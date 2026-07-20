# Audit: AI Integration & Process Automation (PR/CI loop, plans lifecycle, docs drift)

> **Status: SCOPED** — 2026-06-10
> **Branch:** `worktree-agent-a865321e57100f5fc` (audit batch, Unit 12)
> **Goal:** Add AI where it provides a quality gate a solo dev can't provide alone (PR review, CI-failure triage, docs-drift detection), automate the plans-lifecycle hygiene that today runs on pure discipline, and cut ceremony that adds no value (CODEOWNERS, heavyweight process gates).

## Context

### What exists today (verified 2026-06-10)

**Local AI tooling is mature; GitHub CI has zero AI.**

- `.claude/settings.json` — broad local permission allowlist, Playwright MCP, and three GSD hooks: `gsd-check-update.js` (SessionStart), `gsd-context-monitor.js` (PostToolUse, context-limit warnings), `gsd-prompt-guard.js` (PreToolUse, prompt-injection scan on `.planning/` writes), plus `gsd-statusline.js`. The GSD framework ships ~51 skills. This side needs nothing — it is the strongest part of the workflow.
- `.github/workflows/` — `ci.yml` (secret-scan → typecheck/lint/test/e2e), `deploy.yml` + `_deploy.yml` (path-filtered staging → E2E gate → prod), `e2e-qa-longhaul.yml` (nightly cron 07:00 UTC, self-skipping), `dependabot-auto-merge.yml`, `mobile-build.yml`, `publish-stdlib.yml`, `release-sdk-python.yml`, `temporal-worker.yml`, `publish-vpn-agent.yml`/`_publish-vpn-agent.yml`. **No AI job anywhere.** Grep for `claude` in workflows: zero hits.
- No `.github/PULL_REQUEST_TEMPLATE.md`, no `.github/CODEOWNERS`.

**Plans lifecycle runs on discipline alone.** `dolas/agents/team/workflow.md` mandates: plan in `plans/in-progress/` → archive to `plans/completed/<short-sha>-<slug>.md` after merge. Reality on disk:

| Dir                  | Count         | Status                                                                        |
| -------------------- | ------------- | ----------------------------------------------------------------------------- |
| `plans/todo/`        | 6             | fine                                                                          |
| `plans/in-progress/` | 0 (pre-audit) | fine — discipline has actually held                                           |
| `plans/completed/`   | ~50           | canonical archive; mixed `<sha>-` and `<timestamp>-` naming (both sanctioned) |
| `plans/done/`        | 5             | **legacy, pre-dates convention**                                              |
| `plans/archive/`     | 1             | **legacy**                                                                    |
| `plans/archived/`    | 18            | **legacy**                                                                    |

Three redundant legacy dirs mean "where do I look for the historical record?" has four answers. One-shot consolidation fixes this permanently; no recurring automation needed for the _dirs_ themselves.

**Docs drift is real and demonstrable.** `dolas/agents/project/DECISIONS.md` line 9 still says "`apps/web` (Tenant view) and `apps/admin` ... independent React 18 SPAs ... Tailwind CSS" — the apps are `apps/tenant-web`/`apps/admin-web` on React 19 with TanStack (per CLAUDE.md itself). `PATTERNS.md` last meaningfully touched 2026-04-27 despite six weeks of heavy feature work (workflows Phase 1–2, longhaul decommission, RingCentral capture). `GOTCHAS.md` (223 lines) still documents the security-overrides table "audited 2026-04-05" although the audit-ci allowlist was emptied 2026-05-28. The CLAUDE.md footer instructs agents to update these files, but nothing checks that they did.

### Honest value assessment per candidate

