// ---------------------------------------------------------------------------
// moves-by-status -- move counts grouped by MoveStatus, over a scheduled-date
// window. Backs the "operational load" series widget.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { PostgresDatasetDef, DatasetRow } from '../types'

// Windows are an enum rather than caller-supplied dates: it keeps the param
// surface closed, makes the query plan predictable, and means a stored phase-2
// dashboard definition can never carry an unbounded range.
const params = z
  .object({
    window: z.enum(['30d', '90d', '12m']).default('90d'),
  })
  .default({ window: '90d' })

type Params = z.infer<typeof params>

const WINDOW_DAYS: Record<Params['window'], number> = {
  '30d': 30,
  '90d': 90,
  '12m': 365,
}

export const movesByStatus: PostgresDatasetDef<Params> = {
  id: 'moves-by-status',
  version: 1,
  title: 'Moves by status',
  description: 'Move counts grouped by status over a scheduled-date window.',
  source: 'postgres',
  requires: Actions.ListMoves,
  params,
  columns: [
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'count', label: 'Moves', type: 'number' },
  ],

  async run({ db }, p): Promise<DatasetRow[]> {
    const since = new Date(Date.now() - WINDOW_DAYS[p.window] * 24 * 60 * 60 * 1000)

    // groupBy is tenant-scoped by the createTenantDb extension -- do not add
    // tenantId here, it is injected into `where`.
    const grouped = await db.move.groupBy({
      by: ['status'],
      where: { scheduledDate: { gte: since } },
      _count: { _all: true },
    })

    return grouped
      .map((g): DatasetRow => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => String(a.status).localeCompare(String(b.status)))
  },
}
