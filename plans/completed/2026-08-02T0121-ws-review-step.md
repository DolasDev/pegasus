# Pre-PR review step in `/workstream-finish` (local, subscription-covered)

> **Status: COMPLETE** — 2026-08-02. Branch `chore/ws-review-step`.
>
> **Deviation — the dogfood (criterion 4) caught a real defect in the step
> itself.** The plan assumed the step could invoke `/code-review` via the
> `Skill` tool. It cannot: `/code-review` is marked `disable-model-invocation`
> and the tool refuses it outright, so the step as first written would have
> **silently done nothing** on every PR — a review gate that never runs is worse
> than none, because it reads as covered. Fixed in the same PR: the step now
> reviews the branch diff directly against the repo's documented rules and
> _asks_ the developer to run `/code-review` when a diff warrants the heavier or
> independent pass. `/security-review` was empirically confirmed to be
> model-invocable, so the sensitive-path branch works as designed. This is
> exactly the class of defect the step exists to catch, caught by the step, on
> the step.
> Decision context: `plans/in-progress/audit-ai-process-automation.md` is
> user-deferred, and the deferral is _cost_-driven (~$25-60/mo of
> `ANTHROPIC_API_KEY` spend across five AI jobs). This closes the
> highest-value item of that plan — AI review of every diff — at ~$0 by moving
> it from GitHub Actions to the local session, where it runs on the Claude Code
> subscription.

## Context

**The gap this closes.** Solo repo: every PR merges with zero human review.
`audit-ai-process-automation.md` ranks AI PR review as "the highest value item
in this audit" for exactly that reason, and it is the one thing the merge queue
cannot provide — required checks are deterministic; nothing reads the diff for
intent.

**Why not the pre-push hook.** `.husky/pre-push` runs
`turbo run typecheck test --affected` against `origin/main`, and
`audit-00-master-plan.md` acceptance criterion 1 targets **<30 s** for it (from
a 2-5 min baseline — Unit 1 was the highest-ranked item in the whole audit).
Putting a multi-minute LLM review in that hook re-spends exactly what Unit 1
bought, on every push including WIP pushes, and `--no-verify` bypasses it
anyway.

**Why `/workstream-finish` instead.** It is already the single chokepoint every
stream passes through immediately before `gh pr create` — the last moment the
diff is still cheap to change, and it runs once per PR rather than once per
push. `/code-review` and `/security-review` already exist as skills; the only
thing missing is that nothing _invokes_ them, so it runs on discipline alone
(the same failure mode `plans/in-progress` hygiene had — see
`project_plans_in_progress_hygiene`).

**Verified 2026-08-02 (auth, for the record):** the official
`anthropics/claude-code-action` does expose a `claude_code_oauth_token` input
("alternative to anthropic*api_key") in its `action.yml`, so the CI-side
reviewer \_could* also run on the subscription via `claude setup-token`. **User
decision 2026-08-02: hold that; keep it local for now.** Recorded here so the
next session doesn't re-research it. The honest trade being accepted: a review
running in the same session that wrote the code is a **self**-review and
catches less than an independent one — the CI-side reviewer is the upgrade path
when/if the local one proves its worth.

## Plan

- [x] **1. Add the review step to `.claude/commands/workstream-finish.md`**
      New step between "Finalize the commit" and "Land it through the queue",
      so the reviewer sees exactly the tree that will be pushed and any fixes
      land as their own commit on the branch (clean history, and the PR opens
      already-reviewed rather than review-then-amend). - Always run `/code-review` on the branch diff vs `origin/main`. - Run `/security-review` **only** when the diff touches security-sensitive
      paths, decided by a deterministic `git diff --name-only` check (no
      quota spent deciding): `apps/api/src/authz/**`, `**/middleware/**`,
      `apps/api/prisma/migrations/**`, `packages/infra/**`,
      `.github/workflows/**`, `apps/tenant-runner/**`, `**/*.cedar`. - **Skip conditions** (no value, don't spend quota): docs/plans-only diff
      (reuse the repo's own paths-filter definition — everything under
      `plans/`, `dolas/`, or `*.md`), a pure revert, or an explicit user skip.
      A skip is _recorded in the PR body_, never silent. - **Disposition rule:** every finding is either fixed on the branch or
      written down with a one-line reason under a `## Review` section in the
      PR body. Advisory, not a hard gate — the developer may ship over a
      finding, but never silently. This is deliberate: a blocking gate on a
      solo repo just trains `--no-verify`. - State the self-review limitation in that PR-body section so a reader
      does not mistake it for independent review.

- [x] **2. Frontmatter `allowed-tools`** — add `Skill` (to invoke
      `/code-review` + `/security-review`) and `Edit` (to apply fixes). Without
      `Skill` the step cannot run at all; without `Edit` it stalls on the first
      finding.

- [x] **3. Renumber the following steps** (Land → 5, Teardown → 6, Archive
      safety net → 7) and fix the internal cross-references, which name step
      numbers in three places.

- [x] **4. `dolas/agents/team/workflow.md` § "Landing work — canonical path"**
      Add the review as step 1 (before `gh pr create`), so the governing doc
      and the command agree. CLAUDE.md points at this section, so it is the
      canonical statement.

## Files to Modify

| Action | File                                    |
| ------ | --------------------------------------- |
| Modify | `.claude/commands/workstream-finish.md` |
| Modify | `dolas/agents/team/workflow.md`         |

## Side Effects & Risks

- **Quota, not dollars.** The review draws on the Claude Code subscription —
  the same pool as interactive work — so a heavy PR day can throttle the
  session that is doing the actual work. That is the trade being made vs
  ~$25-60/mo of API spend. If throttling bites, the escape is the CI-side
  reviewer (held).
- **Adds minutes to `/workstream-finish`.** Once per PR, not per push, and it
  is time the developer was going to spend on rework later. Docs-only PRs skip
  it entirely.
- **Self-review is weaker than independent review** — noted in the command and
  surfaced in every PR body so it is never overstated.
- **Instruction-only change.** No code, no CI, nothing deployable — the risk of
  the change itself is that the step gets ignored, which is the status quo.

## Acceptance Criteria / Verification

1. `.claude/commands/workstream-finish.md` has the review step between commit
   and push, with skip conditions, the sensitive-path trigger list, and the
   disposition rule; `allowed-tools` includes `Skill` and `Edit`.
2. Step numbering is contiguous and every internal "step N" reference points at
   the right step after renumbering (`grep -n "step [0-9]"`).
3. `dolas/agents/team/workflow.md` § "Landing work — canonical path" lists the
   review before `gh pr create`.
4. **Dogfood:** this very PR is put through the new step — `/code-review` runs
   on its diff before `gh pr create`, and the PR body carries the `## Review`
   section the step mandates (a docs-only diff would normally skip, so the
   dogfood is an explicit override; say so in the section).
5. `prettier --check` passes on both files (lint-staged rewrites markdown).
