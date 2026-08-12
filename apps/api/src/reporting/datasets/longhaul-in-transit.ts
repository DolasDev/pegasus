// ---------------------------------------------------------------------------
// longhaul-in-transit -- shipments loaded but not yet delivered, from the
// tenant's on-prem v_dashboard2 view. Same grouping and same explicit-projection
// rule as longhaul-new-orders-ytd.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { LegacyDatasetDef, DatasetRow } from '../types'

const params = z.object({}).default({})

type Params = z.infer<typeof params>

export const longhaulInTransit: LegacyDatasetDef<Params> = {
  id: 'longhaul-in-transit',
  version: 1,
  title: 'In transit',
  description: 'Loaded but undelivered shipments, grouped by move type (legacy v_dashboard2).',
  source: 'legacy-mssql',
  requires: Actions.ListMoves,
  params,
  columns: [
    { key: 'moveType', label: 'Move type', type: 'string' },
    { key: 'description', label: 'Description', type: 'string' },
    { key: 'count', label: 'Shipments', type: 'number' },
  ],

  sql: () => 'SELECT move_count, movetype, move_desc FROM v_dashboard2',

  map(rows): DatasetRow[] {
    return rows.map((r) => ({
      moveType: String(r['movetype'] ?? ''),
      description: String(r['move_desc'] ?? ''),
      count: Number(r['move_count'] ?? 0),
    }))
  },
}
