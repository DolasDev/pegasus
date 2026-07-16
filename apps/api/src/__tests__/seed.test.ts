/**
 * Integration tests for the dev seed (prisma/seed.ts).
 *
 * These tests require a live PostgreSQL database and are skipped automatically
 * when DATABASE_URL is not set in the environment (repo convention).
 *
 * The seed is intentionally run against the shared local dev database — it is
 * idempotent and only touches the dev tenant + deterministic `seed-*` ids.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { db } from '../db'
import { main, DEV_TENANT_ID } from '../../prisma/seed'

const hasDb = Boolean(process.env['DATABASE_URL'])
const tenantId = process.env['DEFAULT_TENANT_ID'] ?? DEV_TENANT_ID

/**
 * Row counts of everything the seed writes, scoped to the dev tenant (or to
 * deterministic seed ids for models without a tenantId column) so parallel
 * test files writing their own tenants cannot perturb the numbers.
 */
async function countSeededRows(): Promise<Record<string, number>> {
  const [
    tenants,
    tenantUsers,
    leadSources,
    rateTables,
    rates,
    crewMembers,
    vehicles,
    customers,
    contacts,
    addresses,
    moves,
    stops,
    quotes,
    quoteLineItems,
    invoices,
    payments,
    inventoryRooms,
    inventoryItems,
    tariffVersions,
  ] = await Promise.all([
    db.tenant.count({ where: { id: tenantId } }),
    db.tenantUser.count({ where: { tenantId } }),
    db.leadSource.count({ where: { tenantId } }),
    db.rateTable.count({ where: { tenantId } }),
    db.rate.count({ where: { rateTable: { tenantId } } }),
    db.crewMember.count({ where: { tenantId } }),
    db.vehicle.count({ where: { tenantId } }),
    db.customer.count({ where: { tenantId } }),
    db.contact.count({ where: { customer: { tenantId } } }),
    db.address.count({ where: { id: { startsWith: 'seed-addr-' } } }),
    db.move.count({ where: { tenantId } }),
    db.stop.count({ where: { move: { tenantId } } }),
    db.quote.count({ where: { tenantId } }),
    db.quoteLineItem.count({ where: { quote: { tenantId } } }),
    db.invoice.count({ where: { tenantId } }),
    db.payment.count({ where: { invoice: { tenantId } } }),
    db.inventoryRoom.count({ where: { tenantId } }),
    db.inventoryItem.count({ where: { room: { tenantId } } }),
    // Global (non-tenant) rating fixture — scoped by the seed's own
    // deterministic id (not tariffCode: '400NG' broadly), so other tests
    // that import their own '400NG'-coded fixtures (e.g.
    // repositories/__tests__/tariff.repository.test.ts) can't perturb this
    // count when run in the same worker pool against the shared dev DB.
    db.tariffVersion.count({ where: { id: 'seed-tariff-400ng-0001' } }),
  ])
  return {
    tenants,
    tenantUsers,
    leadSources,
    rateTables,
    rates,
    crewMembers,
    vehicles,
    customers,
    contacts,
    addresses,
    moves,
    stops,
    quotes,
    quoteLineItems,
    invoices,
    payments,
    inventoryRooms,
    inventoryItems,
    tariffVersions,
  }
}

afterAll(async () => {
  if (hasDb) await db.$disconnect()
})

