# Audit: Rollback & Release Safety

> **Status: MOSTLY COMPLETE & DEPLOYED** — Phase 1 (1a–1d), Phase 2b, and Phase 3
> (3a–3c) shipped via #252 and live in prod (rollback.yml, check-migration-safety.sh,
> prod-current/prod-previous tags, worker/frontend rollback fidelity). **Outstanding
> two items:** 2a automated Neon safety branch (blocked on
> `plans/todo/neon-branches-for-e2e-isolation.md`) and 2c AI migration review (deferred
> under the AI-automation hold). Keep in-progress until 2a/2c land or are dropped. — updated 2026-06-13

Unit 3 of the CI/CD + DevOps audit batch. Scope: what happens when a deploy or
migration goes BAD — the detection-to-recovery path for the API Lambda, both
frontends, the Temporal worker, and the Neon database. Out of scope (owned by
other units): deploy pipeline dedup/notifications/pre-flight (Unit 2),
monitoring/alarms (Unit 4), CI efficiency (Unit 1).

## Context

### Finding 1 — There is no way to deploy an arbitrary SHA. Rollback today = revert-and-pray.

- `.github/workflows/deploy.yml:20-31` — `workflow_dispatch` has a single
  `target` input (component choice). There is **no ref/SHA input**.
- `.github/workflows/deploy.yml:136,163,248` — every deploy job is gated with
  `github.ref == 'refs/heads/main'`. Dispatching the workflow from any other
  branch/tag silently skips all jobs, so you cannot even dispatch from a
  rollback branch.
- Net: the only rollback path for api/tenant-web/admin-web is `git revert` +
  push to main, which then walks the **full** staging → E2E gate → prod-approval
  chain (`deploy.yml:133-259`) — tens of minutes of latency while prod is broken,
  and the revert itself can be blocked by the very E2E gate the bad deploy broke.

### Finding 2 — deploy.sh cannot do the emergency deploy its own header promises.

- `packages/infra/deploy.sh:3-8` says "local emergency deploys when CI is
  unavailable", but lines 67 and 70 hardcode `PegasusDev-*` stack names and
  line 25 hardcodes `AWS_PROFILE=admin-dev`. `deploy:ci`
  (`packages/infra/package.json:12`) defaults `-c env=${ENV_NAME:-dev}`.
  So the "emergency" script can only deploy the **dev** env. A true prod
  emergency requires hand-assembling `ENV_NAME=prod STACK_PREFIX=PegasusProd
TARGET="..."` from memory — exactly the kind of under-pressure improvisation
  that goes wrong.

### Finding 3 — Migrations are forward-only with zero safety point; a half-failed deploy strands the DB ahead of the code.

- `.github/workflows/_deploy.yml:51-91` — the `migrate` job runs
  `prisma migrate deploy` against Neon (`DIRECT_URL`) **before** the CDK deploy
  job (`needs: [migrate]`, line 95). If migration succeeds and CDK deploy fails,
  the schema is ahead of the running Lambda code with no automated recovery and
  no recorded restore point.
- Prisma generates no down-migrations; the repo confirms destructive
  (non-expand-contract) migrations ship routinely:
  `apps/api/prisma/migrations/20260507233000_drop_tenant_user_role/`,
  `20260518131000_drop_tenant_email_domains/`,
  `20260430160000_replace_legacy_user_id_with_windows_username/` all contain
  `DROP TABLE`/`DROP COLUMN`. With drops in the same release as the code change,
  a code-only rollback to the previous SHA can crash against the new schema —
  rollback safety currently depends on luck, not policy.
- Neon supports branching/PITR (cheap copy-on-write restore points) but nothing
  in-repo automates a pre-migration safety branch, and no runbook describes a
  restore. `apps/api/prisma.config.ts:17-33` confirms migrate runs over
  `DIRECT_URL` — the same env scope where a Neon API call could snapshot first.

### Finding 4 — The one automated rollback (ECS circuit breaker) is partially illusory.

