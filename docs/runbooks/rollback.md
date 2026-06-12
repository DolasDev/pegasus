# Rollback & Release Recovery — Operations Runbook

What to do when a deploy or migration goes bad. Covers the API Lambda, both
frontends (tenant-web, admin-web), the Temporal worker (ECS Fargate), and the
Neon database. Every scenario below has been chosen to be runnable under
pressure, at 2am, with no improvisation.

> **Golden rule — rollbacks are code-only.** The expand-contract migration
> policy (`dolas/agents/project/PATTERNS.md`, enforced by
> `scripts/check-migration-safety.sh`) guarantees that the previous SHA's code
> runs against the _current_ schema. So a code rollback never needs to touch
> the DB. The only DB action in this runbook is restoring a Neon branch after a
> genuinely destructive migration — and that is a deliberate, separate step.

## The two tools

- **`rollback.yml`** (`.github/workflows/rollback.yml`) — `workflow_dispatch`
  only. Deploys an arbitrary SHA to staging and/or prod via the same
  `_deploy.yml` as normal deploys, but with **no staging-first chain and no E2E
  gate** (`skip-migrate: 'true'` always). The `prod` environment's
  required-reviewer rule still gates the prod job. Blank `sha` resolves the
  `prod-previous` tag automatically.
- **Moving tags** (advanced by `deploy.yml`'s `tag-release` job on every
  successful prod deploy):
  - `prod-current` — the SHA currently running in prod.
  - `prod-previous` — the SHA running before it. This is the default rollback
    target.

  ```bash
  git fetch --tags --force
  git rev-parse prod-current    # what's live now
  git rev-parse prod-previous   # where a blank-sha rollback goes
  ```

---

## Scenario 1 — Bad API/frontend deploy, schema unchanged

The common case. The new code is broken but the DB schema is fine (the
migration, if any, was expand-only per policy).

```bash
# Roll prod back to the previous prod release (blank sha = prod-previous):
gh workflow run rollback.yml -f environment=prod -f target=api
# …or a specific component / SHA:
gh workflow run rollback.yml -f environment=prod -f target=tenant-web -f sha=<good-sha>

gh run watch   # approve the prod-environment gate when it pauses
```

Expected time-to-recover: ~8–10 min (build + CDK). Roll **forward** the same
way once the fix lands on main — a normal push to `main` redeploys, or
`gh workflow run deploy.yml -f target=api`.