| Candidate                                                                    | Verdict                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. AI code review on PRs (`anthropics/claude-code-action@v1`)                | **DO — highest value item in this audit**                           | Solo dev = nobody else ever reads the diff. Every PR currently merges with zero human review. The action reads CLAUDE.md/dolas agent files, so it reviews against _this repo's_ documented rules (branded IDs, tenant-scoping, no `as any`). Cost is trivial next to one prod incident.                                                                                                                                                     |
| 2. CI-failure auto-triage                                                    | **DO (small)**                                                      | CI failures today mean manually opening the Actions UI, downloading logs, re-deriving known failure classes (GOTCHAS.md documents several). A `workflow_run`-triggered job that reads the failed log and comments probable cause + GOTCHAS match removes that toil. Low cost — runs only on failure.                                                                                                                                        |
| 3a. Plans hygiene check (stale in-progress, done-but-unarchived)             | **DO as plain script — no AI needed**                               | A weekly bash job covers this fully; using an LLM here would be cost without value.                                                                                                                                                                                                                                                                                                                                                         |
| 3b. Hard CI gate "code PR must move a plan file"                             | **CUT**                                                             | The in-progress dir was empty when audited — discipline is holding. A blocking gate punishes hotfixes and batch merges (memory: rapid main pushes already interact badly with the deploy queue). Advisory weekly report (3a) is enough.                                                                                                                                                                                                     |
| 3c. Legacy plans-dir consolidation                                           | **DO — one-shot, 20 min**                                           | Pure mechanical cleanup.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4a. PR template                                                              | **DO — 10 min**                                                     | Lightweight; gives the AI reviewer and future-you the plan link + verification evidence in a predictable place. Also gives the auto-review job structured context for free.                                                                                                                                                                                                                                                                 |
| 4b. CODEOWNERS                                                               | **CUT**                                                             | Solo repo: every path would map to the same one human. GitHub's review-assignment machinery has no one to assign. The only theoretical angle — using CODEOWNERS to require the Claude bot's review — isn't supported (apps can't be code owners). Do not create it.                                                                                                                                                                         |
| 5a. Weekly docs-drift audit                                                  | **DO**                                                              | Drift is demonstrated above. A weekly cron that diffs the week's commits against CLAUDE.md/DECISIONS/PATTERNS/GOTCHAS and opens a small docs PR turns "update the agent files" from an honor-system instruction into a reviewed artifact.                                                                                                                                                                                                   |
| 5b. Monthly AI dependency/upgrade scout                                      | **CUT**                                                             | Dependabot + `audit-ci` + the repo's own "migrate to one consistent version" policy already cover this. An AI scout would mostly restate Dependabot PRs. Revisit only if Dependabot noise becomes a problem.                                                                                                                                                                                                                                |
| 5c. Mechanism: GitHub Actions cron vs Claude Code `/schedule` cloud routines | **GitHub Actions cron — one mechanism for everything in this plan** | All five adopted items need repo write access, PR creation, and the run history/audit trail next to the code. Actions gives all of that with the same `ANTHROPIC_API_KEY` secret, versioned YAML, and `workflow_dispatch` for manual dry-runs. `/schedule` routines are better for personal/cross-repo chores (e.g. "check my PRs each morning") — keep them out of repo automation so there is exactly one place scheduled repo jobs live. |
| 6. Nightly e2e-qa failure auto-investigation                                 | **REFERENCE ONLY**                                                  | The generic plumbing is Phase 3's triage workflow — adding `E2E — QA longhaul` to its `workflow_run.workflows` list is a one-line opt-in. Telemetry/triage depth is owned by Units 4 and 9.                                                                                                                                                                                                                                                 |

### Setup facts (verified against current docs — no re-research needed)

