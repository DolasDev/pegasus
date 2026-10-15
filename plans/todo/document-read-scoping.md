# Document reads — scope to what the caller may see

**Status:** TODO (raised 2026-10-15 as the out-of-scope item of `plans/completed/3fcd199c-longhaul-driver-scoping.md`).
Needs a design decision before implementation.

## Problem

`apps/api/src/authz/policies/50-documents-shared.cedar` permits `ReadDocument` and `UploadDocument` to **every**
principal, unconstrained, by design ("every authenticated tenant user may read and upload documents, regardless of
role"). The handlers in `apps/api/src/handlers/documents.ts` gate on that Action only, so any signed-in tenant user —
including a driver on the mobile app — can:

- list any entity's documents: `GET /documents/entity/:entityType/:entityId` for `customer`, `quote`, `move`,
  `invoice`, `shipment`;
- read any document's metadata and presigned download URL by id: `GET /documents/:documentId`,
  `GET /documents/:documentId/download-url`;
- upload against any entity.

Documents are tenant-scoped (no cross-tenant leak), but within a tenant this is the same gap #852 closed for the
longhaul reads: a driver can enumerate other drivers' shipment paperwork (BOLs, inventories, customer details) and
billing documents (`invoice`, `quote`).

## Direction (high level)

Scope document access by the **parent entity**, using the same rule the parent's own read uses — don't invent a
second rule:

- `shipment` → `lib/longhaul-read-scope.ts` (Operations roles: all; anyone else: shipments with an activity on
  their own trips — the same EXISTS as `GET /onprem/longhaul/shipments`).
- `move` → the crew scoping in `handlers/moves.ts` (`loadReadableMove` / `crewMemberId`).
- `customer`, `quote`, `invoice` → whatever role reads those entities today (likely Operations/billing roles only;
  a driver has no business reading them).

Apply it to list-by-entity, get-by-id and download-url (resolve the document's `entityType`/`entityId`, then check
the parent), and to upload (a driver may attach paperwork only to a shipment they can read — the mobile doc-scan flow).

## Open questions (decide before planning)

1. **Cedar vs handler.** Push per-entity checks into Cedar (resource attributes on `Document`, AVP re-sync, the
   placeholder-persona invariant in `lib/authz.test.ts`, the post-merge `authz-smoke` gate) or keep `ReadDocument`
   broad and add handler-level parent checks like the longhaul reads? The longhaul precedent argues for handler-level.
2. **Which roles read `customer`/`quote`/`invoice` documents?** No server-side read rule exists for those entities
   that a driver is excluded from — this needs a product answer.
3. **Uploads.** Keep upload open to every principal for entities they can read, or restrict further?
4. **Callers to verify:** mobile doc scan (`plans/completed/cfd18590-shipment-doc-scan.md`), tenant-web document
   panels, any workflow/M2M path that reads documents.

## Acceptance (when planned)

A non-Operations user cannot list, read, download or upload documents for an entity they cannot read through its own
route; Operations/billing users and the mobile doc-scan flow are unchanged.
