import { adminFetch } from './client'
import type {
  Zip3Entry,
  ServiceAreaEntry,
  LinehaulRateEntry,
  ShorthaulRateEntry,
  PackRateEntry,
  UnpackRateEntry,
} from '@/lib/parse-400ng-xlsx'

// ---------------------------------------------------------------------------
// Types (mirror apps/api/src/handlers/admin/tariffs.ts + rating/import-schema.ts)
// ---------------------------------------------------------------------------

export type TariffVersionStatus = 'STAGED' | 'ACTIVE' | 'SUPERSEDED'

export interface TariffVersionCounts {
  zip3s: number
  serviceAreas: number
  linehaulRates: number
  shorthaulRates: number
  packRates: number
  unpackRates: number
}

export interface TariffVersionSummary {
  id: string
  tariffCode: string
  label: string
  /** ISO 8601 — serialised by Prisma/JSON.stringify. */
  effectiveFrom: string
  effectiveTo: string
  status: TariffVersionStatus
  sourceChecksum: string
  importedBy: string | null
  counts: TariffVersionCounts
}

/** The canonical import document — matches Tariff400ngImportSchema on the API. */
export interface Tariff400ngImportDoc {
  schemaVersion: 1
  tariffCode: '400NG'
  label: string
  /** ISO 8601 datetime. */
  effectiveFrom: string
  effectiveTo: string
  zip3s: Zip3Entry[]
  serviceAreas: ServiceAreaEntry[]
  linehaulRates: LinehaulRateEntry[]
  shorthaulRates: ShorthaulRateEntry[]
  packRates: PackRateEntry[]
  unpackRates: UnpackRateEntry[]
}

export interface ImportResult {
  id: string
  status: TariffVersionStatus
  /** false when an identical document was already imported (checksum-idempotent no-op). */
  created: boolean
}

export interface ActivateResult {
  id: string
  status: TariffVersionStatus
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export async function listTariffVersions(tariffCode?: string): Promise<TariffVersionSummary[]> {
  const query = tariffCode ? `?tariffCode=${encodeURIComponent(tariffCode)}` : ''
  return adminFetch<TariffVersionSummary[]>(`/api/admin/tariffs${query}`)
}

export async function getTariffVersion(id: string): Promise<TariffVersionSummary> {
  return adminFetch<TariffVersionSummary>(`/api/admin/tariffs/${id}`)
}

export async function importTariff(doc: Tariff400ngImportDoc): Promise<ImportResult> {
  return adminFetch<ImportResult>('/api/admin/tariffs/import', {
    method: 'POST',
    body: JSON.stringify(doc),
  })
}

export async function activateTariffVersion(id: string): Promise<ActivateResult> {
  return adminFetch<ActivateResult>(`/api/admin/tariffs/${id}/activate`, { method: 'POST' })
}
