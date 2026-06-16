// ---------------------------------------------------------------------------
// Declarative Integration Validation — the CANONICAL ORDER model.
//
// This is our clean, integration-agnostic representation of an order/trip. The
// anti-corruption layer (the per-integration transform) translates a customer's
// payload INTO this shape; rules are evaluated against it. No integration's
// field names or quirks leak in here — that is the whole point.
//
// POC scope: the trip subset the longhaul behavioral guards actually need
// (status, driver, shipments, activities). Deliberately NOT the full longhaul
// schema — see plans/in-progress/declarative-integration-validation-poc.md
// (Open Question #4).
//
// The Zod schema doubles as the STRUCTURAL CONTRACT: `canonicalOrderJsonSchema`
// exports it as JSON Schema, which seeds the future AI loop's ground truth.
// ---------------------------------------------------------------------------

import { z } from 'zod'

export const CanonicalActivitySchema = z.object({
  /** The shipment this activity belongs to. */
  orderNum: z.number().nullable(),
  /** Activity-type code (e.g. load/deliver). Matches LongDistanceDispatchActivity.ActivityType_code. */
  typeCode: z.string().nullable(),
  /** ISO date the activity actually occurred, or null if not yet actualized. */
  actualDate: z.string().nullable(),
})

export const CanonicalShipmentSchema = z.object({
  orderNum: z.number().nullable(),
})

export const CanonicalOrderSchema = z.object({
  /** Trip id; null for a not-yet-persisted (create) order. */
  id: z.number().nullable(),
  status: z.object({
    /** Numeric trip status (1 = pending, ≥4 = in-progress, ≥5 = finalized). */
    id: z.number(),
    name: z.string().nullable(),
  }),
  driver: z
    .object({
      id: z.number().nullable(),
    })
    .nullable(),
  dispatcher: z
    .object({
      code: z.string().nullable(),
    })
    .nullable(),
  shipments: z.array(CanonicalShipmentSchema),
  activities: z.array(CanonicalActivitySchema),
})

export type CanonicalOrder = z.infer<typeof CanonicalOrderSchema>
export type CanonicalActivity = z.infer<typeof CanonicalActivitySchema>

/**
 * The structural contract as JSON Schema. Computed lazily (Zod 4
 * `z.toJSONSchema`) so a Zod/JSON-Schema incompatibility surfaces only when a
 * caller actually asks for it (the contract test), never at import time.
 */
export function canonicalOrderJsonSchema(): unknown {
  return z.toJSONSchema(CanonicalOrderSchema)
}
