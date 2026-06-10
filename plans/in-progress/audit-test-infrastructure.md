# Audit: Unit/Integration Test Infrastructure — Remediation Plan

> **Status: SCOPED** — 2026-06-10

Part of the 12-unit lean-delivery audit. Scope: the Vitest/Jest unit + integration layer — configs, coverage, the DB-skip pattern, mutation testing, and mobile's Jest divergence. Out of scope (owned elsewhere): Playwright/e2e (Unit 9), Python tests (Unit 11), CI job mechanics (Unit 1), pre-push hook speed (Unit 10).

## Context

Inventory (verified 2026-06-10): 11 npm workspaces run `vitest run`; 1 (`apps/mobile`) runs `jest --forceExit`. All Vitest packages are on a single consistent version (`vitest ^4.1.5`) — no version drift. Test-file counts: `apps/api` 118, `apps/tenant-web` 99, `packages/infra` 12, `packages/domain` 9, `apps/admin-web` 5, `packages/auth` 3, `apps/vpn-agent` 3, and 1 each in `packages/theme`, `packages/api-http`, `apps/tunnel-proxy`, `apps/mssql-executor`. Mobile has 21 Jest test files.

### Findings

1. **Root `vitest.workspace.ts` is dead and wrong.** It lists only 2 projects and one of them — `packages/api/vitest.config.ts` — does not exist (the API lives at `apps/api`). Untouched since the bootstrap commit (`419a6af`). Nothing uses it: CI and the root `test` script go through `turbo run test` (per-package `vitest run`), and Vitest 4 dropped workspace-file support in favour of `test.projects`. It is pure misdirection for anyone (or any agent) reading the repo root.
   - Evidence: `vitest.workspace.ts:1-6`, root `package.json` scripts (`"test": "turbo run test"`), `.github/workflows/ci.yml:166-167`.

2. **Coverage is configured but never collected — 100% dormant.** Five packages carry a `coverage: { provider: 'v8', reporter: ['text','lcov'] }` block (`packages/domain/vitest.config.ts:8-12`, `packages/infra/vitest.config.ts:14-18`, `apps/api/vitest.config.ts:11-15`, `apps/admin-web/vitest.config.ts:12-16`, `apps/tenant-web/vitest.config.ts:11-15`) and a `@vitest/coverage-v8` devDependency, but every `test` script is plain `vitest run` — no `--coverage` flag anywhere, no thresholds, no CI step reads lcov, no aggregation. Mobile has a `test:coverage` script that nothing invokes. The config blocks are dead weight that implies a discipline that doesn't exist.

3. **DB-dependent integration tests skip quietly when Postgres is absent.** 12 of 118 `apps/api` test files (all repository + tenant-isolation integration suites) guard with `describe.skipIf(!hasDb)` where `hasDb = Boolean(process.env['DATABASE_URL'])` (e.g. `apps/api/src/repositories/__tests__/users.repository.test.ts:17,31`). `apps/api/vitest.global-setup.ts` does print a warning when Docker is unavailable (lines ~104-112) and the run summary shows "skipped", but the suite still **exits 0**, so a green local run can silently omit the entire repository layer.
   - CI today is _not_ exposed: `.github/workflows/ci.yml:95-112` provisions a Postgres service and exports `DATABASE_URL`, so skips can't happen there — **unless** the env wiring regresses (renamed var, new job, copied workflow), in which case CI would go green while running half the suite. There is no guard against that failure mode.

4. **Stryker mutation testing exists but has never been operationalised.** `packages/domain/stryker.config.mjs` (thresholds `{ high: 80, low: 60, break: 50 }`, vitest runner, perTest coverage analysis) plus `npm run mutation-test` were added in the testing-infrastructure bootstrap commit (`f4ea9d2`) and never touched since; no `reports/` dir exists, no CI/scheduled job references stryker anywhere in `.github/workflows/`. Same story for the fast-check property tests (`packages/domain/src/shared/__tests__/properties.test.ts`) — they at least run with the normal suite. The domain package is the highest-value mutation target in the repo (pure logic, zero I/O, 9 test files → fast runs) and it's getting zero mutation signal.

