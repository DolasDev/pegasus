// DriverGateway — a driver's money, read from the tenant's on-prem system
// (pegII `Pegasus.Api`). No cloud/Postgres alternative exists.

export interface DriverFinancials {
  /** `sp_DrvDailyBalance` formula; null when the driver has no YTD row this month. */
  runningBalance: number | null
  /** `sp_DrvRetainerPaid` formula; null when the driver has no `drivers` row. */
  escrowHeld: number | null
  /** Previous calendar month's closing balance; null when no such row. */
  monthEnd: { year: number; month: number; balance: number } | null
  /** Posted settlements not yet paid out. */
  pendingSettlement: { total: number; count: number }
}

export interface DriverGateway {
  getFinancials(driverId: number): Promise<DriverFinancials>
}
