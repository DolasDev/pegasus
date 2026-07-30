# Chore — Close out finished plans in `plans/in-progress/`

**Branch:** `chore/plans-cleanup`
**Status:** COMPLETE — 2026-07-30. 17 of 30 plans archived, 13 annotated and kept
open. Outcome recorded at the bottom of this file.

## Problem

`plans/in-progress/` has accumulated 30 plan files, many of which describe work
that has already shipped to `main` (and in several cases to prod) months ago.
The directory is meant to be the live picture of what is actually in flight, so
a stale backlog there makes `/workstream-board` and any "what's open?" question
misleading. `plans/completed/` already holds 136 archived plans — the convention
exists, it just hasn't been applied to these.

## Goal

For every file in `plans/in-progress/`, decide **shipped** vs **still open**, and
`git mv` the shipped ones to `plans/completed/`. Nothing else changes — no code,
no plan content rewrites beyond a status line where one is clearly wrong.

## Approach

1. **Fan out the assessment.** Batch the 30 plans across parallel subagents.
   Each agent gets a slice, and for each plan must decide from _evidence_, not
   from the plan's own prose:
   - `git log --oneline main` for the PR/commits the plan describes
   - the actual code/config the plan says it would add — does it exist on `main`?
   - the plan's own checklist / "Status" markers, treated as a hint only
2. **Classify** each plan as one of:
   - `DONE` — every deliverable is on `main`. → move to `plans/completed/`
   - `PARTIAL` — some phases shipped, some not. → stays in `plans/in-progress/`,
     with a one-line note recording which phases remain
   - `OPEN` — not started or barely started. → stays put, untouched
   - `STALE` — superseded or abandoned. → flag for the user, do **not** move
     unilaterally
3. **Verify before moving.** Spot-check the `DONE` verdicts against `git log`
   myself; a subagent's "looks shipped" is not sufficient to archive a plan.
4. **Move + commit.** `git mv` the confirmed `DONE` set into `plans/completed/`
   in one commit, with the commit body listing each plan and the PR/commit that
   closed it.

## Non-goals

- Rewriting or summarizing plan content.
- Touching `plans/todo/`, `plans/deferred/`, `plans/archive*/`, `plans/done/`,
  or `plans/sdk/`. (Note: the coexistence of `completed/`, `done/`, `archive/`
  and `archived/` is its own mess — surface it, don't fix it here.)
- Any application code change. This PR is plans-only.

## Acceptance

- [x] Every plan in `plans/in-progress/` has a recorded verdict.
- [x] Confirmed-shipped plans are in `plans/completed/`, moved with `git mv`
      (history preserved).
- [x] Plans left in `in-progress/` are genuinely in flight, with `PARTIAL` ones
      annotated with what remains.
- [x] `STALE` / ambiguous cases are reported to the user rather than moved.
- [x] One PR, plans-only diff, landed through the merge queue.

## Outcome

30 plans reviewed by 8 parallel agents, each verdict backed by repo evidence
(does the code exist on `main`?) rather than the plan's own checkboxes — which
turned out to be stale in **both** directions. Every cited commit was then
re-verified with `git merge-base --is-ancestor` before anything moved.

### Archived — 17 shipped plans → `plans/completed/`

| Plan                                                     | Closed by       |
| -------------------------------------------------------- | --------------- |
| `2026-07-14-clone-platform-integrations-into-tenants.md` | #425 `55d0d683` |
| `benign-workflow-test-mode.md`                           | #423 `a73861d9` |
| `feedback-requests.md`                                   | #522 `bbdbd1ef` |
| `tariff-import.md`                                       | #472 `76b0e744` |
| `clear-ready-date.md`                                    | #486 `255d5923` |
| `dispatcher-active-filter.md`                            | #481 `a469865e` |
| `driver-typeahead-filter.md`                             | #512 `890a8c8e` |
| `integration-config-delete.md`                           | #509 `60fe4372` |
| `nav-active-highlight.md`                                | #471 `17d50f21` |
| `organisation-spelling.md`                               | #480 `6877dbf2` |
| `us-spelling.md`                                         | #485 `0fbe1814` |
| `pegii-order-native.md`                                  | #489 `6eea9de5` |
| `presignup-idempotent.md`                                | #516 `5d709e29` |
| `remove-availability-variant-c.md`                       | #490 `5ae4514a` |
| `show-password-toggle.md`                                | #492 `92abd68e` |
| `sso-account-mismatch.md`                                | #494 `98397de5` |
| `trip-notes-visibility.md`                               | #469 `1767a059` |

### Kept open — 13, each annotated in place with a dated cleanup-audit note

The 12 `audit-*` plans (11 units plus the master index) and
`legacy-outbox-relay-setup.md`. Each now carries a
`> **Cleanup audit 2026-07-30 …**` blockquote stating what verifiably shipped
and what is genuinely left, so the next reader doesn't re-audit.

### Root cause

Nearly every archived plan was **committed into `plans/in-progress/` by its own
implementing PR** and never `git mv`'d on merge — so a finished plan looks
identical to a live one. `/workstream-finish` is the intended remedy; this is
also exactly what `audit-ai-process-automation.md` Phase 4
(`scripts/plans-hygiene.sh`) was scoped to automate.

### Findings worth acting on separately

1. **`apps/temporal-worker` has no CI gate at all.** Its ~480 lines of tests run
   in no workflow, and its image builds and pushes to staging _and prod_ ECR
   with no test or lint step. Highest-value item left in the audit set
   (`audit-python-toolchain.md`).
2. **`legacy-outbox-relay-setup.md` is a code-referenced runbook whose SNS half
   is retired.** `outbox-relay-stack.ts:29` and `bin/app.ts:202` both cite the
   path, so it cannot simply be moved; its publish-target sections need a
   rewrite for `events:PutEvents` after the #358 EventBridge cutover.
3. **26 open CodeQL alerts, 0 dismissed** — the sole live item in
   `audit-security-supply-chain.md`; better tracked as an issue.
4. **Four archive directories coexist**: `completed/` (the convention),
   plus legacy `done/` (5), `archive/` (1), `archived/` (18). Consolidating them
   is `audit-ai-process-automation.md` Phase 1 and was left alone here.
5. **`audit-ci-pipeline-efficiency.md` and `audit-local-dev-experience.md` are
   each one small item from archivable** — an optional deferred AI workflow and
   a 10-minute DECISIONS.md note respectively.
