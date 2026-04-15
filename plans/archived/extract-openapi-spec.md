# Plan: Extract OpenAPI spec from app.ts

**Branch:** TBD (create from main)
**Goal:** Move the hand-authored OpenAPI spec out of `app.ts` into a dedicated module, reducing `app.ts` bloat by ~330 lines.

## Problem

`apps/api/src/app.ts:67-398` contains a 330-line inline OpenAPI JSON literal. It only covers `/health` and `/api/v1/customers`. It bloats the main entrypoint and drifts silently from the actual routes.

## Checklist

### Step 1 — Extract spec to its own file

- [ ] Create `apps/api/src/lib/openapi-spec.ts` — export a function `getOpenApiSpec()` that returns the spec object
- [ ] Move the entire spec literal from `app.ts` into this new file
- [ ] Update `app.ts` to import and call: `app.get('/openapi.json', (c) => c.json(getOpenApiSpec()))`

### Step 2 — Add a smoke test

- [ ] Write `apps/api/src/lib/__tests__/openapi-spec.test.ts`:
  - Spec has `openapi: '3.1.0'`
  - Spec has `paths['/health']`
  - Spec has `paths['/api/v1/customers']`
  - Spec has `components.schemas.Customer`
- [ ] Test passes

### Step 3 — Verify

- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/api`
- [ ] `node node_modules/.bin/turbo run typecheck`

## Files modified

- `apps/api/src/app.ts` (remove ~330 lines, add 1-line import + route)
- `apps/api/src/lib/openapi-spec.ts` (new)
- `apps/api/src/lib/__tests__/openapi-spec.test.ts` (new)

## Notes

This is a pure extract — no spec content changes. Expanding the spec to cover all routes is a separate effort.
