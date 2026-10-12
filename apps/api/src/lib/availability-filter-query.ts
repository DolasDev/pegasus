// ---------------------------------------------------------------------------
// Saved Operations → Availability filter — the persisted `query` shape.
//
// Validated strictly on write (unlike Planning's `z.record(unknown)`), so a row
// in availability_filters is always something tenant-web's View A can apply.
// Versioned via `v` so a future field change can migrate old rows on read
// instead of failing them.
//
// Dates are integer day offsets from "today" (Planning's convention), so a
// saved "last 3 months → next 3 months" window keeps meaning that on any day.
// null = an open bound. tenant-web converts absolute ⇄ offset; the server only
// stores and validates. Zones are stored as zone CODES — labels are rehydrated
// from the zone reference list on load.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** ~10 years either side — wide enough for any real window, small enough to reject junk. */
const OffsetDays = z.number().int().min(-3650).max(3650).nullable()

export const AVAILABILITY_MOVE_TYPES = ['local', 'longDistance', 'shorthaul'] as const

export const AvailabilityFilterQuery = z.strictObject({
  v: z.literal(1),
  driverName: z.string().max(100),
  zones: z.array(z.string().min(1).max(20)).max(100),
  moveTypes: z.array(z.enum(AVAILABILITY_MOVE_TYPES)).max(AVAILABILITY_MOVE_TYPES.length),
  dateFromOffsetDays: OffsetDays,
  dateToOffsetDays: OffsetDays,
  sortOrder: z.enum(['asc', 'desc']).nullable(),
})

export type AvailabilityFilterQuery = z.infer<typeof AvailabilityFilterQuery>
