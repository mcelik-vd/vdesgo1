import loadCpanelConfig from '../cpanel-config.cjs'
import pg from 'pg'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

loadCpanelConfig()

const connection = new URL(process.env.DATABASE_URL)
if (connection.hostname !== '127.0.0.1' || connection.port !== '5433'
  || connection.pathname !== '/krutoncom_b2b') {
  throw new Error('Migration requires the approved live PostgreSQL 17 target.')
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrations = [
  '001-mobile-backend-foundation.sql',
  '002-mobile-pricing-order-foundation.sql',
  '003-mobile-order-tax-snapshot.sql',
  '004-mobile-sales-invoice-idempotency.sql',
  '006-mobile-customer-access-tombstones.sql',
  '007-mobile-daily-work-sessions.sql',
  '008-central-sales-price-net-semantics.sql',
  '009-mobile-work-session-odometer.sql',
  '010-mobile-location-tracking.sql',
  '011-mobile-route-history-stops.sql',
  '012-product-images.sql',
  '013-unverified-visit-starts.sql',
  '014-sales-invoice-promotions.sql',
  '015-sales-invoice-print-tracking.sql',
  '016-mobile-multiple-workday-sessions.sql',
  '017-mobile-reopen-closed-workday.sql',
  '018-distributor-reset-mobile-order-delete.sql',
  '036-mobile-print-before-sale-transfer.sql',
  '038-customer-tckn.sql',
]
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const backupDirectory = path.join(root, 'backups')
const backupPath = path.join(backupDirectory, `pre-mobile-migrations-${timestamp}.dump`)
const logicalBackupPath = path.join(backupDirectory, `pre-mobile-migrations-${timestamp}.json.gz`)
const pgDumpCandidates = [
  '/opt/alt/postgresql17/usr/bin/pg_dump',
  '/usr/pgsql-17/bin/pg_dump',
  'pg_dump',
]

const runPgDump = (command) => new Promise((resolve, reject) => {
  const child = spawn(command, [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--file',
    backupPath,
    '--host',
    connection.hostname,
    '--port',
    connection.port,
    '--username',
    decodeURIComponent(connection.username),
    '--dbname',
    connection.pathname.slice(1),
  ], {
    env: { ...process.env, PGPASSWORD: connection.password },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  child.on('error', reject)
  child.on('close', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`pg_dump exited with ${code}: ${stderr.trim()}`))
  })
})

