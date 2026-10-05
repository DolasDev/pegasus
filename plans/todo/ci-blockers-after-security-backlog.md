# CI blockers + merge-queue maintenance left after the security backlog

> **Resume point — rewritten 2026-10-05 against `main` @ `fcc934b3`.** Every fact below was
> re-verified that day, not carried over. Read "State of play", then pick from "Live work" — the
> items are ordered cheapest-first, and each one names its next command.
>
> Successor to `plans/completed/security-backlog-and-sort-hardening.md` (fully discharged).
> The narrative write-ups for everything already closed now live in
> `dolas/agents/project/GOTCHAS.md` and the PR bodies; this file keeps only what is still owed,
> plus the merge-queue runbook, which is the reusable part.

---

## State of play

**`main` is green, Deploy included.** CI and Deploy both `success` at `fcc934b3`, and at
`bc81bd2b` (#791) before it. The staging E2E gate passes.

**Closed since 2026-10-02** (detail in GOTCHAS + the PRs, not repeated here):

- **Item 2** — E2E died on `.bin/tsx` → **#779.** Not the range conflict this file predicted: a
  nested vite 8.3.1 left the root `tsx` slot holding vite 8.3.0's _optional peer_, which npm
  never installs, so `.bin/tsx` was never linked. Fixed with a root `tsx` dependency edge —
  which root needed anyway for `create-admin-user`. **#762 then merged.**
- **Item 3** — #746's Test failure → **closed on merge.** Cause never captured; the log had
  already expired.
- **Item 1, the _leak_ half** → **#780.** `--detectOpenHandles` found exactly one open handle,
  and it was in `Dashboard.snapshot.test.tsx`, **not** `tenant-picker.test.tsx` — this file's
  candidate fix had been aimed at the wrong file for weeks.
- **Item 5 (new)** — staging Deploy broke on `sharp` → **#783.** Caused _by_ closing item 2:
  #762 denested `sharp`, and CDK `bundling.nodeModules` needs a **root** lockfile entry. Fixed
  with a root edge plus a PR-time guard test.
- **Item 5b** — the staging E2E gate → **#784.** `@playwright/mcp`'s prerelease `playwright`
  shadowed the runner for `npx` inside `apps/e2e`. Fixed by using the repo's
  `node ../../node_modules/.bin/playwright` convention everywhere.
- **turbo writing itself into `AGENTS.md`** → **#791.** `"agentGuidance": false`; the advice
  kept in `AGENTS.md` in our own words.
- **Runbook pattern (a)** → **#781**, then **#782** correcting it. See the ⚠️ box in the runbook.
- **Item A (the Dependabot backlog)** → **#785**, **#787** and **#799** all merged; #786 was
  superseded by #799. It corrected two things: `@dependabot recreate` does **not** fix a
  `Missing: … from lock file` failure, and **CI runs npm 11.13.0, not the `packageManager`
  10.8.2 pin** — so validating a lockfile with 10.8.2 is a false green. Item 4 gained an
  eighth reproduction, measured at 21 min → 5 s.

**The one lesson worth carrying into the next bump:** `turbo typecheck lint test` and the
PR-level E2E job do **not** exercise CDK bundling or the staging gate's own invocation. #762 went
green on every PR check and broke `main`'s Deploy **twice**. After merging any broad dependency
bump, watch `main`'s Deploy to completion before calling it done.

---

## Live work

### [x] A — Three open Dependabot PRs — ✅ DONE 2026-10-05, all merged

- **#785** `hono 4.13.9 → 4.13.12` — was green but unenqueued; `gh pr merge 785 --auto`. Merged.
- **#787** `turbo 2.11.5 → 2.11.6` — same. Merged. **Opt-out re-verified on 2.11.6** with a
  control in a throwaway repo: `agentGuidance: false` → 0 blocks, key removed → block injected,
  both `parse-ok`. `AGENTS.md` on `main` still has zero managed blocks.
- **#786** `aws-cdk-lib 2.271.0 → 2.272.0` — **`@dependabot recreate` did NOT fix it.** Dependabot
  closed #786 in favour of grouped **#799** (`aws-cdk` group, 2 updates), which failed _identically_
  — recreate just re-runs the same resolution. Fixed by regenerating the lockfile and pushing that
  onto #799's branch; **merged as #799**.

**Two corrections this produced — both matter more than the merges.**

1. **`@dependabot recreate` is the wrong remedy for a `Missing: … from lock file` failure.** It
   reproduces the same lockfile. The remedy is to regenerate and push it.
2. **CI does NOT use the `packageManager: npm@10.8.2` pin.** `.github/actions/setup` runs
   `actions/setup-node` against `.nvmrc` (24.16.0) with no corepack step, so CI's npm is whatever
   Node bundles — the failing job's own "Environment details" group reads **`npm: 11.13.0`**.
   Project memory had prescribed `npx -y npm@10.8.2`, and on #799's broken lockfile that
   **passes**, proving nothing:

   ```
   npx -y npm@10.8.2 ci --dry-run   -> exit 0   ← FALSE GREEN
   npm ci --dry-run  (npm 11.13.0)  -> exit 1   ← reproduces CI exactly
   ```

   So: reproduce the failure with plain `npm` on Node 24 first, then
   `npm install --package-lock-only`, then gate on `npm ci --dry-run` exiting 0. On #799 the churn
   was tightly scoped — 2386 entries before and after, 20 added, 20 removed, zero other version
   changes (the bumped packages moved from `packages/infra/node_modules/` to the root). Memory
   `project_dependabot_lockfile_npm_version_mismatch` has been corrected.

**Also worth knowing for next time:** this ran during a GitHub **Actions major outage**. Runner
starvation presents as uniform ~15m0Xs cancellations with `runner_name=[]` and `steps=0`, and it
turned `main` red on a docs-only merge. Enqueueing during it was deliberately deferred — a starved
entry occupies the head of an `ALLGREEN` queue and is dropped at `check_response_timeout_minutes:
60`, blocking other streams for nothing. Check
`githubstatus.com/api/v2/components.json` before diagnosing a broad uniform failure as yours.

### [ ] B — Item 1 residue: the TENANT-03 **timeout** (the leak is already fixed)

Current state on `main`, verified: `apps/mobile/jest.config.js` has `testTimeout: 45000` (#775),
`"test"` is still `jest --forceExit` **deliberately** (dropping it would let a future leak hang a
CI job rather than warn), and `npm run test:handles` is the discoverable leak check added by #780.

What is still unapplied, and the decision to make:

- The candidate fix is to replace `await act(async () => { fireEvent.press(...) })` with
  `fireEvent.press(...)` then `await waitFor(() => expect(...))`, in
  `apps/mobile/__tests__/app/(auth)/tenant-picker.test.tsx` at lines **59, 70, 90** — that is
  **3 tests, not the "four" this file used to claim** (counted 2026-10-05; the file has 6 tests).
- It is still **unverifiable locally**: the file passes 6/6 in ~1s with zero open handles, so
  only several real CI runs could show whether it helps.
- **So the real question is whether to do it at all.** The 45 s budget has held since #775, and
  the leak that produced the force-exit warning is gone. Shipping an unverifiable rewrite of 3
  tests to chase a flake that may no longer fire is a worse trade than leaving it. Recommend:
  leave it, and only revisit if TENANT-03 exceeds 45 s in a real run. If it does, that run's log
  is the evidence this item has never had — capture it **while it is live** (an expired log is
  what cost item 3 its cause).

### [ ] C — Item 4: `DEPENDABOT_AUTOMERGE_PAT` (owner-only, highest leverage — now 8 reproductions)

See `plans/todo/dependabot-automerge-pat.md`. No code change — the workflow already reads
`secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`.

**Eight reproductions:** #645, #656, #387, #657, #709, #710, **#762** (2026-10-03/04) and
**#799** (2026-10-05). #799 is the cleanest measurement yet: enqueued by the auto-merge
workflow at 22:16:15, it sat at position 1 `AWAITING_CHECKS` for **21 minutes with no
`merge_group` run**, while `pr-798`'s group run had succeeded minutes earlier and Actions was
`operational` — so neither the queue nor the outage explains it. A dequeue plus
`gh pr merge 799 --auto` under a human token produced the `pr-799` run in **~5 seconds**.
21 min → 5 s.

The
The #762 one is the measured one: enqueued 23:57:16 by the workflow's `GITHUB_TOKEN`, it sat at
position 1 `AWAITING_CHECKS` for **18 minutes with no `merge_group` run at all** — while #781,
enqueued _later_ at position 2, had already produced and passed its own group run. A dequeue plus
`gh pr merge 762 --auto` under a **human** token produced the `pr-762` run in **~28 seconds**.
18 min → 28 s is the same shape as #694's 12-second recovery, which is what makes it evidence
rather than superstition.

A `GITHUB_TOKEN`-initiated enqueue gets a queue entry but no `merge_group` checks. **Bookkeeping
lesson:** "auto-merge was enabled" and "the queue will actually build it" are independent claims —
confirm the second with a `merge_group` run for that PR number before recording a PR as healthy.

### [ ] D — Decision: should `@playwright/mcp` be an `apps/e2e` dependency at all?

It depends on a **prerelease** `playwright`, which npm installs at
`apps/e2e/node_modules/playwright` and which shadows the stable runner for anything resolved from
that directory. #784 routed around it by using `node ../../node_modules/.bin/playwright`
everywhere (root `.bin/playwright` is linked from `@playwright/test`, so runner and library
always agree).

But `.claude/settings.json` launches the MCP server as `npx @playwright/mcp@latest`, so **the
declared dependency's only observable effect in CI is the shadowing**. Removing it would delete
the hazard instead of routing around it. That is a dependency decision, not a pipeline fix, which
is why #784 left it alone. Dependabot will keep bumping it and it will keep dragging a prerelease
`playwright` in.

### [ ] E — Optional hardening: three `nodeModules` entries are root-resolvable _by luck_

PR #783 added `packages/infra/lib/stacks/__tests__/cdk-node-modules-root-resolvable.test.ts`, which
asserts every CDK `bundling.nodeModules` package has a root `node_modules/<pkg>` lockfile entry
(static, ~130 ms, and proven red against #762's actual lockfile).

Verified 2026-10-05 — `sharp` is now declared at the root; these three are **not**, and resolve
there only because nothing has displaced them yet:

| package                    | root entry                                            | declared at root? |
| -------------------------- | ----------------------------------------------------- | ----------------- |
| `@napi-rs/canvas`          | 0.1.100 (plus a 1.0.3 copy nested under `pdfjs-dist`) | no                |
| `@cedar-policy/cedar-wasm` | 4.13.0                                                | no                |
| `expo-server-sdk`          | 6.1.0                                                 | no                |

**Not a blocker** — the guard turns each into a red PR check the day it denests, which is the
whole point of it. Declaring them at the root pre-emptively is cheap insurance; doing nothing is
also defensible now that the gate exists.

### [ ] F — Loose end: `check-overrides.mjs` reports 43 of 49 overrides "inert"

Observed locally. On a set this carefully curated that is almost certainly a false signal — most
likely because `npm ls --all --json` under **npm 11** (local) no longer emits the `overridden`
flag the script keys on, while CI pins `npm@10.8.2`. **Confirm that before anyone acts on one of
its monthly reports** — the workflow files an issue from them, so a false signal becomes a ticket.

### (no action) `audit-ci` "Consider not allowlisting" for `decode-uri-component` and `uuid`

Expected, not a finding: the gate is `"high": true`, so moderates are never evaluated. There is a
note at the top of the allowlist in `audit-ci.jsonc` explaining this. **Do not delete those
entries on the strength of that line.**

---

## Merge-queue maintenance runbook

Also in the `project_merge_queue_stall_nudge_recipe` memory and GOTCHAS. The queue jams in
**three distinct ways** and they look alike from the PR page.

**(a) Green PR never enqueued.** `mergeStateStatus: CLEAN`, `autoMergeRequest: null`. The #633
mode: auto-merge was never enabled because the PR was red when the automation looked, and a merge
queue never re-evaluates that. Four Dependabot PRs sat like this, two for **12 days**.
Fix: `gh pr merge <N> --auto`.

> ⚠️ **That signature gives FALSE POSITIVES — corrected 2026-10-03/04 (#781, then #782).**
> `autoMergeRequest: null` is **normal on a queued PR**: auto-merge converts into a queue entry
> and clears the field. On #762 it read null _simultaneously_ with
> `isInMergeQueue: true, position: 1` and a successful auto-merge job; on #779, re-running
> `gh pr merge --auto` answered `! Pull request #779 is already queued to merge`.
>
> **Confirm with two independent signals** before concluding a PR was never enqueued — and before
> counting another Item 4 reproduction:
>
> 1. `gh pr merge <N> --auto` and **read its stdout** — `already queued to merge` is
>    authoritative, and re-running is idempotent and harmless.
> 2. The GraphQL `mergeQueueEntry` (below). Note `gh pr view --json isInMergeQueue` is **not a
>    valid field** — it errors listing the valid ones — so queue state comes only from GraphQL.
>
> **And ruling out (a) does not mean the PR is healthy.** #762 was (a)-clear and then stalled
> under **(b)** anyway; #781 concluded "nothing was wrong with it" from the (a) check alone and
> was wrong within minutes. Finish the (b) check.

**(b) Bot-enqueued entry stalls.** Head of queue, `AWAITING_CHECKS`, and **no `merge_group` run
exists**. The missing-PAT symptom. Fix (verified **three** times — #694, and #762 on 2026-10-04
where 18 minutes of nothing became a group run in ~28 s):

```
id=$(gh pr view <N> --json id -q .id)
gh api graphql -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{position}}}' -F id="$id"
gh pr merge <N> --auto
```

The input field is **`id`**, not `pullRequestId` — GitHub rejects the latter
(`argumentNotAccepted`). Capture the before/after gap rather than assuming the dequeue was
warranted; if a re-enqueue also produces no run, the entry was not the problem.

**(c) Stale base against a repo-wide gate.** `audit-ci` runs against **each PR's own lockfile**,
so an advisory fix landing on `main` does _not_ turn existing PRs green.
Fix: `gh pr update-branch <N>` (or `@dependabot rebase`). This is what was wrong with #761 — it
looked like a broken gate and was only a stale branch.

**Queue state:**

```
gh api graphql -f query='{repository(owner:"DolasDev",name:"pegasus"){mergeQueue(branch:"main"){entries(first:10){nodes{position state enqueuedAt pullRequest{number}}}}}}'
```

### Two diagnosis traps

- **`gh run list --event merge_group` returns STALE data here** — it reported only runs from six
  days earlier while today's were live. Filter client-side instead:
  `gh run list --limit 40 --json createdAt,event,status,conclusion,headBranch -q '.[]|select(.event=="merge_group")|…'`
- **An ejected PR's failing run is NOT among its own checks.** `isInMergeQueue:false` while still
  `OPEN` means ejected; the run lives at `gh-readonly-queue/main/pr-<N>-<base>`. Find it with the
  client-side query above, then `gh run view --log-failed --job <id>`.

---

## Do not commit these

They reappear on almost every run and belong to nobody's PR. Check `git status` before staging,
and prefer naming files explicitly over `git add -A` — that is how a turbo-injected `AGENTS.md`
got swept into a CI hotfix on 2026-10-04 and had to be amended out.

1. **`apps/api/vitest.config.ts`** — coverage-floor drift. `autoUpdate` only _raises_ floors, and
   a floor raised by run-to-run noise is what gets a later PR ejected from the merge queue.
2. **`apps/e2e/.env.test`** — the worktree's Postgres port.
3. **`package-lock.json`** — `scripts/new-worktree.sh` runs `npm install`, and local **npm 11**
   prunes a nested `apps/mobile/node_modules/babel-preset-expo` (116 lines) that the committed
   lockfile keeps. Showed up unrelated in three worktrees. `git checkout package-lock.json`
   unless you deliberately changed a dependency — this prune is also why #779's lockfile edit was
   made by hand rather than by `npm install --package-lock-only`.

   > ✅ A fourth, `AGENTS.md`, is **resolved** — see #791 above. It is no longer expected to go
   > dirty on its own.

---

## Don't redo these

Two intended fixes in this area turned out to be **already done**, each caught only by looking
before editing. Check `git log -- <file>` _and_ `gh pr list --search <pkg>` before starting
dependency work — either check alone would have missed one of them.

- **The `audit-ci` high-advisory gate** (`@grpc/grpc-js`, `brace-expansion` ×3, `node-forge`) was
  cleared by **#755** and **#760**. `main`'s gate passes. The `brace-expansion` allowlist entries
  were re-pointed from the three old GHSAs to the new ones, because `aws-cdk-lib` still bundles a
  copy an override cannot reach. Open Dependabot **alerts** for these remain, by design — an open
  alert is not a failing gate.
- **A PyJWT bump** — Dependabot files its PR within about a minute of the alert. #751 was opened
  as a duplicate of **#750** and closed.

---

## Verification recipe

`turbo typecheck lint test` green is the floor, **not** the ceiling — see the lesson in "State of
play". For anything touching dependencies, CDK bundling, or the e2e invocation, also:

- `npm ci` exits 0 (proves the lockfile is self-consistent). Use the **plain `npm` on Node 24
  (npm 11.13.0)** — that is what CI runs. `packageManager: npm@10.8.2` is declarative and
  nothing enforces it, so validating with 10.8.2 can pass a lockfile CI then rejects (#799).
- `npx cdk synth PegasusStaging-DocumentsStack -c env=staging --app "npx tsx bin/app.ts"` from
  `packages/infra` — this is what actually runs the bundling `npm ci`. It needs
  `npx turbo run build --filter=@pegasus/domain` first, or esbuild fails on `@pegasus/domain`
  with a misleading "Could not resolve".
- From `apps/e2e`: `node ../../node_modules/.bin/playwright test --list` should list tests, not
  print "No tests found". Never `npx playwright` here.
- **Then watch `main`'s Deploy to completion after it merges.**

Expect the pre-push hook to hit the `apps/api` import-timeout cluster if the machine is loaded;
check `uptime` and retry rather than fighting it.

> **Hot file:** `dolas/agents/project/GOTCHAS.md` is appended to by every stream, so two active
> sessions conflict at its tail. #791 hit this twice. Both were append-vs-append — resolve by
> keeping both entries, theirs first; nothing is ever lost that way.
