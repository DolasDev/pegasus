# Supply-Chain & Static-Analysis Security — Remediation Plan

> **Status: SCOPED** — 2026-06-10

## Context

Audit of dependency security, SAST, secret scanning, SBOM, and the dependency-update
review process. All claims below were verified against the repo and the live GitHub API
on 2026-06-10. Scope boundaries: runtime hardening (CORS/rate-limiting/tenant isolation)
is a separate plan; Python CI test jobs and general CI-efficiency are separate plans.

### Headline finding: the repo is PUBLIC and free GitHub security features are all OFF

`gh repo view DolasDev/pegasus` → **`"visibility": "PUBLIC"`**. (Earlier internal notes
assumed private + GHAS-costs-money; that framing is wrong.) For public repos, GitHub's
entire code-security suite is **free** — and every piece of it is currently disabled
(verified via `gh api repos/DolasDev/pegasus --jq .security_and_analysis` and
`gh api repos/DolasDev/pegasus/code-scanning/default-setup`):

| Feature | State 2026-06-10 | Cost on public repo |
| --- | --- | --- |
| CodeQL code scanning | `not-configured` (detected langs: `javascript-typescript`, `python`, `actions`) | Free |
| GitHub secret scanning | `disabled` | Free |
| Secret-scanning push protection | `disabled` | Free |
| Dependabot security updates (auto-fix PRs) | `disabled` (alerts themselves ARE enabled — `vulnerability-alerts` returns 204) | Free |
| Dependency review on PRs | no workflow exists | Free |

A second-order finding: a multi-tenant SaaS monorepo (incl. `packages/infra` CDK code and
all workflow YAML) being world-readable is itself a decision worth confirming. The
public-ness also raises the stakes on every secret-scanning gap — anything that lands in
history is instantly world-readable, not just org-readable.

### What is already good (keep, don't touch)

- **audit-ci gate** — `.github/workflows/ci.yml:128-129` runs
  `npx --no-install audit-ci --config ./audit-ci.jsonc` on every CI run;
  `audit-ci.jsonc:4-8` fails on high/critical with an **empty allowlist**. Healthy.
- **Betterleaks secret scan** — `ci.yml:20-36` runs `betterleaks git .` over full history
  (`fetch-depth: 0`), pinned to v1.1.1, as a required branch-protection check.
  `.betterleaksignore` has 21 fingerprint-scoped entries (1 documented accepted-risk
  Airbrake client key, 20 false positives), each with a rationale comment; triage runbook
  in `dolas/agents/project/GOTCHAS.md:108`. Healthy posture — narrowest-possible
  suppressions, documented.
- **Dependabot auto-merge is genuinely CI-gated.** `dependabot-auto-merge.yml:20-25` uses
  `gh pr merge --auto --squash`, which only merges after required checks pass. Verified
  branch protection on `main` requires all five CI contexts (Secret Scanning, Typecheck,
  Lint, Test, E2E). `strict: false` means a stale-base merge is possible — accepted risk
  for a solo repo (Test job re-runs on main push anyway).
- **Dependabot config** — `.github/dependabot.yml`: weekly npm, minor+patch grouped,
  majors ignored, Expo-locked packages explicitly excluded with rationale. Sound.
- **PyPI publishing** — `release-sdk-python.yml:69-89` uses OIDC trusted publishing, no
  long-lived token. Good.
- **Overrides documentation** — every entry in `package.json` `overrides` (~16 CVE-driven
  + react/jest ecosystem pins) has a matching `//overrides` comment explaining why.

### Gaps (drive the plan)

1. **No SAST at all.** No CodeQL, no Semgrep, nothing. Free CodeQL covers TS, Python,
   *and* GitHub Actions workflows (the `actions` language catches `pull_request_target`
   footguns, script injection in `${{ }}`, etc.).
2. **No gate against newly-introduced bad packages.** audit-ci catches known advisories
   in the resolved tree, but nothing flags a PR that *adds* a vulnerable or
   known-malicious package at review time. `dependency-review-action` (free, public
   repo) does exactly this, including the OpenSSF malicious-packages list and license
   checks.
3. **Secret scanning has one layer, not two.** Betterleaks is good but pattern-based and
   CI-time only. GitHub native scanning adds provider-validated patterns + **push
   protection** (blocks the secret before it enters world-readable history). Free; off.
