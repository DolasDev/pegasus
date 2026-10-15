// ---------------------------------------------------------------------------
// pegII driver-financials DTO — the unwrapped `data` of
// `GET /api/v1/pegii/drivers/{driverId}/financials` (capability
// `pegii.drivers.financials.v1`). This file and pegii-driver.mapper.ts are the
// only places that should change if the contract shifts.
// ---------------------------------------------------------------------------

export interface PegiiDriverFinancialsDto {
  driverId?: number
  asOf?: string
  /** null when driverytdsummary has no (year, month) row for the driver. */
  runningBalance?: number | null
  /** null when the driver has no `drivers` row (crew-only / NWSUB). */
  escrowHeld?: number | null
  /** null when there is no previous-month row. */
  monthEnd?: { year?: number; month?: number; balance?: number | null } | null
  pendingSettlement?: { total?: number | null; count?: number | null } | null
}
