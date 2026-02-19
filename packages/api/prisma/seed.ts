/**
 * Seed script: creates realistic baseline data for local development.
 * Run with: npm run db:seed (uses tsx to execute TypeScript directly)
 *
 * Idempotent — running twice is safe (upserts where possible, skips if present).
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main(): Promise<void> {
  console.log('🌱  Seeding database …')

  // ---------------------------------------------------------------------------
  // Lead sources
  // ---------------------------------------------------------------------------
  const [webLead, referral] = await Promise.all([
    db.leadSource.upsert({
      where: { name: 'Website' },
      create: { name: 'Website', description: 'Organic website enquiry' },
      update: {},
    }),
    db.leadSource.upsert({
      where: { name: 'Referral' },
      create: { name: 'Referral', description: 'Word-of-mouth referral from existing customer' },
      update: {},
    }),
  ])

  // ---------------------------------------------------------------------------
  // Rate table
  // ---------------------------------------------------------------------------
  const rateTable = await db.rateTable.upsert({
    where: { name: 'Standard 2026' },
    create: {
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
      name: 'Marcus Rivera',
      role: 'DRIVER',
      licenceClasses: ['C', 'MR'],
      isActive: true,
    },
    update: {},
  })

  const vehicle = await db.vehicle.upsert({
    where: { registrationPlate: 'PEG-001' },
    create: {
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
    where: { email: 'alice.johnson@example.com' },
    create: {
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
  const move1Origin = await db.address.create({
    data: { line1: '123 Oak Street', city: 'Portland', state: 'OR', postalCode: '97201', country: 'US' },
  })
  const move1Dest = await db.address.create({
    data: { line1: '456 Pine Avenue', city: 'Seattle', state: 'WA', postalCode: '98101', country: 'US' },
  })

  const move1 = await db.move.create({
    data: {
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
  })

  // Quote for move 1 — ACCEPTED
  const quote1 = await db.quote.create({
    data: {
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
  })

  // Invoice — PAID
  const invoice1 = await db.invoice.create({
    data: {
      moveId: move1.id,
      quoteId: quote1.id,
      status: 'PAID',
      totalAmount: 1450.0,
      issuedAt: new Date('2026-01-16'),
      dueAt: new Date('2026-01-30'),
    },
  })
  await db.payment.create({
    data: {
      invoiceId: invoice1.id,
      amount: 1450.0,
      method: 'CARD',
      paidAt: new Date('2026-01-17'),
      reference: 'stripe_pi_1234',
    },
  })

  // Inventory for move 1
  const bedroom = await db.inventoryRoom.create({
    data: { moveId: move1.id, name: 'Master Bedroom' },
  })
  await db.inventoryRoom.create({
    data: {
      moveId: move1.id,
      name: 'Kitchen',
      items: {
        create: [
          { name: 'Microwave', quantity: 1, conditionAtPack: 'GOOD', conditionAtDelivery: 'GOOD', declaredValue: 200 },
          { name: 'Blender', quantity: 1, conditionAtPack: 'EXCELLENT', conditionAtDelivery: 'EXCELLENT', declaredValue: 80 },
        ],
      },
    },
  })
  await db.inventoryItem.createMany({
    data: [
      { roomId: bedroom.id, name: 'Queen Bed Frame', quantity: 1, conditionAtPack: 'GOOD', conditionAtDelivery: 'GOOD', declaredValue: 600 },
      { roomId: bedroom.id, name: 'Dresser', quantity: 1, conditionAtPack: 'FAIR', conditionAtDelivery: 'FAIR', declaredValue: 300 },
      { roomId: bedroom.id, name: 'Bedside Table', quantity: 2, conditionAtPack: 'GOOD', conditionAtDelivery: 'GOOD', declaredValue: 75 },
    ],
  })

  // ---------------------------------------------------------------------------
  // Customer 2 — Bob Chen (referral, moves in-flight)
  // ---------------------------------------------------------------------------
  const bob = await db.customer.upsert({
    where: { email: 'bob.chen@example.com' },
    create: {
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
  const move2Origin = await db.address.create({
    data: { line1: '789 Elm Road', city: 'Tacoma', state: 'WA', postalCode: '98402', country: 'US' },
  })
  const move2Dest = await db.address.create({
    data: { line1: '321 Maple Drive', city: 'Bellevue', state: 'WA', postalCode: '98004', country: 'US' },
  })

  const move2 = await db.move.create({
    data: {
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
  })

  // Quote for move 2 — SENT
  await db.quote.create({
    data: {
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
  })

  // Move 3 — PENDING (just booked)
  const move3Origin = await db.address.create({
    data: { line1: '55 Cedar Lane', city: 'Olympia', state: 'WA', postalCode: '98501', country: 'US' },
  })
  const move3Dest = await db.address.create({
    data: { line1: '88 Birch Court', city: 'Renton', state: 'WA', postalCode: '98057', country: 'US' },
  })

  await db.move.create({
    data: {
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
  })

  console.log('✅  Seed complete')
  console.log(`   Customers: Alice Johnson, Bob Chen`)
  console.log(`   Moves: 1 COMPLETED, 1 SCHEDULED, 1 PENDING`)
  console.log(`   Crew: ${crew.name}  |  Vehicle: ${vehicle.registrationPlate}`)
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => {
    void db.$disconnect()
  })
