# 3b.2: route tenant Automations to their own Temporal namespace (SEED, not yet approved)

- **What this is:** the seed for the next workstream after 3b.1. It's a
  draft. A new session turns it into a detailed plan, gets the user's
  approval, then starts it with
  `/workstream-start feat tenant-temporal-routing <approved plan>`.
- **Written:** 2026-10-15, at the end of the 3b.1 thread.
- **Parent plans:**
  - `plans/in-progress/durable-workflow-worker.md` (3a/3b/3c);
  - `plans/in-progress/long-running-workflows-and-automations.md` (D1–D5);
  - 3b.1, done: `plans/completed/f0d47ffb-tenant-temporal-namespaces.md`. Its
    "Design decision: no platform service account" and "3b.2 sketch" sections
    are the source of this file.

## Why

D5 (verified live in Phase 2): a tenant's code is isolated only once it runs
in its **own** Temporal Cloud namespace with a namespace-scoped key. Today
every Automation still runs in the shared `pegasus-<env>` namespace with the
shared key. 3b.1 built the namespaces; 3b.2 is what makes anything use them.

## Where things stand (2026-10-15)

- **The provisioner is live in staging and prod** (`temporal-provisioner`
  Lambda per env).
  - It creates `pg-<env>-<12 hex of tenantId>`, a namespace-scoped **Write**
    SA and a 1-year key, stored KMS-encrypted on `TenantTemporalNamespace`.
  - Admin-web drives it: Provision, Retry, Rotate key, Deprovision.
  - Row statuses today: `PROVISIONING | READY | FAILED | DEPROVISIONING`.
