# Plan — Tenant-session "published integrations" list endpoint

**Status:** todo
**Owner:** TBD
**Origin:** Follow-up to PR #344 (Developer-page SDK + Integrations sections). The
Developer page's `IntegrationsCard` currently renders a **static** list that
mirrors the server registry. This plan replaces it with a live, session-auth API.

---

## 1. Goal

Expose a read-only, tenant-session endpoint that lists the integrations the
platform validates inbound orders against, so `apps/tenant-web` can render the
"Integrations" card from real data instead of a hardcoded const.

**Definition of done**

- `GET /api/v1/integrations` returns the registered integrations for a logged-in
  tenant user, each with a display name, description, and published-config status
  (active version + visibility, when one exists).
- `IntegrationsCard` on the Developer page consumes it via TanStack Query; the
  static `PUBLISHED_INTEGRATIONS` const is deleted.
- Unit/integration tests cover the handler (authn/authz + shape) and the registry
  additions.

---

## 2. Background / current state

- **Registry** (`apps/api/src/integration-validation/registry.ts`) is the source
  of truth. It exposes:
  - `listIntegrationIds(): string[]` → `['longhaul', 'weichert']` (the built-ins).
  - `getIntegrationDefinition(id): IntegrationDefinition | undefined` (built-in +
    DB overlay merged).
- **`IntegrationDefinition`** (`integration-validation/types.ts`) has **no**
  human-facing `displayName`/`description` today — only `id` and the validator
  internals. The frontend currently invents the display strings.
- **Published configs** live in the `integrationConfig` table, read via
  `createIntegrationConfigRepository(db)`:
  - `findActiveForScope(integrationId, tenantId)` → active config for this tenant
    (own TENANT row, else GLOBAL), or `null`.
  - `listActiveGlobal()` → all active GLOBAL configs.
  - Rows carry `version` and `visibility` (`GLOBAL` | `TENANT`).
- **Route planes** in `apps/api/src/app.ts`:
  - `m2mV1` (`/api/v1`, dual/M2M auth) — where the existing `integrationConfig`
    - `integrationValidation` handlers live (SDK/CLI surface, `vnd_` keys).
  - `v1` (`/api/v1`, Cognito session + RBAC) — where tenant-web reads come from
    (`/me`, `/users`, `/settings`, `/integrations/ringcentral`, …).
  - **Both mount at `/api/v1`**; Hono dispatches by path. The new read belongs on
    the **`v1` (session) plane**.
- **RBAC:** `Actions.ReadIntegrationConfig` → permission `integration_config:read`
  (`apps/api/src/authz/actions.ts:182`). Confirm whether `tenant_admin` already
  carries it in `apps/api/src/authz/role-options.ts`; grant if not (the Developer
  page is `ADMIN_ONLY`).

---

## 3. API changes (`apps/api`)

### 3a. Add display metadata to the registry (source-of-truth move)

In `integration-validation/types.ts`, extend `IntegrationDefinition`:

```ts
/** Human-facing label for UI/list surfaces (e.g. "LongHaul"). */
displayName: string
/** One-line description of what the integration validates. */
description: string
```

Set both on `longhaulDefinition` and `weichertDefinition` in `registry.ts`.
(These are the strings currently hardcoded in the frontend — move them here so
the API owns them.)

### 3b. New handler `apps/api/src/handlers/integrations/list.ts`

- `const integrationsHandler = new Hono<AppEnv>()`
- `integrationsHandler.get('/', requirePermission(Actions.ReadIntegrationConfig), async (c) => …)`
- Logic:
  1. `const tenantId = c.get('tenantId')`
  2. For each `id` of `listIntegrationIds()`:
     - `def = getIntegrationDefinition(id)` → `displayName`, `description`,
       `defaultAction`.
     - `active = await repo.findActiveForScope(id, tenantId)` → `published`,
       `version`, `visibility` (null-safe).
  3. Return `{ data: IntegrationSummary[] }`.