4. **Dependabot ignores two ecosystems.** `dependabot.yml` covers npm only — no
   `github-actions` (35+ action refs pinned by mutable major tag, e.g. `@v6`) and no
   `pip` for `packages/workflows-sdk-python`.
5. **Betterleaks binary downloaded without checksum** — `ci.yml:31-33` curls a tarball
   from GitHub releases and installs it with no SHA-256 verification. A compromised
   release asset would run inside CI with repo checkout.
6. **Python deps unbounded and unaudited.** `packages/workflows-sdk-python/pyproject.toml:18-22`
   declares `temporalio>=1.7`, `httpx>=0.27`, `typer>=0.12` — lower bounds only.
   `release-sdk-python.yml:48-49` installs whatever is latest at tag time
   (non-reproducible release builds). `grep -rn pip-audit` across `.github/` and the SDK
   → zero hits. This SDK is published to PyPI for tenant use.
7. **No override-expiry process.** The 16 CVE overrides in `package.json` have no
   re-check automation; the only tracking is one manual plan
   (`plans/todo/2026-05-09T0315-back-out-transitive-dep-workarounds.md`), which itself
   documents how the `jest-runtime` pin's stated exit condition went stale (the real
   root cause was one level deeper). Dead overrides accumulate, mask regressions, and
   make `npm ls` noise permanent.
8. **No SECURITY.md** — no vulnerability-disclosure contact for a public repo serving
   paying tenants.
9. **No SBOM** — assessed below; verdict: mostly ceremony for now, with one free
   near-equivalent worth enabling.

## Plan

### Phase 0 — Quick wins: turn on the free stuff (≈30 min total, zero recurring toil)

- [ ] **Confirm public visibility is intentional.** (5 min, decision only.) If yes, the
      rest of this plan assumes it. If no — flipping to private removes free CodeQL/
      secret-scanning/dependency-review and most of this plan needs re-scoping; decide
      first.
- [ ] **Enable GitHub secret scanning + push protection + validity checks.** (5 min)
      ```
      gh api -X PATCH repos/DolasDev/pegasus -F 'security_and_analysis[secret_scanning][status]=enabled' -F 'security_and_analysis[secret_scanning_push_protection][status]=enabled' -F 'security_and_analysis[secret_scanning_validity_checks][status]=enabled'
      ```
      Keep Betterleaks as-is — the two are complementary (Betterleaks: full-history +
      custom allowlist + required check; GitHub: provider validation + push-time block).
      Expect GitHub's historical scan to re-flag the known Airbrake key — dismiss with
      the same rationale already recorded in `.betterleaksignore:10-13`.
- [ ] **Enable Dependabot security updates.** (2 min) Alerts are already on; this adds
      automatic fix-PRs, which then flow through the existing CI-gated auto-merge for
      minor/patch — closing vulns with zero manual steps.
      ```
      gh api -X PUT repos/DolasDev/pegasus/automated-security-fixes
      ```
- [ ] **Add `SECURITY.md`.** (10 min) Repo root. Content: supported version = `main`
      (continuous deploy); report via GitHub private vulnerability reporting (enable it:
      `gh api -X PUT repos/DolasDev/pegasus/private-vulnerability-reporting`) with
      dolasllc@gmail.com as fallback; expected ack within 72h; no bounty. Keep it to
      ~15 lines. No AI needed here.

### Phase 1 — SAST: CodeQL default setup (≈30 min, recommended primary path)

