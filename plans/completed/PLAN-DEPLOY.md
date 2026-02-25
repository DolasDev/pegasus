# Plan: Migrate to Runtime Config

## Problem

`deploy.sh` is brittle because Vite bakes `VITE_*` env vars into bundles at **build time**,
forcing builds to happen _after_ CDK deploys so the deployed URLs are known first. This creates:

- `sed -i` manipulation of `.env` files mid-script
- Two-pass `AdminFrontendStack` deploy (CloudFront URL needed by Cognito before assets exist)
- AWS CLI SSM reads piped into shell-written `.env` files
- Fragile ordering: CDK outputs → `.env` → Vite build → CDK asset upload

## Solution

Serve a `/config.json` from each CloudFront distribution. CDK generates it at deploy time using
`s3deploy.Source.jsonData()`, which resolves CloudFormation tokens (stack outputs) into a file
uploaded alongside the SPA assets. SPAs fetch it at boot before rendering. Local dev uses a
static `public/config.json` served by the Vite dev server.

Result:
- Both frontends can be **built once, before any CDK deploy** (no URLs needed at build time)
- No `.env` file manipulation in the deploy script
- No SSM reads in the deploy script
- `deploy.sh` shrinks to: build → ordered CDK deploys

## Config Schemas

### `packages/web/public/config.json`
```json
{
  "apiUrl": "https://...",
  "cognito": {
    "region": "us-east-1",
    "userPoolId": "us-east-1_xxxxxxxx",
    "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
    "domain": "https://pegasus-xxx.auth.us-east-1.amazoncognito.com",
    "redirectUri": "https://<cloudfront-domain>/login/callback"
  }
}
```

### `apps/admin/public/config.json`
```json
{
  "apiUrl": "https://...",
  "cognito": {
    "domain": "https://pegasus-xxx.auth.us-east-1.amazoncognito.com",
    "clientId": "xxxxxxxxxxxxxxxxxxxxxxxxxx",
    "redirectUri": "https://<admin-cloudfront-domain>/auth/callback"
  }
}
```

---

## Steps

Each step is independently deployable and leaves the system working.
Mark steps `[x]` as they complete so work can be resumed.

---

### Step 1 — Add shellcheck to pre-commit and fix existing warnings
> No deploy needed. Catches real shell bugs (unquoted variables, missing error handling,
> non-portable constructs) before they reach AWS. Do this first because it's free signal
> with zero risk, and because Step 7 rewrites the script — better to start clean.

- [ ] Install `shellcheck` if not already present (`sudo apt install shellcheck` on WSL2)
- [ ] Run `shellcheck packages/infra/deploy.sh` and fix all reported warnings
- [ ] Add shellcheck to `.husky/pre-commit` so it runs automatically on every commit:
  ```sh
  # .husky/pre-commit (append after npx lint-staged)
  shellcheck packages/infra/deploy.sh
  ```
- [ ] Confirm the hook fires: make a trivial change to `deploy.sh`, `git add` it, attempt commit

**Verify:** `shellcheck packages/infra/deploy.sh` exits 0 with no output.

---

### Step 2 — Local dev config files (no code changes, no deploy)
> Safe to do any time. No behaviour change. Sets up the local dev pattern.

- [ ] Create `packages/web/public/config.json.example` using the web schema above with
      `localhost` values (`apiUrl: http://localhost:3000`, `redirectUri: http://localhost:5173/login/callback`)
- [ ] Create `apps/admin/public/config.json.example` using the admin schema above with
      `localhost` values (`apiUrl: http://localhost:3000`, `redirectUri: http://localhost:5174/auth/callback`)
- [ ] Add `public/config.json` to the root `.gitignore` (covers both packages via glob)
- [ ] Copy each example to the real `config.json` locally and populate with deployed values
      (same values currently in `packages/web/.env` and `apps/admin/.env`)

**Verify:** Vite dev server (`npm run dev`) serves `http://localhost:5173/config.json` from
`packages/web/public/config.json` without any code changes.

---

### Step 3 — Web app: runtime config module
> Pure frontend change. Deploy script and infra are untouched. After this step the web app
> reads config from `/config.json` at boot; local dev and the deployed CloudFront site both
> work (deployed site still serves config via baked env vars until Step 5 adds CDK config.json,
> but `public/config.json` is not uploaded to production so the fetch will 404 — Step 5 must
> follow before removing the env var fallback).

**Files touched:**
- `packages/web/src/config.ts` — new file
- `packages/web/src/main.tsx`
- `packages/web/src/auth/cognito.ts`
- `packages/web/src/api/client.ts`
- `packages/web/.env.example` — document that VITE_* vars are no longer needed post-Step 4

