// ---------------------------------------------------------------------------
// Reporting dataset registry.
//
// The single source of truth for which datasets exist. Both endpoints resolve
// through here, so a dataset that is not registered is unreachable -- there is
// no path by which a client names arbitrary SQL or an unregistered id.
//
// Catalog filtering is done against a permission STRING SET obtained from one
// `listAllowedPermissions()` call (a single batched AVP round trip, the same
// thing GET /me/permissions does) rather than N `authorize()` calls. Our
// datasets are coarse-grained -- they authorize against the per-tenant catch-all
// resource id -- so the batched form is exactly equivalent and far cheaper.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { DatasetCatalogEntry, DatasetDef } from './types'
import { movesByStatus } from './datasets/moves-by-status'
import { invoicesOutstanding } from './datasets/invoices-outstanding'
import { quotesConversion30d } from './datasets/quotes-conversion-30d'
import { longhaulNewOrdersYtd } from './datasets/longhaul-new-orders-ytd'
import { longhaulInTransit } from './datasets/longhaul-in-transit'
import { longhaulInvoicedYtd } from './datasets/longhaul-invoiced-ytd'

/**
 * Every registered dataset. Order is the catalog's display order.
 *
 * `as DatasetDef[]` widens the individually-parameterized defs to the union;
 * each element keeps its own param type internally, and the handler re-validates
 * through `def.params` before ever calling `run`/`sql`.
 */
const DATASETS: readonly DatasetDef[] = Object.freeze([
  movesByStatus,
  invoicesOutstanding,
  quotesConversion30d,
  longhaulNewOrdersYtd,
  longhaulInTransit,
  longhaulInvoicedYtd,
] as DatasetDef[])

const BY_ID: ReadonlyMap<string, DatasetDef> = new Map(DATASETS.map((d) => [d.id, d]))

/** All registered datasets, unfiltered. Tests and the catalog builder use this. */
export function allDatasets(): readonly DatasetDef[] {
  return DATASETS
}

/** Look up a dataset by its public id. Undefined for an unknown id. */
export function datasetById(id: string): DatasetDef | undefined {
  return BY_ID.get(id)
}

/**
 * True iff the caller may run this dataset: they must hold the dataset's own
 * `requires` action. The surface-level `ReadReportingDataset` check is separate
 * (route middleware) -- both gates must pass.
 */
export function canRunDataset(def: DatasetDef, permissions: ReadonlySet<string>): boolean {
  return permissions.has(def.requires.permission)
}

/** Public catalog for a caller, filtered to what their grants already allow. */
export function catalogFor(permissions: ReadonlySet<string>): DatasetCatalogEntry[] {
  return DATASETS.filter((d) => canRunDataset(d, permissions)).map(toCatalogEntry)
}

export function toCatalogEntry(def: DatasetDef): DatasetCatalogEntry {
  return {
    id: def.id,
    version: def.version,
    title: def.title,
    description: def.description,
    source: def.source,
    permission: def.requires.permission,
    columns: def.columns,
    // Rendered so a client can construct a valid request without this repo.
    paramsSchema: z.toJSONSchema(def.params),
  }
}
