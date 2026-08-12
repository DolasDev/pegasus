// ---------------------------------------------------------------------------
// The one built-in dashboard shipped in phase 1.
//
// It is deliberately NOT a hand-rolled constant: it is parsed through the same
// DashboardDefinition schema a phase-2 stored row will be. Phase 2 replaces the
// literal below with a fetch, and nothing else in the render path changes.
//
// Widget choice mirrors the existing PegII dashboard so the two can be compared
// side by side -- if these numbers match /dashboard/pegii, the dataset contract
// is right.
// ---------------------------------------------------------------------------

import { parseDashboardDefinition, type DashboardDefinition } from './dashboard-definition'

export const BUILTIN_DASHBOARD: DashboardDefinition = parseDashboardDefinition({
  schemaVersion: 1,
  id: 'operations-overview',
  title: 'Operations overview',
  description: 'Cloud and legacy operational figures at a glance.',
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
