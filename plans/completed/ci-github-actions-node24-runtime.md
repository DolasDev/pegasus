# CI/CD GitHub Actions node20 runtime → node24

**Branch:** `chore/ci-actions-node24`
**Goal:** Stop using third-party GitHub Actions whose `runs.using` is still `node20`, ahead of GitHub's runtime removal.

## Why (time-boxed — GitHub forces node24 on 2026-06-16)

GitHub is deprecating the **`node20` action runtime** in favor of `node24`. Per the live
deprecation annotation: actions are **forced to run on Node.js 24 by default starting 2026-06-16**,
and **node20 is removed from runners on 2026-09-16**. Until then flagged actions still run but warn.
Lower-stakes than the Lambda side (see [lambda-nodejs24-runtime-migration.md](./lambda-nodejs24-runtime-migration.md)),
but the June 16 forced-switch is days away, so bump now rather than discover breakage on switchover.

**The CI _toolchain_ is already Node 24** (`.nvmrc` = 24.16.0, root `engines >=24 <25`) — **do NOT
change `.nvmrc` or `engines`.** The only remaining `node20` surface is third-party actions.

## Already on node24 — no change

`actions/checkout@v6`, `actions/setup-node@v6`, `actions/setup-python@v6`,
`actions/upload-artifact@v7`, `actions/download-artifact@v8`.
(`pypa/gh-action-pypi-publish@release/v1` is a Docker action — not node, no change.)

## Checklist

- [x] Read live deprecation annotations across CI / Deploy / Temporal-worker runs (authoritative list)
- [x] Verify each candidate target version's `runs.using` is actually `node24` before bumping
- [x] Bump all node20 actions; re-pin SHA-pinned `dorny/paths-filter` to a node24 release SHA
- [x] Open PR; confirm **zero** `node20` deprecation annotations across all workflows; all jobs green
      — done via PR #255 (`62b0aa6`, merged 2026-06-12); latest main `ci.yml` run `27473340592` green with no node20/node16 annotations.
- [x] Diff contains **no** `.nvmrc` / `engines` change (toolchain already node24)

## Authoritative audit result (from live run annotations + `runs.using` checks)

**Only 4 actions were on node20** — every usage bumped to the verified-node24 version:

| Action (was)                           | → bumped to                                           | `runs.using` | Used in                                                          |
| -------------------------------------- | ----------------------------------------------------- | ------------ | ---------------------------------------------------------------- |
| `actions/cache@v4`                     | `actions/cache@v5`                                    | node24 ✓     | `actions/setup`, `ci.yml`×2, `deploy.yml`, `e2e-qa-longhaul.yml` |
| `dorny/paths-filter@de90cc6…` (v3.0.2) | `@fbd0ab8…f3e69293af611ebaee6363fc25e6d187d` (v4.0.1) | node24 ✓     | `ci.yml`                                                         |
| `docker/setup-buildx-action@v3`        | `docker/setup-buildx-action@v4`                       | node24 ✓     | `temporal-worker.yml`×2, `tenant-runner.yml`×2                   |
| `docker/build-push-action@v6`          | `docker/build-push-action@v7`                         | node24 ✓     | `temporal-worker.yml`×2, `tenant-runner.yml`×2                   |

**Already node24 — NOT touched** (confirmed by absence from deprecation annotations on runs that
exercise them, plus `runs.using` check): `aws-actions/configure-aws-credentials@v6`,
`aws-actions/amazon-ecr-login@v2`, `dependabot/fetch-metadata@v3` (resolves to v3.1.0 = node24),
all `actions/*` at v6/v7/v8, and `pypa/gh-action-pypi-publish` (Docker action).

> The earlier worry about risky `aws-actions/*` major bumps was unfounded — they're already node24,
> so no behavior-changing bumps were needed. Only `actions/cache` (v4→v5) and the `docker/*` actions
> (v6→v7, v3→v4) are major bumps; both are drop-in for our usage (`path`/`key`; `context`/`file`/
> `push`/`tags`/`cache-from`/`cache-to`). CI on the PR is the functional gate.

## Verification

- PR Actions run shows **zero** `node20` deprecation annotations across `ci.yml`, `deploy.yml`,
  `temporal-worker.yml`, `tenant-runner.yml`, `e2e-qa-longhaul.yml`.
- All jobs still green (version bumps only — functional parity expected).
