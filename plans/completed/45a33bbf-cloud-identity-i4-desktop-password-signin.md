# Cloud identity I4 — desktop password sign-in (option 2) + silent multi-tenant refresh

**Repos:**

- pegasus (one small PR, lands **first**).
- movemanager (worktree off `origin/dev` → `dev`, after Steve's `scripts/test.ps1`).

**Goal:** password users sign in to MoveManager in the app, through Cognito `InitiateAuth USER_PASSWORD_AUTH`, exactly as tenant-web does — never through the Hosted UI. Multi-tenant users refresh silently.

**Status:** APPROVED 2026-10-08 (Steve: select-tenant before refresh; Forgot password links to the web page). **Part A landed in pegasus** with this file. **Part B (movemanager) is next** — it needs Part A deployed first; then the post-deploy check below.

## Context

The first live Cloud sign-in on QMM failed with "PreTokenGeneration failed … session does not match the identity provider". The cause is now confirmed in code:

1. **The desktop's "Email and password" choice uses the Cognito Hosted UI password page**, so the token request is `TokenGeneration_HostedAuth`.
2. **Pre-token treats a HostedAuth sign-in as federated** whenever the account has a linked identity (`isFederatedSignIn`, `apps/api/src/cognito/pre-token.ts:160`).
3. **It then takes the tenant from `identities[0]`.** For Steve that's `Microsoft`, which belongs to Dolios ≠ the QMM selection → the security check refuses it.

The code's own header (`pre-token.ts:125-148`) says password login must stay off the Hosted UI. Tenant-web keeps it off: it calls Cognito's `InitiateAuth` with `USER_PASSWORD_AUTH` directly (`apps/tenant-web/src/auth/cognito.ts:162-225`, via `packages/auth/src/cognito-client.ts`). That produces `TokenGeneration_Authentication`, which pre-token treats as native: the `select-tenant` record wins, linked identities or not, and this is tested (`pre-token.test.ts:581-690`).

**Refresh.** Pre-token resolves `TokenGeneration_RefreshTokens` the same native way: a live `select-tenant` record (10 min) wins, otherwise a single roster row. So calling `select-tenant` right before each refresh lets Steve (8 tenants) refresh silently. That's the same trust as sign-in: the refresh token proves identity, and the roster row must still exist and not be deactivated.

**Decided (Steve, 2026-10-08):**

- Option 2.
- Call `select-tenant` before each refresh.
- Forgot-password links to the Pegasus web sign-in page; there's no reset flow in the desktop.

## Part A — pegasus (small PR, lands first)

- **`packages/infra/lib/stacks/cognito-stack.ts`, desktop client:**
  - The `ExplicitAuthFlows` override becomes `['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']`.
  - Add `preventUserExistenceErrors: true`, as the tenant and admin clients have, so a wrong email can't be told from a wrong password.
  - Rewrite the "never collects a password" comment to say why password sign-in is in-app (`InitiateAuth`), never the Hosted UI.
- **`cognito-stack.test.ts`:** the desktop test asserts both flows plus `PreventUserExistenceErrors: 'ENABLED'`. The frozen-clients snapshot is untouched: the desktop client isn't in it.
- **#518 consequence (accepted):** editing the desktop client resets its `SupportedIdentityProviders` to COGNITO once. The next `resolve-tenants` call for each tenant — any web or desktop sign-in — re-adds that tenant's providers. Verify after deploy with `describe-user-pool-client` on the desktop client.
- **`apps/api/src/cognito/pre-token.ts`:** comments only.
  - The `TokenGeneration_RefreshTokens` note ("no client in this repo refreshes today") is stale. Say the desktop refreshes, and calls `select-tenant` first so the refresh resolves to the chosen tenant.
  - Add the desktop to the "password login must stay off the Hosted UI" list.
  - No logic change.
- **Docs:**
  - `GOTCHAS.md`: password sign-in through the Hosted UI misclassifies linked users. The 2026-10-08 desktop live test hit it.
  - Design doc item 6: a line on desktop password sign-in.
- **Gate:** CI green. After deploy, confirm the desktop client lists the expected flows and that its IdPs are back after a `resolve-tenants` call.

## Part B — movemanager

### WebClient (`Pegasus.WebClient/Cloud/`)

- **New `CognitoIdpClient`**, a raw Cognito JSON API client:
  - `POST https://cognito-idp.<region>.amazonaws.com/`, with `X-Amz-Target: AWSCognitoIdentityProviderService.<Op>` and `Content-Type: application/x-amz-json-1.1`. Unauthenticated; public client.
  - **`InitiateAuth(USER_PASSWORD_AUTH, USERNAME = normalized email, PASSWORD)`** → either tokens, or a challenge `{name, session}`.
  - **`RespondToAuthChallenge`** for `SOFTWARE_TOKEN_MFA` (`SOFTWARE_TOKEN_MFA_CODE`) and `NEW_PASSWORD_REQUIRED` (`NEW_PASSWORD`). Chained challenges are handled in a loop: tokens, or the next challenge.
  - **`Refresh(refreshToken)`** via `InitiateAuth REFRESH_TOKEN_AUTH`.
  - **Errors** are mapped to readable messages:
    - Strip the `PreTokenGeneration failed with error …` wrapper, as tenant-web's `unwrapPreTokenMessage` does.
    - `NotAuthorizedException` → "Incorrect email or password."
    - `PasswordResetRequiredException` → "Your password must be reset — use Forgot password."
    - `InvalidPasswordException` → the policy message.
    - `CodeMismatchException` → "That code is not correct."
    - An unknown challenge → a clear error, not a crash.
- **`CognitoTokens` gains `Source` (`HostedUi` | `Password`):**
  - Hosted-UI tokens keep refreshing through `/oauth2/token`, which is unchanged and live-proven.
  - Password tokens refresh through `InitiateAuth REFRESH_TOKEN_AUTH`.
  - `CloudSession` uses the matching path, through an `ICognitoTokenRefresher` per source.
- **`CloudSession` before refresh:** call the new seam `ITenantSelector.SelectTenant(email, tenantId)`, i.e. `CloudAuthClient.SelectTenant`, so pre-token resolves the refresh to this tenant.
  - It takes the tenant id from sign-in.
  - If `select-tenant` refuses (the user was removed from the tenant), raise `CloudReauthRequiredException`.
- **Config:** `CloudConfig` gains `Region` (app.config `PegasusCloud:Region` = `us-east-1`) and `WebSignInUrl` (`PegasusCloud:WebSignInUrl`, the tenant-web sign-in page for Forgot password). The prod URL will be read from SSM / CloudFront at implementation time and recorded here.

### UI

**`CloudSignInForm`:**

- **Password route.** When the chosen provider is "Email and password", or the tenant has no providers, the form shows a **password** field instead of opening the browser. Then `select-tenant` → `InitiateAuth`.
  - On `SOFTWARE_TOKEN_MFA` it swaps to a **6-digit code** field.
  - On `NEW_PASSWORD_REQUIRED` it swaps to **new password + confirm**.
  - The `select-tenant` record lasts 10 minutes, as with the browser path.
- **"Forgot password?" link** opens `WebSignInUrl` (`Process.Start` + `UseShellExecute`).
- **SSO providers keep the browser path.** For a linked QMM M365 user, HostedAuth + `M365` = QMM resolves correctly.
- **Re-sign-in** (`Reauthenticate`) uses the same form, so it gets the password route too.

### Tests (`Pegasus.Tests.Unit`, net48)

- **`CognitoIdpClientTests`** (stub handler):
  - The target header and content type.
  - The body: lowercased `USERNAME`, `ClientId`.
  - Tokens vs challenge parsing; chained challenges.
  - Error mapping, including the pre-token unwrap.
  - Refresh keeps the refresh token.
- **`CloudSession`:**
  - A refresh calls `select-tenant` first.
  - A `select-tenant` refusal → `CloudReauthRequiredException`.
  - A password-source token uses the IdP refresher; a hosted-source token uses `/oauth2/token`.
- **Linux check:** the scratch net8 harness and net48 compile check, now **referencing the real `Pegasus.WebClient` project's references exactly** (the lesson from `c158c263`): compile `Pegasus.WebClient.csproj`'s own C# references and add only the test packages.

## Files

- **pegasus:**
  - `packages/infra/lib/stacks/cognito-stack.ts` + `__tests__/cognito-stack.test.ts`
  - `apps/api/src/cognito/pre-token.ts` (comments)
  - `dolas/agents/project/GOTCHAS.md`
  - `plans/todo/cloud-identity-and-companies.md`
- **movemanager:**
  - `Pegasus.WebClient/Cloud/{CognitoIdpClient (new), CloudConfig, CloudContracts, CloudSession, CloudAuthClient}.cs`
  - `MoveManager/_Masters/CloudSignInForm.vb`, `MoveManager/Program.vb` (config read), `MoveManager/app.config`
  - `Pegasus.Tests.Unit/DataProviders/WebClient/Cloud/*`

## Risks

- **The desktop client's IdP list resets once** at the pegasus deploy (#518 shape). It self-heals per tenant on the next `resolve-tenants`. Until a QMM user starts a sign-in, the desktop's M365 route returns Cognito's bare 400. The desktop always calls `resolve-tenants` first, so this repairs itself on the first attempt.
- **The desktop collects passwords.** They're held only for the call, never stored or logged. Remember-me stays email only.
- **`cognitoAuthEnabled` is enforced only in the UI**, by tenant-web and by the desktop: neither offers password when it's false. That matches today.
- **Admin-reset users** (`RESET_REQUIRED`) get `PasswordResetRequiredException` → the Forgot-password hint.

## Verification

- **pegasus:**
  - infra + api tests and CI.
  - After deploy: `describe-user-pool-client` on the desktop client shows `ALLOW_USER_PASSWORD_AUTH`, `ALLOW_REFRESH_TOKEN_AUTH` and `PreventUserExistenceErrors=ENABLED`, and its IdPs return after a `resolve-tenants`.
- **movemanager:** the harness + net48 compile on Linux; then Steve's `scripts/test.ps1`; then land on `dev` → alpha.
- **Live on QMM** (needs both deployed):
  1. Steve, "Email and password" → signed in to QMM. Picker → QMM USA as Wizard.
  2. Idle for more than 1 hour → a warehouse screen still loads without the browser (the silent refresh via `select-tenant`).
  3. A QMM M365 user → the browser path → their own employee row.
