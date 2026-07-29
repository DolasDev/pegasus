# Developer → Integrations tab; original tab narrows to what's live

**Type:** feat · **Slug:** `developer-integrations-tab`

## ✅ EXECUTED 2026-07-29 — all five phases

Confirmed while implementing: **zero API changes were needed.** Every group is
derivable from the existing `GET /api/v1/integrations` payload, and fork/delete/
floors endpoints were all already live with the publish flag on in staging + prod.

- **Phase 1** — `integrations.index.tsx` filters to `published === true`; empty
  state now "No active integrations" and names where to fork one. The
  `published ? … : 'Built-in'` branch became unreachable and was removed.
- **Phase 2** — `IntegrationFloor` + `listIntegrationFloors()` +
  `integrationFloorsQueryOptions` (1h `staleTime`, matching the endpoint's
  `Cache-Control`).
- **Phase 3** — `deleteIntegrationConfig(id, {force})` + `DeleteConfigResult` +
  `useDeleteIntegrationConfig`; `mutationMessage()` maps `FEATURE_DISABLED` /
  `DEPENDENTS_EXIST` / `NOT_FOUND` to something a tenant admin can act on.
- **Phase 4** — `settings.developer.integrations.tsx` with the four groups, wired
  into `router.tsx` and `AppShell`'s `DEVELOPER_CHILDREN`. Each group is a
  labelled `role="region"` (grouping is the page's meaning, so it is exposed to
  assistive tech, and tests target it semantically instead of walking the DOM).
  **Also removed** `IntegrationsCard` from `settings.developer.tsx` — it was a
  view-only twin of the new page; precedent is the Configs split, which left no
  pointer card behind.
- **Phase 5** — `developer-integrations.test.tsx` (15), `integrations-index.test.tsx`
  (5), `integrations-api.test.ts` (5), plus a Developer-submenu wiring test in
  `AppShell.test.tsx`. Removed the 3 obsolete `IntegrationsCard` tests from
  `developer-settings.test.tsx` and the two "scope the ambiguous Integrations
  match" comments that only existed because that card shared the page.

Deferred as planned: `plans/todo/integration-fork-resync.md` (needs the GLOBAL
version in the list payload before a re-sync affordance can be honest).

No SDK change: no new API surface — `integration-config fork` / `delete` already
expose both capabilities to external authors.

Verified: tenant-web 1213 tests green (120 files), eslint clean, monorepo
typecheck clean (12/12).

---

## Goal

Split the integrations surface in two:

- **`/integrations`** (existing, all-user) — only integrations **active for this
  tenant**: rows with an active published config, whether the tenant's own overlay
  or an inherited platform (GLOBAL) one. The unpublished built-in code baselines
  drop out. Reads as "what is live for me right now".
- **`/settings/developer/integrations`** (new, tenant-admin) — the full catalog in
  four labelled groups: **integration floors**, **platform integrations**,
  **built-in baselines**, **your integrations** — with **Fork** on a platform
  integration and **Delete** on a tenant-owned one.

## What already exists (so this stays small)

Verified on `main` before planning — no API work is needed:

- `GET /api/v1/integrations` returns `{id, name, description, published, version,
visibility}` per integration, correctly scoped (built-ins ∪ GLOBAL ∪ the
  tenant's own) as of #559. Every group below is derivable from that payload:
  - platform integration ⇔ `visibility === 'GLOBAL'`
  - your integration ⇔ `visibility === 'TENANT'`
  - built-in baseline ⇔ `published === false`
    A forked id resolves to the tenant's own row (`findActiveForScope` prefers own
    over GLOBAL), so it appears once, under "your integrations" — no double-listing
    and **no API change required**.
- `GET /integrations/floors` — floor id, `canonicalFields`, `factCatalog`,
  `factDocs?`, `inputFieldRoots?`, `defaultAction`, `projection?`. Unguarded read
  on the dual-auth plane, so a Cognito session reaches it. No client fn yet.
- `POST /integrations/:id/config/fork` — client fn `forkIntegrationConfig` +
  `useForkIntegrationConfig` already exist (used by the detail page CTA).
- `DELETE /integrations/:id/config` — endpoint exists (scoped by caller: a tenant
  deletes its own TENANT overlay and re-inherits GLOBAL/built-in live; the
  platform tenant deletes GLOBAL, 409 `DEPENDENTS_EXIST` unless `?force=true`).
  **No client fn yet — this is the one piece of plumbing to add.**
