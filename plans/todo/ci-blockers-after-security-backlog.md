# CI blockers + merge-queue maintenance left after the security backlog

> **Resume point — checkpointed 2026-10-22 against `main` @ `7a7c5dde`.** Read **"Resume here"**
> immediately below, then "State of play", then pick from "Live work". The body was last fully
> re-verified 2026-10-06 (late) against `c60c00db`; since then: 10-07 closed the `@playwright/mcp`
> decision (#819), 10-09 closed the `nodeModules` hardening (#822) and wired the merge-queue App
> token (#826), 10-12 corrected the cadence + npm-recipe claims (#840), and 10-13 dropped the policy
> gate's `--squash` and made it log both auto-merge signals (#843), and 10-15 recorded the findings
> (#849). **The 10-19 re-check changed the picture: the stage-2 log line is DISCHARGED, but `main`
> carries a failing check and two Dependabot PRs are stuck — one dead for four days. There IS
> agent-doable work now; see "Resume here".** All three were worked the same day: #856 unstuck,
> #861's lockfile regenerated, and #843's assertion tightened to `exit 1`.
>
> ⚠️ **2026-10-23 SETTLED all three npm alerts and the hypothesis the 10-22 checkpoint proposed was
> WRONG.** The failing runs are **security** jobs (the 10-22 half that held up), but our `overrides`
> were **not** blocking them — that was never verified and is now falsified by the service logs
> themselves. The real causes are two **transitive pins**, neither involving an override:
> `@vitest/coverage-v8` exact-peers `vitest`, which exact-pins the vulnerable `@vitest/mocker`; and
> the vulnerable `hono` was the **root** copy that exists only for hoisted `@hono/*` peers, so
> Dependabot's `direct`-only security job found no edge to change and died with `NoChangeError`.
> Fixed in one PR, which also cleared a **brand-new red audit gate on `main`** (dompurify, issue
> #882). See the section below.
> ⚠️ **A diagnosis built on this file's own documented trap reached the merge queue on 2026-10-13
> before being caught.** `autoMergeRequest: null` was read as "policy never approved this PR" when it
> is null _because the PR was queued_. The PR's commit message and body had to be rewritten and
> force-pushed. Written up as the sixth diagnosis trap — read that one even if you skip the rest.
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

**Where:** worktree `/home/steve/repos/pegasus-transitive-security-pins`, branch
`fix/transitive-security-pins`, off `main` @ `7a7c5dde`. The primary checkout stays parked on `main`.

**Status (worked 2026-10-23):** everything this file owned is merged — #819, #822, #826, #840, #843,
#849, #864, #865 — and the one live thread, the failing Dependabot service runs, is **diagnosed and
fixed** below. `main` was green at `7a7c5dde` on checks but its **daily audit went red at 12:42Z on
10-23** (issue #882, dompurify); this PR clears that too.

**All three npm Dependabot alerts are fixed here, and the 10-22 hypothesis they were blamed on is
falsified.** What is left on this file after this PR is **owner-only** (the GitHub App) plus two
parked threads.

### [x] The failing Dependabot runs — DIAGNOSED AND FIXED 2026-10-23

**All three npm alerts are closed by one PR, and the 10-22 hypothesis was wrong.** The 10-22
checkpoint proposed that "the repo's own `overrides` are blocking its own security fixes
(`vite` for two `@vitest/mocker` alerts; `hono` for its own)". It labelled that unverified, which
was right: **it is false.** No override blocked anything. Both real causes are transitive pins,
and the evidence was in the service-run logs the whole time.

**What actually failed, read from the job logs (not inferred):**

| job                  | error                                   | real cause                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `for @vitest/mocker` | `security_update_not_possible`          | `@vitest/coverage-v8@4.1.11` exact-**peers** `vitest@4.1.11`, and `vitest@4.1.11` exact-pins `@vitest/mocker@4.1.11`. A two-level pin chain.                                                                                 |
| `for hono`           | `NoChangeError: No files were updated!` | The vulnerable copy was the **root** `hono@4.13.7`, which exists only to satisfy the hoisted `@hono/*` peers. There is no direct root edge, and the job is `allowed-updates: direct`, so it had nothing to edit and crashed. |

**How the override story was killed.** Three independent checks, each cheap:

- `@vitest/mocker@4.1.12` declares `peerDependencies.vite = "^6.0.0 || ^7.0.0 || ^8.0.0"`. The
  installed `vite` is **8.3.4**, which satisfies it. The override `>=8.3.3 <9` was never in the way.
- The `@vitest/mocker` job log names **no peer conflict and never mentions vite**. Its
  `conflicting-dependencies` entry is `@vitest/mocker` pointing at _itself_, with
  `top_level_ancestors: []` — Dependabot simply never walked up the chain.
- `npm update hono --package-lock-only` moved root `hono` 4.13.7 → **4.13.13 with the override in
  place**, in a 16-line diff. An override that permits the patched version cannot be the blocker.

**The `vite` override's history, which step 2 of the old next action asked for.** `git log -S` found
exactly one commit: **#872 (`838d9811`, 2026-10-21)**. It is **not** the #779 `.bin`/`tsx`-peer
story this file guessed at — that guess predated the override by two years of repo time. #872 added
it as a **security floor** for GHSA-587h-7wmj-h5pm (high, launch-editor bypass, affects
`>=8.3.0 <=8.3.2`): the root vite that vitest resolved was 8.3.0 while the web apps already had
8.3.3, and the audit gate was red repo-wide. So the entry **is** load-bearing — just for a
different reason than predicted, and the old next action's step 4 caution ("do not delete a
security-motivated override to make a bump pass") was the correct instinct aimed at the wrong target.
**It now has the `//overrides` note it was missing**, which is what made this re-derivable at all.

**What the fix is:**

- **`vitest` 4.1.11 → 4.1.12 and `@vitest/coverage-v8` → 4.1.12, together.** Moving either alone is
  impossible: each exact-peers the other. Both alerts' package, `@vitest/mocker`, follows to 4.1.12.
- **Declared floors raised in all 14 manifests** (`vitest` `^4.1.11` → `^4.1.12`;
  `@vitest/coverage-v8` `^4.0.0` → `^4.1.12`). This is the #872 lesson applied: the old ranges
  _already permitted_ 4.1.12, which is exactly why `npm update vitest` reported "up to date" and
  changed nothing. **A range that permits a fix is not a floor that pulls it.** Without the raise
  there is nothing durable and the next `npm install` is free to resolve back down.
- **`hono`'s override floor raised `>=4.13.3` → `>=4.13.11`** for GHSA-5r4p-p66f-jhc7. This
  _tightens_; it does not relax. It also matches that note's own stated design ("kept as a RANGE,
  not a pin, so routine 4.x bumps do not re-block"). Root `hono` goes to 4.13.13 and the nested
  `apps/api` duplicate **collapses into it** — one `hono` line, which is the override's whole purpose.

**A NEW CI blocker found while verifying, and fixed in the same PR.** `scripts/audit-ci.sh` failed
on a package this change does not touch: **`dompurify` 3.4.16**, on GHSA-cg2g-xh64-v4q7 (**critical**)
and GHSA-mrv2-3pqr-j5jr (high), **both published 2026-10-22 16:25Z**, both fixed in 3.4.17. `main`'s
daily audit went red at 2026-10-23 12:42Z and auto-filed **issue #882** about an hour before this was
found. Not caused by this PR — `dompurify` is 3.4.16 on both sides of the diff — so this is the
documented live-advisory-feed flip, the same shape as `shell-quote` and `brace-expansion`. Chain is
`apps/tenant-web > mermaid@11.17.2 > dompurify`, mermaid's range is `^3.3.3`, single root-hoisted
copy, so an override reaches it: added `"dompurify": ">=3.4.17"` with a note. **CLAUDE.md's
"fix the pipeline first" rule is why this is in this PR rather than a follow-up.**

> ⚠️ **Two `//overrides` notes give OPPOSITE lockfile recipes, and `hono`'s is the stale one.**
> `hono`'s note says to delete the `*/node_modules/hono` keys from `package-lock.json` before
> `npm install`. `brace-expansion`'s note carries a **CORRECTION** saying _not_ to — deleting a lock
> key **prunes** the package instead of re-resolving it. The correction is right and is the recipe
> that worked here for `dompurify`: **`npm update <pkg> --package-lock-only`, then `npm install`,
> then confirm with `npm ls <pkg>`, then a real `npm ci`.** Raising the floor and running
> `npm install --package-lock-only` alone left `dompurify` at 3.4.16 — npm had no reason to move a
> version its tree already satisfied. `hono`'s note should be corrected to point at
> `brace-expansion`'s; it is only harmless here because `hono`'s single copy happened to re-resolve.

**The standing finding worth keeping.** Dependabot's **security** jobs here run
`allowed-updates: [{dependency-type: direct}]` with `update-subdependencies: false`, and
`.github/dependabot.yml` has **no `allow:` key at all** — so that is the platform default, not our
configuration. Consequence: **a vulnerable package that is reachable only transitively will always
fail these jobs**, either as `security_update_not_possible` (pinned by an ancestor) or as
`NoChangeError` (no direct edge at all). Both of today's failures are that one shape. Combined with
the gate being `"high": true` while all three alerts were **medium**, nothing in CI would ever have
escalated them — they were visible only via
`gh api repos/DolasDev/pegasus/dependabot/alerts?state=open`. **Treat a red Dependabot service run
on a transitive package as "ours to fix by hand", not as a Dependabot outage.**

**Verification run (the full #861 floor, because this moves a runtime dep that the API Lambda
bundles):** `npm ci` 0 · `turbo typecheck lint test --force` **41/41 with zero cache** · `audit-ci`
**PASS** (it was _failing_ before the dompurify floor) · real `cdk synth --all` 0 with the API bundle
built and `hono` inlined · lockfile integrity checked the #861 way — **2324 → 2323 keys, zero
additions, and the single removal is `apps/api/node_modules/hono`**, the duplicate the override is
there to collapse. 16 version changes, all accounted for: the `@vitest/*` family + its transitive
deps, `dompurify`, `hono`. **`vite` is untouched at 8.3.4** — the clearest statement that the
override hypothesis was a dead end.

**Next action — nothing on this thread.** All four alerts are addressed: three npm by this PR, and
`certifi` by **#869**, which is **OPEN, CLEAN, MERGEABLE, every check green, and
`autoMergeRequest=false` since 2026-10-20** — i.e. the exact "auto-merge consumed, queue entry
dropped" state item 1 below documents, now in its **fourteenth** reproduction and third day dead. It
needs a human `gh pr merge 869 --auto` nudge; that nudge is operationally right and **proves nothing
about the App** (see below). The remaining work on this file is owner-only.

**Also still open, unchanged:**

- **OWNER-ONLY and the only thing that unblocks the last verification:** configure the GitHub App.
  **Re-confirmed still unset 2026-10-22** — zero `DEPENDABOT_AUTOMERGE_APP_CLIENT_ID` variables and
  zero `DEPENDABOT_AUTOMERGE_APP_PRIVATE_KEY` secrets. **THIRTEEN reproductions:** the thirteenth was
  #861 on 10-19, which stalled 3+ min with no group run and produced one 17s after a human nudge —
  and it was blocking #865, this stream's own PR, at the head of the queue. An agent cannot do this;
  **ask rather than work around it.**
- **`@dependabot rebase` appears inoperable here**, cause unidentified, obvious suspect ruled out.
- **The `check-overrides.mjs` question** — **back to purely open-ended.** The 10-22 checkpoint
  claimed this thread had gained "a concrete first case (`vite`, and probably `hono`)". **It had
  not**: neither override blocked anything (see the section above), so that case evaporated. Two of
  this repo's overrides were _raised_ on 10-23 and none was removed. Still **not** a licence to
  delete entries, and now with no worked example pointing at one.
- **#869** (`certifi`, the one **critical** alert, pip) is **OPEN, CLEAN, MERGEABLE, all checks
  green, `autoMergeRequest=false`** as of 2026-10-23 — three days dead in the documented
  stalled-queue state. **Fourteenth reproduction.** Needs a human `gh pr merge 869 --auto`; that is
  a merge action, so ask rather than assume. It is the only one of the four alerts with a PR.

**Uncommitted work:** none. The 10-22 checkpoint had been left dirty in the **primary** checkout;
on 10-23 it was carried into this worktree with `git diff > …/plan-1022.patch` + `git apply`, amended
with the real diagnosis, and lands with the code in one PR. The primary's copy is discarded with
`git checkout -- plans/todo/ci-blockers-after-security-backlog.md` **once this PR carries the
content** — note the `--`, without which a session hook rejects the command as a branch switch.

**In flight (2026-10-23):** this task owns the worktree `transitive-security-pins` (branch
`fix/transitive-security-pins`, Postgres 5490) and no background watcher. Other streams own **#881**
(`activity-labor`) and **#880** (`3b2-staging-acceptance`), plus the worktrees `a9-identity`,
`activity-labor`, `deps-advisory-flip` (parked on `chore/parked-dr`), `move-chat-app`,
`pulse-nw-enablement`, `pulse-tasks`, `ringcentral-forward-skip-unconfigured` — none are mine; do
not touch them. **#869** (certifi) and **#145** (SES, draft/HOLD) are open and are not this stream's
to merge. Re-check with `gh pr list --state open` and `git worktree list`.

**Branch hygiene done 2026-10-23, and the safety check that matters.** Eight stale local branches
were deleted. "ahead of main" is **not** a staleness signal here — every squash-merged branch looks
ahead, so all ten candidates reported `ahead=1` or `ahead=2` and six of them were fully merged. The
check that actually decides it is **`gh pr view <N> --json headRefOid` against the local tip**: equal
means the merged PR carried exactly this commit and `git branch -D` is safe; extra commits mean
unmerged work. Six matched that way (#826, #861, #831, #853, #851, #870), `pr505` matched merged
**#505** despite the local branch having a hand-made name, and `chore/archive-feedback-requests-plan`
(PR **#536**, closed _unmerged_) was cleared differently: its three-dot diff was a **pure rename** of
`plans/todo/feedback-requests.md` into `plans/completed/`, and `main` already has the file archived,
so the branch's only content had landed by another route. Its remote was deleted too — the only
remote branch removed; every other remote has a live PR (#869, #145, #880, #881).

**Recovery SHAs, in case any of those eight was a mistake** (`git branch <name> <sha>` restores it;
the objects stay reachable in the reflog for 90 days):

```
c1147029  chore/merge-queue-app-token                                (#826)
fde7b935  dependabot/npm_and_yarn/main/minor-and-patch-7036216bc7    (#861)
492a760c  dependabot/npm_and_yarn/main/minor-and-patch-b9f5c92442    (#831)
ed940cfe  docs/document-read-scoping-todo                            (#853)
e0bd6543  docs/nw-cloud-auth-rollout                                 (#851)
86ee2535  docs/pulse-phase7-done                                     (#870)
01b09676  pr505                                                      (#505)
033d653b  chore/archive-feedback-requests-plan                       (#536, closed unmerged; also deleted on origin)
```

After the sweep, every local branch is either a live worktree's or has an open PR, and the primary
checkout is parked clean on `main`.

**Verification still owed:**

- **~~The hypothesis in "Next action" is UNVERIFIED~~ — now TESTED, and it FAILED.** It was run
  against on 10-23 and the override-blocking story is false; the section above has the three checks
  that killed it. Recorded rather than deleted because the shape is this file's recurring failure
  mode: a plausible mechanism, named as "the leading candidate", written up with a table and a
  five-step plan **before anything was executed against it**. The log lines that refuted it were
  already fetchable when the hypothesis was written.
- **The merge-queue stage-2 proof** — a `merge_group` run from `enqueue`'s OWN enqueue — remains
  owner-gated on the App. A human `gh pr merge --auto` triggers one regardless, so nudging a stalled
  PR is operationally right and evidentially worthless.
- Nothing is owed from the 10-19 work: #856/#861/#865 all merged with CI green and `main`'s Deploy
  green through prod.

**[x] STAGE-2 VERIFICATION — DISCHARGED 2026-10-19.** #843's both-signals line has executed twice,
on the two Dependabot PRs opened after it merged:

```
PR #856 autoMergeRequest=true isInMergeQueue=false     (10-15 20:59)
PR #861 autoMergeRequest=true isInMergeQueue=false     (10-18 08:41)
```

Three things that settles, beyond "the log line works":

- **The policy gate enables auto-merge.** `autoMergeRequest=true`, printed by the gate itself. This
  is the independent confirmation that the 10-13 misdiagnosis (sixth diagnosis trap) was wrong —
  and it is the evidence that was one GraphQL field away the whole time.
- **A dormant request IS accepted under a merge queue** — the previously unverified link, now
  verified, which is what unblocks item 3 above.
- **`gh pr merge --auto` without `--squash` works**, as #843 assumed.

**What is NOT yet verified, and is the only thing the App setup still owes:** that a
**`merge_group` run appears from `enqueue`'s OWN enqueue.** Both #856 and #861 were enqueued by
`enqueue` under `GITHUB_TOKEN` and produced **no group run at all** — reproductions **eleven and
twelve**. A human `gh pr merge --auto` triggers one regardless, so nudging #856 (item 1) unblocks it
but proves nothing about the App. That proof requires the App to exist.

**SUPERSEDED 2026-10-22 — the box below described the 10-18 failure as a VERSION job. The current
failures are SECURITY jobs with different causes; the re-diagnosis at the top of "Resume here" is
authoritative. The box is kept because the `vite` /`dependency_file_not_resolvable` signature it
records is the same one that recurred on 10-20:**

- The red run is `Dependabot` (the service run, 10-18 08:31Z). This file's closed item says red
  `Dependabot Updates` runs are **declined security updates** and benign. **That does not cover this
  one.** This was a `"command":"version"` job, and it **partially succeeded**: it created the
  `minor-and-patch` group PR (#861) and failed on exactly one dependency:

  ```
  | vite | dependency_file_not_resolvable | { "message": "Error while updating peer dependency." } |
  ```

- So the taxonomy of red Dependabot runs is: (a) declined security updates — **benign**; (b) genuine
  service failures; (c) **a version job that created its PR but could not resolve one dependency**
  (10-18, `vite`); and — added 2026-10-22 — (d) **a SECURITY job that cannot resolve a dependency**,
  which is the same `vite` / `dependency_file_not_resolvable` signature arriving on a different job
  type (10-20), plus `hono` / `unknown_error` (10-21 ×2). (a) is noise; (c) and (d) are the same
  underlying resolution problem and are what the next action investigates.
- `vite` peer resolution has history here (#779 — a nested vite 8.3.1 left the root `tsx` slot
  holding vite 8.3.0's optional peer), which is why step 2 of the next action reads that commit
  before touching the override.
- **None of it blocks the merge queue.** These are service runs, not required checks on a commit the
  queue builds. Verified green on the day of each observation and again at the 10-22 checkpoint
  (`7a7c5dde`: 25 success / 17 skipped / 0 failures), with no "Daily dependency audit: main is red"
  issue open and `audit-ci` clean — and note **why the gate stays quiet**: the three npm alerts are
  _medium_ and the gate is `"high": true`, while the critical one is _pip_, which the npm gate does
  not see. Nothing will escalate these on its own.

- **`@dependabot rebase` appears inoperable here** and the runbook no longer names it as a fix. Cause
  unidentified; the obvious suspect (`No-Delete`) was ruled out. See the ⚠️ under runbook pattern (c).
  Worth 20 minutes before the next stale-base incident.
- **The merge-queue identity fix is still half-done, and the remaining half is OWNER-ONLY.** #826
  wired `enqueue` to mint a **GitHub App** installation token — re-scoped from a PAT, because a PAT
  expires and degrades _silently_ back to `GITHUB_TOKEN`. What is left is creating the App,
  installing it on `pegasus`, and setting one Actions variable + one Actions secret. Steps and the
  two traps (**Actions** store not Dependabot; **Client ID** not App ID) live in
  `plans/todo/dependabot-automerge-pat.md`. An agent cannot do it; **ask rather than work around
  it.**
- **The stage-2 verification is owed and its window is OPEN.** Confirm a real Dependabot PR produces
  a `gh-readonly-queue/main/pr-<N>-*` run within ~a minute. That is the only thing that proves the
  fix: stage 1 shows the token mints and reads, but does not exercise `enablePullRequestAutoMerge`
  under an _installation_ token, which is the one unverified link. If the App is not configured yet,
  the run carries a `::warning::` naming `GITHUB_TOKEN` as the identity — which answers "why did it
  stall" on sight.

  > ⚠️ **This file predicted "Monday 2026-10-12" and that was WRONG — the batch landed Sunday
  > 2026-10-11** (#829 hono, #830 aws-cdk, #831 minor-and-patch). The prediction came from
  > "`interval: weekly` with no `day`, so Dependabot defaults to Monday". **Do not re-derive a day
  > from the config.** Measured over the last 25 Dependabot PRs, scheduled grouped batches landed
  > mostly **Sunday** (10-11, 10-04, 09-27, 09-20, 09-13) but also **Tuesday** (09-29, 09-22, 09-15),
  > and single-package **security** bumps land on any day, on alert rather than on schedule. The
  > cadence is not a thing to predict — **ask**:
  >
  > ```
  > gh pr list --state open --author app/dependabot
  > ```
  >
  > Same family as this file's other staleness traps: a confident answer from the wrong source.

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

So: if you arrived here looking for work, the useful answers are "run the stage-2 check against an
open Dependabot PR", "ask the owner whether the App is set up yet", or "answer the `overridden`-flag
question without deleting anything yet". Inventing a task from the
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
`Six diagnosis traps`): **enqueuing was deliberately deferred during a GitHub Actions
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

**Verification still owed — ONE item, and only the App setup can produce it:** a **`merge_group` run
created by `enqueue`'s OWN enqueue**. Everything else this file owed is discharged.

- **Why this is the only one left.** #843's both-signals line — which this section previously listed
  as unforceable — **ran twice and is discharged** (see "Resume here" for the output and what it
  settles). What it did _not_ and cannot show is the downstream half: both #856 and #861 were
  enqueued by `enqueue` under `GITHUB_TOKEN` and produced **no group run at all**.
- **A human nudge does not count as the proof.** `gh pr merge <N> --auto` triggers a group run
  regardless of what `enqueue` would have done, so unsticking a stalled PR is operationally right and
  evidentially worthless. That distinction has now been got wrong once; keep it explicit.
- **So this verification is gated on the OWNER configuring the App**, not on the next Dependabot PR.
  Once configured, the next Dependabot minor/patch PR should go: policy marks it → `enqueue` fires on
  CI completion → `enqueue`'s log says `Acting as <app-slug>[bot]` → a
  `gh-readonly-queue/main/pr-<N>-*` run appears within ~a minute. All four links in one run.

**Verification discharged earlier:** #819 — `turbo typecheck lint test` green, `npm ci` clean on
npm 11.13.0, the three positional playwright proofs above, and `--list` at 10 tests in 4 files, plus
`main`'s Deploy watched to completion (the staging E2E gate from #784 is what exercises that tree).

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
anyway. **Read "Do not commit these" and "Six diagnosis traps" before starting, not after.**

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

### [ ] `enqueue` needs a non-`GITHUB_TOKEN` identity — **wiring MERGED (#826), owner setup STILL pending; 12 reproductions**

See `plans/todo/dependabot-automerge-pat.md` (filename kept; the workflow's warning message points
at that path). **Re-scoped 2026-10-09 from a PAT to a GitHub App**, because a fine-grained PAT
expires and degrades _silently_ back to `GITHUB_TOKEN`, while an App does not expire and is not
tied to a person's account.

**The code half is done (#826)** — `enqueue` mints an App installation token via
`actions/create-github-app-token@v3`, gated on a `vars.DEPENDABOT_AUTOMERGE_APP_CLIENT_ID` that is
unset today, so the step is skipped and the `||` chain falls through. Safe to have merged before the
App exists.

**What is left is owner-only:** create the App under the `DolasDev` org, install it on `pegasus`,
then set one **Actions** variable + one **Actions** secret. Full steps, both verification stages and
the traps are in the dedicated plan. Three things worth carrying here:

- **Actions store, not the Dependabot store.** `enqueue` is triggered by `workflow_run` /
  `workflow_dispatch`, neither of which is a Dependabot event. A secret filed under _Dependabot_
  would be invisible and the `||` chain would fall through with **no error**.
- **Client ID, not App ID** — `app-id` is deprecated in `create-github-app-token@v3`, and the App
  settings page shows both adjacent.
- **The silent fallback is no longer silent.** #826 makes `enqueue` print which identity it is
  acting as, and emit a `::warning::` when it lands on `GITHUB_TOKEN` (or when the var is set but
  the mint failed). That annotation is the thing that will tell you the App broke.

**Unticked on purpose.** It stays `[ ]` until **stage 2** passes — a real Dependabot PR producing a
`merge_group` run **from the `enqueue` job's own enqueue, not a human's** — because stage 1 only
proves the token mints and reads. Do not predict the next window from `interval: weekly` — see the
cadence box under "Resume here"; ask with `gh pr list --state open --author app/dependabot`.

**Confirmed NOT configured as of 2026-10-19** — no `DEPENDABOT_AUTOMERGE_APP_CLIENT_ID` variable and
no `DEPENDABOT_AUTOMERGE_APP_PRIVATE_KEY` secret exist. Checked, not assumed.

**The cost is no longer "a delayed PR". It is a DEAD PR.** #856 (2026-10-15) is the worked example:
policy marked it, `enqueue` queued it under `GITHUB_TOKEN`, no group run ever appeared, the entry was
dropped at the 60-minute timeout — and because auto-merge _converts into_ the queue entry, the mark
went with it. Four days later it sits `CLEAN`, unqueued, `autoMergeRequest=null`, with nothing left to
re-assert it (`enqueue` only re-fires on a CI completion, which needs a branch change). Every check
green, and it will never merge. **Reproductions eleven and twelve are #856 and #861.**

**Two more reproductions landed 2026-10-13, and they are the sharpest TIMED measurements this item has.**
Both were enqueued by the `enqueue` job under `GITHUB_TOKEN`, sat at position 1 `AWAITING_CHECKS`
with **no `merge_group` run at all**, and produced one within seconds of a human-token
dequeue + re-enqueue:

| PR   | bot-enqueued at | no group run after | after nudge |
| ---- | --------------- | ------------------ | ----------- |
| #842 | 02:49:53Z       | **94 min**         | **16 s**    |
| #829 | 04:37Z          | **11 min**         | **17 s**    |

Reproductions **nine and ten**. Note what they cost everyone else: a stalled entry holds the HEAD of
an `ALLGREEN` queue, so both had to be nudged rather than left — #843 was itself stuck behind #842.
That is the argument for the App setup, stated in minutes of other people's time.

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
Fix: `gh pr update-branch <N>`. This is what was wrong with #761 — it looked like a broken gate and
was only a stale branch.

> ⚠️ **`@dependabot rebase` appears INOPERABLE in this repo — do not reach for it as the fix.**
> Tried on #829 (2026-10-13 04:37Z). Dependabot answered:
>
> ```
> Dependabot attempted to update this pull request, but because the branch
> `dependabot/npm_and_yarn/main/hono-ea3c6ac3e1` is protected it was unable to do so.
> ```
>
> followed by "Oh no! Something went wrong on our end."
>
> **The cause is NOT identified, and the obvious suspect was ruled out:** the `No-Delete` ruleset
> (id 14790303, rules `deletion` + `non_fast_forward`) scopes to `~DEFAULT_BRANCH` only, so it does
> not cover `dependabot/*`. Checked, rather than assumed. Something else is refusing the force-push
> — org-level settings and classic branch protection patterns are the unexamined candidates.
>
> **What DOES work on a Dependabot branch:** a normal fast-forward push. #831's lockfile fix was
> pushed that way on 2026-10-12 and stuck (Dependabot did not force-push over it). So
> "regenerate the lockfile and push it to the branch" — the remedy in GOTCHAS for the `npm ci`
> sync failure — is unaffected. It is only Dependabot's _own_ rebase that fails.
>
> Confusingly, Dependabot DOES sometimes update these branches successfully (#829's head moved from
> `a9dd03e8` to `d4b79460` around 04:30Z on its own, and main's run list shows an
> `npm_and_yarn in / for hono - Update` run succeeding). So this is intermittent or
> operation-specific, not a flat prohibition. **Worth 20 minutes of someone's time before the next
> stale-base incident**, because the runbook used to name it as a fix and it silently isn't one.

**Queue state:**

```
gh api graphql -f query='{repository(owner:"DolasDev",name:"pegasus"){mergeQueue(branch:"main"){entries(first:10){nodes{position state enqueuedAt pullRequest{number}}}}}}'
```

### Seven diagnosis traps

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
- **`autoMergeRequest: null` AFTER the fact is not evidence the mark was never made — and on
  2026-10-13 I built a whole PR on the belief that it was.** The failure is worth the space because
  it was _already written down twice_ (the ⚠️ box under runbook pattern (a), and the
  `project_merge_queue_runbook` memory) and I walked into it anyway.

  The story: the policy gate runs `gh pr merge --auto`, and with `--squash` the queue answers
  `! The merge strategy for main is set by the merge queue` and exits 0. I read that as a refusal,
  then queried #829/#830/#842, saw `autoMergeRequest: null`, and concluded the gate had been
  approving nothing since the queue went in. I opened a PR titled "the Dependabot policy gate was a
  silent no-op", **and it reached position 2 in the merge queue** before the evidence arrived.

  It was wrong on both halves. The field is null **because the PRs were queued** — auto-merge
  converts into a queue entry and clears it. And `enqueue`'s own log proves the gate works, because
  reaching its "re-asserting auto-merge" line requires passing the `HAS_AUTO` guard:

  ```
  PR #829 is CLEAN but not queued — re-asserting auto-merge.
  PR #829 isInMergeQueue=true
  ```

  **Three lessons, in order of reusability:**
  1. **One signal is not a reading.** I checked `mergeStateStatus` and `autoMergeRequest` — two
     fields, but only one _claim_. `isInMergeQueue` was the independent signal, it was one GraphQL
     field away, and the runbook names it explicitly. Ask what would distinguish your hypothesis from
     its opposite, then query _that_.
  2. **A warning line next to a success is bait.** `! The merge strategy…` sits immediately above a
     green tick, which invites reading it as the step's outcome. #843 drops the flag for exactly this
     reason — not because the flag broke anything, but because it generated a line that reads like a
     failure and isn't.
  3. **Prefer logging both signals to remembering not to misread one.** #843's real content is that
     the step now prints `autoMergeRequest=<bool> isInMergeQueue=<bool>` every run. A note telling the
     next person not to make this mistake is weaker than output that makes it impossible.

  Recovery, for the record: dequeue via the GraphQL mutation (the PR had not merged), rewrite the
  commit message and PR body with the corrected diagnosis, force-push, re-enqueue. The _change_ was
  still worth landing — it just wasn't the change the commit message claimed.

- **SEVENTH, added 2026-10-23 — a hypothesis written up at the length of a finding becomes one.**
  The 10-22 checkpoint proposed that this repo's `overrides` were blocking its own security updates.
  It was honest about its status — "that is a hypothesis", "**not verified**", "the leading
  candidate, not a finding" — and it was still **wrong in a way that cost the next session its first
  hour**, because around those disclaimers it had accumulated a causal table, a named mechanism
  (`@vitest/mocker` peers `vite`), a five-step plan whose steps 2–4 all presupposed the conclusion,
  and a correction propagated into three other sections. Volume reads as confidence no matter what
  the hedge says.

  **What would have settled it, and was available at the time:** the failing jobs' own logs.
  `gh api repos/DolasDev/pegasus/actions/jobs/<id>/logs`, two calls. They say
  `security_update_not_possible` with `conflicting-dependencies` naming `@vitest/mocker` pointing at
  _itself_ and `top_level_ancestors: []`, and `NoChangeError: No files were updated!` for `hono` —
  **neither mentions a peer conflict and neither mentions `vite` at all.** The checkpoint instead
  read the _alert list_ plus the lockfile's peer metadata and inferred a mechanism. Same family as
  the sixth trap: a confident answer assembled from adjacent evidence while the direct evidence went
  unqueried.

  **Two narrower lessons that generalise past this file:**
  1. **An override that PERMITS the patched version cannot be blocking it.** Check that first — it is
     one `semver.satisfies` call. `hono`'s `>=4.13.3 <5` already allowed 4.13.11+, and
     `vite`'s `>=8.3.3 <9` already satisfied mocker's `^6||^7||^8`. Both were exonerated by
     arithmetic before any install was run.
  2. **`git log -S` on a bare key name can under-report, and did.** `git log -S'"vite":'` found the
     one commit that _added_ the line, which was luck: `-S` counts occurrences, so a commit that
     only changes an override's _value_ leaves the count unchanged and never appears. Use `-G` when
     you want every commit that touched the line.

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
