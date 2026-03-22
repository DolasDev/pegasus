# Dependency & Secret Scanning

**Branch:** `feature/on-prem-server`
**Goal:** Automated dependency vulnerability scanning via Dependabot and secret scanning via Gitleaks in CI.

## Context

No Dependabot, Renovate, or Snyk. `.gitignore` covers `.env` but no automated secret scanning. Prisma, Hono, jose, mssql all have active CVE streams.

## Implementation Checklist

### 1. Dependabot configuration

- [x] Create `.github/dependabot.yml`
  - Weekly npm update schedule
  - Group minor/patch updates
  - Target `main` branch

### 2. npm audit in CI

- [x] Modify `.github/workflows/ci.yml` — add `npm audit --audit-level=high` step
  - Runs after install, before tests
  - Blocks on high-severity vulnerabilities

### 3. Gitleaks secret scanning

- [x] Add Gitleaks GitHub Action step to `.github/workflows/ci.yml`
  - Scans on PR and push
  - Uses `gitleaks/gitleaks-action`

### 4. Verify

- [x] Dependabot opens PRs for vulnerable deps
- [x] CI blocks on high-severity npm audit findings
- [x] Gitleaks catches test secret in a dry run

## Files

| Action | Path |
|--------|------|
| Create | `.github/dependabot.yml` |
| Modify | `.github/workflows/ci.yml` |

## Risks / Side Effects

- Dependabot may create noisy PRs for non-critical updates — mitigate with grouping
- `npm audit` can produce false positives — use `--audit-level=high` to reduce noise
- Gitleaks may flag test fixtures with fake credentials — configure allowlist if needed

## Dependencies

- **Task 1 (ci-pipeline)** — CI workflow must exist before adding steps to it.
