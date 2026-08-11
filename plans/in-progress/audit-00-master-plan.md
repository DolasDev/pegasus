# Master Plan — Remediation Ranking by Feedback-Loop Cost/Benefit

> **Status: WAVES 1–2 COMPLETE & DEPLOYED — Wave 3 in progress** — updated 2026-06-13

> **2026-08-06 — the 7 acceptance measurements are now recorded** (see the
> Acceptance Criteria section at the bottom): 3 pass, 2 miss (both CI-side, one
> shared root cause, logged against `audit-ci-pipeline-efficiency.md`), 2 held
> pending approval because they are outward-facing. That closes this file's own
> last self-owned gap; it stays open only as the index for the still-open plans.

> **2026-08-08 — both CI misses are now FIXED and the targets re-baselined.**
> #592 (`c80c2a21`) cut `Run ./.github/actions/setup` from **51-54 s to
> 13.9-15.5 s** in every job (root cause was Actions cache-storage exhaustion at
> 10.77 GB vs a 10 GB limit, not a missing cache). The two numeric criteria were
> re-baselined against the current **7-10-job** pipeline — the old figures
> described a 5-job pipeline retired by Waves 2-3 — and now read **PASS with
> headroom**. Scorecard: **5 measured (all pass), 2 held** for approval.
> `audit-ci-pipeline-efficiency.md` was **archived 2026-08-11** — its Phase 4
> (CI-failure triage) folded into `audit-ai-process-automation.md` § Phase 3,
> which already specified the same workflow as a strict superset.

> **Cleanup audit 2026-07-30 — KEEP OPEN.** Waves 1-2 and most of Wave 3 are
> verified on `main`. This file stays because it is the live index for the
> still-open audit plans below (AI automation, ntfy deploy notifications, e2e
> Phases 3-4, the lint ratchet / `no-explicit-any` burn-down, and the Python
> toolchain), and because its own 7 acceptance-criteria measurements (lines
> 118-124) were never recorded.
>
> _Count updated 2026-08-11: **10** audit plans remain open (was 11) —
> `audit-ci-pipeline-efficiency.md` is archived. The 7 measurements are now
> recorded: 5 measured and passing, 2 held for approval._

## Execution status (resume here)

Executed via parallel-worktree batch sessions (no PRs; merge locally on an
integration branch — the harness blocks edits on `main` — gate, single push):

- **Wave 1 (9 units) + Wave 2 (4 units): DONE**, deployed staging+prod, every
  live acceptance check verified (alarm email round-trip, CORS allowlist,
  throttling 25/50, e2e floors, docs-only CI skip in 15 s, `last-deploy` tag
  advancing, Vercel remote cache replaying in CI and locally, Temporal
  pre-flight armed and logging `OK:`). Checkboxes below + in the source plans
  reflect per-item state, with deviation annotations inline.
- **User-deferred (do NOT start without an explicit go):** all of
  `audit-ai-process-automation.md`, and deploy-notification items 2.2–2.4 of
  `audit-deploy-pipeline-reliability.md` (ntfy/AI-triage).
- **Next: Wave 3 below** — pause for the user's go between waves; risk items
  first per the wave note. Each phase still carries its own acceptance
  criteria; archive a source plan to `plans/completed/` only when all its
  phases are done or explicitly dropped.
- One-time follow-ups already done out-of-band: GitHub security features
  enabled (validity checks impossible on free tier); dolas-infra grants
  deployed (`secretsmanager:DescribeSecret`, OIDC-role-only — the legacy
  deploy user is at the 2048-byte IAM cap); dependabot PR #235 repaired and
  merged (repo setting "Allow auto-merge" is OFF, which is why the
  auto-merge workflow always fails — enable in Settings → General if wanted).

## Context

The 2026-06-10 delivery-infrastructure audit produced 12 executable remediation plans in `plans/in-progress/`. This master plan ranks them on **one axis**: estimated cost/benefit toward **increasing the speed and decreasing the cost of the feedback loop on changes**.

"Feedback loop" here means every point where the developer learns whether a change is good, and what it costs to learn it:

