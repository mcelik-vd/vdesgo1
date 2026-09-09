import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

dotenv.config()
pg.types.setTypeParser(1082, (value) => value)

const app = express()
const PORT = Number(process.env.PORT || 4000)
const databaseUrl = process.env.DATABASE_URL
const scrypt = promisify(scryptCallback)
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url))
const loginAttempts = new Map()

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
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_invoice_lines (
        id SERIAL PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL, product_name VARCHAR(150) NOT NULL, unit VARCHAR(50) NOT NULL,
        quantity NUMERIC(14, 3) NOT NULL, inner_quantity NUMERIC(14, 3) NOT NULL DEFAULT 1,
        total_quantity NUMERIC(14, 3) NOT NULL, unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0,
        line_total NUMERIC(14, 2) NOT NULL DEFAULT 0, is_promotional BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
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
        tenant_code VARCHAR(50),
        created_by VARCHAR(80),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (receipt_no, tenant_code)
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS other_stock_entry_lines (
        id SERIAL PRIMARY KEY,
        entry_id INTEGER NOT NULL REFERENCES other_stock_entries(id) ON DELETE CASCADE,
        product_code VARCHAR(50) NOT NULL,
        product_name VARCHAR(150) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        inner_quantity VARCHAR(50) NOT NULL DEFAULT '',
        quantity NUMERIC(12, 2) NOT NULL CHECK (quantity > 0),
        total_quantity NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_quantity > 0)
      )
    `)
    await client.query('ALTER TABLE other_stock_entry_lines ADD COLUMN IF NOT EXISTS total_quantity NUMERIC(12, 2)')
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

    const legacyUsers = await client.query("SELECT username, password FROM distributor_users WHERE password_hash IS NULL AND password <> ''")
    for (const user of legacyUsers.rows) {
      const passwordHash = await hashPassword(user.password)
      await client.query('UPDATE distributor_users SET password_hash = $1, password = \'\' WHERE username = $2', [passwordHash, user.username])
    }

    const defaultFactoryUsers = [
      { username: 'merkez_admin', password: 'merkez123', role: 'Genel Müdür' },
      { username: 'fabrika_admin', password: 'fabrika123', role: 'Üretim Müdürü' },
    ]
    for (const user of defaultFactoryUsers) {
      const exists = await client.query('SELECT 1 FROM factory_users WHERE username = $1', [user.username])
      if (exists.rowCount === 0) {
        const passwordHash = await hashPassword(user.password)
        await client.query('INSERT INTO factory_users (username, password_hash, role_name) VALUES ($1, $2, $3)', [user.username, passwordHash, user.role])
      }
    }
  } finally {
    await client.end().catch(() => undefined)
  }
}

const fallbackRoles = [
  {
    id: 'general-manager',
    name: 'Genel Müdür',
    level: 'Seviye 1',
    active: true,
    permissions: ['Tüm fabrikaya ait raporlar', 'Merkez fiyat ve ürün editörü', 'Distribütör performans izleme'],
  },
  {
    id: 'sales-manager',
    name: 'Satış Müdürü',
    level: 'Seviye 2',
    active: true,
    permissions: ['Müşteri bakiyesi takibi', 'Satış temsilcisi atama', 'Distribütör bazlı satış planı'],
  },
  {
    id: 'production-manager',
    name: 'Üretim Müdürü',
    level: 'Seviye 3',
    active: true,
    permissions: ['Üretim planlaması', 'Depo ve stok kontrol', 'Fabrika sevkiyat takibi'],
  },
]

const fallbackUsers = [
  { distributor: 'Antalya Dağıtım A.Ş.', username: 'antalya_admin', password: '********', role: 'Genel Müdür', status: 'Aktif' },
  { distributor: 'Burdur Toptan', username: 'burdur_sales', password: '********', role: 'Satış Müdürü', status: 'Aktif' },
  { distributor: 'Mersin Müşteri', username: 'mersin_prod', password: '********', role: 'Üretim Müdürü', status: 'Pasif' },
]

const factoryUsers = [
  { username: 'merkez_admin', password: 'merkez123', role: 'Merkez Fabrika Yönetimi', distributor: 'Fabrika Merkezi', status: 'Aktif' },
  { username: 'fabrika_admin', password: 'fabrika123', role: 'Merkez Fabrika Yönetimi', distributor: 'Fabrika Merkezi', status: 'Aktif' },
]

const allowedOrigins = process.env.CORS_ORIGIN?.split(',').map((origin) => origin.trim()) ?? [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://vdesgo-353a1.web.app',
]

app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json())
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  next()
})

const recordAudit = async (client, req, event) => {
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, changed_by, ip_address)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NULLIF($7, '')::inet)`,
    [event.entityType, event.entityId == null ? null : String(event.entityId), event.action,
      event.oldValue == null ? null : JSON.stringify(event.oldValue), event.newValue == null ? null : JSON.stringify(event.newValue),
      req.header('x-vdesgo-username') || null, req.ip || null],
  )
}

