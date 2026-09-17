# Make client-side crashes visible, and attribute requests to a user

**Branch:** `feat/client-error-visibility` · **Goal:** when a tenant-web render crash shows "Something went wrong", leave a trace on the server; and make every `request.completed` line say WHICH user it belongs to.

## Context (so any agent can resume)

Driven by a real prod investigation (2026-09-17, `tkinder@nelsonwesterberg.com`, Nelson Westerberg): he saw "Something went wrong — An unexpected error occurred, please refresh the page or contact support" on the Operations screens. Two things made that near-undiagnosable:

1. **The message is `components/ErrorBoundary.tsx` — a React RENDER crash.** `throwOnError` is not set on the QueryClient (`main.tsx`), so failed queries do NOT reach it. A crash therefore produces **zero** server-side evidence: `console.error` only. Nothing in CloudWatch can ever explain it. (Leading hypothesis for tkinder was a stale bundle after the 09-16 21:14 tenant-web deploy — the CDN maps 404→200→`index.html`, so a missing chunk returns HTML where JS was expected and the dynamic import throws. Unconfirmed, and unconfirmable without this telemetry.)
2. **`request.completed` (`middleware/request-timing.ts`) records route/status/timings but no identity.** Prod showed 403s and 500s on Operations routes with no way to tell which were tkinder's.

## Design

### 1. `userId` + `tenantId` on `request.completed`

`middleware/request-timing.ts` logs in a `finally` AFTER `next()`, so `tenantMiddleware` has already set `tenantId`, `userId` (TenantUser.id, fail-open — may be unset) and `principal.sub`. Add all three as flat fields, omitted when absent:

- `userId` — TenantUser.id (UUID)
- `tenantId` — tenant UUID
- `sub` — Cognito sub

**No email, no name.** UUIDs only — those are already logged elsewhere (e.g. the longhaul resolver's warns) and keep the line PII-free.

### 2. `POST /api/v1/client-errors`

Authenticated (mounted under `v1`, so `tenantMiddleware` applies) — an unauthenticated log-write endpoint is a spam/log-injection vector, and the crash we care about happens on authenticated screens. **Known gap: a crash on `/login` is not captured.** Write that down rather than widening the endpoint.

Body (Zod, all caps enforced server-side so a hostile client cannot bloat the log line):

```
{ message: string (≤500), stack?: string (≤4000), componentStack?: string (≤4000),
  url: string (≤500), userAgent?: string (≤300), appVersion?: string (≤100) }
```

Handler logs ONE `logger.error('client.error', {...})` — the middleware already attaches correlationId/method/path, and #1 adds userId/tenantId — then returns 204. No DB write, no permission gate (any authenticated user may report their own crash).

### 3. Frontend reporting

New `apps/tenant-web/src/lib/report-client-error.ts`:

- `reportClientError(err, extra?)` → POST via `apiFetch`, **never throws** (a failing reporter must not re-crash the page) and never retries.
- Wire into `ErrorBoundary.componentDidCatch` (render crashes, incl. failed dynamic imports).
- Wire `window.addEventListener('error' | 'unhandledrejection')` once in `main.tsx` for crashes outside React's tree.
- De-dupe: same `message` within 10s reported once, so a render loop cannot flood.
- `appVersion` from the build so a stale bundle is identifiable — use the existing build/version value if one exists; otherwise skip rather than inventing one.

## Checklist

- [x] TDD: `request-timing.test.ts` — userId/tenantId/sub present when set, omitted when not, plus a PII guard (no `@` in the line)
- [x] TDD: `client-errors.test.ts` — 204 happy path; logs `client.error` with the fields; over-long fields truncated not rejected; 400 on missing/empty message
- [x] Mount `/client-errors` under v1
- [x] `report-client-error.ts` + unit test (never throws on async reject, sync throw, or non-Error value; de-dupes)
- [x] Wire ErrorBoundary + window listeners; tests for both
- [x] Gates: api vitest 3402, tenant-web vitest 1492, both typechecks, eslint clean
- [x] GOTCHAS: "a render crash leaves no server trace" + how to query `client.error`
- [x] Archive plan into the impl commit

## Outcome notes

- **`appVersion` dropped.** tenant-web has no build stamp and inventing one meant touching the vite config; a failed dynamic import names the chunk in `stack`, which answers the staleness question without it. If a build stamp is ever added, add the field then.
- **Field caps truncate rather than 400.** A too-long report is still the only evidence of the crash; rejecting it would discard exactly what we built this to see.
- `message` is the logger's own first argument, so the reported text is logged as **`clientMessage`** — a Logs-Insights filter is `filter message = 'client.error'`, then read `clientMessage`.
- Not done, deliberately: auto-reloading the page once on a chunk-load failure. That would paper over the stale-bundle case before anyone sees it; get the telemetry first.

## Files

- M `apps/api/src/middleware/request-timing.ts` (+ test)
- A `apps/api/src/handlers/client-errors.ts` (+ test)
- M `apps/api/src/app.ts` (mount)
- A `apps/tenant-web/src/lib/report-client-error.ts` (+ test)
- M `apps/tenant-web/src/components/ErrorBoundary.tsx` (+ test)
- M `apps/tenant-web/src/main.tsx`
- M `dolas/agents/project/GOTCHAS.md`

## Risks

- **Log volume / cost.** A crash loop across many users could be noisy. De-dupe client-side (10s) and keep the payload capped; revisit sampling if it ever shows up in Logs spend.
- **PII.** `message`/`stack` are developer strings, but a crash message _could_ embed user data. Accepted: caps + no deliberate PII fields. Do not add email.
- **Does not fix tkinder.** This makes the NEXT occurrence diagnosable; his crash is still unexplained until it recurs (or he hard-refreshes and it was the stale bundle).
