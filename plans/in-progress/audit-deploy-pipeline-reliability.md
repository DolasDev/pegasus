# Audit: Deploy Pipeline Reliability

> **Status: SCOPED** — 2026-06-10

Audit scope: `.github/workflows/deploy.yml`, `_deploy.yml`, `temporal-worker.yml`, `publish-vpn-agent.yml`, `_publish-vpn-agent.yml`, `packages/infra/bin/app.ts`, `packages/infra/deploy.sh`. Goal: make deploys **reliable** (nothing silently undeployed), **deduplicated** (one source of truth for stack/path mappings), **observable in flight** (push notifications, rollout polling), and **pre-flight-validated** (fail fast on missing secrets/params). Out of scope (owned by other audit units): rollback/release safety (Unit 3), `ci.yml` (Unit 1), CloudWatch monitoring/alerting (Unit 4).

## Context

### F1 — Queued-deploy cancellation silently drops code deploys (CRITICAL, verified live)

`deploy.yml:33-35` uses `concurrency: group: deploy-${{ github.ref }}` with `cancel-in-progress: false`. GitHub keeps **at most one pending run per concurrency group**: when run A is in progress, run B is queued, and run C arrives, GitHub **cancels B** (replaced by C). Since `dorny/paths-filter@v4` (`deploy.yml:57-84`) on push events diffs only the _pushed range of the surviving run_, B's code changes are never evaluated by any run that actually executes. If C is plans-only, the path filter deploys nothing and code changes silently never reach staging/prod.

Verified in run history (`gh run list --workflow deploy.yml`):

```
cancelled  push              2026-06-09T21:49:29Z  chore(plans): archive completed workflows-phase2...
cancelled  push              2026-06-09T21:48:16Z  feat(workflows): add reconcile poller for orphaned RUNNING...
success    push              2026-06-09T21:48:13Z  feat(tenant-web): workflow execution UI...
success    workflow_dispatch 2026-06-09T21:52:09Z  Deploy   (18m — manual recovery)
```

