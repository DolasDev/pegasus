# CI Pipeline Efficiency — Audit & Remediation

> **Status: SCOPED** — 2026-06-10

## Context

Audit of `.github/workflows/ci.yml` (246 lines, 5 jobs) and `audit-ci.jsonc`, with measured timings from recent runs (`gh run list --workflow ci.yml`).

### Measured baseline (run 27243490124, representative of the last ~15 runs)

| Job | Duration | Notes |
| --- | --- | --- |
| Secret Scanning (Betterleaks) | 0m11s | downloads CLI fresh every run |
| Typecheck | 1m20s | npm ci ≈ 38s |
| Lint | 1m03s | npm ci ≈ 38s |
| Test | **3m00s** | critical path; npm ci 38s, turbo test 109s, audit-ci 2s, expo checks 5s |
| E2E Tests | 1m53s | npm ci 40s, Playwright install 29s, actual tests 7s |

- **Wall clock per run: 3m05s–3m33s** (jobs run in parallel; bounded by Test).
- **Billed runner minutes per run: ~7.5** (sum of jobs). Last 60 runs: 53 success, 5 failure (all real failures — dependabot bumps / feature work, not infra flakes), 2 cancelled.
- All 5 job names are **required status checks** on `main` branch protection (verified via `gh api repos/{owner}/{repo}/branches/main/protection`). Any job rename or path-filter scheme must account for this.
- CI runs twice per PR'd change (PR event + push-to-main after merge). Intentional — direct pushes to main happen in the batch/worktree flow — keep.

### Findings (each verified against the file)

1. **Dead-code expo-doctor guard — correctness bug, not just fragility.** `ci.yml:156`: `if echo "$output" | grep -q '✖' | grep -v 'duplicate dependencies'; then`. `grep -q` produces no stdout, so the trailing `grep -v` reads empty input and always exits 1 → the `if` body **never executes**. Real expo-doctor failures pass CI silently. Proven: `printf '✖ fail\n'` through the same pipeline → guard does not fire. The inner logic (lines 158–163) is correct but unreachable.
2. **No `timeout-minutes` on any job** (`grep -n timeout-minutes ci.yml` → no matches). Default is 360 min; a hung Playwright server or pg health-check wait burns up to 6 h of runner time and, via the `ci-${{ github.ref }}` concurrency group, blocks subsequent runs on the same ref.
3. **Node 20 hardcoded in 4 jobs** (`ci.yml:49,76,119,204`). Node 20 reached EOL April 2026 (now past). Local dev pins v24.16.0 (per memory: engines gate). No `.nvmrc` exists at repo root. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` (`ci.yml:10`) is a transitional GitHub flag that becomes redundant once the runner default flips.
4. **4× duplicated setup block** — checkout / setup-node / `npm ci` / "Fix binary permissions" repeated verbatim in typecheck, lint, test, e2e (`ci.yml:45–56, 72–83, 115–126, 200–211`). `npm ci` costs 38–40s per job even with the `setup-node` npm cache (cache only skips the registry download, not extraction/linking). ≈ 2.5 billed min/run of duplication; ~38s of it is on the wall-clock critical path (Test job).
5. **Playwright browsers installed fresh every run** (`ci.yml:213–215`, `playwright install --with-deps chromium`, measured 29s). `~/.cache/ms-playwright` is cacheable keyed on the Playwright version (1.60.0 in `package-lock.json`). (Research note claimed 2–3 min — actual is 29s; still worth caching.)
6. **Betterleaks CLI downloaded fresh from GitHub releases every run** (`ci.yml:27–34`). Cost is small (11s job) but it adds a third-party-download failure mode (release asset throttling/outage) to every single CI run.
7. **audit-ci runs inside the Test job** (`ci.yml:128–129`). Only 2s of runtime, but it couples the dependency-security gate to the longest job: a new CVE surfaces as a "Test" failure, and the audit only executes if the Test job's container spin-up succeeds. `audit-ci.jsonc` itself is sound (fail on high/critical, empty allowlist, documented policy) — no config change needed.
8. **No path filtering** — docs/plans-only commits (a large share of recent history: plan archives, memory updates) run the full ~3.4 min, ~7.5 billed-min pipeline. Because all 5 jobs are required checks, naive workflow-level `paths-ignore` would leave PRs permanently blocked; the in-workflow `dorny/paths-filter` + job-level `if:` pattern is required (skipped required checks report success and do not block merges).
9. Correction to research notes: ci.yml has **5** jobs, not 6.

## Plan

### Phase 1 — Correctness & safety quick wins (~30 min total, do first, single PR)

- [ ] **Fix the dead expo-doctor guard** (`ci.yml:148–164`). Effort: 10 min. Replace the broken pipeline with the already-correct inner logic:

  ```yaml
  - name: Run Expo doctor
    working-directory: apps/mobile
    run: |
      # Tolerate the duplicate-dependency check (monorepo false positive:
      # mobile pins react@19.2.0 for Expo SDK 55 while web apps use 19.2.4).
      output=$(npx expo-doctor 2>&1) || true
      echo "$output"
      failures=$(echo "$output" | grep '✖' | grep -v 'duplicate dependencies' || true)
      if [ -n "$failures" ]; then
        echo "::error::Expo doctor found issues:"
        echo "$failures"
        exit 1
      fi
  ```

  **Heads-up:** the guard has been a no-op since it was written — expect this fix to potentially surface latent expo-doctor failures on the first run. Triage them in the same PR rather than reverting.

- [ ] **Add `timeout-minutes` to all 5 jobs.** Effort: 5 min. Values sized at ~3× measured duration:

  ```yaml
  secret-scan:  timeout-minutes: 5
  typecheck:    timeout-minutes: 10
  lint:         timeout-minutes: 10
  test:         timeout-minutes: 15
  e2e:          timeout-minutes: 15
  ```

  (One line under each `runs-on: ubuntu-latest`.)

- [ ] **Bump Node 20 → 24 via a single source of truth.** Effort: 15 min + watch one green run. Create `.nvmrc` at repo root containing `24.16.0` (matches local dev), then in all four `setup-node` blocks replace `node-version: '20'` with `node-version-file: '.nvmrc'`. Delete the now-redundant `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env (`ci.yml:9–10`) only after confirming actions run clean on node24 default; otherwise keep it one more cycle. Note: deploy workflows are Unit 2's scope — do **not** touch their node pins here, but flag the mismatch to Unit 2 if they still say 20.

