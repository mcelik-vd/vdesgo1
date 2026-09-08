import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('SUPABASE_DATABASE_URL is required.')
  process.exit(1)
}

const schemaPath = fileURLToPath(new URL('../schema.sql', import.meta.url))
const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  await client.query(await readFile(schemaPath, 'utf8'))
  console.log('PostgreSQL schema deployed successfully.')
} finally {
  await client.end().catch(() => undefined)
}
