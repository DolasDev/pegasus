# Plan: Mobile Convergence — Config Hardening, Shared Packages, Real API

**Branch:** TBD (create from main)
**Goal:** Complete mobile platform integration: harden config loading, wire up shared packages (`@pegasus/api-http`, `@pegasus/domain`), persist auth token, replace mock data with real API calls, and finish deploy wiring.

## Background

This plan reconciles and replaces three overlapping plans:

- **`mobile-auth-overhaul`** — Phases 1, 2, 4 are already done (config baked in, authService refactored, jest.setup wired). Remaining: Phase 3 (deploy script + eas.json) and Phase 5 (deprecated endpoint cleanup).
- **`mobile-config-lazy-load`** — Improves the config module created by auth-overhaul: prevents startup crash on missing env vars.
- **`mobile-api-integration`** — Adds `@pegasus/api-http` + `@pegasus/domain`, persists token, replaces mock OrderService with real API calls.

### What's already done (from auth-overhaul)

- `apps/mobile/src/config.ts` exists with `getMobileConfig()` + `MobileConfig` type
- `apps/mobile/src/config.test.ts` exists with 6 test cases
- `authService` accepts `config: MobileConfig` (no more `fetchMobileConfig`)
- `jest.setup.js` has `EXPO_PUBLIC_COGNITO_*` env vars
- `GET /api/auth/mobile-config` endpoint already has deprecation log line
- SSO login fully implemented (`oauthService`, `authenticateWithSso`)

---

## Phase 1: Harden config loading (from mobile-config-lazy-load)

The current `_layout.tsx:11` calls `getMobileConfig()` at module scope — if env vars are missing, the entire app crashes with no recovery.

### Step 1.1 — Update config tests (TDD)

