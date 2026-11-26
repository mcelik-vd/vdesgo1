import express from 'express'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import { submitOrder } from '../services/order-application-service.js'
import {
  cancelMobileSalesInvoice,
  markMobileSalesInvoicePrinted,
  reverseSalesInvoiceCustomerBalance,
  replaceMobileSalesInvoice,
  submitSalesInvoice,
} from '../services/sales-invoice-application-service.js'
import {
  evaluateOrderSubmission,
  lookupPriceCandidates,
  resolveUnitPriceFromCandidates,
} from '../services/pricing-service.js'
import { resolveMobileCapabilities } from '../services/distributor-access.js'
import { normalizeCreditLimit, openOrderCreditSql } from '../services/customer-credit-service.js'

const SESSION_DURATION_MS = 12 * 60 * 60 * 1000
const MOBILE_TOKEN_PREFIX = 'vdesgo_mobile_v1_'
const MAX_SYNC_BATCH_SIZE = 50
const MAX_PAGE_SIZE = 100
const MAX_PULL_SIZE = 200
const MOBILE_CAPABILITIES = new Set([
  'mobile.login',
  'mobile.sync',
  'mobile.customer.read',
  'mobile.route.read',
  'mobile.visit.create',
  'mobile.visit.complete',
  'mobile.order.create',
  'mobile.order.read',
  'mobile.collection.create',
])
const loginAttempts = new Map()
const writeAttempts = new Map()

export const canonicalizePayload = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalizePayload).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalizePayload(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const hashPayload = (value) => createHash('sha256').update(canonicalizePayload(value)).digest('hex')

export const detectRouteStops = (points, radiusM = 30, minimumSeconds = 120) => {
  const ordered = [...points]
    .filter((point) => Number.isFinite(Number(point.latitude))
      && Number.isFinite(Number(point.longitude))
      && Number.isFinite(new Date(point.recordedAt).getTime()))
    .sort((left, right) => new Date(left.recordedAt) - new Date(right.recordedAt))
  const stops = []
  let startIndex = 0
  while (startIndex < ordered.length) {
    const anchor = ordered[startIndex]
    let endIndex = startIndex
    let nextIndex = startIndex + 1
    while (nextIndex < ordered.length
      && distanceMeters(
        Number(anchor.latitude),
        Number(anchor.longitude),
        Number(ordered[nextIndex].latitude),
        Number(ordered[nextIndex].longitude),
      ) <= radiusM) {
      endIndex = nextIndex
      nextIndex += 1
    }
    if (endIndex > startIndex) {
      const cluster = ordered.slice(startIndex, endIndex + 1)
      const durationSeconds = Math.floor(
        (new Date(cluster.at(-1).recordedAt).getTime() - new Date(cluster[0].recordedAt).getTime()) / 1000,
      )
      if (durationSeconds >= minimumSeconds) {
        const latitude = cluster.reduce((sum, point) => sum + Number(point.latitude), 0) / cluster.length
        const longitude = cluster.reduce((sum, point) => sum + Number(point.longitude), 0) / cluster.length
        const maxDistanceM = Math.max(...cluster.map((point) => distanceMeters(
          latitude,
          longitude,
          Number(point.latitude),
          Number(point.longitude),
        )))
        stops.push({
          startedAt: cluster[0].recordedAt,
          endedAt: cluster.at(-1).recordedAt,
          durationSeconds,
          latitude,
          longitude,
          radiusM: Math.min(radiusM, maxDistanceM),
          pointCount: cluster.length,
        })
      }
    }
    startIndex = nextIndex
  }
  return stops
}

const refreshRouteStops = async (client, context, workday) => {
  const result = await client.query(
    `SELECT recorded_at AS "recordedAt", latitude::float8 AS latitude,
       longitude::float8 AS longitude
     FROM mobile_route_points
     WHERE tenant_code = $1 AND sales_representative_id = $2 AND work_session_id = $3
     ORDER BY recorded_at, id`,
    [context.tenantCode, context.salesRepresentativeId, workday.id],
  )
  const stops = detectRouteStops(result.rows)
  await client.query('DELETE FROM mobile_route_stops WHERE work_session_id = $1', [workday.id])
  for (const stop of stops) {
    await client.query(
      `INSERT INTO mobile_route_stops
         (id, tenant_code, sales_representative_id, work_session_id, business_date,
          started_at, ended_at, duration_seconds, latitude, longitude, radius_m, point_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        randomUUID(), context.tenantCode, context.salesRepresentativeId, workday.id,
        workday.businessDate, stop.startedAt, stop.endedAt, stop.durationSeconds,
        stop.latitude, stop.longitude, stop.radiusM, stop.pointCount,
      ],
    )
  }
}

export const validateMobileCollectionPayload = (payload, today = dateInIstanbul()) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const { customerCode, amount, operationDate, description = '' } = payload
  if (typeof customerCode !== 'string' || !customerCode.trim() || customerCode.length > 50
    || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
    || typeof operationDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(operationDate)
    || typeof description !== 'string' || description.length > 500) return false
  const parsedDate = new Date(`${operationDate}T00:00:00.000Z`)
  return Number.isFinite(parsedDate.getTime())
    && parsedDate.toISOString().slice(0, 10) === operationDate
    && operationDate === today
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const validUuid = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const asPositiveInteger = (value, fallback, maximum) => {
  if (value == null || value === '') return fallback
  if (!/^\d+$/.test(String(value))) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : null
}
const asCursor = (value) => {
  if (value == null || value === '') return 0
  if (!/^\d+$/.test(String(value))) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}
const dayInIstanbul = () => new Intl.DateTimeFormat('tr-TR', { weekday: 'long', timeZone: 'Europe/Istanbul' }).format(new Date())
const dateInIstanbul = () => {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}
const routeDays = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar']
const provinceDistricts = {
  Antalya: ['Akseki', 'Alanya', 'Kemer', 'Kepez', 'Konyaaltı', 'Manavgat', 'Muratpaşa', 'Serik'],
  Burdur: ['Bucak', 'Gölhisar', 'Merkez', 'Tefenni'],
  İzmir: ['Bornova', 'Buca', 'Karşıyaka', 'Konak', 'Urla'],
}
const safeCoordinate = (value, min, max) => {
  if (value == null || value === '') return null
  if (!['number', 'string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return undefined
  const coordinate = Number(value)
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : undefined
}
export const distanceMeters = (firstLatitude, firstLongitude, secondLatitude, secondLongitude) => {
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(secondLatitude - firstLatitude)
  const longitudeDelta = radians(secondLongitude - firstLongitude)
  const firstRadians = radians(firstLatitude)
  const secondRadians = radians(secondLatitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstRadians) * Math.cos(secondRadians) * Math.sin(longitudeDelta / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

const publicError = (res, status, code, message, details) => res.status(status).json({
  error: { code, message, ...(details ? { details } : {}) },
})

const isMissingMobileMigration = (error) => error?.code === '42P01' || error?.code === '42703'
export const classifyMobileSyncException = (error) => {
  if (error?.code === '23505') return { status: 'rejected', code: 'DUPLICATE_TAX_NUMBER' }
  if (error?.code === '23514') return { status: 'rejected', code: 'VALIDATION_ERROR' }
  if (error?.code === '23502') return { status: 'rejected', code: 'VALIDATION_ERROR' }
  if (error?.code === '23503') return { status: 'rejected', code: 'RELATED_RECORD_NOT_FOUND' }
  if (error?.code === '40P01' || error?.code === '40001') return { status: 'retry', code: 'DATABASE_CONFLICT' }
  if (error?.code === '08006' || error?.code === '08001' || error?.code === '57P01') return { status: 'retry', code: 'DATABASE_CONNECTION_LOST' }
  return { status: 'retry', code: `RETRYABLE_DATABASE_${error?.code || 'UNKNOWN'}` }
}
const respondForDatabaseError = (res, error, message = 'İşlem şu anda tamamlanamadı.') => {
  if (isMissingMobileMigration(error)) {
    return publicError(res, 503, 'MOBILE_MIGRATION_REQUIRED', 'Mobil backend veritabanı geçişi henüz uygulanmamış.')
  }
  console.error('Mobile API database operation failed:', error)
  return publicError(res, 500, 'SERVER_ERROR', message)
}

const auditMobile = async (client, req, {
  entityType,
  entityId,
  action,
  username,
  tenantCode = null,
  representativeId = null,
  deviceId = null,
  result = null,
}) => {
  const event = {
    tenantCode,
    representativeId,
    deviceId,
    result,
  }
  await client.query(
    `INSERT INTO audit_logs (entity_type, entity_id, action, new_value, changed_by, ip_address, tenant_code)
     VALUES ($1, $2, $3, $4::jsonb, $5, NULLIF($6, '')::inet, $7)`,
    [entityType, entityId == null ? null : String(entityId), action, JSON.stringify(event), username || null, req.ip || null, tenantCode],
  )
}

const auditAuthorizationDenial = (client, req, context, entityId, reason) => auditMobile(client, req, {
  entityType: 'mobile_authorization',
  entityId,
  action: 'denied',
  username: context.username,
  tenantCode: context.tenantCode,
  representativeId: context.salesRepresentativeId,
  deviceId: context.deviceId,
  result: reason,
})

const getMobileContext = async (client, req) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
  const deviceProof = req.header('x-mobile-device-proof')
  if (!token?.startsWith(MOBILE_TOKEN_PREFIX) || !deviceProof || deviceProof.length < 32) return null
  const tokenHash = sha256(token)
  const proofHash = sha256(deviceProof)
  const result = await client.query(
    `SELECT s.id AS session_id, u.id AS user_id, u.username, u.role_name,
       u.tenant_code, u.sales_representative_id,
       r.name AS representative_name, d.id AS device_id, d.platform, d.app_version,
       d.device_secret_hash,
       m.permissions, dr.permissions_json->'MobileFieldSales' AS role_mobile_access
     FROM auth_sessions s
     INNER JOIN mobile_session_devices sd ON sd.auth_session_id = s.id
     INNER JOIN mobile_devices d ON d.id = sd.device_id
     INNER JOIN distributor_users u ON u.id = s.account_user_id
       AND u.username = s.username AND u.status = 'Aktif'
     INNER JOIN sales_representatives r ON r.id = d.sales_representative_id
       AND r.tenant_code = d.tenant_code AND r.active = TRUE
     LEFT JOIN security_access_matrix m ON m.username = u.username
     LEFT JOIN security_distributor_roles dr ON lower(btrim(dr.name)) = lower(btrim(u.role_name)) AND dr.active = TRUE
     WHERE s.token_hash = $1 AND s.account_type = 'distributor'
       AND s.revoked_at IS NULL AND s.expires_at > NOW()
       AND d.status = 'active'
       AND d.distributor_user_id = u.id AND d.tenant_code = u.tenant_code
       AND d.sales_representative_id = u.sales_representative_id
     LIMIT 1`,
    [tokenHash],
  )
  if (!result.rowCount) return null
  const row = result.rows[0]
  const storedProofHash = Buffer.from(row.device_secret_hash, 'utf8')
  const suppliedProofHash = Buffer.from(proofHash, 'utf8')
  if (storedProofHash.length !== suppliedProofHash.length
    || !timingSafeEqual(storedProofHash, suppliedProofHash)) return null
  const mobileAccess = resolveMobileCapabilities(row.permissions ?? {}, {
    MobileFieldSales: row.role_mobile_access ?? {},
  })
  if (mobileAccess.visible === false || mobileAccess.capabilities['mobile.login'] !== true) return null
  const capabilities = Object.fromEntries(
    [...MOBILE_CAPABILITIES].map((capability) => [capability, mobileAccess.capabilities[capability] === true]),
  )
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    username: row.username,
    role: row.role_name,
    tenantCode: row.tenant_code,
    salesRepresentativeId: row.sales_representative_id,
    salesRepresentativeName: row.representative_name,
    deviceId: row.device_id,
    platform: row.platform,
    appVersion: row.app_version,
    capabilities,
  }
}

const withMobileContext = (databaseUrl, capability, handler) => async (req, res) => {
  if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
  if (!req.authenticatedUser || req.authenticatedUser.accountType !== 'distributor') {
    return publicError(res, 401, 'AUTH_REQUIRED', 'Mobil distribütör oturumu gerekli.')
  }
  const client = new pg.Client({ connectionString: databaseUrl })
  try {
    await client.connect()
    const context = await getMobileContext(client, req)
    if (!context) {
      const token = req.header('authorization')?.replace(/^Bearer\s+/i, '')
      const session = token?.startsWith('vdesgo_mobile_v1_')
        ? await client.query(
          `SELECT s.id, s.username, sd.device_id, d.tenant_code, d.sales_representative_id
           FROM auth_sessions s
           LEFT JOIN mobile_session_devices sd ON sd.auth_session_id = s.id
           LEFT JOIN mobile_devices d ON d.id = sd.device_id
           WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > NOW()
           LIMIT 1`,
          [sha256(token)],
        )
        : { rows: [] }
      if (session.rows[0]) {
        await auditMobile(client, req, {
          entityType: 'mobile_authorization',
          entityId: session.rows[0].device_id,
          action: 'device_authorization_failed',
          username: session.rows[0].username,
          tenantCode: session.rows[0].tenant_code,
          representativeId: session.rows[0].sales_representative_id,
          deviceId: session.rows[0].device_id,
          result: 'rejected',
        })
      }
      return publicError(res, 401, 'DEVICE_REVOKED', 'Mobil oturum veya cihaz geçersiz.')
    }
    if (!context.capabilities['mobile.login']) {
      await auditAuthorizationDenial(client, req, context, capability ?? 'mobile.login', 'capability_missing')
      return publicError(res, 403, 'FORBIDDEN', 'Mobil erişim yetkiniz yok.')
    }
    if (capability && !context.capabilities[capability]) {
      await auditAuthorizationDenial(client, req, context, capability, 'capability_missing')
      return publicError(res, 403, 'FORBIDDEN', 'Bu mobil işlem için yetkiniz yok.')
    }
    await client.query('UPDATE mobile_devices SET last_seen_at = NOW() WHERE id = $1', [context.deviceId])
    return await handler({ req, res, client, context })
  } catch (error) {
    return respondForDatabaseError(res, error)
  } finally {
    await client.end().catch((error) => console.error('Mobile database connection cleanup failed:', error))
  }
}

const rateLimit = (store, keyFor, maxAttempts, windowMs) => (req, res, next) => {
  const key = keyFor(req)
  const now = Date.now()
  const current = store.get(key)
  if (!current || now - current.startedAt >= windowMs) {
    store.set(key, { startedAt: now, count: 1 })
    return next()
  }
  if (current.count >= maxAttempts) {
    return publicError(res, 429, 'RATE_LIMITED', 'Çok sık istek gönderildi. Bir süre sonra yeniden deneyin.')
  }
  current.count += 1
  return next()
}

const mobileLoginRateLimit = rateLimit(
  loginAttempts,
  (req) => `${req.ip}:${String(req.body?.username || '').toLocaleLowerCase('tr-TR')}`,
  5,
  15 * 60 * 1000,
)
const mobileWriteRateLimit = rateLimit(
  writeAttempts,
  (req) => `${req.ip}:${req.authenticatedUser?.sessionId || 'unknown'}`,
  60,
  60 * 1000,
)
const mobileSyncRateLimit = rateLimit(
  writeAttempts,
  (req) => `sync:${req.ip}:${req.authenticatedUser?.sessionId || 'unknown'}`,
  120,
  60 * 1000,
)
const mobileRequestRateLimit = rateLimit(
  writeAttempts,
  (req) => `api:${req.ip}:${req.authenticatedUser?.sessionId || 'unknown'}`,
  300,
  60 * 1000,
)

const isFactoryAdministrator = (req, res) => {
  const account = req.authenticatedUser
  if (account?.accountType !== 'factory') {
    publicError(res, 403, 'FORBIDDEN', 'Bu işlem yalnızca merkez yöneticisi tarafından yapılabilir.')
    return false
  }
  const role = account.role?.trim().toLocaleLowerCase('tr-TR')
  if (!['genel müdür', 'sistem yöneticisi'].includes(role)) {
    publicError(res, 403, 'FORBIDDEN', 'Bu işlem için Genel Müdür veya Sistem Yöneticisi yetkisi gerekir.')
    return false
  }
  return true
}

const isDeviceAdministrator = (req, res, action) => {
  if (req.authenticatedUser?.accountType === 'factory') return isFactoryAdministrator(req, res)
  const account = req.authenticatedUser
  const permission = account?.distributorRolePermissions?.MobileDeviceApprovals
    ?? account?.distributorAccessMatrix?.MobileDeviceApprovals
  if (account?.accountType !== 'distributor' || !account.customerCode
    || !permission?.visible || permission.actions?.view !== true
    || (action === 'manage' && permission.actions?.edit !== true)) {
    publicError(res, 403, 'FORBIDDEN', 'Mobil cihaz işlemi için kendi distribütör hesabınızda görüntüleme ve düzenleme yetkisi gerekir.')
    return false
  }
  return true
}

const asPublicDevice = (row) => ({
  id: row.id,
  username: row.username,
  distributorName: row.distributor_name,
  tenantCode: row.tenant_code,
  salesRepresentativeId: row.sales_representative_id,
  salesRepresentativeName: row.representative_name,
  platform: row.platform,
  appVersion: row.app_version,
  status: row.status,
  registeredAt: row.registered_at,
  approvedAt: row.approved_at,
  approvedBy: row.approved_by,
  lastSeenAt: row.last_seen_at,
  lastSyncAt: row.last_sync_at,
  revokedAt: row.revoked_at,
  revokedBy: row.revoked_by,
})

const assertAssignedCustomer = async (client, context, customerCode) => {
  const result = await client.query(
    `SELECT c.code, c.name, c.title, c.province, c.district, c.type, c.territory,
       c.phone, c.mobile_phone, c.address, c.location, c.tax_no, c.tckn, c.tax_office, c.balance, c.active,
       c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount",
       c.location_latitude::float8 AS "locationLatitude",
       c.location_longitude::float8 AS "locationLongitude",
       c.location_accuracy_m::float8 AS "locationAccuracyM",
       c.location_captured_at AS "locationCapturedAt",
       c.customer_discount_1 AS "customerDiscount1",
       c.customer_discount_2 AS "customerDiscount2",
       c.customer_discount_3 AS "customerDiscount3",
       c.cash_discount AS "cashDiscount",
       c.deferred_discount AS "deferredDiscount"
     FROM customer_cards c
     WHERE c.code = $1 AND c.tenant_code = $2 AND c.active = TRUE
       AND EXISTS (
         SELECT 1 FROM sales_rep_customers a
         WHERE a.customer_code = c.code AND a.tenant_code = c.tenant_code
           AND a.sales_representative_id = $3 AND a.active = TRUE
       )
     LIMIT 1`,
    [customerCode, context.tenantCode, context.salesRepresentativeId],
  )
  return result.rows[0] ?? null
}

const normalizeTaxNumber = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const customerTaxNumberExists = async (client, tenantCode, taxNo) => {
  const normalizedTaxNo = normalizeTaxNumber(taxNo)
  if (!normalizedTaxNo) return false
  const result = await client.query(
    `SELECT 1
     FROM customer_cards
     WHERE tenant_code = $1
       AND (regexp_replace(upper(btrim(COALESCE(tax_no, ''))), '[^A-Z0-9]', '', 'g') = $2
         OR regexp_replace(upper(btrim(COALESCE(tckn, ''))), '[^A-Z0-9]', '', 'g') = $2)
     LIMIT 1`,
    [tenantCode, normalizedTaxNo],
  )
  return result.rowCount > 0
}

export const createMobileCustomer = async (client, req, context, body, fallbackCode = null) => {
  let creditLimit
  try {
    creditLimit = normalizeCreditLimit(body.creditLimit)
  } catch (error) {
    if (error.code !== 'INVALID_CREDIT_LIMIT') throw error
    return { status: 'rejected', code: error.code, result: { message: error.message } }
  }
  const fields = {
    ownerName: [body.ownerName ?? '', 150],
    businessTitle: [body.businessTitle ?? '', 150],
    customerTypeCode: [body.customerTypeCode ?? '', 50],
    phone: [body.phone ?? '', 40],
    mobilePhone: [body.mobilePhone ?? '', 40],
    taxNo: [body.taxNo ?? '', 40],
    tckn: [body.tckn ?? '', 11],
    taxOffice: [body.taxOffice, 120],
    address: [body.address ?? '', 2000],
    location: [body.location ?? '', 255],
    province: [body.province ?? '', 80],
    district: [body.district ?? '', 80],
    email: [body.email ?? '', 254],
    customerGroupCode: [body.customerGroupCode ?? '', 50],
  }
  for (const [field, [value, maxLength]] of Object.entries(fields)) {
    if (typeof value !== 'string' || value.trim().length > maxLength) {
      return { status: 'rejected', code: 'VALIDATION_ERROR' }
    }
  }
  if (!String(body.ownerName ?? '').trim()) {
    return { status: 'rejected', code: 'OWNER_NAME_REQUIRED', result: { message: 'Sahibi adı soyadı zorunludur.' } }
  }
  if (!String(body.businessTitle ?? '').trim()) {
    return { status: 'rejected', code: 'BUSINESS_TITLE_REQUIRED', result: { message: 'İşyeri ünvanı zorunludur.' } }
  }
  if (!String(body.taxOffice ?? '').trim()) {
    return { status: 'rejected', code: 'TAX_OFFICE_REQUIRED', result: { message: 'Vergi dairesi zorunludur.' } }
  }
  if (!String(body.customerTypeCode ?? '').trim()) {
    return { status: 'rejected', code: 'CUSTOMER_TYPE_REQUIRED', result: { message: 'Müşteri tipi zorunludur.' } }
  }
  const province = String(body.province ?? '').trim()
  const district = String(body.district ?? '').trim()
  const email = String(body.email ?? '').trim() || '0'
  const customerGroupCode = String(body.customerGroupCode ?? '').trim()
  if (!province || !district) {
    return { status: 'rejected', code: 'PROVINCE_DISTRICT_REQUIRED', result: { message: 'İl ve ilçe zorunludur.' } }
  }
  if (!provinceDistricts[province] || !provinceDistricts[province].includes(district)) {
    return { status: 'rejected', code: 'INVALID_PROVINCE_DISTRICT', result: { message: 'Seçilen il ve ilçe geçerli değil.' } }
  }
  if (!customerGroupCode) {
    return { status: 'rejected', code: 'CUSTOMER_GROUP_REQUIRED', result: { message: 'Cari grup zorunludur.' } }
  }
  if (email !== '0' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 'rejected', code: 'INVALID_EMAIL', result: { message: 'Geçerli bir e-posta adresi girin.' } }
  }

  const taxNo = (body.taxNo ?? '').trim()
  const tckn = (body.tckn ?? '').trim()
  const phone = String(body.phone ?? '').trim() || '0'
  const mobilePhone = String(body.mobilePhone ?? '').trim() || '0'
  const address = String(body.address ?? '').trim() || '0'
  const normalizedTaxNo = normalizeTaxNumber(taxNo)
  if (!normalizedTaxNo && !tckn) {
    return { status: 'rejected', code: 'TAX_IDENTITY_REQUIRED', result: { message: 'VKN veya TCKN girilmelidir.' } }
  }
  if (taxNo && (!/^\d{10}$/.test(taxNo))) {
    return { status: 'rejected', code: 'INVALID_VKN', result: { message: 'VKN 10 haneli rakamlardan oluşmalıdır.' } }
  }
  if (tckn && !/^\d{11}$/.test(tckn)) {
    return { status: 'rejected', code: 'INVALID_TCKN', result: { message: 'TCKN 11 haneli rakamlardan oluşmalıdır.' } }
  }
  const locationLatitude = safeCoordinate(body.locationLatitude, -90, 90)
  const locationLongitude = safeCoordinate(body.locationLongitude, -180, 180)
  const locationAccuracyM = Number(body.locationAccuracyM)
  const locationCapturedAt = new Date(body.locationCapturedAt)
  if (locationLatitude == null || locationLongitude == null
    || !Number.isFinite(locationAccuracyM) || locationAccuracyM <= 0 || locationAccuracyM > 50
    || !Number.isFinite(locationCapturedAt.getTime())) {
    return { status: 'rejected', code: 'LOCATION_REQUIRED', result: { message: 'Konum kaydı alınmalı ve doğruluğu en fazla 50 metre olmalıdır.' } }
  }
  const routeDay = body.routeDay?.trim()
  if (!routeDays.includes(routeDay)) {
    return { status: 'rejected', code: 'ROUTE_DAY_REQUIRED', result: { message: 'Geçerli bir rut günü seçilmelidir.' } }
  }
  const identityNumbers = [...new Set([normalizedTaxNo, tckn].filter(Boolean))].sort()
  for (const number of identityNumbers) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${context.tenantCode}:${number}`],
    )
  }
  for (const number of identityNumbers) {
    if (await customerTaxNumberExists(client, context.tenantCode, number)) {
      return { status: 'rejected', code: 'DUPLICATE_TAX_NUMBER' }
    }
  }

  const customerType = await client.query(
    `SELECT name FROM customer_types
     WHERE code = $1 AND LOWER(name) IN ('perakende', 'horeca')`,
    [body.customerTypeCode.trim()],
  )
  if (!customerType.rowCount) return { status: 'rejected', code: 'INVALID_CUSTOMER_TYPE' }
  const customerTypeName = customerType.rows[0].name
  const customerGroup = await client.query(
    'SELECT code FROM customer_groups WHERE code = $1',
    [customerGroupCode],
  )
  if (!customerGroup.rowCount) return { status: 'rejected', code: 'INVALID_CUSTOMER_GROUP' }

  const code = fallbackCode ?? (body.customerCode?.trim() || `MOB-${randomUUID()}`)
  if (typeof code !== 'string' || !/^MOB-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code)
    || (typeof body.customerCode === 'string' && body.customerCode.trim() && body.customerCode.trim() !== code)) {
    return { status: 'rejected', code: 'INVALID_OPERATION' }
  }
  const name = body.ownerName.trim() || body.businessTitle.trim() || `Müşteri ${taxNo || tckn}`
  const insertedCustomer = await client.query(
    `INSERT INTO customer_cards
       (code, name, title, province, district, type, sales_representative, phone, mobile_phone,
        tax_no, tax_office, address, email, location, location_latitude, location_longitude,
        location_accuracy_m, location_captured_at, balance, active, tenant_code, credit_limit, tckn,
        customer_group_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 0, TRUE, $19, $20, $21, $22)
     RETURNING code, name, title, type, phone, mobile_phone AS "mobilePhone",
       tax_no AS "taxNo", tckn, tax_office AS "taxOffice", address, email,
       province, district, customer_group_code AS "customerGroupCode", location,
       location_latitude::float8 AS "locationLatitude",
       location_longitude::float8 AS "locationLongitude",
       location_accuracy_m::float8 AS "locationAccuracyM",
       location_captured_at AS "locationCapturedAt",
       balance::text AS balance, credit_limit::float8 AS "creditLimit", 0 AS "openOrderAmount"`,
    [
      code,
      name,
      body.businessTitle.trim(),
      province,
      district,
      customerTypeName,
      context.salesRepresentativeName,
      phone,
      mobilePhone,
      taxNo,
      body.taxOffice.trim(),
      address,
      email,
      body.location.trim(),
      locationLatitude,
      locationLongitude,
      locationAccuracyM,
      locationCapturedAt.toISOString(),
      context.tenantCode,
      creditLimit,
      tckn,
      customerGroupCode,
    ],
  )
  const assignment = await client.query(
    `INSERT INTO sales_rep_customers (tenant_code, sales_representative_id, customer_code, route_day)
     VALUES ($1, $2, $3, $4)
     RETURNING id, route_day AS "routeDay", customer_code AS "customerCode"`,
    [context.tenantCode, context.salesRepresentativeId, code, routeDay],
  )
  await auditMobile(client, req, {
    entityType: 'customer',
    entityId: code,
    action: 'created',
    username: context.username,
    tenantCode: context.tenantCode,
    representativeId: context.salesRepresentativeId,
    deviceId: context.deviceId,
    result: { routeDay },
  })
  return {
    status: 'accepted',
    erpObjectType: 'customer',
    erpObjectId: code,
    result: {
      customer: insertedCustomer.rows[0],
      assignment: assignment.rows[0],
    },
  }
}

