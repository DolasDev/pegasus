// search_shipments → GET /api/v1/onprem/longhaul/shipments (Operations → Planning).

import { z } from 'zod'
import type { AssistantTool } from './types'
import { capped, dataArray, isoDate, pick, place, range } from './shared'

const state = z.string().regex(/^[A-Za-z]{2}$/, 'Two-letter state/province code')

const input = z
  .object({
    search: z
      .string()
      .min(3)
      .optional()
      .describe(
        'Order number prefix, shipper name fragment, or registration number. At least 3 characters. When set, all other filters are ignored.',
      ),
    origin_states: z.array(state).optional().describe('Origin state codes, e.g. ["TX","OK"]'),
    destination_states: z.array(state).optional().describe('Destination state codes'),
    pack_from: isoDate.optional().describe('Planned pack spread overlaps on/after this date'),
    pack_to: isoDate.optional().describe('Planned pack spread overlaps on/before this date'),
    load_from: isoDate.optional().describe('Planned load spread overlaps on/after this date'),
    load_to: isoDate.optional().describe('Planned load spread overlaps on/before this date'),
    delivery_from: isoDate.optional().describe('Planned delivery spread on/after this date'),
    delivery_to: isoDate.optional().describe('Planned delivery spread on/before this date'),
    assigned: z
      .enum(['yes', 'no'])
      .optional()
      .describe('"no" = no driver assigned yet; "yes" = has a driver'),
  })
  .strict()

const STATE_VALUES = (codes: string[] | undefined) =>
  codes?.length ? codes.map((value) => ({ value: value.toUpperCase() })) : undefined

export const searchShipments: AssistantTool<typeof input> = {
  name: 'search_shipments',
  description:
    'Call this when the user asks about longhaul shipments (orders) on the planning board: which ' +
    'shipments pack, load or deliver in a date window, which are unassigned, shipments between ' +
    'states, or a specific order number or shipper. Only open shipments that have not been ' +
    'delivered are on the board. Returns at most 20 rows — if `truncated` is true, narrow the ' +
    'filters (tighter dates, states) instead of answering from a partial list.',
  input,
  gate: { kind: 'operations' },
  request(i) {
    if (i.search) {
      return `/api/v1/onprem/longhaul/shipments?searchTerm=${encodeURIComponent(i.search)}`
    }
    const filters: Record<string, unknown> = {}
    const origin = STATE_VALUES(i.origin_states)
    const destination = STATE_VALUES(i.destination_states)
    if (origin) filters['origin'] = origin
    if (destination) filters['destination'] = destination
    const pack = range(i.pack_from, i.pack_to)
    const load = range(i.load_from, i.load_to)
    const del = range(i.delivery_from, i.delivery_to)
    if (pack) filters['pack_date'] = pack
    if (load) filters['load_date'] = load
    if (del) filters['delivery_date'] = del
    if (i.assigned) filters['assigned'] = [{ value: i.assigned === 'yes' ? 'Yes' : 'No' }]
    return `/api/v1/onprem/longhaul/shipments?filters=${encodeURIComponent(JSON.stringify({ filters }))}`
  },
  project(body) {
    return capped(dataArray(body), (r) => {
      const row = r as Record<string, unknown>
      return {
        ...pick(row, ['order_num', 'shipper_name']),
        origin: place(row['shipper_city'], row['shipper_state']),
        destination: place(row['consignee_city'], row['consignee_state']),
        ...pick(row, [
          'plan_pack',
          'pack_date2',
          'plan_load',
          'load_date2',
          'plan_del',
          'del_date2',
          'driver_name',
          'TripMaster_id',
          'total_est_wt',
          'mileage',
          'haul_mode',
          'latest_activity_abbr',
          'latest_activity_date',
        ]),
      }
    })
  },
}
