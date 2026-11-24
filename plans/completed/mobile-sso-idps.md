# Mobile SSO — permit tenant IdPs on the mobile app client

- **Branch:** `fix/mobile-sso-idps`
- **Approved:** 2026-11-24 (Steve), as a separate PR from #991 (mobile session refresh).
- **Goal:** a driver who taps "SIGN IN WITH <provider>" in the mobile app completes SSO
  instead of a bare 400 on the Cognito callback.

## Diagnosis (read-only, deployed config, 2026-11-24)

- Prod pool `us-east-1_gg63uAxs0`: `tenant-app-client` and `desktop-app-client` list
  `COGNITO, M365, Microsoft, Microsoft-SAML, microsoft-nw, microsoft-reliable`;
  `mobile-app-client` lists `["COGNITO"]` only, LastModifiedDate 2026-04-26 (creation).
  Not a #518 wipe: the mobile client never carried IdPs.
- Staging pool `us-east-1_0LoW8JGgK` has no IdPs at all.
- `ssoAppClientIdsFromEnv()` (`apps/api/src/lib/cognito-app-client.ts`) and
  `ssoAppClientIds()` (`apps/api/src/handlers/sso.ts`) cover tenant + desktop only
  ("mobile deliberately absent", added in #809). The mobile login screen still offers the
  provider buttons, so mobile SSO has never worked against a tenant IdP.
- `COGNITO_MOBILE_CLIENT_ID` is already in the API Lambda env; the IAM grant for
  `UpdateUserPoolClient`/`DescribeUserPoolClient` is pool-scoped. No infra change.

## Change

- Add the mobile client to both app-client lists (one shared helper, so the two lists
  can't drift again). Every path that touches the tenant/desktop clients now covers mobile:
  - `POST /auth/resolve-tenants` reconcile (repairs the prod mobile client on first use);
  - `GET /providers` reconcile;
  - `POST /providers` permit (best-effort for non-tenant clients, as desktop is today);
  - `DELETE /providers` revoke-before-delete (required on every client, or the IdP delete
    poisons a client that still names it).
- No CDK edit to any UserPoolClient (#518).

## Checklist

- [x] Shared helper `secondarySsoClientIdsFromEnv()` (desktop + mobile) in
      `cognito-app-client.ts`; `ssoAppClientIdsFromEnv()` and sso.ts `ssoAppClientIds()` both
      build on it; tests
- [x] sso.ts create (best-effort loop over secondary clients) / delete (revoke on every client
      first) / list (reconcile) cover mobile; tests mirror the desktop ones
- [x] resolve-tenants reconcile covers mobile (via `ssoAppClientIdsFromEnv`); tests
- [x] Gate: api `tsc`, eslint, prettier; api suite 343 files / 5529 tests. Root `npm test`
      failed twice on unrelated mobile/admin-web timeouts (host load average ~99 from other
      sessions; suites took 60-86s vs ~3s). Both pass alone: mobile 565/565, admin-web 63/63.
      This PR changes no mobile or web code.
- [x] Playwright e2e not run locally: the change is in Cognito app-client wiring, which e2e
      can't exercise (local runs have no Cognito). CI e2e is the check.
- [ ] Post-deploy: confirm prod `mobile-app-client` SupportedIdentityProviders lists the
      five IdPs after the first resolve-tenants; device test SSO with an NW/Reliable account
- [x] Archive plan → `plans/completed/` before PR
