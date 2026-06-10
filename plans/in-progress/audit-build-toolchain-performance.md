# Build Toolchain & Feedback-Loop Performance — Remediation Plan

> **Status: SCOPED** — 2026-06-10

Audit unit: Turbo pipeline, git hooks, lint toolchain, local feedback-loop speed.
Out of scope (owned by other units): CI workflow YAML edits (Unit 1 — except the remote-cache env vars specified below, which span both), vitest config consolidation (Unit 8), Node version pinning / `.nvmrc` (Unit 7).

## Context

All findings verified against the repo on 2026-06-10. Installed turbo: **2.9.16** (devDep `^2.9.6` in `package.json:33`); `turbo.json` already uses the modern `tasks` key. ESLint **10.4.1** (devDep `^10.2.1`), which includes bulk-suppressions (`--suppress-all`, `--suppress-rule`, `--prune-suppressions` — confirmed via `eslint --help`).

### F1 — No remote cache: every CI job rebuilds the world from cold

`turbo.json` has no `remoteCache` config and CI sets no `TURBO_TOKEN`/`TURBO_TEAM` (grep over `.github/workflows/*.yml` finds none). The four CI jobs in `.github/workflows/ci.yml` each do a full `npm ci` and then run `turbo run typecheck` (line 63), `turbo run lint` (line 86), `turbo run test` (line 167) across all 13 workspaces with an empty cache — even for a one-line docs change. `_deploy.yml:163` (`npx turbo run build`) also builds cold.

Nuance the research notes got wrong: **local** worktrees are less painful than assumed — turbo 2.9 shares one cache across git worktrees (verified: dry-run prints `Remote caching disabled, using shared worktree cache`; cache is `~17M` at the repo root `.turbo/`). The cold-cache pain is concentrated in **CI** and **fresh clones / other machines**.

Recommendation (pick ONE): **Vercel Remote Cache.** It is free on all plans including Hobby as of the 2025 pricing change (subject to fair use), works even when not hosting on Vercel, and — unlike the CI-only `rharkor/caching-for-turbo` GHA-cache approach — also serves local dev, fresh clones, and any second machine. Solo-dev calculus: one `turbo login && turbo link`, zero infra to maintain. The GHA-cache action would add a per-workflow setup step, caches nothing for local dev, and rides GitHub's 10 GB/repo eviction. If Vercel's fair-use terms ever change, migrating is a config swap (`TURBO_API`-compatible self-hosted caches exist).

### F2 — Pre-push hook runs whole-repo `typecheck test` regardless of diff

`.husky/pre-push:4`: `exec node node_modules/.bin/turbo run typecheck test` — no `--affected`, no `--filter`. Since `test` is `cache: false` (`turbo.json:12`), every push reruns **all** test suites in all 13 workspaces, including `apps/mobile`'s 20-suite jest run (`jest --forceExit`) and `apps/api`'s DB-backed vitest suite, even for a one-package change. Estimated 2–5 min per push (not re-timed in this audit; Prisma client absent in this worktree).

Verified fix: `--affected` works on turbo 2.9.16 (dry-run on this branch, which is even with main, correctly scopes to **0 packages**). `--affected` compares HEAD against the merge-base with the base ref (`TURBO_SCM_BASE`, default `main`); setting `TURBO_SCM_BASE=origin/main` makes it correct both on feature branches **and** when pushing `main` directly (batch-merge protocol) — unpushed main commits are then the diff. Root-level changes (`turbo.json`, root `package.json`, lockfile, `tsconfig.base.json` via `globalDependencies` at `turbo.json:3`) mark all packages affected, so cross-package safety is preserved.

### F3 — Pre-commit runs shellcheck on every commit, touched or not

`.husky/pre-commit:2` runs `npx shellcheck packages/infra/deploy.sh` unconditionally. Cost is small (~1s + npx resolution) but it's pure waste on the ~99% of commits that don't touch the script, and it serializes with lint-staged. Move it into lint-staged so it only fires when a tracked shell script is staged.

