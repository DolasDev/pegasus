---
phase: 1
slug: infrastructure-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| **Framework**          | Vitest (infra: `^1.6.0`, api: workspace version)                                           |
| **Config file**        | `packages/infra/vitest.config.ts` / `packages/api/vitest.config.ts`                        |
| **Quick run command**  | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` or `--filter=@pegasus/api` |
| **Full suite command** | `node node_modules/.bin/turbo run test`                                                    |
| **Estimated runtime**  | ~30 seconds (infra only), ~60 seconds (full)                                               |

---

## Sampling Rate

- **After every task commit:** Run relevant package test suite (`--filter=@pegasus/infra` or `--filter=@pegasus/api`)
- **After every plan wave:** Run `node node_modules/.bin/turbo run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan  | Wave | Requirement | Test Type | Automated Command                                               | File Exists | Status     |
| ------- | ----- | ---- | ----------- | --------- | --------------------------------------------------------------- | ----------- | ---------- |
| 1-01-01 | 01-01 | 1    | INFRA-02    | CDK unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` | ✅          | ⬜ pending |
| 1-01-02 | 01-01 | 1    | INFRA-02    | CDK unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/infra` | ✅          | ⬜ pending |
| 1-02-01 | 01-02 | 1    | API-01      | API unit  | `node node_modules/.bin/turbo run test --filter=@pegasus/api`   | ✅          | ⬜ pending |
| 1-03-01 | 01-03 | 1    | INFRA-01    | Manual    | `head -1 apps/mobile/app/_layout.tsx`                           | ✅          | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

_Existing infrastructure covers all phase requirements. No Wave 0 setup needed._

Tests should be added to existing files:

- `packages/infra/lib/stacks/__tests__/cognito-stack.test.ts` — add mobile app client assertions
- `packages/infra/lib/stacks/__tests__/api-stack.test.ts` — add `COGNITO_MOBILE_CLIENT_ID` env var assertion
- `packages/api/src/handlers/auth.test.ts` — add GET /mobile-config test cases

---

## Manual-Only Verifications

| Behavior                           | Requirement | Why Manual                                              | Test Instructions                                                                                               |
| ---------------------------------- | ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Polyfill is first import in layout | INFRA-01    | File inspection — no runtime assertion possible in unit | `head -1 apps/mobile/app/_layout.tsx` must show `import 'react-native-get-random-values'`                       |
| Mobile app client in AWS Console   | INFRA-02    | CDK deploy — integration test requires live AWS         | After `npm run deploy`, verify client in Cognito console with `generateSecret: false` and `ALLOW_USER_SRP_AUTH` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