- [ ] **Enable CodeQL *default setup*** — not an advanced workflow file. (15 min)
      Zero YAML to maintain, auto-tracks language list, runs on PRs to `main` + weekly
      schedule. Since the repo is public this costs nothing; **do not** add Semgrep CE
      or `eslint-plugin-security` alongside — they would duplicate findings for extra
      triage toil. (Semgrep CE remains the documented fallback *only if* the repo ever
      goes private and GHAS isn't purchased.)
      ```
      gh api -X PATCH repos/DolasDev/pegasus/code-scanning/default-setup -f state=configured -f query_suite=default
      ```
      Languages auto-detected: `javascript-typescript`, `python`, `actions`.
- [ ] **Triage the initial scan; do NOT make CodeQL a required check yet.** (30-60 min,
      one-time) Review alerts at Security → Code scanning; dismiss false positives with
      reasons. Only consider promoting to a required branch-protection context after 2-4
      weeks of quiet operation — a noisy required SAST gate is the classic solo-dev
      friction trap. PR-blocking behavior for *new* alerts on changed code happens by
      default via the check annotation even without "required" status.

### Phase 2 — Dependency gates on PRs (≈45 min)

- [ ] **Add `dependency-review-action` as a standalone workflow.** (15 min) New file
      `.github/workflows/dependency-review.yml`:
      ```yaml
      name: Dependency Review
      on: pull_request
      permissions:
        contents: read
      jobs:
        dependency-review:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v6
            - uses: actions/dependency-review-action@v4
              with:
                fail-on-severity: high
                comment-summary-in-pr: on-failure
      ```
      This fails PRs that introduce packages with high/critical advisories or entries on
      the OpenSSF malicious-packages list — the gap audit-ci can't cover (audit-ci only
      sees the post-merge resolved tree; this sees the diff). Note: requires the
      dependency graph; if the action errors with 404/"dependency graph not enabled",
      enable it under Settings → Advanced Security first (the SBOM API check below has
      the same dependency).
- [ ] **Extend Dependabot to `github-actions` and `pip` ecosystems.** (10 min) Append to
      `.github/dependabot.yml`:
      ```yaml
        - package-ecosystem: 'github-actions'
          directory: '/'
          schedule:
            interval: 'weekly'
          groups:
            actions:
              patterns: ['*']
        - package-ecosystem: 'pip'
          directory: '/packages/workflows-sdk-python'
          schedule:
            interval: 'weekly'
      ```
      Actions updates flow through the existing auto-merge gate. SHA-pinning every
      action ref is the stricter posture but adds churn; with Dependabot watching the
      tags, major-tag pinning is an acceptable lean middle ground — **except** consider
      SHA-pinning just the deploy-path workflows (`_deploy.yml`, `deploy.yml`) that hold
      AWS OIDC role access, where a hijacked tag is highest-impact. Defer; revisit if
      CodeQL's `actions` queries flag it.
- [ ] **Verify the Betterleaks download.** (10 min) In `ci.yml`, after the `curl`
      (line 31-33), add a checksum gate. Compute once from the official release asset
      (`sha256sum betterleaks.tar.gz`) and pin:
      ```yaml
      - name: Install Betterleaks
        env:
          BETTERLEAKS_VERSION: '1.1.1'
          BETTERLEAKS_SHA256: '<sha256 of betterleaks_1.1.1_linux_x64.tar.gz>'
        run: |
          curl -sSfL -o betterleaks.tar.gz "https://github.com/betterleaks/betterleaks/releases/download/v${BETTERLEAKS_VERSION}/betterleaks_${BETTERLEAKS_VERSION}_linux_x64.tar.gz"
          echo "${BETTERLEAKS_SHA256}  betterleaks.tar.gz" | sha256sum -c -
          tar -xzf betterleaks.tar.gz -C /usr/local/bin betterleaks
          rm betterleaks.tar.gz
      ```

### Phase 3 — Python supply chain (≈30 min; pip-audit + pin policy only — the PR-time pytest/ruff job belongs to the Python-CI plan)

- [ ] **Add `pip-audit` to the release build job.** (15 min) In
      `.github/workflows/release-sdk-python.yml`, after "Install package (for tests)"
      (line 55-56):
      ```yaml
      - name: Audit dependencies (pip-audit)
        run: |
          python -m pip install pip-audit
          python -m pip-audit --skip-editable
      ```
      This audits the resolved environment that actually ships in the wheel's dependency
      closure, at the moment of release — the minimum bar for a published SDK. (If the
      Python-CI plan later adds a PR-time job, move/duplicate this step there.)
- [ ] **Add upper bounds to runtime deps.** (10 min) In
      `packages/workflows-sdk-python/pyproject.toml:18-22`:
      ```toml
      dependencies = [
        "temporalio>=1.7,<2",
        "httpx>=0.27,<1",
        "typer>=0.12,<1",
      ]
      ```
      Rationale: this SDK is consumed by tenants; `temporalio` 2.x or `httpx` 1.x landing
      silently at install time is a real breakage vector, and (unlike a general-purpose
      library) the platform controls the supported matrix so caps are appropriate. Bump
      caps deliberately via Dependabot pip PRs (Phase 2). Full lockfile/`uv.lock`
      machinery is overkill for 3 deps — skip.

