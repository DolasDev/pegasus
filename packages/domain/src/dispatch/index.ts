// ---------------------------------------------------------------------------
// Dispatch bounded context
// Owns the operational record of the move: scheduling, crew, vehicles, stops.
// ---------------------------------------------------------------------------

import type { Brand, Address, UserId } from '../shared/types'
import type { CustomerId } from '../customer/index'
import type { CrewMemberId, VehicleId } from '../schedule/index'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies a Move aggregate. */
export type MoveId = Brand<string, 'MoveId'>

/** Uniquely identifies a Stop within a Move. */
export type StopId = Brand<string, 'StopId'>

export const toMoveId = (raw: string): MoveId => raw as MoveId
export const toStopId = (raw: string): StopId => raw as StopId

// ---------------------------------------------------------------------------
// Value objects
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a Move.
 *
 * Allowed transitions:
 *   PENDING → SCHEDULED → IN_PROGRESS → COMPLETED
 *   Any non-terminal state → CANCELLED
 */
export type MoveStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export const MOVE_STATUSES: readonly MoveStatus[] = [
  'PENDING',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const

/** The role of a stop along the move route. */
export type StopType = 'PICKUP' | 'DELIVERY' | 'STORAGE' | 'WAYPOINT'

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * A single location visit within a Move route.
 *
 * @invariant `address` must be a valid postal address (all required fields non-empty).
 * @invariant `sequence` must be unique and sequential within its parent Move.
 */
export interface Stop {
  readonly id: StopId
  readonly moveId: MoveId
  readonly type: StopType
  readonly address: Address
  /** 1-based position in the route. */
  readonly sequence: number
  readonly scheduledAt?: Date
  readonly arrivedAt?: Date
  readonly departedAt?: Date
  readonly notes?: string
}

/**
 * The Move aggregate root.
 *
 * A Move is the central operational entity. It is born as PENDING when a
 * customer confirms their booking, progresses through scheduling and dispatch,
 * and is closed as COMPLETED or CANCELLED.
 *
 * @invariant At least one crew member must be assigned before the Move can
 *            transition to IN_PROGRESS (`canDispatch` enforces this).
 * @invariant The status must follow the allowed transition graph (`canTransition` enforces this).
 * @invariant A Move requires at least two stops (origin and destination).
 */
export interface Move {
  readonly id: MoveId
  /** Platform user who created the move record. */
  readonly userId: UserId
  readonly customerId?: CustomerId
  readonly status: MoveStatus
  /** Convenience reference to the first PICKUP stop address. */
  readonly origin: Address
  /** Convenience reference to the last DELIVERY stop address. */
  readonly destination: Address
  readonly stops?: readonly Stop[]
  readonly assignedCrewIds?: readonly CrewMemberId[]
  readonly assignedVehicleIds?: readonly VehicleId[]
  readonly scheduledDate: Date
  readonly createdAt: Date
  readonly updatedAt: Date
}

// ---------------------------------------------------------------------------
// Domain functions
// ---------------------------------------------------------------------------

/** Returns true when a move can legally transition from `current` to `next`. */
export function canTransition(current: MoveStatus, next: MoveStatus): boolean {
  const allowed: Record<MoveStatus, readonly MoveStatus[]> = {
    PENDING: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
  }
  return allowed[current].includes(next)
}

/**
 * Returns true when the Move satisfies all pre-conditions for dispatch
 * (transitioning to IN_PROGRESS).
 *
 * @rule A Move cannot be dispatched without at least one crew member assigned.
 */
export function canDispatch(move: Move): boolean {
  return (move.assignedCrewIds?.length ?? 0) > 0
}
