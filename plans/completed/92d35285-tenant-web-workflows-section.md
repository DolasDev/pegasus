# tenant-web: a Workflows section (open instances, status, signals, stop)

- **Branch:** `feat/tenant-web-workflows-section` (worktree `../pegasus-tenant-web-workflows-section`).
  Plan + code land in one PR via the merge queue.
- **Goal:** the last Phase 4 item of
  `plans/in-progress/long-running-workflows-and-automations.md`: "tenant-web: add
  a Workflows section (open instances, their status from the query, delivered
  signals) next to Automations." Tenants can see their running durable
  Workflows (e.g. one per order, keyed by order id), open one, see where it
  stands, see what has been delivered to it, and stop it, without the CLI.
- **Status:** Approved 2026-11-17 (all four decisions → the recommended option). Implemented 2026-11-17.

## Resume here (2026-11-17, implementation done)

- **Done on this branch:** API `parentExecutionId` filter + OpenAPI + SDK 0.66.1
  (`list_workflow_executions(parent_execution_id=)`, CLI `executions steps`);
  `ApiError.retryAfterSeconds` + `Retry-After` in CORS `exposeHeaders` (Hono and the
  HTTP API); tenant-web `kind` + Automations-list split + pointer; `/workflows`
  list + nav; `/workflows/$executionId` detail; badge → link; legacy-redirect
  comment corrected; RTL, API, infra, e2e smoke; parent plan + DECISIONS.
- **Changed from the design:** actions and the query panel are gated by Cedar
  permission strings from `/me/permissions` (`workflow:query_execution` /
  `cancel_execution` / `terminate_execution`), not role names, which matches the
  existing Automation detail page and yields the same audience (developer + admin
  via permit-all). Added `Retry-After` CORS exposure (the browser could not read
  it otherwise); the hook falls back to 15 s when the header is missing. Added a
  CLI `executions steps` command (discovery surface for the new filter). Step
  rows link to `/automations/$workflowId?tab=executions` (reachable by viewers),
  and the Automation detail page's expanded execution links back to its parent.
- **Owed after merge:** publish SDK 0.66.1 (`sdk-python-v0.66.1`); staging
  eyeball (below); the authoring repo's `CLAUDE.md` (outside this repo) should
  mention the steps listing.

## What exists (verified on `main` @ `ec250151`)

- **API (#963):** `GET /api/v1/workflow-executions` (tenant-wide, open
  durable Workflows by default, `name` / `correlationKey` filters, cursor
  paging; rows carry `kind`, `correlationKey`, `workflowName/Version`), `GET
/:id` (+ declared `signals` / `queries`), `POST /:id/query | cancel |
terminate`. Query is `QueryWorkflowExecution` and terminate is
  `TerminateWorkflowExecution`, both developer-only; list/get are
  `ReadWorkflow` (viewer too). History per execution is `GET
/workflows/:workflowId/executions/:id/history`, and signals appear in it as
  `WorkflowExecutionSignaled` with `signalName`.
