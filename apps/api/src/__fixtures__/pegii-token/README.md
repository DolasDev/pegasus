# Shared cloud-issued pegII token fixture

This directory pins the **Token contract (I1 ↔ I2)** in `plans/todo/cloud-identity-and-companies.md`:
the cloud mints ES256 JWTs, and the on-prem pegII API verifies them.

- `jwks.json`: the public key set the samples were signed with. The test-only key's private half is never written.
- `tokens.json`: the sample tokens, the fixed `now` (2026-10-02T00:00:00Z) to validate at, the accepted clock skew, the expected `iss`/`aud`, and an `expect` map saying which samples must be accepted and which rejected.
  - Each sample sits under `tokenSegments` as its **three JWS segments**. **Join them with `.`** to get the compact JWT.
  - They're stored split so the repo never holds a dot-joined JWT literal: the CI secret scanner's `jwt` rule would flag one, and JSON can't carry an inline `gitleaks:allow`.

**Consumers verify these exact bytes:**

- pegasus: `src/lib/__tests__/pegii-token.test.ts`
- movemanager: a verbatim copy in `Pegasus.Api.Tests/Fixtures/cloud-token/`

**Regenerate only when the contract changes** (`npx tsx scripts/generate-pegii-token-fixture.ts`), then re-copy the directory to movemanager. Every run uses a fresh key, so all bytes change.