#### `packages/web/src/config.ts`
- Export a `WebConfig` type matching the web schema above
- Export `loadConfig(): Promise<void>` — fetches `/config.json`, validates shape, stores in module-level variable
- Export `getConfig(): WebConfig` — returns stored config, throws if `loadConfig` has not been called
- On fetch failure or missing fields, throw a descriptive error (shown in the boot error screen)

#### `packages/web/src/main.tsx`
- Before calling `ReactDOM.createRoot(...).render(...)`, await `loadConfig()`
- Show a full-page loading indicator while fetching
- Show a full-page error message if `loadConfig` throws (avoid blank white screen)

#### `packages/web/src/auth/cognito.ts`
- Replace all `requireEnv('VITE_COGNITO_*')` / `import.meta.env` reads with `getConfig().cognito.*`
- Remove the `_config` lazy-init pattern — config is now loaded at boot, always available
- `getCognitoConfig()` becomes a thin wrapper: `return getConfig().cognito`

#### `packages/web/src/api/client.ts`
- Replace `import.meta.env['VITE_API_URL'] ?? 'http://localhost:3000'` with `getConfig().apiUrl`

**Verify:** `npm run dev` (web) works with `public/config.json`. `npm run typecheck` passes.

---

### Step 4 — Admin app: runtime config module
> Same pattern as Step 3 but for `apps/admin`. Independent of Step 3.

**Files touched:**
- `apps/admin/src/config.ts` — new file
- `apps/admin/src/main.tsx`
- `apps/admin/src/auth/cognito.ts`
- `apps/admin/src/api/client.ts`

#### `apps/admin/src/config.ts`
- Export `AdminConfig` type matching the admin schema above
- Same `loadConfig` / `getConfig` pattern as the web app

#### `apps/admin/src/main.tsx`
- Same boot sequence as web: await `loadConfig()`, show loading/error screen

#### `apps/admin/src/auth/cognito.ts`
- Replace `import.meta.env` reads with `getConfig().cognito.*`
- The admin Cognito module derives `region` from the domain string
  (`domain.split('.')[2]` → e.g. `us-east-1`); keep that derivation, just source `domain` from config

#### `apps/admin/src/api/client.ts`
- Replace `import.meta.env['VITE_API_URL']` with `getConfig().apiUrl`

**Verify:** `npm run dev` (admin, port 5174) works with `apps/admin/public/config.json`.

---

### Step 5 — FrontendStack: CDK generates web config.json
> Infrastructure change. Requires Step 3 to have been deployed. After this step the tenant
> frontend reads live config from CloudFront — `VITE_*` env vars are no longer needed for
> the deployed web app.

**Files touched:**
- `packages/infra/lib/stacks/frontend-stack.ts`
- `packages/infra/bin/app.ts`
- `packages/infra/test/frontend-stack.test.ts` (existing test file, extend it)

#### `packages/infra/lib/stacks/frontend-stack.ts`
- Add props: `apiUrl: string`, `cognitoRegion: string`, `cognitoUserPoolId: string`,
  `cognitoTenantClientId: string`, `cognitoDomain: string`
