import type { ExportCrew } from '@pegasus/domain'
import { getApiClient } from '../api/client'
import type {
  LaborActivity,
  LaborActivityCrewInput,
  LaborAddOutcome,
  LaborCrew,
  LaborCompanyAddOutcome,
  LaborCrewDetail,
  LaborImportResult,
  LaborPacker,
  LaborPackerInput,
  LaborPlace,
  LaborSearchLocation,
  LaborSearchResult,
  MyCrewMember,
  MyCrewMemberInput,
} from '../types/labor'

// ---------------------------------------------------------------------------
// Labor service — the driver's private book of cash-labor crews and the
// company's shared list, plus My Crew (the driver's own packers), over
// /api/v1/labor. A crew is addressed by its phone
// number; the API accepts any spelling of it, but the app always sends the
// E.164 form it was given.
// ---------------------------------------------------------------------------

const BASE = '/api/v1/labor'

const crewPath = (phone: string) => `${BASE}/crews/${encodeURIComponent(phone)}`
const companyCrewPath = (phone: string) => `${BASE}/company/crews/${encodeURIComponent(phone)}`

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

async function searchAt(base: string, q: string): Promise<LaborSearchResult> {
  const query = q.trim()
  const path = query ? `${base}?q=${encodeURIComponent(query)}` : base
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

export class LaborService {
  /**
   * My crews. Empty `q`: A–Z. A ZIP, postal code or "City, ST": nearest first.
   * A state/province: crews serving it. Other text: name/nickname/phone match.
   */
  static async searchCrews(q: string): Promise<LaborSearchResult> {
    return searchAt(`${BASE}/crews`, q)
  }

  /** The company's shared list; same search semantics as {@link searchCrews}. */
  static async searchCompanyCrews(q: string): Promise<LaborSearchResult> {
    return searchAt(`${BASE}/company/crews`, q)
  }

  /**
   * Puts a crew on the company list. From a crew in my own list send just the
   * phone; Operations may also create a brand-new crew (`name` required then).
   * A non-Operations caller whose list lacks the crew gets 422.
   */
  static async addToCompanyList(
    phone: string,
    extras: { name?: string; email?: string | null; nickname?: string | null } = {},
  ): Promise<{ crew: LaborCrewDetail; outcome: LaborCompanyAddOutcome }> {
    const res = await fetchWithMeta<LaborCrewDetail, { outcome: LaborCompanyAddOutcome }>(
      `${BASE}/company/crews`,
      json('POST', { phone, ...extras }),
    )
    return { crew: res.data, outcome: res.meta.outcome }
  }

  /** `nickname` is the company display name; `name` and `email` are shared with everyone. */
  static async updateCompanyCrew(
    phone: string,
    patch: { name?: string; email?: string | null; nickname?: string | null },
  ): Promise<LaborCrewDetail> {
    return getApiClient().fetch<LaborCrewDetail>(companyCrewPath(phone), json('PATCH', patch))
  }

  /** Operations only: takes the crew off the company list (the crew record stays). */
  static async removeFromCompanyList(phone: string): Promise<void> {
    await getApiClient().fetch<null>(companyCrewPath(phone), { method: 'DELETE' })
  }

  static async addToMyList(crew: { phone: string; name: string }): Promise<LaborCrewDetail> {
    return (await LaborService.addCrew({ phone: crew.phone, name: crew.name })).crew
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

  // ── My Crew ───────────────────────────────────────────────────────────────

  static async getMyCrew(): Promise<MyCrewMember[]> {
    const rows = await getApiClient().fetch<MyCrewMember[]>(`${BASE}/my-crew`)
    return rows ?? []
  }

  static async addMyCrewMember(input: MyCrewMemberInput): Promise<MyCrewMember> {
    return getApiClient().fetch<MyCrewMember>(`${BASE}/my-crew`, json('POST', input))
  }

  static async updateMyCrewMember(
    id: string,
    input: Partial<MyCrewMemberInput>,
  ): Promise<MyCrewMember> {
    return getApiClient().fetch<MyCrewMember>(
      `${BASE}/my-crew/${encodeURIComponent(id)}`,
      json('PATCH', input),
    )
  }

  /** Off My Crew; they stay on the jobs they worked. */
  static async removeMyCrewMember(id: string): Promise<void> {
    await getApiClient().fetch<null>(`${BASE}/my-crew/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  // ── Activity labor ────────────────────────────────────────────────────────

  /** My activities on an order (every activity, read-only, for an employee). */
  static async getOrderActivities(orderNum: string | number): Promise<LaborActivity[]> {
    const rows = await getApiClient().fetch<LaborActivity[]>(
      `${BASE}/orders/${encodeURIComponent(String(orderNum))}/activities`,
    )
    return rows ?? []
  }

  /**
   * Replaces the activity's whole crew + packer set, and its My Crew members
   * when `memberIds` is given (omitted = left as they are).
   */
  static async setActivityLabor(
    activityId: number,
    crews: readonly LaborActivityCrewInput[],
    memberIds?: readonly string[],
  ): Promise<LaborActivity> {
    return getApiClient().fetch<LaborActivity>(
      `${BASE}/activities/${activityId}`,
      json('PUT', memberIds ? { crews, memberIds } : { crews }),
    )
  }

  /**
   * Read-modify-write one activity's set — for the screens pushed from the
   * Labor tab (crew picker, new crew, new packer), which hold only ids.
   */
  static async updateActivityLabor(
    orderNum: string | number,
    activityId: number,
    change: (crews: LaborActivityCrewInput[]) => LaborActivityCrewInput[],
  ): Promise<LaborActivity> {
    const activity = (await LaborService.getOrderActivities(orderNum)).find(
      (a) => a.id === activityId,
    )
    if (!activity) throw new Error('This activity is no longer assigned to you.')
    return LaborService.setActivityLabor(activityId, change(activityLaborInput(activity)))
  }

  /** The same read-modify-write for the activity's My Crew members. */
  static async updateActivityMembers(
    orderNum: string | number,
    activityId: number,
    change: (memberIds: string[]) => string[],
  ): Promise<LaborActivity> {
    const activity = (await LaborService.getOrderActivities(orderNum)).find(
      (a) => a.id === activityId,
    )
    if (!activity) throw new Error('This activity is no longer assigned to you.')
    return LaborService.setActivityLabor(
      activityId,
      activityLaborInput(activity),
      change(activityMemberIds(activity)),
    )
  }
}

// ── Activity-labor set helpers (pure) ────────────────────────────────────────

/** The PUT body that leaves `activity` as it is. */
export function activityLaborInput(activity: LaborActivity): LaborActivityCrewInput[] {
  return activity.crews.map((c) => ({
    phone: c.phone,
    packerIds: c.packers.filter((p) => p.selected).map((p) => p.id),
  }))
}

/** The My Crew members who worked `activity`. */
export function activityMemberIds(activity: LaborActivity): string[] {
  return (activity.myCrew ?? []).filter((m) => m.selected).map((m) => m.id)
}

/** Ticks (`on`) or unticks one My Crew member. */
export function withMember(memberIds: string[], id: string, on: boolean): string[] {
  const rest = memberIds.filter((x) => x !== id)
  return on ? [...rest, id] : rest
}

/** Adds a crew (no packers yet); a crew already on the activity is left as is. */
export function withCrew(crews: LaborActivityCrewInput[], phone: string): LaborActivityCrewInput[] {
  return crews.some((c) => c.phone === phone) ? crews : [...crews, { phone, packerIds: [] }]
}

export function withoutCrew(
  crews: LaborActivityCrewInput[],
  phone: string,
): LaborActivityCrewInput[] {
  return crews.filter((c) => c.phone !== phone)
}

/** Selects (`on`) or clears one packer on one crew. */
export function withPacker(
  crews: LaborActivityCrewInput[],
  phone: string,
  packerId: string,
  on: boolean,
): LaborActivityCrewInput[] {
  return crews.map((c) => {
    if (c.phone !== phone) return c
    const rest = c.packerIds.filter((id) => id !== packerId)
    return { ...c, packerIds: on ? [...rest, packerId] : rest }
  })
}