const parsePageToken = (value) => {
  if (!value) return { after: {}, syncCursor: null }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!decoded || typeof decoded !== 'object' || !decoded.after || typeof decoded.after !== 'object') return null
    if (decoded.syncCursor != null && !/^\d+$/.test(String(decoded.syncCursor))) return null
    for (const key of ['customers', 'products']) {
      if (decoded.after[key] != null && (typeof decoded.after[key] !== 'string' || decoded.after[key].length > 120)) return null
    }
    for (const key of ['units', 'prices', 'promotions', 'route']) {
      if (decoded.after[key] != null && (!Number.isSafeInteger(Number(decoded.after[key])) || Number(decoded.after[key]) < 1)) return null
    }
    return decoded
  } catch {
    return null
  }
}

const encodePageToken = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const buildOpeningSnapshot = async (client, context, businessDate, routeDay) => {
  const representativeResult = await client.query(
    `SELECT r.id, r.name, r.vehicle_warehouse_code AS "vehicleWarehouseCode",
       w.name AS "vehicleWarehouseName"
     FROM sales_representatives r
     LEFT JOIN factory_warehouses w ON w.code = r.vehicle_warehouse_code
     WHERE r.id = $1 AND r.tenant_code = $2 AND r.active = TRUE`,
    [context.salesRepresentativeId, context.tenantCode],
  )
  const representative = representativeResult.rows[0]
  if (!representative) throw Object.assign(new Error('Etkin temsilci veya araç deposu bulunamadı.'), { statusCode: 409 })
  if (!representative.vehicleWarehouseCode) {
    throw Object.assign(new Error('Temsilciye araç deposu atanmamış.'), { statusCode: 409 })
  }

  const routeResult = await client.query(
    `SELECT a.id, a.route_day AS "routeDay", a.customer_code AS "customerCode",
       c.name AS "customerName", c.title AS "customerTitle", c.province, c.district,
       c.phone, c.mobile_phone AS "mobilePhone", c.address, c.tax_no AS "taxNo", c.tckn,
       c.tax_office AS "taxOffice", c.balance,
       c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount",
       c.location_latitude::float8 AS "locationLatitude",
       c.location_longitude::float8 AS "locationLongitude",
       c.location_accuracy_m::float8 AS "locationAccuracyM",
       c.location_captured_at AS "locationCapturedAt",
       c.customer_discount_1 AS "customerDiscount1",
       c.customer_discount_2 AS "customerDiscount2",
       c.customer_discount_3 AS "customerDiscount3",
       c.cash_discount AS "cashDiscount", c.deferred_discount AS "deferredDiscount"
     FROM sales_rep_customers a
     INNER JOIN customer_cards c ON c.code = a.customer_code
       AND c.tenant_code = a.tenant_code AND c.active = TRUE
     WHERE a.tenant_code = $1 AND a.sales_representative_id = $2
       AND a.active = TRUE AND a.route_day = $3
     ORDER BY a.id`,
    [context.tenantCode, context.salesRepresentativeId, routeDay],
  )
  const previousRouteResult = await client.query(
    `SELECT closing_summary->'routeOrder' AS "routeOrder"
     FROM mobile_work_sessions
     WHERE tenant_code = $1 AND sales_representative_id = $2
       AND route_day = $3 AND business_date <= $4 AND status = 'closed'
       AND closing_summary ? 'routeOrder'
     ORDER BY business_date DESC, opened_at DESC LIMIT 1`,
    [context.tenantCode, context.salesRepresentativeId, routeDay, businessDate],
  )
  const previousRouteOrder = previousRouteResult.rows[0]?.routeOrder
    ?.map((item) => typeof item === 'string' ? item : item.customerCode)
    .filter((code) => typeof code === 'string') ?? []
  if (previousRouteOrder.length) {
    const orderIndex = new Map(previousRouteOrder.map((code, index) => [code, index]))
    routeResult.rows.sort((left, right) =>
      (orderIndex.get(left.customerCode) ?? Number.MAX_SAFE_INTEGER)
        - (orderIndex.get(right.customerCode) ?? Number.MAX_SAFE_INTEGER)
        || String(left.id).localeCompare(String(right.id), 'en', { numeric: true }))
  }
  const customerCodes = routeResult.rows.map((row) => row.customerCode)
  const salesByCustomer = new Map(customerCodes.map((code) => [code, []]))
  if (customerCodes.length) {
    const sales = await client.query(
      `SELECT customer_code AS "customerCode", invoice_no AS "invoiceNo",
         invoice_date AS "invoiceDate", total_amount AS "totalAmount"
       FROM sales_invoices
       WHERE customer_code = ANY($1::text[])
         AND invoice_date >= ($2::date - INTERVAL '30 days')::date
         AND invoice_date <= $2::date AND cancelled IS NOT TRUE
       ORDER BY invoice_date DESC, id DESC`,
      [customerCodes, businessDate],
    )
    for (const sale of sales.rows) salesByCustomer.get(sale.customerCode)?.push(sale)
  }

  const stockResult = await client.query(
    `WITH movements AS (
       SELECT e.entering_warehouse_code AS warehouse_code, l.product_code, SUM(l.total_quantity) AS quantity
       FROM other_stock_entry_lines l
       INNER JOIN other_stock_entries e ON e.id = l.entry_id
       WHERE e.entering_warehouse_code = $1 AND e.tenant_code = $2 AND e.cancelled_at IS NULL
       GROUP BY e.entering_warehouse_code, l.product_code
       UNION ALL
       SELECT e.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
       FROM other_stock_exit_lines l
       INNER JOIN other_stock_exits e ON e.id = l.exit_id
      WHERE e.exiting_warehouse_code = $1 AND e.tenant_code = $2 AND e.cancelled_at IS NULL
       GROUP BY e.exiting_warehouse_code, l.product_code
       UNION ALL
       SELECT t.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
       FROM warehouse_transfer_lines l
       INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
      WHERE t.entering_warehouse_code = $1 AND t.tenant_code = $2 AND t.cancelled_at IS NULL
       GROUP BY t.entering_warehouse_code, l.product_code
       UNION ALL
       SELECT t.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
       FROM warehouse_transfer_lines l
       INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
      WHERE t.exiting_warehouse_code = $1 AND t.tenant_code = $2 AND t.cancelled_at IS NULL
       GROUP BY t.exiting_warehouse_code, l.product_code
       UNION ALL
       SELECT v.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
       FROM vehicle_loading_lines l
       INNER JOIN vehicle_loadings v ON v.id = l.loading_id
      WHERE v.entering_warehouse_code = $1 AND v.tenant_code = $2 AND v.cancelled_at IS NULL
       GROUP BY v.entering_warehouse_code, l.product_code
       UNION ALL
       SELECT v.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
       FROM vehicle_loading_lines l
       INNER JOIN vehicle_loadings v ON v.id = l.loading_id
      WHERE v.exiting_warehouse_code = $1 AND v.tenant_code = $2 AND v.cancelled_at IS NULL
       GROUP BY v.exiting_warehouse_code, l.product_code
       UNION ALL
       SELECT i.warehouse_code, l.product_code, -SUM(l.total_quantity)
       FROM sales_invoice_lines l
       INNER JOIN sales_invoices i ON i.id = l.invoice_id
       INNER JOIN customer_cards c ON c.code = i.customer_code
         AND c.tenant_code = $2
       WHERE i.warehouse_code = $1 AND i.cancelled IS NOT TRUE
       GROUP BY i.warehouse_code, l.product_code
     )
     SELECT p.code AS "productCode", p.name AS "productName", p.unit,
       COALESCE(SUM(m.quantity), 0) AS quantity
     FROM factory_products p
     LEFT JOIN movements m ON m.product_code = p.code
     WHERE p.active = TRUE
     GROUP BY p.code, p.name, p.unit
     HAVING COALESCE(SUM(m.quantity), 0) <> 0
     ORDER BY p.name`,
    [representative.vehicleWarehouseCode, context.tenantCode],
  )

  return {
    businessDate,
    routeDay,
    salesRepresentative: { id: representative.id, name: representative.name },
    vehicleWarehouse: {
      code: representative.vehicleWarehouseCode,
      name: representative.vehicleWarehouseName,
    },
    route: routeResult.rows.map((customer) => ({
      ...customer,
      balance: Number(customer.balance),
      lastMonthSales: salesByCustomer.get(customer.customerCode) ?? [],
    })),
    stock: stockResult.rows.map((item) => ({ ...item, quantity: Number(item.quantity) })),
    capturedAt: new Date().toISOString(),
  }
}

