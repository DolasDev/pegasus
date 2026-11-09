# All-user Automations viewer (`/automations`)

## Goal

A read-only Automations section in the main nav, like `/integrations`, so nearly any
employee can check on the state of the tenant's automations. It lists **Your
automations** only (`visibility === 'TENANT'`), and each one opens a detail page with
the automation diagram, verified envelope, and executions.

## Scope

Frontend only (`apps/tenant-web`). No API, Cedar, OpenAPI, or SDK change. Every
endpoint the detail page reads (`GET /workflows`, `/:id`, `/:id/triggers`,
`/:id/executions`, `/:id/executions/:eid/history`, `/requirements-summary`) is
gated on `ReadWorkflow`, which is already on the `viewer` baseline
(`20-viewer.cedar`). `workflow_developer` and `tenant_admin` hold it too.

## Units

1. `router.tsx`: add `/automations` and `/automations/$workflowId` off `authLayout`
   (not `settingsLayout`), guarded by `requireRole(...AUTOMATION_VIEW_ROLES)` =
   `tenant_admin`, `viewer`, `workflow_developer`. The detail route gets
   `validateSearch: validateAutomationDetailSearch` so `?tab=executions` deep links work.
2. `AppShell.tsx`: add an `AUTOMATION_VIEW_ROLES` constant and a NAV_ITEMS entry
   (`Zap` icon) next to Integrations.
3. New `routes/automations.index.tsx`: a read-only list of TENANT automations,
   grouped by name with `groupWorkflowsByName`, one row per name linking to the
   latest version. It shows the version, the executability badge (exported from
   `settings.workflows.tsx`, not copied) and the description. Retired rows are already
   excluded by the API.
4. `settings.workflows.$workflowId.tsx`: reuse `WorkflowDetailPage` with a
   `backTo` prop so the back link and breadcrumb point at the right section. Show the
   "Manage secrets & configs" link only to holders of `workflow_config:manage`. Change
   the breadcrumb from "Workflows" to "Automations". Run, cancel, retry and re-test
   are already gated by `perms.has`.
5. Tests: add AppShell nav visibility (viewer sees it, driver doesn't), plus a list
   page test (TENANT only, grouped, links to `/automations/$id`).

## Found during implementation

- Executions and triggers belong to one version id, and publishing a new version
  does not move a trigger. An older version can therefore be the one that actually
  runs. So the list keeps every earlier version reachable as a link and marks the
  ones an enabled trigger still runs ("Still triggered"), using the
  requirements-summary `current` flag (`ReadWorkflow`).
- Following PATTERNS.md ("Client-side role gates come from one shared const"),
  `AUTOMATION_VIEW_ROLES` lives in `auth/role-guard.ts` and is imported by both the
  router and AppShell. (`INTEGRATION_VIEW_ROLES` is still duplicated, which is out of
  scope here.)

## Considered / open

- Execution input/output payloads render on the detail page. `ReadWorkflow` already
  grants these server-side, so the UI widens nothing.
- A user who holds only a persona role and not `viewer` (most persona `.cedar` files
  are empty) is redirected, the same as for Integrations today. Granting `ReadWorkflow`
  to personas would widen data exposure, so it is a separate decision for Steve.
