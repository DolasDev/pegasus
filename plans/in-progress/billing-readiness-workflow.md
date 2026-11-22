# Billing readiness Workflow (RVS) — Phase 5 of long-running Workflows

- **Branch:** `feat/billing-readiness-workflow` (worktree `../pegasus-billing-readiness-workflow`).
  Plan + code land in one PR via the merge queue. Authoring-repo pieces land in
  `~/repos/pegasus-workflows` (its own commits; never _published_ from a platform session).
- **Goal:** Phase 5 of `plans/in-progress/long-running-workflows-and-automations.md`,
  re-targeted (Steve, 2026-11-22) from `nw/order_lifecycle` to a **billing readiness**
  Workflow for **Reliable Van and Storage (RVS)**: once an order's delivery date has
  arrived, track the conditions that must hold before it can be billed, show them live,
  and end when the order is invoiced.
- **Status:** Approved 2026-11-22 (Steve). This branch implements **5a**; 5b–5e are
  listed so the parent plan has one place to point at.

## Decisions (Steve, 2026-11-19..22)

1. **Tenant: RVS** (Allied agent; also does COD moves). **COD and Allied moves get the
   same checklist** for now.
2. **Start: when planned (`sales.del_date`) or actual (`sales.del_actual`) delivery is on
   or before today.** A daily SCHEDULE sweep finds those orders; the Workflow is not started
   at booking and slept (weeks-long instances, dates edited in the desktop with no event).
3. **Done = the order is invoiced** — its first `invoicemaster` row with `inv_status='I'`.
4. **Conditions** (the checklist):
   - **Delivered** — `sales.del_actual` set.
   - **Accessorials authorized** — the order's legacy _premium service details_
     (`PremiumServiceDetail`, keyed by `order_num`; `status` = needs authorization /
     authorized by account / by shipper / not authorized …). Exact RVS codes: measure (open).
   - **Signed BOL submitted** — RVS uploads it through the van lines app straight to
     Allied; Pegasus never sees it. Needs a separate integration (Sirva ADE document pull,
     inert until Sirva credentials exist) → 5d. Shown as "not observable yet" until then.
   - **Audit done** — `invoicemaster.audit_date` set in legacy movemanager, surfaced both as
     a readable fact and as an event (5c).
5. **Custom events: OK to enable** (staging now; prod is needed for RVS, which lives only in
   prod — both the live tenant `2b916653…` and "RVS QA" `47addd95…`).

## Facts measured (2026-11-20, read-only, live RVS via the prod MssqlExecutor)

- 419 orders delivered in the last 90 days (~5/day); **18** delivered but not invoiced.
  → open instances stay in the tens (cap 500); a daily per-instance check ≈ 20 step runs/day.
- `invoicemaster.inv_status` (12 mo): I 5,434 · C 99 · R 20 · D 7. ~3 invoices per order
  (supplementals) → "done" = the **first** `I`.
- `audit_date`: **never set** (0 rows, ever); the desktop lets only the **Wizard** role edit
  it (`InvoiceMaster_BlockOfKeyDatesEditUserControl.vb:44`). 5c must open it to billing.
- `salesserviceauths`: **0 rows ever** at RVS (not the accessorial source).
- `invoicemaster.paper_rec` = `Y` on every row (QA copy) — useless.
- `sales.vans_type` almost always blank — can't separate COD from Allied (moot: decision 1).

## Design (5a)

### Start: daily sweep → custom event → keyed Workflow

- **`billing_delivery_sweep`** (Automation, SCHEDULE trigger, daily, early morning RVS time):
  `search_orders(date_field="del_date" | "del_actual", date_from=today-14, date_to=today,
status="*")`, union by order number. For each order not yet claimed, claim it in workflow
  state (`put_workflow_state("billing_due", <order>)`, compare-and-set) and
  `emit_event("billing.delivery_due", {"orderNum": …, "plannedDelivery": …, "actualDelivery": …})`.
  The claim means each order is emitted **once**, so re-runs and the 14-day lookback never
  produce rejected duplicate starts or repeat signals.
- **Event type** `billing.delivery_due` registered for the tenant (payload schema:
  `orderNum` integer required).
- **`billing_readiness`** (durable Workflow, `kind="workflow"`): EVENT trigger on
  `billing.delivery_due`, `mode=START`, `correlation_path="payload.orderNum"` → one instance
  per order (`wfl/<tenant>/billing_readiness/<orderNum>`).

### The Workflow

- State: the checklist `{delivered, premiumServicesAuthorized, bolReceived, audited,
invoiced}` each `met | pending | unknown | not_observable`, plus `firstSeen`, `lastChange`,
  `lastChecked`.
- Loop: run the **`check_billing_readiness`** Automation step (`run_automation`) → update the
  checklist → if invoiced: finish with a summary; else sleep until the next check
  (daily) **or** a signal (`recheck`, later `audited` / `bol_received`) wakes it early.
