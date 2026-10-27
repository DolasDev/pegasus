import { getApiClient } from '../api/client'
import type { ItineraryItem, ItineraryMeta, ItineraryResponse } from '../types/itinerary'

// ---------------------------------------------------------------------------
// Itinerary service — the driver's longhaul activities and local dispatch job
// acts as one dated list (`GET /onprem/longhaul/me/itinerary`). The API resolves
// the caller's own driver ids; a login with neither mapped gets 403
// DRIVER_NOT_MAPPED, which the screen shows as the onboarding state.
// ---------------------------------------------------------------------------

/** The API's inclusive range limit. */
export const MAX_RANGE_DAYS = 31

export class ItineraryService {
  /** `from` / `to` are inclusive `YYYY-MM-DD` days, at most 31 days apart. */
  static async getMyItinerary(from: string, to: string): Promise<ItineraryResponse> {
    const client = getApiClient()
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    // fetchPaginated keeps `meta` (plain fetch drops it); the itinerary's meta
    // is its own shape, not PaginationMeta.
    const res = await client.fetchPaginated<ItineraryItem>(
      `/api/v1/onprem/longhaul/me/itinerary?${qs}`,
    )
    const meta = res.meta as unknown as Partial<ItineraryMeta> | undefined
    return {
      items: res.data ?? [],
      meta: {
        count: meta?.count ?? res.data?.length ?? 0,
        from: meta?.from ?? from,
        to: meta?.to ?? to,
        failedSources: meta?.failedSources ?? [],
      },
    }
  }
}