- `packages/infra/lib/stacks/temporal-worker-stack.ts:357` —
  `circuitBreaker: { rollback: true }` is the **only** automated rollback in
  the system. But line 289 pins the container image to the mutable tag
  `ecs.ContainerImage.fromEcrRepository(repository, 'latest')`, and
  `.github/workflows/temporal-worker.yml:106-110` rolls new images with
  `aws ecs update-service --force-new-deployment` — which does **not** create a
  new task-definition revision. For image-only pushes, "rollback to the
  previous task definition" re-pulls the **same broken `:latest` image**. The
  breaker only protects against bad task-def changes (env vars, CPU), not bad
  images — the common case.
- Good news: `temporal-worker.yml:101-102` already pushes a per-commit
  `:${{ github.sha }}` tag and the ECR lifecycle rule keeps 20 images
  (`temporal-worker-stack.ts:168-174`), so rollback **material** exists — there
  is just no path that consumes it. Recovery today = hand-crafted
  `aws ecr put-image` retag, undocumented.

### Finding 5 — Frontend rollback = full rebuild; no versioning, and deploys brick open tabs.

- `packages/infra/lib/stacks/frontend-stack.ts:62` and
  `admin-frontend-stack.ts:62` — site buckets are `versioned: false`.
- `frontend-assets-stack.ts:170-193` / `admin-frontend-assets-stack.ts:142-157`
  — `BucketDeployment` with default `prune: true` deletes the previous build's
  hashed Vite chunks on every deploy. Two consequences: (a) rollback requires a
  full rebuild at the old SHA (impossible today per Finding 1); (b) any user
  with an open SPA tab gets dynamic-import 404s mid-session on every deploy —
  a small recurring self-inflicted outage.

### Finding 6 — "Last known good SHA" is not recorded anywhere.

- `git tag` shows a single `v1.0`. Identifying the previous good prod release
  means spelunking `gh run list --workflow deploy.yml` and cross-referencing
  which runs actually reached the prod job — slow and error-prone during an
  incident.

### Finding 7 — No rollback runbook exists.

- `docs/runbooks/` exists (contains `wireguard/`), and
  `docs/ringcentral-message-capture-runbook.md` establishes the runbook
  convention — but nothing covers bad deploy / failed migration / Neon restore.

### AI integration verdict

**No AI in the rollback execution path** — recovery must be deterministic,
boring, and runnable at 2am. One genuinely valuable spot: an AI migration-safety
review on PRs that add migrations (semantic issues a grep can't catch: NOT NULL
without default on a populated table, table-rewrite locks, drop-before-code-stops-
reading). Scoped as Phase 2 item 2c. Everything else here is plain automation.

## Plan

### Phase 1 — One-click rollback to SHA X (quick wins, ~half a day total)

- [x] **1a. Add `git-ref` + `skip-migrate` inputs to `_deploy.yml`** (effort: S, ~30 min)
  - New `workflow_call` inputs:
    ```yaml
    git-ref:
      description: 'Commit SHA/ref to check out and deploy (empty = workflow ref)'
      type: string
      default: ''
    skip-migrate:
      description: 'true to skip the prisma migrate job (rollbacks are code-only)'
      type: string
      default: 'false'
    ```
  - Both checkout steps (`_deploy.yml:57` and `:104`) become:
    ```yaml
    - uses: actions/checkout@v6
      with:
        ref: ${{ inputs.git-ref }}
    ```
    (empty string preserves current default behaviour).
  - Migrate job condition (`_deploy.yml:53`) becomes:
    `if: inputs.deploy-api == 'true' && inputs.skip-migrate != 'true'`.
    The deploy job already tolerates a skipped migrate (`_deploy.yml:96`).
  - Backwards-compatible: `deploy.yml` callers pass neither input, nothing changes.

