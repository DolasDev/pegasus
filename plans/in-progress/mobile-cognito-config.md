# Mobile app config — make builds consume the deploy-generated env

**Status (2026-05-18): not started.** The mobile build profiles in
`apps/mobile/eas.json` still carry `"PLACEHOLDER"` Cognito values, so a
preview/production build cannot authenticate. The deploy pipeline already
generates the correct values as an artifact (`mobile.env.deploy`) but nothing
consumes it. This plan wires the two ends together.

**Started:** —
**Blocks:** any real (non-Expo-Go) mobile build and internal distribution.

---

## Context

`apps/mobile` reads its runtime config from `EXPO_PUBLIC_*` env vars baked in
at build time (`apps/mobile/src/config.ts`). Today those come from the `env`
blocks of the `preview` / `production` profiles in `eas.json`, where three
are still stubs in **both** profiles:

```
EXPO_PUBLIC_COGNITO_USER_POOL_ID  = "PLACEHOLDER"
EXPO_PUBLIC_COGNITO_CLIENT_ID     = "PLACEHOLDER"
EXPO_PUBLIC_COGNITO_DOMAIN        = "PLACEHOLDER"
```

`config.ts` throws `ConfigError` only on a _missing_ var — a non-empty
`"PLACEHOLDER"` passes, so the app builds and then fails at runtime against a
bogus user pool. Silent failure, not a build error.

### The pipeline already produces the right values

`.github/workflows/_deploy.yml` ("Summarise outputs" step) reads the CDK
stack outputs after every successful staging/prod deploy and writes
`artifacts/mobile.env.deploy`:

```
EXPO_PUBLIC_API_URL=...
EXPO_PUBLIC_COGNITO_REGION=us-east-1
EXPO_PUBLIC_COGNITO_USER_POOL_ID=...      # UserPoolId output
EXPO_PUBLIC_COGNITO_CLIENT_ID=...         # MobileClientId output (correct — the mobile client)
EXPO_PUBLIC_COGNITO_DOMAIN=...            # HostedUiBaseUrl output
EXPO_PUBLIC_COGNITO_REDIRECT_URI=movingapp://auth/callback
```

It is uploaded as the artifact `mobile-env-{staging|prod}` (14-day
retention, header marked "do not commit"). The intended design was clearly
_deploy produces the mobile env → a mobile build consumes it_ — but no
consumer was ever built, and the `eas.json` placeholders were the stopgap.

### Two problems block "just consume the artifact"

1. **Stale API URL.** `_deploy.yml` sets `EXPO_PUBLIC_API_URL` from the api
   stack's `ApiUrl` output, which is the raw `execute-api` URL — not the
   branded `api.pegasus[-qa].dolas.dev` the SPAs and `eas.json` were moved to
   in commit `98bc3ee`. Consuming the artifact as-is would _regress_ the
   mobile API URL.

2. **`eas.json` shadows `.env`.** EAS Build promotes a profile's `env` block
   to real process env vars. Expo's `.env` loader (dotenv) does **not**
   override vars already in `process.env`. So as long as `eas.json` sets
   `EXPO_PUBLIC_COGNITO_*`, a `.env` file built from the artifact is ignored.
   The redundant vars must come _out_ of `eas.json`.

### No Cognito-side change needed

`CognitoStack` already provisions the `MobileAppClient` (public, SRP, no
secret) with `callbackUrls: ['movingapp://auth/callback']` /
`logoutUrls: ['movingapp://auth/logout']`, matching the redirect URI in the
generated env. Nothing to change in `cognito-stack.ts`.

---

## The fix — three parts

### Part 1 — Fix the artifact's API URL (`_deploy.yml`)

In the "Summarise outputs" step, set `EXPO_PUBLIC_API_URL` to the branded
domain instead of the `ApiUrl` output. The branded domain is published by
dolas-infra into each Pegasus account as the SSM parameter
`/dolas/pegasus/api/domain-name`; the deploy job already holds AWS
credentials at that point, so:

```bash
API_DOMAIN=$(aws ssm get-parameter --name /dolas/pegasus/api/domain-name \
  --query Parameter.Value --output text)
# EXPO_PUBLIC_API_URL=https://$API_DOMAIN
```