### Phase 4 — Override-expiry automation (≈2-3 h one-time; the AI-integration item)

- [ ] **Deterministic checker script** (1-2 h): `scripts/check-overrides.mjs` — for each
      key in `package.json` `overrides`, query the npm registry for who depends on it
      (`npm ls <pkg> --all --json`) and whether the override constraint is now satisfied
      by default resolution (i.e., delete-and-resolve in a temp dir, or simpler: check
      `npm view <direct-parent> dependencies.<pkg>` against the override range). Emit a
      markdown report of overrides that look removable. This is mechanical — **no AI
      needed for the detection step.**
- [ ] **Monthly scheduled workflow** (30 min): `.github/workflows/override-expiry.yml`:
      ```yaml
      name: Override Expiry Check
      on:
        schedule:
          - cron: '0 6 1 * *'   # 1st of month, 06:00 UTC
        workflow_dispatch: {}
      permissions:
        contents: read
        issues: write
      jobs:
        check:
          runs-on: ubuntu-latest
          steps:
            - uses: actions/checkout@v6
            - uses: actions/setup-node@v6
              with: { node-version: '20' }
            - run: npm ci
            - run: node scripts/check-overrides.mjs --report /tmp/report.md
            - name: File issue if any override is removable
              run: |
                if [ -s /tmp/report.md ]; then
                  gh issue create --title "Override expiry: $(date +%Y-%m) candidates" --body-file /tmp/report.md --label dependencies
                fi
              env:
                GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      ```
