// ---------------------------------------------------------------------------
// Role-name catalog — single source of truth for the human-facing persona
// metadata served at GET /api/v1/users/role-options and
// GET /api/admin/tenants/:tenantId/users/role-options.
//
// Each `name` MUST match a Cedar role group used in either:
//   - policies/10-tenant-admin.cedar / policies/20-viewer.cedar
//   - one of policies/30-personas/*.cedar (filename matches the persona name
//     once `-` is converted to `_`, e.g. local-dispatch.cedar → "local_dispatch")
//
// The drift detector test in __tests__/role-options.test.ts asserts the names
// here line up with the policy files. If you add a persona policy, add it
// here; if you remove a policy, remove the entry — otherwise the test fails.
//
// The catalog is modelled on the legacy VB.NET Pegasus role set so existing
// customers carry their vocabulary forward. Two legacy roles are deliberately
// NOT ported:
//   - Wizard (WZ): combined a role flag with hardcoded usernames to enable
//     SQL Commands — out of scope for tenant authz; any cross-tenant superuser
//     capability belongs on the admin-web platform surface.
//   - Salesman (SM): had no UI gates in the legacy system — it is a data-
//     classification attribute (commission attribution), not a feature gate.
// Viewer (VW) is included but is NEVER assigned implicitly: empty
// `roleNames[]` evaluates to deny in Cedar; Viewer must be assigned by an
// admin. This closes the legacy fallback hole where missing roles silently
// granted read access.
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
    name: 'billing_manager',
    label: 'Billing Manager',
    description: 'Payroll, driver debits, budgets, invoice key dates, currency rates.',
  },
  {
    name: 'accountant',
    label: 'Accountant',
    description: 'Invoices, payments, driver settlements, storage billing.',
  },
  {
    name: 'operations_admin',
    label: 'Operations Admin',
    description: 'Driver debits and settlements, vehicle records, local dispatch status.',
  },
  {
    name: 'senior_management',
    label: 'Senior Management',
    description: 'High-trust read and sign-off across operations; texting toggle.',
  },
  {
    name: 'coordinator',
    label: 'Coordinator',
    description: 'Quotes, employees, vehicles, timesheets, survey results.',
  },
  {
    name: 'customer_service_manager',
    label: 'CS Manager',
    description: 'Survey results, service authorizations, employee benefits, timesheets.',
  },
  {
    name: 'local_dispatch',
    label: 'Local Dispatch',
    description: 'Local dispatch jobs, vehicles, paperwork logging on sales.',
  },
  {
    name: 'long_distance_dispatch',
    label: 'LD Dispatch',
    description: 'Long-distance driver records and budgets (narrow scope).',
  },
  {
    name: 'central_planning_dispatch',
    label: 'Central Planning',
    description: 'Driver records, premium service details, budgets.',
  },
  {
    name: 'warehouse',
    label: 'Warehouse',
    description: 'Household goods in storage, budgets (narrow scope).',
  },
  {
    name: 'sales',
    label: 'Sales',
    description: 'Full quote and customer authoring; read-only on moves.',
  },
  {
    name: 'viewer',
    label: 'Viewer',
    description: 'Explicit read-only across operational entities. Not a default fallback.',
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
  {
    name: 'workflow_runtime',
    label: 'Workflow Runtime',
    description:
      'Service-account persona for the workflow runtime worker: reads operational entities and creates events.',
  },
] as const