- **Keys rotate themselves** (#838):
  - The daily `daily-maintenance` run rotates tenant keys from 45 days out,
    through a **pending slot**: a key is served only after it passes the
    readiness check.
  - The previous key is retired **24 h** after a swap.
  - Expiry alarms fire under 30 days.
- **Staging acceptance passed** 2026-10-13 (Step 9 of the 3b.1 plan),
  covering provision, resume, isolation, rotation and deprovision.
- **Nothing routes to tenant namespaces yet.** Prod has **no**
  `TenantTemporalNamespace` rows. In staging, the test tenant
  `4b2e0267-c597-451e-a367-771dfac52fba` ("AVP Smoke 2026-05-08") was
  deprovisioned and can be provisioned again for 3b.2 acceptance.

## Facts 3b.2 relies on (verified; details in GOTCHAS "Temporal Cloud Ops")

- **Reading a tenant's key:**
  - `tenant-temporal-namespace.repository` → `getDecryptedKey(tenantId)`
    returns `{namespace, grpcAddress, apiKeyId, apiKey}` for the **current**
    key only. The pending key is never returned.
  - The broker-credentials route (`handlers/workflow-internal.ts`, Stage A)
    already uses it.
- **Endpoint:** the key works through the namespace endpoint (the row's
  `grpcAddress`, `<ns>.tmprl.cloud:7233`) **and** the regional endpoint
  `us-east-1.aws.api.temporal.io:7233`. It is refused by `pegasus-<env>` on
  both.
- **Rotation is invisible to the DB reader, but not to a cached client.**
  After a swap the old key works for 24 h, then it's deleted. A client or
  runner holding a key must **re-fetch on an auth failure**
  (PERMISSION_DENIED / UNAUTHENTICATED).
- **A new key's permissions land per API, not all at once.**
  `lib/temporal-namespace-readiness.ts` (`namespaceKeyAuthorized`) is the
  check for that.
- **Cloud Ops facts** (if 3b.2 touches the Ops API at all):
  - at most 10 concurrent async operations per account;
  - the 100-namespace cap is shared by staging and prod (⚠️ the user still
    owes a cap-raise request to Temporal support);
  - the provisioner can't list a tenant's keys (403);
  - an `async_operation_id` must be unique per operation.

## Lessons from 3b.1 to carry into the tests

- **Make the fakes enforce the real service's refusal rules.** Two live bugs
  (#844, #845) shipped because `FakeCloud` allowed things Temporal Cloud
  refuses. For 3b.2, any fake Temporal client must:
  - refuse a scoped key on another namespace;
  - fail with PERMISSION_DENIED once a key is retired;
  - let the code re-fetch afterwards.
- **An acceptance probe must tell "refused" from "gone"** (403 vs 404), and
  must check the status of every call it makes. The Stage B guardrail probe
  "passed" while ignoring a 403.
- **Staging tooling recipe** (for acceptance checks from a laptop):
  - run scratch TypeScript with
    `NODE_PATH=<repo>/apps/api/node_modules:<repo>/node_modules`;
  - read `DATABASE_URL` / `WORKFLOW_TOKEN_KMS_KEY_ID` from a Lambda's config
    into environment variables, never printing them;
  - re-run `npm run db:generate` after schema PRs;
  - AWS SSO expires often: `aws sso login --profile dolas-pegasus-<env>
--use-device-code`.

## Sketch (from the 3b.1 plan; anchors re-verified 2026-10-15)

1. **Execution rows carry their namespace:** add
   `WorkflowExecution.temporalNamespace` (additive, nullable = the shared
   namespace) and write it at start.
2. **Per-namespace client:** today `lib/temporal-client.ts` →
   `getTemporalClient()` is a single shared client. Make it per namespace,
   chosen by **route and tenant**:
   - STDLIB always goes to the platform namespace, with today's
     `pegasus-<env>-service-account` key (Write-only since 3a).
   - TENANT_RUNNER goes to the tenant's namespace once the row is **ACTIVE**,
     with **that tenant's own key** (`getDecryptedKey`).
   - Cache clients per namespace with a TTL; **evict and re-fetch on an auth
     failure** (rotation).
   - There's no platform service account (a user decision, 2026-10-05).
   - Callers (by function):
     - `lib/start-workflow-execution.ts`, the start path;
     - `handlers/workflows.ts`, history and cancel (retry goes through
       start);
     - `lambda-reconcile-workflow-executions.ts`.

     They read the namespace **from the execution row**.
3. **KMS decrypt for the reconcile Lambda:**
   - In `packages/infra/lib/stacks/api-stack.ts`, the API Lambda and the
     dispatcher already have `workflowTokenKey.grantEncryptDecrypt`.
   - **The reconcile Lambda (`ReconcileWorkflowExecutionsFunction`) does
     not** (re-verified 2026-10-15). Add the grant, its
     `WORKFLOW_TOKEN_KMS_KEY_ID` environment variable, and an infra test.
4. **Runner task definition:** add `pegasus-tenant-runner-scoped-<env>` with
   **no** Temporal secret, and make `lib/tenant-runner.ts` →
   `ensureTenantRunner` pick it by status.
   - `publishTenantRunnerPoolMetrics` must count both families.
   - `ecs:RunTask` in the API stack must cover the new family.
5. **Runner config** (`apps/tenant-runner/pegasus_tenant_runner/`):
   - The `TEMPORAL_*` variables become optional in `config.py` →
     `load_config`. When they're absent, fetch credentials from the broker
     **before** `runner.py` → `build_temporal_client`.
   - It must work under **both** task definitions, because the runner image
     `:latest` deploys independently of CDK.
   - Re-fetch on a Temporal auth failure.
6. **Cutover state machine:** add `DRAINING` and `ACTIVE` to
   `TenantTemporalNamespaceStatus` (additive enum values).
   - **DRAINING:**
     - refuse new starts (409 `TENANT_MIGRATING`);
     - SCHEDULE triggers skip;
     - in `lambda-dispatch-workflow-triggers.ts`, **exclude a draining
       tenant's EVENT outbox rows from the drain query**
       (`where: { dispatchedAt: null, tenantId: { notIn: draining } }`). Never
       stamp them, and never park them at the head of the oldest-first,
       100-per-tick queue: a parked head starves every tenant (see GOTCHAS).
   - At zero QUEUED/RUNNING rows → **ACTIVE**.
   - Per-tenant rollback: ACTIVE → shared, after its own drain.
   - **The provisioner's statuses must keep working.** Rotation and the
     daily sweep act on READY rows. Decide how they treat ACTIVE (it must
     keep rotating), and update `findDueForRotation` and
     `earliestReadyKeyExpiry` (the tenant expiry gauge) accordingly.
7. **Acceptance (staging):**
   - cut over a staging tenant;
   - run an Automation end to end, including a dry run;
   - re-run the isolation probes;
   - confirm events created during the drain fire after ACTIVE;
   - force a key rotation **while a runner is live** and confirm it
     re-fetches.
8. **Later, a separate PR:** once every tenant is ACTIVE, remove the legacy
   runner task definition and the shared key from runners. That completes
   3a's goal of no Admin key in runners.

## Decisions to put to the user before coding

- **One PR or several?** Suggested split:
  - (a) data + per-namespace client + reconcile KMS, inert;
  - (b) runner task definition and config;
  - (c) the cutover state machine and admin-web controls;
  - (d) acceptance.
- **Cutover trigger:** an admin-web action per tenant ("Move to own
  namespace"), or automatic on READY?
- **Which tenants first in prod**, and whether prod waits for the
  namespace-cap raise.
- **Does ACTIVE replace READY**, or sit beside it? This affects the
  provisioner's sweeps and the tenant gauge (step 6).

## Still owed elsewhere (not part of 3b.2)

- User: ask Temporal support to raise the namespace cap.
- In `~/repos/pegasus-workflows` (a separate repo): update its CLAUDE.md
  wording for the Automations rename, and mark `sdk-feedback/0008`
  superseded.
