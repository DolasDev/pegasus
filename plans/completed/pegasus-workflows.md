# Pegasus Workflows — Author, Upload, Browse (Phase 1)

> ## ✅ PHASE COMPLETE (archived 2026-06-09)
>
> All deliverables merged to `main`: backend foundation, admin
> promote/demote, both web UIs (`8a14977`, `1619e94`, `e70d61a`), Python
> SDK + stdlib + local Temporal (PR #110, merged 2026-05-19), and the
> `vnd_*` vendor-key auth fix (PR #112, merged 2026-05-19). The
> verification items below were superseded by Phase 2, which exercised
> the full upload→execute path live on staging + prod (see
> `plans/completed/workflows-phase2-execution-runtime.md`). Phase 3
> (sandboxed tenant code + triggers) is scoped in
> `plans/todo/workflows-phase3-sandboxed-tenant-code-and-triggers.md`.

**Started:** 2026-05-13 · **Completed:** 2026-05-19 (archived 2026-06-09)
**Commits:** `8a14977`, `1619e94`, `e70d61a` (direct to `main`);
PR #110 (SDK/stdlib/Temporal), PR #112 (vendor-key auth)

---

## Context

Pegasus needs a way for tenants to automate cross-domain operations (move
lifecycle, billing follow-ups, dispatch decisions) without us shipping
bespoke features for every use case. The vision:

- A **central library** of Python workflows the platform team curates.
- Tenants pick a global workflow and run it, or fork it into their own
  store and modify it.
- **All authoring happens locally in an IDE** against an SDK we publish —
  never in the tenant app. The SDK wraps Temporal (Temporal Cloud in prod;
  Docker for local dev) and the Pegasus public API.
- Tenants upload signed Python artifacts via API token (with a new
  `workflow_developer` role) or a UI portal.

**Phase 1 scope is deliberately narrow:** ship the _developer flow_
end-to-end — write locally, upload, see it listed — **without server-side
execution**. No Temporal infra in this phase. This proves the SDK ergonomics,
upload path, and storage model before we commit to the much larger
execution-runtime work in Phase 2.

**Key design call:** the platform team's curated workflows in
`packages/workflows-stdlib/` upload via the exact same API + token + CLI
that tenants will use, just from CI under a "platform tenant" identity. No
private loader. This forces the upload UX to be the only path and gives us
a worked example we can point tenants at.

---

## Status by component

### ✅ Backend foundation — done (commit `8a14977` + `e70d61a`)

- `apps/api/prisma/schema.prisma` — `Workflow` model, `WorkflowVisibility`
  enum, `Tenant.isPlatformTenant` flag.
- `apps/api/prisma/migrations/20260513120000_add_workflows/migration.sql`.
- `apps/api/src/repositories/workflow.repository.ts` — `create`,
  `findByIdForTenant`, `listForTenant`, `findByNaturalKey`. Cross-tenant
  reads enforced via explicit `OR: [{tenantId}, {visibility: 'GLOBAL'}]`
  predicates.
- `apps/api/src/handlers/workflows.ts` — `POST /upload-url`, `POST /`
  (finalize), `GET /`, `GET /:id`, `GET /:id/download-url`. Visibility
  derived server-side from `Tenant.isPlatformTenant`. Wired into
  `app.ts` under `/api/v1/workflows`.
- Auth: `workflow_developer` persona Cedar policy
  (`apps/api/src/authz/policies/30-personas/workflow-developer.cedar`),
  `ReadWorkflow` + `UploadWorkflow` actions in `actions.ts` +
  `cedar.schema.json`. `ReadWorkflow` added to the `tenant_user` baseline.
- 23 handler unit tests covering RBAC, validation, visibility derivation,
  P2002 dedupe, response-shape redaction.
- Bug fix in `e70d61a`: removed `Workflow` from `TENANT_SCOPED_MODELS` (the
  extension's top-level `where.tenantId` merge was neutralising the OR
  clause); added to `INTENTIONALLY_UNSCOPED` in the schema-sync meta-test.

### ✅ Admin promote/demote (singleton invariant) — done (commit `8a14977`)

- `POST /api/admin/tenants/:id/promote-to-platform` — transactionally
  demotes every other tenant flagged true, then promotes the target.
- `POST /api/admin/tenants/:id/demote-from-platform` — idempotent clear.
- Audit-log actions `PROMOTE_PLATFORM_TENANT` / `DEMOTE_PLATFORM_TENANT`.
- 7 handler unit tests (happy path, idempotency, 404, 422-on-OFFBOARDED,
  cross-tenant demotion via `updateMany`).
- Admin-web `TenantDetailPage` gained a "Platform tenant" section with
  badge, hint text, promote-confirm modal, and demote button. Promote is
  disabled when tenant is not ACTIVE.

### ✅ Tenant-web `/settings/workflows` — done (commit `e70d61a`)

- `apps/tenant-web/src/api/workflows.ts` + `queries/workflows.ts`.
- `apps/tenant-web/src/routes/settings.workflows.tsx` — Platform Library
  (GLOBAL) and Your Workflows (TENANT) sections, per-row Download Source
  button (presigned GET → opens in new tab), empty states explaining the
  SDK push flow.
- `SETTINGS_NAV_ITEMS` entry added in `AppShell.tsx` (lucide `Workflow`
  icon). Router wired.

### ✅ Admin-web `/workflows` — done (commit `e70d61a`)

- `GET /api/admin/workflows` admin handler joining workflow rows to
  tenant name/slug. 4 unit tests.
- `apps/admin-web/src/routes/_auth/workflows/index.tsx` — cross-tenant
  table of every GLOBAL workflow with link to the owning tenant detail
  page; empty state nudges to promote a tenant.
- Header nav strip added in `_auth.tsx` with Tenants / Workflows links.

### ✅ Python SDK — done (commits `7b8e670`, `0b8add1`)

`packages/workflows-sdk-python/`, published to PyPI as
`pegasus-workflows-sdk`.

Contents:

- `pegasus_workflows/__init__.py` — re-exports `temporalio.workflow`,
  `temporalio.activity` decorators. Adds a thin `@pegasus_workflow`
  wrapper that records workflow metadata (name, version) for the manifest.
- `pegasus_workflows/api.py` — auto-generated or hand-rolled client for
  the Pegasus public REST API. Uses an injected token. Generated from the
  OpenAPI spec at `/openapi.json` if usable; otherwise hand-rolled
  covering customers, quotes, moves, inventory, invoices, events.
- `pegasus_workflows/cli/` — the `pegasus-workflows` CLI (Click or Typer)
  with subcommands:
  - `init <name>` — scaffold a new workflow project (pyproject.toml,
    sample workflow, `pegasus-workflows.toml` manifest).
  - `package` — zip the project per the manifest, producing one `.zip`
    per workflow version.
  - `push --token=… [--base-url=…]` — package + upload. Drives the
    existing two-step `/upload-url` → S3 PUT → `POST /` finalize flow.
  - `test <workflow>` — start a local Dockerized Temporal (via `docker
compose up`) and run the workflow with stub inputs.
- `pegasus-workflows.toml` manifest spec — declares workflow IDs,
  versions, entry points, required activities. Must match the
  `ManifestSchema` zod in `apps/api/src/handlers/workflows.ts` (name
  regex `/^[a-z0-9][a-z0-9_-]{0,63}$/`, semver version, `entryPoints[]`).

Released to PyPI via a new `.github/workflows/release-sdk-python.yml` that
publishes on `sdk-python-v*` tags.

### ✅ `packages/workflows-stdlib/` — done (commits `fc42e75`, `e66cd4f`)

A regular Python project that _uses_ the SDK like any tenant project
would. Dogfooded so the platform team uses the exact same upload path as a
tenant CI.

- One subdirectory per curated workflow (e.g., `send_quote_followup/`,
  `auto_close_completed_move/`).
- Top-level `pegasus-workflows.toml` listing them.
- `.github/workflows/publish-stdlib.yml` — on tag, runs
  `pegasus-workflows push --token=$PLATFORM_WORKFLOW_TOKEN`. The token is
  a `vnd_*` key bound to a service-account `TenantUser` in the platform
  tenant with the `workflow_developer` role. Visibility resolves to
  `GLOBAL` server-side because the tenant has `isPlatformTenant=true`.
- One real working workflow to start, even if trivial, so we exercise the
  path end-to-end.

### ✅ Local dev story — done (commits `fc42e75`, `0b8add1`)

- `docker-compose.temporal.yml` at the repo root runs the
  `temporalio/temporal` single-binary dev server + Temporal UI on the
  standard ports (7233 / 8080). Documented in the SDK README;
  `pegasus-workflows test` invokes it via `docker compose -f … up -d` if
  Temporal is not already reachable.
- No prod Temporal connection. The API does not connect to any Temporal
  endpoint in Phase 1.

---

## Operator step before any of this is live

After the next deploy, an admin must promote one tenant to the platform
tenant via the admin portal (`/tenants/:id` → Platform tenant section →
"Promote to platform tenant"). Until then every upload is TENANT-scoped
and the Platform Library is empty.

---

## Out of scope for Phase 1 (explicit)

- Server-side workflow execution. No Temporal Cloud connection from the
  API. No worker process. No trigger plumbing.
- "Fork to my store" UI/API. Tenants can upload their own; they can't yet
  _clone_ a `GLOBAL` workflow into their store with one click.
  Workaround: download the source from the global store and re-upload
  under their tenant. Phase 2 adds the one-click fork.
- Per-workflow runtime token issuance (separate from developer token).
- In-app workflow authoring or editing.
- Versioning UX beyond `name@version` in metadata (no rollback, no diff
  view).

---

## Verification (still to run end-to-end)

Most of these become exercisable only once the SDK lands. Current
manual-verifiable steps marked ✅; remainder need the SDK.

1. ✅ Tenant user without `workflow_developer` is forbidden from
   `POST /api/v1/workflows/upload-url` (handler unit test covers).
2. ⏳ Upload from CLI: `npm run dev`; create a `vnd_*` token in
   `/settings/developer` with `workflow_developer`; from a scaffolded
   workflow project run `pegasus-workflows push --token=$T
--base-url=http://localhost:3000`. _Pass_ = HTTP 201, row in
   `Workflow`, object in S3 under `workflows/{tenantId}/…`.
3. ⏳ List in tenant UI: visit `/settings/workflows` as the same tenant.
   _Pass_ = pushed workflow appears under "Your workflows".
4. ⏳ Global publish: tag `stdlib-v0.0.1`; CI runs `publish-stdlib.yml`
   against staging using the platform-tenant token; the workflow appears
   in **every** tenant's "Platform library" section + the admin
   `/workflows` table.
5. ⏳ Download source: as a non-platform tenant, click "Download source"
   on a GLOBAL workflow — file downloads, contents match what was pushed.
6. ⏳ SDK local dev: from `packages/workflows-sdk-python/`,
   `pip install -e .`; `pegasus-workflows init demo`; cd into the
   scaffold; `pegasus-workflows test hello` — spins up local Temporal
   and executes the toy workflow against a stub Pegasus API.

---

## Reuse / existing patterns (still relevant for the SDK + CI bits)

- **API token issuance**: `apps/api/src/handlers/api-clients.ts` +
  `apps/api/src/middleware/api-client-auth.ts`. The platform-tenant token
  is just a normal `vnd_*` key with `workflow_developer`.
- **CI deploy pattern**: existing `.github/workflows/deploy.yml` is
  path-filtered. The new SDK-publish + stdlib-publish workflows are new
  but should mirror the OIDC + secrets conventions already in use.
- **Server-side manifest schema**: `apps/api/src/handlers/workflows.ts`
  `ManifestSchema` — the SDK manifest must match exactly (`name`,
  `version`, `entryPoints[]`, optional `description`).

---

## Open questions to revisit before Phase 2 (not blockers for Phase 1)

- Runtime token model: same `vnd_*` shape used for workflow execution, or
  a separate short-lived workflow-runtime token issued per execution?
  Affects audit logging.
- Where the Temporal worker runs: ECS Fargate vs EC2 in the existing
  WireGuard VPC vs containerized Lambda. The infra exploration flagged
  Lambda is wrong for long-poll workers.
- "Fork to my store" semantics: deep copy at fork time, or
  reference-with-overlay? Affects the `Workflow` schema.