- Both mutations require `Actions.PublishIntegrationConfig` (tenant_admin holds it
  via permit-everything) **and** `INTEGRATION_CONFIG_PUBLISH_ENABLED`, which is on
  in staging + prod (`packages/infra/bin/app.ts:115`). Off in dev → the UI must
  render the 403 `FEATURE_DISABLED` case as a disabled affordance, not an error.

## Plan

### Phase 1 — narrow the original tab

- `routes/integrations.index.tsx`: filter to `published === true`. Client-side —
  the API stays one read model shared with the new page.
- Empty state becomes "No active integrations", pointing tenant admins at
  Developer → Integrations to fork one. Keep it honest for non-admins (who cannot
  reach that page): describe the state, link only when the role allows.
- Update the route's header comment; it currently claims it lists everything the
  platform validates against.

### Phase 2 — floors client surface

- `api/integrations.ts`: `IntegrationFloor` type + `listIntegrationFloors()`.
- `api/queries/integrations.ts`: `integrationFloorsQueryOptions` (+ `floors` key).
  Long `staleTime` — the endpoint sets `Cache-Control: max-age=3600` because floors
  are code, not data.

### Phase 3 — delete client surface

- `deleteIntegrationConfig(integrationId, opts?: {force?: boolean})` +
  `useDeleteIntegrationConfig` invalidating the list, config, and versions keys.
- Surface the distinct failures rather than a generic toast: `FEATURE_DISABLED`
  (403), `DEPENDENTS_EXIST` (409, platform-tenant only), `NOT_FOUND` (404).

### Phase 4 — the Developer page

New `routes/settings.developer.integrations.tsx` + route in `router.tsx` + a
second entry in `AppShell.tsx`'s `DEVELOPER_CHILDREN` (that array IS the "tabs"
mechanism under Developer — `Configs` is its only member today).

Four groups, each a card with a count, rendered in this order:

1. **Integration floors** — read-only reference. Per floor: id, `defaultAction`,
   projection entity, fact count, canonical-field count; expandable to the fact
   catalog (name → type, plus `factDocs` line when present) and
   `inputFieldRoots`. No actions — a floor is code.
2. **Platform integrations** — `visibility === 'GLOBAL'`. Version badge +
   **Fork to my tenant**. On success, invalidate and the row moves to group 4.
3. **Built-in baselines** — `published === false`. Badged "code only", no
   actions, one line explaining they govern validation until something is
   published. Prevents the #559 confusion where these read as broken.
4. **Your integrations** — `visibility === 'TENANT'`. Version badge, fork
   provenance when present, and **Delete** behind a confirm dialog that states
   the real consequence: the tenant re-inherits the platform config (or the
   built-in) **immediately**, and version history goes with it.

Each row links to the existing `/integrations/$integrationId` detail page for
mapping/rules — no editor work here.

No Radix `Tabs`: groups are plain cards/collapsibles. jsdom `fireEvent` cannot
switch Radix tabs, which has cost us test coverage before.

### Phase 5 — tests (tenant-web vitest + jsdom)

- Grouping: a fixture list covering all four cases lands each row in the right
  group, with the right actions present/absent (assert Fork is absent on a
  built-in and on a tenant row; Delete absent on GLOBAL and built-in rows).
- Fork: click → `forkIntegrationConfig` called with the id; list invalidated.
- Delete: click → confirm required → called with the id; cancel calls nothing.
- Delete failures: `FEATURE_DISABLED` and `DEPENDENTS_EXIST` each render their own
  message.
- Floors: renders one row per floor and expands to show facts.
- `integrations.index.tsx`: unpublished rows are filtered out; empty state when
  nothing is published.

## Out of scope

- Any API change (none needed — see above).
- **Re-sync a stale fork** (`POST …/fork?force=true`, an existing capability):
  would need the GLOBAL version alongside the tenant's in the list payload to know
  when to offer it. Deliberately deferred so this stays fork+delete as asked; noted
  in `plans/todo/` rather than half-built as a dead-end hint.
- Editing mapping/rules (already on the detail page), publish-from-scratch,
  floor authoring.

## Verification

- tenant-web: `npm test`, `npm run lint`, `npm run typecheck`.
- Manual: Developer → Integrations shows all four groups; fork a platform
  integration and watch it move to "Your integrations"; delete it and watch the
  platform row come back; confirm `/integrations` lists only published rows
  throughout.