### Phase 2 — Setup dedup + caching (~1.5 h, second PR)

- [ ] **Create a composite setup action** `.github/actions/setup/action.yml` and replace the 4 duplicated blocks. Effort: 45 min. This both removes ~60 lines of YAML drift risk and adds a `node_modules` cache that skips the 38–40s `npm ci` on lockfile hit (~2.3 billed min/run saved; ~35s off the Test-job critical path → wall clock drops toward ~2m30s):

  ```yaml
  # .github/actions/setup/action.yml
  name: 'Setup Node + dependencies'
  description: 'setup-node, cached node_modules, npm ci on miss, binary perms fix'
  runs:
    using: 'composite'
    steps:
      - uses: actions/setup-node@v6
        with:
          node-version-file: '.nvmrc'
          cache: 'npm'
      - name: Cache node_modules
        id: modules-cache
        uses: actions/cache@v4
        with:
          path: node_modules
          key: ${{ runner.os }}-modules-${{ hashFiles('package-lock.json', '.nvmrc') }}
      - name: Install dependencies
        if: steps.modules-cache.outputs.cache-hit != 'true'
        run: npm ci
        shell: bash
      - name: Fix binary permissions
        run: find node_modules/.bin -type f | xargs chmod +x 2>/dev/null || true
        shell: bash
  ```

  Usage in each job (after `actions/checkout@v6`): `- uses: ./.github/actions/setup`.
  **Validation required before merging:** confirm postinstall-dependent artifacts survive the cache path — Prisma engines are regenerated explicitly per job (`prisma generate`), and `@playwright/test` does not download browsers on postinstall, so a restored `node_modules` should be complete. Verify by re-running a cached run and checking typecheck/test/e2e all pass on `cache-hit: true`.
  Note: workspace `node_modules` are hoisted to root in this repo; if any app keeps a nested `node_modules` (check `ls apps/*/node_modules packages/*/node_modules` locally), add those paths to `path:`.

