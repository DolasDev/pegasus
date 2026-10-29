# Fix: EVENT triggers that hit the tenant-runner concurrency cap are lost forever

Branch: `fix/trigger-concurrency-defer` (worktree `../pegasus-trigger-concurrency-defer`). All changes stay on this branch.

## Problem (found in prod 2026-10-28, verifying #895)

NW's first post-#895 sync captured 6 inbound texts in one batch. The dispatcher fired `nw_pulse_reply` (trigger `d53b5633`) for 5 of them. The 6th, event `d7003e2a` (18:03:33Z, from …0005), came back `CONCURRENCY_LIMIT` (5 of 5 tenant-runner runs active). `lambda-dispatch-workflow-triggers.ts` (`fireTrigger`, `case 'CONCURRENCY_LIMIT'`) treats that as a logged skip and **stamps `dispatchedAt` anyway**, so the event is never retried. That customer's reply was never processed, and nothing alerted anyone.

This was a deliberate Phase 3 Unit 10 contract ("the tenant is over-capacity, not failing"), pinned by the test `CONCURRENCY_LIMIT: … event stamped`. For a reply-handling automation that contract is wrong: the cap is a _rate_ limit, and a burst of more than 5 events per tick loses every event past the 5th. The module header's "domain events … are never lost to a missed tick" is also untrue for this case.

## Design

Treat the cap as **back-pressure**: leave the event undispatched and fire it when the tenant has headroom. Reuse the existing `TENANT_MIGRATING` → `'DEFERRED'` path. It already leaves the whole event unstamped, and on redelivery the deterministic-id pre-check absorbs any of the event's other triggers that did fire.

Two guards keep that from becoming a new outage:

1. **Fairness (GOTCHAS: "A global oldest-first outbox drain + an infinite park").** The drain takes the 100 globally oldest undispatched events. If a capped tenant's parked events are loaded, 100 of them would fill every batch and starve every other tenant. So capped tenants are excluded **at the query**, exactly like `migratingTenantIds`:
   - Before the event query, one `groupBy` over `workflow_executions` finds the tenants at or over the cap. It uses the same lane filter as `countTenantRunnerActiveExecutions`: QUEUED/RUNNING, `dryRun: false`, executable, not curated.
   - Mid-tick, the first `CONCURRENCY_LIMIT` adds the tenant to an in-tick `Set`. Its later events in the same batch defer without calling `startWorkflowExecution`. That saves 1 count query, 1 rejection metric and 1 warn log per event.
2. **A bounded park (it must exhaust).** An event parked longer than `CONCURRENCY_DEFER_MAX_AGE` (**proposed 24 h**, measured from `occurredAt`) is stamped as dropped. It logs an error and emits `WorkflowTriggerSkipped{Reason=CONCURRENCY_DROPPED}` (as built, a reason of its own, so `CONCURRENCY_LIMIT` stays SCHEDULE-only). The bound must stay under the 72 h body retention. (Corrected in review: the purge skips undispatched events, so a parked event keeps its payload body. But `messages.body`, which a reply workflow may re-read via the API, is purged at 72 h regardless.) The query excludes a capped tenant's events only while they are younger than the bound, so expired ones still load and get stamped. A tenant with 5 runs stuck RUNNING therefore can't park its events forever.

A deferral emits a new skip reason, `CONCURRENCY_DEFERRED`. It fires about once per event per cap episode: the query exclusion stops repeats across ticks, and the in-tick set stops repeats within one.

**Unchanged, deliberately:**

- **`DAILY_QUOTA_EXCEEDED` stays stamped (dropped).** Deferring it would park until midnight UTC and then release a herd at 00:00. The park also never exhausts within the day, which is the GOTCHAS anti-pattern. _Decision for the user (default: keep dropping)._
- **SCHEDULE triggers.** A capped fire-minute remains a skipped minute, matching the documented no-catch-up contract and the migrating case.
- **Manual `POST /workflows/:id/run`** still returns 429.
- **The cap value stays 5.** This fix makes the cap delay events instead of losing them; raising the number is a separate decision.

## Steps (TDD: failing test first for each)

### 1. Shared lane filter — `apps/api/src/lib/start-workflow-execution.ts`

- [x] Extract the `where` of `countTenantRunnerActiveExecutions` into one helper. Export `findTenantsAtRunnerConcurrencyCap(db): Promise<string[]>` (a `groupBy tenantId` with `_count`, filtered to ≥ `TENANT_RUNNER_CONCURRENCY_CAP`). The dispatcher and the per-start check then share one filter, and the curated-names list isn't duplicated.
- [x] Test: dry runs, STDLIB-lane runs and terminal runs don't count, and a tenant at exactly 5 is returned.

### 2. Dispatcher — `apps/api/src/lambda-dispatch-workflow-triggers.ts`

