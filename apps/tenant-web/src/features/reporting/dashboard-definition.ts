// ---------------------------------------------------------------------------
// DashboardDefinition -- the portable dashboard document.
//
// This is the single most important shape in phase 1, because phase 2 makes
// dashboards PUBLISHABLE and REUSABLE: a definition authored by one tenant (or
// by the platform tenant, GLOBAL) can be forked and rendered by another. That
// makes a definition a portable document, not a local constant.
//
// Consequences baked in here:
//
//   * `datasetVersion` per widget. Reuse turns dataset identity into a
//     cross-tenant contract -- a GLOBAL dashboard forked by twenty tenants
//     breaks in all of them if a dataset's columns move. Recording the version a
//     widget was authored against lets phase 2 detect drift and warn, instead of
//     silently rendering an empty chart.
//
//   * `schemaVersion` on the document itself, so a stored row from an older
//     release is recognizable rather than mysteriously invalid.
//
//   * Parsed, never trusted. In phase 1 the input is a local constant; in phase
//     2 it is a JSON column. Validating in BOTH cases means the substitution
//     changes only where the JSON comes from -- see the round-trip test.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** How a widget renders its dataset's rows. */
export const WidgetKindSchema = z.enum(['scalar', 'bar', 'line', 'table'])
export type WidgetKind = z.infer<typeof WidgetKindSchema>

export const DashboardWidgetSchema = z.object({
  /** Dataset id from GET /reporting/datasets. Permanent public identifier. */
  datasetId: z.string().min(1),
  /** The dataset version this widget was authored against (drift detection). */
  datasetVersion: z.number().int().positive(),
  /** Validated server-side against that dataset's own schema. */
  params: z.record(z.string(), z.unknown()).optional(),
  widget: WidgetKindSchema,
  title: z.string().min(1),
  /** Grid columns out of 4. */
  span: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
})

export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>

export const DashboardDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  widgets: z.array(DashboardWidgetSchema).min(1).max(12),
})

export type DashboardDefinition = z.infer<typeof DashboardDefinitionSchema>

/**
 * Parse a definition from unknown input, throwing on an invalid document.
 *
 * Phase 1 calls this on a code constant at module load, so a malformed built-in
 * fails a unit test rather than production. Phase 2 calls the exact same
 * function on a Postgres row. That is the whole substitution.
 */
export function parseDashboardDefinition(input: unknown): DashboardDefinition {
  return DashboardDefinitionSchema.parse(input)
}

/** Request payload for POST /reporting/query, derived from a definition. */
export function toQueryRequests(
  def: DashboardDefinition,
): { datasetId: string; params?: Record<string, unknown> }[] {
  return def.widgets.map((w) =>
    w.params ? { datasetId: w.datasetId, params: w.params } : { datasetId: w.datasetId },
  )
}
