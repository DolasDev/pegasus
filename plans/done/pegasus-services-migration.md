# Plan: Pegasus-Services Lambda → Hono Migration

Migrate the legacy standalone Lambda/DynamoDB API (`~/repos/Pegasus-Services/aws/`) into the
Hono backend (`packages/api`), and update the Python integration service — now housed in
`apps/services/` within this repo — to use the new API.

## Status

- Phase 1: PATCH events endpoint — **done**
- Phase 2: ~~WebSocket push~~ — **dropped** (polling only, see DECISIONS.md)
- Phase 3: Update Python service auth + URLs — **done**
- Phase 4: Decommission legacy Lambdas — **done**

---

## Background

The legacy system had 5 Lambda functions behind an API Gateway:

| Lambda                                 | Endpoint                     | Replacement                                   |
| -------------------------------------- | ---------------------------- | --------------------------------------------- |
| `pegasus_api_StoreRequest2EventsQueue` | POST events, GET/POST orders | ✅ `events.ts`, `orders.ts`                   |
| `EventEndpointHandler`                 | GET/DELETE events            | ✅ `events.ts`                                |
| `pegasus_api_login`                    | XOR token auth               | ✅ M2M API key system (`api-clients.ts`)      |
| `GET_hhg_events_poll`                  | GET poll (was a stub)        | ✅ covered by GET `/api/v1/events/:eventType` |
| `PATCH_events_update`                  | PATCH event (was a stub)     | ✅ `PATCH /api/v1/events/:eventId`            |
| `WebSocketConnectionManager`           | WS connect/disconnect        | ❌ dropped — polling replaces push            |
| `EventPublisher`                       | DynamoDB stream → WS push    | ❌ dropped — polling replaces push            |

Auth change: legacy used an XOR-cipher token via `pegasus_api_login`. New system uses
`vnd_<48 hex>` API client keys sent as `Authorization: Bearer vnd_...`.

The Python service and Electron controller from `~/repos/Pegasus-Services` have been
migrated into `apps/services/` in this repo. `Pegasus-Services` is being decommissioned.

---

## Phase 1 — PATCH /api/v1/events/:eventId ✅

**File:** `packages/api/src/handlers/events.ts`
**Repository:** `packages/api/src/repositories/events.repository.ts`

Add a `PATCH /:eventId` route that allows the integration service to update `eventStatus`
(e.g. `NEW → PROCESSING → DONE`) and optionally set `processedAt`.

Tasks:

- [x] Add `updateEvent(db, id, patch)` to `events.repository.ts`
- [x] Add `PATCH /:eventId` route to `eventsHandler` in `events.ts`
  - Require scope `events:write`
  - Accept `{ eventStatus: string, processedAt?: string }`
  - Return 200 with updated event or 404
- [x] Add test cases to `events.test.ts`

---

## Phase 3 — Update Python Service (`apps/services/`)

The Python service (`apps/services/service/app/APICalls.py`, `app/config.py`) currently
authenticates by calling a token endpoint and sending the resulting Bearer token on each
request, with retry-on-401 refresh logic.

The new auth model is simpler: a static `vnd_<48 hex>` API key sent directly as
`Authorization: Bearer vnd_...` — no token endpoint, no refresh.

**Files:**

- `apps/services/service/app/APICalls.py`
- `apps/services/service/app/config.py`
- `apps/services/controller/src/gui-config.js`

Tasks:

- [x] Update `APICalls.py`:
  - Remove `accessRequest()` and `equusAccessRequest()` functions
  - Update `deleteEvent`, `getNewEvents`, `sendEquusMilestone` signatures — remove
    `client_id`, `client_secret`, `token` params; add `api_key` param
  - Replace all `Authorization: Bearer {token}` headers with `Authorization: Bearer {api_key}`
  - Remove 401 retry-with-refresh logic from all three functions
  - Remove `from requests.auth import HTTPBasicAuth` import
  - Remove `api_auth_url` reference from module-level setup
- [x] Update `config.py`:
  - Add `api_key = data['api_key']`
  - Remove `client_secret`, `client_id`, `api_auth_url` assignments
- [x] Update `gui-config.js`:
  - Replace `API Auth Endpoint` (`api_auth_url`), `API Client Id*` (`client_id`), and
    `API Client Secret*` (`client_secret`) fields with a single `API Key` (`api_key`) field
- [x] Smoke-test: run service in `pegasus-events-receiver` mode against Hono staging

---

## Phase 4 — Decommission Legacy AWS Resources

Once Phase 3 is confirmed working:

- [ ] Delete Lambda functions: `EventEndpointHandler`, `pegasus_api_StoreRequest2EventsQueue`,
      `pegasus_api_login`, `GET_hhg_events_poll`, `PATCH_events_update`,
      `WebSocketConnectionManager`, `EventPublisher` — **skipped** (do manually via AWS console)
- [ ] Delete old API Gateway stage (`jc53u7ina2` / stage `default`, mapping `hhg/v1/dev`) — **skipped**
- [ ] Delete DynamoDB tables: `hhg_api_events_dev`, `hhg_api_events_prod_depricated`,
      `ws_connections` — **skipped**
- [x] Delete `~/repos/Pegasus-Services` (service is now in `apps/services/`)
