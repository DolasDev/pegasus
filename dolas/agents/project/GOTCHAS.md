# Gotchas and Environment Quirks

- **Local Integration Testing**: Vitest integration tests for API handlers require Docker to be running, as they spin up a local Postgres container.
- **Deployment Script Workflow**:
  - The deployment script (`bash packages/infra/deploy.sh`) performs a multi-step process for the full stack.
  - The `apps/admin` deployment requires two passes: one to provision the AWS infrastructure (to get the CloudFront URL) and a second pass to upload the Vite bundle after securely injecting `VITE_COGNITO_REDIRECT_URI`.
- **Apps Ports**: Running `npm run dev` in `apps/admin` explicitly binds to port `5174`, unlike generic Vite apps which default to `5173`.
- **Type Checking Strategy**: The system firmly enforces strict imports and avoids circular dependencies. Always verify architecture graph constraints with `madge` or `tsc --traceResolution` when modifying the domain model.
- **On-prem API reachability via WireGuard tunnel**: The cloud API → on-prem call path (`apps/api/src/handlers/onprem.ts` → `tunnelFetch` → tunnel-proxy Lambda → WG hub → tenant overlay IP `10.200.<o1>.<o2>:3000`) requires three on-prem-side conditions, none enforced by code:
  1. The on-prem Node server (`apps/api/src/server.ts`) must bind `0.0.0.0` (the default; verify the deployment's `HOST` env isn't overridden to `127.0.0.1`).
  2. The host firewall must allow inbound on `wg0` to the listen port (`ufw allow in on wg0` or equivalent).
  3. Plain HTTP is intentional — the WG tunnel provides confidentiality + peer auth, so cloud→onprem skips TLS by design (`ONPREM_TUNNEL_SCHEME` defaults to `http`). LAN-side TLS is a separate concern.
- **CDK NodejsFunction bundling silently drops non-JS assets**: `apps/api/src/authz/load.ts` reads `cedar.schema.json` and the `policies/**/*.cedar` tree from `__dirname` at runtime (used both by AVP provisioning in `POST /api/admin/tenants` and by the offline cedar-wasm `/me/permissions` path). esbuild only bundles modules reachable through `import`/`require`, so without an explicit copy these files end up missing from the Lambda asset and tenant creation fails with `ENOENT: /var/task/cedar.schema.json`. Two prior incidents now: `cedar_wasm_bg.wasm` (fixed by listing the package under `nodeModules`) and the schema + policies (fixed via `bundling.commandHooks.afterBundling` in `packages/infra/lib/stacks/api-stack.ts`). **Pattern to repeat:** any new file the API reads from disk at runtime (config JSON, templates, additional Cedar/policy files) must be copied via the same `afterBundling` hook — bundling tests don't catch this because esbuild succeeds and the failure surfaces only when the runtime code path executes. The authenticated AVP smoke (`apps/e2e/tests/api/authz-smoke.spec.ts`) signs in as `e2e-admin@pegasus-test.invalid` against the staging Cognito tenant client and hits the staging tenant referenced by the `E2E_STAGING_TENANT_ID` repo variable. **Don't delete the user from staging Cognito or the corresponding `tenant_users` row from the staging DB.** If the GitHub secret `E2E_STAGING_ADMIN_PASSWORD` rotates, re-set the Cognito password permanently via `aws cognito-idp admin-set-user-password --permanent` (using the temporary-password reset flow would break the gate, since `USER_PASSWORD_AUTH` returns a `NEW_PASSWORD_REQUIRED` challenge). The gate also expects `custom:roles` to include `tenant_admin` — this is mirrored from the `tenant_users.role_names` column by the pre-token-generation Lambda, so a manual DB tweak is the recovery path if the role disappears.

## Security Overrides in Root package.json

The `overrides` section contains two categories of entries:

### React version unification (managed separately)

`react`, `react-dom`, `react-test-renderer`, `@types/react`, `@types/react-dom` — pinned to React 19.x across the monorepo.

### Security vulnerability overrides (audited 2026-04-05)

All of the following are required because transitive dependencies pull in vulnerable versions:

