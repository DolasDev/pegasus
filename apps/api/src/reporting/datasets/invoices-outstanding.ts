// ---------------------------------------------------------------------------
// invoices-outstanding -- total value of invoices that are issued but not yet
// settled. Backs the headline currency tile.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { PostgresDatasetDef, DatasetRow } from '../types'

// No params: "what is currently outstanding" has no useful dimension, and a
// param-free dataset is one less thing a stored dashboard definition can carry
// stale. `z.object({})` (not z.void()) so toJSONSchema renders an object.
const params = z.object({}).default({})

type Params = z.infer<typeof params>

/** Invoice states that represent money still owed to the tenant. */
const OUTSTANDING = ['ISSUED', 'PARTIALLY_PAID'] as const

export const invoicesOutstanding: PostgresDatasetDef<Params> = {
  id: 'invoices-outstanding',
  version: 1,
  title: 'Outstanding invoices',
  description: 'Total value and count of invoices that are issued but not fully paid.',
  source: 'postgres',
  requires: Actions.ReadInvoice,
  params,
  columns: [
    { key: 'amount', label: 'Outstanding', type: 'currency' },
    { key: 'count', label: 'Invoices', type: 'number' },
  ],

  async run({ db }): Promise<DatasetRow[]> {
    const result = await db.invoice.aggregate({
      where: { status: { in: [...OUTSTANDING] } },
      _sum: { totalAmount: true },
      _count: { _all: true },
    })

    // totalAmount is Decimal(12,2); Prisma returns a Decimal instance (or null
    // when no rows match). Number() is safe at this magnitude and gives the FE
    // a plain JSON number to format.
    return [
      {
        amount: result._sum.totalAmount ? Number(result._sum.totalAmount) : 0,
        count: result._count._all,
      },
    ]
  },
}