### F4 — Lint coverage gaps + lint cacheability

- The research note "lint has no cache" is **wrong**: `turbo.json:14-17` leaves `cache` enabled (log-replay caching, `outputs: []`). The actual problem is F1 — CI never has a warm cache to replay. No turbo.json change needed for lint caching; remote cache fixes CI.
- Real gap found instead: **three packages have no `lint` script at all** — `packages/api-http`, `packages/auth`, `packages/theme` (also `apps/e2e` and `apps/mobile`). `turbo run lint` silently skips them, so their code is never linted anywhere (lint-staged only covers _changed_ files, and only since the hooks were installed).

### F5 — `typecheck` cache staleness risk via generated Prisma client

`typecheck` (`turbo.json:18-21`) hashes only package sources. `apps/api`'s `tsc --noEmit` reads the generated client in `node_modules/@prisma/client`, which turbo does not hash. With remote caching ON, a schema change without a source change could replay a stale green typecheck. Mitigation: add `apps/api/turbo.json` declaring `prisma/**` as an input (schema changes always regenerate + bust the hash).

### F6 — driver-planning lint-exception burn-down (measured baseline)

`eslint.config.mjs:39-52` disables 9 rules for `apps/tenant-web/src/features/driver-planning/**`. Measured 2026-06-10 by running eslint with the exception block removed (`npx eslint --no-fix -c <config-without-block> 'apps/tenant-web/src/features/driver-planning/**/*.{ts,tsx}' -f json`):

- Scope: **172** `.ts/.tsx` files, **19,764** LOC.
- **771 violations in 82 files** (90 files are already clean):

| Rule                                         | Count | Fix path                                     |
| -------------------------------------------- | ----: | -------------------------------------------- |
| `@typescript-eslint/no-explicit-any`         |   727 | Manual/AI-assisted typing (the real debt)    |
| `@typescript-eslint/no-unused-vars`          |    29 | Mostly deletions; feature has test coverage  |
| `prefer-const`                               |     5 | `--fix`                                      |
| `@typescript-eslint/consistent-type-imports` |     4 | `--fix`                                      |
| `no-prototype-builtins`                      |     2 | Trivial manual                               |
| `@typescript-eslint/no-wrapper-object-types` |     2 | Trivial manual (`String`→`string` etc.)      |
| `no-var`                                     |     1 | `--fix`                                      |
| `no-useless-assignment`                      |     1 | Trivial manual                               |
| `@typescript-eslint/no-unsafe-function-type` |     0 | **Already clean — delete the exception now** |

So 8 of 9 disabled rules account for only **44** violations; the block exists almost entirely for `no-explicit-any`. The right mechanism is ESLint's native **bulk suppressions** (available in installed v10.4.1): re-enable all rules, grandfather existing violations into a committed `eslint-suppressions.json`, and the count can only ratchet **down** — new violations fail immediately, fixing one then forgetting to prune fails the lint with "unused suppression" (prune with `--prune-suppressions`). This replaces the blanket geographic exception with an exact, shrinking ledger. No custom ratchet tooling needed.

**AI integration (genuine fit):** burning down 727 `any`s across 82 files is mechanical-but-context-heavy typing work — ideal for scheduled Claude Code sessions (~80–120 `any`s/session ≈ 6–9 sessions), each gated by the existing tests + typecheck + the suppressions ratchet, which makes AI output cheap to verify. The rest of this plan is config work — **no AI needed** for F1–F5.

### F7 — Hook fragility (cross-ref)

Both hooks invoke `node node_modules/.bin/turbo` with whatever `node` is on PATH; the known node-25 breakage is Unit 7's scope (`.nvmrc`/pinning). This plan keeps the invocation style unchanged.

## Plan

### Phase 1 — Quick wins (~45 min total)

