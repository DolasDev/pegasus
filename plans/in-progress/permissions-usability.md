# Make Cedar/AVP permissions actually usable end-to-end

## Status

The plumbing is done. Per-tenant AVP policy stores are provisioned for
every tenant in staging and prod (see
`plans/completed/2026-05-07T2102-avp-attribute-based-policies.md`). The
legacy `tenant_users.role` enum and `custom:role` claim are gone (see
`authz-cedar-avp-followups.md` item #6, closed 2026-05-07). All 26
actions resolve correctly through Cedar against the 7 system policies.

**What's still not usable:**

1. The 5 persona policies (`dispatcher`, `sales`, `accountant`,
   `auditor`, `crew_lead`) ship into every store but **no UI lets a
   tenant admin assign them**. Today's tenant-web users page is a
   binary `tenant_admin ↔ tenant_user` toggle. Same in admin-web.
2. **No frontend reads `/api/v1/me/permissions`.** Every action button
   is rendered regardless of whether the API will allow it. A
   tenant_user who clicks "Invite user" gets a 403 toast instead of
   the button being hidden / disabled. Backend is fail-closed (correct)
   but the UX is hostile.
3. There's no end-to-end test for any persona other than `tenant_admin`
   and `tenant_user`. A future refactor that breaks (e.g.) the
   dispatcher policy wouldn't be caught by the staging gate.

## Goal

A tenant admin can assign any subset of the 7 Cedar role-groups to a
user via the Web UI; the resulting tenant-web/admin-web UI hides
controls the user can't act on; a regression in any persona policy is
caught in staging E2E before it reaches prod.

## Non-goals

- **Changing the persona set.** Stays at 7. New personas land via the
  separate "tenant-authored Cedar" plan when an enterprise asks
  (`authz-cedar-avp-followups.md` item #7, deferred).
- **Per-instance ABAC** ("you can only edit moves in your region").
  `requirePermission(action, resourceFn)` already supports it; rolling
  it out across handlers is its own phase.
- **Mobile app permission gating.** The mobile app uses the same
  `session.role` shim and has no granular UI today; revisit when mobile
  features grow beyond "view assigned moves."
- **Operational hygiene items** (#9 store-count metric, #10 empty-sub
  tightening). Those stay in `authz-cedar-avp-followups.md`.

## Plan

### Phase A — Persona assignment UX

The headline gap. Today the only way to set a persona is direct DB:
`UPDATE tenant_users SET role_names = ARRAY['dispatcher'] WHERE id=...`.
That's not a product feature, it's a DBA escape hatch.

- [ ] **A1. Expose the role-name catalog from the API.**

      New endpoint `GET /api/v1/users/role-options` (gated by
      `requirePermission(Actions.ListUsers)`) returns:

      ```json
      {
        "data": [
          { "name": "tenant_admin", "label": "Admin", "description": "Full access to every tenant feature." },
          { "name": "tenant_user",  "label": "User (read-only)", "description": "Read-only baseline across moves, quotes, customers, invoices." },
          { "name": "dispatcher",   "label": "Dispatcher", "description": "Read everything operational; write moves and customer detail at dispatch." },
          { "name": "sales",        "label": "Sales", "description": "Full quote and customer authoring; read-only on moves." },
          { "name": "accountant",   "label": "Accountant", "description": "Full invoice control; read-only on derived moves and quotes." },
          { "name": "auditor",      "label": "Auditor", "description": "Read-only across every operational entity." },
          { "name": "crew_lead",    "label": "Crew Lead", "description": "Read assigned moves and customers; update moves to record progress." }
        ]
      }
      ```

      Source: a hand-curated array in `apps/api/src/authz/role-options.ts`.
      The names must match the seven `.cedar` files exactly so a
      typo-introducing refactor surfaces in tests, not at runtime.
      Co-located unit test asserts each persona's name appears in the
      corresponding policy file (`grep`-style match) — drift detector.

      _Why an API endpoint instead of hardcoding in the frontend:_ when
      the persona set changes (one-line schema/policy edit), the
      frontend doesn't ship a new bundle. Future "tenant-authored
      Cedar" work also slots in by extending this endpoint.

- [ ] **A2. Replace the binary toggle in tenant-web with a
      multi-select.**

      `apps/tenant-web/src/routes/users.tsx`:
      - Drop the "Make admin / Make user" button on each row.
      - Add a "Manage roles" button that opens a side panel with a
        checkbox list backed by `GET /role-options`.
      - On save, call `PATCH /api/v1/users/:id` with the picked
        `roleNames`.
      - **Last-admin guard:** if the user being edited is the only
        active `tenant_admin` and the admin tries to remove
        `tenant_admin` from their roleNames, refuse client-side
        with the same copy as the DELETE last-admin guard
        (`Cannot remove the last administrator…`). Server-side guard
        already exists for DELETE; replicate the rule for PATCH so
        the UX surfaces the error before the round-trip.

      Update `RoleBadge` to render up to 3 chips (e.g. `Admin`,
      `Dispatcher`, `+2`) instead of a single label.

- [ ] **A3. Same UX in admin-web `TenantUsersSection`.**

      Symmetric refactor: replace the inline "Make admin / Make user"
      buttons with a "Manage roles" panel. Reuses the same
      `/role-options` endpoint via the admin route family
      (`adminFetch<RoleOption[]>('/api/admin/tenants/:tenantId/role-options')`
      — a thin pass-through handler that returns the same payload, no
      RBAC since admin auth already gates the parent router).

- [ ] **A4. Update the invite flow in both apps to take roleNames.**

      Backend already accepts `roleNames: string[]`. Frontend invite
      form replaces the User/Admin radio with the same multi-select,
      defaulting to `['tenant_user']`.

### Phase B — Permission-aware frontend

- [ ] **B1. `usePermissions()` hook in tenant-web.**

      `apps/tenant-web/src/auth/permissions.ts` — TanStack Query
      hook that fetches `/api/v1/me/permissions` once, caches for the
      session lifetime, exposes:

      ```ts
      const perms = usePermissions()
      perms.has('user:invite') // boolean
      perms.allOf(['quote:read', 'quote:create']) // boolean
      perms.anyOf(['move:create', 'move:update']) // boolean
      ```

      The endpoint already exists and returns `permissions: string[]`.
      No backend change.

- [ ] **B2. Hide / disable controls without permission.**

      Start with the three highest-traffic admin pages — they're where
      a 403 is most visible:

      - **Users page** (`tenant-web/src/routes/users.tsx`): hide
        Invite/Deactivate/Manage roles buttons if not `user:invite` /
        `user:deactivate` / `user:update`. Replace the existing
        `session?.roleNames.includes('tenant_admin')` page-level
        guard with `perms.has('user:list')`.
      - **SSO settings** (`tenant-web/src/routes/sso.tsx` if it
        exists, otherwise the relevant settings page): hide Add /
        Edit Provider unless `setting:update`.
      - **API clients** (`tenant-web/src/routes/api-clients.tsx`):
        hide Create/Rotate/Revoke unless the matching
        `api_client:*` permission.

      Disabled state, not removal, when the button is the page's
      primary action — so the tenant_user understands the feature
      exists, just isn't theirs.

- [ ] **B3. Same in admin-web for tenant-admin sections.**

      Lower priority since admin-web is gated by `PLATFORM_ADMIN`
      (cognito:groups), not Cedar. But the per-tenant management
      section uses `/api/admin/tenants/.../users` which goes through
      `adminAuthMiddleware`, not `requirePermission`. Skip unless we
      surface tenant-scoped Cedar checks there in a later phase.

### Phase C — E2E coverage for personas

- [ ] **C1. Extend the staging auth-smoke spec.**

      `apps/e2e/tests/api/authz-smoke.spec.ts` today exercises
      `tenant_admin`. Add three more cases against the same staging
      tenant:

      - **Invite a `dispatcher` user** via admin API; sign in; assert
        `/me/permissions` returns exactly the 6 dispatcher actions
        (`move:read`, `move:create`, `move:update`, `customer:read`,
        `customer:update`, `quote:read`) — no more, no less.
      - **Invite an `auditor` user**; assert exactly the 4 read-only
        actions; assert `POST /api/v1/users/invite` returns 403.
      - **Negative-auth case** (closes
        `authz-cedar-avp-followups.md` item #4): a `tenant_user` hits
        `GET /api/v1/users` (200), `POST /api/v1/users/invite` (403).

      The spec uses the same `e2e-admin@pegasus-test.invalid` admin
      account to mint persona test users via
      `POST /api/admin/tenants/:tenantId/users` with the right
      `roleNames`. Cleanup: each persona test user gets a unique
      `+persona-{slug}-{nanoid}@pegasus-test.invalid` email so reruns
      don't conflict; `afterAll` deactivates them via Cognito.

      Run order matters: persona setup must happen in the spec's
      `beforeAll` since pre-token caches PENDING→ACTIVE state on first
      login.

- [ ] **C2. Drift detector for the role-options catalog.**

      `apps/api/src/authz/__tests__/role-options.test.ts` — fails if a
      `.cedar` file exists in `policies/30-personas/` whose persona
      name isn't in `role-options.ts`, or vice versa. Catches the
      "I added a sales-manager.cedar but forgot to expose it" class of
      regression that the E2E spec wouldn't (it only exercises the
      personas it knows about).

### Phase D — Folded items from `authz-cedar-avp-followups.md`

The original followups plan still has open boxes that are best closed
together with the work above:

- [ ] **D1.** Item #4 (negative-auth check) → covered by C1 above.
      Once C1 lands, tick #4 in the followups plan with a back-reference.

- [ ] **D2.** Item #1 / #2 / #3 (post-deploy CFN diff, DB migration
      sanity, new-tenant happy-path AVP smoke) — these were post-deploy
      gates for the original PR #91 merge. Every successful deploy run
      since 2026-05-07 has implicitly verified them. Mark them
      "implicitly verified by N successful deploys" with a CI run
      reference and tick. No code change.

- [ ] **D3.** Items #7, #8, #9, #10 stay in `authz-cedar-avp-followups.md`
      (genuinely scoped out or operational-only). No change.

## Verification

End-state acceptance:

1. A platform admin, via admin-web, invites a new tenant user with
   `roleNames: ['dispatcher', 'auditor']`. The user logs in.
2. `/me/permissions` returns the union of the dispatcher and auditor
   action sets (no duplicates).
3. The user's tenant-web sidebar/buttons reflect that union — invite
   buttons hidden, move-edit/customer-edit visible, invoice-edit
   absent.
4. Phase C E2E spec passes on staging and prod for all three persona
   cases.
5. Removing a persona file or adding one without updating
   `role-options.ts` fails C2's test before it can ship.

## Out of scope (and staying that way)

- Persona inheritance / role hierarchies. Cedar supports it via
  `memberOfTypes` chains; the 7-persona model is intentionally flat
  for cognitive load. Revisit when an enterprise tenant asks.
- Permission-string namespace changes. The `<resource>:<action>`
  shape is stable contract for external M2M consumers.
- Mobile app permission gating (see Non-goals).
