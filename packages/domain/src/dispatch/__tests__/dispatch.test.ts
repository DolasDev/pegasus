import { describe, it, expect } from 'vitest'
import {
  canTransition,
  canDispatch,
  toMoveId,
  toStopId,
  MOVE_STATUSES,
  type Move,
  type MoveStatus,
  type Stop,
} from '../index'
import { toUserId, toAddressId, type Address } from '../../shared/types'
import { toCrewMemberId, toVehicleId } from '../../schedule/index'
import { toCustomerId } from '../../customer/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: toAddressId('a-1'),
    line1: '123 Main St',
    city: 'Portland',
    state: 'OR',
    postalCode: '97201',
    country: 'US',
    ...overrides,
  }
}

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    id: toMoveId('m-1'),
    userId: toUserId('u-1'),
    status: 'PENDING',
    origin: makeAddress(),
    destination: makeAddress({ id: toAddressId('a-2'), line1: '456 Oak Ave', city: 'Seattle', state: 'WA', postalCode: '98101' }),
    scheduledDate: new Date('2026-06-01'),
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// canTransition — exhaustive 5×5 transition matrix
//
// Allowed graph:
//   PENDING    → SCHEDULED, CANCELLED
//   SCHEDULED  → IN_PROGRESS, CANCELLED
//   IN_PROGRESS→ COMPLETED, CANCELLED
//   COMPLETED  → (none)
//   CANCELLED  → (none)
// ---------------------------------------------------------------------------

// Build the expected truth-table explicitly so the test is self-documenting.
const transitionMatrix: { from: MoveStatus; to: MoveStatus; allowed: boolean }[] = [
  // PENDING
  { from: 'PENDING', to: 'PENDING', allowed: false },
  { from: 'PENDING', to: 'SCHEDULED', allowed: true },
  { from: 'PENDING', to: 'IN_PROGRESS', allowed: false },
  { from: 'PENDING', to: 'COMPLETED', allowed: false },
  { from: 'PENDING', to: 'CANCELLED', allowed: true },
  // SCHEDULED
  { from: 'SCHEDULED', to: 'PENDING', allowed: false },
  { from: 'SCHEDULED', to: 'SCHEDULED', allowed: false },
  { from: 'SCHEDULED', to: 'IN_PROGRESS', allowed: true },
  { from: 'SCHEDULED', to: 'COMPLETED', allowed: false },
  { from: 'SCHEDULED', to: 'CANCELLED', allowed: true },
  // IN_PROGRESS
  { from: 'IN_PROGRESS', to: 'PENDING', allowed: false },
  { from: 'IN_PROGRESS', to: 'SCHEDULED', allowed: false },
  { from: 'IN_PROGRESS', to: 'IN_PROGRESS', allowed: false },
  { from: 'IN_PROGRESS', to: 'COMPLETED', allowed: true },
  { from: 'IN_PROGRESS', to: 'CANCELLED', allowed: true },
  // COMPLETED (terminal)
  { from: 'COMPLETED', to: 'PENDING', allowed: false },
  { from: 'COMPLETED', to: 'SCHEDULED', allowed: false },
  { from: 'COMPLETED', to: 'IN_PROGRESS', allowed: false },
  { from: 'COMPLETED', to: 'COMPLETED', allowed: false },
  { from: 'COMPLETED', to: 'CANCELLED', allowed: false },
  // CANCELLED (terminal)
  { from: 'CANCELLED', to: 'PENDING', allowed: false },
  { from: 'CANCELLED', to: 'SCHEDULED', allowed: false },
  { from: 'CANCELLED', to: 'IN_PROGRESS', allowed: false },
  { from: 'CANCELLED', to: 'COMPLETED', allowed: false },
  { from: 'CANCELLED', to: 'CANCELLED', allowed: false },
]

describe('canTransition — full 5×5 matrix', () => {
  it('covers all 25 combinations', () => {
    expect(transitionMatrix).toHaveLength(25)
  })

  for (const { from, to, allowed } of transitionMatrix) {
    it(`${from} → ${to} is ${allowed ? 'allowed' : 'disallowed'}`, () => {
      expect(canTransition(from, to)).toBe(allowed)
    })
  }
})

describe('canTransition — forward progress path', () => {
  it('walks the full happy path PENDING→SCHEDULED→IN_PROGRESS→COMPLETED', () => {
    const path: MoveStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED']
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true)
    }
  })

  it('cancellation is allowed from every non-terminal state', () => {
    const nonTerminal: MoveStatus[] = ['PENDING', 'SCHEDULED', 'IN_PROGRESS']
    for (const status of nonTerminal) {
      expect(canTransition(status, 'CANCELLED')).toBe(true)
    }
  })

  it('cancellation is NOT allowed from terminal states', () => {
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'CANCELLED')).toBe(false)
  })
})

describe('canTransition — self-transitions always disallowed', () => {
  for (const status of MOVE_STATUSES) {
    it(`${status} → ${status} returns false`, () => {
      expect(canTransition(status, status)).toBe(false)
    })
  }
})