describe.skipIf(!hasDb)('prisma seed (integration)', () => {
  it('main(db) resolves without throwing', async () => {
    await expect(main(db)).resolves.toBeUndefined()
  })

  it('creates the dev tenant and an active tenant_admin user', async () => {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    expect(tenant).not.toBeNull()
    expect(tenant?.name).toBe('Dev Tenant')
    expect(tenant?.slug).toBe('dev')

    const admin = await db.tenantUser.findUnique({
      where: { tenantId_email: { tenantId, email: 'dev-admin@example.com' } },
    })
    expect(admin).not.toBeNull()
    expect(admin?.roleNames).toContain('tenant_admin')
    expect(admin?.status).toBe('ACTIVE')
  })

  it('stamps every seeded tenant-scoped row with the dev tenant id', async () => {
    // Deterministic-id rows: assert each one belongs to the dev tenant.
    const move = await db.move.findUnique({ where: { id: 'seed-move-001' } })
    expect(move?.tenantId).toBe(tenantId)
    const crew = await db.crewMember.findUnique({ where: { id: 'seed-crew-001' } })
    expect(crew?.tenantId).toBe(tenantId)
    const quote = await db.quote.findUnique({ where: { id: 'seed-quote-001' } })
    expect(quote?.tenantId).toBe(tenantId)
    const invoice = await db.invoice.findUnique({ where: { id: 'seed-invoice-001' } })
    expect(invoice?.tenantId).toBe(tenantId)
    const room = await db.inventoryRoom.findUnique({ where: { id: 'seed-room-001' } })
    expect(room?.tenantId).toBe(tenantId)

    // Compound-unique rows: assert they resolve under the dev tenant.
    for (const name of ['Website', 'Referral']) {
      const leadSource = await db.leadSource.findUnique({
        where: { tenantId_name: { tenantId, name } },
      })
      expect(leadSource).not.toBeNull()
    }
    const rateTable = await db.rateTable.findUnique({
      where: { tenantId_name: { tenantId, name: 'Standard 2026' } },
    })
    expect(rateTable).not.toBeNull()
    const vehicle = await db.vehicle.findUnique({
      where: { tenantId_registrationPlate: { tenantId, registrationPlate: 'PEG-001' } },
    })
    expect(vehicle).not.toBeNull()
    for (const email of ['alice.johnson@example.com', 'bob.chen@example.com']) {
      const customer = await db.customer.findUnique({
        where: { tenantId_email: { tenantId, email } },
      })
      expect(customer).not.toBeNull()
    }

    // Seed floor: at least everything the seed writes exists under the tenant.
    const counts = await countSeededRows()
    expect(counts['tenants']).toBe(1)
    expect(counts['tenantUsers']).toBeGreaterThanOrEqual(1)
    expect(counts['leadSources']).toBeGreaterThanOrEqual(2)
    expect(counts['rateTables']).toBeGreaterThanOrEqual(1)
    expect(counts['crewMembers']).toBeGreaterThanOrEqual(1)
    expect(counts['vehicles']).toBeGreaterThanOrEqual(1)
    expect(counts['customers']).toBeGreaterThanOrEqual(2)
    expect(counts['addresses']).toBe(6)
    expect(counts['moves']).toBeGreaterThanOrEqual(3)
    expect(counts['quotes']).toBeGreaterThanOrEqual(2)
    expect(counts['invoices']).toBeGreaterThanOrEqual(1)
    expect(counts['inventoryRooms']).toBeGreaterThanOrEqual(2)
    expect(counts['inventoryItems']).toBeGreaterThanOrEqual(5)
    expect(counts['tariffVersions']).toBeGreaterThanOrEqual(1)
  })

  it('seeds a real 400NG tariff fixture (platform-global, no tenantId)', async () => {
    const version = await db.tariffVersion.findUnique({
      where: { id: 'seed-tariff-400ng-0001' },
      include: {
        zip3s: true,
        serviceAreas: true,
        linehaulRates: true,
        shorthaulRates: true,
        packRates: true,
        unpackRates: true,
      },
    })
    expect(version?.status).toBe('ACTIVE')
    expect(version?.zip3s).toHaveLength(2)
    expect(version?.serviceAreas).toHaveLength(2)
    expect(version?.linehaulRates).toHaveLength(2)
    expect(version?.shorthaulRates).toHaveLength(1)
    expect(version?.packRates).toHaveLength(1)
    expect(version?.unpackRates).toHaveLength(1)

    const fsc = await db.tariffFuelSurcharge.findUnique({
      where: {
        tariffCode_effectiveFrom: { tariffCode: '400NG', effectiveFrom: new Date('2026-01-01') },
      },
    })
    expect(fsc?.percentBps).toBe(500)
  })

  it('is idempotent — a second run leaves all row counts unchanged', async () => {
    await main(db) // ensure seeded at least once
    const before = await countSeededRows()
    await main(db)
    const after = await countSeededRows()
    expect(after).toEqual(before)
  })
})
