# Fix Cognito Tenant Callback URLs

**Branch:** main
**Goal:** Register the tenant (FrontendStack) CloudFront URL with Cognito, mirroring the existing admin two-pass deployment pattern.

---

## Problem

`deploy.sh` already captures `ADMIN_URL` (AdminFrontendStack CloudFront URL) after an early infra pass and passes it as `--context adminUrl=...` to CognitoStack, so the admin callback URL is correctly whitelisted. The tenant equivalent never happens — `TENANT_URL` is never captured and never passed to CognitoStack, so the tenant app client only ever gets the localhost fallback (`http://localhost:5173/login/callback`).

---

## Step-by-step Plan

- [x] 1. Make `FrontendStack` props optional — mirror the `AdminFrontendStack` pattern
  - Make `apiUrl`, `cognitoRegion`, `cognitoUserPoolId`, `cognitoTenantClientId`, `cognitoDomain` optional
  - Add `fs` import; wrap `BucketDeployment` in `if (fs.existsSync(distPath) && hasAllProps)` guard
  - When all props provided, include `config.json` source (same as now, just conditional)
  - When dist missing or props absent, no deployment created (infra-only pass)

- [x] 2. Update `bin/app.ts` — decouple `FrontendStack` from cross-stack CDK refs
  - Read four new context keys: `apiUrl`, `cognitoDomain` (reuse admin keys), `cognitoUserPoolId`, `cognitoTenantClientId`
  - Pass them as optional props to `FrontendStack` instead of `cognitoStack.*` / `apiStack.*` CDK tokens
  - Keep the `tenantUrl` context read already there — it's already wired to `tenantCallbackUrls`/`tenantLogoutUrls`

- [x] 3. Update `deploy.sh` — add early FrontendStack infra pass
  - After step 2 (AdminFrontendStack infra pass), add step 2b: deploy `FrontendStack` with no context (infra only) and capture `TENANT_URL` from outputs
  - Pass `--context tenantUrl=${TENANT_URL}` to CognitoStack deploy (step 3)
  - In step 5 (FrontendStack asset pass), pass: `apiUrl`, `cognitoDomain`, `cognitoUserPoolId`, `cognitoTenantClientId` from CDK outputs
  - Read `COGNITO_USER_POOL_ID` and `COGNITO_TENANT_CLIENT_ID` from outputs file after ApiStack deploy
  - Respect `--admin-only` flag: skip tenant infra pass and asset pass (same as existing FrontendStack step)

- [x] 4. Update `frontend-stack.test.ts`
  - Change `synthFrontendStack()` to use optional props
  - Update `BucketDeployment` test to be conditional like `AdminFrontendStack` tests
  - Add two-state test: without props (infra pass, no deployment) and with props (asset pass, deployment with config.json)

---

## Files Modified

| File                                                         | Change                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/infra/lib/stacks/frontend-stack.ts`                | Make props optional, conditional BucketDeployment                  |
| `packages/infra/bin/app.ts`                                  | Read context keys, remove cross-stack refs for FrontendStack       |
| `packages/infra/deploy.sh`                                   | Add early FrontendStack infra pass, pass tenantUrl to CognitoStack |
| `packages/infra/lib/stacks/__tests__/frontend-stack.test.ts` | Update for optional props pattern                                  |

No new files. No schema changes. No breaking API changes.

---

## Risks / Side Effects

- **Cross-stack ref removal**: FrontendStack currently uses `Fn::ImportValue` to read CognitoStack/ApiStack outputs. Removing these means the CloudFormation template no longer has those references — which is fine since the values are now passed at deploy time via context. This is a one-time CloudFormation update that removes cross-stack dependencies (makes the stack more independently deployable).
- **Fresh deploy ordering**: On the very first deploy with no existing stacks, the FrontendStack infra pass creates the CloudFront distribution before CognitoStack exists. This is fine — CognitoStack doesn't depend on FrontendStack.
- **`cognitoRegion`**: Will default to `us-east-1` when not provided (same as current hardcoded default in `app.ts`).
- **`--admin-only` flag**: FrontendStack infra pass and asset pass are skipped when `--admin-only` is set. CognitoStack step is skipped anyway in `--admin-only` mode, so tenant URL not being captured is acceptable.