- **Shape** (`IntegrationSummary`):
  ```ts
  {
    id: string
    name: string
    description: string
    published: boolean
    version: number | null
    visibility: 'GLOBAL' | 'TENANT' | null
  }
  ```
- Keep it read-only — no body validation, no mutations.

### 3c. Mount on the session plane (`app.ts`)

```ts
v1.route('/integrations', integrationsHandler)
```

⚠️ **Ordering caveat:** `/integrations/ringcentral` is already mounted on `v1`.
Mount the new base handler so it only answers `GET /integrations` (exact `/`),
and keep the ringcentral mount **after** it (or vice-versa) — verify in an
app-level test that `GET /api/v1/integrations/ringcentral/...` still resolves to
`ringcentralOauthHandler` and isn't shadowed.

### 3d. RBAC

- Confirm `tenant_admin` has `integration_config:read` in `role-options.ts`. If
  not, add it. Re-seed/verify via the AVP sync path if Cedar policies are
  affected (see `feedback_avp_bulk_sync_throttle_retry` — only relevant if this
  introduces a new permission string).

---

## 4. Frontend changes (`apps/tenant-web`)

### 4a. API client `apps/tenant-web/src/api/integrations.ts` (mirror `event-types.ts`)

```ts
import { apiFetch } from './client'

export interface IntegrationSummary {
  id: string
  name: string
  description: string
  published: boolean
  version: number | null
  visibility: 'GLOBAL' | 'TENANT' | null
}

export function listIntegrations(): Promise<{ data: IntegrationSummary[] }> {
  return apiFetch('/api/v1/integrations')
}
```

### 4b. Query options `apps/tenant-web/src/api/queries/integrations.ts`

```ts
export const integrationsQueryOptions = {
  queryKey: ['integrations', 'list'],
  queryFn: () => listIntegrations(),
}
```

### 4c. Wire `IntegrationsCard` (`routes/settings.developer.tsx`)

- Replace the static `PUBLISHED_INTEGRATIONS` const + map with
  `useQuery(integrationsQueryOptions)`.
- Render loading (`Loader2`) / error (`AlertCircle`) / empty (`EmptyState`,
  already imported) states — match the page's existing patterns.
- Show a "Published vN" / visibility badge when `published`, else a muted
  "Built-in" hint.
- Remove the placeholder comment block referencing the registry.

---

## 5. Tests

- **`apps/api`** (`handlers/integrations/__tests__/list.test.ts`):
  - 401/403 without session / without `integration_config:read`.
  - 200 returns one row per `listIntegrationIds()` with display metadata.
  - `published/version/visibility` reflect an active config row vs none
    (seed an `integrationConfig` row for one id).
- **`apps/api` app-level:** `GET /api/v1/integrations/ringcentral/...` still
  routes to the ringcentral handler (no shadowing).
- **`apps/tenant-web`** (`developer-settings.test.tsx`): mock
  `integrationsQueryOptions`; assert the card renders fetched rows and the
  loading/empty states. The existing element-scoped "Integrations" assertions
  (h3 title vs span/div role labels) stay valid.

---

## 6. Decisions / open questions

1. **Display metadata location** — recommend the registry (3a) over the handler,
   so the validator module owns its own labels. (Alternative: a small lookup map
   in the handler — rejected, drifts from the registry.)
2. **TENANT-published integrations** — `findActiveForScope` already returns a
   tenant's own TENANT-visibility config. Confirm whether non-platform tenants
   should ever see TENANT rows here, or GLOBAL-only. Default: whatever
   `findActiveForScope` returns (own-or-global), matching the validator's live
   resolution.
3. **Permission** — reuse `integration_config:read` vs introduce `integration:read`.
   Recommend reuse (one less Cedar action to sync); revisit only if product wants
   integrations visible to a non-config-reading role.

---

## 7. Out of scope

- Any write/publish surface from tenant-web (publishing stays SDK/CLI on the M2M
  plane).
- Per-integration detail view, version history UI, rule/mapping display.
- Wiring RingCentral or other non-validator "integrations" into this list — it is
  specifically the integration-**validator** registry.