const requireFactoryAccount = (req, res) => {
  if (req.header('x-vdesgo-account-type') !== 'factory') {
    res.status(403).json({ error: 'Bu işlem yalnızca merkez fabrika hesabı tarafından yapılabilir.' })
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
  customers: { table: 'customer_cards', key: 'code', columns: ['code', 'name', 'title', 'province', 'district', 'type', 'territory', 'salesRepresentative', 'phone', 'mobilePhone', 'taxNo', 'taxOffice', 'address', 'location', 'areaM2', 'balance', 'customerGroupCode', 'customerDiscount1', 'customerDiscount2', 'customerDiscount3', 'cashDiscount', 'deferredDiscount', 'active'], dbColumns: ['code', 'name', 'title', 'province', 'district', 'type', 'territory', 'sales_representative', 'phone', 'mobile_phone', 'tax_no', 'tax_office', 'address', 'location', 'area_m2', 'balance', 'customer_group_code', 'customer_discount_1', 'customer_discount_2', 'customer_discount_3', 'cash_discount', 'deferred_discount', 'active'] },
  customerTypes: { table: 'customer_types', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  customerGroups: { table: 'customer_groups', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  chiefs: { table: 'sales_chiefs', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  regions: { table: 'customer_regions', key: 'code', columns: ['code', 'name', 'manager', 'description'], dbColumns: ['code', 'name', 'manager', 'description'] },
  warehouses: { table: 'factory_warehouses', key: 'code', columns: ['code', 'name', 'type', 'area', 'active'], dbColumns: ['code', 'name', 'type', 'area', 'active'] },
  products: { table: 'factory_products', key: 'code', columns: ['code', 'name', 'category', 'productType', 'unit', 'vat', 'ePoint', 'volume', 'weight', 'active'], dbColumns: ['code', 'name', 'category', 'product_type', 'unit', 'vat', 'e_point', 'volume', 'weight', 'active'] },
  productGroups: { table: 'product_groups', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  productTypes: { table: 'product_types', key: 'code', columns: ['code', 'name'], dbColumns: ['code', 'name'] },
  productUnits: { table: 'product_units', key: 'barcode', columns: ['productCode', 'unit', 'innerQuantity', 'barcode'], dbColumns: ['product_code', 'unit', 'inner_quantity', 'barcode'] },
  prices: { table: 'product_prices', key: 'id', columns: ['id', 'productCode', 'productName', 'startDate', 'endDate', 'purchasePrice', 'salesPrice', 'soundReturnPrice', 'damagedReturnPrice', 'recommendedSalesPrice', 'status'], dbColumns: ['id', 'product_code', 'product_name', 'start_date', 'end_date', 'purchase_price', 'sales_price', 'sound_return_price', 'damaged_return_price', 'recommended_sales_price', 'status'] },
  vehicles: { table: 'shipment_vehicles', key: 'plate', columns: ['plate', 'licenseNumber', 'vehicleType', 'brandModel', 'modelYear', 'capacity', 'insuranceStartDate', 'insuranceEndDate', 'cascoStartDate', 'cascoEndDate', 'lastOilMaintenanceKm', 'lastOilMaintenanceDate', 'tireChangeDate', 'tireChangeKm', 'inspectionDueDate', 'driverName', 'active'], dbColumns: ['plate', 'license_number', 'vehicle_type', 'brand_model', 'model_year', 'capacity', 'insurance_start_date', 'insurance_end_date', 'casco_start_date', 'casco_end_date', 'last_oil_maintenance_km', 'last_oil_maintenance_date', 'tire_change_date', 'tire_change_km', 'inspection_due_date', 'driver_name', 'active'] },
  salesRepresentatives: { table: 'sales_representatives', key: 'id', columns: ['id', 'name', 'phone', 'routeRegion', 'vehicleWarehouseCode', 'orderWarehouseCode', 'salesType', 'note', 'vehiclePlate', 'active'], dbColumns: ['id', 'name', 'phone', 'route_region', 'vehicle_warehouse_code', 'order_warehouse_code', 'sales_type', 'note', 'vehicle_plate', 'active'] },
}

const toApiValue = (value) => value instanceof Date ? value.toISOString().slice(0, 10) : value

const toResponseRow = (row, definition) => Object.fromEntries(
  definition.columns.map((column, index) => [column, toApiValue(row[definition.dbColumns[index]])]),
)

const normalizeResourceValue = (resource, column, value) => {
  if (resource === 'customers' && column === 'areaM2') return value === '' || value == null ? null : Number(value)
  if (resource === 'customers' && column === 'balance') return value === '' || value == null ? 0 : parseMoneyNumber(value)
  return value
}

const validatePriceDates = (body) => {
  if (!body?.startDate) return 'Fiyat başlangıç tarihi zorunludur.'
  if (body.endDate && body.endDate < body.startDate) return 'Fiyat bitiş tarihi başlangıç tarihinden önce olamaz.'
  return null
}

const accessError = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode })

const getRequestTenant = async (client, req) => {
  if (req.header('x-vdesgo-account-type') === 'factory') return null

  const username = req.header('x-vdesgo-username')
  if (!username) throw accessError('Distribütör kimliği zorunludur.', 401)

  const result = await client.query('SELECT customer_code FROM distributor_users WHERE username = $1 AND status = $2', [username, 'Aktif'])
  if (result.rowCount === 0 || !result.rows[0].customer_code) throw accessError('Distribütör hesabı bulunamadı.', 401)
  return result.rows[0].customer_code
}

const tenantResources = new Set(['customers', 'warehouses', 'vehicles', 'salesRepresentatives'])
const resourcePermissionModules = {
  customers: 'CustomerDefinition',
  warehouses: 'WarehouseDefinition',
  products: 'ProductDefinition',
  prices: 'PriceDefinition',
  vehicles: 'ShipmentDefinition',
  salesRepresentatives: 'SalesRepresentativeDefinition',
}
const roleModuleDefaults = {
  'satış müdürü': new Set(['ProductDefinition', 'PriceDefinition']),
  'üretim müdürü': new Set(['ProductDefinition', 'WarehouseDefinition', 'ShipmentDefinition']),
}

const assertResourceAccess = async (client, req, resource, action) => {
  if (req.header('x-vdesgo-account-type') === 'factory') return null

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
    const tenantCode = await getRequestTenant(client, req)
    const scope = tenantCode === null ? '' : ' AND r.tenant_code = $1'
    const params = tenantCode === null ? [] : [tenantCode]
    const result = await client.query(`SELECT a.id, a.route_day AS "routeDay", a.sales_representative_id AS "salesRepresentativeId", r.name AS "salesRepresentativeName", a.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle", c.province, c.district FROM sales_rep_customers a INNER JOIN sales_representatives r ON r.id = a.sales_representative_id INNER JOIN customer_cards c ON c.code = a.customer_code WHERE a.active = TRUE${scope} ORDER BY a.route_day, r.name, c.name`, params)
    return res.json(result.rows)
  } catch (error) { return res.status(500).json({ error: 'Rut kayıtları alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
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

app.get('/inventory/other-entries', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const entries = await client.query(`
      SELECT e.id, e.receipt_no AS "receiptNo", e.entry_date AS "entryDate",
             e.entering_warehouse_code AS "enteringWarehouseCode", w.name AS "enteringWarehouseName",
             e.tenant_code AS "tenantCode", e.created_by AS "createdBy"
      FROM other_stock_entries e
      LEFT JOIN factory_warehouses w ON w.code = e.entering_warehouse_code
      WHERE e.tenant_code IS NOT DISTINCT FROM $1
      ORDER BY e.entry_date DESC, e.receipt_no DESC
    `, [tenantCode])
    const lines = await client.query(`
      SELECT entry_id AS "entryId", product_code AS "productCode", product_name AS "productName",
             unit, inner_quantity AS "innerQuantity", quantity, total_quantity AS "totalQuantity"
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

app.get('/inventory/stock', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { warehouseCode, productCode } = req.query
  if (!warehouseCode || !productCode) return res.status(400).json({ error: 'Depo ve ürün kodu zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await getRequestTenant(client, req)
    const result = await client.query(`
      SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0)
        + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0)
        + COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.entering_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.exiting_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM sales_invoice_lines l INNER JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.warehouse_code = $1 AND l.product_code = $2), 0) AS "baseQuantity"
    `, [warehouseCode, productCode, tenantCode])
    return res.json({ warehouseCode, productCode, baseQuantity: Number(result.rows[0].baseQuantity) })
  } catch (error) {
    console.error('Stock query failed:', error)
    return res.status(500).json({ error: 'Stock query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/sales-invoices', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { invoiceNo, invoiceDate, customerCode, customerName, salesRepresentative, saleType, warehouseCode, totalAmount, lines } = req.body ?? {}
  if (!invoiceDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  const parseBalance = (value) => parseMoneyNumber(value)
  const formatBalance = (value) => formatMoney(value)
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)', [warehouseCode, tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query('SELECT balance FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [customerCode, tenantCode])
    if (customer.rowCount === 0) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    for (const line of lines) {
      const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
      const stock = await client.query(`
        SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
        + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
        + COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.entering_warehouse_code = $1 AND l.product_code = $2), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
        - COALESCE((SELECT SUM(l.total_quantity) FROM sales_invoice_lines l INNER JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.warehouse_code = $1 AND l.product_code = $2), 0) AS "baseQuantity"
      `, [warehouseCode, line.productCode])
    }
    const invoice = await client.query('INSERT INTO sales_invoices (invoice_no, invoice_date, customer_code, customer_name, sales_representative, sale_type, warehouse_code, total_amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, invoice_no AS "invoiceNo"', [invoiceNo, invoiceDate, customerCode, customerName || '', salesRepresentative || '', saleType || null, warehouseCode, Number(totalAmount || 0), req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
      await client.query('INSERT INTO sales_invoice_lines (invoice_id, product_code, product_name, unit, quantity, inner_quantity, total_quantity, unit_price, line_total, is_promotional) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [invoice.rows[0].id, line.productCode, line.productName, line.unit, Number(line.quantity), Number(line.innerQuantity || 1), totalQuantity, Number(line.unitPrice || 0), Number(line.lineTotal || 0), line.isPromotional === true])
    }
    const nextBalance = parseBalance(customer.rows[0].balance) + Number(totalAmount || 0)
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2', [formatBalance(nextBalance), customerCode])
    await recordAudit(client, req, { entityType: 'sales_invoice', entityId: invoice.rows[0].id, action: 'create', newValue: { ...invoice.rows[0], customerCode, warehouseCode, totalAmount: Number(totalAmount || 0) } })
    await client.query('COMMIT')
    return res.status(201).json({ ...invoice.rows[0], customerCode, salesRepresentative, saleType, totalAmount: Number(totalAmount || 0) })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Satış faturası kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/orders', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { orderNo, orderDate, customerCode, warehouseCode, totalAmount, stockReserved, lines } = req.body ?? {}
  if (!orderDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)', [warehouseCode, tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query('SELECT code FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [customerCode, tenantCode])
    if (customer.rowCount === 0) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const order = await client.query('INSERT INTO orders (order_no, order_date, customer_code, warehouse_code, total_amount, stock_reserved, tenant_code, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, order_no AS "orderNo"', [orderNo || null, orderDate, customerCode, warehouseCode, Number(totalAmount || 0), stockReserved === true, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
      await client.query('INSERT INTO order_lines (order_id, product_code, product_name, unit, quantity, inner_quantity, total_quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [order.rows[0].id, line.productCode, line.productName, line.unit, Number(line.quantity), Number(line.innerQuantity || 1), totalQuantity, Number(line.unitPrice || 0), Number(line.lineTotal || 0)])
    }
    if (stockReserved === true) {
      for (const line of lines) {
        const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
        const stock = await client.query(`
          SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2), 0)
          - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
          + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2), 0)
          - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
          + COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.entering_warehouse_code = $1 AND l.product_code = $2), 0)
          - COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.exiting_warehouse_code = $1 AND l.product_code = $2), 0)
          - COALESCE((SELECT SUM(l.total_quantity) FROM sales_invoice_lines l INNER JOIN sales_invoices i ON i.id = l.invoice_id WHERE i.warehouse_code = $1 AND l.product_code = $2), 0) AS "baseQuantity"
        `, [warehouseCode, line.productCode])
        const availableStock = Number(stock.rows[0].baseQuantity)
        if (availableStock < totalQuantity) throw new Error(`${line.productName} için yeterli stok bulunmuyor. Mevcut: ${availableStock}, İstenilen: ${totalQuantity}`)
      }
      const nextReceipt = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_exits WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
      const exit = await client.query('INSERT INTO other_stock_exits (receipt_no, exit_date, exiting_warehouse_code, tenant_code, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nextReceipt.rows[0].nextNumber, orderDate, warehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
      await client.query('UPDATE orders SET reservation_exit_id = $1 WHERE id = $2', [exit.rows[0].id, order.rows[0].id])
      for (const line of lines) {
        const totalQuantity = Number(line.quantity) * Number(line.innerQuantity || 1)
        await client.query('INSERT INTO other_stock_exit_lines (exit_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7)', [exit.rows[0].id, line.productCode, line.productName, line.unit, Number(line.innerQuantity || 1), Number(line.quantity), totalQuantity])
      }
    }
    await recordAudit(client, req, { entityType: 'order', entityId: order.rows[0].id, action: 'create', newValue: { ...order.rows[0], customerCode, warehouseCode, totalAmount: Number(totalAmount || 0), stockReserved: stockReserved === true } })
    await client.query('COMMIT')
    return res.status(201).json({ ...order.rows[0], customerCode, warehouseCode, totalAmount: Number(totalAmount || 0), stockReserved: stockReserved === true })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Sipariş kaydedilemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

app.delete('/orders/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const order = await client.query('SELECT id, reservation_exit_id FROM orders WHERE id = $1 AND tenant_code IS NOT DISTINCT FROM $2 FOR UPDATE', [req.params.id, tenantCode])
    if (!order.rowCount) throw new Error('Sipariş bulunamadı.')
    if (order.rows[0].reservation_exit_id) await client.query('DELETE FROM other_stock_exits WHERE id = $1', [order.rows[0].reservation_exit_id])
    await client.query('DELETE FROM orders WHERE id = $1', [req.params.id])
    await recordAudit(client, req, { entityType: config.table, entityId: header.rows[0].id, action: 'create', newValue: { ...header.rows[0], customerCode, warehouseCode, totalAmount: Number(totalAmount || 0) } })
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || 'Sipariş silinemedi.' })
  } finally { await client.end().catch(() => undefined) }
})

const parseAccountBalance = (value) => parseMoneyNumber(value)
const formatAccountBalance = (value) => formatMoney(value)

const createInboundInvoice = async (req, res, config) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const { invoiceNo, invoiceDate, customerCode, customerName, warehouseCode, totalAmount, lines, returnType } = req.body ?? {}
  if (!invoiceDate || !customerCode || !warehouseCode || !Array.isArray(lines) || lines.length === 0) return res.status(400).json({ error: 'Tarih, cari, depo ve ürün satırları zorunludur.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL)', [warehouseCode, tenantCode])
    if (warehouse.rowCount === 0) throw new Error('Depo bulunamadı veya bu kullanıcıya ait değil.')
    const customer = await client.query('SELECT balance FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [customerCode, tenantCode])
    if (!customer.rowCount) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const header = config.includeReturnType
      ? await client.query(`INSERT INTO ${config.table} (invoice_no, invoice_date, customer_code, customer_name, warehouse_code, total_amount, return_type, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, invoice_no AS "invoiceNo"`, [invoiceNo || null, invoiceDate, customerCode, customerName || '', warehouseCode, Number(totalAmount || 0), returnType === 'Bozuk' ? 'Bozuk' : 'Sağlam', req.header('x-vdesgo-username') || null])
      : await client.query(`INSERT INTO ${config.table} (invoice_no, invoice_date, customer_code, customer_name, warehouse_code, total_amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, invoice_no AS "invoiceNo"`, [invoiceNo || null, invoiceDate, customerCode, customerName || '', warehouseCode, Number(totalAmount || 0), req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const quantity = Number(line.quantity)
      const innerQuantity = Number(line.innerQuantity || 1)
      if (!line.productCode || !line.productName || !line.unit || quantity <= 0 || innerQuantity <= 0) throw new Error('Geçersiz ürün satırı.')
      await client.query(`INSERT INTO ${config.lineTable} (invoice_id, product_code, product_name, unit, quantity, inner_quantity, total_quantity, unit_price, line_total) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [header.rows[0].id, line.productCode, line.productName, line.unit, quantity, innerQuantity, quantity * innerQuantity, Number(line.unitPrice || 0), Number(line.lineTotal || 0)])
    }
    const nextReceipt = await client.query('SELECT COALESCE(MAX(receipt_no), 0) + 1 AS "nextNumber" FROM other_stock_entries WHERE tenant_code IS NOT DISTINCT FROM $1', [tenantCode])
    const entry = await client.query('INSERT INTO other_stock_entries (receipt_no, entry_date, entering_warehouse_code, tenant_code, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nextReceipt.rows[0].nextNumber, invoiceDate, warehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    await client.query(`UPDATE ${config.table} SET stock_entry_id = $1 WHERE id = $2`, [entry.rows[0].id, header.rows[0].id])
    for (const line of lines) {
      const quantity = Number(line.quantity)
      const innerQuantity = Number(line.innerQuantity || 1)
      await client.query('INSERT INTO other_stock_entry_lines (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7)', [entry.rows[0].id, line.productCode, line.productName, line.unit, String(innerQuantity), quantity, quantity * innerQuantity])
    }
    const nextBalance = parseAccountBalance(customer.rows[0].balance) + Number(config.balanceDelta) * Number(totalAmount || 0)
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2', [formatAccountBalance(nextBalance), customerCode])
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], customerCode, totalAmount: Number(totalAmount || 0) })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    return res.status(400).json({ error: error.message || `${config.label} kaydedilemedi.` })
  } finally { await client.end().catch(() => undefined) }
}

