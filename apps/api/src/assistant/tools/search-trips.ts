// search_trips → GET /api/v1/onprem/longhaul/trips (Operations → Trips).

import { z } from 'zod'
import type { AssistantTool } from './types'
import { capped, dataArray, isoDate, pick, range } from './shared'

const input = z
  .object({
    trip_id: z.number().int().positive().optional().describe('A single trip number'),
    driver_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Driver id from list_drivers. Call list_drivers first to resolve a name.'),
    planned_from: isoDate
      .optional()
      .describe('Trips whose planned span overlaps on/after this date (YYYY-MM-DD)'),
    planned_to: isoDate
      .optional()
      .describe('Trips whose planned span overlaps on/before this date (YYYY-MM-DD)'),
  })
  .strict()

export const searchTrips: AssistantTool<typeof input> = {
  name: 'search_trips',
  description:
    "Call this when the user asks about longhaul trips: a driver's trips, trips running in a date " +
    'window ("this week", "next month"), or a trip by number. For one trip\'s stops, shipments ' +
    'and notes, call get_trip instead. Returns at most 20 rows — if `truncated` is true, narrow ' +
    'the date window or add a driver before answering.',
  input,
  gate: { kind: 'operations' },
  request(i) {
    const filters: Record<string, unknown> = {}
    if (i.trip_id) filters['id'] = String(i.trip_id)
    if (i.driver_id) filters['driver_id'] = { value: i.driver_id }
    const planned = range(i.planned_from, i.planned_to)
    if (planned) filters['planned_date'] = planned
    const query = { filters, sortBy: { value: 'planned_first_day', order: 'ASC' } }
    return `/api/v1/onprem/longhaul/trips?filters=${encodeURIComponent(JSON.stringify(query))}`
  },
  project(body) {
    return capped(dataArray(body), (r) => {
      const row = r as Record<string, unknown>
      return {
        ...pick(row, ['id', 'trip_title']),
        status: row['status_status'] ?? undefined,
        ...pick(row, [
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
        planner:
          [row['planner_first_name'], row['planner_last_name']].filter(Boolean).join(' ') ||
          undefined,
        dispatcher:
          [row['dispatcher_first_name'], row['dispatcher_last_name']].filter(Boolean).join(' ') ||
          undefined,
        notes: Array.isArray(row['notes']) ? row['notes'].length : undefined,
      }
    })
  },
}
