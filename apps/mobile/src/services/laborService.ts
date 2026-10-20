import type { ExportCrew } from '@pegasus/domain'
import { getApiClient } from '../api/client'
import type {
  LaborAddOutcome,
  LaborCrew,
  LaborCrewDetail,
  LaborImportResult,
  LaborPacker,
  LaborPackerInput,
  LaborPlace,
  LaborSearchLocation,
  LaborSearchResult,
} from '../types/labor'

// ---------------------------------------------------------------------------
// Labor service — the driver's private book of cash-labor crews, over
// /api/v1/labor. A crew is addressed by its phone number; the API accepts any
// spelling of it, but the app always sends the E.164 form it was given.
// ---------------------------------------------------------------------------

const BASE = '/api/v1/labor'

const crewPath = (phone: string) => `${BASE}/crews/${encodeURIComponent(phone)}`

const json = (method: string, body: unknown): RequestInit => ({
  method,
  body: JSON.stringify(body),
})

/**
 * `fetch` that keeps the envelope's `meta`. ApiClient.fetch returns only
 * `data`, and the labor API puts the search location and the add outcome in
 * `meta`. fetchPaginated returns the whole envelope; only its meta typing is
 * pagination-specific, so it is re-typed here.
 */
async function fetchWithMeta<T, M>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; meta: M }> {
  const res = await getApiClient().fetchPaginated<unknown>(path, init)
  return res as unknown as { data: T; meta: M }
}

export class LaborService {
  /**
   * My crews. Empty `q`: A–Z. A ZIP, postal code or "City, ST": nearest first.
   * A state/province: crews serving it. Other text: name/nickname/phone match.
   */
  static async searchCrews(q: string): Promise<LaborSearchResult> {
    const query = q.trim()
    const path = query ? `${BASE}/crews?q=${encodeURIComponent(query)}` : `${BASE}/crews`
    const res = await fetchWithMeta<
      LaborCrew[],
      { location: LaborSearchLocation | null; locationNotFound?: boolean }
    >(path)
    return {
      crews: res.data ?? [],
      location: res.meta?.location ?? null,
      locationNotFound: res.meta?.locationNotFound === true,
    }
  }

  static async addCrew(input: {
    phone: string
    name: string
    email?: string | null
    nickname?: string | null
  }): Promise<{ crew: LaborCrewDetail; outcome: LaborAddOutcome }> {
    const res = await fetchWithMeta<LaborCrewDetail, { outcome: LaborAddOutcome }>(
      `${BASE}/crews`,
      json('POST', input),
    )
    return { crew: res.data, outcome: res.meta.outcome }
  }

  static async importCrews(
    crews: ReadonlyArray<{ phone: string; name: string; email?: string | null }>,
  ): Promise<LaborImportResult[]> {
    return getApiClient().fetch<LaborImportResult[]>(
      `${BASE}/crews/import`,
      json('POST', { crews }),
    )
  }

  static async getCrew(phone: string): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(crewPath(phone))
  }

  /** `name` and `email` are shared with every linked driver; `nickname` is mine. */
  static async updateCrew(
    phone: string,
    patch: { name?: string; email?: string | null; nickname?: string | null },
  ): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(crewPath(phone), json('PATCH', patch))
  }

  /** Removes the crew from MY list only — the shared record stays for others. */
  static async removeCrew(phone: string): Promise<void> {
    await getApiClient().fetch<null>(crewPath(phone), { method: 'DELETE' })
  }

  static async setServiceAreas(
    phone: string,
    serviceAreas: ReadonlyArray<{ city: string; region: string }>,
  ): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(
      `${crewPath(phone)}/service-areas`,
      json('PUT', { serviceAreas }),
    )
  }

  static async addPacker(phone: string, input: LaborPackerInput): Promise<LaborPacker> {
    return getApiClient().fetch<LaborPacker>(`${crewPath(phone)}/packers`, json('POST', input))
  }

  static async updatePacker(
    phone: string,
    id: string,
    input: Partial<LaborPackerInput>,
  ): Promise<LaborPacker> {
    return getApiClient().fetch<LaborPacker>(
      `${crewPath(phone)}/packers/${encodeURIComponent(id)}`,
      json('PATCH', input),
    )
  }

  static async deletePacker(phone: string, id: string): Promise<void> {
    await getApiClient().fetch<null>(`${crewPath(phone)}/packers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  static async rateCrew(
    phone: string,
    rating: { stars: number; comment?: string | null },
  ): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(`${crewPath(phone)}/rating`, json('PUT', rating))
  }

  static async clearRating(phone: string): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(`${crewPath(phone)}/rating`, {
      method: 'DELETE',
    })
  }

  /** City typeahead (US + Canada): "spring" or "spring, mo"; two letters minimum. */
  static async searchPlaces(q: string): Promise<LaborPlace[]> {
    if (q.trim().length < 2) return []
    const rows = await getApiClient().fetch<LaborPlace[]>(
      `${BASE}/places?q=${encodeURIComponent(q.trim())}`,
    )
    return rows ?? []
  }

  /** Everything in my list, in the shape the domain's vCard/CSV renderers take. */
  static async getExport(): Promise<ExportCrew[]> {
    const rows = await getApiClient().fetch<ExportCrew[]>(`${BASE}/export`)
    return rows ?? []
  }
}
