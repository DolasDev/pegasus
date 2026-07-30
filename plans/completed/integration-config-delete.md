# Delete a published integration config (sdk-feedback 0031, + 0030 part A)

**Branch:** `feat/integration-config-delete` (worktree `pegasus-integration-config-delete`)

**Goal:** Give the platform tenant a way to permanently remove a published GLOBAL
integration config (and a tenant a way to drop its own TENANT overlay), so
placeholder/renamed ids like `demo_partner` stop living forever in
`list_integrations` and stop being forkable — closing sdk-feedback **0031** and
**0030 part A**, exposed through the SDK + CLI and published to PyPI.

## Approved design decisions

1. **Hard delete** — physically remove the `integration_configs` rows for the
   (integrationId, scope) lineage. Not a soft `RETIRED` status. No enum change,
   **no Prisma migration**; the `IntegrationConfig` doc comment that claims
   "append-only" gets amended to note the explicit delete path.
2. **One verb covering both scopes** — a single `DELETE
/api/v1/integrations/:integrationId/config` that removes the _caller's own_
   config lineage:
   - platform tenant → the **GLOBAL** lineage (0031)
   - regular tenant → its **TENANT** overlay lineage, after which it re-inherits
     GLOBAL (0030 part A)
     Out of scope: 0030's `fork_integration_config(force=True)` refresh path.

## Semantics

- Deletes **the whole lineage** for `(integrationId, tenantId)` — every version,
  not just the active one. A later re-publish starts again at `v1`.
- After deleting a GLOBAL for a **config-only** id (no built-in overlay in code,
  e.g. `weichert`/`demo_partner`-style published ids): `get_integration_config`,
  `map_from_external`, `fork_integration_config` all → **404**, and the id drops
  out of `list_integrations` entirely (it leaves `listIntegrationIds()` when the
  registry overlay is refreshed).
- For an id that _also_ has a **built-in code overlay** (`demo_partner`,
  `allied_status` in `registry.ts`), deleting the GLOBAL config removes the
  published overlay only; the code baseline remains and the id still appears in
  `list_integrations` with `published:false` and its built-in `displayName`. That
  is correct — a built-in is code, not data — and must be **documented** in the
  SDK method docstring so the behavior isn't surprising.
- **Dependency guard (GLOBAL only):** refuse with `409 DEPENDENTS_EXIST` when any
  _other_ tenant still has a PUBLISHED TENANT config for that integration id,
  reporting the count. `?force=true` is the explicit opt-in that proceeds anyway
  (deleting the GLOBAL only — never another tenant's rows).
- Auth: `PublishIntegrationConfig` + the `INTEGRATION_CONFIG_PUBLISH_ENABLED`
  switch — exactly the publish gate. A non-platform caller can only ever reach
  its own TENANT rows (scoping is by `tenantId`, never by request input).
- `refreshRegistryOverlay` after a successful delete, so the GLOBAL overlay cache
  drops the id immediately; `logger.info` audit line (the tenant-plane convention).

## Checklist

### Platform — apps/api

- [x] `prisma/schema.prisma` — amend the `IntegrationConfig` model doc comment
      (append-only _except_ an explicit scoped delete). **Comment only — no schema
      change, no migration.** (Hot file: rebase before landing.)
- [x] `src/repositories/integration-config.repository.ts` - `deleteScope(integrationId, tenantId)` → `{ deleted: number }` via
      `deleteMany`. - `countOtherTenantOverlays(integrationId, excludeTenantId)` → number of
      PUBLISHED `TENANT` rows owned by other tenants (the dependency guard).
- [x] `src/repositories/integration-config.repository.test.ts` — cover both:
      lineage delete scoped to one tenant, other scopes untouched; dependent count
      excludes the caller and non-PUBLISHED rows.
- [x] `src/handlers/integration-validation/config.ts` — `DELETE
  /integrations/:integrationId/config`.
- [x] `src/handlers/integration-validation/config.test.ts` — feature-disabled 403,
      missing-permission 403, no-config 404, platform→GLOBAL delete, tenant→TENANT
      delete, `409 DEPENDENTS_EXIST` + `?force=true` override, overlay refreshed.
- [x] `src/lib/openapi-spec.ts` — document the `delete` operation on
      `/api/v1/integrations/{integrationId}/config` (the path is currently GET-only
      in the spec; add the sibling verb).

### SDK — packages/workflows-sdk-python

- [x] `pegasus_workflows/api.py` — `delete_integration_config(integration_id, *,
  force=False) -> dict` (returns `{integrationId, visibility, deleted}`), with
      `_capture_mutation` dry-run support and a docstring covering the built-in
      fallback + the dependents guard.
- [x] `pegasus_workflows/cli/integration_config.py` — `integration-config delete
  <id> [--force] [--yes]`; **interactive confirmation** (irreversible) unless
      `--yes`; a `409` prints the dependents count and the `--force` hint.
- [x] `pegasus_workflows/cli/mcp_server.py` — add the delete/retire flow to the
      `pegasus://reference/integration-config` resource and the m2m surface
      reference (docs only; the MCP tool surface stays read/dry-run).
- [x] `README.md` — CLI table row + a short "removing an integration" paragraph in
      the integration-config section covering both scopes.
- [x] `tests/test_api.py` — client method: URL, `force` param, dry-run capture.
- [x] `tests/test_cli_integration_config.py` — `delete` happy path, `--yes`,
      confirmation abort, 409 messaging.
- [x] `pyproject.toml` → `0.29.0`; `CHANGELOG.md` entry.

### Land + publish

- [x] `npm test` / `npm run typecheck` / lint green; `uv run pytest` + `ruff` green
      in the SDK.
- [~] One PR (plan + implementation), merge queue via `gh pr merge --auto --squash`.
- [ ] After merge: push tag `sdk-python-v0.29.0` → `release-sdk-python.yml` → PyPI.

## Also updated (discovered during implementation)

- `pegasus_workflows/testing/__init__.py` — the offline test harness classifies
  every client method; `delete_integration_config` registered as a
  `PublishIntegrationConfig` mutation, with a parity call in
  `tests/test_testing_harness.py` (two anti-drift tests enforce this).
- `apps/api/vitest.config.ts` — coverage floors auto-raised by the new tests.

## Risks / side effects

- **Irreversible by design.** No audit row survives a hard delete — the
  `logger.info` line is the only trace. The CLI confirmation prompt and the
  dependents guard are the safety rails.
- **Cross-tenant blast radius.** A GLOBAL delete can strand a tenant that resolved
  through it. Guarded by the dependents check for tenants with their _own_
  overlay; a tenant with _no_ overlay silently falls back to the built-in (or 404
  for a config-only id) — called out in the docstring and README.
- **Hot file:** `prisma/schema.prisma` (comment only). Rebase on `origin/main`
  before landing per the merge-queue protocol.
- `forkedFromConfigId` is deliberately not an FK, so deleting a GLOBAL does not
  cascade into tenant forks — verified in the schema comment.
- Version numbering restarts at v1 after a delete + re-publish; the unique
  constraint `(integrationId, tenantId, version)` stays satisfied because the old
  rows are gone.
