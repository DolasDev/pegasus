/**
 * Integration tests for the CustomerGateway seam.
 *
 * Requires a live PostgreSQL database; skipped automatically when DATABASE_URL
 * is unset (same convention as customer.repository.test.ts). Proves:
 *   - a customerSource=null tenant round-trips through real Prisma via the
 *     gateway (default path is unchanged end-to-end), and
 *   - a customerSource='pegii' tenant is served from the pegII path instead —
 *     here backed by a stubbed tunnel returning fixture DTOs.
 */
import { describe, it, expect, afterAll, beforeAll, afterEach } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import type { PrismaClient } from '@prisma/client'
import { db } from '../../db'
import { createTenantDb } from '../../lib/prisma'
import { createCustomer, deleteCustomer } from '../../repositories/customer.repository'
import { resolveCustomerGateway } from '../customer-gateway.factory'
import { setTunnelLambdaClient } from '../../lib/tunnel-client'
import { happyPathCustomer } from '../pegii/__fixtures__/pegii-customer.fixtures'

const hasDb = Boolean(process.env['DATABASE_URL'])
const TEST_TENANT_SLUG = 'test-customer-gateway'

const createdIds: string[] = []
let testDb: PrismaClient
let testTenantId: string

afterAll(async () => {
  if (hasDb) {
    for (const id of createdIds) await deleteCustomer(testDb, id).catch(() => undefined)
    await db.tenant
      .update({ where: { id: testTenantId }, data: { customerSource: null } })
      .catch(() => undefined)
    await db.$disconnect()
  }
})

afterEach(() => {
  setTunnelLambdaClient(null)
  delete process.env['TUNNEL_PROXY_FUNCTION_NAME']
  delete process.env['PEGII_API_TUNNEL_BASE_OVERRIDE']
})

describe.skipIf(!hasDb)('CustomerGateway (integration)', () => {
  const uniqueEmail = `gw+${Date.now()}@example.com`
  let customerId: string

  beforeAll(async () => {
    const tenant = await db.tenant.upsert({
      where: { slug: TEST_TENANT_SLUG },
      create: { name: 'Test Tenant (Customer Gateway)', slug: TEST_TENANT_SLUG },
      update: { customerSource: null },
    })
    testTenantId = tenant.id
    testDb = createTenantDb(db, testTenantId) as unknown as PrismaClient

    const customer = await createCustomer(
      testDb,
      testTenantId,
      { userId: 'user-gw-001', firstName: 'Gwen', lastName: 'Gateway', email: uniqueEmail },
      { firstName: 'Gwen', lastName: 'Gateway', email: uniqueEmail, isPrimary: true },
    )
    customerId = customer.id
    createdIds.push(customerId)
  })

  it('default (null) source serves the real Postgres customer through the gateway', async () => {
    await db.tenant.update({ where: { id: testTenantId }, data: { customerSource: null } })
    const gateway = await resolveCustomerGateway(testDb, testTenantId)

    const found = await gateway.findCustomerById(customerId)
    expect(found?.id).toBe(customerId)
    expect(found?.email).toBe(uniqueEmail)

    const list = await gateway.listCustomers({ limit: 100 })
    expect(list.some((c) => c.id === customerId)).toBe(true)
  })

  it("'pegii' source is served from the pegII path (stubbed tunnel), not Postgres", async () => {
    await db.tenant.update({ where: { id: testTenantId }, data: { customerSource: 'pegii' } })
    // Route the pegII client at a stub tunnel that returns the fixture DTO.
    process.env['TUNNEL_PROXY_FUNCTION_NAME'] = 'test-proxy-fn'
    process.env['PEGII_API_TUNNEL_BASE_OVERRIDE'] = 'https://pegii.test:8443'
    const send = () =>
      Promise.resolve({
        Payload: new TextEncoder().encode(
          JSON.stringify({
            status: 200,
            headers: {},
            body: JSON.stringify({ data: happyPathCustomer }),
          }),
        ),
      })
    setTunnelLambdaClient({ send } as unknown as LambdaClient)

    const gateway = await resolveCustomerGateway(testDb, testTenantId)
    const found = await gateway.findCustomerById('1001')

    // The fixture, not the Postgres row — proves the branch fired.
    expect(found?.id).toBe('1001')
    expect(found?.firstName).toBe('Ada')
    expect(found?.email).toBe('ada@acme.example')
  })
})
