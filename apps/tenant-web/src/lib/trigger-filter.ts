// ---------------------------------------------------------------------------
// Client-side validation for EVENT-trigger filters (Phase 3 Unit 5).
//
// The dispatcher's v1 filter contract (apps/api/src/lambda-dispatch-workflow-
// triggers.ts, Unit 3): shallow top-level strict equality, scalars only —
// every filter key must exactly equal the same key in the event payload.
// An empty/absent filter matches every event of the subscribed type.
//
// The server only enforces "plain JSON object" at create time; nested values
// would be stored but can never match (strict equality against a payload
// scalar). We reject them client-side so users don't create dead triggers.
// ---------------------------------------------------------------------------

export type TriggerFilterValidation =
  | {
      ok: true
      /** The parsed filter, or undefined when empty (= match-all; omit from the request). */
      filter: Record<string, unknown> | undefined
    }
  | { ok: false; error: string }

/**
 * Parses + validates the filter textarea contents. Empty text and `{}` are
 * valid and mean "match every event" (returned as `undefined` so callers omit
 * the field from the create request).
 */
export function parseTriggerFilter(text: string): TriggerFilterValidation {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, filter: undefined }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Filter must be valid JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Filter must be a JSON object (e.g. {"status": "COMPLETED"}).' }
  }

  const filter = parsed as Record<string, unknown>
  const keys = Object.keys(filter)
  if (keys.length === 0) return { ok: true, filter: undefined }

  for (const key of keys) {
    const value = filter[key]
    // Scalars only — strict equality against nested objects/arrays can never
    // match a payload value, so such a filter would silently never fire.
    if (typeof value === 'object' && value !== null) {
      return {
        ok: false,
        error: `Filter values must be scalars (string, number, boolean, or null) — "${key}" is ${
          Array.isArray(value) ? 'an array' : 'an object'
        }.`,
      }
    }
  }

  return { ok: true, filter }
}
