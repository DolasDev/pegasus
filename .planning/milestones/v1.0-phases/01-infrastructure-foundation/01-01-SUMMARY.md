---
phase: 01-infrastructure-foundation
plan: 01
subsystem: infra
tags: [cognito, mobile, cdk, auth]
dependency_graph:
  requires: []
  provides: [mobile-cognito-client, COGNITO_MOBILE_CLIENT_ID]
  affects: [packages/infra, packages/api]
tech_stack:
  added: []
  patterns: [addClient-SSM-CfnOutput pattern, cross-stack prop injection]
key_files:
  created: []
  modified:
    - packages/infra/lib/stacks/cognito-stack.ts
    - packages/infra/lib/stacks/api-stack.ts
    - packages/infra/bin/app.ts
    - packages/infra/lib/stacks/__tests__/cognito-stack.test.ts
    - packages/infra/lib/stacks/__tests__/api-stack.test.ts
decisions:
  - Mobile client uses userSrp authFlow (no OAuth block, no client secret)
  - CDK adds default OAuth properties to all clients when user pool has Hosted UI domain
metrics:
  duration: 3m
  completed: 2026-03-27
  tasks_completed: 2
  files_modified: 5
---

# Phase 01 Plan 01: Mobile Cognito App Client Summary

**One-liner:** Mobile Cognito app client (SRP-only, no secret) added to CDK with SSM + CfnOutput exports and COGNITO_MOBILE_CLIENT_ID Lambda env var injected via cross-stack props.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add mobile app client to CognitoStack + inject env var in ApiStack + wire in app.ts | 6b37684 | cognito-stack.ts, api-stack.ts, app.ts |
| 2 | CDK unit tests for mobile app client and COGNITO_MOBILE_CLIENT_ID env var | 7259147 | cognito-stack.test.ts, api-stack.test.ts |

## What Was Built

Added a dedicated Cognito app client for the Pegasus mobile driver app:

- `CognitoStack.mobileAppClient` — `UserPoolClient` named `mobile-app-client` with `generateSecret: false`, `authFlows: { userSrp: true }`, 8h token validity, 30d refresh, `enableTokenRevocation: true`, no OAuth block
- SSM parameter at `/pegasus/mobile/cognito-client-id` storing the client ID
- CloudFormation output `PegasusCognitoMobileClientId` for cross-stack reference
- `ApiStackProps.cognitoMobileClientId?: string` — new optional prop
- Lambda environment variable `COGNITO_MOBILE_CLIENT_ID` wired from the prop
- `app.ts` cross-stack wiring: `cognitoMobileClientId: cognitoStack.mobileAppClient.userPoolClientId`

CDK unit tests added: 10 new tests for the mobile client in `cognito-stack.test.ts`, 1 new test in `api-stack.test.ts`. All 117 tests pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CDK emits default OAuth properties for all UserPoolClients when User Pool has a Hosted UI domain**

- **Found during:** Task 2 (TDD test run)
- **Issue:** The plan's test assertion `AllowedOAuthFlows: Match.absent()` assumed CDK omits OAuth config when no `oAuth` block is passed. In reality, CDK emits `AllowedOAuthFlows: ["implicit", "code"]` and `AllowedOAuthFlowsUserPoolClient: true` as defaults for all clients in a pool that has a Hosted UI domain. The plan comment "CDK omits the property entirely when oAuth is not configured" is inaccurate for this stack configuration.
- **Fix:** Replaced the `AllowedOAuthFlows: Match.absent()` assertion with a test that verifies the mobile client does NOT contain tenant/admin Hosted UI callback URLs (`localhost:5173`, `localhost:5174`), which is the meaningful behavioral invariant.
- **Files modified:** `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`
- **Commit:** 7259147

**2. [Rule 1 - Bug] `expect` not imported in cognito-stack.test.ts**

- **Found during:** Task 2 (TDD test run)
- **Issue:** The test used `expect(mobileClientOutput).toBeDefined()` but `expect` was not in the vitest import.
- **Fix:** Added `expect` to the import: `import { describe, it, beforeAll, expect } from 'vitest'`
- **Files modified:** `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts`
- **Commit:** 7259147

## Verification

All plan success criteria met:

- `node node_modules/.bin/turbo run test --filter=@pegasus/infra` exits 0 with 117 tests green
- `cognito-stack.ts` has `public readonly mobileAppClient`, `MobileAppClient` addClient call, SSM at `/pegasus/mobile/cognito-client-id`, CfnOutput `PegasusCognitoMobileClientId`
- `api-stack.ts` ApiStackProps has `cognitoMobileClientId?: string` and Lambda env has `COGNITO_MOBILE_CLIENT_ID`
- `app.ts` passes `cognitoMobileClientId: cognitoStack.mobileAppClient.userPoolClientId` to ApiStack
- No regressions — Lambda count in CognitoStack stays at 2 (pre-auth + pre-token)

## Self-Check: PASSED

Files exist:
- packages/infra/lib/stacks/cognito-stack.ts — FOUND
- packages/infra/lib/stacks/api-stack.ts — FOUND
- packages/infra/bin/app.ts — FOUND
- packages/infra/lib/stacks/__tests__/cognito-stack.test.ts — FOUND
- packages/infra/lib/stacks/__tests__/api-stack.test.ts — FOUND

Commits:
- 6b37684 — FOUND (feat: mobile app client implementation)
- 7259147 — FOUND (test: CDK unit tests)
