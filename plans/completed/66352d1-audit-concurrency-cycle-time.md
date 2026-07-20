# Audit: Concurrent-Session Conflicts & Cycle Time

> **Status: SHIPPED (Core + safe wins) — 2026-06-15.** Executed via `/batch` as 6
> worktree PRs (#273–#278), all merged to `main`. The GitHub **merge queue** was
> then enabled on `main` (`merge-queue-main` ruleset, squash/ALLGREEN) and repo
> auto-merge turned on. Deferred items recorded at the bottom.

Audit scope: the **concurrency bottleneck** that the 2026-06-10 delivery audit
never addressed — why running several Claude Code sessions on this repo makes
them block each other over branches, merges, worktrees, and the shared local
stack, and why the deploy chain + pre-merge gate inflate per-change cycle time.

Goal: **let N concurrent sessions ship in parallel without manual coordination,
and cut the per-change feedback time**, by serializing _merges_ (not sessions)
through GitHub's native merge queue, isolating per-session working state, and
trimming dead latency from the deploy/gate/inner loops.

## What shipped (PRs #273–#278)

- [x] **1.1** `merge_group:` trigger added to `ci.yml`; the 5 required-check jobs
      (Secret Scanning always-on; Typecheck, Lint, Test, E2E Tests, plus
      migration-safety) run on `merge_group` events, with `migration-safety` resolving
      its base from `github.event.merge_group.base_sha`. **(PR #276)**
- [x] **1.2** Merge queue enabled on `main` — `merge-queue-main` ruleset
      (id 17701163), `merge_method: SQUASH`, `grouping_strategy: ALLGREEN`,
      timeout 60m, min/max entries 1/5. Coexists with classic branch protection
      (which still supplies the required checks). **(coordinator, out-of-band via `gh api`)**
- [x] **1.3** `/ship` skill Phase 7/8 updated to enqueue with
      `gh pr merge --squash --auto --delete-branch` and watch the queue entry; repo
      "Allow auto-merge" enabled. **(coordinator; skill lives outside the repo)**
- [x] **1.4** Process docs: `dolas/agents/team/workflow.md` makes the merge queue
      the canonical multi-session path (direct push = break-glass). **(PR #273)**
- [x] **1.5** Queue verified end-to-end by landing this archival PR through it.
- [x] **2.1 / 2.2** `scripts/new-worktree.sh` + `scripts/rm-worktree.sh`: per-session
      worktree on a fresh branch + isolated Postgres (derived port 5433–5492, container
      `pegasus-pg-<slug>`) + generated `.env`/`.env.test` pointing at the isolated DB
      (both global-setups honor an external `DATABASE_URL`). **(PR #278)**
- [x] **2.3** `dolas/agents/project/context.md`: one session = one worktree = one
      branch = one DB; never two sessions in the primary checkout. **(PR #273)**
- [x] **3.1** `deploy.yml` skips the prisma `migrate` job when no
      `apps/api/prisma/migrations/**` changed (threads `skip-migrate` to `_deploy.yml`;
      forced-full / empty-base still migrates). **(PR #277)**
- [x] **4.1** Playwright `workers: isQa ? 1 : 2` (QA stays serial to protect the
      flaky on-prem WireGuard tunnel). **(PR #274)**
- [x] **4.3** `context.md` task-completion gate notes affected-only inner-loop test
      scoping (`turbo run test --filter=...[origin/main]`), trusting CI for the full
      matrix without weakening the final gate. **(PR #273)**
- [x] **4.4** `apps/api/turbo.json` declares explicit `build` inputs so
      `prisma/migrations/**` no longer busts the api build cache. **(PR #275)**

## Deferred (not done — revisit if needed)

- [ ] **3.2 / 4.2** Narrow the staging e2e gate to a true `@smoke` subset + PR-CI
      smoke filtering. Needs `@smoke` curation across specs and changes the prod
      critical path; overlaps `audit-e2e-strategy.md`. Do deliberately, not blind.
- [ ] **3.3** Stop forcing `--all` CDK deploy on a lone `package-lock.json` bump.
      Deploy-correctness risk (a transitive runtime-dep bump must still redeploy
      bundles) — needs careful devDep-vs-runtime classification.
- [ ] **Phase 2 Neon variant** The local-Postgres-per-worktree variant shipped
      instead; `plans/todo/neon-branches-for-e2e-isolation.md` remains parked.
- [ ] **4.1 follow-up** Playwright `fullyParallel: true` (kept `false` — audit
      inter-spec coupling first).

## Acceptance (met)

- Two concurrent sessions can each open a PR and `--auto`; the queue serializes the
  merges with no non-ff race and no manual git coordination.
- A no-migration API deploy skips the migrate job; forced-full still migrates.
- Local e2e runs 2 workers; adding a migration file is a cache hit for the api build.
