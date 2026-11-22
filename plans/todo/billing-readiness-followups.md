# Billing readiness Workflow (RVS) — follow-ups after 5a

- **Parent:** Phase 5 of `plans/in-progress/long-running-workflows-and-automations.md`.
- **5a (shipped):** custom events on staging, SDK 0.67.1 event-type registry, and the
  workflows in pegasus-workflows `reliable/billing_readiness/`. Decisions, measurements and
  the 5a design: `plans/completed/*-billing-readiness-workflow.md` and the DECISIONS.md entry
  "Phase 5 proves durable Workflows on RVS billing readiness".
- **The checklist:** delivered · premium services authorized · signed BOL submitted ·
  audit date set · invoiced (done). COD and Allied alike. Start when planned or actual
  delivery is on or before today; end when invoiced.

## Next: staging acceptance on Dolios (after the 5a deploy + SDK 0.67.1 publish)

Dolios is the staging E2E-gate tenant (NW data). **Ask Steve before publishing there**
(platform sessions don't publish workflows by default), and terminate the test instances
afterwards (open instances keep the tenant runner up).

- [ ] `GET /api/v1/event-types` answers (flag on) with a `workflow_developer` key.
- [ ] `event-types create billing.delivery_due --schema event-schema.json`.
- [ ] Publish both workflows; set `SWEEP=off`, `ONLY_ORDERS=<2–3 recent NW orders>`.
- [ ] Manual sweep run → reports exactly those orders; `SWEEP=on` → manual run emits them.
- [ ] EVENT trigger `mode=START`, `correlation_path=payload.orderNum`,
      `signal_name=delivery_due` → one instance per order on `/workflows`.
- [ ] `status` query shows the checklist (delivered met for a delivered order).
- [ ] `recheck` signal re-checks at once.
- [ ] A second sweep run emits nothing (claims hold); no rejected START in the dispatcher.
- [ ] Terminate the test instances; record the run here.

## Rollout gates (RVS — prod)

- **Prod flag flip** (`customEventsEnabled` for prod in `packages/infra/bin/app.ts`) only
  after the Dolios acceptance, with Steve's approval. It opens the event-type registry and
  emit to every prod tenant (management still needs `ManageEventTypes`).
- **Keep `ONLY_ORDERS` set until 5b ships**: without "invoiced" every instance lives
  `MAX_OPEN_DAYS` (~5/day × 90 ≈ 450 open vs the 500 cap).
- **Keys are single-use for life**: an RVS order run through a 5a instance never gets a
  5b one. Don't pilot 5a on orders that should be tracked for real.

## Slices

- [ ] **5b — pegII billing facts.** An API-key (`m2mV1`) route + SDK
      `get_order_billing(order_num)` → `{deliveredActual, invoices[{invoiceNum, status,
    invoiceDate, auditDate}], premiumServices[{id, status, accountStatus,
    description}]}`, through the existing read-only legacy-SQL executor path (no
      movemanager release). Then the check activity fills `premiumServicesAuthorized`,
      `audited`, `invoiced`. First measure RVS's `PremiumServiceDetail.status` codes in use
      (prod SSO login; aggregates only). Invoices join on `invoicemaster.rvs_job` at RVS —
      check the job-column name per tenant (`<client>_job`).
- [ ] **5c — movemanager: audit date.** Let the billing role edit Audit Date (today only
      the Wizard role can; `InvoiceMaster_BlockOfKeyDatesEditUserControl.vb:44`); saving it
      emits `pegii.invoice.audited` (order, invoice, auditDate) → a `audited` signal (declare
      it in the manifest). Movemanager lands without PRs; RVS needs the site release. RVS
      billing must start entering it (0 rows ever set).
- [ ] **5d — BOL submitted.** Sirva ADE document pull (`ade_document_pull`) → a
      BOL-received event → signal. Blocked on Sirva credentials; own plan.
- [ ] **5e — discovery + metrics** (the parent plan's remaining Phase 5 items): authoring
      repo `CLAUDE.md` (event-type registry + the sweep → keyed START pattern), MCP
      `pegasus://guide/workflows` with `billing_readiness` as the worked example, CLI
      `--help`, OpenAPI; metrics for open Workflows per tenant, signals delivered/failed, the
      wake sweep's launches, Temporal action volume.

## Open questions

1. Escalation: after how many days with no change, and which RVS role? (default 7 days;
   `ESCALATE_ROLES` empty = never.)
2. RVS premium-service status codes in use (5b).
3. Prod flag flip + RVS rollout timing.

## Risks

- A tenant runner doesn't idle-exit while a durable Workflow is open → RVS's runner stays
  up once instances exist.
- Don't `close_task` desktop template tasks from these workflows (legacy triggers stamp
  actuals).
