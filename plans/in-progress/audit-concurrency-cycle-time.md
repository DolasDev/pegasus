# Audit: Concurrent-Session Conflicts & Cycle Time

> **Status: SCOPED** — 2026-06-15

Audit scope: the **concurrency bottleneck** that the 2026-06-10 delivery audit
never addressed — why running several Claude Code sessions on this repo makes
them block each other over branches, merges, worktrees, and the shared local
stack, and why the deploy chain + pre-merge gate inflate per-change cycle time.

Branch: TBD (create `chore/merge-queue-cycle-time` or per-phase branches).
Goal: **let N concurrent sessions ship in parallel without manual
coordination, and cut the per-change feedback time**, by serializing _merges_
(not sessions) through GitHub's native merge queue, isolating per-session
working state, and trimming dead latency from the deploy/gate/inner loops.

Out of scope (owned by sibling audit units): the `last-deploy`-tag diff-base
cancellation fix (done, `audit-deploy-pipeline-reliability.md` 2.1); CI job
parallelism & caching (done, `audit-ci-pipeline-efficiency.md`); Neon branch
_mechanism_ (parked in `plans/todo/neon-branches-for-e2e-isolation.md` — this
plan _consumes_ it in Phase 2).

## Diagnosis

Every change funnels through one `main` + auto-deploy-on-merge. That is a hard
serialization point that fights concurrency:

### C1 — Merges cannot parallelize; coordination is manual and fragile (CRITICAL)

Two sessions doing `git merge && git push origin main` race: the loser gets a
non-fast-forward rejection. There is **no queue or lock**. Today the only
"parallel" path is the batch-worktree-merge-locally protocol captured in
memory (`feedback_batch_worktree_merge_push.md`), which is hand-driven and has
already produced CWD-drift bugs (integration branch created at a worker's tip,
not `main`, 2026-06-11). Two _canonical_ flows also contradict each other:
`/ship` (PR → branch CI → squash-merge → watch deploy) vs the batch protocol
(merge straight to `main`, no PR). Run simultaneously they sabotage each other
— a `/ship` squash-merge fires the very push that cancels the batch session's
queued deploy.

### C2 — Sessions physically share working state (CRITICAL)