- Add a second source to the existing `BucketDeployment`:
  ```ts
  s3deploy.Source.jsonData('config.json', {
    apiUrl: props.apiUrl,
    cognito: {
      region: props.cognitoRegion,
      userPoolId: props.cognitoUserPoolId,
      clientId: props.cognitoTenantClientId,
      domain: props.cognitoDomain,
      redirectUri: `https://${this.distribution.distributionDomainName}/login/callback`,
    },
  })
  ```
- Add a CloudFront cache behaviour for the path `/config.json`:
  - `cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED`
  - `originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN`
  - Place this behaviour before the catch-all `/*` behaviour

#### `packages/infra/bin/app.ts`
- Pass `CognitoStack` outputs and `ApiStack` URL output into `FrontendStack` props

#### CDK tests
- Add assertions to the `FrontendStack` test that:
  - A `BucketDeployment` exists with two sources (asset + jsonData)
  - A CloudFront cache behaviour exists for path pattern `/config.json` with a disabled cache policy
  - The behaviour is ordered before the catch-all SPA behaviour
- Update the snapshot after confirming the assertions pass

**Verify:** `npm test --workspace=packages/infra` passes. After `./deploy.sh`,
`curl https://<tenant-cloudfront>/config.json` returns correct JSON. Login flow works
end-to-end without any `VITE_COGNITO_*` vars in `packages/web/.env`.

---

### Step 6 — AdminFrontendStack: CDK generates admin config.json
> Infrastructure change. Requires Step 4 to have been deployed. Retains the two-pass deploy
> pattern for now (eliminated in Step 7). On the first pass (no Cognito props) no config.json
> is written; on the second pass (Cognito props available) config.json is included.

**Files touched:**
- `packages/infra/lib/stacks/admin-frontend-stack.ts`
- `packages/infra/bin/app.ts`
- `packages/infra/test/admin-frontend-stack.test.ts` (existing test file, extend it)

#### `packages/infra/lib/stacks/admin-frontend-stack.ts`
- Add optional props: `apiUrl?: string`, `cognitoDomain?: string`, `cognitoAdminClientId?: string`
- In the `BucketDeployment` sources array, conditionally add `Source.jsonData`:
  ```ts
  const sources: s3deploy.ISource[] = [s3deploy.Source.asset(distPath)]
  if (props.apiUrl && props.cognitoDomain && props.cognitoAdminClientId) {
    sources.push(s3deploy.Source.jsonData('config.json', {
      apiUrl: props.apiUrl,
      cognito: {
        domain: props.cognitoDomain,
        clientId: props.cognitoAdminClientId,
        redirectUri: `https://${this.distribution.distributionDomainName}/auth/callback`,
      },
    }))
  }
  ```
- Add CloudFront cache behaviour for `/config.json` (same policy as Step 5)

#### `packages/infra/bin/app.ts`
- First instantiation of `AdminFrontendStack` (infra pass): no Cognito/API props
- Second instantiation is not how CDK works — the two-pass is a deploy-script concern,
  not a CDK construct concern. `app.ts` creates one stack; `deploy.sh` deploys it twice.
  On the second deploy, pass Cognito + API props via CDK context and read them in `app.ts`,
  forwarding to `AdminFrontendStack`.

#### CDK tests
- Add two test cases to the `AdminFrontendStack` test:
  1. **Without Cognito props**: assert no `config.json` source is present in `BucketDeployment`
  2. **With Cognito props**: assert `config.json` source is present and the `/config.json`
     CloudFront behaviour exists with a disabled cache policy
- Update the snapshot after confirming the assertions pass

**Verify:** `npm test --workspace=packages/infra` passes. After full `./deploy.sh`,
`curl https://<admin-cloudfront>/config.json` returns correct JSON. Admin login works
without `VITE_COGNITO_*` vars in `apps/admin/.env`.

---

### Step 7 — Simplify deploy.sh
> Script-only change. Requires Steps 5 and 6 to be deployed. CDK now owns config.json
> generation; the script only needs to sequence CDK deploys and trigger builds.

#### Add `--dry-run` flag
- [ ] Add `DRY_RUN=false` flag parsing alongside the existing flags
- [ ] Wrap every `npx cdk deploy`, `npm run build`, `aws ssm`, and file-write operation in
      a helper:
  ```sh
  run() {
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [dry-run] $*"
    else
      "$@"
    fi
  }
  ```
- [ ] Replace bare command invocations with `run <command>` throughout the script
- [ ] Verify: `./deploy.sh --dry-run` prints all commands in order and exits 0 without
      touching AWS or the filesystem

#### Simplify the deploy sequence
- [ ] Move both frontend builds to the top (before any CDK deploy):
  ```sh
  run npm run build --workspace=packages/web
  run npm run build --workspace=apps/admin
  ```
- [ ] Remove `sed -i` + `echo VITE_API_URL` into `packages/web/.env` (old step 4)
- [ ] Remove mid-script `npm run build --workspace=packages/web` (old step 5)
- [ ] Remove `aws ssm get-parameter` reads (old step 7)
- [ ] Remove heredoc write of `apps/admin/.env` (old step 7)
- [ ] Remove mid-script `npm run build --workspace=apps/admin` (old step 8)
- [ ] Run `shellcheck packages/infra/deploy.sh` after editing and fix any new warnings

**New deploy order (7 lines of logic):**
1. Build both frontends
2. Deploy `AdminFrontendStack` (infra pass — capture CloudFront URL)
3. Deploy `CognitoStack` (registers CloudFront URLs for OAuth)
4. Deploy `ApiStack`
5. Deploy `FrontendStack` (CDK writes config.json)
6. Deploy `AdminFrontendStack` (second pass — CDK writes config.json)

**Verify:** `./deploy.sh --dry-run` prints the correct sequence with no file writes.
`./deploy.sh` completes without writing any `.env` files. Both frontends work.
`./deploy.sh --skip-cognito` still works.

---

## What Stays the Same

- **Two-pass `AdminFrontendStack`** — still required because Cognito must know the admin
  CloudFront URL before the admin app can register OAuth callbacks. Fixing this properly
  requires splitting `AdminFrontendStack` into a pure-infra stack and an assets stack, which
  is a larger CDK refactor left for a future plan.
- **Local `.env` files for dev** — `packages/web/.env` can still hold `VITE_API_URL` as a
  convenience (Vite ignores unknown vars), but it is no longer read by app code.
- **`VITE_API_URL` in `.env`** — `deploy.sh` no longer writes it; it becomes a developer-managed
  file rather than a generated artefact.