- **Inner loop** — edit → typecheck/test locally → commit → pre-push hook (seconds–minutes, many times/day)
- **CI loop** — push → 5 required checks (~3m05s wall, ~7.5 billed min, every push)
- **Deploy loop** — merge → staging → e2e gate → prod (~10–18 min, plus the _attention_ cost of watching it)
- **Truth loop** — false-green signals (tests that silently skip, dead CI guards, deploys that silently never happen) which defer feedback to the most expensive possible moment, and detection/recovery when a bad change reaches prod (the loop's catastrophic tail)

Benefit therefore counts: latency removed per iteration × iteration frequency, billed-compute removed, false-green holes closed (rework avoided), and attention freed. Cost = implementation effort from each plan's own estimates (+ any recurring $).

**⚠️ This ranking is NOT a global priority order.** Several low-ranked plans contain the most urgent items in the repo _by risk_ (unrouted prod alarms, open CORS, no rollback path). See "Do-anyway shortlist" below — those items are cheap enough that ranking them on the feedback axis must not delay them.

## Ranking

| Rank | Plan                                                                                                                       | Feedback-loop benefit                                                                                                                                                                                                                                                                                                                               | Effort (core)                   | Cost/benefit verdict                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [audit-build-toolchain-performance.md](./audit-build-toolchain-performance.md)                                             | **Inner loop, every push.** Pre-push hook drops from whole-repo 2–5 min to affected-only seconds; Vercel remote cache makes every CI run, fresh clone, and **multi-agent worktree** start warm (worktrees currently rebuild the world from cold — this directly speeds parallel-agent batches).                                                     | ~3 h (Phases 1–2)               | **Best ratio in the set.** Purest match to the axis: highest-frequency loop, biggest per-iteration cut, smallest effort.                                                                                        |
| 2    | [audit-ci-pipeline-efficiency.md](../completed/51126028-audit-ci-pipeline-efficiency.md) ✅ **DONE — archived 2026-08-11** | **CI loop, every push.** ~35 s wall + ~2 billed min off every run; docs/plans-only pushes (the most frequent commit type in this repo) drop from ~3.4 min to <1 min; fixes a false-green hole (dead expo-doctor guard) and adds timeouts so a hang can't block the ref for 6 h.                                                                     | ~3.5 h (Phases 1–3)             | **Do with #1 as a pair.** Same loop, complementary mechanisms (caching vs topology), measured baselines already in the plan.                                                                                    |
| 3    | [audit-local-dev-experience.md](./audit-local-dev-experience.md)                                                           | **Inner loop, foundational.** The Node-version footgun intermittently costs hours (corrupted node*modules, flaky pre-push) — 30 min kills it forever. Fixing the unrunnable seed restores \_local* verification of data-dependent work, replacing the slowest feedback loop that exists (test-in-staging round-trips).                              | ~6 h (Phases 1–4)               | **High.** Phase 1 alone (~30 min) has perhaps the best minutes-saved-per-minute-spent of any single item in the audit.                                                                                          |
| 4    | [audit-test-infrastructure.md](./audit-test-infrastructure.md)                                                             | **Truth loop.** Closes the silent-skip hole (12 DB-dependent suites can pass green while not running — false feedback at the cheapest-to-lie stage); deletes dead config that misdirects; coverage ratchet automates a signal that currently doesn't exist at all.                                                                                  | ~1 h (Phase 1); ~6.5 h full     | **High for Phase 1, moderate after.** Phases 3–5 (mutation cadence, mobile hygiene, shared config) are quality work, not loop speed — defer.                                                                    |
| 5    | [audit-deploy-pipeline-reliability.md](./audit-deploy-pipeline-reliability.md)                                             | **Deploy loop + a severe truth hole.** The queued-deploy cancellation bug means a merge can silently never ship — "it's deployed" feedback is currently _untrustworthy_ and has already cost re-dispatch toil. Skip-empty-migrations cuts ~5 min off most deploys; notifications convert deploy-watching (attention) into push-notification (free). | ~5 h (Phases 1–2); ~10 h full   | **Moderate-high.** Effort is real, but the cancellation fix removes the single most expensive _kind_ of false feedback in the pipeline. Phases 3–4 (stack manifest, dedup) are maintenance-cost items — defer.  |
| 6    | [audit-e2e-strategy.md](./audit-e2e-strategy.md)                                                                           | **Truth loop, large hole.** PR CI runs zero browser tests (the 7-second "pass" is mostly skips) and the staging gate can't catch write regressions — so UI/write defects get their first real test in staging or prod, the most expensive feedback there is. The minimum-executed-tests guard (Phase 1, ~1.5 h) kills the false-green cheaply.      | ~1.5 h (Phase 1); +2.5–3 d full | **Moderate.** Phase 1 is a quick win; Phases 2–3 buy early detection at meaningful effort (and add ~minutes to PR CI — a deliberate latency-for-truth trade). Do Phase 1 now, schedule Phases 2–3 after Tier 1. |
| 7    | [audit-ai-process-automation.md](./audit-ai-process-automation.md)                                                         | **Adds a feedback channel that doesn't exist.** AI PR review ≈ a second pair of eyes within ~5 min of opening a PR (a solo dev otherwise gets _no_ review feedback, ever); CI-failure triage replaces log-spelunking with a posted hypothesis.                                                                                                      | ~4 h + ~$25–60/mo               | **Moderate.** Doesn't speed existing loops — it adds review/triage feedback at near-zero marginal attention cost. Value compounds with PR volume; recurring $ and a tuning week are the cost.                   |
| 8    | [audit-observability-alerting.md](../completed/audit-observability-alerting.md) ✅ **DONE — archived**                     | **Tail of the loop.** "Did my change break prod?" currently has feedback latency = ∞ (11 alarms, zero subscribers). Phase 0 (~1 h) makes it minutes. Insights saved queries cut investigation time when feedback does arrive.                                                                                                                       | ~1 h (Phase 0); ~1 d full       | **Moderate on this axis, urgent on risk.** Detection isn't iteration speed — but for a trunk-deploying solo dev it bounds the cost of every bad change. Phase 0 is in the do-anyway shortlist.                  |
| 9    | [audit-rollback-release-safety.md](./audit-rollback-release-safety.md)                                                     | **Caps worst-case loop cost.** Rollback-to-SHA turns "bad deploy" from hours of revert-and-pray into minutes; Neon safety branches make migration failures recoverable. Enables _confidence_ to ship fast more than speed itself.                                                                                                                   | ~1.5 d                          | **Moderate-low on this axis** (pays out only on bad deploys), but it's insurance that makes the fast loop safe to use. High on the risk axis.                                                                   |
| 10   | [audit-python-toolchain.md](./audit-python-toolchain.md)                                                                   | **Moves Python feedback from release-time to PR-time** — currently SDK/stdlib changes get zero CI until a version tag, so defects feed back at publish, the worst moment. Frequency is low (Python changes are occasional), capping total benefit.                                                                                                  | ~1 d (Phase 1 alone ~1–2 h)     | **Low-moderate.** Do Phase 1 (PR CI job) before the next Phase-3 workflows push, when Python change-frequency spikes; the rest can wait for that same trigger.                                                  |
| 11   | [audit-security-supply-chain.md](./audit-security-supply-chain.md)                                                         | **Mostly orthogonal to loop speed.** CodeQL/dependency-review add early-warning feedback for a rare defect class, and slightly _increase_ PR latency. Override-expiry automation removes a small recurring chore.                                                                                                                                   | ~4.5 h                          | **Low on this axis** — but Phase 0 (turn on free GitHub security features, ~30 min) is in the do-anyway shortlist.                                                                                              |
| 12   | [audit-security-runtime-hardening.md](./audit-security-runtime-hardening.md)                                               | **~Zero feedback-loop impact.** CORS, throttling, headers, tenant-isolation guards protect the product, not the loop. (The tenant-isolation CI guard test is the one loop-relevant sliver: it converts a class of cross-tenant bugs into PR-time failures.)                                                                                         | ~2.25 d                         | **Lowest on this axis — explicitly NOT lowest priority overall.** On a risk axis this plan is near the top; its Phase 1 quick wins are in the do-anyway shortlist.                                              |

## Do-anyway shortlist (risk items the ranking must not bury — ~3.5 h total)

These are cheap, urgent, and independent of the feedback-loop ordering. Slot them into the first working session regardless of rank:

- [x] Alarm email routing + OK-actions — `audit-observability-alerting.md` Phase 0 (~1 h)
- [x] Confirm repo visibility is intentional + enable free GitHub security features + SECURITY.md — `audit-security-supply-chain.md` Phase 0 (~30 min)
- [x] CORS allowlist (both layers), SKIP_AUTH prod fail-fast, API GW throttling — `audit-security-runtime-hardening.md` Phase 1 (~half day)

## Plan

Execution in three waves. Each checked item = execute that phase of the named plan (the phase carries its own acceptance criteria); archive each source plan to `plans/completed/` only when ALL its phases are done or explicitly dropped.

### Wave 1 — Quick-win sweep (~1.5 days total; do as one focused block)

- [x] Do-anyway shortlist above (~3.5 h)
- [x] `audit-local-dev-experience.md` Phase 1 — `.nvmrc` + engine-strict (~30 min)
- [x] `audit-ci-pipeline-efficiency.md` Phase 1 — dead-guard fix, timeouts, Node 24 (~30 min; coordinate Node pin with the `.nvmrc` item above)
- [x] `audit-build-toolchain-performance.md` Phases 1–2 — pre-push scoping + remote cache (~3 h)
- [x] `audit-test-infrastructure.md` Phase 1 — silent-skip guard + dead-config deletion (~1 h)
- [x] `audit-e2e-strategy.md` Phase 1 — minimum-executed-tests guard + ergonomics (~1.5 h)
- [x] `audit-deploy-pipeline-reliability.md` Phase 1 — timeouts, skip-empty-migrations, VPN pre-flight (~1.5 h)

### Wave 2 — Structural feedback-loop work (~3–4 days)

- [x] `audit-ci-pipeline-efficiency.md` Phases 2–3 — composite setup action, caches, paths-filter (~3 h)
- [x] `audit-deploy-pipeline-reliability.md` Phase 2 — cancellation-proof change detection + deploy notifications (~3–4 h) _(2.1 cancellation-proof detection shipped — marker is a force-pushed `last-deploy` git tag, not a repo variable: GITHUB_TOKEN cannot write Actions variables (403, needs a fine-grained Variables PAT); 2.2–2.4 notifications deferred by user)_
- [x] `audit-local-dev-experience.md` Phases 2–4 — seed fix (TDD), one-command bootstrap, doctor (~5 h)
- [ ] `audit-ai-process-automation.md` Phases 0–3 — AI PR review + CI-failure triage (~2.5 h + tuning week) _(deferred by user 2026-06-11 — revisit later)_
- [x] `audit-e2e-strategy.md` Phase 2 — browser coverage in PR CI (~1–1.5 d)

### Wave 3 — Insurance, depth, and the rest (as capacity allows; risk items first)

- [x] `audit-rollback-release-safety.md` Phases 1–3 (~1.5 d) _(shipped & deployed via #252: Phase 1 1a–1d, Phase 2b, Phase 3 3a–3c. **Outstanding:** 2a Neon safety branch (blocked on `plans/todo/neon-branches-for-e2e-isolation.md`) + 2c AI migration review (AI-automation hold). Source plan stays in-progress until those land/drop.)_
- [x] `audit-observability-alerting.md` Phases 1–2 (~1 d) _(shipped & deployed via #253; reconcile alarm via #251 Unit 11. Source plan archived to `plans/completed/`. Optional Slack/dashboard-footer + Phase 3 AI triage left undone by design.)_
- [x] `audit-security-runtime-hardening.md` Phases 2–3 (~1 d) _(shipped & deployed 2026-06-17 via #295 (P2 security headers) + #297 (P3 tenant-isolation db-access guard + RLS-deferred decision). Headers live-verified on prod+QA tenant/api hosts (HSTS/nosniff/frame-DENY/referrer; CSP report-only tenant-only; no CORS clobber on api). P3 schema-sync hoist was already complete. **Source plan stays in-progress:** Phase 4 ops items remain — Lambda concurrency quota (L-B99A9384), WAF, `/docs` gate, path-filtered AI security-review.)_
- [x] `audit-security-supply-chain.md` Phases 1–4 (~4 h) _(implemented on branch `audit/security-supply-chain` — CodeQL default setup, dependency-review.yml, Dependabot actions+pip ecosystems, Betterleaks SHA-256 gate, pip-audit, pyproject caps, deterministic override-expiry checker+workflow. **Deferred:** Phase 4 AI override-agent (AI hold). **Pending:** Phase 5 SBOM export until dependency graph populates post-merge. CodeQL not yet a required check (triage window).)_
- [x] `audit-python-toolchain.md` Phase 1 — Python in PR CI _(complete 2026-08-01. Landed in three steps: #349 opportunistically added ruff+pytest for the SDK and pytest for the stdlib; #568 added the `temporal-worker-python` job plus the `test` gate in `temporal-worker.yml` that both `staging` and `prod` depend on (1.2); this PR finished 1.1 with `pip-audit --skip-editable` in all three Python jobs — Python had **zero** vulnerability scanning until now, in CI or at release — and ruff over `packages/workflows-stdlib`, the last un-linted Python tree (3 real violations fixed). Shipped as three path-filtered jobs, not the one always-run job the plan sketched; each filter includes `ci.yml` so job edits self-validate. Rescoped: Phase 1 spans four Python trees (`apps/tenant-runner` postdates the plan). **Remainder (Phases 2-5 — dep upper bounds, Dependabot pip/docker, release-workflow dedup, stdlib drift harness, uv lockfile, Turbo wrappers) still open** — take it with the next Phase-3 workflows push (~1 d).)_
- [x] `audit-test-infrastructure.md` Phases 2–3 _(shipped & deployed 2026-06-17: P2 coverage ratchet on domain (#292, baseline lines 100/branches 97.36/funcs 94.44/stmts 97.82) + api (#294, DB-backed baseline, 1812 tests) via vitest `autoUpdate` thresholds; dormant coverage config stripped from infra/admin/tenant + coverage policy noted in PATTERNS.md (#293); P3 scheduled non-blocking mutation-test workflow for `packages/domain` (#296, local score 86.96% > break:50). Coverage gate verified green through the merge queue. **Source plan stays in-progress:** Phase 4 (mobile Jest hygiene) + Phase 5 (shared vitest base) remain.)_
- [x] `audit-deploy-pipeline-reliability.md` Phases 3–4 _(shipped & deployed 2026-06-19 via #308 (P3 single-source deploy manifest + drift-guard test, fixes ApiCdnStack drift), #306+#310 (P4.2 reusable `_temporal-worker.yml` + shared buildx cache; #310 fixed a `startup_failure` from missing caller-job `permissions`), #307 (P4.3 composite setup — reused the existing `./.github/actions/setup` rather than a new action). P4.1 migrate-skip was already live. **Prereq fix #309**: bumped `undici`→7.28.0 (GHSA-vmh5-mc38-953g) which had turned audit-ci red mid-batch. Both temporal-worker env jobs verified green post-merge. **Source plan stays in-progress: 2.2–2.4 ntfy notifications user-deferred.** Note: rapid back-to-back merges raced the `tag-release` force-push — `prod-current`/`prod-previous` left stale; self-heals on next clean prod deploy.)_
- [ ] `audit-e2e-strategy.md` Phases 3–4, `audit-ai-process-automation.md` Phases 4–5, other deferred phases (toolchain, deploy 2.2–2.4)
- [ ] `audit-build-toolchain-performance.md` Phase 4 — AI-assisted driver-planning lint burn-down (recurring sessions)

## Files to Modify / Create

- This file only. All implementation files are enumerated in the 12 linked plans; this master plan introduces no new targets.

## Side Effects & Risks

- **Ranking axis is deliberately narrow.** If this document is read as a global priority list, the security/rollback/alerting items get starved — that's why the do-anyway shortlist exists and is part of Wave 1.
- **Cross-plan coupling:** the Node 20→24 pin appears in both Unit 1 (ci.yml) and Unit 7 (`.nvmrc`) — implement once, from the `.nvmrc`; Unit 2 owns the deploy-workflow Node pins. The composite setup action (Unit 1 Phase 2) should land before Unit 2 Phase 4 reuses it. Unit 9 Phase 3 depends on `plans/todo/neon-branches-for-e2e-isolation.md`.
- Effort figures are the plans' own estimates; treat as ±50%.

## Acceptance Criteria / Verification

The loop improvements are measurable; capture a baseline now and re-measure after Waves 1–2:

> **MEASURED 2026-08-06.** Five of seven recorded below with reproducible
> commands. **3 pass, 2 miss, 2 held.** The two misses are both CI-side and share
> one root cause (below); everything on the developer's own machine — the
> highest-frequency loop, and the whole point of the ranking — passes with room
> to spare. Baseline for comparison: `audit-ci-pipeline-efficiency.md:17-30`
> (run 27243490124, the 5-job pipeline as of 2026-06-10).

- [x] **Pre-push latency — PASS.** Target <30 s (baseline 2–5 min whole-repo).
      Timing the exact hook body,
      `time env TURBO_SCM_BASE=origin/main turbo run typecheck test --affected`:
      **3.4 s** for a leaf-package change (`apps/admin-web/src/main.tsx` → 4
      packages affected, 6 tasks, 2 cached), plus ~0.8 s for the hook's
      `git fetch origin main`. **Upper bound, recorded honestly:** a
      `packages/domain` change is not a one-package change — domain is the
      dependency root, so `--affected` correctly fans out to 9 packages / 13
      tasks and takes **1m26s**. Still ~2–3× better than the 2–5 min whole-repo
      baseline, but worth knowing before you touch domain late in the day.
- [x] **CI wall clock — PASS (re-baselined 2026-08-08).** Post-#592, measured over
      11 runs after `c80c2a21`: **warm code run 215–226 s** against a
      re-baselined **≤4m00s (240 s)**; **docs/plans-only 18–20 s** against
      **<45 s**. The original ≤2m45s (165 s) target was retired as _unreachable_,
      not merely missed: the critical path is now always the `Test` job
      (195–212 s), of which setup is ~14 s and the rest is `turbo run test`
      itself — wall clock cannot fall below the suite's own runtime, and `test`
      has turbo caching disabled repo-wide by design. **Further wall-clock wins
      must come from test runtime, not CI plumbing.** Full target table +
      bounds: `audit-ci-pipeline-efficiency.md` § Phase 2.
      _Superseded pre-fix measurement (2026-08-06), kept for the record:_
      Target ≤2m45s (165 s) warm;
      docs/plans-only <1 min. Measured over 23 successful `ci.yml` runs
      (`gh run list --workflow ci.yml --limit 40 --json databaseId,conclusion,event,startedAt,updatedAt`,
      wall = `updatedAt − startedAt`): **code PR/push 211–272 s (median ~240 s ≈ 4m)**;
      **docs/plans-only 18–20 s** (target <60 s — met with 3× headroom).
- [x] **Billed minutes — PASS (re-baselined 2026-08-08).** Post-#592:
      **335–377 s for a 7-job code run** (target **≤6m30s / 390 s**),
      **443–492 s when the three Python jobs also run** (target **≤8m30s /
      510 s**), **13–17 s docs/plans-only** (target **<30 s**). The headline:
      **377 s across 7 jobs today vs ~450 s across 5 jobs at the 2026-06-10
      baseline — more than double the jobs for less total compute.** The old
      ≤5.5 min figure was a 5-job number and was retired, not moved to flatter
      the result; each new target names its bound in
      `audit-ci-pipeline-efficiency.md` § Phase 2.
      _Superseded pre-fix measurement (2026-08-06), kept for the record:_
      Target ≤5.5 min (330 s)
      per run, summed across non-skipped jobs
      (`gh run view <id> --json jobs`; the `/timing` API returns 0 — this repo is
      public, so Actions minutes are not billed and the sum is the right proxy).
      Measured: **code PRs 383–562 s (6m23s–9m22s)**; **docs/plans-only 13–17 s**. - **Root cause of both misses — composition change plus one unrealized
      optimization, not a regression in anything shipped:** 1. `Run ./.github/actions/setup` costs **51–54 s in every job**, but
      `audit-ci-pipeline-efficiency.md:266` promised "Install dependencies
      ≤5 s (cache hit)". At 4 jobs/run that is ~3.4 billed min — the single
      biggest recoverable chunk — and ~50 s of it sits on the critical path.
      **This is the one actionable item;** logged against that plan.
      **FIXED 2026-08-06.** Root cause was not a missing cache — one existed and
      was correct — but **Actions cache-storage exhaustion: 10.77 GB against
      GitHub's 10 GB limit**, so entries were evicted before they could ever be
      reused and every job paid a cold 44.3 s `npm ci`. `setup-node`'s
      `cache: 'npm'` alone held **5.47 GB** for a `~/.npm` dir that is only read
      on the very path the node_modules cache exists to skip, and each of
      `refs/pull/N/merge`, `refs/heads/gh-readonly-queue/…` and
      `refs/heads/main` saved its own ~463 MB copy. Fix: drop the npm cache;
      restore everywhere, save only on `main`, from a single job. Only 6 of the
      last 40 commits touch `package-lock.json`, so ~85 % of runs should now
      hit. **Re-measure the two numbers above once post-fix runs land — and
      re-baseline the targets, which still describe a 5-job pipeline.** 2. `Run tests` is now **144 s** (baseline: turbo test 109 s) because the
      Wave-3 coverage ratchets added ~1,800 api tests. `test` has turbo
      caching disabled repo-wide (`turbo.json`) by design, so no remote-cache
      win is available to it. 3. The pipeline gained jobs the 2026-06-10 target predates:
      `migration-safety`, three Python jobs, and browser coverage in the e2e
      job — the last being an explicit "latency-for-truth trade" this plan's
      own rank-6 note called for. The targets were set against a 5-job
      pipeline and were never re-baselined when Waves 2–3 deliberately added
      work.
- [x] **False-green holes closed — PASS (all three, seeded locally; nothing broken
      was ever committed or pushed).** - expo-doctor guard (`ci.yml:412-424`): `printf '✖ fail\n✖ duplicate dependencies\n'`
      through the live `grep '✖' | grep -v 'duplicate dependencies'` pipeline
      yields a non-empty `failures` → **fires**; the tolerated
      duplicate-dependency line alone stays silent → **no false positive**; and
      the original buggy `grep -q` form still **never** fires, confirming the
      fix is what made the guard reachable. - DB silent-skip fail-fast (`apps/api/vitest.global-setup.ts:73-77`):
      `env -u DATABASE_URL CI=true npx vitest run` → throws
      `[test:db] CI run without DATABASE_URL — integration tests would silently skip. Failing fast.`, exit 1. - e2e minimum-executed floor (`ci.yml:564-572`, `E2E_MIN_EXECUTED_TESTS=32`;
      `deploy.yml:290` uses 8): seeded `results.json` at 5 and 31 → exit 1; at
      32 and 40 → pass. Boundary is inclusive as intended.
- [ ] **Deploy trust — HELD, needs approval.** Requires a deliberate 3-commit
      rapid push to `main`. Outward-facing; not run unattended (user decision
      2026-08-01, re-confirmed 2026-08-06). Note the notification half is
      unbuildable anyway while deploy 2.2–2.4 (ntfy) stays user-deferred.
- [x] **Local loop restored — PASS.** `npm run db:seed` exits 0 in **0.6 s**
      against a fresh worktree Postgres, and is idempotent (ran twice; row counts
      unchanged — `tenants=2 customers=2 moves=3 crew=1`, matching the seed's own
      summary). `npm run setup` exits 0 in **6.3 s** and ends on `✔ Stack ready.`
      with migrations applied and seed in place.
      _Latent inconsistency spotted while measuring (not fixed here):
      `scripts/setup.sh:89` probes `localhost:5432` to decide whether to start
      Docker, but the migrate/seed steps use `DATABASE_URL` from
      `apps/api/.env`. On a machine where 5432 is up but `.env` points elsewhere
      (every worktree), the probe is answering about a different database than
      the one that gets seeded. Harmless today — it made this measurement safe by
      accident, since it left the primary dev DB untouched._
- [ ] **Prod feedback bounded — HELD, needs approval.** Requires firing a real
      prod CloudWatch alarm (`aws cloudwatch set-alarm-state`) to time the email
      round-trip. Outward-facing; not run unattended.
