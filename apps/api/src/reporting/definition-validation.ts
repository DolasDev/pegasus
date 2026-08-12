// ---------------------------------------------------------------------------
// Validate a user-authored dashboard document against the dataset registry.
//
// The document arrives from a client, so nothing in it is trusted: dataset ids
// are checked against the registry, params are re-validated through each
// dataset's OWN schema, and the caller must independently hold every referenced
// dataset's action.
//
// Dataset VERSION drift is deliberately a warning, not an error. Blocking on it
// would make a dataset version bump instantly un-publishable for every stored
// dashboard that references it — the drift signal exists to inform, not to gate.
// ---------------------------------------------------------------------------

import { canRunDataset, datasetById } from './registry'
import type { DashboardDocument } from './definition'

export interface DriftWarning {
  datasetId: string
  authoredAgainst: number
  current: number
}

export type ValidationResult =
  | { ok: true; warnings: DriftWarning[] }
  | { ok: false; status: 400 | 403; code: string; error: string }

export function validateDefinition(
  doc: DashboardDocument,
  permissions: ReadonlySet<string>,
): ValidationResult {
  const unknown: string[] = []
  const forbidden: string[] = []
  const warnings: DriftWarning[] = []

  for (const widget of doc.widgets) {
    const def = datasetById(widget.datasetId)
    if (!def) {
      unknown.push(widget.datasetId)
      continue
    }

    // Belt to the query endpoint's braces. That gate is what actually protects
    // the DATA; this one stops an author from persisting a reference to a
    // dataset they cannot read, which would otherwise let the definition itself
    // disclose which datasets exist.
    if (!canRunDataset(def, permissions)) {
      forbidden.push(widget.datasetId)
      continue
    }

    const params = def.params.safeParse(widget.params ?? undefined)
    if (!params.success) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_WIDGET_PARAMS',
        error: `Invalid params for dataset "${widget.datasetId}"`,
      }
    }

    if (widget.datasetVersion !== def.version) {
      warnings.push({
        datasetId: def.id,
        authoredAgainst: widget.datasetVersion,
        current: def.version,
      })
    }
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'UNKNOWN_DATASET',
      error: `Unknown dataset(s): ${[...new Set(unknown)].join(', ')}`,
    }
  }

  if (forbidden.length > 0) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      error: 'Forbidden: insufficient permissions for this action',
    }
  }

  return { ok: true, warnings }
}

/** Slug rule — lowercase kebab, stable, used in URLs and stored in preferences. */
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 128 && SLUG_RE.test(slug)
}
