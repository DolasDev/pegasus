# Reconciler: settle stranded QUEUED durable rows (frees stranded `wfl/` keys)

- **Branch:** `fix/reconcile-stranded-queued`
- **Status:** built 2026-11-11 (Steve: "fix the stranded wfl/ key in the reconciler").
- **Parent:** `plans/completed/f5d5a31f-workflow-signal-delivery.md` Risks
  ("A stranded key (known, not fixed here)").

## Problem

Both reconciler lanes read `status: 'RUNNING'` only. A durable row is inserted
QUEUED and moved to RUNNING right after Temporal accepts the start, so a start
that never happened (crash between insert and start, or a failed cleanup)
leaves it QUEUED forever. It holds an open-Workflow slot and keeps the runner
sweep wanting a runner; for an event-routed `wfl/` key it is found as "the open
instance" by every later event — each delivery fails NOT_RUNNING, the key is
stranded.

## Fix

A third reconciler lane: `status QUEUED`, `kind WORKFLOW`, `queuedAt` older than
10 min (only the API, 29 s, and the trigger dispatcher, 2 min, can be mid-start
— so no start is in flight and closing the row can't race `markStarted`, which
has no status predicate), oldest first, 100 per tick. For each row, describe the
instance (the row's `temporalWorkflowId`, or the derivable manual-run id
`wf/<tenant>/<name>/<executionId>` when it never recorded one):

| Temporal says                                                           | Row becomes                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| not found                                                               | FAILED "Not started: … no Temporal instance exists" — frees the key                                                |
| found, `memo.executionId` names ANOTHER row                             | FAILED "Not started: … belongs to execution X" (never adopt an orphan — two RUNNING rows on one instance)          |
| found, ours (or no memo: pre-#944 start of its own id), running         | RUNNING, `temporalRunId = firstRunId` (fallback `runId`), `startedAt = startTime`                                  |
| found, no memo, but ANOTHER row already tracks the id (status ≠ QUEUED) | FAILED "Not started: … execution X already tracks its Temporal instance" (a pre-#944 NEW-mode `wf/…/trg/…` orphan) |
| found, ours, closed                                                     | its terminal status + result / error                                                                               |

Every write is `updateMany({ id, status: 'QUEUED' })`. Never-started closes emit
`Pegasus/Workflows WorkflowExecutionNeverStarted` (its own series — each is a
crashed start; no alarm in this change); a full batch logs a backlog warning.

Also: `POST …/executions/:id/retry` refuses a keyed instance (`wfl/…`) — 409
`EXECUTION_NOT_RETRYABLE`, since a retry would start an UNKEYED copy that no
event for the key reaches. SDK 0.62.1 docs (docstring + README), OpenAPI text.

## Out of scope

Automation QUEUED rows strand the same way (and hold a concurrency-cap slot) —
same lane shape would work, but their crash recovery is the runner write-back
contract; a separate decision. The dispatcher keeps NOT_RUNNING final: with this
lane the key frees itself within ~10 min and the next event STARTs.

## Checklist

- [x] QUEUED lane in `lambda-reconcile-workflow-executions.ts` + tests (not
      found, adopt, orphan, closed, derived id, firstRunId fallback, Temporal
      error, lost race, query shape).
- [x] Retry refuses `wfl/` rows + test; OpenAPI + SDK docstring + README.
- [x] SDK 0.62.1 (pyproject, uv.lock, CHANGELOG); DECISIONS signals entry.
- [ ] After merge + Deploy: tag `sdk-python-v0.62.1` on the merge commit.
