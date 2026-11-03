import { getApiClient } from '../api/client'
import type { ItineraryItem, ItineraryMeta, ItineraryResponse } from '../types/itinerary'

const ACTS = '/api/v1/onprem/longhaul/me/itinerary/acts'

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

  /**
   * Post (or clear, with `eta: null`) the driver's ETA for one act. `day` is the
   * item's listed day — the server re-reads that day to confirm the act is the
   * caller's. Not for a trip activity: its ETA has the trip screen's editor
   * (the server answers 409 USE_ACTIVITY_ETA).
   */
  static async setEta(
    item: Pick<ItineraryItem, 'key' | 'day'>,
    eta: { day: string; window: { start: string; end: string } | null } | null,
  ): Promise<ItineraryItem> {
    return getApiClient().fetch<ItineraryItem>(`${ACTS}/eta`, {
      method: 'PUT',
      body: JSON.stringify({ key: item.key, day: item.day, eta }),
    })
  }

  /** Mark one act done on `done` (a day), or clear it with null. */
  static async setDone(
    item: Pick<ItineraryItem, 'key' | 'day'>,
    done: string | null,
  ): Promise<ItineraryItem> {
    return getApiClient().fetch<ItineraryItem>(`${ACTS}/done`, {
      method: 'PUT',
      body: JSON.stringify({ key: item.key, day: item.day, done }),
    })
  }
}
