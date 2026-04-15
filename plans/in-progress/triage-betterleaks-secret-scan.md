# Plan: Triage 21 Betterleaks secret-scanning findings

**Branch:** TBD (create from main)
**Goal:** Unblock the `Secret Scanning (Betterleaks)` CI job, which currently reports 21 leaks across 304 scanned commits and fails on every PR (including `main`).

## Problem

The `Secret Scanning (Betterleaks)` workflow runs `betterleaks git .` and currently reports:

```
304 commits scanned.
leaks found: 21
```

It has been failing on `main` for multiple builds. Because it scans full history, the findings are almost certainly a mix of:

- Historical commits that contained real secrets (now rotated, but still in git history)
- False positives (test fixtures, placeholder JWTs, example Cognito IDs, fake API keys, generated migration SQL)
- Example values in `.env.example` files

Until triaged, the job blocks every PR's "required checks".

## Checklist

### Step 1 — Enumerate findings

- [ ] Run `betterleaks git .` locally (install via `npm i -g betterleaks` or equivalent) and capture the full JSON/text report.
- [ ] Produce a table: `commit` | `file` | `rule` | `verdict (real / false-positive / rotated)`.

### Step 2 — Classify

For each finding:

- [ ] **Real + unrotated** — rotate the credential immediately, then proceed.
- [ ] **Real + already rotated** — add to an allowlist with a comment explaining when it was rotated.
- [ ] **False positive** (fixture, example, placeholder) — add to `.betterleaks.toml` (or the tool's allowlist format) with a path-scoped or hash-scoped exclusion and a comment.

### Step 3 — Configure allowlist

- [ ] Create or update `.betterleaks.toml` at repo root (check tool docs for exact filename).
- [ ] Allowlist entries must be as narrow as possible: prefer commit-hash or file-path scoping over broad regex suppression.
- [ ] Never blanket-allow a whole directory or file extension.

### Step 4 — Verify

- [ ] `betterleaks git .` — exit 0 locally.
- [ ] Push a test branch — `Secret Scanning (Betterleaks)` CI job green.

### Step 5 — Document

- [ ] Add a short runbook to `dolas/agents/project/GOTCHAS.md` explaining:
  - Where the allowlist lives
  - How to add new entries when a false positive appears
  - The rotation protocol if a real secret is found

## Out of scope

- Switching secret scanners (e.g. gitleaks → trufflehog).
- BFG / git-filter-repo history rewrites to purge real secrets. Rotation is sufficient; history rewrites break everyone's clones and require full team coordination — a separate, explicit plan.

## Verification

`Secret Scanning (Betterleaks)` CI job green on both the follow-up PR and `main`.
