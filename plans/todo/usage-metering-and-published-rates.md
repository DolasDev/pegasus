# Usage Metering + Published Automation Rates

**Branch:** none yet. This file lands on `main` through a plan-only PR
(`docs/usage-metering-and-published-rates`). Implement it with
`/workstream-start feat usage-metering plans/todo/usage-metering-and-published-rates.md`;
Phase 6 (the website) can ship as its own small PR.
**Goal:** Count every billable automated action per tenant, let the tenant and
platform admins see the count, close a monthly usage statement to invoice from,
and publish the automation plans on pegasusmovemanager.com.
**Status:** APPROVED 2026-09-30. D1–D3 decided by Steve the same day (see
Decisions).

---

## Execution status (resume here)

- [ ] **Phase 1**: the meter. `UsageEvent`, the billable-action registry, the
      `meterUsage` middleware, wired to the three billable routes that exist
      today.
- [ ] **Phase 2**: plans and the usage summary API. `TenantAutomationPlan`,
      admin plan management, `GET /api/v1/usage/summary`, SDK
      `get_usage_summary`, discoverability → SDK minor.
- [ ] **Phase 3**: UIs. tenant-web Settings → Developer → Usage; admin-web
      tenant Usage section with the plan editor and a statement export.
- [ ] **Phase 4**: monthly statement close. `UsageStatement` + a daily
      idempotent cron lambda + infra.
- [ ] **Phase 5**: meter each new billable action as it lands (standing rule,
      wired into the NW pulse master plan).
