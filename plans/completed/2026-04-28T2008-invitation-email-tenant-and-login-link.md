# Invitation email: tenant name + correct login link

**Branch:** `main` (executed directly on main per developer instruction)
**Goal:** Replace Cognito's generic invite email with a tenant-aware version naming the tenant and linking to the correct login page, by adding a `CustomMessage_AdminCreateUser` Lambda trigger and passing tenant context via `ClientMetadata` from both invite handlers.

## Background

Backlog brief: `plans/todo/invitation-email-tenant-and-login-link.md`. Cognito's `AdminCreateUser` invite email is generic — no tenant name, no link. Two handlers issue invites today; both hit the **same** shared user pool, so one trigger covers both.

- Tenant invite: `apps/api/src/handlers/users.ts:120` (POST `/users/invite`)
- Platform-admin issuing a tenant invite: `apps/api/src/handlers/admin/tenant-users.ts:112` → `provisionCognitoUser()`

There is no admin-portal invite endpoint today; admin-portal-only invitations are a follow-up, not in this plan.

## Approach

### Lambda trigger

- New file `apps/api/src/cognito/custom-message.ts`. Handles only `triggerSource === 'CustomMessage_AdminCreateUser'` (forgot-password and other custom-message events pass through unchanged).
- Wire it as a third bundled Lambda alongside `preAuthFn` / `preTokenFn` in `packages/infra/lib/stacks/cognito-stack.ts` and add `lambdaTriggers.customMessage`.
- Cold-start cached SSM reads (mirrors the admin-client-id pattern at `cognito-stack.ts:171-178`):
  - `/dolas/pegasus/web/domain-name` → tenant base
  - `/dolas/pegasus/admin/domain-name` → admin base
- Dev fallback env vars `TENANT_LOGIN_URL_FALLBACK` (`http://localhost:5173`) and `ADMIN_LOGIN_URL_FALLBACK` (`http://localhost:5174`) injected via CDK so dev/CI synth still produces a usable link when SSM is empty.
- IAM: `ssm:GetParameter` on both domain-name ARNs, literal-ARN form (no construct ref) to preserve the no-circular-dependency rule documented at `cognito-stack.ts:166-170`.
- Email body must include `event.request.usernameParameter` and `event.request.codeParameter` verbatim or Cognito rejects the response. HTML-escape the tenant name. Link form: `https://<tenant-base>/login?email=<urlencoded-email>` so `resolveTenantsForEmail` (`apps/tenant-web/src/auth/tenant-resolver.ts`) prefills on landing.
- Fail-safe: any unexpected error → return the event unchanged so the default Cognito email still goes out.

### Handler `ClientMetadata`

Both handlers add `ClientMetadata: { source: 'tenant', tenantId, tenantName, tenantSlug }` to their `AdminCreateUserCommand` calls. The trigger reads it from `event.request.clientMetadata`.

- `apps/api/src/handlers/users.ts:144` — fetch tenant `name`/`slug` (the tenant middleware at `apps/api/src/middleware/tenant.ts:45` already loads the full tenant; thread it through or re-read from `c.get('tenant')` if exposed).
- `apps/api/src/handlers/admin/tenant-users.ts:154` (`provisionCognitoUser`) — same fields. The tenant is fetched at `tenant-users.ts:128`; pass it into `provisionCognitoUser`.

The `source` field is currently always `'tenant'`. Reserved for a future admin-portal invite path — do **not** add a placeholder admin branch now.

### Pool config (no change)

`AdminCreateUserConfig` stays as-is (`AllowAdminCreateUserOnly: true`, asserted by `cognito-stack.test.ts`). No `inviteMessageTemplate` needed — the Lambda fully overrides the body.

## Checklist