- [x] **1b. New `.github/workflows/rollback.yml`** (effort: M, ~2 h incl. staging drill)
  - `workflow_dispatch` only. Sketch:
    ```yaml
    name: Rollback
    on:
      workflow_dispatch:
        inputs:
          sha:
            description: 'Commit SHA to roll back to (empty = prod-previous tag)'
            type: string
            default: ''
          environment:
            type: choice
            required: true
            options: [staging, prod, both]
          target:
            type: choice
            required: true
            default: all
            options: [all, api, tenant-web, admin-web]
    # Serialize against normal deploys — same group deploy.yml uses for main.
    concurrency:
      group: deploy-refs/heads/main
      cancel-in-progress: false
    permissions:
      id-token: write
      contents: read
    jobs:
      resolve:
        runs-on: ubuntu-latest
        outputs:
          sha: ${{ steps.r.outputs.sha }}
          api: ${{ steps.r.outputs.api }}
          tenant: ${{ steps.r.outputs.tenant }}
          admin: ${{ steps.r.outputs.admin }}
        steps:
          - uses: actions/checkout@v6
            with: { fetch-depth: 0 }
          - id: r
            run: |
              set -euo pipefail
              sha="${{ inputs.sha }}"
              if [[ -z "$sha" ]]; then
                git fetch --tags --force
                sha=$(git rev-parse --verify prod-previous^{commit})
              fi
              git cat-file -e "${sha}^{commit}"   # fail fast on bogus input
              case "${{ inputs.target }}" in
                all)        api=true;  tenant=true;  admin=true ;;
                api)        api=true;  tenant=false; admin=false ;;
                tenant-web) api=false; tenant=true;  admin=false ;;
                admin-web)  api=false; tenant=false; admin=true ;;
              esac
              { echo "sha=$sha"; echo "api=$api"; echo "tenant=$tenant"; echo "admin=$admin"; } >> "$GITHUB_OUTPUT"
              echo "### Rolling back to \`$sha\` (${{ inputs.environment }} / ${{ inputs.target }})" >> "$GITHUB_STEP_SUMMARY"
      rollback-staging:
        needs: resolve
        if: inputs.environment == 'staging' || inputs.environment == 'both'
        uses: ./.github/workflows/_deploy.yml
        with:
          env-name: staging
          stack-prefix: PegasusStaging
          deploy-api: ${{ needs.resolve.outputs.api }}
          deploy-tenant: ${{ needs.resolve.outputs.tenant }}
          deploy-admin: ${{ needs.resolve.outputs.admin }}
          git-ref: ${{ needs.resolve.outputs.sha }}
          skip-migrate: 'true'
        secrets: inherit
        permissions: { id-token: write, contents: read }
      rollback-prod:
        needs: resolve
        if: ${{ !cancelled() && needs.resolve.result == 'success' && (inputs.environment == 'prod' || inputs.environment == 'both') }}
        uses: ./.github/workflows/_deploy.yml
        with:
          env-name: prod
          stack-prefix: PegasusProd
          deploy-api: ${{ needs.resolve.outputs.api }}
          deploy-tenant: ${{ needs.resolve.outputs.tenant }}
          deploy-admin: ${{ needs.resolve.outputs.admin }}
          git-ref: ${{ needs.resolve.outputs.sha }}
          skip-migrate: 'true'
        secrets: inherit
        permissions: { id-token: write, contents: read }
    ```
  - Design notes: intentionally **no** staging-first chain and no E2E gate —
    this is the emergency path; the `prod` GitHub environment's
    required-reviewer rule still applies to `rollback-prod` (one click), so it
    is not unguarded. `skip-migrate: 'true'` because rollbacks are code-only by
    policy (Phase 2 item 2b makes that safe). The reusable workflow file itself
    resolves from main HEAD, so fixes to `_deploy.yml` always apply even when
    deploying old SHAs.

- [x] **1c. Record last-known-good: moving `prod-current` / `prod-previous` tags** (effort: S, ~45 min)
  - Append a `tag-release` job to `deploy.yml`:
    ```yaml
    tag-release:
      name: Tag prod release
      needs: deploy-prod
      if: success()
      runs-on: ubuntu-latest
      permissions:
        contents: write
      steps:
        - uses: actions/checkout@v6
          with: { fetch-depth: 0 }
        - run: |
            set -euo pipefail
            git fetch --tags --force
            prev=$(git rev-parse --verify -q prod-current^{commit} || true)
            if [[ -n "$prev" && "$prev" != "${{ github.sha }}" ]]; then
              git tag -f prod-previous "$prev"
              git push -f origin prod-previous
            fi
            git tag -f prod-current "${{ github.sha }}"
            git push -f origin prod-current
    ```
  - Rollback then becomes: dispatch `rollback.yml` with `sha` blank (resolves
    `prod-previous` automatically). Solo-dev cost during an incident: two
    clicks, zero spelunking. Note `deploy.yml` top-level `permissions` is
    `contents: read` (`deploy.yml:37-39`) — the job-level `contents: write`
    override above is required.