| Override                  | Pulled in by                                                 | Why needed                     |
| ------------------------- | ------------------------------------------------------------ | ------------------------------ |
| `handlebars >=4.7.9`      | ts-jest (mobile)                                             | Prototype pollution fix        |
| `flatted >=3.4.2`         | eslint -> flat-cache                                         | Pollution fix                  |
| `@xmldom/xmldom >=0.9.9`  | expo -> @expo/plist, xcode                                   | Misuse of entities fix         |
| `defu >=6.1.5`            | prisma -> c12                                                | Prototype pollution fix        |
| `undici >=7.24.0`         | jsdom (admin-web), expo (mobile)                             | Various HTTP handling fixes    |
| `path-to-regexp >=8.4.0`  | react-router-dom v5 (longhaul)                               | ReDoS fix                      |
| `picomatch >=4.0.4`       | tailwindcss -> chokidar, jest (mobile)                       | ReDoS fix                      |
| `rollup >=4.58.1`         | vite 5 (admin-web)                                           | DOM clobbering fix             |
| `yaml >=2.8.3`            | tailwindcss, aws-cdk-lib (overrides 1.x to 2.x), lint-staged | Various parsing fixes          |
| `minimatch >=3.1.4`       | aws-cdk-lib, eslint, stryker                                 | ReDoS fix                      |
| `brace-expansion >=2.0.3` | minimatch (transitive)                                       | ReDoS fix                      |
| `ajv >=8.18.0`            | aws-cdk-lib -> table, eslint, stryker                        | Prototype pollution fix        |
| `effect >=3.20.0`         | prisma -> @prisma/config                                     | Various fixes                  |
| `esbuild >=0.25.0`        | vite 5 (dev server vuln GHSA-67mh-4wv8-2f99)                 | Dev server request forgery fix |

Re-audit periodically with `npm audit` and `npm ls <pkg> --all`. Remove overrides when upstream deps update past the vulnerable versions.

## Sharp Bundling for Lambda

The converter Lambda uses `sharp` for image transcoding. Sharp ships a platform-specific prebuilt binary (~30MB). In the CDK `NodejsFunction` bundling config, sharp must be listed in `nodeModules` (not `externalModules`) so esbuild installs it into the bundle with its native binary. Using `externalModules: ['sharp']` would strip it entirely.

## Cedar-WASM Bundling for Lambda

`@cedar-policy/cedar-wasm/nodejs` reads `${__dirname}/cedar_wasm_bg.wasm` synchronously at module init via `require('fs').readFileSync`. esbuild bundles the JS but doesn't carry the `.wasm` asset — Lambda init then crashes with `ENOENT: no such file or directory, open '/var/task/cedar_wasm_bg.wasm'` and API Gateway returns a bare `{"message":"Internal Server Error"}` 500 (no `correlationId` envelope, because Hono's `onError` never gets to run).

In the CDK `NodejsFunction` bundling config, list the package under `nodeModules` (not `externalModules`) so CDK installs it as a real `node_modules` dep alongside the bundle, preserving the package layout the runtime read expects. Same shape as the sharp gotcha above. See `packages/infra/lib/stacks/api-stack.ts:196-205`.

Failure mode is silent against the staging E2E gate's path filter — if the next pushes to `main` only touch paths excluded from the api filter (e.g. `plans/`, `dolas/`), no fresh deploy fires and the gate doesn't re-run, so a red staging Lambda can sit broken indefinitely. PR #91 (cedar/AVP foundation) shipped broken on 2026-05-03 and was only caught two days later when a `packages/infra/**` change forced a full rebuild.

## ssm:SendCommand IAM Statement Shape

`ssm:SendCommand` authorizes against **both** the document and the instance resource in the same call. Two pitfalls when scoping:

