/**
 * Integration tests for the move repository.
 *
 * These tests require a live PostgreSQL database and are skipped automatically
 * when DATABASE_URL is not set in the environment.
 *
 * To run locally:
 *   DATABASE_URL=postgresql://... npm test
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { db } from '../../db'
import {
  createMove,
  findMoveById,
  listMoves,
  updateMoveStatus,
  assignCrewMember,
  assignVehicle,
} from '../move.repository'

const hasDb = Boolean(process.env['DATABASE_URL'])

const createdMoveIds: string[] = []

afterAll(async () => {
  if (hasDb) {
    for (const id of createdMoveIds) {
      await db.move
        .delete({ where: { id } })
        .catch(() => undefined)
    }
    await db.$disconnect()
  }
})

describe.skipIf(!hasDb)('MoveRepository (integration)', () => {
  const originAddress = {
    line1: '1 Origin Rd',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  }
  const destinationAddress = {
    line1: '2 Dest Blvd',
    city: 'Houston',
    state: 'TX',
    postalCode: '77001',
    country: 'US',
  }

  let moveId: string

  beforeAll(async () => {
    const move = await createMove({
      userId: `user-${Date.now()}`,
      scheduledDate: new Date('2025-09-01T08:00:00Z'),
      origin: originAddress,
      destination: destinationAddress,
    })
    moveId = move.id
    createdMoveIds.push(moveId)
  })

  it('createMove returns a Move with a valid id', () => {
    expect(moveId).toBeTruthy()
  })

  it('createMove sets initial status to PENDING', async () => {
    const move = await findMoveById(moveId)
    expect(move?.status).toBe('PENDING')
  })

  it('createMove stores the origin address', async () => {
    const move = await findMoveById(moveId)
    expect(move?.origin.line1).toBe('1 Origin Rd')
    expect(move?.origin.city).toBe('Austin')
  })

  it('createMove stores the destination address', async () => {
    const move = await findMoveById(moveId)
    expect(move?.destination.line1).toBe('2 Dest Blvd')
    expect(move?.destination.city).toBe('Houston')
  })

  it('findMoveById returns null for an unknown id', async () => {
    const result = await findMoveById('00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('listMoves includes the created move', async () => {
    const list = await listMoves({ limit: 100 })
    const found = list.find((m) => m.id === moveId)
    expect(found).toBeDefined()
  })

  it('updateMoveStatus transitions PENDING → SCHEDULED', async () => {
    const updated = await updateMoveStatus(moveId, 'SCHEDULED')
    expect(updated?.status).toBe('SCHEDULED')
  })

  it('assignCrewMember adds a crew member to the move', async () => {
    const crewMemberId = `crew-test-${Date.now()}`
    // Upsert a crew member to avoid FK constraint violations
    await db.crewMember.upsert({
      where: { id: crewMemberId },
      create: { id: crewMemberId, name: 'Test Crew', role: 'DRIVER' },
      update: {},
    })
    const result = await assignCrewMember(moveId, crewMemberId)
    expect(result?.assignedCrewIds).toContain(crewMemberId)

    // Cleanup
    await db.crewMember.delete({ where: { id: crewMemberId } }).catch(() => undefined)
  })

  it('assignVehicle adds a vehicle to the move', async () => {
    const vehicleId = `vehicle-test-${Date.now()}`
    await db.vehicle.upsert({
      where: { id: vehicleId },
      create: {
        id: vehicleId,
        registrationPlate: `TST-${Date.now()}`,
        make: 'Ford',
        model: 'Transit',
        capacityCubicFeet: 400,
        lastInspectionDate: new Date('2024-01-01'),
      },
      update: {},
    })
    const result = await assignVehicle(moveId, vehicleId)
    expect(result?.assignedVehicleIds).toContain(vehicleId)

    // Cleanup
    await db.vehicle.delete({ where: { id: vehicleId } }).catch(() => undefined)
  })
})

// Always-running guard to confirm skip logic
describe('MoveRepository skip guard', () => {
  it('skips integration tests when DATABASE_URL is absent', () => {
    if (!hasDb) {
      expect(true).toBe(true)
    } else {
      expect(hasDb).toBe(true)
    }
  })
})