- [x] **1d. Write `docs/runbooks/rollback.md`** (effort: M, ~1.5 h)
  - Follows the existing convention (`docs/runbooks/wireguard/`,
    `docs/ringcentral-message-capture-runbook.md`). Scenarios, each with exact
    commands:
    1. **Bad API/frontend deploy, schema unchanged** — dispatch `rollback.yml`
       (`gh workflow run rollback.yml -f environment=prod -f target=api` —
       blank sha = prod-previous). Expected time-to-recover: ~8–10 min (build +
       CDK).
    2. **Migration applied, CDK deploy failed** (Finding 3) — schema is ahead
       of code. Decision tree: if migration was expand-only (the policy), do
       nothing — re-run deploy or roll code back; schema stays. If it was
       destructive, restore from the `pre-migrate-<run_id>` Neon branch
       (Phase 2): Neon console → branch → "Restore" (or
       `curl -X POST .../projects/$NEON_PROJECT_ID/branches/$BRANCH_ID/restore`),
       then `prisma migrate resolve --rolled-back <migration>` to fix
       `_prisma_migrations` bookkeeping.
    3. **Data-corrupting migration discovered late** — Neon PITR within the
       retention window; document the console path + the API call, and the
       caveat that writes since the restore point are lost (export them first
       from a PITR branch if needed).
    4. **Bad Temporal worker image** — retag a known-good `:SHA` image as
       `:latest` and force redeploy (commands in Phase 3 item 3a; until that
       lands, the runbook carries the raw `aws ecr batch-get-image` /
       `put-image` / `update-service` sequence).
    5. **Finding the last good SHA** — `git rev-parse prod-previous`; fallback
       `gh run list --workflow deploy.yml --branch main --json conclusion,headSha,displayTitle --limit 15`.
    6. **CI itself is down** — the only scenario for a local deploy:
       documented one-liner
       `ENV_NAME=prod TARGET="PegasusProd-ApiStack ..." npm run deploy:ci`
       from `packages/infra/` at the target SHA (see Phase 3 item 3c for the
       deploy.sh fix that makes this less hand-rolled).

### Phase 2 — Database safety net (the highest-risk gap, ~half a day)

- [ ] **2a. Automated Neon safety branch in the migrate job** (effort: M, ~2 h + one-time Neon/GitHub setup)
  - One-time setup: create a Neon API key; add `NEON_API_KEY` secret and
    `NEON_PROJECT_ID` variable to both `staging` and `prod` GitHub
    environments (same place `DIRECT_URL` lives, `_deploy.yml:40-48`).
  - Insert between "Show pending migrations" (`_deploy.yml:74`) and "Apply
    migrations" (`_deploy.yml:87`):
    ```yaml
    - name: Neon safety branch (only when migrations are pending)
      working-directory: apps/api
      env:
        DIRECT_URL: ${{ secrets.DIRECT_URL }}
        NEON_API_KEY: ${{ secrets.NEON_API_KEY }}
        NEON_PROJECT_ID: ${{ vars.NEON_PROJECT_ID }}
      run: |
        set -euo pipefail
        # `prisma migrate status` exits non-zero when migrations are pending.
        if node ../../node_modules/.bin/prisma migrate status; then
          echo "No pending migrations — no safety branch needed."
          exit 0
        fi
        name="pre-migrate-${{ github.run_id }}-$(date -u +%Y%m%d)"
        curl -fsS -X POST \
          "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
          -H "Authorization: Bearer ${NEON_API_KEY}" \
          -H 'Content-Type: application/json' \
          -d "{\"branch\":{\"name\":\"${name}\"}}" > /dev/null
        echo "### Neon safety branch: \`${name}\`" >> "$GITHUB_STEP_SUMMARY"
        # Prune safety branches older than 7 days so we never hit branch quota.
        cutoff=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)
        curl -fsS -H "Authorization: Bearer ${NEON_API_KEY}" \
          "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches" \
        | jq -r --arg c "$cutoff" \
            '.branches[] | select(.name | startswith("pre-migrate-")) | select(.created_at < $c) | .id' \
        | while read -r bid; do
            curl -fsS -X DELETE -H "Authorization: Bearer ${NEON_API_KEY}" \
              "https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${bid}" > /dev/null || true
          done
    ```
  - Cost: Neon branches are copy-on-write — near-zero storage for a 7-day
    safety window. Zero added latency on the (common) no-pending-migrations
    path.

