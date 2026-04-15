import type { DriverMetrics } from '../types'

export async function getDriverMetrics(): Promise<DriverMetrics> {
  await new Promise((resolve) => setTimeout(resolve, 150))
  return {
    accountBalance: 2847.5,
    activeShipments: 3,
    pendingSettlementTotal: 1240.0,
    completedThisWeek: 7,
    milesThisWeek: 1284,
  }
}