Verify after: `curl -s https://api.pegasus-qa.dolas.dev/health` (staging) or the
prod health endpoint returns 200; for a frontend, the served bundle hash
changed (see Scenario 5 / the staging drill in the plan's acceptance criteria).

---

## Scenario 2 — Migration applied, CDK deploy failed

The `migrate` job runs **before** the `deploy` job in `_deploy.yml`, so the
schema can be ahead of the running Lambda code. Decision tree:

1. **Was the migration expand-only?** (the policy — additive columns/tables, no
   drops or renames, old code still works against the new shape.)
   → **Do nothing destructive.** Either re-run the deploy
   (`gh workflow run deploy.yml -f target=api`) to get the code forward, or roll
   the code back with `rollback.yml` — the schema stays put and both old and new
   code tolerate it. No DB action.

2. **Was it destructive** (`DROP`/`RENAME`/`SET NOT NULL` — should never ship
   with the code that needs it, but if it did)?
   → Restore from the `pre-migrate-<run_id>-<date>` Neon safety branch the
   migrate job created (Phase 2a). In the Neon console: select the branch →
   **Restore**, or via API:

   ```bash
   curl -X POST \
     "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/restore" \
     -H "Authorization: Bearer $NEON_API_KEY"
   ```

   Then fix Prisma's bookkeeping so it doesn't think the migration is still
   applied:

   ```bash
   cd apps/api
   node ../../node_modules/.bin/prisma migrate resolve --rolled-back <migration_name>
   ```

   List the safety branches to find the right one:

   ```bash
   curl -s -H "Authorization: Bearer $NEON_API_KEY" \
     "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
     | jq -r '.branches[] | select(.name | startswith("pre-migrate-")) | "\(.name)\t\(.id)"'
   ```

---

## Scenario 3 — Data-corrupting migration discovered late

The migration applied cleanly but is silently corrupting/dropping data, and
it's now past the immediate deploy window.

- Use **Neon point-in-time recovery (PITR)** within the retention window. In
  the console: **Branches → Restore → to a timestamp** just before the bad
  migration deployed (cross-reference the `tag-release` / deploy run time).
- **Caveat:** writes between the restore point and now are lost. If those
  writes matter, first create a PITR **branch** at "now", export the rows you
  need from it, then restore the main branch and re-apply the export.
- API form (branch at a timestamp):

  ```bash
  curl -X POST \
    "https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches" \
    -H "Authorization: Bearer $NEON_API_KEY" -H 'Content-Type: application/json' \
    -d '{"branch":{"name":"pitr-export","parent_timestamp":"2026-06-12T18:00:00Z"}}'
  ```

---

## Scenario 4 — Bad Temporal worker image

The worker (`pegasus-temporal-worker-<env>`) is crash-looping on a bad image.
The ECS circuit breaker does **not** help here — image-only rolls reuse the
mutable `:latest` tag, so "rollback to previous task def" re-pulls the same bad
image. Use the `rollback-to-sha` dispatch input (Phase 3a):

```bash
gh workflow run temporal-worker.yml -f env-name=staging -f rollback-to-sha=<good-sha>
```

This retags the known-good `:<good-sha>` image as `:latest` server-side (no
docker pull) and forces a new ECS deployment. Confirm:

```bash
aws ecs describe-services --cluster pegasus-temporal-worker-staging \
  --services pegasus-temporal-worker-staging \
  --query 'services[0].deployments[0].rolloutState'   # → COMPLETED
```

**If `rollback-to-sha` is not yet available** (before Phase 3a ships), the raw
sequence — retag a known-good `:SHA` as `:latest`, then force a new deployment:

```bash
ECR_REPO=pegasus-temporal-worker
CLUSTER=pegasus-temporal-worker-staging
SERVICE=pegasus-temporal-worker-staging
manifest=$(aws ecr batch-get-image --repository-name "$ECR_REPO" \
  --image-ids imageTag=<good-sha> --query 'images[0].imageManifest' --output text)
aws ecr put-image --repository-name "$ECR_REPO" --image-tag latest --image-manifest "$manifest"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment
```

(The ECR lifecycle rule keeps the last 20 images, so per-commit `:SHA` tags are
available for recent deploys.)

---

## Scenario 5 — Finding the last good SHA

```bash
git fetch --tags --force
git rev-parse prod-previous     # the usual rollback target
git rev-parse prod-current      # what's live now

# Fallback if the tags are missing/suspect — list recent prod deploy runs:
gh run list --workflow deploy.yml --branch main \
  --json conclusion,headSha,displayTitle,createdAt --limit 15
```

---

## Scenario 6 — CI itself is down (local emergency deploy)

The **only** scenario for a local deploy. `npm run deploy` / `deploy.sh`
defaults to dev; for a prod emergency, drive `deploy:ci` with the env explicit
(see `packages/infra/deploy.sh` Phase-3c env parameterization):

```bash
cd packages/infra
git checkout <good-sha>
ENV_NAME=prod TARGET="PegasusProd-ApiStack PegasusProd-ApiCdnStack" \
  npm run deploy:ci
```

…or, via the parameterized `deploy.sh` (prints a confirmation banner and
requires `CONFIRM_ENV=prod` for non-dev):

```bash
ENV_NAME=prod CONFIRM_ENV=prod ./packages/infra/deploy.sh --api-only
```

Use only when the GitHub Actions path is genuinely unavailable — a local deploy
hides the change from CI's change-detection marker (`last-deploy` tag), so push
the fix through `main` as soon as CI is back.

---

## Maintenance note

`prune: false` on the frontend asset deployments (Phase 3b) means old Vite
chunks accumulate in the site buckets (KBs per deploy). Prune quarterly:
inspect `aws s3 ls s3://<site-bucket> --recursive`, and delete `assets/`
objects older than the last few releases — never the objects referenced by the
live `index.html`.
