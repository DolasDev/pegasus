# Phase 3b: a Temporal Cloud namespace per tenant, for Automations

- **Branch:** `feat/tenant-temporal-namespaces` (worktree
  `../pegasus-tenant-temporal-namespaces`). All 3b work stays on this branch.
- **Goal:** each tenant's Automations run in its **own** Temporal Cloud
  namespace, with a tenant-scoped Write key that the tenant runner fetches from
  the broker. The shared platform key leaves tenant runners for every tenant
  that is cut over. No Workflows yet (that's 3c).
- **Parent plans:** `plans/in-progress/durable-workflow-worker.md` (the
  3a/3b/3c split, decisions DECIDE-1..4) and
  `plans/in-progress/long-running-workflows-and-automations.md` (D1–D5).
  Phase 2 evidence: `plans/completed/2b1e2147-durable-workflow-isolation-spike.md`.
- **Status:** Stage A (Steps 3–8 and 10) coded 2026-10-05 on this branch and
  going through `/workstream-finish`. **Next: Stage B**, which starts with
  Step 1 ⚠️ (the user creates the provisioner identities and secrets) after
  Stage A merges and deploys.

## Detailed plan (written 2026-10-05; execution starts in a new session)

### Design decision: no platform service account (user, 2026-10-05)

The API, reconciler and dispatcher talk to a tenant's namespace with **that
tenant's own scoped Write key**: the one the provisioner stores KMS-encrypted
in `TenantTemporalNamespace`. That's the same key the tenant runner fetches.
There is **no** account-level `pegasus-<env>-platform` service account.

- **Why:**
  - It removes two of four Cloud identities and two secrets.
  - It removes the provisioner's "grant platform account Write" step.
  - It removes any long-lived key that reaches every tenant namespace.
  - It makes the regional-endpoint question moot (one connection per tenant
    endpoint, each with that tenant's key).
- **Security is the same either way:** the API can already decrypt every
  tenant key, so an API compromise is equally bad in both designs.
- **The platform namespace** (`pegasus-<env>`: the STDLIB lane, and tenants
  not yet cut over) keeps using today's `pegasus-<env>-service-account` key,
  now Write-only (3a).

### How to resume (for the executing session)

1. Enter this worktree: `EnterWorktree` with path
   `/home/steve/repos/pegasus-tenant-temporal-namespaces`, branch
   `feat/tenant-temporal-namespaces`. Nothing is committed yet; this plan file
   is untracked.
2. **Baseline (already green, 2026-10-05):** the DB is migrated and the Prisma
   client generated, `packages/domain` is built, `apps/api` typecheck is
   clean, and API vitest passes 267/267 files and 3742 tests.
   - If `main` gained a migration since then, run `db:migrate` **and**
     `db:generate`.
   - `package-lock.json` gets rewritten by local npm 11 (the repo pins npm
     10.8.2). `git restore -- package-lock.json` before committing.
   - The API's `vitest.config.ts` coverage floors auto-raise on local runs;
     never commit that drift.
3. The branch has no commits and may be behind `main`. Run
   `git pull --ff-only` first (allowed: it's a fast-forward of an empty
   branch), then `db:migrate` and `db:generate` if a migration arrived.
4. Follow the **Execution order (inert-first)** under "3b.1 steps". Work
   test-first, and tick boxes as you go. Stop at every ⚠️ step for the user's
   explicit go-ahead.

### Split: 3b.1 (this worktree) then 3b.2 (a new workstream)

3b is too large for one reviewable PR, and its riskiest part (rerouting live
Automations) should land separately from the inert foundation.

- **3b.1: provisioning foundation (this branch).** It deploys **inert**:
  namespaces can be provisioned for a tenant, but nothing routes to them.
  It contains the data model, the Cloud Ops client, the provisioner Lambda
  (**created only when its secret ARN is configured**), admin endpoints and
  UI, and the broker credentials endpoint. The Cloud identities, the
  guardrail probe and live acceptance come **after** it merges, in a small
  **enable PR** (see the execution order).
- **3b.2: route Automations to tenant namespaces (a new
  `/workstream-start`).** Per-namespace API client, `temporalNamespace` on
  execution rows, the scoped runner task definition plus the runner
  credential fetch, the cutover state machine with event-safe draining, and
  the reconciler and handlers reading the namespace from the row. Its plan is
  sketched at the end of this file so 3b.2 can be seeded from it.

### Verified facts this plan rests on

- **Cloud Ops API** (research 2026-10-05; sources in the session log; verify
  the exact paths against `https://saas-api.tmprl.cloud/docs/httpapi.html`
  before coding):
  - REST/JSON at `https://saas-api.tmprl.cloud`, with headers
    `Authorization: Bearer <key>` and `temporal-cloud-api-version: v0.23.0`
    (pin it). There's **no official TS SDK**; call it with `fetch`.
  - `POST /cloud/namespaces` with `{spec:{name, retention_days,
api_key_auth:{enabled:true}, replicas:[{region:"aws-us-east-1"}]},
async_operation_id}`.
  - `GET /cloud/namespaces/{ns}`;
    `DELETE /cloud/namespaces/{ns}?resource_version=…`.
  - `POST /cloud/service-accounts` with `{spec:{name,
namespace_scoped_access:{namespace, access:{permission:"PERMISSION_WRITE"}}},
async_operation_id}`.
  - `POST /cloud/api-keys` with `{spec:{owner_id,
owner_type:"OWNER_TYPE_SERVICE_ACCOUNT", display_name, expiry_time}}`.
    The `token` is returned **once**. `DELETE /cloud/api-keys/{id}`.
  - `POST /cloud/namespaces/{ns}/service-accounts/{saId}/access` with
    `{access:{permission:"PERMISSION_WRITE"}, resource_version}`. This is the
    narrow grant call, gated only on namespace Admin of `ns`.
  - **Every mutation is async.** Poll `GET /cloud/operations/{id}`, honouring
    its `check_duration`. `async_operation_id` is the client's idempotency
    key. There's a cap of **10 concurrent async operations per account**.
  - Optimistic concurrency uses `resource_version`.
- **Roles:**
  - **Developer** can create namespaces, and gets namespace Admin **only on
    namespaces it created** ("Developer roles also don't have automatic access
    to Namespaces that they didn't create"). On those it can manage
    namespace-scoped service accounts and keys and call the access-grant RPC.
  - Developer **cannot** create account-level service accounts; that needs
    Global Admin or Owner.
  - Any role can _list_ namespaces and service accounts account-wide. That's
    disclosure, not action.
- **Naming:** 2–39 chars, `[a-z0-9-]`, starting with a letter. The ID is
  `<name>.chgel`, and the endpoint is `<name>.chgel.tmprl.cloud:7233`.
  Proposed name: `pg-<env>-<first 12 hex of tenantId>`, for example
  `pg-staging-a90b22bc4393` (22 chars).
- **Codebase:**
  - The admin API is `apps/api/src/handlers/admin/tenants.ts` (PLATFORM_ADMIN
    group; the kill switch at `:685/:730` is the handler template).
  - The admin-web page is `routes/_auth/tenants/$id.tsx`, with
    `WorkflowKillSwitchSection` at `:402` as the UI template.
  - The client is `apps/admin-web/src/api/tenants.ts`.
  - **There's no async Lambda invoke in the repo yet.** The only `InvokeCommand`
    use is synchronous (`lib/mssql-executor-client.ts`); copy its lazy client
    and test-setter shape, with `InvocationType: 'Event'`.
  - Cron Lambda pattern: `api-stack.ts:684-835`, non-VPC, `NODEJS_24_X`.
  - KMS: `encryptRuntimeToken` / `decryptRuntimeToken`
    (`lib/runtime-token-crypto.ts`, key `WORKFLOW_TOKEN_KMS_KEY_ID`).
  - Broker routes: `handlers/workflow-internal.ts`, using `requireBrokerAuth()`
    and the `GET /tenant-workflows` template at `:433`.
  - `TenantBrokerCredential` (`schema.prisma:2418`) is the model to copy; the
    Tenant back-relations are at `:302-303`.
- **3a is live:** `saas-api.tmprl.cloud` is NXDOMAIN inside the WireGuard VPC.
  The provisioner **must not** be VPC-attached (API-stack Lambdas aren't).

### 3b.1 steps (this branch)

**Execution order (inert-first; user decision 2026-10-05).** No Cloud
account work blocks the code.

- **Stage A, code and merge (this branch, no Cloud identities needed):**
  Steps **3 → 4 → 5 → 6 → 7 → 8 → 10**, then `/workstream-finish`.
  - It deploys **inert**: no provisioner secret ARN is configured, so CDK
    doesn't create the provisioner Lambda, the admin endpoints return 503
    `TEMPORAL_PROVISIONING_NOT_CONFIGURED`, and admin-web shows "not
    configured".
  - Only the new table and the (READY-gated, so 404) broker route exist in
    prod.
- **Stage B, enable (after Stage A merges and deploys):**
  - Step **1** ⚠️ (the user creates the provisioner accounts and secrets),
    then Step **2** ⚠️ (the guardrail probe must pass).
  - Then a **small enable PR** (its own `/workstream-start fix <slug>`) that
    adds the provisioner secret ARNs to `bin/app.ts` (`TEMPORAL_SECRET_ARNS`
    gets a `temporalProvisioner` entry per env). The pre-flight now finds the
    secrets, and CDK creates the Lambda.
  - Then Step **9** ⚠️ (live acceptance in staging).
- **3b.2 starts only after Stage B's Step 9 passes.**

**Progress (Stage A):**

- [x] Step 3: data model, migration `20261005204213_tenant_temporal_namespace`,
      repository with tests. Includes `previousApiKeyId`/`previousKeyRetireAt`
      (Step 5's rotation columns) so there's a single migration.
- [x] Step 4: `lib/temporal-cloud-ops.ts`. Paths and fields checked
      2026-10-05 against `temporalio/api-cloud` `service.proto` and
      `request_response.proto` (the HTML docs page is JS-rendered); `VERSION`
      is `v0.23.0`. Additions beyond the plan: `findServiceAccountByName`,
      `getApiKey` and `listApiKeys` (for resuming after a lost create
      response, and the token-once recovery). Note `GetServiceAccounts`
      returns the repeated field as `service_account` (singular).
- [x] Step 5: `lib/temporal-provisioner.ts` (logic, deps injected) plus
      `lambda-temporal-provisioner.ts` (wiring). Deviations from the plan,
      each for resumability:
  - **Lease column** `leaseExpiresAt` (in the same migration): the "row-level
    guard". A Lambda killed by its timeout runs no `catch`, so a status-only
    guard would wedge the row in PROVISIONING forever. The lease expires
    after 15 minutes.
  - **State checks instead of deterministic `async_operation_id`s:** each
    step asks Cloud first (`getNamespace`, `findServiceAccountByName`,
    `listApiKeys`), and op ids carry a per-run nonce. A retry with the same op
    id as a FAILED operation would just replay the failure.
  - **Token-once recovery:** on resume, every key on the service account is
    deleted before a new one is minted (an orphan's token is unrecoverable).
  - **Rotate** refuses while the previous key is in its grace period (24 h).
    A failed rotate records `lastError` but leaves the row READY, because the
    old key still works.
  - **`retire-previous-keys`**: a sweep action that deletes rotated-out keys
    past their grace. Step 6 schedules it daily.
  - **Readiness** uses the stored key through `getDecryptedKey`, the same
    path 3b.2 will use.
- [x] Step 6: infra. A `TemporalProvisionerFunction` inside the
      Temporal-configured branch, gated on `temporalProvisionerSecretArn`
      (`TEMPORAL_SECRET_ARNS[env].temporalProvisioner`, optional and unset).
      Async `retryAttempts: 0` (the lease would only make retries skip), a
      daily `retire-previous-keys` rule, and a 1-year log retention (it's an
      audit trail). Tests cover both the unset and the set case. **Gotcha:**
      the `_deploy.yml` pre-flight greps every `arn:aws:secretsmanager:`
      literal in `bin/app.ts`, comments included.
- [x] Step 7: `handlers/admin/temporal-namespace.ts` (a sub-router like
      `vpn.ts`), `lib/temporal-provisioner-invoke.ts`, and admin-web's
      `TenantTemporalNamespaceSection`. Deviations:
  - **GET with no row returns 200 `{data: null, configured}`, not 404**, so
    admin-web can tell "no namespace" apart from "not configured" without a
    second call.
  - A PROVISIONING or DEPROVISIONING row is re-invoked only when its lease
    has expired (a killed run). A live run just gets 202.
  - A failed invoke returns 502 and marks the row FAILED (rotate excepted).
  - The namespace id is `tenantNamespaceName(tenantTaskQueueEnv(), tenantId)`
    plus the account suffix from `TEMPORAL_NAMESPACE`.
- [x] Step 8: `GET /api/v1/internal/temporal-credentials` returns
      `{data: {address, namespace, apiKey}}`. It's READY-only, and the key
      is not decrypted for any other status. A token asking for another
      tenant gets 404 (deliberately unlike `/tenant-workflows`' 400) and
      triggers no lookup. Every response is `no-store`; a decrypt failure is
      a 500 that logs only the error name. Allowlisted in the OpenAPI
      coverage test (runner-only). `admin/temporal-namespace.ts` was added to
      `db-access-guard`'s base-client allowlist.
- [x] Step 10: docs. `DECISIONS.md` (Developer-role provisioner, and no
      platform service account), `GOTCHAS.md` (the Cloud Ops traps), and
      `durable-workflow-worker.md` (3a DNS check ticked, 3b in progress).
      Then `/workstream-finish` with `/security-review`.

**Step 1 ⚠️ (Stage B, after Stage A merges; user, one-time, Cloud account):
create the provisioner identity, one per environment.** Needs a **Global Admin or
Owner** login, since Developer can't create account-level service accounts.
The secret must exist before the **enable PR** merges, because the
`_deploy.yml` pre-flight checks every ARN in `bin/app.ts`. Stage A adds no
ARN, so it isn't affected.

- **Getting `tcld`:** it has no prebuilt release binaries. Build v0.55.0 from
  source with Go (download Go from go.dev/dl and checksum-verify it), using
  `GOPATH`, `GOBIN` and `GOCACHE` set under a scratch dir:
  `go install github.com/temporalio/tcld/cmd/tcld@v0.55.0`. Then run
  `tcld login` (a browser device flow; the user runs it as `! <path>/tcld login`).
  The core `temporal` CLI has **no** `cloud` commands. A `go install` inside a
  worktree session trips the git guard, so run it from a small script file.
- **Commands, per env `E` ∈ {staging, prod}:**

  ```
  tcld service-account create -n pegasus-$E-provisioner -d "Creates per-tenant namespaces (3b)" --ar Developer
  tcld apikey create -n pegasus-$E-provisioner-key -d 1y --si <provisioner SA id>
  ```

  - `apikey create` returns the secret in the **`secretKey`** field, **once**.
    Pipe it straight into Secrets Manager; never echo it.
  - Each create returns a `requestId`. Poll `tcld request get -r <id>` until
    `Fulfilled`.
  - Store the key (profile `dolas-pegasus-$E`, us-east-1):

    ```
    aws secretsmanager create-secret --name pegasus/$E/temporal-provisioner --secret-string '{"apiKey":"<secretKey>"}'
    ```

    Build the JSON with a script that reads the key from a 0600 file, so the
    key never appears in argv or a transcript.

  - Record the secret's **full ARN with its 6-character suffix**
    (`describe-secret --query ARN`) for `TEMPORAL_SECRET_ARNS` in
    `bin/app.ts`.

**Step 2 ⚠️ (Stage B; guardrail probe, must pass before the enable PR
merges).** Developer scoping is **per creator**, so test the property 3b.2
relies on: _one env's provisioner cannot touch a namespace the **other**
env's provisioner created._

1. The **staging** provisioner creates a throwaway `pg-staging-000000000000`,
   then a scoped Write service account plus key on it. Both must succeed (the
   authorized control).
2. The **prod** provisioner must be **refused** on that namespace for get
   (if the role check denies it; listing is account-wide, so note it),
   create a scoped service account, rotate or delete a key, and delete the
   namespace.
3. Swap roles: the prod provisioner creates `pg-prod-000000000000`, and the
   staging provisioner must be refused on it the same way.
4. Both provisioners must be refused on the **existing**
   `pegasus-staging.chgel` and `pegasus-prod.chgel` (neither created them).
5. **Tenant keys across environments:** the scoped key minted in (1) must be
   refused by `pg-prod-000000000000` and `pegasus-prod.chgel` (gRPC
   DescribeNamespace, start, signal, poll), and vice versa. That's the same
   property Phase 2 proved, re-checked against provisioner-made keys.
6. Controls: a no-key run (tcld prompts for login) and the authorized
   create in (1). Then delete both throwaways.

- **If any refusal fails, STOP and return to the user** (fallbacks: separate
  Cloud accounts per env, or operator-run provisioning).
- Put the transcripts in this file.

**Step 3: data model (test-first).**

- New `model TenantTemporalNamespace`, mirroring `TenantBrokerCredential`:
  - `id`; `tenantId @unique`; `namespace @unique` (full `<name>.chgel`);
    `grpcAddress`;
  - `cloudServiceAccountId?`, `apiKeyId?`, `apiKeyCiphertext?`,
    `apiKeyExpiresAt?`;
  - `status TenantTemporalNamespaceStatus @default(PROVISIONING)`;
  - `step String?` (the last completed provisioning step, for resumability);
  - `lastError String?`; `createdAt`, `updatedAt`.
- Enum `PROVISIONING | READY | FAILED | DEPROVISIONING`. **DRAINING and
  ACTIVE are added in 3b.2** (YAGNI). Back-relation `temporalNamespace
TenantTemporalNamespace?` on Tenant.
- An additive migration (`apps/api/prisma/migrations/<ts>_tenant_temporal_namespace/`),
  which passes `check-migration-safety.sh` (no DROP, RENAME or SET NOT NULL).
- Add it to `INTENTIONALLY_UNSCOPED`, the same list `TenantBrokerCredential` is in
  (verified 2026-10-05: `prisma-tenant-isolation.test.ts:965`): it's
  read by platform code with an explicit `tenantId`, never via the tenant DB
  extension. Update `prisma-tenant-isolation.test.ts`.
- Repository `apps/api/src/repositories/tenant-temporal-namespace.repository.ts`
  with `findByTenant`, `createProvisioning` (handles a P2002 race the way
  `tenant-broker-credential.ts` does), `markStep`, `markReady`,
  `markFailed`, `storeKey` (encrypts with `encryptRuntimeToken`) and
  `getDecryptedKey`. Real-DB tests use `describe.skipIf(!hasDb)`, following
  `lib/__tests__/tenant-broker-credential.test.ts`.

**Step 4: Cloud Ops client (test-first, no live calls in tests).**

- `apps/api/src/lib/temporal-cloud-ops.ts`: a minimal `fetch`-based client
  with injectable `fetch` and sleep for tests.
  - Methods: `createNamespace`, `getNamespace`, `deleteNamespace`,
    `createScopedServiceAccount`, `createApiKey`, `deleteApiKey`,
    `grantNamespaceAccess`, `getOperation`, and
    `waitForOperation(id, {timeoutMs})`, which polls with `check_duration`.
  - Typed errors: `CloudOpsAuthError` (401/403), `CloudOpsConflictError`
    (409, or a stale `resource_version`), and `CloudOpsError`.
  - **Never logs the key or the returned `token`.** A unit test asserts the
    logger never receives either.
  - Pins `temporal-cloud-api-version`.
- **Name guard:** a pure function `assertProvisionableName(env, name)` that
  only accepts `^pg-<env>-[0-9a-f]{12}$`, and is called before every
  mutating call. It's defence in depth on top of the Developer scoping.
  Unit-tested.

**Step 5: provisioner Lambda (test-first).**

- `apps/api/src/lambda-temporal-provisioner.ts`. Its event is
  `{action:'provision'|'rotate'|'deprovision', tenantId}`. It's idempotent
  and resumable from `TenantTemporalNamespace.step`.
- `provision` steps, in order, each with a deterministic
  `async_operation_id = <tenantId>:<step>:v1`:
  1. create the namespace;
  2. wait for the operation;
  3. create a scoped Write service account;
  4. create a key (1-year expiry), then store it encrypted **immediately**,
     since the token is shown once;
  5. **readiness:** connect to `<ns>.chgel.tmprl.cloud:7233` with the new key
     and retry `DescribeNamespace` until authorized (about 90 s seen; give up
     after 10 minutes);
  6. mark the row READY.
  - Any failure → `FAILED` with `lastError`. Re-invoking resumes from `step`.
- `rotate`, with a **grace window**:
  1. Mint a new key and store it (it becomes the key the broker hands out).
  2. Keep the **old key alive for a grace period** (default 24 hours; record
     `previousApiKeyId` and `previousKeyRetireAt`). Running runners keep
     working, and a later scheduled pass, or the next `rotate`, deletes the
     old key.
  - Deleting the old key immediately would force-kill every running runner
    for that tenant once 3b.2 ships.
  - In 3b.2, the runner **and the API's per-tenant client cache** must
    re-fetch credentials on an auth failure.
  - This needs two more nullable columns on the model (Step 3):
    `previousApiKeyId` and `previousKeyRetireAt`.
- `deprovision`: refused unless status is READY or FAILED (never once a
  tenant is cut over; enforced again in 3b.2). Deletes the key and the
  namespace, which removes the scoped service account with it.
- Concurrency: at most one action per tenant (a row-level guard), and stay
  under the account's cap of 10 async operations.
- Logs go to CloudWatch with an `audit: true` field per Cloud mutation
  (tenantId, action, step, operation id). Never secrets.
- Tests (vitest, mocked Cloud Ops client and DB): the happy path, resume
  from each step, idempotent re-invoke, readiness timeout → FAILED, the
  token stored before anything else can fail, the name guard refusing a
  foreign name, and deprovision refused in a non-terminal state.

**Step 6: infra (test-first, `api-stack.ts` plus tests).**

- **Conditional creation (inert-first):** a new optional stack prop,
  `temporalProvisionerSecretArn`, sourced from `TEMPORAL_SECRET_ARNS[env]`
  in `bin/app.ts`. **Leave it unset in Stage A.**
  - Unset: no provisioner function, no IAM, and the API gets no
    `TEMPORAL_PROVISIONER_FUNCTION_NAME`.
  - Set: everything below. This mirrors how the Temporal Lambdas are gated
    on their props (`api-stack.ts:642-647`).
  - Infra tests cover **both** cases: unset → no function and no extra env;
    set → everything below.
- A `TemporalProvisionerFunction` NodejsFunction: `NODEJS_24_X`, **no VPC**
  (assert in a test), 15-minute timeout, 256 MB, its own log group.
  - Env: `DATABASE_URL`, `WORKFLOW_TOKEN_KMS_KEY_ID`, `ENV_NAME`,
    `TEMPORAL_PROVISIONER_SECRET_ARN` (read at runtime, not injected as a
    plaintext env var).
  - IAM: read **only** `pegasus/<env>/temporal-provisioner` (assert that no
    other function can read it), `grantEncryptDecrypt` on the workflow-token
    KMS key, and DB secret read.
- The API function gets `lambda:InvokeFunction` on the provisioner only,
  plus env `TEMPORAL_PROVISIONER_FUNCTION_NAME`.
- **Stage A adds no ARN to `bin/app.ts`.** The enable PR (Stage B) adds the
  **full ARN with suffix** (memory: `fromSecretCompleteArn`); the
  `_deploy.yml` pre-flight checks it exists.

**Step 7: admin API and admin-web.**

- `POST /api/admin/tenants/:id/temporal-namespace` creates the PROVISIONING
  row, or resumes a FAILED one, then async-invokes `provision` and returns 202
  with the row.
- `POST …/temporal-namespace/rotate-key` and `POST …/temporal-namespace/deprovision`.
- `GET …/temporal-namespace` returns status, step, namespace and lastError
  (never key material).
- Every mutation writes `writeAuditLog(...)` (actions
  `PROVISION_TEMPORAL_NAMESPACE`, `ROTATE_…`, `DEPROVISION_…`) and follows
  the kill-switch handler's shape: findUnique, 404, idempotent early return,
  transaction plus audit.
- Admin-web: a `TemporalNamespaceSection` on `tenants/$id.tsx`, modelled on
  `WorkflowKillSwitchSection`. It shows status, polls while PROVISIONING,
  and has Provision / Rotate key / Deprovision buttons; deprovision asks for
  confirmation in the page, since the viewer has no `confirm()`. Add a
  component test.
- **Not configured (Stage A in prod):** when
  `TEMPORAL_PROVISIONER_FUNCTION_NAME` is unset, the mutating endpoints
  return **503 `TEMPORAL_PROVISIONING_NOT_CONFIGURED`** and write **no row**.
  `GET` still works (no row → 404). Admin-web shows "Temporal namespace
  provisioning is not configured for this environment" and disables the
  buttons.
- vitest for the handlers: 404, idempotency, audit rows, invoke called with
  `InvocationType: 'Event'`, **the not-configured 503 with no row written**,
  and no key fields in the response.

**Step 8: broker credentials endpoint (inert until 3b.2).**

- `GET /api/v1/internal/temporal-credentials`, using `requireBrokerAuth()`.
  A tenant token pins the tenant; the shared secret requires `?tenantId`.
- Returns `{address, namespace, apiKey}` **only when the status is
  READY**; 404 otherwise. Sets `Cache-Control: no-store` and logs without
  the key. In 3b.2 the condition becomes ACTIVE.
- vitest: tenant confinement (another tenant's id gives 404), the 404s by
  status, no-store, and the key absent from logs.
- OpenAPI: internal broker routes are **excluded** from the SDK-facing spec.
  Confirm the coverage test's allowlist handles `/internal/*`.
- ⚠️ **This is the first broker route that returns a _secret_.** The
  existing ones return a status, a signed URL, or the per-workflow `vnd_`
  token, which is tenant-owned by design. `workflow-internal.test.ts` must
  assert that the key never reaches any logger call or error body. This route
  is where this PR's `/security-review` will focus.

**Step 9 ⚠️ (Stage B; acceptance, staging, after the enable PR deploys):** provision one **staging**
test tenant through admin-web.

- Watch the row go `PROVISIONING → READY`.
- **Re-run the Phase 2 isolation probe** against the new namespace with its
  key: the key works on its own namespace, and is refused by
  `pegasus-staging` and by another tenant namespace, through both endpoints,
  with the control.
- `cloudops_probe.sh` with the tenant key: it lists only its own namespace,
  and `saas-api` is unreachable from the runner VPC (3a).
- Confirm the stored key decrypts and works with the API's own code path
  (`getDecryptedKey`, then DescribeNamespace), which 3b.2 will use.
- Deprovision it, and confirm it's gone.
- Scripts from `plans/completed/2b1e2147-…` Appendix A; adapt them into
  `scripts/temporal/` if they get reused a third time.

**Step 10: docs and landing.**

- `DECISIONS.md`: provisioning by a Developer-role service account per env,
  and why Developer is enough; and **no platform service account**, with the
  API using each tenant's own key (see the design decision above).
- `GOTCHAS.md`: Ops API calls are async and capped at 10 concurrent; the key
  token is shown once, so store it first; the provisioner can't be in the
  WireGuard VPC.
- Update `durable-workflow-worker.md` (3b.1 done; **tick 3a's DNS check**,
  which passed 2026-10-05 in staging and prod, NXDOMAIN with the control
  resolving).
- `/workstream-finish` for **Stage A**, including `/security-review` (a
  Lambda, IAM, a broker route that returns a secret). The plan file stays in
  `plans/in-progress/` until Stage B's Step 9 passes. The enable PR updates
  it and archives it when 3b.1 is fully done.

### Risks (3b.1)

- **Stage A must not reference the provisioner secret.** If any ARN for it
  lands in `bin/app.ts` before Step 1, the deploy pre-flight fails. An infra
  test pins "prop unset → no function".
- **Inert isn't untested:** Stage A's code is exercised only by mocks until
  Stage B. Step 9 is the real proof, and 3b.2 must not start before it
  passes.
- **Token-once:** a crash between `createApiKey` and `storeKey` loses the
  token. Recovery: on resume, a key with no stored ciphertext is deleted
  and re-minted. Test this explicitly.
- **Listing is account-wide** for every role, so the provisioner can
  enumerate prod namespace names. That's disclosure only, and accepted.
- **Cost:** namespaces are free, and Actions are billed only on use.

### 3b.2 sketch (seed a new workstream from this once 3b.1 has merged)

1. **Execution rows carry their namespace:** add
   `WorkflowExecution.temporalNamespace` (additive) and write it at start.
2. **Per-namespace client:** `getTemporalClient(namespace)`, selected by
   **route and tenant**.
   - STDLIB always goes to the platform namespace, using today's
     `pegasus-<env>-service-account` key (Write-only since 3a).
   - TENANT_RUNNER goes to the tenant's namespace when ACTIVE, using **that
     tenant's own key**: decrypt it through
     `tenant-temporal-namespace.repository.getDecryptedKey`, and connect to
     `<ns>.chgel.tmprl.cloud:7233`.
   - Cache clients per namespace with a TTL, and **evict and re-fetch on an
     auth failure**, which covers key rotation.
   - There's no platform service account, and no regional-endpoint question.
   - Callers: `start-workflow-execution.ts:586/593`, `workflows.ts:1126/1196`
     (history and cancel; retry goes through start), and
     `lambda-reconcile-workflow-executions.ts:124/139`. They read the
     namespace **from the row**.
3. **The API and the reconcile and dispatch Lambdas need KMS decrypt** on the
   workflow-token key. The API (`api-stack.ts:587`) and the dispatcher
   (`:807`) already have `grantEncryptDecrypt`. **The reconcile Lambda does
   NOT** (verified 2026-10-05), so add the grant, its
   `WORKFLOW_TOKEN_KMS_KEY_ID` env var, and an infra test. All three keep
   today's shared key for the platform namespace.
4. **Runner:** add a `pegasus-tenant-runner-scoped-<env>` task definition
   with **no** Temporal secret, and make `ensureTenantRunner` choose it by
   status.
   - `publishTenantRunnerPoolMetrics` must count both families: today it
     lists only one (`tenant-runner.ts:464`).
   - IAM: `ecs:RunTask` must cover the new family (`api-stack.ts:874-881`).
5. **Runner config:** `TEMPORAL_*` become optional in `config.py`. If
   they're absent, fetch credentials from the broker **before**
   `build_temporal_client`. Today `load_config` hard-requires them and runs
   before the broker client exists (`runner.py:244` → `:132` → `:171`).
   - It must work under **both** task definitions, because the runner image
     `:latest` deploys independently of CDK.
   - Re-fetch on a Temporal auth failure (key rotation).
6. **Cutover state machine:** add `DRAINING` and `ACTIVE`.
   - `DRAINING`: refuse new starts (409 `TENANT_MIGRATING`); SCHEDULE
     triggers skip.
   - **EVENT outbox rows for a draining tenant are excluded from the drain
     query** (`where: { dispatchedAt: null, tenantId: { notIn: draining } }`).
     They must not be stamped, and must not be parked at the head of the
     oldest-first, 100-per-tick queue. Today the stamp is unconditional
     (`lambda-dispatch-workflow-triggers.ts:556-559`), and a parked row would
     starve every tenant (GOTCHAS: "A global oldest-first outbox drain + an
     infinite 'park' = one tenant starves the rest").
   - Once there are zero QUEUED/RUNNING rows, the tenant becomes `ACTIVE`.
   - There's a per-tenant rollback path (ACTIVE → shared, after its own
     drain).
7. **Acceptance:** cut over a staging tenant, run an Automation end to end
   (including a dry run), re-run the isolation probes, and confirm events
   created during the drain fire after ACTIVE.
8. Final cleanup (removing the legacy runner task definition and the
   shared key from runners) is a separate PR once every tenant is ACTIVE.
   That also completes 3a's goal of no Admin key in runners.

## Approved outline (verbatim from durable-workflow-worker.md, 3b)

> **Superseded where it conflicts with the detailed plan above.** In
> particular, the "platform identity" (account-level platform service account,
> `pegasus/<env>/temporal-platform`, "grant the platform service account Write")
> was **dropped on 2026-10-05**: the API uses each tenant's own key instead.
> See "Design decision: no platform service account".

- **Data:** a new model `TenantTemporalNamespace`:
  - fields: `tenantId @unique`, `namespace`, `grpcAddress`, `apiKeyId`,
    `apiKeyCiphertext` (KMS, the same key as the runtime tokens),
    `apiKeyExpiresAt`, `status` (`PROVISIONING|READY|DRAINING|ACTIVE`),
    timestamps;
  - an additive migration, and an entry in `TENANT_SCOPED_MODELS`.
- **Provisioning (DECIDE-1 → automated Lambda, user decision 2026-09-29):**
  a dedicated `temporal-provisioner` Lambda per env. It is **not** the API
  Lambda, so the Cloud credential never sits in the request path. It's invoked
  asynchronously from an admin-web action ("Enable Workflows for tenant") and
  from `scripts/` for re-runs. It must **not** be VPC-attached to the WireGuard
  VPC: 3a's DNS Firewall blocks `saas-api.tmprl.cloud` there. Steps,
  idempotent and resumable from `TenantTemporalNamespace.status`:
  - create `pegasus-<env>-t-<short>` (API-key auth);
  - create a scoped **Write** service account, then its key (1-year expiry);
  - grant the platform service account Write;
  - **retry until authorized** (about 90 s seen);
  - store the key KMS-encrypted.
  - Also `rotate` and `deprovision` actions.
  - **Guardrails**, because the user accepted a Cloud credential in AWS, and
    staging and prod share the Cloud account:
    - The credential gets the **lowest account role that can create
      namespaces and service accounts**, never Owner or Global Admin. Its key
      lives in `pegasus/<env>/temporal-provisioner`, readable only by the
      provisioner Lambda's role.
    - **Verify before 3b ships:** the _staging_ provisioner key must be
      refused (`PERMISSION_DENIED`) on `pegasus-prod` and on any prod tenant
      namespace, for describe, write and delete. Use a Phase 2-style probe
      with a control.
    - If the role turns out to reach namespaces it didn't create, **stop and
      return to the user**. Options then: separate Temporal Cloud accounts
      per environment, or falling back to operator scripts.
    - It only acts on names matching the `pegasus-<env>-t-*` pattern,
      enforced in code. Every call is logged to a CloudWatch audit stream.
- **Platform identity:** a new _account-level_ (not namespace-scoped)
  platform service account per env, with account role **Read** (the minimum;
  it belongs to the trusted Lambdas, so the user-list exposure doesn't matter
  here). It gets **Write** on `pegasus-<env>` and on each tenant namespace,
  granted at provisioning. New secret `pegasus/<env>/temporal-platform`. The
  API and cron Lambdas move to it. ⚠️ Cloud account change.
- **API Temporal client becomes per-namespace, chosen by _route_ and
  _tenant_:**
  - STDLIB (curated) runs **always** go to the platform namespace, because
    that's where the stdlib worker polls.
  - TENANT_RUNNER runs go to the tenant's namespace when it's ACTIVE, and the
    shared one otherwise.
  - The chosen namespace is **stored on the row**: a new additive column,
    `WorkflowExecution.temporalNamespace`, written at start.
  - The reconciler and the cancel, retry, describe and history handlers read
    it from the row and never re-derive it from tenant status, which changes
    at cutover. Legacy rows with a null value use the shared namespace.
  - One cached client per namespace.
  - First item: **verify the regional endpoint** serves many namespaces with
    one key (the positive case Phase 2 didn't test). If it does, use one
    connection; otherwise use one per namespace endpoint.
- **Runner in scoped mode:**
  - A second task definition, `pegasus-tenant-runner-scoped-<env>`, with **no
    Temporal secret at all**.
  - At start the runner calls a new broker endpoint,
    `GET /internal/temporal-credentials` (authenticated with `wbk_`, confined
    to the tenant). It returns `{address, namespace, apiKey}` for READY or
    ACTIVE tenants and 404 otherwise.
  - `ensureTenantRunner` picks the task definition by tenant status. The
    legacy task definition stays for unprovisioned tenants.
  - This fetch-at-start design keeps the key out of RunTask overrides,
    which are readable through `ecs:DescribeTasks`. It matches how `wbk_` is
    already stored, so it's the default rather than a question.
  - **Deploy-order constraint:** `tenant-runner.yml` pushes `:latest` on every
    merge, independently of CDK, so 3b's runner code will run under the
    _legacy_ task definition before the scoped one exists. The runner must
    work under both: env-provided credentials when present, a broker fetch
    when absent, with no ordering dependency on the CDK deploy.
- **Per-tenant cutover (drain, then flip):**
  - `READY`: nothing changes yet.
  - `DRAINING`: new starts are refused with 409 `TENANT_MIGRATING`.
    SCHEDULE triggers skip (a missed tick is acceptable, per the existing
    no-catch-up contract). **EVENT outbox rows for that tenant stay
    undispatched and fire after ACTIVE.** Events are durable and must never
    be lost to the drain.
  - When there are **zero QUEUED/RUNNING rows** (Automations cap at 15
    minutes), the status becomes `ACTIVE`. From then on, starts go to the
    tenant namespace and the scoped runner.
  - Driven by `scripts/temporal/cutover-tenant.ts`.
  - The final cleanup (removing the legacy runner task definition and the
    shared key from runners) happens once every tenant is ACTIVE. That's a
    separate small PR.
- **Tests:**
  - vitest for client resolution, cutover states, the broker endpoint (tenant
    confinement and 404s) and task-definition selection;
  - pytest for the runner's credential fetch;
  - infra tests: the scoped task definition has no Temporal secret, and the
    new secret is read only by the API and cron Lambdas.
- **Acceptance:** provision one staging tenant, re-run the Phase 2 probes
  (`probe.py`, `control.py`, `cloudops_probe.sh`) against it, cut it over, and
  run an Automation end to end, including a dry run.

⚠️ **Cloud account changes in 3b:** the per-env provisioner accounts (the
platform account was dropped 2026-10-05; see the design decision), and
provisioning of one staging tenant. Each is scripted, run by the user or with
the user's go-ahead, and paired with a deprovision script.