The reconcile-poller API change (#229) only deployed because the dev noticed and manually dispatched. Today the recovery protocol is _human discipline_ (memory note: "after batch merges, check `gh run list` for cancelled runs and re-dispatch") — exactly the kind of toil this audit must eliminate.

**Root design flaw:** the diff base is "previous commit" rather than "last successfully deployed commit". Fixing the base makes cancellations _benign by construction_ — the surviving newest run always covers everything since the last successful deploy. No re-dispatch logic, no accumulated-filter bookkeeping.

### F2 — Stack lists duplicated across 4 places, and they have ALREADY drifted (HIGH)

The component→stack mapping is hand-maintained in:

1. `packages/infra/bin/app.ts` — source of truth (construct IDs `${stackIdPrefix}-XStack`, lines 148-395).
2. `.github/workflows/_deploy.yml:181-223` — "Resolve CDK stack target" bash case (api bucket = Cognito, Documents, WireGuard, Api, ApiCdn, Monitoring, TemporalWorker; + staging-only E2EStagingRoleStack).
3. `packages/infra/deploy.sh:66-75` — `--api-only` / `--admin-only` hardcoded lists.
4. `.github/workflows/deploy.yml:62-84` — component→path filters (the other half of the same mapping).

**Drift found during this audit:** `deploy.sh:67` `--api-only` list is missing `PegasusDev-ApiCdnStack` and `PegasusDev-TemporalWorkerStack` (TemporalWorker is staging/prod-only so harmless in dev, but ApiCdn is real drift — a local `--api-only` emergency deploy would skip the API CDN stack that `_deploy.yml` deploys). Adding any new stack today requires touching all four places with zero automated drift detection.

### F3 — `prisma migrate deploy` job runs on every API deploy (~2-3 min × 2 envs of pure overhead)

`_deploy.yml:51-91`: the `migrate` job runs whenever `deploy-api == 'true'`, and the `deploy` job is serialized behind it (`needs: [migrate]`, line 95). The cost is not `migrate deploy` itself (no-op in seconds) but the full job scaffold: checkout + `npm ci` + `prisma generate` ≈ 2-3 min, twice per push (staging + prod). The vast majority of API deploys ship no new migration files (`apps/api/prisma/migrations/` last changed 2026-06-08; dozens of API deploys since). This is 4-6 min of dead serial latency on nearly every deploy.

### F4 — E2E staging gate extracts URLs via jq with no validation (MEDIUM)

`deploy.yml:193-203` extracts 6 values via `jq -r '...'` from the CDK outputs artifact. `jq -r` on a missing key emits the literal string `null` (or empty with `// empty`), so a renamed output key or a partial-deploy outputs file produces garbage env vars and the Playwright suite fails with confusing connection errors instead of a clear "output X missing from cdk-outputs-staging". The `_deploy.yml:214-221` comment about E2EStagingRoleStack proves this class of failure has already bitten once.

### F5 — Zero deploy notifications; cancelled runs are completely invisible (HIGH for a solo dev)

No workflow sends any notification on start/success/failure/cancellation, and the prod gate (`deploy.yml:240-259`, required-reviewer on the `prod` environment) sits silently waiting for approval until the dev happens to open the Actions tab. Critically, a **cancelled-while-queued run never executes any jobs**, so an in-workflow notification step can never report it — the notifier must live in a _separate_ workflow triggered by `workflow_run: completed` (which does fire for cancelled runs).

### F6 — `temporal-worker.yml` staging/prod jobs are copy-paste, and the "build once" comment is false (MEDIUM)

Lines 63-136 (staging) and 138-202 (prod) are near-identical. The header comment (lines 58-61) claims "Build the image once, push it twice" but the jobs run **two independent builds** with **per-env buildx cache scopes** (`scope=temporal-worker-staging` line 103-104 vs `scope=temporal-worker-prod` line 176-177), so prod can't even reuse staging's layers — slower, and the staging/prod images for the same SHA are not guaranteed identical (e.g. `apt-get` timing). Also `--force-new-deployment` (lines 121-126, 187-192) is fire-and-forget: the job goes green even if the new task crash-loops and the circuit breaker rolls back.

### F7 — `_publish-vpn-agent.yml`: no apikey pre-flight, fire-and-forget instance refresh (MEDIUM)

- `publish-vpn-agent.yml:9-12` documents that a fresh instance's user-data **hard-fails** on a missing `/pegasus/wireguard/agent/apikey` SSM param (confirmed: `packages/infra/lib/stacks/wireguard-stack.ts:556-557` exits 1 in cloud-init). Yet `_publish-vpn-agent.yml` never checks the param exists before triggering the refresh — the workflow goes green while the hub fails to boot.
- **Stale doc found during this audit:** `publish-vpn-agent.yml:12` tells the operator to "bootstrap the apikey first per `apps/api/scripts/bootstrap-vpn-agent-apikey.ts`" — that script does not exist anywhere in the repo. The param is actually created by the WireGuardStack `AgentKeyBootstrap` custom resource on first deploy (`wireguard-stack.ts:404,557`). The recovery instruction in the workflow header is a dead end.
- `_publish-vpn-agent.yml:144-153`: `aws autoscaling start-instance-refresh` with `MinHealthyPercentage: 0` is fire-and-forget; no polling of `describe-instance-refreshes`, so a failed rollout (VPN hub down!) is invisible.

### F8 — Temporal Cloud secret ARNs hardcoded with random suffixes (LOW, accepted with mitigation)

`packages/infra/bin/app.ts:125-141` hardcodes complete Secrets Manager ARNs (with the 6-char suffix) per env. This is a _deliberate, well-documented_ workaround (`fromSecretNameV2` ARNs are rejected by the SM API — see comment + memory). The suffix is stable for the secret's lifetime; the only failure mode is rotation-by-recreation, which today fails mid-deploy in ECS with an opaque error. Mitigation needed: a pre-flight `describe-secret` per ARN in the deploy job so a stale suffix fails in seconds with a clear message, not minutes into a CFN update.

### F9 — No `timeout-minutes` on any job in any of the 5 workflow files (LOW effort, real risk)

Default is 360 min. A hung CDK deploy (stuck `UPDATE_IN_PROGRESS`) or wedged `npm ci` blocks the concurrency queue for up to 6 hours — and per F1, everything queued behind it gets churned/cancelled. Observed normal durations: deploys 6-18 min, so generous caps are easy to pick.

### F10 — Repeated setup boilerplate; node version pinned in 4 places

`checkout → setup-node('20') → npm ci → "Fix binary permissions" chmod hack → prisma generate` is copy-pasted across `_deploy.yml` (×2 jobs), `deploy.yml` (e2e job), `_publish-vpn-agent.yml`. Node `'20'` is hardcoded 4 times across the deploy files (root `package.json` engines is `>=18`; no `.nvmrc` exists). A composite action + `.nvmrc` removes this drift surface.

### AI integration assessment

Most findings here need deterministic automation, **not AI** — adding an LLM to path filtering or stack resolution would reduce reliability. One genuinely valuable spot: **AI failure triage in the deploy-watch notifier** (Phase 2). On a failed deploy, fetch the failed job's log tail and have Claude produce a 2-3 sentence diagnosis embedded in the push notification, so the solo dev on a phone knows "Neon migrate lock timeout — re-run" vs "CFN rollback in ApiStack — needs a laptop" without opening logs. Low cost (one Haiku-class call per failure), clearly net-positive. Everything else: no AI needed.

## Plan

### Phase 1 — Quick wins (≈1.5h total, each independently shippable)

- [x] **1.1 Add `timeout-minutes` to every job** (15 min). `_deploy.yml`: `migrate: 15`, `deploy: 45` (full `--all` dispatch took 18 min; CDK retries deserve headroom). `deploy.yml`: `changes: 5`, `e2e-staging: 25`. `temporal-worker.yml`: both jobs `30`. `_publish-vpn-agent.yml`: `publish: 30`. One line per job, e.g.:

  ```yaml
  deploy:
    name: Deploy to ${{ inputs.env-name }}
    timeout-minutes: 45
  ```

- [x] **1.2 Validate E2E URL extraction** (15 min). In `deploy.yml` "Extract staging URLs" step, assert required values after extraction:

  ```bash
  API_URL=$(jq -r '.["pegasus-staging-api"].ApiUrl // empty' "$F")
  WEB_URL=$(jq -r '.["pegasus-staging-frontend"].DistributionUrl // empty' "$F")
  E2E_ROLE_ARN=$(jq -r '.["pegasus-staging-e2e-role"].E2ERoleArn // empty' "$F")
  for v in API_URL WEB_URL USER_POOL_ID E2E_ROLE_ARN; do
    [[ -n "${!v}" ]] || { echo "::error::$v missing from cdk-outputs-staging — output key renamed or stack not in deploy set?"; exit 1; }
  done
  ```

  (Keep `CLIENT_ID`/`TENANT_CLIENT_ID` optional as today via `// empty`.)

- [x] **1.3 Poll ECS rollout in `temporal-worker.yml`** (15 min). After `update-service --force-new-deployment` in both jobs (collapses to one place after 4.2):

  ```bash
  aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"
  STATE=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --query 'services[0].deployments[?status==`PRIMARY`].rolloutState' --output text)
  [[ "$STATE" == "COMPLETED" ]] || { echo "::error::Rollout state=$STATE — circuit breaker likely rolled back"; exit 1; }
  ```

  (`services-stable` waiter = 40×15s ≈ 10 min cap, inside the job timeout.)

- [x] **1.4 VPN agent: SSM apikey pre-flight + instance-refresh polling** (45 min). In `_publish-vpn-agent.yml`:
  - Before "Trigger ASG instance refresh", add (param name from `wireguard-stack.ts:147`):
    ```bash
    aws ssm get-parameter --name /pegasus/wireguard/agent/apikey --query 'Parameter.Name' --output text >/dev/null \
      || { echo "::error::/pegasus/wireguard/agent/apikey missing in ${{ inputs.env-name }} — new hub instances will hard-fail on boot. Deploy WireGuardStack in this env first (its AgentKeyBootstrap custom resource creates the param)."; exit 1; }
    ```
    (No `--with-decryption` → no KMS perm needed; the deploy role needs `ssm:GetParameter` on that param — one-time IAM addition, see Risks.)
  - Fix the stale header comment in `publish-vpn-agent.yml:12`: replace the reference to the nonexistent `apps/api/scripts/bootstrap-vpn-agent-apikey.ts` with "the param is created by WireGuardStack's AgentKeyBootstrap custom resource — deploy that stack in the target env first".
  - Capture the refresh ID and poll to completion:
    ```bash
    REFRESH_ID=$(aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG" \
      --preferences '{"MinHealthyPercentage": 0, "InstanceWarmup": 60}' --query InstanceRefreshId --output text)
    for i in $(seq 1 40); do
      STATUS=$(aws autoscaling describe-instance-refreshes --auto-scaling-group-name "$ASG" \
        --instance-refresh-ids "$REFRESH_ID" --query 'InstanceRefreshes[0].Status' --output text)
      case "$STATUS" in
        Successful) echo "Instance refresh complete."; exit 0 ;;
        Failed|Cancelled|RollbackSuccessful|RollbackFailed) echo "::error::Instance refresh $STATUS"; exit 1 ;;
      esac
      sleep 15
    done
    echo "::error::Instance refresh still $STATUS after 10m"; exit 1
    ```

- [x] **1.5 Pre-flight Temporal secret ARNs in `_deploy.yml`** (20 min). After "Configure AWS credentials", api deploys only:
  ```yaml
  - name: Pre-flight Temporal secret ARNs
    if: inputs.deploy-api == 'true'
    run: |
      set -euo pipefail
      node -e '
        const { TEMPORAL_SECRET_ARNS } = require("./packages/infra/bin/secret-arns.json");
        const arns = TEMPORAL_SECRET_ARNS[process.env.ENV_NAME] ?? {};
        console.log(Object.values(arns).join("\n"));
      ' > /tmp/arns.txt || true
      # Simplest form: grep the ARNs for this env straight out of bin/app.ts
      grep -oE "arn:aws:secretsmanager:[^']*" packages/infra/bin/app.ts | grep ":$(aws sts get-caller-identity --query Account --output text):" | while read -r arn; do
        aws secretsmanager describe-secret --secret-id "$arn" --query Name --output text >/dev/null \
          || { echo "::error::Secret ARN stale (rotated-by-recreation?): $arn — update TEMPORAL_SECRET_ARNS in packages/infra/bin/app.ts"; exit 1; }
      done
  ```
  Implementation note: use the grep-by-account form (drop the `node -e` block) unless 3.1's manifest lands first, in which case read ARNs from the manifest. Filtering by the caller account ID naturally selects the current env's ARNs. Requires `secretsmanager:DescribeSecret` on `pegasus/*` for the deploy role (the role already deploys stacks referencing these secrets, so this is likely already granted via its admin-ish policy — verify on first run).

### Phase 2 — Cancellation-proof change detection + notifications (the core reliability fix, ≈3-4h)

- [ ] **2.1 Diff against the last _successfully deployed_ SHA instead of the previous commit** (2-3h). This makes F1 cancellations benign by construction — the surviving newest run always covers every commit since the last green deploy; no re-dispatch automation needed. Design:
  - **Marker:** a GitHub Actions repo variable `LAST_DEPLOY_SHA`, updated only by a new terminal job in `deploy.yml`:
    ```yaml
    record-deploy:
      name: Record deployed SHA
      needs: [changes, deploy-prod]
      # Only push runs and dispatch target=all evaluated ALL components,
      # so only they may advance the marker. A partial dispatch (target=api)
      # must not — it would swallow undeployed tenant/admin changes.
      if: success() && (github.event_name == 'push' || inputs.target == 'all')
      runs-on: ubuntu-latest
      timeout-minutes: 5
      permissions:
        actions: write
      steps:
        - name: Advance LAST_DEPLOY_SHA
          env:
            GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          run: gh variable set LAST_DEPLOY_SHA --body "${{ github.sha }}" --repo "${{ github.repository }}"
    ```
    (If `GITHUB_TOKEN` is rejected for variable writes on this org plan, fall back to a fine-grained PAT secret `DEPLOY_MARKER_TOKEN` with Variables read/write — note it in the run as a one-time setup.)
  - **Detection:** in the `changes` job, replace `dorny/paths-filter` with explicit `git diff` against the marker (transparent, no action quirks with SHA bases, and composes with the 3.1 manifest):
    ```yaml
    - uses: actions/checkout@v6
      with:
        fetch-depth: 0 # need history back to LAST_DEPLOY_SHA
    - name: Resolve diff base
      id: base
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      run: |
        set -euo pipefail
        BASE=$(gh variable get LAST_DEPLOY_SHA --repo "${{ github.repository }}" 2>/dev/null || true)
        # Fallbacks: unset variable (first run) or GC'd/force-pushed-away SHA → deploy everything.
        if [[ -z "$BASE" ]] || ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
          echo "base=" >> "$GITHUB_OUTPUT"; echo "::warning::No usable LAST_DEPLOY_SHA — forcing full deploy."
        else
          echo "base=$BASE" >> "$GITHUB_OUTPUT"
        fi
    - name: Decide components to deploy
      id: decide
      run: |
        set -euo pipefail
        BASE='${{ steps.base.outputs.base }}'
        changed() { [[ -z "$BASE" ]] || git diff --name-only "$BASE"..HEAD -- "$@" | grep -q .; }
        if [[ "${{ github.event_name }}" == "workflow_dispatch" ]]; then
          ... (existing target case, unchanged) ...
        else
          if changed packages/infra .github/workflows/deploy.yml .github/workflows/_deploy.yml package-lock.json apps/temporal-worker; then
            api=true; tenant=true; admin=true
          else
            changed apps/api apps/tunnel-proxy apps/mssql-executor packages/domain && api=true || api=false
            changed apps/tenant-web && tenant=true || tenant=false
            changed apps/admin-web && admin=true || admin=false
          fi
        fi
        ... (existing output + summary block; also echo "Diff base: ${BASE:-<none — full deploy>}" into the step summary) ...
    ```
    (Path lists shown inline here; once 3.1 lands they are read from the manifest with `jq`.)
  - **Behavioral consequences to accept:** after an E2E-gate failure or unapproved prod run, the next push re-deploys everything that changed since the last green run — idempotent CDK, slightly slower, strictly safer. The old failure mode (silently undeployed code) becomes impossible while runs keep landing; a cancelled run with _no_ successor is covered by 2.2's notification.

- [ ] **2.2 `deploy-watch.yml` — push notifications via ntfy.sh, covering cancelled runs** (45 min). New workflow; must be separate because cancelled-while-queued runs execute zero jobs of their own:

  ```yaml
  name: Deploy watch
  on:
    workflow_run:
      workflows: [Deploy, 'Temporal worker image', 'Publish VPN agent']
      types: [completed]
  permissions:
    actions: read
  jobs:
    notify:
      if: github.event.workflow_run.conclusion != 'success'
      runs-on: ubuntu-latest
      timeout-minutes: 5
      steps:
        - name: Push notification
          env:
            CONCLUSION: ${{ github.event.workflow_run.conclusion }}
            TITLE: ${{ github.event.workflow_run.display_title }}
            URL: ${{ github.event.workflow_run.html_url }}
            WF: ${{ github.event.workflow_run.name }}
          run: |
            PRIO=high; TAG=rotating_light
            if [[ "$CONCLUSION" == "cancelled" ]]; then PRIO=default; TAG=information_source; fi
            curl -fsS -H "Title: $WF $CONCLUSION" -H "Priority: $PRIO" -H "Tags: $TAG" \
              -d "$TITLE — $URL" "https://ntfy.sh/${{ secrets.NTFY_TOPIC }}"
  ```

  One-time setup: pick a random topic string, `gh secret set NTFY_TOPIC`, subscribe in the ntfy mobile app. Zero infrastructure, free. After 2.1 lands, cancelled notifications are informational (superseded run covers the changes); failures are actionable alerts.

- [ ] **2.3 "Prod approval waiting" ping** (15 min). The prod gate waits silently today. Add a final step to the `e2e-staging` job in `deploy.yml`:

  ```yaml
  - name: Notify — prod approval ready
    if: success()
    run: |
      curl -fsS -H "Title: Pegasus prod deploy awaiting approval" -H "Tags: hourglass" \
        -d "${{ github.event.head_commit.message || github.event.workflow_run.display_title || 'manual dispatch' }} — approve: https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}" \
        "https://ntfy.sh/${{ secrets.NTFY_TOPIC }}"
  ```

- [ ] **2.4 (AI, optional) Failure triage in deploy-watch** (1h). In `deploy-watch.yml`, on `conclusion == 'failure'`, fetch the failed job's log tail and include a Claude-generated 2-3 sentence diagnosis in the ntfy body:
  ```yaml
  - name: Fetch failed job logs
    if: env.CONCLUSION == 'failure'
    env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' }
    run: |
      RUN_ID=${{ github.event.workflow_run.id }}
      JOB_ID=$(gh api "repos/${{ github.repository }}/actions/runs/$RUN_ID/jobs?per_page=50" \
        --jq '[.jobs[] | select(.conclusion=="failure")][0].id')
      gh api "repos/${{ github.repository }}/actions/jobs/$JOB_ID/logs" | tail -c 12000 > /tmp/log.txt
  - name: Diagnose
    if: env.CONCLUSION == 'failure'
    run: |
      jq -n --rawfile log /tmp/log.txt '{model:"claude-haiku-4-5",max_tokens:300,messages:[{role:"user",content:("Deploy pipeline job failed. Log tail:\n\n"+$log+"\n\nIn 2-3 sentences: most likely root cause and whether a simple re-run will fix it.")}]}' \
        | curl -fsS https://api.anthropic.com/v1/messages -H "x-api-key: ${{ secrets.ANTHROPIC_API_KEY }}" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" -d @- \
        | jq -r '.content[0].text' > /tmp/diagnosis.txt || echo "(triage unavailable)" > /tmp/diagnosis.txt
  ```
  Append `/tmp/diagnosis.txt` to the ntfy body. Genuinely valuable for phone-first triage; degrade gracefully (`|| echo`) so triage failure never blocks the alert. Requires `gh secret set ANTHROPIC_API_KEY`. This is the only place in this audit where AI adds value — change detection, stack resolution, and rollout polling must stay deterministic.

### Phase 3 — Single-source deploy manifest (≈2-3h)

- [ ] **3.1 Create `.github/deploy-manifest.json`** (30 min) — the one place mapping components → watched paths → stack suffixes:
  ```json
  {
    "components": {
      "api": {
        "paths": ["apps/api", "apps/tunnel-proxy", "apps/mssql-executor", "packages/domain"],
        "stacks": [
          "CognitoStack",
          "DocumentsStack",
          "WireGuardStack",
          "ApiStack",
          "ApiCdnStack",
          "MonitoringStack",
          "TemporalWorkerStack"
        ]
      },
      "tenant-web": {
        "paths": ["apps/tenant-web"],
        "stacks": ["FrontendStack", "FrontendAssetsStack"]
      },
      "admin-web": {
        "paths": ["apps/admin-web"],
        "stacks": ["AdminFrontendStack", "AdminFrontendAssetsStack"]
      }
    },
    "forceAllPaths": [
      "packages/infra",
      "apps/temporal-worker",
      ".github/workflows/deploy.yml",
      ".github/workflows/_deploy.yml",
      ".github/deploy-manifest.json",
      "package-lock.json"
    ],
    "envExtraStacks": { "staging": ["E2EStagingRoleStack"] },
    "envConditionalStacks": {
      "TemporalWorkerStack": ["staging", "prod"],
      "E2EStagingRoleStack": ["staging"]
    }
  }
  ```
  (Paths as directory prefixes, consumed by `git diff -- <path>`; no glob expansion needed.)
- [ ] **3.2 Consume the manifest in `deploy.yml` `changes` job** (30 min). Replace the inline path lists from 2.1 with jq reads:
  ```bash
  mapfile -t API_PATHS < <(jq -r '.components.api.paths[]' .github/deploy-manifest.json)
  mapfile -t FORCE_ALL < <(jq -r '.forceAllPaths[]' .github/deploy-manifest.json)
  changed "${FORCE_ALL[@]}" && { api=true; tenant=true; admin=true; } || { changed "${API_PATHS[@]}" && api=true || api=false; ... }
  ```
- [ ] **3.3 Consume the manifest in `_deploy.yml` "Resolve CDK stack target"** (30 min). Replace the bash-case stack arrays (lines 181-223):
  ```bash
  add_stacks() { while read -r s; do stacks+=("${STACK_PREFIX}-${s}"); done < <(jq -r ".components[\"$1\"].stacks[]" .github/deploy-manifest.json); }
  stacks=()
  [[ "$API"    == "true" ]] && add_stacks api
  [[ "$TENANT" == "true" ]] && add_stacks tenant-web
  [[ "$ADMIN"  == "true" ]] && add_stacks admin-web
  while read -r s; do stacks+=("${STACK_PREFIX}-${s}"); done < <(jq -r ".envExtraStacks[\"$ENV_NAME\"] // [] | .[]" .github/deploy-manifest.json)
  ```
  (Keep the existing `--all` short-circuit when all three are true.)
- [ ] **3.4 Consume the manifest in `deploy.sh`** (20 min) — replaces the hardcoded `TARGET` lists at lines 66-75 and **fixes the existing ApiCdnStack drift**:
  ```bash
  MANIFEST="$REPO_ROOT/.github/deploy-manifest.json"
  if [[ "$API_ONLY" == "true" ]]; then
    TARGET=$(jq -r '.components.api.stacks[] | "PegasusDev-" + .' "$MANIFEST" | grep -v TemporalWorkerStack | tr '\n' ' ')
  elif [[ "$ADMIN_ONLY" == "true" ]]; then
    TARGET=$(jq -r '(.components["admin-web"].stacks + ["CognitoStack","ApiStack"])[] | "PegasusDev-" + .' "$MANIFEST" | tr '\n' ' ')
  ...
  ```
  (Dev-only exclusions like TemporalWorkerStack come from `envConditionalStacks` — filter suffixes whose allowed-env list exists and excludes `dev`.)
- [ ] **3.5 Drift-guard test in `packages/infra`** (45 min). New `packages/infra/lib/__tests__/deploy-manifest.test.ts` — the location matters: `vitest.config.ts` only includes `lib/**/__tests__/**/*.test.ts`. Runs in the existing CI test job, so drift is caught at PR time, not deploy time:
  ```ts
  import { execSync } from 'node:child_process'
  import manifest from '../../../../.github/deploy-manifest.json'
  test.each(['staging', 'prod', 'dev'] as const)('manifest matches cdk ls for %s', (env) => {
    const actual = execSync(`npx cdk ls -c env=${env} --app "npx tsx bin/app.ts"`, {
      cwd: __dirname + '/../..',
    })
      .toString()
      .trim()
      .split('\n')
      .map((id) => id.split('-').slice(1).join('-'))
      .sort()
    const allowed = (s: string) =>
      !(s in manifest.envConditionalStacks) || manifest.envConditionalStacks[s].includes(env)
    const expected = [
      ...Object.values(manifest.components).flatMap((c) => c.stacks),
      ...(manifest.envExtraStacks[env] ?? []),
    ]
      .filter(allowed)
      .filter((s, i, a) => a.indexOf(s) === i)
      .sort()
    expect(actual).toEqual(expected)
  })
  ```
  Now adding a stack to `bin/app.ts` without updating the manifest fails CI with an exact diff — the four sync surfaces collapse to one file plus an automated guard. No AI needed; a deterministic test is strictly better here.

### Phase 4 — Pipeline speed & deduplication (≈3h)

- [ ] **4.1 Skip the `migrate` job when no migration files changed** (45 min). In `deploy.yml` `changes` job add a `migrations` detection (`changed apps/api/prisma/migrations` against the same diff base — burst-safe thanks to 2.1); thread it through:

  ```yaml
  # deploy.yml → _deploy.yml call sites
  with:
    run-migrations: ${{ needs.changes.outputs.migrations }}
  # _deploy.yml
  migrate:
    if: inputs.deploy-api == 'true' && inputs.run-migrations == 'true'
  ```

  On `workflow_dispatch`, always set `migrations=true` (manual runs are recovery runs — be conservative). Belt-and-braces guard inside the `deploy` job so a skipped migrate can never strand pending migrations (cheap: client already generated):

  ```yaml
  - name: Assert no pending migrations
    if: inputs.deploy-api == 'true' && inputs.run-migrations != 'true'
    working-directory: apps/api
    env: { DIRECT_URL: '${{ secrets.DIRECT_URL }}' }
    run: node ../../node_modules/.bin/prisma migrate status # exits non-zero when migrations are pending
  ```

  Saves ~2-3 min serial latency per env on the ~90% of API deploys that ship no migrations.

- [ ] **4.2 Refactor `temporal-worker.yml` into a reusable `_temporal-worker.yml`** (1.5h), mirroring the `_deploy.yml` / `_publish-vpn-agent.yml` precedent. Reusable workflow takes `env-name`; the caller keeps the staging→prod chain (`prod` job `needs: staging` + `environment: prod` gate). Two deliberate fixes while refactoring:
  - **Shared buildx cache scope** — `cache-from/to: type=gha,scope=temporal-worker` (drop the per-env suffix) so the prod build reuses staging's layers: faster, and staging/prod images for a SHA become effectively identical (makes the "build once" header comment true in practice; full build-once-via-`docker save` artifact is possible later but not worth the artifact upload cost now).
  - Fold in the 1.3 `ecs wait services-stable` rollout check (write it once instead of twice).

- [ ] **4.3 Composite setup action + single-sourced node version** (45 min). New `.github/actions/setup-node-workspace/action.yml`:
  ```yaml
  name: Setup node workspace
  inputs:
    prisma-generate: { default: 'false' }
  runs:
    using: composite
    steps:
      - uses: actions/setup-node@v6
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
        shell: bash
      - run: find node_modules/.bin -type f | xargs chmod +x 2>/dev/null || true
        shell: bash
      - run: node ../../node_modules/.bin/prisma generate
        if: inputs.prisma-generate == 'true'
        shell: bash
        working-directory: apps/api
  ```
  Add `.nvmrc` containing `20` (matching today's workflows — bumping to 24 is a separate, deliberate change since local dev already standardizes on 24 per the Node-version gotcha; do it in its own commit so a runtime behavior change is bisectable). Replace the 4 copy-pasted blocks in `_deploy.yml` (×2), `deploy.yml` (e2e), `_publish-vpn-agent.yml`.

## Files to Modify / Create

| File                                              | Action                                                                                                                               | Phases                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `.github/workflows/deploy.yml`                    | modify — timeouts, URL validation, diff-base detection, `record-deploy` job, prod-approval ping, migrations output, composite action | 1.1, 1.2, 2.1, 2.3, 3.2, 4.1, 4.3 |
| `.github/workflows/_deploy.yml`                   | modify — timeouts, secret-ARN pre-flight, manifest-driven stack target, `run-migrations` input + guard, composite action             | 1.1, 1.5, 3.3, 4.1, 4.3           |
| `.github/workflows/temporal-worker.yml`           | modify — becomes thin caller of reusable workflow                                                                                    | 1.1, 1.3, 4.2                     |
| `.github/workflows/_temporal-worker.yml`          | **create** — reusable per-env build+push+rollout-wait                                                                                | 4.2                               |
| `.github/workflows/_publish-vpn-agent.yml`        | modify — timeout, apikey pre-flight, refresh polling, composite action                                                               | 1.1, 1.4, 4.3                     |
| `.github/workflows/publish-vpn-agent.yml`         | modify — fix stale bootstrap-script reference in header comment                                                                      | 1.4                               |
| `.github/workflows/deploy-watch.yml`              | **create** — workflow_run notifier (+ optional AI triage)                                                                            | 2.2, 2.4                          |
| `.github/deploy-manifest.json`                    | **create** — single source for component→paths→stacks                                                                                | 3.1                               |
| `packages/infra/test/deploy-manifest.test.ts`     | **create** — drift guard vs `cdk ls`                                                                                                 | 3.5                               |
| `packages/infra/deploy.sh`                        | modify — manifest-driven TARGET lists (fixes ApiCdnStack drift)                                                                      | 3.4                               |
| `.github/actions/setup-node-workspace/action.yml` | **create** — shared setup composite                                                                                                  | 4.3                               |
| `.nvmrc`                                          | **create** — `20` (single-sourced node version)                                                                                      | 4.3                               |
| `packages/infra/bin/app.ts`                       | unchanged (stays source of truth; secret ARNs stay hardcoded per F8, now pre-flighted)                                               | —                                 |

One-time operator setup (not files): `gh secret set NTFY_TOPIC` (+ subscribe in ntfy app); optional `gh secret set ANTHROPIC_API_KEY` (2.4); fine-grained PAT `DEPLOY_MARKER_TOKEN` only if `GITHUB_TOKEN` can't write repo variables (2.1); `ssm:GetParameter` on `/pegasus/wireguard/agent/apikey` + verify `secretsmanager:DescribeSecret` for the deploy roles (1.4, 1.5).

## Side Effects & Risks

- **2.1 over-deployment by design:** after a failed/unapproved run, the next push redeploys everything changed since the last green deploy. CDK is idempotent so this is safe, but a no-change CFN update still takes minutes. Accepted: a few slow deploys beat one silent non-deploy.
- **2.1 marker fallback:** if `LAST_DEPLOY_SHA` is unset/unreachable (first run, force-push), the run forces a full deploy with a `::warning`. Loud and safe, never silent.
- **2.1 marker writes:** if the repo plan rejects `GITHUB_TOKEN` variable writes, the `record-deploy` job fails visibly (and 2.2 notifies) — falls back to the PAT path; it can never silently corrupt detection because a failed write just leaves the older (more conservative) base.
- **2.1 `fetch-depth: 0`:** full-history checkout in the `changes` job adds ~5-15s on this repo size. Negligible.
- **3.x manifest cutover:** behavior change risk if the manifest mistranscribes a stack list — mitigated by 3.5 running in the same PR's CI, and by validating with a staging `workflow_dispatch` before any prod approval.
- **3.5 test cost:** `cdk ls` synthesizes the app 3× (~30-90s in CI test job). If too slow, drop the `dev` case (staging covers the superset minus E2E role nuance).
- **1.4 IAM:** pre-flight needs `ssm:GetParameter` on the apikey param for the per-env deploy role; until granted, the step fails _closed_ (treats permission error as "missing param"). Grant before merging or scope the first rollout to dev.
- **4.1 migration skip:** the in-deploy-job `prisma migrate status` guard means a wrongly-skipped migrate job fails the deploy _before_ CDK runs rather than shipping a Lambda against an unmigrated schema. Note: guard relies on `migrate status` exiting non-zero with pending migrations (true on Prisma 5.4+; this repo is on Prisma 7).
- **4.2 cache scope merge:** staging and prod now share GHA buildx cache — intended; cache poisoning is not a concern (same repo, same trust domain).
- **Notifications dependency:** ntfy.sh is a free third-party service; an outage only mutes alerts (steps are `curl -fsS` inside notify-only jobs — never blocks a deploy; 2.3's step should append `|| true` so a notify hiccup can't fail the E2E gate job).
- **Concurrency semantics unchanged:** queued runs will still be _cancelled_ by newer pushes (GitHub behavior, not configurable) — after 2.1 this is benign, and 2.2 makes each one visible.

## Acceptance Criteria / Verification

- [ ] **Cancellation safety net (the headline):** with all of Phase 2 merged, reproduce the 2026-06-09 failure shape — push 3 commits to main within ~60s where commit 2 touches `apps/api/` and commit 3 is plans-only. Verify: middle run shows `cancelled` in `gh run list --workflow deploy.yml --limit 5`; the final (surviving) run's step summary prints `Diff base: <last green SHA>` and its Deploy-plan table shows `api: true`; after prod approval, `gh variable get LAST_DEPLOY_SHA` equals the head SHA. **Zero manual re-dispatch.**
- [ ] **Notification path:** `gh run cancel <queued-run-id>` (or the burst above) produces an ntfy push within ~1 min; a forced failure (e.g. temporarily bogus stack name on a branch-dispatched run) produces a high-priority push, with a Claude diagnosis paragraph if 2.4 is enabled.
- [ ] **Prod-approval ping:** every push deploy that passes the E2E gate sends the "awaiting approval" notification before the prod job is approved.
- [ ] **Manifest single-sourcing:** `cd packages/infra && npx vitest run test/deploy-manifest.test.ts` passes; then add a dummy `new DocumentsStack(app, `${stackIdPrefix}-ScratchStack`, …)` locally and confirm the test fails with a set diff naming `ScratchStack`. `bash packages/infra/deploy.sh --api-only --dry-run` prints a TARGET list that now includes `PegasusDev-ApiCdnStack`.
- [ ] **Stack-resolution parity:** for a staging api-only run, the `_deploy.yml` "Resolve CDK stack target" log prints exactly the pre-refactor set plus `PegasusStaging-E2EStagingRoleStack` (compare against a pre-change run log).
- [ ] **Migration skip:** an API-only push with no `apps/api/prisma/migrations/` changes shows `Migrate staging database — skipped` in the run graph and the deploy job's "Assert no pending migrations" step passing; a push that adds a migration file runs the migrate job in both envs. Net run duration for migration-less API deploys drops ~4-6 min vs the 8-16 min baseline above.
- [ ] **Pre-flights fail fast and loud:** delete `/pegasus/wireguard/agent/apikey` in **dev** only, dispatch `publish-vpn-agent` with `env=dev`, confirm the run fails at "Pre-flight" in <1 min with the bootstrap-script error message (then restore via `apps/api/scripts/bootstrap-vpn-agent-apikey.ts`). Temporal ARN pre-flight: verify the step lists/validates both ARNs in a normal staging run log.
- [ ] **Rollout polling:** a temporal-worker push shows `services-stable` wait + `rolloutState: COMPLETED` in the log; a vpn-agent publish shows the instance-refresh poll ending in `Successful`.
- [ ] **Timeouts:** `grep -c 'timeout-minutes' .github/workflows/{deploy,_deploy,temporal-worker,_temporal-worker,publish-vpn-agent,_publish-vpn-agent,deploy-watch}.yml` — every job has one (expected total ≥ 10).
- [ ] **No regression in the happy path:** one full `workflow_dispatch target=all` run goes green end-to-end (staging → E2E gate → prod) and total duration stays ≤ the 18 min baseline.
