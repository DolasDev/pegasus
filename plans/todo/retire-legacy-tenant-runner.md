# Retire the legacy tenant runner (3b.2 follow-up)

- **Status:** TODO, **blocked** (see "Blockers"). Not approved; the design
  decision below is the user's.
- **Branch:** none yet. When unblocked: `scripts/new-worktree.sh chore retire-legacy-tenant-runner`.
- **Goal:** no tenant runner holds the shared Temporal key. Remove the legacy
  task definition `pegasus-tenant-runner-<env>` and the shared
  `TEMPORAL_CLOUD_API_KEY` from runners. This completes 3a's "no Admin key in
  runners" (`plans/in-progress/durable-workflow-worker.md`).
- **Carved out of** 3b.2 (`plans/completed/00dc33f0-tenant-temporal-routing.md`,
  its "Later, separate PR" item). Read its "Design" section first: the
  state machine, runner families and per-row namespace are what this changes.
- **Written:** 2026-11-03, against `main` @ `00dc33f0`.

## Blockers (re-checked 2026-11-03)

Every tenant with executable Automations must be `ACTIVE` (or have its
Automations retired) before the legacy family can go. Re-run on **both** envs
before starting:

```sql
select t.name, count(distinct w.name) from workflows w join tenants t on t.id = w.tenant_id
where w.executable and w.status = 'ACTIVE' and w.name <> 'send_quote_followup'
  and w.tenant_id not in (select tenant_id from tenant_temporal_namespaces where status = 'ACTIVE')
group by 1;
```

`send_quote_followup` is excluded on purpose: it is a curated (STDLIB)
workflow, which always runs in the platform namespace and is never rerouted.
Don't "fix" the exclusion.

| Env     | Tenant                             | Tenant id                              | Automations                        | Namespace row                                                          |
| ------- | ---------------------------------- | -------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------- |
| prod    | Nelson Westerberg Test             | `32dd89be-72b3-4038-a54e-9c520ca4547e` | 2                                  | none (not migrated, by the user's choice)                              |
| staging | AVP Smoke 2026-05-08               | `4b2e0267-c597-451e-a367-771dfac52fba` | 1 (`smoke_canary` fork `ad780834`) | none (deprovisioned after 3b.2 acceptance; the staging table is empty) |
| staging | Dolios (E2E Tests - DO NOT DELETE) | `b40b082e-1932-4182-a081-47b7df363276` | 2                                  | none                                                                   |

- The E2E suite (`apps/e2e`) does not run Automations, so the staging E2E
  tenant's two are leftovers from manual work (CLI profile `qa`), not a test
  dependency. Confirm before retiring them.
- DB access recipe and AWS SSO notes: the archived 3b.2 plan, "Gotchas for
  whoever resumes".

## Decision needed (user)

What happens to a tenant **without** an ACTIVE namespace once the legacy
family is gone?

- **A. Provisioning + cutover become a prerequisite of running an
  Automation.** Publishing (or the first run) refuses with a clear error until
  the tenant is ACTIVE, or the platform provisions and cuts over on first
  publish. Cost: every tenant that ever publishes takes one of the
  **100 namespaces shared by staging and prod** (see GOTCHAS "Temporal Cloud
  Ops"). 5 are in use per our DB on 2026-11-03 (the 5 prod ACTIVE rows; staging has none).
- **B. Keep the legacy family** for tenants without a namespace. The shared
  key stays in that task definition, so 3a's goal is not met. This plan then
  shrinks to "nothing to do".

## Touchpoints (if A)

- [ ] `apps/api/src/lib/tenant-runner.ts`: `ensureTenantRunner` loses the
      `legacy` family; the sweep's (tenant, family) demand and the pool metric
      become single-family. Rows with `temporal_namespace = NULL` that are still
      open at deploy time need a story: drain them first (block the deploy on
      the blocker query returning zero, plus zero open shared-namespace
      TENANT_RUNNER rows).
- [ ] `apps/api/src/lib/start-workflow-execution.ts`: the no-row / READY path
      for TENANT_RUNNER starts (today it goes to the shared namespace) becomes
      a refusal or a provision-then-cutover.
- [ ] The cutover/rollback state machine: does `ROLLBACK` (ACTIVE → REVERTING
      → READY) still make sense with no legacy runner to fall back to?
- [ ] `packages/infra/lib/stacks/temporal-worker-stack.ts`: drop
      `pegasus-tenant-runner-<env>` and its `TEMPORAL_*` env + `secrets`;
      `api-stack.ts`: drop the legacy `TENANT_RUNNER_TASK_DEFINITION` wiring and
      RunTask coverage. Infra tests.
- [ ] `apps/tenant-runner/pegasus_tenant_runner/config.py`: **env mode stays**
      (local dev runs against Dockerized Temporal with env config); only the
      deployed legacy task definition goes.
- [ ] SDK boundary (CLAUDE.md): if A changes what publish/run returns for a
      tenant without a namespace, expose it as a typed error and document it in
      the SDK README, `~/repos/pegasus-workflows/CLAUDE.md`, MCP guide, OpenAPI.
- [ ] `dolas/agents/project/DECISIONS.md`; tick 3a's item in
      `plans/in-progress/durable-workflow-worker.md`.

## Also carried from the 3b.2 prod rollout

- [ ] **Dolios:** verify its first run after the 2026-11-03 cutover lands in
      `pg-prod-a90b22bc4393.chgel` on a scoped runner (`runner-scoped/` log
      stream). As of 2026-11-03 it has 11 executable Automations, no enabled
      triggers and no runs since cutover. Hermes, Quality Move Management and
      Reliable Van have no executable Automations; their first publish runs in
      their own namespace.
- [ ] Staging AVP Smoke: revoke the `avp-smoke` CLI key (`workflow_developer`)
      if the user doesn't want it.

## Risks

- A legacy runner image/task def removed while a shared-namespace row is still
  open strands that run until the reconciler fails it. Gate the deploy on zero
  open shared TENANT_RUNNER rows.
- The 100-namespace cap (option A) is account-wide across staging and prod.
