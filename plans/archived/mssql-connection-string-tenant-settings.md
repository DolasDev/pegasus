# Plan: MSSQL Connection String Settings in Tenant Web

## Context

The on-prem deployment connects to the legacy VB.NET SQL Server database via a per-tenant `mssql_connection_string` stored in the PostgreSQL `tenants` table. Today this value can only be set via direct SQL or the platform admin API. Tenant administrators need a self-service UI in the tenant web app's Developer Settings page to view and update their own connection string.

## 1. API — New tenant-facing settings handler

**New file:** `apps/api/src/handlers/settings.ts`

Create a Hono router mounted at `/api/v1/settings` with two endpoints, both gated by `requireRole(['tenant_admin'])`:

- **`GET /mssql`** — Returns the current connection string with the password masked (e.g. `Server=HOST;Database=DB;User Id=user;Password=****;...`). Returns `{ data: { mssqlConnectionString: string | null } }`.
- **`PATCH /mssql`** — Accepts `{ mssqlConnectionString: string | null }` (nullable to allow clearing). Validates with Zod, updates the tenant row via `basePrisma.tenant.update()` using `c.get('tenantId')`. Returns the masked value.

Masking logic: replace the `Password=...` segment value with `****` before returning. Keep it simple — regex on the connection string format.

**Mount in `apps/api/src/app.ts`:** Add `v1.route('/settings', settingsHandler)` alongside the other tenant routes.

**Patterns to follow:**

- `apps/api/src/handlers/api-clients.ts` — same `requireRole(['tenant_admin'])`, Zod validation, response shape
- `apps/api/src/middleware/rbac.ts` — `requireRole` import

## 2. Frontend — API layer

**New file:** `apps/tenant-web/src/api/settings.ts`

- `getMssqlSettings(): Promise<{ mssqlConnectionString: string | null }>` — calls `GET /api/v1/settings/mssql`
- `updateMssqlSettings(data: { mssqlConnectionString: string | null }): Promise<...>` — calls `PATCH /api/v1/settings/mssql`

**New file:** `apps/tenant-web/src/api/queries/settings.ts`

- Query keys: `settingsKeys.mssql()`
- `mssqlSettingsQueryOptions` — wraps `getMssqlSettings`
- `useUpdateMssqlSettings()` mutation — invalidates on success

**Patterns to follow:**

- `apps/tenant-web/src/api/api-clients.ts` and `apps/tenant-web/src/api/queries/api-clients.ts`

## 3. Frontend — UI section on Developer Settings page

**Modify:** `apps/tenant-web/src/routes/settings.developer.tsx`

Add a "Legacy Database Connection" section **below** the existing API Clients section. Render as a `Card` with:

- Title: "Legacy Database Connection"
- Description: "Configure the SQL Server connection string for the legacy application database."
- Display: show masked connection string (from GET) or "Not configured" empty state
- Edit mode: toggle to an input field with Save/Cancel buttons
- Clear option: button or empty-submit to set `null`
- Role guard: section only visible to `tenant_admin` (consistent with existing page — the API enforces it server-side too)
- Error display: same `formError` + `AlertCircle` pattern used by the API client form

## 4. README update

**Modify:** `apps/api/README.md`

Update the existing "Legacy MSSQL Database Connection" section (step 7) to add a subsection:

> **Configuring via the Web UI:** Tenant administrators can update the connection string from the tenant web app at **Settings > Developer Settings > Legacy Database Connection**. This requires the `tenant_admin` role.

## 5. Tests

- **API handler test:** `apps/api/src/handlers/settings.test.ts` — test GET returns masked value, PATCH updates and returns masked value, PATCH with null clears it, 403 for non-admin role. Follow pattern in `apps/api/src/handlers/api-clients.ts` tests.
- **Frontend test:** `apps/tenant-web/src/__tests__/developer-settings.test.tsx` — extend existing test file to cover the new MSSQL section rendering and interaction.

## Files to create/modify

| Action | Path                                                                 |
| ------ | -------------------------------------------------------------------- |
| Create | `apps/api/src/handlers/settings.ts`                                  |
| Create | `apps/api/src/handlers/settings.test.ts`                             |
| Modify | `apps/api/src/app.ts` (mount settings route)                         |
| Create | `apps/tenant-web/src/api/settings.ts`                                |
| Create | `apps/tenant-web/src/api/queries/settings.ts`                        |
| Modify | `apps/tenant-web/src/routes/settings.developer.tsx` (add MSSQL card) |
| Modify | `apps/tenant-web/src/__tests__/developer-settings.test.tsx` (extend) |
| Modify | `apps/api/README.md` (add UI reference)                              |

## Verification

1. `node node_modules/.bin/turbo run typecheck` — full monorepo type check passes
2. `node node_modules/.bin/turbo run test` — all tests pass including new ones
3. Manual: start dev server, navigate to Settings > Developer Settings, verify the MSSQL card appears, saves, masks the password on reload, and clears when set to empty