- [ ] **Cache Playwright browsers in the e2e job.** Effort: 30 min. Saves ~20s and removes a CDN download from every run:

  ```yaml
  - name: Get Playwright version
    id: pw-version
    run: echo "version=$(node -p "require('./package-lock.json').packages['node_modules/@playwright/test'].version")" >> "$GITHUB_OUTPUT"
  - name: Cache Playwright browsers
    id: pw-cache
    uses: actions/cache@v4
    with:
      path: ~/.cache/ms-playwright
      key: ${{ runner.os }}-playwright-${{ steps.pw-version.outputs.version }}
  - name: Install Playwright browsers
    working-directory: apps/e2e
    if: steps.pw-cache.outputs.cache-hit != 'true'
    run: node ../../node_modules/.bin/playwright install --with-deps chromium
  - name: Install Playwright OS deps
    working-directory: apps/e2e
    if: steps.pw-cache.outputs.cache-hit == 'true'
    run: node ../../node_modules/.bin/playwright install-deps chromium
  ```

  (apt packages aren't cacheable; `install-deps` on a hit takes ~5–10s on ubuntu-latest, which already ships most of them.)

- [ ] **Cache the Betterleaks binary.** Effort: 15 min. Primarily a resilience fix (one less external download per run):

  ```yaml
  - name: Cache Betterleaks
    id: bl-cache
    uses: actions/cache@v4
    with:
      path: ~/betterleaks-bin
      key: betterleaks-${{ env.BETTERLEAKS_VERSION }}-linux-x64
  - name: Install Betterleaks
    if: steps.bl-cache.outputs.cache-hit != 'true'
    run: |
      mkdir -p ~/betterleaks-bin
      curl -sSfL -o betterleaks.tar.gz \
        "https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}/betterleaks_${BETTERLEAKS_VERSION}_linux_x64.tar.gz"
      tar -xzf betterleaks.tar.gz -C ~/betterleaks-bin betterleaks
      rm betterleaks.tar.gz
  - name: Run Betterleaks
    run: ~/betterleaks-bin/betterleaks git .
  ```

  Move `BETTERLEAKS_VERSION: '1.1.1'` to job-level `env` so both steps see it.

### Phase 3 — Job topology (~1.5 h, third PR)

- [ ] **Move the audit-ci step from the Test job to the Lint job.** Effort: 10 min. Cut lines `ci.yml:128–129` and paste after the Lint job's setup (before the lint step). Rationale: decouples the dependency-security gate from the 3-min Test job and the Postgres container; a new CVE now fails in ~50s with an honestly-named-enough job, **without renaming any job** (avoids branch-protection churn — keeping job names stable is why a dedicated `dependency-audit` job is NOT recommended right now; revisit if Unit 5 adds a security job). `audit-ci.jsonc` needs no changes.

- [ ] **Skip heavy jobs on docs/plans-only changes** with `dorny/paths-filter`. Effort: 1 h. Saves the full ~3.4 min wall / ~7.3 billed min on every plans-archive or docs commit — the highest-frequency waste found in this audit. Skipped required checks report success, so branch protection stays satisfied.

  ```yaml
  changes:
    name: Detect changed paths
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      code: ${{ steps.filter.outputs.code }}
    steps:
      - uses: actions/checkout@v6
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            code:
              - '!((plans|dolas)/**|**/*.md)'
  ```

  Then on typecheck, lint, test, e2e add:

  ```yaml
  needs: changes
  if: needs.changes.outputs.code == 'true'
  ```

  **Deliberately conservative:** the filter treats *anything* outside `plans/`, `dolas/`, and `*.md` as code — a `.md` inside `apps/` or `packages/` also skips, which is acceptable; if in doubt, narrow the negation to `!(plans/**|dolas/**)` only. **Keep secret-scan unconditional** (docs can leak secrets too). Pin `dorny/paths-filter` to a commit SHA (it's a third-party action): `dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36 # v3.0.2`.

### Phase 4 — Optional AI integration (~1–2 h, only if desired)

- [ ] **CI-failure auto-triage comment** via `anthropics/claude-code-action`. Effort: 1–2 h + ~cents per failure. The one place AI genuinely earns its keep here: on a failed CI run, an action job pulls `gh run view <id> --log-failed`, asks Claude for a root-cause hypothesis + suggested fix, and posts it as a PR comment / commit comment — replacing the manual log-spelunking loop. Sketch (new file `.github/workflows/ci-triage.yml`):

  ```yaml
  name: CI Failure Triage
  on:
    workflow_run:
      workflows: [CI]
      types: [completed]
  jobs:
    triage:
      if: github.event.workflow_run.conclusion == 'failure'
      runs-on: ubuntu-latest
      timeout-minutes: 10
      permissions:
        contents: read
        actions: read
        pull-requests: write
      steps:
        - uses: actions/checkout@v6
        - name: Fetch failed logs
          env:
            GH_TOKEN: ${{ github.token }}
          run: gh run view ${{ github.event.workflow_run.id }} --log-failed > failed.log || true
        - uses: anthropics/claude-code-action@v1
          with:
            anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
            prompt: |
              Read failed.log (CI failure logs). Identify the most likely root cause
              and the file(s) to fix. Post a concise comment on the PR/commit for run
              ${{ github.event.workflow_run.id }} with: root cause, evidence line, suggested fix.
  ```

  Requires `ANTHROPIC_API_KEY` repo secret. With only ~5 failures/60 runs, cost is negligible.

- **Explicit non-recommendation:** everything in Phases 1–3 is deterministic YAML work — no AI component adds value there. Likewise, do not add AI-generated PR summaries or AI lint: the solo-dev author already knows the diff, and turbo/eslint are deterministic and faster.

## Files to Modify / Create

| File | Action |
| --- | --- |
| `.github/workflows/ci.yml` | Modify (all phases: guard fix, timeouts, node-version-file, composite-action adoption, caches, audit-ci move, paths-filter gating) |
| `.github/actions/setup/action.yml` | **Create** (Phase 2 composite action; `.github/actions/` does not exist yet) |
| `.nvmrc` | **Create** (Phase 1; content `24.16.0`) |
| `.github/workflows/ci-triage.yml` | **Create** (Phase 4, optional) |
| `audit-ci.jsonc` | No changes (config is sound) |

Out of scope (other audit units): `deploy.yml`, `_deploy.yml`, `temporal-worker.yml`, VPN/publish workflows (Unit 2); rollback (Unit 3); Turbo remote caching & pre-push hooks (Unit 10); e2e test strategy beyond the browser cache above (Unit 9); new security scanners (Unit 5).

## Side Effects & Risks

- **Expo-doctor fix may turn CI red immediately** — the guard has never actually enforced anything. Budget time in the Phase 1 PR to fix or explicitly allowlist whatever it surfaces.
- **Node 20 → 24** changes the runtime under typecheck/tests. Engines field is `>=18`, and dev already runs 24.16.0, so risk is low — but land it as its own commit so a failure bisects cleanly.
- **node_modules cache restore** can mask postinstall side effects. Mitigated by per-job `prisma generate` and the validation step in Phase 2; if anything is flaky, drop only the `actions/cache` step — the composite action still pays for itself as dedup.
- **Stale caches**: `actions/cache` evicts LRU at 10 GB/repo; node_modules (~hundreds of MB) + Playwright (~150 MB) fit comfortably, but a corrupt cache is cleared with `gh cache delete --all`.
- **paths-filter misclassification** could skip CI on a real code change pushed straight to main (which auto-deploys). The filter is negation-based (only `plans/`, `dolas/`, `*.md` skip), so the failure mode requires shipping logic inside those paths — not a thing in this repo. Still, verify with the acceptance tests below before relying on it.
- **Required checks**: no job is renamed anywhere in this plan, so branch protection needs no edits. If a future change does rename jobs, update `main` protection in the same sitting.
- **Phase 4** posts AI-generated comments with `pull-requests: write`; logs may contain secrets-adjacent output — Betterleaks gating reduces but does not eliminate this. Acceptable for a private solo repo.

## Acceptance Criteria / Verification

Phase 1:
- `grep -c 'timeout-minutes' .github/workflows/ci.yml` → `5` (or 6 after Phase 3's `changes` job).
- `grep -n "node-version: '20'" .github/workflows/ci.yml` → no matches; `cat .nvmrc` → `24.16.0`.
- Guard fix proven in CI: temporarily not needed — verify locally that the new pipeline fires: `output='✖ something broke'; failures=$(echo "$output" | grep '✖' | grep -v 'duplicate dependencies' || true); [ -n "$failures" ] && echo GUARD-FIRES` → prints `GUARD-FIRES`.
- One green run on a real PR: `gh run list --workflow ci.yml --limit 1` → `success`.

Phase 2:
- Second consecutive run (warm cache): `gh run view <id> --json jobs` shows "Install dependencies" ≤ 5s (cache hit) in all 4 jobs and "Install Playwright browsers" skipped.
- **Wall clock for a warm code-change run ≤ 2m45s** (baseline 3m20s); Test job ≤ 2m25s.
- Billed minutes (sum of job durations in `gh run view --json jobs`) ≤ 5.5 min (baseline ~7.5).

Phase 3:
- audit-ci: `gh run view <id> --json jobs --jq '.jobs[] | select(.name=="Lint") | .steps[].name'` includes "Audit dependencies"; Test job no longer does. Force-verify the gate still bites: add a fake high advisory id to a scratch branch's allowlist removal test or simply confirm `npx --no-install audit-ci --config ./audit-ci.jsonc` exits 0 locally.
- Docs-only commit (e.g. touch a file under `plans/`) → `gh run view <id> --json jobs` shows typecheck/lint/test/e2e `conclusion: skipped`, secret-scan + changes `success`, **wall clock < 1 min**, and the commit/PR is mergeable (required checks satisfied).
- Code commit → all jobs run as before.

Phase 4 (if implemented):
- Intentionally break a test on a scratch branch → within ~3 min of CI failure, a triage comment appears on the PR naming the failing spec. `gh run list --workflow ci-triage.yml --limit 1` → `success`.

Whole-plan regression gate: after each phase's PR merges, confirm the next `main` push produces a green CI run **and** an uncancelled Deploy run (`gh run list --workflow deploy.yml --limit 1`) per the known rapid-push cancellation gotcha.
