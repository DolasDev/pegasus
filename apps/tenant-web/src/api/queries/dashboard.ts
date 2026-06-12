// ---------------------------------------------------------------------------
// PegII dashboard — TanStack Query bindings.
//
// Backs the dashboard's "Use PegII Data" toggle: when on, the dashboard sources
// its numbers from three on-prem MSSQL views via GET /api/v1/dashboard/pegii
// instead of the cloud Postgres endpoints. The DTO is declared locally (the
// repo has no shared client-types package; every queries module declares its
// own — see queries/app-settings.ts).
// ---------------------------------------------------------------------------

import { queryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'

export interface PegiiMoveBreakdownRow {
  move_count: number
  movetype: string
  move_desc: string
}

export interface DashboardPegiiData {
  /** v_dashboard1 — new orders YTD, grouped by move type + description. */
  newOrders: PegiiMoveBreakdownRow[]
  /** v_dashboard2 — in-transit (loaded, not delivered), same grouping. */
  inTransit: PegiiMoveBreakdownRow[]
  /** v_dashboard3 — sum of invoicemaster invoice totals YTD. */
  totalInvoicesYtd: number
}

export const dashboardKeys = {
  all: ['dashboard'] as const,
  pegii: () => [...dashboardKeys.all, 'pegii'] as const,
}

// `enabled` is threaded in so the query only fires when the toggle is on —
// apiFetch already unwraps the `{ data }` envelope, so the type parameter is
// the payload type itself.
export const dashboardPegiiQueryOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: dashboardKeys.pegii(),
    queryFn: () => apiFetch<DashboardPegiiData>('/api/v1/dashboard/pegii'),
    enabled,
  })
