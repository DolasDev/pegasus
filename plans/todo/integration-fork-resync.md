# Re-sync a stale forked integration config from the platform

**Status:** todo (deliberately deferred out of the Developer → Integrations tab,
`plans/completed/developer-integrations-tab.md`)

## The gap

A tenant that forks a platform (GLOBAL) integration config gets a snapshot: the
row is stamped with `forkedFromConfigId` / `forkedFromVersion`, and from then on
the tenant's overlay governs validation. When the platform publishes a newer
GLOBAL version, nothing tells the tenant, and nothing pulls it in.

The API capability already exists — `POST /integrations/:id/config/fork?force=true`
re-seeds an existing overlay from the CURRENT GLOBAL as a new tenant version
(sdk-feedback 0030 part B), superseding rather than dropping the old row, so a bad
refresh is reversible via `versions` + `rollback`. It is reachable from the SDK
(`integration-config fork --force`) but has no UI.

## Why it was deferred

The Developer → Integrations tab groups by what `GET /api/v1/integrations`
returns, and that payload carries only the **resolved** config for the caller's
scope. For a forked id the resolved row is the tenant's own, so the page cannot
see whether the platform's GLOBAL is newer — there is nothing to compare against.
Shipping a "Re-sync from platform" button without that would either always show
(inviting a pointless re-fork) or show a hint that leads nowhere.

## What it needs

1. **API** — the GLOBAL version alongside the tenant's in the list read model.
   `listIntegrationSummaries` (`apps/api/src/integration-validation/summaries.ts`)
   already has every GLOBAL row in hand via the overlay warm; adding
   `platformVersion: number | null` costs one `listActiveGlobal()` call mapped by
   id, not a per-id query. Additive field.
2. **tenant-web** — `forkIntegrationConfig(id, { force: true })` (the client fn
   currently takes no options) + a "Re-sync from platform" action on an owned row
   whose `forkedFromVersion < platformVersion`, behind a confirm that says the
   tenant's local edits to mapping/rules are replaced (recoverable via version
   history).
3. **Provenance display** — "forked from platform v3 · platform is now at v5" on
   the owned row, so the state is legible even before acting.

## Out of scope for that follow-up

- Merging platform changes INTO local edits. Re-sync is a replace, and the confirm
  must say so; a real 3-way merge of mapping/rules is a much larger design.
