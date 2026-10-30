# Event triggers fire in seconds, not up to a minute — kick the dispatcher

Branch: `feat/trigger-dispatch-kick` (worktree `../pegasus-trigger-dispatch-kick`). All changes stay on this branch.

## Problem (measured in prod 2026-10-30, the 11-text burst after #897)

A captured `sms.received` waits for the next dispatcher tick. The dispatcher is an EventBridge `rate(1 minute)` rule (`packages/infra/lib/stacks/api-stack.ts`, `DispatchWorkflowTriggersSchedule`), so:

- **A single text waits 0–60 s, about 30 s on average.** In the burst, the 19:38:33.9 tick ran 0.6 s before the first text committed (19:38:34.5). The texts that fired on the next tick waited 57–59 s.
- **A burst over the 5-run cap waits about a minute per extra batch of 5.** The first 5 runs all finished within about 50 s, but the waiting 6 only started at the next tick. The last text waited **2 m 40 s**.

A dispatcher tick takes 0.2–2 s (prod REPORT durations), so the delay is almost entirely waiting for the schedule.

## Design

Keep the 1-minute tick as the safety net. Add an **asynchronous "kick"**: an `InvocationType: 'Event'` Lambda invoke of the dispatcher, sent at the two moments new work becomes possible.

1. **After capture commits a new `sms.received`.** Path: webhook → SQS → `lambda-ringcentral-capture.ts` → `syncConnection` → `captureMessage`, which emits inside its transaction. The 15-min reconciliation sync (`lambda-ringcentral-sync.ts`) uses the same `syncConnection` and kicks too. The kick is sent after `syncConnection` returns, so the event is committed, and only when the sync emitted at least one `sms.received`. That needs a new `emitted` count alongside `captured`, so syncs that only find outbound texts don't kick.
2. **After a TENANT_RUNNER run reaches a terminal status** (`handlers/workflow-internal.ts`, where the worker reports `markTerminal`), and only if that tenant has an undispatched domain event (one indexed `findFirst`). This frees a cap slot and fires the next waiting event within seconds, not at the next minute.

**One copy at a time: `reservedConcurrentExecutions: 1` on the dispatcher.** Concurrent dispatchers could each count the same free cap slots and both start runs: the cap is counted before starting, not reserved, so a burst could briefly exceed 5. With one copy at a time, a kick that arrives during a tick is throttled, and Lambda's async retry re-delivers it seconds later. **Unblocked by the account quota: 1,000 on both accounts since 2026-05-29.** Reserving 1 leaves 999, well above AWS's 100-unreserved floor.

**A kicked invocation runs only the domain-event phase.** The handler receives `{ source: 'kick' }` and skips:

- the namespace drains (Phase 0);
- the SCHEDULE sweep (Phase 2), so a kick never evaluates a fire-minute (that would be harmless because the id is deterministic, but wasted queries);
- the runner sweep (Phase 3).

`startWorkflowExecution` already launches the runner itself. The EventBridge invocation (`source: 'aws.events'`, or no recognised payload) runs everything as today.

**Async invoke settings on the dispatcher** (`EventInvokeConfig`):

- `retryAttempts: 0`: a failed tick is simply re-run by the next one.
- `maxEventAge: 60 s`: a kick that has waited a minute is redundant with the tick, so it can be dropped.

Both settings also apply to the scheduled invocation. They're acceptable: the next tick is the retry.

**Kick failures never fail the caller.** One helper, `apps/api/src/lib/trigger-dispatch-kick.ts`, `kickTriggerDispatcher(reason)`. It mirrors the existing **`lib/push-forward-invoke.ts`** (`kickPushForwarder`, the move-chat kick): the same lazy `LambdaClient`, the same `set…LambdaClient` test seam, `InvocationType: 'Event'`, the 202 check and warn-and-return-false. Two differences:

