# Retire the curated (bundled) workflow lane → everything runs via the sandbox

## Context

Workflow execution today has **two lanes** (`apps/api/src/lib/workflow-route.ts`):

- **STDLIB lane** — curated workflows (name ∈ `CURATED_WORKFLOW_NAMES`, currently
  just `send_quote_followup`) run on the shared `pegasus-stdlib-<env>` queue,
  served by the `temporal-worker` Fargate service whose **image bakes in
  `packages/workflows-stdlib`** and hard-imports the workflow code. Trusted,
  unsandboxed, uncapped.
- **TENANT_RUNNER lane** — every other executable workflow runs on a per-tenant
  queue, served by the `tenant-runner` sandbox, which **downloads the published
  artifact from S3**, verifies `artifactSha256`, and runs it hardened + capped.

The intended long-term design is **one lane: everything through the sandbox**,
with platform-scoped GLOBAL workflows _dogfooded in_ (published under the platform
tenant and run by the platform tenant's own runner). Retiring the curated bundled
lane is what **decouples workflow source from this repo** — once nothing is baked
into an image, the platform workflows can move to the `pegasus-workflows` repo and
be published from there (the stated canonical-home goal).

This plan is the follow-up to the `demo_partner` genericization / integration-
config move (PR #396); it is **prod-touching** (decommissions a live ECS service)
and must be sequenced carefully.

## Load-bearing hazards (do not skip)

1. **`TemporalWorkerStack` also owns the sandbox's infra.** That one stack
   provisions _two planes_ sharing **one ECS cluster** (`pegasus-temporal-worker-<env>`):
   the curated worker (Plane A, delete) **and** the tenant-runner's cluster +
   task-def + IAM roles (Plane B, the sandbox — must survive). The API's
   `ecs:RunTask` targets that cluster ARN by name (`api-stack.ts`). So this is a
   **surgical stack edit** (remove Plane-A constructs, keep the cluster + Plane B
   with **stable logical IDs**), never a stack deletion — a delete/recreate of the
   cluster would take down the sandbox in prod.
2. **`TEMPORAL_TASK_QUEUE` is load-bearing for the _tenant_ lane too.**
   `tenantTaskQueueEnv()` derives the env suffix (`staging`/`prod`) by regex-
   stripping `pegasus-stdlib-` off `TEMPORAL_TASK_QUEUE`. Dropping the var makes
   every workflow silently start on `…-dev` queues in prod → executions strand
   until timeout. Must be **repurposed as a pure env-suffix carrier** (or replaced
   by an explicit `PEGASUS_ENV_NAME`), changing `tenantTaskQueueEnv()`,
   `api-stack.ts`, and `bin/app.ts` together — deliberately, before touching the
   curated set.
3. **`send_quote_followup` must have a live S3 artifact + `executable=true` in
   each env BEFORE flipping the route.** GLOBAL rows go through the same
   publish/finalize path as tenant rows, so it _should_ — but the Phase-2 plan's
   own checklist left the global-publish step unconfirmed. **Verify the prod +
   staging `Workflow` row actually resolves an S3 object at its `artifactKey`**
   (re-run `publish-stdlib.yml` / `pegasus-workflows push` if not) before Step 3
   below. If it has no artifact, flipping the route stops it running.

## Behavior changes to ship deliberately

- **Cross-tenant GLOBAL run now requires a fork.** The `MUST_FORK` guard
  (`start-workflow-execution.ts`) only fires on the TENANT_RUNNER route. After
  retirement, a non-owning tenant calling `run` on a GLOBAL workflow gets
  `403 WORKFLOW_MUST_FORK` (must `POST /:id/fork` first). The **platform tenant
  running its own GLOBAL rows is unaffected** — that's the dogfood path, and it
  works as-is. Update the tenant-web UI (`settings.workflows.tsx`) so GLOBAL rows
  the caller doesn't own show a "fork to run" affordance instead of a bare Run
  button, and fix the now-stale "Curated / always executable" badge copy.
- **Forked workflows finally run the tenant's own bytes** (today a fork of a
  curated name is shadowed by the bundled code — a latent bug the retirement
  fixes). Call this out as a positive.
- GLOBAL runs become subject to the per-tenant concurrency cap, daily quota, and
  per-execution timeout for the first time.

## Ordered plan (suggested sub-PRs)

**Sub-PR A — decouple the env-suffix (safe, no behavior change):**

1. Repoint `tenantTaskQueueEnv()` off the `pegasus-stdlib-` shape: either keep
   `TEMPORAL_TASK_QUEUE` purely as an env-suffix carrier, or add an explicit
   `PEGASUS_ENV_NAME` and thread it through `api-stack.ts` + `bin/app.ts`. Keep
   the value injected so staging/prod never fall back to `dev`. Ship + deploy;
   confirm tenant-lane queue names unchanged.

**Sub-PR B — flip routing to sandbox-only (after verifying Hazard 3):** 2. Verify `send_quote_followup` has a live artifact + `executable=true` in
staging **and** prod. 3. Empty `CURATED_WORKFLOW_NAMES` (or delete the module and simplify its 4
consumers: `resolveWorkflowRoute`, the two TENANT_RUNNER count filters in
`start-workflow-execution.ts`, the admin `runner-status` filter). Remove the
now-dead STDLIB branch, `temporalTaskQueue()` (`temporal-client.ts`), and the
`'STDLIB'` union member. 4. Ship the tenant-web fork-UX + badge-copy change (behavior-change comms). 5. Deploy to staging; run `send_quote_followup` as the platform tenant end-to-end
through the sandbox; confirm a non-owning tenant gets `WORKFLOW_MUST_FORK` then
runs via fork. Then prod.

**Sub-PR C — decommission the worker infra (deploy window):** 6. Surgically edit `TemporalWorkerStack`: remove `WorkerRepository`,
`WorkerLogGroup`, `WorkerTaskDef`, `WorkerSg`, `WorkerService`; **keep**
`WorkerCluster` + all `TenantRunner*` constructs with stable logical IDs
(consider renaming the stack/class to `SandboxStack` only via a proper CDK
stack-rename migration, else leave the name). 7. Drop `TemporalWorkerDownAlarm` + `QueryTemporalWorkerErrors` from
`monitoring-stack.ts` + `bin/app.ts` (they'd fire forever once the service is
gone). 8. Delete `apps/temporal-worker/` (app, Dockerfile, tests) and the CI:
`.github/workflows/temporal-worker.yml` + `_temporal-worker.yml` (confirm
neither is a branch-protection required check first — they are not referenced
from `ci.yml`). 9. Update `.github/deploy-manifest.json` (drop `TemporalWorkerStack` from the
`api` component if the stack is removed/renamed) and trim the `temporal-worker`
service out of `docker-compose.temporal.yml`. 10. Review the `cdk diff` for exactly which resources CFN proposes to delete vs.
orphan. Post-deploy, manually clean the RETAIN orphans: `pegasus-temporal-worker`
ECR repo + `/pegasus/<env>/temporal-worker` log group, per env.

**Sub-PR D — move the workflows to the platform repo (the original goal):** 11. Move `send_quote_followup` + `emit_custom_event` source into
`pegasus-workflows/platform/<name>/` (per-project layout: own
`pegasus-workflows.toml` + `pyproject.toml` + `README.md` + package + tests);
replace the platform repo's `send_quote_followup` _stub_ with the real impl. 12. Publish them from the platform repo via `pegasus-workflows push` (the same
identity/flow that publishes `send_order_saved_sms`). Confirm the GLOBAL rows
keep a live artifact so the sandbox keeps running them. 13. Delete `packages/workflows-stdlib/` from this repo; remove the now-dead
`publish-stdlib.yml`; rework `ci.yml`'s `workflows-stdlib-python` job to
SDK-only (rename → `workflows-sdk-python`, drop the stdlib pytest step + the
`packages/workflows-stdlib/**` path filter — none of these are required
checks). Update root `CLAUDE.md`'s package map + the
`regenerate-stdlib-workflow-diagrams` todo (now platform-repo work).

## Verification

- Sub-PR A: tenant-lane queue names identical pre/post in staging (log the
  resolved queue for a test run).
- Sub-PR B: full `send_quote_followup` execution via sandbox in staging + prod;
  `MUST_FORK` path exercised for a non-owning tenant; unit tests for the emptied
  allowlist / simplified route.
- Sub-PR C: `cdk diff` reviewed; sandbox (`tenant-runner`) executions still land
  on `pegasus-temporal-worker-<env>` cluster post-deploy; the down-alarm no longer
  exists.
- Sub-PR D: platform-repo `pegasus-workflows package` + `test` per workflow;
  published GLOBAL rows resolve a live artifact; a real run of each on the sandbox.

## Notes / follow-ups carried from PR #396

- Republish `demo_partner` GLOBAL to QA (the old QA `weichert` published config is
  inert after the rename); confirm weichert was never published to prod.
- `apps/admin-web` runner-status copy references `packages/workflows-stdlib/` —
  reword once the workflows move (Sub-PR D).
