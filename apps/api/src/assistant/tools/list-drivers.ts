// list_drivers → GET /api/v1/onprem/longhaul/drivers (active longhaul drivers).
// The endpoint has no server-side search, so the name filter runs here; that is
// what keeps a fleet-sized list out of the model's context.

import { z } from 'zod'
import type { AssistantTool } from './types'
import { capped, dataArray, pick } from './shared'

const input = z
  .object({
    name: z
      .string()
      .min(2)
      .optional()
      .describe('Case-insensitive fragment of the driver name or agent code'),
  })
  .strict()

export const listDrivers: AssistantTool<typeof input> = {
  name: 'list_drivers',
  description:
    'Call this to resolve a driver name to a driver_id (needed by search_trips), or when the user ' +
    'asks which longhaul drivers exist. Pass `name` whenever you have one. Returns at most 20 rows.',
  input,
  gate: { kind: 'operations' },
  request() {
    return '/api/v1/onprem/longhaul/drivers'
  },
  project(body, i) {
    const needle = i.name?.toLowerCase()
    const rows = dataArray(body).filter((r) => {
      if (!needle) return true
      const row = r as Record<string, unknown>
      return [row['driver_name'], row['agent_code']].some(
        (v) => typeof v === 'string' && v.toLowerCase().includes(needle),
      )
    })
    return capped(rows, (r) => pick(r, ['driver_id', 'driver_name', 'agent_code', 'type']))
  },
}