- [x] **Phase 6**: advertise the automation plans on `apps/company-web`,
      without prices (#761, Steve 2026-10-02).

**Order:** 1 → 2 → 3 and 4 in parallel → 6. Phase 5 is a rule, not a batch.
**Hard deadline:** NW billing cannot start until Phases 1–3 are live. The NW
proposal promises that billing starts only when NW can see its usage count in
Pegasus, and the test move is **one week from signature**. So Phases 1–3 need
to be merged before NW signs, or signature and billing start will slip apart.

---

## Context (enough to resume without re-reading the codebase)

### The commercial model this implements (approved 2026-09-30)

From the NW pulse texting proposal (`~/repos/pegasus-workflows/commercial/nw/2026-pulse-texting/`,
rates approved 2026-09-30):

| Plan            | Per month        | Actions per **year** |
| --------------- | ---------------- | -------------------- |
| Starter         | $300             | 6,000                |
| Growth          | $650             | 15,000               |
| Scale           | $1,200           | 50,000               |
| Beyond the pool | $0.30 per action |                      |

- **Pooled annually, billed monthly at 1/12.** NW volume swings 260–671
  moves/month; a monthly allowance would overbill June and waste February.
- **Moving between plans:** up at any time, pro-rated; down at renewal. There's a
  4% escalator at each renewal, applied to the plan prices and the overage
  rate.
- **The one-time prioritization fee is bespoke and never published.**
- Invoicing stays manual. Pegasus Software LLC invoices from the monthly
  statement; this plan does not integrate a payment processor.

### What counts: a billable automated action

**A billable action is a successful, first-time mutation that reaches the
outside world, performed by a workflow runtime or an API client on the
tenant's behalf.**

| Counts (1 each)                                                           | Free                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Text sent (`SendSms`)                                                     | Every read (orders, texts, opt-outs, salesmen, …)                                   |
| Email sent (`SendEmail`, when it lands)                                   | Workflow state (`WriteWorkflowState`): ledgers and reservations                     |
| Task created (`CreateTask`, when it lands) / closed (`CloseTask`)         | Workflow runs, schedules, triggers                                                  |
| Memo written (`WriteOrderMemo`, when it lands)                            | Dry runs (client-side; they never reach the API)                                    |
| Inbound text marked read (`UpdateTextMessage`)                            | Any non-2xx response                                                                |
| Integration delivery / call (`DeliverToExternal`, `CallExternal`), per D3 | Tenant events (`EmitTenantEvent`), internal                                         |
|                                                                           | Idempotent replays (`alreadySent`, `alreadyRead`, `alreadyClosed`, `alreadyExists`) |
|                                                                           | Opt-out records; anything a **human** does through tenant-web                       |

**Why:** Steve rejected per-monitored-move. It's a concept inside one
workflow's ledger, so the platform can't count it, and it breaks when a second
workflow touches the same moves. The meter has to belong to the platform and
be the same for every workflow and API client. Per-text, per-run and
per-API-call were rejected too: per-text bills twice alongside RingCentral and
punishes dedup; per-run bills polling; per-API-call bills reads and retries.
The full reasoning is in the proposal's `terms-recommendation.md` §2.

### Facts from the codebase that shape the design (verified 2026-09-30)

**Auth and identity**

- The M2M surface is `m2mV1` (`apps/api/src/app.ts:269`), mounted at `/api/v1`
  (`:360`) ahead of the Cognito `v1` block. There is no router-wide auth: each
  handler applies `dualAuthMiddleware` (`middleware/dual-auth.ts:28-43`).
  - `Bearer vnd_*` goes to `m2mAppAuthMiddleware`, which sets `tenantId`,
    `db`, `userId`, `principal`, `apiClient` and `correlationId`
    (`middleware/m2m-app-auth.ts:145-155`; types in `types.ts:45-102`).
  - Anything else goes to Cognito `tenantMiddleware`, with **`apiClient`
    undefined**.
- **Human vs automation:** `c.get('apiClient')` is set only for API-key callers.
  `/sms/send` is dual-auth, so a coordinator's manual send must NOT be metered.
  The meter keys on `apiClient` being present.
- **Workflow attribution:** each workflow runtime's key is its own ApiClient,
  named `wf-runtime-<workflowId>`, linked by `Workflow.runtimeApiClientId`,
  with `roleNames: ['workflow_runtime']` (`lib/start-workflow-execution.ts:260-300`).
  So actions attribute to a **workflow** via `apiClientId`. The **execution
  id is not available** on the request: the SDK sends only `Authorization`
  (`pegasus_workflows/api.py:317-323`), and ApiClient has no execution column.
  Per-execution attribution is deferred (see Decisions, D5).

**Authz**

- `requirePermission(action)` (`middleware/rbac.ts:24-53`) is the single choke
  point that knows `action.id` for every gated route. It runs **before** the
  handler, so metering needs a post-`next()` step, not a pre-check.
- `ActionDef { id, resourceType, permission }` lives in `authz/actions.ts:47-54`.

**The three billable routes that exist today, and their replay signals**

- `POST /sms/send` (`handlers/sms.ts:84-159`, action `SendSms`): 202 when new,
  **200 with `data.alreadySent: true`** on a dedup replay; the `SmsSend` row id
  is `data.id`.
- `POST /sms/messages/:id/read` (`handlers/sms.ts:206-263`, action
  `UpdateTextMessage`): `data.alreadyRead = !result.changed`.
- `POST /pegii/tasks/close` (`handlers/pegii-runtime.ts:274-302`, action
  `CloseTask`): `data.alreadyClosed`. The service behind it is still the
  in-memory stub (`services/pegii-tasks.ts:9-17`) until pulse Phase 6 replaces
  it. Meter it anyway; the contract is what matters.
- `CreateTask`, `WriteOrderMemo` and `SendEmail` do not exist yet; they arrive
  with pulse master plan Phases 3, 6 and 7 (Phase 5 here).
- `DeliverToExternal` (`handlers/integration-delivery.ts:137`) and `CallExternal`
  (`handlers/integration-call.ts:245`) exist and are billable (D3). Neither
  carries a dedup key or a stable result id, so each successful call counts
  once; `subjectKey` is the request's `correlationId`. **Check before wiring:**
  how each reports an upstream failure. If an upstream 4xx/5xx is proxied back
  inside a 2xx envelope, the meter must read the upstream status, not
  `c.res.status`.

**Existing counting:** only `countTenantRunnerDailyExecutions`
(`lib/start-workflow-execution.ts:362-379`), for the daily run quota, plus
CloudWatch `Pegasus/Workflows` metrics (`:101-133`). No usage or billing code
exists; `settings.app.billing` is a UI-preferences page, unrelated.

**UI**

- tenant-web: `/settings/*` hangs off `settingsLayout` (tenant_admin only,
  `apps/tenant-web/src/router.tsx:250-254`). The Developer pages are separate
  routes (`routes/settings.developer*.tsx`, `router.tsx:268-284`), registered in
  `addChildren` (`:493-516`); nav entries are in `AppShell.tsx`. **Both
  `router.tsx` and `AppShell.tsx` are merge-magnet files**: serialize with any
  other stream touching them.
- admin-web: `apps/admin-web/src/routes/_auth/tenants/$id.tsx`, composed of
  sections like `TenantUsersSection` / `TenantVpnSection`.

**Cron:** every scheduled lambda lives in `packages/infra/lib/stacks/api-stack.ts`
and follows one pattern:

- a `LogGroup` pushed to `cronLogGroupNames`
- a `NodejsFunction` with `entry: apps/api/src/lambda-*.ts`, `DATABASE_URL`
  and `dbSecret.grantRead`
- an `events.Rule` on `Schedule.rate(...)`. No rule uses `Schedule.cron`, so
  follow that.

The handler model is `apps/api/src/lambda-ringcentral-buffer-purge.ts` (root
`db` for cross-tenant work, `createLogger`).

**Prisma**

- `TENANT_SCOPED_MODELS` is in `lib/prisma.ts:20-126`. The extension scopes
  reads, updates and deletes, but **creates and upserts are not rewritten**, so
  every create must set `tenantId` explicitly.
- Migrations are named `YYYYMMDDHHMMSS_snake_name`.
- The model to copy is `WorkflowState` (`schema.prisma:2097-2120`).

---

## Phase 1: the meter

**Model** `UsageEvent` (tenant-scoped; add it to `TENANT_SCOPED_MODELS`):
`id uuid, tenantId, action String (an ActionDef id), subjectKey String,
apiClientId String, workflowId String?, correlationId String?, occurredAt
DateTime @default(now())`.

- `@@unique([tenantId, action, subjectKey])` is the meter's own dedup, so a
  retry that the route doesn't flag as a replay still counts once.
- `@@index([tenantId, occurredAt])` for the summary and statement queries.
- `@@map("usage_events")`, `@@schema("public")`.
- **Retention:** kept (billing record); no purge.

**Registry** `apps/api/src/lib/usage/billable-actions.ts`: a const map from an
action id to a `subjectKey(c, body)` function.

- `SendSms` → `sms:${data.id}`
- `UpdateTextMessage` → `read:${data.id}`
- `CloseTask` → `close:${data.id}`
- `DeliverToExternal` → `deliver:${correlationId}`; `CallExternal` →
  `call:${correlationId}` (see the upstream-status check above)

It's typed against `Actions`, so a typo is a compile error. A unit test asserts
that every registry key is a real `Actions` id.

**Middleware** `meterUsage(actionId)` in `middleware/meter-usage.ts`, placed
**after** `requirePermission` on each billable route. After `await next()`:

1. Skip unless `c.get('apiClient')` is set (humans are free) and `c.res.status`
   is 2xx.
2. Read `c.res.clone().json()`. Skip if any `data.already*` flag is `true`.
3. Resolve `workflowId` from `apiClient.name` (`wf-runtime-<id>`); otherwise
   null (a plain API client).
4. `createMany({ skipDuplicates: true })` the `UsageEvent`, setting `tenantId`
   explicitly. **Never inside an interactive transaction** (P2002 aborts a PG
   transaction, the #730 lesson); `skipDuplicates` avoids the throw.
5. **Non-fatal:** a meter failure logs and emits the CloudWatch metric
   `Pegasus/Usage MeterWriteFailed{Action}`, then returns the original response
   untouched. A failed meter must never fail a text. The alarm is the backstop.

**Tests** (write them first):

- **Counting rules:** a new send counts 1; a replay counts 0; the same subject
  twice counts 1; a Cognito caller counts 0; a 409 or 503 counts 0.
- **Resilience:** a meter DB failure still returns the handler's 2xx.
- **Tenant isolation:** tenant A's events are invisible to tenant B.
- **Attribution:** the runtime client resolves `workflowId`; a plain API client
  resolves null.

**Files:**

- `apps/api/prisma/schema.prisma` + migration
- `apps/api/src/lib/prisma.ts`
- `apps/api/src/lib/usage/billable-actions.ts` (new)
- `apps/api/src/middleware/meter-usage.ts` (new) + test
- `apps/api/src/repositories/usage.repository.ts` (new)
- `apps/api/src/handlers/sms.ts`, `handlers/pegii-runtime.ts`,
  `handlers/integration-delivery.ts`, `handlers/integration-call.ts`: add the
  middleware to five routes, no logic changes
- `packages/infra`: a CloudWatch alarm on `MeterWriteFailed`

## Phase 2: plans and the usage summary API → SDK minor

**Model** `TenantAutomationPlan` (tenant-scoped):
`id, tenantId, planCode (STARTER|GROWTH|SCALE),
monthlyPriceCents, annualPoolActions, overageCentsPerAction, termStart Date,
termEnd Date, createdAt, createdBy`.

- History is kept: a plan change inserts a new row with a new `termStart`;
  nothing is updated in place. The active row is the latest with
  `termStart <= today < termEnd`.
- Pro-rating an upgrade is done at statement time (Phase 4), not stored.
- The prices live **in the row** so a renewal escalator is data, not a deploy.
  A shared const `AUTOMATION_PLAN_CATALOG` in `packages/domain` holds the
  published defaults (Phase 6 reads the same numbers).

**Summary:** `GET /api/v1/usage/summary?year=YYYY` → `{plan, termStart, termEnd,
pool, usedTermToDate, remaining, projectedAtTermEnd, byMonth[], byAction[],
byWorkflow[]}`.

- Dual auth. Cognito requires `tenant_admin` (it's a billing view); M2M needs
  the new action `ReadUsage`, granted to `workflow-runtime`, so a workflow can
  check its own consumption.
- The projection is linear on term-to-date; label it as an estimate.

**Admin:** `GET/POST /admin/tenants/:id/automation-plan` (plan history, assign a
plan) and `GET /admin/tenants/:id/usage` (the same summary, any tenant). These
use admin auth, like the rest of `/admin`.

**Discoverability** (CLAUDE.md "SDK is the external product boundary"):

- SDK `get_usage_summary(year=None)`.
- SDK README + MCP guidance get a **"What counts as a billable action"** section
  listing counted vs free, and explaining that dedup keys make retries free.
  Workflow authors need this to design cheaply.
- `pegasus-workflows/CLAUDE.md`.
- OpenAPI (the coverage test gates CI).

**Files:**

- `schema.prisma` + migration
- `lib/prisma.ts`
- `packages/domain/src/billing/automation-plans.ts` (new)
- `handlers/usage.ts` (new)
- `handlers/admin/tenant-usage.ts` (new)
- `app.ts`
- the authz trio: `authz/actions.ts`, `authz/cedar.schema.json`,
  `authz/policies/30-personas/workflow-runtime.cedar`
- `lib/openapi-spec.ts`
- the SDK checklist files: `api.py`, `testing/__init__.py` `_READS`, `README`,
  `CHANGELOG`, `pyproject`, `cli/mcp_server.py`, tests
- `~/repos/pegasus-workflows/CLAUDE.md`

After merge, tag `sdk-python-vX.Y.Z` and publish (standing rule).

## Phase 3: UIs

- **tenant-web** `/settings/developer/usage` (`routes/settings.developer.usage.tsx`,
  registered in `router.tsx`, nav in `AppShell.tsx`):
  - the plan and its term
  - a pool meter (used / pool, and the projection)
  - a by-month bar chart
  - by-action and by-workflow tables
  - a one-paragraph "what counts" explainer linking to the published rates
- **admin-web** tenant detail: a new `TenantUsageSection` in `tenants/$id.tsx`
  with the same summary, the plan editor (assign or upgrade, with the history
  table), and **Export statement (CSV)** for a chosen month, which reads
  Phase 4's `UsageStatement`.
- Playwright: the tenant_admin sees Usage and a coordinator doesn't; an admin
  assigns a plan and the tenant view reflects it.

## Phase 4: monthly statement close

- **Model** `UsageStatement` (tenant-scoped):
  - fields: `tenantId, periodMonth (YYYY-MM), planCode, monthlyPriceCents,
actionsInMonth, termToDateActions, pool, overageActions, overageCents,
proRatedPlanCents, closedAt`
  - `@@unique([tenantId, periodMonth])`
  - immutable once written
- **Lambda** `apps/api/src/lambda-usage-statement-close.ts` on
  `Schedule.rate(Duration.days(1))`:
  - For every tenant with a plan, if last month has no statement, close it.
  - That makes it idempotent and self-healing after a missed day, which is the
    reason for daily-rate rather than monthly-cron.
- **Overage is billed only once the term-to-date pool is exhausted:**
  `overageActions = max(0, termToDate − pool) − overage already billed this
term`. An upgrade mid-term pro-rates the plan price by days and applies the
  new pool to the whole term (the proposal: "the part you have prepaid counts
  toward it").
- **Domain logic** in `packages/domain/src/billing/usage-statement.ts` as pure
  functions with Vitest unit tests:
  - a seasonal year (NW's 24-month curve × 9.1 actions per move) stays inside
    the Scale pool
  - a mid-term upgrade
  - an overage month
  - the escalator at renewal
- **Infra:** a LogGroup plus a NodejsFunction plus a Rule in `api-stack.ts`, per
  the cron pattern. Run `grep -r USAGE_ packages/infra` before the PR (standing
  lesson: a flag-gated feature isn't shipped until it's wired).

## Phase 5: meter each new billable action as it lands (standing rule)

Every PR that adds an outward-mutating action must, in the same PR:

1. Add it to `billable-actions.ts` (or record in the PR body why it is free).
2. Put `meterUsage` on its route.
3. Add it to the SDK README's billable list.

Known upcoming, from `plans/in-progress/nw-pulse-texting-platform.md`:

- `SendEmail` (pulse Phase 3)
- `CreateTask` (pulse Phase 6)
- `WriteOrderMemo` (pulse Phase 7)

That plan gets a pointer to this rule (done in this PR).

## Phase 6: advertise the automation plans on pegasusmovemanager.com — SHIPPED (#761), without prices

**Scoped down by Steve, 2026-10-02: the plans are advertised WITHOUT prices.**
#761 added an Automation section between Platform and Heritage:

- the three plans as cards, with annual action pools (6,000 / 15,000 / 50,000)
  and the volume each suits
- annual pooling, and a "counts as one action / always free" list
- the note that texting runs through the customer's own provider at their own
  cost, and that new workflows are quoted per project
- an "Ask for pricing" CTA

There are no plan prices, no overage rate and no fee on the page. Verify by
content: `curl -s https://pegasusmovemanager.com/ | grep -c 'Automation plans'`.

**Gates, as they stand for the no-prices page:**

1. **NW has the proposal first.** Met by omission: no price is public.
2. **The product boundary.** Decided by Steve on 2026-10-02 to advertise. It
   comes back if prices are ever published: the NW retainer deal memo (§7)
   requires excluding Pegasus Cloud from NW's Pegasus II new-version
   entitlement before Cloud is announced.
3. **Plan names match** (D1: Starter / Growth / Scale). Keep the site, the NW
   proposal and `TenantAutomationPlan` in step.

Publishing prices later is a separate change that re-opens gates 1 and 2.

---

## Decisions

- **D1 decided: public plan names are Starter / Growth / Scale** (were Pilot /
  Growth / Full in the NW proposal, which has been renamed to match).
- **D2 decided: three plans only.** No plan above Scale. A heavy tenant pays
  overage at $0.30 an action (for example ~90k actions a year → $14,400 +
  40k × $0.30 = $26,400). Revisit only if a customer actually lands there.
- **D3 decided: `DeliverToExternal` and `CallExternal` are billable**, one action
  per successful delivery or call. `EmitTenantEvent` is free (internal). The
  published "what counts" list and the NW proposal both include it.
- **D4 decided: humans are never metered.** Keyed on `apiClient` presence.
- **D5 decided (deferred): per-execution attribution.** Per-workflow via
  `apiClientId` is enough to bill and explain. Adding execution ids needs the
  runner to export `PEGASUS_EXECUTION_ID` and the SDK to send an
  `X-Pegasus-Execution-Id` header. That's a follow-up, not a blocker.
- **D6 decided: no payment processor.** Statements feed a manual invoice.

## Side effects and risks

- **Merge-magnet files:**
  - `authz/actions.ts`, `cedar.schema.json`, `workflow-runtime.cedar`,
    `schema.prisma`, `router.tsx`, `AppShell.tsx`
  - The NW pulse streams touch the same authz and schema files: serialize,
    then rebase.
- **The meter sits in the response path of `/sms/send`.** Reading
  `c.res.clone().json()` costs one body parse; bounded and small.
- **Three new tenant-scoped tables** (`UsageEvent`, `TenantAutomationPlan`,
  `UsageStatement`):
  - run the tenant-isolation suite
  - apply the migration to local Docker before push (pre-push runs against
    Neon)
  - commit the coverage ratchet (never lower floors)
- **Billing correctness is a trust issue.** Under-counting is a revenue leak;
  over-counting is a customer dispute. The `(tenantId, action, subjectKey)`
  unique key plus the replay check is the defense, and the tenant-visible
  view is the audit.
- **The stub `pegii-tasks` close** counts closes that don't persist until pulse
  Phase 6. There's no customer impact before NW's test move; note it in the PR.

## Acceptance

- A workflow on an NW environment in `TEST_PHONES` mode (live sends to test numbers; a dry run never reaches the API, so it cannot exercise the meter) sends a text (count 1), retries with the same
  `dedup_key` (still 1), marks a reply read (2), and a coordinator sends
  manually from tenant-web (still 2). The tenant-web Usage page and the
  admin-web section both show 2, attributed to the workflow.
- The month-end close produces one `UsageStatement` per tenant with a plan,
  re-running changes nothing, and the CSV export matches it.
- The SDK is published with `get_usage_summary`; README, MCP and
  `pegasus-workflows/CLAUDE.md` document the billable list.
- pegasusmovemanager.com shows the plans, without prices (#761), verified by
  content.