`git worktree list` shows a **single** checkout. Concurrent sessions that
aren't given a real worktree land in the same checkout, competing over the git
index/HEAD/unstaged files, **one** `node_modules`, and **one** local Postgres
(concurrent `npm test` / `npm run e2e` gates corrupt each other's DB state).
Memory (`project_node_version_gate.md`) confirms "stale worktrees need own
`npm install`" — so worktree isolation is neither scripted nor reliable today.

### C3 — Every merge fires a full, serial, gated deploy (HIGH)

`deploy.yml` triggers on every push to `main`; the chain is serial: staging
CDK → **25-min e2e-staging gate** → **manual prod approval** → prod CDK
(9–16 min observed). `concurrency.cancel-in-progress: false` queues runs, and a
trailing plans-only commit can become the surviving run and deploy nothing
(benign for code only because the diff-base is the `last-deploy` tag — but the
_notification_ gap 2.2 remains, so a cancelled run is invisible). Under
concurrency this means each session's merge spawns a deploy that mostly cancels
its neighbours; effective throughput is one-deploy-at-a-time with manual
re-dispatch toil.

### C4 — The pre-merge gate duplicates CI and is heavy (MEDIUM)

The task-completion gate (`dolas/agents/project/context.md`) requires full
`npm test` **and** Playwright e2e before a task is "done" / before any
merge — the same suites CI re-runs on the PR. For a solo dev behind branch
protection this is double work on the inner loop. Playwright is also
`workers: 1`, `fullyParallel: false` (`apps/e2e/playwright.config.ts:95-98`),
so the local e2e you wait on runs fully serial.

### C5 — Coupling-driven deploy fan-out (MEDIUM)

`deploy.yml` forces `--all` CDK deploy on any `package-lock.json` change, so
routine Dependabot/devDep bumps trigger 45-min full prod deploys. The api
`build` task declares no Turbo `inputs`, so adding a prisma migration file
busts the api build cache even when `src/` is unchanged. (Architecture itself
is _not_ the culprit — `packages/domain` is the only god-package and is tiny,
21 files; coupling is otherwise proportionate.)

**Feasibility confirmed:** repo is **public** → GitHub merge queue is available
on the **Free** plan. No `merge_group` trigger exists in any workflow yet
(required). Branch protection on `main`: required checks = Secret Scanning,
Typecheck, Lint, Test, E2E Tests; `strict: false`; no required PR reviews.

---

## Phase 1 — Merge queue: serialize merges, not sessions (Tier 1, the core unlock)

Adopt GitHub's native merge queue so concurrent sessions each open a PR and
just "queue for merge"; the queue rebases + tests + merges serially and
**batches** the resulting pushes to `main` → fewer, batched deploys. Deletes
the non-ff race, the manual local-merge protocol, and the CWD-drift class.

- [ ] **1.1** Add `merge_group:` to `ci.yml` `on:` triggers so the required
      checks (Secret Scanning, Typecheck, Lint, Test, E2E Tests) run against the
      queue's temporary merge branch. _Verify the `changes` path-filter job
      (`dorny/paths-filter`) resolves a sane base on `merge_group` events — if it
      mis-detects, fall back to running the full job set on `merge_group`._
- [ ] **1.2** Enable the merge queue on the `main` branch protection rule /
      ruleset (Settings → Branches, or API). Keep the existing 5 required checks.
      Consider `strict: false` retained (the queue already tests against latest
      main, so "require branches up to date" is redundant).
- [ ] **1.3** Update the `/ship` skill (`~/.claude/skills/ship/SKILL.md`)
      Phase 7: replace immediate `gh pr merge --squash --delete-branch` with
      `gh pr merge --squash --auto --delete-branch` (adds to queue), then Phase 8
      watches the _queue entry_ → resulting main deploy. Document that merge no
      longer = instant; it = enqueued.
- [ ] **1.4** Retire the manual batch-merge-to-main protocol for concurrent
      work: update `dolas/agents/team/workflow.md` + the relevant memory entries to
      make "open a PR, let the merge queue serialize" the **single** canonical
      multi-session path. Keep direct-push only as a documented break-glass.
- [ ] **1.5** Confirm `deploy.yml` still fires correctly off queue-merged
      pushes and that batched merges produce one deploy covering all batched
      commits (the `last-deploy` diff-base already guarantees coverage).

**Acceptance:** two PRs opened from two sessions both set to auto-merge land
back-to-back via the queue with **zero** manual `git` coordination and no
non-ff rejection; required checks show as run on a `merge_group` ref; the
post-merge deploy run's change-set covers both PRs.

## Phase 2 — Per-session working-state isolation (Tier 1)

Give each concurrent session its own checkout, deps, and DB so sessions stop
contending over shared state (C2).

- [ ] **2.1** Script `scripts/new-worktree.sh <slug>`: creates a sibling git
      worktree on a fresh branch, runs `npm install` in it (or links the root store
      where safe per the Node-24 stale-worktree gotcha), and prints next steps.
      Wrap cleanup in `scripts/rm-worktree.sh` (prune + remove + branch delete).
- [ ] **2.2** Per-worktree DB isolation: assign each worktree a unique local
      Postgres (distinct container name + port via an env-derived offset) **or**
      consume `plans/todo/neon-branches-for-e2e-isolation.md` to give each session
      an ephemeral Neon branch. Thread the chosen `DATABASE_URL` into
      `.env`/`.env.test` generation so `npm test` / `npm run e2e` in two worktrees
      can't corrupt each other.
- [ ] **2.3** Document the model in `dolas/agents/project/context.md`: one
      session = one worktree = one branch = one DB; never two sessions in the
      primary checkout.

**Acceptance:** two worktrees each run `npm run e2e` simultaneously to green
without DB cross-talk; removing a worktree leaves the primary checkout and
`main` untouched.

## Phase 3 — Trim the deploy chain (Tier 2, helps every session)

- [ ] **3.1** Skip the `migrate` job when no migration files changed
      (`audit-deploy-pipeline-reliability.md` 4.1) — saves ~4–6 min serial latency
      on ~90% of API deploys. Gate `migrate` on a `prisma/migrations/**` path check
      in the `changes` job; keep `deploy` `needs:` tolerant of a skipped `migrate`.
- [ ] **3.2** Narrow the e2e-staging gate to a true `@smoke` subset and/or move
      the full remote suite off the prod critical path
      (`audit-e2e-strategy.md` 3.2/3.3). The 25-min gate currently blocks _every_
      prod deploy; a smoke gate drops it to minutes, full coverage runs in the
      nightly QA job.
- [ ] **3.3** Stop forcing `--all` CDK deploy on a lone `package-lock.json`
      change — only force `--all` when the lockfile change coincides with infra/src
      changes (or classify dep-only bumps as no-CDK). Removes 45-min full prod
      deploys on Dependabot bumps (C5).

**Acceptance:** a no-migration API change deploys without the migrate job; a
prod deploy's gate window is single-digit minutes; a pure devDep bump does not
trigger a full CDK `--all`.

## Phase 4 — Inner loop + e2e speed (Tier 3)

- [ ] **4.1** Playwright `workers: 2` (overlap the api + browser projects;
      they don't share write paths) and audit api specs for a later
      `fullyParallel: true` (`apps/e2e/playwright.config.ts:95-98`). ~30–40% off
      the local e2e you wait on. Bump the skip-guard floors accordingly.
- [ ] **4.2** Introduce an explicit `@smoke` tag (feeds 3.2) and let PR CI /
      the local gate run smoke-only for fast signal, full suite post-merge.
- [ ] **4.3** Scope the task-completion gate (`context.md`) to **affected**
      packages for the inner loop (`turbo run test --filter=...[origin/main]`),
      trusting CI for the full matrix — removes the CI-duplication tax (C4).
- [ ] **4.4** Add Turbo `inputs: ["src/**", "prisma/schema.prisma"]` to the api
      `build` task so migration files don't bust its build cache (C5).

**Acceptance:** local e2e wall-clock drops measurably with `workers: 2`; an
inner-loop edit gates in seconds via affected-only test scoping; adding a
migration file is a cache _hit_ for the api build.

---

## Ordering

Phase 1 first (it's the unlock and is low-effort/high-leverage), then Phase 2
(removes the other half of the concurrency contention). Phases 3–4 are
independent latency wins that can interleave or be picked off opportunistically;
3.1/3.2 overlap already-scoped (but unshipped) items in the deploy/e2e plans —
do them from here and tick the source plans.

## Files to Modify / Create

- `.github/workflows/ci.yml` (add `merge_group` trigger) — 1.1
- `main` branch protection / ruleset (merge queue) — 1.2 (out-of-band, via UI/API)
- `~/.claude/skills/ship/SKILL.md` — 1.3
- `dolas/agents/team/workflow.md`, `dolas/agents/project/context.md`, memory entries — 1.4, 2.3, 4.3
- `scripts/new-worktree.sh`, `scripts/rm-worktree.sh` (new) — 2.1
- `.env`/`.env.test` generation + (optional) Neon branch wiring — 2.2
- `.github/workflows/_deploy.yml`, `deploy.yml` — 3.1, 3.3
- `apps/e2e/playwright.config.ts`, e2e tag wiring, README floors — 3.2, 4.1, 4.2
- `turbo.json` — 4.4

## Side Effects & Risks

- **Merge queue + path-filter on `merge_group`**: the `changes` job's diff base
  may differ on queue events — verify, or run full checks on `merge_group`
  (1.1). This is the one thing that can silently neuter the gate.
- **Merge queue changes the meaning of "merged"**: `/ship` and any automation
  that assumes immediate merge must wait on the queue entry (1.3).
- **`workers: 2`** can surface latent inter-spec state coupling — audit before
  going further to `fullyParallel` (4.1).
- **Affected-only local gating (4.3)** trades a sliver of local coverage for
  speed; safe only because CI runs the full matrix as the real gate. Don't
  weaken CI's required checks.
- Effort is uncosted here; treat each phase as independently shippable.

## Acceptance Criteria / Verification

- [ ] Two concurrent sessions ship two PRs through the merge queue with no
      manual git coordination and no non-ff race (Phase 1).
- [ ] Two worktrees run `npm run e2e` in parallel to green without DB
      cross-talk (Phase 2).
- [ ] A no-migration API deploy skips the migrate job; prod gate window is
      single-digit minutes; a devDep-only bump skips full CDK `--all` (Phase 3).
- [ ] Local e2e wall-clock drops with `workers: 2`; inner-loop edits gate in
      seconds via affected scoping; api build is a cache hit after a migration-only
      change (Phase 4).
