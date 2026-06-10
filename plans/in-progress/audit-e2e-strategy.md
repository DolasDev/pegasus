# Audit — E2E Test Strategy (Speed, Reliability, Coverage, Ergonomics)

> **Status: SCOPED** — 2026-06-10

Unit 9 of the CI/CD + devops audit batch. Scope: the Playwright e2e suite
(`apps/e2e`), its three execution modes, the CI jobs that run it, and the
existing `plans/todo/neon-branches-for-e2e-isolation.md` plan.
**Out of scope** (owned by sibling audit units): unit/integration tests
(Unit 8), generic CI job setup dedup (Unit 1 — except the Playwright
browser cache, which is e2e-specific and specified here), deploy pipeline
mechanics (Unit 2), generic AI CI-failure triage (Unit 12).

## Context

### Verified ground truth (measured 2026-06-09 runs — corrects prior assumptions)

The working hypothesis going in was "e2e is the #1 CI bottleneck (15–20 min)".
**That is false.** Measured step timings:

- **CI `E2E Tests` job** (`.github/workflows/ci.yml:172-245`), run 27241973872:
  total **1 m 48 s** — `npm ci` 36 s, Playwright browser install 26 s, **the
  actual `playwright test` step: 7 s**.
- **Staging e2e gate** (`.github/workflows/deploy.yml:160-238`), run
  27238212079: total **1 m 23 s** — `npm ci` 41 s, browser install 12 s,
  Playwright run **19 s**. The gate's own comment (deploy.yml:156) already
  says it's intentionally a small smoke.
- **QA longhaul nightly** (`.github/workflows/e2e-qa-longhaul.yml`): ~4–7 min
  per run; **3 of the last 5 runs failed** at the "Run QA longhaul E2E" step
  (runs 27150051930, 27135540346, 27089217145 — external on-prem/tunnel
  dependency).

So the e2e problem is **not speed — it's signal**. The suite is thin, much of
it silently skips, and the green checkmark overstates what was tested.

### Finding 1 — PR CI has ZERO browser coverage; the 7-second "pass" is mostly skips

- `ci.yml`'s e2e job env (ci.yml:191-197) sets `DATABASE_URL`/`SKIP_AUTH` but
  **no `WEB_URL`** and no MSSQL config. Consequences, all by-design self-skips:
  - `tests/browser/landing.spec.ts:6` — skips without `WEB_URL`.
  - `tests/browser/trip-date-container.spec.ts:43` — skips without `WEB_URL`
    (and needs a logged-in dev server even locally).
  - `tests/browser/admin-vpn-diagnose.spec.ts:14` — skips without its web URL.
  - `tests/api/longhaul.spec.ts:8` — 14 tests skip without MSSQL.
- Net: the CI job runs only ~34 HTTP-level API tests in 7 s. **No browser
  spec has ever run in PR CI.** Core SaaS flows (customer/quote/move CRUD in
  tenant-web, admin-web flows) have no browser tests anywhere; the only real
  browser suite is QA-longhaul, which covers one module, nightly, against an
  environment that's down ~half the time.
- Compounding it, the `E2E_SKIP` pattern (`apps/e2e/global-setup.ts:51-77`)
  converts _infrastructure_ failures (no Postgres, failed migrate) into a
  green run. Locally that's a nice ergonomic; in CI it's a false-positive
  machine — if the Postgres service container ever broke, the job would pass
  in seconds with 0 tests executed and nobody would notice.

### Finding 2 — the staging gate smoke can't catch a write-path regression

Remote mode filters `@local-only` (`apps/e2e/playwright.config.ts:104`).
What actually runs in the gate: `health.spec.ts` (2), `authz-smoke.spec.ts`
(4 + persona coverage, real Cognito), `ringcentral.spec.ts` (3 webhook
checks), `landing.spec.ts` (1). All read-only or webhook-shaped. Every
CRUD spec (`customers`, `moves`, `quotes`, `documents-variants`,
`api-client-service-accounts`, `vpn`, `me-permissions`) is `@local-only`
because it would pollute the shared staging DB. **A deploy that breaks
`POST /customers` sails through the gate to prod.** This is exactly the gap
`plans/todo/neon-branches-for-e2e-isolation.md` (Pattern A: reset shared
staging branch from a `baseline` parent before each run) was written to
close — that plan is sound and should be executed, not duplicated. One
refinement needed: it references a `_e2e.yml` workflow that never
materialized; the gate now lives inline as the `e2e-staging` job in
`deploy.yml:160`, so the reset step goes there.