- Action: `anthropics/claude-code-action@v1`. Auth for direct API: repo secret `ANTHROPIC_API_KEY` + the Claude GitHub App installed on the repo (`claude /install-github-app` from a local Claude Code session is the guided path; manual path: install https://github.com/apps/claude, add the secret, copy a workflow file).
- v1 auto-detects mode: `@claude` mention in issue/PR comments → interactive; explicit `prompt:` input → automation mode (runs immediately).
- CLI passthrough via `claude_args` (e.g. `--max-turns 10 --model claude-opus-4-8 --allowedTools ...`). v0 inputs `direct_prompt`/`mode`/`max_turns` are gone.
- The action respects CLAUDE.md and the files it links — our dolas agent files become the review rubric automatically.
- Models/pricing (per MTok, current): Opus 4.8 `claude-opus-4-8` $5/$25 · Sonnet 4.6 `claude-sonnet-4-6` $3/$15 · Haiku 4.5 `claude-haiku-4-5` $1/$5.

### Cost model (monthly, assuming ~25–40 PRs/month + a handful of CI failures)

| Job                                                              | Per-run estimate | Runs/mo | Monthly        |
| ---------------------------------------------------------------- | ---------------- | ------- | -------------- |
| Auto PR review (Opus 4.8, ~100–300K in / ~5K out, prompt-cached) | $0.30–1.50       | 25–40   | ~$15–45        |
| @claude on-demand mentions                                       | $0.20–1.00       | ~10     | ~$5            |
| CI-failure triage (Sonnet 4.6, log excerpt only)                 | $0.05–0.30       | ~10     | ~$2            |
| Weekly docs-drift audit (Opus 4.8, reads docs + week's diff)     | $0.50–2.00       | 4–5     | ~$5            |
| Plans hygiene (bash, no AI)                                      | $0               | 4       | $0             |
| **Total**                                                        |                  |         | **~$25–60/mo** |

Guardrails baked into every YAML below: `--max-turns` cap, `timeout-minutes`, `concurrency` with cancel-in-progress, skip-conditions (drafts, dependabot, `skip-ai-review` label), and review-only permissions (`contents: read`) on the PR-review job so the reviewer can never push. Set a monthly spend alert in the Anthropic Console (Settings → Limits) as the backstop.

---

## Plan

### Phase 0 — One-time setup (manual, ~15 min)

- [ ] Install the Claude GitHub App on the `pegasus` repo: run `claude /install-github-app` locally (or install https://github.com/apps/claude manually with Contents/Issues/Pull requests read-write, repo-scoped).
- [ ] Create a dedicated API key in the Anthropic Console (name it `pegasus-github-ci`) and add it as repo secret `ANTHROPIC_API_KEY`. Set a monthly spend limit/alert (~$75 ceiling) in Console → Settings → Limits.

### Phase 1 — Quick wins (no AI, ~1 hour total)

- [ ] **Consolidate legacy plans dirs into `plans/completed/`** (effort: 20 min). One-shot script — prefix each legacy file with the short sha of its last touching commit to match the archive convention, then remove the empty dirs:

  ```bash
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  for dir in plans/done plans/archive plans/archived; do
    for f in "$dir"/*.md; do
      [ -e "$f" ] || continue
      sha=$(git log -1 --format=%h -- "$f")
      base=$(basename "$f")
      git mv "$f" "plans/completed/${sha}-${base}"
    done
    rmdir "$dir"
  done
  git commit -m "chore(plans): consolidate legacy done/archive/archived dirs into plans/completed"
  ```

  Collision check first: `for d in done archive archived; do for f in plans/$d/*.md; do ls plans/completed/*-$(basename $f) 2>/dev/null; done; done` (expect empty). Then update `dolas/agents/team/workflow.md` § "Archiving Completed Plans" with one sentence: _"`plans/completed/` is the only archive directory; `done/`, `archive/`, `archived/` were consolidated into it 2026-06."_

- [ ] **Add `.github/PULL_REQUEST_TEMPLATE.md`** (effort: 10 min). Mirrors the plan-file convention; intentionally short — three sections, no checklists-for-checklists'-sake:

  ```markdown
  ## What & why

  <!-- One or two sentences. Link the plan file if one exists: plans/in-progress/<slug>.md -->

  ## Verification

  <!-- Which test layers ran (npm test / e2e / staging gate)? Paste the relevant evidence or "n/a: docs-only". -->

  ## Deploy impact

  <!-- Components this touches per deploy.yml path filters (api / tenant-web / admin-web / infra→all / none). -->
  ```

- [ ] **Do NOT create CODEOWNERS** — documented as cut (see Context). Re-evaluate only if a second human joins.

### Phase 2 — AI code review on PRs (highest value; effort: ~1 hour + tuning over first week)

- [ ] **Add `.github/workflows/claude.yml`** — interactive `@claude` responder (mentions in PR/issue comments and review comments). This is the general-purpose assistant: ask it to explain a diff, fix a review finding, or investigate an issue.

  ```yaml
  name: Claude
  on:
    issue_comment:
      types: [created]
    pull_request_review_comment:
      types: [created]
    issues:
      types: [opened]
  permissions:
    contents: write # may push fix commits to the PR branch when asked
    pull-requests: write
    issues: write
    id-token: write
    actions: read # lets it inspect CI runs when asked "why did CI fail?"
  jobs:
    claude:
      if: contains(github.event.comment.body || github.event.issue.body, '@claude')
      runs-on: ubuntu-latest
      timeout-minutes: 20
      steps:
        - uses: actions/checkout@v6
          with:
            fetch-depth: 0
        - uses: anthropics/claude-code-action@v1
          with:
            anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
            claude_args: '--model claude-opus-4-8 --max-turns 25'
  ```

- [ ] **Add `.github/workflows/claude-review.yml`** — automatic review of every non-draft PR. Review-only: `contents: read`, so it physically cannot push. Single sticky comment per PR (re-runs update it rather than stacking).

  ```yaml
  name: Claude Review
  on:
    pull_request:
      types: [opened, ready_for_review, synchronize]
  permissions:
    contents: read
    pull-requests: write
    issues: read
    id-token: write
  concurrency:
    group: claude-review-${{ github.event.pull_request.number }}
    cancel-in-progress: true
  jobs:
    review:
      if: >
        !github.event.pull_request.draft &&
        github.actor != 'dependabot[bot]' &&
        !contains(github.event.pull_request.labels.*.name, 'skip-ai-review')
      runs-on: ubuntu-latest
      timeout-minutes: 15
      steps:
        - uses: actions/checkout@v6
          with:
            fetch-depth: 0
        - uses: anthropics/claude-code-action@v1
          with:
            anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
            prompt: |
              Review PR #${{ github.event.pull_request.number }} in ${{ github.repository }}.
              Review the diff against this repo's standards (CLAUDE.md and the dolas/agents
              files it links — branded IDs, tenant scoping on every Prisma query, no `as any`
              or ts-ignore, structured logging, TDD test-before-impl, non-breaking migrations).
              Report every issue you find, including ones you are uncertain about or consider
              low-severity; include a confidence and severity tag per finding so the human can
              filter. Pay extra attention to: missing tenantId filters, secrets, error paths
              that leak internals, and Lambda/VPC/bundling gotchas documented in
              dolas/agents/project/GOTCHAS.md.
              Post the review as ONE comment using `gh pr comment` (update your previous
              comment if one exists via `gh pr comment --edit-last`). Do not push commits.
              End with a verdict line: APPROVE / COMMENTS / REQUEST_CHANGES.
            claude_args: '--model claude-opus-4-8 --max-turns 15'
  ```

  Notes: dependabot PRs are excluded because `dependabot-auto-merge.yml` already handles them and a review comment would block nothing. The "report everything + confidence tags" phrasing is deliberate — current Opus models follow "only report high-severity" filters literally and suppress real findings; filter as the human instead. Model dial: switch `--model claude-sonnet-4-6` if monthly cost matters more than recall (~40% cheaper).

- [ ] **Tune for one week** (effort: passive). If the review is too chatty on mechanical PRs (plans archives, version bumps), add `paths-ignore: ['plans/**', '*.md']` to the `pull_request` trigger rather than weakening the prompt.

### Phase 3 — CI-failure auto-triage (effort: ~45 min)

- [ ] **Add `.github/workflows/ci-triage.yml`** — fires only when CI or Deploy fails on `main` or a PR branch; pulls the failing job log, matches against known failure classes (GOTCHAS.md documents several), and comments on the commit (and the PR if one exists) with probable cause + suggested fix. Costs nothing when CI is green.

  ```yaml
  name: CI Failure Triage
  on:
    workflow_run:
      workflows: ['CI', 'Deploy'] # opt-in later: "E2E — QA longhaul" (see Phase 5 note)
      types: [completed]
  permissions:
    contents: read
    actions: read
    pull-requests: write
    issues: write
    id-token: write
  jobs:
    triage:
      if: github.event.workflow_run.conclusion == 'failure'
      runs-on: ubuntu-latest
      timeout-minutes: 10
      concurrency:
        group: ci-triage-${{ github.event.workflow_run.head_branch }}
        cancel-in-progress: true
      steps:
        - uses: actions/checkout@v6
        - uses: anthropics/claude-code-action@v1
          with:
            anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
            prompt: |
              Workflow "${{ github.event.workflow_run.name }}" run
              ${{ github.event.workflow_run.id }} failed on branch
              ${{ github.event.workflow_run.head_branch }}
              (sha ${{ github.event.workflow_run.head_sha }}).
              1. Fetch the failing logs: `gh run view ${{ github.event.workflow_run.id }} --log-failed`.
              2. Identify the first real error (not cascade noise). Check whether it matches a
                 known failure class in dolas/agents/project/GOTCHAS.md or CLAUDE.md's CI/CD
                 section before proposing anything novel.
              3. Comment your triage on the commit:
                 `gh api repos/${{ github.repository }}/commits/${{ github.event.workflow_run.head_sha }}/comments -f body=...`
                 — include: failing job+step, the key log lines (trimmed), probable cause,
                 one concrete suggested fix, and whether a simple re-run is likely to help
                 (flake vs deterministic). If a PR exists for the branch
                 (`gh pr list --head <branch>`), post the same comment there instead.
              Keep it under 30 lines. Do not modify any code.
            claude_args: '--model claude-sonnet-4-6 --max-turns 12'
  ```

  Sonnet is sufficient here — log classification, not deep reasoning. This also covers the repo rule "fix the pipeline first": the triage comment lands while context is fresh, and a deploy-run failure on `main` gets surfaced without watching the Actions tab. (Pairs with the existing memory gotcha about canceled Deploy runs after rapid pushes — the triage fires on `failure`, not `cancelled`; if cancelled-run detection is wanted later, add `types: [completed]` filtering on `conclusion == 'cancelled'` in a follow-up.)

### Phase 4 — Plans-lifecycle hygiene (no AI; effort: ~30 min)

- [ ] **Add `scripts/plans-hygiene.sh`** — pure bash, reports (a) stale `plans/in-progress/` entries older than 14 days, (b) in-progress plans whose checklists are fully `[x]` (done-but-unarchived):

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  cd "$(git rev-parse --show-toplevel)"
  issues=""
  for f in plans/in-progress/*.md; do
    [ -e "$f" ] || continue
    last=$(git log -1 --format=%ct -- "$f"); now=$(date +%s)
    age_days=$(( (now - last) / 86400 ))
    [ "$age_days" -gt 14 ] && issues+="- STALE (${age_days}d): \`$f\`\n"
    open=$(grep -c '^\s*- \[ \]' "$f" || true)
    done_=$(grep -c '^\s*- \[x\]' "$f" || true)
    if [ "$open" -eq 0 ] && [ "$done_" -gt 0 ]; then
      issues+="- DONE-BUT-UNARCHIVED: \`$f\` (all ${done_} items checked — move to plans/completed/)\n"
    fi
  done
  if [ -n "$issues" ]; then printf "Plans hygiene findings:\n${issues}"; exit 1; else echo "Plans hygiene: clean"; fi
  ```

- [ ] **Add `.github/workflows/plans-hygiene.yml`** — weekly cron (Mon 08:00 UTC) + `workflow_dispatch`; on findings, creates/updates a single pinned issue titled `Plans hygiene report` (`gh issue list --search 'Plans hygiene report in:title' …` then `gh issue create`/`gh issue comment`). Non-blocking by design — it nags, it never gates. (~15 lines of YAML around the script; `permissions: contents: read, issues: write`.)
- [ ] **Explicitly skipped:** a per-PR "code change must move a plan file" gate — see Context 3b. If discipline ever visibly decays (hygiene issue stays open >1 month), revisit as a _warning_ comment on PRs, still never a required check.

### Phase 5 — Weekly docs-drift audit (effort: ~45 min)

- [ ] **Add `.github/workflows/docs-drift.yml`** — Sunday-night cron + `workflow_dispatch`; compares the week's merged changes against the agent docs and opens one small PR with proposed updates (which then gets reviewed by Phase 2's auto-reviewer — the loop closes itself):

  ```yaml
  name: Docs Drift Audit
  on:
    schedule:
      - cron: '0 6 * * 0' # Sundays 06:00 UTC
    workflow_dispatch:
  permissions:
    contents: write
    pull-requests: write
    id-token: write
  jobs:
    audit:
      runs-on: ubuntu-latest
      timeout-minutes: 25
      steps:
        - uses: actions/checkout@v6
          with:
            fetch-depth: 0
        - uses: anthropics/claude-code-action@v1
          with:
            anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
            prompt: |
              You are auditing documentation drift in this repo.
              1. List the last 7 days of commits: `git log --since="7 days ago" --oneline --stat main`.
              2. Read CLAUDE.md, dolas/agents/project/DECISIONS.md, PATTERNS.md, GOTCHAS.md,
                 and dolas/agents/project/context.md.
              3. Find concrete drift only: renamed/removed packages or apps, stale entity or
                 command references, decisions contradicted by merged code, resolved gotchas
                 still documented as live, new gotchas/decisions visible in commit messages
                 but absent from the docs. Known seed examples: DECISIONS.md still references
                 apps/web + apps/admin and "React 18"; GOTCHAS.md overrides table predates the
                 2026-05-28 allowlist cleanup.
              4. If you find drift: create branch `docs-drift/$(date +%Y-%m-%d)`, make the
                 minimal edits (never delete a decision — mark it superseded with a date),
                 push, and open a PR titled "docs: weekly drift audit" with a per-edit
                 rationale, labeled `docs-drift`. Keep the diff under ~100 lines; if more is
                 needed, fix the worst and list the rest in the PR body.
              5. If there is no drift, exit without creating anything.
              Never push to main. Never edit files under plans/completed/.
            claude_args: '--model claude-opus-4-8 --max-turns 30'
  ```

- [ ] **Mechanism decision (recorded):** GitHub Actions cron is the single scheduler for all repo automation in this plan; Claude Code `/schedule` cloud routines are reserved for personal cross-repo chores and intentionally not used here. One mechanism, one audit trail.
- [ ] **Reference (not designed here):** nightly `E2E — QA longhaul` failure investigation = add `"E2E — QA longhaul"` to `ci-triage.yml`'s `workflow_run.workflows` list once Units 4/9 land their telemetry; the suite self-skips when the tunnel is down, so gate the triage on `conclusion == 'failure'` only (skips report success).

---

## Files to Modify / Create

| Action                   | Path                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| Create                   | `.github/PULL_REQUEST_TEMPLATE.md`                                                        |
| Create                   | `.github/workflows/claude.yml`                                                            |
| Create                   | `.github/workflows/claude-review.yml`                                                     |
| Create                   | `.github/workflows/ci-triage.yml`                                                         |
| Create                   | `.github/workflows/plans-hygiene.yml`                                                     |
| Create                   | `.github/workflows/docs-drift.yml`                                                        |
| Create                   | `scripts/plans-hygiene.sh`                                                                |
| Modify                   | `dolas/agents/team/workflow.md` (one sentence: completed/ is the only archive dir)        |
| Move                     | `plans/done/*`, `plans/archive/*`, `plans/archived/*` → `plans/completed/<sha>-<name>.md` |
| Secret                   | Repo secret `ANTHROPIC_API_KEY` (Console key `pegasus-github-ci`, spend-capped)           |
| Not created (deliberate) | `.github/CODEOWNERS`                                                                      |

## Side Effects & Risks

- **API cost runaway** — a pathological loop or huge-diff PR could burn tokens. Mitigations: `--max-turns` on every job, `timeout-minutes` on every job, `concurrency: cancel-in-progress` on review/triage, Console monthly spend limit + alert, `skip-ai-review` label as the per-PR kill switch, and disabling any single workflow is one click in the Actions tab.
- **AI-review noise fatigue** — the real failure mode of candidate 1: if the reviewer nitpicks every plans-archive commit, it gets ignored and the quality gate dies. Mitigations: confidence/severity tags so findings are filterable, `paths-ignore` escape hatch for mechanical PRs, sticky single comment instead of comment stacking, and a deliberate one-week tuning pass.
- **Secrets in CI** — `ANTHROPIC_API_KEY` joins existing repo secrets. It is a spend credential, not an infra credential: dedicated key, spend-capped, rotatable in seconds. The review job runs with `contents: read` so a prompt-injected PR (malicious diff content instructing the reviewer) cannot push code; the worst case is a misleading comment. The interactive `claude.yml` job _does_ have `contents: write` — it only triggers on @claude mentions authored in this repo, and the Claude app only honors mentions from users with write access; still, treat its pushed commits like any contributor's: they go through PR review and branch CI, never direct to main (deploy.yml only fires on main).
- **Triage on `workflow_run` runs with main-branch workflow definitions** — safe by construction (it never checks out PR code with write perms), but remember edits to `ci-triage.yml` only take effect once merged to main.
- **Docs-drift PRs could subtly rewrite decisions** — constrained to "mark superseded, never delete", ≤100-line diffs, and every drift PR is human-merged after passing the Phase 2 auto-review. Worst case is a wrong suggestion you decline.
- **Plans consolidation rewrites paths referenced elsewhere** — a few docs/memory entries reference `plans/archived/...` paths. Acceptable: git history preserves the moves (`git log --follow`), and the hygiene report covers the future. Optionally grep `rg 'plans/(done|archive|archived)/' --type md` post-move and fix stragglers in the same commit.
- **Deploy concurrency interaction** — the consolidation commit is plans-only and will trigger a Deploy run that no-ops on path filters; per existing memory gotcha, land plans-only commits _before_ (not after) a batch of code merges to avoid canceling a needed deploy.

## Acceptance Criteria / Verification

Observable outcomes, in rollout order:

1. **Plans consolidation:** `ls plans/` shows exactly `todo in-progress completed`; `ls plans/completed | wc -l` increased by 24; every migrated file matches `^[0-9a-f]{7,}-.*\.md$`; `git log --follow plans/completed/<sha>-dolas-modules-migration.md` shows the original history.
2. **PR template:** opening a new PR in the GitHub UI pre-fills the three sections.
3. **@claude mention:** comment `@claude what does this PR change?` on a test PR → a Claude response comment appears within ~5 minutes and the `Claude` workflow run shows in Actions.
4. **Auto-review:** open a test PR that adds an unscoped Prisma query (no `tenantId` filter) under `apps/api/` → within ~5 minutes a single review comment appears, flags the missing tenant scoping with a severity tag, and ends with a verdict line. Push a fixup commit → the same comment updates (no second comment). Add label `skip-ai-review` to another PR → no review run.
5. **CI triage:** push a branch with a deliberately failing unit test → after CI fails, a commit/PR comment appears identifying the failing test and classifying it as deterministic. No triage runs appear for green CI.
6. **Plans hygiene:** `bash scripts/plans-hygiene.sh` exits 0 on a clean tree; create a dummy fully-checked plan in `plans/in-progress/` → script exits 1 naming it; `workflow_dispatch` of the workflow creates/updates the `Plans hygiene report` issue.
7. **Docs drift:** `workflow_dispatch` of `docs-drift.yml` on the current tree → a PR appears fixing at least the known seeds (DECISIONS.md apps/web + React 18 references), diff ≤100 lines, with per-edit rationale; merging it requires the human click. A second dispatch immediately after merge produces no PR.
8. **Cost:** after the first full week, Anthropic Console usage for the `pegasus-github-ci` key is within the ~$25–60/mo run-rate; if not, drop the review model to `claude-sonnet-4-6` and re-measure.
