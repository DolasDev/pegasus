# Fix the `./.github/actions/setup` install caching (51 s → hit path)

> **Status: COMPLETE (implementation)** — 2026-08-06. Branch
> `chore/ci-setup-cache`. No deviation: the plan was written after the
> diagnosis, and the diagnosis held.
>
> **Acceptance criteria 1-4 are POST-MERGE measurements and are NOT yet taken.**
> Cache behavior cannot be observed from a branch — the save path is gated on
> `refs/heads/main`, so the first real hit can only happen on the second `main`
> push after this lands. Re-measure then; until someone does, this fix is
> reasoned-and-verified-by-construction, not proven. The commands are in
> § Acceptance Criteria.
>
> **Not done, deliberately: the ~10.8 GB of existing cache entries are left
> alone.** Most are on dead refs (merged `refs/pull/*/merge`, deleted
> `gh-readonly-queue/*`) and are unreachable garbage that will age out in 7 days
> — but deleting them now would also evict entries that in-flight branches are
> using. Offered as a separate one-command cleanup rather than done unasked.
> Closes the one actionable item from the 2026-08-06 acceptance measurements
> (`audit-00-master-plan.md` § Acceptance Criteria; owned by
> `audit-ci-pipeline-efficiency.md` Phase 2, whose "Install dependencies ≤5 s
> (cache hit)" target has never been met).

## Context — the cache is not missing, it is being evicted

`Run ./.github/actions/setup` costs **51–54 s in every job**. The composite
action **already** caches `node_modules` correctly. Measuring the actual failure
(run 31045211891, Test job raw log) shows why it doesn't help:

```
20:41:26.700  Cache not found for input keys: Linux-modules-31b3ec42…
20:41:26.708  ##[group]Run npm ci
20:42:10.994  (next step)          → npm ci = 44.3 s of the 49 s step
```

A **miss**, not a slow restore. The reason is storage exhaustion:

```
gh api repos/DolasDev/pegasus/actions/cache/usage
  → active caches: 31   total: 10.77 GB   (GitHub hard limit: 10 GB)
```

Broken down by key prefix (`gh api …/actions/caches`):

| Key prefix         | Total    | Entries | What it is                               |
| ------------------ | -------- | ------- | ---------------------------------------- |
| `node-cache-*`     | 5,472 MB | 11      | `setup-node`'s `cache: 'npm'` → `~/.npm` |
| `Linux-modules-*`  | 4,694 MB | 10      | our `node_modules` cache                 |
| `codeql-overlay-*` | 593 MB   | 8       | CodeQL default setup                     |
| `playwright-*`     | 259 MB   | 1       | e2e browsers                             |
| `betterleaks-*`    | 14 MB    | 1       | secret-scan CLI                          |

**Three compounding causes:**

1. **Two ~500 MB caches per lockfile hash doing overlapping jobs.** `~/.npm`
   (496 MB) only helps on the `npm ci` path — the exact path the `node_modules`
   cache (463 MB) exists to avoid. Together they are 10.1 GB of the 10.77 GB
   total, so they evict each other and everything else.
2. **Every ref saves its own copy.** The same content is stored under
   `refs/pull/N/merge`, `refs/heads/gh-readonly-queue/main/pr-N-…`, **and**
   `refs/heads/main` — 3 copies per lockfile hash, two of them on refs that are
   deleted minutes later. Confirmed in the listing: identical
   `Linux-modules-31b3ec42…` and `node-cache-…0af38787…` entries on all three
   refs for PR 586.
3. Consequence: LRU eviction removes entries before they are ever reused, so
   nearly every job pays the cold `npm ci`.

**The hit rate is worth chasing:** only **6 of the last 40 commits** on `main`
touch `package-lock.json`, so ~85 % of runs _could_ hit an exact-key cache.

## Plan

- [x] **1. Drop `cache: 'npm'` from `actions/setup-node`.** It is the single
      largest consumer (5.47 GB) and is dead weight on the fast path — when the
      `node_modules` cache hits, `npm ci` never runs, so `~/.npm` is never read.
      Keeping both guarantees neither survives.
      **Honest cost:** on a genuine miss (a lockfile-changing PR, ~15 % of
      commits) `npm ci` must hit the registry and gets slower than today's 44 s.
      That is the trade — rare cold installs in exchange for the common case
      going to ~0. State it in the action's comments.

- [x] **2. Save the `node_modules` cache only on `refs/heads/main`; restore
      everywhere.** Split `actions/cache` into `cache/restore` + `cache/save`
      with `if: github.ref == 'refs/heads/main'`. Default-branch caches are
      readable from every branch and from `refs/pull/*/merge`, so PRs still hit;
      what disappears is the 2 ephemeral copies per hash. ~3× less storage for
      the same hit rate.

- [x] **3. Save from exactly one job, via a `cache-save` input (default
      `false`).** Without this, all four jobs on a `main` push would each upload
      the same ~463 MB — wasted minutes and a pile of "cache already exists"
      warnings. `Typecheck` opts in (fastest job, runs on every code change).

- [x] **4. Do NOT add `restore-keys`.** Tempting and wrong: `npm ci` deletes
      `node_modules` before installing, so a partial restore is pure download
      cost for zero benefit. Leave a comment saying so, or someone will
      "helpfully" add it back.

- [x] **5. Record the outcome** in `audit-ci-pipeline-efficiency.md` (which owns
      the Phase-2 target) and in the master plan's measurement block, replacing
      the "not attempted yet" note with the measured result.

## Files to Modify

| Action | File                                                   |
| ------ | ------------------------------------------------------ |
| Modify | `.github/actions/setup/action.yml`                     |
| Modify | `.github/workflows/ci.yml` (Typecheck opts in to save) |
| Modify | `plans/in-progress/audit-ci-pipeline-efficiency.md`    |
| Modify | `plans/in-progress/audit-00-master-plan.md`            |

## Side Effects & Risks

- **First run after merge is cold by construction.** No `main` cache exists
  under the new scheme until the first `main` push saves one. One slow run.
- **A stale `node_modules` can never be served for a different lockfile** — the
  key is an exact hash of `package-lock.json` + `.nvmrc`, and there are no
  restore-keys. Correctness is preserved by construction.
- **Skipping `npm ci` on a hit also skips postinstall.** Already true today and
  already handled: every job that needs the Prisma client runs an explicit
  `prisma generate`, and `husky`'s `prepare` is meaningless in CI. Unchanged by
  this PR, but re-verified.
- **Cache eviction is global and shared with CodeQL/Playwright/Betterleaks.**
  Freeing ~5.5 GB helps them too; none of their keys change.
- **Not a correctness risk, a speed risk:** if the hit rate turns out worse than
  the 85 % the lockfile churn predicts, the fallback is to restore `cache: npm`
  _instead of_ the node_modules cache — not in addition to it.

## Acceptance Criteria / Verification

1. `gh api repos/DolasDev/pegasus/actions/cache/usage` total drops below 10 GB
   and stops climbing (measure ≥1 day after merge, once old entries age out).
2. On a second `main` push with an unchanged `package-lock.json`, the Test job
   log shows `Cache restored from key: Linux-modules-…` and **no** `Run npm ci`
   group; the `Install dependencies` step reports skipped.
3. `Run ./.github/actions/setup` drops from ~51 s to the restore-only cost.
   Record the real number — the ≤5 s Phase-2 target is about the _install_ step
   (which becomes 0 s / skipped); a ~463 MB restore is not free and the plan
   should say what it actually costs rather than claim ≤5 s for the whole step.
4. Exactly one cache entry per lockfile hash, on `refs/heads/main` only
   (`gh api …/actions/caches` shows no `refs/pull/*` or `gh-readonly-queue`
   `Linux-modules-*` entries for hashes created after the merge).
5. CI stays green through the merge queue, and a lockfile-changing PR still
   installs correctly (verify on the next Dependabot PR).
