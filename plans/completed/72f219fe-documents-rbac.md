# feat(api): RBAC gate on the documents endpoints

## Context

The documents endpoints (`apps/api/src/handlers/documents.ts`) have **no RBAC gate** —
any authenticated tenant user can upload/list/download/delete (flagged as the
follow-up from #546). Add Cedar-backed gating:

- **All roles** may **upload** and **view** documents.
- Only **billing/accounting roles** (`accountant`, `billing_manager`) and
  **`tenant_admin`** may **delete** (and archive).

## Roles (confirmed)

`accountant` (wired), `billing_manager` (placeholder, no permits yet),
`tenant_admin` (permit-everything via `10-tenant-admin.cedar`).

## Changes

### 1. Actions catalog — `src/authz/actions.ts`

- Add `'Document'` to the `ResourceType` union.
- Add:
  - `ReadDocument` → `document:read`
  - `UploadDocument` → `document:upload`
  - `DeleteDocument` → `document:delete`
- Do NOT touch `READ_ACTION_IDS` (unused elsewhere; unconstrained read permit covers all).

### 2. Cedar schema — `src/authz/cedar.schema.json`

- Add `"Document"` entityType (empty Record shape, like `Blob`).
- Add `ReadDocument` / `UploadDocument` / `DeleteDocument` to `actions`
  (`appliesTo: { principalTypes: ["User"], resourceTypes: ["Document"] }`).

### 3. Policies — `src/authz/policies/`

- New `50-documents-shared.cedar`: one unconstrained permit granting
  `ReadDocument` + `UploadDocument` to every principal (all roles).
- `30-personas/accountant.cedar`: add `DeleteDocument` to its action list.
- `30-personas/billing-manager.cedar`: replace the comment-only placeholder with a
  permit granting `DeleteDocument` (keep a short descriptive comment).
- `tenant_admin`: already covered by `10-tenant-admin.cedar` (no change).
- (Placeholder-invariant + role-options drift tests adapt automatically.)

### 4. Handler — `src/handlers/documents.ts`

Mount `requirePermission(...)`:

- `POST /upload-url`, `POST /:id/finalize` → `UploadDocument`
- `GET /:id/download-url`, `GET /entity/:type/:id`, `GET /:id` → `ReadDocument`
- `DELETE /:id`, `PATCH /:id/archive` → `DeleteDocument`
  (Coarse action-only checks — matches "all roles view/upload"; no per-record scoping.)

### 5. Tests — `src/handlers/documents.test.ts`

- Parametrize `buildApp(principal = ADMIN)` and set `c.set('principal', principal)`
  (no `policyStoreId` → offline Cedar backend, same pattern as `moves.test.ts`).
- Add cases: a non-privileged role (e.g. `driver`) CAN upload + read; that role gets
  **403** on delete + archive; `accountant` and `billing_manager` CAN delete.

## Verify

`vitest run src/handlers/documents.test.ts src/authz`, api typecheck, coverage.
One PR → merge queue. Backend-only; no deploy config beyond the normal Deploy.
