import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { createMobileRouter } from './mobile/mobile-api.js'
import {
  factoryModules,
  factoryRoleDefaults,
  hasFactoryPermission,
  normalizeFactoryPermissions,
  resolveFactoryPermissions,
  resolveFactoryRequestPermission,
  canManageDistributorOperations,
} from './services/factory-access.js'
import { allowsDistributorScope, resolveOperationTenant } from './services/operation-tenant.js'
import { registerFactoryCustomerCardRoutes, resolveFactoryCustomerCard, syncFactoryCustomerCards } from './services/factory-customer-cards.js'
import { normalizeTckn, normalizeCustomerEmail } from './services/customer-identity.js'
import { registerSupplierReturnRoutes } from './services/supplier-return-service.js'
import { registerEDocumentRoutes } from './services/e-document-service.js'
import { assertProductionGoodsStockAfterChange, loadProductionGoodsEntry, normalizeProductionGoodsLines } from './services/production-goods-entry-service.js'
import {
  distributorModules,
  hasDistributorPermission,
  normalizeDistributorPermissions,
  resolveDistributorRequestPermission,
  serializeDistributorRole,
} from './services/distributor-access.js'
import {
  availableStock,
  insertInvoiceLines,
  reverseSalesInvoiceCustomerBalance,
} from './services/sales-invoice-application-service.js'
import {
  allocateFactoryInvoiceLots,
  assertLotExpiryDates,
  assertFactoryLotAvailability,
  getFactoryLotBalances,
  limitLotBalancesToStock,
  normalizeLotCode,
  normalizeLotExpiryDate,
} from './services/factory-lot-service.js'
import { cancelReturnInvoice } from './services/return-invoice-cancellation-service.js'
import { evaluateOrderSubmission, normalizeLegacyStandardUnitPrice } from './services/pricing-service.js'
import { markSalesInvoicePrinted, markSalesInvoicesPrinted } from './services/sales-invoice-print-service.js'
import { assignReturnInvoiceNumber } from './services/return-invoice-print-service.js'
import { customerTypeReportCondition, loadReportFilterOptions } from './services/report-filters.js'
import { parseProductImage } from './services/product-image.js'
import { assertCustomerCredit, normalizeCreditLimit, openOrderCreditSql } from './services/customer-credit-service.js'
import { latestProductPricesQuery } from './services/price-list-report-service.js'
import { assertOrderNotInvoiced, loadErpOrder, orderEditLines, replaceErpOrder } from './services/erp-order-edit-service.js'
import { cancelWarehouseOperation, loadWarehouseOperation, replaceWarehouseOperation } from './services/warehouse-operation-service.js'
import { createDistributorResetRouter } from './services/distributor-reset-router.js'
import {
  createFactoryOrder,
  deletePendingFactoryOrder,
  listFactoryOrders,
  loadFactoryOrderProducts,
  updatePendingFactoryOrder,
} from './services/factory-order-service.js'
import { buildWarehouseTransferReportQuery } from './services/warehouse-transfer-report-service.js'
import { buildOtherStockMovementReportQuery } from './services/other-stock-movement-report-service.js'
import {
  countPendingFactoryInvoiceTransfers,
  createFactoryInvoiceTransferCode,
  importFactoryInvoiceTransfer,
  loadImportedFactoryInvoice,
  loadFactoryInvoiceTransfer,
} from './services/factory-invoice-transfer-service.js'
import {
  aggregateOrderLines,
  buildOrderInvoiceAmounts,
  normalizeBulkOrderIds,
  recalculateMobileOrderLines,
  validateOrderTotal,
} from './services/bulk-order-conversion-service.js'

dotenv.config()
pg.types.setTypeParser(1082, (value) => value)

const app = express()
const PORT = Number(process.env.PORT || 4000)
const databaseUrl = process.env.DATABASE_URL
const productionIntegrationToken = process.env.PRODUCTION_INTEGRATION_TOKEN || ''
const scrypt = promisify(scryptCallback)
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))
const tenantIdentityMigrationPath = new URL('./migrations/021-tenant-identity.sql', import.meta.url)
const loginAttempts = new Map()
const requiredPasswordLength = 8
const mobileTokenPrefix = 'vdesgo_mobile_v1_'
const isValidPassword = (value) => typeof value === 'string' && value.length === requiredPasswordLength

const parseMoneyNumber = (value) => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const normalized = String(value).trim()
  if (!normalized) return 0
  const cleaned = normalized.replace(/[^0-9,.-]/g, '')
  if (!cleaned) return 0
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return Number(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    return Number(cleaned.replace(',', '.'))
  }
  if (cleaned.includes('.') && !cleaned.includes(',')) {
    return Number(cleaned)
  }
  return Number(cleaned)
}

const formatMoney = (value) => {
  const numericValue = Number(value) || 0
  return `${numericValue.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`
}

const hashPassword = async (password) => {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = await scrypt(password, salt, 64)
  return `${salt}:${derivedKey.toString('hex')}`
}

const verifyPassword = async (password, passwordHash) => {
  const [salt, key] = passwordHash?.split(':') ?? []
  if (!salt || !key) return false

  const storedKey = Buffer.from(key, 'hex')
  const derivedKey = await scrypt(password, salt, storedKey.length)
  return storedKey.length === derivedKey.length && timingSafeEqual(storedKey, derivedKey)
}

const ensureAuthStorage = async () => {
  if (!databaseUrl) return

  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    await client.query(await readFile(schemaPath, 'utf8'))
    await client.query(await readFile(new URL('./migrations/033-official-sales-invoice-numbering.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/027-supplier-return-approval.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/028-supplier-return-invoice-details.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/031-promotion-target-audience.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/035-customer-credit-and-latest-prices.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/036-mobile-print-before-sale-transfer.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/037-e-document-exports.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/038-customer-tckn.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/039-e-document-schema-version-text.sql', import.meta.url), 'utf8'))
    await client.query(await readFile(new URL('./migrations/040-customer-email.sql', import.meta.url), 'utf8'))
    await client.query('ALTER TABLE factory_users ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE')
    await client.query('ALTER TABLE distributor_users ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT FALSE')
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id BIGSERIAL PRIMARY KEY,
        token_hash CHAR(64) UNIQUE NOT NULL,
        account_type VARCHAR(20) NOT NULL CHECK (account_type IN ('factory', 'distributor')),
        account_user_id BIGINT NOT NULL,
        username VARCHAR(80) NOT NULL,
        password_change_required BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )
    `)
    await client.query('ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS account_user_id BIGINT')
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_security_migrations (
        name VARCHAR(120) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query('BEGIN')
    try {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', ['714921063'])
      const tenantMigration = await client.query(
        `INSERT INTO auth_security_migrations (name)
         VALUES ('tenant-identity-v1')
         ON CONFLICT (name) DO NOTHING
         RETURNING name`,
      )
      if (tenantMigration.rowCount) {
        await client.query(await readFile(tenantIdentityMigrationPath, 'utf8'))
      }
      const bootstrapMigration = await client.query(
        `INSERT INTO auth_security_migrations (name)
         VALUES ('require-rotation-for-legacy-bootstrap-users-v1')
         ON CONFLICT (name) DO NOTHING
         RETURNING name`,
      )
      if (bootstrapMigration.rowCount) {
        await client.query(
          `UPDATE factory_users SET password_change_required = TRUE
           WHERE username IN ('merkez_admin', 'fabrika_admin')`,
        )
        await client.query(
          `UPDATE distributor_users SET password_change_required = TRUE
           WHERE username IN ('antalya_admin', 'burdur_sales')`,
        )
      }
      const passwordPolicyMigration = await client.query(
        `INSERT INTO auth_security_migrations (name)
         VALUES ('require-eight-character-passwords-v1')
         ON CONFLICT (name) DO NOTHING
         RETURNING name`,
      )
      if (passwordPolicyMigration.rowCount) {
        await client.query("UPDATE factory_users SET password_change_required = TRUE WHERE status = 'Aktif'")
        await client.query("UPDATE distributor_users SET password_change_required = TRUE WHERE status = 'Aktif'")
        await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL')
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE')
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS province VARCHAR(80) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS district VARCHAR(80) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location VARCHAR(255) NOT NULL DEFAULT ''")
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(12, 2)')
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_1 VARCHAR(20) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_2 VARCHAR(20) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS customer_discount_3 VARCHAR(20) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS cash_discount VARCHAR(20) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS deferred_discount VARCHAR(20) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS tckn VARCHAR(11) NOT NULL DEFAULT ''")
    await client.query("ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS tax_office VARCHAR(120) NOT NULL DEFAULT ''")
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location_latitude NUMERIC(9, 6)')
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location_longitude NUMERIC(9, 6)')
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(8, 2)')
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS location_captured_at TIMESTAMPTZ')
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'customer_cards'::regclass
            AND conname = 'customer_cards_tckn_check'
        ) THEN
          ALTER TABLE customer_cards ADD CONSTRAINT customer_cards_tckn_check
            CHECK (tckn = '' OR tckn ~ '^[0-9]{11}$');
        END IF;
      END $$;
    `)
    await client.query('ALTER TABLE customer_cards ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()')
    await client.query(`
      CREATE TABLE IF NOT EXISTS security_access_matrix (
        username VARCHAR(80) PRIMARY KEY,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb
      )
    `)
    const balanceType = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'customer_cards' AND column_name = 'balance'
    `)
    if (['character varying', 'text', 'character'].includes(balanceType.rows[0]?.data_type)) {
      await client.query('ALTER TABLE customer_cards ALTER COLUMN balance DROP DEFAULT')
      await client.query(`
        ALTER TABLE customer_cards
        ALTER COLUMN balance TYPE NUMERIC(14,2)
        USING CASE
          WHEN balance IS NULL OR balance = '' THEN 0
          WHEN balance ~ ',' THEN replace(replace(regexp_replace(balance, '[^0-9,.-]', '', 'g'), '.', ''), ',', '.')::numeric
          WHEN balance ~ '.' THEN regexp_replace(balance, '[^0-9.]', '', 'g')::numeric
          ELSE regexp_replace(balance, '[^0-9.-]', '', 'g')::numeric
        END
      `)
    }
    await client.query('ALTER TABLE customer_cards ALTER COLUMN balance SET DEFAULT 0')
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoices (
        id SERIAL PRIMARY KEY, invoice_no VARCHAR(50) UNIQUE NOT NULL, invoice_date DATE NOT NULL,
        customer_code VARCHAR(50) NOT NULL, customer_name VARCHAR(150) NOT NULL DEFAULT '',
        sales_representative VARCHAR(150) NOT NULL DEFAULT '', sale_type VARCHAR(30), warehouse_code VARCHAR(50) NOT NULL,
        total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0, created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await client.query('ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS cancelled BOOLEAN NOT NULL DEFAULT FALSE')
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoice_lines (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
        quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
        total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
        line_total NUMERIC(14, 2) NOT NULL DEFAULT 0, is_promotional BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    await client.query('ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS discount_1 NUMERIC(8, 3) NOT NULL DEFAULT 0')
    await client.query('ALTER TABLE sales_invoice_lines ADD COLUMN IF NOT EXISTS discount_2 NUMERIC(8, 3) NOT NULL DEFAULT 0')
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoice_line_lots (
        id BIGSERIAL PRIMARY KEY,
        sales_invoice_line_id INTEGER NOT NULL REFERENCES sales_invoice_lines(id) ON DELETE CASCADE,
        lot_code VARCHAR(120),
        quantity NUMERIC(14, 3) NOT NULL CHECK (quantity > 0),
        allocation_type VARCHAR(12) NOT NULL CHECK (allocation_type IN ('FIFO', 'FEFO', 'MANUAL', 'UNTRACKED')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'sales_invoice_line_lots'::regclass
          AND conname = 'sales_invoice_line_lots_allocation_type_check'
          AND pg_get_constraintdef(oid) NOT LIKE '%FEFO%') THEN
          ALTER TABLE sales_invoice_line_lots DROP CONSTRAINT sales_invoice_line_lots_allocation_type_check;
          ALTER TABLE sales_invoice_line_lots ADD CONSTRAINT sales_invoice_line_lots_allocation_type_check
            CHECK (allocation_type IN ('FIFO', 'FEFO', 'MANUAL', 'UNTRACKED'));
        END IF;
      END $$`)
    await client.query('CREATE INDEX IF NOT EXISTS sales_invoice_line_lots_lot_idx ON sales_invoice_line_lots (lot_code) WHERE lot_code IS NOT NULL')
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_rep_customers (
        id SERIAL PRIMARY KEY, tenant_code VARCHAR(50), sales_representative_id INTEGER NOT NULL,
        customer_code VARCHAR(50) NOT NULL, route_day VARCHAR(20) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (tenant_code, sales_representative_id, customer_code, route_day)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS other_stock_entries (
        id SERIAL PRIMARY KEY,
        receipt_no INTEGER NOT NULL,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        entering_warehouse_code VARCHAR(50) NOT NULL,
        exiting_warehouse_code VARCHAR(50),
        entry_type VARCHAR(40) NOT NULL DEFAULT 'Sair Giriş',
        source_system VARCHAR(40) NOT NULL DEFAULT 'manual',
        source_reference VARCHAR(120),
        tenant_code VARCHAR(50),
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (receipt_no, tenant_code)
      )
    `)
    await client.query("ALTER TABLE other_stock_entries ADD COLUMN IF NOT EXISTS entry_type VARCHAR(40) NOT NULL DEFAULT 'Sair Giriş'")
    await client.query("ALTER TABLE other_stock_entries ADD COLUMN IF NOT EXISTS source_system VARCHAR(40) NOT NULL DEFAULT 'manual'")
    await client.query('ALTER TABLE other_stock_entries ADD COLUMN IF NOT EXISTS source_reference VARCHAR(120)')
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS other_stock_entries_source_reference_uidx
      ON other_stock_entries (tenant_code, entry_type, source_system, source_reference)
      WHERE source_reference IS NOT NULL`)
    await client.query(`
      CREATE TABLE IF NOT EXISTS other_stock_entry_lines (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES other_stock_entries(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL,
        product_name VARCHAR(150) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
        quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        total_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_quantity > 0),
        production_lot_code VARCHAR(120)
      )
    `)
    await client.query('ALTER TABLE other_stock_entry_lines ADD COLUMN IF NOT EXISTS total_quantity NUMERIC(12, 2)')
    await client.query('ALTER TABLE other_stock_entry_lines ADD COLUMN IF NOT EXISTS production_lot_code VARCHAR(120)')
    await client.query('ALTER TABLE other_stock_entry_lines ADD COLUMN IF NOT EXISTS lot_expiry_date DATE')
    await client.query(`
      CREATE TABLE IF NOT EXISTS other_stock_exits (
        id SERIAL PRIMARY KEY,
        receipt_no INTEGER NOT NULL,
        exit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        exiting_warehouse_code VARCHAR(50) NOT NULL,
        tenant_code VARCHAR(50),
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (receipt_no, tenant_code)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS other_stock_exit_lines (
        id SERIAL PRIMARY KEY,
        exit_id INTEGER NOT NULL REFERENCES other_stock_exits(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL,
        product_name VARCHAR(150) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
        quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
      )
    `)
    await client.query('ALTER TABLE other_stock_exit_lines ADD COLUMN IF NOT EXISTS production_lot_code VARCHAR(120)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouse_transfers (
        id SERIAL PRIMARY KEY,
        receipt_no INTEGER NOT NULL,
        transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
        entering_warehouse_code VARCHAR(50) NOT NULL,
        exiting_warehouse_code VARCHAR(50) NOT NULL,
        tenant_code VARCHAR(50),
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (receipt_no, tenant_code)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS warehouse_transfer_lines (
        id SERIAL PRIMARY KEY,
        transfer_id INTEGER NOT NULL REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL,
        product_name VARCHAR(150) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
        quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
      )
    `)
    await client.query('ALTER TABLE warehouse_transfer_lines ADD COLUMN IF NOT EXISTS production_lot_code VARCHAR(120)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_loadings (
        id SERIAL PRIMARY KEY, receipt_no INTEGER NOT NULL, loading_date DATE NOT NULL DEFAULT CURRENT_DATE,
        entering_warehouse_code VARCHAR(50) NOT NULL, exiting_warehouse_code VARCHAR(50) NOT NULL,
        tenant_code VARCHAR(50), created_by VARCHAR(80), created_at TIMESTAMP DEFAULT NOW(), UNIQUE (receipt_no, tenant_code)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_loading_lines (
        id SERIAL PRIMARY KEY, loading_id INTEGER NOT NULL REFERENCES vehicle_loadings(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
        inner_quantity VARCHAR(50) NOT NULL DEFAULT '', quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        total_quantity NUMERIC(12, 2) NOT NULL CHECK (total_quantity > 0)
      )
    `)
    await client.query('ALTER TABLE vehicle_loading_lines ADD COLUMN IF NOT EXISTS production_lot_code VARCHAR(120)')
    for (const table of ['other_stock_entries', 'other_stock_exits', 'warehouse_transfers', 'vehicle_loadings']) {
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`)
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(80)`)
    }
    await client.query(`
      CREATE TABLE IF NOT EXISTS distributor_users (
        id SERIAL PRIMARY KEY,
        customer_code VARCHAR(50),
        distributor_name VARCHAR(150) NOT NULL,
        username VARCHAR(80) UNIQUE NOT NULL,
        password VARCHAR(200) NOT NULL DEFAULT '',
        password_hash VARCHAR(255),
        role_name VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Aktif',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await client.query('ALTER TABLE distributor_users ADD COLUMN IF NOT EXISTS customer_code VARCHAR(50)')
    await client.query('ALTER TABLE distributor_users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)')
    await client.query(`
      CREATE TABLE IF NOT EXISTS factory_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(80) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role_name VARCHAR(80) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'Aktif',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS central_promotions (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(150) NOT NULL,
        promotion_type VARCHAR(40) NOT NULL,
        condition_type VARCHAR(40) NOT NULL,
        condition_unit VARCHAR(50) NOT NULL DEFAULT 'Adet',
        threshold NUMERIC(12, 2) NOT NULL DEFAULT 1,
        reward_value NUMERIC(12, 2) NOT NULL DEFAULT 0,
        reward_type VARCHAR(30) NOT NULL DEFAULT 'discount',
        application_mode VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (application_mode IN ('optional', 'mandatory')),
        reward_product_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        reward_product_units JSONB NOT NULL DEFAULT '{}'::jsonb,
        priority INTEGER NOT NULL DEFAULT 0,
        start_date DATE NOT NULL,
        end_date DATE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        customer_type_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        customer_group_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        customer_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        product_type_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        product_group_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        product_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        created_at TIMESTAMP DEFAULT NOW()
      )
    `)
      await client.query("ALTER TABLE central_promotions ADD COLUMN IF NOT EXISTS reward_type VARCHAR(30) NOT NULL DEFAULT 'discount'")
      await client.query("ALTER TABLE central_promotions ADD COLUMN IF NOT EXISTS reward_product_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]")
      await client.query("ALTER TABLE central_promotions ADD COLUMN IF NOT EXISTS condition_unit VARCHAR(50) NOT NULL DEFAULT 'Adet'")
      await client.query("ALTER TABLE central_promotions ADD COLUMN IF NOT EXISTS reward_product_units JSONB NOT NULL DEFAULT '{}'::jsonb")
      await client.query("ALTER TABLE central_promotions ADD COLUMN IF NOT EXISTS application_mode VARCHAR(20) NOT NULL DEFAULT 'optional' CHECK (application_mode IN ('optional', 'mandatory'))")

    const legacyUsers = await client.query("SELECT username, password FROM distributor_users WHERE password_hash IS NULL AND password <> ''")
    for (const user of legacyUsers.rows) {
      const passwordHash = await hashPassword(user.password)
      await client.query('UPDATE distributor_users SET password_hash = $1, password = \'\' WHERE username = $2', [passwordHash, user.username])
    }

  } finally {
    await client.end().catch(() => undefined)
  }
}

const fallbackRoles = Object.entries(factoryRoleDefaults).map(([roleName, permissionsJson]) => ({
  id: `builtin-${Buffer.from(roleName).toString('hex')}`,
  name: roleName.replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase('tr-TR')),
  level: 'Yerleşik rol',
  active: true,
  builtin: true,
  permissions: [],
  permissionsJson,
}))

const fallbackUsers = [
  { distributor: 'Antalya Dağıtım A.Ş.', username: 'antalya_admin', password: '********', role: 'Genel Müdür', status: 'Aktif' },
  { distributor: 'Burdur Toptan', username: 'burdur_sales', password: '********', role: 'Satış Müdürü', status: 'Aktif' },
  { distributor: 'Mersin Müşteri', username: 'mersin_prod', password: '********', role: 'Üretim Müdürü', status: 'Pasif' },
]

const factoryUsers = [
  { username: 'merkez_admin', password: '********', role: 'Merkez Fabrika Yönetimi', distributor: 'Fabrika Merkezi', status: 'Aktif' },
  { username: 'fabrika_admin', password: '********', role: 'Merkez Fabrika Yönetimi', distributor: 'Fabrika Merkezi', status: 'Aktif' },
]

const allowedOrigins = [
  ...(process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://vdesgo-353a1.web.app',
  ]),
  'http://localhost:5174',
  'http://127.0.0.1:5174',
]

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

const sessionDurationMs = 12 * 60 * 60 * 1000
const publicApiPaths = new Set(['/health', '/auth/login', '/mobile/v1/auth/session'])
app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS' || publicApiPaths.has(req.path)) return next()
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (req.path.startsWith('/inventory/integrations/production/')) {
    const expected = Buffer.from(productionIntegrationToken)
    const supplied = Buffer.from(token || '')
    if (!expected.length) return res.status(503).json({ error: 'Production entegrasyonu yapılandırılmamış.' })
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.status(401).json({ error: 'Production entegrasyon anahtarı geçersiz.' })
    req.authenticatedUser = { accountType: 'factory', username: 'vdesgo-production', tenantCode: 'F:MAIN', integrationClient: true }
    return next()
  }
  if (!token) return res.status(401).json({ error: 'Oturum gerekli.' })
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const distributorRoleSchema = await client.query(
      "SELECT to_regclass('security_distributor_roles') IS NOT NULL AS available",
    )
    const distributorRoleJoin = distributorRoleSchema.rows[0].available
      ? `LEFT JOIN LATERAL (
           SELECT permissions_json AS permissions, active
           FROM security_distributor_roles
           WHERE lower(btrim(name)) = lower(btrim(du.role_name))
           ORDER BY id DESC LIMIT 1
         ) distributor_role_access ON s.account_type = 'distributor'`
      : `LEFT JOIN LATERAL (
           SELECT NULL::jsonb AS permissions, TRUE AS active
         ) distributor_role_access ON s.account_type = 'distributor'`
    const result = await client.query(
      `SELECT s.id AS "sessionId", s.account_type AS "accountType", s.username,
        s.account_user_id AS "userId",
        s.password_change_required AS "passwordChangeRequired",
        CASE WHEN s.account_type = 'factory' THEN fu.role_name ELSE du.role_name END AS role,
        role_access.permissions AS "rolePermissions", role_access.active AS "roleActive",
        distributor_role_access.permissions AS "distributorRolePermissions",
        distributor_role_access.active AS "distributorRoleActive",
        legacy_matrix.permissions AS "distributorAccessMatrix",
        du.distributor_name AS distributor,
        du.customer_code AS "customerCode",
        CASE WHEN s.account_type = 'factory' THEN fu.tenant_code ELSE du.tenant_code END AS "tenantCode"
       FROM auth_sessions s
       LEFT JOIN factory_users fu ON s.account_type = 'factory' AND fu.id = s.account_user_id AND fu.username = s.username AND fu.status = 'Aktif'
       LEFT JOIN distributor_users du ON s.account_type = 'distributor' AND du.id = s.account_user_id AND du.username = s.username AND du.status = 'Aktif'
       LEFT JOIN LATERAL (
         SELECT to_jsonb(r)->'permissions_json' AS permissions
           , r.active
         FROM security_roles r
         WHERE lower(btrim(r.name)) = lower(btrim(
           CASE WHEN s.account_type = 'factory' THEN fu.role_name ELSE du.role_name END
         ))
         ORDER BY r.id DESC LIMIT 1
       ) role_access ON TRUE
       ${distributorRoleJoin}
       LEFT JOIN security_access_matrix legacy_matrix
         ON s.account_type = 'distributor' AND legacy_matrix.username = s.username
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
         AND ((s.account_type = 'factory' AND fu.username IS NOT NULL AND COALESCE(role_access.active, TRUE))
           OR (s.account_type = 'distributor' AND du.username IS NOT NULL AND du.customer_code IS NOT NULL
             AND COALESCE(distributor_role_access.active, TRUE)))
       LIMIT 1`,
      [tokenHash],
    )
    if (!result.rowCount) return res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş.' })
    const session = result.rows[0]
    const isMobileSession = token.startsWith(mobileTokenPrefix)
    if (isMobileSession && !req.path.startsWith('/mobile/v1/')) {
      return res.status(403).json({ error: 'Bu mobil oturum ERP web API erişimi için kullanılamaz.' })
    }
    const mobileAdminRequest = ['factory', 'distributor'].includes(session.accountType)
      && req.path.startsWith('/mobile/v1/admin/')
    if (!isMobileSession && req.path.startsWith('/mobile/v1/') && !mobileAdminRequest) {
      return res.status(401).json({ error: 'Mobil cihaz oturumu gerekli.' })
    }
    req.authenticatedUser = {
      sessionId: session.sessionId,
      userId: session.userId,
      username: session.username,
      accountType: session.accountType,
      role: session.role,
      rolePermissions: session.accountType === 'factory'
        ? resolveFactoryPermissions(session.role, session.rolePermissions)
        : null,
      distributorRolePermissions: session.accountType === 'distributor'
        ? normalizeDistributorPermissions(session.distributorRolePermissions)
        : null,
      distributorAccessMatrix: session.accountType === 'distributor'
        ? session.distributorAccessMatrix
        : null,
      distributor: session.distributor,
      customerCode: session.customerCode,
      tenantCode: session.tenantCode,
      passwordChangeRequired: session.passwordChangeRequired,
    }
    req.headers['x-vdesgo-account-type'] = session.accountType
    req.headers['x-vdesgo-username'] = session.username
    await client.query('UPDATE auth_sessions SET last_used_at = NOW() WHERE id = $1', [session.sessionId])
    if (session.passwordChangeRequired && !(
      (req.method === 'POST' && req.path === '/auth/change-password')
      || (req.method === 'POST' && req.path === '/auth/logout')
    )) {
      return res.status(403).json({ error: 'Devam etmeden önce parolanızı değiştirmeniz gerekir.' })
    }
    return next()
  } catch (error) {
    console.error('Session authentication failed:', error)
    return res.status(503).json({ error: 'Oturum şu anda doğrulanamıyor.' })
  } finally {
    await client.end().catch((error) => console.error('Session database connection cleanup failed:', error))
  }
})

app.use((req, res, next) => {
  if (req.authenticatedUser?.integrationClient === true
    && req.path.startsWith('/inventory/integrations/production/')) return next()
  if (req.authenticatedUser?.accountType !== 'factory') return next()
  const permission = resolveFactoryRequestPermission(req.method, req.path, req.body)
  if (!permission) return next()
  if (permission.action === 'manage') {
    return requireFactoryAdministrator(req, res) ? next() : undefined
  }
  const modules = permission.modules ?? [permission.module]
  if (!modules.some((module) => hasFactoryPermission(
    req.authenticatedUser.role,
    req.authenticatedUser.rolePermissions,
    module,
    permission.action,
  ))) {
    return res.status(403).json({ error: 'Bu işlem için merkez rolünüzde yetki tanımlanmamış.' })
  }
  return next()
})

app.use((req, res, next) => {
  if (req.authenticatedUser?.accountType !== 'distributor' || !req.authenticatedUser.distributorRolePermissions) return next()
  const permission = resolveDistributorRequestPermission(req.method, req.path, req.body)
  if (!permission) return next()
  const modules = permission.modules ?? [permission.module]
  if (!modules.some((module) => hasDistributorPermission(
    req.authenticatedUser.distributorRolePermissions,
    module,
    permission.action,
  ))) {
    return res.status(403).json({ error: 'Bu işlem distribütör rolünüz için yetkilendirilmemiş.' })
  }
  return next()
})

app.use('/mobile/v1', createMobileRouter({ databaseUrl, verifyPassword }))
app.use(async (req, res, next) => {
  if (req.query.distributorCode === undefined) return next()
  if (!allowsDistributorScope(req.method, req.path)) {
    return res.status(400).json({ error: 'Bu işlem distribütör kapsamını desteklemiyor.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    req.operationTenant = await resolveOperationTenant(client, req.authenticatedUser, req.query.distributorCode)
    return next()
  } catch (error) {
    console.error('Distributor operation scope rejected:', error)
    return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : 'Distribütör kapsamı doğrulanamadı.' })
  } finally { await client.end().catch((error) => console.error('Operation scope cleanup failed:', error)) }
})

app.use('/factory/resets', createDistributorResetRouter({ databaseUrl, verifyPassword }))

const recordAudit = async (client, req, event) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, changed_by, ip_address, tenant_code)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NULLIF($7, '')::inet, $8)`,
    [event.entityType, event.entityId == null ? null : String(event.entityId), event.action,
      event.oldValue == null ? null : JSON.stringify(event.oldValue), event.newValue == null ? null : JSON.stringify(event.newValue),
      req.header('x-vdesgo-username') || null, req.ip || null, req.operationTenant || req.authenticatedUser?.tenantCode || null],
  )
}

const requireFactoryAccount = (req, res) => {
  if (req.authenticatedUser?.accountType !== 'factory') {
    res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Bu işlem yalnızca merkez fabrika hesabı tarafından yapılabilir.' })
    return false
  }
  return true
}

const requireFactoryAdministrator = (req, res) => {
  if (!requireFactoryAccount(req, res)) return false
  const role = req.authenticatedUser?.role?.trim().toLocaleLowerCase('tr-TR')
  if (!['genel müdür', 'sistem yöneticisi'].includes(role)) {
    res.status(403).json({ error: 'Bu işlem için Genel Müdür veya Sistem Yöneticisi yetkisi gerekir.' })
    return false
  }
  return true
}

const loginRateLimit = (req, res, next) => {
  const key = `${req.ip}:${String(req.body?.username || '').toLowerCase()}`
  const now = Date.now()
  const current = loginAttempts.get(key)
  if (!current || now - current.startedAt > 15 * 60 * 1000) {
    loginAttempts.set(key, { startedAt: now, failures: 0 })
    return next()
  }
  if (current.failures >= 5) return res.status(429).json({ ok: false, error: 'Çok fazla başarısız giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.' })
  return next()
}

const registerLoginFailure = (req) => {
  const key = `${req.ip}:${String(req.body?.username || '').toLowerCase()}`
  const current = loginAttempts.get(key) || { startedAt: Date.now(), failures: 0 }
  current.failures += 1
  loginAttempts.set(key, current)
}

const clearLoginFailures = (req) => loginAttempts.delete(`${req.ip}:${String(req.body?.username || '').toLowerCase()}`)

const resourceDefinitions = {
  customers: { table: 'customer_cards', key: 'code', columns: ['code', 'name', 'title', 'province', 'district', 'type', 'territory', 'salesRepresentative', 'phone', 'mobilePhone', 'taxNo', 'tckn', 'taxOffice', 'address', 'location', 'areaM2', 'balance', 'customerGroupCode', 'customerDiscount1', 'customerDiscount2', 'customerDiscount3', 'cashDiscount', 'deferredDiscount', 'active', 'creditLimit', 'email'], dbColumns: ['code', 'name', 'title', 'province', 'district', 'type', 'territory', 'sales_representative', 'phone', 'mobile_phone', 'tax_no', 'tckn', 'tax_office', 'address', 'location', 'area_m2', 'balance', 'customer_group_code', 'customer_discount_1', 'customer_discount_2', 'customer_discount_3', 'cash_discount', 'deferred_discount', 'active', 'credit_limit', 'email'] },
  customerTypes: { table: 'customer_types', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  customerGroups: { table: 'customer_groups', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  chiefs: { table: 'sales_chiefs', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  regions: { table: 'customer_regions', key: 'code', columns: ['code', 'name', 'manager', 'description'], dbColumns: ['code', 'name', 'manager', 'description'] },
  warehouses: { table: 'factory_warehouses', key: 'code', columns: ['code', 'name', 'type', 'area', 'active'], dbColumns: ['code', 'name', 'type', 'area', 'active'] },
  products: { table: 'factory_products', key: 'code', columns: ['code', 'name', 'category', 'productType', 'unit', 'vat', 'ePoint', 'volume', 'weight', 'imageDataUrl', 'imageMimeType', 'active'], dbColumns: ['code', 'name', 'category', 'product_type', 'unit', 'vat', 'e_point', 'volume', 'weight', 'image_data', 'image_mime_type', 'active'] },
  productGroups: { table: 'product_groups', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  productTypes: { table: 'product_types', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  productUnits: { table: 'product_units', key: 'barcode', columns: ['productCode', 'unit', 'innerQuantity', 'barcode'], dbColumns: ['product_code', 'unit', 'inner_quantity', 'barcode'] },
  prices: { table: 'product_prices', key: 'id', columns: ['id', 'productCode', 'productName', 'startDate', 'endDate', 'purchasePrice', 'salesPrice', 'soundReturnPrice', 'damagedReturnPrice', 'recommendedSalesPrice', 'status'], dbColumns: ['id', 'product_code', 'product_name', 'start_date', 'end_date', 'purchase_price', 'sales_price', 'sound_return_price', 'damaged_return_price', 'recommended_sales_price', 'status'] },
  vehicles: { table: 'shipment_vehicles', key: 'plate', columns: ['plate', 'licenseNumber', 'vehicleType', 'brandModel', 'modelYear', 'capacity', 'insuranceStartDate', 'insuranceEndDate', 'cascoStartDate', 'cascoEndDate', 'lastOilMaintenanceKm', 'lastOilMaintenanceDate', 'tireChangeDate', 'tireChangeKm', 'inspectionDueDate', 'driverName', 'active'], dbColumns: ['plate', 'license_number', 'vehicle_type', 'brand_model', 'model_year', 'capacity', 'insurance_start_date', 'insurance_end_date', 'casco_start_date', 'casco_end_date', 'last_oil_maintenance_km', 'last_oil_maintenance_date', 'tire_change_date', 'tire_change_km', 'inspection_due_date', 'driver_name', 'active'] },
  salesRepresentatives: { table: 'sales_representatives', key: 'id', columns: ['id', 'name', 'phone', 'routeRegion', 'vehicleWarehouseCode', 'orderWarehouseCode', 'salesType', 'note', 'vehiclePlate', 'active', 'maxManualDiscountPercent'], dbColumns: ['id', 'name', 'phone', 'route_region', 'vehicle_warehouse_code', 'order_warehouse_code', 'sales_type', 'note', 'vehicle_plate', 'active', 'max_manual_discount_percent'] },
}

const toApiValue = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value
const resourceColumnDefaults = { max_manual_discount_percent: 0 }

const toResponseRow = (row, definition) => Object.fromEntries(
  definition.columns.map((column, index) => {
    if (column === 'creditLimit') return [column, row.credit_limit == null ? null : Number(row.credit_limit)]
    if (column === 'imageDataUrl') {
      const imageData = row[definition.dbColumns[index]]
      const mimeType = row.image_mime_type
      return [column, imageData && mimeType ? `data:${mimeType};base64,${imageData.toString('base64')}` : null]
    }
    return [
      column,
      toApiValue(row[definition.dbColumns[index]] ?? resourceColumnDefaults[definition.dbColumns[index]] ?? null),
    ]
  }),
)

const prepareProductImageBody = (resource, body) => {
  if (resource !== 'products') return
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Ürün bilgileri geçersiz.'), { statusCode: 400 })
  }
  const image = parseProductImage(body?.imageDataUrl)
  body.imageDataUrl = image.data
  body.imageMimeType = image.mimeType
}

const auditResourceRow = (resource, row) => resource === 'products'
  ? { ...row, image_data: row.image_data ? `[${row.image_data.length} byte product image]` : null }
  : row

const normalizeResourceValue = (resource, column, value) => {
  if (resource === 'customers' && column === 'tckn') return normalizeTckn(value)
  if (resource === 'customers' && column === 'email') return normalizeCustomerEmail(value)
  if (resource === 'customers' && column === 'creditLimit') return normalizeCreditLimit(value)
  if (resource === 'products' && (column === 'imageDataUrl' || column === 'imageMimeType')) {
    return value || null
  }
  if (resource === 'customers' && column === 'areaM2') return value === '' || value == null ? null : Number(value)
  if (resource === 'customers' && column === 'balance') return value === '' || value == null ? 0 : parseMoneyNumber(value)
  if (resource === 'salesRepresentatives' && column === 'maxManualDiscountPercent') {
    const discount = value === '' || value == null ? 0 : Number(value)
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      throw Object.assign(new Error('Maksimum iskonto oranı 0 ile 100 arasında olmalıdır.'), { statusCode: 400 })
    }
    return discount
  }
  return value
}

const getAvailableResourceColumns = async (client, definition) => {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = $1`,
    [definition.table],
  )
  return new Set(result.rows.map((row) => row.column_name))
}

const ensureOptionalResourceValues = (res, definition, body, availableColumns) => {
  for (const [index, column] of definition.columns.entries()) {
    const dbColumn = definition.dbColumns[index]
    if (column !== 'maxManualDiscountPercent') continue
    if (availableColumns.has(dbColumn)) continue
    const value = body?.[column]
    if (value != null && value !== '' && Number(value) !== 0) {
      res.status(503).json({ error: 'Bu alanı kullanmak için mobil fiyatlandırma migration’ı uygulanmalıdır.' })
      return false
    }
  }
  return true
}

const validatePriceDates = (body) => {
  if (!body?.startDate) return 'Fiyat başlangıç tarihi zorunludur.'
  if (!body?.endDate) return 'Fiyat bitiş tarihi zorunludur.'
  if (body.endDate && body.endDate < body.startDate) return 'Fiyat bitiş tarihi başlangıç tarihinden önce olamaz.'
  return null
}

const accessError = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode })

const getRequestTenant = async (client, req) => {
  return req.operationTenant || resolveOperationTenant(client, req.authenticatedUser, req.query.distributorCode)
}

const getReportTenant = getRequestTenant

const tenantResources = new Set(['customers', 'warehouses', 'vehicles', 'salesRepresentatives'])
const resourcePermissionModules = {
  customers: 'CustomerDefinition',
  warehouses: 'WarehouseDefinition',
  products: 'ProductDefinition',
  prices: 'ProductDefinition',
  vehicles: 'ShipmentDefinition',
  salesRepresentatives: 'SalesRepresentativeDefinition',
}
const roleModuleDefaults = {
  'satış müdürü': new Set(['ProductDefinition', 'PriceDefinition']),
  'üretim müdürü': new Set(['ProductDefinition', 'WarehouseDefinition', 'ShipmentDefinition']),
}

const assertResourceAccess = async (client, req, resource, action) => {
  if (req.authenticatedUser?.accountType === 'factory') {
    const moduleName = resourcePermissionModules[resource]
    if (moduleName && !hasFactoryPermission(
      req.authenticatedUser.role,
      req.authenticatedUser.rolePermissions,
      moduleName,
      action === 'read' ? 'view' : action,
    )) {
      throw accessError('Bu merkez rolünde bu veri işlemi için yetki bulunmuyor.')
    }
    return tenantResources.has(resource) ? getRequestTenant(client, req) : null
  }

  if (req.authenticatedUser?.accountType === 'distributor' && req.authenticatedUser.distributorRolePermissions) {
    const moduleName = resourcePermissionModules[resource]
    if (moduleName && !hasDistributorPermission(
      req.authenticatedUser.distributorRolePermissions,
      moduleName,
      action === 'read' ? 'view' : action,
    )) {
      throw accessError('Bu distribütör rolünde bu veri işlemi için yetki bulunmuyor.')
    }
  }

  if (action === 'read' && !tenantResources.has(resource)) return null
  if (action !== 'read' && !tenantResources.has(resource)) {
    throw accessError('Bu ana veri yalnızca fabrika hesabı tarafından değiştirilebilir.')
  }
  const tenantCode = await getRequestTenant(client, req)

  const moduleName = resourcePermissionModules[resource]
  if (!moduleName) return tenantCode

  const result = await client.query('SELECT u.role_name, m.permissions FROM distributor_users u LEFT JOIN security_access_matrix m ON m.username = u.username WHERE u.username = $1 AND u.status = $2', [req.header('x-vdesgo-username'), 'Aktif'])
  if (result.rowCount === 0) throw accessError('Distribütör hesabı bulunamadı.', 401)
  const roleName = result.rows[0].role_name?.toLocaleLowerCase('tr-TR')
  const defaultModules = roleModuleDefaults[roleName]
  if (defaultModules && !defaultModules.has(moduleName)) {
    throw accessError('Bu modüle rolünüz için erişim tanımlanmamış.')
  }
  const permission = result.rows[0]?.permissions?.[moduleName]
  if (permission && typeof permission === 'object' && permission.visible === false) {
    throw accessError('Bu modüle erişim yetkiniz bulunmuyor.')
  }
  return tenantCode
}

const validateRepresentativeWarehouses = async (client, req, values, currentId = null, tenantCode = null) => {
  const vehicleWarehouseCode = values.vehicleWarehouseCode
  if (!vehicleWarehouseCode || values.active === false) return
  const params = [vehicleWarehouseCode, currentId]
  const tenantClause = ' AND tenant_code IS NOT DISTINCT FROM $3'
  if (tenantClause) params.push(tenantCode)
  const result = await client.query(`
    SELECT id, name, vehicle_warehouse_code AS "vehicleWarehouseCode", order_warehouse_code AS "orderWarehouseCode"
    FROM sales_representatives
    WHERE active = TRUE AND id IS DISTINCT FROM $2::int
      AND vehicle_warehouse_code = $1${tenantClause}
    ORDER BY id
    LIMIT 1
  `, params)
  if (result.rowCount > 0) {
    const conflict = result.rows[0]
    throw Object.assign(new Error(`${conflict.name} adlı satış temsilcisinde ${vehicleWarehouseCode} araç deposu zaten kayıtlı. Aynı araç deposu başka satış temsilcisine atanamaz.`), { statusCode: 409 })
  }
}

const mobileRepresentativeRoleName = 'Mobil Satış Temsilcisi'
const mobileRepresentativeCapabilities = Object.fromEntries([
  'mobile.login', 'mobile.sync', 'mobile.customer.read', 'mobile.route.read',
  'mobile.visit.create', 'mobile.visit.complete', 'mobile.order.create', 'mobile.order.read',
  'mobile.collection.create',
].map((capability) => [capability, true]))

const hasMobileUserLink = async (client) => (await client.query(
  `SELECT 1 FROM information_schema.columns
   WHERE table_schema = current_schema() AND table_name = 'distributor_users' AND column_name = 'sales_representative_id'`,
)).rowCount > 0

const readMobileCredentials = (body) => {
  const username = typeof body?.mobileUsername === 'string' ? body.mobileUsername.trim() : ''
  const password = typeof body?.mobilePassword === 'string' ? body.mobilePassword : ''
  if (!username && !password) return null
  if (!username || username.length > 80 || !/^[\p{L}\p{N}._-]+$/u.test(username)) {
    throw Object.assign(new Error('Mobil kullanıcı adı zorunludur; yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.'), { statusCode: 400 })
  }
  if (password && !isValidPassword(password)) {
    throw Object.assign(new Error('Mobil şifre tam 8 karakter olmalıdır.'), { statusCode: 400 })
  }
  return { username, password }
}

const revokeDistributorUserSessions = (client, userId) => client.query(
  "UPDATE auth_sessions SET revoked_at = NOW() WHERE account_type = 'distributor' AND account_user_id = $1 AND revoked_at IS NULL",
  [userId],
)

const saveRepresentativeMobileUser = async (client, req, representativeId, credentials) => {
  if (!credentials) return null
  if (!(await hasMobileUserLink(client))) {
    throw Object.assign(new Error('Mobil kullanıcı tanımlamak için 001 mobil migration’ı uygulanmalıdır.'), { statusCode: 503 })
  }
  const representative = await client.query('SELECT id, tenant_code, active FROM sales_representatives WHERE id = $1', [representativeId])
  const tenantCode = representative.rows[0]?.tenant_code
  if (!tenantCode?.startsWith('D:')) {
    throw Object.assign(new Error('Mobil kullanıcı yalnızca bir distribütöre bağlı satış temsilcisi için tanımlanabilir.'), { statusCode: 400 })
  }
  const existing = await client.query(
    'SELECT id, username FROM distributor_users WHERE sales_representative_id = $1 FOR UPDATE',
    [representativeId],
  )
  const current = existing.rows[0]
  const duplicate = await client.query(
    'SELECT 1 FROM distributor_users WHERE lower(username) = lower($1) AND id IS DISTINCT FROM $2',
    [credentials.username, current?.id ?? null],
  )
  if (duplicate.rowCount > 0) {
    throw Object.assign(new Error('Bu mobil kullanıcı adı başka bir hesapta kullanılıyor.'), { statusCode: 409 })
  }
  const status = representative.rows[0].active ? 'Aktif' : 'Pasif'
  let userId = current?.id
  if (current) {
    const passwordHash = credentials.password ? await hashPassword(credentials.password) : null
    await client.query(
      `UPDATE distributor_users
       SET username = $1, password_hash = COALESCE($2, password_hash), password = '', status = $3,
           password_change_required = FALSE
       WHERE id = $4`,
      [credentials.username, passwordHash, status, current.id],
    )
    if (current.username !== credentials.username) {
      await client.query('DELETE FROM security_access_matrix WHERE username = $1', [current.username])
    }
    if (passwordHash || current.username !== credentials.username) await revokeDistributorUserSessions(client, current.id)
  } else {
    if (!credentials.password) {
      throw Object.assign(new Error('Yeni mobil kullanıcı için 8 karakterli şifre zorunludur.'), { statusCode: 400 })
    }
    const customerCode = tenantCode.slice(2)
    const distributor = await client.query(
      `SELECT COALESCE(
         (SELECT NULLIF(btrim(COALESCE(NULLIF(title, ''), name)), '') FROM customer_cards WHERE code = $1 AND tenant_code = 'F:MAIN'),
         (SELECT distributor_name FROM distributor_users WHERE customer_code = $1 AND sales_representative_id IS NULL ORDER BY id LIMIT 1),
         $1
       ) AS name`,
      [customerCode],
    )
    const inserted = await client.query(
      `INSERT INTO distributor_users
         (customer_code, distributor_name, username, password, password_hash, role_name, status,
          password_change_required, sales_representative_id, tenant_code)
       VALUES ($1, $2, $3, '', $4, $5, $6, FALSE, $7, $8)
       RETURNING id`,
      [customerCode, distributor.rows[0].name, credentials.username, await hashPassword(credentials.password),
        mobileRepresentativeRoleName, status, representativeId, tenantCode],
    )
    userId = inserted.rows[0].id
  }
  await client.query(
    `INSERT INTO security_access_matrix (username, permissions) VALUES ($1, $2::jsonb)
     ON CONFLICT (username) DO UPDATE SET permissions = COALESCE(security_access_matrix.permissions, '{}'::jsonb) || EXCLUDED.permissions`,
    [credentials.username, JSON.stringify({ MobileFieldSales: { visible: true, capabilities: mobileRepresentativeCapabilities } })],
  )
  await recordAudit(client, req, {
    entityType: 'mobile_user',
    entityId: credentials.username,
    action: current ? 'update' : 'create',
    newValue: { username: credentials.username, salesRepresentativeId: representativeId, passwordChanged: Boolean(credentials.password) },
  })
  return { id: userId, username: credentials.username }
}

const syncRepresentativeMobileUserStatus = async (client, representativeId, active) => {
  if (!(await hasMobileUserLink(client))) return
  const updated = await client.query(
    'UPDATE distributor_users SET status = $2 WHERE sales_representative_id = $1 RETURNING id',
    [representativeId, active ? 'Aktif' : 'Pasif'],
  )
  if (!active) for (const row of updated.rows) await revokeDistributorUserSessions(client, row.id)
}

const getRepresentativeMobileUsernames = async (client, representativeIds) => {
  if (representativeIds.length === 0 || !(await hasMobileUserLink(client))) return new Map()
  const result = await client.query(
    'SELECT sales_representative_id, username FROM distributor_users WHERE sales_representative_id = ANY($1::int[])',
    [representativeIds],
  )
  return new Map(result.rows.map((row) => [row.sales_representative_id, row.username]))
}

const isAllowedOperationDate = (value) => {
  const today = new Date()
  const todayText = today.toISOString().slice(0, 10)
  const earliest = new Date(today)
  earliest.setUTCDate(earliest.getUTCDate() - 5)
  return typeof value === 'string' && value >= earliest.toISOString().slice(0, 10) && value <= todayText
}

app.get('/representative-routes', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const scope = tenantCode === null ? '' : ' AND r.tenant_code = $1'
    const params = tenantCode === null ? [] : [tenantCode]
    const result = await client.query(`SELECT a.id, a.route_day AS "routeDay", a.sales_representative_id AS "salesRepresentativeId", r.name AS "salesRepresentativeName", a.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle", c.province, c.district FROM sales_rep_customers a INNER JOIN sales_representatives r ON r.id = a.sales_representative_id INNER JOIN customer_cards c ON c.code = a.customer_code WHERE a.active = TRUE${scope} ORDER BY a.route_day, r.name, c.name`, params)
    return res.json(result.rows)
  } catch (error) { return res.status(error.statusCode || 500).json({ error: error.message || 'Rut kayıtları alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.get('/representative-visits/representatives', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const result = await client.query(
      `SELECT id, name, active FROM sales_representatives
       WHERE active = TRUE${tenantCode === null ? '' : ' AND tenant_code IS NOT DISTINCT FROM $1'}
       ORDER BY name, id`,
      tenantCode === null ? [] : [tenantCode],
    )
    return res.json(result.rows)
  } catch (error) {
    console.error('Representative visit selector query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Satış temsilcileri alınamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Representative selector query cleanup failed:', error))
  }
})

app.post('/representative-locations/requests', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const requestAll = req.body?.all === true
  const salesRepresentativeId = requestAll ? null : Number(req.body?.salesRepresentativeId)
  if (!requestAll && (!Number.isInteger(salesRepresentativeId) || salesRepresentativeId < 1)) {
    return res.status(400).json({ error: 'Satış temsilcisi seçimi geçersiz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const representatives = await client.query(
      `SELECT id, tenant_code AS "tenantCode" FROM sales_representatives
       WHERE active = TRUE
         ${requestAll ? '' : 'AND id = $1'}
         ${tenantCode === null ? '' : `AND tenant_code IS NOT DISTINCT FROM $${requestAll ? 1 : 2}`}
       ORDER BY id`,
      requestAll
        ? (tenantCode === null ? [] : [tenantCode])
        : (tenantCode === null ? [salesRepresentativeId] : [salesRepresentativeId, tenantCode]),
    )
    if (!representatives.rowCount) return res.status(404).json({ error: 'Satış temsilcisi bulunamadı.' })
    if (representatives.rows.some((representative) => !representative.tenantCode)) {
      return res.status(409).json({ error: 'Satış temsilcisinin distribütör bilgisi bulunamadı.' })
    }
    const requestedBy = req.authenticatedUser?.username || req.header('x-vdesgo-username') || 'system'
    await client.query('BEGIN')
    const requests = []
    for (const representative of representatives.rows) {
      await client.query(
        `UPDATE mobile_location_requests SET status = 'expired'
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND status = 'pending'`,
        [representative.tenantCode, representative.id],
      )
      const id = randomUUID()
      const inserted = await client.query(
        `INSERT INTO mobile_location_requests
           (id, tenant_code, sales_representative_id, requested_by, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '2 minutes')
         RETURNING id, sales_representative_id AS "salesRepresentativeId",
           requested_at AS "requestedAt", expires_at AS "expiresAt", status`,
        [id, representative.tenantCode, representative.id, requestedBy],
      )
      requests.push(inserted.rows[0])
      await recordAudit(client, req, {
        entityType: 'mobile_location_request',
        entityId: id,
        action: 'create',
        newValue: { salesRepresentativeId: representative.id },
      })
    }
    await client.query('COMMIT')
    return res.status(201).json(requestAll ? { requests } : requests[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Representative location request failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Konum talebi oluşturulamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Representative location request cleanup failed:', error))
  }
})

app.get('/representative-locations/history', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const representativeId = req.query.salesRepresentativeId === undefined
    ? null
    : Number(req.query.salesRepresentativeId)
  if (representativeId !== null && (!Number.isInteger(representativeId) || representativeId < 1)) {
    return res.status(400).json({ error: 'Satış temsilcisi seçimi geçersiz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query(
      `SELECT p.business_date AS date, r.id AS "salesRepresentativeId",
         r.name AS "salesRepresentativeName", r.vehicle_plate AS "vehiclePlate",
         COUNT(DISTINCT p.id)::int AS "pointCount",
         COUNT(DISTINCT s.id)::int AS "stopCount",
         MIN(p.recorded_at) AS "firstPointAt", MAX(p.recorded_at) AS "lastPointAt",
         MIN(w.opened_at) AS "openedAt", MAX(w.closed_at) AS "closedAt",
         CASE WHEN BOOL_AND(w.status = 'closed') THEN 'closed' ELSE 'open' END AS status
       FROM mobile_route_points p
       INNER JOIN sales_representatives r ON r.id = p.sales_representative_id
       INNER JOIN mobile_work_sessions w ON w.id = p.work_session_id
       LEFT JOIN mobile_route_stops s ON s.work_session_id = p.work_session_id
       WHERE ($1::text IS NULL OR p.tenant_code IS NOT DISTINCT FROM $1)
         AND ($2::int IS NULL OR p.sales_representative_id = $2)
       GROUP BY p.business_date, r.id, r.name, r.vehicle_plate
       ORDER BY p.business_date DESC, r.name
       LIMIT 1000`,
      [tenantCode, representativeId],
    )
    return res.json({ records: result.rows })
  } catch (error) {
    console.error('Representative location history query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Geçmiş konum kayıtları alınamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Representative location history cleanup failed:', error))
  }
})

app.get('/representative-locations', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const requestAll = req.query.salesRepresentativeId === 'all'
  const salesRepresentativeId = requestAll ? null : Number(req.query.salesRepresentativeId)
  const date = typeof req.query.date === 'string' ? req.query.date : ''
  const parsedDate = Date.parse(`${date}T00:00:00.000Z`)
  if ((!requestAll && (!Number.isInteger(salesRepresentativeId) || salesRepresentativeId < 1))
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(parsedDate)
    || new Date(parsedDate).toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: 'Temsilci ve tarih seçimi geçersiz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const representatives = await client.query(
      `SELECT r.id, r.name, r.vehicle_plate AS "vehiclePlate"
       FROM sales_representatives r
       WHERE ($1::text IS NULL OR r.tenant_code IS NOT DISTINCT FROM $1)
         AND ($2::int IS NULL OR r.id = $2)
         AND (r.active = TRUE OR EXISTS (
           SELECT 1 FROM mobile_route_points p
           WHERE p.sales_representative_id = r.id AND p.business_date = $3
         ))
       ORDER BY r.name`,
      [tenantCode, salesRepresentativeId, date],
    )
    if (!representatives.rowCount && !requestAll) {
      return res.status(404).json({ error: 'Satış temsilcisi bulunamadı.' })
    }
    const representativeIds = representatives.rows.map((representative) => representative.id)
    if (representativeIds.length === 0) return res.json({ date, routes: [] })
    const points = await client.query(
      `SELECT p.id, p.sales_representative_id AS "salesRepresentativeId",
         p.recorded_at AS "recordedAt",
         p.latitude::float8 AS latitude, p.longitude::float8 AS longitude,
         p.accuracy_m::float8 AS "accuracyM", p.speed_mps::float8 AS "speedMps",
         p.bearing_degrees::float8 AS "bearingDegrees"
       FROM mobile_route_points p
       WHERE p.sales_representative_id = ANY($1::int[]) AND p.business_date = $2
         AND ($3::text IS NULL OR p.tenant_code IS NOT DISTINCT FROM $3)
       ORDER BY p.recorded_at, p.id`,
      [representativeIds, date, tenantCode],
    )
    const requests = await client.query(
      `SELECT DISTINCT ON (sales_representative_id)
         id, sales_representative_id AS "salesRepresentativeId", status,
         requested_at AS "requestedAt", expires_at AS "expiresAt",
         fulfilled_at AS "fulfilledAt"
       FROM mobile_location_requests
       WHERE sales_representative_id = ANY($1::int[])
         AND ($2::text IS NULL OR tenant_code IS NOT DISTINCT FROM $2)
       ORDER BY sales_representative_id, requested_at DESC`,
      [representativeIds, tenantCode],
    )
    const stops = await client.query(
      `SELECT id, sales_representative_id AS "salesRepresentativeId",
         started_at AS "startedAt", ended_at AS "endedAt",
         duration_seconds AS "durationSeconds", latitude::float8 AS latitude,
         longitude::float8 AS longitude, radius_m::float8 AS "radiusM",
         point_count AS "pointCount"
       FROM mobile_route_stops
       WHERE sales_representative_id = ANY($1::int[]) AND business_date = $2
         AND ($3::text IS NULL OR tenant_code IS NOT DISTINCT FROM $3)
       ORDER BY started_at`,
      [representativeIds, date, tenantCode],
    )
    const routes = representatives.rows.map((representative) => {
      const routePoints = points.rows.filter((point) => point.salesRepresentativeId === representative.id)
      return {
        representative,
        request: requests.rows.find((request) => request.salesRepresentativeId === representative.id) ?? null,
        points: routePoints,
        lastPoint: routePoints.at(-1) ?? null,
        stops: stops.rows.filter((stop) => stop.salesRepresentativeId === representative.id),
      }
    })
    if (requestAll) return res.json({ date, routes })
    return res.json({ date, ...routes[0], routes })
  } catch (error) {
    console.error('Representative location query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Konum bilgileri alınamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Representative location query cleanup failed:', error))
  }
})

app.get('/representative-visits', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const firstDate = typeof req.query.firstDate === 'string'
    ? req.query.firstDate
    : typeof req.query.date === 'string' ? req.query.date : ''
  const lastDate = typeof req.query.lastDate === 'string' ? req.query.lastDate : firstDate
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  if (!isDate(firstDate) || !isDate(lastDate) || lastDate < firstDate) {
    return res.status(400).json({ error: 'Geçerli başlangıç ve bitiş tarihleri seçiniz.' })
  }
  const representativeId = req.query.salesRepresentativeId
  if (representativeId !== undefined && (!/^\d+$/.test(String(representativeId)) || Number(representativeId) < 1)) {
    return res.status(400).json({ error: 'Satış temsilcisi seçimi geçersiz.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = [firstDate, lastDate]
    const conditions = [
      `v.started_at >= ($1::date::timestamp AT TIME ZONE 'Europe/Istanbul')`,
      `v.started_at < (($2::date + 1)::timestamp AT TIME ZONE 'Europe/Istanbul')`,
    ]
    if (tenantCode !== null) {
      params.push(tenantCode)
      conditions.push(`v.tenant_code IS NOT DISTINCT FROM $${params.length}`)
    }
    if (representativeId !== undefined) {
      params.push(Number(representativeId))
      conditions.push(`v.sales_representative_id = $${params.length}`)
    }
    const result = await client.query(
      `SELECT v.id, v.tenant_code AS "tenantCode",
         v.sales_representative_id AS "salesRepresentativeId",
         r.name AS "salesRepresentativeName",
         v.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle",
         v.started_at AS "startedAt", v.completed_at AS "completedAt",
         v.visit_result AS "visitResult", v.note,
         v.start_latitude AS "startLatitude", v.start_longitude AS "startLongitude",
         v.end_latitude AS "endLatitude", v.end_longitude AS "endLongitude",
         v.created_by AS "createdById", du.username AS "createdByUsername",
         CASE WHEN v.completed_at IS NULL THEN 'Devam ediyor'
           ELSE COALESCE(NULLIF(v.visit_result, ''), 'Tamamlandı') END AS status,
         GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(v.completed_at, NOW()) - v.started_at)))::integer
           AS "durationSeconds"
       FROM field_visits v
       INNER JOIN sales_representatives r
         ON r.id = v.sales_representative_id AND r.tenant_code IS NOT DISTINCT FROM v.tenant_code
       INNER JOIN customer_cards c
         ON c.code = v.customer_code AND c.tenant_code IS NOT DISTINCT FROM v.tenant_code
       LEFT JOIN distributor_users du ON du.id = v.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY v.started_at DESC, v.id DESC`,
      params,
    )
    return res.json({ firstDate, lastDate, rows: result.rows })
  } catch (error) {
    console.error('Representative visit query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Mobil ziyaret kayıtları alınamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Representative visit query cleanup failed:', error))
  }
})

app.post('/representative-routes/assign', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { salesRepresentativeId, routeDay, customerCode } = req.body ?? {}
  const allowedRouteDays = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
  if (
    !Number.isInteger(Number(salesRepresentativeId))
    || Number(salesRepresentativeId) <= 0
    || typeof customerCode !== 'string'
    || !customerCode.trim()
    || !allowedRouteDays.includes(routeDay)
  ) {
    return res.status(400).json({ error: 'Temsilci, geçerli gün ve cari zorunludur.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const representative = tenantCode === null
      ? await client.query('SELECT id FROM sales_representatives WHERE id = $1', [Number(salesRepresentativeId)])
      : await client.query('SELECT id FROM sales_representatives WHERE id = $1 AND tenant_code = $2', [Number(salesRepresentativeId), tenantCode])
    if (!representative.rowCount) return res.status(404).json({ error: 'Satış temsilcisi bulunamadı.' })

    const customer = tenantCode === null
      ? await client.query('SELECT code FROM customer_cards WHERE code = $1', [customerCode])
      : await client.query('SELECT code FROM customer_cards WHERE code = $1 AND tenant_code = $2', [customerCode, tenantCode])
    if (!customer.rowCount) return res.status(404).json({ error: 'Cari bulunamadı.' })

    await client.query('BEGIN')
    const assignmentKey = `${tenantCode ?? 'factory'}:${salesRepresentativeId}:${customerCode}:${routeDay}`
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [assignmentKey])
    const existingAssignment = await client.query(
      `SELECT id FROM sales_rep_customers
       WHERE tenant_code IS NOT DISTINCT FROM $1
         AND sales_representative_id = $2 AND customer_code = $3 AND route_day = $4
       LIMIT 1`,
      [tenantCode, Number(salesRepresentativeId), customerCode, routeDay],
    )
    const assignment = existingAssignment.rowCount
      ? await client.query('UPDATE sales_rep_customers SET active = TRUE WHERE id = $1 RETURNING id', [existingAssignment.rows[0].id])
      : await client.query(
        `INSERT INTO sales_rep_customers (tenant_code, sales_representative_id, customer_code, route_day)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantCode, Number(salesRepresentativeId), customerCode, routeDay],
      )
    await client.query('COMMIT')
    return res.status(201).json({ id: assignment.rows[0].id })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Route customer assignment failed:', error)
    return res.status(500).json({ error: 'Cari rut listesine eklenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/representative-routes', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { salesRepresentativeId, routeDay, customerCodes } = req.body ?? {}
  if (!salesRepresentativeId || !routeDay || !Array.isArray(customerCodes)) return res.status(400).json({ error: 'Temsilci, gün ve cari listesi zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const rep = await client.query(`SELECT id FROM sales_representatives WHERE id = $1${tenantCode === null ? '' : ' AND tenant_code = $2'}`, tenantCode === null ? [salesRepresentativeId] : [salesRepresentativeId, tenantCode])
    if (!rep.rowCount) throw new Error('Satış temsilcisi bulunamadı.')
    await client.query('DELETE FROM sales_rep_customers WHERE sales_representative_id = $1 AND route_day = $2 AND tenant_code IS NOT DISTINCT FROM $3', [salesRepresentativeId, routeDay, tenantCode])
    for (const customerCode of customerCodes) await client.query('INSERT INTO sales_rep_customers (tenant_code, sales_representative_id, customer_code, route_day) VALUES ($1, $2, $3, $4)', [tenantCode, salesRepresentativeId, customerCode, routeDay])
    await client.query('COMMIT'); return res.status(201).json({ saved: customerCodes.length })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return res.status(400).json({ error: error.message || 'Rut kaydedilemedi.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.delete('/representative-routes/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); const tenantCode = await getRequestTenant(client, req)
    const result = tenantCode === null
      ? await client.query('DELETE FROM sales_rep_customers WHERE id = $1', [req.params.id])
      : await client.query('DELETE FROM sales_rep_customers WHERE id = $1 AND tenant_code = $2', [req.params.id, tenantCode])
    if (!result.rowCount) return res.status(404).json({ error: 'Rut ataması bulunamadı.' })
    return res.status(204).end()
  } catch (error) { return res.status(500).json({ error: 'Rut ataması silinemedi.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/other-entries/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_entries WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) {
    console.error('Other stock entry number query failed:', error)
    return res.status(500).json({ error: 'Other stock entry number query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/integrations/production/catalog', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const [products, units, warehouses] = await Promise.all([
      client.query("SELECT code, name FROM factory_products WHERE active IS TRUE ORDER BY code"),
      client.query('SELECT product_code AS "productCode", unit, inner_quantity AS "innerQuantity" FROM product_units ORDER BY product_code, id'),
      client.query("SELECT code, name FROM factory_warehouses WHERE tenant_code = 'F:MAIN' AND type = 'Merkez Depo' AND active IS TRUE ORDER BY name"),
    ])
    return res.json({
      products: products.rows,
      units: units.rows.map((row) => ({ ...row, innerQuantity: Number.parseFloat(String(row.innerQuantity).replace(',', '.')) })),
      warehouses: warehouses.rows,
    })
  } catch (error) {
    console.error('Production integration catalog query failed:', error)
    return res.status(500).json({ error: 'ERP ürün, birim ve depo listesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/integrations/production/entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { eventId, sourceLotCode, productionOrderId, entryDate, enteringWarehouseCode, productCode, unit, quantity, lotExpiryDate } = req.body ?? {}
  const validDate = typeof entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
    && Number.isFinite(Date.parse(`${entryDate}T00:00:00Z`))
    && new Date(`${entryDate}T00:00:00Z`).toISOString().slice(0, 10) === entryDate
  const parsedQuantity = Number(quantity)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(eventId || ''))
    || typeof sourceLotCode !== 'string' || !sourceLotCode.trim()
    || !validDate || !enteringWarehouseCode || !productCode || !unit
    || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    return res.status(400).json({ error: 'Üretim lotu, olay, tarih, depo, ürün, birim ve pozitif temel miktar zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const normalizedExpiry = normalizeLotExpiryDate(lotExpiryDate, sourceLotCode)
    await assertLotExpiryDates(client, [{ productCode, productionLotCode: sourceLotCode.trim(), lotExpiryDate: normalizedExpiry }])
    const existing = await client.query(
      `SELECT e.id, e.receipt_no AS "receiptNo", e.entry_date AS "entryDate",
              e.entering_warehouse_code AS "enteringWarehouseCode", l.product_code AS "productCode",
              l.unit, l.quantity, l.total_quantity AS "totalQuantity", l.production_lot_code AS "productionLotCode"
       FROM other_stock_entries e
       INNER JOIN other_stock_entry_lines l ON l.entry_id = e.id
       WHERE e.tenant_code = 'F:MAIN' AND e.entry_type = 'Üretimden Mal Girişi'
         AND e.source_system = 'vdesgo-production' AND e.source_reference = $1 AND e.cancelled_at IS NULL
       FOR UPDATE OF e`,
      [eventId],
    )
    if (existing.rowCount) {
      if (existing.rows.length !== 1 || existing.rows[0].productionLotCode !== sourceLotCode) {
        throw Object.assign(new Error('Bu üretim olayı farklı bir ERP fişiyle eşleşiyor.'), { statusCode: 409 })
      }
      await client.query('COMMIT')
      return res.json({ ...existing.rows[0], idempotent: true, sourceReference: eventId, sourceSystem: 'vdesgo-production' })
    }

    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND tenant_code = 'F:MAIN' AND type = 'Merkez Depo' AND active IS TRUE FOR SHARE`,
      [String(enteringWarehouseCode)],
    )
    if (!warehouse.rowCount) throw Object.assign(new Error('Seçilen ERP hedef deposu aktif fabrika merkez deposu değil.'), { statusCode: 400 })
    const product = await client.query(
      `SELECT p.name AS "productName", u.inner_quantity AS "innerQuantity"
       FROM factory_products p
       INNER JOIN product_units u ON u.product_code = p.code
       WHERE p.code = $1 AND p.active IS TRUE AND u.unit = $2
       ORDER BY u.id DESC LIMIT 1 FOR SHARE OF p`,
      [String(productCode), String(unit)],
    )
    if (!product.rowCount) throw Object.assign(new Error('ERP ürünü aktif olmalı ve seçilen temel birim tanımlı olmalıdır.'), { statusCode: 400 })
    const innerQuantity = Number.parseFloat(String(product.rows[0].innerQuantity).replace(',', '.'))
    if (!Number.isFinite(innerQuantity) || Math.abs(innerQuantity - 1) > 1e-9) {
      throw Object.assign(new Error(`ERP ürününde ${unit} birimi temel miktar için 1 birim içeriğiyle tanımlanmalıdır.`), { statusCode: 409 })
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['vdesgo-production-entry:F:MAIN'])
    const nextReceipt = await client.query(
      `SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "receiptNo"
       FROM other_stock_entries WHERE tenant_code = 'F:MAIN'`,
    )
    const header = await client.query(
      `INSERT INTO other_stock_entries
         (receipt_no, entry_date, entering_warehouse_code, entry_type, source_system, source_reference, tenant_code, created_by)
       VALUES ($1,$2,$3,'Üretimden Mal Girişi','vdesgo-production',$4,'F:MAIN','vdesgo-production')
       RETURNING id, receipt_no AS "receiptNo", entry_date AS "entryDate",
         entering_warehouse_code AS "enteringWarehouseCode"`,
      [Number(nextReceipt.rows[0].receiptNo), entryDate, String(enteringWarehouseCode), eventId],
    )
    await client.query(
      `INSERT INTO other_stock_entry_lines
         (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code, lot_expiry_date)
       VALUES ($1,$2,$3,$4,'1',$5,$5,$6,$7)`,
      [header.rows[0].id, String(productCode), product.rows[0].productName, String(unit), parsedQuantity, sourceLotCode.trim(), normalizedExpiry],
    )
    await recordAudit(client, req, {
      entityType: 'production_goods_receipt', entityId: header.rows[0].id, action: 'create',
      newValue: { ...header.rows[0], entryType: 'Üretimden Mal Girişi', sourceSystem: 'vdesgo-production', sourceReference: eventId, productionOrderId, sourceLotCode, productCode, quantity: parsedQuantity, unit, tenantCode: 'F:MAIN' },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      ...header.rows[0], sourceSystem: 'vdesgo-production', sourceReference: eventId,
      lines: [{ productCode, productName: product.rows[0].productName, unit, innerQuantity: 1, quantity: parsedQuantity, totalQuantity: parsedQuantity, productionLotCode: sourceLotCode }],
    })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Production integration receipt creation failed:', error)
    return res.status(error.statusCode || (error.code === '23505' ? 409 : 400)).json({ error: error.message || 'Üretim kabul fişi ERP’ye kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/production-entries/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Üretim girişi yalnızca fabrika merkez deposuna kaydedilebilir.' })
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_entries WHERE tenant_code = $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) {
    console.error('Production stock entry number query failed:', error)
    return res.status(500).json({ error: 'Üretim girişi fiş numarası alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/production-entries/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Üretim girişi yalnızca fabrika merkezinde kullanılabilir.' })
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_entries WHERE tenant_code = $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) {
    console.error('Production entry number query failed:', error)
    return res.status(500).json({ error: 'Üretim girişi fiş numarası alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/other-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const entries = await client.query(`
      SELECT e.id, e.receipt_no AS "receiptNo", e.entry_date AS "entryDate",
             e.entering_warehouse_code AS "enteringWarehouseCode", w.name AS "enteringWarehouseName",
              e.tenant_code AS "tenantCode", e.created_by AS "createdBy",
              e.cancelled_at AS "cancelledAt", e.cancelled_by AS "cancelledBy"
      FROM other_stock_entries e
      LEFT JOIN factory_warehouses w ON w.code = e.entering_warehouse_code AND w.tenant_code = e.tenant_code
      WHERE e.tenant_code IS NOT DISTINCT FROM $1 AND e.entry_type = 'Sair Giriş'
      ORDER BY e.entry_date DESC, e.receipt_no DESC
    `, [tenantCode])
    const lines = await client.query(`
      SELECT entry_id AS "entryId", product_code AS "productCode", product_name AS "productName",
             unit, inner_quantity AS "innerQuantity", quantity, total_quantity AS "totalQuantity",
             production_lot_code AS "productionLotCode"
      FROM other_stock_entry_lines
      WHERE entry_id = ANY($1::int[])
      ORDER BY id
    `, [entries.rows.map((entry) => entry.id)])
    const linesByEntry = new Map()
    for (const line of lines.rows) linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) || []), line])
    return res.json(entries.rows.map((entry) => ({ ...entry, entryDate: toApiValue(entry.entryDate), lines: linesByEntry.get(entry.id) || [] })))
  } catch (error) {
    console.error('Other stock entries query failed:', error)
    return res.status(500).json({ error: 'Other stock entries query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/production-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Üretim girişi yalnızca fabrika merkezinde görüntülenebilir.' })
    const entries = await client.query(`
      SELECT e.id, e.receipt_no AS "receiptNo", e.entry_date AS "entryDate",
             e.entering_warehouse_code AS "enteringWarehouseCode", w.name AS "enteringWarehouseName",
             e.source_system AS "sourceSystem", e.source_reference AS "sourceReference",
              e.tenant_code AS "tenantCode", e.created_by AS "createdBy",
              e.cancelled_at AS "cancelledAt", e.cancelled_by AS "cancelledBy"
      FROM other_stock_entries e
      LEFT JOIN factory_warehouses w ON w.code = e.entering_warehouse_code AND w.tenant_code = e.tenant_code
      WHERE e.tenant_code = $1 AND e.entry_type = 'Üretimden Mal Girişi'
      ORDER BY e.entry_date DESC, e.receipt_no DESC
    `, [tenantCode])
    const lines = await client.query(`
      SELECT entry_id AS "entryId", product_code AS "productCode", product_name AS "productName",
             unit, inner_quantity AS "innerQuantity", quantity, total_quantity AS "totalQuantity",
             production_lot_code AS "productionLotCode"
      FROM other_stock_entry_lines
      WHERE entry_id = ANY($1::int[])
      ORDER BY id
    `, [entries.rows.map((entry) => entry.id)])
    const linesByEntry = new Map()
    for (const line of lines.rows) linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) || []), line])
    return res.json(entries.rows.map((entry) => ({ ...entry, entryDate: toApiValue(entry.entryDate), lines: linesByEntry.get(entry.id) || [] })))
  } catch (error) {
    console.error('Production stock entries query failed:', error)
    return res.status(500).json({ error: 'Üretim girişi kayıtları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/stock', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { warehouseCode, productCode } = req.query
  if (!warehouseCode || !productCode) return res.status(400).json({ error: 'Depo ve ürün kodu zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const baseQuantity = await availableStock(client, warehouseCode, productCode, tenantCode)
    const lots = tenantCode === 'F:MAIN'
      ? limitLotBalancesToStock(await getFactoryLotBalances(client, warehouseCode, productCode), baseQuantity)
      : []
    return res.json({
      warehouseCode, productCode, baseQuantity,
      lotQuantity: lots.reduce((total, lot) => total + lot.quantity, 0),
      lots,
    })
  } catch (error) {
    console.error('Stock query failed:', error)
    return res.status(500).json({ error: 'Stock query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/lot-sales', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Lot satış takibi yalnızca fabrika hesabında kullanılabilir.' })
  let lotCode
  try { lotCode = normalizeLotCode(req.query.lotCode) }
  catch (error) { return res.status(error.statusCode || 400).json({ error: error.message }) }
  if (!lotCode) return res.status(400).json({ error: 'Lot numarası zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Lot satış takibi yalnızca fabrika merkezinde kullanılabilir.' })
    const result = await client.query(`
      SELECT i.id AS "invoiceId", i.invoice_no AS "invoiceNo", i.invoice_date AS "invoiceDate",
        i.customer_code AS "customerCode", i.customer_name AS "customerName",
        i.sales_representative AS "salesRepresentative", i.sale_type AS "saleType",
        l.product_code AS "productCode", l.product_name AS "productName", l.unit,
        SUM(a.quantity) AS quantity
      FROM sales_invoice_line_lots a
      INNER JOIN sales_invoice_lines l ON l.id = a.sales_invoice_line_id
      INNER JOIN sales_invoices i ON i.id = l.invoice_id
      WHERE a.lot_code = $1 AND i.tenant_code = 'F:MAIN' AND i.cancelled IS NOT TRUE
      GROUP BY i.id, l.id
      ORDER BY i.invoice_date, i.invoice_no, l.id
    `, [lotCode])
    return res.json(result.rows.map((row) => ({ ...row, quantity: Number(row.quantity) })))
  } catch (error) {
    console.error('Factory lot sales lookup failed:', error)
    return res.status(500).json({ error: 'Lot satış geçmişi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/lot-sales/report', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Lot takip raporu yalnızca fabrika hesabında kullanılabilir.' })
  const { firstDate, lastDate } = req.query
  const lotCode = typeof req.query.lotCode === 'string' ? req.query.lotCode.trim() : ''
  const customer = typeof req.query.customer === 'string' ? req.query.customer.trim() : ''
  const isValidDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  if (!isValidDate(firstDate) || !isValidDate(lastDate) || firstDate > lastDate) {
    return res.status(400).json({ error: 'Geçerli bir lot raporu tarih aralığı giriniz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Lot takip raporu yalnızca fabrika merkezinde kullanılabilir.' })
    const result = await client.query(`
      SELECT i.id AS "invoiceId", i.invoice_no AS "invoiceNo", i.invoice_date AS "invoiceDate",
        i.customer_code AS "customerCode", i.customer_name AS "customerName",
        i.sales_representative AS "salesRepresentative", i.sale_type AS "saleType",
        l.product_code AS "productCode", l.product_name AS "productName", l.unit,
        a.lot_code AS "lotCode", SUM(a.quantity) AS quantity
      FROM sales_invoice_line_lots a
      INNER JOIN sales_invoice_lines l ON l.id = a.sales_invoice_line_id
      INNER JOIN sales_invoices i ON i.id = l.invoice_id
      WHERE i.tenant_code = 'F:MAIN' AND i.cancelled IS NOT TRUE
        AND a.lot_code IS NOT NULL AND i.invoice_date >= $1::date AND i.invoice_date <= $2::date
        AND ($3 = '' OR a.lot_code ILIKE '%' || $3 || '%')
        AND ($4 = '' OR i.customer_code ILIKE '%' || $4 || '%' OR i.customer_name ILIKE '%' || $4 || '%')
      GROUP BY i.id, l.id, a.lot_code
      ORDER BY i.invoice_date, i.invoice_no, l.id, a.lot_code
    `, [firstDate, lastDate, lotCode, customer])
    return res.json(result.rows.map((row) => ({
      ...row,
      invoiceDate: toApiValue(row.invoiceDate),
      quantity: Number(row.quantity),
    })))
  } catch (error) {
    console.error('Factory lot tracking report failed:', error)
    return res.status(500).json({ error: 'Lot takip raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/stock-report', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const byLot = req.query?.byLot === 'true'
  if (byLot && req.authenticatedUser?.accountType !== 'factory') {
    return res.status(403).json({ error: 'Lot bazlı stok görünümü yalnızca fabrika hesabında kullanılabilir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    if (byLot && tenantCode !== 'F:MAIN') {
      return res.status(403).json({ error: 'Lot bazlı stok görünümü yalnızca fabrika merkezinde kullanılabilir.' })
    }
    if (byLot) {
      const result = await client.query(`
        WITH stock_movements AS (
          SELECT e.entering_warehouse_code AS warehouse_code, l.product_code, l.total_quantity AS quantity
          FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id
          WHERE e.tenant_code = 'F:MAIN' AND e.cancelled_at IS NULL
            AND e.entry_type IN ('Sair Giriş', 'Üretimden Mal Girişi', 'Alış Faturası', 'İade Faturası')
          UNION ALL
          SELECT e.exiting_warehouse_code, l.product_code, -l.total_quantity
          FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id
          WHERE e.tenant_code = 'F:MAIN' AND e.cancelled_at IS NULL
          UNION ALL
          SELECT t.entering_warehouse_code, l.product_code, l.total_quantity
          FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.tenant_code = 'F:MAIN' AND t.cancelled_at IS NULL
          UNION ALL
          SELECT t.exiting_warehouse_code, l.product_code, -l.total_quantity
          FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.tenant_code = 'F:MAIN' AND t.cancelled_at IS NULL
          UNION ALL
          SELECT v.entering_warehouse_code, l.product_code, l.total_quantity
          FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.tenant_code = 'F:MAIN' AND v.cancelled_at IS NULL
          UNION ALL
          SELECT v.exiting_warehouse_code, l.product_code, -l.total_quantity
          FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.tenant_code = 'F:MAIN' AND v.cancelled_at IS NULL
          UNION ALL
          SELECT i.warehouse_code, l.product_code, -l.total_quantity
          FROM sales_invoice_lines l INNER JOIN sales_invoices i ON i.id = l.invoice_id
          WHERE i.tenant_code = 'F:MAIN' AND i.cancelled IS NOT TRUE
        ), stock_balances AS (
          SELECT warehouse_code, product_code, SUM(quantity) AS quantity
          FROM stock_movements GROUP BY warehouse_code, product_code
        ), lot_movements AS (
          SELECT e.entering_warehouse_code AS warehouse_code, l.product_code,
            NULLIF(BTRIM(l.production_lot_code), '') AS lot_code, l.total_quantity AS quantity
          FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id
          WHERE e.tenant_code = 'F:MAIN' AND e.cancelled_at IS NULL
            AND e.entry_type IN ('Sair Giriş', 'Üretimden Mal Girişi', 'Alış Faturası', 'İade Faturası')
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT e.exiting_warehouse_code, l.product_code, NULLIF(BTRIM(l.production_lot_code), ''), -l.total_quantity
          FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id
          WHERE e.tenant_code = 'F:MAIN' AND e.cancelled_at IS NULL
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT t.entering_warehouse_code, l.product_code, NULLIF(BTRIM(l.production_lot_code), ''), l.total_quantity
          FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.tenant_code = 'F:MAIN' AND t.cancelled_at IS NULL
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT t.exiting_warehouse_code, l.product_code, NULLIF(BTRIM(l.production_lot_code), ''), -l.total_quantity
          FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.tenant_code = 'F:MAIN' AND t.cancelled_at IS NULL
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT v.entering_warehouse_code, l.product_code, NULLIF(BTRIM(l.production_lot_code), ''), l.total_quantity
          FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.tenant_code = 'F:MAIN' AND v.cancelled_at IS NULL
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT v.exiting_warehouse_code, l.product_code, NULLIF(BTRIM(l.production_lot_code), ''), -l.total_quantity
          FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.tenant_code = 'F:MAIN' AND v.cancelled_at IS NULL
            AND NULLIF(BTRIM(l.production_lot_code), '') IS NOT NULL
          UNION ALL
          SELECT i.warehouse_code, l.product_code, a.lot_code, -a.quantity
          FROM sales_invoice_line_lots a
          INNER JOIN sales_invoice_lines l ON l.id = a.sales_invoice_line_id
          INNER JOIN sales_invoices i ON i.id = l.invoice_id
          WHERE i.tenant_code = 'F:MAIN' AND i.cancelled IS NOT TRUE AND a.lot_code IS NOT NULL
        ), lot_balances AS (
          SELECT warehouse_code, product_code, lot_code, SUM(quantity) AS quantity
          FROM lot_movements GROUP BY warehouse_code, product_code, lot_code
        ), stock_rows AS (
          SELECT w.code AS "warehouseCode", w.name AS "warehouseName", p.code AS "productCode",
            p.name AS "productName", p.unit, p.category, p.product_type AS "productType",
            COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'unitContent', u.inner_quantity) ORDER BY u.id)
              FROM product_units u WHERE u.product_code = p.code), '[]'::jsonb) AS units,
            COALESCE((SELECT NULLIF(REPLACE(u.inner_quantity, ',', '.') , '')::NUMERIC
              FROM product_units u WHERE u.product_code = p.code AND u.unit = p.unit ORDER BY u.id LIMIT 1), 1) AS "unitContent",
            COALESCE(b.quantity, 0) AS stock_quantity
          FROM factory_warehouses w CROSS JOIN factory_products p
          LEFT JOIN stock_balances b ON b.warehouse_code = w.code AND b.product_code = p.code
          WHERE w.active = TRUE AND w.tenant_code = 'F:MAIN'
        ), lot_rows AS (
          SELECT s.*, l.lot_code AS "lotCode", l.quantity AS "baseQuantity"
          FROM stock_rows s INNER JOIN lot_balances l
            ON l.warehouse_code = s."warehouseCode" AND l.product_code = s."productCode"
          WHERE ABS(l.quantity) > 0.000001
          UNION ALL
          SELECT s.*, NULL::text AS "lotCode", s.stock_quantity - COALESCE(SUM(l.quantity), 0) AS "baseQuantity"
          FROM stock_rows s LEFT JOIN lot_balances l
            ON l.warehouse_code = s."warehouseCode" AND l.product_code = s."productCode"
          GROUP BY s."warehouseCode", s."warehouseName", s."productCode", s."productName",
            s.unit, s.category, s."productType", s.units, s."unitContent", s.stock_quantity
          HAVING ABS(s.stock_quantity - COALESCE(SUM(l.quantity), 0)) > 0.000001
        )
        SELECT "warehouseCode", "warehouseName", "productCode", "productName", "lotCode",
          unit, category, "productType", units, "unitContent", "baseQuantity"
        FROM lot_rows ORDER BY "warehouseName", "productName", "lotCode" NULLS FIRST
      `)
      return res.json(result.rows.map((row) => {
        const baseQuantity = Number(row.baseQuantity)
        const unitContent = Number(row.unitContent) || 1
        const units = row.units.map((unit) => {
          const content = Number(String(unit.unitContent).replace(',', '.'))
          if (!unit.unit || !Number.isFinite(content) || content <= 0) {
            throw new Error(`${row.productCode}: Geçersiz ürün birim içeriği.`)
          }
          return { unit: unit.unit, unitContent: content }
        }).sort((left, right) => left.unitContent - right.unitContent || left.unit.localeCompare(right.unit, 'tr-TR'))
        return { ...row, units, baseQuantity, unitContent, quantity: baseQuantity / unitContent }
      }))
    }
    const result = await client.query(`
      WITH movements AS (
        SELECT e.entering_warehouse_code AS warehouse_code, l.product_code, SUM(l.total_quantity) AS quantity
        FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id
        WHERE e.tenant_code IS NOT DISTINCT FROM $1 AND e.cancelled_at IS NULL
          AND e.entry_type IN ('Sair Giriş', 'Üretimden Mal Girişi', 'Alış Faturası', 'İade Faturası')
        GROUP BY e.entering_warehouse_code, l.product_code
        UNION ALL
        SELECT e.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
        FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id
        WHERE e.tenant_code IS NOT DISTINCT FROM $1 AND e.cancelled_at IS NULL
        GROUP BY e.exiting_warehouse_code, l.product_code
        UNION ALL
        SELECT t.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
        FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
        WHERE t.tenant_code IS NOT DISTINCT FROM $1 AND t.cancelled_at IS NULL
        GROUP BY t.entering_warehouse_code, l.product_code
        UNION ALL
        SELECT t.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
        FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
        WHERE t.tenant_code IS NOT DISTINCT FROM $1 AND t.cancelled_at IS NULL
        GROUP BY t.exiting_warehouse_code, l.product_code
        UNION ALL
        SELECT v.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
        FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
        WHERE v.tenant_code IS NOT DISTINCT FROM $1 AND v.cancelled_at IS NULL
        GROUP BY v.entering_warehouse_code, l.product_code
        UNION ALL
        SELECT v.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
        FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
        WHERE v.tenant_code IS NOT DISTINCT FROM $1 AND v.cancelled_at IS NULL
        GROUP BY v.exiting_warehouse_code, l.product_code
        UNION ALL
        SELECT i.warehouse_code, l.product_code, -SUM(l.total_quantity)
        FROM sales_invoice_lines l
        INNER JOIN sales_invoices i ON i.id = l.invoice_id
        WHERE i.cancelled IS NOT TRUE AND i.tenant_code IS NOT DISTINCT FROM $1
        GROUP BY i.warehouse_code, l.product_code
      )
      SELECT w.code AS "warehouseCode", w.name AS "warehouseName", p.code AS "productCode", p.name AS "productName",
        p.unit, p.category, p.product_type AS "productType",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('unit', u.unit, 'unitContent', u.inner_quantity) ORDER BY u.id)
          FROM product_units u WHERE u.product_code = p.code), '[]'::jsonb) AS units,
        COALESCE((SELECT NULLIF(REPLACE(u.inner_quantity, ',', '.') , '')::NUMERIC FROM product_units u WHERE u.product_code = p.code AND u.unit = p.unit ORDER BY u.id LIMIT 1), 1) AS "unitContent",
        COALESCE(SUM(m.quantity), 0) AS "baseQuantity"
      FROM factory_warehouses w CROSS JOIN factory_products p
      LEFT JOIN movements m ON m.warehouse_code = w.code AND m.product_code = p.code
      WHERE w.active = TRUE AND ($1::VARCHAR IS NULL OR w.tenant_code IS NOT DISTINCT FROM $1)
      GROUP BY w.code, w.name, p.code, p.name, p.unit, p.category, p.product_type
      ORDER BY w.name, p.name
    `, [tenantCode])
    return res.json(result.rows.map((row) => {
      const baseQuantity = Number(row.baseQuantity)
      const unitContent = Number(row.unitContent) || 1
      const units = row.units.map((unit) => {
        const content = Number(String(unit.unitContent).replace(',', '.'))
        if (!unit.unit || !Number.isFinite(content) || content <= 0) {
          throw new Error(`${row.productCode}: Geçersiz ürün birim içeriği.`)
        }
        return { unit: unit.unit, unitContent: content }
      }).sort((left, right) => left.unitContent - right.unitContent || left.unit.localeCompare(right.unit, 'tr-TR'))
      return { ...row, units, baseQuantity, unitContent, quantity: baseQuantity / unitContent }
    }))
  } catch (error) {
    console.error('Stock report query failed:', error)
    return res.status(500).json({ error: 'Stok raporu alınamadı. Ürün birim tanımlarını kontrol edin.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/production-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Üretim girişi yalnızca fabrika merkezinde görüntülenebilir.' })
    const entries = await client.query(`
      SELECT e.id, e.receipt_no AS "receiptNo", e.entry_date AS "entryDate",
             e.entering_warehouse_code AS "enteringWarehouseCode", w.name AS "enteringWarehouseName",
             e.source_system AS "sourceSystem", e.source_reference AS "sourceReference",
             e.tenant_code AS "tenantCode", e.created_by AS "createdBy"
      FROM other_stock_entries e
      LEFT JOIN factory_warehouses w ON w.code = e.entering_warehouse_code AND w.tenant_code = e.tenant_code
      WHERE e.tenant_code = $1 AND e.entry_type = 'Üretimden Mal Girişi'
      ORDER BY e.entry_date DESC, e.receipt_no DESC
    `, [tenantCode])
    const lines = await client.query(`
      SELECT entry_id AS "entryId", product_code AS "productCode", product_name AS "productName",
             unit, inner_quantity AS "innerQuantity", quantity, total_quantity AS "totalQuantity",
             production_lot_code AS "productionLotCode"
      FROM other_stock_entry_lines
      WHERE entry_id = ANY($1::int[])
      ORDER BY id
    `, [entries.rows.map((entry) => entry.id)])
    const linesByEntry = new Map()
    for (const line of lines.rows) linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) || []), line])
    return res.json(entries.rows.map((entry) => ({ ...entry, entryDate: toApiValue(entry.entryDate), lines: linesByEntry.get(entry.id) || [] })))
  } catch (error) {
    console.error('Production stock entries query failed:', error)
    return res.status(500).json({ error: 'Üretim girişi kayıtları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/production-entries/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretim kaydı yalnızca fabrika hesabında görüntülenebilir.' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz üretim girişi numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') return res.status(403).json({ error: 'Üretim girişi yalnızca fabrika merkezinde görüntülenebilir.' })
    const entry = await loadProductionGoodsEntry(client, Number(req.params.id))
    if (!entry) return res.status(404).json({ error: 'Üretim girişi bulunamadı.' })
    return res.json(entry)
  } catch (error) {
    console.error('Production stock entry query failed:', error)
    return res.status(500).json({ error: 'Üretim girişi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/inventory/production-entries/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretim kaydı yalnızca fabrika hesabında düzenlenebilir.' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz üretim girişi numarası.' })
  const { receiptNo, entryDate, enteringWarehouseCode, lines } = req.body ?? {}
  const validEditDate = typeof entryDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entryDate)
    && Number.isFinite(Date.parse(`${entryDate}T00:00:00Z`))
    && new Date(`${entryDate}T00:00:00Z`).toISOString().slice(0, 10) === entryDate
    && entryDate <= new Date().toISOString().slice(0, 10)
  if (!Number.isInteger(Number(receiptNo)) || !validEditDate || !enteringWarehouseCode || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Fiş bilgileri ve en az bir ürün satırı zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') throw Object.assign(new Error('Üretim girişi yalnızca fabrika merkezinde düzenlenebilir.'), { statusCode: 403 })
    const current = await loadProductionGoodsEntry(client, Number(req.params.id), { forUpdate: true, manualOnly: true })
    if (!current) throw Object.assign(new Error('Düzenlenebilir üretim girişi bulunamadı.'), { statusCode: 404 })
    if (current.cancelledAt) throw Object.assign(new Error('İptal edilmiş üretim girişi düzenlenemez.'), { statusCode: 409 })
    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND tenant_code = 'F:MAIN' AND type = 'Merkez Depo' AND active IS TRUE FOR SHARE`,
      [enteringWarehouseCode],
    )
    if (!warehouse.rowCount) throw Object.assign(new Error('Giren depo aktif fabrika merkez deposu olmalıdır.'), { statusCode: 400 })
    const duplicate = await client.query(
      `SELECT id FROM other_stock_entries
        WHERE receipt_no = $1 AND tenant_code = 'F:MAIN' AND id <> $2
       FOR UPDATE`,
      [Number(receiptNo), Number(req.params.id)],
    )
    if (duplicate.rowCount) throw Object.assign(new Error('Bu fiş numarası daha önce kullanılmış.'), { statusCode: 409 })
    const normalizedLines = await normalizeProductionGoodsLines(client, lines)
    await assertProductionGoodsStockAfterChange(client, [
      { before: { warehouseCode: current.enteringWarehouseCode, lines: current.lines }, after: { warehouseCode: enteringWarehouseCode, lines: normalizedLines } },
    ])
    await client.query(
      `UPDATE other_stock_entries SET receipt_no = $1, entry_date = $2, entering_warehouse_code = $3
       WHERE id = $4 AND tenant_code = 'F:MAIN' AND entry_type = 'Üretimden Mal Girişi'`,
      [Number(receiptNo), entryDate, enteringWarehouseCode, Number(req.params.id)],
    )
    await client.query('DELETE FROM other_stock_entry_lines WHERE entry_id = $1', [Number(req.params.id)])
    for (const line of normalizedLines) {
      await client.query(
        `INSERT INTO other_stock_entry_lines
           (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [Number(req.params.id), line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode],
      )
    }
    const updated = { ...current, receiptNo: Number(receiptNo), entryDate, enteringWarehouseCode, lines: normalizedLines }
    await recordAudit(client, req, { entityType: 'production_goods_receipt', entityId: req.params.id, action: 'update', oldValue: current, newValue: updated })
    await client.query('COMMIT')
    return res.json(updated)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Production goods receipt update failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Üretim girişi güncellenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/inventory/production-entries/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretim kaydı yalnızca fabrika hesabında iptal edilebilir.' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz üretim girişi numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') throw Object.assign(new Error('Üretim girişi yalnızca fabrika merkezinde iptal edilebilir.'), { statusCode: 403 })
    const current = await loadProductionGoodsEntry(client, Number(req.params.id), { forUpdate: true, manualOnly: true })
    if (!current) throw Object.assign(new Error('İptal edilebilir üretim girişi bulunamadı.'), { statusCode: 404 })
    if (current.cancelledAt) throw Object.assign(new Error('Üretim girişi daha önce iptal edilmiş.'), { statusCode: 409 })
    await assertProductionGoodsStockAfterChange(client, [
      { before: { warehouseCode: current.enteringWarehouseCode, lines: current.lines }, after: null },
    ])
    const cancelled = await client.query(
      `UPDATE other_stock_entries SET cancelled_at = NOW(), cancelled_by = $1
       WHERE id = $2 AND tenant_code = 'F:MAIN' AND entry_type = 'Üretimden Mal Girişi' AND cancelled_at IS NULL
       RETURNING cancelled_at AS "cancelledAt", cancelled_by AS "cancelledBy"`,
      [req.authenticatedUser?.username || req.header('x-vdesgo-username') || null, Number(req.params.id)],
    )
    if (!cancelled.rowCount) throw Object.assign(new Error('Üretim girişi bulunamadı veya daha önce iptal edildi.'), { statusCode: 409 })
    await recordAudit(client, req, { entityType: 'production_goods_receipt', entityId: req.params.id, action: 'cancel', oldValue: current, newValue: { ...current, ...cancelled.rows[0], cancelled: true } })
    await client.query('COMMIT')
    return res.json({ id: Number(req.params.id), cancelled: true, ...cancelled.rows[0] })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Production goods receipt cancellation failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Üretim girişi iptal edilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

const requireDistributorOrderAccount = (req, res) => {
  if (req.authenticatedUser?.accountType === 'distributor') return true
  res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Fabrika siparişleri yalnızca distribütör hesabında kullanılabilir.' })
  return false
}

app.get('/factory-orders/products', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireDistributorOrderAccount(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    return res.json(await loadFactoryOrderProducts(client, tenantCode))
  } catch (error) {
    console.error('Factory order product list failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Sipariş ürünleri alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Factory order product connection cleanup failed:', error)) }
})

app.get('/factory-orders', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireDistributorOrderAccount(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    return res.json(await listFactoryOrders(client, tenantCode))
  } catch (error) {
    console.error('Factory order history failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fabrika siparişleri alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Factory order history connection cleanup failed:', error)) }
})

app.post('/factory-orders', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireDistributorOrderAccount(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const order = await createFactoryOrder(client, {
      tenantCode,
      customerCode: req.authenticatedUser.customerCode,
      username: req.authenticatedUser.username,
      lines: req.body?.lines,
    })
    await recordAudit(client, req, {
      entityType: 'distributor_factory_order',
      entityId: order.id,
      action: 'create',
      newValue: order,
    })
    await client.query('COMMIT')
    return res.status(201).json(order)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Factory order rollback failed:', rollbackError))
    console.error('Factory order creation failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fabrika siparişi kaydedilemedi.' })
  } finally { await client.end().catch((error) => console.error('Factory order connection cleanup failed:', error)) }
})

app.put('/factory-orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireDistributorOrderAccount(req, res)) return
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz fabrika sipariş numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const updated = await updatePendingFactoryOrder(client, {
      tenantCode,
      customerCode: req.authenticatedUser.customerCode,
      username: req.authenticatedUser.username,
      orderId: Number(req.params.id),
      lines: req.body?.lines,
    })
    const { previousLines, ...order } = updated
    await recordAudit(client, req, {
      entityType: 'distributor_factory_order',
      entityId: order.id,
      action: 'update',
      oldValue: previousLines,
      newValue: order,
    })
    await client.query('COMMIT')
    return res.json(order)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Factory order update rollback failed:', rollbackError))
    console.error('Factory order update failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fabrika siparişi güncellenemedi.' })
  } finally { await client.end().catch((error) => console.error('Factory order update connection cleanup failed:', error)) }
})

app.delete('/factory-orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireDistributorOrderAccount(req, res)) return
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz fabrika sipariş numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const deleted = await deletePendingFactoryOrder(client, {
      tenantCode,
      orderId: Number(req.params.id),
    })
    await recordAudit(client, req, {
      entityType: 'distributor_factory_order',
      entityId: deleted.id,
      action: 'delete',
      oldValue: deleted,
    })
    await client.query('COMMIT')
    return res.json({ ok: true, orderNo: deleted.orderNo })
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Factory order deletion rollback failed:', rollbackError))
    console.error('Factory order deletion failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fabrika siparişi silinemedi.' })
  } finally { await client.end().catch((error) => console.error('Factory order deletion connection cleanup failed:', error)) }
})

app.patch('/factory-orders/:id/production', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz fabrika sipariş numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const order = await client.query(
      `SELECT dfo.id, dfo.tenant_code AS "tenantCode", dfo.status,
         dfo.approval_note AS "approvalNote", dfo.approved_at AS "approvedAt"
       FROM distributor_factory_orders dfo
       INNER JOIN orders o ON o.source_factory_order_id = dfo.id
       WHERE dfo.id = $1 AND o.tenant_code = 'F:MAIN'
       FOR UPDATE OF dfo`,
      [Number(req.params.id)],
    )
    if (!order.rowCount) throw Object.assign(new Error('Distribütör siparişi bulunamadı.'), { statusCode: 404 })
    const current = order.rows[0]
    if (current.status === 'Reddedildi') {
      throw Object.assign(new Error('Reddedilmiş sipariş üretime gönderilemez.'), { statusCode: 409 })
    }
    let result = current
    if (current.status === 'Bekliyor') {
      const approved = await client.query(
        `UPDATE distributor_factory_orders
         SET status = 'Onaylandı', approval_note = 'Üretime gönderildi',
             approved_by = $2, approved_at = NOW(), updated_by = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'Bekliyor'
         RETURNING id, tenant_code AS "tenantCode", status,
           approval_note AS "approvalNote", approved_at AS "approvedAt"`,
        [current.id, req.authenticatedUser.username || null],
      )
      if (!approved.rowCount) {
        throw Object.assign(new Error('Sipariş durumu değişti; yenileyip tekrar deneyiniz.'), { statusCode: 409 })
      }
      result = approved.rows[0]
      await recordAudit(client, req, {
        entityType: 'distributor_factory_order',
        entityId: current.id,
        action: 'approve_for_production',
        oldValue: { status: current.status },
        newValue: { status: result.status, approvalNote: result.approvalNote },
      })
    }
    await client.query('COMMIT')
    return res.json({
      id: result.id,
      tenantCode: result.tenantCode,
      status: result.status,
      approvalNote: result.approvalNote,
      approvedAt: result.approvedAt,
    })
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Factory order production rollback failed:', rollbackError))
    return res.status(error.statusCode || 400).json({ error: error.message || 'Sipariş üretime gönderilemedi.' })
  } finally { await client.end().catch((error) => console.error('Factory order production connection cleanup failed:', error)) }
})

app.get('/inventory/warehouse-transfer-report', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const { startDate, endDate, enteringWarehouseCode, exitingWarehouseCode } = req.query
    const productCodes = Array.isArray(req.query.productCode) ? req.query.productCode : req.query.productCode ? [req.query.productCode] : []
    const query = buildWarehouseTransferReportQuery({
      tenantCode,
      startDate,
      endDate,
      enteringWarehouseCode,
      exitingWarehouseCode,
      productCodes,
    })
    const result = await client.query(query.text, query.values)
    return res.json(result.rows.map((row) => ({ ...row, transferDate: toApiValue(row.transferDate), quantity: Number(row.quantity), innerQuantity: Number(row.innerQuantity || 1), totalQuantity: Number(row.totalQuantity) })))
  } catch (error) {
    console.error('Warehouse transfer report query failed:', error)
    return res.status(500).json({ error: 'Warehouse transfer report query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/stock-report/movements/:operation', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const query = buildOtherStockMovementReportQuery({
      operation: req.params.operation,
      tenantCode,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    })
    const result = await client.query(query.text, query.values)
    return res.json({
      movementType: query.movementType,
      rows: result.rows.map((row) => ({
        ...row,
        lastMovementDate: toApiValue(row.lastMovementDate),
        innerQuantity: Number(String(row.innerQuantity || '1').replace(',', '.')),
        quantity: Number(row.quantity),
        totalQuantity: Number(row.totalQuantity),
      })),
    })
  } catch (error) {
    console.error('Other stock movement report query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Sair stok hareketi raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/report-filter-options/:report/:resource', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    return res.json(await loadReportFilterOptions(client, { ...req.params, tenantCode }))
  } catch (error) {
    console.error('Report filter options failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Rapor filtre seçenekleri alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Report filter options cleanup failed:', error)) }
})

app.get('/sales-invoices/summary/invoice-types', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const result = await client.query("SELECT DISTINCT sale_type AS type FROM sales_invoices WHERE tenant_code IS NOT DISTINCT FROM $1 AND cancelled IS NOT TRUE AND sale_type IS NOT NULL AND sale_type <> '' ORDER BY sale_type", [tenantCode])
    return res.json(result.rows.map((row) => row.type))
  } catch (error) {
    console.error('Sales invoice type query failed:', error)
    return res.status(500).json({ error: 'Fatura tipleri alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/summary/invoice-numbers', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = tenantCode === null ? [] : [tenantCode]
    const scope = tenantCode === null ? ' WHERE i.cancelled IS NOT TRUE' : ' WHERE i.cancelled IS NOT TRUE AND i.tenant_code IS NOT DISTINCT FROM $1'
    const result = await client.query(`SELECT DISTINCT i.invoice_no AS number FROM sales_invoices i LEFT JOIN customer_cards c ON c.code = i.customer_code ${scope} ORDER BY number DESC`, params)
    return res.json(result.rows.map((row) => row.number))
  } catch (error) {
    console.error('Sales invoice number query failed:', error)
    return res.status(500).json({ error: 'Fatura numaraları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/summary', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const conditions = []
    const params = []
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    conditions.push('i.cancelled IS NOT TRUE')
    if (tenantCode !== null) { params.push(tenantCode); conditions.push(`i.tenant_code IS NOT DISTINCT FROM $${params.length}`) }
    if (req.query.firstDate) { params.push(req.query.firstDate); conditions.push(`i.invoice_date >= $${params.length}`) }
    if (req.query.lastDate) { params.push(req.query.lastDate); conditions.push(`i.invoice_date <= $${params.length}`) }
    const customerCodes = queryValues(req.query.customerCode)
    const customerTypeCodes = queryValues(req.query.customerTypeCode)
    const customerGroupCodes = queryValues(req.query.customerGroupCode)
    const invoiceTypes = queryValues(req.query.invoiceType)
    const invoiceNos = queryValues(req.query.invoiceNo)
    const representativeIds = queryValues(req.query.representativeId)
    const warehouseCodes = queryValues(req.query.warehouseCode)
    const productCodes = queryValues(req.query.productCode)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`i.customer_code = ANY($${params.length}::text[])`) }
    if (customerTypeCodes.length) { params.push(customerTypeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (customerGroupCodes.length) { params.push(customerGroupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (invoiceTypes.length) { params.push(invoiceTypes); conditions.push(`i.sale_type = ANY($${params.length}::text[])`) }
    if (invoiceNos.length) { params.push(invoiceNos.map((value) => `%${value}%`)); conditions.push(`i.invoice_no ILIKE ANY($${params.length}::text[])`) }
    if (representativeIds.length) { params.push(representativeIds.map(Number)); conditions.push(`i.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]))`) }
    if (warehouseCodes.length) { params.push(warehouseCodes); conditions.push(`i.warehouse_code = ANY($${params.length}::text[])`) }
    if (productCodes.length) { params.push(productCodes); conditions.push(`EXISTS (SELECT 1 FROM sales_invoice_lines report_line WHERE report_line.invoice_id = i.id AND report_line.product_code = ANY($${params.length}::text[]))`) }
    const filterClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      SELECT i.invoice_no AS "invoiceNo",
             i.invoice_date AS "invoiceDate",
             i.customer_code AS "customerCode",
             i.customer_name AS "customerName",
             i.sale_type AS "saleType",
             i.total_amount AS "totalAmount",
             i.warehouse_code AS "warehouseCode"
      FROM sales_invoices i
      LEFT JOIN customer_cards c ON c.code = i.customer_code
      ${filterClause}
      ORDER BY i.invoice_date DESC, i.invoice_no DESC
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, totalAmount: Number(row.totalAmount || 0), invoiceDate: toApiValue(row.invoiceDate) })))
  } catch (error) {
    console.error('Sales invoice summary query failed:', error)
    return res.status(500).json({ error: 'Satış fatura özeti alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/detail', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const conditions = []
    const params = []
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    conditions.push('i.cancelled IS NOT TRUE')
    if (tenantCode !== null) { params.push(tenantCode); conditions.push(`i.tenant_code IS NOT DISTINCT FROM $${params.length}`) }
    if (req.query.firstDate) { params.push(req.query.firstDate); conditions.push(`i.invoice_date >= $${params.length}`) }
    if (req.query.lastDate) { params.push(req.query.lastDate); conditions.push(`i.invoice_date <= $${params.length}`) }
    const customerCodes = queryValues(req.query.customerCode)
    const customerTypeCodes = queryValues(req.query.customerTypeCode)
    const customerGroupCodes = queryValues(req.query.customerGroupCode)
    const invoiceTypes = queryValues(req.query.invoiceType)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`i.customer_code = ANY($${params.length}::text[])`) }
    if (customerTypeCodes.length) { params.push(customerTypeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (customerGroupCodes.length) { params.push(customerGroupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (invoiceTypes.length) { params.push(invoiceTypes); conditions.push(`i.sale_type = ANY($${params.length}::text[])`) }
    if (req.query.invoiceNo) { params.push(`%${req.query.invoiceNo}%`); conditions.push(`i.invoice_no ILIKE $${params.length}`) }
    const filterClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      SELECT i.invoice_no AS "invoiceNo",
             i.invoice_date AS "invoiceDate",
             i.customer_code AS "customerCode",
             i.customer_name AS "customerName",
             i.sale_type AS "saleType",
             l.product_code AS "productCode",
             l.product_name AS "productName",
             l.quantity,
             l.unit_price AS "unitPrice",
             l.line_total AS "lineTotal",
             l.discount_1 AS "discount1",
             l.discount_2 AS "discount2",
             l.is_promotional AS "isPromotional",
             i.sales_representative AS "salesRepresentative",
             i.total_amount AS "invoiceTotal",
                 COALESCE(NULLIF(regexp_replace(replace(COALESCE(p.vat, ''), ',', '.'), '[^0-9.]', '', 'g'), '')::numeric, 0) AS vat,
             i.warehouse_code AS "warehouseCode"
      FROM sales_invoice_lines l
      INNER JOIN sales_invoices i ON i.id = l.invoice_id
      LEFT JOIN customer_cards c ON c.code = i.customer_code
                LEFT JOIN factory_products p ON p.code = l.product_code
      ${filterClause}
      ORDER BY i.invoice_date DESC, i.invoice_no DESC, l.id
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, quantity: Number(row.quantity || 0), unitPrice: Number(row.unitPrice || 0), lineTotal: Number(row.lineTotal || 0), discount1: Number(row.discount1 || 0), discount2: Number(row.discount2 || 0), invoiceTotal: Number(row.invoiceTotal || 0), vat: Number(row.vat || 0), invoiceDate: toApiValue(row.invoiceDate) })))
  } catch (error) {
    console.error('Sales invoice detail query failed:', error)
    return res.status(500).json({ error: 'Satış fatura detayı alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/general', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const conditions = []
    const params = []
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    conditions.push('i.cancelled IS NOT TRUE')
    if (tenantCode !== null) { params.push(tenantCode); conditions.push(`i.tenant_code IS NOT DISTINCT FROM $${params.length}`) }
    if (req.query.firstDate) { params.push(req.query.firstDate); conditions.push(`i.invoice_date >= $${params.length}`) }
    if (req.query.lastDate) { params.push(req.query.lastDate); conditions.push(`i.invoice_date <= $${params.length}`) }
    const customerCodes = queryValues(req.query.customerCode)
    const customerTypeCodes = queryValues(req.query.customerTypeCode)
    const customerGroupCodes = queryValues(req.query.customerGroupCode)
    const invoiceTypes = queryValues(req.query.invoiceType)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`i.customer_code = ANY($${params.length}::text[])`) }
    if (customerTypeCodes.length) { params.push(customerTypeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (customerGroupCodes.length) { params.push(customerGroupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (invoiceTypes.length) { params.push(invoiceTypes); conditions.push(`i.sale_type = ANY($${params.length}::text[])`) }
    const invoiceNos = queryValues(req.query.invoiceNo)
    const representativeIds = queryValues(req.query.representativeId)
    const warehouseCodes = queryValues(req.query.warehouseCode)
    const productCodes = queryValues(req.query.productCode)
    if (invoiceNos.length) { params.push(invoiceNos.map((value) => `%${value}%`)); conditions.push(`i.invoice_no ILIKE ANY($${params.length}::text[])`) }
    if (representativeIds.length) { params.push(representativeIds.map(Number)); conditions.push(`i.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]) AND tenant_code IS NOT DISTINCT FROM i.tenant_code)`) }
    if (warehouseCodes.length) { params.push(warehouseCodes); conditions.push(`i.warehouse_code = ANY($${params.length}::text[])`) }
    if (productCodes.length) { params.push(productCodes); conditions.push(`l.product_code = ANY($${params.length}::text[])`) }
    const filterClause = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      SELECT l.product_code AS "productCode", l.product_name AS "productName", l.unit,
             SUM(l.quantity) AS quantity, SUM(l.line_total) AS "totalAmount"
      FROM sales_invoice_lines l
      INNER JOIN sales_invoices i ON i.id = l.invoice_id
      LEFT JOIN customer_cards c ON c.code = i.customer_code
      LEFT JOIN factory_products p ON p.code = l.product_code
      ${filterClause}
      GROUP BY l.product_code, l.product_name, l.unit
      ORDER BY "totalAmount" DESC, l.product_code
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, quantity: Number(row.quantity || 0), totalAmount: Number(row.totalAmount || 0) })))
  } catch (error) {
    console.error('General sales report query failed:', error)
    return res.status(500).json({ error: 'Genel satış listesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/product-customer', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const conditions = ['i.cancelled IS NOT TRUE']
    const params = tenantCode === null ? [] : [tenantCode]
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    if (tenantCode !== null) conditions.push('i.tenant_code IS NOT DISTINCT FROM $1')
    if (req.query.firstDate) { params.push(req.query.firstDate); conditions.push(`i.invoice_date >= $${params.length}`) }
    if (req.query.lastDate) { params.push(req.query.lastDate); conditions.push(`i.invoice_date <= $${params.length}`) }
    const customerCodes = queryValues(req.query.customerCode)
    const customerTypeCodes = queryValues(req.query.customerTypeCode)
    const customerGroupCodes = queryValues(req.query.customerGroupCode)
    const invoiceTypes = queryValues(req.query.invoiceType)
    const invoiceNos = queryValues(req.query.invoiceNo)
    const representativeIds = queryValues(req.query.representativeId)
    const warehouseCodes = queryValues(req.query.warehouseCode)
    const productCodes = queryValues(req.query.productCode)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`i.customer_code = ANY($${params.length}::text[])`) }
    if (customerTypeCodes.length) { params.push(customerTypeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (customerGroupCodes.length) { params.push(customerGroupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (invoiceTypes.length) { params.push(invoiceTypes); conditions.push(`i.sale_type = ANY($${params.length}::text[])`) }
    if (invoiceNos.length) { params.push(invoiceNos.map((value) => `%${value}%`)); conditions.push(`i.invoice_no ILIKE ANY($${params.length}::text[])`) }
    if (representativeIds.length) { params.push(representativeIds.map(Number)); conditions.push(`i.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]))`) }
    if (warehouseCodes.length) { params.push(warehouseCodes); conditions.push(`i.warehouse_code = ANY($${params.length}::text[])`) }
    if (productCodes.length) { params.push(productCodes); conditions.push(`l.product_code = ANY($${params.length}::text[])`) }
    const filterClause = ` WHERE ${conditions.join(' AND ')}`
    const result = await client.query(`
      SELECT l.product_code AS "productCode",
             l.product_name AS "productName",
             i.customer_code AS "customerCode",
             i.customer_name AS "customerName",
             SUM(l.quantity) AS "quantity",
             SUM(l.line_total) AS "totalAmount"
      FROM sales_invoice_lines l
      INNER JOIN sales_invoices i ON i.id = l.invoice_id
      LEFT JOIN customer_cards c ON c.code = i.customer_code
      ${filterClause}
      GROUP BY l.product_code, l.product_name, i.customer_code, i.customer_name
      ORDER BY "totalAmount" DESC, l.product_code, i.customer_code
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, quantity: Number(row.quantity || 0), totalAmount: Number(row.totalAmount || 0) })))
  } catch (error) {
    console.error('Product customer sales report query failed:', error)
    return res.status(500).json({ error: 'Ürün bazlı müşteri raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/receipt-operations', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const params = tenantCode === null ? [] : [tenantCode]
    const salesScope = tenantCode === null
      ? ''
      : ' WHERE i.tenant_code IS NOT DISTINCT FROM $1'
    const purchaseScope = tenantCode === null ? '' : ' WHERE i.tenant_code IS NOT DISTINCT FROM $1'
    const returnScope = tenantCode === null ? '' : ' WHERE i.tenant_code IS NOT DISTINCT FROM $1'
    const orderScope = `WHERE ${tenantCode === null ? '' : 'o.tenant_code IS NOT DISTINCT FROM $1 AND '}
      (converted.id IS NULL OR COALESCE(batch.created_at,
        converted.created_at AT TIME ZONE 'Europe/Istanbul') >= NOW() - INTERVAL '10 days')`
    const result = await client.query(`
      SELECT i.id, 'Satış Faturası' AS "receiptType",
        CASE WHEN i.source_channel = 'MOBILE' AND i.invoice_no LIKE 'MOB-%'
          THEN COALESCE(NULLIF(i.mobile_print_number, ''), 'ERP numarası bekliyor')
          ELSE COALESCE(i.invoice_no, 'Taslak-' || i.id::text) END AS no,
        i.transfer_code AS "transferCode", i.invoice_date AS date,
        i.customer_code AS "customerCode", i.customer_name AS customer, i.total_amount AS total,
        i.sale_type AS "saleType", NULL::text AS "returnType", i.tenant_code AS "tenantCode", i.cancelled,
        i.printed_at AS "printedAt", i.printed_by AS "printedBy", NULL::bigint AS "sourceFactoryOrderId",
        NULL::text AS "sourceFactoryOrderStatus",
        cancellation.id AS "cancellationRequestId", cancellation.status AS "cancellationStatus",
        i.sales_representative AS "salesRepresentative", FALSE AS "convertedToInvoice"
      FROM sales_invoices i LEFT JOIN customer_cards c ON c.code = i.customer_code AND c.tenant_code = i.tenant_code
      LEFT JOIN LATERAL (
        SELECT r.id, r.status FROM factory_invoice_cancellation_requests r
        WHERE r.sales_invoice_id = i.id ORDER BY r.requested_at DESC LIMIT 1
      ) cancellation ON TRUE${salesScope}
      UNION ALL
      SELECT i.id, 'Alış Faturası', i.invoice_no, i.source_transfer_code, i.invoice_date, i.customer_code, i.customer_name, i.total_amount, NULL, NULL, i.tenant_code, i.cancelled, NULL::timestamptz, NULL::text, NULL::bigint, NULL::text,
        cancellation.id, cancellation.status, NULL::text, FALSE
      FROM purchase_invoices i LEFT JOIN customer_cards c ON c.code = i.customer_code AND c.tenant_code = i.tenant_code
      LEFT JOIN LATERAL (
        SELECT r.id, r.status FROM factory_invoice_cancellation_requests r
        WHERE r.purchase_invoice_id = i.id ORDER BY r.requested_at DESC LIMIT 1
      ) cancellation ON TRUE${purchaseScope}
      UNION ALL
      SELECT i.id, 'İade Faturası', i.invoice_no, NULL::text, i.invoice_date, i.customer_code, i.customer_name, i.total_amount, NULL, i.return_type, i.tenant_code, i.cancelled, NULL::timestamptz, NULL::text, NULL::bigint, NULL::text, NULL::bigint, NULL::text, NULL::text, FALSE
      FROM return_invoices i LEFT JOIN customer_cards c ON c.code = i.customer_code AND c.tenant_code = i.tenant_code${returnScope}
      UNION ALL
      SELECT o.id, 'Sipariş', o.order_no, NULL::text, o.order_date, o.customer_code, c.name, o.total_amount, NULL, NULL, o.tenant_code, FALSE, NULL::timestamptz, NULL::text,
        o.source_factory_order_id AS "sourceFactoryOrderId", dfo.status AS "sourceFactoryOrderStatus", NULL::bigint AS "cancellationRequestId", NULL::text AS "cancellationStatus",
        COALESCE(sr.name, NULLIF(c.sales_representative, ''), '') AS "salesRepresentative",
        converted.id IS NOT NULL AS "convertedToInvoice"
      FROM orders o LEFT JOIN customer_cards c ON c.code = o.customer_code AND c.tenant_code = o.tenant_code
      LEFT JOIN distributor_factory_orders dfo ON dfo.id = o.source_factory_order_id
      LEFT JOIN sales_invoices converted ON converted.source_order_id = o.id
      LEFT JOIN shipment_batch_orders batch_order ON batch_order.order_id = o.id
      LEFT JOIN shipment_batches batch ON batch.id = batch_order.batch_id
      LEFT JOIN LATERAL (
        SELECT a.sales_representative_id
        FROM sales_rep_customers a
        WHERE a.customer_code = o.customer_code AND a.tenant_code = o.tenant_code AND a.active = TRUE
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
      ) assigned ON TRUE
      LEFT JOIN sales_representatives sr
        ON sr.id = assigned.sales_representative_id AND sr.tenant_code = o.tenant_code
      ${orderScope}
      ORDER BY date DESC NULLS LAST, id DESC
    `, params)
    return res.json(result.rows.map((row) => ({
      ...row,
      date: toApiValue(row.date),
      total: formatMoney(row.total),
      printed: row.printedAt != null,
    })))
  } catch (error) {
    console.error('Receipt operations query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fiş kayıtları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

const requireDistributorBulkOrderAccess = (req) => {
  if (req.authenticatedUser?.accountType !== 'distributor') {
    throw Object.assign(new Error('Toplu sipariş işlemi yalnızca distribütör hesabında kullanılabilir.'), {
      statusCode: req.authenticatedUser ? 403 : 401,
    })
  }
}

const requireBulkOrderMigration = async (client) => {
  const migration = await client.query(
    `SELECT 1 FROM mobile_backend_migrations WHERE name = '025-bulk-order-shipment-batches'`,
  )
  if (!migration.rowCount) {
    throw Object.assign(new Error('Toplu sipariş/sevkiyat veritabanı güncellemesi uygulanmalıdır.'), {
      statusCode: 503,
    })
  }
}

const validIsoDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

app.get('/bulk-order-conversion/options', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    requireDistributorBulkOrderAccess(req)
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    await requireBulkOrderMigration(client)
    const [warehouses, representatives] = await Promise.all([
      client.query(
        `SELECT code, name, type, active FROM factory_warehouses
         WHERE tenant_code = $1 AND active = TRUE
           AND type IN ('Merkez Depo', 'Gecici Depo')
         ORDER BY name, code`,
        [tenantCode],
      ),
      client.query(
        `SELECT id, name, active FROM sales_representatives
         WHERE tenant_code = $1 AND active = TRUE ORDER BY name, id`,
        [tenantCode],
      ),
    ])
    return res.json({ warehouses: warehouses.rows, representatives: representatives.rows })
  } catch (error) {
    console.error('Bulk order options query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Sipariş filtreleri alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/bulk-order-conversion/orders', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    requireDistributorBulkOrderAccess(req)
    const { from, to, warehouseCode } = req.query
    const representativeId = req.query.salesRepresentativeId
      ? Number(req.query.salesRepresentativeId)
      : null
    if (!validIsoDate(from) || !validIsoDate(to) || from > to || !warehouseCode) {
      return res.status(400).json({ error: 'Tarih aralığı ve stok kontrol deposu zorunludur.' })
    }
    if (representativeId != null && (!Number.isSafeInteger(representativeId) || representativeId <= 0)) {
      return res.status(400).json({ error: 'Geçersiz satış temsilcisi.' })
    }

    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    await requireBulkOrderMigration(client)
    const warehouse = await client.query(
      `SELECT code, name FROM factory_warehouses
       WHERE code = $1 AND tenant_code = $2 AND active = TRUE
         AND type IN ('Merkez Depo', 'Gecici Depo')`,
      [warehouseCode, tenantCode],
    )
    if (!warehouse.rowCount) {
      return res.status(404).json({ error: 'Seçilen depo bulunamadı veya bu distribütöre ait değil.' })
    }

    const result = await client.query(
      `SELECT o.id, o.order_no AS "orderNo", o.order_date AS "orderDate",
          o.customer_code AS "customerCode",
          COALESCE(NULLIF(c.title, ''), c.name) AS "customerName",
          o.total_amount AS "totalAmount", o.warehouse_code AS "reservationWarehouseCode",
          o.stock_reserved AS "stockReserved", o.reservation_exit_id AS "reservationExitId",
          COALESCE(o.sales_representative_id, assigned.sales_representative_id) AS "salesRepresentativeId",
          COALESCE(sr.name, NULLIF(c.sales_representative, ''), '') AS "salesRepresentative",
          i.id AS "convertedInvoiceId", i.invoice_no AS "convertedInvoiceNo",
          b.id AS "shipmentBatchId"
       FROM orders o
       INNER JOIN customer_cards c
         ON c.code = o.customer_code AND c.tenant_code = o.tenant_code
       LEFT JOIN LATERAL (
         SELECT a.sales_representative_id
         FROM sales_rep_customers a
         WHERE a.customer_code = c.code AND a.tenant_code = o.tenant_code AND a.active = TRUE
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1
       ) assigned ON TRUE
       LEFT JOIN sales_representatives sr
         ON sr.id = COALESCE(o.sales_representative_id, assigned.sales_representative_id)
         AND sr.tenant_code = o.tenant_code
       LEFT JOIN sales_invoices i ON i.source_order_id = o.id
       LEFT JOIN shipment_batch_orders b ON b.order_id = o.id
       WHERE o.tenant_code = $1 AND o.order_date BETWEEN $2::date AND $3::date
         AND o.source_factory_order_id IS NULL
         AND COALESCE(o.mobile_status, '') <> 'CANCELLED'
         AND ($4::integer IS NULL
           OR COALESCE(o.sales_representative_id, assigned.sales_representative_id) = $4
           OR (COALESCE(o.sales_representative_id, assigned.sales_representative_id) IS NULL
             AND c.sales_representative = (
               SELECT r.name FROM sales_representatives r
               WHERE r.id = $4 AND r.tenant_code = o.tenant_code
             )))
       ORDER BY o.order_date DESC, o.id DESC`,
      [tenantCode, from, to, representativeId],
    )
    const orderIds = result.rows.map((row) => row.id)
    const lineResult = orderIds.length
      ? await client.query(
          `SELECT l.id AS "lineId", l.order_id AS "orderId", l.product_code AS "productCode",
              l.product_name AS "productName", l.unit, l.quantity,
              l.inner_quantity AS "innerQuantity", l.total_quantity AS "totalQuantity"
           FROM order_lines l
           WHERE l.order_id = ANY($1::integer[])
           ORDER BY l.order_id, l.id`,
          [orderIds],
        )
      : { rows: [] }
    const linesByOrder = new Map()
    for (const line of lineResult.rows) {
      const lines = linesByOrder.get(line.orderId) ?? []
      lines.push({
        lineId: line.lineId,
        productCode: line.productCode,
        productName: line.productName,
        unit: line.unit,
        quantity: Number(line.quantity),
        innerQuantity: Number(line.innerQuantity || 1),
        totalQuantity: Number(line.totalQuantity),
      })
      linesByOrder.set(line.orderId, lines)
    }
    const orders = result.rows.map((row) => ({
      ...row,
      orderDate: toApiValue(row.orderDate),
      totalAmount: Number(row.totalAmount || 0),
      stockReserved: row.stockReserved === true,
      lines: linesByOrder.get(row.id) ?? [],
    }))
    const aggregated = aggregateOrderLines(orders.filter((order) => order.convertedInvoiceId == null))
    const products = []
    for (const [productCode, requiredQuantity] of aggregated.requiredByProduct) {
      const stock = await availableStock(client, warehouseCode, productCode, tenantCode)
      const product = await client.query(
        'SELECT unit FROM factory_products WHERE code = $1 LIMIT 1',
        [productCode],
      )
      products.push({
        productCode,
        productName: aggregated.lines.find((line) => line.productCode === productCode)?.productName ?? productCode,
        baseUnit: product.rows[0]?.unit ?? '',
        requiredQuantity,
        availableStock: stock,
      })
    }
    return res.json({
      warehouse: warehouse.rows[0],
      orders,
      products,
    })
  } catch (error) {
    console.error('Bulk order query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Toplu sipariş listesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/bulk-order-conversion/orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz sipariş kimliği.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    requireDistributorBulkOrderAccess(req)
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    await requireBulkOrderMigration(client)
    const order = await loadErpOrder(client, Number(req.params.id), tenantCode, true)
    if (order.sourceFactoryOrderId != null) {
      throw Object.assign(new Error('Bu sipariş toplu sipariş ekranından düzenlenemez.'), { statusCode: 409 })
    }
    await assertOrderNotInvoiced(client, order.id)
    const lines = await client.query(
      `SELECT l.id AS "lineId", l.product_code AS "productCode", l.product_name AS "productName", l.unit,
          l.quantity, l.inner_quantity AS "innerQuantity", l.unit_price AS "unitPrice",
          l.line_total AS "lineTotal", l.net_amount_snapshot AS "netAmount",
          l.vat_rate_snapshot AS "vatRate", l.is_promotional AS "isPromotional",
          l.promotion_id AS "promotionId", l.promotion_amount AS "promotionAmount",
          l.price_source AS "priceSource", l.price_reference_id AS "priceReferenceId",
          l.customer_discount_amount_snapshot AS "customerDiscountAmountSnapshot",
          l.manual_discount_amount AS "manualDiscountAmount",
          l.base_unit_price AS "baseUnitPrice",
          l.base_unit_net_price AS "baseUnitNetPrice",
          l.effective_unit_net_price AS "effectiveUnitNetPrice",
          l.net_amount_snapshot AS "netAmountSnapshot",
          l.gross_amount_snapshot AS "grossAmountSnapshot",
          l.tax_amount_snapshot AS "taxAmountSnapshot"
       FROM order_lines l WHERE l.order_id = $1 ORDER BY l.id FOR UPDATE`,
      [order.id],
    )
    const currentLines = orderEditLines(lines.rows, order.totalAmount)
    const quantities = req.body?.quantities
    if (!Array.isArray(quantities) || quantities.length !== currentLines.length) {
      throw Object.assign(new Error('Her sipariş ürünü için yeni miktar girilmelidir.'), { statusCode: 400 })
    }
    const quantityByLineId = new Map()
    for (const entry of quantities) {
      const quantity = Number(entry?.quantity)
      const lineId = Number(entry?.lineId)
      if (!Number.isSafeInteger(lineId) || lineId <= 0 || !Number.isFinite(quantity) || quantity <= 0
        || quantity > 100000000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 1e-7
        || quantityByLineId.has(lineId)) {
        throw Object.assign(new Error('Sipariş miktarları geçersiz.'), { statusCode: 400 })
      }
      quantityByLineId.set(lineId, quantity)
    }
    const payloadLines = currentLines.map((line) => {
      const quantity = quantityByLineId.get(line.lineId)
      if (quantity == null) {
        throw Object.assign(new Error('Sipariş ürünleri değişmiş. Listeyi yenileyip tekrar deneyin.'), { statusCode: 409 })
      }
      const oldQuantity = Number(line.quantity)
      const factor = quantity / oldQuantity
      return {
        productCode: line.productCode,
        productName: line.productName,
        unit: line.unit,
        quantity,
        innerQuantity: Number(line.innerQuantity || 1),
        unitPrice: Number(line.unitPrice || 0),
        netAmount: Number(line.netAmount || 0) * factor,
        vatRate: Number(line.vatRate || 0),
        promotionId: line.promotionId,
        promotionAmount: Number(line.promotionAmount || 0) * factor,
        isPromotional: line.isPromotional === true,
        priceSource: line.priceSource,
        priceReferenceId: line.priceReferenceId,
        customerDiscountAmountSnapshot: Number(line.customerDiscountAmountSnapshot || 0) * factor,
      }
    })
    let saved
    if (order.sourceChannel === 'MOBILE' && order.taxContractVersion === 'NET_VAT_EXCLUSIVE_V1') {
      if (order.mobileStatus !== 'ACCEPTED' || order.stockReserved || order.reservationExitId) {
        throw Object.assign(new Error('Yalnızca kabul edilmiş ve stok rezervasyonu bulunmayan mobil siparişler miktar düzenlemesine açıktır.'), { statusCode: 409 })
      }
      const updated = recalculateMobileOrderLines(lines.rows, quantityByLineId)
      await assertCustomerCredit(client, {
        customerCode: order.customerCode, tenantCode: order.tenantCode,
        amount: updated.totalAmount, excludeOrderIds: [order.id],
      })
      await client.query(
        `SELECT set_config('vdesgo.bulk_order_conversion_edit', 'on', TRUE)`,
      )
      for (const line of updated.lines) {
        await client.query(
          `UPDATE order_lines
           SET quantity = $1, total_quantity = $2, line_total = $3,
             manual_discount_amount = $4, customer_discount_amount_snapshot = $5,
             promotion_amount = $6, tax_amount_snapshot = $7,
             net_amount_snapshot = $8, gross_amount_snapshot = $9
           WHERE id = $10 AND order_id = $11`,
          [
            line.quantity, line.totalQuantity, line.grossAmount,
            line.manualDiscountAmount, line.customerDiscountAmount,
            line.promotionAmount, line.taxAmount, line.netAmount,
            line.grossAmount, line.lineId, order.id,
          ],
        )
      }
      const updatedOrder = await client.query(
        `UPDATE orders
         SET total_amount = $1, pricing_status = 'ERP_EDITED',
           subtotal_snapshot = $2, discount_total_snapshot = $3,
           promotion_total_snapshot = $4, tax_total_snapshot = $5,
           grand_total_snapshot = $1, net_total_snapshot = $6
         WHERE id = $7
         RETURNING id, order_no AS "orderNo"`,
        [
          updated.totalAmount, updated.subtotal, updated.discountAmount,
          updated.promotionAmount, updated.taxAmount, updated.netAmount, order.id,
        ],
      )
      saved = {
        ...updatedOrder.rows[0],
        customerCode: order.customerCode,
        warehouseCode: order.warehouseCode,
        totalAmount: updated.totalAmount,
        stockReserved: false,
      }
    } else {
      saved = await replaceErpOrder({
        client,
        id: order.id,
        tenantCode,
        username: req.header('x-vdesgo-username') || null,
        payload: {
          orderNo: order.orderNo,
          orderDate: order.orderDate,
          customerCode: order.customerCode,
          warehouseCode: order.warehouseCode,
          stockReserved: order.stockReserved,
          lines: payloadLines,
        },
      })
    }
    await recordAudit(client, req, {
      entityType: 'order',
      entityId: order.id,
      action: 'bulk_conversion_quantity_update',
      oldValue: { lines: currentLines.map((line) => ({ productCode: line.productCode, quantity: line.quantity })) },
      newValue: { lines: payloadLines.map((line) => ({ productCode: line.productCode, quantity: line.quantity })) },
    })
    await client.query('COMMIT')
    return res.json(saved)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Bulk order edit rollback failed:', rollbackError))
    console.error('Bulk order edit failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Sipariş miktarları güncellenemedi.' })
  } finally { await client.end().catch((error) => console.error('Bulk order edit cleanup failed:', error)) }
})

app.post('/bulk-order-conversion/convert', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const orderIds = normalizeBulkOrderIds(req.body?.orderIds)
  const warehouseCode = typeof req.body?.warehouseCode === 'string' ? req.body.warehouseCode.trim() : ''
  if (!orderIds || !warehouseCode) {
    return res.status(400).json({ error: 'En az bir sipariş ve stok kontrol deposu seçilmelidir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    requireDistributorBulkOrderAccess(req)
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    await requireBulkOrderMigration(client)
    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND tenant_code = $2 AND active = TRUE
         AND type IN ('Merkez Depo', 'Gecici Depo')
       FOR UPDATE`,
      [warehouseCode, tenantCode],
    )
    if (!warehouse.rowCount) {
      throw Object.assign(new Error('Seçilen depo bulunamadı veya bu distribütöre ait değil.'), { statusCode: 404 })
    }
    const orderResult = await client.query(
      `SELECT id, order_no AS "orderNo", order_date AS "orderDate",
          customer_code AS "customerCode", warehouse_code AS "warehouseCode",
          total_amount AS "totalAmount", stock_reserved AS "stockReserved",
          reservation_exit_id AS "reservationExitId",
          subtotal_snapshot AS "subtotalSnapshot",
          discount_total_snapshot AS "discountTotalSnapshot",
          promotion_total_snapshot AS "promotionTotalSnapshot",
          tax_total_snapshot AS "taxTotalSnapshot",
          grand_total_snapshot AS "grandTotalSnapshot",
          net_total_snapshot AS "netTotalSnapshot",
          source_channel AS "sourceChannel", source_factory_order_id AS "sourceFactoryOrderId"
       FROM orders
       WHERE id = ANY($1::integer[]) AND tenant_code = $2
       ORDER BY id
       FOR UPDATE`,
      [orderIds, tenantCode],
    )
    if (orderResult.rowCount !== orderIds.length
      || orderResult.rows.some((order) => order.sourceFactoryOrderId != null)) {
      throw Object.assign(new Error('Seçilen siparişlerden bazıları bulunamadı veya dönüştürülemez.'), { statusCode: 409 })
    }
    const alreadyConverted = await client.query(
      `SELECT source_order_id FROM sales_invoices
       WHERE source_order_id = ANY($1::integer[])`,
      [orderIds],
    )
    if (alreadyConverted.rowCount) {
      throw Object.assign(new Error('Seçilen siparişlerden en az biri daha önce faturaya dönüştürülmüş.'), { statusCode: 409 })
    }
    const orderLinesResult = await client.query(
      `SELECT l.order_id AS "orderId", l.product_code AS "productCode",
          l.product_name AS "productName", l.unit, l.quantity,
          l.inner_quantity AS "innerQuantity", l.total_quantity AS "totalQuantity",
          l.unit_price AS "unitPrice", l.line_total AS "lineTotal",
          l.net_amount_snapshot AS "netAmountSnapshot",
          l.gross_amount_snapshot AS "grossAmountSnapshot",
          l.vat_rate_snapshot AS "vatRateSnapshot",
          l.tax_amount_snapshot AS "taxAmountSnapshot",
          l.customer_discount_amount_snapshot AS "customerDiscountAmountSnapshot",
          l.manual_discount_amount AS "manualDiscountAmount",
          l.manual_discount_percent AS "manualDiscountPercent",
          l.price_source AS "priceSource", l.price_reference_id AS "priceReferenceId",
          l.base_unit_price AS "baseUnitPrice", l.promotion_id AS "promotionId",
          l.promotion_amount AS "promotionAmount"
       FROM order_lines l
       WHERE l.order_id = ANY($1::integer[])
       ORDER BY l.order_id, l.id`,
      [orderIds],
    )
    const linesByOrder = new Map()
    for (const line of orderLinesResult.rows) {
      const lines = linesByOrder.get(line.orderId) ?? []
      lines.push(line)
      linesByOrder.set(line.orderId, lines)
    }
    const orders = orderResult.rows.map((order) => ({
      ...order,
      lines: linesByOrder.get(order.id) ?? [],
    }))
    if (orders.some((order) => order.lines.length === 0)) {
      throw Object.assign(new Error('Ürünsüz sipariş faturaya dönüştürülemez.'), { statusCode: 409 })
    }

    for (const order of orders) {
      if (order.reservationExitId) {
        const removed = await client.query(
          `DELETE FROM other_stock_exits
           WHERE id = $1 AND tenant_code = $2`,
          [order.reservationExitId, tenantCode],
        )
        if (!removed.rowCount) {
          throw Object.assign(new Error(`${order.orderNo || order.id} siparişinin stok rezervasyonu bulunamadı.`), { statusCode: 409 })
        }
        await client.query(
          'UPDATE orders SET stock_reserved = FALSE, reservation_exit_id = NULL WHERE id = $1',
          [order.id],
        )
      } else if (order.stockReserved) {
        throw Object.assign(new Error(`${order.orderNo || order.id} siparişinin stok rezervasyon kaydı eksik.`), { statusCode: 409 })
      }
    }

    const aggregated = aggregateOrderLines(orders)
    for (const [productCode, requiredQuantity] of aggregated.requiredByProduct) {
      const stock = await availableStock(client, warehouseCode, productCode, tenantCode)
      if (!Number.isFinite(stock) || stock + 1e-9 < requiredQuantity) {
        const productName = aggregated.lines.find((line) => line.productCode === productCode)?.productName || productCode
        throw Object.assign(
          new Error(`${productName} için seçilen depoda stok yetersiz. Stok: ${stock}, sipariş: ${requiredQuantity}.`),
          { statusCode: 409 },
        )
      }
    }

    const batch = await client.query(
      `INSERT INTO shipment_batches (shipment_date, warehouse_code, tenant_code, created_by)
       VALUES (CURRENT_DATE, $1, $2, $3)
       RETURNING id, shipment_date AS "shipmentDate", warehouse_code AS "warehouseCode",
         created_at AS "createdAt"`,
      [warehouseCode, tenantCode, req.header('x-vdesgo-username') || null],
    )
    const invoices = []
    for (const order of orders) {
      const customerResult = await client.query(
        `SELECT c.name, c.title, c.balance,
            COALESCE(sr.name, NULLIF(c.sales_representative, ''), '') AS "salesRepresentative"
         FROM customer_cards c
         LEFT JOIN LATERAL (
           SELECT a.sales_representative_id
           FROM sales_rep_customers a
           WHERE a.customer_code = c.code AND a.tenant_code = c.tenant_code AND a.active = TRUE
           ORDER BY a.created_at DESC, a.id DESC
           LIMIT 1
         ) assigned ON TRUE
         LEFT JOIN sales_representatives sr
           ON sr.id = assigned.sales_representative_id AND sr.tenant_code = c.tenant_code
         WHERE c.code = $1 AND c.tenant_code = $2 AND c.active = TRUE
         FOR UPDATE OF c`,
        [order.customerCode, tenantCode],
      )
      if (!customerResult.rowCount) {
        throw Object.assign(new Error(`Sipariş ${order.orderNo || order.id} carisi bulunamadı veya pasif.`), { statusCode: 409 })
      }
      const customer = customerResult.rows[0]
      const amounts = buildOrderInvoiceAmounts(order, order.lines)
      await assertCustomerCredit(client, {
        customerCode: order.customerCode, tenantCode,
        amount: amounts.totalAmount, excludeOrderIds: [order.id],
      })
      const promotionIds = [...new Set(order.lines.map((line) => Number(line.promotionId)).filter((id) => Number.isSafeInteger(id) && id > 0))]
      const promotion = promotionIds.length === 1
        ? await client.query('SELECT code, promotion_type AS "promotionType" FROM central_promotions WHERE id = $1', [promotionIds[0]])
        : { rows: [] }
      const invoice = await client.query(
        `INSERT INTO sales_invoices
           (invoice_no, invoice_date, customer_code, customer_name, sales_representative,
            sale_type, warehouse_code, total_amount, created_by, tenant_code, source_channel,
            source_order_id, promotion_id, promotion_code, promotion_type, promotion_amount,
            subtotal_amount, product_discount_amount, customer_discount_amount,
            payment_discount_amount, net_amount, tax_amount, discount_selection)
         VALUES (NULL,$1,$2,$3,$4,'Soğuk Satış',$5,$6,$7,$8,'ERP',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'{}'::jsonb)
         RETURNING id, invoice_no AS "invoiceNo"`,
        [
          order.orderDate,
          order.customerCode,
          customer.title || customer.name,
          customer.salesRepresentative,
          warehouseCode,
          amounts.totalAmount,
          req.header('x-vdesgo-username') || null,
          tenantCode,
          order.id,
          promotionIds.length === 1 ? promotionIds[0] : null,
          promotion.rows[0]?.code ?? null,
          promotion.rows[0]?.promotionType ?? null,
          amounts.promotionAmount,
          amounts.subtotal,
          amounts.productDiscountAmount,
          amounts.customerDiscountAmount,
          amounts.paymentDiscountAmount,
          amounts.netAmount,
          amounts.taxAmount,
        ],
      )
      const invoiceLines = order.lines.map((line) => {
        const netAmount = Number(line.netAmountSnapshot ?? line.lineTotal ?? 0)
        const vatRate = Number(line.vatRateSnapshot || 0)
        const vatAmount = Number(line.taxAmountSnapshot ?? (netAmount * vatRate / 100))
        return {
          productCode: line.productCode,
          productName: line.productName,
          unitCode: line.unit,
          quantity: Number(line.quantity),
          innerQuantity: Number(line.innerQuantity || 1),
          totalQuantity: Number(line.totalQuantity),
          baseUnitPrice: Number(line.baseUnitPrice ?? line.unitPrice ?? 0),
          netAmount,
          discount1Percent: Number(line.manualDiscountPercent || 0),
          discount2Percent: 0,
          isPromotional: line.priceSource === 'PROMOTION_FREE_GOODS',
          priceSource: line.priceSource,
          priceReferenceId: line.priceReferenceId,
          promotionId: line.promotionId,
          promotionCode: promotion.rows[0]?.code ?? null,
          promotionType: promotion.rows[0]?.promotionType ?? null,
          promotionAmount: Number(line.promotionAmount || 0),
          vatRate,
          vatAmount,
          grossAmount: Number(line.grossAmountSnapshot ?? (netAmount + vatAmount)),
        }
      })
      await insertInvoiceLines(client, invoice.rows[0].id, invoiceLines)
      const nextBalance = parseMoneyNumber(customer.balance) + amounts.totalAmount
      await client.query(
        'UPDATE customer_cards SET balance = $1 WHERE code = $2 AND tenant_code = $3',
        [nextBalance, order.customerCode, tenantCode],
      )
      await client.query(
        `INSERT INTO shipment_batch_orders (batch_id, order_id, invoice_id)
         VALUES ($1,$2,$3)`,
        [batch.rows[0].id, order.id, invoice.rows[0].id],
      )
      await recordAudit(client, req, {
        entityType: 'sales_invoice',
        entityId: invoice.rows[0].id,
        action: 'bulk_order_conversion',
        newValue: {
          orderId: order.id,
          invoiceNo: invoice.rows[0].invoiceNo,
          customerCode: order.customerCode,
          warehouseCode,
          totalAmount: amounts.totalAmount,
          shipmentBatchId: batch.rows[0].id,
        },
      })
      invoices.push({
        id: invoice.rows[0].id,
        invoiceNo: invoice.rows[0].invoiceNo,
        orderId: order.id,
        orderNo: order.orderNo,
        customerCode: order.customerCode,
        customerName: customer.title || customer.name,
        totalAmount: amounts.totalAmount,
      })
    }
    for (const line of aggregated.lines) {
      await client.query(
        `INSERT INTO shipment_batch_lines
           (batch_id, product_code, product_name, unit, quantity, total_quantity)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [batch.rows[0].id, line.productCode, line.productName, line.unit, line.quantity, line.totalQuantity],
      )
    }
    await recordAudit(client, req, {
      entityType: 'shipment_batch',
      entityId: batch.rows[0].id,
      action: 'create',
      newValue: {
        shipmentDate: toApiValue(batch.rows[0].shipmentDate),
        warehouseCode,
        orderIds,
        invoiceIds: invoices.map((invoice) => invoice.id),
        products: aggregated.lines,
      },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      batch: {
        ...batch.rows[0],
        shipmentDate: toApiValue(batch.rows[0].shipmentDate),
        id: Number(batch.rows[0].id),
      },
      invoices,
      products: aggregated.lines,
    })
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Bulk conversion rollback failed:', rollbackError))
    console.error('Bulk order conversion failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Siparişler faturaya dönüştürülemedi.' })
  } finally { await client.end().catch((error) => console.error('Bulk conversion cleanup failed:', error)) }
})

app.get('/shipment-batches', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    requireDistributorBulkOrderAccess(req)
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    await requireBulkOrderMigration(client)
    const batches = await client.query(
      `SELECT b.id, b.shipment_date AS "shipmentDate", b.warehouse_code AS "warehouseCode",
          w.name AS "warehouseName", b.created_by AS "createdBy", b.created_at AS "createdAt",
          COUNT(DISTINCT bo.order_id)::integer AS "orderCount"
       FROM shipment_batches b
       INNER JOIN factory_warehouses w ON w.code = b.warehouse_code AND w.tenant_code = b.tenant_code
       LEFT JOIN shipment_batch_orders bo ON bo.batch_id = b.id
       WHERE b.tenant_code = $1
       GROUP BY b.id, w.name
       ORDER BY b.shipment_date DESC, b.id DESC`,
      [tenantCode],
    )
    const batchIds = batches.rows.map((batch) => batch.id)
    const [lines, orders] = batchIds.length
      ? await Promise.all([
          client.query(
            `SELECT batch_id AS "batchId", product_code AS "productCode",
                product_name AS "productName", unit, quantity, total_quantity AS "totalQuantity"
             FROM shipment_batch_lines WHERE batch_id = ANY($1::bigint[])
             ORDER BY batch_id DESC, product_name, unit`,
            [batchIds],
          ),
          client.query(
            `SELECT bo.batch_id AS "batchId", bo.order_id AS "orderId",
                o.order_no AS "orderNo", c.code AS "customerCode",
                COALESCE(NULLIF(c.title, ''), c.name) AS "customerName",
                COALESCE(sr.name, NULLIF(c.sales_representative, ''), '') AS "salesRepresentative",
                i.id AS "invoiceId", i.invoice_no AS "invoiceNo", i.cancelled
             FROM shipment_batch_orders bo
             INNER JOIN orders o ON o.id = bo.order_id
             INNER JOIN sales_invoices i ON i.id = bo.invoice_id
             INNER JOIN customer_cards c ON c.code = o.customer_code AND c.tenant_code = o.tenant_code
             LEFT JOIN LATERAL (
               SELECT a.sales_representative_id
               FROM sales_rep_customers a
               WHERE a.customer_code = c.code AND a.tenant_code = o.tenant_code AND a.active = TRUE
               ORDER BY a.created_at DESC, a.id DESC
               LIMIT 1
             ) assigned ON TRUE
             LEFT JOIN sales_representatives sr
               ON sr.id = COALESCE(o.sales_representative_id, assigned.sales_representative_id)
               AND sr.tenant_code = o.tenant_code
             WHERE bo.batch_id = ANY($1::bigint[])
             ORDER BY bo.batch_id DESC, o.order_date, o.id`,
            [batchIds],
          ),
        ])
      : [{ rows: [] }, { rows: [] }]
    const linesByBatch = new Map()
    for (const line of lines.rows) {
      const entries = linesByBatch.get(line.batchId) ?? []
      entries.push({
        ...line,
        quantity: Number(line.quantity),
        totalQuantity: Number(line.totalQuantity),
      })
      linesByBatch.set(line.batchId, entries)
    }
    const ordersByBatch = new Map()
    for (const order of orders.rows) {
      const entries = ordersByBatch.get(order.batchId) ?? []
      entries.push(order)
      ordersByBatch.set(order.batchId, entries)
    }
    return res.json(batches.rows.map((batch) => ({
      ...batch,
      id: Number(batch.id),
      shipmentDate: toApiValue(batch.shipmentDate),
      orderCount: Number(batch.orderCount),
      lines: linesByBatch.get(batch.id) ?? [],
      orders: ordersByBatch.get(batch.id) ?? [],
    })))
  } catch (error) {
    console.error('Shipment batches query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Sevkiyat listesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/sales-invoices/:id/print-preview', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const invoice = await client.query(
      `SELECT i.id, i.invoice_no AS "invoiceNo", i.invoice_date AS "invoiceDate",
         i.customer_code AS "customerCode", i.customer_name AS "customerName",
         i.sales_representative AS "salesRepresentative", i.sale_type AS "saleType",
         i.warehouse_code AS "warehouseCode", i.subtotal_amount AS subtotal,
         i.product_discount_amount AS "productDiscountAmount",
         i.customer_discount_amount AS "customerDiscountAmount",
         i.payment_discount_amount AS "paymentDiscountAmount",
         i.promotion_code AS "promotionCode", i.promotion_amount AS "promotionAmount",
         i.promotion_id AS "promotionId", i.promotions_declined AS "promotionsDeclined",
         i.discount_selection AS "discountSelection",
         i.net_amount AS "netAmount", i.tax_amount AS "taxAmount",
         i.total_amount AS "totalAmount", i.printed_at AS "printedAt",
         i.printed_by AS "printedBy", i.print_count AS "printCount",
         i.source_channel AS "sourceChannel", i.mobile_print_number AS "mobilePrintNumber",
         i.cancelled, c.address, c.tax_office AS "taxOffice", c.tax_no AS "taxNo",
         c.phone
       FROM sales_invoices i
       LEFT JOIN customer_cards c ON c.code = i.customer_code
         AND c.tenant_code IS NOT DISTINCT FROM i.tenant_code
       WHERE i.id = $1 AND ($2::text IS NULL OR i.tenant_code = $2)`,
      [Number(req.params.id), tenantCode],
    )
    if (!invoice.rowCount) return res.status(404).json({ error: 'Satış faturası bulunamadı.' })
    const lines = await client.query(
      `SELECT l.product_code AS "productCode", l.product_name AS "productName", l.unit,
         quantity, inner_quantity AS "innerQuantity", total_quantity AS "totalQuantity",
         l.unit_price AS "unitPrice", l.discount_1 AS "discount1", l.discount_2 AS "discount2",
         l.net_amount_snapshot AS "netAmount", l.vat_rate_snapshot AS "vatRate",
         l.tax_amount_snapshot AS "taxAmount", l.gross_amount_snapshot AS "grossAmount",
         l.is_promotional AS "isPromotional", l.promotion_code AS "promotionCode",
         l.price_source AS "priceSource", p.unit AS "baseUnit",
         reference_price.sales_price AS "referenceUnitPrice",
         COALESCE((SELECT json_agg(json_build_object('lotCode', a.lot_code, 'quantity', a.quantity, 'allocationType', a.allocation_type) ORDER BY a.id)
           FROM sales_invoice_line_lots a WHERE a.sales_invoice_line_id = l.id), '[]'::json) AS "lotAllocations"
       FROM sales_invoice_lines l
       LEFT JOIN factory_products p ON p.code = l.product_code
       LEFT JOIN product_prices reference_price ON reference_price.id = l.price_reference_id
         AND l.price_source = 'STANDARD'
       WHERE l.invoice_id = $1 ORDER BY l.id`,
      [Number(req.params.id)],
    )
    const editable = req.query.edit === 'true'
    return res.json({
      ...invoice.rows[0],
      invoiceDate: toApiValue(invoice.rows[0].invoiceDate),
      lines: editable ? lines.rows.map((line) => ({
        ...line,
        unitPrice: normalizeLegacyStandardUnitPrice(line),
      })) : lines.rows,
    })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fatura ön izlemesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.patch('/sales-invoices/printed/batch', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const invoices = await markSalesInvoicesPrinted({
      client,
      invoiceIds: req.body?.invoiceIds,
      startInvoiceNumber: req.body?.startInvoiceNumber,
      tenantCode,
      username: req.authenticatedUser?.username || req.header('x-vdesgo-username'),
      recordAudit, req,
    })
    await client.query('COMMIT')
    return res.json({ invoices })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Fatura numaralarından biri daha önce kullanılmış.' })
    }
    return res.status(error.statusCode || 400).json({ error: error.message || 'Toplu yazdırma durumu kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.patch('/sales-invoices/:id/printed', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const invoice = await markSalesInvoicePrinted({
      client,
      invoiceId: req.params.id,
      invoiceNumber: req.body?.invoiceNumber,
      confirmNumberChange: req.body?.confirmNumberChange,
      tenantCode,
      username: req.authenticatedUser?.username || req.header('x-vdesgo-username'),
      recordAudit,
      req,
    })
    await client.query('COMMIT')
    return res.json(invoice)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Fatura numarası daha önce kullanılmış.' })
    }
    return res.status(error.statusCode || 500).json({ error: error.message || 'Yazdırma durumu kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/promotion-reports/:report', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const report = String(req.params.report || '')
  const allowedReports = new Set(['usage-summary', 'invoice-detail', 'free-goods', 'customer-product', 'profitability'])
  if (!allowedReports.has(report)) return res.status(404).json({ error: 'Promosyon raporu bulunamadı.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.endDate || ''))
      ? String(req.query.endDate)
      : new Date().toISOString().slice(0, 10)
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.startDate || ''))
      ? String(req.query.startDate)
      : `${endDate.slice(0, 8)}01`
    const parameters = [startDate, endDate, tenantCode]
    let invoiceFilter = `
      i.invoice_date BETWEEN $1 AND $2
      AND i.cancelled IS NOT TRUE
      AND ($3::text IS NULL OR i.tenant_code = $3)`
    if (report === 'usage-summary' || report === 'invoice-detail') {
      const promotionIds = (Array.isArray(req.query.promotionId) ? req.query.promotionId : [req.query.promotionId])
        .filter((value) => /^\d+$/.test(String(value ?? '')))
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
      const representativeIds = (Array.isArray(req.query.representativeId) ? req.query.representativeId : [req.query.representativeId])
        .filter((value) => /^\d+$/.test(String(value ?? '')))
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value > 0)
      if (promotionIds.length) {
        parameters.push(promotionIds)
        invoiceFilter += ` AND i.promotion_id = ANY($${parameters.length}::int[])`
      }
      if (representativeIds.length) {
        parameters.push(representativeIds)
        invoiceFilter += ` AND i.sales_representative IN (
          SELECT name FROM sales_representatives
          WHERE id = ANY($${parameters.length}::int[])
            AND tenant_code IS NOT DISTINCT FROM $3)`
      }
    }
    const queries = {
      'usage-summary': `
        SELECT i.promotion_code AS "promotionCode",
          COALESCE(MAX(p.name), i.promotion_code) AS "promotionName",
          i.promotion_type AS "promotionType",
          COUNT(*)::int AS "invoiceCount",
          COUNT(DISTINCT i.customer_code)::int AS "customerCount",
          SUM(i.subtotal_amount)::numeric(14,2) AS "subtotal",
          SUM(i.promotion_amount)::numeric(14,2) AS "promotionAmount",
          SUM(i.total_amount)::numeric(14,2) AS "invoiceTotal"
        FROM sales_invoices i
        LEFT JOIN central_promotions p ON p.id = i.promotion_id
        WHERE ${invoiceFilter} AND i.promotion_id IS NOT NULL
        GROUP BY i.promotion_id, i.promotion_code, i.promotion_type
        ORDER BY SUM(i.promotion_amount) DESC, i.promotion_code`,
      'invoice-detail': `
        SELECT i.invoice_date AS "invoiceDate", i.invoice_no AS "invoiceNo",
          i.customer_code AS "customerCode", i.customer_name AS "customerName",
          i.sales_representative AS "salesRepresentative", i.source_channel AS "sourceChannel",
          i.promotion_code AS "promotionCode", i.promotion_type AS "promotionType",
          i.subtotal_amount AS "subtotal", i.promotion_amount AS "promotionAmount",
          i.tax_amount AS "taxAmount", i.total_amount AS "invoiceTotal"
        FROM sales_invoices i
        WHERE ${invoiceFilter} AND i.promotion_id IS NOT NULL
        ORDER BY i.invoice_date DESC, i.id DESC`,
      'free-goods': `
        SELECT i.invoice_date AS "invoiceDate", i.invoice_no AS "invoiceNo",
          i.customer_code AS "customerCode", i.customer_name AS "customerName",
          l.promotion_code AS "promotionCode", l.product_code AS "productCode",
          l.product_name AS "productName", l.unit, l.quantity,
          l.total_quantity AS "totalQuantity", l.promotion_amount AS "promotionValue"
        FROM sales_invoice_lines l
        INNER JOIN sales_invoices i ON i.id = l.invoice_id
        WHERE ${invoiceFilter} AND l.is_promotional = TRUE
        ORDER BY i.invoice_date DESC, i.id DESC, l.id`,
      'customer-product': `
        SELECT i.promotion_code AS "promotionCode", i.customer_code AS "customerCode",
          i.customer_name AS "customerName", l.product_code AS "productCode",
          l.product_name AS "productName", SUM(l.total_quantity) AS "totalQuantity",
          SUM(l.promotion_amount)::numeric(14,2) AS "promotionAmount",
          COUNT(DISTINCT i.id)::int AS "invoiceCount"
        FROM sales_invoice_lines l
        INNER JOIN sales_invoices i ON i.id = l.invoice_id
        WHERE ${invoiceFilter} AND l.promotion_id IS NOT NULL
        GROUP BY i.promotion_code, i.customer_code, i.customer_name, l.product_code, l.product_name
        ORDER BY SUM(l.promotion_amount) DESC, i.customer_code, l.product_code`,
      profitability: `
        WITH invoice_totals AS (
          SELECT i.promotion_id, i.promotion_code, MAX(p.name) AS promotion_name,
            COUNT(*)::int AS invoice_count, SUM(i.subtotal_amount) AS subtotal,
            SUM(i.promotion_amount) AS promotion_amount, SUM(i.total_amount) AS invoice_total
          FROM sales_invoices i
          LEFT JOIN central_promotions p ON p.id = i.promotion_id
          WHERE ${invoiceFilter} AND i.promotion_id IS NOT NULL
          GROUP BY i.promotion_id, i.promotion_code
        ), gift_totals AS (
          SELECT i.promotion_id, SUM(l.promotion_amount) AS free_goods_value
          FROM sales_invoice_lines l
          INNER JOIN sales_invoices i ON i.id = l.invoice_id
          WHERE ${invoiceFilter} AND l.is_promotional = TRUE
          GROUP BY i.promotion_id
        )
        SELECT t.promotion_code AS "promotionCode", t.promotion_name AS "promotionName",
          t.invoice_count AS "invoiceCount", t.subtotal::numeric(14,2) AS "subtotal",
          t.promotion_amount::numeric(14,2) AS "totalBenefit",
          COALESCE(g.free_goods_value, 0)::numeric(14,2) AS "freeGoodsCost",
          (t.promotion_amount - COALESCE(g.free_goods_value, 0))::numeric(14,2) AS "discountCost",
          t.invoice_total::numeric(14,2) AS "invoiceTotal"
        FROM invoice_totals t
        LEFT JOIN gift_totals g ON g.promotion_id = t.promotion_id
        ORDER BY t.promotion_amount DESC`,
    }
    const result = await client.query(queries[report], parameters)
    return res.json({ report, startDate, endDate, rows: result.rows })
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Promosyon raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.patch('/sales-invoices/:id/cancel', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const invoice = await client.query(
      `SELECT i.id, i.customer_code AS "customerCode", i.total_amount AS "totalAmount",
              i.cancelled, i.source_channel AS "sourceChannel", i.mobile_status AS "mobileStatus",
              i.transfer_code AS "transferCode", i.transfer_tenant_code AS "transferTenantCode"
       FROM sales_invoices i
       JOIN customer_cards c ON c.code = i.customer_code AND c.tenant_code = i.tenant_code
       WHERE i.id = $1 AND i.tenant_code = $2
       FOR UPDATE OF i`,
      [req.params.id, tenantCode],
    )
    if (!invoice.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Satış faturası bulunamadı.' })
    }

    const current = invoice.rows[0]
    if (current.transferCode) {
      const imported = await client.query(
        `SELECT id, cancelled FROM purchase_invoices
         WHERE source_transfer_code = $1 AND tenant_code = $2
         FOR UPDATE`,
        [current.transferCode, current.transferTenantCode],
      )
      if (imported.rowCount) {
        if (tenantCode !== 'F:MAIN' || req.authenticatedUser?.accountType !== 'factory') {
          throw Object.assign(new Error('Aktarılmış faturanın iptal talebini yalnızca Fabrika Merkez başlatabilir.'), { statusCode: 403 })
        }
        if (imported.rows[0].cancelled) {
          throw Object.assign(new Error('Distribütör alış faturası zaten iptal edilmiş.'), { statusCode: 409 })
        }
        const pending = await client.query(
          `SELECT id FROM factory_invoice_cancellation_requests
           WHERE sales_invoice_id = $1 AND status = 'pending' FOR UPDATE`,
          [current.id],
        )
        if (pending.rowCount) {
          await client.query('COMMIT')
          return res.status(202).json({ id: current.id, cancellationRequested: true, cancellationRequestId: pending.rows[0].id })
        }
        const cancellation = await client.query(
          `INSERT INTO factory_invoice_cancellation_requests
             (sales_invoice_id, purchase_invoice_id, factory_tenant_code, distributor_tenant_code, requested_by)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [current.id, imported.rows[0].id, tenantCode, current.transferTenantCode, req.header('x-vdesgo-username') || null],
        )
        await recordAudit(client, req, {
          entityType: 'factory_invoice_cancellation_request',
          entityId: cancellation.rows[0].id,
          action: 'requested',
          newValue: { salesInvoiceId: current.id, purchaseInvoiceId: imported.rows[0].id, distributorTenantCode: current.transferTenantCode },
        })
        await client.query('COMMIT')
        return res.status(202).json({ id: current.id, cancellationRequested: true, cancellationRequestId: cancellation.rows[0].id })
      }
    }
    const isFirstCancellation = current.cancelled !== true
    const mobileStatus = current.sourceChannel === 'MOBILE' ? 'CANCELLED' : current.mobileStatus
    await client.query(
      `UPDATE sales_invoices
       SET cancelled = TRUE, mobile_status = $2
       WHERE id = $1`,
      [current.id, mobileStatus],
    )

    if (isFirstCancellation) {
      await reverseSalesInvoiceCustomerBalance({
        client,
        customerCode: current.customerCode,
        totalAmount: current.totalAmount,
        tenantCode,
      })
    }

    if (isFirstCancellation || (current.sourceChannel === 'MOBILE' && current.mobileStatus !== 'CANCELLED')) {
      await recordAudit(client, req, {
        entityType: current.sourceChannel === 'MOBILE' ? 'mobile_sales_invoice' : 'sales_invoice',
        entityId: current.id,
        action: 'cancel',
        oldValue: { cancelled: current.cancelled, mobileStatus: current.mobileStatus },
        newValue: { cancelled: true, mobileStatus, balanceReversed: isFirstCancellation },
      })
    }

    await client.query('COMMIT')
    return res.json({ id: current.id, cancelled: true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Satış faturası iptal edilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.patch('/factory-invoice-cancellations/:id/decision', async (req, res) => {
  if (req.authenticatedUser?.accountType !== 'distributor') {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'İptal talebini yalnızca ilgili distribütör yanıtlayabilir.' })
  }
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const decision = req.body?.decision
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ error: 'Onay veya ret kararı belirtilmelidir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (!tenantCode?.startsWith('D:')) throw Object.assign(new Error('Distribütör hesabı gerekli.'), { statusCode: 403 })
    const requestInfo = await client.query(
      `SELECT sales_invoice_id AS "salesInvoiceId", purchase_invoice_id AS "purchaseInvoiceId",
              factory_tenant_code AS "factoryTenantCode"
       FROM factory_invoice_cancellation_requests
       WHERE id = $1 AND distributor_tenant_code = $2`,
      [req.params.id, tenantCode],
    )
    if (!requestInfo.rowCount) throw Object.assign(new Error('İptal talebi bulunamadı.'), { statusCode: 404 })

    const requestSeed = requestInfo.rows[0]
    const salesInvoice = await client.query(
      `SELECT id, customer_code AS "customerCode", total_amount AS "totalAmount",
              tenant_code AS "tenantCode", cancelled, source_channel AS "sourceChannel", mobile_status AS "mobileStatus"
       FROM sales_invoices WHERE id = $1 AND tenant_code = $2 FOR UPDATE`,
      [requestSeed.salesInvoiceId, requestSeed.factoryTenantCode],
    )
    const purchaseInvoice = await client.query(
      `SELECT id, customer_code AS "customerCode", total_amount AS "totalAmount",
              warehouse_code AS "warehouseCode", stock_entry_id AS "stockEntryId",
              source_factory_sales_invoice_id AS "sourceFactorySalesInvoiceId", cancelled
       FROM purchase_invoices WHERE id = $1 AND tenant_code = $2 FOR UPDATE`,
      [requestSeed.purchaseInvoiceId, tenantCode],
    )
    const cancellation = await client.query(
      `SELECT id, status FROM factory_invoice_cancellation_requests
       WHERE id = $1 AND distributor_tenant_code = $2 FOR UPDATE`,
      [req.params.id, tenantCode],
    )
    if (!purchaseInvoice.rowCount || !salesInvoice.rowCount || !cancellation.rowCount) {
      throw Object.assign(new Error('Faturaya bağlı iptal talebi bulunamadı.'), { statusCode: 404 })
    }
    const sales = salesInvoice.rows[0]
    const purchase = purchaseInvoice.rows[0]
    if (cancellation.rows[0].status !== 'pending') {
      throw Object.assign(new Error('Bu iptal talebi daha önce yanıtlanmış.'), { statusCode: 409 })
    }
    if (sales.cancelled || purchase.cancelled || String(purchase.sourceFactorySalesInvoiceId) !== String(sales.id)) {
      throw Object.assign(new Error('Fatura durumu değişmiş; iptal talebi uygulanamıyor.'), { statusCode: 409 })
    }

    if (decision === 'reject') {
      await client.query(
        `UPDATE factory_invoice_cancellation_requests
         SET status = 'rejected', responded_by = $2, responded_at = NOW()
         WHERE id = $1`,
        [req.params.id, req.header('x-vdesgo-username') || null],
      )
      await recordAudit(client, req, {
        entityType: 'factory_invoice_cancellation_request',
        entityId: req.params.id,
        action: 'rejected',
        newValue: { salesInvoiceId: sales.id, purchaseInvoiceId: purchase.id },
      })
      await client.query('COMMIT')
      return res.json({ id: Number(req.params.id), status: 'rejected', cancelled: false })
    }

    if (!purchase.stockEntryId) throw Object.assign(new Error('Alış faturasının stok giriş kaydı bulunamadı.'), { statusCode: 409 })
    const stockLines = await client.query(
      `SELECT product_code AS "productCode", product_name AS "productName", unit,
              inner_quantity AS "innerQuantity", quantity, total_quantity AS "totalQuantity"
       FROM other_stock_entry_lines WHERE entry_id = $1 ORDER BY id FOR SHARE`,
      [purchase.stockEntryId],
    )
    if (!stockLines.rowCount) throw Object.assign(new Error('Alış faturasının stok hareket satırları bulunamadı.'), { statusCode: 409 })
    const requiredByProduct = new Map()
    for (const line of stockLines.rows) {
      const quantity = Number(line.totalQuantity)
      if (!Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error('Stok hareketinde geçersiz miktar var.'), { statusCode: 409 })
      requiredByProduct.set(line.productCode, (requiredByProduct.get(line.productCode) || 0) + quantity)
    }
    for (const [productCode, requiredQuantity] of requiredByProduct) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-cancel-stock:${tenantCode}:${purchase.warehouseCode}:${productCode}`])
      const stock = await availableStock(client, purchase.warehouseCode, productCode, tenantCode)
      if (stock + 1e-9 < requiredQuantity) {
        throw Object.assign(new Error(`${productCode} ürününde yeterli kullanılabilir stok yok; iptal onayı verilemedi.`), { statusCode: 409 })
      }
    }

    const supplierOwnership = await client.query(
      `SELECT 1 FROM distributor_factory_supplier_cards
       WHERE tenant_code = $1 AND customer_code = $2
       UNION ALL
       SELECT 1 FROM customer_cards
       WHERE tenant_code = $1 AND code = $2 AND is_factory_card = TRUE
         AND factory_card_source IS NOT NULL AND active IS TRUE
       LIMIT 1`,
      [tenantCode, purchase.customerCode],
    )
    if (!supplierOwnership.rowCount) throw Object.assign(new Error('Fabrika tedarikçi carisi doğrulanamadı.'), { statusCode: 409 })

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-cancel-stock-receipt:${tenantCode}`])
    const nextReceipt = await client.query(
      `SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber"
       FROM other_stock_exits WHERE tenant_code IS NOT DISTINCT FROM $1`,
      [tenantCode],
    )
    const stockExit = await client.query(
      `INSERT INTO other_stock_exits
         (receipt_no, exit_date, exiting_warehouse_code, tenant_code, created_by)
       VALUES ($1,CURRENT_DATE,$2,$3,$4) RETURNING id`,
      [nextReceipt.rows[0].nextNumber, purchase.warehouseCode, tenantCode, req.header('x-vdesgo-username') || null],
    )
    for (const line of stockLines.rows) {
      await client.query(
        `INSERT INTO other_stock_exit_lines
           (exit_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [stockExit.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity],
      )
    }

    await reverseSalesInvoiceCustomerBalance({
      client,
      customerCode: sales.customerCode,
      totalAmount: sales.totalAmount,
      tenantCode: sales.tenantCode,
    })
    const supplierBalance = await client.query(
      `UPDATE customer_cards SET balance = balance + $1::numeric
       WHERE code = $2 AND tenant_code = $3 RETURNING balance`,
      [purchase.totalAmount, purchase.customerCode, tenantCode],
    )
    if (!supplierBalance.rowCount) throw new Error('Distribütör fabrika tedarikçi carisi güncellenemedi.')
    await client.query(
      `UPDATE sales_invoices SET cancelled = TRUE,
         mobile_status = CASE WHEN source_channel = 'MOBILE' THEN 'CANCELLED' ELSE mobile_status END
       WHERE id = $1 AND tenant_code = $2`,
      [sales.id, sales.tenantCode],
    )
    await client.query('UPDATE purchase_invoices SET cancelled = TRUE WHERE id = $1 AND tenant_code = $2', [purchase.id, tenantCode])
    await client.query(
      `UPDATE factory_invoice_cancellation_requests
       SET status = 'approved', responded_by = $2, responded_at = NOW(), stock_reversal_exit_id = $3
       WHERE id = $1`,
      [req.params.id, req.header('x-vdesgo-username') || null, stockExit.rows[0].id],
    )
    await recordAudit(client, req, {
      entityType: 'factory_invoice_cancellation_request',
      entityId: req.params.id,
      action: 'approved',
      newValue: { salesInvoiceId: sales.id, purchaseInvoiceId: purchase.id, stockReversalExitId: stockExit.rows[0].id },
    })
    await client.query('COMMIT')
    return res.json({ id: Number(req.params.id), status: 'approved', cancelled: true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'İptal talebi yanıtlanamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

const erpSalesPricingPayload = (body, { autoApplyMandatoryPromotions = true } = {}) => ({
  customerCode: body?.customerCode,
  priceRevision: '0',
  promotionRevision: '0',
  discountSelection: body?.discountSelection ?? {},
  selectedPromotionId: body?.selectedPromotionId ?? null,
  selectedRewardProductCode: body?.selectedRewardProductCode ?? null,
  selectedRewardProductCodes: body?.selectedRewardProductCodes ?? null,
  skipPromotions: body?.skipPromotions === true,
  requirePromotionSelection: true,
  autoApplyMandatoryPromotions,
  lines: Array.isArray(body?.lines)
    ? body.lines.filter((line) => line?.isPromotional !== true).map((line) => ({
        productCode: line.productCode,
        unitCode: line.unitCode ?? line.unit,
        quantity: line.quantity,
        discount1Percent: line.discount1Percent ?? line.discount1 ?? 0,
        discount2Percent: line.discount2Percent ?? line.discount2 ?? 0,
      }))
    : [],
})

const evaluateErpSalesInvoice = async (client, req, body) => {
  let tenantCode = await getRequestTenant(client, req)
  if (tenantCode == null && typeof body?.customerCode === 'string' && body.customerCode.trim()) {
    const customerTenant = await client.query(
      `SELECT tenant_code AS "tenantCode" FROM customer_cards
       WHERE code = $1 AND active = TRUE
       ORDER BY tenant_code NULLS LAST
       LIMIT 1`,
      [body.customerCode],
    )
    tenantCode = customerTenant.rows[0]?.tenantCode ?? null
  }
  const evaluation = await evaluateOrderSubmission({
    client,
    context: { tenantCode, salesRepresentativeId: null, accountType: req.authenticatedUser?.accountType },
    payload: erpSalesPricingPayload(body, {
      autoApplyMandatoryPromotions: req.authenticatedUser?.accountType !== 'factory',
    }),
    centralOnly: false,
    requireDiscountApproval: false,
    requireAssignedCustomer: false,
    enforceRevision: false,
    maximumManualDiscountPercent: 100,
  })
  return { tenantCode, evaluation }
}

app.post('/sales-invoices/quote', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const { evaluation } = await evaluateErpSalesInvoice(client, req, req.body ?? {})
    return res.status(evaluation.status === 'rejected' ? 400 : 200).json(evaluation)
  } catch (error) {
    return res.status(error.statusCode || 400).json({ error: error.message || 'Promosyon hesaplanamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/sales-invoices', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const {
    invoiceDate, customerCode, customerName, salesRepresentative,
    saleType, warehouseCode, lines,
  } = req.body ?? {}
  if (!invoiceDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const migration = await client.query(
      `SELECT 1 FROM mobile_backend_migrations WHERE name = '014-sales-invoice-promotions'`,
    )
    if (!migration.rowCount) throw new Error('Satış faturası promosyon migration’ı uygulanmalıdır.')

    const { tenantCode, evaluation } = await evaluateErpSalesInvoice(client, req, req.body ?? {})
    if (evaluation.status !== 'accepted') {
      await client.query('ROLLBACK')
      return res.status(409).json(evaluation)
    }
    const hasManualLotSelection = lines.some((line) => normalizeLotCode(line?.productionLotCode))
    if (tenantCode === 'F:MAIN' && hasManualLotSelection && !hasFactoryPermission(
      req.authenticatedUser?.role, req.authenticatedUser?.rolePermissions, 'WarehouseOperationsList', 'edit',
    )) {
      throw Object.assign(new Error('Lot seçimini elle değiştirmek için depo işlemleri düzenleme yetkisi gereklidir.'), { statusCode: 403 })
    }
    const priced = evaluation.result
    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND active = TRUE
         AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)
       FOR UPDATE`,
      [warehouseCode, tenantCode],
    )
    if (!warehouse.rowCount) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query(
      `SELECT balance FROM customer_cards
       WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)
       FOR UPDATE`,
      [customerCode, tenantCode],
    )
    if (!customer.rowCount) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    await assertCustomerCredit(client, { customerCode, tenantCode, amount: priced.grandTotal })

    const requiredByProduct = new Map()
    for (const line of priced.lines) {
      const quantity = Number(line.totalQuantity)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün miktarı.')
      requiredByProduct.set(line.productCode, (requiredByProduct.get(line.productCode) ?? 0) + quantity)
    }
    const factoryStockByProduct = new Map()
    for (const [productCode, requiredQuantity] of requiredByProduct) {
      const stock = await availableStock(
        client,
        warehouseCode,
        productCode,
        tenantCode,
      )
      if (stock + 1e-9 < requiredQuantity) {
        throw new Error(`${productCode} için yeterli depo stoğu yok.`)
      }
      factoryStockByProduct.set(productCode, stock)
    }

    const invoice = await client.query(
      `INSERT INTO sales_invoices
         (invoice_no, invoice_date, customer_code, customer_name, sales_representative,
          sale_type, warehouse_code, total_amount, created_by, tenant_code, source_channel,
          promotion_id, promotion_code, promotion_type, promotion_amount, promotions_declined,
          subtotal_amount, product_discount_amount, customer_discount_amount,
          payment_discount_amount, net_amount, tax_amount, discount_selection)
       VALUES (NULL,$1,$2,$3,$4,$5,$6,$7,$8,$9,'ERP',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id, invoice_no AS "invoiceNo"`,
      [
        invoiceDate, customerCode, customerName || '',
        salesRepresentative || '', saleType || null, warehouseCode, priced.grandTotal,
        req.header('x-vdesgo-username') || null, tenantCode, priced.selectedPromotionId,
        priced.promotionCode, priced.promotionType, priced.promotionTotal,
        priced.promotionSkipped === true, priced.subtotal, priced.productDiscountTotal,
        priced.customerDiscountTotal, priced.paymentDiscountTotal, priced.netTotal,
        priced.taxTotal,
        req.body?.discountSelection ?? {},
      ],
    )
    await insertInvoiceLines(client, invoice.rows[0].id, priced.lines)
    if (tenantCode === 'F:MAIN') {
      await allocateFactoryInvoiceLots({
        client, invoiceId: invoice.rows[0].id, warehouseCode, inputLines: lines,
        pricedLines: priced.lines, stockByProduct: factoryStockByProduct,
        approvedExpiredLots: Array.isArray(req.body?.approvedExpiredLots) ? req.body.approvedExpiredLots : [],
      })
    }
    const transferCode = tenantCode === 'F:MAIN'
      ? await createFactoryInvoiceTransferCode(client, invoice.rows[0].id, customerCode)
      : null
    const nextBalance = parseMoneyNumber(customer.rows[0].balance) + Number(priced.grandTotal)
    await client.query(
      `UPDATE customer_cards SET balance = $1
       WHERE code = $2 AND tenant_code IS NOT DISTINCT FROM $3`,
      [nextBalance, customerCode, tenantCode],
    )
    await recordAudit(client, req, {
      entityType: 'sales_invoice',
      entityId: invoice.rows[0].id,
      action: 'create',
      newValue: {
        ...invoice.rows[0],
        customerCode,
        warehouseCode,
        totalAmount: priced.grandTotal,
        promotionCode: priced.promotionCode,
        promotionAmount: priced.promotionTotal,
        transferCode,
      },
    })
    await client.query('COMMIT')
    return res.status(201).json({
      ...invoice.rows[0],
      customerCode,
      salesRepresentative,
      saleType,
      totalAmount: priced.grandTotal,
      transferCode,
      pricing: priced,
    })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Satış faturası kaydedilemedi.', code: error.code, expiredLot: error.expiredLot })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/sales-invoices/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const {
    invoiceNo, invoiceDate, customerCode, salesRepresentative,
    saleType, warehouseCode, lines,
  } = req.body ?? {}
  if (!invoiceDate || !customerCode || !warehouseCode || !Array.isArray(lines) || !lines.length) {
    return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const requestTenant = await getRequestTenant(client, req)
    const currentResult = await client.query(
      `SELECT id, invoice_no AS "invoiceNo", customer_code AS "customerCode",
         total_amount AS "totalAmount", tenant_code AS "tenantCode", printed_at AS "printedAt",
         cancelled, transfer_code AS "transferCode",
         transfer_tenant_code AS "transferTenantCode"
       FROM sales_invoices
       WHERE id = $1 AND ($2::text IS NULL OR tenant_code = $2)
       FOR UPDATE`,
      [Number(req.params.id), requestTenant],
    )
    if (!currentResult.rowCount) throw new Error('Satış faturası bulunamadı.')
    const current = currentResult.rows[0]
    if (current.cancelled === true) throw new Error('İptal edilmiş fatura düzenlenemez.')
    if (current.printedAt != null) throw new Error('Yazdırılmış fatura düzenlenemez.')
    if (current.transferTenantCode && current.transferTenantCode !== `D:${customerCode}`) {
      throw Object.assign(new Error('Aktarım kodu oluşturulmuş fatura başka bir cariye taşınamaz.'), { statusCode: 409 })
    }
    if (current.transferCode) {
      const imported = await client.query(
        'SELECT 1 FROM purchase_invoices WHERE source_transfer_code = $1',
        [current.transferCode],
      )
      if (imported.rowCount) {
        throw Object.assign(new Error('Distribütör tarafından alınmış fatura düzenlenemez.'), { statusCode: 409 })
      }
    }

    const { tenantCode, evaluation } = await evaluateErpSalesInvoice(client, req, req.body ?? {})
    if (evaluation.status !== 'accepted') {
      await client.query('ROLLBACK')
      return res.status(409).json(evaluation)
    }
    if (tenantCode !== current.tenantCode) throw new Error('Fatura farklı bir distribütöre taşınamaz.')
    const hasManualLotSelection = lines.some((line) => normalizeLotCode(line?.productionLotCode))
    if (tenantCode === 'F:MAIN' && hasManualLotSelection && !hasFactoryPermission(
      req.authenticatedUser?.role, req.authenticatedUser?.rolePermissions, 'WarehouseOperationsList', 'edit',
    )) {
      throw Object.assign(new Error('Lot seçimini elle değiştirmek için depo işlemleri düzenleme yetkisi gereklidir.'), { statusCode: 403 })
    }
    const priced = evaluation.result
    const warehouse = await client.query(
      `SELECT 1 FROM factory_warehouses
       WHERE code = $1 AND active = TRUE
         AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)
       FOR UPDATE`,
      [warehouseCode, tenantCode],
    )
    if (!warehouse.rowCount) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')

    const requiredByProduct = new Map()
    for (const line of priced.lines) {
      const quantity = Number(line.totalQuantity)
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün miktarı.')
      requiredByProduct.set(line.productCode, (requiredByProduct.get(line.productCode) ?? 0) + quantity)
    }
    const factoryStockByProduct = new Map()
    for (const [productCode, requiredQuantity] of requiredByProduct) {
      const stock = await availableStock(client, warehouseCode, productCode, tenantCode, current.id)
      if (stock + 1e-9 < requiredQuantity) {
        throw new Error(`${productCode} için yeterli depo stoğu yok.`)
      }
      factoryStockByProduct.set(productCode, stock)
    }

    const customerCodes = [...new Set([current.customerCode, customerCode])].sort()
    const customers = await client.query(
      `SELECT code, name, title, balance FROM customer_cards
       WHERE code = ANY($1::text[]) AND tenant_code IS NOT DISTINCT FROM $2
       ORDER BY code FOR UPDATE`,
      [customerCodes, tenantCode],
    )
    const oldCustomer = customers.rows.find((row) => row.code === current.customerCode)
    const newCustomer = customers.rows.find((row) => row.code === customerCode)
    if (!oldCustomer || !newCustomer) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const resolvedCustomerName = newCustomer.title || newCustomer.name || customerCode
    await assertCustomerCredit(client, {
      customerCode, tenantCode, amount: priced.grandTotal,
      replacedInvoiceAmount: current.customerCode === customerCode ? current.totalAmount : 0,
    })

    await client.query(
      `UPDATE sales_invoices SET
         invoice_no = NULL, invoice_date = $1, customer_code = $2, customer_name = $3,
         sales_representative = $4, sale_type = $5, warehouse_code = $6, total_amount = $7,
         promotion_id = $8, promotion_code = $9, promotion_type = $10,
         promotion_amount = $11, promotions_declined = $12, subtotal_amount = $13,
         product_discount_amount = $14, customer_discount_amount = $15,
         payment_discount_amount = $16, net_amount = $17, tax_amount = $18,
         discount_selection = $19
       WHERE id = $20`,
      [
        invoiceDate, customerCode, resolvedCustomerName,
        salesRepresentative || '', saleType || null, warehouseCode, priced.grandTotal,
        priced.selectedPromotionId, priced.promotionCode, priced.promotionType,
        priced.promotionTotal, priced.promotionSkipped === true, priced.subtotal,
        priced.productDiscountTotal, priced.customerDiscountTotal,
        priced.paymentDiscountTotal, priced.netTotal, priced.taxTotal,
        req.body?.discountSelection ?? {}, current.id,
      ],
    )
    await client.query('DELETE FROM sales_invoice_lines WHERE invoice_id = $1', [current.id])
    await insertInvoiceLines(client, current.id, priced.lines)
    if (tenantCode === 'F:MAIN') {
      await allocateFactoryInvoiceLots({
        client, invoiceId: current.id, warehouseCode, inputLines: lines, pricedLines: priced.lines,
        stockByProduct: factoryStockByProduct, excludeInvoiceId: current.id,
        approvedExpiredLots: Array.isArray(req.body?.approvedExpiredLots) ? req.body.approvedExpiredLots : [],
      })
    }
    const transferCode = current.transferCode || (tenantCode === 'F:MAIN'
      ? await createFactoryInvoiceTransferCode(client, current.id, customerCode)
      : null)

    if (current.customerCode === customerCode) {
      await client.query(
        `UPDATE customer_cards SET balance = balance + $1
         WHERE code = $2 AND tenant_code IS NOT DISTINCT FROM $3`,
        [Number(priced.grandTotal) - Number(current.totalAmount), customerCode, tenantCode],
      )
    } else {
      await client.query(
        `UPDATE customer_cards SET balance = balance - $1
         WHERE code = $2 AND tenant_code IS NOT DISTINCT FROM $3`,
        [Number(current.totalAmount), current.customerCode, tenantCode],
      )
      await client.query(
        `UPDATE customer_cards SET balance = balance + $1
         WHERE code = $2 AND tenant_code IS NOT DISTINCT FROM $3`,
        [Number(priced.grandTotal), customerCode, tenantCode],
      )
    }
    await recordAudit(client, req, {
      entityType: 'sales_invoice',
      entityId: current.id,
      action: 'update',
      oldValue: current,
      newValue: {
        invoiceNo: null,
        customerCode,
        warehouseCode,
        totalAmount: priced.grandTotal,
        promotionCode: priced.promotionCode,
        transferCode,
      },
    })
    await client.query('COMMIT')
    return res.json({
      id: current.id,
      invoiceNo: null,
      customerCode,
      customerName: resolvedCustomerName,
      saleType,
      totalAmount: priced.grandTotal,
      transferCode,
      pricing: priced,
    })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Satış faturası güncellenemedi.', code: error.code, expiredLot: error.expiredLot })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/orders', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { orderNo, orderDate, customerCode, warehouseCode, totalAmount, stockReserved, lines } = req.body ?? {}
  if (!orderDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  const numericTotal = parseMoneyNumber(totalAmount)
  try {
    await client.connect(); await client.query('BEGIN')
    validateOrderTotal(lines, numericTotal)
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query(
      'SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)',
      [warehouseCode, tenantCode],
    )
    if (warehouse.rowCount === 0) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query('SELECT code, tenant_code FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [customerCode, tenantCode])
    if (customer.rowCount === 0) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    await assertCustomerCredit(client, {
      customerCode, tenantCode: customer.rows[0].tenant_code,
      amount: numericTotal,
    })
    const order = await client.query(
      `INSERT INTO orders
       (order_no, order_date, customer_code, warehouse_code, total_amount, stock_reserved,
        tenant_code, created_by, promotion_total_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, order_no AS "orderNo"`,
      [orderNo || null, orderDate, customerCode, warehouseCode, numericTotal, stockReserved === true,
        tenantCode, req.header('x-vdesgo-username') || null, Math.max(0, Number(req.body?.promotionTotal) || 0)],
    )
    for (const line of lines) {
      const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
      const promotionId = Number(line.promotionId ?? req.body?.selectedPromotionId)
      await client.query(
        `INSERT INTO order_lines
         (order_id, product_code, product_name, unit, quantity, inner_quantity, total_quantity,
          unit_price, line_total, price_source, promotion_id, promotion_amount,
          vat_rate_snapshot, tax_amount_snapshot, net_amount_snapshot, gross_amount_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [order.rows[0].id, line.productCode, line.productName, line.unit, Number(line.quantity),
          Number(line.innerQuantity || 1), totalQuantity, Number(line.unitPrice || 0),
          Number(line.lineTotal || 0), line.isPromotional === true ? 'PROMOTION_FREE_GOODS' : null,
          Number.isSafeInteger(promotionId) && promotionId > 0 ? promotionId : null,
          Math.max(0, Number(line.promotionAmount) || 0), Number(line.vatRate || 0),
          Math.max(0, Number(line.netAmount) * Number(line.vatRate || 0) / 100),
          Math.max(0, Number(line.netAmount) || 0),
          Math.max(0, Number(line.netAmount) * (1 + Number(line.vatRate || 0) / 100))],
      )
    }
    if (stockReserved === true) {
      const { requiredByProduct } = aggregateOrderLines([{
        orderNo,
        lines: lines.map((line) => ({ ...line, totalQuantity: Number(line.quantity) * Number(line.innerQuantity || 1) })),
      }])
      for (const [productCode, totalQuantity] of requiredByProduct) {
        const stock = await availableStock(client, warehouseCode, productCode, tenantCode)
        if (!Number.isFinite(stock) || stock < totalQuantity) throw new Error(`${productCode} için yeterli stok bulunmuyor. Mevcut: ${stock}, İstenilen: ${totalQuantity}`)
      }
      const nextReceipt = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_exits WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
      const exit = await client.query('INSERT INTO other_stock_exits (receipt_no, exit_date, exiting_warehouse_code, tenant_code, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nextReceipt.rows[0].nextNumber, orderDate, warehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
      await client.query('UPDATE orders SET reservation_exit_id = $1 WHERE id = $2', [exit.rows[0].id, order.rows[0].id])
      for (const line of lines) {
        const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
        await client.query('INSERT INTO other_stock_exit_lines (exit_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7)', [exit.rows[0].id, line.productCode, line.productName, line.unit, Number(line.innerQuantity || 1), Number(line.quantity), totalQuantity])
      }
    }
    await recordAudit(client, req, { entityType: 'order', entityId: order.rows[0].id, action: 'create', newValue: { ...order.rows[0], customerCode, warehouseCode, totalAmount: numericTotal, stockReserved: stockReserved === true } })
    await client.query('COMMIT')
    return res.status(201).json({ ...order.rows[0], customerCode, warehouseCode, totalAmount: numericTotal, stockReserved: stockReserved === true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Sipariş kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz sipariş kimliği.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const order = await loadErpOrder(client, Number(req.params.id), tenantCode)
    const lines = await client.query(
      `SELECT l.product_code AS "productCode", l.product_name AS "productName", l.unit,
         l.quantity, l.inner_quantity AS "innerQuantity", l.unit_price AS "unitPrice",
         l.net_amount_snapshot AS "netAmount", l.line_total AS "lineTotal",
         l.promotion_id AS "promotionId", l.promotion_amount AS "promotionAmount",
         l.price_source AS "priceSource", p.unit AS "baseUnit",
         reference_price.sales_price AS "referenceUnitPrice",
         COALESCE(l.price_source = 'PROMOTION_FREE_GOODS', FALSE) AS "isPromotional",
         COALESCE(l.vat_rate_snapshot, NULLIF(REPLACE(REPLACE(p.vat, '%', ''), ',', '.'), '')::numeric, 0) AS "vatRate"
       FROM order_lines l LEFT JOIN factory_products p ON p.code = l.product_code
       LEFT JOIN product_prices reference_price ON reference_price.id = l.price_reference_id
         AND l.price_source = 'STANDARD'
       WHERE l.order_id = $1 ORDER BY l.id`,
      [order.id],
    )
    return res.json({ ...order, lines: orderEditLines(lines.rows, order.totalAmount) })
  } catch (error) {
    console.error('Order edit details failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Sipariş bilgileri alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Order connection cleanup failed:', error)) }
})

app.put('/orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz sipariş kimliği.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const saved = await replaceErpOrder({
      client, id: Number(req.params.id), tenantCode, payload: req.body ?? {},
      username: req.header('x-vdesgo-username') || null,
    })
    await recordAudit(client, req, { entityType: 'order', entityId: saved.id, action: 'update', newValue: saved })
    await client.query('COMMIT')
    return res.json(saved)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Order update rollback failed:', rollbackError))
    console.error('Order update failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Sipariş güncellenemedi.' })
  } finally { await client.end().catch((error) => console.error('Order connection cleanup failed:', error)) }
})

app.get('/return-invoices/:id/print-preview', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz iade faturası numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query(
      `SELECT r.id, r.invoice_no AS "invoiceNo", to_char(r.invoice_date, 'YYYY-MM-DD') AS "invoiceDate",
         r.customer_code AS "customerCode", r.customer_name AS "customerName",
         r.warehouse_code AS "warehouseCode", r.total_amount AS "totalAmount", r.return_type AS "returnType",
         c.address AS "customerAddress", c.tax_office AS "customerTaxOffice", c.tax_no AS "customerTaxNo", c.phone AS "customerPhone",
         COALESCE(NULLIF(fc.title, ''), fc.name, 'VD GIDA') AS "issuerName", fc.address AS "issuerAddress",
         fc.tax_office AS "issuerTaxOffice", fc.tax_no AS "issuerTaxNo",
         sr.invoice_no AS "sourceInvoiceNo", to_char(sr.invoice_date, 'YYYY-MM-DD') AS "sourceInvoiceDate",
         sr.invoice_details AS "invoiceDetails", sr.lines AS "sourceLines"
       FROM return_invoices r
       LEFT JOIN customer_cards c ON c.code = r.customer_code AND c.tenant_code IS NOT DISTINCT FROM r.tenant_code
       LEFT JOIN supplier_return_invoices sr ON sr.factory_invoice_id = r.id AND sr.status = 'Onaylandı'
       LEFT JOIN customer_cards fc ON fc.code = sr.factory_card_code AND fc.tenant_code = 'F:MAIN'
       WHERE r.id = $1 AND ($2::text IS NULL OR r.tenant_code IS NOT DISTINCT FROM $2)`,
      [Number(req.params.id), tenantCode],
    )
    if (!result.rowCount) return res.status(404).json({ error: 'İade faturası bulunamadı.' })
    const invoice = result.rows[0]
    let lines = Array.isArray(invoice.sourceLines) ? invoice.sourceLines : []
    if (lines.length === 0) {
      const lineResult = await client.query(
        `SELECT product_code AS "productCode", product_name AS "productName", unit, quantity,
           inner_quantity AS "innerQuantity", total_quantity AS "totalQuantity", unit_price AS "unitPrice",
           line_total AS "lineTotal"
         FROM return_invoice_lines WHERE invoice_id = $1 ORDER BY id`,
        [Number(req.params.id)],
      )
      lines = lineResult.rows.map((line) => ({
        ...line, netAmount: line.lineTotal, taxAmount: null, vatRate: null, discount1: 0, discount2: 0,
        grossAmount: line.lineTotal,
      }))
    } else {
      lines = lines.map((line) => ({
        ...line,
        grossAmount: line.lineTotal,
      }))
    }
    return res.json({ ...invoice, lines })
  } catch (error) {
    console.error('Return invoice print preview failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'İade faturası ön izlemesi alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Return invoice connection cleanup failed:', error)) }
})

app.delete('/orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const order = await client.query('SELECT id, reservation_exit_id, source_factory_order_id FROM orders WHERE id = $1 AND tenant_code IS NOT DISTINCT FROM $2 FOR UPDATE', [req.params.id, tenantCode])
    if (!order.rowCount) throw new Error('Sipariş bulunamadı.')
    await assertOrderNotInvoiced(client, order.rows[0].id)
    if (order.rows[0].source_factory_order_id != null) {
      throw Object.assign(new Error('Distribütör kaynaklı fabrika siparişi yalnızca kendi sipariş takibinden silinebilir.'), { statusCode: 409 })
    }
    if (order.rows[0].reservation_exit_id) await client.query('DELETE FROM other_stock_exits WHERE id = $1', [order.rows[0].reservation_exit_id])
    await client.query('DELETE FROM orders WHERE id = $1', [req.params.id])
    await recordAudit(client, req, {
      entityType: 'order',
      entityId: order.rows[0].id,
      action: 'delete',
      oldValue: order.rows[0],
    })
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Sipariş silinemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

const parseAccountBalance = (value) => parseMoneyNumber(value)
const formatAccountBalance = (value) => formatMoney(value)

const createInboundInvoice = async (req, res, config) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { invoiceNo, invoiceDate, customerCode, customerName, warehouseCode, totalAmount, lines, returnType } = req.body ?? {}
  if (!invoiceDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  const numericTotal = parseMoneyNumber(totalAmount)
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    let resolvedCustomerCode = customerCode
    let resolvedCustomerName = customerName || ''
    if (config.factorySupplier && tenantCode?.startsWith('D:')) {
      const factoryCustomer = await resolveFactoryCustomerCard(client, resourceDefinitions.customers, tenantCode)
      resolvedCustomerCode = factoryCustomer.code
      resolvedCustomerName = factoryCustomer.title || factoryCustomer.name
    }
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)', [warehouseCode, tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query('SELECT balance FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [resolvedCustomerCode, tenantCode])
    if (!customer.rowCount) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const header = config.includeReturnType
      ? await client.query(`INSERT INTO ${config.table} (invoice_no, invoice_date, customer_code, customer_name, warehouse_code, total_amount, return_type, created_by, tenant_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, invoice_no AS "invoiceNo"`, [invoiceNo || null, invoiceDate, resolvedCustomerCode, resolvedCustomerName, warehouseCode, numericTotal, returnType === 'Bozuk' ? 'Bozuk' : 'Sağlam', req.header('x-vdesgo-username') || null, tenantCode])
      : await client.query(`INSERT INTO ${config.table} (invoice_no, invoice_date, customer_code, customer_name, warehouse_code, total_amount, created_by, tenant_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, invoice_no AS "invoiceNo"`, [invoiceNo || null, invoiceDate, resolvedCustomerCode, resolvedCustomerName, warehouseCode, numericTotal, req.header('x-vdesgo-username') || null, tenantCode])
    for (const line of lines) {
      const quantity = Number(line.quantity)
      const innerQuantity = Number(line.innerQuantity || 1)
      if (!line.productCode || !line.productName || !line.unit || quantity <= 0 || innerQuantity <= 0) throw new Error('Geçersiz ürün satırı.')
      await client.query(`INSERT INTO ${config.lineTable} (invoice_id, product_code, product_name, unit, quantity, inner_quantity, total_quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [header.rows[0].id, line.productCode, line.productName, line.unit, quantity, innerQuantity, quantity * innerQuantity, Number(line.unitPrice || 0), Number(line.lineTotal || 0)])
    }
    const nextReceipt = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_entries WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    const entry = await client.query('INSERT INTO other_stock_entries (receipt_no, entry_date, entering_warehouse_code, entry_type, tenant_code, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [nextReceipt.rows[0].nextNumber, invoiceDate, warehouseCode, config.entryType, tenantCode, req.header('x-vdesgo-username') || null])
    await client.query(`UPDATE ${config.table} SET stock_entry_id = $1 WHERE id = $2`, [entry.rows[0].id, header.rows[0].id])
    for (const line of lines) {
      const quantity = Number(line.quantity)
      const innerQuantity = Number(line.innerQuantity || 1)
      await client.query('INSERT INTO other_stock_entry_lines (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7)', [entry.rows[0].id, line.productCode, line.productName, line.unit, String(innerQuantity), quantity, quantity * innerQuantity])
    }
    const nextBalance = parseAccountBalance(customer.rows[0].balance) + Number(config.balanceDelta) * numericTotal
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2 AND tenant_code = $3', [nextBalance, resolvedCustomerCode, tenantCode])
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], customerCode: resolvedCustomerCode, customerName: resolvedCustomerName, totalAmount: numericTotal })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || `${config.label} kaydedilemedi.` })
  } finally { await client.end().catch(() => undefined) }
}

app.post('/purchase-invoices', (req, res) => createInboundInvoice(req, res, { table: 'purchase_invoices', lineTable: 'purchase_invoice_lines', balanceDelta: -1, label: 'Alış faturası', entryType: 'Alış Faturası', factorySupplier: true }))
app.get('/factory-invoice-transfers/pending', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'distributor' && !req.operationTenant?.startsWith('D:')) {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Bekleyen fabrika faturaları yalnızca distribütör hesabında kullanılabilir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const count = await countPendingFactoryInvoiceTransfers(client, tenantCode)
    return res.json({ count })
  } catch (error) {
    console.error('Pending factory invoice transfer count failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Bekleyen fabrika faturaları alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Factory invoice transfer count connection cleanup failed:', error)) }
})
app.get('/factory-invoice-transfers/:code', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'distributor' && !req.operationTenant?.startsWith('D:')) {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Fatura aktarım kodu yalnızca distribütör hesabında kullanılabilir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    return res.json(await loadFactoryInvoiceTransfer(client, {
      code: req.params.code,
      tenantCode,
    }))
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Fatura aktarımı bulunamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/purchase-invoices/import-factory', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'distributor' && !req.operationTenant?.startsWith('D:')) {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Fatura aktarımı yalnızca distribütör hesabında kullanılabilir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const imported = await importFactoryInvoiceTransfer(client, {
      code: req.body?.code,
      tenantCode,
      warehouseCode: req.body?.warehouseCode,
      username: req.authenticatedUser.username,
      customerDefinition: resourceDefinitions.customers,
    })
    await recordAudit(client, req, {
      entityType: 'purchase_invoice',
      entityId: imported.id,
      action: 'import_factory_invoice',
      newValue: imported,
    })
    await client.query('COMMIT')
    return res.status(201).json(imported)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Factory invoice import rollback failed:', rollbackError))
    return res.status(error.statusCode || 400).json({ error: error.message || 'Fabrika faturası alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/purchase-invoices/:id/factory-source', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'distributor' && !req.operationTenant?.startsWith('D:')) {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Fatura görüntüleme yalnızca distribütör hesabında kullanılabilir.' })
  }
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz alış faturası numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    return res.json(await loadImportedFactoryInvoice(client, {
      invoiceId: Number(req.params.id),
      tenantCode,
    }))
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Aktarılan fatura görüntülenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/return-invoices', (req, res) => createInboundInvoice(req, res, { table: 'return_invoices', lineTable: 'return_invoice_lines', balanceDelta: -1, label: 'İade faturası', entryType: 'İade Faturası', includeReturnType: true }))

app.patch('/return-invoices/:id/invoice-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (Object.keys(req.body ?? {}).some((key) => !['invoiceNo', 'confirmNumberChange'].includes(key))) {
    return res.status(400).json({ error: 'Yalnızca fatura numarası ve değişiklik onayı gönderilebilir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const invoice = await assignReturnInvoiceNumber(client, {
      id: req.params.id, tenantCode, invoiceNo: req.body?.invoiceNo,
      confirmNumberChange: req.body?.confirmNumberChange, recordAudit, req,
    })
    await client.query('COMMIT')
    return res.json(invoice)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Return invoice number rollback failed:', rollbackError))
    console.error('Return invoice number failed:', error)
    return res.status(error.code === '23505' ? 409 : error.statusCode || 500).json({
      error: error.code === '23505' ? 'Fatura numarası daha önce kullanılmış.' : error.message || 'Fatura numarası kaydedilemedi.',
    })
  } finally { await client.end().catch((error) => console.error('Return invoice number cleanup failed:', error)) }
})

app.patch('/return-invoices/:id/cancel', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz iade faturası numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const result = await cancelReturnInvoice({
      client, id: Number(req.params.id), tenantCode,
      username: req.authenticatedUser?.username || req.header('x-vdesgo-username'),
      availableStock, recordAudit, req,
    })
    await client.query('COMMIT')
    return res.json(result)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'İade faturası iptal edilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/purchase-invoices/:id', async (req, res) => {
  if (req.header('x-vdesgo-account-type') !== 'factory') return res.status(403).json({ error: 'Alış faturası silme yetkisi yalnızca merkez kullanıcılarındadır.' })
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const invoice = await client.query('SELECT id, customer_code, total_amount, stock_entry_id FROM purchase_invoices WHERE id = $1 AND tenant_code = $2 FOR UPDATE', [req.params.id, tenantCode])
    if (!invoice.rowCount) throw new Error('Alış faturası bulunamadı.')
    const customer = await client.query('SELECT balance FROM customer_cards WHERE code = $1 AND tenant_code = $2 FOR UPDATE', [invoice.rows[0].customer_code, tenantCode])
    const restoredBalance = parseAccountBalance(customer.rows[0].balance) + Number(invoice.rows[0].total_amount || 0)
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2 AND tenant_code = $3', [restoredBalance, invoice.rows[0].customer_code, tenantCode])
    if (invoice.rows[0].stock_entry_id) await client.query('DELETE FROM other_stock_entries WHERE id = $1 AND tenant_code = $2', [invoice.rows[0].stock_entry_id, tenantCode])
    await client.query('DELETE FROM purchase_invoices WHERE id = $1 AND tenant_code = $2', [req.params.id, tenantCode])
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Alış faturası silinemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/collection-operations', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { customerCode, operationType, amount, description, operationDate } = req.body ?? {}
  const allowedTypes = ['Tahsilat', 'Bakiye Düşürme', 'Bakiye Yükseltme', 'Fabrika Ödeme']
  const factoryPayment = operationType === 'Fabrika Ödeme'
  if (factoryPayment && req.authenticatedUser?.accountType !== 'distributor') {
    return res.status(req.authenticatedUser ? 403 : 401).json({ error: 'Fabrika Ödeme yalnızca distribütör hesabından yapılabilir.' })
  }
  const numericAmount = Number(amount)
  if ((!customerCode && !factoryPayment) || !allowedTypes.includes(operationType) || !Number.isFinite(numericAmount) || numericAmount <= 0 || (operationType !== 'Tahsilat' && !description?.trim()) || !operationDate) return res.status(400).json({ error: 'Cari, işlem türü, tarih ve tutar zorunludur; bakiye işlemlerinde açıklama gereklidir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (factoryPayment && !tenantCode?.startsWith('D:')) throw new Error('Fabrika Ödeme yalnızca distribütör kapsamından yapılabilir.')
    const resolvedCustomerCode = factoryPayment
      ? (await resolveFactoryCustomerCard(client, resourceDefinitions.customers, tenantCode)).code
      : customerCode
    const customer = await client.query('SELECT code, name, title, balance FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [resolvedCustomerCode, tenantCode])
    if (!customer.rowCount) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const balanceDelta = operationType === 'Bakiye Yükseltme' || factoryPayment ? 1 : -1
    const nextBalance = parseAccountBalance(customer.rows[0].balance) + balanceDelta * numericAmount
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2 AND tenant_code = $3', [nextBalance, resolvedCustomerCode, tenantCode])
    const operation = await client.query('INSERT INTO customer_collection_operations (customer_code, operation_type, amount, description, operation_date, balance_delta, created_by, tenant_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, operation_type AS "operationType", operation_date AS "operationDate", customer_code AS "customerCode", amount, description', [resolvedCustomerCode, operationType, numericAmount, description.trim(), operationDate, balanceDelta, req.header('x-vdesgo-username') || null, tenantCode])
    await client.query('COMMIT')
    return res.status(201).json({ ...operation.rows[0], customerName: customer.rows[0].name, customerTitle: customer.rows[0].title, previousBalance: customer.rows[0].balance, newBalance: formatAccountBalance(nextBalance) })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Tahsilat işlemi kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/collection-operations', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const conditions = []
    const params = tenantCode === null ? [] : [tenantCode]
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    if (tenantCode !== null) conditions.push('o.tenant_code IS NOT DISTINCT FROM $1')
    if (req.query.firstDate) { params.push(req.query.firstDate); conditions.push(`o.operation_date >= $${params.length}`) }
    if (req.query.lastDate) { params.push(req.query.lastDate); conditions.push(`o.operation_date <= $${params.length}`) }
    const customerCodes = queryValues(req.query.customerCode)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`o.customer_code = ANY($${params.length}::text[])`) }
    const operationTypes = queryValues(req.query.operationType)
    if (operationTypes.length) { params.push(operationTypes); conditions.push(`o.operation_type = ANY($${params.length}::text[])`) }
    const representativeIds = queryValues(req.query.representativeId)
    if (representativeIds.length) { params.push(representativeIds.map(Number)); conditions.push(`c.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]))`) }
    const query = `SELECT o.id, o.operation_type AS "operationType", o.operation_date AS "operationDate", o.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle", o.amount, o.description FROM customer_collection_operations o INNER JOIN customer_cards c ON c.code = o.customer_code AND c.tenant_code = o.tenant_code${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY o.operation_date DESC, o.id DESC`
    const result = await client.query(query, params)
    return res.json(result.rows)
  } catch (error) { return res.status(500).json({ error: 'Tahsilat kayıtları alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
})

const customerAccountMovementsCte = `WITH movements AS (
  SELECT i.invoice_date AS operation_date, i.customer_code, i.customer_name, i.tenant_code,
    'Satış Faturası'::text AS operation_type, i.invoice_no::text AS reference_no,
    'Satış Faturası'::text AS description, i.total_amount AS debit, 0::numeric AS credit,
    i.created_at::timestamp AS movement_created_at, 1::integer AS movement_source_order, i.id::bigint AS movement_id
  FROM sales_invoices i WHERE i.cancelled IS NOT TRUE
  UNION ALL
  SELECT i.invoice_date, i.customer_code, i.customer_name, i.tenant_code,
    'Alış Faturası', COALESCE(i.invoice_no, 'AL-' || i.id::text), 'Alış Faturası', 0::numeric, i.total_amount,
    i.created_at::timestamp, 2::integer, i.id::bigint
  FROM purchase_invoices i WHERE i.cancelled IS NOT TRUE
  UNION ALL
  SELECT i.invoice_date, i.customer_code, i.customer_name, i.tenant_code,
    'İade Faturası', COALESCE(i.invoice_no, 'IA-' || i.id::text), 'İade Faturası', 0::numeric, i.total_amount,
    i.created_at::timestamp, 3::integer, i.id::bigint
  FROM return_invoices i WHERE i.cancelled IS NOT TRUE
  UNION ALL
  SELECT r.approved_at::date, r.factory_customer_code, c.name, r.tenant_code,
    'Satıcıya İade Faturası', 'SI-' || r.id::text, 'Satıcıya İade Faturası', r.total_amount, 0::numeric,
    r.approved_at::timestamp, 4::integer, r.id::bigint
  FROM supplier_return_invoices r
  INNER JOIN customer_cards c ON c.code = r.factory_customer_code AND c.tenant_code = r.tenant_code
  WHERE r.status = 'Onaylandı'
  UNION ALL
  SELECT r.approved_at::date, r.distributor_customer_code, c.name, 'F:MAIN',
    'Distribütörden İade Faturası', 'SI-' || r.id::text, 'Distribütörden İade Faturası', 0::numeric, r.total_amount,
    r.approved_at::timestamp, 5::integer, r.id::bigint
  FROM supplier_return_invoices r
  INNER JOIN customer_cards c ON c.code = r.distributor_customer_code AND c.tenant_code = 'F:MAIN'
  WHERE r.status = 'Onaylandı'
  UNION ALL
  SELECT o.operation_date, o.customer_code, c.name, o.tenant_code, 'Tahsilat', o.id::text,
    CASE WHEN o.operation_type = 'Tahsilat'
      THEN COALESCE(NULLIF(BTRIM(o.description), ''), 'Tahsilat')
      ELSE o.operation_type || CASE WHEN NULLIF(BTRIM(o.description), '') IS NULL THEN '' ELSE ' - ' || BTRIM(o.description) END
    END,
    CASE WHEN o.balance_delta > 0 THEN o.amount ELSE 0::numeric END,
    CASE WHEN o.balance_delta < 0 THEN o.amount ELSE 0::numeric END,
    o.created_at::timestamp, 6::integer, o.id::bigint
  FROM customer_collection_operations o
  INNER JOIN customer_cards c ON c.code = o.customer_code AND c.tenant_code = o.tenant_code
)`

app.get('/customer-reports/account-summary', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = [tenantCode, req.query.firstDate || '0001-01-01', req.query.lastDate || '9999-12-31']
    const conditions = ['($1::text IS NULL OR c.tenant_code IS NOT DISTINCT FROM $1)']
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    if (req.query.customerCode) { const values = queryValues(req.query.customerCode); params.push(values); conditions.push(`c.code = ANY($${params.length}::text[])`) }
    if (req.query.customerTypeCode) { const values = queryValues(req.query.customerTypeCode); params.push(values); conditions.push(customerTypeReportCondition(params.length)) }
    if (req.query.customerGroupCode) { const values = queryValues(req.query.customerGroupCode); params.push(values); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (req.query.representativeId) { const values = queryValues(req.query.representativeId).map(Number); params.push(values); conditions.push(`c.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]))`) }
    const scope = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      ${customerAccountMovementsCte}, customer_scope AS (
        SELECT c.code, c.name, c.title, c.balance, c.tenant_code
        FROM customer_cards c${scope}
      ), invoice_totals AS (
        SELECT i.customer_code, SUM(i.total_amount) AS invoice_total
        FROM sales_invoices i
        WHERE i.cancelled IS NOT TRUE
          AND ($1::text IS NULL OR i.tenant_code IS NOT DISTINCT FROM $1)
          AND i.invoice_date BETWEEN $2 AND $3
        GROUP BY i.customer_code
      ), collection_totals AS (
        SELECT o.customer_code, SUM(o.amount) AS collection_total
        FROM customer_collection_operations o
        WHERE o.operation_type = 'Tahsilat'
          AND ($1::text IS NULL OR o.tenant_code IS NOT DISTINCT FROM $1)
          AND o.operation_date BETWEEN $2 AND $3
        GROUP BY o.customer_code
      ), closing_balances AS (
        SELECT c.code AS customer_code,
          c.balance - COALESCE(SUM(m.debit - m.credit) FILTER (WHERE m.operation_date > $3), 0) AS balance
        FROM customer_scope c
        LEFT JOIN movements m ON m.customer_code = c.code AND m.tenant_code IS NOT DISTINCT FROM c.tenant_code
        GROUP BY c.code, c.balance
      )
      SELECT c.code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle",
        COALESCE(i.invoice_total, 0) AS "invoiceTotal",
        COALESCE(o.collection_total, 0) AS "collectionTotal",
        COALESCE(b.balance, c.balance) AS balance
      FROM customer_scope c
      LEFT JOIN invoice_totals i ON i.customer_code = c.code
      LEFT JOIN collection_totals o ON o.customer_code = c.code
      LEFT JOIN closing_balances b ON b.customer_code = c.code
      ORDER BY c.name, c.code
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, invoiceTotal: Number(row.invoiceTotal || 0), collectionTotal: Number(row.collectionTotal || 0), balance: Number(row.balance || 0) })))
  } catch (error) {
    console.error('Customer account summary query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Cari hesap özeti alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/customer-reports/tracking', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = tenantCode === null ? [] : [tenantCode]
    const conditions = tenantCode === null ? [] : ['c.tenant_code IS NOT DISTINCT FROM $1']
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    const firstDate = req.query.firstDate || new Date().toISOString().slice(0, 10)
    const lastDate = req.query.lastDate || firstDate
    params.push(firstDate, lastDate)
    const firstDateParam = params.length - 1
    const lastDateParam = params.length
    const typeCodes = queryValues(req.query.customerTypeCode)
    const groupCodes = queryValues(req.query.customerGroupCode)
    if (typeCodes.length) { params.push(typeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (groupCodes.length) { params.push(groupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      SELECT c.type, c.customer_group_code AS "groupCode", COALESCE(g.name, '') AS "groupName",
        COUNT(*) FILTER (WHERE c.created_at::date < $${firstDateParam})::integer AS "beforeCount",
        COUNT(*) FILTER (WHERE c.created_at::date BETWEEN $${firstDateParam} AND $${lastDateParam})::integer AS "periodCount",
        COUNT(*)::integer AS "totalCount"
      FROM customer_cards c
      LEFT JOIN customer_groups g ON g.code = c.customer_group_code
      ${where}
      GROUP BY c.type, c.customer_group_code, g.name
      ORDER BY c.type, g.name, c.customer_group_code
    `, params)
    const rows = result.rows.map((row) => ({ ...row, beforeCount: Number(row.beforeCount || 0), periodCount: Number(row.periodCount || 0), totalCount: Number(row.totalCount || 0) }))
    return res.json({ beforeCount: rows.reduce((sum, row) => sum + row.beforeCount, 0), periodCount: rows.reduce((sum, row) => sum + row.periodCount, 0), totalCount: rows.reduce((sum, row) => sum + row.totalCount, 0), rows })
  } catch (error) {
    console.error('Customer tracking report query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Müşteri takip raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/customer-reports/account-detail', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = [tenantCode, req.query.firstDate || '0001-01-01', req.query.lastDate || '9999-12-31']
    const conditions = ['($1::text IS NULL OR c.tenant_code IS NOT DISTINCT FROM $1)']
    const queryValues = (value) => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []
    const customerCodes = queryValues(req.query.customerCode)
    const customerTypeCodes = queryValues(req.query.customerTypeCode)
    const customerGroupCodes = queryValues(req.query.customerGroupCode)
    const representativeIds = queryValues(req.query.representativeId)
    if (customerCodes.length) { params.push(customerCodes); conditions.push(`c.code = ANY($${params.length}::text[])`) }
    if (customerTypeCodes.length) { params.push(customerTypeCodes); conditions.push(customerTypeReportCondition(params.length)) }
    if (customerGroupCodes.length) { params.push(customerGroupCodes); conditions.push(`c.customer_group_code = ANY($${params.length}::text[])`) }
    if (representativeIds.length) { params.push(representativeIds.map(Number)); conditions.push(`c.sales_representative IN (SELECT name FROM sales_representatives WHERE id = ANY($${params.length}::int[]))`) }
    const scope = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
    const result = await client.query(`
      ${customerAccountMovementsCte}, customer_scope AS (
        SELECT c.code, c.name, c.balance, c.tenant_code FROM customer_cards c${scope}
      ), scoped AS (
        SELECT m.* FROM movements m
        INNER JOIN customer_scope c ON c.code = m.customer_code AND c.tenant_code IS NOT DISTINCT FROM m.tenant_code
        WHERE m.operation_date BETWEEN $2 AND $3
      ), opening_balances AS (
        SELECT c.code AS customer_code,
          c.balance - COALESCE(SUM(m.debit - m.credit) FILTER (WHERE m.operation_date >= $2), 0) AS opening_balance
        FROM customer_scope c
        LEFT JOIN movements m ON m.customer_code = c.code AND m.tenant_code IS NOT DISTINCT FROM c.tenant_code
        GROUP BY c.code, c.balance
      )
      SELECT operation_date AS "operationDate", customer_code AS "customerCode", customer_name AS "customerName",
        operation_type AS "operationType", reference_no AS "referenceNo", description, debit, credit,
        opening_balance + SUM(debit - credit) OVER (
          PARTITION BY tenant_code, customer_code
          ORDER BY operation_date, movement_created_at, movement_source_order, movement_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS balance
      FROM scoped
      INNER JOIN opening_balances USING (customer_code)
      ORDER BY customer_code, operation_date, movement_created_at, movement_source_order, movement_id
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, operationDate: toApiValue(row.operationDate), debit: Number(row.debit || 0), credit: Number(row.credit || 0), balance: Number(row.balance || 0) })))
  } catch (error) {
    console.error('Customer account detail query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Cari hesap detayı alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/customer-reports/average-due-date', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const params = tenantCode === null ? [] : [tenantCode]
    const scope = tenantCode === null ? ' WHERE i.cancelled IS NOT TRUE' : ' WHERE i.cancelled IS NOT TRUE AND i.tenant_code IS NOT DISTINCT FROM $1'
    const result = await client.query(`
      SELECT i.customer_code AS "customerCode", i.customer_name AS "customerName",
        COUNT(*)::integer AS "invoiceCount", SUM(i.total_amount) AS balance,
        to_char(to_timestamp(SUM(EXTRACT(EPOCH FROM i.invoice_date) * i.total_amount) / NULLIF(SUM(i.total_amount), 0)), 'YYYY-MM-DD') AS "averageDueDate"
      FROM sales_invoices i
      LEFT JOIN customer_cards c ON c.code = i.customer_code
      ${scope}
      GROUP BY i.customer_code, i.customer_name
      ORDER BY "averageDueDate", i.customer_code
    `, params)
    return res.json(result.rows.map((row) => ({ ...row, balance: Number(row.balance || 0) })))
  } catch (error) {
    console.error('Customer average due date query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'Cari ortalama vade raporu alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/other-exits/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_exits WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) {
    console.error('Other stock exit number query failed:', error)
    return res.status(500).json({ error: 'Other stock exit number query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/other-exits', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { receiptNo, exitDate, exitingWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(exitDate) || !exitingWarehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih yalnızca bugün veya geriye dönük 5 gün içinde seçilebilir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND tenant_code = $2 FOR UPDATE', [exitingWarehouseCode, tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Çıkan depo aktif olmalıdır.')
    const normalizedLines = lines.map((line) => {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      const quantity = Number(line.quantity)
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      return {
        ...line, innerQuantity, quantity, totalQuantity: innerQuantity * quantity,
        productionLotCode: tenantCode === 'F:MAIN' ? normalizeLotCode(line.productionLotCode) : null,
      }
    })
    await assertFactoryLotAvailability(client, exitingWarehouseCode, normalizedLines, tenantCode)
    const header = await client.query('INSERT INTO other_stock_exits (receipt_no, exit_date, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, receipt_no, exit_date, exiting_warehouse_code', [Number(receiptNo), exitDate, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of normalizedLines) {
      const stock = await client.query(`SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) AS "baseQuantity"`, [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < line.totalQuantity) throw new Error(`${line.productName} için yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO other_stock_exit_lines (exit_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode])
    }
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], lines })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Other stock exit creation failed:', error)
    return res.status(400).json({ error: error.message || 'Sair çıkış kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/other-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { receiptNo, entryDate, enteringWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(entryDate) || !enteringWarehouseCode || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Fiş bilgileri ve en az bir ürün satırı zorunludur.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND type = $2 AND active = TRUE AND tenant_code = $3 FOR UPDATE', [enteringWarehouseCode, 'Merkez Depo', tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Giren depo merkez depo olmalıdır.')
    const header = await client.query("INSERT INTO other_stock_entries (receipt_no, entry_date, entering_warehouse_code, entry_type, source_system, tenant_code, created_by) VALUES ($1, $2, $3, 'Sair Giriş', 'manual', $4, $5) RETURNING id, receipt_no, entry_date, entering_warehouse_code", [Number(receiptNo), entryDate, enteringWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    const normalizedExpiryLines = lines.map((line) => {
      const productionLotCode = tenantCode === 'F:MAIN' ? normalizeLotCode(line.productionLotCode) : null
      return { ...line, productionLotCode, lotExpiryDate: tenantCode === 'F:MAIN' ? normalizeLotExpiryDate(line.lotExpiryDate, productionLotCode) : null }
    })
    if (tenantCode === 'F:MAIN') await assertLotExpiryDates(client, normalizedExpiryLines)
    for (const line of normalizedExpiryLines) {
      if (!line.productCode || !line.productName || !line.unit || !line.quantity || Number(line.quantity) <= 0) throw new Error('Geçersiz ürün satırı.')
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      if (!Number.isFinite(innerQuantity) || innerQuantity <= 0) throw new Error('Geçersiz birim içeriği.')
      const quantity = Number(line.quantity)
      await client.query('INSERT INTO other_stock_entry_lines (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code, lot_expiry_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity || '', quantity, innerQuantity * quantity, line.productionLotCode, line.lotExpiryDate])
    }
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], lines })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Other stock entry creation failed:', error)
    return res.status(400).json({ error: error.message || 'Sair giriş kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/production-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const { receiptNo, entryDate, enteringWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(entryDate) || !enteringWarehouseCode || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Fiş bilgileri ve en az bir ürün satırı zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') throw Object.assign(new Error('Üretim girişi yalnızca fabrika merkezine kaydedilebilir.'), { statusCode: 403 })
    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND tenant_code = 'F:MAIN' AND type = 'Merkez Depo' AND active IS TRUE FOR SHARE`,
      [enteringWarehouseCode],
    )
    if (!warehouse.rowCount) throw new Error('Giren depo aktif fabrika merkez deposu olmalıdır.')
    const duplicate = await client.query(
      `SELECT 1 FROM other_stock_entries WHERE receipt_no = $1 AND tenant_code = 'F:MAIN' FOR UPDATE`,
      [Number(receiptNo)],
    )
    if (duplicate.rowCount) throw Object.assign(new Error('Bu fiş numarası daha önce kullanılmış.'), { statusCode: 409 })
    const normalizedLines = await normalizeProductionGoodsLines(client, lines)
    const header = await client.query(
      `INSERT INTO other_stock_entries
         (receipt_no, entry_date, entering_warehouse_code, entry_type, source_system, source_reference, tenant_code, created_by)
       VALUES ($1,$2,$3,'Üretimden Mal Girişi','manual',NULL,'F:MAIN',$4)
       RETURNING id, receipt_no AS "receiptNo", entry_date AS "entryDate", entering_warehouse_code AS "enteringWarehouseCode"`,
      [Number(receiptNo), entryDate, enteringWarehouseCode, req.header('x-vdesgo-username') || null],
    )
    for (const line of normalizedLines) {
      await client.query(
        `INSERT INTO other_stock_entry_lines
           (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode],
      )
    }
    await recordAudit(client, req, {
      entityType: 'production_goods_receipt', entityId: header.rows[0].id, action: 'create',
      newValue: { ...header.rows[0], entryType: 'Üretimden Mal Girişi', tenantCode: 'F:MAIN', lines: normalizedLines },
    })
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], entryType: 'Üretimden Mal Girişi', tenantCode: 'F:MAIN', sourceSystem: 'manual', lines: normalizedLines })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Production goods receipt creation failed:', error)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Üretim mal girişi kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/production-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType !== 'factory') return res.status(403).json({ error: 'Üretimden mal girişi yalnızca fabrika hesabında kullanılabilir.' })
  const { receiptNo, entryDate, enteringWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(entryDate) || !enteringWarehouseCode || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'Fiş bilgileri ve en az bir ürün satırı zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    if (tenantCode !== 'F:MAIN') throw Object.assign(new Error('Üretim girişi yalnızca fabrika merkezine kaydedilebilir.'), { statusCode: 403 })
    const warehouse = await client.query(
      `SELECT code FROM factory_warehouses
       WHERE code = $1 AND tenant_code = 'F:MAIN' AND type = 'Merkez Depo' AND active IS TRUE FOR SHARE`,
      [enteringWarehouseCode],
    )
    if (!warehouse.rowCount) throw new Error('Giren depo aktif fabrika merkez deposu olmalıdır.')
    const duplicate = await client.query(
      `SELECT 1 FROM other_stock_entries WHERE receipt_no = $1 AND tenant_code = 'F:MAIN' FOR UPDATE`,
      [Number(receiptNo)],
    )
    if (duplicate.rowCount) throw Object.assign(new Error('Bu fiş numarası daha önce kullanılmış.'), { statusCode: 409 })
    const normalizedLines = await normalizeProductionGoodsLines(client, lines)
    const header = await client.query(
      `INSERT INTO other_stock_entries
         (receipt_no, entry_date, entering_warehouse_code, entry_type, source_system, source_reference, tenant_code, created_by)
       VALUES ($1,$2,$3,'Üretimden Mal Girişi','manual',NULL,'F:MAIN',$4)
       RETURNING id, receipt_no AS "receiptNo", entry_date AS "entryDate", entering_warehouse_code AS "enteringWarehouseCode"`,
      [Number(receiptNo), entryDate, enteringWarehouseCode, req.header('x-vdesgo-username') || null],
    )
    for (const line of normalizedLines) {
      await client.query(
        `INSERT INTO other_stock_entry_lines
           (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode],
      )
    }
    await recordAudit(client, req, {
      entityType: 'production_goods_receipt', entityId: header.rows[0].id, action: 'create',
      newValue: { ...header.rows[0], entryType: 'Üretimden Mal Girişi', tenantCode: 'F:MAIN', lines: normalizedLines },
    })
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], entryType: 'Üretimden Mal Girişi', tenantCode: 'F:MAIN', lines: normalizedLines })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Üretim mal girişi kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/operation-records/:operation', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const operation = req.params.operation
    const query = operation === 'vehicle-loadings'
      ? `SELECT v.id, v.receipt_no AS "receiptNo", v.loading_date AS "operationDate", v.entering_warehouse_code AS "enteringWarehouseCode", wi.name AS "enteringWarehouseName", v.exiting_warehouse_code AS "exitingWarehouseCode", wo.name AS "exitingWarehouseName", v.tenant_code AS "tenantCode", v.created_by AS "createdBy", v.cancelled_at AS "cancelledAt", v.cancelled_by AS "cancelledBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity, 'productionLotCode', l.production_lot_code) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM vehicle_loadings v LEFT JOIN vehicle_loading_lines l ON l.loading_id = v.id LEFT JOIN factory_warehouses wi ON wi.code = v.entering_warehouse_code AND wi.tenant_code = v.tenant_code LEFT JOIN factory_warehouses wo ON wo.code = v.exiting_warehouse_code AND wo.tenant_code = v.tenant_code WHERE v.tenant_code IS NOT DISTINCT FROM $1 GROUP BY v.id, wi.name, wo.name ORDER BY v.loading_date DESC, v.receipt_no DESC`
      : operation === 'other-exits'
      ? `SELECT e.id, e.receipt_no AS "receiptNo", e.exit_date AS "operationDate", e.exiting_warehouse_code AS "exitingWarehouseCode", w.name AS "exitingWarehouseName", e.tenant_code AS "tenantCode", e.created_by AS "createdBy", e.cancelled_at AS "cancelledAt", e.cancelled_by AS "cancelledBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity, 'productionLotCode', l.production_lot_code) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM other_stock_exits e LEFT JOIN other_stock_exit_lines l ON l.exit_id = e.id LEFT JOIN factory_warehouses w ON w.code = e.exiting_warehouse_code AND w.tenant_code = e.tenant_code WHERE e.tenant_code IS NOT DISTINCT FROM $1 GROUP BY e.id, w.name ORDER BY e.exit_date DESC, e.receipt_no DESC`
      : operation === 'transfers'
        ? `SELECT t.id, t.receipt_no AS "receiptNo", t.transfer_date AS "operationDate", t.entering_warehouse_code AS "enteringWarehouseCode", wi.name AS "enteringWarehouseName", t.exiting_warehouse_code AS "exitingWarehouseCode", wo.name AS "exitingWarehouseName", t.tenant_code AS "tenantCode", t.created_by AS "createdBy", t.cancelled_at AS "cancelledAt", t.cancelled_by AS "cancelledBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity, 'productionLotCode', l.production_lot_code) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM warehouse_transfers t LEFT JOIN warehouse_transfer_lines l ON l.transfer_id = t.id LEFT JOIN factory_warehouses wi ON wi.code = t.entering_warehouse_code AND wi.tenant_code = t.tenant_code LEFT JOIN factory_warehouses wo ON wo.code = t.exiting_warehouse_code AND wo.tenant_code = t.tenant_code WHERE t.tenant_code IS NOT DISTINCT FROM $1 GROUP BY t.id, wi.name, wo.name ORDER BY t.transfer_date DESC, t.receipt_no DESC`
        : null
    if (!query) return res.json([])
    const scopedQuery = tenantCode === null ? query.replace(/WHERE [a-z]+\.tenant_code IS NOT DISTINCT FROM \$1/g, 'WHERE TRUE') : query
    const result = await client.query(scopedQuery, tenantCode === null ? [] : [tenantCode])
    return res.json(result.rows.map((row) => ({ ...row, operationDate: toApiValue(row.operationDate), totalQuantity: Number(row.totalQuantity) })))
  } catch (error) {
    console.error('Operation records query failed:', error)
    return res.status(500).json({ error: 'Operation records query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/operation-records/:operation/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz işlem numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    return res.json(await loadWarehouseOperation({ client, operation: req.params.operation, id: Number(req.params.id), tenantCode }))
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Depo işlem kaydı alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/inventory/operation-records/:operation/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz işlem numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const record = await replaceWarehouseOperation({
      client, operation: req.params.operation, id: Number(req.params.id), tenantCode,
      payload: req.body ?? {}, username: req.authenticatedUser?.username,
      availableStock, isAllowedOperationDate, recordAudit, req,
    })
    await client.query('COMMIT')
    return res.json(record)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Depo işlem kaydı güncellenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/inventory/operation-records/:operation/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Geçersiz işlem numarası.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const result = await cancelWarehouseOperation({
      client, operation: req.params.operation, id: Number(req.params.id), tenantCode,
      username: req.authenticatedUser?.username || req.header('x-vdesgo-username'),
      availableStock, recordAudit, req,
    })
    await client.query('COMMIT')
    return res.json(result)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(error.statusCode || 400).json({ error: error.message || 'Depo işlem kaydı iptal edilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/vehicle-loadings/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); const tenantCode = await getRequestTenant(client, req)
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM vehicle_loadings WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) { return res.status(500).json({ error: 'Araç yükleme fiş numarası alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/vehicle-loadings', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { receiptNo, loadingDate, enteringWarehouseCode, exitingWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(loadingDate) || !enteringWarehouseCode || !exitingWarehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Fiş, tarih, araç deposu, çıkan depo ve ürün satırı zorunludur.' })
  if (enteringWarehouseCode === exitingWarehouseCode) return res.status(400).json({ error: 'Giren depo ve çıkan depo aynı olamaz.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN'); const tenantCode = await getRequestTenant(client, req)
    const depots = await client.query('SELECT code, type FROM factory_warehouses WHERE code = ANY($1::text[]) AND active = TRUE AND tenant_code = $2 ORDER BY code FOR UPDATE', [[enteringWarehouseCode, exitingWarehouseCode], tenantCode])
    if (depots.rowCount !== 2 || !depots.rows.some((item) => item.code === enteringWarehouseCode && ['Araç Deposu', 'Arac Deposu'].includes(item.type))) throw new Error('Giren depo aktif bir Araç Deposu olmalıdır.')
    const normalizedLines = lines.map((line) => {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      const quantity = Number(line.quantity)
      const totalQuantity = innerQuantity * quantity
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      return {
        ...line, innerQuantity, quantity, totalQuantity,
        productionLotCode: tenantCode === 'F:MAIN' ? normalizeLotCode(line.productionLotCode) : null,
      }
    })
    await assertFactoryLotAvailability(client, exitingWarehouseCode, normalizedLines, tenantCode)
    const header = await client.query('INSERT INTO vehicle_loadings (receipt_no, loading_date, entering_warehouse_code, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, receipt_no, loading_date, entering_warehouse_code, exiting_warehouse_code', [Number(receiptNo), loadingDate, enteringWarehouseCode, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of normalizedLines) {
      const stock = await client.query('SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3 AND t.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3 AND t.cancelled_at IS NULL), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.entering_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3 AND v.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.exiting_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3 AND v.cancelled_at IS NULL), 0) AS "baseQuantity"', [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < line.totalQuantity) throw new Error(`${line.productName} için çıkan depoda yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO vehicle_loading_lines (loading_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode])
    }
    await client.query('COMMIT'); return res.status(201).json({ ...header.rows[0], lines })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return res.status(400).json({ error: error.message || 'Araç yükleme kaydedilemedi.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.get('/inventory/transfers/next-number', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM warehouse_transfers WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    return res.json({ receiptNo: result.rows[0].nextNumber })
  } catch (error) { return res.status(500).json({ error: 'Transfer fiş numarası alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.post('/inventory/transfers', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { receiptNo, transferDate, enteringWarehouseCode, exitingWarehouseCode, lines } = req.body ?? {}
  if (!Number.isInteger(Number(receiptNo)) || !isAllowedOperationDate(transferDate) || !enteringWarehouseCode || !exitingWarehouseCode || enteringWarehouseCode === exitingWarehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, iki farklı depo ve en az bir ürün satırı zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const depots = await client.query('SELECT code FROM factory_warehouses WHERE code = ANY($1::text[]) AND active = TRUE AND tenant_code = $2 ORDER BY code FOR UPDATE', [[enteringWarehouseCode, exitingWarehouseCode], tenantCode])
    if (depots.rowCount !== 2) throw new Error('İki depo da aktif olmalıdır.')
    const normalizedLines = lines.map((line) => {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      const quantity = Number(line.quantity)
      const totalQuantity = innerQuantity * quantity
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      return {
        ...line, innerQuantity, quantity, totalQuantity,
        productionLotCode: tenantCode === 'F:MAIN' ? normalizeLotCode(line.productionLotCode) : null,
      }
    })
    await assertFactoryLotAvailability(client, exitingWarehouseCode, normalizedLines, tenantCode)
    const header = await client.query('INSERT INTO warehouse_transfers (receipt_no, transfer_date, entering_warehouse_code, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, receipt_no, transfer_date, entering_warehouse_code, exiting_warehouse_code', [Number(receiptNo), transferDate, enteringWarehouseCode, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of normalizedLines) {
      const stock = await client.query(`SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3 AND e.cancelled_at IS NULL), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3 AND t.cancelled_at IS NULL), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3 AND t.cancelled_at IS NULL), 0) AS "baseQuantity"`, [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < line.totalQuantity) throw new Error(`${line.productName} için çıkan depoda yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO warehouse_transfer_lines (transfer_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity, production_lot_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, line.quantity, line.totalQuantity, line.productionLotCode])
    }
    await client.query('COMMIT'); return res.status(201).json({ ...header.rows[0], lines })
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return res.status(400).json({ error: error.message || 'Transfer kaydedilemedi.' }) }
  finally { await client.end().catch(() => undefined) }
})

app.get('/data/warehouses/next-code', async (_req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query("SELECT MAX(CAST(SUBSTRING(code FROM '^DEP-([0-9]+)$') AS INTEGER)) AS \"lastNumber\" FROM factory_warehouses")
    const nextNumber = (result.rows[0]?.lastNumber ?? 0) + 1
    return res.json({ code: `DEP-${String(nextNumber).padStart(3, '0')}` })
  } catch (error) {
    console.error('Next warehouse code query failed:', error)
    return res.status(500).json({ error: 'Next warehouse code query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/data/customers/next-code', async (_req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query("SELECT MAX(CAST(code AS INTEGER)) AS \"lastNumber\" FROM customer_cards WHERE code ~ '^[0-9]+$'")
    const nextNumber = (result.rows[0]?.lastNumber ?? 1000) + 1
    return res.json({ code: String(nextNumber).padStart(4, '0') })
  } catch (error) {
    console.error('Next customer code query failed:', error)
    return res.status(500).json({ error: 'Next customer code query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/data/products/next-code', async (_req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query("SELECT MAX(CAST(code AS INTEGER)) AS \"lastNumber\" FROM factory_products WHERE code ~ '^[0-9]+$'")
    const nextNumber = Math.max(result.rows[0]?.lastNumber ?? 99, 99) + 1
    return res.json({ code: String(nextNumber) })
  } catch (error) {
    console.error('Next product code query failed:', error)
    return res.status(500).json({ error: 'Next product code query failed' })
  } finally { await client.end().catch(() => undefined) }
})

registerFactoryCustomerCardRoutes(app, {
  pg, databaseUrl, definition: resourceDefinitions.customers, requireFactoryAccount,
  assertResourceAccess, toResponseRow, recordAudit, normalizeResourceValue,
})
registerSupplierReturnRoutes(app, {
  pg, databaseUrl, definition: resourceDefinitions.customers, getRequestTenant, toResponseRow, recordAudit,
})
registerEDocumentRoutes(app, { pg, databaseUrl, getRequestTenant, recordAudit })

app.get('/data/:resource', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const authorizedTenant = await assertResourceAccess(client, req, req.params.resource, 'read')
    const tenantCode = req.authenticatedUser?.accountType === 'factory' && req.query.distributorCode !== undefined
      ? await getReportTenant(client, req)
      : authorizedTenant
    const includeFactoryCards = req.params.resource === 'customers'
      && ['Satış Faturası', 'Alış Faturası', 'Sipariş'].includes(req.query.invoiceType)
      && tenantCode?.startsWith('D:')
    const factoryPurchaseSelection = req.params.resource === 'customers'
      && req.query.invoiceType === 'Alış Faturası'
      && tenantCode?.startsWith('D:')
    if (includeFactoryCards) {
      await client.query('BEGIN')
      await syncFactoryCustomerCards(client, resourceDefinitions.customers, tenantCode)
      await client.query('COMMIT')
    }
    const availableColumns = req.params.resource === 'salesRepresentatives'
      ? await getAvailableResourceColumns(client, definition)
      : new Set(definition.dbColumns)
    const customerColumns = req.params.resource === 'customers'
      ? `${definition.dbColumns.map((column) => column === 'sales_representative'
        ? `COALESCE((SELECT r.name FROM sales_rep_customers a INNER JOIN sales_representatives r ON r.id = a.sales_representative_id WHERE a.customer_code = c.code AND a.active = TRUE AND a.tenant_code IS NOT DISTINCT FROM c.tenant_code ORDER BY a.created_at DESC, a.id DESC LIMIT 1), NULLIF(c.sales_representative, '')) AS sales_representative`
        : `c.${column}`).join(', ')}, c.tenant_code, ${openOrderCreditSql()} AS open_order_amount`
      : `${definition.dbColumns.map((column) => availableColumns.has(column)
        ? column
        : `${resourceColumnDefaults[column]} AS ${column}`).join(', ')}${['customers', 'warehouses', 'vehicles'].includes(req.params.resource) ? ', tenant_code' : ''}`
    const customerTable = req.params.resource === 'customers' ? 'customer_cards c' : definition.table
    if (req.params.resource === 'prices' && req.query.latest === 'true') {
      const latest = await client.query(latestProductPricesQuery)
      return res.json(latest.rows.map((row) => toResponseRow(row, definition)))
    }
    const customerFilter = factoryPurchaseSelection
      ? ' AND c.is_factory_card = TRUE AND c.factory_card_source IS NOT NULL AND c.active IS TRUE'
      : req.params.resource === 'customers' && !includeFactoryCards
        ? ' AND c.is_factory_card = FALSE'
        : ''
    const result = tenantCode && tenantResources.has(req.params.resource)
      ? await client.query(`SELECT ${customerColumns} FROM ${customerTable} WHERE ${req.params.resource === 'customers' ? 'c.' : ''}tenant_code = $1${customerFilter} ORDER BY ${req.params.resource === 'customers' ? 'c.' : ''}${definition.dbColumns[0]}`, [tenantCode])
      : await client.query(`SELECT ${customerColumns} FROM ${customerTable}${req.params.resource === 'customers' ? ' WHERE c.is_factory_card = FALSE' : ''} ORDER BY ${req.params.resource === 'customers' ? 'c.' : ''}${definition.dbColumns[0]}`)
    if (req.params.resource === 'salesRepresentatives') {
      const mobileUsernames = await getRepresentativeMobileUsernames(client, result.rows.map((row) => row.id))
      return res.json(result.rows.map((row) => ({ ...toResponseRow(row, definition), mobileUsername: mobileUsernames.get(row.id) ?? '' })))
    }
    return res.json(result.rows.map((row) => ({
      ...toResponseRow(row, definition),
      ...(['customers', 'warehouses', 'vehicles'].includes(req.params.resource) ? { tenantCode: row.tenant_code } : {}),
      ...(req.params.resource === 'customers' ? { openOrderAmount: Number(row.open_order_amount) } : {}),
    })))
  } catch (error) {
    console.error('Resource query failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/data/prices/bulk', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const body = req.body ?? {}
  if (!Array.isArray(body.productCodes) || !body.productCodes.length
    || body.productCodes.some((code) => typeof code !== 'string' || !code.trim())
    || new Set(body.productCodes).size !== body.productCodes.length) {
    return res.status(400).json({ error: 'Fiyat eklenecek ürünleri tekrarsız seçin.' })
  }
  const dateError = validatePriceDates(body)
  if (dateError) return res.status(400).json({ error: dateError })
  for (const date of [body.startDate, body.endDate]) {
    const parsed = typeof date === 'string' ? Date.parse(`${date}T00:00:00.000Z`) : NaN
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed)
      || new Date(parsed).toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ error: 'Geçerli fiyat tarihleri girin.' })
    }
  }
  const priceFields = ['purchasePrice', 'salesPrice', 'soundReturnPrice', 'damagedReturnPrice', 'recommendedSalesPrice']
  for (const field of priceFields) {
    const value = body[field]
    if (!['string', 'number'].includes(typeof value) || String(value).length > 50
      || !/^(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/.test(String(value).trim())
      || !Number.isFinite(parseMoneyNumber(value)) || parseMoneyNumber(value) < 0) {
      return res.status(400).json({ error: 'Tüm fiyat alanlarına geçerli, sıfır veya pozitif tutar girin.' })
    }
  }
  if (!['Aktif', 'Pasif'].includes(body.status)) {
    return res.status(400).json({ error: 'Geçerli bir fiyat durumu seçin.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await assertResourceAccess(client, req, 'prices', 'create')
    await client.query('BEGIN')
    const products = await client.query(
      'SELECT code, name FROM factory_products WHERE code = ANY($1::text[]) ORDER BY code FOR SHARE',
      [body.productCodes],
    )
    if (products.rowCount !== body.productCodes.length) {
      throw accessError('Seçilen ürünlerden biri bulunamadı. Ürün listesini yenileyin.', 400)
    }
    const definition = resourceDefinitions.prices
    const saved = []
    for (const product of products.rows) {
      const result = await client.query(
        `INSERT INTO product_prices
          (product_code, product_name, start_date, end_date, purchase_price, sales_price,
           sound_return_price, damaged_return_price, recommended_sales_price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING ${definition.dbColumns.join(', ')}`,
        [product.code, product.name, body.startDate, body.endDate,
          ...priceFields.map((field) => String(body[field]).trim()), body.status],
      )
      await recordAudit(client, req, { entityType: 'prices', entityId: result.rows[0].id, action: 'create', newValue: result.rows[0] })
      saved.push(toResponseRow(result.rows[0], definition))
    }
    await client.query('COMMIT')
    return res.status(201).json(saved)
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Bulk price rollback failed:', rollbackError))
    console.error('Bulk price creation failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Toplu fiyat eklenemedi. Hiçbir fiyat kaydedilmedi.' })
  } finally { await client.end().catch((error) => console.error('Bulk price cleanup failed:', error)) }
})

app.post('/data/:resource', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  if (req.params.resource === 'customers' && req.body?.type === 'Fabrika') {
    return res.status(400).json({ error: 'Fabrika kartını Fabrika Kart Tanımlama ekranından kaydedin.' })
  }
  if (req.params.resource === 'prices') {
    const dateError = validatePriceDates(req.body)
    if (dateError) return res.status(400).json({ error: dateError })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    prepareProductImageBody(req.params.resource, req.body)
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'create')
    const availableColumns = req.params.resource === 'salesRepresentatives'
      ? await getAvailableResourceColumns(client, definition)
      : new Set(definition.dbColumns)
    if (!ensureOptionalResourceValues(res, definition, req.body, availableColumns)) return
    const isGeneratedKey = definition.key === 'id'
    const writeIndexes = definition.columns.map((_, index) => index)
      .filter((index) => availableColumns.has(definition.dbColumns[index]) && !(isGeneratedKey && index === 0))
    const writeColumns = writeIndexes.map((index) => definition.columns[index])
    const writeDbColumns = writeIndexes.map((index) => definition.dbColumns[index])
    const values = writeColumns.map((column) => normalizeResourceValue(
      req.params.resource,
      column,
      req.body?.[column] ?? (column === 'active' ? true : ''),
    ))
    if (!values[0]) return res.status(400).json({ error: `${definition.key} is required` })
    if (req.params.resource === 'salesRepresentatives') {
      const mobileCredentials = readMobileCredentials(req.body)
      if (tenantCode?.startsWith('D:') && !mobileCredentials?.password) {
        return res.status(400).json({ error: 'Mobil uygulama kullanıcı adı ve 8 karakterli şifre zorunludur.' })
      }
      await client.query('BEGIN')
      await validateRepresentativeWarehouses(client, req, req.body ?? {}, null, tenantCode)
      const placeholders = writeColumns.map((_, index) => `$${index + 1}`).join(', ')
      const returningColumns = definition.dbColumns.filter((column) => availableColumns.has(column))
      const result = tenantCode
        ? await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}, tenant_code) VALUES (${placeholders}, $${values.length + 1}) RETURNING ${returningColumns.join(', ')}`, [...values, tenantCode])
        : await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}) VALUES (${placeholders}) RETURNING ${returningColumns.join(', ')}`, values)
      const mobileUser = await saveRepresentativeMobileUser(client, req, result.rows[0].id, mobileCredentials)
      await recordAudit(client, req, { entityType: req.params.resource, entityId: result.rows[0].id, action: 'create', newValue: result.rows[0] })
      await client.query('COMMIT')
      return res.status(201).json({ ...toResponseRow(result.rows[0], definition), mobileUsername: mobileUser?.username ?? '' })
    }
    const placeholders = writeColumns.map((_, index) => `$${index + 1}`).join(', ')
    const returningColumns = definition.dbColumns.filter((column) => availableColumns.has(column))
    const result = tenantCode
      ? await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}, tenant_code) VALUES (${placeholders}, $${values.length + 1}) RETURNING ${returningColumns.join(', ')}`, [...values, tenantCode])
      : await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}) VALUES (${placeholders}) RETURNING ${returningColumns.join(', ')}`, values)
    await recordAudit(client, req, { entityType: req.params.resource, entityId: result.rows[0][definition.dbColumns[0]], action: 'create', newValue: auditResourceRow(req.params.resource, result.rows[0]) })
    return res.status(201).json(toResponseRow(result.rows[0], definition))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Resource creation failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource creation failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.patch('/data/products/:key/status', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (typeof req.body?.active !== 'boolean') return res.status(400).json({ error: 'Ürün durumu aktif veya pasif olarak belirtilmelidir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    await assertResourceAccess(client, req, 'products', 'edit')
    await client.query('BEGIN')
    const existing = await client.query('SELECT active FROM factory_products WHERE code = $1 FOR UPDATE', [req.params.key])
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Ürün bulunamadı.' })
    }
    const definition = resourceDefinitions.products
    const result = await client.query(
      `UPDATE factory_products SET active = $1 WHERE code = $2 RETURNING ${definition.dbColumns.join(', ')}`,
      [req.body.active, req.params.key],
    )
    await recordAudit(client, req, {
      entityType: 'products', entityId: req.params.key, action: 'update',
      oldValue: { active: existing.rows[0].active }, newValue: { active: req.body.active },
    })
    await client.query('COMMIT')
    return res.json(toResponseRow(result.rows[0], definition))
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError) => console.error('Product status rollback failed:', rollbackError))
    console.error('Product status update failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Ürün durumu değiştirilemedi.' })
  } finally { await client.end().catch((error) => console.error('Product status connection cleanup failed:', error)) }
})

app.put('/data/:resource/:key', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  if (req.params.resource === 'prices') {
    const dateError = validatePriceDates(req.body)
    if (dateError) return res.status(400).json({ error: dateError })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    prepareProductImageBody(req.params.resource, req.body)
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'edit')
    if (req.params.resource === 'customers') {
      const factoryCard = await client.query('SELECT 1 FROM customer_cards WHERE code = $1 AND is_factory_card = TRUE', [req.params.key])
      if (factoryCard.rowCount || req.body?.type === 'Fabrika') return res.status(403).json({ error: 'Fabrika kartı yalnızca Fabrika Kart Tanımlama ekranından değiştirilebilir.' })
    }
    const availableColumns = req.params.resource === 'salesRepresentatives'
      ? await getAvailableResourceColumns(client, definition)
      : new Set(definition.dbColumns)
    if (!ensureOptionalResourceValues(res, definition, req.body, availableColumns)) return
    const writeIndexes = definition.columns.map((_, index) => index)
      .filter((index) => index > 0 && availableColumns.has(definition.dbColumns[index])
        && !(req.params.resource === 'customers' && ['creditLimit', 'balance', 'tckn', 'email'].includes(definition.columns[index])
          && !Object.hasOwn(req.body ?? {}, definition.columns[index])))
    const values = writeIndexes.map((index) => normalizeResourceValue(
      req.params.resource,
      definition.columns[index],
      req.body?.[definition.columns[index]] ?? '',
    ))
    const updates = writeIndexes.map((index, valueIndex) => `${definition.dbColumns[index]} = $${valueIndex + 1}`).join(', ')
    const returningColumns = definition.dbColumns.filter((column) => availableColumns.has(column))
    if (req.params.resource === 'salesRepresentatives') {
      const mobileCredentials = readMobileCredentials(req.body)
      await client.query('BEGIN')
      await validateRepresentativeWarehouses(client, req, req.body ?? {}, Number(req.params.key), tenantCode)
      const result = tenantCode
        ? await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} AND tenant_code = $${values.length + 2} RETURNING ${returningColumns.join(', ')}`, [...values, req.params.key, tenantCode])
        : await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} RETURNING ${returningColumns.join(', ')}`, [...values, req.params.key])
      if (result.rowCount === 0) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Record not found' })
      }
      const representativeId = result.rows[0].id
      const mobileUser = await saveRepresentativeMobileUser(client, req, representativeId, mobileCredentials)
      await syncRepresentativeMobileUserStatus(client, representativeId, result.rows[0].active !== false)
      await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'update', newValue: auditResourceRow(req.params.resource, result.rows[0]) })
      await client.query('COMMIT')
      const mobileUsername = mobileUser?.username ?? (await getRepresentativeMobileUsernames(client, [representativeId])).get(representativeId) ?? ''
      return res.json({ ...toResponseRow(result.rows[0], definition), mobileUsername })
    }
    if (req.params.resource === 'salesRepresentatives') {
      const representative = await client.query('SELECT vehicle_warehouse_code, order_warehouse_code FROM sales_representatives WHERE id = $1', [req.params.key])
      if (representative.rowCount > 0) {
        const warehouseCodes = [...new Set([representative.rows[0].vehicle_warehouse_code, representative.rows[0].order_warehouse_code].filter(Boolean))]
        if (warehouseCodes.length > 0) {
          const stock = await client.query(`
            WITH movements AS (
              SELECT e.entering_warehouse_code AS warehouse_code, l.product_code, SUM(l.total_quantity) AS quantity
              FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id
              WHERE e.entering_warehouse_code = ANY($1::text[]) AND e.cancelled_at IS NULL GROUP BY e.entering_warehouse_code, l.product_code
              UNION ALL
              SELECT e.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
              FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id
              WHERE e.exiting_warehouse_code = ANY($1::text[]) AND e.cancelled_at IS NULL GROUP BY e.exiting_warehouse_code, l.product_code
              UNION ALL
              SELECT t.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
              FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
              WHERE t.entering_warehouse_code = ANY($1::text[]) AND t.cancelled_at IS NULL GROUP BY t.entering_warehouse_code, l.product_code
              UNION ALL
              SELECT t.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
              FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
              WHERE t.exiting_warehouse_code = ANY($1::text[]) AND t.cancelled_at IS NULL GROUP BY t.exiting_warehouse_code, l.product_code
              UNION ALL
              SELECT v.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
              FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
              WHERE v.entering_warehouse_code = ANY($1::text[]) AND v.cancelled_at IS NULL GROUP BY v.entering_warehouse_code, l.product_code
              UNION ALL
              SELECT v.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
              FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id
              WHERE v.exiting_warehouse_code = ANY($1::text[]) AND v.cancelled_at IS NULL GROUP BY v.exiting_warehouse_code, l.product_code
              UNION ALL
              SELECT i.warehouse_code, l.product_code, -SUM(l.total_quantity)
              FROM sales_invoice_lines l INNER JOIN sales_invoices i ON i.id = l.invoice_id
              WHERE i.warehouse_code = ANY($1::text[]) AND i.cancelled IS NOT TRUE GROUP BY i.warehouse_code, l.product_code
            )
            SELECT warehouse_code, SUM(quantity) AS quantity FROM movements GROUP BY warehouse_code HAVING SUM(quantity) > 0
          `, [warehouseCodes])
          if (stock.rowCount > 0) return res.status(409).json({ error: 'Bu satış temsilcisine bağlı depoda stok bulunmakta. Lütfen depo stok mevcudunu sıfırlayın, daha sonra silme işlemi yapın.' })
        }
      }
      const cancelled = await client.query('UPDATE sales_representatives SET active = FALSE WHERE id = $1 RETURNING id, active', [req.params.key])
      if (cancelled.rowCount === 0) return res.status(404).json({ error: 'Satış temsilcisi bulunamadı.' })
      await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'cancel', newValue: cancelled.rows[0] })
      return res.json({ id: cancelled.rows[0].id, active: false, cancelled: true })
    }
    const result = tenantCode
      ? await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} AND tenant_code = $${values.length + 2} RETURNING ${definition.dbColumns.join(', ')}`, [...values, req.params.key, tenantCode])
      : await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} RETURNING ${definition.dbColumns.join(', ')}`, [...values, req.params.key])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found' })
    await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'update', newValue: result.rows[0] })
    const responseRow = toResponseRow(result.rows[0], definition)
    const balance = req.params.resource === 'customers' ? parseMoneyNumber(result.rows[0].balance) : 0
    const warning = req.params.resource === 'customers' && responseRow.active === false && balance > 0
      ? 'Cari pasif olarak kaydedildi; ancak bu carinin borcu bulunmaktadır.'
      : undefined
    return res.json(warning ? { ...responseRow, warning } : responseRow)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Resource update failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource update failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/data/:resource/:key', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  if (req.params.resource === 'customers' && req.header('x-vdesgo-account-type') === 'distributor') {
    return res.status(403).json({ error: 'Cari kart silme işlemi yalnızca merkez tarafından yapılabilir.' })
  }
  const keyDbColumn = definition.dbColumns[definition.columns.indexOf(definition.key)]
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'delete')
    if (req.params.resource === 'customers') {
      const factoryCard = await client.query('SELECT 1 FROM customer_cards WHERE code = $1 AND is_factory_card = TRUE', [req.params.key])
      if (factoryCard.rowCount) return res.status(403).json({ error: 'Fabrika kartı yalnızca Fabrika Kart Tanımlama ekranından silinebilir.' })
    }
    if (req.params.resource === 'warehouses') {
      await client.query('BEGIN')
      const warehouse = await client.query(
        'SELECT code FROM factory_warehouses WHERE code = $1 AND tenant_code IS NOT DISTINCT FROM $2 FOR UPDATE',
        [req.params.key, tenantCode],
      )
      if (!warehouse.rowCount) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Depo bulunamadı.' })
      }
      const stock = await client.query(
        `WITH movements AS (
          SELECT l.product_code, l.total_quantity AS quantity
          FROM other_stock_entry_lines l JOIN other_stock_entries e ON e.id = l.entry_id
          WHERE e.entering_warehouse_code = $1 AND e.tenant_code IS NOT DISTINCT FROM $2 AND e.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, -l.total_quantity
          FROM other_stock_exit_lines l JOIN other_stock_exits e ON e.id = l.exit_id
          WHERE e.exiting_warehouse_code = $1 AND e.tenant_code IS NOT DISTINCT FROM $2 AND e.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, l.total_quantity
          FROM warehouse_transfer_lines l JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.entering_warehouse_code = $1 AND t.tenant_code IS NOT DISTINCT FROM $2 AND t.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, -l.total_quantity
          FROM warehouse_transfer_lines l JOIN warehouse_transfers t ON t.id = l.transfer_id
          WHERE t.exiting_warehouse_code = $1 AND t.tenant_code IS NOT DISTINCT FROM $2 AND t.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, l.total_quantity
          FROM vehicle_loading_lines l JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.entering_warehouse_code = $1 AND v.tenant_code IS NOT DISTINCT FROM $2 AND v.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, -l.total_quantity
          FROM vehicle_loading_lines l JOIN vehicle_loadings v ON v.id = l.loading_id
          WHERE v.exiting_warehouse_code = $1 AND v.tenant_code IS NOT DISTINCT FROM $2 AND v.cancelled_at IS NULL
          UNION ALL
          SELECT l.product_code, -l.total_quantity
          FROM sales_invoice_lines l JOIN sales_invoices i ON i.id = l.invoice_id
          WHERE i.warehouse_code = $1 AND i.cancelled IS NOT TRUE
            AND (i.tenant_code IS NOT DISTINCT FROM $2 OR (i.tenant_code IS NULL AND EXISTS (
              SELECT 1 FROM customer_cards c WHERE c.code = i.customer_code AND c.tenant_code = $2
            )))
        )
        SELECT product_code FROM movements GROUP BY product_code HAVING SUM(quantity) <> 0 LIMIT 1`,
        [req.params.key, tenantCode],
      )
      if (stock.rowCount) {
        await client.query('ROLLBACK')
        return res.status(409).json({ error: 'Depo silinemez, stok mevcut.' })
      }
      await client.query(
        'DELETE FROM factory_warehouses WHERE code = $1 AND tenant_code IS NOT DISTINCT FROM $2',
        [req.params.key, tenantCode],
      )
      await recordAudit(client, req, { entityType: 'warehouses', entityId: req.params.key, action: 'delete' })
      await client.query('COMMIT')
      return res.status(204).end()
    }
    if (req.params.resource === 'salesRepresentatives') {
      await validateRepresentativeWarehouses(client, req, req.body ?? {}, null, tenantCode)
    }
    if (req.params.resource === 'salesRepresentatives') {
      const result = tenantCode
        ? await client.query('UPDATE sales_representatives SET active = FALSE WHERE id = $1 AND tenant_code = $2 RETURNING id, active', [req.params.key, tenantCode])
        : await client.query('UPDATE sales_representatives SET active = FALSE WHERE id = $1 RETURNING id, active', [req.params.key])
      if (result.rowCount === 0) return res.status(404).json({ error: 'Satış temsilcisi bulunamadı.' })
      await syncRepresentativeMobileUserStatus(client, result.rows[0].id, false)
      await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'cancel', newValue: result.rows[0] })
      return res.status(200).json(result.rows[0])
    }
    const result = tenantCode
      ? await client.query(`DELETE FROM ${definition.table} WHERE ${keyDbColumn} = $1 AND tenant_code = $2`, [req.params.key, tenantCode])
      : await client.query(`DELETE FROM ${definition.table} WHERE ${keyDbColumn} = $1`, [req.params.key])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found' })
    await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'delete' })
    return res.status(204).end()
  } catch (error) {
    if (req.params.resource === 'warehouses') {
      await client.query('ROLLBACK').catch((rollbackError) => console.error('Warehouse deletion rollback failed:', rollbackError))
    }
    console.error('Resource deletion failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource deletion failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/promotions/next-code', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query("SELECT MAX(CAST(SUBSTRING(code FROM '^MP-([0-9]+)$') AS INTEGER)) AS \"lastNumber\" FROM central_promotions")
    const nextNumber = (result.rows[0]?.lastNumber ?? 0) + 1
    return res.json({ code: `MP-${String(nextNumber).padStart(3, '0')}` })
  } catch (error) {
    console.error('Next promotion code query failed:', error)
    return res.status(500).json({ error: 'Next promotion code query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/promotions', async (req, res) => {
  const accountType = req.header('x-vdesgo-account-type')
  if (!['factory', 'distributor'].includes(accountType)) {
    return res.status(403).json({ error: 'Geçerli bir hesap türü zorunludur.' })
  }
  const requestedAudience = typeof req.query.audience === 'string' ? req.query.audience : null
  if (requestedAudience !== null && !['customer', 'factory'].includes(requestedAudience)) {
    return res.status(400).json({ error: 'Promosyon türü geçersiz.' })
  }
  const audience = accountType === 'distributor' ? 'customer' : requestedAudience
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    if (accountType === 'distributor') await getRequestTenant(client, req)
    const result = await client.query(`
      SELECT id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType",
        condition_unit AS "conditionUnit", threshold, reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority,
        start_date AS "startDate", end_date AS "endDate",
        active, customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes",
        customer_codes AS "customerCodes", product_type_codes AS "productTypeCodes",
        product_group_codes AS "productGroupCodes", product_codes AS "productCodes", created_at AS "createdAt",
        COALESCE((to_jsonb(central_promotions)->>'additional_discount_allowed')::boolean, FALSE) AS "additionalDiscountAllowed",
        COALESCE(to_jsonb(central_promotions)->>'application_mode', 'optional') AS "applicationMode",
        COALESCE(to_jsonb(central_promotions)->>'target_audience', 'customer') AS "targetAudience"
      FROM central_promotions
      WHERE $1::text IS NULL OR COALESCE(to_jsonb(central_promotions)->>'target_audience', 'customer') = $1
      ORDER BY created_at DESC NULLS LAST, id DESC
    `, [audience])
    return res.json(result.rows)
  } catch (error) {
    console.error('Promotion query failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Promotion query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/promotions', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return
  const promotion = req.body ?? {}
  if (!promotion.name || !promotion.promotionType || !promotion.conditionType || !promotion.startDate) {
    return res.status(400).json({ error: 'Name, type, condition and start date are required' })
  }
  if (!['mandatory', 'optional'].includes(promotion.applicationMode ?? 'optional')) {
    return res.status(400).json({ error: 'Promosyon uygulama türü geçersiz.' })
  }
  if (!['customer', 'factory'].includes(promotion.targetAudience ?? 'customer')) {
    return res.status(400).json({ error: 'Promosyon hedef türü geçersiz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const promotionColumns = await getAvailableResourceColumns(client, { table: 'central_promotions' })
    const supportsAdditionalDiscount = promotionColumns.has('additional_discount_allowed')
    const supportsApplicationMode = promotionColumns.has('application_mode')
    const supportsTargetAudience = promotionColumns.has('target_audience')
    if (!supportsTargetAudience) {
      return res.status(503).json({ error: 'Promosyon hedef türü için 031-promotion-target-audience migration’ı uygulanmalıdır.' })
    }
    if (promotion.additionalDiscountAllowed === true && !supportsAdditionalDiscount) {
      return res.status(503).json({ error: 'Bu ayar için mobil fiyatlandırma migration’ı uygulanmalıdır.' })
    }
    if (promotion.applicationMode === 'mandatory' && !supportsApplicationMode) {
      return res.status(503).json({ error: 'Zorunlu promosyon ayarı için 029-central-promotion-application-mode migration’ı uygulanmalıdır.' })
    }
    const codeResult = await client.query("SELECT 'MP-' || LPAD((COALESCE(MAX(CAST(SUBSTRING(code FROM '^MP-([0-9]+)$') AS INTEGER)), 0) + 1)::TEXT, 3, '0') AS code FROM central_promotions")
    const optionalColumns = ', target_audience'
      + `${supportsAdditionalDiscount ? ', additional_discount_allowed' : ''}${supportsApplicationMode ? ', application_mode' : ''}`
    const optionalValues = ', $21'
      + `${supportsAdditionalDiscount ? ', $22' : ''}${supportsApplicationMode ? `, $${22 + Number(supportsAdditionalDiscount)}` : ''}`
    const optionalReturn = `, COALESCE((to_jsonb(central_promotions)->>'additional_discount_allowed')::boolean, FALSE) AS "additionalDiscountAllowed",
      COALESCE(to_jsonb(central_promotions)->>'application_mode', 'optional') AS "applicationMode",
      COALESCE(to_jsonb(central_promotions)->>'target_audience', 'customer') AS "targetAudience"`
    const values = [
      codeResult.rows[0].code, promotion.name, promotion.promotionType, promotion.conditionType, promotion.conditionUnit || 'Adet', Number(promotion.threshold || 1),
      Number(promotion.rewardValue || 0), promotion.rewardType || 'discount', promotion.rewardProductCodes ?? [], promotion.rewardProductUnits ?? {}, Number(promotion.priority || 0), promotion.startDate, promotion.endDate || '',
      promotion.active !== false, promotion.customerTypeCodes ?? [], promotion.customerGroupCodes ?? [], promotion.customerCodes ?? [],
      promotion.productTypeCodes ?? [], promotion.productGroupCodes ?? [], promotion.productCodes ?? [],
    ]
    values.push(promotion.targetAudience || 'customer')
    if (supportsAdditionalDiscount) values.push(promotion.additionalDiscountAllowed === true)
    if (supportsApplicationMode) values.push(promotion.applicationMode || 'optional')
    const result = await client.query(`
      INSERT INTO central_promotions (
        code, name, promotion_type, condition_type, condition_unit, threshold, reward_value, reward_type, reward_product_codes, reward_product_units, priority, start_date, end_date, active,
        customer_type_codes, customer_group_codes, customer_codes, product_type_codes, product_group_codes, product_codes${optionalColumns}
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, '')::date, NULLIF($13, '')::date, $14, $15, $16, $17, $18, $19, $20${optionalValues})
      RETURNING id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType", threshold,
        condition_unit AS "conditionUnit", reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority, start_date AS "startDate", end_date AS "endDate", active,
        customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes", customer_codes AS "customerCodes",
        product_type_codes AS "productTypeCodes", product_group_codes AS "productGroupCodes", product_codes AS "productCodes"${optionalReturn}
    `, values)
    await recordAudit(client, req, { entityType: 'promotion', entityId: result.rows[0].id, action: 'create', newValue: result.rows[0] })
    return res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Promotion creation failed:', error)
    return res.status(500).json({ error: 'Promotion creation failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/promotions/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return
  const promotion = req.body ?? {}
  if (!['mandatory', 'optional'].includes(promotion.applicationMode ?? 'optional')) {
    return res.status(400).json({ error: 'Promosyon uygulama türü geçersiz.' })
  }
  if (!['customer', 'factory'].includes(promotion.targetAudience ?? 'customer')) {
    return res.status(400).json({ error: 'Promosyon hedef türü geçersiz.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const promotionColumns = await getAvailableResourceColumns(client, { table: 'central_promotions' })
    const supportsAdditionalDiscount = promotionColumns.has('additional_discount_allowed')
    const supportsApplicationMode = promotionColumns.has('application_mode')
    const supportsTargetAudience = promotionColumns.has('target_audience')
    if (!supportsTargetAudience) {
      return res.status(503).json({ error: 'Promosyon hedef türü için 031-promotion-target-audience migration’ı uygulanmalıdır.' })
    }
    if (promotion.additionalDiscountAllowed === true && !supportsAdditionalDiscount) {
      return res.status(503).json({ error: 'Bu ayar için mobil fiyatlandırma migration’ı uygulanmalıdır.' })
    }
    if (promotion.applicationMode === 'mandatory' && !supportsApplicationMode) {
      return res.status(503).json({ error: 'Zorunlu promosyon ayarı için 029-central-promotion-application-mode migration’ı uygulanmalıdır.' })
    }
    const previous = await client.query('SELECT * FROM central_promotions WHERE id = $1', [Number(req.params.id)])
    if (previous.rowCount === 0) return res.status(404).json({ error: 'Promotion not found' })
    const optionalUpdate = ', target_audience = $21'
      + `${supportsAdditionalDiscount ? ', additional_discount_allowed = $22' : ''}${supportsApplicationMode ? `, application_mode = $${22 + Number(supportsAdditionalDiscount)}` : ''}`
    const idParameter = 22 + Number(supportsAdditionalDiscount) + Number(supportsApplicationMode)
    const optionalReturn = `, COALESCE((to_jsonb(central_promotions)->>'additional_discount_allowed')::boolean, FALSE) AS "additionalDiscountAllowed",
      COALESCE(to_jsonb(central_promotions)->>'application_mode', 'optional') AS "applicationMode",
      COALESCE(to_jsonb(central_promotions)->>'target_audience', 'customer') AS "targetAudience"`
    const values = [
      promotion.code, promotion.name, promotion.promotionType, promotion.conditionType, promotion.conditionUnit || 'Adet', Number(promotion.threshold || 1),
      Number(promotion.rewardValue || 0), promotion.rewardType || 'discount', promotion.rewardProductCodes ?? [], promotion.rewardProductUnits ?? {}, Number(promotion.priority || 0), promotion.startDate, promotion.endDate || '',
      promotion.active !== false, promotion.customerTypeCodes ?? [], promotion.customerGroupCodes ?? [], promotion.customerCodes ?? [],
      promotion.productTypeCodes ?? [], promotion.productGroupCodes ?? [], promotion.productCodes ?? [],
    ]
    values.push(promotion.targetAudience || 'customer')
    if (supportsAdditionalDiscount) values.push(promotion.additionalDiscountAllowed === true)
    if (supportsApplicationMode) values.push(promotion.applicationMode || 'optional')
    values.push(Number(req.params.id))
    const result = await client.query(`
      UPDATE central_promotions SET code = $1, name = $2, promotion_type = $3, condition_type = $4, condition_unit = $5, threshold = $6,
        reward_value = $7, reward_type = $8, reward_product_codes = $9, reward_product_units = $10, priority = $11, start_date = $12, end_date = NULLIF($13, '')::date, active = $14,
        customer_type_codes = $15, customer_group_codes = $16, customer_codes = $17, product_type_codes = $18,
        product_group_codes = $19, product_codes = $20${optionalUpdate}
      WHERE id = $${idParameter}
      RETURNING id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType", threshold,
        condition_unit AS "conditionUnit", reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority, start_date AS "startDate", end_date AS "endDate", active,
        customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes", customer_codes AS "customerCodes",
        product_type_codes AS "productTypeCodes", product_group_codes AS "productGroupCodes", product_codes AS "productCodes"${optionalReturn}
    `, values)
    if (result.rowCount === 0) return res.status(404).json({ error: 'Promotion not found' })
      await recordAudit(client, req, { entityType: 'promotion', entityId: req.params.id, action: 'update', oldValue: previous.rows[0], newValue: result.rows[0] })
    return res.json(result.rows[0])
  } catch (error) {
    console.error('Promotion update failed:', error)
    return res.status(500).json({ error: 'Promotion update failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/promotions/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previous = await client.query('SELECT * FROM central_promotions WHERE id = $1', [Number(req.params.id)])
    if (previous.rowCount === 0) return res.status(404).json({ error: 'Promotion not found' })
    const result = await client.query('DELETE FROM central_promotions WHERE id = $1', [Number(req.params.id)])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Promotion not found' })
    await recordAudit(client, req, { entityType: 'promotion', entityId: req.params.id, action: 'delete', oldValue: previous.rows[0] })
    return res.status(204).end()
  } catch (error) {
    console.error('Promotion deletion failed:', error)
    return res.status(500).json({ error: 'Promotion deletion failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/access-matrix/:username', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (req.authenticatedUser?.accountType === 'factory' && !requireFactoryAdministrator(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const isFactory = req.header('x-vdesgo-account-type') === 'factory'
    const isOwnDistributorMatrix = req.header('x-vdesgo-account-type') === 'distributor'
      && req.header('x-vdesgo-username') === req.params.username
    if (!isFactory && !isOwnDistributorMatrix) {
      return res.status(403).json({ error: 'Bu erişim matrisi yalnızca merkez veya ilgili kullanıcı tarafından okunabilir.' })
    }
    if (isOwnDistributorMatrix) {
      const user = await client.query('SELECT 1 FROM distributor_users WHERE username = $1 AND status = $2', [req.params.username, 'Aktif'])
      if (user.rowCount === 0) return res.status(401).json({ error: 'Distribütör hesabı bulunamadı.' })
    }
    const result = await client.query('SELECT permissions FROM security_access_matrix WHERE username = $1', [req.params.username])
    return res.json(result.rows[0]?.permissions ?? {})
  } catch (error) {
    console.error('Access matrix query failed:', error)
    return res.status(500).json({ error: 'Access matrix query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/security/access-matrix/:username', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previous = await client.query('SELECT permissions FROM security_access_matrix WHERE username = $1', [req.params.username])
    await client.query(
      `INSERT INTO security_access_matrix (username, permissions) VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET permissions = EXCLUDED.permissions`,
      [req.params.username, req.body?.permissions ?? {}],
    )
    await recordAudit(client, req, { entityType: 'security_access_matrix', entityId: req.params.username, action: 'update', oldValue: previous.rows[0] ?? null, newValue: { permissions: req.body?.permissions ?? {} } })
    return res.status(204).end()
  } catch (error) {
    console.error('Access matrix update failed:', error)
    return res.status(500).json({ error: 'Access matrix update failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vdesgo-api' })
})

app.get('/audit-logs', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getReportTenant(client, req)
    const result = await client.query(`
      SELECT id, entity_type AS "entityType", entity_id AS "entityId", action,
        old_value AS "oldValue", new_value AS "newValue", changed_by AS "changedBy",
        host(ip_address) AS "ipAddress", changed_at AS "changedAt"
      FROM audit_logs
      WHERE tenant_code = $1
      ORDER BY changed_at DESC, id DESC
      LIMIT 5000
    `, [tenantCode])
    return res.json(result.rows)
  } catch (error) {
    console.error('Audit log query failed:', error)
    return res.status(error.statusCode || 500).json({ error: error.message || 'İşlem logları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/distributors/options', async (req, res) => {
  if (!canManageDistributorOperations(req.authenticatedUser)) {
    return res.status(403).json({ error: 'Distribütör işlemlerine erişim yetkisi gerekir.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      `SELECT DISTINCT customer_code AS "customerCode", distributor_name AS "customerName", status
       FROM distributor_users WHERE status = 'Aktif' AND customer_code IS NOT NULL
         AND tenant_code = 'D:' || customer_code ORDER BY "customerCode"`,
    )
    return res.json(result.rows)
  } catch (error) {
    console.error('Distributor options query failed:', error)
    return res.status(503).json({ error: 'Distribütör listesi alınamadı.' })
  } finally { await client.end().catch((error) => console.error('Distributor options cleanup failed:', error)) }
})

app.get('/security/audit-users', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      `SELECT customer_code AS "customerCode", distributor_name AS "customerName", username, status
       FROM distributor_users
       WHERE customer_code IS NOT NULL
       ORDER BY distributor_name, username`,
    )
    return res.json(result.rows)
  } catch (error) {
    console.error('Audit user lookup failed:', error)
    return res.status(500).json({ error: 'Log filtreleri için kullanıcılar alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/tenant-backfill-issues', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const requestedLimit = Number(req.query.limit)
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 1000)
    : 200
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const [count, issues] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS total FROM tenant_backfill_issues WHERE resolved_at IS NULL'),
      client.query(
        `SELECT table_name AS "tableName", record_id AS "recordId", reason, detected_at AS "detectedAt"
         FROM tenant_backfill_issues
         WHERE resolved_at IS NULL
         ORDER BY table_name, detected_at DESC, id
         LIMIT $1`,
        [limit],
      ),
    ])
    return res.json({ total: count.rows[0].total, issues: issues.rows })
  } catch (error) {
    console.error('Tenant backfill issue query failed:', error)
    return res.status(500).json({ error: 'Tenant eşleştirme sorunları alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/my-access', async (req, res) => {
  if (!req.authenticatedUser) return res.status(401).json({ error: 'Oturum gerekli.' })
  if (req.authenticatedUser.accountType === 'factory') {
    return res.json({
      accountType: 'factory',
      role: req.authenticatedUser.role,
      permissions: req.authenticatedUser.rolePermissions,
    })
  }
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      'SELECT permissions FROM security_access_matrix WHERE username = $1',
      [req.authenticatedUser.username],
    )
    return res.json({
      accountType: 'distributor',
      permissions: req.authenticatedUser.distributorRolePermissions ?? result.rows[0]?.permissions ?? {},
      roleManaged: Boolean(req.authenticatedUser.distributorRolePermissions),
    })
  } catch (error) {
    console.error('Current access query failed:', error)
    return res.status(500).json({ error: 'Kullanıcı erişim bilgisi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/factory-modules', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  return res.json(factoryModules)
})

app.get('/security/distributor-modules', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  return res.json(distributorModules)
})

app.get('/security/distributor-customer-options', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      `SELECT code, name, title, province, district, type, tax_no AS "taxNo"
       FROM customer_cards
        WHERE tenant_code = 'F:MAIN' AND is_factory_card = FALSE AND active = TRUE
       ORDER BY code`,
    )
    return res.json(result.rows)
  } catch (error) {
    console.error('Factory distributor customer options query failed:', error)
    return res.status(500).json({ error: 'Fabrika cari listesi alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/distributor-roles', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      `SELECT id, name, level, active, permissions_json AS "permissionsJson"
       FROM security_distributor_roles ORDER BY id`,
    )
    return res.json(result.rows.map(serializeDistributorRole))
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    console.error('Distributor roles query failed:', error)
    return res.status(500).json({ error: 'Distribütör rolleri alınamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/security/distributor-roles', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const level = typeof req.body?.level === 'string' ? req.body.level.trim() : ''
  const permissions = normalizeDistributorPermissions({
    ...req.body?.permissionsJson,
    ...(req.body?.mobileCapabilities && Object.keys(req.body.mobileCapabilities).length
      ? { MobileFieldSales: { capabilities: req.body.mobileCapabilities } }
      : {}),
  })
  if (!name || name.length > 80 || !level || level.length > 40 || req.body?.active !== true
    || !permissions || Object.keys(permissions).filter((module) => module !== 'MobileFieldSales').length !== distributorModules.length) {
    return res.status(400).json({ error: 'Geçerli rol adı, rol türü ve tüm ekranlar için izin matrisi zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(
      `INSERT INTO security_distributor_roles (name, level, active, permissions_json)
       VALUES ($1, $2, TRUE, $3::jsonb)
       RETURNING id, name, level, active, permissions_json AS "permissionsJson"`,
      [name, level, JSON.stringify(permissions)],
    )
    await recordAudit(client, req, { entityType: 'security_distributor_role', entityId: result.rows[0].id, action: 'create', newValue: result.rows[0] })
    return res.status(201).json(serializeDistributorRole(result.rows[0]))
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    if (error.code === '23505') return res.status(409).json({ error: 'Bu distribütör rolü zaten tanımlı.' })
    console.error('Distributor role creation failed:', error)
    return res.status(500).json({ error: 'Distribütör rolü oluşturulamadı.' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/security/distributor-roles/:id', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const id = Number(req.params.id)
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  const level = typeof req.body?.level === 'string' ? req.body.level.trim() : ''
  const active = req.body?.active
  const permissions = normalizeDistributorPermissions({
    ...req.body?.permissionsJson,
    ...(req.body?.mobileCapabilities && Object.keys(req.body.mobileCapabilities).length
      ? { MobileFieldSales: { capabilities: req.body.mobileCapabilities } }
      : {}),
  })
  if (!Number.isSafeInteger(id) || id < 1 || !name || name.length > 80 || !level || level.length > 40
    || typeof active !== 'boolean' || !permissions
    || Object.keys(permissions).filter((module) => module !== 'MobileFieldSales').length !== distributorModules.length) {
    return res.status(400).json({ error: 'Geçerli rol kimliği, adı, türü, durumu ve tam yetki matrisi zorunludur.' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previousResult = await client.query(
      'SELECT id, name, level, active, permissions_json AS "permissionsJson" FROM security_distributor_roles WHERE id = $1',
      [id],
    )
    if (!previousResult.rowCount) return res.status(404).json({ error: 'Distribütör rolü bulunamadı.' })
    const previous = previousResult.rows[0]
    if (!active) {
      const assigned = await client.query(
        'SELECT 1 FROM distributor_users WHERE lower(btrim(role_name)) = lower(btrim($1)) LIMIT 1',
        [previous.name],
      )
      if (assigned.rowCount) return res.status(409).json({ error: 'Bu role atanmış kullanıcılar var; rol pasifleştirilemez.' })
    }
    await client.query('BEGIN')
    if (previous.name !== name) {
      await client.query(
        'UPDATE distributor_users SET role_name = $1 WHERE lower(btrim(role_name)) = lower(btrim($2))',
        [name, previous.name],
      )
    }
    const result = await client.query(
      `UPDATE security_distributor_roles
       SET name = $1, level = $2, active = $3, permissions_json = $4::jsonb, updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, level, active, permissions_json AS "permissionsJson"`,
      [name, level, active, JSON.stringify(permissions), id],
    )
    await recordAudit(client, req, { entityType: 'security_distributor_role', entityId: id, action: 'update', oldValue: previous, newValue: result.rows[0] })
    await client.query('COMMIT')
    return res.json(serializeDistributorRole(result.rows[0]))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    if (error.code === '23505') return res.status(409).json({ error: 'Bu distribütör rolü zaten tanımlı.' })
    console.error('Distributor role update failed:', error)
    return res.status(500).json({ error: 'Distribütör rolü güncellenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/security/distributor-roles/:id', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Geçersiz rol kimliği.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const role = await client.query('SELECT id, name FROM security_distributor_roles WHERE id = $1', [id])
    if (!role.rowCount) return res.status(404).json({ error: 'Distribütör rolü bulunamadı.' })
    const assigned = await client.query(
      'SELECT 1 FROM distributor_users WHERE lower(btrim(role_name)) = lower(btrim($1)) LIMIT 1',
      [role.rows[0].name],
    )
    if (assigned.rowCount) return res.status(409).json({ error: 'Bu role atanmış kullanıcılar var; önce kullanıcıların rolünü değiştirin.' })
    await client.query('BEGIN')
    await client.query('DELETE FROM security_distributor_roles WHERE id = $1', [id])
    await recordAudit(client, req, { entityType: 'security_distributor_role', entityId: id, action: 'delete', oldValue: role.rows[0] })
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    console.error('Distributor role deletion failed:', error)
    return res.status(500).json({ error: 'Distribütör rolü silinemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.get('/security/roles', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const result = await client.query(
      `SELECT id, name, level, active, permissions,
        to_jsonb(role)->'permissions_json' AS "permissionsJson"
       FROM security_roles role ORDER BY id ASC`
    )

    const rows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      active: row.active,
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
      builtin: false,
      permissionsJson: resolveFactoryPermissions(row.name, row.permissionsJson),
    }))
    const existingNames = new Set(rows.map((row) => row.name.trim().toLocaleLowerCase('tr-TR')))
    return res.json([
      ...rows,
      ...fallbackRoles.filter((role) => !existingNames.has(role.name.trim().toLocaleLowerCase('tr-TR'))),
    ])
  } catch (error) {
    console.error('Roles query failed:', error)
    return res.status(500).json({ error: 'Roles query failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.get('/security/users', async (req, res) => {
  if (!requireFactoryAdministrator(req, res)) return
  if (!databaseUrl) {
    return res.status(503).json({ error: 'Database not configured' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const result = await client.query(
      'SELECT customer_code as "customerCode", distributor_name as "customerName", username, role_name as "role", status FROM distributor_users ORDER BY id ASC'
    )

    const rows = result.rows.map((row) => ({
      customerCode: row.customerCode ?? '',
      customerName: row.customerName,
      username: row.username,
      password: '********',
      role: row.role,
      status: row.status,
    }))

    return res.json(rows)
  } catch (error) {
    console.error('Users query failed:', error)
    return res.status(500).json({ error: 'Users query failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.get('/security/factory-users', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query('SELECT username, role_name as "role", status FROM factory_users ORDER BY id ASC')
    return res.json(result.rows.map((user) => ({ ...user, password: '********' })))
  } catch (error) {
    console.error('Factory users query failed:', error)
    return res.status(500).json({ error: 'Factory users query failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.post('/auth/login', loginRateLimit, async (req, res) => {
  const { username, password, accountType = 'distributor' } = req.body ?? {}

  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(400).json({ ok: false, error: 'Kullanıcı adı ve şifre zorunludur.' })
  }
  if (!['factory', 'distributor'].includes(accountType)) {
    return res.status(400).json({ ok: false, error: 'Geçerli hesap türü seçilmelidir.' })
  }

  if (!databaseUrl) {
    return res.status(503).json({ ok: false, error: 'Veritabanı yapılandırılmamış.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const isFactoryUser = accountType === 'factory'
    const result = await client.query(
      isFactoryUser
        ? 'SELECT id AS "userId", username, password_hash as "passwordHash", role_name as "role", status, password_change_required AS "passwordChangeRequired" FROM factory_users WHERE username = $1 AND status = $2'
        : 'SELECT id AS "userId", customer_code AS "customerCode", distributor_name as "distributor", username, password_hash as "passwordHash", role_name as "role", status, password_change_required AS "passwordChangeRequired" FROM distributor_users WHERE username = $1 AND status = $2',
      [username.trim(), 'Aktif']
    )

    if (result.rows.length === 0 || !(await verifyPassword(password, result.rows[0].passwordHash))) {
      registerLoginFailure(req)
      return res.status(401).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı.' })
    }

    const user = result.rows[0]
    if (!isFactoryUser && !user.customerCode) {
      registerLoginFailure(req)
      return res.status(401).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı.' })
    }
    if (!isFactoryUser && await hasMobileUserLink(client)) {
      const mobileOnly = await client.query('SELECT 1 FROM distributor_users WHERE id = $1 AND sales_representative_id IS NOT NULL', [user.userId])
      if (mobileOnly.rowCount > 0) {
        return res.status(403).json({ ok: false, error: 'Bu hesap yalnızca mobil satış uygulaması için tanımlıdır.' })
      }
    }
    clearLoginFailures(req)
    const sessionToken = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(sessionToken).digest('hex')
    const expiresAt = new Date(Date.now() + sessionDurationMs)
    await client.query(
      `INSERT INTO auth_sessions (token_hash, account_type, account_user_id, username, password_change_required, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tokenHash, isFactoryUser ? 'factory' : 'distributor', user.userId, user.username, user.passwordChangeRequired, expiresAt],
    )
    return res.json({
      ok: true,
      token: sessionToken,
      expiresAt: expiresAt.toISOString(),
      user: {
        username: user.username,
        distributor: isFactoryUser ? 'Fabrika Merkezi' : user.distributor,
        role: user.role,
        status: user.status,
        accountType: isFactoryUser ? 'factory' : 'distributor',
        passwordChangeRequired: user.passwordChangeRequired,
      },
    })
  } catch (error) {
    console.error('Login query failed:', error)
    return res.status(500).json({ ok: false, error: 'Giriş sırasında hata oluştu.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.post('/auth/change-password', async (req, res) => {
  const session = req.authenticatedUser
  const { password, confirmPassword } = req.body ?? {}
  if (!session?.passwordChangeRequired) return res.status(400).json({ error: 'Parola değişikliği bekleyen bir oturum bulunamadı.' })
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Yeni parola tam olarak 8 karakter olmalıdır.' })
  if (password !== confirmPassword) return res.status(400).json({ error: 'Yeni parola onayı eşleşmiyor.' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const passwordHash = await hashPassword(password)
    const result = session.accountType === 'factory'
      ? await client.query('UPDATE factory_users SET password_hash = $1, password_change_required = FALSE WHERE id = $2 AND username = $3 AND status = $4', [passwordHash, session.userId, session.username, 'Aktif'])
      : await client.query("UPDATE distributor_users SET password_hash = $1, password = '', password_change_required = FALSE WHERE id = $2 AND username = $3 AND status = $4", [passwordHash, session.userId, session.username, 'Aktif'])
    if (!result.rowCount) return res.status(401).json({ error: 'Kullanıcı artık etkin değil; yeniden giriş yapın.' })
    await client.query('UPDATE auth_sessions SET password_change_required = FALSE WHERE id = $1', [session.sessionId])
    await recordAudit(client, req, {
      entityType: `${session.accountType}_user`,
      entityId: session.username,
      action: 'mandatory_password_change',
    })
    return res.json({ ok: true })
  } catch (error) {
    console.error('Mandatory password change failed:', error)
    return res.status(500).json({ error: 'Parola değiştirilemedi.' })
  } finally {
    await client.end().catch((error) => console.error('Password change database connection cleanup failed:', error))
  }
})

app.post('/auth/logout', async (req, res) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || !databaseUrl) return res.status(204).end()
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash])
    return res.status(204).end()
  } catch (error) {
    console.error('Session logout failed:', error)
    return res.status(500).json({ error: 'Oturum kapatılamadı.' })
  } finally {
    await client.end().catch((error) => console.error('Logout database connection cleanup failed:', error))
  }
})

app.post('/security/roles', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return

  const { name, level = 'Özel rol', active = true, permissions = [], permissionsJson } = req.body ?? {}
  const roleName = typeof name === 'string' ? name.trim() : ''
  const roleLevel = typeof level === 'string' ? level.trim() : ''
  const normalizedPermissions = normalizeFactoryPermissions(permissionsJson)
  if (!roleName || roleName.length > 80 || !roleLevel || roleLevel.length > 40
    || typeof active !== 'boolean' || !Array.isArray(permissions) || !normalizedPermissions
    || Object.keys(normalizedPermissions).length === 0) {
    return res.status(400).json({ error: 'Rol adı, seviye, durum ve geçerli yetki matrisi zorunludur.' })
  }
  if (['genel müdür', 'sistem yöneticisi'].includes(roleName.toLocaleLowerCase('tr-TR'))) {
    return res.status(409).json({ error: 'Genel Müdür ve Sistem Yöneticisi ayrılmış yönetici rolleridir.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const schema = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'security_roles' AND column_name = 'permissions_json'
      ) AS available`,
    )
    if (!schema.rows[0].available) {
      return res.status(503).json({ error: 'Rol yetki şeması eksik. 004-factory-role-rbac migration uygulanmalıdır.' })
    }
    const duplicate = await client.query('SELECT 1 FROM security_roles WHERE lower(btrim(name)) = lower(btrim($1))', [roleName])
    if (duplicate.rowCount) return res.status(409).json({ error: 'Bu rol adı zaten kullanılıyor.' })
    if (!active) {
      const assigned = await client.query(
        'SELECT 1 FROM factory_users WHERE lower(btrim(role_name)) = lower(btrim($1)) LIMIT 1',
        [roleName],
      )
      if (assigned.rowCount) return res.status(409).json({ error: 'Bu role atanmış merkez kullanıcıları var; etkin olmayan rol oluşturulamaz.' })
    }
    const result = await client.query(
      `INSERT INTO security_roles (name, level, active, permissions, permissions_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, name, level, active, permissions, permissions_json AS "permissionsJson"`,
      [roleName, roleLevel, active, permissions, JSON.stringify(normalizedPermissions)],
    )
    await recordAudit(client, req, { entityType: 'security_role', entityId: result.rows[0].id, action: 'create', newValue: result.rows[0] })
    return res.status(201).json(result.rows[0])
  } catch (error) {
    console.error('Role creation failed:', error)
    return res.status(500).json({ error: 'Role creation failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.put('/security/roles/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return
  const roleId = Number(req.params.id)
  const { name, level, active, permissionsJson } = req.body ?? {}
  const roleName = typeof name === 'string' ? name.trim() : ''
  const roleLevel = typeof level === 'string' ? level.trim() : ''
  const normalizedPermissions = normalizeFactoryPermissions(permissionsJson)
  if (!Number.isSafeInteger(roleId) || roleId < 1 || !roleName || roleName.length > 80
    || !roleLevel || roleLevel.length > 40 || typeof active !== 'boolean' || !normalizedPermissions
    || Object.keys(normalizedPermissions).length === 0) {
    return res.status(400).json({ error: 'Geçerli rol kimliği, adı, seviyesi, durumu ve yetki matrisi zorunludur.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const schema = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'security_roles' AND column_name = 'permissions_json'
      ) AS available`,
    )
    if (!schema.rows[0].available) {
      return res.status(503).json({ error: 'Rol yetki şeması eksik. 004-factory-role-rbac migration uygulanmalıdır.' })
    }
    const previousResult = await client.query('SELECT id, name, level, active, permissions, permissions_json AS "permissionsJson" FROM security_roles WHERE id = $1', [roleId])
    if (!previousResult.rowCount) return res.status(404).json({ error: 'Rol bulunamadı.' })
    const previous = previousResult.rows[0]
    const previousName = previous.name.trim().toLocaleLowerCase('tr-TR')
    const nextName = roleName.toLocaleLowerCase('tr-TR')
    const isRootRole = ['genel müdür', 'sistem yöneticisi'].includes(previousName)
      || ['genel müdür', 'sistem yöneticisi'].includes(nextName)
    if (isRootRole) {
      return res.status(400).json({ error: 'Genel Müdür ve Sistem Yöneticisi rolleri ayrıcalıklıdır ve düzenlenemez.' })
    }
    const duplicate = await client.query(
      'SELECT 1 FROM security_roles WHERE lower(btrim(name)) = lower(btrim($1)) AND id <> $2',
      [roleName, roleId],
    )
    if (duplicate.rowCount) return res.status(409).json({ error: 'Bu rol adı zaten kullanılıyor.' })
    if (!active) {
      const assigned = await client.query('SELECT 1 FROM factory_users WHERE lower(btrim(role_name)) = lower(btrim($1)) LIMIT 1', [previous.name])
      if (assigned.rowCount) return res.status(409).json({ error: 'Bu role atanmış merkez kullanıcıları var; önce kullanıcıların rolünü değiştirin.' })
    }

    await client.query('BEGIN')
    if (previous.name !== roleName) {
      await client.query('UPDATE factory_users SET role_name = $1 WHERE lower(btrim(role_name)) = lower(btrim($2))', [roleName, previous.name])
    }
    const result = await client.query(
      `UPDATE security_roles
       SET name = $1, level = $2, active = $3, permissions_json = $4::jsonb
       WHERE id = $5
       RETURNING id, name, level, active, permissions, permissions_json AS "permissionsJson"`,
      [roleName, roleLevel, active, JSON.stringify(normalizedPermissions), roleId],
    )
    await recordAudit(client, req, {
      entityType: 'security_role',
      entityId: roleId,
      action: 'update',
      oldValue: previous,
      newValue: result.rows[0],
    })
    await client.query('COMMIT')
    return res.json(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Role update failed:', error)
    return res.status(500).json({ error: 'Rol güncellenemedi.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.delete('/security/roles/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return
  const roleId = Number(req.params.id)
  if (!Number.isSafeInteger(roleId) || roleId < 1) return res.status(400).json({ error: 'Geçersiz rol kimliği.' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const role = await client.query('SELECT id, name FROM security_roles WHERE id = $1', [roleId])
    if (!role.rowCount) return res.status(404).json({ error: 'Rol bulunamadı.' })
    if (['genel müdür', 'sistem yöneticisi'].includes(role.rows[0].name.trim().toLocaleLowerCase('tr-TR'))) {
      return res.status(400).json({ error: 'Ayrıcalıklı yönetici rolleri silinemez.' })
    }
    const assigned = await client.query(
      'SELECT 1 FROM factory_users WHERE lower(btrim(role_name)) = lower(btrim($1)) LIMIT 1',
      [role.rows[0].name],
    )
    if (assigned.rowCount) return res.status(409).json({ error: 'Bu role atanmış merkez kullanıcıları var; önce kullanıcıların rolünü değiştirin.' })
    await client.query('BEGIN')
    await client.query('DELETE FROM security_roles WHERE id = $1', [roleId])
    await recordAudit(client, req, { entityType: 'security_role', entityId: roleId, action: 'delete', oldValue: role.rows[0] })
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Role deletion failed:', error)
    return res.status(500).json({ error: 'Rol silinemedi.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.post('/security/users', async (req, res) => {
  if (!databaseUrl) {
    return res.status(503).json({ error: 'Database not configured' })
  }
  if (!requireFactoryAdministrator(req, res)) return

  const { customerCode, customerName, username, password, role, status = 'Aktif' } = req.body ?? {}

  if (typeof customerCode !== 'string' || !customerCode.trim() || typeof customerName !== 'string' || !customerName.trim()
    || typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password
    || typeof role !== 'string' || !role.trim() || !['Aktif', 'Pasif'].includes(status)) {
    return res.status(400).json({ error: 'Geçerli cari, kullanıcı adı, parola, rol ve hesap durumu zorunludur.' })
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Password must be exactly 8 characters.' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const customer = await client.query(
      `SELECT code, COALESCE(NULLIF(title, ''), name) AS "customerName"
       FROM customer_cards
       WHERE code = $1 AND tenant_code = 'F:MAIN' AND is_factory_card = FALSE AND active = TRUE
       FOR SHARE`,
      [customerCode.trim()],
    )
    if (!customer.rowCount) return res.status(400).json({ error: 'Aktif fabrika merkez carilerinden birini seçin.' })
    const assignedRole = await client.query(
      'SELECT active FROM security_distributor_roles WHERE lower(btrim(name)) = lower(btrim($1))',
      [role.trim()],
    )
    if (!assignedRole.rowCount || !assignedRole.rows[0].active) {
      return res.status(400).json({ error: 'Etkin bir distribütör rolü seçilmelidir.' })
    }
    const passwordHash = await hashPassword(password)
    const result = await client.query(
      `INSERT INTO distributor_users (customer_code, distributor_name, username, password, password_hash, role_name, status)
       VALUES ($1, $2, $3, '', $4, $5, $6)
       RETURNING customer_code as "customerCode", distributor_name as "customerName", username, role_name as "role", status`,
      [customer.rows[0].code, customer.rows[0].customerName, username.trim(), passwordHash, role.trim(), status]
    )
    await recordAudit(client, req, { entityType: 'distributor_user', entityId: username.trim(), action: 'create', newValue: { ...result.rows[0], password: undefined } })

    return res.status(201).json({
      ...result.rows[0],
      password: '********',
    })
  } catch (error) {
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    console.error('User creation failed:', error)
    return res.status(500).json({ error: 'Distribütör kullanıcısı oluşturulamadı.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.put('/security/distributor-users/:username/role', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return
  const username = req.params.username.trim()
  const role = typeof req.body?.role === 'string' ? req.body.role.trim() : ''
  if (!role || role.length > 80) return res.status(400).json({ error: 'Geçerli distribütör rolü zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const assignedRole = await client.query(
      'SELECT active FROM security_distributor_roles WHERE lower(btrim(name)) = lower(btrim($1))',
      [role],
    )
    if (!assignedRole.rowCount || !assignedRole.rows[0].active) {
      return res.status(400).json({ error: 'Etkin bir distribütör rolü seçilmelidir.' })
    }
    const previous = await client.query(
      'SELECT username, role_name AS role, status FROM distributor_users WHERE username = $1',
      [username],
    )
    if (!previous.rowCount) return res.status(404).json({ error: 'Distribütör kullanıcısı bulunamadı.' })
    await client.query('BEGIN')
    const updated = await client.query(
      'UPDATE distributor_users SET role_name = $1 WHERE username = $2 RETURNING username, role_name AS role, status',
      [role, username],
    )
    await client.query(
      "UPDATE auth_sessions SET revoked_at = NOW() WHERE account_type = 'distributor' AND account_user_id = (SELECT id FROM distributor_users WHERE username = $1) AND revoked_at IS NULL",
      [username],
    )
    await recordAudit(client, req, {
      entityType: 'distributor_user',
      entityId: username,
      action: 'role_change',
      oldValue: previous.rows[0],
      newValue: updated.rows[0],
    })
    await client.query('COMMIT')
    return res.json(updated.rows[0])
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error.code === '42P01') return res.status(503).json({ error: 'Distribütör rol şeması eksik. 005-distributor-role-rbac migration uygulanmalıdır.' })
    console.error('Distributor user role update failed:', error)
    return res.status(500).json({ error: 'Distribütör kullanıcı rolü güncellenemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/security/factory-users', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return

  const { username, password, role } = req.body ?? {}
  if (typeof username !== 'string' || !username.trim() || username.trim().length > 80
    || typeof password !== 'string' || !password
    || typeof role !== 'string' || !role.trim() || role.trim().length > 80) {
    return res.status(400).json({ error: 'Geçerli kullanıcı adı, parola ve rol zorunludur.' })
  }
  if (!isValidPassword(password)) return res.status(400).json({ error: 'Password must be exactly 8 characters.' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const roleName = role.trim()
    const roleDefinition = await client.query(
      'SELECT active FROM security_roles WHERE lower(btrim(name)) = lower(btrim($1)) ORDER BY id DESC LIMIT 1',
      [roleName],
    )
    if ((roleDefinition.rowCount && !roleDefinition.rows[0].active)
      || (!roleDefinition.rowCount && !factoryRoleDefaults[roleName.toLocaleLowerCase('tr-TR')])) {
      return res.status(400).json({ error: 'Seçilen merkez rolü etkin değil veya tanımlı değil.' })
    }
    const passwordHash = await hashPassword(password)
    const result = await client.query(
      'INSERT INTO factory_users (username, password_hash, role_name) VALUES ($1, $2, $3) RETURNING username, role_name as "role", status',
      [username.trim(), passwordHash, roleName]
    )
    await recordAudit(client, req, { entityType: 'factory_user', entityId: username.trim(), action: 'create', newValue: result.rows[0] })
    return res.status(201).json({ ...result.rows[0], password: '********' })
  } catch (error) {
    console.error('Factory user creation failed:', error)
    return res.status(500).json({ error: 'Factory user creation failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.put('/security/factory-users/:username/role', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return
  const username = req.params.username.trim()
  const roleName = typeof req.body?.role === 'string' ? req.body.role.trim() : ''
  if (!roleName || roleName.length > 80) return res.status(400).json({ error: 'Geçerli merkez rolü zorunludur.' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const roleDefinition = await client.query(
      'SELECT active FROM security_roles WHERE lower(btrim(name)) = lower(btrim($1)) ORDER BY id DESC LIMIT 1',
      [roleName],
    )
    if ((roleDefinition.rowCount && !roleDefinition.rows[0].active)
      || (!roleDefinition.rowCount && !factoryRoleDefaults[roleName.toLocaleLowerCase('tr-TR')])) {
      return res.status(400).json({ error: 'Seçilen merkez rolü etkin değil veya tanımlı değil.' })
    }
    const previous = await client.query('SELECT id, username, role_name AS role, status FROM factory_users WHERE username = $1', [username])
    if (!previous.rowCount) return res.status(404).json({ error: 'Merkez kullanıcısı bulunamadı.' })
    const previousRole = previous.rows[0].role.trim().toLocaleLowerCase('tr-TR')
    const nextRole = roleName.toLocaleLowerCase('tr-TR')
    if (previous.rows[0].status === 'Aktif' && ['genel müdür', 'sistem yöneticisi'].includes(previousRole)
      && !['genel müdür', 'sistem yöneticisi'].includes(nextRole)) {
      const remainingAdmins = await client.query(
        `SELECT 1 FROM factory_users
         WHERE id <> $1 AND status = 'Aktif'
           AND lower(btrim(role_name)) IN ('genel müdür', 'sistem yöneticisi')
         LIMIT 1`,
        [previous.rows[0].id],
      )
      if (!remainingAdmins.rowCount) {
        return res.status(409).json({ error: 'Etkin durumdaki son yönetici kullanıcının rolü düşürülemez.' })
      }
    }
    await client.query('BEGIN')
    const updated = await client.query(
      'UPDATE factory_users SET role_name = $1 WHERE id = $2 RETURNING id, username, role_name AS role, status',
      [roleName, previous.rows[0].id],
    )
    await client.query(
      "UPDATE auth_sessions SET revoked_at = NOW() WHERE account_type = 'factory' AND account_user_id = $1 AND revoked_at IS NULL",
      [previous.rows[0].id],
    )
    await recordAudit(client, req, {
      entityType: 'factory_user',
      entityId: username,
      action: 'role_change',
      oldValue: previous.rows[0],
      newValue: updated.rows[0],
    })
    await client.query('COMMIT')
    return res.json({ username: updated.rows[0].username, role: updated.rows[0].role, status: updated.rows[0].status })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Factory user role update failed:', error)
    return res.status(500).json({ error: 'Merkez kullanıcı rolü güncellenemedi.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.put('/security/:accountType-users/:username/password', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return

  const { accountType, username } = req.params
  const { password } = req.body ?? {}
  const table = accountType === 'factory' ? 'factory_users' : accountType === 'distributor' ? 'distributor_users' : null
  if (!table || !isValidPassword(password)) return res.status(400).json({ error: 'A valid account type and password of exactly 8 characters are required.' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const passwordHash = await hashPassword(password)
    const query = accountType === 'factory'
      ? 'UPDATE factory_users SET password_hash = $1, password_change_required = TRUE WHERE username = $2'
      : "UPDATE distributor_users SET password_hash = $1, password = '', password_change_required = TRUE WHERE username = $2"
    const result = await client.query(query, [passwordHash, username])
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' })
    await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE username = $1 AND account_type = $2 AND revoked_at IS NULL', [username, accountType])
    await recordAudit(client, req, { entityType: `${accountType}_user`, entityId: username, action: 'password_change' })
    return res.status(204).end()
  } catch (error) {
    console.error('Password update failed:', error)
    return res.status(500).json({ error: 'Password update failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.delete('/security/:accountType-users/:username', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAdministrator(req, res)) return

  const { accountType, username } = req.params
  const table = accountType === 'factory' ? 'factory_users' : accountType === 'distributor' ? 'distributor_users' : null
  if (!table) return res.status(400).json({ error: 'Valid account type is required' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previous = await client.query(`SELECT id, username, role_name AS "role", status FROM ${table} WHERE username = $1`, [username])
    if (!previous.rowCount) return res.status(404).json({ error: 'User not found' })
    if (accountType === 'factory' && previous.rows[0].status === 'Aktif'
      && ['genel müdür', 'sistem yöneticisi'].includes(previous.rows[0].role.trim().toLocaleLowerCase('tr-TR'))) {
      const remainingAdmins = await client.query(
        `SELECT 1 FROM factory_users
         WHERE username <> $1 AND status = 'Aktif'
           AND lower(btrim(role_name)) IN ('genel müdür', 'sistem yöneticisi')
         LIMIT 1`,
        [username],
      )
      if (!remainingAdmins.rowCount) {
        return res.status(409).json({ error: 'Etkin durumdaki son yönetici kullanıcısı silinemez.' })
      }
    }
    await client.query('BEGIN')
    await client.query(
      'UPDATE auth_sessions SET revoked_at = NOW() WHERE account_type = $1 AND account_user_id = $2 AND revoked_at IS NULL',
      [accountType, previous.rows[0].id],
    )
    const result = await client.query(`DELETE FROM ${table} WHERE username = $1`, [username])
    if (result.rowCount === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'User not found' })
    }
    await recordAudit(client, req, { entityType: `${accountType}_user`, entityId: username, action: 'delete', oldValue: previous.rows[0] ?? null })
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('User deletion failed:', error)
    return res.status(500).json({ error: 'User deletion failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.get('/factory/dashboard', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) {
    return res.json({
      summary: [
        { label: 'Aktif distribütör', value: '18', detail: '+2 bu ay' },
        { label: 'Merkez katalog ürünleri', value: '1.240', detail: '7 kategori' },
        { label: 'Toplam depo stok değeri', value: '₺4,8M', detail: 'Distribütör bazlı' },
        { label: 'Toplam müşteri bakiyesi', value: '₺2,1M', detail: 'Net müşteri bakiyesi' },
      ],
      products: [
        { code: 'URN-001', name: 'Krutos 60g', category: 'Atıştırmalık', unit: 'Koli', vat: '%10', ePoint: '10', volume: '0,006 L', weight: '60 gr', active: true },
        { code: 'URN-002', name: 'Krutos 100g', category: 'Atıştırmalık', unit: 'Koli', vat: '%10', ePoint: '15', volume: '0,010 L', weight: '100 gr', active: true },
      ],
      warehouses: [
        { code: 'DEP-001', name: 'Antalya Merkez Depo', type: 'Merkez Depo', active: true },
      ],
      customers: [
        { code: 'MUS-1042', name: 'ABC Market', territory: 'Antalya Merkez', salesRepresentative: 'Ahmet Yilmaz', warehouse: 'Antalya Merkez Depo', balance: '18.450,00 TL' },
      ],
      source: 'fallback-mock',

    })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)

    const [summaryResult, productResult, warehouseResult, customerResult] = await Promise.all([
      client.query('SELECT label, value, detail FROM factory_summary ORDER BY id ASC'),
      client.query('SELECT code, name, category, unit, vat, e_point as "ePoint", volume, weight, active FROM factory_products ORDER BY id ASC'),
      client.query('SELECT code, name, type, active FROM factory_warehouses WHERE tenant_code = $1 ORDER BY id ASC', [tenantCode]),
      client.query('SELECT code, name, territory, sales_representative as "salesRepresentative", warehouse, balance FROM distributor_customers WHERE tenant_code = $1 ORDER BY id ASC', [tenantCode]),
    ])

    res.json({
      summary: summaryResult.rows,
      products: productResult.rows,
      warehouses: warehouseResult.rows,
      customers: customerResult.rows,
      source: 'postgres',
    })
  } catch (error) {
    console.error('Database error:', error)
    res.status(500).json({ error: 'Database connection failed', details: String(error) })
  } finally {
    await client.end().catch(() => undefined)
  }
})

export { app, ensureAuthStorage }

if (process.env.VDESGO_FIREBASE_FUNCTION !== '1') {
  ensureAuthStorage()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`VDesgo API listening on http://localhost:${PORT}`)
      })
    })
    .catch((error) => {
      console.error('Database initialization failed:', error)
      process.exitCode = 1
    })
}
