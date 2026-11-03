import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiFetchPaginated } from '@/api/client'

// ---------------------------------------------------------------------------
// Operations → Labor: the tenant's COMPANY crew list (/api/v1/labor/company/*)
// plus the shared crew routes it reuses (/api/v1/labor/crews/:phone/*).
//
// A crew is a platform-wide record keyed by its E.164 phone: name, email,
// service areas and packers are shared with every tenant that has the number.
// What is the tenant's own is `companyNickname`, the display name on the list.
// Mirrors apps/api/src/handlers/labor.ts (crewDto / packerDto).
// ---------------------------------------------------------------------------

export interface LaborServiceArea {
  id: string
  city: string
  region: string
  country: string
  geocoded: boolean
}

export interface LaborCrew {
  /** E.164, the crew's identity. */
  phone: string
  phoneDisplay: string
  /** Shared platform-wide name. */
  name: string
  /** The caller's PRIVATE nickname; usually null on the company screen. */
  nickname: string | null
  /** This tenant's display name for the crew. */
  companyNickname: string | null
  displayName: string
  email: string | null
  serviceAreas: LaborServiceArea[]
  packerCount: number
  myRating: { stars: number; comment: string | null; updatedAt: string } | null
  averageRating: { average: number; count: number } | null
  addedAt: string
  inMyList: boolean
  inCompanyList: boolean
  canRemoveFromCompany: boolean
  /** Only on a location search; null = no geocoded service area. */
  distanceMiles?: number | null
}

export interface LaborPacker {
  id: string
  firstName: string
  lastName: string
  email: string | null
  cidNumber: string | null
  /** YYYY-MM-DD. */
  cidIssuedOn: string | null
  phone: string | null
  phoneDisplay: string | null
  updatedAt: string
}

export interface LaborCrewDetail extends LaborCrew {
  packers: LaborPacker[]
}

export interface LaborSearchMeta {
  location?: { label: string; [k: string]: unknown } | null
  locationNotFound?: boolean
}

export interface LaborPlace {
  city: string
  region: string
  country: string
}

export type CreateOutcome = 'added' | 'linkedExisting' | 'addedFromMyList' | 'alreadyInList'

export interface NewCompanyCrewInput {
  phone: string
  name: string
  email?: string
  /** The company display name. */
  nickname?: string
}

export interface UpdateCompanyCrewInput {
  name?: string
  email?: string | null
  /** The company display name; null clears it. */
  nickname?: string | null
}

export interface PackerInput {
  firstName: string
  lastName: string
  email?: string | null
  cidNumber?: string | null
  cidIssuedOn?: string | null
  phone?: string | null
}

const BASE = '/api/v1/labor'
const crewPath = (phone: string) => `${BASE}/crews/${encodeURIComponent(phone)}`
const companyCrewPath = (phone: string) => `${BASE}/company/crews/${encodeURIComponent(phone)}`

export const laborKeys = {
  all: ['labor-company'] as const,
  list: (q: string) => [...laborKeys.all, 'list', q] as const,
  detail: (phone: string) => [...laborKeys.all, 'detail', phone] as const,
  places: (q: string) => [...laborKeys.all, 'places', q] as const,
}

export const companyCrewsQueryOptions = (q: string) =>
  queryOptions({
    queryKey: laborKeys.list(q),
    queryFn: async () => {
      // The envelope is `{ data, meta }`, but meta is the search's location,
      // not pagination — the paginated fetch is just the one that keeps it.
      const res = await apiFetchPaginated<LaborCrew>(
        `${BASE}/company/crews?q=${encodeURIComponent(q)}`,
      )
      return { crews: res.data, meta: res.meta as unknown as LaborSearchMeta }
    },
  })

export const crewDetailQueryOptions = (phone: string) =>
  queryOptions({
    queryKey: laborKeys.detail(phone),
    queryFn: () => apiFetch<LaborCrewDetail>(crewPath(phone)),
  })

export const placesQueryOptions = (q: string) =>
  queryOptions({
    queryKey: laborKeys.places(q),
    queryFn: () => apiFetch<LaborPlace[]>(`${BASE}/places?q=${encodeURIComponent(q)}`),
    staleTime: 5 * 60_000,
  })

function useInvalidateAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: laborKeys.all })
}

/** POST /company/crews. The outcome rides in `meta`, which `apiFetch` drops. */
export function useCreateCompanyCrew() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: async (input: NewCompanyCrewInput) => {
      const res = await apiFetchPaginated<LaborCrewDetail>(`${BASE}/company/crews`, {
        method: 'POST',
        body: JSON.stringify(input),
      })
      const crew = res.data as unknown as LaborCrewDetail
      const outcome = (res.meta as unknown as { outcome: CreateOutcome }).outcome
      return { crew, outcome }
    },
    onSuccess: invalidate,
  })
}

export function useUpdateCompanyCrew(phone: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: UpdateCompanyCrewInput) =>
      apiFetch<LaborCrewDetail>(companyCrewPath(phone), {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  })
}

export function useRemoveCompanyCrew() {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (phone: string) => apiFetch<null>(companyCrewPath(phone), { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}

export function useSaveServiceAreas(phone: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (serviceAreas: { city: string; region: string }[]) =>
      apiFetch<LaborCrewDetail>(`${crewPath(phone)}/service-areas`, {
        method: 'PUT',
        body: JSON.stringify({ serviceAreas }),
      }),
    onSuccess: invalidate,
  })
}

export function useAddPacker(phone: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (input: PackerInput) =>
      apiFetch<LaborPacker>(`${crewPath(phone)}/packers`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  })
}

export function useUpdatePacker(phone: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: ({ id, ...input }: PackerInput & { id: string }) =>
      apiFetch<LaborPacker>(`${crewPath(phone)}/packers/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  })
}

export function useDeletePacker(phone: string) {
  const invalidate = useInvalidateAll()
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`${crewPath(phone)}/packers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
