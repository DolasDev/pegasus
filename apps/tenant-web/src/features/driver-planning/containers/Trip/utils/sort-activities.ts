/**
 * Stable-ish sort of trip activities by their effective start date and then
 * by their planned_end. Activities missing a `planned_end` sink to the end.
 *
 * Effective start = actual_date || estimated_date || planned_start.
 * Returns a new array — the input is not mutated.
 */
export function sortActivities<T extends Record<string, unknown>>(activities: T[]): T[] {
  return activities.slice(0).sort((first, second) => {
    if (!first.planned_end) {
      return 1
    } else if (!second.planned_end) {
      return -1
    }
    const diff =
      +new Date(
        (first.actual_date || first.estimated_date || first.planned_start) as
          | string
          | number
          | Date,
      ) -
      +new Date(
        (second.actual_date || second.estimated_date || second.planned_start) as
          | string
          | number
          | Date,
      )
    if (diff !== 0) {
      return diff
    }
    return (
      +new Date(first.planned_end as string | number | Date) -
      +new Date(second.planned_end as string | number | Date)
    )
  })
}