5. **Mobile Jest divergence — mostly justified, two smells.** `apps/mobile/jest.config.js` uses the `react-native` preset with babel-jest, a hand-rolled `resolvePackage()` hoisting shim, and module-name mappings into workspace sources. Two genuine issues:
   - `"test": "jest --forceExit"` (`apps/mobile/package.json:10,14`) — forceExit masks leaked open handles; a hung handle that later becomes a real bug (timers, async-storage, fetch mocks) will be invisible.
   - `ts-jest@^29.4.9` is a devDependency but appears nowhere in `jest.config.js` (the react-native preset transforms via babel-jest) — likely a dead dependency.
   - The root-level `overrides: { "jest-runtime": "30.3.0" }` pin (root `package.json:70,106`) is well-documented and correct: react-native 0.83.6's preset locks jest-environment-node@29 while jest-runtime 30.4+ calls `clearMocksOnScope()`. Keep until react-native ships a jest-30 preset.
   - **Jest→Vitest migration verdict: do not migrate.** The Expo/react-native testing ecosystem (the `react-native` preset's native-module mocks, `transformIgnorePatterns` handling of untranspiled RN packages, `@testing-library/react-native`) is built on Jest; Vitest has no maintained RN preset. Migrating would trade one contained, documented divergence for an unsupported frontier. Contain it instead (see Phase 4).

6. **Config drift across the 10 Vitest configs — real but mostly benign.** Differences: `globals: true` in 8 configs, `globals: false` in `packages/infra/vitest.config.ts:5`, unset in `apps/vpn-agent/vitest.config.ts`; `packages/auth` has 3 test files and **no config at all** (runs on defaults; its tests import `describe/it` explicitly, so this works). The `dist/**` exclude is copy-pasted into 8 configs because compiled test output gets re-discovered otherwise (vpn-agent learned this the hard way — see its config comment). The React dedupe/aliasing block is duplicated verbatim between `apps/tenant-web/vitest.config.ts` and `apps/admin-web/vitest.config.ts` (lines ~17-35 in each). `packages/infra`'s `pool: 'forks'` is **required** (CDK `NodejsFunction` spawns esbuild; Turbo's worker-stdio breaks `child_process.spawn` — documented at `packages/infra/vitest.config.ts:7-12`) and must be preserved. Verdict: a shared base config is worth doing as a low-priority consolidation, not an urgent fix — the single Vitest version means drift hasn't actually bitten.

7. **AI angle — honest assessment: no new AI automation here.** A periodic "Claude reviews uncovered branches and proposes tests" job is strictly worse than the mechanical alternatives: coverage ratchets and mutation testing produce trustworthy, zero-maintenance gap signals, while an AI scan job needs prompt upkeep, produces unverified suggestions, and duplicates what Stryker's surviving-mutant report already says with proof. The one genuinely valuable AI use is **ad hoc, not pipelined**: after a scheduled mutation run, paste the surviving-mutant list into Claude Code and ask it to write tests that kill specific survivors — that's a 10-minute targeted session with a built-in verification loop (re-run Stryker). Phase 3 bakes that recipe into the scheduled job's summary rather than building a new pipeline.

## Plan

### Phase 1 — Quick wins (kill misdirection + close the silent-skip hole) — ~1h total

- [ ] **Delete `vitest.workspace.ts`** at repo root. It references a nonexistent package, is unsupported by Vitest 4, and nothing invokes it. (Effort: 5 min. Verify nothing imports it: `grep -rn "vitest.workspace" --include='*.ts' --include='*.json' . | grep -v node_modules` → expect no hits besides the file itself.)
- [ ] **CI fail-fast guard in `apps/api/vitest.global-setup.ts`**: at the top of `setup()`, before the Docker fallback logic, add:
  ```ts
  if (process.env['CI'] && !process.env['DATABASE_URL']) {
    throw new Error(
      '[test:db] CI run without DATABASE_URL — integration tests would silently skip. Failing fast.',
    )
  }
  ```
  This turns the "CI env wiring regressed → half the suite skips green" failure mode into a hard failure. GitHub Actions always sets `CI=true`. (Effort: 10 min incl. a comment explaining why.)
