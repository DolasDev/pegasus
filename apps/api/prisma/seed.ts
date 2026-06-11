/**
 * Seed logic: creates realistic baseline data for local development.
 *
 * Run via the CLI wrapper: npm run db:seed (tsx prisma/seed-run.ts).
 * Exported as `main(db)` so integration tests (src/__tests__/seed.test.ts)
 * can run it against the shared test client without side effects on import.
 *
 * Idempotent — running twice is safe. Every row either upserts on a
 * deterministic id or on its tenant-scoped compound unique, and nested
 * creates only fire on the initial upsert-create.
 *
 * All tenant-scoped rows belong to a single dev tenant whose id matches the
 * SKIP_AUTH middleware default (apps/api/src/middleware/skip-auth.ts), so a
 * locally-running API sees the seeded data when DEFAULT_TENANT_ID is set.
 */
import type { PrismaClient } from '@prisma/client'

export const DEV_TENANT_ID = 'dev00000-0000-0000-0000-000000000001'

export async function main(db: PrismaClient): Promise<void> {
  const tenantId = process.env['DEFAULT_TENANT_ID'] ?? DEV_TENANT_ID

  console.log('🌱  Seeding database …')

  // ---------------------------------------------------------------------------
  // Dev tenant + admin tenant user (mirrors apps/e2e/global-setup.ts)
  // ---------------------------------------------------------------------------
  const tenant = await db.tenant.upsert({
    where: { id: tenantId },
    create: { id: tenantId, name: 'Dev Tenant', slug: 'dev' },
    update: {},
  })

  await db.tenantUser.upsert({
    where: { tenantId_email: { tenantId, email: 'dev-admin@example.com' } },
    create: {
      id: 'seed-tenant-user-001',
      tenantId,
      email: 'dev-admin@example.com',
      roleNames: ['tenant_admin'],
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
    update: {},
  })

  // ---------------------------------------------------------------------------
  // Lead sources
  // ---------------------------------------------------------------------------
  const [webLead, referral] = await Promise.all([
    db.leadSource.upsert({
      where: { tenantId_name: { tenantId, name: 'Website' } },
      create: { tenantId, name: 'Website', description: 'Organic website enquiry' },
      update: {},
    }),
    db.leadSource.upsert({
      where: { tenantId_name: { tenantId, name: 'Referral' } },
      create: {
        tenantId,
        name: 'Referral',
        description: 'Word-of-mouth referral from existing customer',
      },
      update: {},
    }),
  ])

  // ---------------------------------------------------------------------------
  // Rate table
  // ---------------------------------------------------------------------------
  const rateTable = await db.rateTable.upsert({
    where: { tenantId_name: { tenantId, name: 'Standard 2026' } },
    create: {
      tenantId,
      name: 'Standard 2026',
      effectiveFrom: new Date('2026-01-01'),
      isActive: true,
      rates: {
        create: [
          { serviceCode: 'LABOR_HR', description: 'Labour (per man-hour)', unitPrice: 75.0 },
          { serviceCode: 'TRUCK_HR', description: 'Truck (per hour)', unitPrice: 120.0 },
          { serviceCode: 'PACKING_BOX', description: 'Packing box', unitPrice: 4.5 },
          { serviceCode: 'FUEL_SURCHARGE', description: 'Fuel surcharge (flat)', unitPrice: 35.0 },
        ],
      },
    },
    update: {},
  })

  // ---------------------------------------------------------------------------
  // Crew member & vehicle
  // ---------------------------------------------------------------------------
  const crew = await db.crewMember.upsert({
    where: { id: 'seed-crew-001' },
    create: {
      id: 'seed-crew-001',
      tenantId,
      name: 'Marcus Rivera',
      role: 'DRIVER',
      licenceClasses: ['C', 'MR'],
      isActive: true,
    },
    update: {},
  })

  const vehicle = await db.vehicle.upsert({
    where: { tenantId_registrationPlate: { tenantId, registrationPlate: 'PEG-001' } },
    create: {
      tenantId,
      registrationPlate: 'PEG-001',
      make: 'Isuzu',
      model: 'NPR',
      capacityCubicFeet: 800,
      lastInspectionDate: new Date('2025-11-01'),
      isActive: true,
    },
    update: {},
  })

  // ---------------------------------------------------------------------------
  // Customer 1 — Alice Johnson (web lead, COMPLETED move)
  // ---------------------------------------------------------------------------
  const alice = await db.customer.upsert({
    where: { tenantId_email: { tenantId, email: 'alice.johnson@example.com' } },
    create: {
      tenantId,
      userId: 'user-seed-001',
      firstName: 'Alice',
      lastName: 'Johnson',
      email: 'alice.johnson@example.com',
      phone: '503-555-0101',
      leadSourceId: webLead.id,
      contacts: {
        create: {
          firstName: 'Alice',
          lastName: 'Johnson',
          email: 'alice.johnson@example.com',
          phone: '503-555-0101',
          isPrimary: true,
        },
      },
    },
    update: {},
  })

  // Move 1 — COMPLETED
  const move1Origin = await db.address.upsert({
    where: { id: 'seed-addr-001' },
    create: {
      id: 'seed-addr-001',
      line1: '123 Oak Street',
      city: 'Portland',
      state: 'OR',
      postalCode: '97201',
      country: 'US',
    },
    update: {},
  })
  const move1Dest = await db.address.upsert({
    where: { id: 'seed-addr-002' },
    create: {
      id: 'seed-addr-002',
      line1: '456 Pine Avenue',
      city: 'Seattle',
      state: 'WA',
      postalCode: '98101',
      country: 'US',
    },
    update: {},
  })

  const move1 = await db.move.upsert({
    where: { id: 'seed-move-001' },
    create: {
      id: 'seed-move-001',
      tenantId,
      userId: alice.userId,
      customerId: alice.id,
      status: 'COMPLETED',
      originId: move1Origin.id,
      destinationId: move1Dest.id,
      scheduledDate: new Date('2026-01-15'),
      crewAssignments: { create: { crewMemberId: crew.id } },
      vehicleAssignments: { create: { vehicleId: vehicle.id } },
      stops: {
        create: [
          { type: 'PICKUP', addressId: move1Origin.id, sequence: 1 },
          { type: 'DELIVERY', addressId: move1Dest.id, sequence: 2 },
        ],
      },
    },
    update: {},
  })

  // Quote for move 1 — ACCEPTED
  const quote1 = await db.quote.upsert({
    where: { id: 'seed-quote-001' },
    create: {
      id: 'seed-quote-001',
      tenantId,
      moveId: move1.id,
      rateTableId: rateTable.id,
      status: 'ACCEPTED',
      priceAmount: 1450.0,
      validUntil: new Date('2026-01-10'),
      lineItems: {
        create: [
          { description: 'Labour (8 man-hours)', quantity: 8, unitPrice: 75.0 },
          { description: 'Truck (5 hours)', quantity: 5, unitPrice: 120.0 },
          { description: 'Fuel surcharge', quantity: 1, unitPrice: 35.0 },
          { description: 'Packing boxes', quantity: 20, unitPrice: 4.5 },
        ],
      },
    },
    update: {},
  })

  // Invoice — PAID
  const invoice1 = await db.invoice.upsert({
    where: { id: 'seed-invoice-001' },
    create: {
      id: 'seed-invoice-001',
      tenantId,
      moveId: move1.id,
      quoteId: quote1.id,
      status: 'PAID',
      totalAmount: 1450.0,
      issuedAt: new Date('2026-01-16'),
      dueAt: new Date('2026-01-30'),
    },
    update: {},
  })
  await db.payment.upsert({
    where: { id: 'seed-payment-001' },
    create: {
      id: 'seed-payment-001',
      invoiceId: invoice1.id,
      amount: 1450.0,
      method: 'CARD',
      paidAt: new Date('2026-01-17'),
      reference: 'stripe_pi_1234',
    },
    update: {},
  })

  // Inventory for move 1
  const bedroom = await db.inventoryRoom.upsert({
    where: { id: 'seed-room-001' },
    create: { id: 'seed-room-001', tenantId, moveId: move1.id, name: 'Master Bedroom' },
    update: {},
  })
  await db.inventoryRoom.upsert({
    where: { id: 'seed-room-002' },
    create: {
      id: 'seed-room-002',
      tenantId,
      moveId: move1.id,
      name: 'Kitchen',
      items: {
        create: [
          {
            id: 'seed-item-004',
            name: 'Microwave',
            quantity: 1,
            conditionAtPack: 'GOOD',
            conditionAtDelivery: 'GOOD',
            declaredValue: 200,
          },
          {
            id: 'seed-item-005',
            name: 'Blender',
            quantity: 1,
            conditionAtPack: 'EXCELLENT',
            conditionAtDelivery: 'EXCELLENT',
            declaredValue: 80,
          },
        ],
      },
    },
    update: {},
  })
  await db.inventoryItem.createMany({
    data: [
      {
        id: 'seed-item-001',
        roomId: bedroom.id,
        name: 'Queen Bed Frame',
        quantity: 1,
        conditionAtPack: 'GOOD',
        conditionAtDelivery: 'GOOD',
        declaredValue: 600,
      },
      {
        id: 'seed-item-002',
        roomId: bedroom.id,
        name: 'Dresser',
        quantity: 1,
        conditionAtPack: 'FAIR',
        conditionAtDelivery: 'FAIR',
        declaredValue: 300,
      },
      {
        id: 'seed-item-003',
        roomId: bedroom.id,
        name: 'Bedside Table',
        quantity: 2,
        conditionAtPack: 'GOOD',
        conditionAtDelivery: 'GOOD',
        declaredValue: 75,
      },
    ],
    skipDuplicates: true,
  })

  // ---------------------------------------------------------------------------
  // Customer 2 — Bob Chen (referral, moves in-flight)
  // ---------------------------------------------------------------------------
  const bob = await db.customer.upsert({
    where: { tenantId_email: { tenantId, email: 'bob.chen@example.com' } },
    create: {
      tenantId,
      userId: 'user-seed-002',
      firstName: 'Bob',
      lastName: 'Chen',
      email: 'bob.chen@example.com',
      phone: '206-555-0202',
      leadSourceId: referral.id,
      contacts: {
        create: {
          firstName: 'Bob',
          lastName: 'Chen',
          email: 'bob.chen@example.com',
          phone: '206-555-0202',
          isPrimary: true,
        },
      },
    },
    update: {},
  })

  // Move 2 — SCHEDULED
  const move2Origin = await db.address.upsert({
    where: { id: 'seed-addr-003' },
    create: {
      id: 'seed-addr-003',
      line1: '789 Elm Road',
      city: 'Tacoma',
      state: 'WA',
      postalCode: '98402',
      country: 'US',
    },
    update: {},
  })
  const move2Dest = await db.address.upsert({
    where: { id: 'seed-addr-004' },
    create: {
      id: 'seed-addr-004',
      line1: '321 Maple Drive',
      city: 'Bellevue',
      state: 'WA',
      postalCode: '98004',
      country: 'US',
    },
    update: {},
  })

  const move2 = await db.move.upsert({
    where: { id: 'seed-move-002' },
    create: {
      id: 'seed-move-002',
      tenantId,
      userId: bob.userId,
      customerId: bob.id,
      status: 'SCHEDULED',
      originId: move2Origin.id,
      destinationId: move2Dest.id,
      scheduledDate: new Date('2026-03-05'),
      crewAssignments: { create: { crewMemberId: crew.id } },
      stops: {
        create: [
          { type: 'PICKUP', addressId: move2Origin.id, sequence: 1 },
          { type: 'DELIVERY', addressId: move2Dest.id, sequence: 2 },
        ],
      },
    },
    update: {},
  })

  // Quote for move 2 — SENT
  await db.quote.upsert({
    where: { id: 'seed-quote-002' },
    create: {
      id: 'seed-quote-002',
      tenantId,
      moveId: move2.id,
      rateTableId: rateTable.id,
      status: 'SENT',
      priceAmount: 875.0,
      validUntil: new Date('2026-02-28'),
      lineItems: {
        create: [
          { description: 'Labour (6 man-hours)', quantity: 6, unitPrice: 75.0 },
          { description: 'Truck (4 hours)', quantity: 4, unitPrice: 120.0 },
          { description: 'Fuel surcharge', quantity: 1, unitPrice: 35.0 },
        ],
      },
    },
    update: {},
  })

  // Move 3 — PENDING (just booked)
  const move3Origin = await db.address.upsert({
    where: { id: 'seed-addr-005' },
    create: {
      id: 'seed-addr-005',
      line1: '55 Cedar Lane',
      city: 'Olympia',
      state: 'WA',
      postalCode: '98501',
      country: 'US',
    },
    update: {},
  })
  const move3Dest = await db.address.upsert({
    where: { id: 'seed-addr-006' },
    create: {
      id: 'seed-addr-006',
      line1: '88 Birch Court',
      city: 'Renton',
      state: 'WA',
      postalCode: '98057',
      country: 'US',
    },
    update: {},
  })

  await db.move.upsert({
    where: { id: 'seed-move-003' },
    create: {
      id: 'seed-move-003',
      tenantId,
      userId: bob.userId,
      customerId: bob.id,
      status: 'PENDING',
      originId: move3Origin.id,
      destinationId: move3Dest.id,
      scheduledDate: new Date('2026-04-20'),
      stops: {
        create: [
          { type: 'PICKUP', addressId: move3Origin.id, sequence: 1 },
          { type: 'DELIVERY', addressId: move3Dest.id, sequence: 2 },
        ],
      },
    },
    update: {},
  })

  console.log('✅  Seed complete')
  console.log(`   Tenant: ${tenant.name} (id: ${tenant.id})`)
  console.log(`   Customers: Alice Johnson, Bob Chen`)
  console.log(`   Moves: 1 COMPLETED, 1 SCHEDULED, 1 PENDING`)
  console.log(`   Crew: ${crew.name}  |  Vehicle: ${vehicle.registrationPlate}`)
  console.log(
    `   For local dev (SKIP_AUTH=true), set DEFAULT_TENANT_ID=${tenant.id} in apps/api/.env`,
  )
}