1. **AWS-managed documents have an empty account portion.** `AWS-RunShellScript`'s ARN is `arn:aws:ssm:<region>::document/AWS-RunShellScript` (note the `::`). Templating `${this.account}` into that ARN in CDK produces `arn:aws:ssm:<region>:<acct>:document/...` — a string IAM never sees on real calls — so the policy never matches and SendCommand fails closed with "no identity-based policy allows the ssm:SendCommand action".
2. **Tag conditions are evaluated per-resource.** Putting the document and the instance in the same `PolicyStatement` with `StringEquals: ssm:resourceTag/Name = ...` filters the statement out for the document side of the call (AWS-managed documents don't carry customer tags), so the call is denied even when the ARN is listed.

Correct shape — two statements: instance with the tag condition (the actual safety guarantee — restricts which target instance is allowed), document unconditionally. See `packages/infra/lib/stacks/api-stack.ts` `ssm:SendCommand` block, with a regression test in `__tests__/api-stack.test.ts` asserting the document statement has no `Condition`.

## pdfjs-dist in Node.js (Server-Side)

`pdfjs-dist` requires a canvas polyfill for server-side rendering. The converter Lambda uses `@napi-rs/canvas` for this. Import the legacy build (`pdfjs-dist/legacy/build/pdf.mjs`) — the standard build assumes browser APIs. The `page.render()` TypeScript types require a `canvas` property in `RenderParameters` but the server-side render works with just `canvasContext` + `viewport` — use `as any` on the render call.

## S3 Event Notification Prefix Filters

S3 event notification prefix filters only match from the start of the key. You cannot filter on a mid-key segment like `/original/`. The converter Lambda receives all `ObjectCreated` events on the documents bucket and filters for `/original/` in the handler code.

## Domain Types Over the Wire

Domain entities have `Date` fields (`createdAt`, `updatedAt`, `scheduledDate`) and branded IDs (`CustomerId`, `MoveId`). JSON serialization turns `Date` → `string` and branded IDs → plain `string`. If a frontend query is typed `apiFetch<Customer>`, TypeScript will claim `createdAt: Date` — but at runtime it's a string. Use `Serialized<T>` from `@pegasus/domain` instead.

## Per-Handler Catch Blocks (Anti-Pattern)

Historically, every API handler had `try { ... } catch { return 500 }`. This prevents `DomainError` from reaching `app.onError` (which routes it to 422), suppresses structured logging, and makes error paths untestable. These catch blocks should be removed — see `fix-handler-error-swallowing` plan.

## Mobile App Isolation

The mobile app (`apps/mobile`) historically did not import `@pegasus/api-http` or `@pegasus/domain`. It used raw `fetch()`, local `AsyncStorage` mock data, and its own type definitions. The `mobile-api-integration` plan addresses this convergence. Until it lands, do not assume mobile shares any code with the web apps beyond `@pegasus/theme`.

## Betterleaks Secret Scanning

CI job `Secret Scanning (Betterleaks)` (`.github/workflows/ci.yml`) runs `betterleaks git .` over full history and fails the build on any finding.

**Allowlist location:** `.betterleaksignore` at repo root. Each entry is a fingerprint: `<commit-sha>:<file>:<rule-id>:<line>` — the narrowest scope the tool supports. No regex or path-wide suppression.

**Adding a new entry (false positive or rotated secret):**

1. Install locally: `curl -sSfL https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_linux_x64.tar.gz | tar -xz betterleaks`
2. Reproduce: `./betterleaks git . --report-format json --report-path /tmp/bl.json`
3. Open `/tmp/bl.json`, find the offending finding, copy its `Fingerprint` field verbatim.
4. Append to `.betterleaksignore` under a comment block explaining the verdict (false positive / rotated / client-side identifier) and **why** it is safe.
5. Re-run `./betterleaks git .` — must exit 0 before pushing.

**If you find a real, live secret:**

1. **Rotate first.** Revoke the credential at its source (AWS, Cognito, Airbrake, etc.) before touching git.
2. Remove the secret from HEAD in a new commit.
3. Add the historical fingerprint to `.betterleaksignore` with a `rotated YYYY-MM-DD` comment.
4. Do **not** rewrite history with BFG / git-filter-repo unless absolutely required — it breaks everyone's clones and needs team coordination. Rotation is the mitigation, not history rewrite.

**Never** blanket-allowlist a file, directory, or rule. Always fingerprint-scope.

## WireGuard Hub: Manual Peer Break-Glass

The reconcile agent (`apps/vpn-agent`) is the source of truth for hub peer state — it polls the admin API and applies `wg set` every ~30s. If the agent is wedged (process down, API unreachable, kernel disagreeing with desired state) and a tenant needs the tunnel up _now_, you can add a peer manually:

```bash
# SSM into the hub
aws ssm start-session --target <hub-instance-id>
sudo wg set wg0 peer <tenant-pubkey> allowed-ips 10.200.<n>.2/32
sudo wg show wg0   # verify peer block is present
```

Caveats:

- **Non-persistent.** ASG instance replacement wipes this. Fix the agent before the next refresh.
- **Diagnose, don't paper over.** Check `journalctl -u pegasus-vpn-agent` and the `pegasus-wireguard-agent-down` / `pegasus-wireguard-eip-detached` / `pegasus-wireguard-peer-drift` alarms before reaching for this. Manual `wg set` is the _exception_, not the steady state.
- **Drop the manual entry once the agent is back.** It will already have re-added the peer from the database; remove your manual entry with `sudo wg set wg0 peer <pubkey> remove` if it's still there alongside the agent's version.
