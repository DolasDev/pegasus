# Crew-leader link — a login-free page where a crew leader staffs their activities

**Branch:** `feat/crew-leader-link` (worktree `../pegasus-crew-leader-link`). One PR: API + tenant-web + mobile.

**Goal:** a crew leader has no login. A driver shares a link with them. Opening it texts a one-time
code to the crew's phone on file. Once the code checks out, the leader sees a minimal job summary and
can assign their packers to the activities the driver gave their crew. They can also add, edit and
remove packers on their crew.

## What exists today (measured on `main` @ `277004f9`)

- `Crew` is **platform-wide**, keyed by E.164 `phone`, and owns `Packer` rows. Packers are shared
  across tenants (#878). `ActivityLaborCrew` / `ActivityLaborPacker` are tenant-scoped records of
  which crew and packers worked a legacy `LongDistanceDispatchActivity` (#881). Handlers live in
  `apps/api/src/handlers/labor.ts`; activity reads go through `lib/longhaul-driver-activity.ts`.
- **Public capability-link precedent:** feedback surveys. `handlers/feedback-public.ts` is mounted
  pre-tenant at `/api/public/v1` and uses the root db. It resolves the tenant FROM the token via
  `lib/opaque-token` (only a prefix and SHA-256 hash are stored). The SPA page is
  `apps/tenant-web/src/routes/f.$token.tsx`. The whole surface sits behind a feature flag.
- **Outbound SMS:** `services/sms/outbound.ts` `sendTenantSms` sends through the tenant's RingCentral
  connection. It handles STOP opt-out and dedup. **NW is the only prod tenant with a connection**
  (memory, 2026-10).
- **There is no request throttling** anywhere in the API (grep, 2026-10-28). Limits must be counted in
  the DB, using the append-only `CrewLinkAdd` precedent.
- Job details: per-activity address and arrival window come from `lib/itinerary/*`
  (longhaul-activity-rows: place + `arrivalWindow`). Weight comes from `total_est_wt` and the
  `pegasus_shadow.weight` actual, as the mobile shipment screen reads them.

## Steve's decisions (2026-10-28)

1. **No RingCentral connection means not available.** The share action is disabled, with a clear
   message, for a tenant that can't send SMS. It turns on automatically when the tenant connects.
   There is no link-only fallback and no platform SNS sender.
2. **The driver shares the link** from the mobile Labor tab with the native share sheet (their own
   SMS app). The platform does not text the link. It texts only the one-time code.
3. A verified crew leader may **add, edit and remove** their own crew's packers.
4. A leader assigns packers **only on activities where the driver already assigned this crew**. They
   can't attach their crew to other activities.

## Fixed security rules (not options)

- **The one-time code (OTP) goes ONLY to `Crew.phone`.** The page never accepts a phone number. A
  forwarded link is useless without the crew's phone.
- **Link token:** an opaque `lib/opaque-token` value (prefix `crl`) where only the hash is stored. It
  is scoped to `(tenantId, crewPhone, orderNum)` and records `createdByUserId` (the sharing driver).
  It expires 14 days after mint, and re-sharing mints a fresh one. The driver (or Operations) can
  revoke it.
  Re-check on every request: the crew must still be assigned to at least one activity on the order,
  or the response is 404 "no longer active".
- **OTP:** 6 digits from `crypto.randomInt`, stored hashed, expiring in 10 minutes. A new send
  invalidates the previous code. Limits are counted in the DB: at most **3 sends per link per hour**
  and **10 per crew phone per day** across all links, and **5 wrong attempts** burn the link. A burn
  writes a `logger.warn` that names the tenant and order.
  SMS body: "Pegasus: your crew access code is 123456. It expires in 10 minutes." It never contains
  the link. It goes through `sendTenantSms` with `dedupKey = otp:<otpId>`.
- **Session:** a successful verify returns a separate opaque session token (prefix `crs`, hash-only,
  bound to the link row, 12 h TTL). The page sends it in an `X-Crew-Session` header, never a cookie,
  so CSRF doesn't apply. It lives in `sessionStorage`. Revoking or expiring the link kills its
  sessions.
- **Least data on the page:** an address (street, city, state, ZIP) per activity, the activity days,
  the arrival window/start time, estimated and actual weight, and THIS crew's activities with their
  packer selections. **There is no customer name, phone or email, no other crews and no driver phone.**
  The crew name and packer list are shown.
- **Uniform errors:** an unknown, expired or revoked token returns the same 404 body. Responses carry
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, so the token never leaks in a Referer.
- **Attribution:** writes set `createdByUserId`/`updatedByUserId` = the sharing driver, as today's
  non-null columns require. They also append a `CrewLinkAudit` row
  `{linkId, action, packerId?, activityId?, at}`, so "done via crew link" stays distinguishable.
- **Feature flag `CREW_LEADER_LINK_ENABLED`:** the public surface returns 404 when it is off. It MUST
  be wired into `packages/infra` for the api Lambda env (see feedback: a flag-gated feature isn't
  shipped until CDK wires it).

## Data model (Postgres, one migration)

- `CrewAccessLink`: `id`, `tenantId`, `crewPhone`, `orderNum`, `tokenPrefix`, `tokenHash`,
  `createdByUserId` (FK TenantUser, Cascade), `expiresAt`, `revokedAt?`, `burnedAt?`, `createdAt`.
  It has an index on `tokenPrefix` and on `(tenantId, orderNum, crewPhone)`. It is tenant-scoped
  (`TENANT_SCOPED_MODELS`); the public path uses the root db and the token.
- `CrewAccessOtp`: `id`, `linkId`, `codeHash`, `expiresAt`, `attempts`, `consumedAt?`, `createdAt`.
  It is append-only, so it also serves as the send-rate counter.
- `CrewAccessSession`: `id`, `linkId`, `tokenPrefix`, `tokenHash`, `expiresAt`, `createdAt`.
- `CrewLinkAudit`: `id`, `linkId`, `action` (text), `packerId?`, `activityId?`, `detail Json?`, `at`.
- `labor_crew_links` etc. stay unchanged. Add the new models to the schema-sync lists as needed.

## API

**Authenticated (driver, mobile)**, in `labor.ts`, behind the existing labor permissions:

- `GET  /api/v1/labor/sharing` returns `{ available: boolean }`. It is true iff the flag is on AND
  the tenant has a RingCentral connection (`listConnectionsByTenant` / `readOAuthConfig`).
- `POST /api/v1/labor/orders/:orderNum/crews/:phone/link` returns `{ url, expiresAt }`. The caller
  must own at least one activity on the order that this crew is assigned to (the ETA-editor rule), or
  have an Operations role. It fails with 409 `SMS_UNAVAILABLE` when sharing is unavailable. It
  revokes the previous live link for that (tenant, order, crew).
- `DELETE /api/v1/labor/orders/:orderNum/crews/:phone/link` revokes the live link.

**Public** (`handlers/crew-link-public.ts`, mounted at `/api/public/v1/crew-link`, pre-tenant):

- `POST /:token/otp` sends a code. It returns `{ sent: true, phoneHint: "•••• 1234" }`, or 429 when
  rate-limited.
- `POST /:token/verify` takes `{ code }` and returns `{ session, expiresAt }`. A wrong code returns
  400 `{ attemptsLeft }`. A burned link returns 404.
- `GET /:token/job` (session) returns the minimal job summary plus this crew's activities and packers.
- `PUT /:token/activities/:activityId/packers` (session) takes `{ packerIds }`. The activity must
  have an `ActivityLaborCrew` row for (tenant, crew), and each packer must belong to the crew. This
  reuses the existing selection writer.
- `POST /:token/packers`, `PATCH /:token/packers/:id` and `DELETE /:token/packers/:id` (session)
  reuse the `labor.ts` packer validation (`cidKey`/`emailKey` identity, CID-date rule). The packer
  must belong to the link's crew.

The existing write logic is pulled into small shared functions so the public handler doesn't fork
the validation.

## tenant-web

- `routes/c.$token.tsx` is a public route alongside `f.$token.tsx`, outside the auth guard. Its states
  are: send code, enter code (resend has a cooldown), job, invalid/expired, and "texting isn't set up
  for this company".
- Job view: a summary card (address, days, start time, est./actual weight), then one card per assigned
  activity with checkboxes for the crew's packers, then a "My crew" section to add, edit or remove
  packers (with a confirm on remove). The page is built mobile-first, since the crew leader will open
  it on a phone.
- `api/crew-link.ts` is a fetch client sending the `X-Crew-Session` header. The token is kept in
  `sessionStorage`.

## Mobile

- On the shipment Labor tab, each assigned crew card gets a **"Share crew link"** action, shown only
  when `GET /labor/sharing` is available. It mints, then opens React Native's built-in `Share.share`
  with a one-line message plus the URL; no new native module is needed. A "Stop sharing" action
  revokes the link.
- Release: it still needs an **EAS build** after the API deploys, because there is no OTA path.

## Tests

- API unit and handler tests:
  - token scoping across tenant, order and crew
  - the uniform 404
  - OTP expiry, re-send invalidation, the 3/h and 10/day caps, and the 5-attempt burn
  - session expiry and revoke cascade
  - un-assigned activities refused
  - another crew's packer refused
  - a packer write records the driver plus an audit row
  - the flag-off 404
  - the sharing-unavailable 409
  - the job DTO contains no customer name or phone
- tenant-web: route tests for each state.
- mobile: the share action is hidden when sharing is unavailable, and calls `Share.share` with the
  URL.
- `/code-review high` + `/security-review` before `/workstream-finish`.

## Release / still owed after merge

- Deploy green, then set `CREW_LEADER_LINK_ENABLED` per environment (staging first).
- An EAS build for the mobile share button.
- DECISIONS.md entry: the first public write surface onto platform-wide `Packer` rows, and why
  (OTP to `Crew.phone`).

## Status

- [x] Phase 1: migration + models + public API + authenticated mint/revoke + tests (`c5bf3874`)
- [x] Phase 2: tenant-web `/c/$token` page + tests (`8226365c`)
- [x] Phase 3: mobile share action + tests (`d4da9f0b`)
- [x] Phase 4: CDK flag wiring (staging ON, prod OFF), OpenAPI, DECISIONS, archive the plan
- [ ] `/code-review high` + `/security-review`, then `/workstream-finish`

**What differs from the plan above (as built):**

- The audit table is `CrewAccessAudit`, not `CrewLinkAudit`, so it doesn't read as part of
  `CrewLink`. The wrong-code count is `CrewAccessLink.failedAttempts`, reset on success, not an
  `attempts` column per OTP. Only `CrewAccessLink` carries `tenantId`, which makes it
  `TENANT_SCOPED_MODELS`; its OTP, session and audit children hang off it.
- Every attempt is counted BEFORE the compare (`ea689298`), so parallel guesses can't overrun the
  limit of 5.
- After `/code-review high`:
  - **Link scope.** A driver's link covers only the crew assignments that driver made
    (`assignedByUserId`). A link minted by an Operations role sets `allActivities` (a second,
    additive migration) and covers all of them. Re-sharing revokes only the caller's own previous
    link; stop-sharing revokes the caller's link (Operations: all of them) and needs no live
    assignment.
  - **No revival.** A link whose crew is on none of its activities is revoked for good, so
    re-assigning the crew never brings an old link back.
  - **Code sends.** The OTP row is claimed before counting, so parallel sends can't pass the caps.
    A failed or refused send withdraws its row, so it never replaces the code already held. A sent
    code resets the wrong-guess count.
  - **Errors.** An FK race in the packer selection returns 409 `LABOR_CHANGED`. A missing crew on
    `/job` returns the uniform 404.
  - **Web page.** An activity's boxes are locked while its save is in flight, and the job is
    re-read after each save. The page has an "I already have a code" path for after a reload.
- `/security-review`: no findings at confidence ≥ 8.
- Packer writes are shared by both writers through `lib/labor-packers.ts`, extracted from
  `handlers/labor.ts`.
- The feedback public handler's flag middleware is now scoped to `/feedback/*`. Before, its `'*'`
  would have 404'd the crew-link routes on the shared `/api/public/v1` mount whenever feedback was off.
- CORS: `X-Crew-Session` was added to both the Hono `cors()` and API Gateway's `corsPreflight`.
- The flag is `CREW_LEADER_LINK_ENABLED`, plus `CREW_LEADER_LINK_PUBLIC_WEB_URL`, which is the same
  origin as the feedback link. It is **staging only**; for prod, add `'prod'` to
  `crewLeaderLinkEnabled` in `packages/infra/bin/app.ts`.
- tenant-web's crew page uses its own fetch client, not `apiFetch`, so a signed-in user's Cognito
  bearer is never sent to the public endpoint.
