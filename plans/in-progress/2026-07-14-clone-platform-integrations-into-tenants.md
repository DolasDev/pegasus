# Clone platform integrations into tenants (mirror workflow fork)

**Branch:** `feat/integration-clone-to-tenant` (worktree: `../pegasus-integration-clone-to-tenant`, isolated DB port 5462)

**Goal:** Let a tenant **clone a platform (GLOBAL) integration-validator config into
their own tenant scope** and then customize + publish it from the tenant-web UI —
mirroring the existing workflow "fork to my store" flow. Today the runtime already
prefers a tenant's own `IntegrationConfig` over GLOBAL (shipped in PR #420), but a
tenant has **no way to create one except the Python CLI**, and there is **no
provenance link** back to the platform config it was based on. This closes that gap.

---

## Why (the gap)

- **Workflows** have `POST /workflows/:id/fork` → copies a GLOBAL row into a
  TENANT-owned row, stamps `forkedFromWorkflowId` / `forkedFromVersion`, and the
  tenant-web UI splits "Platform library" vs "Your workflows" with a **Fork** button.
  (`apps/api/src/handlers/workflows.ts:826`, `repositories/workflow.repository.ts:182`,
  schema `Workflow.forkedFrom*` at `schema.prisma:1541-1549`,
  `apps/tenant-web/src/routes/settings.workflows.tsx` `WorkflowRow`.)
- **IntegrationConfig** deliberately mirrors Workflow's `visibility` model (GLOBAL =
  platform tenant, TENANT = owned) and is likewise excluded from `TENANT_SCOPED_MODELS`,
  **but has no `forkedFrom*` columns, no clone endpoint, and a 100% read-only
  tenant-web viewer.** Publishing is CLI-only (`pegasus-workflows integration-config
publish`).

So the clone flow is a near-direct port of the workflow fork flow, adapted to the two
structural differences below.

### How integrations differ from workflows (drives the design)

|                  | Workflow                                                    | IntegrationConfig                                                                                                                              |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity         | free `name` + `version` (many per tenant)                   | `integrationId` bound to a **code-defined built-in** (currently only `demo_partner`); **at most one active config per integration per tenant** |
| Payload          | zip artifact in **S3** (`artifactKey`)                      | `mapping` + `rules` + `corpus` **JSON in the row** — no S3 copy needed                                                                         |
| Versioning       | `(tenantId,name,version)` unique; fork keeps source version | `(integrationId,tenantId,version)` unique, monotonic; publish **supersedes** prior PUBLISHED for the scope                                     |
| Correctness gate | none beyond artifact shape                                  | **`runGatePipeline`** (static checks + golden corpus) must pass to publish                                                                     |
| Runtime creds    | fresh per-workflow service account minted on fork           | none — configs are inert data resolved per-request                                                                                             |

Consequences:

- No S3 `copyObject` — clone just copies the three JSON blobs.
- Clone must **re-run the gate** against the _current_ built-in (contract may have
  drifted since the GLOBAL config was published), exactly like the rollback path
  (`config.ts` rollback re-gates before republishing). Fail → 422 `GATE_FAILED`.
- Clone must **refuse to clobber** a tenant that already has its own config (409),
  since `repo.publish` would otherwise supersede their customizations.
- Version numbering restarts at 1 for the tenant's own scope (not the source version).

---

## Design decisions