- [x] `fireTrigger`: `CONCURRENCY_LIMIT` returns `'CAPPED'`, with no skip metric there. The EVENT caller decides defer vs drop by event age. SCHEDULE keeps today's `skip('CONCURRENCY_LIMIT')`.
- [x] Event query: add `NOT: { tenantId: { in: capped }, occurredAt: { gt: now − MAX_AGE } }` next to the migrating exclusion.
- [x] Event loop: the in-tick `cappedTenants` set. If a matching trigger is capped and the event is younger than `MAX_AGE`, skip `CONCURRENCY_DEFERRED`, mark the event deferred and leave it unstamped. If it is older, skip `CONCURRENCY_DROPPED` (a separate reason, so `CONCURRENCY_LIMIT` keeps meaning SCHEDULE skipped-minutes only), log an error and stamp it.
- [x] Add `'CONCURRENCY_DEFERRED'` to `TriggerSkipReason`. Update the `case` comment and the module header (the "never lost" claim, plus a back-pressure paragraph next to the 3b.2 one).

### 3. Tests — `apps/api/src/__tests__/lambda-dispatch-workflow-triggers.test.ts`

- [x] **Invert** `CONCURRENCY_LIMIT: … event stamped`: the event is NOT stamped, and `CONCURRENCY_DEFERRED` is emitted. Rewrite the `limit-rejection` describe comment, which states the old contract as spec. `DAILY_QUOTA_EXCEEDED` keeps its stamped assertion.
- [x] Burst: 7 same-tenant events with 4 active means 1 start, 6 events unstamped and exactly one rejected `startWorkflowExecution` (the in-tick set).
- [x] An event with two triggers where one fires and one is capped is unstamped. On redelivery the fired trigger hits `DUPLICATE` and the capped one fires.
- [x] The query excludes the capped tenant's young events but still loads another tenant's. Assert on the `findMany` `where` (the harness needs a `groupBy` mock).
- [x] An event older than `MAX_AGE` that is still capped gets stamped, an error log and `CONCURRENCY_DROPPED`.
- [x] Derivation (Unit 8) does not run for a deferred event, and runs once it is finally stamped.
- [x] SCHEDULE at the cap behaves as before.
- [x] **Added in self-review:** multi-pass fairness. A tenant one run under the cap isn't excluded, so its 100 parked events could fill a batch (1 fires, 99 re-park, other tenants wait, and the `pegasus-domain-event-dispatch-backlog` alarm, threshold > 0, fires). A full pass that newly parks a tenant re-queries without it (`MAX_EVENT_PASSES = 3`). Tested both ways: a re-query when a full pass parks someone, and none when it parks no one.

### 4. Docs / surfaces

- [x] `dolas/agents/project/GOTCHAS.md`: a short entry on this incident, cross-referenced to the infinite-park entry ("a retry-later state needs query-level exclusion + a bound").
- [x] SDK discoverability (CLAUDE.md rule). Done: README + OpenAPI sentence, SDK bumped to **0.53.2** (docs-only). The SDK README's reply-automation section (~"within about a minute of the text arriving") and `openapi-spec.ts`'s limits description gain one sentence: _EVENT-trigger runs over the 5-run cap are delayed until a slot frees (up to 24 h), not dropped; the daily quota still drops._
- [ ] Memory `project_sms_received_event.md`: mark the drop as fixed (after merge).

## Verification after deploy (prod, read-only)

- [ ] Publish SDK 0.53.2: tag `sdk-python-v0.53.2` on the merge commit.
- [ ] Dispatcher logs show no `CONCURRENCY_DROPPED` errors. Any `CONCURRENCY_DEFERRED` skip is followed, within minutes, by an execution whose temporal id carries that event id.
- [ ] On the next NW burst of more than 5 texts (or a deliberate one: 6+ test texts from a test phone to NW's number, _only with user OK_), every `sms.received` gets an `nw_pulse_reply` execution, and `dispatched_at` stays null until its run starts.
- [ ] `d7003e2a` itself is NOT replayed. It is already stamped, and re-processing a 1-day-old reply is the user's call (a one-row `UPDATE … SET dispatched_at = NULL` would redeliver it).

## Decisions (approved by the user 2026-10-29, all defaults)

1. **Max park age:** 24 h. It must stay under the 72 h body purge.
2. **Daily quota:** keep dropping.
3. **Replay `d7003e2a`:** no.

## Known gaps (documented in the module header)

- **Cap and quota at once.** The run path checks the cap BEFORE the daily quota. An event arriving while its tenant is at both parks instead of dropping, and may fire after the quota resets at midnight UTC. It releases in batches of at most 5, so there is no herd.
- **Curated triggers wait with the event.** The query exclusion holds the whole event, so a curated (STDLIB) trigger on a capped tenant's event waits too. Only the in-tick short-circuit is curated-aware. The same holds for a capped tenant's events that match no trigger at all: Unit 8 derivation of custom events from them waits until the tenant drops under the cap (at most 24 h). They are delayed, never dropped, because the drop path only stamps events that had a capped trigger.

## Out of scope

- Raising or per-tenant-configuring the cap.
- Alarming on `CONCURRENCY_DROPPED`. Today it is dashboard-only (`monitoring-stack.ts` Workflows dashboard); an alarm can follow once the drop path is rare.
