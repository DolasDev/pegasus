# Temporal key rotation and expiry alarms (3b.1 follow-on)

- **Branch:** `feat/temporal-key-rotation`, started with
  `/workstream-start feat temporal-key-rotation ~/.claude/plans/temporal-key-rotation.md`.
- **Parent plan:** `plans/in-progress/tenant-temporal-namespaces.md`. This
  implements the "Key rotation and expiry alarm" item in its Stage B progress
  list, so update that item when this lands.
- **User request (2026-10-12):** _"If the rotation can be reasonably automated
  do that, if not I'll need some sort of reminder to rotate the keys to ensure
  service doesn't go down."_
- **Status:** approved 2026-10-12; steps 1–7 and 9 done 2026-10-12 (see
  **Progress** at the end). Archived when the PR opened: step 8 (staging
  acceptance) runs after deploy and is tracked by the parent plan's **Step 9**
  in `plans/in-progress/tenant-temporal-namespaces.md`, as is the ⚠️ user
  `--tag-only` action.

## Facts this plan rests on (verified 2026-10-12)

- **A provisioner key can mint a key for its own service account.** A test
  minted a key on `pegasus-staging-provisioner`, deleted it, and the delete was
  verified (404). Cloud refuses an expiry under 24 h
  (`400 expiry must be after <now+24h>`).
- A provisioner key **can list its own keys** with their expiry
  (`GET /cloud/api-keys`, with or without `owner_id`), and sees **no other
  key** in the account.
- **Keys in the account** (`tcld apikey list` as admin; there are only four):

  | Key                                                                    | Owner                                                                  | Expires              |
  | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------- |
  | `pegasus-staging-provisioner-key` (`yyDenH2L0rl8UYIpxVy6nD5T7f1XknqW`) | SA `69b2cae2cb2048c3ab5008dd009d7d86`                                  | 2027-10-11T20:27:57Z |
  | `pegasus-prod-provisioner-key` (`JxKvv9NxbBxOLRqOvdGLHwNRiLe3G9Tn`)    | SA `064171003878499392a7f408338268bd`                                  | 2027-10-11T20:28:51Z |
  | `pegasus-staging-api-key` (`pscs5j0ESTdEtTf6EQk3yxQXsiDH4puz`)         | `pegasus-staging-service-account` (`e33a25fa38a34fbe8ee3985514d2d7b6`) | 2028-06-04T16:10:23Z |
  | `pegasus-prod-api-key` (`e9wITZsUqD6GVTvCi67ypzPlAfXujXfB`)            | `pegasus-prod-service-account` (`f3442e2093bc45958874804995914a63`)    | 2028-06-04T16:26:37Z |

  The platform keys were matched to their service accounts **by name**: the
  `tcld` listing doesn't show owners. Confirm it in step 6 below.

- **The handler reads the provisioner secret on every invocation**
  (`lambda-temporal-provisioner.ts` → `provisionerApiKey()`). A
  `PutSecretValue` therefore takes effect on the next run, with no redeploy.
- **The platform key is baked in at deploy time.** CloudFormation injects
  `pegasus/<env>/temporal-cloud`'s `apiKey` as a plaintext env var into the
  API, reconcile and dispatcher Lambdas (`api-stack.ts`, the
  `TEMPORAL_CLOUD_API_KEY` env var). ECS injects it into the stdlib worker and
  the tenant runners at task start. So rotating it means a redeploy and new
  ECS tasks. It can't be automated from the provisioner, which can't see that
  key anyway.
- Existing pieces to reuse:
  - The daily rule `TemporalProvisionerRetireKeysSchedule` (`api-stack.ts`
    ~:908), and its infra test asserting `Input: {action:'retire-previous-keys'}`
    (`api-stack.test.ts` ~:1542).
  - `runTemporalProvisioner` with `withLease`, `rotate` and
    `retire-previous-keys` (`apps/api/src/lib/temporal-provisioner.ts`).
  - `namespaceKeyAuthorized` (`lib/temporal-namespace-readiness.ts`).
  - Metric constants in `packages/infra/lib/metrics.ts`
    (`PEGASUS_WORKFLOWS_METRIC_NAMESPACE = 'Pegasus/Workflows'`). Emitters
    duplicate the names literally, because apps/api can't import infra.
  - The days-remaining alarm pattern: `TariffCoverageDaysAlarm` in
    `monitoring-stack.ts` (~:325): Maximum statistic, 1-day period,
    `LESS_THAN_THRESHOLD`, `treatMissingData: BREACHING`, `wire(...)` to the
    alarm SNS topic, which emails `dolasllc@gmail.com` in staging and prod.