describe('canTransition — skipping states disallowed', () => {
  it('PENDING cannot skip directly to IN_PROGRESS', () => {
    expect(canTransition('PENDING', 'IN_PROGRESS')).toBe(false)
  })

  it('PENDING cannot skip directly to COMPLETED', () => {
    expect(canTransition('PENDING', 'COMPLETED')).toBe(false)
  })

  it('SCHEDULED cannot skip to COMPLETED', () => {
    expect(canTransition('SCHEDULED', 'COMPLETED')).toBe(false)
  })

  it('SCHEDULED cannot revert to PENDING', () => {
    expect(canTransition('SCHEDULED', 'PENDING')).toBe(false)
  })

  it('IN_PROGRESS cannot revert to PENDING', () => {
    expect(canTransition('IN_PROGRESS', 'PENDING')).toBe(false)
  })

  it('IN_PROGRESS cannot revert to SCHEDULED', () => {
    expect(canTransition('IN_PROGRESS', 'SCHEDULED')).toBe(false)
  })
})

describe('canTransition — terminal states have no exits', () => {
  it('COMPLETED has zero allowed next states', () => {
    const exits = MOVE_STATUSES.filter((s) => canTransition('COMPLETED', s))
    expect(exits).toHaveLength(0)
  })

  it('CANCELLED has zero allowed next states', () => {
    const exits = MOVE_STATUSES.filter((s) => canTransition('CANCELLED', s))
    expect(exits).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// canDispatch
// ---------------------------------------------------------------------------

describe('canDispatch', () => {
  it('returns false when assignedCrewIds is undefined', () => {
    expect(canDispatch(makeMove())).toBe(false)
  })

  it('returns false when assignedCrewIds is an empty array', () => {
    expect(canDispatch(makeMove({ assignedCrewIds: [] }))).toBe(false)
  })

  it('returns true with exactly one crew member', () => {
    expect(canDispatch(makeMove({ assignedCrewIds: [toCrewMemberId('crew-1')] }))).toBe(true)
  })

  it('returns true with multiple crew members', () => {
    expect(
      canDispatch(
        makeMove({
          assignedCrewIds: [toCrewMemberId('crew-1'), toCrewMemberId('crew-2'), toCrewMemberId('crew-3')],
        }),
      ),
    ).toBe(true)
  })

  it('is independent of vehicle assignment — vehicles alone are not enough', () => {
    // A move may have vehicles but no crew — dispatch should still fail
    // (assignedCrewIds left undefined via the default makeMove helper)
    expect(
      canDispatch(
        makeMove({
          assignedVehicleIds: [toVehicleId('veh-1')],
        }),
      ),
    ).toBe(false)
  })

  it('returns true when both crew and vehicles are assigned', () => {
    expect(
      canDispatch(
        makeMove({
          assignedCrewIds: [toCrewMemberId('crew-1')],
          assignedVehicleIds: [toVehicleId('veh-1')],
        }),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Move / Stop branded ID factories
// ---------------------------------------------------------------------------

describe('toMoveId / toStopId', () => {
  it('toMoveId preserves the underlying string value', () => {
    const id = toMoveId('move-abc-123')
    expect(id).toBe('move-abc-123')
  })

  it('toStopId preserves the underlying string value', () => {
    const id = toStopId('stop-xyz-456')
    expect(id).toBe('stop-xyz-456')
  })

  it('two distinct MoveIds with the same raw value are equal', () => {
    expect(toMoveId('same')).toBe(toMoveId('same'))
  })

  it('two distinct MoveIds with different raw values are not equal', () => {
    expect(toMoveId('a')).not.toBe(toMoveId('b'))
  })
})

// ---------------------------------------------------------------------------
// Move optional associations
// ---------------------------------------------------------------------------

describe('Move optional fields', () => {
  it('can be constructed without a customerId', () => {
    const move = makeMove()
    expect(move.customerId).toBeUndefined()
  })

  it('can carry a customerId when provided', () => {
    const move = makeMove({ customerId: toCustomerId('cust-1') })
    expect(move.customerId).toBe('cust-1')
  })

  it('can carry optional stops array', () => {
    const stop: Stop = {
      id: toStopId('s-1'),
      moveId: toMoveId('m-1'),
      type: 'PICKUP',
      address: makeAddress(),
      sequence: 1,
    }
    const move = makeMove({ stops: [stop] })
    expect(move.stops).toHaveLength(1)
    expect(move.stops?.[0]?.type).toBe('PICKUP')
  })

  it('stop sequence is 1-based', () => {
    const stop: Stop = {
      id: toStopId('s-1'),
      moveId: toMoveId('m-1'),
      type: 'DELIVERY',
      address: makeAddress({ id: toAddressId('a-3') }),
      sequence: 2,
    }
    expect(stop.sequence).toBeGreaterThanOrEqual(1)
  })
})
