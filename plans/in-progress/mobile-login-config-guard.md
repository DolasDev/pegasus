# Fix "Unable to look up account" at mobile login + make API 500s diagnosable

## Background / root cause (already diagnosed)

Drivers on the latest closed-testing build hit **"Unable to look up account. Please
try again."** at the email step of login.

- The screen calls `resolveTenants(email)` → `POST ${apiUrl}/api/auth/resolve-tenants`;
  `authService.resolveTenants` throws on any non-2xx, and `login.tsx` catches
  **everything** and renders one generic message.
- `isConfigValid()` only checks env vars are **present**, not **correct**, so a
  present-but-wrong `apiUrl` still boots the app to the login screen.
- Probing the real endpoints:
  - `https://api.pegasus.dolas.dev` (prod) → **200** `{"data":[]}`
  - `https://api.pegasus-qa.dolas.dev` (qa) → **200** `{"data":[]}`
  - `https://wep133vue4.execute-api.us-east-1.amazonaws.com` (**dev**, the value
    committed in the working-tree `apps/mobile/.env`) → **500** `INTERNAL_ERROR`
- So the failing AAB baked the **dev** API URL (a local `eas build`, not the
  `mobile-release.yml` CI path, which resolves the prod/staging custom domain
  from SSM and can only target prod/staging).
- Separately, dev's `resolve-tenants` 500 is currently **undiagnosable** because
  `apps/api/src/handlers/auth.ts:194` is `} catch {` — the error is swallowed
  with no logging.

## Scope

### 1. Mobile — fail fast + diagnosable login errors (`apps/mobile`)

- `src/config.ts`: validate `apiUrl` is a well-formed absolute `http(s)` URL
  (parseable, single scheme). Empty / garbage / double-scheme (`https://https://…`)
  now fails config validation → the existing `ConfigErrorScreen` shows instead of
  a misleading login screen. (A valid-but-wrong host like the dev URL still parses,
  so it's covered by the next item.)
- `src/auth/authService.ts`: on non-2xx, throw `AuthError('ResolveTenantsFailed', …)`
  carrying the HTTP status (already close to this); keep network rejects distinct.
- `app/(auth)/login.tsx`: replace the blanket `catch {}` message with mapped,
  actionable copy — server error (5xx) vs. connectivity vs. unknown — and
  `console.warn` the `apiUrl` host + detail so a misrouted build is obvious in logs.

### 2. API — stop swallowing the error (`apps/api/src/handlers/auth.ts`)

- Bind the outer catch in `resolve-tenants` (line ~194) and `select-tenant`
  (~278): `catch (err) { logger.error('resolve-tenants: unhandled error', { error: String(err) }); … }`.
  This surfaces the dev-500 root cause in CloudWatch after the next deploy.
  (The 500 itself is environment-specific — prod/staging run identical code and
  return 200 — so the code fix is diagnosability; the underlying dev cause is
  reported once logs are readable.)

### 3. Tests

- `apps/mobile`: jest cases for `getMobileConfig` URL-format validation and the
  new `login.tsx` error mapping.
- `apps/api`: unit test that a thrown `db.tenantUser.findMany` makes
  `resolve-tenants` return 500 **and** calls `logger.error` (covers the catch
  branch so the added line doesn't drop the coverage floor).

### 4. Publish to Expo

- After code is green, trigger the release so the **prod** URL is baked and
  testers are unblocked:
  `gh workflow run mobile-release.yml --ref <branch> -f env=prod -f platform=android -f submit=true`
  Confirm the run's `mobile-eas-config` step resolves `EXPO_PUBLIC_API_URL=https://api.pegasus.dolas.dev`
  and that EAS accepts the build. (Promotion Closed-testing → Production stays manual.)

### 5. Finish

- Commit plan + implementation together, open one PR, land via merge queue
  (`/workstream-finish`).

## Out of scope / follow-up

- Actually repairing dev's DB/env that causes the 500 (operational; needs
  `aws sso login` for account 864899848943 to read logs — surfaced by item 2).
- Reworking how the release delivers config to EAS (e.g. `.easignore`) — only if
  item 4 shows the gitignored composite `.env` isn't reaching the bundler.

## Verification

- `apps/mobile`: `npm test` green; manual reasoning that a dev-URL build now
  either fails config (if malformed) or shows a server-error message naming the host.
- `apps/api`: targeted vitest for the handler green, coverage floor holds.
- Expo: release run accepted with the prod URL baked.
