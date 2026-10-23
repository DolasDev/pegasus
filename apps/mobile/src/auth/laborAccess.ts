import { hasOperationsRole } from '@pegasus/auth'
import { useAuth } from '../context/AuthContext'
import { useTrips } from '../context/TripsContext'

// ---------------------------------------------------------------------------
// Who sees what in the drawer and on the Labor tab.
//
//   driver      role `driver`, or a /me/driver mapping (a longhaul driver id)
//   operations  any OPERATIONS_ROLES role (shared with the API and tenant-web)
//
// A driver sees Dashboard / My Trips / Labor (My list | Company). An Operations
// user who is not a driver sees only Labor (Company) and Messages. Anyone else
// has no Labor entry. The mapping call is async, so `resolved` says whether
// "not a driver" can be believed: not while it is in flight (`pending`), and
// not after it FAILED — a flaky launch must not hide a driver's trips.
// ---------------------------------------------------------------------------

export interface LaborAccess {
  isDriver: boolean
  isOperations: boolean
  /** False while /me/driver may still turn a non-driver-role user into a driver. */
  resolved: boolean
  /** The /me/driver call is still in flight and the role alone doesn't say "driver". */
  pending: boolean
  /** Labor is in the drawer. */
  canSeeLabor: boolean
  /** Operations without a driver identity: Labor + Messages only. */
  operationsOnly: boolean
}

export function laborAccessFor(input: {
  roleNames: readonly string[] | null | undefined
  driverId: number | null
  mappingResolved: boolean
  mappingFailed?: boolean
}): LaborAccess {
  const hasDriverRole = (input.roleNames ?? []).includes('driver')
  const isDriver = hasDriverRole || input.driverId != null
  const isOperations = hasOperationsRole(input.roleNames)
  // The role alone already answers "is a driver"; otherwise trust only a
  // mapping call that succeeded.
  const resolved = isDriver || (input.mappingResolved && !input.mappingFailed)
  return {
    isDriver,
    isOperations,
    resolved,
    pending: !isDriver && !input.mappingResolved,
    canSeeLabor: isDriver || isOperations,
    operationsOnly: isOperations && !isDriver && resolved,
  }
}

export function useLaborAccess(): LaborAccess {
  const { session } = useAuth()
  const { driverId, mappingResolved, mappingFailed } = useTrips()
  return laborAccessFor({
    roleNames: session?.roleNames,
    driverId,
    mappingResolved,
    mappingFailed,
  })
}
