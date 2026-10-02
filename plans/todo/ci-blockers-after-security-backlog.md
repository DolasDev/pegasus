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

---

## Item 1 — the TENANT-03 mobile flake (do this first; it ejects PRs from the merge queue)

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

### The lever that is NEW and not yet tried

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

---

## Item 2 — `#762`: E2E dies on `node_modules/.bin/tsx` (a real bug, not a flake)

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

## Item 3 — `#746` Test failure: uncharacterized

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

---

## Merge-queue maintenance runbook (learned 2026-09-29 → 10-02)

Also in `project_merge_queue_stall_nudge_recipe` memory and GOTCHAS. The queue jams in **three
distinct ways** and they look alike from the PR page:

**(a) Green PR never enqueued.** `mergeStateStatus: CLEAN`, `autoMergeRequest: null`. The #633
mode: auto-merge was never enabled because the PR was red when the automation looked, and a
merge queue never re-evaluates that. Four Dependabot PRs sat like this, two for **12 days**.
Fix: `gh pr merge <N> --auto`.

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