await mkdir(backupDirectory, { recursive: true })
let backupError
let verifiedBackupPath = backupPath
for (const candidate of pgDumpCandidates) {
  try {
    await runPgDump(candidate)
    backupError = null
    break
  } catch (error) {
    backupError = error
  }
}
if (backupError) {
  const backupClient = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await backupClient.connect()
  try {
    await backupClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const tableResult = await backupClient.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    )
    const tables = {}
    for (const { table_name: tableName } of tableResult.rows) {
      const identifier = `"${tableName.replaceAll('"', '""')}"`
      tables[tableName] = (await backupClient.query(`SELECT * FROM public.${identifier}`)).rows
    }
    const columns = await backupClient.query(
      `SELECT table_name, column_name, ordinal_position, data_type, udt_name,
         is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
    )
    const constraints = await backupClient.query(
      `SELECT c.conrelid::regclass::text AS table_name, c.conname AS constraint_name,
         pg_get_constraintdef(c.oid, true) AS definition
       FROM pg_constraint c
       INNER JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE n.nspname = 'public'
       ORDER BY c.conrelid::regclass::text, c.conname`,
    )
    const indexes = await backupClient.query(
      `SELECT tablename AS table_name, indexname AS index_name, indexdef AS definition
       FROM pg_indexes WHERE schemaname = 'public'
       ORDER BY tablename, indexname`,
    )
    await backupClient.query('COMMIT')
    const payload = {
      format: 'vdesgo-logical-json-v1',
      generatedAt: new Date().toISOString(),
      database: connection.pathname.slice(1),
      sourceBackupError: backupError.message,
      columns: columns.rows,
      constraints: constraints.rows,
      indexes: indexes.rows,
      tables,
    }
    await writeFile(logicalBackupPath, gzipSync(JSON.stringify(payload), { level: 9 }))
    await chmod(logicalBackupPath, 0o600)
    verifiedBackupPath = logicalBackupPath
  } catch (error) {
    await backupClient.query('ROLLBACK').catch(() => undefined)
    throw new Error(`Live logical backup failed; migration refused. ${error.message}`)
  } finally {
    await backupClient.end()
  }
}
const backup = await stat(verifiedBackupPath)
if (backup.size < 1024) throw new Error('Live backup is unexpectedly small; migration refused.')
console.log(`Verified live backup: ${path.basename(verifiedBackupPath)} (${backup.size} bytes)`)

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
try {
  const version = await client.query("SELECT current_setting('server_version_num')::int AS version")
  if (version.rows[0].version < 170000) throw new Error('PostgreSQL 17 or newer is required.')
  const prerequisites = await client.query(
    `SELECT to_regclass('public.distributor_users') IS NOT NULL AS users,
       to_regclass('public.sales_representatives') IS NOT NULL AS representatives,
       to_regclass('public.orders') IS NOT NULL AS orders`,
  )
  if (!prerequisites.rows[0].users || !prerequisites.rows[0].representatives
    || !prerequisites.rows[0].orders) {
    throw new Error('Live ERP schema prerequisites are missing.')
  }

  const sqlParts = await Promise.all(migrations.map(async (name) => {
    const sql = await readFile(path.join(root, 'migrations', name), 'utf8')
    return sql.replace(/^\s*BEGIN;\s*$/gmi, '').replace(/^\s*COMMIT;\s*$/gmi, '')
  }))

  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(20261015, 9)')
  const migrationTable = await client.query(
    "SELECT to_regclass('public.mobile_backend_migrations') IS NOT NULL AS exists",
  )
  const appliedMigrations = migrationTable.rows[0].exists
    ? new Set((await client.query(
      'SELECT name FROM mobile_backend_migrations WHERE name = ANY($1::text[])',
      [migrations.map((name) => name.replace(/\.sql$/, ''))],
    )).rows.map(({ name }) => name))
    : new Set()
  const pendingSql = sqlParts.filter((_, index) =>
    !appliedMigrations.has(migrations[index].replace(/\.sql$/, '')))
  if (pendingSql.length) await client.query(pendingSql.join('\n'))
  const verification = await client.query(
    `SELECT
       to_regclass('public.mobile_work_sessions') IS NOT NULL AS work_sessions,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'mobile_work_sessions'
           AND column_name = 'opening_odometer_km'
       ) AS opening_odometer,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'mobile_work_sessions'
           AND column_name = 'closing_odometer_km'
       ) AS closing_odometer,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'mobile_route_points'
       ) AS route_points,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'mobile_route_stops'
       ) AS route_stops,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'customer_cards'
           AND column_name = 'location_accuracy_m'
       ) AS customer_location_accuracy,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'factory_products'
           AND column_name = 'image_data'
       ) AS product_images,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'field_visits'
           AND column_name = 'start_location_verified'
       ) AS unverified_visit_starts,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales_invoices'
           AND column_name = 'promotion_code'
       ) AS sales_invoice_promotions,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'sales_invoices'
           AND column_name = 'printed_at'
       ) AS sales_invoice_print_tracking,
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.mobile_work_sessions'::regclass
           AND conname = 'mobile_work_sessions_tenant_code_sales_representative_id_bu_key'
       ) AS reopen_constraint_removed,
       EXISTS (
         SELECT 1 FROM pg_index
         WHERE indexrelid = to_regclass('public.mobile_work_sessions_one_open_per_rep_day_uidx')
           AND indisunique AND indpred IS NOT NULL
       ) AS one_open_workday_index,
       (SELECT COUNT(*)::int FROM mobile_backend_migrations
        WHERE name = ANY($1::text[])) AS migration_count`,
    [migrations.map((name) => name.replace(/\.sql$/, ''))],
  )
  const result = verification.rows[0]
  if (!result.work_sessions || !result.opening_odometer || !result.closing_odometer
    || !result.route_points || !result.route_stops || !result.customer_location_accuracy
    || !result.product_images
    || !result.unverified_visit_starts
    || !result.sales_invoice_promotions
    || !result.sales_invoice_print_tracking
    || !result.reopen_constraint_removed
    || !result.one_open_workday_index
    || result.migration_count !== migrations.length) {
    throw new Error(`Migration verification failed: ${JSON.stringify(result)}`)
  }
  await client.query('COMMIT')
  console.log(`Mobile migrations applied and verified: ${JSON.stringify(result)}`)
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await client.end()
}