### Finding 3 — serialization is fine today; don't optimize prematurely

`workers: 1`, `fullyParallel: false` (playwright.config.ts:95-98) caps
throughput, but at 19 s (gate) / 7 s (CI) there is nothing to parallelize.
Parallelism only becomes worth the shared-DB-state work after the suite
grows past ~2–3 min of runtime. Defer; the Neon plan's Pattern B note
already captures the eventual path.

### Finding 4 — flake management is good per-spec, absent as a process

What already exists and works (keep):

- Variant pinning: `/driver-planning` renders a RANDOM A/B/C variant per
  mount; `tests/browser/longhaul/pages/AvailabilityPage.ts:30-40`
  (`pinVariant`) pins C before asserting and re-pins after reload.
- On-prem health gating: `tests/browser/longhaul/_shared.ts:45-64` probes
  `/version` + `/users/me` with one retry and `test.skip()`s the spec on
  genuine outage instead of failing.
- `retries: CI ? 1 : 0` + `trace: 'on-first-retry'` (config:97,108) and
  report artifacts uploaded in all three workflows.

What's missing: nothing consumes the failures. 3/5 nightly QA failures
produced artifacts nobody opened and no tracking record. There is no
quarantine mechanism — a genuinely flaky spec's only options today are
"fail the run" or "get deleted".

### Finding 5 — mode discoverability is mediocre; docs exist but no front door

- `apps/e2e/REMOTE.md` and `apps/e2e/QA.md` are good mode contracts, but
  there's no `apps/e2e/README.md` indexing them, and the root `package.json`
  has `e2e` + `e2e:qa` scripts (package.json:20-21) but **no `e2e:remote`**
  — running remote mode locally requires hand-assembling 3+ env vars from
  REMOTE.md.
- `CLAUDE.md`'s "E2E Suite" section is stale: it lists 4 API spec files and 1
  browser spec; reality is 13 API + 8 browser spec files (~120 `test()`
  declarations across modes).

### Finding 6 — visual regression: one spec, effectively dev-laptop-only

