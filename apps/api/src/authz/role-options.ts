// ---------------------------------------------------------------------------
// Role-name catalog — single source of truth for the human-facing persona
// metadata served at GET /api/v1/users/role-options and
// GET /api/admin/tenants/:tenantId/users/role-options.
//
// Each `name` MUST match a Cedar role group used in either:
//   - policies/10-tenant-admin.cedar / policies/20-tenant-user.cedar
//   - one of policies/30-personas/*.cedar (filename matches the persona name
//     once `-` is converted to `_`, e.g. crew-lead.cedar → "crew_lead")
//
// The drift detector test in __tests__/role-options.test.ts asserts the names
// here line up with the policy files. If you add a persona policy, add it
// here; if you remove a policy, remove the entry — otherwise the test fails.
// ---------------------------------------------------------------------------

export type RoleOption = {
  /** Cedar role-group identifier. Must match the policy `principal in
   *  Pegasus::Group::"…"` exactly. */
  name: string
  /** Short label for UI (≤ ~16 chars). */
  label: string
  /** One-sentence description shown next to the checkbox. */
  description: string
}

export const ROLE_OPTIONS: readonly RoleOption[] = [
  {
    name: 'tenant_admin',
    label: 'Admin',
    description: 'Full access to every tenant feature.',
  },
  {
    name: 'tenant_user',
    label: 'User (read-only)',
    description: 'Read-only baseline across moves, quotes, customers, invoices.',
  },
  {
    name: 'dispatcher',
    label: 'Dispatcher',
    description: 'Read everything operational; write moves and customer detail at dispatch.',
  },
  {
    name: 'sales',
    label: 'Sales',
    description: 'Full quote and customer authoring; read-only on moves.',
  },
  {
    name: 'accountant',
    label: 'Accountant',
    description: 'Full invoice control; read-only on derived moves and quotes.',
  },
  {
    name: 'auditor',
    label: 'Auditor',
    description: 'Read-only across every operational entity.',
  },
  {
    name: 'crew_lead',
    label: 'Crew Lead',
    description: 'Read assigned moves and customers; update moves to record progress.',
  },
  {
    name: 'reporting',
    label: 'Reporting',
    description:
      'Service-account read-only access across moves, quotes, invoices, customers, orders, and events.',
  },
  {
    name: 'integrations',
    label: 'Integrations',
    description: 'Service-account read/write on the orders and events M2M surfaces.',
  },
  {
    name: 'workflow_developer',
    label: 'Workflow Dev',
    description: 'Upload Python workflow artifacts via the SDK. Read access included.',
  },
] as const
