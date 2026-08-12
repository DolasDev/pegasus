// ---------------------------------------------------------------------------
// quotes-conversion-30d -- quote counts grouped by QuoteStatus over a trailing
// window, so the sales funnel (draft -> sent -> accepted/rejected) is visible
// as a series.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { PostgresDatasetDef, DatasetRow } from '../types'

const params = z
  .object({
    window: z.enum(['30d', '90d']).default('30d'),
  })
  .default({ window: '30d' })

type Params = z.infer<typeof params>

const WINDOW_DAYS: Record<Params['window'], number> = { '30d': 30, '90d': 90 }

// Funnel order, not alphabetical -- the chart reads left-to-right as a pipeline.
const STATUS_ORDER = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

export const quotesConversion30d: PostgresDatasetDef<Params> = {
  id: 'quotes-conversion-30d',
  version: 1,
  title: 'Quote pipeline',
  description: 'Quote counts by status over a trailing window, in funnel order.',
  source: 'postgres',
  requires: Actions.ReadQuote,
  params,
  columns: [
    { key: 'status', label: 'Status', type: 'string' },
    { key: 'count', label: 'Quotes', type: 'number' },
  ],

  async run({ db }, p): Promise<DatasetRow[]> {
    const since = new Date(Date.now() - WINDOW_DAYS[p.window] * 24 * 60 * 60 * 1000)

    const grouped = await db.quote.groupBy({
      by: ['status'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    })

    const counts = new Map(grouped.map((g) => [String(g.status), g._count._all]))

    // Emit every funnel stage, including zeros -- a missing bar reads as "no
    // data" while a zero bar correctly reads as "nothing converted".
    return STATUS_ORDER.map((status): DatasetRow => ({ status, count: counts.get(status) ?? 0 }))
  },
}