`tests/browser/trip-date-container.spec.ts` carries the only
`toHaveScreenshot` usage, with a sane tolerance budget
(`maxDiffPixelRatio: 0.01, threshold: 0.2`, config:115-117). It's
`@local-only` _and_ requires a manually-logged-in tenant-web dev server, so
it never runs in CI. Verdict: **keep minimal — do not invest in visual
tooling** (Percy/Chromatic-class spend isn't justified by one container).
It earns its keep as a manual layout-drift checker; revisit only if a Neon
isolated gate makes browser specs CI-runnable and screenshot baselines stop
being machine-dependent.

### Finding 7 — AI angle (honest assessment)

- **AI selector healing: skip — snake oil at this scale.** The suite already
  uses page objects (`tests/browser/longhaul/pages/`) with semantic
  locators; healing tools mostly mask real UI regressions and add a vendor.
- **AI trace triage: defer to Unit 12's generic CI-failure triage.** The only
  e2e-specific piece worth specifying here is making failures _triageable by
  an agent at all_: the nightly auto-issue in Phase 4 below links the
  Playwright HTML report + trace artifacts, which is precisely the input a
  triage agent (or Claude pointed at the artifact) needs. No bespoke e2e AI
  tool needed.
- **AI spec authoring: yes, genuinely valuable here.** `@playwright/mcp` is
  already a devDependency (`apps/e2e/package.json:13`). The browser-coverage
  gap (Finding 1) is exactly the toil AI removes well: drive the running app
  via Playwright MCP, then have Claude generate page objects + specs matching
  the existing longhaul PO conventions. This is a _practice_, not
  infrastructure — Phase 2 exploits it.

## Plan

### Phase 1 — Quick wins (~1–2 h total, all independent)

- [x] **1.1 Add a minimum-executed-tests guard to both CI e2e runs.**
      (~30 min) Silent-skip false-positives (Finding 1) die here. Run
      Playwright with a JSON reporter alongside the list reporter, then
      assert a floor on executed (non-skipped) tests:
      `yaml
  # ci.yml "Run E2E tests" step — add reporter + guard
  - name: Run E2E tests
    working-directory: apps/e2e
    run: node ../../node_modules/.bin/playwright test --reporter=list,json
    env:
    PLAYWRIGHT_JSON_OUTPUT_NAME: results.json
  - name: Guard against silent-skip false positives
    working-directory: apps/e2e
    run: |
    ran=$(jq '.stats.expected + .stats.flaky' results.json)
        echo "Executed (passed) tests: $ran"
        if [ "$ran" -lt 30 ]; then
    echo "::error::Only $ran tests executed — the suite silently skipped (E2E_SKIP / missing env?). Floor is 30."
    exit 1
    fi
    `  Same pattern in`deploy.yml` `e2e-staging` with floor **8** (current
    remote set is ~10). Floors live as env vars at the top of each job so
    they're greppable and easy to bump when specs are added.
- [x] **1.2 Cache Playwright browsers in all three workflows.** (~20 min;
      saves 12–26 s/job — minor, but free and removes a network dependency
      from the deploy gate). Insert before each "Install Playwright
      browsers" step in `ci.yml`, `deploy.yml` (e2e-staging job), and
      `e2e-qa-longhaul.yml`:
      `yaml
  - name: Resolve Playwright version
    id: pw
    run: echo "version=$(node -p "require('@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"
  - name: Cache Playwright browsers
    id: pw-cache
    uses: actions/cache@v4
    with:
    path: ~/.cache/ms-playwright
    key: playwright-${{ runner.os }}-${{ steps.pw.outputs.version }}
  - name: Install Playwright browsers
    working-directory: apps/e2e
    run: |
    if [ "${{ steps.pw-cache.outputs.cache-hit }}" = "true" ]; then
    node ../../node_modules/.bin/playwright install-deps chromium
    else
    node ../../node_modules/.bin/playwright install --with-deps chromium
    fi
    `  (Version-resolve step must run after`npm ci`. If Unit 1's setup-dedup
    composite action lands first, fold this into it instead.)
- [x] **1.3 Add `e2e:remote` root script + `apps/e2e/README.md` front door.**
      (~30 min) Root `package.json` scripts block:
      `json
  "e2e:remote": "E2E_TARGET=remote npm run e2e --workspace=@pegasus/e2e"
  `
      (env vars still come from `apps/e2e/.env.test.local` per the loader at
      playwright.config.ts:37 — README documents that.) New
      `apps/e2e/README.md` (~30 lines): the three-mode table (lift from
      REMOTE.md), which script runs which mode, pointer to QA.md / REMOTE.md
      / `.env.test.example`, the `@local-only` / `@qa-mutating` tag contract,
      and the skip-guard floor from 1.1.
- [x] **1.4 Fix the stale CLAUDE.md E2E section.** (~10 min) Replace the
      4-file spec list under "### E2E Suite" with a pointer to
      `apps/e2e/README.md` (don't enumerate specs in two places again).

### Phase 2 — Close the browser-coverage hole in PR CI (~1–1.5 d)

- [ ] **2.1 Serve a built tenant-web in the CI e2e job.** (~0.5 d) In
      `ci.yml` e2e job: `turbo run build --filter=@pegasus/tenant-web`
      (Vite build with `VITE_API_BASE_URL=http://localhost:3001`), then
      `npx vite preview --port 4173 &` (or `npx serve -s dist`) and export
      `WEB_URL=http://localhost:4173`. This alone un-skips
      `landing.spec.ts`. Bump the 1.1 floor accordingly.
- [ ] **2.2 Solve local browser auth.** (~0.5 d) The API already honors
      `SKIP_AUTH=true` in local mode; the SPA still needs a session to pass
      its auth guard. Two options — pick after a 1 h spike:
      (a) extend `SKIP_AUTH` handling so tenant-web (when
      `VITE_E2E_SKIP_AUTH=true`, build-time, never in prod bundles) skips the
      Cognito redirect and trusts the API's default-tenant identity; or
      (b) mint a session the same way `apps/e2e/fixtures/hosted-ui-login.ts`
      does for QA and inject `storageState`, against a local stub. Option (a)
      is less machinery and mirrors the API's existing test seam — prefer it
      unless the spike finds the guard too entangled.
- [ ] **2.3 Author the first three core-flow browser specs with Playwright
      MCP + Claude.** (~0.5 d, AI-assisted — Finding 7) Flows, in order of
      regression value: login-shell loads + nav renders; create customer →
      appears in list; create quote from customer → line item math renders.
      Convention: page objects in `tests/browser/pages/` mirroring the
      longhaul PO style (`tests/browser/longhaul/pages/AvailabilityPage.ts`
      is the exemplar — including its variant-pinning discipline if any
      target page has randomized variants). Tag `@local-only` until Phase 3
      gives the gate an isolated DB.

### Phase 3 — Make the staging gate able to catch write regressions (~0.5–1 d + Neon plan)

- [ ] **3.1 Execute `plans/todo/neon-branches-for-e2e-isolation.md`
      (Pattern A) with these refinements.** (effort per that plan; the
      refinements are ~0 extra) - Its step 3 targets a `_e2e.yml` that doesn't exist — the reset step
      goes in the `e2e-staging` job of `.github/workflows/deploy.yml`
      (insert between "Extract staging URLs" and "Run E2E (remote)"). - Its step 4 ("what lives on `baseline`") should standardize on the
      same fixtures `global-setup.ts` seeds locally (tenant
      `e2e00000-...0001` + admin user), NOT `prisma db seed` — the seed
      script is known-broken (omits tenantId; see memory). Concretely:
      `prisma migrate deploy` + the two upserts from
      `apps/e2e/global-setup.ts:91-105` replayed against `baseline` once. - Move the plan file to `plans/in-progress/` when started.
- [ ] **3.2 Introduce a `@smoke` promotion tag and run CRUD specs in the
      gate.** (~0.5 d, after 3.1) Once the gate DB resets per run, the
      `@local-only` tag is no longer the right filter — split it:
      `@local-only` keeps meaning "needs SKIP_AUTH or local-only infra"
      (`vpn`, `admin-vpn-diagnose`, `documents-variants` if S3-coupled,
      `trip-date-container`); `customers`/`moves`/`quotes` get retagged so
      remote mode includes them (they already use the `apiFetch` fixture and
      run in 7 s — gate stays well under 2 min). Acceptance: revert-test —
      deliberately break a `POST /customers` handler on a branch, confirm
      the gate run fails.
- [ ] **3.3 Revisit `workers: 1` only after 3.2.** (no-op now) If gate
      runtime exceeds ~3 min, flip `fullyParallel: true` for the `api`
      project with per-spec unique fixture data; the Neon reset makes
      cross-RUN isolation a non-issue, and cross-WORKER isolation is just
      unique-suffix discipline the specs mostly already follow.

### Phase 4 — Flake policy + nightly failure routing (~0.5 d)

- [ ] **4.1 Auto-file an issue when the QA nightly fails.** (~1 h) The 3/5
      failure streak rotted unseen (Finding 4). Append to
      `e2e-qa-longhaul.yml`:
      `yaml
  - name: File/refresh failure issue
    if: failure()
    env:
    GH_TOKEN: ${{ github.token }}
      run: |
        title="QA longhaul nightly failed"
        existing=$(gh issue list --state open --search "$title in:title" --json number --jq '.[0].number')
        body="Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }} — report artifact: playwright-report-qa-longhaul. Traces are in the artifact (trace on-first-retry)."
        if [ -n "$existing" ]; then gh issue comment "$existing" --body "$body";
    else gh issue create --title "$title" --label e2e-flake --body "$body"; fi
    `
    One open issue, refreshed per failure — gives Unit 12's triage agent
    (or a human) a single thread with artifact links. No further e2e-side
    AI tooling needed (Finding 7).
- [ ] **4.2 Adopt a written flake policy in `apps/e2e/README.md`.** (~30 min)
      Three rules: (1) a spec that fails-then-passes-on-retry twice in one
      week gets tagged `@flaky` and excluded from blocking runs via
      `grepInvert: /@local-only|@flaky/` in the `isDeployed` branch of
      playwright.config.ts:104 (quarantine, still runs in the nightly);
      (2) retry budget stays at 1 in CI — never raise it to hide a flake;
      (3) quarantined specs carry a `// QUARANTINED <date> <issue#>` header
      and get a fix-or-delete decision within 2 weeks. (Past fixes —
      variant pinning, shell-bound sentinels, on-prem probes — show flakes
      here are fixable; the policy just prevents silent retry-masking.)
- [ ] **4.3 Upgrade gate trace capture to `'retain-on-failure'` for remote
      mode only.** (~15 min) `trace: 'on-first-retry'` means a
      fail-fail-no-retry-left sequence in the gate ships no trace. In
      playwright.config.ts `use`: `trace: isDeployed ? 'retain-on-failure' :
  'on-first-retry'`. Cost: trace overhead on every gate test (~10 tests,
      negligible at 19 s) in exchange for always-triageable prod-gate
      failures.

## Files to Modify / Create

| File                                                  | Action                                                         | Phase         |
| ----------------------------------------------------- | -------------------------------------------------------------- | ------------- |
| `.github/workflows/ci.yml`                            | skip-guard, browser cache, tenant-web build+serve in e2e job   | 1.1, 1.2, 2.1 |
| `.github/workflows/deploy.yml`                        | skip-guard + cache in `e2e-staging`; Neon reset step           | 1.1, 1.2, 3.1 |
| `.github/workflows/e2e-qa-longhaul.yml`               | browser cache; failure auto-issue step                         | 1.2, 4.1      |
| `package.json` (root)                                 | add `e2e:remote` script                                        | 1.3           |
| `apps/e2e/README.md`                                  | **create** — mode index, tag contract, flake policy            | 1.3, 4.2      |
| `CLAUDE.md`                                           | de-stale E2E section → pointer to README                       | 1.4           |
| `apps/e2e/playwright.config.ts`                       | `@flaky` grepInvert; remote `retain-on-failure` trace          | 4.2, 4.3      |
| `apps/tenant-web/` (auth guard)                       | E2E auth seam per 2.2 spike outcome                            | 2.2           |
| `apps/e2e/tests/browser/pages/*` + 3 new specs        | **create** — core-flow browser specs                           | 2.3           |
| `apps/e2e/tests/api/{customers,moves,quotes}.spec.ts` | retag for gate inclusion                                       | 3.2           |
| `plans/todo/neon-branches-for-e2e-isolation.md`       | execute (Pattern A) with §3.1 refinements; move to in-progress | 3.1           |

## Side Effects & Risks

- **1.1 floor values can false-fail** when specs are legitimately removed or
  a new env-gated suite lands — floors are deliberately loose (30/8 vs ~34/10
  actual) and live as job-level env vars to make bumps a one-line diff.
- **2.2 auth seam is the riskiest item**: any web-side auth bypass must be
  build-time (`import.meta.env`-guarded, dead-code-eliminated in prod
  builds) and CI-only. If the spike shows leakage risk into prod bundles,
  fall back to option (b) (storageState injection) even though it's more
  machinery.
- **3.2 retagging changes gate semantics**: the gate gets slower (still
  <2 min projected) and gains a new failure dependency (Neon reset API). A
  Neon API outage would block prod deploys — mitigate by making the reset
  step retry once, then fail loudly (never skip-and-run against a dirty DB,
  which silently reintroduces Finding 2's pollution problem).
- **4.1 issue automation** needs `issues: write` permission added to the
  workflow's `permissions` block; the `e2e-flake` label must exist first.
- **Browser cache (1.2)** can serve a stale binary if the cache key scheme
  misses a Playwright patch bump — key on the exact resolved version string
  (the sketch does) and never use `restore-keys` fallbacks.
- Ordering with sibling units: 1.2 overlaps Unit 1's setup-dedup composite —
  whichever lands second rebases; 3.1's reset step touches deploy.yml, which
  Unit 2 may also be restructuring.

## Acceptance Criteria / Verification

- **Phase 1**:
  - `gh run watch` a CI run on a branch with `E2E_SKIP` artificially forced
    (e.g. unset `DATABASE_URL` in the job env on a throwaway branch) →
    the e2e job FAILS at the guard step instead of passing in 7 s.
  - Second consecutive CI run shows `Cache restored from key: playwright-…`
    and the install step completes in <5 s.
  - `npm run e2e:remote` from repo root fails fast with the
    `E2E_TARGET=remote requires E2E_API_BASE_URL` config error (proves the
    script wires the mode) and `[ -e apps/e2e/README.md ]`.
- **Phase 2**:
  - CI e2e job log shows `landing.spec.ts` and the 3 new core-flow specs as
    PASSED (not skipped); JSON-guard `ran` count increases by ≥4.
  - `grep -r VITE_E2E_SKIP_AUTH apps/tenant-web/dist` after a prod-mode
    build returns nothing (seam is dead-code-eliminated).
- **Phase 3**:
  - Neon plan's own step 6 validation (record created in run N invisible in
    run N+1).
  - Revert-test: branch with a deliberately broken `POST /customers` →
    `e2e-staging` job fails and `deploy-prod` is skipped.
  - Gate job wall-clock stays under 3 min (`gh run view <id> --json jobs`).
- **Phase 4**:
  - Manually `gh workflow run e2e-qa-longhaul.yml` against a known-down
    tunnel → one open issue labeled `e2e-flake` exists with the run link;
    a second failure comments on the same issue instead of opening a new one.
  - Force a no-retry double failure in remote mode → trace zip present in
    the `playwright-report-staging` artifact.