- `@workflow.query status` → the checklist + timings (shown on tenant-web `/workflows/$id`).
- **Escalation:** after **N days** with no change (N + the role: open question; default 7 days,
  `notify()` to the billing role), once, then every N days.
- **Safety valve:** close after 90 days open (finish "stale", with the checklist), so a lost
  order never pins an instance (and the tenant runner) forever.
- `continue_as_new` every ~30 checks to bound history.

### The check step (5a vs 5b)

- **5a:** `check_billing_readiness` reads what the SDK already reaches:
  `search_orders(date_field="del_actual", …)` / `get_order` for **delivered**. The other
  conditions return `unknown` ("needs 5b").
- **5b** swaps in `get_order_billing(order)` (below) for premium services, audit, invoiced.

### Platform changes in 5a

- **CDK:** `CUSTOM_EVENTS_ENABLED=true` on **staging** (per-env context, like the other feature
  flags; prod stays off until the staging proof passes — then a one-line flip, approval
  required). Infra test asserts it.
- Nothing else is expected — verify while implementing: a custom event type can back a
  START trigger with `correlationPath` (`handlers/workflows.ts:319` allows custom types), the
  runtime role has `EmitTenantEvent` (`workflow-runtime.cedar`), the event-types registry is on
  `m2mV1` (`app.ts:333`).

### Where it runs first

- **Staging Dolios** (NW data, `nwi`) proves the mechanics end to end: sweep → event → one
  instance per order → status query → finishes on invoiced (or the 90-day valve). Same code;
  only the tenant config differs.
- Then **prod RVS QA** (`47addd95…`) after the prod flag flip.

## Later slices (own PRs / plans)

- **5b — pegII billing facts.** An API-key (`m2mV1`) route + SDK
  `get_order_billing(order_num)` → `{deliveredActual, invoices[{invoiceNum, status,
invoiceDate, auditDate}], premiumServices[{id, status, accountStatus, description}]}`,
  read through the existing read-only legacy-SQL executor path (no movemanager release).
  Measure RVS's premium-service status codes first (needs the prod SSO login).
- **5c — movemanager: audit date.** Let the billing role edit Audit Date; saving it emits
  `pegii.invoice.audited` (order, invoice, auditDate) → a Workflow signal. Movemanager lands
  without PRs (dev branch); the RVS site needs the release.
- **5d — BOL received.** Sirva ADE document pull (`ade_document_pull`) → a BOL-received event
  → signal. Blocked on Sirva credentials; own plan.
- **5e — discovery + metrics** (the original Phase 5 items): SDK README, authoring repo
  `CLAUDE.md`, MCP `pegasus://guide/workflows` with `billing_readiness` as the worked example,
  CLI `--help`, OpenAPI; metrics for open Workflows per tenant, signals delivered/failed, the
  wake sweep's launches, Temporal action volume.

## Tests

- Authoring repo: `pegasus-workflows test` for `billing_readiness` against Dockerized Temporal
  (checklist transitions, finish on invoiced, escalation timer, 90-day valve, query), and unit
  tests for the sweep (claim-once, lookback union) with `fake_client`.
- Platform: infra test for the staging flag; any route change gets an integration test.
- Staging acceptance (Dolios): register the event type, publish both, trigger the sweep once
  manually, see N instances on `/workflows`, query one, deliver a `recheck` signal, confirm
  no duplicate start on a second sweep.

## Checklist

- [ ] Plan seeded; parent plan Phase 5 re-targeted to this plan
- [ ] CDK: `CUSTOM_EVENTS_ENABLED` on staging + infra test
- [ ] Verify the custom-event START path (type registry on m2m, START + correlationPath, EmitTenantEvent)
- [ ] Authoring repo: `billing_delivery_sweep` Automation + tests
- [ ] Authoring repo: `check_billing_readiness` Automation (5a: delivered only) + tests
- [ ] Authoring repo: `billing_readiness` Workflow (checklist, query, escalation, valve, continue-as-new) + tests
- [ ] Land platform PR; deploy; staging acceptance on Dolios
- [ ] Docs: DECISIONS, parent plan Resume

## Open questions

1. Escalation: after how many days with no change, and to which role? (default 7 days, billing role)
2. RVS premium-service status codes in use (measure; prod SSO login).
3. Prod flag flip + RVS rollout timing (after the staging proof).

## Risks

- **Runner cost:** a tenant runner does not idle-exit while a durable Workflow is open, so
  RVS's runner stays up permanently once instances exist (~20 open). Acceptable at this
  volume; note it in the rollout.
- **Custom events on prod** opens the event-type registry + emit surface to every prod tenant
  (management needs its own permissions). Review before the prod flip.
- **pegII task writes:** don't `close_task` desktop template tasks from these Workflows
  (legacy triggers stamp actuals).
