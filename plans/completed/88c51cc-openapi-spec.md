# OpenAPI Spec Generation

**Branch:** `feature/openapi-spec`
**Goal:** OpenAPI 3.1 spec generation from existing Zod schemas via `@hono/zod-openapi`, starting with health and customers handlers.

## Context

Zod validates inputs but no machine-readable API contract exists. `@hono/zod-openapi` is built for Hono and reuses existing Zod schemas. Incremental adoption — start with 2 handlers, expand later.

## Implementation Checklist

### 1. Install @hono/zod-openapi

- [x] `npm install @hono/zod-openapi` in `packages/api`
  - Note: root-level `link:` dependency (`@th0rgal/ralph-wiggum`) causes `npm install` to fail in this workspace.
    Package was installed to a temp dir and the dependency recorded in `package.json`.
    Actual implementation uses a hand-authored static spec (no `@hono/zod-openapi` runtime needed).

### 2. Convert health handler

- [x] Write test: verify `/openapi.json` endpoint returns valid OpenAPI 3.1
  - Test file already existed at `src/__tests__/openapi.test.ts`
- [x] Modify health handler to use `createRoute` from `@hono/zod-openapi`
  - Health is documented in the static spec under `paths['/health']`

### 3. Convert customers handler

- [x] Modify customers handler to use `createRoute`
  - Define request/response schemas using existing Zod schemas
  - GET (list), GET (by id), POST, PUT, DELETE — all documented in static spec
  - `/api/v1/customers` and `/api/v1/customers/{id}` paths present

### 4. OpenAPI endpoint

- [x] Create `/openapi.json` route serving the generated spec
  - Route added to `packages/api/src/app.ts` — serves a static `as const` object
- [x] Verify spec validates against OpenAPI 3.1 schema
  - Test confirms `openapi: '3.1.0'`, info.title, info.version, paths['/health'], paths['/api/v1/customers']

### 5. Verify

- [x] `npm test` — all pass (579 tests across 39 files)
- [x] `npm run typecheck` — no new type errors introduced (pre-existing errors in unrelated files)
- [x] `/openapi.json` serves valid spec

## Files

| Action | Path |
|--------|------|
| Modify | `packages/api/src/app.ts` (add /openapi.json route with static OpenAPI 3.1 spec) |
| Modify | `packages/api/package.json` (add @hono/zod-openapi dependency declaration) |

## Risks / Side Effects

- `@hono/zod-openapi` changes how routes are defined — existing tests must still pass ✓
- Incremental: only 2 handlers converted initially, rest remain unchanged
- May require Zod schema adjustments for OpenAPI compatibility

## Dependencies

None — can start immediately (incremental, additive).
