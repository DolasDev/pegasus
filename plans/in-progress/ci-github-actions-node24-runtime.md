# CI/CD GitHub Actions node20 runtime → node24

**Branch:** _(not started — separate branch, e.g. `chore/ci-actions-node24`)_
**Goal:** Stop using third-party GitHub Actions whose `runs.using` is still `node20`, ahead of GitHub's runtime removal.

## Why (hygiene, no hard cutoff)

GitHub is deprecating the **`node20` action runtime** in favour of `node24`. Affected actions emit
`node20 runtime is deprecated` annotations in run logs but still execute, so this is hygiene, not a
hard outage — unlike the Lambda side (see [lambda-nodejs24-runtime-migration.md](./lambda-nodejs24-runtime-migration.md)).

**The CI _toolchain_ is already Node 24** (`.nvmrc` = 24.16.0, root `engines >=24 <25`) — **do NOT
change `.nvmrc` or `engines`.** The only remaining `node20` surface is third-party actions.

## Already on node24 — no change

`actions/checkout@v6`, `actions/setup-node@v6`, `actions/setup-python@v6`,
`actions/upload-artifact@v7`, `actions/download-artifact@v8`.
(`pypa/gh-action-pypi-publish@release/v1` is a Docker action — not node, no change.)

## Checklist

- [ ] Trigger / read a recent run of each workflow; collect every `node20 ... deprecated` annotation (authoritative bump list — don't bump blindly)
- [ ] Bump each flagged action to the lowest version that moved to `node24`, preserving SHA-pinning where already used
- [ ] Open PR; confirm **zero** `node20` deprecation annotations across all workflows; all jobs green
- [ ] Confirm diff contains **no** `.nvmrc` / `engines` change

## Audit + bump candidates (verify runtime before bumping)

| Action                                             | Used in                                            | Action                                            |
| -------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `actions/cache@v4`                                 | `.github/actions/setup`, `ci.yml`                  | bump to latest v4.x / v5 declaring node24         |
| `aws-actions/configure-aws-credentials@v6`         | `_deploy.yml`, `deploy.yml`, `temporal-worker.yml` | verify; bump to node24 release if v6 still node20 |
| `aws-actions/amazon-ecr-login@v2`                  | `temporal-worker.yml`                              | verify / bump                                     |
| `docker/setup-buildx-action@v3`                    | `temporal-worker.yml`                              | verify / bump                                     |
| `docker/build-push-action@v6`                      | `temporal-worker.yml`                              | verify / bump                                     |
| `dorny/paths-filter@de90cc6…` (v3.0.2, SHA-pinned) | `ci.yml`                                           | v3 is node20 → re-pin to a node24 release SHA     |
| `dependabot/fetch-metadata@v3`                     | `dependabot-auto-merge.yml`                        | verify / bump                                     |

## Verification

- PR Actions run shows **zero** `node20` deprecation annotations across `ci.yml`,
  `deploy.yml`/`_deploy.yml`, `temporal-worker.yml`, `mobile-build.yml`,
  `publish-vpn-agent.yml`/`_publish-vpn-agent.yml`, `e2e-qa-longhaul.yml`, `dependabot-auto-merge.yml`.
- All jobs still green (version bumps only — functional parity expected).

## Risk

Major-version bumps of `aws-actions/*` can change input/behaviour — read each action's changelog
before bumping; prefer the smallest version that flips the runtime. This is why the method is
"read the warnings first," not a blind sweep.