- [ ] **Loud local skip banner**: add a tiny custom reporter `apps/api/vitest.skip-reporter.ts` that, in `onTestRunEnd`, counts skipped test files/suites and prints a red multi-line banner when > 0, e.g. `⚠ 12 DB-dependent suites SKIPPED — start Docker or set DATABASE_URL; this run did NOT exercise the repository layer`. Wire it in `apps/api/vitest.config.ts` via `reporters: ['default', './vitest.skip-reporter.ts']`. Keep it dumb: count `module.state() === 'skipped'` (Vitest 4 reporter API) or fall back to scanning `testModules` for files where all tests skipped. (Effort: 30 min.)
- [ ] **Remove `ts-jest` from `apps/mobile/package.json` devDependencies** after confirming zero references: `grep -rn "ts-jest" apps/mobile --include='*.js' --include='*.ts' --include='*.json' | grep -v node_modules` currently shows only the package.json line. Run `npm install` (Node 24 PATH pin per memory) and `npm test -w @pegasus/mobile` to confirm. (Effort: 15 min.)

### Phase 2 — Coverage: enable a ratchet where it pays, delete it where it doesn't — ~2h

Decision (recommended): **do not** build repo-wide coverage aggregation or blanket thresholds — for a solo dev that's ceremony, not signal. Instead enable real, self-ratcheting coverage on the two packages where regressions are costly (`packages/domain` — business rules; `apps/api` — handlers/repos), and strip the dormant config everywhere else.

- [ ] **`packages/domain` + `apps/api`: turn coverage on with an auto-ratchet.** In each `vitest.config.ts` coverage block add:
  ```ts
  coverage: {
    provider: 'v8',
    reporter: ['text', 'lcov'],
    reportsDirectory: './coverage',
    thresholds: {
      lines: 0, branches: 0, functions: 0, statements: 0, // replaced by first autoUpdate run
      autoUpdate: true, // vitest rewrites these numbers upward as coverage improves
    },
  },
  ```
  Change those two packages' `test` script to `vitest run --coverage`. Run once locally; `autoUpdate` writes the current real numbers into the config — commit that as the baseline. From then on, any PR that drops coverage below the high-water mark fails `turbo run test` (already in CI), and improvements ratchet the floor up automatically. (Effort: 45 min. Note: v8 coverage adds runtime — measure; if `apps/api` suite time grows > ~30%, scope coverage to `src/repositories/**` + `src/lib/**` via `coverage.include` rather than abandoning it.)
- [ ] **Delete the dormant `coverage` blocks** from `packages/infra/vitest.config.ts`, `apps/admin-web/vitest.config.ts`, `apps/tenant-web/vitest.config.ts`, and remove `@vitest/coverage-v8` from those packages' devDependencies (infra, admin-web, tenant-web). Rationale: infra is CDK assertions (coverage is meaningless there); the two SPAs' coverage was never looked at — keep the option of re-adding deliberately later instead of carrying config that lies. (Effort: 30 min incl. install + test run.)
- [ ] **Doc note**: one paragraph in `dolas/agents/project/PATTERNS.md` stating the coverage policy — "ratcheted on domain + api via vitest autoUpdate thresholds; nowhere else by design". (Effort: 10 min.)

### Phase 3 — Mutation testing: scheduled, non-blocking, with an AI follow-up recipe — ~1.5h

- [ ] **New workflow `.github/workflows/mutation-test.yml`**: `on: { schedule: [{ cron: '0 6 1 * *' }], workflow_dispatch: {} }` (monthly + manual; weekly is overkill for a package that changes a few times a month). Job: checkout, setup-node 20, `npm ci`, `npm run mutation-test -w @pegasus/domain`, then `actions/upload-artifact` of `packages/domain/reports/mutation/html`. Let the existing `thresholds.break: 50` in `packages/domain/stryker.config.mjs` fail the job — that's the alert. Do **not** add it to PR CI. (Effort: 45 min. Coordinate naming/conventions with Unit 1's CI plan but this is an independent additive workflow.)
- [ ] **Add a summary step** that greps Stryker's clear-text output for the mutation score and surviving-mutant list and writes it to `$GITHUB_STEP_SUMMARY`, ending with the AI recipe line: _"To act on survivors: open Claude Code in `packages/domain`, paste the survivor list, ask for tests that kill each mutant, re-run `npm run mutation-test` to verify."_ This is the entire AI integration for this unit — deliberate, ad hoc, verifiable. (Effort: 20 min.)
- [ ] **First manual run** via `workflow_dispatch` (or locally: `npm run mutation-test -w @pegasus/domain`) to establish the baseline score and confirm runtime is acceptable (expect minutes, not hours, at 9 test files). If the score is below 50 the job will fail — triage survivors in one Claude Code session before enabling the cron. (Effort: depends on score; budget 1 session.)