- [x] **P1.1 — Scope pre-push to affected packages** (15 min). Replace `.husky/pre-push` body:

  ```sh
  zero=0000000000000000000000000000000000000000
  while read -r _local_ref local_sha _remote_ref _remote_sha; do
    if [ "$local_sha" != "$zero" ]; then
      git fetch -q origin main || true
      if [ "${FULL_PREPUSH:-}" = "1" ]; then
        exec node node_modules/.bin/turbo run typecheck test
      fi
      exec env TURBO_SCM_BASE=origin/main node node_modules/.bin/turbo run typecheck test --affected
    fi
  done
  ```

  `FULL_PREPUSH=1 git push` is the escape hatch for a deliberate whole-repo gate.

- [x] **P1.2 — Move shellcheck into lint-staged** (10 min). Delete line 2 of `.husky/pre-commit` (leave only `npx lint-staged`); add to the `lint-staged` block in root `package.json`:

  ```json
  "*.sh": ["shellcheck"]
  ```

  This widens coverage from one hardcoded script to every staged shell script, and only when one is actually staged. Verify `shellcheck` resolves (it currently runs via `npx`; if the npm wrapper package isn't a devDep, add `"shellcheck": "^4.1.0"` to root devDependencies so the hook never does a network npx install mid-commit).

- [x] **P1.3 — Delete the zero-violation exception + autofix the 10 fixable** (20 min). In `eslint.config.mjs` remove `'@typescript-eslint/no-unsafe-function-type': 'off'` (0 violations), then remove `prefer-const`, `no-var`, `consistent-type-imports` from the block and run `npx eslint --fix 'apps/tenant-web/src/features/driver-planning/**/*.{ts,tsx}'` from `apps/tenant-web` (10 auto-fixes). Run `npm test --workspace=@pegasus/tenant-web` after.

### Phase 2 — Vercel Remote Cache (~45 min, one-time)

- [ ] **P2.1 — Link the repo** (15 min). From repo root: `npx turbo login` then `npx turbo link` (creates/uses a Vercel team; writes gitignored `.turbo/config.json`). Confirm `.turbo` is gitignored (it is the existing local cache dir — verify `git check-ignore .turbo` before committing anything). _(code wiring landed; Vercel login/link + secrets are pending user-manual steps)_
- [x] **P2.2 — Enable artifact signing** (10 min). In `turbo.json` add:

  ```json
  "remoteCache": { "signature": true }
  ```

  Generate a key (`openssl rand -hex 32`) and export `TURBO_REMOTE_CACHE_SIGNATURE_KEY` in the local shell profile. Signing makes cache poisoning require the key, not just a leaked read/write token.

- [ ] **P2.3 — Specify CI env vars (wiring is Unit 1's edit)** (5 min + Unit 1). CI jobs that run turbo (`ci.yml` typecheck/lint/test jobs, `_deploy.yml` build step) need: _(code wiring landed; Vercel login/link + secrets are pending user-manual steps)_
  - secret `TURBO_TOKEN` (scoped Vercel token), secret `TURBO_REMOTE_CACHE_SIGNATURE_KEY`, repo variable `TURBO_TEAM` (team slug).
  - `gh secret set TURBO_TOKEN`, `gh secret set TURBO_REMOTE_CACHE_SIGNATURE_KEY`, `gh variable set TURBO_TEAM`.
    Once present, turbo picks them up from env — typecheck/lint/build replay warm artifacts across CI runs and from local pushes that already ran the same hash.
- [x] **P2.4 — Guard typecheck cache against stale Prisma client** (15 min). Create `apps/api/turbo.json`:

  ```json
  {
    "$schema": "https://turbo.build/schema.json",
    "extends": ["//"],
    "tasks": {
      "typecheck": { "inputs": ["$TURBO_DEFAULT$", "prisma/**"] }
    }
  }
  ```

### Phase 3 — Lint coverage + suppressions ratchet (~1.5 h)

- [ ] **P3.1 — Add lint scripts to unlinted packages** (30 min). Add `"lint": "eslint src"` to `packages/api-http/package.json`, `packages/auth/package.json`, `packages/theme/package.json`; fix whatever surfaces (expected small — these are newer, conventions-era packages). Optionally `"lint": "eslint tests global-setup.ts"` for `apps/e2e`. `apps/mobile` is excluded deliberately (Expo/jest toolchain, separate audit).
- [ ] **P3.2 — Replace the driver-planning exception block with bulk suppressions** (45 min). Delete the entire `files: ['apps/tenant-web/src/features/driver-planning/**/*.{ts,tsx}']` override from `eslint.config.mjs` (after P1.3 it still suppresses ~756 violations). Then from `apps/tenant-web`: `npx eslint src --suppress-all` — this writes `apps/tenant-web/eslint-suppressions.json` grandfathering existing violations. Commit it. From now on `eslint src` (per-package lint, lint-staged, CI) fails on any NEW violation in driver-planning and fails with "unused suppressions" when fixes land without `--prune-suppressions` — a zero-discipline ratchet.
- [ ] **P3.3 — Fix the 34 trivial remaining violations** (30 min, can fold into P3.2): `no-unused-vars` 29 (deletions; rerun tenant-web tests), `no-prototype-builtins` 2, `no-wrapper-object-types` 2, `no-useless-assignment` 1, then `npx eslint src --prune-suppressions` and commit. After this the suppressions file is purely the 727 `no-explicit-any` ledger.

### Phase 4 — AI-assisted `no-explicit-any` burn-down (recurring, ~6–9 sessions)

- [ ] **P4.1 — Stand up the recurring session** (30 min once). Create `plans/todo/driver-planning-any-burndown.md` tracking per-directory counts (derive with: `cd apps/tenant-web && npx eslint src/features/driver-planning -f json | node -e "..."` or just read `eslint-suppressions.json` counts). Session protocol per run: pick one directory (`redux/`, `containers/`, `components/`, `utils/`, `availability/`), prompt Claude Code to replace `any` with real types (domain types in `packages/domain`, API response types) — NOT `unknown`-spray; gate each session with `npm test --workspace=@pegasus/tenant-web && npm run typecheck --workspace=@pegasus/tenant-web && npx eslint src --prune-suppressions`. ~80–120 `any`s per session → done in 6–9 sessions. Optionally schedule via the `/schedule` cloud-agent skill (weekly), but manual `/loop`-style sessions during slow weeks are fine — the ratchet guarantees no regression between sessions either way.
- [ ] **P4.2 — Finish line** (5 min). When `eslint-suppressions.json` is empty, delete it and the `--suppressions-location` plumbing (if any was added); driver-planning is then under full repo lint with zero exceptions.

## Files to Modify / Create

| File                                                                                          | Action                                                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `.husky/pre-push`                                                                             | Rewrite to `--affected` + `FULL_PREPUSH` escape hatch (P1.1)  |
| `.husky/pre-commit`                                                                           | Drop unconditional shellcheck line (P1.2)                     |
| `package.json` (root)                                                                         | lint-staged `*.sh` entry; optional `shellcheck` devDep (P1.2) |
| `eslint.config.mjs`                                                                           | Shrink (P1.3) then delete (P3.2) the driver-planning block    |
| `turbo.json`                                                                                  | Add `remoteCache.signature` (P2.2)                            |
| `apps/api/turbo.json`                                                                         | **Create** — prisma input for typecheck (P2.4)                |
| `packages/api-http/package.json`, `packages/auth/package.json`, `packages/theme/package.json` | Add `lint` scripts (P3.1)                                     |
| `apps/tenant-web/eslint-suppressions.json`                                                    | **Create** (generated, committed) (P3.2)                      |
| `plans/todo/driver-planning-any-burndown.md`                                                  | **Create** — session tracker (P4.1)                           |

CI YAML (`ci.yml`, `_deploy.yml`) env-var wiring: **Unit 1**, per P2.3 spec.

## Side Effects & Risks

- **Remote-cache poisoning / token leakage**: anyone with the Vercel token can write artifacts that other machines replay. Mitigations: `signature: true` (P2.2) so artifacts are HMAC-verified with a key the cache provider never sees; keep `TURBO_TOKEN` in GH secrets only; solo-dev threat model is low but signing is one config line.
- **Stale-cache false greens**: `--affected` under-scopes if `origin/main` is stale → the hook fetches first; CI still runs the full graph, so misses are caught pre-merge. Root-config and lockfile changes invalidate all packages via turbo's global hash (verified `globalDependencies` includes `tsconfig.base.json`; turbo.json/root package.json/lockfile are always global hash inputs).
- **Pre-push on `main` batch pushes**: with `TURBO_SCM_BASE=origin/main`, pushing main runs checks over exactly the unpushed commits — intended; but a push of _many_ merged branches re-checks their union (can approach full-repo time; that is correct behavior, not a regression).
- **`exec` in the pre-push read-loop** processes only the first pushed ref (pre-existing behavior, preserved). Multi-ref pushes (`git push origin a b`) gate only on the first ref — acceptable; CI is the backstop.
- **Suppressions-file merge conflicts**: `eslint-suppressions.json` is a JSON map keyed by file — conflicts are rare for a solo dev and resolve by rerunning `--suppress-all` is **forbidden** post-adoption (it would re-grandfather new violations); resolve conflicts by rerunning `--prune-suppressions` only.
- **`no-unused-vars` deletions in ported legacy code** (P3.3) can remove vars with side-effectful initializers — rely on the existing driver-planning test suites (multiple `*.test.ts(x)` present) and the pinned-variant E2E (per project memory) before merging.
- **Prisma input addition (P2.4)** widens the typecheck hash → slightly more cache misses for `apps/api`; that is the point.
- **Vercel fair-use**: free tier has no hard published quota; if throttled, fall back is config-only (self-hosted `TURBO_API` cache or `rharkor/caching-for-turbo` for CI).

## Acceptance Criteria / Verification

- **Pre-push scoping**: on a branch touching only `packages/theme`, `git push` output shows `Packages in scope: @pegasus/theme` (plus dependents) and completes in <60s; `FULL_PREPUSH=1 git push` runs all 13. On a branch even with `origin/main`, hook runs 0 tasks and exits 0.
- **Pre-commit**: commit touching only a `.ts` file runs no shellcheck (check `set -x` trace or timing); commit staging `packages/infra/deploy.sh` with an introduced unquoted var fails.
- **Remote cache**: after P2.1–P2.3, run `npx turbo run typecheck --force` once, then in a **fresh clone** (or `rm -rf .turbo && TURBO_*` env set) run `npx turbo run typecheck` → output shows `FULL TURBO` / `cached, replayed` for all packages, wall time <30s. In CI, the typecheck job's turbo summary line reports >0 remote cache hits on a re-run of an identical commit.
- **Signature**: flip one char of `TURBO_REMOTE_CACHE_SIGNATURE_KEY` locally → previously-cached artifacts are rejected (cache miss, not replay).
- **Prisma guard**: edit `apps/api/prisma/schema.prisma` (whitespace), run `npx turbo run typecheck --filter=@pegasus/api --dry` → hash changed (cache miss expected).
- **Lint coverage**: `npx turbo run lint --dry` lists `@pegasus/api-http`, `@pegasus/auth`, `@pegasus/theme` in scope; `npx turbo run lint` passes.
- **Ratchet**: add `const x: any = 1` to any driver-planning file → `npx eslint src` (from `apps/tenant-web`) fails. Fix one suppressed `any` without pruning → lint fails with unused-suppression error; with `--prune-suppressions` → passes and the JSON count decremented.
- **Burn-down done**: `apps/tenant-web/eslint-suppressions.json` absent and `npx eslint src` passes with no driver-planning rules disabled in `eslint.config.mjs`.
