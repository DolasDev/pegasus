# Shared desktop-session pegII token fixture (cloud identity I4)

This fixture pins the `scp` claim that `POST /api/v1/desktop/session` adds to a pegII token.

- **What pegII does with it:** pegII's desktop connection route serves a company connection only to a token with `ptype=user` **and** `scp=desktop`.
- **Why the check is needed:** bridge tokens carry no `scp`. The bridge mints them for any signed-in user, without a membership check, so they must never unlock a connection string.

**Contents:**

- `jwks.json`: the public half of a throwaway test key. This fixture has its own key, separate from the I1 fixture in `../pegii-token/`. That fixture's private key was never written, so it cannot sign new samples, and it is not regenerated.
- `tokens.json`: the samples, plus the fixed `now`, skew, `iss` and `aud`.
  - **The samples:** every one is a **valid** cloud token.
  - **`expectDesktopConnection`:** says which samples the desktop route must serve and which it must refuse.
  - **Format:** each token is stored as its three JWS segments. Join them with `.` to get the token. They are kept split so the secret scanner never sees a dot-joined JWT.

**Consumers verify these exact bytes:**

- pegasus: `src/lib/__tests__/pegii-token.test.ts` ("shared desktop-session token fixture").
- movemanager: a verbatim copy in `Pegasus.Api.Tests/Fixtures/cloud-token-desktop/`.

**Regenerating:** run `npx tsx scripts/generate-pegii-desktop-token-fixture.ts`, and only when the contract changes. Every run uses a fresh key, so all the bytes change. After regenerating, copy the directory to movemanager again.