app.post('/purchase-invoices', (req, res) => createInboundInvoice(req, res, { table: 'purchase_invoices', lineTable: 'purchase_invoice_lines', balanceDelta: -1, label: 'Alış faturası' }))
app.post('/return-invoices', (req, res) => createInboundInvoice(req, res, { table: 'return_invoices', lineTable: 'return_invoice_lines', balanceDelta: -1, label: 'İade faturası', includeReturnType: true }))

app.delete('/purchase-invoices/:id', async (req, res) => {
  if (req.header('x-vdesgo-account-type') !== 'factory') return res.status(403).json({ error: 'Alış faturası silme yetkisi yalnızca merkez kullanıcılarındadır.' })
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const invoice = await client.query('SELECT id, customer_code, total_amount, stock_entry_id FROM purchase_invoices WHERE id = $1 FOR UPDATE', [req.params.id])
    if (!invoice.rowCount) throw new Error('Alış faturası bulunamadı.')
    const customer = await client.query('SELECT balance FROM customer_cards WHERE code = $1 FOR UPDATE', [invoice.rows[0].customer_code])
    const restoredBalance = parseAccountBalance(customer.rows[0].balance) + Number(invoice.rows[0].total_amount || 0)
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2', [formatAccountBalance(restoredBalance), invoice.rows[0].customer_code])
    if (invoice.rows[0].stock_entry_id) await client.query('DELETE FROM other_stock_entries WHERE id = $1', [invoice.rows[0].stock_entry_id])
    await client.query('DELETE FROM purchase_invoices WHERE id = $1', [req.params.id])
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
  const allowedTypes = ['Tahsilat', 'Bakiye Düşürme', 'Bakiye Yükseltme']
  const numericAmount = Number(amount)
  if (!customerCode || !allowedTypes.includes(operationType) || !Number.isFinite(numericAmount) || numericAmount <= 0 || (operationType !== 'Tahsilat' && !description?.trim()) || !operationDate) return res.status(400).json({ error: 'Cari, işlem türü, tarih ve tutar zorunludur; bakiye işlemlerinde açıklama gereklidir.' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); await client.query('BEGIN')
    const tenantCode = await getRequestTenant(client, req)
    const customer = await client.query('SELECT code, name, title, balance FROM customer_cards WHERE code = $1 AND (tenant_code IS NOT DISTINCT FROM $2 OR $2 IS NULL) FOR UPDATE', [customerCode, tenantCode])
    if (!customer.rowCount) throw new Error('Cari bulunamadı veya bu kullanıcıya ait değil.')
    const balanceDelta = operationType === 'Bakiye Yükseltme' ? 1 : -1
    const nextBalance = parseAccountBalance(customer.rows[0].balance) + balanceDelta * numericAmount
    await client.query('UPDATE customer_cards SET balance = $1 WHERE code = $2', [formatAccountBalance(nextBalance), customerCode])
    const operation = await client.query('INSERT INTO customer_collection_operations (customer_code, operation_type, amount, description, operation_date, balance_delta, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, operation_type AS "operationType", operation_date AS "operationDate", customer_code AS "customerCode", amount, description', [customerCode, operationType, numericAmount, description.trim(), operationDate, balanceDelta, req.header('x-vdesgo-username') || null])
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
    const tenantCode = await getRequestTenant(client, req)
    const query = tenantCode === null
      ? 'SELECT o.id, o.operation_type AS "operationType", o.operation_date AS "operationDate", o.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle", o.amount, o.description FROM customer_collection_operations o INNER JOIN customer_cards c ON c.code = o.customer_code ORDER BY o.operation_date DESC, o.id DESC'
      : 'SELECT o.id, o.operation_type AS "operationType", o.operation_date AS "operationDate", o.customer_code AS "customerCode", c.name AS "customerName", c.title AS "customerTitle", o.amount, o.description FROM customer_collection_operations o INNER JOIN customer_cards c ON c.code = o.customer_code WHERE c.tenant_code IS NOT DISTINCT FROM $1 ORDER BY o.operation_date DESC, o.id DESC'
    const params = tenantCode === null ? [] : [tenantCode]
    const result = await client.query(query, params)
    return res.json(result.rows)
  } catch (error) { return res.status(500).json({ error: 'Tahsilat kayıtları alınamadı.' }) }
  finally { await client.end().catch(() => undefined) }
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
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND active = TRUE', [exitingWarehouseCode])
    if (warehouse.rowCount === 0) throw new Error('Çıkan depo aktif olmalıdır.')
    const header = await client.query('INSERT INTO other_stock_exits (receipt_no, exit_date, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, receipt_no, exit_date, exiting_warehouse_code', [Number(receiptNo), exitDate, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      const quantity = Number(line.quantity)
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      const totalQuantity = innerQuantity * quantity
      const stock = await client.query(`SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) AS "baseQuantity"`, [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < totalQuantity) throw new Error(`${line.productName} için yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO other_stock_exit_lines (exit_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, quantity, totalQuantity])
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
    const warehouse = await client.query('SELECT code FROM factory_warehouses WHERE code = $1 AND type = $2 AND active = TRUE', [enteringWarehouseCode, 'Merkez Depo'])
    if (warehouse.rowCount === 0) throw new Error('Giren depo merkez depo olmalıdır.')
    const header = await client.query('INSERT INTO other_stock_entries (receipt_no, entry_date, entering_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, receipt_no, entry_date, entering_warehouse_code', [Number(receiptNo), entryDate, enteringWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      if (!line.productCode || !line.productName || !line.unit || !line.quantity || Number(line.quantity) <= 0) throw new Error('Geçersiz ürün satırı.')
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.'))
      if (!Number.isFinite(innerQuantity) || innerQuantity <= 0) throw new Error('Geçersiz birim içeriği.')
      const quantity = Number(line.quantity)
      await client.query('INSERT INTO other_stock_entry_lines (entry_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity || '', quantity, innerQuantity * quantity])
    }
    await client.query('COMMIT')
    return res.status(201).json({ ...header.rows[0], lines })
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error('Other stock entry creation failed:', error)
    return res.status(400).json({ error: error.message || 'Sair giriş kaydedilemedi.' })
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
      ? `SELECT v.id, v.receipt_no AS "receiptNo", v.loading_date AS "operationDate", v.entering_warehouse_code AS "enteringWarehouseCode", wi.name AS "enteringWarehouseName", v.exiting_warehouse_code AS "exitingWarehouseCode", wo.name AS "exitingWarehouseName", v.tenant_code AS "tenantCode", v.created_by AS "createdBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM vehicle_loadings v LEFT JOIN vehicle_loading_lines l ON l.loading_id = v.id LEFT JOIN factory_warehouses wi ON wi.code = v.entering_warehouse_code LEFT JOIN factory_warehouses wo ON wo.code = v.exiting_warehouse_code WHERE v.tenant_code IS NOT DISTINCT FROM $1 GROUP BY v.id, wi.name, wo.name ORDER BY v.loading_date DESC, v.receipt_no DESC`
      : operation === 'other-exits'
      ? `SELECT e.id, e.receipt_no AS "receiptNo", e.exit_date AS "operationDate", e.exiting_warehouse_code AS "exitingWarehouseCode", w.name AS "exitingWarehouseName", e.tenant_code AS "tenantCode", e.created_by AS "createdBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM other_stock_exits e LEFT JOIN other_stock_exit_lines l ON l.exit_id = e.id LEFT JOIN factory_warehouses w ON w.code = e.exiting_warehouse_code WHERE e.tenant_code IS NOT DISTINCT FROM $1 GROUP BY e.id, w.name ORDER BY e.exit_date DESC, e.receipt_no DESC`
      : operation === 'transfers'
        ? `SELECT t.id, t.receipt_no AS "receiptNo", t.transfer_date AS "operationDate", t.entering_warehouse_code AS "enteringWarehouseCode", wi.name AS "enteringWarehouseName", t.exiting_warehouse_code AS "exitingWarehouseCode", wo.name AS "exitingWarehouseName", t.tenant_code AS "tenantCode", t.created_by AS "createdBy", COALESCE(SUM(l.total_quantity), 0) AS "totalQuantity", COUNT(l.id)::int AS "lineCount", COALESCE(json_agg(json_build_object('productCode', l.product_code, 'productName', l.product_name, 'unit', l.unit, 'innerQuantity', l.inner_quantity, 'quantity', l.quantity, 'totalQuantity', l.total_quantity) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines FROM warehouse_transfers t LEFT JOIN warehouse_transfer_lines l ON l.transfer_id = t.id LEFT JOIN factory_warehouses wi ON wi.code = t.entering_warehouse_code LEFT JOIN factory_warehouses wo ON wo.code = t.exiting_warehouse_code WHERE t.tenant_code IS NOT DISTINCT FROM $1 GROUP BY t.id, wi.name, wo.name ORDER BY t.transfer_date DESC, t.receipt_no DESC`
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

app.delete('/inventory/operation-records/:operation/:id', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const tableByOperation = { 'other-entries': 'other_stock_entries', 'other-exits': 'other_stock_exits', transfers: 'warehouse_transfers', 'vehicle-loadings': 'vehicle_loadings' }
  const table = tableByOperation[req.params.operation]
  if (!table) return res.status(404).json({ error: 'Operation not found' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect(); const tenantCode = await getRequestTenant(client, req); await client.query('BEGIN')
    const result = tenantCode === null
      ? await client.query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id])
      : await client.query(`DELETE FROM ${table} WHERE id = $1 AND tenant_code = $2`, [req.params.id, tenantCode])
    if (result.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Record not found' }) }
    await client.query('COMMIT'); return res.status(204).end()
  } catch (error) { await client.query('ROLLBACK').catch(() => undefined); return res.status(500).json({ error: 'Operation deletion failed' }) }
  finally { await client.end().catch(() => undefined) }
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
    const depots = await client.query('SELECT code, type FROM factory_warehouses WHERE code = ANY($1::text[]) AND active = TRUE', [[enteringWarehouseCode, exitingWarehouseCode]])
    if (depots.rowCount !== 2 || !depots.rows.some((item) => item.code === enteringWarehouseCode && ['Araç Deposu', 'Arac Deposu'].includes(item.type))) throw new Error('Giren depo aktif bir Araç Deposu olmalıdır.')
    const header = await client.query('INSERT INTO vehicle_loadings (receipt_no, loading_date, entering_warehouse_code, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, receipt_no, loading_date, entering_warehouse_code, exiting_warehouse_code', [Number(receiptNo), loadingDate, enteringWarehouseCode, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.')); const quantity = Number(line.quantity); const totalQuantity = innerQuantity * quantity
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      const stock = await client.query('SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.entering_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM vehicle_loading_lines l INNER JOIN vehicle_loadings v ON v.id = l.loading_id WHERE v.exiting_warehouse_code = $1 AND l.product_code = $2 AND v.tenant_code IS NOT DISTINCT FROM $3), 0) AS "baseQuantity"', [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < totalQuantity) throw new Error(`${line.productName} için çıkan depoda yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO vehicle_loading_lines (loading_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, quantity, totalQuantity])
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
    const depots = await client.query('SELECT code FROM factory_warehouses WHERE code = ANY($1::text[]) AND active = TRUE', [[enteringWarehouseCode, exitingWarehouseCode]])
    if (depots.rowCount !== 2) throw new Error('İki depo da aktif olmalıdır.')
    const header = await client.query('INSERT INTO warehouse_transfers (receipt_no, transfer_date, entering_warehouse_code, exiting_warehouse_code, tenant_code, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, receipt_no, transfer_date, entering_warehouse_code, exiting_warehouse_code', [Number(receiptNo), transferDate, enteringWarehouseCode, exitingWarehouseCode, tenantCode, req.header('x-vdesgo-username') || null])
    for (const line of lines) {
      const innerQuantity = Number.parseFloat(String(line.innerQuantity || '').replace(',', '.')); const quantity = Number(line.quantity); const totalQuantity = innerQuantity * quantity
      if (!line.productCode || !line.productName || !line.unit || !Number.isFinite(innerQuantity) || innerQuantity <= 0 || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Geçersiz ürün satırı.')
      const stock = await client.query(`SELECT COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_entry_lines l INNER JOIN other_stock_entries e ON e.id = l.entry_id WHERE e.entering_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM other_stock_exit_lines l INNER JOIN other_stock_exits e ON e.id = l.exit_id WHERE e.exiting_warehouse_code = $1 AND l.product_code = $2 AND e.tenant_code IS NOT DISTINCT FROM $3), 0) + COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.entering_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0) - COALESCE((SELECT SUM(l.total_quantity) FROM warehouse_transfer_lines l INNER JOIN warehouse_transfers t ON t.id = l.transfer_id WHERE t.exiting_warehouse_code = $1 AND l.product_code = $2 AND t.tenant_code IS NOT DISTINCT FROM $3), 0) AS "baseQuantity"`, [exitingWarehouseCode, line.productCode, tenantCode])
      if (Number(stock.rows[0].baseQuantity) < totalQuantity) throw new Error(`${line.productName} için çıkan depoda yeterli stok bulunmuyor.`)
      await client.query('INSERT INTO warehouse_transfer_lines (transfer_id, product_code, product_name, unit, inner_quantity, quantity, total_quantity) VALUES ($1, $2, $3, $4, $5, $6, $7)', [header.rows[0].id, line.productCode, line.productName, line.unit, line.innerQuantity, quantity, totalQuantity])
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

app.get('/data/:resource', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'read')
    const customerColumns = req.params.resource === 'customers'
      ? definition.dbColumns.map((column) => column === 'sales_representative'
        ? `COALESCE((SELECT r.name FROM sales_rep_customers a INNER JOIN sales_representatives r ON r.id = a.sales_representative_id WHERE a.customer_code = c.code AND a.active = TRUE AND a.tenant_code IS NOT DISTINCT FROM c.tenant_code ORDER BY a.created_at DESC, a.id DESC LIMIT 1), NULLIF(c.sales_representative, '')) AS sales_representative`
        : `c.${column}`).join(', ')
      : definition.dbColumns.join(', ')
    const customerTable = req.params.resource === 'customers' ? 'customer_cards c' : definition.table
    const result = tenantCode && tenantResources.has(req.params.resource)
      ? await client.query(`SELECT ${customerColumns} FROM ${customerTable} WHERE ${req.params.resource === 'customers' ? 'c.' : ''}tenant_code = $1 ORDER BY ${req.params.resource === 'customers' ? 'c.' : ''}${definition.dbColumns[0]}`, [tenantCode])
      : await client.query(`SELECT ${customerColumns} FROM ${customerTable} ORDER BY ${req.params.resource === 'customers' ? 'c.' : ''}${definition.dbColumns[0]}`)
    return res.json(result.rows.map((row) => toResponseRow(row, definition)))
  } catch (error) {
    console.error('Resource query failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/data/:resource', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  if (req.params.resource === 'prices') {
    const dateError = validatePriceDates(req.body)
    if (dateError) return res.status(400).json({ error: dateError })
  }
  const isGeneratedKey = definition.key === 'id'
  const writeColumns = isGeneratedKey ? definition.columns.slice(1) : definition.columns
  const writeDbColumns = isGeneratedKey ? definition.dbColumns.slice(1) : definition.dbColumns
  const values = writeColumns.map((column) => normalizeResourceValue(req.params.resource, column, req.body?.[column] ?? (column === 'active' ? true : '')))
  if (!values[0]) return res.status(400).json({ error: `${definition.key} is required` })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'write')
    const placeholders = writeColumns.map((_, index) => `$${index + 1}`).join(', ')
    const result = tenantCode
      ? await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}, tenant_code) VALUES (${placeholders}, $${values.length + 1}) RETURNING ${definition.dbColumns.join(', ')}`, [...values, tenantCode])
      : await client.query(`INSERT INTO ${definition.table} (${writeDbColumns.join(', ')}) VALUES (${placeholders}) RETURNING ${definition.dbColumns.join(', ')}`, values)
    await recordAudit(client, req, { entityType: req.params.resource, entityId: result.rows[0][definition.dbColumns[0]], action: 'create', newValue: result.rows[0] })
    return res.status(201).json(toResponseRow(result.rows[0], definition))
  } catch (error) {
    console.error('Resource creation failed:', error)
    return res.status(error.statusCode ?? 500).json({ error: error.statusCode ? error.message : 'Resource creation failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.put('/data/:resource/:key', async (req, res) => {
  const definition = resourceDefinitions[req.params.resource]
  if (!definition || !databaseUrl) return res.status(404).json({ error: 'Resource not found' })
  if (req.params.resource === 'prices') {
    const dateError = validatePriceDates(req.body)
    if (dateError) return res.status(400).json({ error: dateError })
  }
  const values = definition.columns.slice(1).map((column) => normalizeResourceValue(req.params.resource, column, req.body?.[column] ?? ''))
  const updates = definition.dbColumns.slice(1).map((column, index) => `${column} = $${index + 1}`).join(', ')
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'write')
    const result = tenantCode
      ? await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} AND tenant_code = $${values.length + 2} RETURNING ${definition.dbColumns.join(', ')}`, [...values, req.params.key, tenantCode])
      : await client.query(`UPDATE ${definition.table} SET ${updates} WHERE ${definition.dbColumns[0]} = $${values.length + 1} RETURNING ${definition.dbColumns.join(', ')}`, [...values, req.params.key])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found' })
    await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'update', newValue: result.rows[0] })
    return res.json(toResponseRow(result.rows[0], definition))
  } catch (error) {
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
    const tenantCode = await assertResourceAccess(client, req, req.params.resource, 'write')
    const result = tenantCode
      ? await client.query(`DELETE FROM ${definition.table} WHERE ${keyDbColumn} = $1 AND tenant_code = $2`, [req.params.key, tenantCode])
      : await client.query(`DELETE FROM ${definition.table} WHERE ${keyDbColumn} = $1`, [req.params.key])
    if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found' })
    await recordAudit(client, req, { entityType: req.params.resource, entityId: req.params.key, action: 'delete' })
    return res.status(204).end()
  } catch (error) {
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
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query(`
      SELECT id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType",
        condition_unit AS "conditionUnit", threshold, reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority,
        start_date AS "startDate", end_date AS "endDate",
        active, customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes",
        customer_codes AS "customerCodes", product_type_codes AS "productTypeCodes",
        product_group_codes AS "productGroupCodes", product_codes AS "productCodes", created_at AS "createdAt"
      FROM central_promotions ORDER BY active DESC, priority DESC, created_at ASC
    `)
    return res.json(result.rows)
  } catch (error) {
    console.error('Promotion query failed:', error)
    return res.status(500).json({ error: 'Promotion query failed' })
  } finally { await client.end().catch(() => undefined) }
})

app.post('/promotions', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return
  const promotion = req.body ?? {}
  if (!promotion.name || !promotion.promotionType || !promotion.conditionType || !promotion.startDate) {
    return res.status(400).json({ error: 'Name, type, condition and start date are required' })
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const codeResult = await client.query("SELECT 'MP-' || LPAD((COALESCE(MAX(CAST(SUBSTRING(code FROM '^MP-([0-9]+)$') AS INTEGER)), 0) + 1)::TEXT, 3, '0') AS code FROM central_promotions")
    const result = await client.query(`
      INSERT INTO central_promotions (
        code, name, promotion_type, condition_type, condition_unit, threshold, reward_value, reward_type, reward_product_codes, reward_product_units, priority, start_date, end_date, active,
        customer_type_codes, customer_group_codes, customer_codes, product_type_codes, product_group_codes, product_codes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, '')::date, NULLIF($13, '')::date, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType", threshold,
        condition_unit AS "conditionUnit", reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority, start_date AS "startDate", end_date AS "endDate", active,
        customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes", customer_codes AS "customerCodes",
        product_type_codes AS "productTypeCodes", product_group_codes AS "productGroupCodes", product_codes AS "productCodes"
    `, [
      codeResult.rows[0].code, promotion.name, promotion.promotionType, promotion.conditionType, promotion.conditionUnit || 'Adet', Number(promotion.threshold || 1),
      Number(promotion.rewardValue || 0), promotion.rewardType || 'discount', promotion.rewardProductCodes ?? [], promotion.rewardProductUnits ?? {}, Number(promotion.priority || 0), promotion.startDate, promotion.endDate || '',
      promotion.active !== false, promotion.customerTypeCodes ?? [], promotion.customerGroupCodes ?? [], promotion.customerCodes ?? [],
      promotion.productTypeCodes ?? [], promotion.productGroupCodes ?? [], promotion.productCodes ?? [],
    ])
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
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previous = await client.query('SELECT * FROM central_promotions WHERE id = $1', [Number(req.params.id)])
    if (previous.rowCount === 0) return res.status(404).json({ error: 'Promotion not found' })
    const result = await client.query(`
      UPDATE central_promotions SET code = $1, name = $2, promotion_type = $3, condition_type = $4, condition_unit = $5, threshold = $6,
        reward_value = $7, reward_type = $8, reward_product_codes = $9, reward_product_units = $10, priority = $11, start_date = $12, end_date = NULLIF($13, '')::date, active = $14,
        customer_type_codes = $15, customer_group_codes = $16, customer_codes = $17, product_type_codes = $18,
        product_group_codes = $19, product_codes = $20
      WHERE id = $21
      RETURNING id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType", threshold,
        condition_unit AS "conditionUnit", reward_value AS "rewardValue", reward_type AS "rewardType", reward_product_codes AS "rewardProductCodes", reward_product_units AS "rewardProductUnits", priority, start_date AS "startDate", end_date AS "endDate", active,
        customer_type_codes AS "customerTypeCodes", customer_group_codes AS "customerGroupCodes", customer_codes AS "customerCodes",
        product_type_codes AS "productTypeCodes", product_group_codes AS "productGroupCodes", product_codes AS "productCodes"
    `, [
      promotion.code, promotion.name, promotion.promotionType, promotion.conditionType, promotion.conditionUnit || 'Adet', Number(promotion.threshold || 1),
      Number(promotion.rewardValue || 0), promotion.rewardType || 'discount', promotion.rewardProductCodes ?? [], promotion.rewardProductUnits ?? {}, Number(promotion.priority || 0), promotion.startDate, promotion.endDate || '',
      promotion.active !== false, promotion.customerTypeCodes ?? [], promotion.customerGroupCodes ?? [], promotion.customerCodes ?? [],
        promotion.productTypeCodes ?? [], promotion.productGroupCodes ?? [], promotion.productCodes ?? [], Number(req.params.id),
    ])
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
  if (!requireFactoryAccount(req, res)) return
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

app.get('/security/roles', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
  if (!databaseUrl) {
    return res.json(fallbackRoles)
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const result = await client.query(
      'SELECT id, name, level, active, permissions FROM security_roles ORDER BY id ASC'
    )

    const rows = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      level: row.level,
      active: row.active,
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
    }))

    return res.json(rows.length > 0 ? rows : fallbackRoles)
  } catch (error) {
    console.error('Roles query failed:', error)
    return res.json(fallbackRoles)
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.get('/security/users', async (req, res) => {
  if (!requireFactoryAccount(req, res)) return
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
  if (!requireFactoryAccount(req, res)) return

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const result = await client.query('SELECT username, role_name as "role" FROM factory_users ORDER BY id ASC')
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

  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Kullanıcı adı ve şifre zorunludur.' })
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
        ? 'SELECT username, password_hash as "passwordHash", role_name as "role", status FROM factory_users WHERE username = $1 AND status = $2'
        : 'SELECT distributor_name as "distributor", username, password_hash as "passwordHash", role_name as "role", status FROM distributor_users WHERE username = $1 AND status = $2',
      [username, 'Aktif']
    )

    if (result.rows.length === 0 || !(await verifyPassword(password, result.rows[0].passwordHash))) {
      registerLoginFailure(req)
      return res.status(401).json({ ok: false, error: 'Kullanıcı adı veya şifre hatalı.' })
    }

    const user = result.rows[0]
    clearLoginFailures(req)
    return res.json({
      ok: true,
      user: {
        username: user.username,
        distributor: isFactoryUser ? 'Fabrika Merkezi' : user.distributor,
        role: user.role,
        status: user.status,
        accountType: isFactoryUser ? 'factory' : 'distributor',
      },
    })
  } catch (error) {
    console.error('Login query failed:', error)
    return res.status(500).json({ ok: false, error: 'Giriş sırasında hata oluştu.' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.post('/security/roles', async (req, res) => {
  if (!databaseUrl) {
    return res.status(503).json({ error: 'Database not configured' })
  }
  if (!requireFactoryAccount(req, res)) return

  const { name, level, active = true, permissions = [] } = req.body ?? {}

  if (!name || !level) {
    return res.status(400).json({ error: 'name and level are required' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const result = await client.query(
      `INSERT INTO security_roles (name, level, active, permissions)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, level, active, permissions`,
      [name, level, Boolean(active), Array.isArray(permissions) ? permissions : []]
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

app.post('/security/users', async (req, res) => {
  if (!databaseUrl) {
    return res.status(503).json({ error: 'Database not configured' })
  }
  if (!requireFactoryAccount(req, res)) return

  const { customerCode, customerName, username, password, role, status = 'Aktif' } = req.body ?? {}

  if (!customerCode || !customerName || !username || !password || !role) {
    return res.status(400).json({ error: 'customerCode, customerName, username, password and role are required' })
  }

  const client = new pg.Client({ connectionString: databaseUrl })

  try {
    await client.connect()
    const passwordHash = await hashPassword(password)
    const result = await client.query(
      `INSERT INTO distributor_users (customer_code, distributor_name, username, password, password_hash, role_name, status)
       VALUES ($1, $2, $3, '', $4, $5, $6)
       RETURNING customer_code as "customerCode", distributor_name as "customerName", username, role_name as "role", status`,
      [customerCode, customerName, username, passwordHash, role, status]
    )
    await recordAudit(client, req, { entityType: 'distributor_user', entityId: username, action: 'create', newValue: { ...result.rows[0], password: undefined } })

    return res.status(201).json({
      ...result.rows[0],
      password: '********',
    })
  } catch (error) {
    console.error('User creation failed:', error)
    return res.status(500).json({ error: 'User creation failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.post('/security/factory-users', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return

  const { username, password, role } = req.body ?? {}
  if (!username || !password || !role) return res.status(400).json({ error: 'username, password and role are required' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const passwordHash = await hashPassword(password)
    const result = await client.query(
      'INSERT INTO factory_users (username, password_hash, role_name) VALUES ($1, $2, $3) RETURNING username, role_name as "role"',
      [username, passwordHash, role]
    )
    await recordAudit(client, req, { entityType: 'factory_user', entityId: username, action: 'create', newValue: result.rows[0] })
    return res.status(201).json({ ...result.rows[0], password: '********' })
  } catch (error) {
    console.error('Factory user creation failed:', error)
    return res.status(500).json({ error: 'Factory user creation failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.put('/security/:accountType-users/:username/password', async (req, res) => {
  if (!databaseUrl) return res.status(503).json({ error: 'Database not configured' })
  if (!requireFactoryAccount(req, res)) return

  const { accountType, username } = req.params
  const { password } = req.body ?? {}
  const table = accountType === 'factory' ? 'factory_users' : accountType === 'distributor' ? 'distributor_users' : null
  if (!table || !password) return res.status(400).json({ error: 'Valid account type and password are required' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const passwordHash = await hashPassword(password)
    const query = accountType === 'factory'
      ? 'UPDATE factory_users SET password_hash = $1 WHERE username = $2'
      : "UPDATE distributor_users SET password_hash = $1, password = '' WHERE username = $2"
    const result = await client.query(query, [passwordHash, username])
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' })
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
  if (!requireFactoryAccount(req, res)) return

  const { accountType, username } = req.params
  const table = accountType === 'factory' ? 'factory_users' : accountType === 'distributor' ? 'distributor_users' : null
  if (!table) return res.status(400).json({ error: 'Valid account type is required' })

  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const previous = await client.query(`SELECT username, role_name AS "role" FROM ${table} WHERE username = $1`, [username])
    const result = await client.query(`DELETE FROM ${table} WHERE username = $1`, [username])
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' })
    await recordAudit(client, req, { entityType: `${accountType}_user`, entityId: username, action: 'delete', oldValue: previous.rows[0] ?? null })
    return res.status(204).end()
  } catch (error) {
    console.error('User deletion failed:', error)
    return res.status(500).json({ error: 'User deletion failed' })
  } finally {
    await client.end().catch(() => undefined)
  }
})

app.get('/factory/dashboard', async (_req, res) => {
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

    const [summaryResult, productResult, warehouseResult, customerResult] = await Promise.all([
      client.query('SELECT label, value, detail FROM factory_summary ORDER BY id ASC'),
      client.query('SELECT code, name, category, unit, vat, e_point as "ePoint", volume, weight, active FROM factory_products ORDER BY id ASC'),
      client.query('SELECT code, name, type, active FROM factory_warehouses ORDER BY id ASC'),
      client.query('SELECT code, name, territory, sales_representative as "salesRepresentative", warehouse, balance FROM distributor_customers ORDER BY id ASC'),
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
