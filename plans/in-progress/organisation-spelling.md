# Fix "organisation" → "organization" in tenant-web login copy

## Problem

The tenant login flow's organization-selection step renders British-English
"organisation" in user-facing copy. Standardise the UI on US "organization".

## Scope

User-facing strings in `apps/tenant-web` plus the two places that assert on
them (unit test + e2e selector). A single word change per site — no logic,
no behaviour, no API change.

### In scope

- `apps/tenant-web/src/routes/login.tsx` — 5 occurrences
  - L135 "No authentication method is configured for this organisation…"
  - L237 "…signs in through your organisation's identity provider…"
  - L364 CardTitle "Looking up your organisation"
  - L377 CardTitle "Choose your organisation" ← the org-selection page
  - L378 CardDescription "…associated with multiple organisations."
- `apps/tenant-web/src/routes/login.test.tsx` — 2 assertions on
  "Choose your organisation" (L113, L132)
- `apps/e2e/fixtures/hosted-ui-login.ts` — L70 `getByText('Choose your organisation')`
  tenant-picker selector (breaks if the copy changes and this does not)
- `apps/tenant-web/src/routes/sso-config.tsx` — L680 user-facing description
  ("…enable SSO login for your organisation.")

### Out of scope

- `packages/infra/lib/stacks/cognito-stack.ts` L512 — a code comment, not
  user-facing. Left alone.
- `CLAUDE.md` / `dolas/agents/**` prose — repo docs keep their existing voice.
- Any DB column, API field, or Cedar identifier — none contain the word.

## Approach

1. Mechanical string replacement at the 9 sites above.
2. Keep the typographic apostrophe in L237 (`organisation’s` → `organization’s`).
3. Run `apps/tenant-web` unit tests — the two updated assertions must pass
   against the updated component (they are the regression guard).
4. `npm run typecheck` + `npm run lint` at root.

## Verification

- `npm test -w apps/tenant-web` green — login.test.tsx asserts the new copy.
- `npm run typecheck` green.
- Grep check: `grep -rn "rganisation" apps/tenant-web/src apps/e2e` returns
  nothing.
- E2E not run locally (needs a live hosted-UI session); the fixture selector is
  updated in lockstep with the copy so the tenant-picker step keeps matching.

## Risk

Very low. Display-copy only. The one real hazard is a stale selector — an
assertion or e2e locator left on the old string would fail loudly rather than
silently, and all three known matchers are updated here.