## Design

Three classes of key, three answers:

### 1. Provisioner key: rotate itself (automated)

The new action `daily-maintenance` (see 4) calls `rotateOwnKeyIfDue`:

1. List own keys (`listApiKeys` on the provisioner's own SA). **First step
   when executing:** confirm the REST listing returns each key's `owner_id` in
   `spec`, so the provisioner can discover its own SA id. If it doesn't, pass
   `TEMPORAL_PROVISIONER_SERVICE_ACCOUNT_ID` per env from `bin/app.ts`; both
   ids are listed above.
2. **Find the current key:** the `keyId` stored in the secret JSON, written by
   step 5 of the first rotation. Until then, use the only key on the SA. With
   more than one key and no `keyId`, take the latest expiry and log a warning.
3. If it expires in **≥ 30 days** (and the event has no `force: true`), stop.
4. Mint a 1-year key for its own SA. Verify the **new** token with a fresh
   Cloud Ops client (`GET /cloud/api-keys`), retrying for up to 5 minutes for
   propagation. If it never works, stop, record a failure (metric, see 5) and
   leave the secret untouched.
5. `PutSecretValue` with `{"apiKey": <new>, "keyId": <new id>, "expiresAt": <iso>}`.
   The handler only reads `apiKey`, so the shape stays compatible.
6. **Never delete the old key.** It expires on its own within 30 days, and
   `AWSPREVIOUS` still holds its value. This removes the only dangerous failure
   mode (deleting the one working key).
7. Never log either token. The audit log records the old and new key ids.

**IAM:** `secretsmanager:PutSecretValue` on **only** the imported provisioner
secret (`provisionerSecret.grantWrite(provisionerFunction)`; check that
`grantWrite` doesn't also grant things that aren't needed, e.g.
`UpdateSecret`/`DeleteSecret`, and hand-write the statement if it does). An
infra test pins that exactly one policy holds `PutSecretValue`, and that it's
the provisioner's.

### 2. Tenant keys: scheduled rotation with a pending slot (automated)

Today `rotate` stores the new key as current immediately, has **no readiness
check**, and has **no rollback** (the plan already lists that as owed).
Automating it as-is would quietly hand runners an unauthorized key. Fix both
with a **pending** slot:

- **Migration (additive):** add nullable columns `pendingApiKeyId` and
  `pendingApiKeyCiphertext` to `TenantTemporalNamespace`.
- **Repository:**
  - `storePendingKey` (encrypts, as `storeKey` does);
  - `promotePendingKey`, a transaction that sets previous = current and
    current = pending, clears pending, and sets `previousKeyRetireAt`. It
    refuses while `previousApiKeyId` is set, as `rotateKey` does today;
  - `clearPendingKey`;
  - `getDecryptedPendingKey`, used only by the readiness check.
- **New `rotate` flow:**
  1. If a stale pending key exists, delete it in Cloud and clear it.
  2. Retire an expired previous key (as today; it already checks that the
     current key works).
  3. Mint a key.
  4. `storePendingKey` **immediately** (token-once still holds).
  5. Wait for the operation.
  6. Run the `namespaceKeyAuthorized` loop on the **pending** key (10 minutes).
  7. If ready, `promotePendingKey`.
  8. On a timeout: `setLastError`, emit `TemporalKeyRotationFailed`, and leave
     the pending key for the next run to discard. The row stays READY with
     the **old key still current**, so the broker never serves an unverified
     key.
- `repo.rotateKey` (store-as-current) is then only used by tests; remove it
  if nothing calls it.
- **Schedule:** `daily-maintenance` rotates every READY row whose
  `apiKeyExpiresAt < now + 30 days`, `previousApiKeyId IS NULL` and with no
  live lease. Do them sequentially (the Cloud Ops cap is 10 concurrent
  operations, and each `rotate` claims its own lease). Cap the batch (e.g. 20
  a day) so one run stays well inside the 15-minute timeout; the next day
  picks up the rest.
- This **retires the "Owed before 3b.2 depends on rotation" item** in the
  parent plan, which says to fix it with a pending slot or a swap-back. Update
  that item.

### 3. Platform keys: manual runbook plus reminder

`scripts/temporal/rotate-platform-key.sh <staging|prod>` needs an admin
`tcld login`, and the `dolas-pegasus-<env>` AWS profile:

1. Pre-flight:
   - read the secret's **key names** only (`jq 'keys'`; never print values),
     to confirm the JSON shape is `{"apiKey": ...}`;
   - find the SA `pegasus-<env>-service-account` and its current key(s).
2. Mint a 1-year key for that SA. The secret stays in a 0600 temp file,
   shredded on exit, as in `create-provisioner.sh`.
3. `PutSecretValue` on `pegasus/<env>/temporal-cloud`, preserving any other
   JSON fields.
4. Tag the secret `expiresAt=<new expiry ISO>` and `keyId=<new id>`.
5. **Print, don't run, the follow-up:**
   - redeploy the API stack through CI (`deploy.yml`, `workflow_dispatch`
     `component=api`; check the exact input name);
   - `aws ecs update-service --force-new-deployment` for
     `pegasus-temporal-worker-<env>`;
   - tenant runners pick the key up at their next task start (they're
     scale-to-zero);
   - **after** all of that, and no sooner than 24 h later:
     `tcld apikey delete -i <old id>`.

`--tag-only` mode only sets the `expiresAt`/`keyId` tags from the current
`tcld apikey list` data. Use it now to seed both platform secrets with the
2028-06-04 expiries above.

### 4. One daily action and the reminder metric

Replace the daily rule's input with `{action: 'daily-maintenance'}`. Keep
accepting `retire-previous-keys` in the handler for one release, because the
Lambda code and the rule deploy together but a stale queued event could still
arrive. `daily-maintenance` runs these in order, **each isolated**: one
failing must not skip the rest, and each failure is logged and counted.

1. retire previous keys (the existing sweep);
2. discard stale pending tenant keys and rotate expiring tenant keys;
3. rotate its own key if due;
4. **publish the gauges** (`PutMetricData`, `Pegasus/Workflows`):
   - `TemporalKeyDaysToExpiry` with dimension `KeyClass`, whose values are:
     - `provisioner`: days until its current key expires (after any rotation
       above);
     - `tenant`: the **minimum** across READY rows. With no READY rows, emit
       365 so the alarm stays green; document that sentinel;
     - `platform`: from the `expiresAt` **tag** on `pegasus/<env>/temporal-cloud`,
       read with `DescribeSecret` (metadata only; **never**
       `GetSecretValue`, so the provisioner never holds the platform key). A
       missing or invalid tag emits **0**, which fires the alarm until
       someone records it.
   - `TemporalKeyRotationFailed` (Count): 1 per failed rotation (tenant or
     provisioner), and 0 otherwise so the alarm has data.

**IAM additions for the provisioner:**

- `secretsmanager:DescribeSecret` on the platform secret ARN only. Pass it as
  env `TEMPORAL_PLATFORM_SECRET_ARN`; it's `props.temporalCloudSecretArn`,
  already in scope.
- `cloudwatch:PutMetricData` with the `cloudwatch:namespace = Pegasus/Workflows`
  condition, copied from the reconcile Lambda.

**Alarms (`monitoring-stack.ts`)**, gated on a new prop
`temporalKeyExpiryAlarms: boolean`, which `bin/app.ts` sets true for staging
and prod only. Otherwise dev, which has no provisioner, would alarm forever on
BREACHING missing data.

- `pegasus-temporal-key-expiry-<keyclass>`, one per `KeyClass`: Maximum,
  1-day period, `< 30`, BREACHING on missing data. Descriptions:
  - **provisioner:** "self-rotation failed; check provisioner logs; manual
    fallback is `create-provisioner.sh`-style mint + PutSecretValue";
  - **tenant:** "the rotation sweep is failing; see `lastError` on
    `TenantTemporalNamespace` rows";
  - **platform:** "run `scripts/temporal/rotate-platform-key.sh <env>`".
- `pegasus-temporal-key-rotation-failed`: Sum > 0 over 1 day,
  NOT_BREACHING.

## Steps (test-first, in order)

1. **Verify assumptions before coding** (read-only, with the staging
   provisioner key; reuse `scripts/temporal/guardrail-probe.py`'s helpers in a
   scratch script):
   - does `GET /cloud/api-keys` return `spec.owner_id`?
   - does `GET /cloud/api-keys?owner_id=<a scoped tenant SA>` list that SA's
     keys? That's Stage B finding 4, still unverified. It only becomes
     testable once a tenant namespace exists, so it can be confirmed in step 8.
2. **Migration and repository** for the pending slot, with real-DB tests
   (`describe.skipIf(!hasDb)`).
3. **Provisioner logic** (`temporal-provisioner.ts`):
   - the pending-slot `rotate`;
   - `rotateOwnKeyIfDue` (with injectable secret read/write);
   - `daily-maintenance` with isolated sub-steps;
   - the gauge computation, as a pure function plus an injectable metric
     publisher.

   Extend the `FakeCloud` harness in `temporal-provisioner.test.ts`:
   own-key listing, a `keyAuthorized` toggle per token, and the 24 h
   minimum-expiry rule. Tests:
   - pending key never served before readiness; timeout leaves the old key
     current; the next run discards the stale pending key;
   - promote moves current to previous with a retire time;
   - the sweep only touches rows expiring within 30 days, respects the batch
     cap and survives one row failing;
   - own-key rotation: not due → no-op; due → mint, verify, put; new key never
     verifies → secret untouched plus failure metric; `force` overrides the
     threshold; the old key is never deleted;
   - gauges: tenant minimum, the 365 sentinel, a missing platform tag → 0;
   - no token in any log line.

4. **Lambda wiring** (`lambda-temporal-provisioner.ts`):
   - the Secrets Manager `PutSecretValue` and `DescribeSecret` adapters and
     the CloudWatch publisher;
   - event validation for `daily-maintenance` and `{action: 'rotate-own-key', force?: boolean}`;
   - keep accepting `retire-previous-keys` for now.
5. **Infra:**
   - API stack: the rule input; `grantWrite` (or a hand-written statement);
     `DescribeSecret` on the platform ARN and its env var; `PutMetricData`
     with the namespace condition;
   - MonitoringStack: the alarms and the `temporalKeyExpiryAlarms` prop;
   - `bin/app.ts`: wire the prop;
   - metric-name constants in `metrics.ts`;
   - tests: PutSecretValue in exactly one policy, DescribeSecret scoped to
     the platform ARN only, no `GetSecretValue` on the platform secret for
     the provisioner, alarms present only when the prop is true, the rule
     input updated (fix the existing assertion).
6. **`scripts/temporal/rotate-platform-key.sh`** with a `--tag-only` mode
   (shellcheck-clean; key handling as in `create-provisioner.sh`). Update
   `scripts/temporal/README.md`: replace the "Keys that expire" table's
   "follow-on PR" wording with how each class is now handled.
   - ⚠️ **User, after merge:** run `rotate-platform-key.sh staging --tag-only`
     and then `prod --tag-only`, to seed the platform `expiresAt` tags.
     Without them the platform alarm fires (by design) once the gauges
     publish. Alternatively run `--tag-only` before the deploy, since it only
     touches tags.
7. **Docs:**
   - `GOTCHAS.md`: the 24 h minimum key expiry; that a provisioner can
     self-rotate; the platform key is baked in at deploy time;
   - `DECISIONS.md`: automated vs manual by key class, and why the old key is
     never deleted on self-rotation;
   - the parent plan: tick the rotation item, and retire the "Owed before
     3b.2" rollback item.
8. **Acceptance (staging, after deploy), together with parent-plan Step 9**
   if that hasn't run yet: provision a test tenant through admin-web, then:
   - invoke `{action: 'rotate-own-key', force: true}` on the staging
     provisioner. The secret's `AWSCURRENT` has a new `keyId`, the old key
     still exists, and the next `daily-maintenance` run succeeds with the new
     key;
   - force a tenant rotation (admin-web Rotate key). The pending key is
     verified, then promoted; the broker serves the new key; the previous key
     is retired after its grace (or check `previousKeyRetireAt` is set);
   - check Stage B finding 4 against the tenant's scoped SA;
   - the CloudWatch gauges appear for all three `KeyClass` values (platform
     > 0 once the tags are seeded), and the alarms are OK;
   - deprovision the test tenant.
   - Delete the old provisioner key in staging only if you want a clean
     account; it expires on its own anyway.
9. `/workstream-finish` with `/security-review`: the scope is IAM write on a
   secret, a new metadata read on the platform secret, and token handling in
   the self-rotation.

## Risks

- **Self-rotation writes the only copy of the provisioner's credential.**
  Mitigations: verify before writing, never delete the old key, and
  `AWSPREVIOUS` keeps the old value. Recovery: an admin re-runs a
  `create-provisioner.sh`-style mint, or restores `AWSPREVIOUS` with
  `aws secretsmanager update-secret-version-stage`. Put this in the README.
- **The pending-slot migration** is additive (two nullable columns). It must
  pass `check-migration-safety.sh`.
- **Daily-maintenance runtime:** batch caps keep it under 15 minutes. If a
  readiness loop runs long, the lease expires and the next day resumes.
- **Prod gets self-rotation the moment this deploys,** but it only fires
  within 45 days of 2027-10-11 (from ~2027-08-27), so there's no immediate
  effect. Tenant rotation only fires for rows within 45 days of expiry, and
  there are none in prod yet. Step 8's forced run on staging is the only live
  proof of self-rotation before then.

## Progress

- [x] **Step 1** (2026-10-12): `GET /cloud/api-keys` as the staging
      provisioner returns `spec.ownerId` and `spec.expiryTime`, with and without
      `owner_id`, and only its own key. So no `TEMPORAL_PROVISIONER_SERVICE_ACCOUNT_ID`
      is needed. The body is lowerCamel (`apiKeys`); `field()` reads both. Both
      provisioner secrets use the AWS-managed KMS key (no KMS grant needed for
      `PutSecretValue`). Platform-key owners confirmed **by id** with
      `tcld apikey get` (`.owner.ownerId`): `pegasus-<env>-api-key` belongs to
      `pegasus-<env>-service-account` in both envs. Stage B finding 4 (listing a
      scoped tenant SA's keys) stays for step 8.
- [x] **Step 2:** migration `20261012200000_tenant_temporal_pending_key` (two
      nullable columns; `migrate dev --create-only` showed no drift). Repository:
      `storePendingKey`, `promotePendingKey`, `clearPendingKey`,
      `getDecryptedPendingKey`, `findWithPendingKey`, `findDueForRotation`,
      `earliestReadyKeyExpiry`; `rotateKey` removed (only its tests used it).
- [x] **Step 3:** provisioner refactored into per-tenant inner functions, then
      the pending-slot `rotate`, `rotateOwnKeyIfDue`, `daily-maintenance` and
      `keyExpiryGauges`. Cloud Ops client gained `listOwnApiKeys`.
- [x] **Step 4:** Lambda adapters (PutSecretValue, DescribeSecret tag,
      CloudWatch), event validation for `daily-maintenance` and `rotate-own-key`.
- [x] **Step 5:** API stack (rule input, hand-written IAM), MonitoringStack
      alarms behind `temporalKeyExpiryAlarms` (set where a provisioner secret is
      configured), metric constants.
- [x] **Step 6:** `scripts/temporal/rotate-platform-key.sh` (shellcheck-clean
      via `uvx --from shellcheck-py`); its key discovery dry-run read-only against
      both envs. README updated.
- [x] **Step 7:** GOTCHAS, DECISIONS, parent plan.
- [ ] **Step 8:** staging acceptance, after deploy.
- [ ] ⚠️ **User:** `rotate-platform-key.sh staging --tag-only`, then `prod`.

**Deviations from the design above, and why:**

- **Rotation starts at 45 days, not 30; the alarms stay at 30.** With both at
  30, a key would page on the day it first became due, before rotation had a
  try. The gap gives the daily run 15 attempts first.
- **With several own keys and none recorded, assume the _soonest_-expiring,
  not the latest.** An orphan key from a self-rotation that died before
  writing the secret would be the latest, and would hide the real key's
  expiry from both the rotation check and the gauge.
- **The tenant sweep runs on a start budget (5 min), not only a count cap.**
  One rotation can take 15 min (operation wait plus the 10-minute readiness
  window), and the Lambda timeout can't be caught. So own-key rotation and the
  gauges run _before_ the sweep, and the sweep stops starting rotations after
  5 minutes. A rotation cut off mid-way is safe (its key is still pending).
- **A row whose last attempt failed is swept last** (`lastError` set sorts
  after), and a successful promote clears `lastError`. Otherwise a row that
  always times out would spend the whole budget every day and starve the rest
  (a test reproduced exactly that).
- **The rotate's first step deletes every key on the tenant's SA that is
  neither current nor previous**, not only the recorded pending key, to cover
  a run that died between minting and storing (token-once).
- **`TemporalKeyRotationFailed` is published twice on a day with sweep
  failures:** once with the gauges (failures so far, 0 when healthy, so the
  alarm always has data), once after the sweep. The alarm sums them.
- **IAM:** `PutSecretValue` is hand-written, because `grantWrite` also grants
  `UpdateSecret` and `UpdateSecretVersionStage`.
