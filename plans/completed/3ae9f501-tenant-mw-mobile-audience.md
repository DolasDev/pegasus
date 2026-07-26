# Fix: tenant middleware rejects mobile-client tokens ("Invalid or unverifiable token")

## Root cause (verified)

The mobile app now reaches `/api/v1/*` (after the crypto.randomUUID fix, #542), but every
request 401s with "Invalid or unverifiable token". `tenantMiddleware` (`apps/api/src/middleware/tenant.ts:59`)
verifies the JWT with `audience: tenantClientId` (`COGNITO_TENANT_CLIENT_ID`, the **web** client
`6o543aiqnt0b5343ch7cj76p00`). The mobile ID token's `aud` is the **mobile** client
`53fb2cpu04ttqsau0ghng3odji` (`COGNITO_MOBILE_CLIENT_ID`, confirmed set in the prod Lambda), so
`jwtVerify` fails the audience check.

`validate-token` (`handlers/auth.ts:446`) already accepts BOTH:
`audience: [tenantClientId, mobileClientId]` — which is why mobile _login_ works but data calls don't.
This was latent: no mobile `/api/v1` request ever got through before #542.

API-side fix only — **no mobile rebuild** (version code 10 is correct). Ships via normal Deploy on merge.

## Scope

### `apps/api/src/middleware/tenant.ts`

- Read `const mobileClientId = process.env['COGNITO_MOBILE_CLIENT_ID'] ?? ''`.
- Change the `jwtVerify` audience to `[tenantClientId, mobileClientId].filter(Boolean)`
  (mirrors validate-token; `filter(Boolean)` so an unset mobile id can't become an empty-string
  audience). Nothing else changes — tenant scoping still comes from the `custom:tenantId` claim,
  so authz is unchanged; we only broaden which Cognito app client may present a token.

### Tests

- Add/extend a test asserting `tenantMiddleware` passes an audience array containing BOTH the
  tenant and mobile client IDs to `jwtVerify`, and that a token whose `aud` is the mobile client
  is accepted (mock jose like `handlers/auth.test.ts`). If a full middleware harness is too heavy,
  cover it via a handler test that routes through the middleware.

## Verify

- api unit tests green; coverage floor holds (the new lines run on every tenant request the
  existing handler tests already exercise).
- After merge + Deploy: a live `GET /api/v1/me/driver` from the phone returns **200** in the prod
  Lambda logs and My Trips loads driver 17698. (No app update required.)
