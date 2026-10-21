// ---------------------------------------------------------------------------
// Services board query ⇄ saved services-filter query.
//
// The board holds ABSOLUTE dates (see redux/activities). A saved filter holds
// day OFFSETS from today, so a preset saved as "today → a week out" still means
// that next month. The offset math is shared with Availability's saved filters.
//
// Selections are stored as bare values and rehydrated to labelled options:
//   - activity types from filterOptions.activityType;
//   - dispatchers from dispatcherList;
//   - short haul from SHAUL_LIST.
// A value missing from its list keeps a code-labelled option, so it still
// filters. This covers a list that hasn't loaded yet or an entry since
// retired. The disabled `office` control is never saved, and loading a filter
// clears it.
// ---------------------------------------------------------------------------

import type { SavedServicesQuery } from '@/api/queries/services-filters'
import {
  fromOffsetDays,
  localTodayIso,
  toOffsetDays,
} from '../../availability/availability-filter-query'
import { SHAUL_LIST } from '../../utils/shaul-list'
import type { ActivityQuery } from '../../redux/activities'

export interface Option {
  label: string
  value: string
}

export interface ServicesReferenceOptions {
  activityTypes: Option[]
  dispatchers: Option[]
}

export function toSavedQuery(
  query: ActivityQuery,
  todayIso: string = localTodayIso(),
): SavedServicesQuery {
  const [from, to] = query.filters.date_range
  return {
    v: 1,
    // The board always carries both bounds; a cleared input falls back to today
    // rather than producing an unsaveable open bound.
    dateFromOffsetDays: toOffsetDays(from, todayIso) ?? 0,
    dateToOffsetDays: toOffsetDays(to, todayIso) ?? 0,
    activityTypes: query.filters.activity_type.map((o) => o.value),
    shortHaul: query.filters.short_haul
      .map((o) => o.value)
      .filter((v): v is 'Y' | 'N' => v === 'Y' || v === 'N'),
    dispatchers: query.filters.operations_id.map((o) => String(o.value)),
    sortBy: query.sortBy ? { value: query.sortBy.value, order: query.sortBy.order } : null,
  }
}

/** Rehydrate `values` to options from `list`, keeping unknown values as code-labelled options. */
export function toOptions(values: string[], list: Option[]): Option[] {
  // String(): a value already on the board may be a raw legacy number.
  const norm = (v: unknown) => String(v).trim().toUpperCase()
  return values.map(
    (value) =>
      list.find((o) => norm(o.value) === norm(value)) ?? {
        label: String(value),
        value: String(value),
      },
  )
}

export function fromSavedQuery(
  saved: SavedServicesQuery,
  refs: ServicesReferenceOptions,
  todayIso: string = localTodayIso(),
): ActivityQuery {
  return {
    filters: {
      date_range: [
        fromOffsetDays(saved.dateFromOffsetDays, todayIso),
        fromOffsetDays(saved.dateToOffsetDays, todayIso),
      ],
      activity_type: toOptions(saved.activityTypes, refs.activityTypes),
      short_haul: toOptions(saved.shortHaul, SHAUL_LIST),
      operations_id: toOptions(saved.dispatchers, refs.dispatchers),
      office: [],
    },
    sortBy: saved.sortBy,
  }
}