Keep the `ApiUrl` output for the human-readable deploy summary; only the
`mobile.env.deploy` line changes.

### Part 2 — Strip runtime config from `eas.json`

Remove from **both** the `preview` and `production` profile `env` blocks:
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_COGNITO_REGION`,
`EXPO_PUBLIC_COGNITO_USER_POOL_ID`, `EXPO_PUBLIC_COGNITO_CLIENT_ID`,
`EXPO_PUBLIC_COGNITO_DOMAIN`, `EXPO_PUBLIC_COGNITO_REDIRECT_URI` — every var
the artifact supplies.

Keep `EXPO_PUBLIC_ENV` (`preview` / `production`): it is a static per-profile
label, not deploy-derived, and is _not_ in the artifact. Keep all non-`env`
build settings (`buildType`, `resourceClass`, `distribution`, etc.).

After this, `eas.json` carries only build settings + `EXPO_PUBLIC_ENV`; the
`.env` file is the single source of runtime config.

### Part 3 — Consume the artifact at build time

Build flow: download the `mobile-env-{env}` artifact, write it to
`apps/mobile/.env` (gitignored — already confirmed, and the artifact header
says "do not commit"), then `eas build`.

**Recommended: a `mobile-build.yml` workflow.** `workflow_dispatch` with an
`env` input (`staging` → `preview` profile, `prod` → `production`):

1. `actions/download-artifact` for `mobile-env-{env}` from the most recent
   successful `Deploy` run (`gh run download` / `dawidd6/action-download-artifact`).
2. Write it to `apps/mobile/.env`.
3. `eas build --non-interactive --profile {preview|production} --platform all`
   (requires `EXPO_TOKEN` as a repo secret).

**Caveat — 14-day artifact retention.** If no deploy has run in the last 14
days the artifact is gone. Mitigations, pick one:

- Re-run a deploy before building (fine for a pre-release cadence), or
- Have `mobile-build.yml` resolve the values itself instead of downloading
  the artifact — assume the Pegasus account role (CI already has the OIDC
  deploy roles) and read SSM directly:
  `/pegasus/admin/cognito-user-pool-id`, `/pegasus/mobile/cognito-client-id`,
  `/pegasus/admin/cognito-hosted-ui-domain`, `/dolas/pegasus/api/domain-name`.
  Self-contained, no retention dependency. If chosen, the `mobile.env.deploy`
  artifact in `_deploy.yml` can be dropped entirely.

For a first pass, manual download + local `eas build` is enough to unblock;
the workflow is the durable answer.

---

## Steps

1. `_deploy.yml`: branded API URL in the `mobile.env.deploy` block (Part 1).
2. `eas.json`: remove the six artifact-supplied `EXPO_PUBLIC_*` vars from both
   profiles; keep `EXPO_PUBLIC_ENV` + build settings (Part 2).
3. Trigger a staging deploy; download `mobile-env-staging`; confirm it now
   carries `EXPO_PUBLIC_API_URL=https://api.pegasus-qa.dolas.dev` and a real
   mobile client ID.
4. Save it as `apps/mobile/.env`; run `getMobileConfig()` (or a dev client)
   and confirm no `ConfigError` and the values are correct.
5. `eas build --profile preview`; smoke-test driver SRP sign-in against
   staging, including the `movingapp://auth/callback` deep-link round-trip.
6. Add `mobile-build.yml` (Part 3) once the manual path is proven.

---

## Out of scope (separate follow-ups)

- **App Store submission config.** `eas.json` `submit.production` still has
  `ascAppId` / `appleTeamId` = `"PLACEHOLDER"` and `appleId` =
  `steve@yourcompany.com`. Blocks store _submission_, not a functioning
  build — fill when that step is reached.
- **Deploy-pipeline mobile build.** `deploy.yml` has no `mobile` path filter
  and never builds the app. Wiring mobile builds into the deploy pipeline
  (vs. the standalone `mobile-build.yml` here) is a larger decision; out of
  scope.

---

## Done when

- `mobile.env.deploy` carries the branded API URL and a real mobile client ID.
- `eas.json` no longer holds artifact-supplied runtime config.
- A `preview` build authenticates a driver against staging Cognito and
  completes the `movingapp://` callback round-trip.