### Phase 4 — Mobile Jest hygiene: contain the divergence — ~1-2h

- [ ] **Hunt the leaked handles behind `--forceExit`**: run `npx jest --detectOpenHandles --runInBand` in `apps/mobile`. If the leaks are in app/test code (un-cleared timers, unmocked fetch/async-storage), fix them and drop `--forceExit` from both `test` and `test:coverage` scripts. If the leaks trace into the react-native preset internals (common), keep `--forceExit` but add a one-line comment in `apps/mobile/package.json` scripts (`"//test"` key) naming the leaking module so the flag reads as a documented containment, not a shrug. (Effort: 1h timebox — do not rabbit-hole.)
- [ ] **Record the divergence-removal trigger** in `dolas/agents/project/GOTCHAS.md`: mobile stays on Jest until react-native ships a jest-30-compatible preset; when it does, delete the root `jest-runtime: 30.3.0` override (root `package.json:106`) and re-test. Checking is one command: `npm view react-native@latest jest-preset 2>/dev/null` / release notes at RN upgrades — which already happen for Expo SDK bumps. No scheduled job needed. (Effort: 10 min.)
- [ ] **Do not migrate mobile to Vitest** — decision recorded in Context §5; add one line to `dolas/agents/project/DECISIONS.md` so a future agent doesn't re-litigate it. (Effort: 5 min.)

### Phase 5 — Optional consolidation: shared Vitest base (do last, or not at all) — ~2h

- [ ] **Create `vitest.shared.ts` at repo root** exporting two partial configs:
  ```ts
  // vitest.shared.ts
  import type { ViteUserConfig } from 'vitest/config'
  export const nodeBase: ViteUserConfig['test'] = {
    globals: true,
    environment: 'node',
    exclude: ['dist/**', 'node_modules/**'],
  }
  // reactBase: jsdom + setupFiles convention + the react/react-dom dedupe-alias block
  // currently duplicated in apps/tenant-web/vitest.config.ts and apps/admin-web/vitest.config.ts
  ```
  Each package config becomes `defineConfig({ test: { ...nodeBase, /* overrides */ } })`. **Preserve exactly**: `packages/infra`'s `pool: 'forks'` + `globals: false` + its `include` glob (CDK/esbuild constraint — keep the explanatory comment); `apps/api`'s `globalSetup`, `testTimeout: 15_000`, and domain alias; the two SPAs' plugins/setupFiles. Add a minimal `packages/auth/vitest.config.ts` using `nodeBase` while at it (its tests already pass on defaults, so this is consistency only). (Effort: 2h incl. running `turbo run test` to prove no behaviour change. Skip this phase entirely if time-constrained — the drift is cosmetic; the duplicated React-dedupe block is the only part that has real bug-recurrence risk.)

## Files to Modify / Create

| Action                     | Path                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Delete                     | `vitest.workspace.ts` (repo root)                                                                                                                            |
| Modify                     | `apps/api/vitest.global-setup.ts` (CI fail-fast guard)                                                                                                       |
| Create                     | `apps/api/vitest.skip-reporter.ts` (loud skip banner)                                                                                                        |
| Modify                     | `apps/api/vitest.config.ts` (reporter wiring; coverage ratchet + `--coverage` script)                                                                        |
| Modify                     | `apps/api/package.json` (`test` script `--coverage`)                                                                                                         |
| Modify                     | `packages/domain/vitest.config.ts`, `packages/domain/package.json` (coverage ratchet)                                                                        |
| Modify                     | `packages/infra/vitest.config.ts`, `apps/admin-web/vitest.config.ts`, `apps/tenant-web/vitest.config.ts` (+ their `package.json`s) — remove dormant coverage |
| Modify                     | `apps/mobile/package.json` (drop `ts-jest`; forceExit outcome)                                                                                               |
| Create                     | `.github/workflows/mutation-test.yml` (scheduled, non-blocking)                                                                                              |
| Modify                     | `dolas/agents/project/PATTERNS.md`, `dolas/agents/project/DECISIONS.md`, `dolas/agents/project/GOTCHAS.md` (policy/decision/trigger notes)                   |
| Create (Phase 5, optional) | `vitest.shared.ts`, `packages/auth/vitest.config.ts`; modify remaining `vitest.config.ts` files                                                              |

