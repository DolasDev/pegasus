# Set the `DEPENDABOT_AUTOMERGE_PAT` repository secret

> Split out of `plans/completed/security-backlog-and-sort-hardening.md` on 2026-09-29, which
> closed every engineering item in that plan. This is the one thing engineering cannot do:
> it needs the repo owner's credentials.

**No code change is required.** The workflow already reads
`secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`, so the secret existing is the
whole fix.

## Why it matters

#633 fixed Dependabot auto-merge — an auto-merge request enabled while a PR is still red is
never re-evaluated under a merge queue. The `enqueue` job now works and PRs reach the queue on
their own.

But a **bot-initiated** enqueue does not trigger `merge_group` checks: actions taken with
`GITHUB_TOKEN` do not trigger workflows (GitHub community discussion #70310). Reproduced four
times — #645, then #656 / #387 / #657. Each self-queued, sat in `AWAITING_CHECKS` with zero
`merge_group` runs, and started CI instantly once dequeued and re-enqueued under a human token.

## Until it exists

Every Dependabot PR needs a manual nudge:

```
gh api graphql -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{position}}}' -F id="$(gh pr view <N> --json id -q .id)"
gh pr merge <N> --auto
```