- [ ] **AI step — honest assessment: worth it, but as the *second* stage, not the
      detector.** The judgment work ("is the `jest-runtime` pin's exit condition met?
      that requires checking which `jest-environment-node` the react-native preset now
      pulls, re-running the mobile suite, and reading the tracking plan") is exactly what
      went stale under the manual process, and is genuinely a good fit for an agent with
      repo access. Recommendation: extend the workflow above so that *when the report is
      non-empty*, a `anthropics/claude-code-action@v1` step (model `claude-opus-4-8`)
      runs with a prompt to: read `//overrides` + the report +
      `plans/todo/2026-05-09T0315-back-out-transitive-dep-workarounds.md`, attempt
      removal of each candidate on a branch (`rm -rf node_modules package-lock.json &&
      npm install`, then `turbo run test`), and open a cleanup PR only for overrides that
      survive the full test suite — falling back to commenting findings on the issue.
      Cost: one monthly run, realistically a few dollars at Opus pricing — trivially
      cheaper than the half-day manual sessions the plans archive documents. The PR
      still lands through CI + auto-review like any other.
      **Do not** let the agent push to `main` or auto-merge; PR only.

### Phase 5 — SBOM: mostly NOT NOW (honest assessment)

- [ ] **Skip release-attached CycloneDX/syft SBOMs.** For a solo dev with no customer or
      regulatory demand for SBOM delivery, generating and storing artifacts nobody reads
      is ceremony. Revisit when an enterprise tenant or compliance framework (e.g.,
      SOC 2 vendor questionnaire) asks.
- [ ] **Do enable the free near-equivalent** (5 min): GitHub's dependency-graph SBOM
      export. Currently `gh api repos/DolasDev/pegasus/dependency-graph/sbom` returns
      404 — flip on the dependency graph (Settings → Advanced Security, or it activates
      with the dependency-review work in Phase 2), then the on-demand export
      (`gh api repos/DolasDev/pegasus/dependency-graph/sbom > sbom.spdx.json`) satisfies
      any ad-hoc "send us your SBOM" request with zero recurring cost. Document the
      command in `dolas/agents/project/GOTCHAS.md`.
- [ ] **Skip signed commits / commit provenance.** `required_signatures` is off; for a
      single-author repo where every change flows through one GitHub account + branch
      protection, signing adds key-management toil with negligible threat-model benefit.
      PyPI provenance is already covered by trusted publishing (PEP 740 attestations are
      on by default in current `pypa/gh-action-pypi-publish@release/v1`). No action.

## Files to Modify / Create

| Path | Action |
| --- | --- |
| `SECURITY.md` | create (Phase 0) |
| `.github/workflows/dependency-review.yml` | create (Phase 2) |
| `.github/dependabot.yml` | modify — add `github-actions` + `pip` ecosystems (Phase 2) |
| `.github/workflows/ci.yml` | modify — Betterleaks SHA-256 check (Phase 2) |
| `.github/workflows/release-sdk-python.yml` | modify — pip-audit step (Phase 3) |
| `packages/workflows-sdk-python/pyproject.toml` | modify — dependency upper bounds (Phase 3) |
| `scripts/check-overrides.mjs` | create (Phase 4) |
| `.github/workflows/override-expiry.yml` | create (Phase 4) |
| `dolas/agents/project/GOTCHAS.md` | modify — SBOM export one-liner + secret-scan layering note (Phase 5) |
| Repo settings via `gh api` (no file) | secret scanning, push protection, security updates, private vuln reporting, CodeQL default setup, dependency graph |

## Side Effects & Risks

- **CodeQL initial-scan noise.** First scan on a mature monorepo will produce alerts;
  budget the one-time triage and do not wire it as a required check until quiet.
- **Push protection can block a legitimate push** (e.g., a test fixture that looks like
  a key). Bypass-with-reason is built into the flow; the Betterleaks runbook pattern in
  GOTCHAS.md applies.
- **`dependency-review-action` at `fail-on-severity: high` can block an urgent PR** if a
  newly-added dep has an unfixed advisory. Escape hatch: `allow-ghsas` input per-GHSA,
  mirroring the audit-ci allowlist discipline (entry + rationale + removal condition).
- **pyproject upper bounds** can cause resolver conflicts for tenants who co-install the
  SDK with something needing `httpx>=1`. Accepted: platform controls the supported
  matrix; loosen deliberately if it bites.
- **Dependabot `github-actions` PRs** add ~1 grouped PR/week initially; auto-merge
  absorbs minor/patch. Major action bumps (e.g., `checkout@v6→v7`) still need a human —
  that is intended.
- **Claude override-expiry agent**: an agent with `npm install` + test execution runs
  arbitrary postinstall scripts from the registry — same exposure CI already has, but
  keep its workflow token scoped to `contents: write` + `pull-requests: write` on a
  branch, never `main` push, and no AWS credentials in that workflow.
- **Deploy interaction**: none of these changes touch `deploy.yml` path filters; new
  workflows are independent. The `ci.yml` edit (checksum) changes a required check —
  verify green on a branch before merging (main pushes auto-deploy).

## Acceptance Criteria / Verification

Phase 0:
- `gh api repos/DolasDev/pegasus --jq '.security_and_analysis.secret_scanning.status'` → `enabled`; same for `secret_scanning_push_protection`.
- `gh api repos/DolasDev/pegasus/automated-security-fixes -i 2>&1 | head -1` → `204`.
- `[ -f SECURITY.md ]` and it renders on the repo's Security tab.

Phase 1:
- `gh api repos/DolasDev/pegasus/code-scanning/default-setup --jq '.state'` → `configured`.
- A test PR shows a "Code scanning" check; Security → Code scanning lists completed analyses for `javascript-typescript`, `python`, `actions`.

Phase 2:
- A test PR adding a package with a known high advisory (e.g., `npm i lodash@4.17.15` in a scratch branch) fails the `Dependency Review` check; reverting passes it.
- `gh api repos/DolasDev/pegasus/dependabot/alerts?per_page=1` still 200 and Dependabot opens `github-actions`-ecosystem PRs on the next weekly run (`gh pr list --author 'app/dependabot'`).
- CI Secret Scanning job green with the checksum line present; corrupting `BETTERLEAKS_SHA256` on a scratch branch fails that job.

Phase 3:
- Run the release workflow via `workflow_dispatch`; the `Audit dependencies (pip-audit)` step appears and passes.
- `pip install 'pegasus-workflows-sdk @ file:packages/workflows-sdk-python'` in a fresh venv resolves `temporalio<2`, `httpx<1`.

Phase 4:
- `gh workflow run override-expiry.yml` completes; with a deliberately-stale override candidate (test by temporarily adding an already-satisfied override like `"minimatch": ">=3.0.0"`), an issue is filed; with none, no issue.
- If the Claude step is enabled: the run opens a PR (never pushes `main`); PR passes the full required-check suite before any merge.

Phase 5:
- `gh api repos/DolasDev/pegasus/dependency-graph/sbom --jq '.sbom.name'` → returns the repo SBOM (currently 404).
