// Pure date arithmetic. Formatting helpers live in ./format-date.ts.

/** Difference between two dates in whole days (second - first), rounded. */
export function datediff(first: Date | string | number, second: Date | string | number): number {
  return Math.round((+new Date(second) - +new Date(first)) / (1000 * 60 * 60 * 24))
}

/** Returns a new Date that is `days` days after `date`. Does not mutate. */
export function addDays(date: Date | string | number, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Two dates fall on the same calendar day in local time. Times of day are
 * ignored (only year/month/day are compared). Invalid Date inputs (NaN
 * timestamp, e.g. `new Date(undefined)`) compare as NOT same-day.
 */
export function sameDayCheck(
  a: Date | string | number | null | undefined,
  b: Date | string | number | null | undefined,
): boolean {
  const dayA = new Date(a as Date | string | number)
  const dayB = new Date(b as Date | string | number)
  if (isNaN(dayA.getTime()) || isNaN(dayB.getTime())) return false
  return (
    dayA.getFullYear() === dayB.getFullYear() &&
    dayA.getMonth() === dayB.getMonth() &&
    dayA.getDate() === dayB.getDate()
  )
}