- **tenant-web:**
  - two Automations surfaces: the read-only `/automations` (nav for
    `AUTOMATION_VIEW_ROLES` = admin / viewer / developer) and the admin
    `/settings/automations` (upload, run, triggers, executions, the "Workflow
    step" badge whose parent id is only a tooltip);
  - `/settings/workflows[/$id]` are Phase 1 redirects to `/settings/automations`
    (`lib/legacy-workflow-redirects.ts`), reserved for this page;
  - the `Workflow` type has no `kind`, so **durable Workflows are listed
    mixed in with Automations today**. The API already returns `kind`.
- Role gating in tenant-web is by role NAME (`auth/role-guard.ts`), not Cedar.

## Decisions (Steve, 2026-11-17)

1. **Placement: top-level `/workflows`.** A nav entry next to Automations for
   `AUTOMATION_VIEW_ROLES` (admin / viewer / developer). Actions are hidden for
   viewers. The `/settings/workflows[/$id]` Phase 1 redirects STAY (old
   Automation bookmarks); `legacy-workflow-redirects.ts`'s "Phase 4 deletes
   this" comment gets corrected.
2. **Live status (the query): developers/admins only.** No Cedar change. Viewers
   see the stored status, the key, delivered signals and steps; the query panel
   is hidden for them, with a one-line "live status needs the developer role"
   hint.
3. **Split the lists.** Both Automations lists show `kind === 'AUTOMATION'`
   only, with a "Durable Workflows → /workflows" pointer. A Workflow version's
   publish/trigger management stays on the settings detail page by id.
4. **Actions: query, cancel, terminate** (developer/admin). Sending signals
   stays in the CLI/SDK.

## Design

### Routes / nav

- `/workflows`: the list page. The nav entry is "Workflows" (icon `Workflow`),
  for `AUTOMATION_VIEW_ROLES`, next to Automations.
  - Default: OPEN instances, newest first. Columns: Workflow (name@version),
    key (`correlationKey`, or "manual"), status, started, last change. Filters:
    name, key search, Open/All toggle. Paged with "Load more" (cursor).
- `/workflows/$executionId`: the detail page, by id alone.
  - Header: name@version, key, status, started/finished, error. Run input,
    collapsed.
  - **Status panel:** if the version declares a `status` query, it runs once
    when the page opens and on **Refresh**; never on a timer (each query wakes
    the runner). While a 503 `WORKFLOW_WORKER_STARTING` is in flight it shows
    "Waking the runner…" and retries on `Retry-After`, up to 90 s, then "try
    again". Other declared queries go in a "Run query" select with optional
    JSON args (developer/admin).
  - **Delivered signals:** from the history timeline (`WorkflowExecutionSignaled`
    - `signalName` + timestamp). The history route needs `workflowId`, which the
      row carries.
  - **Steps:** the step Automations this instance started, with status, each
    linking to its Automation execution. Needs a `parentExecutionId` filter on
    `GET /workflow-executions` (small API + OpenAPI + SDK change, below).
  - **Actions** (developer/admin, hidden for viewers): Cancel (confirm), and
    Terminate (requires a reason, red confirm explaining that "no more of its
    code runs; its open steps are cancelled"). Kill-switch independent.
- The "Workflow step" badge in Automation executions becomes a **link** to
  `/workflows/$parentExecutionId` (today it's a tooltip).
- `/settings/workflows[/$id]`: keep the Phase 1 redirects (they serve old
  Automation bookmarks; this section lives at `/workflows`, so nothing
  conflicts).

### Automations lists

- Add `kind` to the tenant-web `Workflow` type. The `/automations` and
  `/settings/automations` lists show `kind === 'AUTOMATION'` only. A durable
  Workflow's publish/triggers management stays where it is today (the settings
  detail page by id still works for any kind); the settings list gets a
  "Durable Workflows → /workflows" pointer so publishing admins can find them.

### API addition (small)

- `GET /workflow-executions?parentExecutionId=<id>` filters to that
  Workflow's steps (kind AUTOMATION implied). Tenant-scoped like the rest; the
  `(parentExecutionId)` index exists. OpenAPI entry; SDK
  `list_workflow_executions(parent_execution_id=…)`; an SDK patch bump
  (re-check tags first).

### Data / client

- `api/workflow-executions.ts`: query options for list / get / history, and
  mutations for query / cancel / terminate, via `@pegasus/api-http`. The
  `Serialized<T>` wire types. Query's 503 handling lives in a small hook
  (`useWorkflowQuery`) with the Retry-After loop + abort on unmount.
- The list can refetch on window focus (cheap DB read). The detail page polls
  ONLY the DB row (e.g. every 15 s while open, to catch closure). The query
  never polls.

## Tests

- Vitest/RTL:
  - list renders rows, key, the filters → query params, empty state;
  - detail: status query auto-runs once, the 503 → retry → answer path (fake
    timers), Refresh, no timer polling;
  - signals from the history fixture; steps list; actions hidden for viewer,
    terminate requires a reason;
  - badge link; Automations lists exclude `kind: WORKFLOW`.
- API: the `parentExecutionId` filter integration test (tenant 404 / scoping)
  plus OpenAPI coverage.
- e2e (Playwright browser): one smoke that `/workflows` loads for an admin
  (with the tag contract per `apps/e2e/README.md`), if a seeded durable
  Workflow is feasible; else a list empty-state smoke.

## Checklist

- [x] Decisions recorded
- [x] API `parentExecutionId` filter + test + OpenAPI; SDK param + patch bump
- [x] tenant-web: `kind` on `Workflow`; Automations lists filter
- [x] `/workflows` list + nav (hot files: `router.tsx`, `AppShell.tsx`; serialize)
- [x] `/workflows/$executionId` detail: header, status query hook, signals, steps, actions
- [x] Badge → link
- [x] Tests (RTL, API, e2e smoke); typecheck/lint
- [ ] (post-deploy) Eyeball on staging AVP Smoke (browser); local eyeball of all three pages done 2026-11-17 — this also clears the long-owed "Workflow
      step" badge eyeball
- [x] Docs: parent plan Phase 4 tick + Resume; DECISIONS; SDK README/CHANGELOG for the filter

## Risks

- Hot files: `router.tsx`, `AppShell.tsx`. Another stream
  (`feat/task-queue-activity-feed`) is open right now; check its diff before
  editing them.
- Query cost: the page must never poll queries (each wakes the runner). Tested.