1. **New endpoint** `POST /api/v1/integrations/:integrationId/config/clone` in
   `handlers/integration-validation/config.ts` (same M2M `dualAuthMiddleware` plane the
   SPA already calls for `GET .../config`, so a Cognito session works). Gated by
   `requirePermission(Actions.PublishIntegrationConfig)` **and** the existing
   `INTEGRATION_CONFIG_PUBLISH_ENABLED` feature flag.
   - Source = the active **GLOBAL** published config for `integrationId`
     (`repo.findActiveGlobal(integrationId)` — new thin repo method, or reuse
     `listActiveGlobal().find(...)`). **404** if none exists (a built-in-only integration
     with no GLOBAL config row is not cloneable in the MVP — see Open Questions).
   - **409** if the caller already has an active TENANT config for this integration
     (don't overwrite customizations).
   - Re-run `runGatePipeline(getBuiltInDefinition(id), {mapping, rules, corpus})`;
     **422 `GATE_FAILED`** on failure (contract drift).
   - On success, publish a new TENANT version via `repo.publish({...copied,
forkedFromConfigId: source.id, forkedFromVersion: source.version})`; return
     `{data: toFull(row)}` **201**.
2. **No dedicated Cedar action** — reuse `PublishIntegrationConfig`, exactly as
   workflow fork reuses `UploadWorkflow`. **No `cedar.schema.json` / `actions.ts`
   change** (avoids the merge-magnet hot files).
3. **Provenance columns** on `IntegrationConfig`, mirroring `Workflow`:
   `forkedFromConfigId String?` and `forkedFromVersion Int?` (Int, since IntegrationConfig
   versions are Int). Nullable, **not FKs** (survive source deletion). No new index.
4. **No `DRAFT` status.** Clone publishes a real TENANT version immediately (like fork
   creating a real TENANT row). The later edit UI holds edits **client-side** and only
   round-trips through the existing `.../config/validate` (dry-run gate) then `.../config`
   (publish) — matching the CLI's edit→validate→publish loop. So the `IntegrationConfigStatus`
   enum is untouched.
5. **UI:** integrations are few (one card per `integrationId`), so we do **not** copy
   workflows' two-section list. Instead, on the **integration detail page**
   (`integrations.$integrationId.tsx`): when the resolved active config is GLOBAL/built-in,
   show a **"Clone to my tenant"** CTA; once a TENANT config exists, show a provenance
   line ("Forked from platform v{n}") and (Phase 3) the edit/publish controls.

---

## Phase 0 — Schema + migration `[ ]`

**Files:**

- `apps/api/prisma/schema.prisma` — add to `model IntegrationConfig` (after `publishedBy`):
  ```prisma
  /// Set when this config was created by cloning a GLOBAL platform config
  /// ("clone to my tenant"). Holds the source IntegrationConfig.id. Null for
  /// directly-published configs. Not an FK so the row survives source deletion.
  forkedFromConfigId String? @map("forked_from_config_id")
  /// The source config's version at clone time. Null for direct publishes.
  forkedFromVersion  Int?    @map("forked_from_version")
  ```
- `apps/api/prisma/migrations/<ts>_add_integration_config_fork_provenance/migration.sql` —
  `ALTER TABLE "integration_configs" ADD COLUMN ...` (generate via
  `npm run db:migrate -- --name add_integration_config_fork_provenance` against the
  isolated DB on port 5462).

**Checklist:**

- `[ ]` Add the two columns + doc comments (mirror `Workflow.forkedFrom*` at
  `schema.prisma:1541-1549`).
- `[ ]` `npm run db:generate` + `npm run db:migrate` (isolated DB).
- `[ ]` Confirm migration is additive/nullable (no backfill, no default needed).

**Risk:** `schema.prisma` is a merge-magnet — keep the change to these 2 additive columns
and rebase before landing if another stream touches it.

---

## Phase 1 — Backend clone endpoint + repository + tests `[ ]`

**Files:**

- `apps/api/src/repositories/integration-config.repository.ts`
  - Extend `PublishConfigInput` with optional `forkedFromConfigId?: string` /
    `forkedFromVersion?: number`; thread them into `publish`'s `create` data and into
    `IntegrationConfigRow` / `SELECT`.
  - Add `findActiveGlobal(integrationId): Promise<IntegrationConfigRow | null>` (latest
    PUBLISHED GLOBAL for one integration) — or reuse `listActiveGlobal()` filtered.
  - Add `findActiveOwn(integrationId, tenantId)` (latest PUBLISHED **TENANT** row owned by
    caller) for the 409 guard — or derive from `findActiveForScope` + visibility check.
- `apps/api/src/handlers/integration-validation/config.ts`
  - New `POST /integrations/:integrationId/config/clone` handler (mirror the rollback
    handler's structure: feature-flag guard → auth (`tenantId`/`userId`) → source lookup
    → 404 → own-config guard → 409 → `runGatePipeline` → 422 → `repo.publish({...,
forkedFrom*})` → `refreshRegistryOverlay(basePrisma)` → 201). `logger.info('integration
config cloned', {...})`.
  - Extend `toFull` to surface `forkedFromConfigId` / `forkedFromVersion`.
- `apps/api/src/handlers/integration-validation/config.test.ts` — add a `describe('POST
.../config/clone')` block mirroring `workflows.test.ts:754` fork tests: 403 without
  `PublishIntegrationConfig`; 403 `FEATURE_DISABLED` when flag off; 404 when no GLOBAL
  source; 409 when caller already has an own config; 422 on gate failure; 201 with
  `visibility: TENANT` + `forkedFrom*` set + gate re-run on success.
- `apps/api/src/repositories/integration-config.repository.test.ts` (DB-backed) — clone
  round-trip: publish GLOBAL → clone into tenant → assert new TENANT v1 with provenance,
  and that a second clone 409s / is guarded at the handler layer.

**Checklist:**

- `[ ]` Repo: provenance fields on publish input + SELECT; `findActiveGlobal` / own-config
  guard helper.
- `[ ]` Handler: clone route with 404 / 409 / 422 / 201 + feature-flag + RBAC + re-gate +
  overlay refresh.
- `[ ]` `toFull` exposes provenance.
- `[ ]` Handler unit tests (mocked repo/gate) + DB-backed repo test.
- `[ ]` `npx tsc --noEmit` + `eslint` clean; targeted vitest green.

**Notes for the implementer:**

- The runtime resolver (`registry.ts` `resolveIntegrationDefinition`) already prefers
  TENANT > GLOBAL, so a cloned config takes effect immediately for that tenant. Initially
  it's byte-identical to GLOBAL, so **no behavior change until the tenant edits** — clone
  is safe/inert by itself (it just pins the tenant to a snapshot + unlocks editing).
- Re-gating on clone means a clone can 422 even though the GLOBAL config is live, if the
  built-in code contract drifted since the GLOBAL publish. This is intentional (same as
  rollback) — surface the gate report to the UI.

---

## Phase 2 — tenant-web clone button + provenance display `[ ]`

**Files:**

- `apps/tenant-web/src/api/integrations.ts` — add
  `cloneIntegrationConfig(integrationId): Promise<IntegrationConfig>` →
  `apiFetch('/api/v1/integrations/${id}/config/clone', {method:'POST'})`. Add
  `forkedFromConfigId?` / `forkedFromVersion?` to the `IntegrationConfig` type.
- `apps/tenant-web/src/api/queries/integrations.ts` — add `useCloneIntegrationConfig()`
  (`useMutation` → on success `invalidateQueries(integrationKeys.config(id))` +
  `integrationKeys.list()`), mirroring `useForkWorkflow` in
  `api/queries/workflows.ts:79`.
- `apps/tenant-web/src/routes/integrations.$integrationId.tsx` — when the active config's
  `visibility !== 'TENANT'` (GLOBAL or built-in), render a **"Clone to my tenant"** button
  (spinner while pending, inline `ApiError` on failure — mirror `WorkflowRow`). When a
  TENANT config exists with `forkedFromVersion`, show a provenance line
  ("Customized · forked from platform v{n}"). Update the list badge in
  `integrations.index.tsx` / the `IntegrationsCard` on `settings.developer.tsx` to
  distinguish "Platform" vs "Yours".
- `apps/tenant-web/src/routes/__tests__/integration-detail.test.tsx` — extend for the
  clone button visibility + provenance rendering.

**Checklist:**

- `[ ]` API client + mutation hook.
- `[ ]` Clone button (RBAC-gated visually; server enforces) + provenance line + list badge.
- `[ ]` Component tests; `npm run -w apps/tenant-web typecheck` + lint.

**Risk:** `router.tsx` is a merge-magnet but we **reuse existing routes** (no new route), so
no `router.tsx` change is expected — verify.

---

## Phase 3 — tenant-web edit + publish UI (makes clone actually useful) `[ ]`

Clone alone gives a byte-identical copy; the value is **customization**. Add a minimal
editor so a tenant can change their cloned config and publish a new version, all in-app.

**MVP editor (JSON-first, not rich forms):**

- On the detail page, when viewing a **TENANT** config, add an "Edit" mode: editable
  JSON text areas / a lightweight code editor for `mapping` and `rules` (reuse the
  existing `RawJsonView` styling; corpus stays as-is from the clone unless edited).
- "Validate" button → `POST .../config/validate` (dry-run gate, already exists), render
  the `GateReport` (problems + corpus pass/fail) inline.
- "Publish" button → `POST .../config` with the edited `{mapping, rules, corpus}` (already
  exists) → new TENANT version; invalidate queries. Disabled until a validate passes.
- Version history: surface `GET .../config/versions` (already exists) as a simple list
  with rollback (`POST .../config/rollback/:version`, already exists).

**Files:** `apps/tenant-web/src/api/integrations.ts` (+ validate/publish/versions/rollback
client fns), `api/queries/integrations.ts` (+ mutations), new
`components/IntegrationConfigEditor.tsx`, wire into `integrations.$integrationId.tsx`.

**Checklist:** `[ ]` client fns · `[ ]` editor component · `[ ]` validate/publish/rollback
wiring · `[ ]` tests.

> Rich per-field mapping/rules form editors (edit counterparts to `MappingTable` /
> `RulesTable`) are **out of scope** here — backlog polish. JSON editing + the gate is
> enough to ship real customization.

---

## Phase 4 — Backlog / follow-ons (not this workstream unless asked) `[ ]`

- **"Update from platform"** — re-clone/merge when the GLOBAL config advances (diff the
  tenant's config vs current GLOBAL, offer to pull changes). Needs the provenance columns
  from Phase 0.
- **"Reset to platform"** — delete/supersede the tenant's config so runtime falls back to
  GLOBAL (the resolver already handles absence).
- Rich mapping/rules **form editors** (not raw JSON).
- Seed-from-built-in clone when **no GLOBAL config row** exists (needs a submittable corpus
  derived from the built-in `__corpus__` fixtures).
- Provenance display on a dedicated version-history view.

---

## Cross-cutting concerns & risks

- **Feature flag:** clone/publish paths respect `INTEGRATION_CONFIG_PUBLISH_ENABLED`. The
  UI must be usable only where the flag is on; otherwise the button 403s `FEATURE_DISABLED`
  — surface that cleanly (or hide the button when the flag is known-off; there's no flag
  read on the client today, so start with graceful 403 handling).
- **Hot files:** `schema.prisma` (Phase 0, additive) is the only merge-magnet touched.
  **No** `cedar.schema.json` / `actions.ts` / `router.tsx` changes expected — confirm.
- **Platform tenant cloning into itself:** guard or ignore — a platform-tenant caller
  owns GLOBAL; cloning GLOBAL→its-own-TENANT is nonsensical. Simplest: allow the 409/own
  guards to handle it, or 400 if `tenant.isPlatformTenant`. Decide in Phase 1.
- **Gate drift 422:** a clone can fail the gate if the built-in contract changed since the
  GLOBAL publish. Intentional; the UI shows the report.
- **QA prerequisite:** for demo_partner, the platform must have a **GLOBAL published
  config** to clone from (there's a standing TODO to republish `demo_partner` GLOBAL to
  QA). Without it, clone 404s. Note this when demoing.

## Open questions (resolve before/while implementing)

1. **Clone source when only a built-in exists (no GLOBAL row)?** MVP: 404 (not cloneable).
   Confirm that's acceptable, or pull Phase-4 seed-from-built-in forward.
2. **Endpoint name:** `.../config/clone` (chosen) vs `.../config/fork`. `clone` reads
   better for config data; `fork` matches workflows. Pick one and be consistent in the UI.
3. **Should clone be blocked for the platform tenant** (400) or just fall through the
   own-config/409 guard? Lean 400 for a clear message.

---

## Verification (per phase, before PR)

- Phase 0/1: `npx tsc --noEmit`, `eslint`, targeted vitest (handler + repo), DB-backed
  clone round-trip against the isolated DB (port 5462).
- Phase 2/3: tenant-web typecheck + lint + component tests; drive the flow in the running
  app (`npm run dev`) — clone a GLOBAL config, confirm the TENANT copy appears with
  provenance and the runtime resolver now serves it.
- Ship each phase as its own PR through the merge queue (`gh pr merge --auto --squash`).
  Phases are independently shippable: 0+1 (backend) can land before 2 (UI button) before 3
  (editor).
