/**
 * Converts a string to start case (capitalizes the first letter of each word).
 * Replacement for lodash/startCase.
 */
export function startCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Formats a (first, last) name pair as `"Last , First"` with each part
 * start-cased. Returns `'N/A'` when both parts are empty/falsy. Preserves the
 * legacy comma-space-space rendering used by the trip-detail Gantt header.
 */
export function lastCommaFirst(first: unknown, last: unknown): string {
  const firstName = startCase(String(first ?? '').toLowerCase())
  const lastName = startCase(String(last ?? '').toLowerCase())
  return first || last ? `${lastName} , ${firstName}` : 'N/A'
}
