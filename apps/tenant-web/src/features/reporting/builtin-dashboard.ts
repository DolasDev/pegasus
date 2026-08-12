// ---------------------------------------------------------------------------
// The built-in dashboard — the fallback when a user has no default set and the
// tenant has published nothing.
//
// Still authored as a v1 document ON PURPOSE: it is the standing proof that the
// v1 -> v2 upgrade works, since it is parsed through the same path as any stored
// row. If someone "modernizes" this literal to v2, that coverage disappears
// silently and a real phase-1 row is the next thing to find the bug.
// ---------------------------------------------------------------------------

import { parseDashboardDefinition, type DashboardDefinition } from './dashboard-definition'

/** Slug the built-in reports under, so it can be referenced like a stored one. */
export const BUILTIN_SLUG = 'operations-overview'
export const BUILTIN_TITLE = 'Operations overview'
export const BUILTIN_DESCRIPTION = 'Cloud and legacy operational figures at a glance.'

export const BUILTIN_DASHBOARD: DashboardDefinition = parseDashboardDefinition({
  schemaVersion: 1,
  id: BUILTIN_SLUG,
  title: BUILTIN_TITLE,
  description: BUILTIN_DESCRIPTION,
  widgets: [
    {
      datasetId: 'longhaul-invoiced-ytd',
      datasetVersion: 1,
      widget: 'scalar',
      title: 'Invoiced YTD',
      span: 2,
    },
    {
      datasetId: 'invoices-outstanding',
      datasetVersion: 1,
      widget: 'scalar',
      title: 'Outstanding invoices',
      span: 2,
    },
    {
      datasetId: 'longhaul-new-orders-ytd',
      datasetVersion: 1,
      widget: 'bar',
      title: 'New orders YTD',
      span: 2,
    },
    {
      datasetId: 'longhaul-in-transit',
      datasetVersion: 1,
      widget: 'bar',
      title: 'In transit',
      span: 2,
    },
    {
      datasetId: 'moves-by-status',
      datasetVersion: 1,
      params: { window: '90d' },
      widget: 'bar',
      title: 'Moves by status (90d)',
      span: 2,
    },
    {
      datasetId: 'quotes-conversion-30d',
      datasetVersion: 1,
      params: { window: '30d' },
      widget: 'bar',
      title: 'Quote pipeline (30d)',
      span: 2,
    },
  ],
})
