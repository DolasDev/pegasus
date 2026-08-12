// ---------------------------------------------------------------------------
// longhaul-invoiced-ytd -- sum of invoicemaster invoice totals YTD, from the
// tenant's on-prem v_dashboard3 view. A scalar view: one row, one column.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { LegacyDatasetDef, DatasetRow } from '../types'

const params = z.object({}).default({})

type Params = z.infer<typeof params>

export const longhaulInvoicedYtd: LegacyDatasetDef<Params> = {
  id: 'longhaul-invoiced-ytd',
  version: 1,
  title: 'Invoiced YTD',
  description: 'Sum of legacy invoicemaster invoice totals year-to-date (legacy v_dashboard3).',
  source: 'legacy-mssql',
  requires: Actions.ReadInvoice,
  params,
  columns: [{ key: 'amount', label: 'Invoiced YTD', type: 'currency' }],

  sql: () => 'SELECT TotalInvoicesYTD FROM v_dashboard3',

  map(rows): DatasetRow[] {
    // Scalar view: an empty recordset means "no invoices yet", which is a
    // legitimate 0 rather than an error. Note the legacy column is PascalCase
    // here while v_dashboard1/2 are snake_case -- that inconsistency is real,
    // and is exactly why every column name is verified against the live view
    // rather than assumed.
    const first = rows[0]
    return [{ amount: first ? Number(first['TotalInvoicesYTD'] ?? 0) : 0 }]
  },
}