- [x] **2b. Expand-contract migration policy + deterministic guard** (effort: M, ~2 h)
  - Policy statement added to `dolas/agents/project/PATTERNS.md` (where agents
    already look for conventions): _destructive DDL (`DROP TABLE`,
    `DROP COLUMN`, `RENAME`, `ALTER ... SET NOT NULL` on existing columns) must
    ship at least one release **after** the last code that reads the old shape;
    a migration PR is either expand-only or contract-only, never both with the
    code change that needs it. Consequence: rolling back code is always safe;
    `rollback.yml` never has to touch the DB._
  - Guard (automation over discipline): `scripts/check-migration-safety.sh` —
    diffs `apps/api/prisma/migrations/**/migration.sql` files added relative to
    `origin/main`, greps for the destructive patterns above, and fails unless
    the SQL carries an explicit `-- expand-contract: contract approved` marker
    comment. ~30 lines of bash:
    ```bash
    #!/usr/bin/env bash
    set -euo pipefail
    base="${1:-origin/main}"
    added=$(git diff --diff-filter=A --name-only "$base"...HEAD -- 'apps/api/prisma/migrations/**/migration.sql')
    [ -z "$added" ] && exit 0
    fail=0
    for f in $added; do
      if grep -qiE 'DROP TABLE|DROP COLUMN|ALTER TABLE .* RENAME|SET NOT NULL' "$f" \
         && ! grep -q -- '-- expand-contract: contract approved' "$f"; then
        echo "::error file=$f::Destructive DDL without expand-contract marker. See docs/runbooks/rollback.md."
        fail=1
      fi
    done
    exit $fail
    ```
  - Wire as a single additive step in `.github/workflows/ci.yml` (one step
    only — CI structure is Unit 1's territory; coordinate if both plans touch
    the file).

- [ ] **2c. AI migration review on migration PRs** (effort: S, ~1 h; genuinely valuable)
  - The grep guard catches syntax; it cannot catch semantics (NOT NULL without
    a default on a populated table, index builds without `CONCURRENTLY`
    table-locking a hot table, a drop whose reader was removed in the _same_
    PR). Add a step (same ci.yml job as 2b, gated on the same
    paths) running headless Claude:
    ```yaml
    - name: AI migration safety review
      if: steps.guard.outputs.has_new_migrations == 'true'
      env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
      run: |
        git diff origin/main...HEAD -- apps/api/prisma/migrations apps/api/prisma/schema.prisma \
          | claude -p "Review this Prisma/Postgres migration diff for rollback safety on a live multi-tenant DB behind PgBouncer: expand-contract violations, locking hazards, NOT NULL on populated tables, data loss. Reply PASS or a numbered list of blocking findings." \
          | tee -a "$GITHUB_STEP_SUMMARY"
    ```
  - Advisory (non-blocking) for the first month; flip to blocking once trusted.
    This is the one place in this plan where AI earns its keep — everywhere
    else, deterministic automation wins.

### Phase 3 — Worker + frontend rollback fidelity (~half a day, lower urgency)

- [x] **3a. Worker image rollback input on `temporal-worker.yml`** (effort: S, ~1 h)
  - Add a `rollback-to-sha` dispatch input. When set, skip the build job steps
    and instead retag server-side (no docker pull needed) per env:
    ```bash
    manifest=$(aws ecr batch-get-image --repository-name "$ECR_REPO_NAME" \
      --image-ids imageTag="$ROLLBACK_SHA" --query 'images[0].imageManifest' --output text)
    aws ecr put-image --repository-name "$ECR_REPO_NAME" \
      --image-tag latest --image-manifest "$manifest"
    aws ecs update-service --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE" \
      --force-new-deployment
    ```
  - Also fix the misleading comment at
    `packages/infra/lib/stacks/temporal-worker-stack.ts:354-357`: the circuit
    breaker does **not** restore the previous image for image-only rolls
    (Finding 4) — document that `rollback-to-sha` is the real image-rollback
    path. (Comment-only change to the stack; no infra mutation.)

