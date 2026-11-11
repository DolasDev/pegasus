// get_trip → GET /api/v1/onprem/longhaul/trips/:id (the trip detail screen).

import { z } from 'zod'
import type { AssistantTool } from './types'
import { pick, place } from './shared'

const input = z
  .object({ trip_id: z.number().int().positive().describe('The trip number') })
  .strict()

const MAX_ACTIVITIES = 40
const MAX_SHIPMENTS = 20
const MAX_NOTES = 10

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : []

export const getTrip: AssistantTool<typeof input> = {
  name: 'get_trip',
  description:
    'Call this when the user asks about ONE specific trip: its stops/activities and their planned ' +
    'dates, which shipments are on it, its driver, or its notes — e.g. "why is trip 4471 late?". ' +
    'Needs the trip number; use search_trips first if you only have a driver or a date.',
  input,
  gate: { kind: 'operations' },
  request(i) {
    return `/api/v1/onprem/longhaul/trips/${i.trip_id}`
  },
  project(body) {
    const trip = ((body as { data?: unknown } | null)?.data ?? null) as Record<
      string,
      unknown
    > | null
    if (!trip) return { resultCount: null, data: { found: false } }
    const activities = list(trip['activities'])
    const shipments = list(trip['shipments'])
    const notes = list(trip['notes'])
    return {
      resultCount: activities.length,
      data: {
        ...pick(trip, ['id', 'trip_title']),
        status: trip['status_status'] ?? undefined,
        ...pick(trip, [
          'internal_status',
          'driver_id',
          'driver_name',
          'planned_first_day',
          'planned_last_day',
          'origin_geo_name',
          'destination_geo_name',
          'total_estimated_lbs',
          'total_actual_lbs',
        ]),
        activities: activities.slice(0, MAX_ACTIVITIES).map((a) => ({
          ...pick(a, [
            'ActivityType_code',
            'order_num',
            'status',
            'planned_start',
            'planned_end',
            'actual_start',
            'actual_end',
            'is_confirmed',
            'is_committed',
          ]),
          location: place(a['city'], a['state']),
        })),
        activities_truncated: activities.length > MAX_ACTIVITIES || undefined,
        shipments: shipments.slice(0, MAX_SHIPMENTS).map((s) => ({
          ...pick(s, ['order_num', 'shipper_name', 'total_est_wt']),
          origin: place(s['shipper_city'], s['shipper_state']),
          destination: place(s['consignee_city'], s['consignee_state']),
        })),
        notes: notes
          .slice(0, MAX_NOTES)
          .map((n) =>
            pick(n, ['note', 'notes', 'text', 'created_at', 'created_date', 'created_by']),
          ),
      },
    }
  },
}