- it reads `TRIGGER_DISPATCHER_FUNCTION_NAME` and is a no-op when that is unset (dev, or a stack without Temporal, where the dispatcher doesn't exist);
- it gets a **hard ~2 s client timeout** (`requestHandler` timeout). Callers **await** it, because on Lambda an un-awaited promise is frozen when the handler returns, and the invoke might never be sent. The timeout bounds the added latency on the SQS record and the worker's terminal report.

Both still succeed whatever the kick does; the minute tick covers anything a failed kick missed.

**A hung tick.** A tick that hangs to its 2-min timeout holds the one allowed copy. Kicks and the next scheduled invocation queue behind it, and any that wait 60 s are dropped (`maxEventAge`); recovery is the following scheduled tick. `retryAttempts: 0` also removes today's two automatic retries of a crashed tick. Both are acceptable, because a tick runs every minute regardless.

**Latency the metric doesn't capture.** The verification metric (`execution.created_at − event.occurred_at`) measures dispatch only. Capture adds its own: about 5 s from the webhook to commit in the burst (webhook → SQS → sync). So "a few seconds" is the dispatch step; text-to-run end-to-end is more like 10–15 s.

## Steps (TDD: failing test first for each)

### 1. Kick helper — `apps/api/src/lib/trigger-dispatch-kick.ts`

- [x] `kickTriggerDispatcher(reason: 'sms_received' | 'run_finished')` sends an async `InvokeCommand` with payload `{ source: 'kick', reason }`. Model it on `push-forward-invoke.ts`, plus the ~2 s timeout.
- [x] Tests, mirroring `push-forward-invoke`'s:
  - no env means no client call;
  - a send rejection is swallowed and warn-logged;
  - a non-202 returns false;
  - **a hung send resolves within the timeout, never hangs**;
  - the payload and `InvocationType: 'Event'` are correct.

### 2. Capture kicks — `services/ringcentral/sync.ts`, `lambda-ringcentral-capture.ts`, `lambda-ringcentral-sync.ts`

- [x] `captureMessage` reports whether it emitted. `syncConnection` returns `{ captured, emitted }`.
- [x] Both Lambda handlers **await** `kickTriggerDispatcher('sms_received')` once per handler invocation, before returning, when the total emitted is above 0. That's once per batch, not once per message.
- [x] Tests:
  - emitted > 0 kicks exactly once per batch;
  - emitted = 0 doesn't kick;
  - a failed kick doesn't fail the SQS record.

### 3. Run-finished kick — `handlers/workflow-internal.ts`

- [x] After `markTerminal`: if the workflow routes TENANT_RUNNER and the tenant has an undispatched `domain_events` row, **await** `kickTriggerDispatcher('run_finished')` before responding. It sits after the DB writes, and its failure can't change the response; the 2 s timeout bounds the delay.
- [x] Tests:
  - a runner run with waiting events kicks;
  - no waiting events means no kick;
  - a STDLIB run doesn't kick;
  - a kick failure still returns success.
  - Also note in a test that an event waiting behind a namespace migration triggers a kick too. That's harmless: the kicked tick excludes migrating tenants at the query.

### 4. Dispatcher — `lambda-dispatch-workflow-triggers.ts`

- [x] `handler(event?)`: `{ source: 'kick' }` runs Phase 1 only. Anything else runs every phase, as today. Log `source` on "Dispatch tick finished".
- [x] Module header: event triggers fire within seconds of capture (kick), with the minute tick as the safety net. Note the one-at-a-time guarantee the cap check now relies on.
- [x] Tests:
  - a kick skips the schedule query, the namespace drains and the runner sweep;
  - a scheduled event runs all phases;
  - an empty event behaves like a schedule event (backward compatible).

### 5. Infra — `packages/infra/lib/stacks/api-stack.ts`

- [x] Hoist `let dispatchTriggersFunction: NodejsFunction | undefined` out of the Temporal-configured block, so the capture, sync and api functions can reference it when it exists.
- [x] Dispatcher: `reservedConcurrentExecutions: 1`, plus `configureAsyncInvoke({ retryAttempts: 0, maxEventAge: Duration.seconds(60) })`.
- [x] When the dispatcher exists, the capture, sync and api functions each get `dispatchTriggersFunction.grantInvoke(fn)` and `TRIGGER_DISPATCHER_FUNCTION_NAME`.
- [x] Infra tests:
  - reserved concurrency 1 and the EventInvokeConfig;
  - the invoke grant plus env on all three callers;
  - without Temporal props, no grant and no env (and synth still passes).
- [x] **Infra snapshots:** none needed. `api-stack.test.ts` uses fine-grained assertions; the only snapshot in `__snapshots__/` is the Cognito stack.

### 6. Docs / surfaces

- [x] SDK README, reply-automation section: replace "within about a minute of the text arriving" with "usually within a few seconds (at most about a minute)". Bump the SDK to **0.54.2** (docs-only) and add a CHANGELOG entry. _As built, the README says "about 10–15 seconds … at most about a minute", because it is text-to-start: capture adds about 5 s before dispatch. It also says a waiting burst text fires "within seconds of a slot freeing"._
- [x] `openapi-spec.ts`: no latency promise today (grep for "about a minute", "within a minute" and "~1 min" found only README:423), so there's nothing to change. Re-check at implementation time.
- [x] `dolas/agents/project/GOTCHAS.md`: a short entry. The cap is counted before starting, not reserved, so it is only correct with a single dispatcher; `reservedConcurrentExecutions: 1` is what guarantees that. Don't remove it without making the cap count atomic.
- [ ] Memory: `project_sms_received_event.md` latency note (after merge).

## Verification after deploy (prod, read-only)

- [ ] Publish SDK 0.54.2: tag `sdk-python-v0.54.2` on the merge commit.
- [ ] The dispatcher configuration shows `ReservedConcurrentExecutions: 1`.
- [ ] One test text (user sends): `nw_pulse_reply` execution `created_at − occurred_at` is **under 10 s**. Logs show a tick with `source: kick`.
- [ ] A burst of 11 test texts (user sends, with the user's OK as before): all 11 complete. The last one waits about one run's duration past the first batch, not 2 m 40 s. No run starts while 5 are active (the cap holds).
- [ ] No sustained `Throttles` on the dispatcher beyond kick collisions. `Errors` stays 0. `DomainEventDispatchBacklog` stays 0.

## Decisions (approved by the user 2026-10-30, all defaults)

1. **Kick on run-finished too, not only on capture?** _Default: yes._ Without it, bursts over 5 still wait a minute per batch.
2. **A kick runs the event phase only?** _Default: yes._ It's cheaper, and it never touches SCHEDULE fire-minutes.
3. **Async invoke `retryAttempts: 0` and `maxEventAge: 60 s` on the dispatcher, applied to the scheduled tick too?** _Default: yes._ The next tick is the retry.

## Out of scope

- Kicking from other domain-event emitters (`quote.accepted` etc.). The helper is reusable; wiring each emitter is a follow-up if anyone needs sub-minute latency there.
- Making the cap check atomic (a reservation row, or an advisory lock). Running one dispatcher at a time makes it unnecessary for the dispatcher. The manual `POST /workflows/:id/run` path keeps its existing small race, unchanged.
- The dry-run-capped follow-up from #897 (a separate `dryCappedTenants` set).
