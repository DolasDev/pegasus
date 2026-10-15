import { ApiError } from '@pegasus/api-http'
import { getApiClient } from '../api/client'
import type { DriverMetrics } from '../types'

export type DriverMetricsResult =
  { status: 'ok'; metrics: DriverMetrics } | { status: 'not_linked' }

/**
 * Fetch the signed-in driver's dashboard metrics. A 404 DRIVER_NOT_LINKED
 * (account not mapped to a longhaul driver) is returned as `not_linked`;
 * every other failure throws.
 */
export async function getDriverMetrics(): Promise<DriverMetricsResult> {
  try {
    const metrics = await getApiClient().fetch<DriverMetrics>('/api/v1/me/driver/metrics')
    return { status: 'ok', metrics }
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && err.code === 'DRIVER_NOT_LINKED') {
      return { status: 'not_linked' }
    }
    throw err
  }
}
