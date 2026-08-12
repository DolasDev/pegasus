// ---------------------------------------------------------------------------
// The dashboard document — server-side schema, versioning, and upgrade.
//
// Phase 1 shipped `schemaVersion: 1`, where a widget's geometry was a single
// `span` (1-4 columns, auto-flowed). Phase 2 adds a real grid (`layout` with
// x/y/w/h) because widgets are now dragged and resized on a canvas.
//
// v1 documents MUST keep working: the built-in dashboard is one, and any row
// written before this deploy is one. `parseDefinition` therefore UPGRADES a v1
// document instead of rejecting it — deriving x/y/w/h by flowing spans across a
// 12-column grid, which reproduces exactly what v1 rendered. `span` is retained
// on every widget so a downgrade (code rollback) still renders.
// ---------------------------------------------------------------------------

import { z } from 'zod'

export const GRID_COLUMNS = 12
/** Rows are 60px tall in the editor; a default widget is 4 rows (~240px). */
export const DEFAULT_WIDGET_H = 4

export const WidgetKindSchema = z.enum(['scalar', 'bar', 'line', 'table'])
export type WidgetKind = z.infer<typeof WidgetKindSchema>

const SpanSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])

const LayoutSchema = z.object({
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
  /** The dataset version this widget was authored against — the drift signal. */
  datasetVersion: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
  widget: WidgetKindSchema,
  title: z.string().min(1).max(120),
  /** Retained from v1 so a rollback still renders. Derived on upgrade. */
  span: SpanSchema,
})

/** A v2 widget — same as v1 plus explicit grid geometry. */
export const DashboardWidgetSchema = WidgetBase.extend({ layout: LayoutSchema })
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>

/** Matches MAX_BATCH in handlers/reporting.ts — a 13th widget would 400 at render. */
export const MAX_WIDGETS = 12

export const DashboardDefinitionSchema = z.object({
  schemaVersion: z.literal(2),
  widgets: z.array(DashboardWidgetSchema).min(1).max(MAX_WIDGETS),
})
export type DashboardDocument = z.infer<typeof DashboardDefinitionSchema>

// --- v1 -------------------------------------------------------------------

const V1Schema = z.object({
  schemaVersion: z.literal(1),
  // v1 also carried id/title/description at the document level; phase 2 promotes
  // those to real columns, so they are accepted and ignored here.
  id: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  widgets: z
    .array(WidgetBase.partial({ span: true }))
    .min(1)
    .max(MAX_WIDGETS),
})

/**
 * Flow v1 spans across the grid exactly as the v1 CSS grid did: 4 slots per
 * row (span is in units of a 4-column layout), left to right, wrapping.
 */
export function upgradeV1(doc: z.infer<typeof V1Schema>): DashboardDocument {
  const COLS_PER_SPAN_UNIT = GRID_COLUMNS / 4 // 3 grid columns per v1 span unit
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

/**
 * Parse a document of ANY supported schemaVersion into the current shape.
 * Throws (ZodError) on a document that is neither v1 nor v2.
 */
export function parseDefinition(input: unknown): DashboardDocument {
  const asV2 = DashboardDefinitionSchema.safeParse(input)
  if (asV2.success) return asV2.data

  const asV1 = V1Schema.safeParse(input)
  if (asV1.success) return upgradeV1(asV1.data)

  // Report the v2 failure — it is the shape callers are expected to send.
  throw asV2.error
}