## Side Effects & Risks

- **Coverage `autoUpdate` rewrites `vitest.config.ts` on improvement** — produces config diffs in unrelated PRs. Acceptable for a solo dev (it's the ratchet working); if it annoys, freeze to explicit numbers and bump quarterly.
- **`--coverage` slows the two instrumented suites** (v8 instrumentation overhead, typically 10-30%). `apps/api` is the risk (118 files + DB). Mitigate with `coverage.include` scoping; worst case revert to coverage-off and explicit-threshold-free — but then delete the config blocks too (no zombie config).
- **CI fail-fast guard** depends on `CI` env var — set by GitHub Actions by default; any future non-GHA runner must also set it (note in the code comment).
- **Mutation job can fail on first run** if current score < 50 (`break` threshold). That's signal, not breakage — it's a scheduled job, not a PR gate. Triage before enabling cron, or temporarily lower `break` and ratchet it up.
- **Removing `@vitest/coverage-v8` from 3 packages** changes lockfile; run installs with Node 24 (`/home/steve/.nvm/versions/node/v24.16.0/bin` PATH pin — default shell node 25 corrupts node_modules, per project memory).
- **Skip-reporter uses Vitest 4 reporter API** — pin to documented `Reporter` hooks; a future Vitest major may need a 5-line update.
- **Phase 5 base-config refactor** could subtly change test discovery (`include`/`exclude`) — the acceptance gate is identical test counts before/after.

## Acceptance Criteria / Verification

All commands from repo root unless noted; use Node 24 PATH pin for anything touching node_modules.

- [ ] Stale workspace file gone: `[ ! -e vitest.workspace.ts ] && echo OK`
- [ ] Silent-skip closed in CI: `CI=true DATABASE_URL= npx vitest run --root apps/api 2>&1 | grep -q 'Failing fast' && echo OK` (global setup throws; suite exits non-zero)
- [ ] Loud local banner: with Docker stopped and no `DATABASE_URL`, `npm test -w @pegasus/api` prints the SKIPPED banner and the skip count matches 12 suites.
- [ ] Coverage ratchet live: `npm test -w @pegasus/domain` and `npm test -w @pegasus/api` produce `coverage/lcov.info` and nonzero `thresholds` numbers committed in both `vitest.config.ts` files; artificially deleting a test makes the run fail the threshold.
- [ ] Dormant coverage gone: `grep -L coverage packages/infra/vitest.config.ts apps/admin-web/vitest.config.ts apps/tenant-web/vitest.config.ts` lists all three files; `grep -rn coverage-v8 packages/infra/package.json apps/admin-web/package.json apps/tenant-web/package.json` → no hits.
- [ ] Mutation cadence: `gh workflow run mutation-test.yml` succeeds (or fails only on the `break` threshold), uploads an HTML-report artifact, and the step summary shows the mutation score + survivor list + AI recipe line.
- [ ] Mobile: `grep ts-jest apps/mobile/package.json` → no hits; `npm test -w @pegasus/mobile` green; `forceExit` either removed or annotated with the named leaking module.
- [ ] No regression anywhere: `node node_modules/.bin/turbo run test` green; per-package test counts (Vitest "Test Files" summary) unchanged from pre-change baseline except intentional additions.
- [ ] (Phase 5 only) `turbo run test` test-file counts identical before/after the shared-base refactor; `packages/infra` still runs with `pool: 'forks'` (assert via `grep -n "pool: 'forks'" packages/infra/vitest.config.ts` or the shared override).
