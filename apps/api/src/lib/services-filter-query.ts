// ---------------------------------------------------------------------------
// Saved Operations → Services filter: the persisted `query` shape.
//
// The counterpart of lib/availability-filter-query.ts. It is validated
// strictly on write, so a row in services_filters is always something the
// Services board can apply. It is versioned via `v`.
//
// The board filters on ABSOLUTE dates (redux/activities: "the 14th means the
// 14th" on a board left open overnight). The saved form deliberately stores day
// OFFSETS instead, because a preset holding absolute dates would be dead within
// a week. Both bounds are required because the board always has both. Every
// selection is stored as its VALUE only:
//   - activityTypes: Longhaul_ActivityType abbreviations;
//   - shortHaul: 'Y' / 'N';
//   - dispatchers: salesman codes.
// tenant-web rehydrates the labels from reference data on load. The board's
// `office` control is unwired, so it is not persisted: a saved filter must not
// carry a selection that filters nothing.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** ~10 years either side — wide enough for any real window, small enough to reject junk. */
const OffsetDays = z.number().int().min(-3650).max(3650)

/**
 * The sort keys the activities list handler whitelists (SORTABLE_COLUMNS in
 * handlers/longhaul-cloud/activities-list.ts). A test pins the two lists
 * together.
 */
export const SERVICES_SORT_KEYS = [
  'scheduled_date',
  'actual_date',
  'activity_type',
  'order_num',
  'status',
  'driver_name',
  'city',
  'state',
  'shipper_name',
  'dispatcher',
] as const

const Code = z.string().min(1).max(20)

export const ServicesFilterQuery = z.strictObject({
  v: z.literal(1),
  dateFromOffsetDays: OffsetDays,
  dateToOffsetDays: OffsetDays,
  activityTypes: z.array(Code).max(100),
  shortHaul: z.array(z.enum(['Y', 'N'])).max(2),
  dispatchers: z.array(Code).max(200),
  sortBy: z
    .strictObject({ value: z.enum(SERVICES_SORT_KEYS), order: z.enum(['asc', 'desc']) })
    .nullable(),
})

export type ServicesFilterQuery = z.infer<typeof ServicesFilterQuery>
