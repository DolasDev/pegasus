/**
 * Shared mobile app types.
 *
 * Driver-facing order/trip data now comes from the longhaul endpoints — see
 * `src/types/longhaul.ts` (LonghaulTrip / LonghaulShipment). The legacy
 * cloud-`Move` "TruckingOrder" aliases were removed when the Paperwork screen
 * was retired.
 */

/**
 * Placeholder metrics for the driver dashboard. Replace with API-backed
 * query when the backend exposes a driver stats endpoint.
 */
export interface DriverMetrics {
  accountBalance: number
  activeShipments: number
  pendingSettlementTotal: number
  completedThisWeek: number
  milesThisWeek: number
}