const bootstrapPage = async (client, context, limit, pageToken) => {
  const pageState = parsePageToken(pageToken)
  if (!pageState) return { error: 'INVALID_PAGE_TOKEN' }
  const sequenceResult = await client.query('SELECT COALESCE(MAX(sequence), 0)::text AS cursor FROM mobile_sync_changes')
  const syncCursor = pageState.syncCursor ?? sequenceResult.rows[0].cursor
  const after = pageState.after ?? {}
  const customers = await client.query(
    `SELECT c.code, c.name, c.title, c.province, c.district, c.type, c.territory,
       c.phone, c.mobile_phone, c.address, c.location,
       c.tax_no AS "taxNo", c.tckn, c.tax_office AS "taxOffice", c.balance,
       c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount",
       c.location_latitude::float8 AS "locationLatitude",
       c.location_longitude::float8 AS "locationLongitude",
       c.location_accuracy_m::float8 AS "locationAccuracyM",
       c.location_captured_at AS "locationCapturedAt",
       c.customer_group_code AS "customerGroupCode",
       c.customer_discount_1 AS "customerDiscount1",
       c.customer_discount_2 AS "customerDiscount2",
       c.customer_discount_3 AS "customerDiscount3",
       c.cash_discount AS "cashDiscount", c.deferred_discount AS "deferredDiscount",
       c.active
     FROM customer_cards c
     WHERE c.tenant_code = $1 AND c.active = TRUE AND ($2::text IS NULL OR c.code > $2)
       AND EXISTS (
         SELECT 1 FROM sales_rep_customers a
         WHERE a.customer_code = c.code AND a.tenant_code = c.tenant_code
           AND a.sales_representative_id = $3 AND a.active = TRUE
       )
     ORDER BY c.code LIMIT $4`,
    [context.tenantCode, after.customers ?? null, context.salesRepresentativeId, limit + 1],
  )
  const products = await client.query(
    `SELECT code, name, category, product_type AS "productType", unit, vat,
       e_point AS "ePoint", volume, weight,
       CASE WHEN image_data IS NULL THEN NULL
         ELSE 'data:' || image_mime_type || ';base64,' || encode(image_data, 'base64')
       END AS "imageDataUrl", active
     FROM factory_products WHERE active = TRUE AND ($1::text IS NULL OR code > $1)
     ORDER BY code LIMIT $2`,
    [after.products ?? null, limit + 1],
  )
  const units = await client.query(
    `SELECT u.id, u.product_code AS "productCode", u.unit, u.inner_quantity AS "innerQuantity", u.barcode
     FROM product_units u INNER JOIN factory_products p ON p.code = u.product_code AND p.active = TRUE
     WHERE ($1::bigint IS NULL OR u.id > $1) ORDER BY u.id LIMIT $2`,
    [after.units ?? null, limit + 1],
  )
  const prices = await client.query(
    `SELECT id, product_code AS "productCode", start_date AS "startDate", end_date AS "endDate",
       sales_price AS "salesPrice", tax_included AS "taxIncluded",
       recommended_sales_price AS "recommendedSalesPrice"
     FROM product_prices
     WHERE status = 'Aktif' AND start_date <= CURRENT_DATE
       AND ($1::bigint IS NULL OR id > $1)
     ORDER BY id LIMIT $2`,
    [after.prices ?? null, limit + 1],
  )
  const promotions = await client.query(
    `SELECT id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType",
       condition_unit AS "conditionUnit", threshold, reward_value AS "rewardValue",
       reward_type AS "rewardType", start_date AS "startDate", end_date AS "endDate"
     FROM central_promotions
     WHERE active = TRUE AND start_date <= CURRENT_DATE
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)
       AND ($1::bigint IS NULL OR id > $1)
     ORDER BY id LIMIT $2`,
    [after.promotions ?? null, limit + 1],
  )
  const day = dayInIstanbul()
  const route = await client.query(
    `SELECT a.id, a.route_day AS "routeDay", a.customer_code AS "customerCode",
       c.name AS "customerName", c.title AS "customerTitle", c.province, c.district,
       c.address, c.phone, c.mobile_phone AS "mobilePhone", c.balance,
       c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount"
     FROM sales_rep_customers a
     INNER JOIN customer_cards c ON c.code = a.customer_code AND c.tenant_code = a.tenant_code AND c.active = TRUE
     WHERE a.tenant_code = $1 AND a.sales_representative_id = $2 AND a.active = TRUE
       AND a.route_day = $3 AND ($4::bigint IS NULL OR a.id > $4)
     ORDER BY a.id LIMIT $5`,
    [context.tenantCode, context.salesRepresentativeId, day, after.route ?? null, limit + 1],
  )
  const datasets = { customers, products, units, prices, promotions, route }
  const data = {}
  const nextAfter = { ...after }
  let hasMore = false
  for (const [name, result] of Object.entries(datasets)) {
    const rows = result.rows.slice(0, limit)
    data[name] = name === 'promotions'
      ? rows.map((promotion) => ({ ...promotion, applicability: 'candidate_only' }))
      : rows
    if (result.rows.length > limit) {
      hasMore = true
    }

    const last = rows.at(-1)
    if (last) nextAfter[name] = name === 'customers' || name === 'products' ? last.code : last.id
  }
  const revisions = await client.query(
    `SELECT
       COALESCE(MAX(sequence) FILTER (WHERE entity_type IN
         ('price', 'price_list_item', 'customer_product_price', 'customer_price_list', 'distributor_price_list')), 0)::text
         AS "priceRevision",
       COALESCE(MAX(sequence) FILTER (WHERE entity_type = 'promotion'), 0)::text AS "promotionRevision"
     FROM mobile_sync_changes`,
  )
  return {
    data,
    nextPageToken: hasMore ? encodePageToken({ after: nextAfter, syncCursor }) : null,
    syncCursor,
    revisions: revisions.rows[0],
    serverTime: new Date().toISOString(),
    priceTaxSemantics: 'NET_VAT_EXCLUSIVE_V1',
    pricingIsAuthoritative: false,
    stockIncluded: false,
  }
}

const getEntitySnapshot = async (client, context, entityType, entityKey) => {
  switch (entityType) {
    case 'customer':
    case 'customer_access': {
      const customer = await assertAssignedCustomer(client, context, entityKey)
      if (!customer) return null
      const { balance, ...snapshot } = customer
      return snapshot
    }
    case 'product': {
      const result = await client.query(
        `SELECT code, name, category, product_type AS "productType", unit, vat,
           e_point AS "ePoint", volume, weight,
           CASE WHEN image_data IS NULL THEN NULL
             ELSE 'data:' || image_mime_type || ';base64,' || encode(image_data, 'base64')
           END AS "imageDataUrl", active
         FROM factory_products WHERE code = $1 AND active = TRUE`,
        [entityKey],
      )
      return result.rows[0] ?? null
    }
    case 'product_unit': {
      const result = await client.query(
        `SELECT u.id, u.product_code AS "productCode", u.unit, u.inner_quantity AS "innerQuantity", u.barcode
         FROM product_units u INNER JOIN factory_products p ON p.code = u.product_code AND p.active = TRUE
         WHERE u.id = $1`,
        [entityKey],
      )
      return result.rows[0] ?? null
    }
    case 'price': {
      const result = await client.query(
        `SELECT id, product_code AS "productCode", start_date AS "startDate", end_date AS "endDate",
           sales_price AS "salesPrice", tax_included AS "taxIncluded",
           recommended_sales_price AS "recommendedSalesPrice"
         FROM product_prices WHERE id = $1 AND status = 'Aktif'
           AND start_date <= CURRENT_DATE`,
        [entityKey],
      )
      return result.rows[0] ?? null
    }
    case 'promotion': {
      const result = await client.query(
        `SELECT id, code, name, promotion_type AS "promotionType", condition_type AS "conditionType",
           condition_unit AS "conditionUnit", threshold, reward_value AS "rewardValue",
           reward_type AS "rewardType", start_date AS "startDate", end_date AS "endDate"
         FROM central_promotions WHERE id = $1 AND active = TRUE
           AND start_date <= CURRENT_DATE AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
        [entityKey],
      )
      return result.rows[0] ?? null
    }
    case 'sales_representative': {
      const result = await client.query(
        `SELECT id, name, phone, route_region AS "routeRegion", sales_type AS "salesType"
         FROM sales_representatives
         WHERE id = $1 AND tenant_code = $2 AND active = TRUE`,
        [entityKey, context.tenantCode],
      )
      return result.rows[0] ?? null
    }
    case 'route_assignment': {
      const [customerCode, routeDay] = entityKey.split(':')
      const result = await client.query(
        `SELECT a.id, a.route_day AS "routeDay", a.customer_code AS "customerCode",
           c.name AS "customerName", c.title AS "customerTitle", c.province, c.district,
           json_build_object(
             'code', c.code, 'name', c.name, 'title', c.title, 'province', c.province,
             'district', c.district, 'type', c.type, 'territory', c.territory,
             'phone', c.phone, 'mobilePhone', c.mobile_phone, 'address', c.address, 'location', c.location,
             'locationLatitude', c.location_latitude::float8,
             'locationLongitude', c.location_longitude::float8,
             'locationAccuracyM', c.location_accuracy_m::float8,
             'locationCapturedAt', c.location_captured_at
           ) AS customer
         FROM sales_rep_customers a
         INNER JOIN customer_cards c ON c.code = a.customer_code AND c.tenant_code = a.tenant_code AND c.active = TRUE
         WHERE a.tenant_code = $1 AND a.sales_representative_id = $2
           AND a.customer_code = $3 AND a.route_day = $4 AND a.active = TRUE`,
        [context.tenantCode, context.salesRepresentativeId, customerCode, routeDay],
      )
      return result.rows[0] ?? null
    }
    case 'order': {
      const result = await client.query(
        `SELECT id, order_no AS "orderNo", order_date AS "orderDate", customer_code AS "customerCode",
           total_amount AS "totalAmount", mobile_status AS status, server_accepted_at AS "acceptedAt"
         FROM orders WHERE id = $1 AND tenant_code = $2
           AND sales_representative_id = $3 AND originating_user_id = $4`,
        [entityKey, context.tenantCode, context.salesRepresentativeId, context.userId],
      )
      return result.rows[0] ?? null
    }
    case 'sales_invoice': {
      const result = await client.query(
        `SELECT id, mobile_operation_id AS "operationId",
           invoice_no AS "invoiceNo", mobile_print_number AS "mobilePrintNumber",
           printed_at AS "printedAt", invoice_date AS "invoiceDate",
           customer_code AS "customerCode", total_amount AS "totalAmount",
           sale_type AS "saleType", mobile_status AS status,
           server_accepted_at AS "acceptedAt"
         FROM sales_invoices WHERE id = $1 AND tenant_code = $2
           AND sales_representative_id = $3 AND originating_user_id = $4
           AND source_channel = 'MOBILE'`,
        [entityKey, context.tenantCode, context.salesRepresentativeId, context.userId],
      )
      return result.rows[0] ?? null
    }
    case 'field_visit': {
      const result = await client.query(
        `SELECT id, customer_code AS "customerCode", started_at AS "startedAt",
           completed_at AS "completedAt", visit_result AS "visitResult", note
         FROM field_visits WHERE id = $1 AND tenant_code = $2
           AND sales_representative_id = $3 AND created_by = $4`,
        [entityKey, context.tenantCode, context.salesRepresentativeId, context.userId],
      )
      return result.rows[0] ?? null
    }
    default:
      return null
  }
}

const handleOperation = async (client, req, context, operation) => {
  if (!operation || typeof operation !== 'object' || !validUuid(operation.operationId)) {
    return { operationId: operation?.operationId ?? null, status: 'rejected', code: 'INVALID_OPERATION' }
  }
  if (!['visit.start', 'visit.complete', 'order.submit', 'sale.submit', 'collection.submit', 'customer.create'].includes(operation.type)) {
    return { operationId: operation.operationId, status: 'rejected', code: 'INVALID_OPERATION' }
  }
  const neededCapability = operation.type === 'visit.start'
    ? 'mobile.visit.create'
    : operation.type === 'visit.complete'
      ? 'mobile.visit.complete'
      : operation.type === 'collection.submit'
        ? 'mobile.collection.create'
        : 'mobile.order.create'
  if (!context.capabilities[neededCapability]) {
    return { operationId: operation.operationId, status: 'rejected', code: 'FORBIDDEN' }
  }
  if (!operation.payload || typeof operation.payload !== 'object' || Array.isArray(operation.payload)) {
    return { operationId: operation.operationId, status: 'rejected', code: 'INVALID_OPERATION' }
  }
  if (operation.type === 'sale.submit'
    && (typeof operation.payload.mobilePrintedAt !== 'string'
      || !Number.isFinite(Date.parse(operation.payload.mobilePrintedAt))
      || (operation.payload.mobilePrintNumber != null
        && (typeof operation.payload.mobilePrintNumber !== 'string'
          || operation.payload.mobilePrintNumber.length > 100)))) {
    return { operationId: operation.operationId, status: 'rejected', code: 'SALE_PRINT_REQUIRED' }
  }
  const workSessionId = operation.payload.workSessionId ?? null
  if (workSessionId !== null && !validUuid(workSessionId)) {
    return { operationId: operation.operationId, status: 'rejected', code: 'INVALID_OPERATION' }
  }

  const payloadHash = hashPayload({ type: operation.type, payload: operation.payload })
  await client.query('BEGIN')
  try {
    const insert = await client.query(
      `INSERT INTO mobile_sync_operations
         (operation_id, device_id, user_id, sales_representative_id, tenant_code, operation_type,
          payload_hash, client_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (operation_id) DO NOTHING
       RETURNING operation_id`,
      [operation.operationId, context.deviceId, context.userId, context.salesRepresentativeId,
        context.tenantCode, operation.type, payloadHash,
        operation.clientCreatedAt && Number.isFinite(Date.parse(operation.clientCreatedAt)) ? operation.clientCreatedAt : null],
    )
    if (insert.rowCount && operation.type !== 'customer.create') {
      const workSession = await client.query(
        `SELECT status FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND distributor_user_id = $3
           AND (($4::uuid IS NULL AND business_date = $5) OR id = $4::uuid)
         FOR UPDATE`,
        [context.tenantCode, context.salesRepresentativeId, context.userId, workSessionId, dateInIstanbul()],
      )
      if (!workSession.rowCount || workSession.rows[0].status !== 'open') {
        await client.query('ROLLBACK')
        return { operationId: operation.operationId, status: 'rejected', code: 'WORKDAY_NOT_OPEN' }
      }
    }
    if (!insert.rowCount) {
      const existingResult = await client.query(
        'SELECT * FROM mobile_sync_operations WHERE operation_id = $1 FOR UPDATE',
        [operation.operationId],
      )
      const existing = existingResult.rows[0]
      if (existing.device_id !== context.deviceId || existing.user_id !== context.userId) {
        await client.query('ROLLBACK')
        return { operationId: operation.operationId, status: 'rejected', code: 'OPERATION_NOT_FOUND' }
      }
      if (existing.payload_hash !== payloadHash || existing.operation_type !== operation.type) {
        await client.query('ROLLBACK')
        return { operationId: operation.operationId, status: 'rejected', code: 'OPERATION_ID_PAYLOAD_MISMATCH' }
      }
      await client.query('COMMIT')
      return {
        operationId: operation.operationId,
        status: existing.status,
        code: existing.error_code,
        result: existing.result_summary,
        erpObjectType: existing.erp_object_type,
        erpObjectId: existing.erp_object_id,
        documentNumber: existing.erp_document_number,
      }
    }

    let result
    if (operation.type === 'customer.create') {
      const requestedCode = operation.payload.customerCode
      if (typeof requestedCode !== 'string' || !/^MOB-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedCode)) {
        result = { status: 'rejected', code: 'INVALID_OPERATION' }
      } else {
        result = await createMobileCustomer(client, req, context, operation.payload, requestedCode)
      }
    } else if (operation.type === 'visit.start') {
      const {
        customerCode,
        visitId,
        latitude,
        longitude,
        accuracyM,
        capturedAt,
        allowUnverifiedLocation = false,
        unverifiedReason = null,
      } = operation.payload
      const lat = safeCoordinate(latitude, -90, 90)
      const lon = safeCoordinate(longitude, -180, 180)
      const accuracy = Number(accuracyM)
      const captured = new Date(capturedAt)
      const unverifiedReasons = new Set([
        'customer_location_missing',
        'gps_unavailable',
        'gps_accuracy_insufficient',
      ])
      const unverified = allowUnverifiedLocation === true
      const hasUsableReading = lat != null && lon != null
        && Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 30
        && Number.isFinite(captured.getTime())
        && Math.abs(Date.now() - captured.getTime()) <= 5 * 60 * 1000
      if (!validUuid(visitId) || !customerCode
        || (unverified && !unverifiedReasons.has(unverifiedReason))
        || (!unverified && !hasUsableReading)) {
        result = { status: 'rejected', code: 'VALIDATION_ERROR' }
      } else {
        const customer = await assertAssignedCustomer(client, context, customerCode)
        if (!customer) result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
        else if (!unverified && (customer.locationLatitude == null || customer.locationLongitude == null)) {
          result = { status: 'rejected', code: 'CUSTOMER_LOCATION_MISSING' }
        } else if (unverifiedReason === 'customer_location_missing'
          && customer.locationLatitude != null && customer.locationLongitude != null) {
          result = { status: 'rejected', code: 'UNVERIFIED_OVERRIDE_NOT_ALLOWED' }
        }
        else {
          const distance = hasUsableReading
            && customer.locationLatitude != null && customer.locationLongitude != null
            ? distanceMeters(
              lat,
              lon,
              Number(customer.locationLatitude),
              Number(customer.locationLongitude),
            )
            : null
          if (!unverified && distance > 30) {
            result = {
              status: 'rejected',
              code: 'OUTSIDE_CUSTOMER_RADIUS',
              result: { distanceM: Math.round(distance * 10) / 10 },
            }
          } else {
          await client.query(
            `INSERT INTO field_visits
               (id, tenant_code, sales_representative_id, customer_code, started_at,
                start_latitude, start_longitude, start_accuracy_m, start_distance_m,
                start_location_captured_at, start_location_verified,
                start_location_unverified_reason, created_by, start_operation_id)
             VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              visitId, context.tenantCode, context.salesRepresentativeId, customerCode,
              hasUsableReading ? lat : null,
              hasUsableReading ? lon : null,
              hasUsableReading ? accuracy : null,
              distance,
              hasUsableReading ? captured.toISOString() : null,
              !unverified,
              unverified ? unverifiedReason : null,
              context.userId,
              operation.operationId,
            ],
          )
          result = {
            status: 'accepted',
            erpObjectType: 'field_visit',
            erpObjectId: visitId,
            result: {
              customerCode,
              startedAt: new Date().toISOString(),
              distanceM: distance == null ? null : Math.round(distance * 10) / 10,
              accuracyM: hasUsableReading ? accuracy : null,
              locationVerified: !unverified,
              unverifiedReason: unverified ? unverifiedReason : null,
            },
          }
          }
        }
      }
    } else if (operation.type === 'visit.complete') {
      const { visitId, visitResult, note = '', latitude, longitude } = operation.payload
      const lat = safeCoordinate(latitude, -90, 90)
      const lon = safeCoordinate(longitude, -180, 180)
      if (!validUuid(visitId) || typeof note !== 'string' || note.length > 2000
        || typeof visitResult !== 'string' || !visitResult.trim() || visitResult.length > 50
        || lat === undefined || lon === undefined || (lat === null) !== (lon === null)) {
        result = { status: 'rejected', code: 'VALIDATION_ERROR' }
      } else {
        const visit = await client.query(
           `SELECT id, customer_code AS "customerCode" FROM field_visits
           WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
             AND created_by = $4 AND completed_at IS NULL
           FOR UPDATE`,
          [visitId, context.tenantCode, context.salesRepresentativeId, context.userId],
        )
        if (!visit.rowCount) result = { status: 'rejected', code: 'VISIT_NOT_OPEN' }
        else if (!await assertAssignedCustomer(client, context, visit.rows[0].customerCode)) {
           result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
        }
        else {
          await client.query(
            `UPDATE field_visits SET completed_at = NOW(), visit_result = $1, note = $2,
               end_latitude = $3, end_longitude = $4, completion_operation_id = $5, updated_at = NOW()
             WHERE id = $6`,
            [visitResult.trim(), note, lat, lon, operation.operationId, visitId],
          )
          result = {
            status: 'accepted',
            erpObjectType: 'field_visit',
            erpObjectId: visitId,
            result: { completedAt: new Date().toISOString(), visitResult: visitResult.trim() },
          }
        }
      }
    } else if (operation.type === 'collection.submit') {
      const { customerCode, amount, operationDate, description = '' } = operation.payload
      if (!validateMobileCollectionPayload(operation.payload)) {
        result = { status: 'rejected', code: 'VALIDATION_ERROR' }
      } else if (!await assertAssignedCustomer(client, context, customerCode)) {
        result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
      } else {
        const customerResult = await client.query(
          `SELECT balance FROM customer_cards
           WHERE code = $1 AND tenant_code = $2 AND active = TRUE FOR UPDATE`,
          [customerCode, context.tenantCode],
        )
        if (!customerResult.rowCount) {
          result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
        } else {
          const previousBalance = customerResult.rows[0].balance
          const updatedCustomer = await client.query(
            `UPDATE customer_cards
             SET balance = COALESCE(balance, 0) - $1::numeric
             WHERE code = $2 AND tenant_code = $3
             RETURNING balance`,
            [numericAmount, customerCode, context.tenantCode],
          )
          const operationResult = await client.query(
            `INSERT INTO customer_collection_operations
               (customer_code, operation_type, amount, description, operation_date, balance_delta, created_by, tenant_code)
             VALUES ($1, 'Tahsilat', $2, $3, $4, -1, $5, $6)
             RETURNING id`,
            [customerCode, amount, description.trim(), operationDate, context.username, context.tenantCode],
          )
          result = {
            status: 'accepted',
            erpObjectType: 'customer_collection_operation',
            erpObjectId: operationResult.rows[0].id,
            result: {
              customerCode,
              amount,
              operationDate,
              previousBalance,
              newBalance: updatedCustomer.rows[0].balance,
            },
          }
        }
      }
    } else if (operation.type === 'order.submit') {
      const customerCode = operation.payload?.customerCode
      if (!customerCode || !await assertAssignedCustomer(client, context, customerCode)) {
        result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
      } else result = await submitOrder({ client, req, context, operationId: operation.operationId, payload: operation.payload })
    } else {
      const customerCode = operation.payload?.customerCode
      if (!customerCode || !await assertAssignedCustomer(client, context, customerCode)) {
        result = { status: 'rejected', code: 'CUSTOMER_NOT_ASSIGNED' }
      } else result = await submitSalesInvoice({ client, req, context, operationId: operation.operationId, payload: operation.payload })
    }

    await client.query(
      `UPDATE mobile_sync_operations
       SET status = $1, processed_at = NOW(), erp_object_type = $2, erp_object_id = $3,
           erp_document_number = $4, result_summary = $5::jsonb, error_code = $6
       WHERE operation_id = $7`,
      [result.status, result.erpObjectType ?? result.result?.erpObjectType ?? null,
        result.erpObjectId ?? result.result?.erpObjectId ?? null,
        result.documentNumber ?? result.result?.documentNumber ?? null,
        result.result ? JSON.stringify(result.result) : null, result.status === 'accepted' ? null : result.code,
        operation.operationId],
    )
    await auditMobile(client, req, {
      entityType: `mobile_${operation.type}`,
      entityId: operation.operationId,
      action: result.status,
      username: context.username,
      tenantCode: context.tenantCode,
      representativeId: context.salesRepresentativeId,
      deviceId: context.deviceId,
      result: operation.type === 'collection.submit'
        ? result.result ?? result.code ?? result.status
        : result.code ?? result.status,
    })
    await client.query('UPDATE mobile_devices SET last_sync_at = NOW() WHERE id = $1', [context.deviceId])
    await client.query('COMMIT')
    return {
      operationId: operation.operationId,
      status: result.status,
      code: result.code,
      result: result.result,
      erpObjectType: result.erpObjectType ?? result.result?.erpObjectType,
      erpObjectId: result.erpObjectId ?? result.result?.erpObjectId,
      documentNumber: result.documentNumber ?? result.result?.documentNumber,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error?.code === '23505') {
      return { operationId: operation.operationId, status: 'rejected', code: 'DUPLICATE_OPERATION' }
    }
    throw error
  }
}

