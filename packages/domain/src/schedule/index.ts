// ---------------------------------------------------------------------------
// Schedule bounded context
// Models crew and vehicle availability for capacity planning.
// ---------------------------------------------------------------------------

import type { Brand, DateRange } from '../shared/types'
export { dateRangesOverlap } from '../shared/types'

// ---------------------------------------------------------------------------
// Branded ID types
// ---------------------------------------------------------------------------

/** Uniquely identifies a CrewMember. */
export type CrewMemberId = Brand<string, 'CrewMemberId'>

/** Uniquely identifies a Vehicle. */
export type VehicleId = Brand<string, 'VehicleId'>

/** Uniquely identifies an Availability window. */
export type AvailabilityId = Brand<string, 'AvailabilityId'>

export const toCrewMemberId = (raw: string): CrewMemberId => raw as CrewMemberId
export const toVehicleId = (raw: string): VehicleId => raw as VehicleId
export const toAvailabilityId = (raw: string): AvailabilityId => raw as AvailabilityId

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/**
 * A crew member who can be assigned to moves.
 *
 * @invariant `name` must be non-empty.
 */
export interface CrewMember {
  readonly id: CrewMemberId
  readonly name: string
  readonly role: CrewRole
  readonly licenceClasses: readonly string[]
  readonly isActive: boolean
}

/** The role a crew member plays on a job. */
export type CrewRole = 'DRIVER' | 'MOVER' | 'SUPERVISOR'

/**
 * A vehicle that can be assigned to moves.
 *
 * @invariant `lastInspectionDate` must be within 12 months of the scheduled move date
 *            before the vehicle can be dispatched.
 */
export interface Vehicle {
  readonly id: VehicleId
  readonly registrationPlate: string
  readonly make: string
  readonly model: string
  readonly capacityCubicFeet: number
  readonly lastInspectionDate: Date
  readonly isActive: boolean
}

/**
 * An availability window for a crew member or vehicle.
 * Two windows for the same resource must not overlap.
 *
 * @invariant `window.end` must be after `window.start`.
 */
export interface Availability {
  readonly id: AvailabilityId
  /** The resource this window applies to. */
  readonly resourceId: CrewMemberId | VehicleId
  readonly resourceType: 'CREW_MEMBER' | 'VEHICLE'
  readonly window: DateRange
  readonly isAvailable: boolean
}
