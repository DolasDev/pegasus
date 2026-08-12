// ---------------------------------------------------------------------------
// DashboardDefinition -- the portable dashboard document (client side).
//
// Phase 1 shipped v1, where geometry was a single `span` and widgets auto-flowed
// in a 4-column CSS grid. Phase 2 adds `layout` (x/y/w/h on a 12-column grid)
// because widgets are now dragged and resized on a canvas.
//
// v1 documents MUST keep rendering: the built-in is one, and so is any row
// written before the phase-2 deploy. `parseDashboardDefinition` UPGRADES a v1
// document rather than rejecting it, deriving x/y/w/h by flowing spans exactly
// as v1 laid them out. `span` is retained on every widget so a code rollback
// still renders.
//
// This mirrors apps/api/src/reporting/definition.ts. The two are deliberately
// separate files (the repo has no shared client-types package -- see
// api/queries/*.ts), so a change to one needs the same change to the other;
// the API re-validates everything a client sends regardless.
// ---------------------------------------------------------------------------

import { z } from 'zod'

export const GRID_COLUMNS = 12
/** Grid row height in px, and the default widget height in rows. */
export const GRID_ROW_HEIGHT = 60
export const DEFAULT_WIDGET_H = 4
/** Matches the API's MAX_BATCH -- a 13th widget would 400 at render. */
export const MAX_WIDGETS = 12

export const WidgetKindSchema = z.enum(['scalar', 'bar', 'line', 'table'])
export type WidgetKind = z.infer<typeof WidgetKindSchema>

const SpanSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

export const LayoutSchema = z.object({
  x: z
    .number()
    .int()
    .min(0)
    .max(GRID_COLUMNS - 1),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(GRID_COLUMNS),
  h: z.number().int().min(1).max(24),
})
export type WidgetLayout = z.infer<typeof LayoutSchema>

const WidgetBase = z.object({
  datasetId: z.string().min(1),
  /** The dataset version this widget was authored against (drift detection). */
  datasetVersion: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
  widget: WidgetKindSchema,
  title: z.string().min(1).max(120),
  /** Retained from v1 so a rollback still renders. Derived on upgrade. */
  span: SpanSchema,
})

export const DashboardWidgetSchema = WidgetBase.extend({ layout: LayoutSchema })
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>

export const DashboardDefinitionSchema = z.object({
  schemaVersion: z.literal(2),
  widgets: z.array(DashboardWidgetSchema).min(1).max(MAX_WIDGETS),
})
export type DashboardDefinition = z.infer<typeof DashboardDefinitionSchema>

// --- v1 -------------------------------------------------------------------

const V1Schema = z.object({
  schemaVersion: z.literal(1),
  // v1 carried these at the document level; phase 2 promotes them to columns.
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  widgets: z
    .array(WidgetBase.partial({ span: true }))
    .min(1)
    .max(MAX_WIDGETS),
})

export function upgradeV1(doc: z.infer<typeof V1Schema>): DashboardDefinition {
  const COLS_PER_SPAN_UNIT = GRID_COLUMNS / 4
  let x = 0
  let y = 0

  const widgets = doc.widgets.map((w) => {
    const span = (w.span ?? 2) as z.infer<typeof SpanSchema>
    const width = span * COLS_PER_SPAN_UNIT
    if (x + width > GRID_COLUMNS) {
      x = 0
      y += DEFAULT_WIDGET_H
    }
    const layout: WidgetLayout = { x, y, w: width, h: DEFAULT_WIDGET_H }
    x += width
    return { ...w, span, layout }
  })

  return { schemaVersion: 2, widgets }
}

/** Parse a document of any supported schemaVersion into the current shape. */
export function parseDashboardDefinition(input: unknown): DashboardDefinition {
  const asV2 = DashboardDefinitionSchema.safeParse(input)
  if (asV2.success) return asV2.data

  const asV1 = V1Schema.safeParse(input)
  if (asV1.success) return upgradeV1(asV1.data)

  throw asV2.error
}

/** Request payload for POST /reporting/query, derived from a definition. */
export function toQueryRequests(
  def: DashboardDefinition,
): { datasetId: string; params?: Record<string, unknown> }[] {
  return def.widgets.map((w) =>
    w.params ? { datasetId: w.datasetId, params: w.params } : { datasetId: w.datasetId },
  )
}

/** Convert a widget's grid geometry into react-grid-layout's item shape. */
export function toGridLayout(
  widgets: readonly DashboardWidget[],
): Array<WidgetLayout & { i: string }> {
  return widgets.map((w, i) => ({ i: String(i), ...w.layout }))
}

/** Append a widget below everything else so a new card is never hidden. */
export function nextFreeRow(widgets: readonly DashboardWidget[]): number {
  return widgets.reduce((max, w) => Math.max(max, w.layout.y + w.layout.h), 0)
}