export const createMobileRouter = ({ databaseUrl, verifyPassword }) => {
  const router = express.Router()
  router.use((req, res, next) => req.path === '/auth/session'
    ? next()
    : mobileRequestRateLimit(req, res, next))
  router.post('/auth/session', mobileLoginRateLimit, async (req, res) => {
    if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
    const { username, password, deviceId, deviceProof, platform, appVersion } = req.body ?? {}
    if (typeof username !== 'string' || username.trim().length > 80
      || typeof password !== 'string' || password.length > 256 || !username.trim()
      || !validUuid(deviceId) || typeof deviceProof !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(deviceProof)
      || !['android', 'ios'].includes(platform) || typeof appVersion !== 'string'
      || !appVersion.trim() || appVersion.length > 40) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Kullanıcı, parola ve geçerli cihaz bilgileri zorunludur.')
    }
    const client = new pg.Client({ connectionString: databaseUrl })
    try {
      await client.connect()
      const userResult = await client.query(
        `SELECT u.id, u.username, u.password_hash, u.tenant_code,
           u.sales_representative_id, u.distributor_name, u.role_name,
           u.password_change_required AS "passwordChangeRequired", s.name AS representative_name,
           m.permissions, dr.permissions_json->'MobileFieldSales' AS role_mobile_access
         FROM distributor_users u
         LEFT JOIN sales_representatives s ON s.id = u.sales_representative_id
           AND s.tenant_code = u.tenant_code AND s.active = TRUE
         LEFT JOIN security_access_matrix m ON m.username = u.username
         LEFT JOIN security_distributor_roles dr ON lower(btrim(dr.name)) = lower(btrim(u.role_name)) AND dr.active = TRUE
         WHERE u.username = $1 AND u.status = 'Aktif'`,
        [username.trim()],
      )
      const user = userResult.rows[0]
      if (!user || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
        await auditMobile(client, req, {
          entityType: 'mobile_auth',
          entityId: sha256(username.trim().toLocaleLowerCase('tr-TR')).slice(0, 24),
          action: 'login_failed',
          result: 'rejected',
        })
        return publicError(res, 401, 'AUTH_REQUIRED', 'Kullanıcı adı veya parola hatalı.')
      }
      if (user.passwordChangeRequired) {
        return publicError(res, 403, 'PASSWORD_CHANGE_REQUIRED', 'Önce ERP girişinde parolanızı değiştirmeniz gerekir.')
      }
      if (!user.tenant_code || !user.sales_representative_id || !user.representative_name) {
        return publicError(res, 403, 'REPRESENTATIVE_NOT_ASSIGNED', 'Kullanıcıya aynı distribütör içinden etkin bir satış temsilcisi atanmamış.')
      }
      const mobileAccess = resolveMobileCapabilities(user.permissions ?? {}, {
        MobileFieldSales: user.role_mobile_access ?? {},
      })
      if (mobileAccess.visible === false || mobileAccess.capabilities['mobile.login'] !== true) {
        return publicError(res, 403, 'FORBIDDEN', 'Kullanıcı için mobil giriş yetkisi etkin değil.')
      }
      const secretHash = sha256(deviceProof)
      await client.query('BEGIN')
      const deviceResult = await client.query(
        'SELECT * FROM mobile_devices WHERE id = $1 FOR UPDATE',
        [deviceId],
      )
      let device = deviceResult.rows[0]
      if (!device) {
        await client.query(
          `INSERT INTO mobile_devices
             (id, distributor_user_id, sales_representative_id, tenant_code, device_secret_hash,
              platform, app_version, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [deviceId, user.id, user.sales_representative_id, user.tenant_code, secretHash, platform, appVersion],
        )
        await auditMobile(client, req, {
          entityType: 'mobile_device',
          entityId: deviceId,
          action: 'registered',
          username: user.username,
          tenantCode: user.tenant_code,
          representativeId: user.sales_representative_id,
          deviceId,
          result: 'pending',
        })
        await client.query('COMMIT')
        return res.status(202).json({
          device: { id: deviceId, status: 'pending' },
          message: 'Cihaz yöneticinin onayını bekliyor.',
          serverTime: new Date().toISOString(),
        })
      }
      if (device.status === 'revoked') {
        await client.query('ROLLBACK')
        return publicError(res, 403, 'DEVICE_REVOKED', 'Bu cihaz iptal edilmiş; yöneticiyle iletişime geçin.')
      }
      const expectedHash = Buffer.from(device.device_secret_hash, 'utf8')
      const suppliedHash = Buffer.from(secretHash, 'utf8')
      const sameProof = expectedHash.length === suppliedHash.length && timingSafeEqual(expectedHash, suppliedHash)
      if (device.distributor_user_id !== user.id || device.sales_representative_id !== user.sales_representative_id
        || device.tenant_code !== user.tenant_code || !sameProof) {
        await client.query('ROLLBACK')
        return publicError(res, 403, 'DEVICE_MISMATCH', 'Cihaz kullanıcı veya temsilci kapsamıyla eşleşmiyor.')
      }
      if (device.status !== 'active') {
        await client.query('ROLLBACK')
        return res.status(202).json({
          device: { id: deviceId, status: 'pending' },
          message: 'Cihaz yöneticinin onayını bekliyor.',
          serverTime: new Date().toISOString(),
        })
      }
      const token = `${MOBILE_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
      loginAttempts.delete(`${req.ip}:${username.trim().toLocaleLowerCase('tr-TR')}`)
      const tokenHash = sha256(token)
      const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)
      const session = await client.query(
        `INSERT INTO auth_sessions
           (token_hash, account_type, account_user_id, username, password_change_required, expires_at)
         VALUES ($1, 'distributor', $2, $3, FALSE, $4)
         RETURNING id`,
        [tokenHash, user.id, user.username, expiresAt],
      )
      await client.query(
        'INSERT INTO mobile_session_devices (auth_session_id, device_id) VALUES ($1, $2)',
        [session.rows[0].id, deviceId],
      )
      await client.query('UPDATE mobile_devices SET app_version = $1, last_seen_at = NOW() WHERE id = $2', [appVersion, deviceId])
      await auditMobile(client, req, {
        entityType: 'mobile_session',
        entityId: session.rows[0].id,
        action: 'login',
        username: user.username,
        tenantCode: user.tenant_code,
        representativeId: user.sales_representative_id,
        deviceId,
        result: 'accepted',
      })
      await client.query('COMMIT')
      return res.json({
        token,
        tokenType: 'Bearer',
        expiresAt: expiresAt.toISOString(),
        user: { id: user.id, username: user.username, role: user.role_name },
        tenant: { code: user.tenant_code, distributorName: user.distributor_name },
        salesRepresentative: { id: user.sales_representative_id, name: user.representative_name },
        roles: [user.role_name],
        capabilities: mobileAccess.capabilities,
        device: { id: deviceId, status: 'active', platform, appVersion },
        serverTime: new Date().toISOString(),
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    } finally {
      await client.end().catch((error) => console.error('Mobile login connection cleanup failed:', error))
    }
  })

  router.get('/me', withMobileContext(databaseUrl, 'mobile.login', async ({ req, res, context }) => {
    return res.json({
      user: { id: context.userId, username: context.username, role: context.role },
      tenant: { code: context.tenantCode },
      salesRepresentative: { id: context.salesRepresentativeId, name: context.salesRepresentativeName },
      capabilities: context.capabilities,
      device: { id: context.deviceId, platform: context.platform, appVersion: context.appVersion },
      serverTime: new Date().toISOString(),
    })
  }))

  router.post('/auth/logout', withMobileContext(databaseUrl, 'mobile.login', async ({ req, res, client, context }) => {
    await client.query('BEGIN')
    try {
      await client.query('UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL', [context.sessionId])
      await auditMobile(client, req, {
        entityType: 'mobile_session',
        entityId: context.sessionId,
        action: 'logout',
        username: context.username,
        tenantCode: context.tenantCode,
        representativeId: context.salesRepresentativeId,
        deviceId: context.deviceId,
        result: 'revoked',
      })
      await client.query('COMMIT')
      return res.status(204).end()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    }
  }))

  router.get('/route/today', withMobileContext(databaseUrl, 'mobile.route.read', async ({ res, client, context }) => {
    const day = dayInIstanbul()
    const result = await client.query(
      `SELECT a.id, a.route_day AS "routeDay", a.customer_code AS "customerCode",
         c.name AS "customerName", c.title AS "customerTitle", c.province, c.district,
         c.address, c.phone, c.mobile_phone AS "mobilePhone", c.balance,
         c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount",
         COALESCE(NULLIF(REPLACE(BTRIM(c.customer_discount_1), ',', '.'), '')::numeric, 0::numeric) AS "customerDiscount1",
         COALESCE(NULLIF(REPLACE(BTRIM(c.customer_discount_2), ',', '.'), '')::numeric, 0::numeric) AS "customerDiscount2",
         COALESCE(NULLIF(REPLACE(BTRIM(c.customer_discount_3), ',', '.'), '')::numeric, 0::numeric) AS "customerDiscount3",
         COALESCE(NULLIF(REPLACE(BTRIM(c.cash_discount), ',', '.'), '')::numeric, 0::numeric) AS "cashDiscount",
         COALESCE(NULLIF(REPLACE(BTRIM(c.deferred_discount), ',', '.'), '')::numeric, 0::numeric) AS "deferredDiscount"
       FROM sales_rep_customers a
       INNER JOIN customer_cards c ON c.code = a.customer_code AND c.tenant_code = a.tenant_code AND c.active = TRUE
       WHERE a.tenant_code = $1 AND a.sales_representative_id = $2 AND a.active = TRUE AND a.route_day = $3
       ORDER BY a.id`,
      [context.tenantCode, context.salesRepresentativeId, day],
    )
    return res.json({
      routeDay: day,
      stops: result.rows.map((stop) => ({
        ...stop,
        balance: Number(stop.balance),
        customerDiscount1: Number(stop.customerDiscount1),
        customerDiscount2: Number(stop.customerDiscount2),
        customerDiscount3: Number(stop.customerDiscount3),
        cashDiscount: Number(stop.cashDiscount),
        deferredDiscount: Number(stop.deferredDiscount),
      })),
      serverTime: new Date().toISOString(),
    })
  }))

  router.get('/route/outside', withMobileContext(databaseUrl, 'mobile.route.read', async ({ req, res, client, context }) => {
    const today = dayInIstanbul()
    const requestedDay = req.query.day
    if (requestedDay && (!routeDays.includes(requestedDay) || requestedDay === today)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Rut dışı ekranında bugünkü gün seçilemez.')
    }
    const params = requestedDay
      ? [context.tenantCode, context.salesRepresentativeId, requestedDay]
      : [context.tenantCode, context.salesRepresentativeId, today]
    const dayFilter = requestedDay ? 'AND a.route_day = $3' : 'AND a.route_day <> $3'
    const result = await client.query(
      `SELECT a.id, a.route_day AS "routeDay", a.customer_code AS "customerCode",
         c.name AS "customerName", c.title AS "customerTitle", c.province, c.district,
         c.balance, r.name AS "salesRepresentativeName",
         c.credit_limit::float8 AS "creditLimit", ${openOrderCreditSql()}::float8 AS "openOrderAmount"
       FROM sales_rep_customers a
       INNER JOIN sales_representatives r ON r.id = a.sales_representative_id
         AND r.tenant_code = a.tenant_code AND r.active = TRUE
       INNER JOIN customer_cards c ON c.code = a.customer_code
         AND c.tenant_code = a.tenant_code AND c.active = TRUE
       WHERE a.tenant_code = $1 AND a.sales_representative_id = $2
         AND a.active = TRUE ${dayFilter}
       ORDER BY a.route_day, c.name`,
      params,
    )
    return res.json({
      today,
      days: routeDays.filter((day) => day !== today),
      assignments: result.rows.map((row) => ({ ...row, balance: Number(row.balance) })),
      serverTime: new Date().toISOString(),
    })
  }))

  router.get('/location/requests/pending', withMobileContext(databaseUrl, 'mobile.sync', async ({ res, client, context }) => {
    await client.query(
      `UPDATE mobile_location_requests
       SET status = 'expired'
       WHERE tenant_code = $1 AND sales_representative_id = $2
         AND status = 'pending' AND expires_at <= NOW()`,
      [context.tenantCode, context.salesRepresentativeId],
    )
    const result = await client.query(
      `SELECT id, requested_at AS "requestedAt", expires_at AS "expiresAt"
       FROM mobile_location_requests
       WHERE tenant_code = $1 AND sales_representative_id = $2
         AND status = 'pending' AND expires_at > NOW()
       ORDER BY requested_at DESC
       LIMIT 1`,
      [context.tenantCode, context.salesRepresentativeId],
    )
    return res.json({ request: result.rows[0] ?? null, serverTime: new Date().toISOString() })
  }))

  router.post('/location/points', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    const points = req.body?.points
    const requestId = req.body?.requestId ?? null
    if (!Array.isArray(points) || points.length === 0 || points.length > 1000
      || (requestId !== null && !validUuid(requestId))) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Konum paketi geçersiz.')
    }
    const normalized = []
    for (const point of points) {
      const latitude = safeCoordinate(point?.latitude, -90, 90)
      const longitude = safeCoordinate(point?.longitude, -180, 180)
      const accuracyM = Number(point?.accuracyM)
      const speedMps = point?.speedMps == null ? null : Number(point.speedMps)
      const bearingDegrees = point?.bearingDegrees == null ? null : Number(point.bearingDegrees)
      const recordedAt = new Date(point?.recordedAt)
      if (!validUuid(point?.id) || !validUuid(point?.workSessionId)
        || latitude == null || longitude == null
        || !Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > 100
        || (speedMps !== null && (!Number.isFinite(speedMps) || speedMps < 0))
        || (bearingDegrees !== null && (!Number.isFinite(bearingDegrees) || bearingDegrees < 0 || bearingDegrees >= 360))
        || !Number.isFinite(recordedAt.getTime()) || recordedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        return publicError(res, 400, 'VALIDATION_ERROR', 'Konum noktalarından biri geçersiz.')
      }
      normalized.push({
        id: point.id,
        workSessionId: point.workSessionId,
        recordedAt: recordedAt.toISOString(),
        latitude,
        longitude,
        accuracyM,
        speedMps,
        bearingDegrees,
      })
    }
    try {
      await client.query('BEGIN')
      const workSessionId = normalized[0].workSessionId
      const workday = await client.query(
        `SELECT id, business_date AS "businessDate"
         FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND distributor_user_id = $3 AND id = $4 AND status = 'open'
         FOR UPDATE`,
        [context.tenantCode, context.salesRepresentativeId, context.userId, workSessionId],
      )
      if (!workday.rowCount || normalized.some((point) => point.workSessionId !== workday.rows[0].id)) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'WORKDAY_NOT_OPEN', 'Konum yüklemek için günlük oturum açık olmalıdır.')
      }
      if (requestId) {
        const request = await client.query(
          `SELECT id FROM mobile_location_requests
           WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
             AND status = 'pending' AND expires_at > NOW()
           FOR UPDATE`,
          [requestId, context.tenantCode, context.salesRepresentativeId],
        )
        if (!request.rowCount) {
          await client.query('ROLLBACK')
          return publicError(res, 409, 'LOCATION_REQUEST_EXPIRED', 'Konum talebinin süresi dolmuş.')
        }
      }
      for (const point of normalized) {
        await client.query(
          `INSERT INTO mobile_route_points
             (id, tenant_code, distributor_user_id, sales_representative_id, device_id,
              work_session_id, business_date, recorded_at, latitude, longitude,
              accuracy_m, speed_mps, bearing_degrees)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            point.id, context.tenantCode, context.userId, context.salesRepresentativeId,
            context.deviceId, point.workSessionId, workday.rows[0].businessDate,
            point.recordedAt, point.latitude, point.longitude, point.accuracyM,
            point.speedMps, point.bearingDegrees,
          ],
        )
      }
      await refreshRouteStops(client, context, workday.rows[0])
      if (requestId) {
        await client.query(
          `UPDATE mobile_location_requests
           SET status = 'fulfilled', fulfilled_at = NOW(), fulfilled_by_device_id = $2
           WHERE id = $1`,
          [requestId, context.deviceId],
        )
      }
      await client.query('COMMIT')
      return res.json({
        acceptedIds: normalized.map((point) => point.id),
        requestFulfilled: requestId !== null,
        serverTime: new Date().toISOString(),
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }))

  router.get('/day/current', withMobileContext(databaseUrl, 'mobile.sync', async ({ res, client, context }) => {
    const businessDate = dateInIstanbul()
    const result = await client.query(
      `SELECT id, distributor_user_id AS "distributorUserId", device_id AS "deviceId",
         business_date AS "businessDate", route_day AS "routeDay", status,
         opening_snapshot AS "openingSnapshot", closing_summary AS "closingSummary",
         opened_at AS "openedAt", closed_at AS "closedAt",
         opening_odometer_km::float8 AS "openingOdometerKm",
         closing_odometer_km::float8 AS "closingOdometerKm",
         COALESCE(
           opening_odometer_km,
           (
             SELECT previous.closing_odometer_km
             FROM mobile_work_sessions previous
             WHERE previous.tenant_code = mobile_work_sessions.tenant_code
               AND previous.sales_representative_id = mobile_work_sessions.sales_representative_id
               AND previous.status = 'closed'
               AND previous.closing_odometer_km IS NOT NULL
               AND previous.opened_at < mobile_work_sessions.opened_at
             ORDER BY previous.opened_at DESC
             LIMIT 1
           )
         )::float8 AS "suggestedOpeningOdometerKm",
         CASE WHEN closing_odometer_km IS NULL THEN NULL
              ELSE (closing_odometer_km - opening_odometer_km)::float8 END AS "traveledKm"
       FROM mobile_work_sessions
       WHERE tenant_code = $1 AND sales_representative_id = $2
         AND distributor_user_id = $3
         AND (business_date = $4 OR (
           business_date < $4 AND status = 'open' AND device_id = $5
         ))
       ORDER BY CASE
           WHEN business_date = $4 AND status = 'open' THEN 0
           WHEN business_date < $4 AND status = 'open' THEN 1
           ELSE 2
         END, opened_at DESC
       LIMIT 1`,
      [context.tenantCode, context.salesRepresentativeId, context.userId, businessDate, context.deviceId],
    )
    const session = result.rows[0] ?? null
    const currentDaySession = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND distributor_user_id = $3 AND business_date = $4
       ) AS "exists",
       EXISTS (
         SELECT 1
         FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND distributor_user_id = $3 AND business_date = $4
           AND status = 'open'
       ) AS "open"`,
      [context.tenantCode, context.salesRepresentativeId, context.userId, businessDate],
    )
    return res.json({
      businessDate,
      routeDay: dayInIstanbul(),
      session,
      requiresClosing: session?.status === 'open' && session.businessDate < businessDate,
      currentDaySessionExists: currentDaySession.rows[0].exists,
      currentDaySessionOpen: currentDaySession.rows[0].open,
      serverTime: new Date().toISOString(),
    })
  }))

  router.get('/day/stock', withMobileContext(databaseUrl, 'mobile.sync', async ({ res, client, context }) => {
    const representativeResult = await client.query(
      `SELECT vehicle_warehouse_code AS "warehouseCode"
       FROM sales_representatives
       WHERE id = $1 AND tenant_code = $2 AND active = TRUE`,
      [context.salesRepresentativeId, context.tenantCode],
    )
    const warehouseCode = representativeResult.rows[0]?.warehouseCode
    if (!warehouseCode) {
      return publicError(res, 409, 'VEHICLE_WAREHOUSE_NOT_FOUND', 'Temsilciye etkin araç deposu atanmamış.')
    }

    const result = await client.query(
      `WITH movements AS (
         SELECT e.entering_warehouse_code AS warehouse_code, l.product_code, SUM(l.total_quantity) AS quantity
         FROM other_stock_entry_lines l
         INNER JOIN other_stock_entries e ON e.id = l.entry_id
        WHERE e.entering_warehouse_code = $1 AND e.tenant_code = $2 AND e.cancelled_at IS NULL
         GROUP BY e.entering_warehouse_code, l.product_code
         UNION ALL
         SELECT e.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
         FROM other_stock_exit_lines l
         INNER JOIN other_stock_exits e ON e.id = l.exit_id
         WHERE e.exiting_warehouse_code = $1 AND e.tenant_code = $2 AND e.cancelled_at IS NULL
         GROUP BY e.exiting_warehouse_code, l.product_code
         UNION ALL
         SELECT t.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
         FROM warehouse_transfer_lines l
         INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
         WHERE t.entering_warehouse_code = $1 AND t.tenant_code = $2 AND t.cancelled_at IS NULL
         GROUP BY t.entering_warehouse_code, l.product_code
         UNION ALL
         SELECT t.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
         FROM warehouse_transfer_lines l
         INNER JOIN warehouse_transfers t ON t.id = l.transfer_id
         WHERE t.exiting_warehouse_code = $1 AND t.tenant_code = $2 AND t.cancelled_at IS NULL
         GROUP BY t.exiting_warehouse_code, l.product_code
         UNION ALL
         SELECT v.entering_warehouse_code, l.product_code, SUM(l.total_quantity)
         FROM vehicle_loading_lines l
         INNER JOIN vehicle_loadings v ON v.id = l.loading_id
         WHERE v.entering_warehouse_code = $1 AND v.tenant_code = $2 AND v.cancelled_at IS NULL
         GROUP BY v.entering_warehouse_code, l.product_code
         UNION ALL
         SELECT v.exiting_warehouse_code, l.product_code, -SUM(l.total_quantity)
         FROM vehicle_loading_lines l
         INNER JOIN vehicle_loadings v ON v.id = l.loading_id
         WHERE v.exiting_warehouse_code = $1 AND v.tenant_code = $2 AND v.cancelled_at IS NULL
         GROUP BY v.exiting_warehouse_code, l.product_code
         UNION ALL
         SELECT i.warehouse_code, l.product_code, -SUM(l.total_quantity)
         FROM sales_invoice_lines l
         INNER JOIN sales_invoices i ON i.id = l.invoice_id
         INNER JOIN customer_cards c ON c.code = i.customer_code
           AND c.tenant_code = $2
         WHERE i.warehouse_code = $1 AND i.cancelled IS NOT TRUE
         GROUP BY i.warehouse_code, l.product_code
       )
       SELECT p.code AS "productCode", p.name AS "productName", p.unit,
         COALESCE(SUM(m.quantity), 0) AS quantity,
         COALESCE(unit_data.units, jsonb_build_array(
           jsonb_build_object('unit', p.unit, 'innerQuantity', 1)
         )) AS units
       FROM factory_products p
       LEFT JOIN movements m ON m.product_code = p.code AND m.warehouse_code = $1
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object('unit', available_units.unit, 'innerQuantity', available_units.inner_quantity)
           ORDER BY available_units.id
         ) AS units
         FROM (
           SELECT u.id, u.unit,
             CASE
               WHEN REPLACE(NULLIF(BTRIM(u.inner_quantity), ''), ',', '.') ~ '^[0-9]+(\\.[0-9]+)?$'
                 THEN REPLACE(BTRIM(u.inner_quantity), ',', '.')::numeric
               ELSE NULL
             END AS inner_quantity
           FROM product_units u
           WHERE u.product_code = p.code
           UNION ALL
           SELECT 0, p.unit, 1::numeric
           WHERE NOT EXISTS (
             SELECT 1 FROM product_units base_unit
             WHERE base_unit.product_code = p.code AND base_unit.unit = p.unit
           )
         ) available_units
       ) unit_data ON TRUE
       WHERE p.active = TRUE
       GROUP BY p.code, p.name, p.unit, unit_data.units
       HAVING COALESCE(SUM(m.quantity), 0) <> 0
       ORDER BY p.name`,
      [warehouseCode, context.tenantCode],
    )
    return res.json({
      warehouseCode,
      stock: result.rows.map((item) => ({ ...item, quantity: Number(item.quantity) })),
      serverTime: new Date().toISOString(),
    })
  }))

  router.post('/day/open', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    const businessDate = dateInIstanbul()
    const routeDay = dayInIstanbul()
    const openingOdometerKm = req.body?.openingOdometerKm
    if (!Number.isFinite(openingOdometerKm) || openingOdometerKm < 0) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Geçerli bir başlangıç kilometresi girin.')
    }
    try {
      await client.query('BEGIN')
      const scopeKey = `${context.tenantCode}:${context.salesRepresentativeId}:${businessDate}`
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [scopeKey])
      const existing = await client.query(
        `SELECT id, distributor_user_id AS "distributorUserId", device_id AS "deviceId",
           business_date AS "businessDate", route_day AS "routeDay", status,
           opening_snapshot AS "openingSnapshot", closing_summary AS "closingSummary",
           opened_at AS "openedAt", closed_at AS "closedAt",
           opening_odometer_km::float8 AS "openingOdometerKm",
           closing_odometer_km::float8 AS "closingOdometerKm",
           CASE WHEN closing_odometer_km IS NULL THEN NULL
                ELSE (closing_odometer_km - opening_odometer_km)::float8 END AS "traveledKm"
         FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2 AND business_date = $3
         ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, opened_at DESC
         LIMIT 1
         FOR UPDATE`,
        [context.tenantCode, context.salesRepresentativeId, businessDate],
      )
      if (existing.rowCount && existing.rows[0].status === 'open') {
        const currentSession = existing.rows[0]
        if (currentSession.distributorUserId !== context.userId
          || currentSession.deviceId !== context.deviceId) {
          await client.query('COMMIT')
          return publicError(res, 409, 'WORKDAY_ALREADY_OPEN', 'Bugünün oturumu başka bir mobil cihazda açılmış.')
        }
        if (currentSession.openingOdometerKm == null) {
          const updated = await client.query(
            `UPDATE mobile_work_sessions
             SET opening_odometer_km = $2
             WHERE id = $1 AND opening_odometer_km IS NULL
             RETURNING id, business_date AS "businessDate", route_day AS "routeDay", status,
               opening_snapshot AS "openingSnapshot", closing_summary AS "closingSummary",
               opened_at AS "openedAt", closed_at AS "closedAt",
               opening_odometer_km::float8 AS "openingOdometerKm",
               closing_odometer_km::float8 AS "closingOdometerKm",
               CASE WHEN closing_odometer_km IS NULL THEN NULL
                    ELSE (closing_odometer_km - opening_odometer_km)::float8 END AS "traveledKm"`,
            [currentSession.id, openingOdometerKm],
          )
          await auditMobile(client, req, {
            entityType: 'mobile_work_session',
            entityId: currentSession.id,
            action: 'opening_odometer_recorded',
            username: context.username,
            tenantCode: context.tenantCode,
            representativeId: context.salesRepresentativeId,
            deviceId: context.deviceId,
            result: { businessDate, openingOdometerKm },
          })
          await client.query('COMMIT')
          return res.json({
            session: updated.rows[0],
            alreadyOpen: true,
            odometerRecorded: true,
            serverTime: new Date().toISOString(),
          })
        }
        await client.query('COMMIT')
        return res.json({ session: currentSession, alreadyOpen: true, serverTime: new Date().toISOString() })
      }

      const openingSnapshot = await buildOpeningSnapshot(client, context, businessDate, routeDay)
      const id = randomUUID()
      const saved = await client.query(
        `INSERT INTO mobile_work_sessions
           (id, tenant_code, distributor_user_id, sales_representative_id, device_id,
            business_date, route_day, opening_snapshot, opening_odometer_km)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id, business_date AS "businessDate", route_day AS "routeDay", status,
           opening_snapshot AS "openingSnapshot", closing_summary AS "closingSummary",
           opened_at AS "openedAt", closed_at AS "closedAt",
           opening_odometer_km::float8 AS "openingOdometerKm",
           closing_odometer_km::float8 AS "closingOdometerKm",
           NULL::float8 AS "traveledKm"`,
        [id, context.tenantCode, context.userId, context.salesRepresentativeId,
          context.deviceId, businessDate, routeDay, JSON.stringify(openingSnapshot), openingOdometerKm],
      )
      await auditMobile(client, req, {
        entityType: 'mobile_work_session',
        entityId: id,
        action: 'opened',
        username: context.username,
        tenantCode: context.tenantCode,
        representativeId: context.salesRepresentativeId,
        deviceId: context.deviceId,
        result: { businessDate, routeDay, vehicleWarehouseCode: openingSnapshot.vehicleWarehouse.code },
      })
      await client.query('COMMIT')
      return res.status(201).json({ session: saved.rows[0], alreadyOpen: false, serverTime: new Date().toISOString() })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error.statusCode) return publicError(res, error.statusCode, 'WORKDAY_OPEN_FAILED', error.message)
      return respondForDatabaseError(res, error, 'Günlük açılış verileri alınamadı.')
    }
  }))

  router.post('/day/close', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    const {
      pendingOperationCount,
      closingOdometerKm,
      openingOdometerKm: submittedOpeningOdometerKm = null,
      routeOrder = null,
      workSessionId = null,
    } = req.body ?? {}
    if (!Number.isSafeInteger(pendingOperationCount) || pendingOperationCount < 0
      || !Number.isFinite(closingOdometerKm) || closingOdometerKm < 0
      || (submittedOpeningOdometerKm !== null
        && (!Number.isFinite(submittedOpeningOdometerKm) || submittedOpeningOdometerKm < 0))
      || (workSessionId != null && (typeof workSessionId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workSessionId)))
      || (routeOrder != null && (!Array.isArray(routeOrder) || routeOrder.length > 1000
        || routeOrder.some((item, index) => !item || typeof item.customerCode !== 'string'
          || item.position !== index)))) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Bekleyen işlem sayısı, kapanış kilometresi veya rut sırası geçersiz.')
    }
    if (pendingOperationCount > 0) {
      return publicError(res, 409, 'PENDING_OPERATIONS', 'Kapanıştan önce bekleyen işlemler eşitlenmelidir.')
    }
    const businessDate = dateInIstanbul()
    try {
      await client.query('BEGIN')
      const result = await client.query(
        `SELECT id, status, opening_snapshot AS "openingSnapshot",
           opening_odometer_km::float8 AS "openingOdometerKm",
           closing_summary AS "closingSummary", closed_at AS "closedAt",
           business_date AS "businessDate", opened_at AS "openedAt"
         FROM mobile_work_sessions
         WHERE tenant_code = $1 AND sales_representative_id = $2
           AND distributor_user_id = $3
           AND (($4::uuid IS NULL AND business_date = $5) OR id = $4::uuid)
         ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, opened_at DESC
         LIMIT 1
         FOR UPDATE`,
        [context.tenantCode, context.salesRepresentativeId, context.userId, workSessionId, businessDate],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'WORKDAY_NOT_OPEN', 'Önce bugünün açılışını yapmalısınız.')
      }
      if (result.rows[0].businessDate > businessDate) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'INVALID_WORKDAY_DATE', 'Gelecek tarihli çalışma günü kapatılamaz.')
      }
      if (result.rows[0].status === 'closed') {
        await client.query('COMMIT')
        return res.json({ id: result.rows[0].id, status: 'closed', closedAt: result.rows[0].closedAt, alreadyClosed: true })
      }
      let openingOdometerKm = result.rows[0].openingOdometerKm
      if (openingOdometerKm == null) {
        const previous = await client.query(
          `SELECT closing_odometer_km::float8 AS "closingOdometerKm"
           FROM mobile_work_sessions
           WHERE tenant_code = $1 AND sales_representative_id = $2
             AND status = 'closed' AND closing_odometer_km IS NOT NULL
             AND opened_at < $3
           ORDER BY opened_at DESC
           LIMIT 1`,
          [context.tenantCode, context.salesRepresentativeId, result.rows[0].openedAt],
        )
        openingOdometerKm = submittedOpeningOdometerKm ?? previous.rows[0]?.closingOdometerKm
        if (openingOdometerKm == null) {
          await client.query('ROLLBACK')
          return publicError(res, 400, 'MISSING_OPENING_ODOMETER', 'Başlangıç kilometresi bulunamadı. Önceki kapanış kilometresi yok; başlangıç kilometresini girin.')
        }
      }
      if (closingOdometerKm < openingOdometerKm) {
        await client.query('ROLLBACK')
        return publicError(res, 400, 'INVALID_ODOMETER', 'Kapanış kilometresi başlangıç kilometresinden küçük olamaz.')
      }
      const openingRoute = result.rows[0].openingSnapshot.route ?? []
      const submittedRoute = routeOrder ?? []
      if (routeOrder != null && (submittedRoute.length !== openingRoute.length
        || new Set(submittedRoute.map((item) => item.customerCode)).size !== submittedRoute.length
        || submittedRoute.some((item) => !openingRoute.some((stop) => stop.customerCode === item.customerCode)))) {
        await client.query('ROLLBACK')
        return publicError(res, 400, 'INVALID_ROUTE_ORDER', 'Rut sırası açılıştaki bugünkü müşteri listesinin tamamını içermelidir.')
      }
      const pending = await client.query(
        `SELECT COUNT(*)::integer AS count
         FROM mobile_sync_operations
         WHERE device_id = $1 AND status IN ('processing', 'retry')`,
        [context.deviceId],
      )
      if (pending.rows[0].count > 0) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'PENDING_SERVER_OPERATIONS', 'Sunucuda sonuçlanmamış işlemler var; yeniden eşitleyip deneyin.')
      }

      const closingSummary = {
        pendingOperationCount: 0,
        routeOrder: routeOrder == null ? null : submittedRoute,
        openingOdometerKm,
        closingOdometerKm,
        traveledKm: closingOdometerKm - openingOdometerKm,
        openedAt: result.rows[0].openingSnapshot.capturedAt,
        synchronizedAt: new Date().toISOString(),
      }
      const updated = await client.query(
        `UPDATE mobile_work_sessions
         SET status = 'closed', closing_summary = $1::jsonb,
           opening_odometer_km = $2, closing_odometer_km = $3, closed_at = NOW()
         WHERE id = $4
         RETURNING id, status, closed_at AS "closedAt", closing_summary AS "closingSummary"`,
        [JSON.stringify(closingSummary), openingOdometerKm, closingOdometerKm, result.rows[0].id],
      )
      await auditMobile(client, req, {
        entityType: 'mobile_work_session',
        entityId: result.rows[0].id,
        action: 'closed',
        username: context.username,
        tenantCode: context.tenantCode,
        representativeId: context.salesRepresentativeId,
        deviceId: context.deviceId,
        result: closingSummary,
      })
      await client.query('COMMIT')
      return res.json(updated.rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error, 'Günlük kapanış tamamlanamadı.')
    }
  }))

  router.get('/bootstrap', mobileSyncRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    if (!context.capabilities['mobile.customer.read'] || !context.capabilities['mobile.route.read']) {
      return publicError(res, 403, 'FORBIDDEN', 'Bootstrap için cari ve rota okuma yetkileri gereklidir.')
    }
    const limit = asPositiveInteger(req.query.limit, 50, MAX_PAGE_SIZE)
    if (limit === null) return publicError(res, 400, 'VALIDATION_ERROR', 'Sayfa boyutu geçersiz.')
    const page = await bootstrapPage(client, context, limit, req.query.pageToken)
    if (page.error) return publicError(res, 400, 'INVALID_PAGE_TOKEN', 'Bootstrap sayfa imleci geçersiz.')
    return res.json(page)
  }))

  router.get('/sync/pull', mobileSyncRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    if (!context.capabilities['mobile.customer.read'] || !context.capabilities['mobile.route.read']) {
      return publicError(res, 403, 'FORBIDDEN', 'Senkronizasyon için cari ve rota okuma yetkileri gereklidir.')
    }
    const cursor = asCursor(req.query.cursor)
    if (cursor === null) return publicError(res, 400, 'VALIDATION_ERROR', 'Senkronizasyon cursor değeri geçersiz.')
    const limit = asPositiveInteger(req.query.limit, 100, MAX_PULL_SIZE)
    if (limit === null) return publicError(res, 400, 'VALIDATION_ERROR', 'Sayfa boyutu geçersiz.')
    const changesResult = await client.query(
      `SELECT sequence::text AS sequence, entity_type AS "entityType", entity_key AS "entityKey",
         change_type AS "changeType", tenant_code AS "tenantCode",
         sales_representative_id AS "salesRepresentativeId", changed_at AS "changedAt"
       FROM mobile_sync_changes
       WHERE sequence > $1
         AND (
           (tenant_code = $2 AND (
             entity_type = 'customer'
             OR (sales_representative_id = $3
               AND entity_type IN ('sales_representative', 'route_assignment', 'customer_access', 'order', 'sales_invoice', 'field_visit'))
           ))
           OR (tenant_code IS NULL AND entity_type IN ('product', 'product_unit', 'price', 'promotion'))
         )
       ORDER BY sequence LIMIT $4`,
      [cursor, context.tenantCode, context.salesRepresentativeId, limit + 1],
    )
    const rows = changesResult.rows.slice(0, limit)
    const changes = []
    for (const change of rows) {
      if (change.entityType === 'customer') {
        const assigned = await client.query(
          `SELECT 1 FROM sales_rep_customers
           WHERE customer_code = $1 AND tenant_code = $2
             AND sales_representative_id = $3 AND active = TRUE LIMIT 1`,
          [change.entityKey, context.tenantCode, context.salesRepresentativeId],
        )
        if (!assigned.rowCount) continue
      }
      const record = change.changeType === 'delete'
        ? null
        : await getEntitySnapshot(client, context, change.entityType, change.entityKey)
      if (change.changeType === 'upsert' && !record) {
        changes.push({ ...change, changeType: 'delete', record: null })
      } else {
        changes.push({ ...change, record })
      }
    }
    const nextCursor = rows.length ? rows.at(-1).sequence : String(cursor)
    const hasMore = changesResult.rows.length > limit
    await client.query('UPDATE mobile_devices SET last_sync_at = NOW() WHERE id = $1', [context.deviceId])
    return res.json({
      changes,
      nextCursor,
      hasMore,
      serverTime: new Date().toISOString(),
    })
  }))

  router.get('/sync/operations/:operationId', mobileSyncRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    if (!validUuid(req.params.operationId)) return publicError(res, 400, 'VALIDATION_ERROR', 'İşlem kimliği geçersiz.')
    const result = await client.query(
      `SELECT operation_id AS "operationId", operation_type AS "operationType", status,
         erp_object_type AS "erpObjectType", erp_object_id AS "erpObjectId",
         erp_document_number AS "documentNumber", result_summary AS result,
         error_code AS code, server_received_at AS "serverReceivedAt", processed_at AS "processedAt"
       FROM mobile_sync_operations
       WHERE operation_id = $1 AND device_id = $2 AND user_id = $3
         AND tenant_code = $4 AND sales_representative_id = $5`,
      [req.params.operationId, context.deviceId, context.userId, context.tenantCode, context.salesRepresentativeId],
    )
    if (!result.rowCount) return publicError(res, 404, 'OPERATION_NOT_FOUND', 'İşlem bulunamadı.')
    if (['order.submit', 'sale.submit'].includes(result.rows[0].operationType) && !context.capabilities['mobile.order.read']) {
      return publicError(res, 403, 'FORBIDDEN', 'Sipariş sonucu için okuma yetkiniz yok.')
    }
    return res.json(result.rows[0])
  }))

  router.post('/documents/:operationId/printed', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    if (!validUuid(req.params.operationId)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Belge işlem kimliği geçersiz.')
    }
    const rawPrintNumber = req.body?.printNumber
    if (rawPrintNumber != null && typeof rawPrintNumber !== 'string') {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Fatura numarası metin olmalıdır.')
    }
    const printNumber = typeof rawPrintNumber === 'string' ? rawPrintNumber.trim() : null
    if (printNumber && printNumber.length > 100) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Fatura numarası en fazla 100 karakter olabilir.')
    }
    await client.query('BEGIN')
    try {
      const operation = await client.query(
        `SELECT i.id, i.printed_at AS "printedAt", i.mobile_status AS status,
           i.cancelled
         FROM mobile_sync_operations o
         INNER JOIN sales_invoices i ON i.id::text = o.erp_object_id
         WHERE o.operation_id = $1 AND o.device_id = $2 AND o.user_id = $3
           AND o.tenant_code = $4 AND o.sales_representative_id = $5
           AND o.operation_type = 'sale.submit' AND o.status = 'accepted'
           AND o.erp_object_type = 'sales_invoice'
           AND i.tenant_code = $4 AND i.sales_representative_id = $5
           AND i.originating_user_id = $3 AND i.source_channel = 'MOBILE'
           AND i.mobile_operation_id = o.operation_id
         FOR UPDATE OF o, i`,
        [req.params.operationId, context.deviceId, context.userId, context.tenantCode, context.salesRepresentativeId],
      )
      if (!operation.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 404, 'DOCUMENT_NOT_FOUND', 'Mobil satış faturası bulunamadı.')
      }
      if (operation.rows[0].status === 'CANCELLED' || operation.rows[0].cancelled) {
        await client.query('COMMIT')
        return res.status(204).end()
      }
      const marked = await markMobileSalesInvoicePrinted({
        client,
        invoiceId: operation.rows[0].id,
        operationId: req.params.operationId,
        printNumber,
        tenantCode: context.tenantCode,
        salesRepresentativeId: context.salesRepresentativeId,
        userId: context.userId,
        username: context.username,
      })
      if (!marked) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'DOCUMENT_CANNOT_BE_PRINTED', 'Satış faturası iptal edilmiş veya artık yazdırılamıyor.')
      }
      if (operation.rows[0].printedAt == null) {
        await auditMobile(client, req, {
          entityType: 'mobile_sales_invoice',
          entityId: operation.rows[0].id,
          action: 'printed',
          username: context.username,
          tenantCode: context.tenantCode,
          representativeId: context.salesRepresentativeId,
          deviceId: context.deviceId,
          result: { operationId: req.params.operationId, printNumber },
        })
      }
      await client.query('COMMIT')
      return res.status(204).end()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    }
  }))

  router.put('/documents/:operationId', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    if (!validUuid(req.params.operationId)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Belge işlem kimliği geçersiz.')
    }
    const payload = req.body?.payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Düzeltilmiş satış bilgileri zorunludur.')
    }
    await client.query('BEGIN')
    try {
      const operation = await client.query(
        `SELECT o.operation_type AS "operationType", o.status,
           o.erp_object_type AS "erpObjectType", o.erp_object_id AS "erpObjectId",
           i.id, i.customer_code AS "customerCode", i.total_amount AS "totalAmount",
           i.warehouse_code AS "warehouseCode"
         FROM mobile_sync_operations o
         INNER JOIN sales_invoices i ON i.id::text = o.erp_object_id
         WHERE o.operation_id = $1 AND o.device_id = $2 AND o.user_id = $3
           AND o.tenant_code = $4 AND o.sales_representative_id = $5
           AND o.operation_type = 'sale.submit' AND o.status = 'accepted'
           AND o.erp_object_type = 'sales_invoice'
           AND i.tenant_code = $4 AND i.sales_representative_id = $5
           AND i.originating_user_id = $3 AND i.source_channel = 'MOBILE'
           AND i.mobile_operation_id = o.operation_id
           AND i.mobile_status = 'ACCEPTED' AND i.cancelled IS NOT TRUE
           AND i.printed_at IS NULL
         FOR UPDATE OF o, i`,
        [req.params.operationId, context.deviceId, context.userId, context.tenantCode, context.salesRepresentativeId],
      )
      if (!operation.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'DOCUMENT_CANNOT_BE_EDITED', 'Yalnızca aktif ve mobilde oluşturulmuş satış faturaları düzeltilebilir.')
      }

      const result = await replaceMobileSalesInvoice({
        client,
        req,
        context,
        operationId: req.params.operationId,
        invoice: operation.rows[0],
        payload,
      })
      if (result.status !== 'accepted') {
        await client.query('COMMIT')
        return publicError(
          res,
          409,
          result.code ?? 'SALE_CORRECTION_REJECTED',
          'Düzeltilmiş sıcak satış kaydedilemedi.',
          result.result,
        )
      }

      await client.query(
        `UPDATE mobile_sync_operations
         SET payload_hash = $1, result_summary = $2::jsonb, erp_document_number = $3,
           error_code = NULL, processed_at = NOW()
         WHERE operation_id = $4 AND status = 'accepted'`,
        [
          hashPayload({ type: 'sale.submit', payload }),
          JSON.stringify(result.result),
          result.documentNumber,
          req.params.operationId,
        ],
      )
      await client.query('COMMIT')
      return res.json({
        operationId: req.params.operationId,
        status: 'accepted',
        result: result.result,
        erpObjectType: result.erpObjectType,
        erpObjectId: result.erpObjectId,
        documentNumber: result.documentNumber,
      })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    }
  }))

  router.delete('/documents/:operationId', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    if (!validUuid(req.params.operationId)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Belge işlem kimliği geçersiz.')
    }
    await client.query('BEGIN')
    try {
      const operation = await client.query(
        `SELECT operation_type AS "operationType", status, erp_object_type AS "erpObjectType",
           erp_object_id AS "erpObjectId"
         FROM mobile_sync_operations
         WHERE operation_id = $1 AND device_id = $2 AND user_id = $3
           AND tenant_code = $4 AND sales_representative_id = $5
         FOR UPDATE`,
        [req.params.operationId, context.deviceId, context.userId, context.tenantCode, context.salesRepresentativeId],
      )
      if (!operation.rowCount || !['order.submit', 'sale.submit'].includes(operation.rows[0].operationType)) {
        await client.query('ROLLBACK')
        return publicError(res, 404, 'DOCUMENT_NOT_FOUND', 'Sipariş veya satış bulunamadı.')
      }
      if (operation.rows[0].status !== 'accepted' || !operation.rows[0].erpObjectId) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'DOCUMENT_NOT_READY', 'Senkronize edilmemiş belge silinemez.')
      }

      const { operationType, erpObjectType, erpObjectId } = operation.rows[0]
      let cancelled
      if (operationType === 'order.submit' && erpObjectType === 'order') {
        cancelled = await client.query(
          `UPDATE orders SET mobile_status = 'CANCELLED'
           WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
             AND originating_user_id = $4 AND source_channel = 'MOBILE'
             AND mobile_operation_id = $5 AND mobile_status = 'ACCEPTED'
           RETURNING id`,
          [erpObjectId, context.tenantCode, context.salesRepresentativeId, context.userId, req.params.operationId],
        )
        if (cancelled.rowCount) {
          await auditMobile(client, req, {
            entityType: 'mobile_order',
            entityId: erpObjectId,
            action: 'cancelled',
            username: context.username,
            tenantCode: context.tenantCode,
            representativeId: context.salesRepresentativeId,
            deviceId: context.deviceId,
            result: { operationId: req.params.operationId },
          })
        } else {
          const existing = await client.query(
            `SELECT id FROM orders
             WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
               AND originating_user_id = $4 AND source_channel = 'MOBILE'
               AND mobile_operation_id = $5 AND mobile_status = 'CANCELLED'`,
            [erpObjectId, context.tenantCode, context.salesRepresentativeId, context.userId, req.params.operationId],
          )
          if (!existing.rowCount) {
            await client.query('ROLLBACK')
            return publicError(res, 409, 'DOCUMENT_CANNOT_BE_CANCELLED', 'Sipariş artık iptal edilemiyor.')
          }
        }
      } else if (operationType === 'sale.submit' && erpObjectType === 'sales_invoice') {
        const invoice = await client.query(
          `SELECT id, printed_at AS "printedAt", transfer_code AS "transferCode",
             customer_code AS "customerCode", total_amount AS "totalAmount",
             cancelled, mobile_status AS status,
             EXISTS (SELECT 1 FROM purchase_invoices p
               WHERE p.source_factory_sales_invoice_id = sales_invoices.id)
               OR EXISTS (SELECT 1 FROM shipment_batch_orders b
                 WHERE b.invoice_id = sales_invoices.id)
               OR EXISTS (SELECT 1 FROM factory_invoice_cancellation_requests r
                 WHERE r.sales_invoice_id = sales_invoices.id) AS "isReferenced"
           FROM sales_invoices
           WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
             AND originating_user_id = $4 AND source_channel = 'MOBILE'
             AND mobile_operation_id = $5
           FOR UPDATE`,
          [erpObjectId, context.tenantCode, context.salesRepresentativeId, context.userId, req.params.operationId],
        )
        if (!invoice.rowCount) {
          await client.query('ROLLBACK')
          return publicError(res, 409, 'DOCUMENT_CANNOT_BE_CANCELLED', 'Satış faturası bulunamadı.')
        }
        if (invoice.rows[0].printedAt == null && !invoice.rows[0].cancelled) {
          if (invoice.rows[0].transferCode || invoice.rows[0].isReferenced) {
            await client.query('ROLLBACK')
            return publicError(res, 409, 'DOCUMENT_ALREADY_TRANSFERRED', 'Aktarılmış satış silinemez veya geri alınamaz.')
          }
          await reverseSalesInvoiceCustomerBalance({
            client,
            customerCode: invoice.rows[0].customerCode,
            totalAmount: invoice.rows[0].totalAmount,
            tenantCode: context.tenantCode,
          })
          await client.query(
            `UPDATE mobile_sync_operations
             SET status = 'rejected', error_code = 'DOCUMENT_DELETED',
               erp_object_type = NULL, erp_object_id = NULL, erp_document_number = NULL,
               result_summary = NULL, processed_at = NOW()
             WHERE operation_id = $1 AND status = 'accepted'`,
            [req.params.operationId],
          )
          const deleted = await client.query(
            `DELETE FROM sales_invoices
             WHERE id = $1 AND tenant_code = $2 AND mobile_operation_id = $3`,
            [erpObjectId, context.tenantCode, req.params.operationId],
          )
          if (!deleted.rowCount) throw new Error('Unprinted mobile sales invoice was not deleted.')
          await auditMobile(client, req, {
            entityType: 'mobile_sales_invoice',
            entityId: erpObjectId,
            action: 'deleted',
            username: context.username,
            tenantCode: context.tenantCode,
            representativeId: context.salesRepresentativeId,
            deviceId: context.deviceId,
            result: { operationId: req.params.operationId },
          })
        } else {
          const reversed = await cancelMobileSalesInvoice({
            client,
            invoiceId: erpObjectId,
            operationId: req.params.operationId,
            tenantCode: context.tenantCode,
            salesRepresentativeId: context.salesRepresentativeId,
            userId: context.userId,
          })
          if (reversed) {
            await auditMobile(client, req, {
              entityType: 'mobile_sales_invoice',
              entityId: erpObjectId,
              action: 'cancelled',
              username: context.username,
              tenantCode: context.tenantCode,
              representativeId: context.salesRepresentativeId,
              deviceId: context.deviceId,
              result: { operationId: req.params.operationId },
            })
          } else {
            const existing = await client.query(
              `SELECT id FROM sales_invoices
               WHERE id = $1 AND tenant_code = $2 AND sales_representative_id = $3
                 AND originating_user_id = $4 AND source_channel = 'MOBILE'
                 AND mobile_operation_id = $5 AND mobile_status = 'CANCELLED'
                 AND cancelled IS TRUE`,
              [erpObjectId, context.tenantCode, context.salesRepresentativeId, context.userId, req.params.operationId],
            )
            if (!existing.rowCount) {
              await client.query('ROLLBACK')
              return publicError(res, 409, 'DOCUMENT_CANNOT_BE_CANCELLED', 'Satış faturası artık iptal edilemiyor.')
            }
          }
        }
      } else {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'DOCUMENT_TYPE_MISMATCH', 'Belge türü doğrulanamadı.')
      }

      await client.query('COMMIT')
      return res.status(204).end()
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    }
  }))

  router.post('/sync/push', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.sync', async ({ req, res, client, context }) => {
    const { deviceId, batchId, operations } = req.body ?? {}
    if (deviceId !== context.deviceId || !validUuid(batchId) || !Array.isArray(operations)
      || operations.length === 0 || operations.length > MAX_SYNC_BATCH_SIZE) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Cihaz, batch kimliği ve 1-50 arası işlem zorunludur.')
    }
    const results = []
    for (const operation of operations) {
      try {
        results.push(await handleOperation(client, req, context, operation))
      } catch (error) {
        if (error.code === '23514' && error.constraint === 'mobile_operation_reset_cutoff') {
          results.push({ operationId: operation?.operationId ?? null, status: 'rejected', code: 'RESET_REQUIRED' })
          continue
        }
        if (isMissingMobileMigration(error)) {
          return publicError(res, 503, 'MOBILE_MIGRATION_REQUIRED', 'Mobil backend veritabanı geçişi henüz uygulanmamış.')
        }
        console.error('Mobile sync operation failed:', error)
        const classified = classifyMobileSyncException(error)
        await client.query('ROLLBACK').catch(() => undefined)
        await client.query(
          `UPDATE mobile_sync_operations
           SET status = $1, processed_at = NOW(), error_code = $2, result_summary = $3::jsonb
           WHERE operation_id = $4`,
          [
            classified.status,
            classified.code,
            JSON.stringify({
              databaseCode: error?.code ?? null,
              constraint: error?.constraint ?? null,
              detail: error?.detail ?? null,
            }),
            operation?.operationId,
          ],
        ).catch((updateError) => console.error('Mobile sync operation status update failed:', updateError))
        results.push({
          operationId: operation?.operationId ?? null,
          status: classified.status,
          code: classified.code,
          result: classified.status === 'retry' ? undefined : undefined,
        })
      }
    }
    return res.json({
      batchId,
      results,
      serverTime: new Date().toISOString(),
    })
  }))

  router.get('/customers/:customerCode/sales-context', withMobileContext(databaseUrl, 'mobile.customer.read', async ({ req, res, client, context }) => {
    const customer = await assertAssignedCustomer(client, context, req.params.customerCode)
    if (!customer) {
      await auditAuthorizationDenial(client, req, context, req.params.customerCode, 'customer_not_assigned')
      return publicError(res, 403, 'CUSTOMER_NOT_ASSIGNED', 'Cari bu temsilciye atanmış değil.')
    }
    const pricingMigration = await client.query(
      `SELECT 1 FROM mobile_backend_migrations
       WHERE name = '003-mobile-order-tax-snapshot'`,
    )
    const lastOrder = await client.query(
        `SELECT order_no AS "orderNo", order_date AS "orderDate", total_amount AS "totalAmount",
           mobile_status AS status
         FROM orders WHERE customer_code = $1 AND tenant_code = $2
           AND sales_representative_id = $3 AND originating_user_id = $4
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        [customer.code, context.tenantCode, context.salesRepresentativeId, context.userId],
      )
    const accountMovements = await client.query(
      `SELECT movement_date AS date, movement_type AS type, reference,
          description, balance_effect::text AS "balanceEffect"
       FROM (
          SELECT invoice_date AS movement_date, 'Satış Faturası' AS movement_type,
            COALESCE(invoice_no, 'Fatura #' || id::text) AS reference,
            'Satış faturası' AS description, total_amount AS balance_effect, id AS source_id
          FROM sales_invoices
          WHERE customer_code = $1 AND tenant_code = $2
            AND invoice_date >= ($3::date - INTERVAL '1 month')::date
            AND invoice_date <= $3::date AND cancelled IS NOT TRUE
          UNION ALL
          SELECT r.invoice_date, 'İade Faturası',
            COALESCE(r.invoice_no, 'İade #' || r.id::text),
            COALESCE(r.return_type, 'İade faturası'), -r.total_amount, r.id
          FROM return_invoices r
          INNER JOIN customer_cards c ON c.code = r.customer_code AND c.tenant_code = $2
          WHERE r.customer_code = $1
            AND r.invoice_date >= ($3::date - INTERVAL '1 month')::date
            AND r.invoice_date <= $3::date
          UNION ALL
          SELECT op.operation_date, COALESCE(NULLIF(op.operation_type, ''), 'Tahsilat'),
            'Tahsilat #' || op.id::text, op.description,
            op.amount * op.balance_delta, op.id
          FROM customer_collection_operations op
          INNER JOIN customer_cards c ON c.code = op.customer_code AND c.tenant_code = $2
          WHERE op.customer_code = $1
            AND op.operation_date >= ($3::date - INTERVAL '1 month')::date
            AND op.operation_date <= $3::date
       ) movements
       ORDER BY movement_date DESC, source_id DESC`,
      [customer.code, context.tenantCode, dateInIstanbul()],
    )
    return res.json({
      customer: {
        code: customer.code,
        name: customer.name,
        title: customer.title,
        phone: customer.phone,
        mobilePhone: customer.mobile_phone,
        address: customer.address,
        taxNo: customer.tax_no,
        tckn: customer.tckn,
        taxOffice: customer.tax_office,
        province: customer.province,
        district: customer.district,
        balance: customer.balance,
      },
      discounts: {
        m1: customer.customerDiscount1,
        m2: customer.customerDiscount2,
        m3: customer.customerDiscount3,
        cash: customer.cashDiscount,
        deferred: customer.deferredDiscount,
      },
      risk: null,
      lastOrder: lastOrder.rows[0] ?? null,
      accountMovements: accountMovements.rows,
      pricing: pricingMigration.rowCount
        ? { available: true, quoteEndpoint: '/mobile/v1/pricing/quote', taxSemantics: 'NET_VAT_EXCLUSIVE_V1' }
        : { available: false, reason: 'MOBILE_TAX_MIGRATION_REQUIRED' },
      asOf: new Date().toISOString(),
    })
  }))

  router.get('/customer-types', withMobileContext(databaseUrl, 'mobile.customer.read', async ({ res, client }) => {
    const result = await client.query(
      `SELECT code, name FROM customer_types
       WHERE LENGTH(name) <= 80 AND LOWER(name) IN ('perakende', 'horeca')
       ORDER BY CASE WHEN LOWER(name) = 'perakende' THEN 0 ELSE 1 END, code`,
    )
    return res.json({ types: result.rows })
  }))

  router.get('/customer-groups', withMobileContext(databaseUrl, 'mobile.customer.read', async ({ res, client }) => {
    const result = await client.query(
      `SELECT code, name FROM customer_groups
       ORDER BY name, code`,
    )
    return res.json({ groups: result.rows })
  }))

  router.get('/customers/tax-number-check', withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const taxNo = typeof req.query.taxNo === 'string' ? req.query.taxNo.trim() : ''
    if (!taxNo || taxNo.length > 40 || !normalizeTaxNumber(taxNo)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Geçerli bir vergi numarası girin.')
    }
    return res.json({ exists: await customerTaxNumberExists(client, context.tenantCode, taxNo) })
  }))

  router.post('/customers', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const body = req.body ?? {}
    await client.query('BEGIN')
    try {
      const result = await createMobileCustomer(client, req, context, body)
      if (result.status === 'rejected') {
        await client.query('ROLLBACK')
        const status = result.code === 'DUPLICATE_TAX_NUMBER' ? 409 : 400
        const message = result.code === 'DUPLICATE_TAX_NUMBER'
          ? 'Bu VKN veya TCKN ile kayıtlı bir müşteri zaten var.'
          : result.code === 'INVALID_CUSTOMER_TYPE'
            ? 'Seçilen müşteri türü bulunamadı.'
            : result.code === 'LOCATION_REQUIRED'
              ? 'Müşteri için en fazla 50 metre doğrulukta GPS konumu gereklidir.'
              : 'Vergi dairesi ve VKN veya 11 haneli TCKN zorunludur; diğer alanlar geçerli uzunlukta olmalıdır.'
        return publicError(res, status, result.code, message)
      }
      await client.query('COMMIT')
      return res.status(201).json(result.result)
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    }
  }))

  router.get('/customers/:customerCode/products/:productCode/unit-price', withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const customer = await assertAssignedCustomer(client, context, req.params.customerCode)
    if (!customer) {
      await auditAuthorizationDenial(client, req, context, req.params.customerCode, 'customer_not_assigned')
      return publicError(res, 403, 'CUSTOMER_NOT_ASSIGNED', 'Cari bu temsilciye atanmış değil.')
    }
    const unitCode = typeof req.query.unitCode === 'string' ? req.query.unitCode.trim() : ''
    const documentType = req.query.documentType
    if (!['order', 'van_sale'].includes(documentType)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Belge türü geçersiz.')
    }
    const productResult = await client.query(
      `SELECT p.code, p.name, p.unit, p.vat, p.active,
         u.inner_quantity AS "innerQuantity"
       FROM factory_products p
       LEFT JOIN product_units u ON u.product_code = p.code AND u.unit = $2
       WHERE p.code = $1 AND p.active = TRUE
         AND (u.id IS NOT NULL OR p.unit = $2)`,
      [req.params.productCode, unitCode],
    )
    if (!unitCode || productResult.rowCount !== 1) {
      return publicError(res, 404, 'PRODUCT_OR_UNIT_NOT_FOUND', 'Ürün veya seçilen birim bulunamadı.')
    }
    const revision = await client.query(
      `SELECT COALESCE(MAX(sequence), 0)::text AS "priceRevision"
       FROM mobile_sync_changes
       WHERE entity_type IN
         ('price', 'price_list_item', 'customer_product_price', 'customer_price_list', 'distributor_price_list')`,
    )
    const price = await lookupPriceCandidates(
      client,
      context,
      customer,
      productResult.rows[0],
      unitCode,
      dateInIstanbul(),
      { centralOnly: documentType === 'van_sale' },
    )
    if (price.error) {
      return publicError(res, 404, price.error.code, 'Seçilen birim için geçerli satış fiyatı bulunamadı.')
    }
    return res.json({
      productCode: req.params.productCode,
      unitCode,
      unitPrice: price.unitPrice,
      baseUnitPrice: price.baseUnitPrice ?? price.unitPrice,
      innerQuantity: price.innerQuantity ?? 1,
      taxIncluded: price.taxIncluded,
      source: price.source,
      priceReferenceId: price.priceId,
      priceRevision: revision.rows[0].priceRevision,
    })
  }))

  router.post('/pricing/snapshot', withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const { customerCodes } = req.body ?? {}
    if (!Array.isArray(customerCodes) || customerCodes.length > 50
      || customerCodes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 50)
      || new Set(customerCodes).size !== customerCodes.length) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'En fazla 50 farklı atanmış cari gönderilmelidir.')
    }

    const businessDate = dateInIstanbul()
    const revision = await client.query(
      `SELECT COALESCE(MAX(sequence), 0)::text AS "priceRevision"
       FROM mobile_sync_changes
       WHERE entity_type IN
         ('price', 'price_list_item', 'customer_product_price', 'customer_price_list', 'distributor_price_list')`,
    )
    const customers = customerCodes.length
      ? await client.query(
        `SELECT c.code, c.type, c.customer_group_code AS "customerGroupCode"
         FROM customer_cards c
         WHERE c.tenant_code = $1 AND c.active = TRUE AND c.code = ANY($2::text[])
           AND EXISTS (
             SELECT 1 FROM sales_rep_customers a
             WHERE a.tenant_code = c.tenant_code AND a.customer_code = c.code
               AND a.sales_representative_id = $3 AND a.active = TRUE
           )
         ORDER BY c.code`,
        [context.tenantCode, customerCodes, context.salesRepresentativeId],
      )
      : { rows: [] }
    if (customers.rowCount !== customerCodes.length) {
      return publicError(res, 403, 'CUSTOMER_NOT_ASSIGNED', 'Bir veya daha fazla cari bu temsilciye atanmamış.')
    }

    const productUnits = await client.query(
      `SELECT p.code AS "productCode", p.name AS "productName", p.unit AS "baseUnit",
         units.unit AS "unitCode", units."innerQuantity"
       FROM factory_products p
       CROSS JOIN LATERAL (
         SELECT p.unit AS unit, NULL::text AS "innerQuantity"
         WHERE NOT EXISTS (SELECT 1 FROM product_units base WHERE base.product_code = p.code AND base.unit = p.unit)
         UNION ALL
         SELECT u.unit, u.inner_quantity AS "innerQuantity"
         FROM product_units u WHERE u.product_code = p.code
       ) units
       WHERE p.active = TRUE AND NULLIF(BTRIM(units.unit), '') IS NOT NULL
       ORDER BY p.code, units.unit`,
    )
    const productCodes = [...new Set(productUnits.rows.map((product) => product.productCode))]
    const unitsByProduct = new Map()
    for (const product of productUnits.rows) {
      const productUnitsForCode = unitsByProduct.get(product.productCode) ?? []
      productUnitsForCode.push(product)
      unitsByProduct.set(product.productCode, productUnitsForCode)
    }
    const candidates = new Map()
    const keyFor = (customerCode, productCode, unitCode) =>
      JSON.stringify([customerCode, productCode, unitCode])
    const candidateFor = (customerCode, productCode, unitCode) => {
      const key = keyFor(customerCode, productCode, unitCode)
      let entry = candidates.get(key)
      if (!entry) {
        entry = { customerSpecific: [], customerPriceList: [], distributorPriceList: [], standard: [] }
        candidates.set(key, entry)
      }
      return entry
    }

    const customerCodesForQuery = customerCodes
    const specific = customerCodes.length && productCodes.length
      ? await client.query(
        `SELECT customer_code AS "customerCode", product_code AS "productCode", unit_code AS "unitCode",
           id AS "priceId", unit_price AS price, tax_included AS "taxIncluded",
           valid_from AS "validFrom", valid_to AS "validTo"
         FROM customer_product_prices
         WHERE tenant_code = $1 AND customer_code = ANY($2::text[])
           AND product_code = ANY($3::text[]) AND active = TRUE
           AND valid_from <= $4 AND (valid_to IS NULL OR valid_to >= $4)
         ORDER BY valid_from DESC`,
        [context.tenantCode, customerCodesForQuery, productCodes, businessDate],
      )
      : { rows: [] }
    for (const row of specific.rows) {
      candidateFor(row.customerCode, row.productCode, row.unitCode).customerSpecific.push(row)
    }

    const customerLists = customerCodes.length && productCodes.length
      ? await client.query(
        `SELECT a.customer_code AS "customerCode", i.product_code AS "productCode", i.unit_code AS "unitCode",
           i.id AS "priceId", i.unit_price AS price, i.tax_included AS "taxIncluded",
           i.valid_from AS "validFrom", i.valid_to AS "validTo"
         FROM customer_price_list_assignments a
         JOIN price_lists p ON p.id = a.price_list_id AND p.active = TRUE
         JOIN price_list_items i ON i.price_list_id = a.price_list_id
           AND i.product_code = ANY($3::text[]) AND i.active = TRUE
           AND i.valid_from <= $4 AND (i.valid_to IS NULL OR i.valid_to >= $4)
         WHERE a.tenant_code = $1 AND a.customer_code = ANY($2::text[]) AND a.active = TRUE
           AND a.valid_from <= $4 AND (a.valid_to IS NULL OR a.valid_to >= $4)
         ORDER BY a.valid_from DESC, i.valid_from DESC`,
        [context.tenantCode, customerCodesForQuery, productCodes, businessDate],
      )
      : { rows: [] }
    for (const row of customerLists.rows) {
      candidateFor(row.customerCode, row.productCode, row.unitCode).customerPriceList.push(row)
    }

    const distributorLists = customerCodes.length && productCodes.length
      ? await client.query(
        `SELECT a.tenant_code AS "tenantCode", i.product_code AS "productCode", i.unit_code AS "unitCode",
           i.id AS "priceId", i.unit_price AS price, i.tax_included AS "taxIncluded",
           i.valid_from AS "validFrom", i.valid_to AS "validTo"
         FROM distributor_price_list_assignments a
         JOIN price_lists p ON p.id = a.price_list_id AND p.active = TRUE
         JOIN price_list_items i ON i.price_list_id = a.price_list_id
           AND i.product_code = ANY($2::text[]) AND i.active = TRUE
           AND i.valid_from <= $3 AND (i.valid_to IS NULL OR i.valid_to >= $3)
         WHERE a.tenant_code = $1 AND a.active = TRUE
           AND a.valid_from <= $3 AND (a.valid_to IS NULL OR a.valid_to >= $3)
         ORDER BY a.valid_from DESC, i.valid_from DESC`,
        [context.tenantCode, productCodes, businessDate],
      )
      : { rows: [] }
    for (const row of distributorLists.rows) {
      for (const customerCode of customerCodes) {
        candidateFor(customerCode, row.productCode, row.unitCode).distributorPriceList.push(row)
      }
    }

    const standard = productCodes.length
      ? await client.query(
        `SELECT id AS "priceId", product_code AS "productCode", sales_price AS price,
           tax_included AS "taxIncluded", start_date AS "validFrom", end_date AS "validTo"
         FROM product_prices
         WHERE product_code = ANY($1::text[]) AND status = 'Aktif' AND start_date <= $2
           AND start_date = (
             SELECT MAX(previous.start_date) FROM product_prices previous
             WHERE previous.product_code = product_prices.product_code
               AND previous.status = 'Aktif' AND previous.start_date <= $2
           )
           AND NULLIF(BTRIM(sales_price), '') IS NOT NULL
         ORDER BY product_code, id`,
        [productCodes, businessDate],
      )
      : { rows: [] }
    for (const row of standard.rows) {
      for (const product of unitsByProduct.get(row.productCode) ?? []) {
        for (const customerCode of customerCodes) {
          candidateFor(customerCode, row.productCode, product.unitCode).standard.push(row)
        }
      }
    }

    const prices = []
    for (const customer of customers.rows) {
      for (const product of productUnits.rows) {
        const entry = candidates.get(keyFor(customer.code, product.productCode, product.unitCode))
        if (!entry) continue
        for (const [documentType, centralOnly] of [['order', false], ['van_sale', true]]) {
          const resolved = resolveUnitPriceFromCandidates({
            ...entry,
            product: { unit: product.baseUnit, innerQuantity: product.innerQuantity },
            unitCode: product.unitCode,
            centralOnly,
          })
          if (resolved.error) continue
          prices.push({
            customerCode: customer.code,
            productCode: product.productCode,
            unitCode: product.unitCode,
            documentType,
            unitPrice: resolved.unitPrice,
            baseUnitPrice: resolved.baseUnitPrice ?? resolved.unitPrice,
            innerQuantity: Number(resolved.innerQuantity ?? 1),
            taxIncluded: resolved.taxIncluded,
            source: resolved.source,
            priceReferenceId: resolved.priceId,
            businessDate,
          })
        }
      }
    }

    return res.json({
      businessDate,
      priceRevision: revision.rows[0].priceRevision,
      prices,
      serverTime: new Date().toISOString(),
    })
  }))

  router.post('/pricing/quote', withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const evaluation = await evaluateOrderSubmission({
      client,
      context,
      payload: req.body ?? {},
      centralOnly: req.body?.requirePromotionSelection === true,
      allowPromotionWithManualDiscount: true,
      requireDiscountApproval: req.body?.requirePromotionSelection !== true,
    })
    return res.json({
      quoteStatus: evaluation.status,
      orderCreated: false,
      code: evaluation.code,
      result: evaluation.result,
      serverTime: new Date().toISOString(),
    })
  }))

  router.post('/sales/quote', withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const evaluation = await evaluateOrderSubmission({
      client,
      context,
      payload: { ...(req.body ?? {}), requirePromotionSelection: true },
      centralOnly: true,
      requireDiscountApproval: false,
      allowPromotionWithManualDiscount: true,
    })
    return res.json({
      quoteStatus: evaluation.status,
      orderCreated: false,
      code: evaluation.code,
      result: evaluation.result,
      serverTime: new Date().toISOString(),
    })
  }))

  router.post('/orders', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const { operationId, clientCreatedAt, payload } = req.body ?? {}
    if (!validUuid(operationId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'İşlem kimliği ve sipariş içeriği zorunludur.')
    }
    const result = await handleOperation(client, req, context, {
      operationId,
      clientCreatedAt,
      type: 'order.submit',
      payload,
    })
    const statusCode = result.status === 'accepted' ? 201
      : result.status === 'requires_approval' ? 202
        : result.status === 'conflict' ? 409
          : result.status === 'retry' ? 503 : 422
    return res.status(statusCode).json(result)
  }))

  router.post('/sales', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.order.create', async ({ req, res, client, context }) => {
    const { operationId, clientCreatedAt, payload } = req.body ?? {}
    if (!validUuid(operationId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'İşlem kimliği ve sıcak satış içeriği zorunludur.')
    }
    const result = await handleOperation(client, req, context, {
      operationId,
      clientCreatedAt,
      type: 'sale.submit',
      payload,
    })
    const statusCode = result.status === 'accepted' ? 201
      : result.status === 'requires_approval' ? 202
        : result.status === 'conflict' ? 409
          : result.status === 'retry' ? 503 : 422
    return res.status(statusCode).json(result)
  }))

  router.post('/collections', mobileWriteRateLimit, withMobileContext(databaseUrl, 'mobile.collection.create', async ({ req, res, client, context }) => {
    const { operationId, clientCreatedAt, payload } = req.body ?? {}
    if (!validUuid(operationId) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'İşlem kimliği ve tahsilat bilgileri zorunludur.')
    }
    const result = await handleOperation(client, req, context, {
      operationId,
      clientCreatedAt,
      type: 'collection.submit',
      payload,
    })
    return res.status(result.status === 'accepted' ? 201 : result.status === 'retry' ? 503 : 422).json(result)
  }))

  router.get('/admin/devices', async (req, res) => {
    if (!isDeviceAdministrator(req, res, 'view')) return
    if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
    if (req.query.status && !['pending', 'active', 'revoked'].includes(req.query.status)) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Cihaz durumu filtresi geçersiz.')
    }
    const client = new pg.Client({ connectionString: databaseUrl })
    try {
      await client.connect()
      const result = await client.query(
        `SELECT d.*, u.username, u.distributor_name, r.name AS representative_name
         FROM mobile_devices d
         INNER JOIN distributor_users u ON u.id = d.distributor_user_id
         INNER JOIN sales_representatives r ON r.id = d.sales_representative_id
         WHERE ($1::text IS NULL OR d.status = $1)
           AND ($2::text IS NULL OR (
             d.tenant_code = $2 AND u.tenant_code = $2 AND r.tenant_code = $2
             AND u.sales_representative_id = d.sales_representative_id
           ))
         ORDER BY d.registered_at DESC LIMIT 200`,
        [
          typeof req.query.status === 'string' ? req.query.status : null,
          req.authenticatedUser.accountType === 'distributor' ? req.authenticatedUser.tenantCode : null,
        ],
      )
      return res.json(result.rows.map(asPublicDevice))
    } catch (error) {
      return respondForDatabaseError(res, error)
    } finally {
      await client.end().catch((error) => console.error('Mobile admin connection cleanup failed:', error))
    }
  })

  router.post('/admin/devices/:deviceId/approve', async (req, res) => {
    if (!isDeviceAdministrator(req, res, 'manage')) return
    if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
    if (!validUuid(req.params.deviceId)) return publicError(res, 400, 'VALIDATION_ERROR', 'Cihaz kimliği geçersiz.')
    const client = new pg.Client({ connectionString: databaseUrl })
    try {
      await client.connect()
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE mobile_devices d SET status = 'active', approved_at = NOW(), approved_by = $2
         FROM distributor_users u INNER JOIN sales_representatives r
           ON r.id = u.sales_representative_id AND r.tenant_code = u.tenant_code AND r.active = TRUE
         WHERE d.id = $1 AND d.status = 'pending' AND u.id = d.distributor_user_id
           AND u.sales_representative_id = d.sales_representative_id
           AND u.tenant_code = d.tenant_code AND u.status = 'Aktif'
           AND r.tenant_code = d.tenant_code
           AND ($3::text IS NULL OR d.tenant_code = $3)
         RETURNING d.*`,
        [
          req.params.deviceId,
          req.authenticatedUser.username,
          req.authenticatedUser.accountType === 'distributor' ? req.authenticatedUser.tenantCode : null,
        ],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 409, 'DEVICE_NOT_APPROVABLE', 'Cihaz beklemede değil veya kullanıcı/temsilci ataması değişmiş.')
      }
      await auditMobile(client, req, {
        entityType: 'mobile_device',
        entityId: req.params.deviceId,
        action: 'approved',
        username: req.authenticatedUser.username,
        tenantCode: result.rows[0].tenant_code,
        representativeId: result.rows[0].sales_representative_id,
        deviceId: req.params.deviceId,
        result: 'active',
      })
      await client.query('COMMIT')
      return res.json({ id: result.rows[0].id, status: result.rows[0].status, approvedAt: result.rows[0].approved_at })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    } finally {
      await client.end().catch((error) => console.error('Mobile admin connection cleanup failed:', error))
    }
  })

  router.post('/admin/devices/:deviceId/revoke', async (req, res) => {
    if (!isDeviceAdministrator(req, res, 'manage')) return
    if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
    if (!validUuid(req.params.deviceId)) return publicError(res, 400, 'VALIDATION_ERROR', 'Cihaz kimliği geçersiz.')
    const client = new pg.Client({ connectionString: databaseUrl })
    try {
      await client.connect()
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE mobile_devices d SET status = 'revoked', revoked_at = NOW(), revoked_by = $2
         WHERE d.id = $1 AND d.status <> 'revoked'
           AND ($3::text IS NULL OR (d.tenant_code = $3 AND EXISTS (
             SELECT 1 FROM distributor_users u
             INNER JOIN sales_representatives r ON r.id = u.sales_representative_id
               AND r.tenant_code = u.tenant_code AND r.active = TRUE
             WHERE u.id = d.distributor_user_id AND u.tenant_code = $3
               AND u.status = 'Aktif' AND u.sales_representative_id = d.sales_representative_id
           )))
         RETURNING d.*`,
        [
          req.params.deviceId,
          req.authenticatedUser.username,
          req.authenticatedUser.accountType === 'distributor' ? req.authenticatedUser.tenantCode : null,
        ],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 404, 'DEVICE_NOT_FOUND', 'Etkin cihaz bulunamadı.')
      }
      await client.query(
        `UPDATE auth_sessions s SET revoked_at = NOW()
         FROM mobile_session_devices sd
         WHERE sd.device_id = $1 AND sd.auth_session_id = s.id AND s.revoked_at IS NULL`,
        [req.params.deviceId],
      )
      await auditMobile(client, req, {
        entityType: 'mobile_device',
        entityId: req.params.deviceId,
        action: 'revoked',
        username: req.authenticatedUser.username,
        tenantCode: result.rows[0].tenant_code,
        representativeId: result.rows[0].sales_representative_id,
        deviceId: req.params.deviceId,
        result: 'revoked',
      })
      await client.query('COMMIT')
      return res.json({ id: result.rows[0].id, status: 'revoked', revokedAt: result.rows[0].revoked_at })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      return respondForDatabaseError(res, error)
    } finally {
      await client.end().catch((error) => console.error('Mobile admin connection cleanup failed:', error))
    }
  })

  router.put('/admin/users/:userId/sales-representative', async (req, res) => {
    if (!isFactoryAdministrator(req, res)) return
    if (!databaseUrl) return publicError(res, 503, 'DATABASE_UNAVAILABLE', 'Veritabanı yapılandırılmamış.')
    const userId = Number(req.params.userId)
    const representativeId = Number(req.body?.salesRepresentativeId)
    if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(representativeId) || representativeId <= 0) {
      return publicError(res, 400, 'VALIDATION_ERROR', 'Kullanıcı ve temsilci kimlikleri geçersiz.')
    }
    const client = new pg.Client({ connectionString: databaseUrl })
    try {
      await client.connect()
      await client.query('BEGIN')
      const result = await client.query(
        `UPDATE distributor_users u SET sales_representative_id = r.id
         FROM sales_representatives r
         WHERE u.id = $1 AND u.status = 'Aktif' AND u.customer_code IS NOT NULL
           AND r.id = $2 AND r.tenant_code = u.tenant_code AND r.active = TRUE
         RETURNING u.id, u.username, u.customer_code, u.tenant_code, u.sales_representative_id`,
        [userId, representativeId],
      )
      if (!result.rowCount) {
        await client.query('ROLLBACK')
        return publicError(res, 404, 'REPRESENTATIVE_NOT_ASSIGNED', 'Aktif kullanıcı ve aynı distribütöre ait temsilci bulunamadı.')
      }
      await client.query(
        `UPDATE mobile_devices SET status = 'revoked', revoked_at = NOW(), revoked_by = $2
         WHERE distributor_user_id = $1 AND status <> 'revoked'`,
        [userId, req.authenticatedUser.username],
      )
      await client.query(
        `UPDATE auth_sessions s SET revoked_at = NOW()
         FROM mobile_session_devices sd INNER JOIN mobile_devices d ON d.id = sd.device_id
         WHERE d.distributor_user_id = $1 AND sd.auth_session_id = s.id AND s.revoked_at IS NULL`,
        [userId],
      )
      await auditMobile(client, req, {
        entityType: 'distributor_user',
        entityId: userId,
        action: 'sales_representative_assigned',
        username: req.authenticatedUser.username,
        tenantCode: result.rows[0].tenant_code,
        representativeId,
        result: 'assigned',
      })
      await client.query('COMMIT')
      return res.json({ userId, salesRepresentativeId: representativeId })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      if (error?.code === '23505') return publicError(res, 409, 'REPRESENTATIVE_ALREADY_ASSIGNED', 'Bu temsilciye başka bir mobil kullanıcı atanmış.')
      return respondForDatabaseError(res, error)
    } finally {
      await client.end().catch((error) => console.error('Mobile admin connection cleanup failed:', error))
    }
  })

  return router
}
