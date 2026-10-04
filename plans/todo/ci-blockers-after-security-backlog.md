# CI blockers + merge-queue maintenance left after the security backlog

> **Resume point.** Written 2026-10-02 against `main` @ `ebc6c004`. Successor to
> `plans/completed/security-backlog-and-sort-hardening.md`, which is **fully discharged** —
> every dependency alert in it is closed and the ORDER BY hardening shipped (#740, #741, #744).
>
> This file is the residue: **CI failures that block merges**, plus the queue-maintenance
> runbook that was learned the hard way and is worth not re-deriving.
>
> Re-verify PR numbers and versions before acting. Other sessions move `main` fast — three
> PRs landed while the previous session was writing this class of work, and two of its
> intended fixes turned out to have **already been done by someone else** (see
> "Don't redo these" at the bottom).
>
> **2026-10-03 pass.** Item 2 **fixed** (#779 — root `tsx` dependency edge; the cause was an
> optional-peer slot capture, not the range conflict this file predicted). Item 3 **closed**
> (#746 merged; cause never captured). Item 1 **partly fixed**: the `--detectOpenHandles` lever
> was finally pulled and found a real leaked timer — in `Dashboard.snapshot.test.tsx`, **not** in
> `tenant-picker.test.tsx` — now fixed; the TENANT-03 _timeout_ remains mitigated-only by #775.
> Item 4 unchanged and still owner-only. Both "loose ends" at the bottom are also still open.
> That leaves **Item 1's timeout, Item 4, and the two loose ends** as the live work here.

---

## Item 1 — the TENANT-03 mobile flake (the LEAK is fixed; the TIMEOUT is still only mitigated)

> **2026-10-03 — the lever was pulled, and it pointed at a different file.**
>
> `npx jest --detectOpenHandles` (no `--forceExit`) was run, finally. It reports exactly **one**
> open handle in the whole 22-suite / 193-test mobile run, reproducibly 3/3 — and it is **not**
> `tenant-picker.test.tsx`, which is clean on its own (6/6, no handles). It is
> `src/components/__tests__/Dashboard.snapshot.test.tsx`, whose `shows loading state initially`
> test mocked `getDriverMetrics` with a promise resolving through a real
> `setTimeout(…, 1000)` while asserting synchronously and returning — so the timer outlived the
> test and its worker could not exit. That is the
> "A worker process has failed to exit gracefully and has been force exited" line from the
> 2026-10-01 run, attributed. Fixed by mocking with a promise that never settles (all a
> loading-state assertion needs): 193 tests pass with **0** open handles and a clean exit, 3/3.
>
> **So the hypothesis below was half right.** `--forceExit` _was_ masking a real leak. The leak
> was just somewhere else, which is exactly why the previous session was right not to ship the
> `waitFor` rewrite blind — it would have edited four tests in the wrong file.
>
> **Still open, and do not conflate it with the above:**
>
> - The **TENANT-03 timeout itself is unproven as fixed.** Removing the handle removes the
>   force-exit warning; it is not evidence the 15s/45s timeout stops being exceeded. `#775`'s
>   `testTimeout: 45000` remains the only thing addressing that, and it is a mitigation.
> - The **`waitFor` rewrite is still unapplied and still unverified** (see below). It stays a
>   candidate, now with one fewer confound.
> - `apps/mobile`'s `test` script is **still `jest --forceExit`**, deliberately: dropping it
>   would let a future leak hang a CI job rather than warn. `npm run test:handles` was added
>   instead, so the check that found this is one discoverable command rather than a flag someone
>   has to know to pass.

**Why it is top of the list:** it is not just a red check. It failed a `merge_group` run and
**ejected #744 from the merge queue**, and the CI `Test` job runs `turbo run test` with **no
`--affected` and no filter** — so it is reachable from any PR, including dependency-only ones
that touch nothing in `apps/mobile`. Observed failing on 2026-09-29 and again 2026-10-01.
Roughly 1 in 4 runs.

```
FAIL __tests__/app/(auth)/tenant-picker.test.tsx (29-33 s)
  ● TenantPickerScreen › calls selectTenant … when a company is tapped (TENANT-03)
    thrown: "Exceeded timeout of 15000 ms for a test."
```

**Diagnosis (from `dolas/agents/project/GOTCHAS.md`, entry "TENANT-03"):** the test is fully
mocked — no network, no storage — and hangs inside

```tsx
await act(async () => {
  fireEvent.press(getByText('Acme Moving Co'))
})
```

`fireEvent.press` is synchronous and RNTL already wraps it in `act`. The outer **async** `act`
then drives React's async work loop against `VirtualizedList`'s real ~50ms
`_updateCellsToRender` batching timers; the log carries the matching "An update to
VirtualizedList inside a test was not wrapped in act(…)" warning with a `Timeout._onTimeout`
stack. On a saturated 2-core runner the loop outlives jest's 15s default.

### The lever — PULLED 2026-10-03, and it named a timer in another file

> Outcome is in the box at the top of this item: one open handle, in
> `Dashboard.snapshot.test.tsx`, not here. The reasoning below is kept because it is what made
> the lever worth pulling; only its guess about _which_ timer was wrong.

The 2026-10-01 run added a line the earlier ones did not:

```
A worker process has failed to exit gracefully and has been force exited. This is likely
caused by tests leaking due to improper teardown. … Active timers can also cause this,
ensure that .unref() was called on them.
```

**`apps/mobile`'s test script is `jest --forceExit`** (`apps/mobile/package.json`), which
_masks_ exactly that leak. So:

```
cd apps/mobile && npx jest --detectOpenHandles        # note: NO --forceExit
```

If that names the leaked `VirtualizedList` timer, the flake becomes **locally reproducible**,
which is the whole difficulty — it currently passes 3/3 locally in ~1s, so no fix can be
verified off-runner. Chase this before writing any fix.

**Candidate fix, still UNVERIFIED:** drop the outer async `act` and use the documented RNTL
idiom — `fireEvent.press(...)` then
`await waitFor(() => expect(mockSelectTenant).toHaveBeenCalledWith(...))`. `waitFor` polls with
a bounded timeout instead of draining the timer loop. **Four tests in that file share the
pattern.** Do not ship this blind: without a local reproduction you are guessing, and the
previous session deliberately declined to.

A `--forceExit` that hides a leak is worth a second look on its own, independent of this test.
**It got one** — it was hiding a real leak, and `npm run test:handles` now exposes that class
without removing the flag's CI-hang protection.

---

## Item 2 — `#762`: E2E dies on `node_modules/.bin/tsx` — ✅ CAUSE FOUND AND FIXED (2026-10-03)

> **Resolved by #779** (merged 2026-10-03). The diagnosis below was the right class but the
> wrong mechanism, and the difference is the whole fix.
>
> **It is not a range conflict.** #762 bumps all four tsx-declaring workspaces (api, e2e, infra,
> vpn-agent) to the _same_ `^4.23.15`, so there is nothing to reconcile and the `prisma`-style
> pin has nothing to pin. What actually happened: the bump nested **vite 8.3.1** under admin-web
> and tenant-web while root stayed on **8.3.0**, and arborist then filled the root `tsx` slot
> with vite 8.3.0's **optional peer** — `"optional": true, "peer": true` at 4.23.13 — pushing all
> four workspaces' real 4.23.15 into nested copies. npm does not install an optional peer nothing
> depends on, so root `node_modules/.bin/tsx` was never linked.
>
> **Fix: one line of `package.json` + one line of the lockfile.** Declare `tsx` in the **root**
> `devDependencies`. Root needed it anyway — `npm run create-admin-user` runs bare `tsx` and the
> `scripts/*.ts` runbooks are `npx tsx`, both of which were resolving by luck and would have
> broken the moment #762 landed. The caller was deliberately left alone — invoking a tool as
> `node ../../node_modules/.bin/<tool>` is a repo-wide convention (~40 call sites; the `node`
> prefix exists because a restored cache loses the `.bin` exec bit), so the fix belongs at the
> root-ownership end, exactly as prisma's did.
>
> **Verified locally, four ways:**
>
> 1. Reproduced the CI failure off-runner — with root `node_modules/tsx` moved into
>    `apps/e2e/node_modules/` and the root `.bin` link removed, the real webServer command dies
>    with the exact `Cannot find module …/node_modules/.bin/tsx`.
> 2. The bin-link rule, in isolation: a root `devDependencies` entry always yields
>    `node_modules/.bin/tsx`; a package reachable only as vite's _optional_ peer is not installed
>    at all and yields nothing. That is the mechanism, not an inference.
> 3. Against **#762's own manifests** + the root edge at a range matching theirs, arborist
>    collapses tsx to a **single hoisted copy**, non-optional and non-peer. (At root `^4.23.13`
>    vs their `^4.23.15` the bin link is restored but four nested copies survive — so keep the
>    root range equal to the workspaces', which is what Dependabot will do once root declares it.)
> 4. `apps/e2e` `tests/api/health.spec.ts` passes through Playwright (webServer + globalSetup),
>    and `npm ci --dry-run` accepts the hand-edited lockfile.
>
> **Still to do:** `@dependabot rebase` on #762 once this is on `main`, then confirm its **E2E
> Tests** job is green. A rebase alone was never going to fix it; a rebase _onto this_ will.
> Recorded in GOTCHAS as "`node ../../node_modules/.bin/<tool>` requires the ROOT to own the tool".

### Original diagnosis (kept for the record — the class was right, the remedy was not)

```
[WebServer] Error: Cannot find module '/home/runner/work/pegasus/pegasus/node_modules/.bin/tsx'
Error: Process from config.webServer was not able to start. Exit code: 1
```

- **Reproducible, not flaky.** It failed identically on #759 (2026-10-01) and again on **#762**
  (2026-10-02, verified), which is the Dependabot PR that superseded #759.
- #762 is `chore(deps): bump the minor-and-patch group across 1 directory with **32 updates**`
  and touches nine `package.json` files plus the lockfile.
- **This is the `.bin` hoisting class already documented in the `//overrides` block** — see the
  `prisma` entry: two workspaces declaring the same range, npm installs a private copy in each
  instead of hoisting, so `node_modules/.bin/<tool>` is never created and the thing that invokes
  it by path dies. The `prisma` remedy was to pin one version so it hoists.
- So: find which workspaces declare `tsx` and what the group bump did to their ranges
  (`grep -rn '"tsx"' apps/*/package.json packages/*/package.json package.json`, then
  `npm ls tsx --all`). `apps/e2e/playwright.config.ts`'s `webServer` is the caller.
- A plain `@dependabot rebase` will **not** fix this; it is the bump's own break.

---

## Item 3 — `#746` Test failure: ✅ CLOSED (merged 2026-10-02) — cause never captured

> `#746` is **MERGED**. Whatever the Test failure was, it did not survive a re-run, and the log
> had already expired when this item was written — so the cause was never captured and now cannot
> be. Nothing to chase; the item is closed on the merge, not on an explanation. If the same job
> fails again, pull the log **while the run is still live** — an expired log (`BlobNotFound`, 404)
> is what cost this one. The two load-sensitive candidates below remain plausible but unproven,
> and Item 1's note is the live version of that story.

### Original item (kept for the record)

`#746` (`feat(domain-reference): A9 — identity & cross-references`) is `BLOCKED` on **Test**.
The job log had already expired when this was written (`BlobNotFound`, HTTP 404), so **the cause
is unknown and was not guessed at**. Re-run the job to capture fresh output before assuming
anything.

Two known candidates it could be, both documented in GOTCHAS, both load-sensitive:

- the TENANT-03 flake above, or
- the `apps/api` import-timeout cluster — `optional-auth.test.ts`, `health.test.ts`,
  `openapi.test.ts`, `server.test.ts` all `import('../app')` and all time out at 15s under a
  saturated parallel `turbo test`. On a loaded dev machine (load avg 33) five of them failed at
  once; at load 6 the same tree passed 31/31.

If it is the api cluster, that is a **second instance of the same root cause** as TENANT-03: a
15s default timeout that is too tight for import-heavy suites under contention. Worth fixing as
one piece of work rather than two.

---

## Item 4 — `DEPENDABOT_AUTOMERGE_PAT` (owner-only; see its own file)

`plans/todo/dependabot-automerge-pat.md` — unchanged, still the single highest-leverage fix.
**Six reproductions** now: #645, #656, #387, #657, then #709 and #710 on 2026-09-29/10-02. No
code change; the workflow already reads
`secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`.

**Still six, not seven.** #762 looked like a seventh on 2026-10-03 — green, `CLEAN`,
`autoMergeRequest: null` — and it was not: it was queued at position 1 the whole time, and its
auto-merge job had succeeded. See the ⚠️ correction under runbook pattern (a) before adding to
this count; the signature this item is recognized by is not reliable on its own.

---

## Merge-queue maintenance runbook (learned 2026-09-29 → 10-02)

Also in `project_merge_queue_stall_nudge_recipe` memory and GOTCHAS. The queue jams in **three
distinct ways** and they look alike from the PR page:

**(a) Green PR never enqueued.** `mergeStateStatus: CLEAN`, `autoMergeRequest: null`. The #633
mode: auto-merge was never enabled because the PR was red when the automation looked, and a
merge queue never re-evaluates that. Four Dependabot PRs sat like this, two for **12 days**.
Fix: `gh pr merge <N> --auto`.

> ⚠️ **That signature gives FALSE POSITIVES — corrected 2026-10-03.** `autoMergeRequest: null`
> and `isInMergeQueue: false` can **both** read stale while the PR is queued and merging fine.
> Seen twice the same evening: on **#779**, `autoMergeRequest` read non-null right after
> `gh pr merge --auto`, then **null** with `isInMergeQueue: false` minutes later — and re-running
> the command answered `! Pull request #779 is already queued to merge`; it merged on its own. On
> **#762** the same null/CLEAN pair looked exactly like the missing-PAT symptom, while GraphQL
> `mergeQueueEntry` said `isInMergeQueue: true, position: 1, AWAITING_CHECKS` and the auto-merge
> job had logged `! The merge strategy for main is set by the merge queue`.
>
> So before concluding a PR was never enqueued — and **before counting another item-4
> reproduction** — confirm with **two independent** signals: GraphQL `mergeQueueEntry`, and
> `gh pr merge <N> --auto` read for its stdout (`already queued to merge` is authoritative;
> re-running is idempotent and harmless). Note `gh pr view --json isInMergeQueue` is **not a
> valid field** — it errors out listing the available ones, so the queue state only comes from
> GraphQL. This is the same "an empty field is not evidence of absence" trap as the stale
> `--event merge_group` listing two bullets down.

**(b) Bot-enqueued entry stalls.** Head of queue, `AWAITING_CHECKS`, and **no `merge_group` run
exists**. The missing-PAT symptom. Fix (verified twice):

```
id=$(gh pr view <N> --json id -q .id)
gh api graphql -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{position}}}' -F id="$id"
gh pr merge <N> --auto
```

The input field is **`id`**, not `pullRequestId` — GitHub rejects the latter
(`argumentNotAccepted`).

**(c) Stale base against a repo-wide gate.** `audit-ci` runs against **each PR's own
lockfile**, so an advisory fix landing on `main` does _not_ turn existing PRs green. Fix:
`gh pr update-branch <N>` (or `@dependabot rebase`). This is what was wrong with #761 — it
looked like a broken gate and was only a stale branch.

### Two diagnosis traps

- **`gh run list --event merge_group` returns STALE data here** — it reported only runs from six
  days earlier while today's were live. Filter client-side instead:
  `gh run list --limit 40 --json createdAt,event,status,conclusion,headBranch -q '.[]|select(.event=="merge_group")|…'`
- **An ejected PR's failing run is NOT among its own checks.** `isInMergeQueue:false` while still
  `OPEN` means ejected; the run lives at `gh-readonly-queue/main/pr-<N>-<base>`. Find it with the
  client-side query above, then `gh run view --log-failed --job <id>`.

---

## Don't redo these

Two intended fixes in this area turned out to be **already done**, each caught only by looking
before editing. Check `git log -- <file>` _and_ `gh pr list --search <pkg>` before starting
dependency work — either check alone would have missed one of them.

- **The `audit-ci` high-advisory gate** (`@grpc/grpc-js`, `brace-expansion` ×3, `node-forge`) was
  cleared by **#755** and **#760**. `main`'s gate passes. The `brace-expansion` allowlist entries
  were re-pointed from the three old GHSAs to the new ones, because `aws-cdk-lib` still bundles a
  copy an override cannot reach.
- **A PyJWT bump** — Dependabot files its PR within about a minute of the alert. #751 was opened
  as a duplicate of **#750** and closed.

## Two loose ends, deliberately not acted on

- **`scripts/check-overrides.mjs` reported 43 of 49 overrides as "inert"** locally. On a set this
  carefully curated that is a false signal, most likely because `npm ls --all --json` under
  npm 11 (local) no longer emits the `overridden` flag the script keys on, while CI pins
  `npm@10.8.2`. **Confirm this before anyone acts on one of its monthly reports** — the workflow
  files an issue from them.
- `audit-ci` reports the `decode-uri-component` and `uuid` allowlist entries as "Consider not
  allowlisting". That is expected — the gate is `"high": true`, so moderates are never evaluated.
  There is a note at the top of the allowlist in `audit-ci.jsonc` explaining this; do not delete
  those entries on the strength of that line.

## Verification for any of the above

`turbo typecheck lint test` green. Do **not** commit `apps/api/vitest.config.ts` coverage-floor
drift (`autoUpdate` only raises floors, and raised floors invite merge-queue ejection) or
`apps/e2e/.env.test` (worktree DB port) — both reappear on almost every run. Expect the pre-push
hook to hit the api import-timeout cluster if the machine is loaded; check `uptime` and retry
rather than fighting it.

**A third artifact belongs on that list: `package-lock.json`.** `scripts/new-worktree.sh` runs
`npm install`, and local **npm 11** prunes a nested `apps/mobile/node_modules/babel-preset-expo`
entry (116 lines) that the committed lockfile keeps. It showed up unrelated in two worktrees on
2026-10-03. It is not yours and it is not this PR's business — `git checkout package-lock.json`
before committing unless you deliberately changed a dependency. The same prune is why #779's
lockfile edit was made by hand rather than by `npm install --package-lock-only`.