- [ ] Update `apps/mobile/src/config.test.ts`:
  - `getMobileConfig()` throws `ConfigError` (not plain `Error`) when env vars are missing
  - `getMobileConfig()` caches result after first successful call (second call doesn't re-read env)
  - Add new: `isConfigValid()` returns `true` when env vars are set
  - Add new: `isConfigValid()` returns `false` when env vars are missing (no throw)

### Step 1.2 — Implement lazy config with error class

- [ ] Rewrite `apps/mobile/src/config.ts`:
  - Export `ConfigError extends Error` with typed `code` field
  - `getMobileConfig()` throws `ConfigError` (not plain `Error`), caches on success
  - Export `isConfigValid(): boolean` — calls `getMobileConfig()` in try/catch, returns boolean
- [ ] Tests pass

### Step 1.3 — Add config error screen in layout

- [ ] Update `apps/mobile/app/_layout.tsx`:
  - Move `getMobileConfig()` call from module scope (line 11) to inside the component
  - Check `isConfigValid()` before rendering `AuthProvider`
  - If invalid, show a simple error screen with "Configuration error" message
  - `authService` creation moves inside the component (or a useMemo) since config is now lazy
- [ ] Verify: `cd apps/mobile && npx jest`

---

## Phase 2: Persist auth token (prerequisite for API calls)

Currently `authService.authenticate()` discards the idToken after `validate-token` succeeds (AUTH-03). To make authenticated API calls, the token must be returned and stored.

### Step 2.1 — Update Session type + auth tests (TDD)

- [ ] Update `apps/mobile/src/auth/types.ts` — add `token: string` to `Session` type
- [ ] Write test in `apps/mobile/src/auth/authService.test.ts`: after `authenticate()`, returned session includes `token` field
- [ ] Write test: after `authenticateWithSso()`, returned session includes `token` field

### Step 2.2 — Persist token in auth service

- [ ] Update `authService.ts` `authenticate()` — include `idToken` as `token` in returned Session
- [ ] Update `authService.ts` `authenticateWithSso()` — same
- [ ] `AuthContext` already persists session via SecureStore — token flows through automatically
- [ ] Tests pass

### Step 2.3 — Update AuthContext tests

- [ ] Update `apps/mobile/src/context/AuthContext.test.tsx` — mock sessions now include `token` field
- [ ] Verify existing cold-start restore + expiry tests still pass

---

## Phase 3: Wire shared packages

### Step 3.1 — Add package dependencies

- [ ] `apps/mobile/package.json` — add `"@pegasus/api-http": "*"` and `"@pegasus/domain": "*"` to dependencies
- [ ] Update `jest.config.js` `moduleNameMapper`:
  ```js
  '^@pegasus/api-http$': '<rootDir>/../../packages/api-http/src/index.ts',
  '^@pegasus/domain$': '<rootDir>/../../packages/domain/src/index.ts',
  ```
- [ ] `npm install` from root
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/mobile`

### Step 3.2 — Create mobile API client (TDD)

- [ ] Write `apps/mobile/src/api/__tests__/client.test.ts`:
  - `mobileFetch` attaches `x-correlation-id` header
  - `mobileFetch` attaches `Authorization: Bearer <token>` when session exists
  - `mobileFetch` unwraps `{ data }` envelope
  - `mobileFetch` throws `ApiError` on error responses
  - `mobileFetchPaginated` returns `{ data, meta }`
- [ ] Create `apps/mobile/src/api/client.ts`:
  - Import `createApiClient` from `@pegasus/api-http`
  - `getBaseUrl` reads from `getMobileConfig().apiUrl`
  - `getToken` reads current session token from SecureStore (or exported getter)
  - Export `mobileFetch` and `mobileFetchPaginated`
- [ ] Tests pass

### Step 3.3 — Replace local types with domain types

- [ ] Update `apps/mobile/src/types/index.ts`:
  - Remove `TruckingOrder`, `InventoryItem`, `OrderStatus` definitions
  - Re-export from `@pegasus/domain`: `Serialized<Move>`, `MoveStatus`, `Serialized<InventoryItem>`
  - Keep `Driver` as mobile-only if no domain equivalent exists
  - Export type aliases for backwards compat if screens use the old names:
    ```ts
    import type { Serialized } from '@pegasus/domain'
    import type { Move, MoveStatus } from '@pegasus/domain'
    export type TruckingOrder = Serialized<Move> // transitional alias
    export type OrderStatus = MoveStatus
    ```
- [ ] Update screen imports as needed
- [ ] Typecheck passes

---

## Phase 4: Replace mock data with real API calls (TDD)

### Step 4.1 — Rewrite OrderService tests

- [ ] Rewrite `apps/mobile/src/services/orderService.test.ts`:
  - `getOrders()` calls `mobileFetch` with `/api/v1/moves` (mock the client)
  - `getOrderById(id)` calls `mobileFetch` with `/api/v1/moves/{id}`
  - `updateOrderStatus(id, status)` calls `mobileFetch` with PUT
  - On network failure, falls back to AsyncStorage cache
  - On success, writes result to AsyncStorage cache

### Step 4.2 — Rewrite OrderService

- [ ] Rewrite `apps/mobile/src/services/orderService.ts`:
  - Import `mobileFetch` from `../api/client`
  - `getOrders()` — fetch from API, cache in AsyncStorage, fall back to cache on error
  - `getOrderById(id)` — fetch from API, fall back to cache
  - `updateOrderStatus(id, status)` — PUT to API
  - `addProofPhoto(orderId, photoUri)` — POST to API (or keep local until API endpoint exists)
  - Remove `MOCK_ORDERS` import from production code (keep in test fixtures)
- [ ] Move `mockData.ts` to `services/__fixtures__/mockData.ts` (test-only)
- [ ] Tests pass

### Step 4.3 — Update screens for async loading

- [ ] `apps/mobile/app/(tabs)/index.tsx` — add loading spinner and error state
- [ ] `apps/mobile/app/order/[id].tsx` — add loading spinner and error state
- [ ] Verify: `cd apps/mobile && npx jest`

---

## Phase 5: Deploy wiring + cleanup (from auth-overhaul remaining)

### Step 5.1 — Add Cognito env vars to eas.json build profiles

- [ ] Update `apps/mobile/eas.json`:
  - Add to `preview.env`: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_REGION`, `EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`, `EXPO_PUBLIC_COGNITO_DOMAIN`, `EXPO_PUBLIC_COGNITO_REDIRECT_URI`
  - Add to `production.env`: same keys with production values (or EAS Secrets references)

### Step 5.2 — Add mobile config generation to deploy script

- [ ] Update `packages/infra/deploy.sh`:
  - After CDK deploy, read Cognito outputs and generate `apps/mobile/.env.deploy`
  - Add `.env.deploy` to `apps/mobile/.gitignore`

### Step 5.3 — Create .env.example

- [ ] Create `apps/mobile/.env.example` with all `EXPO_PUBLIC_*` keys and placeholder values

### Step 5.4 — Verify deprecated endpoint has deprecation log

- [ ] Confirm `apps/api/src/handlers/auth.ts` `GET /mobile-config` has deprecation log (already done — just verify)

---

## Phase 6: Final verification

- [ ] `cd apps/mobile && npx jest`
- [ ] `node node_modules/.bin/turbo run typecheck`
- [ ] `node node_modules/.bin/turbo run test`

---

## Files summary

| File                                            | Action                                               | Phase |
| ----------------------------------------------- | ---------------------------------------------------- | ----- |
| `apps/mobile/src/config.ts`                     | Modify (lazy + ConfigError + cache)                  | 1     |
| `apps/mobile/src/config.test.ts`                | Modify (add ConfigError, isConfigValid, cache tests) | 1     |
| `apps/mobile/app/_layout.tsx`                   | Modify (lazy config + error screen)                  | 1     |
| `apps/mobile/src/auth/types.ts`                 | Modify (add `token` to Session)                      | 2     |
| `apps/mobile/src/auth/authService.ts`           | Modify (return token in session)                     | 2     |
| `apps/mobile/src/auth/authService.test.ts`      | Modify (assert token in session)                     | 2     |
| `apps/mobile/src/context/AuthContext.test.tsx`  | Modify (mock sessions with token)                    | 2     |
| `apps/mobile/package.json`                      | Modify (add api-http + domain deps)                  | 3     |
| `apps/mobile/jest.config.js`                    | Modify (add moduleNameMapper)                        | 3     |
| `apps/mobile/src/api/client.ts`                 | **New**                                              | 3     |
| `apps/mobile/src/api/__tests__/client.test.ts`  | **New**                                              | 3     |
| `apps/mobile/src/types/index.ts`                | Modify (replace with domain re-exports)              | 3     |
| `apps/mobile/src/services/orderService.ts`      | Rewrite (real API + cache)                           | 4     |
| `apps/mobile/src/services/orderService.test.ts` | Rewrite                                              | 4     |
| `apps/mobile/src/services/mockData.ts`          | Move to `__fixtures__/`                              | 4     |
| `apps/mobile/app/(tabs)/index.tsx`              | Modify (loading/error states)                        | 4     |
| `apps/mobile/app/order/[id].tsx`                | Modify (loading/error states)                        | 4     |
| `apps/mobile/eas.json`                          | Modify (add env vars)                                | 5     |
| `packages/infra/deploy.sh`                      | Modify (generate .env.deploy)                        | 5     |
| `apps/mobile/.env.example`                      | **New**                                              | 5     |
| `apps/mobile/.gitignore`                        | Modify (add .env.deploy)                             | 5     |

## Dependencies

- `wire-safe-response-types` should land first so Phase 3.3 uses `Serialized<T>` from day one
- `extract-shared-auth-pkce` can land before or after — it touches auth primitives, not the API client or data layer

## Risks

- **Offline support**: AsyncStorage is preserved as a cache layer, not removed. Fetch-first, cache-fallback.
- **Token expiry**: Token is stored but no refresh flow. Sessions expire after Cognito TTL (~1 hour). Refresh is out of scope.
- **AUTH-03 change**: The original security decision was to discard raw tokens. This plan reverses that for the idToken specifically, since it's needed for authenticated API calls. The token is stored in SecureStore (encrypted on native, localStorage on web preview).
