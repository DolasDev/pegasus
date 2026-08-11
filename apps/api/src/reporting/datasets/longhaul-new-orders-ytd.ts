// ---------------------------------------------------------------------------
// longhaul-new-orders-ytd -- new orders YTD by move type, from the tenant's
// on-prem v_dashboard1 view.
//
// Deliberately reads the SAME view as handlers/dashboard-pegii.ts. That makes
// phase 1 provable: if the catalog reproduces the existing PegII dashboard's
// numbers exactly, the dataset contract is right.
//
// Columns are selected EXPLICITLY, never `SELECT *`: a star select combined
// with an alias that reuses a projected name makes mssql hand back an ARRAY for
// that column instead of a scalar (seen in prod). Explicit projection also
// keeps the shape stable if a tenant adds columns to their view.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { Actions } from '../../authz/actions'
import type { LegacyDatasetDef, DatasetRow } from '../types'

// No params -- see the injection rule on LegacyDatasetDef. Nothing
// caller-supplied is interpolated into the fragment.
const params = z.object({}).default({})

type Params = z.infer<typeof params>

export const longhaulNewOrdersYtd: LegacyDatasetDef<Params> = {
  id: 'longhaul-new-orders-ytd',
  version: 1,
  title: 'New orders YTD',
  description: 'New longhaul orders year-to-date, grouped by move type (legacy v_dashboard1).',
  source: 'legacy-mssql',
  requires: Actions.ListMoves,
  params,
  columns: [
    { key: 'moveType', label: 'Move type', type: 'string' },
    { key: 'description', label: 'Description', type: 'string' },
    { key: 'count', label: 'Orders', type: 'number' },
  ],

  sql: () => 'SELECT move_count, movetype, move_desc FROM v_dashboard1',

  map(rows): DatasetRow[] {
    return rows.map((r) => ({
      moveType: String(r['movetype'] ?? ''),
      description: String(r['move_desc'] ?? ''),
      count: Number(r['move_count'] ?? 0),
    }))
  },
}