- [x] **1.** Lambda handler test — `apps/api/src/cognito/custom-message.test.ts`. Mirror `apps/api/src/cognito/pre-token.test.ts`: hoisted `mockSend` for SSM, branch matrix on `triggerSource`, present/missing `clientMetadata`. Assert the rendered body contains `usernameParameter`, `codeParameter`, escaped tenant name, and the prefilled login URL.
- [x] **2.** Lambda handler — `apps/api/src/cognito/custom-message.ts`. Implement to pass the test. Module-scope cached SSM reads, env-var fallback, fail-safe.
- [x] **3.** Tenant invite handler test — extend `apps/api/src/handlers/users.test.ts` to assert the `AdminCreateUserCommand` input includes the expected `ClientMetadata`.
- [x] **4.** Tenant invite handler — `apps/api/src/handlers/users.ts`. Add `ClientMetadata` to the `AdminCreateUserCommand`.
- [x] **5.** Admin invite handler test — extend `apps/api/src/handlers/admin/tenant-users.test.ts`.
- [x] **6.** `provisionCognitoUser` — `apps/api/src/handlers/admin/tenant-users.ts`. Pass tenant through and add `ClientMetadata`.
- [x] **7.** CDK trigger wiring + IAM — `packages/infra/lib/stacks/cognito-stack.ts`. Bundle `custom-message.ts` (mirror `preTokenFn`), set `lambdaTriggers.customMessage`, grant `ssm:GetParameter` on both domain-name ARNs, inject the two fallback env vars.
- [x] **8.** CDK test — extend `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`: assert third Lambda exists, is wired as `LambdaConfig.CustomMessage`, and has `ssm:GetParameter` on the two domain-name ARNs.
- [ ] **9.** Manual verification (DEFERRED — requires deployed Cognito environment) — temporarily disable `MessageAction: 'SUPPRESS'` in dev (or run against staging). Invite a user; confirm the email contains tenant name + working `/login?email=…` link with the temp password.
- [x] **10.** Run gate — `npm test` from repo root must pass. No existing E2E spec covers invite email content; Step 2 of the completion gate (`dolas/agents/project/context.md`) is **not applicable** for this task.

## Files to create

- `apps/api/src/cognito/custom-message.ts`
- `apps/api/src/cognito/custom-message.test.ts`

## Files to modify

- `apps/api/src/handlers/users.ts` (around line 144 — add `ClientMetadata`; may need to read tenant name/slug)
- `apps/api/src/handlers/users.test.ts`
- `apps/api/src/handlers/admin/tenant-users.ts` (`provisionCognitoUser`)
- `apps/api/src/handlers/admin/tenant-users.test.ts`
- `packages/infra/lib/stacks/cognito-stack.ts` (lines ~142–202: third bundled Lambda, IAM, trigger wiring, env vars)
- `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`

## Risks / side effects

- **Cognito rejects responses missing `usernameParameter` / `codeParameter`.** Tests must enforce both substrings in the rendered body.
- **SSM parameters absent in dev** — must fail-soft to env fallback, never throw out of the trigger handler.
- **Cold-start latency** affects perceived invite send time. Cache SSM reads at module scope.
- **No circular CFN dependencies** — IAM resources must be string-literal ARNs (account+region scoped), matching the existing convention.
- **Out of scope:** broader email branding system, admin-portal-only invite endpoint, resend-invite flow, per-tenant subdomains.

## Verification

- `npm test` (root) — all Vitest layers green, including new handler + CDK assertions.
- `cd packages/infra && npm run synth` — stack synthesises cleanly with the new Lambda + IAM.
- Dev manual invite (with `MessageAction: 'SUPPRESS'` temporarily off) → inbox shows tenant name + working `/login?email=…` link with temp password; first-login flow completes.
- Optional staging smoke test post-deploy via `.github/workflows/deploy.yml`.

## Resume context

Read these in order if picking this up cold:

1. This file.
2. `dolas/agents/team/workflow.md` (plan format, branch discipline, commit rules).
3. `dolas/agents/project/context.md` (TDD layers, task completion gate).
4. `apps/api/src/cognito/pre-token.ts` + `pre-token.test.ts` — exact pattern to mirror for the new Lambda (SSM cold-start cache, hoisted `mockSend`, branch matrix tests).
5. `packages/infra/lib/stacks/cognito-stack.ts:100-240` — Lambda bundling, IAM, trigger wiring conventions (and the no-cycle comments to respect).
6. The two invite handlers and their tests (lines listed above).