- [x] **3b. Stop deleting the live frontend bundle out from under users** (effort: S, ~45 min)
  - Add `prune: false` to both `BucketDeployment`s
    (`frontend-assets-stack.ts:170-193`, `admin-frontend-assets-stack.ts:142-157`).
    Leave the buckets `versioned: false` (`frontend-stack.ts:62`,
    `admin-frontend-stack.ts:62`) — Vite's content-hashed filenames already
    make every chunk immutable, so keeping old chunks alongside new ones is
    safe and `config.json` is still overwritten in place. (A blanket S3
    lifecycle `expiration` rule is NOT an option here: it would also delete the
    _active_ bundle's objects; versioning + `noncurrentVersionExpiration` would
    work but adds machinery for no benefit over rebuild-based rollback.)
  - Effects: open SPA tabs stop 404ing on dynamic imports mid-deploy, and a
    frontend rollback via `rollback.yml` (which rebuilds at the old SHA) needs
    no bucket archaeology. Cost: slow bucket growth (KBs/deploy) — add a
    quarterly manual prune note to the runbook.

- [x] **3c. Make deploy.sh honest** (effort: S, ~30 min)
  - Parameterize the env: `ENV_NAME="${ENV_NAME:-dev}"`,
    `STACK_PREFIX="Pegasus$(tr '[:lower:]' '[:upper:]' <<< ${ENV_NAME:0:1})${ENV_NAME:1}"`,
    replace the hardcoded `PegasusDev-` literals at `deploy.sh:67,70` with
    `${STACK_PREFIX}-`, and print a loud banner when `ENV_NAME != dev`
    requiring an explicit `CONFIRM_ENV=prod` env var to proceed. Keeps the
    script dev-default but makes the documented "CI is down" emergency path
    (runbook scenario 6) a real, tested command instead of folklore.

## Files to Modify / Create

