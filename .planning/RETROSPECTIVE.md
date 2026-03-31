# Project Retrospective

_A living document updated after each milestone. Lessons feed forward into future planning._

---

## Milestone: v1.0 — Mobile Driver Login

**Shipped:** 2026-03-31
**Phases:** 7 | **Plans:** 14

### What Was Built

- SRP crypto polyfill wired as first import in `_layout.tsx` — unblocked Cognito auth on device without Amplify
- Full typed auth service layer (`cognitoService` + `authService` factory) with dependency injection; raw ID tokens never stored
- `expo-secure-store` session persistence with cold-start restore and `AppState`-based expiry detection
- Two-step email-first tenant resolution UI — auto-selects single tenant, shows picker for multi-tenant orgs
- Flash-free auth guard via `Stack.Protected` + `SplashScreen`, inline errors, password toggle, and input locking
- Production auth bug fixes: `validate-token` audience mismatch (BREAK-01/02), `expiresAt` seconds→ms unit mismatch (BREAK-03)

### What Worked

- **Gap audit loop:** Running `/gsd:audit-milestone` twice before completion caught three production blockers (BREAK-01, BREAK-02, BREAK-03) that would have silently failed on device. The audit → gap phase → re-audit cycle added 2 phases but prevented a broken launch.
- **Dependency injection pattern:** Injecting `authService` as `AuthProvider` prop rather than importing at module scope made unit tests straightforward — no `vi.mock()` of `amazon-cognito-identity-js`.
- **Phase ordering:** Infrastructure first (polyfill, CDK client, mobile-config endpoint) meant auth code was never written against a misconfigured foundation.
- **Option B for expiresAt:** Fixing the seconds/ms mismatch at the comparison site (`session.expiresAt * 1000 < Date.now()`) required zero API changes and preserved the web package contract.

### What Was Inefficient

- **ROADMAP.md tracked completion incorrectly:** Phases 2 and 4 were marked `[ ]` (incomplete) when both were actually complete — this required manual reconciliation at milestone time. Root cause: out-of-order editing during gap closure phases.
- **Three audit iterations:** First audit at 5 phases missed the BREAK-03 unit mismatch, requiring a second audit and Phase 07. Earlier auditing (after Phase 5) would have caught BREAK-03 before it became a deferred fix.
- **No `.env.example` in `apps/mobile/`:** Discovered only during audit as tech debt. Should be standard when any new env var is introduced.
- **CDK deployment unconfirmed:** The mobile Cognito app client was CDK-defined and test-verified but never deployed to AWS to confirm actual provisioning. This is the largest remaining risk.

### Patterns Established

- **Audit before milestone complete:** Run `/gsd:audit-milestone` when all planned phases are done, not just at the end. Gaps found early become their own phases rather than last-minute hotfixes.
- **JWT time comparison pattern:** Always convert seconds to ms at the comparison site — `expiresAt * 1000 < Date.now()` — never at storage or transmission time.
- **jose mock pattern:** `vi.hoisted(() => vi.fn())` + `vi.mock('jose', () => ({ ...actual }))` preserves real error classes while allowing `jwtVerify` to be mocked per test.
- **Stack mock for unit tests:** `jest.fn()` with `.Screen`/`.Protected` properties attached — plain object mock breaks JSX; callable function mock works.

### Key Lessons

1. **Audit early, not just at completion.** Three production blockers were found during milestone audit. Auditing at phase 5 (rather than 7) would have surfaced BREAK-03 a phase earlier and reduced the gap-closure overhead.
2. **Unit tests pass, device tests don't.** Five tech-debt items require physical device/simulator verification. This class of risk (CDK deployment, SplashScreen native behavior, SRP polyfill execution order) cannot be closed by test suites alone. Budget device time before calling any mobile milestone "done."
3. **Inject don't import for service layer.** `cognitoService` and `authService` as factory deps made test isolation trivial. Applying this to any future service with external I/O (SecureStore, AppState, fetch) saves mock-setup overhead.
4. **One env var, one mobile client.** All tenants share `COGNITO_MOBILE_CLIENT_ID` — the mobile app is not per-tenant. This is simpler than per-tenant mapping and consistent with how Cognito user pools work across tenants.

### Cost Observations

- Sessions: ~14 execution sessions (1 per plan) + audit/research sessions
- Notable: Gap closure (Phases 6–7) added ~30% of total session count for ~15% of planned scope — gap audits are high ROI

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change                                            |
| --------- | ------ | ----- | ----------------------------------------------------- |
| v1.0      | 7      | 14    | Established: audit loop, injection pattern, JWT rules |

### Cumulative Quality

| Milestone | Test Files Added | Notable Coverage                              |
| --------- | ---------------- | --------------------------------------------- |
| v1.0      | ~8               | cognitoService, authService, AuthContext, validate-token (9 cases), auth guard |

### Top Lessons (Verified Across Milestones)

1. Run milestone audit before declaring done — gap phases are cheaper than post-ship hotfixes.
2. Physical device verification is a separate category from unit/integration test coverage — plan for it explicitly.
