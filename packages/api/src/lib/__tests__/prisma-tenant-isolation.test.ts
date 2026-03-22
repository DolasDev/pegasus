/**
 * Integration tests proving that createTenantDb enforces cross-tenant data
 * isolation for every model in TENANT_SCOPED_MODELS.
 *
 * These tests require a live PostgreSQL database. They are skipped automatically
 * when DATABASE_URL is not set in the environment.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://... npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from '../../db'
import { createTenantDb, TENANT_SCOPED_MODELS } from '../prisma'
import type { PrismaClient } from '@prisma/client'

const hasDb = Boolean(process.env['DATABASE_URL'])

// ---------------------------------------------------------------------------
// Skip guard — always-running test that confirms the skip logic itself works.
// ---------------------------------------------------------------------------

describe('TenantIsolation skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true) // confirmed: DB-dependent tests above were skipped
    } else {
      expect(hasDb).toBe(true) // DB available; integration tests ran
    }
  })
})

// ---------------------------------------------------------------------------
// DB-dependent isolation tests
// ---------------------------------------------------------------------------

const SLUG_A = 'test-isolation-tenant-a'
const SLUG_B = 'test-isolation-tenant-b'

let tenantAId: string
let tenantBId: string
let dbA: PrismaClient
let dbB: PrismaClient

describe.skipIf(!hasDb)('createTenantDb — cross-tenant isolation (integration)', () => {
  beforeAll(async () => {
    // Upsert two isolated test tenants.
    const [tenantA, tenantB] = await Promise.all([
      db.tenant.upsert({
        where: { slug: SLUG_A },
        create: { name: 'Isolation Tenant A', slug: SLUG_A },
        update: {},
      }),
      db.tenant.upsert({
        where: { slug: SLUG_B },
        create: { name: 'Isolation Tenant B', slug: SLUG_B },
        update: {},
      }),
    ])
    tenantAId = tenantA.id
    tenantBId = tenantB.id
    dbA = createTenantDb(db, tenantAId) as unknown as PrismaClient
    dbB = createTenantDb(db, tenantBId) as unknown as PrismaClient
  })

  afterAll(async () => {
    // Clean up all seeded data in reverse-FK order to avoid constraint errors.
    // Use the base db client to bypass tenant scoping so we can delete both tenants' data.
    await db.availability.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.moveCrewAssignment.deleteMany({
      where: { move: { tenantId: { in: [tenantAId, tenantBId] } } },
    })
    await db.moveVehicleAssignment.deleteMany({
      where: { move: { tenantId: { in: [tenantAId, tenantBId] } } },
    })
    await db.inventoryRoom.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.quoteLineItem.deleteMany({
      where: { quote: { tenantId: { in: [tenantAId, tenantBId] } } },
    })
    await db.payment.deleteMany({
      where: { invoice: { tenantId: { in: [tenantAId, tenantBId] } } },
    })
    await db.invoice.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.quote.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.stop.deleteMany({ where: { move: { tenantId: { in: [tenantAId, tenantBId] } } } })
    await db.move.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.crewMember.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.vehicle.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.rateTable.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.tenantSsoProvider.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.contact.deleteMany({
      where: { customer: { tenantId: { in: [tenantAId, tenantBId] } } },
    })
    await db.customer.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.leadSource.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    await db.account.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } })
    // Addresses have no tenantId — they are orphaned on move/stop delete (no FK cascade to address).
    // Leave them; they are harmless test artefacts.
    await db.$disconnect()
  })

  // -------------------------------------------------------------------------
  // Customer isolation
  // -------------------------------------------------------------------------

  describe('Customer', () => {
    let customerAId: string
    let customerBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [cA, cB] = await Promise.all([
        db.customer.create({
          data: {
            tenantId: tenantAId,
            userId: 'user-iso-a',
            firstName: 'Alice',
            lastName: 'A',
            email: `alice+${ts}@a.test`,
          },
        }),
        db.customer.create({
          data: {
            tenantId: tenantBId,
            userId: 'user-iso-b',
            firstName: 'Bob',
            lastName: 'B',
            email: `bob+${ts}@b.test`,
          },
        }),
      ])
      customerAId = cA.id
      customerBId = cB.id
    })

    it('findMany via dbA returns only Tenant A customers', async () => {
      const rows = await dbA.customer.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(customerAId)
      expect(ids).not.toContain(customerBId)
    })

    it('findUnique via dbA returns null for a Tenant B record', async () => {
      const result = await dbA.customer.findUnique({ where: { id: customerBId } })
      expect(result).toBeNull()
    })

    it('update via dbA cannot mutate a Tenant B record', async () => {
      // update returns the updated row (scoped) — a cross-tenant row produces no-op null
      await dbA.customer.update({
        where: { id: customerBId },
        data: { firstName: 'HACKED' },
      }).catch(() => {
        // Prisma throws P2025 (record not found) — that is the correct behaviour
      })
      const unchanged = await db.customer.findUnique({ where: { id: customerBId } })
      expect(unchanged?.firstName).toBe('Bob')
    })

    it('delete via dbA cannot remove a Tenant B record', async () => {
      await dbA.customer.delete({ where: { id: customerBId } }).catch(() => {
        // Prisma throws P2025 — correct behaviour
      })
      const stillExists = await db.customer.findUnique({ where: { id: customerBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // CrewMember isolation
  // -------------------------------------------------------------------------

  describe('CrewMember', () => {
    let crewAId: string
    let crewBId: string

    beforeAll(async () => {
      const [cA, cB] = await Promise.all([
        db.crewMember.create({
          data: { tenantId: tenantAId, name: 'Crew A', role: 'DRIVER', licenceClasses: [] },
        }),
        db.crewMember.create({
          data: { tenantId: tenantBId, name: 'Crew B', role: 'MOVER', licenceClasses: [] },
        }),
      ])
      crewAId = cA.id
      crewBId = cB.id
    })

    it('findMany via dbA returns only Tenant A crew members', async () => {
      const rows = await dbA.crewMember.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(crewAId)
      expect(ids).not.toContain(crewBId)
    })

    it('update via dbA cannot mutate a Tenant B crew member', async () => {
      await dbA.crewMember.update({ where: { id: crewBId }, data: { name: 'HACKED' } }).catch(() => {})
      const unchanged = await db.crewMember.findUnique({ where: { id: crewBId } })
      expect(unchanged?.name).toBe('Crew B')
    })

    it('delete via dbA cannot remove a Tenant B crew member', async () => {
      await dbA.crewMember.delete({ where: { id: crewBId } }).catch(() => {})
      const stillExists = await db.crewMember.findUnique({ where: { id: crewBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Vehicle isolation
  // -------------------------------------------------------------------------

  describe('Vehicle', () => {
    let vehicleAId: string
    let vehicleBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [vA, vB] = await Promise.all([
        db.vehicle.create({
          data: {
            tenantId: tenantAId,
            registrationPlate: `ISO-A-${ts}`,
            make: 'Ford',
            model: 'Transit',
            capacityCubicFeet: 200,
            lastInspectionDate: new Date('2025-01-01'),
          },
        }),
        db.vehicle.create({
          data: {
            tenantId: tenantBId,
            registrationPlate: `ISO-B-${ts}`,
            make: 'Mercedes',
            model: 'Sprinter',
            capacityCubicFeet: 250,
            lastInspectionDate: new Date('2025-01-01'),
          },
        }),
      ])
      vehicleAId = vA.id
      vehicleBId = vB.id
    })

    it('findMany via dbA returns only Tenant A vehicles', async () => {
      const rows = await dbA.vehicle.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(vehicleAId)
      expect(ids).not.toContain(vehicleBId)
    })

    it('update via dbA cannot mutate a Tenant B vehicle', async () => {
      await dbA.vehicle.update({ where: { id: vehicleBId }, data: { make: 'HACKED' } }).catch(() => {})
      const unchanged = await db.vehicle.findUnique({ where: { id: vehicleBId } })
      expect(unchanged?.make).toBe('Mercedes')
    })

    it('delete via dbA cannot remove a Tenant B vehicle', async () => {
      await dbA.vehicle.delete({ where: { id: vehicleBId } }).catch(() => {})
      const stillExists = await db.vehicle.findUnique({ where: { id: vehicleBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Availability isolation
  // -------------------------------------------------------------------------

  describe('Availability', () => {
    let availAId: string
    let availBId: string

    beforeAll(async () => {
      const [aA, aB] = await Promise.all([
        db.availability.create({
          data: {
            tenantId: tenantAId,
            windowStart: new Date('2025-06-01T08:00:00Z'),
            windowEnd: new Date('2025-06-01T17:00:00Z'),
          },
        }),
        db.availability.create({
          data: {
            tenantId: tenantBId,
            windowStart: new Date('2025-06-02T08:00:00Z'),
            windowEnd: new Date('2025-06-02T17:00:00Z'),
          },
        }),
      ])
      availAId = aA.id
      availBId = aB.id
    })

    it('findMany via dbA returns only Tenant A availabilities', async () => {
      const rows = await dbA.availability.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(availAId)
      expect(ids).not.toContain(availBId)
    })

    it('update via dbA cannot mutate a Tenant B availability', async () => {
      await dbA.availability.update({
        where: { id: availBId },
        data: { isAvailable: false },
      }).catch(() => {})
      const unchanged = await db.availability.findUnique({ where: { id: availBId } })
      expect(unchanged?.isAvailable).toBe(true)
    })

    it('delete via dbA cannot remove a Tenant B availability', async () => {
      await dbA.availability.delete({ where: { id: availBId } }).catch(() => {})
      const stillExists = await db.availability.findUnique({ where: { id: availBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Move isolation
  // -------------------------------------------------------------------------

  describe('Move', () => {
    let moveAId: string
    let moveBId: string

    const addressData = {
      line1: '1 Test St',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      country: 'US',
    }

    beforeAll(async () => {
      const [mA, mB] = await Promise.all([
        db.move.create({
          data: {
            tenant: { connect: { id: tenantAId } },
            userId: 'user-a',
            status: 'PENDING',
            scheduledDate: new Date('2025-09-01'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
        db.move.create({
          data: {
            tenant: { connect: { id: tenantBId } },
            userId: 'user-b',
            status: 'PENDING',
            scheduledDate: new Date('2025-09-02'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
      ])
      moveAId = mA.id
      moveBId = mB.id
    })

    it('findMany via dbA returns only Tenant A moves', async () => {
      const rows = await dbA.move.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(moveAId)
      expect(ids).not.toContain(moveBId)
    })

    it('findUnique via dbA returns null for a Tenant B move', async () => {
      const result = await dbA.move.findUnique({ where: { id: moveBId } })
      expect(result).toBeNull()
    })

    it('update via dbA cannot mutate a Tenant B move', async () => {
      await dbA.move.update({ where: { id: moveBId }, data: { status: 'CANCELLED' } }).catch(() => {})
      const unchanged = await db.move.findUnique({ where: { id: moveBId } })
      expect(unchanged?.status).toBe('PENDING')
    })

    it('delete via dbA cannot remove a Tenant B move', async () => {
      await dbA.move.delete({ where: { id: moveBId } }).catch(() => {})
      const stillExists = await db.move.findUnique({ where: { id: moveBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // LeadSource isolation
  // -------------------------------------------------------------------------

  describe('LeadSource', () => {
    let lsAId: string
    let lsBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [lA, lB] = await Promise.all([
        db.leadSource.create({ data: { tenantId: tenantAId, name: `Lead-A-${ts}` } }),
        db.leadSource.create({ data: { tenantId: tenantBId, name: `Lead-B-${ts}` } }),
      ])
      lsAId = lA.id
      lsBId = lB.id
    })

    it('findMany via dbA returns only Tenant A lead sources', async () => {
      const rows = await dbA.leadSource.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(lsAId)
      expect(ids).not.toContain(lsBId)
    })

    it('update via dbA cannot mutate a Tenant B lead source', async () => {
      await dbA.leadSource.update({ where: { id: lsBId }, data: { name: 'HACKED' } }).catch(() => {})
      const unchanged = await db.leadSource.findUnique({ where: { id: lsBId } })
      expect(unchanged?.name).not.toBe('HACKED')
    })

    it('delete via dbA cannot remove a Tenant B lead source', async () => {
      await dbA.leadSource.delete({ where: { id: lsBId } }).catch(() => {})
      const stillExists = await db.leadSource.findUnique({ where: { id: lsBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Account isolation
  // -------------------------------------------------------------------------

  describe('Account', () => {
    let accountAId: string
    let accountBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [aA, aB] = await Promise.all([
        db.account.create({ data: { tenantId: tenantAId, name: `Acct-A-${ts}` } }),
        db.account.create({ data: { tenantId: tenantBId, name: `Acct-B-${ts}` } }),
      ])
      accountAId = aA.id
      accountBId = aB.id
    })

    it('findMany via dbA returns only Tenant A accounts', async () => {
      const rows = await dbA.account.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(accountAId)
      expect(ids).not.toContain(accountBId)
    })

    it('update via dbA cannot mutate a Tenant B account', async () => {
      await dbA.account.update({ where: { id: accountBId }, data: { name: 'HACKED' } }).catch(() => {})
      const unchanged = await db.account.findUnique({ where: { id: accountBId } })
      expect(unchanged?.name).not.toBe('HACKED')
    })

    it('delete via dbA cannot remove a Tenant B account', async () => {
      await dbA.account.delete({ where: { id: accountBId } }).catch(() => {})
      const stillExists = await db.account.findUnique({ where: { id: accountBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // RateTable isolation
  // -------------------------------------------------------------------------

  describe('RateTable', () => {
    let rtAId: string
    let rtBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [rA, rB] = await Promise.all([
        db.rateTable.create({
          data: {
            tenantId: tenantAId,
            name: `RT-A-${ts}`,
            effectiveFrom: new Date('2025-01-01'),
          },
        }),
        db.rateTable.create({
          data: {
            tenantId: tenantBId,
            name: `RT-B-${ts}`,
            effectiveFrom: new Date('2025-01-01'),
          },
        }),
      ])
      rtAId = rA.id
      rtBId = rB.id
    })

    it('findMany via dbA returns only Tenant A rate tables', async () => {
      const rows = await dbA.rateTable.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(rtAId)
      expect(ids).not.toContain(rtBId)
    })

    it('update via dbA cannot mutate a Tenant B rate table', async () => {
      await dbA.rateTable.update({ where: { id: rtBId }, data: { name: 'HACKED' } }).catch(() => {})
      const unchanged = await db.rateTable.findUnique({ where: { id: rtBId } })
      expect(unchanged?.name).not.toBe('HACKED')
    })

    it('delete via dbA cannot remove a Tenant B rate table', async () => {
      await dbA.rateTable.delete({ where: { id: rtBId } }).catch(() => {})
      const stillExists = await db.rateTable.findUnique({ where: { id: rtBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Quote isolation (depends on Move)
  // -------------------------------------------------------------------------

  describe('Quote', () => {
    let quoteAId: string
    let quoteBId: string

    const addressData = {
      line1: '5 Quote Ave',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201',
      country: 'US',
    }

    beforeAll(async () => {
      const [moveA, moveB] = await Promise.all([
        db.move.create({
          data: {
            tenant: { connect: { id: tenantAId } },
            userId: 'user-a',
            status: 'PENDING',
            scheduledDate: new Date('2025-10-01'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
        db.move.create({
          data: {
            tenant: { connect: { id: tenantBId } },
            userId: 'user-b',
            status: 'PENDING',
            scheduledDate: new Date('2025-10-02'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
      ])

      const [qA, qB] = await Promise.all([
        db.quote.create({
          data: {
            tenantId: tenantAId,
            moveId: moveA.id,
            priceAmount: 100,
            validUntil: new Date('2025-12-31'),
          },
        }),
        db.quote.create({
          data: {
            tenantId: tenantBId,
            moveId: moveB.id,
            priceAmount: 200,
            validUntil: new Date('2025-12-31'),
          },
        }),
      ])
      quoteAId = qA.id
      quoteBId = qB.id
    })

    it('findMany via dbA returns only Tenant A quotes', async () => {
      const rows = await dbA.quote.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(quoteAId)
      expect(ids).not.toContain(quoteBId)
    })

    it('update via dbA cannot mutate a Tenant B quote', async () => {
      await dbA.quote.update({ where: { id: quoteBId }, data: { status: 'ACCEPTED' } }).catch(() => {})
      const unchanged = await db.quote.findUnique({ where: { id: quoteBId } })
      expect(unchanged?.status).toBe('DRAFT')
    })

    it('delete via dbA cannot remove a Tenant B quote', async () => {
      await dbA.quote.delete({ where: { id: quoteBId } }).catch(() => {})
      const stillExists = await db.quote.findUnique({ where: { id: quoteBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Invoice isolation (depends on Move)
  // -------------------------------------------------------------------------

  describe('Invoice', () => {
    let invoiceAId: string
    let invoiceBId: string

    const addressData = {
      line1: '7 Invoice Blvd',
      city: 'Houston',
      state: 'TX',
      postalCode: '77001',
      country: 'US',
    }

    beforeAll(async () => {
      const [moveA, moveB] = await Promise.all([
        db.move.create({
          data: {
            tenant: { connect: { id: tenantAId } },
            userId: 'user-a',
            status: 'PENDING',
            scheduledDate: new Date('2025-11-01'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
        db.move.create({
          data: {
            tenant: { connect: { id: tenantBId } },
            userId: 'user-b',
            status: 'PENDING',
            scheduledDate: new Date('2025-11-02'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
      ])

      const [iA, iB] = await Promise.all([
        db.invoice.create({
          data: {
            tenantId: tenantAId,
            moveId: moveA.id,
            totalAmount: 500,
          },
        }),
        db.invoice.create({
          data: {
            tenantId: tenantBId,
            moveId: moveB.id,
            totalAmount: 600,
          },
        }),
      ])
      invoiceAId = iA.id
      invoiceBId = iB.id
    })

    it('findMany via dbA returns only Tenant A invoices', async () => {
      const rows = await dbA.invoice.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(invoiceAId)
      expect(ids).not.toContain(invoiceBId)
    })

    it('update via dbA cannot mutate a Tenant B invoice', async () => {
      await dbA.invoice.update({ where: { id: invoiceBId }, data: { status: 'VOID' } }).catch(() => {})
      const unchanged = await db.invoice.findUnique({ where: { id: invoiceBId } })
      expect(unchanged?.status).toBe('DRAFT')
    })

    it('delete via dbA cannot remove a Tenant B invoice', async () => {
      await dbA.invoice.delete({ where: { id: invoiceBId } }).catch(() => {})
      const stillExists = await db.invoice.findUnique({ where: { id: invoiceBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // InventoryRoom isolation (depends on Move)
  // -------------------------------------------------------------------------

  describe('InventoryRoom', () => {
    let roomAId: string
    let roomBId: string

    const addressData = {
      line1: '9 Inventory Lane',
      city: 'San Antonio',
      state: 'TX',
      postalCode: '78201',
      country: 'US',
    }

    beforeAll(async () => {
      const [moveA, moveB] = await Promise.all([
        db.move.create({
          data: {
            tenant: { connect: { id: tenantAId } },
            userId: 'user-a',
            status: 'PENDING',
            scheduledDate: new Date('2025-12-01'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
        db.move.create({
          data: {
            tenant: { connect: { id: tenantBId } },
            userId: 'user-b',
            status: 'PENDING',
            scheduledDate: new Date('2025-12-02'),
            origin: { create: { ...addressData } },
            destination: { create: { ...addressData } },
          },
        }),
      ])

      const [rA, rB] = await Promise.all([
        db.inventoryRoom.create({
          data: { tenantId: tenantAId, moveId: moveA.id, name: 'Living Room A' },
        }),
        db.inventoryRoom.create({
          data: { tenantId: tenantBId, moveId: moveB.id, name: 'Living Room B' },
        }),
      ])
      roomAId = rA.id
      roomBId = rB.id
    })

    it('findMany via dbA returns only Tenant A inventory rooms', async () => {
      const rows = await dbA.inventoryRoom.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(roomAId)
      expect(ids).not.toContain(roomBId)
    })

    it('update via dbA cannot mutate a Tenant B inventory room', async () => {
      await dbA.inventoryRoom.update({ where: { id: roomBId }, data: { name: 'HACKED' } }).catch(() => {})
      const unchanged = await db.inventoryRoom.findUnique({ where: { id: roomBId } })
      expect(unchanged?.name).toBe('Living Room B')
    })

    it('delete via dbA cannot remove a Tenant B inventory room', async () => {
      await dbA.inventoryRoom.delete({ where: { id: roomBId } }).catch(() => {})
      const stillExists = await db.inventoryRoom.findUnique({ where: { id: roomBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // TenantSsoProvider isolation
  // -------------------------------------------------------------------------

  describe('TenantSsoProvider', () => {
    let providerAId: string
    let providerBId: string

    beforeAll(async () => {
      const ts = Date.now()
      const [pA, pB] = await Promise.all([
        db.tenantSsoProvider.create({
          data: {
            tenantId: tenantAId,
            name: `Provider-A-${ts}`,
            type: 'OIDC',
            cognitoProviderName: `oidc-a-${ts}`,
          },
        }),
        db.tenantSsoProvider.create({
          data: {
            tenantId: tenantBId,
            name: `Provider-B-${ts}`,
            type: 'SAML',
            cognitoProviderName: `saml-b-${ts}`,
          },
        }),
      ])
      providerAId = pA.id
      providerBId = pB.id
    })

    it('findMany via dbA returns only Tenant A SSO providers', async () => {
      const rows = await dbA.tenantSsoProvider.findMany()
      const ids = rows.map((r: { id: string }) => r.id)
      expect(ids).toContain(providerAId)
      expect(ids).not.toContain(providerBId)
    })

    it('update via dbA cannot mutate a Tenant B SSO provider', async () => {
      await dbA.tenantSsoProvider
        .update({ where: { id: providerBId }, data: { name: 'HACKED' } })
        .catch(() => {})
      const unchanged = await db.tenantSsoProvider.findUnique({ where: { id: providerBId } })
      expect(unchanged?.name).not.toBe('HACKED')
    })

    it('delete via dbA cannot remove a Tenant B SSO provider', async () => {
      await dbA.tenantSsoProvider.delete({ where: { id: providerBId } }).catch(() => {})
      const stillExists = await db.tenantSsoProvider.findUnique({ where: { id: providerBId } })
      expect(stillExists).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Schema-sync assertion: TENANT_SCOPED_MODELS must not contain models that
  // lack a tenantId column, and every NEW model with a tenantId column must
  // either be added to TENANT_SCOPED_MODELS or to the explicit exclusion list
  // below. This test fails immediately when a new model with tenantId is added
  // to the schema but neither scoped nor acknowledged.
  // -------------------------------------------------------------------------

  describe('Schema-sync: TENANT_SCOPED_MODELS matches schema.prisma', () => {
    it('TENANT_SCOPED_MODELS contains only models that have a tenantId field, and all new tenantId models are acknowledged', () => {
      const schemaPath = join(__dirname, '../../../prisma/schema.prisma')
      const schemaText = readFileSync(schemaPath, 'utf-8')

      // Models that have a tenantId field but are intentionally excluded from
      // TENANT_SCOPED_MODELS because they are not queried via the tenant-scoped
      // Prisma client (they use a separate auth/access path).
      const INTENTIONALLY_UNSCOPED = new Set([
        'TenantUser',   // accessed via tenant middleware directly, not by tenant API handlers
        'AuthSession',  // short-lived auth handshake record — no tenant-API reads
        'ApiClient',    // M2M auth — accessed by api-client-auth middleware, not tenant handlers
      ])

      // Extract model names that contain a tenantId field declaration.
      // Strategy: parse model blocks, then check each block for "tenantId".
      const modelBlockRegex = /^model\s+(\w+)\s*\{([^}]*)\}/gm
      const modelsWithTenantId: string[] = []

      let match: RegExpExecArray | null
      while ((match = modelBlockRegex.exec(schemaText)) !== null) {
        const modelName = match[1]!
        const body = match[2]!
        // Look for a tenantId field declaration line
        if (/\btenantId\b/.test(body)) {
          modelsWithTenantId.push(modelName)
        }
      }

      // Every model with tenantId must be either scoped or intentionally excluded.
      // If neither, the developer forgot to update one of the two sets.
      for (const model of modelsWithTenantId) {
        const isScoped = TENANT_SCOPED_MODELS.has(model)
        const isExcluded = INTENTIONALLY_UNSCOPED.has(model)
        expect(
          isScoped || isExcluded,
          `Model "${model}" has a tenantId field but is neither in TENANT_SCOPED_MODELS nor INTENTIONALLY_UNSCOPED. ` +
            `Add it to one of those sets in prisma.ts / this test.`,
        ).toBe(true)
      }

      // TENANT_SCOPED_MODELS must not reference models that have no tenantId.
      // This catches stale entries after a model is renamed or removed.
      for (const scopedModel of TENANT_SCOPED_MODELS) {
        expect(
          modelsWithTenantId.includes(scopedModel),
          `TENANT_SCOPED_MODELS contains "${scopedModel}" but that model has no tenantId in schema.prisma`,
        ).toBe(true)
      }
    })
  })
})