| File                                                       | Action                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.github/workflows/_deploy.yml`                            | Modify — `git-ref` + `skip-migrate` inputs (1a); Neon safety-branch step (2a) |
| `.github/workflows/rollback.yml`                           | **Create** (1b)                                                               |
| `.github/workflows/deploy.yml`                             | Modify — append `tag-release` job (1c)                                        |
| `docs/runbooks/rollback.md`                                | **Create** (1d)                                                               |
| `dolas/agents/project/PATTERNS.md`                         | Modify — expand-contract policy (2b)                                          |
| `scripts/check-migration-safety.sh`                        | **Create** (2b)                                                               |
| `.github/workflows/ci.yml`                                 | Modify — guard + AI review steps (2b/2c; coordinate with Unit 1)              |
| `.github/workflows/temporal-worker.yml`                    | Modify — `rollback-to-sha` input (3a)                                         |
| `packages/infra/lib/stacks/temporal-worker-stack.ts`       | Modify — comment correction only (3a)                                         |
| `packages/infra/lib/stacks/frontend-assets-stack.ts`       | Modify — `prune: false` (3b)                                                  |
| `packages/infra/lib/stacks/admin-frontend-assets-stack.ts` | Modify — `prune: false` (3b)                                                  |
| `packages/infra/deploy.sh`                                 | Modify — env parameterization + confirm gate (3c)                             |

One-time operator setup (not in repo): Neon API key → `NEON_API_KEY` secret +
`NEON_PROJECT_ID` variable on `staging` and `prod` GitHub environments;
`ANTHROPIC_API_KEY` repo secret for 2c.

## Side Effects & Risks

- **1b** shares the `deploy-refs/heads/main` concurrency group with normal
  deploys — a rollback queued behind a long deploy waits for it. Acceptable:
  cancelling an in-flight CDK deploy mid-changeset is worse. Per the existing
  memory note, rapid queueing can cancel pending runs only when
  `cancel-in-progress` flips — keep it `false` in rollback.yml exactly as in
  deploy.yml.
- **1b** deploys old SHAs with the _current_ `_deploy.yml` — if the old SHA's
  build contract changed (e.g. a workspace rename), the rollback build can
  fail. Mitigation: rollback drill (below) plus the tags from 1c keep rollback
  targets recent.
- **1c** force-pushes moving tags with the default `GITHUB_TOKEN`; ensure no
  tag-protection rule covers `prod-*`. Moving tags are non-standard but this is
  a solo repo — convenience wins.
- **2a** adds a Neon API dependency to the migrate job. `curl -fsS` failing
  **blocks** the deploy — that is intentional (no safety point → no migration),
  but note it as a new failure mode; the runbook documents the override
  (re-run with the step temporarily guarded) if Neon's API is down while prod
  needs a fix.
- **2b** marker comments can be cargo-culted. The AI review (2c) is the
  backstop; both are advisory-first.
- **3b** `prune: false` grows the site buckets slowly (hashed chunks, KBs per
  deploy). Quarterly manual prune noted in the runbook. `BucketDeployment`'s
  CloudFront invalidation behaviour is unchanged.
- Skipping the E2E gate on rollback (1b) is deliberate but means a rollback can
  itself be bad. The prod environment approval click remains the human check.
- Touching `.github/workflows/_deploy.yml`/`deploy.yml` triggers the `infra`
  path filter (`deploy.yml:82-83`) → next push to main after merging this work
  runs a full `--all` deploy of both envs. Expected; merge when not racing
  other deploys.

## Acceptance Criteria / Verification

1. **Rollback drill (staging, frontend)** — the core proof:
   - Note current bundle: `curl -s https://pegasus-qa.dolas.dev | grep -o 'assets/index-[^"]*\.js'`
   - `gh workflow run rollback.yml -f sha=$(git rev-parse 'HEAD~3') -f environment=staging -f target=tenant-web`
   - `gh run watch` until green; re-run the curl — the chunk hash must differ
     (old bundle serving). Then `gh workflow run deploy.yml -f target=tenant-web`
     to roll forward and confirm the hash returns.
2. **Rollback drill (staging, api)** — dispatch with `target=api`; verify the
   migrate job shows **skipped** in the run graph and
   `curl -s https://api.pegasus-qa.dolas.dev/health` returns 200 after.
3. **Tags** — after the next successful prod deploy:
   `git fetch --tags --force && git rev-parse prod-current` equals the deployed
   SHA shown in the run summary; after a second deploy, `prod-previous` equals
   the first.
4. **Neon safety branch** — merge a trivial migration to staging; the migrate
   job summary shows `Neon safety branch: pre-migrate-…`; confirm via
   `curl -s -H "Authorization: Bearer $NEON_API_KEY" https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches | jq -r '.branches[].name'`.
   A no-migration deploy must show "No pending migrations" and create nothing.
5. **Guard** — branch with a `DROP COLUMN` migration and no marker →
   `scripts/check-migration-safety.sh origin/main` exits 1; add the marker →
   exits 0.
6. **Worker rollback** — `gh workflow run temporal-worker.yml -f env-name=staging -f rollback-to-sha=<old-sha>`;
   then `aws ecs describe-services --cluster pegasus-temporal-worker-staging --services pegasus-temporal-worker-staging --query 'services[0].deployments[0].rolloutState'`
   reaches `COMPLETED` and the running task's image digest matches the old SHA tag's digest
   (`aws ecr describe-images --repository-name pegasus-temporal-worker --image-ids imageTag=<old-sha>`).
7. **Runbook exists and is executable** — `[ -f docs/runbooks/rollback.md ]`;
   every command block in it has been pasted-and-run once against staging
   during the drills above.
8. **deploy.sh** — `./packages/infra/deploy.sh --api-only --dry-run` still
   prints PegasusDev targets; `ENV_NAME=staging ./packages/infra/deploy.sh --api-only --dry-run`
   prints `PegasusStaging-*` targets and the confirmation banner.
