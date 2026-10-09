# Give the `enqueue` job a non-`GITHUB_TOKEN` identity (GitHub App — owner setup)

> Split out of `plans/completed/security-backlog-and-sort-hardening.md` on 2026-09-29, which
> closed every engineering item in that plan. This is the one thing engineering cannot do:
> it needs the repo owner's credentials.
>
> **Re-scoped 2026-10-09 from a PAT to a GitHub App, and the wiring is MERGED (#826).** The
> filename is kept because the workflow's own warning message points at this path. The PAT recipe
> is retained at the bottom — it is still the fallback link in the chain, not dead text.

**The code is done.** What remains is **owner-only**: create the App, install it, and set one
variable + one secret. Until then the `enqueue` job falls back to `GITHUB_TOKEN` and **says so with
a warning on every run** (that annotation is new in #826 — the fallback used to be silent).

## Why it matters

#633 fixed Dependabot auto-merge — an auto-merge request enabled while a PR is still red is never
re-evaluated under a merge queue. The `enqueue` job now works and PRs reach the queue on their own.

But **actions taken with `GITHUB_TOKEN` do not trigger workflows**, so a `GITHUB_TOKEN`-initiated
enqueue produces a queue entry and **no `merge_group` run**. The entry then holds the head of an
`ALLGREEN` queue until it is dropped at `check_response_timeout_minutes: 60`, blocking every other
stream for no benefit.

**Eight reproductions:** #645, #656, #387, #657, #709, #710, **#762**, **#799**. The two measured:

| PR   | bot-enqueued, no run for | after dequeue + human-token re-enqueue |
| ---- | ------------------------ | -------------------------------------- |
| #762 | 18 min                   | **~28 s**                              |
| #799 | 21 min                   | **~5 s**                               |

#799 is the cleanest evidence: `pr-798`'s group run had succeeded minutes earlier and Actions was
`operational`, so neither the queue nor an outage explains it.

A **GitHub App installation token is not `GITHUB_TOKEN`** and does trigger workflows. That is the
whole mechanism.

## Why an App rather than a PAT

Both fix the trigger. The App is better for an org-owned repo on three counts:

- **No expiry to manage.** A fine-grained PAT expires (max 366 days), and when it does the `||`
  chain silently reverts to `GITHUB_TOKEN` and the stall returns. Installation tokens are minted
  per-run and last an hour; the App itself does not expire.
- **Not tied to a person.** The PAT would act as the owner's account, and would die with their
  access. The App acts as `<app-slug>[bot]`.
- **Scoped twice.** The App is installed on one repository, and #826 additionally passes
  `permission-contents: write` / `permission-pull-requests: write` to the mint step, which scopes the
  minted token **below** the App's own grant — so this job cannot use a permission the App is later
  given.

Cost: it needed a code change, which a PAT did not. That change is merged, so the cost is paid.

## Owner setup (the only remaining work)

**1. Create the App — under the ORG, not your personal account.**
`https://github.com/organizations/DolasDev/settings/apps` → **New GitHub App**

- **Name:** `pegasus-merge-queue` (appears in logs as `pegasus-merge-queue[bot]`)
- **Homepage URL:** anything — `https://github.com/DolasDev/pegasus` is fine
- **Webhook:** **uncheck "Active"**. No webhook URL is needed; leaving it checked forces you to
  supply one.
- **Repository permissions:** **Contents → Read and write**, **Pull requests → Read and write**.
  Metadata → Read is added automatically. Nothing else — the mint step requests exactly these two
  and the App must grant at least them or the mint fails loudly.
- **Where can this GitHub App be installed:** **Only on this account**

**2. Generate a private key.** On the App's settings page → **Private keys** → _Generate a private
key_. A `.pem` downloads. Treat it as a credential.

**3. Install it.** App settings → **Install App** → `DolasDev` → **Only select repositories** →
`pegasus`.

**4. Set the variable and the secret.** Both live in **Actions**, not the Dependabot store — the
`enqueue` job is triggered by `workflow_run` / `workflow_dispatch`, neither of which is a Dependabot
event, so it reads Actions secrets. (A secret filed under _Dependabot_ would be invisible here and
the `||` chain would fall through with no error.)

```
gh variable set DEPENDABOT_AUTOMERGE_APP_CLIENT_ID --repo DolasDev/pegasus --body '<Client ID>'
gh secret   set DEPENDABOT_AUTOMERGE_APP_PRIVATE_KEY --repo DolasDev/pegasus < /path/to/key.pem
```

> ⚠️ **Client ID, not App ID.** The App settings page shows both, adjacent, and `app-id` is
> **deprecated** in `create-github-app-token@v3`. The deprecated one is the one that reads as
> obvious, which is why the variable is named for the Client ID.

> ⚠️ **Pipe the `.pem`, don't paste it.** `gh secret set ... < key.pem` preserves the header,
> footer and newlines verbatim. Pasting into the web form mangles them often enough to be worth
> avoiding.

**5. Delete the local `.pem`** once the secret is set. It is recoverable by generating a new key.

## Verifying it — two stages

**Stage 1, immediately, non-destructive.** The `workflow_dispatch` lever runs `enqueue` against any
PR number, and the author guard stops it before it touches auto-merge. Point it at an open
non-Dependabot PR:

```
gh workflow run "Dependabot Auto-Merge" -f pr=145
gh run list --workflow="Dependabot Auto-Merge" --limit 1
gh run view <id> --log
```

Read the identity line that #826 added — it is the first thing the step prints:

| what you see                                                            | meaning                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `Acting as pegasus-merge-queue[bot] (GitHub App …)`                     | ✅ configured correctly                                                                                         |
| **the `Mint a GitHub App token` step is RED**                           | var set, mint failed — bad/rotated key, App uninstalled, or permission not granted. Read that step's own error. |
| the Mint step shows **skipped** + `::warning::Acting as GITHUB_TOKEN …` | nothing configured yet — the pre-#826 status quo                                                                |

> A configured-but-broken App **fails the job** rather than falling back, on purpose: a
> `GITHUB_TOKEN` enqueue would put a PR at the head of the queue that never gets built, blocking
> every other stream for the full 60-minute timeout. Not enqueuing at all is strictly better, and a
> red run is the signal. The graceful fallback exists only for the never-configured case.

Then `PR #145 author is 'steve-dolo', not Dependabot — refusing.` and exit 0. It never reaches
`--disable-auto`/`--auto`, so this is safe to run repeatedly.

**Stage 2, the real proof — next Dependabot batch.** `.github/dependabot.yml` is `interval: weekly`
with no `day`, so Dependabot defaults to **Monday**; the next window is **2026-10-12**. When one of
its minor/patch PRs goes green and `enqueue` fires, a `merge_group` run should appear within ~a
minute:

```
gh run list --limit 40 --json createdAt,event,status,conclusion,headBranch \
  -q '.[]|select(.event=="merge_group")|"\(.createdAt) \(.status)/\(.conclusion) \(.headBranch)"'
```

Look for `gh-readonly-queue/main/pr-<N>-*`. Client-side filter deliberately —
`gh run list --event merge_group` returns stale data in this repo. You are looking for **~20 s**
instead of 18–21 minutes.

**The one unverified link, stated plainly.** Stage 1 proves the App token is minted and can _read_
PR metadata. It does **not** prove that `enablePullRequestAutoMerge` /
`disablePullRequestAutoMerge` behave identically under an **installation** token as under a PAT —
installation tokens and PATs are not identical in what GraphQL exposes, and this could not be
tested without a live Dependabot PR. Stage 2 covers it: if a `merge_group` run appears, both the
trigger behaviour and the mutations worked. If stage 1 is green and stage 2 is not, suspect the
mutation, not the token.

## Until it exists

Every Dependabot PR needs a manual nudge:

```
gh api graphql -f query='mutation($id:ID!){dequeuePullRequest(input:{id:$id}){mergeQueueEntry{position}}}' -F id="$(gh pr view <N> --json id -q .id)"
gh pr merge <N> --auto
```

## Fallback: the PAT route (still wired, deliberately)

`enqueue` resolves its token as
`steps.app-token.outputs.token || secrets.DEPENDABOT_AUTOMERGE_PAT || secrets.GITHUB_TOKEN`. The
middle link is **not** a migration leftover — it is the escape hatch if the App is ever uninstalled
or its key rotated badly. To use it, set an **Actions** repository secret
`DEPENDABOT_AUTOMERGE_PAT` with a fine-grained PAT scoped to `DolasDev/pegasus` only, granting
**Contents: Read and write** and **Pull requests: Read and write** (the same two the workflow
declares in its own `permissions:` block). If fine-grained PATs are restricted at the org level
(Org Settings → Third-party Access → Personal access tokens), a classic PAT with `repo` works but
is far broader. **Record the expiry date here if you take this route** — an expired PAT degrades
silently to `GITHUB_TOKEN`, and the warning annotation will be the only clue.
