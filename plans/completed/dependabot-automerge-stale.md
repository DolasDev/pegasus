# Fix: Dependabot auto-merge goes stale and never enters the merge queue

## Problem

No Dependabot PR has auto-merged since the `merge-queue-main` ruleset was created
on **2026-06-15**. The last ones to land on their own were #260–#266 (2026-06-15).
Everything since has piled up — #596/#597 sat `CLEAN` for six days and only merged
on 2026-08-13 because they were re-triggered by hand.

### Root cause

`.github/workflows/dependabot-auto-merge.yml` triggers `on: pull_request` and runs
`gh pr merge --auto --squash` within seconds of the PR opening (or being rebased) —
always **before** CI has gone green. Job log for #597, run `31718980346`:

```
16:06:34  Run gh pr merge --auto --squash "$PR_URL"
16:06:38  ! The merge strategy for main is set by the merge queue
```

The step exits 0 and the auto-merge request is created. But once a merge queue
governs the branch, GitHub's **async auto-merge completion path never re-evaluates
that request** when the PR later becomes mergeable — so the PR never enters the
queue. Corroborated by GitHub community discussion #190610 (auto-merge/ruleset
behavior change of 2026-03-25; the follow-up comment describes the async path
failing to re-check).

Re-issuing `gh pr merge --auto` on an already-enabled PR is a **no-op** — it does
not refresh the stale request. Only `--disable-auto` followed by `--auto` creates a
fresh request, which is then evaluated immediately and enters the queue. Verified
twice in this repo (#596 and #597, both entered at position 1 within seconds).

### Red herring — do not chase

`autoMergeRequest.mergeMethod` reports `MERGE` on every Dependabot PR while the
queue requires `SQUASH`. This is **cosmetic**: when a merge queue governs `main`,
the queue's method wins. The workflow already passes `--squash` correctly.

## Approach

Keep the existing `pull_request` job exactly as the **policy gate** — it is what
decides (via `dependabot/fetch-metadata`) that a PR is a semver minor/patch bump
and enables auto-merge. Add a second job that makes that decision _effective_ by
re-asserting the request at the moment the PR is actually green.

The existing auto-merge request doubles as the "policy already approved this PR"
marker, so the new job never needs to re-run `fetch-metadata`.

### New job: `enqueue`

Triggers:

- `workflow_run` on **CI** `types: [completed]`
- `workflow_dispatch` with a `pr` input — a manual unstick lever, also the test hook

Guards, in order:

1. Job-level `if`: `workflow_run.conclusion == 'success'` **and**
   `workflow_run.event == 'pull_request'` — filters out `merge_group` and
   push-to-`main` CI completions, and prevents any re-trigger loop.
2. Resolve the PR from `repos/{owner}/{repo}/commits/<head_sha>/pulls` as the
   **primary** path (`workflow_run.pull_requests` is unreliable/empty too often to
   branch on).
3. PR is `OPEN`, author is `dependabot[bot]` (enforced on the `workflow_dispatch`
   path too, or this becomes a generic merge lever), `autoMergeRequest != null`,
   `isInMergeQueue == false`.
4. `mergeStateStatus == CLEAN`, **polled** ~3× with short sleeps — `workflow_run`
   fires the instant CI completes and GitHub recomputes mergeability async, so a
   brief `BLOCKED`/`UNKNOWN` read is expected. If still not clean, exit 0 quietly;
   another CI completion will come.

Action: `gh pr merge <n> --disable-auto` then `gh pr merge <n> --auto` — the pair
empirically validated twice here. Do **not** substitute plain `gh pr merge`.

Token: write it as `GH_TOKEN: ${{ secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN }}`
so the mitigation below is a secrets change, not a code change.

Security: this `workflow_run` job runs in default-branch context with write
permissions. It must **never** check out PR head code. It only reads PR metadata
and toggles auto-merge.

## Known risks (record, do not engineer around)

- **Bot-initiated enqueue may not trigger `merge_group` checks.** GITHUB_TOKEN
  actions do not trigger workflows (community discussion #70310). Every enqueue
  this repo has observed was under a human token, so there is **no evidence yet**
  about bot-initiated enqueues. Failure signature: PR enters the queue → no
  `merge_group` CI run appears → entry ejects after `check_response_timeout_minutes: 60`.
  Mitigation: swap in `DEPENDABOT_AUTOMERGE_PAT`. Confirming a `merge_group` run
  actually triggers for a bot-enqueued PR is an explicit verification item, not an
  assumption.
- **422 on enable.** If GitHub extends the March-2026 behavior (auto-merge refused
  until all requirements are met) to this ruleset shape, the `pull_request` enable
  step starts failing, the policy marker never appears, and the `enqueue` job would
  never act. Recorded so the failure is diagnosable.

## Verification

Decided: **dispatch-only, no forced merges.** Every remaining Dependabot PR is
`BLOCKED`, and rebasing one to make it green would mean this workflow merges _and
deploys_ that bump as a side effect of testing. Not worth it — so nothing is pushed
green artificially.

### Done before merge

The `enqueue` step's script was extracted from the YAML and executed locally
against real PRs (read-only in every case — nothing was merged or queued):

| Path exercised                | Input                              | Result                                                      |
| ----------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| YAML + `bash -n`              | —                                  | both parse                                                  |
| Dispatch, not-CLEAN no-op     | `DISPATCH_PR=601` (BLOCKED)        | resolved, passed guards, polled 3×, exited 0 without action |
| `workflow_run` SHA resolution | `HEAD_SHA=ceed1c8b`                | resolved → PR #601, same clean no-op                        |
| SHA with no open PR           | `HEAD_SHA=f10c12a3` (merged)       | "No open PR — nothing to do", exit 0                        |
| Author guard                  | `DISPATCH_PR=145` (human, on HOLD) | refused: "author is 'steve-dolo', not Dependabot"           |

Two real bugs were caught and fixed this way:

- `isInMergeQueue` is **not** exposed by `gh pr view --json` (REST-backed field
  set). Both reads of it now go through `gh api graphql`. This bit twice — once in
  the guard, and again in the post-enqueue confirmation line, where it would have
  failed the job under `set -e` _after_ a successful enqueue (the worst shape: work
  done, job red). The second one was caught only by reading the staged diff.
- GraphQL reports the bot's login as `dependabot`, not `dependabot[bot]` or
  `app/dependabot` — the original author check would have refused every PR.
  All three spellings are now accepted.
- Also fixed a `set -e` hazard: `[[ ... ]] && break` as the last command in the
  poll loop exits the script when the condition is false.

### Left to confirm after merge

`workflow_run` and `workflow_dispatch` only take effect once this file is on the
default branch, so the remaining steps are post-merge:

1. Manual `workflow_dispatch` against a currently-`BLOCKED` Dependabot PR —
   expect the same clean no-op as above, now proving Actions-side permissions and
   the `inputs.pr` wiring.
2. Then wait for the next routine Dependabot PR to land unattended. Until that
   happens, confidence is **partial by design**.
3. On that first real one, **confirm a `merge_group` CI run appears** for the
   bot-enqueued entry (the #70310 risk above) — `gh run list --event merge_group`.
   If it does not, swap in `DEPENDABOT_AUTOMERGE_PAT`.

## Files

- `.github/workflows/dependabot-auto-merge.yml` — add the `enqueue` job + triggers
- `plans/in-progress/dependabot-automerge-stale.md` — this plan
