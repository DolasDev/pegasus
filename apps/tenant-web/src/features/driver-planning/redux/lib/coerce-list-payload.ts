/**
 * Coerce a possibly-null/undefined fetched list payload into a real array.
 *
 * The on-prem bridge can intermittently return `null`/`undefined` instead of
 * `[]` for reference-data endpoints (e.g. `/trip-statuses`, `/states`,
 * `/drivers`). Reducers that assign the payload straight to state and
 * consumers that `.map`/`.concat` off it crash when the slice is undefined —
 * which is what triggered the Trips error boundary class of regressions in
 * the longhaul port.
 *
 * Pipe every `fetch*Success` reducer's payload through this on the way into
 * state to keep that crash class extinct.
 */
export function coerceListPayload<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : []
}
