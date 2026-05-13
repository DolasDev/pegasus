import { notifyError } from '../../components/Snackbar/notify'

export type FetchFn = (op: string, ...args: unknown[]) => Promise<unknown>

/**
 * Wraps a fetch call with a reshape pass and an error fallback:
 *
 *   - happy path: returns `reshape(await fetch(op, ...args))`.
 *   - on throw:   `notifyError(err.message)` is called and `fallback` is
 *                 returned. Failures are surfaced to the user, but a list
 *                 view that can't load doesn't crash the module.
 *
 * Used by API surface methods (e.g. `fetchShipments`) where:
 *   - the on-prem bridge can hiccup, and
 *   - the consuming UI is happier rendering "no rows" than throwing into the
 *     error boundary.
 *
 * Methods that intentionally surface errors to the caller (e.g. `fetchTrip`
 * on the trip-detail page where the error boundary IS the UX) should bypass
 * this helper and call the fetch primitive directly.
 *
 * `fetch` is passed in to keep the helper trivially unit-testable and avoid
 * an import cycle with the `API` surface module.
 */
export async function fetchAndReshape<T>(
  fetch: FetchFn,
  op: string,
  args: unknown[],
  reshape: (raw: unknown) => T,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fetch(op, ...args)
    return reshape(raw)
  } catch (e) {
    notifyError((e as { message?: string })?.message ?? String(e))
    return fallback
  }
}
