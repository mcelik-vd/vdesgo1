import assert from 'node:assert/strict'
import test from 'node:test'
import { createMobileCustomer, classifyMobileSyncException } from '../mobile/mobile-api.js'

test('creates a mobile customer with matching SQL columns and values', async () => {
  const statements = []
  const customerCode = 'MOB-12345678-1234-1234-1234-123456789abc'
  const capturedAt = '2026-10-30T12:00:00.000Z'
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values })
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
      if (sql.includes('SELECT 1') && sql.includes('FROM customer_cards')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT name FROM customer_types')) {
        return { rows: [{ name: 'Perakende' }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO customer_cards')) {
        const insert = sql.match(/INSERT INTO customer_cards\s*\(([\s\S]*?)\)\s*VALUES\s*\(([\s\S]*?)\)/)
        assert.ok(insert, 'customer insert statement must expose columns and values')
        assert.equal(insert[1].split(',').length, insert[2].split(',').length)
        assert.equal(values.length, 18)
        assert.deepEqual(
          [...insert[2].matchAll(/\$(\d+)/g)].map(([, index]) => Number(index)),
          Array.from({ length: 18 }, (_, index) => index + 1),
        )
        return { rows: [{ code: customerCode }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO sales_rep_customers')) {
        return { rows: [{ id: 'assignment-1', customerCode, routeDay: 'Cuma' }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }

  const result = await createMobileCustomer(
    client,
    { ip: '127.0.0.1' },
    {
      tenantCode: 'test-tenant',
      salesRepresentativeId: 'representative-1',
      salesRepresentativeName: 'Test',
      username: 'mobile-test',
      deviceId: 'device-1',
    },
    {
      ownerName: 'Test Customer',
      businessTitle: 'Test Store',
      customerTypeCode: 'RETAIL',
      phone: '',
      mobilePhone: '',
      taxNo: '1234567890',
      tckn: '11111111111',
      taxOffice: 'Test',
      address: '',
      location: '',
      locationLatitude: 41,
      locationLongitude: 29,
      locationAccuracyM: 10,
      locationCapturedAt: capturedAt,
      routeDay: 'Cuma',
    },
    customerCode,
  )

  assert.equal(result.status, 'accepted')
  const customerInsert = statements.find(({ sql }) => sql.includes('INSERT INTO customer_cards'))
  assert.equal(customerInsert.values[14], capturedAt)
  assert.equal(customerInsert.values[15], 'test-tenant')
  assert.equal(customerInsert.values[17], '11111111111')
})

test('accepts TCKN without VKN, validates it and checks both identity columns for duplicates', async () => {
  const statements = []
  let duplicate = false
  const client = {
    async query(sql, values = []) {
      statements.push({ sql, values })
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
      if (sql.includes('SELECT 1') && sql.includes('FROM customer_cards')) {
        assert.match(sql, /COALESCE\(tax_no, ''\)/)
        assert.match(sql, /COALESCE\(tckn, ''\)/)
        return { rows: duplicate ? [{}] : [], rowCount: duplicate ? 1 : 0 }
      }
      if (sql.includes('SELECT name FROM customer_types')) return { rows: [{ name: 'Perakende' }], rowCount: 1 }
      if (sql.includes('INSERT INTO customer_cards')) return { rows: [{ code: 'test' }], rowCount: 1 }
      if (sql.includes('INSERT INTO sales_rep_customers')) return { rows: [{}], rowCount: 1 }
      if (sql.includes('INSERT INTO audit_logs')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected query: ${sql}`)
    },
  }
  const context = { tenantCode: 'test', salesRepresentativeId: 'rep', salesRepresentativeName: 'Test', username: 'test', deviceId: 'device' }
  const body = {
    ownerName: 'Test Ad Soyad', businessTitle: 'Test', customerTypeCode: 'RETAIL',
    phone: '', mobilePhone: '', taxNo: '', tckn: '11111111111', taxOffice: 'Test',
    address: '', location: '', locationLatitude: 41, locationLongitude: 29,
    locationAccuracyM: 10, locationCapturedAt: '2026-10-30T12:00:00.000Z', routeDay: 'Cuma',
  }
  const run = (input) => createMobileCustomer(client, { ip: '127.0.0.1' }, context, input, 'MOB-12345678-1234-1234-1234-123456789abc')
  assert.equal((await run(body)).status, 'accepted')
  const insert = statements.find(({ sql }) => sql.includes('INSERT INTO customer_cards'))
  assert.equal(insert.values[7], '')
  assert.equal(insert.values[17], body.tckn)
  assert.equal((await run({ ...body, tckn: '' })).code, 'TAX_IDENTITY_REQUIRED')
  assert.equal((await run({ ...body, tckn: '123' })).code, 'INVALID_TCKN')
  duplicate = true
  assert.equal((await run(body)).code, 'DUPLICATE_TAX_NUMBER')
})

test('rejects missing or malformed customer identity fields before database writes', async () => {
  const context = { tenantCode: 'test', salesRepresentativeId: 'rep', salesRepresentativeName: 'Test', username: 'test', deviceId: 'device' }
  const base = {
    ownerName: 'Test', businessTitle: 'Test', customerTypeCode: 'RETAIL',
    phone: '', mobilePhone: '', taxNo: '1234567890', tckn: '',
    taxOffice: 'Test', address: '', location: '', locationLatitude: 41,
    locationLongitude: 29, locationAccuracyM: 10,
    locationCapturedAt: '2026-10-30T12:00:00.000Z', routeDay: 'Cuma',
  }
  const client = { async query() { throw new Error('Validation must run before database access') } }
  const run = (body) => createMobileCustomer(client, { ip: '127.0.0.1' }, context, body, 'MOB-12345678-1234-1234-1234-123456789abc')

  assert.equal((await run({ ...base, taxOffice: '' })).code, 'TAX_OFFICE_REQUIRED')
  assert.equal((await run({ ...base, customerTypeCode: '' })).code, 'CUSTOMER_TYPE_REQUIRED')
  assert.equal((await run({ ...base, taxNo: '', tckn: '' })).code, 'TAX_IDENTITY_REQUIRED')
  assert.equal((await run({ ...base, taxNo: '123' })).code, 'INVALID_VKN')
  assert.equal((await run({ ...base, taxNo: '', tckn: '123' })).code, 'INVALID_TCKN')
  assert.equal((await run({ ...base, customerTypeCode: 'RETAIL', routeDay: '' })).code, 'ROUTE_DAY_REQUIRED')
})

test('classifies live database failures instead of hiding all failures as retryable', () => {
  assert.deepEqual(
    classifyMobileSyncException({ code: '42703', column: 'tckn' }),
    { status: 'retry', code: 'RETRYABLE_DATABASE_42703' },
  )
  assert.deepEqual(
    classifyMobileSyncException({ code: '23505', constraint: 'customer_cards_pkey' }),
    { status: 'rejected', code: 'DUPLICATE_TAX_NUMBER' },
  )
  assert.deepEqual(
    classifyMobileSyncException({ code: '40P01' }),
    { status: 'retry', code: 'DATABASE_CONFLICT' },
  )
})
