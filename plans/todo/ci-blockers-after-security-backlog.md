# CI blockers + merge-queue maintenance left after the security backlog

> **Resume point — refreshed 2026-10-09 against `main` @ `65a11dfd`, in the PR that closes the last
> agent-doable item (#822).** Read **"Resume here"** immediately below, then "State of play", then
> pick from "Live work". The body was last fully re-verified 2026-10-06 (late) against `c60c00db`;
> the 10-07 pass closed the `@playwright/mcp` decision (#819) and the 10-09 pass closed the
> `nodeModules` hardening (#822). **Everything still open is either owner-only or a judgement call —
> see "Resume here".**
>
> ⚠️ **This file said "nothing is blocking" at `892f0c53` and was falsified two hours later.** A
> newly-published **critical** advisory flipped `audit-ci` red on `main` with no code change, and the
> first PR to enter the merge queue after it was **ejected** by a failure that had nothing to do with
> it. Fixed in **#808**. The state-of-play section below now leads with what that exposed, because the
> interesting part is not the advisory — it is that **Dependabot was never going to catch it**, and
> this file's own "No Dependabot PRs open" line read as good news.
>
> ⚠️ **Corrected 2026-10-07: the "Dependabot is broken" diagnosis this file carried was wrong.**
> Every red `Dependabot Updates` run was a security update Dependabot _correctly_ declined; the
> shell-quote advisory had no PR because GitHub had **not yet raised an alert** for it. See the
> closed item under Live work.
>
> Successor to `plans/completed/security-backlog-and-sort-hardening.md` (fully discharged).
> Narrative write-ups for everything closed live in `dolas/agents/project/GOTCHAS.md` and the PR
> bodies; this file keeps only what is still owed, plus the merge-queue runbook, which is the
> reusable part.

---

## Resume here

**Where:** primary checkout `/home/steve/repos/pegasus`, branch `main`, last commit
`65a11dfd feat(domain-reference): mint the party aggregate — [A8 §9 item 1], catalog 0.6.4 (#821)`.
No worktree is needed to read this.

**Status:** nothing is in flight from the previous sessions. #819 (drop `@playwright/mcp`) and
#822 (root `nodeModules` edges) both merged with CI green and `main`'s Deploy green through prod.
`main` is green (see State of play). The `Live work` checkboxes are accurate as of 2026-10-09.

**Next action — there is no obvious one left, and that is the honest state of this file.** Read this
before reaching for the loose end below; the remaining items are not a queue to work down.

- **`DEPENDABOT_AUTOMERGE_PAT` is still the highest-leverage thing on the list and is OWNER-ONLY.**
  No code change — the workflow already reads `secrets.DEPENDABOT_AUTOMERGE_PAT ||
secrets.GITHUB_TOKEN`. Eight reproductions. An agent cannot do it; **ask rather than work around
  it.**
- **Both decisions are settled** — `@playwright/mcp` by removing it (#819), TENANT-03 by
  deliberately leaving it (and the "leave it" there is load-bearing: the candidate rewrite is
  _unverifiable locally_, so doing it would be churn chasing a flake that may no longer fire).
- **The only agent-doable item left is the `check-overrides.mjs` loose end, and it is deliberately
  open-ended, not shovel-ready.** Do not treat it as a mechanical task. The open _question_ is
  narrow and worth answering (is npm's `overridden` flag now marking only the node that directly
  satisfies an override, which would make the "43 inert" an over-count?); the _action_ it implies —
  deleting override entries — is where the risk is, because removing an entry lets the resolver run
  unconstrained and can pull a lower version a parent range still permits. The 4 dead ones are the
  cheapest start, but **`handlebars` is there for CVE-2019-19919**, so read the `//overrides` note
  before removing any security entry even when the package is gone from the tree. One entry at a
  time, each with `rm -rf node_modules package-lock.json && npm install` and the affected suite.

So: if you arrived here looking for work, the useful answers are "ask the owner about the PAT" or
"answer the `overridden`-flag question without deleting anything yet". Inventing a task from the
`(no action)` item at the bottom would be a mistake — that one is explicitly _expected output_, not
a finding.

**What #822 did** (the item it closes has the full record, including the range correction):

- Three root `devDependencies` edges — `@cedar-policy/cedar-wasm` `^4.13.0`, `@napi-rs/canvas`
  `^0.1.99`, `expo-server-sdk` `^6.1.0` — each matching `apps/api` **exactly**, plus a
  `//devDependencies` note apiece. Lockfile effect: **3 insertions, nothing else.**
- **The plan's own step 2 was wrong and is corrected in the item below:** it said to pin to the
  installed versions, but `^0.1.99` ≠ `^0.1.100` for a 0.x caret, and a root range that diverges
  from the workspace's is exactly what makes npm nest instead of hoist — the #762 mechanism this
  edge exists to prevent.
- Verified with a real `cdk synth` (exit 0, all three in the bundled assets at the expected
  versions), not just the `turbo` floor, because bundling is invisible to typecheck/lint/test.

**A trap this file should have warned about, and now does:** the `//devDependencies` notes are the
only thing standing between these edges and a future "unused dependency" cleanup. Three root
devDependencies that no root file imports look exactly like cruft. Each note starts `NOT unused —
do not remove` and names the stack and Lambda construct that bundles the package. **If you ever
find yourself pruning root devDependencies, read those notes first.**

**In flight (not mine):** at #822's creation the only other open PR was `#145` (Cognito/SES, on
explicit hold). Four worktrees belong to other streams — note that
`pegasus-deps-advisory-flip` is parked on a branch whose name keeps changing (`chore/parked-dr` →
`chore/dr-party` → `chore/dr-person-grain`) and is what owns Postgres port 5459. Re-check with
`gh pr list --state open` and `git worktree list`; neither of those is a reason to wait.

**One dead end still worth not re-walking** (the rest are in State of play's three lessons and in
`Five diagnosis traps`): **enqueuing was deliberately deferred during a GitHub Actions
`major_outage`** rather than pushed through. A starved entry holds the head of an `ALLGREEN` queue
and is dropped at `check_response_timeout_minutes: 60`, blocking every other stream for no benefit —
and nothing merges during the outage anyway. Check
`curl -s https://www.githubstatus.com/api/v2/components.json` before diagnosing a broad, uniform CI
failure as yours.

**Do not commit from the primary checkout.** It stays parked on `main` (see
`dolas/agents/team/workflow.md`), and a session hook enforces it. This file is edited in the
worktree and lands with the code, one PR — if a copy of it is dirty in the primary, discard that
with `git checkout -- plans/todo/ci-blockers-after-security-backlog.md` once the PR carries the
content.

**Verification still owed:** none from #819 — `turbo typecheck lint test` green, `npm ci` clean on
npm 11.13.0, the three positional playwright proofs above, and `--list` at 10 tests in 4 files. The
one thing that cannot be done before merge is **watching `main`'s Deploy to completion**, since this
touches `apps/e2e`'s tree and that is exactly what the staging E2E gate (#784) exercises.

---

## State of play

**`main` is green through prod at `be16d7d2`** (re-verified 2026-10-07 from the commit's own
check-runs, **not** `gh run list` — see the traps): **41 success, 1 skipped, 0 failures**, with
`Lint` (the `audit-ci` gate), `Test`, `Deploy to staging` and `Deploy to prod` all success. One
`E2E Tests` run was still `in_progress` at checkpoint time. Working tree clean apart from this
file — see "Resume here".

**But it was RED from ~15:51Z to 16:18Z, and the cause is still live.**

- **`GHSA-pqg4-j6r4-53mv` (`shell-quote`, CRITICAL, CVSS 8.1, `>=1.8.4 <1.11.0`)** published while
  installed was 1.10.0, flipping the `Lint` job's `audit-ci` gate. **Fourth** advisory flip this repo
  has taken, and the **second** on `shell-quote` specifically — both landed _above the floor the
  existing override pinned_. Fixed in **#808**: floor `>=1.9.0` → `>=1.11.0`, 3-line lockfile diff.
  The `//overrides` note now records the stacking pattern, as `brace-expansion`'s does.
- **`Dependabot Updates` shows red runs, and they are NOT an outage** (diagnosed 2026-10-07). Each
  failure is a per-advisory security update that cannot be done — `security_update_not_possible`
  (katex: `mermaid@11.17.2 requires katex@^0.16.47`; brace-expansion: the copy bundled in
  aws-cdk-lib) or `NoChangeError` (grpc-js: npm will not re-resolve it, as `audit-ci.jsonc`
  records). The weekly version-update runs succeeded throughout. **The critical shell-quote advisory
  had no PR because it had no alert**: published 13:40Z, fixed by #808 at 16:17Z, and GitHub turns an
  advisory into an alert ~24h after publication (median of the last 30), sometimes weeks. See Live work.

**The lesson worth more than the fix: this file already contained the answers to two of the three
traps I hit, and I hit them because I had not read it.** The `gh run list --branch main` staleness and
the `apps/api/vitest.config.ts` coverage-floor drift are both documented below, and both cost time
anyway. **Read "Do not commit these" and "Five diagnosis traps" before starting, not after.**

**Everything from the previous round is still closed.** Nine fixes landed 2026-10-02 → 10-05; detail
is in GOTCHAS and the PRs, so one line each:

- **E2E died on `.bin/tsx`** → **#779.** Not the range conflict this file predicted — a nested
  vite 8.3.1 left the root `tsx` slot holding vite 8.3.0's _optional peer_, which npm never
  installs. Fixed with a root `tsx` dependency edge. **#762 then merged.**
- **#746's Test failure** → closed on merge; cause never captured (log had expired).
- **The mobile open-handle leak** → **#780.** One handle, in `Dashboard.snapshot.test.tsx` —
  **not** `tenant-picker.test.tsx`, where this file had aimed its fix for weeks.
- **Staging Deploy broke on `sharp`** → **#783.** Caused _by_ fixing the first item: #762
  denested `sharp`, and CDK `bundling.nodeModules` needs a **root** lockfile entry. Fixed with a
  root edge plus a PR-time guard test.
- **The staging E2E gate** → **#784.** `@playwright/mcp`'s prerelease `playwright` shadowed the
  runner for `npx` inside `apps/e2e`. Fixed by using the repo's
  `node ../../node_modules/.bin/playwright` convention everywhere.
- **turbo writing itself into `AGENTS.md`** → **#791.** `"agentGuidance": false`; the advice kept
  in `AGENTS.md` in our own words. Re-verified on turbo 2.11.6 after #787.
- **Runbook pattern (a)** → **#781**, then **#782** correcting it. See the ⚠️ box in the runbook.
- **The Dependabot backlog** → **#785**, **#787**, **#799** merged (#786 superseded by #799);
  recorded in **#801**.

**Three lessons from that round, in descending order of how much they'd cost to relearn:**

1. **`turbo typecheck lint test` is the floor, not the ceiling.** It does not exercise CDK
   bundling or the staging gate's own invocation. #762 was green on every PR check and broke
   `main`'s Deploy **twice**. After any broad dependency bump, watch `main`'s Deploy to
   completion before calling it done.
2. **CI runs npm 11.13.0, not the `packageManager: npm@10.8.2` pin.** `actions/setup-node` reads
   `.nvmrc` with no corepack step, so npm is whatever Node bundles. Validating a lockfile with
   10.8.2 is a **false green** — on #799 it exited 0 while CI rejected the same file.
3. **`@dependabot recreate` does not fix a `Missing: … from lock file` failure.** It re-runs the
   same resolution. Regenerate the lockfile and push it to the branch instead.

---

## Live work

**One item now blocks nothing today but guarantees a repeat**, and it is first because it is the
reason this file's previous revision was wrong. The rest, **all now closed or settled except two**:
one owner-only item (the PAT), two decisions (settled — one removed in #819, one deliberately left),
one optional hardening (done in #822), one loose end (the only agent-doable thing remaining, and
open-ended), one explicitly no-action.

### [x] `Dependabot Updates` "erroring" — NOT broken; the premise was wrong (closed 2026-10-07)

**What the red runs actually are.** Read with `gh api repos/DolasDev/pegasus/actions/jobs/<job-id>/logs`
(`gh run view --log` returns zero lines for a service run — see GOTCHAS). Every failure since
2026-10-01 is a **security** job for one alert that cannot be satisfied:

| Run          | Package         | Error                                     | Why                                                                                                 |
| ------------ | --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 10-06 ×3     | katex           | `security_update_not_possible`            | `mermaid@11.17.2 requires katex@^0.16.47`; fix is 0.18.2. Mermaid 12.1.0 still declares `^0.16.47`. |
| 10-02        | brace-expansion | `security_update_not_possible`            | resolves to 5.0.9 — the copy bundled in aws-cdk-lib, which overrides cannot reach                   |
| 10-01, 10-02 | @grpc/grpc-js   | `NoChangeError` ("No files were updated") | the same no-op re-resolution `audit-ci.jsonc`'s GHSA-m9gg entry records                             |
| 10-05 20:59Z | aws-cdk-lib     | unknown (log expired: `BlobNotFound`)     | succeeded on the same commit 57 min later — transient                                               |

The weekly **version-update** runs (npm, pip, actions, 10-02 → 10-04) all succeeded. There is nothing
to fix in `.github/dependabot.yml`.

**Why shell-quote had no PR — the real lesson.** No shell-quote alert exists in any state.
`GHSA-pqg4-j6r4-53mv` was published 13:40Z on 10-06; `audit-ci` (npm's bulk advisory endpoint) went
red ~15:51Z; #808 merged 16:17Z. GitHub had not yet raised an alert, so Dependabot had nothing to act
on. Advisory → alert lag over the last 30 alerts: **median ~24h**, min 0.1h, and 12–107 days for
five of them (sprintf-js, braces, node-forge, fflate, image-size; cause not established).

**So, permanently, not "until it's green":** "no Dependabot PR" never means "no advisory". `audit-ci`
sees a same-day advisory hours to days before Dependabot does. The pre-enqueue check stays:
`npx --no-install audit-ci --config ./audit-ci.jsonc`.

**The red runs should stop.** Security jobs are driven by **open** alerts, and all nine were dismissed
on 2026-10-07 with reasons (see "Don't redo these"). Unverified at the time of writing: no push to
`main` had happened since. If a `for katex` run goes red again after one, the dismissal theory is wrong.

**Done — daily audit of `main`:** `.github/workflows/dependency-audit.yml` runs `audit-ci` at 07:23 UTC
(and on `workflow_dispatch`). A failure turns the run red and opens — or comments on — the issue
**"Daily dependency audit: main is red"**; the next green run closes it. CI's `Lint` job and the daily
job share `scripts/audit-ci.sh`, so the gate (and its npm-endpoint-error pass-through) cannot drift.
**When that issue is open, fix `main` before enqueuing anything** — every queued PR will be ejected.

### [ ] `DEPENDABOT_AUTOMERGE_PAT` — owner-only, and the highest-leverage item left

See `plans/todo/dependabot-automerge-pat.md`. **No code change** — the workflow already reads
`secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`. It needs the secret set, which only
you can do.

**Eight reproductions:** #645, #656, #387, #657, #709, #710, **#762**, **#799**. A
`GITHUB_TOKEN`-initiated enqueue gets a queue entry but **no `merge_group` checks**, so the PR
sits at the head of the queue doing nothing until someone nudges it. The two measured ones:

| PR   | bot-enqueued, no run for | after dequeue + human-token re-enqueue |
| ---- | ------------------------ | -------------------------------------- |
| #762 | 18 min                   | **~28 s**                              |
| #799 | 21 min                   | **~5 s**                               |

#799 is the cleanest evidence yet: `pr-798`'s group run had succeeded minutes earlier and Actions
was `operational`, so neither the queue nor the outage explains it.

**Bookkeeping lesson:** "auto-merge was enabled" and "the queue will actually build it" are
independent claims. Confirm the second with a `merge_group` run **for that PR number** before
recording a PR as healthy — see the ⚠️ box in the runbook for why the first claim's usual
signature lies.

### [x] Decision: should `@playwright/mcp` stay an `apps/e2e` dependency? — NO, removed (#819)

It pulled a **prerelease** `playwright` into `apps/e2e/node_modules`, which shadows the stable
runner for anything resolved from that directory. #784 routed around it by spelling out
`node ../../node_modules/.bin/playwright` at every call site (root `.bin/playwright` is linked
from `@playwright/test` itself, so runner and library always agree) — but `.claude/settings.json`
launches the MCP server as `npx @playwright/mcp@latest`, so **the declared dependency's only
observable effect in CI was the shadowing**, and every Dependabot bump re-dragged a prerelease
runner into the tree for a server fetched by `npx` anyway.

**Removed in #819** — 48 lockfile deletions, zero additions, no behaviour change. The decision was
"delete the hazard rather than route around it", and the routing-around **stays**: the explicit
`.bin` path is what makes the next such dependency a non-event, and it is now documented in terms of
the directory rather than this one package. Full outcome and the three positional proofs are under
"Resume here".

### [ ] Decision: the TENANT-03 **timeout** (the leak half is already fixed)

Verified on `main` 2026-10-06: `apps/mobile/jest.config.js` has `testTimeout: 45000` (#775),
`"test"` is still `jest --forceExit` **deliberately** (dropping it would let a future leak hang a
CI job rather than warn), and `npm run test:handles` is the discoverable leak check from #780.

The unapplied candidate: replace `await act(async () => { fireEvent.press(...) })` with
`fireEvent.press(...)` then `await waitFor(() => expect(...))` in
`apps/mobile/__tests__/app/(auth)/tenant-picker.test.tsx` — **3 of its 6 tests**, at lines 59, 70
and 90 (re-counted 2026-10-06; this file once claimed "four").

It remains **unverifiable locally** — the file passes 6/6 in ~1s with zero open handles, so only
several real CI runs could show whether it helps.

**What I'd do: leave it.** The 45 s budget has held since #775 and the leak that produced the
force-exit warning is gone, so this would be an unverifiable rewrite chasing a flake that may no
longer fire. Revisit only if TENANT-03 actually exceeds 45 s in a real run — and then capture
that run's log **while it is live**, because it is the evidence this item has never had. (An
expired log is exactly what cost #746 its cause.)

### [x] Optional hardening: three `nodeModules` entries were root-resolvable _by luck_ — declared (#822)

#783 added `packages/infra/lib/stacks/__tests__/cdk-node-modules-root-resolvable.test.ts`, which
asserts every CDK `bundling.nodeModules` package has a root `node_modules/<pkg>` lockfile entry
(static, ~130 ms, proven red against #762's actual lockfile). `sharp` was declared at the root by
#783; these three were not, and sat there only because nothing had displaced them yet:

| package                    | root entry                                            | bundled by                       | now declared     |
| -------------------------- | ----------------------------------------------------- | -------------------------------- | ---------------- |
| `@napi-rs/canvas`          | 0.1.100 (plus a 1.0.3 copy nested under `pdfjs-dist`) | DocumentsStack ConverterFunction | `^0.1.99` (#822) |
| `@cedar-policy/cedar-wasm` | 4.13.0                                                | api-stack ApiFunction            | `^4.13.0` (#822) |
| `expo-server-sdk`          | 6.1.0                                                 | api-stack PushForwardFunction    | `^6.1.0` (#822)  |

**Done in #822** — three root `devDependencies` edges plus a `//devDependencies` note each, the
same shape #783 used for `sharp`. Lockfile effect: **3 insertions, nothing else** — the root entries
already existed, so the edges only record the intent and no package moved. The `@napi-rs/canvas`
0.1.100 / `pdfjs-dist` 1.0.3 split is preserved and is correct: the root stays on 0.1.x for the
bundler while `pdfjs-dist` keeps the major it needs.

> ⚠️ **This item's own step 2 told the next agent to pin to "the versions already in the lockfile"
> (0.1.100 / 4.13.0 / 6.1.0). That was wrong for `@napi-rs/canvas` and is corrected here.** The rule
> — stated in `sharp`'s and `tsx`'s own `//devDependencies` notes — is **keep the root range EQUAL to
> the workspace's**, because a divergent range is precisely what makes npm nest instead of hoist,
> which is the entire #762 mechanism. For a 0.x caret `^0.1.99` and `^0.1.100` are _different_
> ranges, so pinning to the installed version would have introduced the very divergence the edge
> exists to prevent. All three now match `apps/api` exactly.

Verified beyond the `turbo` floor, since this is the #762 class of change and `turbo` cannot see
bundling: real `cdk synth` exit 0 with all three present in the bundled assets at the expected
versions — `@napi-rs/canvas` 0.1.100 (next to `sharp` 0.35.5), `expo-server-sdk` 6.1.0,
`@cedar-policy/cedar-wasm` 4.13.0 — plus `npm ci` clean on npm 11.13.0, the #783 guard green before
and after (its value here is that it keeps passing while "by luck" becomes "by declaration"), and
`turbo typecheck lint test` 41/41.

### [ ] Loose end: `check-overrides.mjs` reports 47 of 49 overrides as removal candidates

**Its stated cause in this file was wrong, and is corrected here.** The old note blamed a
local-vs-CI npm split — local npm 11 not emitting the `overridden` flag "while CI pins
npm@10.8.2". Both halves are false:

- `.github/workflows/override-expiry.yml` uses `actions/setup-node` with `node-version-file:
.nvmrc`, so **the workflow runs npm 11.13.0 too.** There is no divergence to explain, and the
  monthly issue it files would say the same thing a local run does.
- **npm 11 does still emit `overridden`** — measured on this tree: exactly **2** nodes, and they
  are precisely the 2 the script reports as active (`react`, `react-native`). So the script's key
  works; the flag is simply narrow.

Measured 2026-10-06: 49 targets checked → **4 dead** (`@eslint/eslintrc`, `handlebars`,
`path-to-regexp`, `rollup` — package no longer in the tree at all), **43 inert** (installed, no
node marked `overridden`), **2 active**.

So the real question is narrower than "is this a false signal?": **is npm's `overridden` flag now
marking only the node that directly satisfies the override, rather than every instance it
forced?** If so, "no node marked overridden" is not evidence an override is inert, and 43 is an
over-count.

The script already states the right caveat and the test for it — a removal candidate is not a
safe delete, because "removing it lets the resolver run unconstrained, which can pull a lower
version a parent range still permits." Its recipe: delete the entry,
`rm -rf node_modules package-lock.json && npm install`, then run the affected suite. The 4 dead
ones are the cheapest place to start — though note `handlebars` is there for CVE-2019-19919, so
read the `//overrides` note before removing a security entry even when the package is gone.

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

### Five diagnosis traps

- **`gh run list --event merge_group` returns STALE data here** — it reported only runs from six
  days earlier while today's were live. Filter client-side instead:
  `gh run list --limit 40 --json createdAt,event,status,conclusion,headBranch -q '.[]|select(.event=="merge_group")|…'`
- **An ejected PR's failing run is NOT among its own checks.** `isInMergeQueue:false` while still
  `OPEN` means ejected; the run lives at `gh-readonly-queue/main/pr-<N>-<base>`. Find it with the
  client-side query above, then `gh run view --log-failed --job <id>`.
- **`gh run list --branch main` goes stale too, and far worse.** On 2026-10-06 it returned runs
  from **September 23** as its newest rows, which reads as "main's last CI was weeks ago". Do not
  diagnose `main`'s health from it. Ask the commit instead — this cannot drift:
  `gh api "repos/DolasDev/pegasus/commits/$(/usr/bin/git rev-parse origin/main)/check-runs?per_page=40"`,
  grouped by `conclusion`. Same family as the two traps above: a tool that answers confidently
  with old data is more dangerous than one that errors.
- **A docs-only PR can be green on every branch check and still be ejected — and this is
  structural, not a flake.** `ci.yml` path-filters the heavy jobs away for a docs/plans-only diff, so
  `Lint` (which carries `Audit dependencies`) reports `skipping` and branch protection is satisfied
  vacuously. The merge queue runs every job **unconditionally** — the
  `|| github.event_name == 'merge_group'` clause `ci.yml` documents and `scripts/check_ci_merge_group.py`
  enforces — so a docs PR is the **first thing to discover a pre-existing failure on `main`**, and the
  ejection names it as the culprit. #807 was ejected by #808's advisory. **Before blaming your diff,
  check whether the same job passes on `main`'s own head commit.**
- **`npm update <pkg> --package-lock-only` can GUT the lockfile and report success.** Run while
  `package.json`'s `overrides` contained an invalid entry, it deleted **32,997 lines** of
  `package-lock.json`, printed a cheerful `up to date, audited 16 packages`, and exited **0**. The next
  `npm install` then failed with an `ERESOLVE` about `react-native-worklets` peer ranges — which reads
  as a genuine dependency conflict and is nothing of the kind. **Check `git diff --stat package-lock.json`
  after any lock-affecting command**; a 3-line change is a floor raise, a 30,000-line change is damage.
  Recovery is `git checkout origin/main -- package-lock.json` then one plain `npm install`.
  (The invalid entry, for the record: a `//`-prefixed comment key placed **inside** `overrides`. Those
  belong in the sibling top-level **`//overrides`** block — npm rejects them in `overrides` with
  "Override without name".)

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
   lockfile keeps. Showed up unrelated in three worktrees. `git checkout -- package-lock.json`
   unless you deliberately changed a dependency — this prune is also why #779's lockfile edit was
   made by hand rather than by `npm install --package-lock-only`. Note the `--`: without it a session
   hook rejects the command as a branch switch on the primary worktree.

   > A second, _smaller_ lockfile churn to expect and **keep**: `npm install --package-lock-only`
   > drops a stale `"peer": true` from `apps/api/node_modules/hono` (1 line). That node is forced by
   > the root `overrides` entry `"hono": ">=4.13.3 <5"`, not by a peer edge, so npm 11 is correcting
   > the metadata. Observed on #819. Unlike the `babel-preset-expo` prune this is not a structural
   > change, and hand-reverting it only re-churns on the next install.

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
  copy an override cannot reach. Their Dependabot **alerts** — and katex, sprintf-js, braces,
  node-forge — were **dismissed 2026-10-07** with a reason and a "revisit when" comment each; zero open.
  Dismissed alerts do not reopen on their own, so those comments are the only reminder.
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
