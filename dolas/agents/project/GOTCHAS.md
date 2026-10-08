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
- **`POST /api/admin/tenants` returning `AUTHZ_ERROR` is opaque by design**: the response is a sanitized "Failed to provision the tenant authorization store" with no class hint, so the only way to distinguish bundling vs IAM vs AVP-eventual-consistency vs Cognito-introspection IAM is to read CloudWatch. Filter command (single line):

  ```
  aws logs filter-log-events --profile pegasus-staging --region us-east-1 --log-group-name <api-log-group> --start-time $(($(date +%s) - 600))000 --filter-pattern '"Failed to provision"' --query 'events[].message' --output text
  ```

  Known error shapes seen during the AVP foundation rollout (2026-05-03 to 2026-05-06), each with its fix commit:

  | CloudWatch error fragment                                                                                                                                                                                                                                                                                   | Class                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `ENOENT: ... open '/var/task/cedar.schema.json'` (or any `.cedar` path)                                                                                                                                                                                                                                     | Bundling                   | `5588b18` — `commandHooks.afterBundling` in `packages/infra/lib/stacks/api-stack.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
  | `ENOENT: ... cedar_wasm_bg.wasm`                                                                                                                                                                                                                                                                            | Bundling                   | `19c0798` — list `@cedar-policy/cedar-wasm` under `bundling.nodeModules`, not `externalModules`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
  | `AccessDeniedException: ... cognito-idp:DescribeUserPool` (or `ListUserPoolClients` / `DescribeUserPoolClient`)                                                                                                                                                                                             | IAM                        | `46fb673` / `cf36796` — the API Lambda role needs every `cognito-idp:Describe*UserPool*` and `ListUserPoolClients` action AVP `CreateIdentitySource` calls under the caller's credentials                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
  | `ResourceNotFoundException: Policy Store does not exist.` immediately after a successful `CreatePolicyStore`                                                                                                                                                                                                | AVP eventual consistency   | `02a2961` — `withConsistencyRetry` wrapper in `apps/api/src/lib/authz-provision.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
  | `ValidationException: PrincipalEntityType <T> cannot be defined in Entities` or `GroupEntityType <T> cannot be defined in Entities` from `IsAuthorizedWithToken`/`BatchIsAuthorizedWithToken`, **or** `tenant_admin` user receives empty `permissions: []` from `/me/permissions` despite policies existing | AVP token-RBAC unsupported | Plan `plans/completed/2026-05-XX-avp-attribute-based-policies.md` — AVP's Cognito identity source treats `cognito:groups` as a special claim: it can ONLY be projected into Group _parent entities_ (via `groupConfiguration`), and never onto the principal as a regular attribute. With `groupConfiguration` set, AVP synthesises Group entities with user-pool-prefixed IDs that don't match bare-named policy refs, AND it forbids the caller from supplying corrective `entities` of the principal/Group types via `IsAuthorizedWithToken`. The fix: skip `IsAuthorizedWithToken` entirely. Call `IsAuthorized` (no-token) directly with a manually-built `User + Group` entity hierarchy in `entities` — same shape the offline cedar-wasm path builds. The JWT is already verified by `middleware/jwt-auth.ts`, so AVP's token-signature check would be redundant. |

  Regression tests for the bundling and IAM classes live in `packages/infra/lib/stacks/__tests__/api-stack.test.ts` (IAM permission pin) and `api-stack.bundle.test.ts` (asset-content contract). The eventual-consistency class is logic-shaped and only exercised by an end-to-end call into AVP — see `plans/todo/avp-provisioning-regression-tests.md` item #3 for the proposed live-integration safety net.

- **CDK NodejsFunction bundling silently drops non-JS assets**: `apps/api/src/authz/load.ts` reads `cedar.schema.json` and the `policies/**/*.cedar` tree from `__dirname` at runtime (used both by AVP provisioning in `POST /api/admin/tenants` and by the offline cedar-wasm `/me/permissions` path). esbuild only bundles modules reachable through `import`/`require`, so without an explicit copy these files end up missing from the Lambda asset and tenant creation fails with `ENOENT: /var/task/cedar.schema.json`. Two prior incidents now: `cedar_wasm_bg.wasm` (fixed by listing the package under `nodeModules`) and the schema + policies (fixed via `bundling.commandHooks.afterBundling` in `packages/infra/lib/stacks/api-stack.ts`). **Pattern to repeat:** any new file the API reads from disk at runtime (config JSON, templates, additional Cedar/policy files) must be copied via the same `afterBundling` hook — bundling tests don't catch this because esbuild succeeds and the failure surfaces only when the runtime code path executes.
- **Staging E2E gate depends on a stable test admin**: The authenticated AVP smoke (`apps/e2e/tests/api/authz-smoke.spec.ts`) signs in as `e2e-admin@pegasus-test.invalid` against the staging Cognito tenant client and hits the staging tenant referenced by the `E2E_STAGING_TENANT_ID` repo variable. **Don't delete the user from staging Cognito or the corresponding `tenant_users` row from the staging DB.** If the GitHub secret `E2E_STAGING_ADMIN_PASSWORD` rotates, re-set the Cognito password permanently via `aws cognito-idp admin-set-user-password --permanent` (using the temporary-password reset flow would break the gate, since `USER_PASSWORD_AUTH` returns a `NEW_PASSWORD_REQUIRED` challenge). The gate also expects `custom:roles` to include `tenant_admin` — this is mirrored from the `tenant_users.role_names` column by the pre-token-generation Lambda, so a manual DB tweak is the recovery path if the role disappears.

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

The safety net for this is the `pegasus-lambda-errors` CloudWatch alarm in `MonitoringStack` (per stage). It's deliberately tuned to "any error in 3 of the last 5 minutes" (`threshold: 0`, `evaluationPeriods: 5`, `datapointsToAlarm: 3`) rather than a per-minute count, so a low-traffic stage left broken by a path-filtered deploy still trips it within ~5 minutes regardless of deploy cadence.

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

## Mobile Store Screenshots: Config Is Inlined at Bundle Time, and Metro Caches It

`apps/mobile/store-assets` captures listing screenshots by driving a real
`expo export --platform web` build. Expo inlines `process.env.EXPO_PUBLIC_*` into
the bundle **at transform time**, so:

- **A checkout with no `apps/mobile/.env` renders only the "Configuration Error"
  screen**, and every capture fails with `never reached "<text>"` — including
  screens whose copy you never touched. A fresh worktree is exactly that case.
  `npm run store:export` therefore bakes placeholder `EXPO_PUBLIC_*` values itself
  (every `/api/*` request is served from `fixtures/screens.json`, so the host never
  matters).
- **Metro's transform cache survives an env change.** Supplying the variables
  after an env-less export still produced a bundle with them unset, because
  `config.ts` came back from cache. `store:export` passes `--clear` for that
  reason — do not drop it to save a few seconds.
- **Diagnose from `FAILED-<screen>.png`**, which the capture writes next to the raw
  shots on any failure, and confirm inlining with
  `grep -c <expected-host> dist-web/_expo/static/js/web/entry-*.js`.

## Mobile Android: R8 Is Opt-In Under CNG

`apps/mobile/android/` is gitignored — EAS prebuilds it from `app.json` on every
build, so editing a local `build.gradle` changes nothing that ships. The generated
`build.gradle` reads `android.enableMinifyInReleaseBuilds` from gradle properties
and **defaults it to `false`**. Until the `expo-build-properties` plugin entry in
`app.json` set it, every release AAB shipped un-minified, and Play Console flagged
vcode 16 with "DEX code optimization … Obfuscation (1%)". Under 25% "may impact
your visibility and publishing capabilities".

- **Verify a config change by prebuilding into a scratch copy**
  (`npx expo prebuild --platform android --no-install`), then grep
  `android/gradle.properties`. Grep case-insensitively: the key is `…Minify…`.
- **`eas submit` does not upload `mapping.txt`.** Without it, Play vitals crash and
  ANR stacks show obfuscated class names. Download it from the EAS build artifacts
  and upload it in Play Console (App bundle explorer → Downloads).
- **R8 can strip classes that native modules reach only by reflection.** That
  fails at runtime, not at build time. If a release build crashes in a native
  module, add a keep rule via `expo-build-properties` `android.extraProguardRules`.
  Don't turn minify off.

## Betterleaks Secret Scanning

CI job `Secret Scanning (Betterleaks)` (`.github/workflows/ci.yml`) runs `betterleaks git .` over full history and fails the build on any finding.

**Allowlist location:** `.betterleaksignore` at repo root. Each entry is a fingerprint: `<commit-sha>:<file>:<rule-id>:<line>` — the narrowest scope the tool supports. No regex or path-wide suppression.

**Adding a new entry (false positive or rotated secret):**

1. Install locally: `curl -sSfL https://github.com/betterleaks/betterleaks/releases/download/v1.1.1/betterleaks_1.1.1_linux_x64.tar.gz | tar -xz betterleaks`
2. Reproduce: `./betterleaks git . --report-format json --report-path /tmp/bl.json`
3. Open `/tmp/bl.json`, find the offending finding, copy its `Fingerprint` field verbatim.
4. Append to `.betterleaksignore` under a comment block explaining the verdict (false positive / rotated / client-side identifier) and **why** it is safe.
5. Re-run `./betterleaks git .` — must exit 0 before pushing.

**A `.betterleaksignore` fingerprint only works for a finding already on `main`.** The fingerprint
is keyed on the commit SHA. `main` is squash-merged, so a finding introduced by a **not-yet-merged
PR** lives on the PR-branch commit; when the PR squash-merges, the lines are re-introduced under a
**new** SHA. A fingerprint pinned to the PR commit passes the PR check but the finding **resurfaces
on `main` under the squash SHA and fails there — wedging the merge queue.** You cannot predict the
squash SHA. (All existing `.betterleaksignore` entries reference commits already on `main` — they
came from the one-time historical triage, not from pre-merge PRs.)

**For a false positive introduced by a PR, use an inline allow-comment instead** — `// gitleaks:allow`
(TS/JS) or `# gitleaks:allow` (Python) on the same line as the value, ideally with a short reason.
It travels with the line through squash-merge, so it's SHA-independent; CI runs plain `betterleaks
git .` (no `--ignore-gitleaks-allow`), so it's honored. You must **amend** the commit that introduced
the line (force-push) — a _new_ commit adding the comment leaves the original commit's patch still
flagged in the full-history scan. Keep the reason short: the SDK's `Ruff (SDK)` step (`ruff check .`,
line-length 100) will fail E501 on a long trailing comment. Note also that `generic-api-key` is
suppressed by stopwords — a fixture value containing `secret`/`token`/`example` won't be flagged at
all, so you often only need to comment the values that lack one.

**Docs count too, and placeholders are not safe.** A markdown example
`curl -H "Authorization: Bearer vnd_YOUR_KEY"` trips rule `curl-auth-header` (#651) — nothing <!-- gitleaks:allow -->
secret, check still red. In _user-facing_ docs prefer **rewriting the example** over an
allow-comment, since hoisting the key into a variable reads better anyway and stops matching:
`read -rs PEGASUS_KEY && export PEGASUS_KEY`, then `Bearer $PEGASUS_KEY`. Save `gitleaks:allow`
for code and fixtures where the literal has to stay — **including this very paragraph**, whose
example is allowed with a trailing `<!-- gitleaks:allow -->`. That is the markdown form: the tool
only looks for the literal string anywhere on the matched line, and an HTML comment renders as
nothing.

**After amending, a local full scan still reports the old finding — that is the stale
remote-tracking ref, not a failed fix.** `betterleaks git .` walks every reachable ref, and
`origin/<branch>` still points at the pre-amend commit until you force-push. Check your own commits
first with `./betterleaks git . --log-opts=-3 -v`; the full scan clears once the force-push moves
the ref. `-v` prints File/Line/RuleID/Fingerprint straight to stdout, which is usually quicker than
the JSON report above — worth knowing because the CI log only ever prints `leaks found: N`, never
the finding itself.

**If you find a real, live secret:**

1. **Rotate first.** Revoke the credential at its source (AWS, Cognito, Airbrake, etc.) before touching git.
2. Remove the secret from HEAD in a new commit.
3. Add the historical fingerprint to `.betterleaksignore` with a `rotated YYYY-MM-DD` comment.
4. Do **not** rewrite history with BFG / git-filter-repo unless absolutely required — it breaks everyone's clones and needs team coordination. Rotation is the mitigation, not history rewrite.

**Never** blanket-allowlist a file, directory, or rule. Always fingerprint-scope.

**Two layers, on purpose.** GitHub native secret scanning + push protection is also
enabled (repo Settings → Security). It is complementary, not redundant: Betterleaks is
CI-time, full-history, pattern-based, with the custom `.betterleaksignore`; GitHub adds
provider-validated patterns and **push-time** blocking before a secret enters the
(world-readable, public repo) history. A push blocked by push protection can be bypassed
with a reason in the CLI output — same triage discipline as the Betterleaks runbook above.
The known Airbrake client key is dismissed in both (`.betterleaksignore:10-13` rationale).

### The scan is repo-wide, not PR-wide — someone else's branch can redden your PR

`betterleaks git .` scans **every ref the runner has**, and the job checks out with
`fetch-depth: 0` ("all history for all branches and tags"). So a finding on ANY pushed
branch fails the secret-scan job on EVERY open PR, including PRs that never touched the
file. Seen 2026-07-16: an `ing_`-prefixed fake token fixture on `feat/inbound-ingress`
(#450) failed the scan on the unrelated #451 four minutes after it was pushed, while
older PRs stayed green only because their checks had already run.

Do not quote a flagged literal into this file when writing one of these up — the scanner
reads documentation too, and a pasted example becomes finding number five.

Diagnose before assuming it is yours — the CI log prints only `leaks found: N`, not the
findings. Reproduce locally per the runbook above and read the `Commit` and `File` of each
finding; `git branch -a --contains <sha>` and `git merge-base --is-ancestor <sha> HEAD`
tell you whose it is in one step. If it is not on your branch, the fix belongs on the
branch that owns it — do not allowlist it from yours.

**Prefer an inline `// gitleaks:allow` comment to a fingerprint for a finding on an
unmerged branch.** Fingerprints are pinned to a **commit sha**, so a squash-merge (or any
rebase/force-push) changes the sha and the entry silently stops matching — the finding
then reappears on `main`. The inline comment travels with the content and survives both.
`gitleaks:allow` works because betterleaks is a gitleaks fork. #450 fixed its own fixture
this way, which cleared #451 with no change to #451 at all.

## Merge queue ejects a PR whose coverage floors were ratcheted before a parallel PR merged

`apps/api/vitest.config.ts` has `thresholds.autoUpdate: true`, which only ever RAISES a
floor — it never lowers one. So two PRs in flight that both move coverage will break each
other, and the second one through pays:

1. PR A ratchets floors up against the `main` it forked from (e.g. lines 91.03).
2. PR B merges first, adding code whose coverage sits below A's floors.
3. A's own branch checks stay **green** (they run on A's pre-B tree), so A looks ready and
   is queued — but the merge queue validates `main + A` on a `merge_group` ref, where the
   combined coverage (90.93) is under A's floor (91.03). The Test job fails and the queue
   **ejects A**, quietly: `gh pr checks` still shows every branch check passing, and
   `mergeStateStatus` reads `CLEAN`.

Symptom: a PR enters the queue (`AWAITING_CHECKS`), disappears from it minutes later
without merging, and auto-merge reads OFF. Seen twice on #451 on 2026-07-16.

Fix: rebase onto `main`, re-run `npx vitest run --coverage` from `apps/api`, and re-pin the
floors to the **measured** combined values. Verify they are still ≥ `main`'s floors — then
it is an honest ratchet, not a regression. (If a parallel PR added a migration, run
`npm run db:migrate` AND `npm run db:generate` from `apps/api` first, or the stale Prisma
client fails tests that pass on `main`.)

## SBOM Export (on demand, no recurring artifacts)

We deliberately do **not** attach CycloneDX/syft SBOMs to releases — ceremony with no
consumer today. For any ad-hoc "send us your SBOM" request, export GitHub's free
dependency-graph SBOM instead:

```
gh api repos/DolasDev/pegasus/dependency-graph/sbom > sbom.spdx.json
```

(Requires the repo dependency graph enabled — it is, alongside Dependabot alerts and the
`Dependency Review` PR check. If the command 404s, re-check Settings → Advanced Security.)

## The WireGuard VPC's DNS Firewall: fail-open is set by an API call, and the block is bypassable

`wireguard-stack.ts` blocks `saas-api.tmprl.cloud` (the Temporal Cloud Ops API) with a Route 53
Resolver DNS Firewall rule group associated with the whole VPC (durable-workflow Phase 3a). Three
things about it are not obvious:

- **Fail-open is not a CloudFormation property.** There is no `FirewallConfig` resource, so an
  `AwsCustomResource` (`VpcDnsFirewallFailOpen`) calls `UpdateFirewallConfig` with
  `FirewallFailOpen: ENABLED`. AWS's default is fail _closed_: a firewall fault would take down DNS
  for everything in the VPC, including the WireGuard hub and the longhaul MSSQL path. If that
  custom resource is ever removed, or the setting drifts, the VPC silently reverts to fail-closed.
  Check it with `aws route53resolver get-firewall-config --resource-id <vpc-id>`.
- **It is a speed bump, not a wall.** Runner egress is deliberately open (Resolved decision #2),
  so code that hard-codes the Ops API's IP skips DNS entirely. It exists to keep a leaked
  namespace-scoped key (whose mandatory account-level Read role can list the Cloud account's
  users) from being trivially usable from inside a tenant runner.
- **It covers the whole VPC**, not just runner subnets: the hub, private Lambdas and the stdlib
  worker cannot resolve the Ops API either. None of them need it. If something ever legitimately
  must call the Ops API (for example the planned `temporal-provisioner` Lambda), run it **outside**
  this VPC.

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

## Login: one Cognito login fires multiple PreTokenGeneration invocations

A single Cognito login is not one PreTokenGeneration call — it is several
(initial auth + silent token refresh + extra SPA token calls). Two consequences
that caused an intermittent "account has not been granted access" failure:

- **`AuthSession` must not be consumed on read.** `select-tenant` creates a
  short-lived `AuthSession` carrying the user's tenant pick. Pre-token previously
  `deleteMany`'d it on first read — so the second invocation (token refresh,
  which never has its own AuthSession) lost the pick. Sessions now expire only
  via their 10-minute `expiresAt`; pre-token sweeps expired rows but never
  deletes the one it just read. If you touch `pre-token.ts`, do not re-introduce
  a read-time delete.
- **Resolution is roster-only.** When there is no live AuthSession (every token
  refresh), pre-token resolves the tenant from the user's `tenant_users` roster
  (exactly one active row → use it; multiple → throw "session expired"; zero →
  "not granted access"). There is no email-domain fallback — the `email_domains`
  column was removed. A user belonging to multiple tenants cannot be auto-resolved
  on a bare token refresh and is told to sign in again rather than guessed at.
  The MoveManager desktop (from its in-app password sign-in release) refreshes
  silently anyway by calling `select-tenant`
  immediately before each refresh: the fresh `AuthSession` wins, exactly as at
  sign-in. Any other client that wants silent multi-tenant refresh must do the same.

Cognito wraps any pre-token `throw` as `UserLambdaValidationException` with the
message `PreTokenGeneration failed with error <msg>.`. `unwrapPreTokenMessage`
in `packages/auth/src/cognito-client.ts` strips that wrapper (and Cognito's
appended period) so only the Lambda's own sentence reaches the login UI — keep
pre-token error strings user-ready.

## Password sign-in through the Hosted UI resolves a linked user to the WRONG tenant

Password login must call Cognito `InitiateAuth USER_PASSWORD_AUTH` directly (tenant-web:
`apps/tenant-web/src/auth/cognito.ts` via `packages/auth/src/cognito-client.ts`; the
MoveManager desktop: its in-app password form). **Never** route it through the Hosted UI's
own password page, even though that page works and looks the same.

Why: pre-token's `isFederatedSignIn` (`apps/api/src/cognito/pre-token.ts`) classifies a
sign-in by `triggerSource`. `InitiateAuth` yields `TokenGeneration_Authentication` →
native → the `select-tenant` pick wins. The Hosted UI yields `TokenGeneration_HostedAuth`
→ treated as federated whenever the account carries a linked identity
(`cognito/pre-sign-up.ts` links them) → the tenant comes from `identities[0]`'s provider.
For a user linked to another tenant's IdP, that is the wrong tenant, and the
AuthSession-disagreement check refuses it:
`PreTokenGeneration failed … session does not match the identity provider`.

Hit 2026-10-08 on the desktop's first QMM live sign-in: "Email and password" opened the
Hosted UI, the user's `identities[0]` was another tenant's Microsoft provider, and the
QMM pick was refused. Fix: the desktop app client allows `USER_PASSWORD_AUTH`
(`cognito-stack.ts`, pinned in `cognito-stack.test.ts`) and the desktop signs in in-app.
Unlinked users don't hit it, so a test account without a linked identity will not
reproduce it — test with a linked one.

## Ported longhaul CSS relies on browser-default headings that Tailwind Preflight strips

`apps/longhaul` had **no CSS reset**, so its components were authored against
browser-default heading metrics. tenant-web imports Tailwind v4 (`globals.css`),
whose Preflight resets `h1–h6` to `margin: 0; font-size/weight: inherit`. When a
longhaul component is ported into `driver-planning`, any layout that leaned on a
default heading size/margin silently breaks:

- The Trip Itinerary Gantt's fixed left card column uses `margin-top: 53px` to
  clear the `<h5>` date-header row. That 53px **is** the height a UA-default
  `<h5>` occupies at the feature's 14px base (`0.83em` text + `1.67em` block
  margins). Preflight collapsed the header to one text line, dropping the left
  column ~33px out of row-alignment with the Gantt rows.
- The `<h3>` "Trip Itinerary" rendered at body size/weight instead of bold 1.17em.

Fix pattern: **restore the UA-default heading metrics once, scoped to the whole
feature**, in `driver-planning/styles.css`:

```css
:where(.driver-planning-root) :where(h3) {
  font-size: 1.17em;
  font-weight: bold;
  margin: 1em 0;
}
/* …h2/h4/h5/h6 likewise; h1 keeps its existing explicit rule. */
```

The `:where()` wrapper zeroes specificity to (0,0,0): the rules still beat
Preflight (unlayered always wins over Tailwind's `@layer base`) but lose to
every component heading rule — explicit styles (`Lane .title`, `ConfirmDialog
.title`) and margin overrides (`.tripContainer h3`, `.activityCreationContainer
h3`) alike — so nothing downstream has to fight them. This covers every bare
`<hN>` in the feature at once (Gantt date header, Expandable, filter modals,
empty-states, AppGuard error, Notes, PendingTrips). The same block also restores
`<p>` margins (`:where(p) { margin: 1em 0 }`) — Preflight zeroes those too and
the AppGuard/ErrorBoundary/Notes paragraphs lost their spacing. Do NOT retune
the Gantt's 53px magic number — the restored `<h5>` margin is what gives the
header its height.

Audited the rest of the feature for the same Preflight class: `<table>`
(`components/Table`), `<ul>`/`<li>` (`components/Autocomplete`) are all
explicitly classed → unaffected. longhaul had **no** global `a` rule, so bare
`<a onClick>` (href-less, e.g. PendingTrips Save/edit) render identically in
both apps — no fix needed; only `ErrorBoundary`'s `<a href="mailto:">` loses its
default underline (cosmetic, left as-is to avoid diverging from the reference). Separately, the feature also lost its `font-family` (longhaul forced
`Open Sans` on `body`/`*`); it's now declared on `.driver-planning-root` and the
font is bundled via `@fontsource/open-sans` (400/700) imported in
`DriverPlanningLayout.tsx`. Verified by `Trip/index.test.tsx` (card-count ===
gantt-row-count alignment invariant) + a WEB_URL-gated visual spec
`apps/e2e/tests/browser/trip-date-container.spec.ts`.

## Turbo strict env mode hides job env vars from tasks

Turbo 2 runs tasks in `strict` env mode: a var set at the CI job level (or in
your shell) is **invisible** to the task unless declared in `turbo.json`
(`tasks.<task>.env` / `globalEnv` / `passThroughEnv`). This was the actual
mechanism of the api test suite's silent-skip hole — ci.yml set `DATABASE_URL`
at the job level, turbo stripped it, vitest's global setup saw it unset and
skipped all 12 DB-backed suites green. `CI` itself IS passed through (turbo's
built-in allowlist), which is why the fail-fast guard could fire. When a task
"can't see" an env var that's clearly set, check `turbo.json` env declarations
before debugging anything else.

## Advisory CI pre-flights must fail only on their precise signal

Two Wave-1 deploy pre-flights initially failed runs on the wrong signals:
AccessDenied (missing IAM grant) and an AWS endpoint connect-hang (transient
GitHub-runner network incident, 2026-06-10 ~23:00–23:40 UTC — also broke the
e2e staging gate with raw `ConnectTimeoutError`s) were both classified as
"stale secret ARN". Pattern: an advisory check greps for its ONE true positive
(`ResourceNotFoundException`) and warns-and-continues on everything else, with
`--cli-connect-timeout/--cli-read-timeout` + `AWS_MAX_ATTEMPTS` so a hung
endpoint can't eat the job timeout (one hang burned 18 min). Related: ECS
`rolloutState` flips to COMPLETED asynchronously _after_ `aws ecs wait
services-stable` returns — poll it (≤2 min), never one-shot read it.

## VPN agent: dev has no /pegasus/wireguard/agent/apikey param

Only staging/prod hub user-data hard-fails on the missing apikey param; dev
predates the AgentKeyBootstrap hardening and intentionally has no param (dev
publishes succeeded without it for months). The publish pre-flight is scoped
`env-name != 'dev'` — don't "fix" dev by creating the param or un-scoping the
check without also deploying WireGuardStack's hardened user-data there.

## GitHub deploy roles are CDK-managed in dolas-infra

`pegasus-github-actions-deploy-{staging,prod}` (and their inline policies) come
from `dolas-infra:lib/pegasus/constructs/pegasus-github-oidc-role.ts` — never
patch their IAM out-of-band; add grants there and deploy dolas-infra. Pending
grant as of 2026-06-11: `secretsmanager:DescribeSecret` on `pegasus/*` (arms
the temporal secret-ARN pre-flight, currently warn-only).

## Two different "redirect URIs" in the SSO setup

When a tenant registers Pegasus at an external OIDC IdP, the callback to
whitelist there is the **Cognito hosted-UI endpoint**
`{cognito.domain}/oauth2/idpresponse` — NOT the app's
`config.cognito.redirectUri` (`…/login/callback`), which is only registered in
Cognito's own app client. SAML equivalents: ACS = `{domain}/saml2/idpresponse`,
SP entity ID = `urn:amazon:cognito:sp:{userPoolId}`. The tenant-web SSO form
(`apps/tenant-web/src/routes/sso-config.tsx`, `IdpSetupHints`) surfaces the
correct values per environment from `/config.json`.

## Lockfile regeneration can nest packages that CDK bundling needs root-hoisted

CDK `NodejsFunction` `nodeModules: [...]` staging writes a one-dep package.json
next to a copy of the monorepo `package-lock.json` and runs `npm ci` — which
only resolves entries at the lock's ROOT `node_modules/` path. Dependabot's
lock regeneration (PR #235) nested `sharp` (+`@img/*`) and
`@cedar-policy/cedar-wasm` under `apps/api/node_modules/`, so api-stack's
bundle test failed locally (cedar) and the documents-stack sharp Lambda broke
the real deploy (`EUSAGE: Missing: sharp@x from lock file`) — there is NO
bundle test for the sharp Lambda. Spot-hoisting lock entries is whack-a-mole;
the fix is `rm -rf node_modules apps/*/node_modules packages/*/node_modules
package-lock.json && npm install` (Node 24) to restore npm's maximal hoisting,
then the full gate. Same PR also taught: a stale nested `hono` copy breaks
`@hono/swagger-ui` typings (targeted `npm dedupe hono`), and react-native's
jest-preset pins `jest-environment-node@^29`, incompatible with jest ≥ 30.4's
runtime (`clearMocksOnScope`) — apps/mobile overrides `testEnvironment` with a
local equivalent env (`apps/mobile/jest.environment.js`) resolving its own
jest-30-matched copy.

## Adding middleware to a Hono route widens `c.req.param()` to `string | undefined`

`ssoHandler.delete('/providers/:id', async (c) => …)` types `c.req.param('id')`
as `string` — Hono infers it from the path literal. Inserting a middleware
(`ssoHandler.delete('/providers/:id', requirePermission(...), async (c) => …)`)
degrades that inference and it becomes `string | undefined`, which under
`exactOptionalPropertyTypes: true` fails against Prisma's
`WhereUniqueInput` (`TS2375`) — so gating an existing `:id` route with
`requirePermission` breaks typecheck at the _db call_, several lines away from
the edit, with an error that reads like a Prisma problem rather than a routing
one. The established fix is `users.ts`'s idiom: `c.req.param('id') ?? ''`. The
fallback is unreachable (the route only matches with an `:id` present); it
exists purely to restore the type. Handlers that already had a `validator`
middleware are unaffected — their inference was degraded to begin with.

## Ported longhaul `calc(100vw - …)` widths overflow tenant-web's column; `overflow-x: clip` then clips right-pinned children off-screen

The driver-planning feature is a lift-and-shift of the standalone `apps/longhaul`
app, whose full-viewport layout hard-codes widths like
`.tripContainer { width: calc(100vw - 90px) }` (viewport minus a 90px rail).
Inside tenant-web the feature renders in AppShell's content **column**, which is
narrower than `100vw - …` (there's a sidebar + padding), so the element overflows
its parent to the right. That was merely ugly until commit `400bb69` added
`.driver-planning-root { position: relative; overflow-x: clip }` (to hide the
off-screen `ShipmentDetail` slide) — the clip now chops that over-wide right
edge. Any child pinned to it with `position: absolute; right: N` (the Trip-detail
`.noteContainer` / `[data-target="trip-notes"]` Notes panel) is carried past the
clip boundary and disappears, while still present in the DOM. Fix is to size the
ported container to its actual column (`width: 100%`) and let inner-content
overflow scroll within the Lane (`overflow: auto`) instead of blowing out the
box. When porting more longhaul screens, treat every `100vw`-relative width as
suspect. Regression guard: `apps/e2e/tests/browser/trip-notes-visibility.spec.ts`
asserts (geometry, no screenshot) that the Notes panel's right edge stays within
`.driver-planning-root` and `.tripContainer` is no wider than it.

## `useRouter().state.location.pathname` is NOT reactive — and the dev server masks the bug

Reading the current path off the router instance —
`const router = useRouter(); const pathname = router.state.location.pathname` — does
**not** subscribe the component to router updates (`useRouter()` is a plain context read
of a stable instance whose `.state` mutates in place). A layout-level component that does
this (whose `<Outlet>` swaps the page without re-invoking the parent) will not re-render
on client-side navigation, so anything derived from `pathname` — e.g. active-link
highlighting — freezes at the value from first render. This bit the sidebar submenus
(Operations / App Settings `NavGroup` children in `components/AppShell.tsx`), the App
Settings in-page rail (`features/settings/app/AppSettingsLayout.tsx`), and the
shell/shell-free toggle (`routes/__root.tsx`). Fix: subscribe reactively —
`const pathname = useRouterState({ select: (s) => s.location.pathname })` — or use
`<Link>`'s built-in active state (`activeProps` / `data-status`).

**The trap that makes this expensive to diagnose:** it does NOT reproduce under
`vite --mode e2e` (dev). React Fast Refresh keeps an HMR client connected and re-renders
the whole route tree on navigation, which incidentally re-runs the non-reactive read with
a fresh value — so the highlight appears to work in dev. It only manifests in a real build
(`vite build` + `vite preview`), where nothing forces the parent to re-render. When
verifying a router-reactivity fix, drive a PRODUCTION build via `vite preview`, not the
dev server, and prove navigation stayed client-side (a `window` sentinel set after load
survives). Regression coverage lives in `src/__tests__/AppShell.test.tsx` (mocks
`useRouterState` with a mutable pathname); note a mocked router is inherently reactive, so
the unit test guards the match logic, not the reactivity — the preview-build check is the
reactivity proof.

## A CDK deploy silently wipes every tenant's SSO — CFN resets `SupportedIdentityProviders`

Changing **any** property of the tenant `AWS::Cognito::UserPoolClient` in
`packages/infra/lib/stacks/cognito-stack.ts` — a callback URL, a logout URL, a token
TTL — makes CloudFormation rewrite the resource, which resets
`SupportedIdentityProviders` to the template's value (`['COGNITO']`). Every tenant's
federated login dies at once, with no deploy failure and nothing in the API logs.

The symptom is deliberately undiagnosable from the outside: Cognito still accepts
`/oauth2/authorize` and still redirects to the IdP, the user authenticates
successfully at Microsoft, and only the **callback** fails — a bare `400` at
`https://<domain>/error?code=…&state=…` with no `error_description`. No Lambda
trigger fires (the rejection precedes pre-sign-up/pre-token), so the trigger log
groups are silent and look healthy.

This hit prod on 2026-07-21: PR #494 added `/login/signed-out` logout URLs, CFN reset
the list at 20:57 UTC, and SSO was dead for ~22h until the drift was traced through
CloudTrail (`UpdateUserPoolClient` by `AWSCloudFormation` with
`supportedIdentityProviders: ['COGNITO']`).

**There is no template-side fix.** Tenant IdP names are chosen at runtime so IaC can
never pre-declare the list, and `addPropertyDeletionOverride` does not help either:
`UpdateUserPoolClient` documents that "if you don't provide a value for an attribute,
Amazon Cognito sets it to its default value", so omitting the property produces the
same reset. Upstream: aws-cloudformation/cloudformation-coverage-roadmap#676.

**The recovery lives in the application.** `POST /auth/resolve-tenants` calls
`reconcileTenantAppClientFromEnv` (`apps/api/src/lib/cognito-app-client.ts`), which
re-adds every `isEnabled` provider from the DB. That endpoint is the last server-side
hop in the SSO flow — the SPA builds the `/oauth2/authorize` URL client-side at
`apps/tenant-web/src/auth/cognito.ts:90` — so the first user to type their email
after a deploy repairs it for everyone, before any redirect. `GET /providers` (the
SSO settings page) reconciles too, as a second path. Both are additive-only: the pool
is shared across tenants, so another tenant's providers must never be stripped.

**Diagnosing it fast:** compare the live client against the DB —
`aws cognito-idp describe-user-pool-client --user-pool-id <pool> --client-id <tenant client> --query 'UserPoolClient.SupportedIdentityProviders'`.
If it reads `["COGNITO"]` while tenants have providers enabled, this is it. The
gzipped `state` param in the `/error` URL base64url-decodes to JSON naming the pool,
the IdP, the client id and the callback — decode it before theorizing.

**There are TWO clients to keep right now (cloud identity I4, 2026-10-06):** the
MoveManager desktop signs in through its own `desktop-app-client`. It is a separate
CFN resource, so it drifts separately, and SSO IdPs must be listed on it too, or
desktop SSO fails the same undiagnosable way. Every IdP path covers both clients:
create (best-effort on the desktop client), delete (both required before the IdP
goes), `GET /providers` and `resolve-tenants` reconcile. When diagnosing, check both
ids. The mobile client has never carried tenant IdPs.

**The CI guard:** `cognito-stack.test.ts` → "existing app clients are frozen" pins
the admin/tenant/mobile client properties in a snapshot and asserts exactly four
clients. If it fails, you edited an existing client. Undo it, or update the snapshot
only after planning and verifying the SSO repair. A new need gets a **new** client.

## Adding a built-in DOMAIN_EVENT_TYPE breaks four exact-list assertions

`DOMAIN_EVENT_TYPES` in `apps/api/src/lib/domain-events.ts` is a public contract,
and several tests assert its **exact** contents rather than membership. Adding a
type (e.g. `feedback.submitted` for the feedback feature, #feedback-requests) fails
these until each is updated:

- `src/lib/__tests__/domain-events.test.ts` — the "exposes exactly the … event
  types" assertion (`toEqual` the literal list).
- `src/handlers/me.test.ts` + `src/lib/authz.test.ts` — the viewer/tenant_user
  permission-list assertions, if the new feature ALSO adds a read action to the
  `20-viewer.cedar` baseline (feedback added `ReadFeedbackForms` there).

Separately, any new **m2m GET route** must be added to `lib/openapi-spec.ts` or the
`openapi-spec.coverage.test.ts` fails — and a path with both a GET and a POST must
declare **both verbs under one `paths` key**, or the later object literal clobbers
the earlier (duplicate-key, last-wins) and the GET silently vanishes from the spec.

A new handler that reads the **unscoped base `db`** (the pre-tenant, token-resolved
pattern — `feedback-public.ts` mirrors `ingress.ts`) must be allowlisted in
`src/__tests__/db-access-guard.test.ts`. The opaque bearer/capability-token
mint+hash+timing-safe-compare now lives once in `lib/opaque-token.ts`; reuse it
(ingress + feedback both do) rather than re-hashing inline.

## `v_longhaul_states` is keyed by `id`, NOT `geo_code` — join on geo_code and rows fan out

The shipments list showed the same shipment twice on the Operations Planning screen.
Cause: `buildBaseSql` in `apps/api/src/handlers/longhaul-cloud/shipments-list.ts`
reached the origin/destination state rows with
`LEFT JOIN v_longhaul_states AS os ON <view>.shipper_state = os.geo_code`. `geo_code`
is not a key — every state row sharing that code multiplied the shipment row.

This was the **only** geo_code join in the repo; every other site joins on the `id`
key (`longhaul-trip-fetch.ts`, `trips-list.ts`, `driver-planning.ts`). The shipments
view has no state_id column, so it can't use the key — the fix was to stop joining
at all and run the zone predicates as `EXISTS (SELECT 1 FROM v_longhaul_states …)`,
which asks the same question without multiplying rows.

Two related traps in the same query family:

- **`sales` is 1:1 with a shipment by convention only.** `shipments-write.ts` guards
  its INSERT with `IF NOT EXISTS`, but no constraint enforces it. Read it through
  `OUTER APPLY (SELECT TOP (1) …)`, never a bare `LEFT JOIN`.
- **A join that projects nothing can still duplicate.** `buildShipmentBundleSql` in
  `lib/longhaul-trip-fetch.ts` joined `sales` while selecting only `s.*` — pure
  fan-out, zero value, and it duplicated a trip's shipments (and their Gantt rows).

Downstream code assumes one row per order everywhere — the enrichment maps are keyed
by `order_num` and the planning list uses `key={shipment.order_num}` — so
`dedupeByOrderNum` backstops the (tenant-owned, un-owned-by-us) view itself and warns
when it fires.

## Gantt date columns must be keyed by UTC calendar day, not by timestamp

Adding a planned date on the trip screen rendered the same date as two columns.
`parseActivities` built the column list as a `Set` of full ISO timestamps, while the
header renders `formatDateShort(day)` with `timeZone: 'UTC'` — so two values on the
same UTC day but different times-of-day were two Set entries with one visible label.

The values genuinely disagree on time-of-day: an activity's `planned_start`, its
ETA/actual dates, the shipment's pegged `plan_pack`/`plan_load`/`plan_del`, and the
`addDays` day-walk all come from different legacy columns. `getPegDates` compares
them with `sameDayCheck` (calendar-day granularity), then the pegged value — carrying
the _shipment_ row's time-of-day — was pushed into `days` next to the activity's own.
That's why the duplicate appeared exactly when a planned date was added.

`toUtcDayKey` (`features/driver-planning/utils/date.ts`) is now the one key. Both
`parseActivities` and `ActivityGantt.getOffset` use it. Two follow-on bugs died with
it: `getOffset` was an exact string match whose `-1` fallback silently parked bars in
column 0, and `addDays` (local-time `setDate`) shifts the UTC time-of-day by an hour
across a DST boundary. Note `sameDayCheck` compares in **local** time while the label
and the key are **UTC** — deliberate, since changing `sameDayCheck` would move the
drift-detection semantics.

## A sync read of a lazily-warmed module cache reports "no data" as "no such thing"

`GET /api/v1/integrations` listed only the two built-in code overlays
(`demo_partner`, `allied_status`) for every tenant, both badged unpublished — no
Weichert, no Sirva ADE. Nothing was wrong with the data: every real integration was
published in `integration_configs`.

The list enumerated `listIntegrationIds()`, which is **synchronous** and therefore
reports whatever the module-level GLOBAL overlay cache (`registry.ts`) happens to
hold. That cache is warmed only by `refreshRegistryOverlay` (after a publish, in
that one container) or by `loadRegistryOverlayIfStale`, whose sole caller was
`resolveIntegrationDefinition` — and only on its `tenantId === null`
(platform-scoped m2m key) branch. A Lambda container serving browser traffic
therefore read a permanently-null map and truthfully reported the code baseline as
the whole world.

Two lessons, both general:

- **A lazily-warmed cache needs a warm call on _every_ read path, not just the one
  it was written for.** Grep the warm function's call sites before trusting a
  sync accessor that reads it. Runtime validation was fine throughout, because
  `validate.ts` goes through `findActiveForScope` and never consults the cache —
  which is exactly why the bug survived: the engine worked, only the _inventory_
  of what exists was wrong.
- **Enumeration and resolution are different questions.** `findActiveForScope`
  resolves tenant-over-GLOBAL-over-built-in correctly for an id you already have,
  but nothing enumerated TENANT-visibility ids at all (the overlay is built from
  `listActiveGlobal` alone), so a tenant could not see an integration it had
  published itself. `listIntegrationIdsForScope` + `listIntegrationSummaries`
  (`integration-validation/summaries.ts`) are now the one read model behind all
  three list endpoints.

Test lesson: `list.test.ts` mocked `listIntegrationIds`/`getIntegrationDefinition`,
so it asserted the handler faithfully rendered whatever the registry returned — a
test that _cannot_ observe an id-set regression. The regression test that matters is
DB-backed (`summaries.test.ts`): publish under a new-partner id, assert the sync
accessor does **not** know it, then assert the endpoint lists it anyway.

## A GLOBAL config row published by one test file poisons every other file's reads of that integration

_Hit and fixed 2026-07-29 while shipping the floor `factDocs` change. Kept because the shape recurs: any test that publishes a
`GLOBAL` integration config is publishing it for the whole process pool._

`apps/api` test files run in parallel workers against ONE Postgres. Between its
`beforeAll` and `afterAll`, `src/integration-validation/resolve-tenant-config.test.ts`
publishes a **GLOBAL** `demo_partner` config whose mapping is deliberately degenerate
(`{serviceOrderNumber: 'Global.Source'}`, so the winning overlay is observable) and
calls `refreshRegistryOverlay(db)`. Any test in another file that resolves
`demo_partner` in that window gets that overlay — the canonical comes back nearly
empty and the assertion fails with a wall of `structural-contract` issues on fields
the input clearly had.

Reproduce (pre-existing on a clean `main`; ~2/10 for the whole directory, ~5/8 for the
pair):

    npx vitest run src/handlers/integration-validation/map-to-external.test.ts src/integration-validation/resolve-tenant-config.test.ts

Symptom to recognize: `map-to-external.test.ts` / `validate.test.ts` failing with
`expected { external: {}, valid: false } to match object { valid: true }` and
`Invalid input: expected string, received undefined` on `serviceOrderNumber`,
`supplierContactName`, … — i.e. the mapping produced nothing, which no code change to
the facts/floors can cause. Re-running usually goes green, which is exactly why it is
worth writing down: it is **not** the change under test.

It is not a retry candidate: re-running is what hides it. The fix was to give the
writing file an integration id nobody else reads from the DB — it now overlays
`allied_status` (a built-in overlay on the same `shipment_status_update` floor, read
only by `floor-overlay.test.ts`, which mocks Prisma) instead of `demo_partner`. The
pair went 5/8 failing → 0/10, the whole directory 2/10 → 0/6.

The general rule: **a GLOBAL row has no tenant scope**, so a test publishing one is
publishing it for every concurrently-running file. Overlay an integration id whose
runtime behavior no other DB-backed test asserts, and clean up in `afterAll`.

## A summed field name that isn't a column silently writes 0 — and overwrites good data

_Found 2026-08-06 from a user report that "Total Actual Weight" showed 0 on the Trip
screen. Fifth instance of the drifted-field-name class (#569/#570/#571/#575), and the
first where the wrong name caused a **write** rather than a blank cell._

`computeTripSummary` (`apps/api/src/lib/longhaul-cloud-trip-summary.ts`) summed
`total_actual_wt`, counted super-VIPs via `supervip`, and read the state ids off
nested `origin_state`/`destination_state` objects. None of those is a column on
`v_longhaul_shipments_v2`. Each resolved to `undefined`, and `Number(undefined) || 0`
is a perfectly quiet `0`. The results are then **persisted** by `SUMMARY_UPDATE_SQL`,
so every activity save, trip save, and `/trips/:id/summary` call wrote 0/0/null over
correct legacy values. 337 NWI trips (4,289,839 lbs) were zeroed before it was caught.

The real columns (verified against prod `INFORMATION_SCHEMA`):

| read as                 | actually                                                      |
| ----------------------- | ------------------------------------------------------------- |
| `total_actual_wt`       | `weight` (int, ordinal 46 — the pair to `total_est_wt` at 45) |
| `supervip`              | `idc_break` (same as #571)                                    |
| `origin_state.state_id` | `shipper_state` → `v_longhaul_states.geo_code` → `.id`        |

Three things made this survive review for months:

1. **A confident comment asserting the opposite.** The file header claimed the on-prem
   app also computed 0 here and that the port was "faithfully replicating a quirk". It
   was not: prod trip 16575 stores `total_actual_lbs = 7900 = 2480 + 1540 + 3880`, the
   `weight` of its three load shipments. A comment explaining why a value is wrong is
   not evidence that it should be — check it against the database.
2. **A test that pinned the bug.** `expect(s.total_actual_lbs).toBe(0) // absent on the
view` locked in the broken behavior, so the fix looked like a regression.
3. **`Record<string, unknown>` on the row type**, which makes every typo legal — the
   exact reason `@pegasus/longhaul-contracts` exists. The summary path simply never
   adopted it. It does now: `SummaryShipmentRow` extends `LonghaulShipmentViewRow` and
   `sumShipmentField` takes a `LonghaulShipmentViewColumn`, so a bad name is a compile
   error.

Also worth knowing: **`TripMaster.total_actual_lbs` is `bigint`, which the `mssql`
driver returns as a string.** `"0"` is truthy, so the UI's `trip.total_actual_lbs ||
'N/A'` rendered a literal `0` rather than the `N/A` a numeric 0 would have produced.
When a numeric column's fallback behaves oddly in the browser, check whether it is
bigint before assuming the value is wrong.

Repair for already-zeroed rows: `scripts/backfill-trip-summary-actuals.ts` (dry run by
default, `--apply` to write). It only fills columns that are currently empty — a stored
non-empty value always wins — so it is safe to re-run, but the code fix must be
deployed first or the next save re-zeroes the repaired trips.

## The same cold registry overlay bit a second time — outbound `call_external` 404'd 2 runs in 3

_sdk-feedback 0038, filed 2026-08-10 against a **blocking** Weichert delivery failure._
Read "A sync read of a lazily-warmed module cache reports 'no data' as 'no such thing'"
above first — this is that same `registry.ts` overlay, on a different read path, found
eleven weeks later. Fixing the _list_ plane did not fix the _outbound_ plane, and
nothing made that obvious.

The symptom was the confusing part. The same workflow, same input, seconds apart:

```
run 1: 404 Unknown integration 'weichert'
run 2: 404 Unknown integration 'weichert'
run 3: OK http=200
```

…while `get_integration_config('weichert')`, `validate`, and `map_to_external` all
resolved that id perfectly, every time, from both tenants. A 404 that says _the
integration does not exist_ alongside three planes that clearly know it does sends you
to check the config, the publish, the tenant overlay, the id spelling. None of that is
where it lives.

Both outbound handlers gated on the **synchronous** `getIntegrationDefinition`, whose
overlay is warmed only by the four config-mutation handlers (publish / fork / rollback
/ delete). On horizontally-scaled Lambda a publish warms **one** container. Every other
container falls through to the built-in `REGISTRY` — which by definition has no entry
for a config-only integration, since being authorable without a code entry is the whole
point of sdk-feedback 0020. Which container the load balancer picked decided whether
the call worked.

What generalizes:

- **A cache-hit rate that depends on the load balancer looks like flakiness, not like a
  bug.** A retry "fixes" it by landing on a warm container; a dry run exercises the
  capture path and passes; more instances make it worse; every deploy resets it. Every
  one of those signals reads as transient.
- **`loadRegistryOverlayIfStale` existed for exactly this, and its docstring said so —
  and nothing called it.** A TTL mechanism nobody invokes is not a mechanism. If the
  correct use of an accessor is "call this other thing first," the split itself is the
  defect: `getIntegrationDefinition` _looks_ total.
- **Two planes answering the same question differently is the bug, before any symptom
  appears.** validate/map resolved per request against the DB; outbound read process
  memory. Both outbound handlers now use `resolveIntegrationDefinition` too, so the
  planes agree by construction — and the outbound plane picked up TENANT-scoped
  configs, which it had silently ignored all along.

Cost: up to two extra `findFirst`s per outbound call, the same ones `/validate` and
`/map-to-external` have always paid.

Regression guard: `apps/api/src/handlers/integration-outbound-config-only.test.ts`. It
deliberately does **not** mock the registry — the sibling suites do, which is precisely
why they could never have caught this. It asserts `getIntegrationDefinition(id)` is
still `undefined` while the handler resolves the id anyway; that assertion is the exact
expression the old gate used, so it is the proof rather than a proxy for it.

---

## `app.route('/api/v1', …)` twice: a sub-app mount claims the whole prefix's middleware

`app.ts` mounts two routers on the same `/api/v1` prefix — `m2mV1` (dual-auth:
Cognito sessions **plus** `vnd_` vendor keys) first, then `v1` (session-only,
`tenantMiddleware`). Inside `m2mV1`, `pegiiRuntimeHandler` is mounted at `/pegii`
and does `pegiiRuntimeHandler.use('*', dualAuthMiddleware)`.

Hono's `.route()` **merges** the sub-app's routes into the parent router. That `use('*')`
therefore registers as a middleware matching `/api/v1/pegii/*` on the parent — for
every path under the prefix, including ones the sub-app has no handler for. So a new
**session** route added at `/api/v1/pegii/reports/...` would still run the m2m
`dualAuthMiddleware` on its way to the `v1` handler, even though `pegiiRuntimeHandler`
itself never matches it. The route would work, sometimes, with auth semantics nobody
wrote down.

Nothing warns you. There is no shadowing error, no duplicate-route diagnostic; the
request simply picks up a middleware from a router you were not editing.

What generalizes:

- **A path prefix is owned by whichever sub-app mounted it first, middleware included.**
  Before adding a route under an existing prefix, check whether some other router
  already `use('*')`s it — `grep "route('/<prefix>'" apps/api/src/app.ts`.
- **Mirroring an upstream path is not worth inheriting the wrong auth.** The pegII
  reports bridge (`handlers/pegii-reports.ts`) is served at `/api/v1/pegii-reports/...`
  while calling upstream's `/api/v1/pegii/reports/...` verbatim from inside the gateway.
  The one-character difference in the prefix is the whole isolation.
- The same trap applies to `/onprem`, `/settings` and `/integrations`, all of which
  already have more than one router contributing routes.

### The same split, from the caller's side: a `vnd_` key reaches `m2mV1` and nothing else

The consequence nobody writes down until it bites: **an API key can only reach routes mounted
on `m2mV1`.** Everything on `v1` sits behind `tenantMiddleware` and requires a Cognito session,
so a `vnd_` key is rejected there outright. This is a **router split, not a permissions gap** —
no combination of roles widens it, because the request never reaches an authorization check.

Reachable with a key (given the matching Cedar action): `/api/v1/runtime/{customers,quotes,moves,invoices}`,
`/orders`, `/events`, `/event-types`, `/pegii/*`, `/workflows`, `/sms`, `/integration-*`, `/blobs`,
`/feedback-*`. **Not** reachable by any key: everything else on `v1` — notably the whole
Operations → Planning surface (`/api/v1/onprem/longhaul/*`: shipments, trips, drivers, filter
reference data), plus `/reporting`, `/documents` and `/dashboard/pegii`.

Assuming otherwise is an easy and expensive mistake: the AI-assistant Phase 0 plan (#651) budgeted
for an ops admin exploring the planning data with a read-only `reporting` key, which cannot work at
all. **Before promising any surface to a key-authenticated caller, confirm the route is mounted on
`m2mV1`** — `grep -n "m2mV1.route\|m2mV1.get" apps/api/src/app.ts`. If it isn't, the options are
mounting a deliberate `/runtime`-style read mirror (see `handlers/runtime-reads.ts`, which exists
for exactly this reason) or using a Cognito principal instead. Widening a Cedar policy is never
the fix.

**And a `vnd_` key on a route that doesn't exist is told its credentials are bad.** A key that
authenticates on `m2mV1` but matches no handler there falls through to `v1`, whose
`tenantMiddleware` answers `401 "Invalid or unverifiable token"`. So "no such route" and "bad key"
look identical from the client. sdk-feedback 0044 needed a known-good route and an invented one as
controls just to prove a pegII order-write route was missing. `/pegii/*` now ends with a terminal
`.all('*')` 404 after dual auth (`handlers/pegii-runtime.ts`, pinned by
`__tests__/pegii-unmatched-route.test.ts`).

- **The safe fix is one terminal catch-all per m2m sub-router**, and only where no `v1` route
  shares that sub-prefix.
- **Never put a catch-all on `m2mV1` itself.** It shares the `/api/v1` mount, so it would swallow
  every Cognito route.
- **Never teach `tenantMiddleware` to verify API keys.** That puts a key lookup on the session
  plane, the class of change behind #447/#526.
- Other m2m sub-routers still have the old behaviour. If you see the `401` on a valid key, check
  whether the route exists before you debug the key.

## Two predicates on ONE column: Planning's `move_type` filter vs the `Is_Trip_Planning` whitelist

> **Resolved — kept as the worked example behind the rule at the end of this section.**
> The whitelist no longer exists; everything before "#685 removed the whitelist entirely" is
> the history that produced the rule. Line references are deliberately omitted: the code they
> pointed at is gone, and a stale line number is how this bug kept getting misread.

Filtering Operations → Planning by move type **INTERNATIONAL** returned zero shipments —
for every date range, zone and tenant. `move_type` has no column of its own: it filtered
`import_export`, which was also the column the `Is_Trip_Planning` predicate ANDed its
per-client eligibility whitelist onto. Selecting a code outside that whitelist produced an
unsatisfiable conjunction:

```sql
import_export IN ('Z') AND import_export IN ('H','HA','M','A','SS')
```

#615 added `'Z'` to NWI's `importExportTypes` and declined the general fix. **RESOLVED in
#628**: measuring the blast radius settled it. NWI's lookup holds **16** codes and the
whitelist covered **6** — the other **10 were unsatisfiable**, and they carry 27,718 of the
43,614 planning-eligible rows in prod (64%), the largest single bucket being ORIGIN SERVICE
ONLY at 16,507. Widening the whitelist to cover them was therefore off the table: the same
predicate gates the **default unfiltered** list, which would have gone ~15.9k → ~43.6k rows.

#628 therefore made an explicit `move_type` selection **suppress** the whitelist clause
instead of intersecting with it (`moveTypeFiltered`), keeping the whitelist as the _default_
eligibility set.

**That traded one bug for a subtler one, and #685 removed the whitelist entirely.** Suppression
means adding a filter can **ADD** rows: selecting HHG INTRASTATE (`I`) dropped the whitelist and
surfaced ~1,964 shipments the unfiltered board never showed. A filter that widens its own result
is indefensible from the user's side, and no amount of arbitration between the two predicates
fixes it — the root cause is that a system default and a user filter constrained the SAME column.

`Is_Trip_Planning` is now `shipment_status = 'A' AND del_actual IS NULL`, full stop;
`importExportTypes` is deleted from `longhaul-client-config.ts` with no remaining caller. Every
code the dropdown offers is in the default board AND narrowable from it, so the two rules that
were incompatible — "a filter can only narrow" and "every dropdown option returns something" —
both hold. The board grows accordingly: measure before assuming the ±30-day default window still
fits under `SHIPMENT_RESULT_LIMIT` (1000) for a given tenant.

**The generalizable rule:** when a system default and a user filter constrain the same column,
neither ANDing them nor letting one win is correct. Intersecting makes the default silently
unoverridable; overriding makes the filter non-monotonic. Remove one of the two predicates.

**Two system predicates survive** in `buildBaseSql`: `shipment_status = 'A'` and
`del_actual IS NULL`. Nothing user-facing targets either today — the date filters match the two
bounds of the PLANNED spread (`plan_X` + `X_date2`, ShipmentDetail's "Date Spread"), never
`pack_actual`/`load_actual`/`del_actual`. **If you ever add an "Actual Del Date" filter, remove
`del_actual IS NULL` — do not AND with it.** Same for a shipment-status filter. Every other
predicate in the builder is a pure conjunct, so no filter can widen its own result; audited
Sep 2026, and `moveTypeFiltered` was the only suppression flag that ever existed.

**The search box is the one place adding input still WIDENS the result** — and it is not a
filter. `buildBaseSql` is `if (searchTerm.length >= 3) {…} else if (filters) {…}`, so at three
characters every filter AND both eligibility predicates vanish: search returns cancelled and
already-delivered orders with the date window gone. At two characters they all apply. Deliberate
on-prem parity (`findShipmentsWithQuery`), pinned by a test — flagged here because the 2-vs-3
character cliff is invisible and reads exactly like the move-type bug from the user's side.

**Beware the JS post-filters when the base query is capped.** `TripStatus_id` and
`latest_activity` filter in JS after `SELECT TOP (1001) … ORDER BY plan_load ASC`, so on an
over-cap base they only ever see the 1001 EARLIEST-planned-load shipments — a biased slice, not
a random one. Post-filtering then brings the count under 1000, so no `RESULT_LIMIT_EXCEEDED`
fires and `meta.count` undercounts with nothing to indicate it. That is why `sit_dest` was
deliberately written in SQL instead (see its comment); these two can't follow because both
fields are derived per row with no column behind them. Removing the eligibility whitelist grew
the base set ~2.74×, so this is more reachable than it was — a dispatcher who widens the load
window past the cap and then picks a Last Activity gets a silently incomplete list.

Three things make it invisible:

- `Is_Trip_Planning: true` is hardcoded in tenant-web's `DEFAULT_QUERY` and is **not** a
  FilterTab, so a user cannot turn it off to work around the contradiction.
- NWI's Move Types dropdown is built from the `MoveType` lookup with `moveTypesWhere = '1=1'`,
  so it offers **every** code — including ones the whitelist forbids. The dropdown advertises
  filters that cannot match. (QMM's `moveTypesWhere` is restrictive, which is why it needs no
  `'Z'`: the code never reaches a filter.)
- An empty list is indistinguishable from "no matching shipments". Nothing surfaces the clash.
  The #628 shape was worse in this respect: a filter that returns MORE rows looks like working
  software, so it survived from Aug 2026 until a dispatcher noticed the count going the wrong way.

Not a port regression — legacy `shipment.repository.v2.ts:171`/`:214` AND'd the same two
predicates onto the same column, so INTERNATIONAL returned nothing there too.

What generalizes:

- **When two predicates share a column, decide which one is authoritative.** The bug was
  treating a user's explicit choice and a system default as peers to be AND'd. A default is
  what applies _absent_ a preference; an explicit selection _is_ the preference. Intersecting
  them makes the default silently unoverridable.
- **Measure the blast radius before picking the cheap fix.** Per-code whitelisting looked
  reasonable at n=1 and was indefensible at n=10 — but nobody had counted. One `GROUP BY
import_export` against prod turned a judgment call into an obvious one.
- **Test satisfiability, not spelling.** The regression test extracts every
  `import_export IN (...)` clause from the generated SQL, resolves the placeholders back
  through the bound params, and asserts the intersection is non-empty — parameterized over
  all 16 real lookup codes, so it fails for exactly the codes that are broken and is
  indifferent to _how_ the handler avoids the clash. Asserting that a letter appears in a
  list would not have caught this.
- **`import_export` values are inconsistently space-padded.** It is `nvarchar`, and prod holds
  the same logical code both ways — `'M'` on 470 rows and `'M '` on 1,404. MSSQL's `=`/`IN`
  ignore trailing spaces so SQL-side comparisons are unaffected, and nothing trims the value
  on the way out — so any **JS** comparison against it must `.trim()` first. `getMoveType` in
  `ShipmentCard/index.tsx` did not, which silently dropped the badge on the padded majority of
  MILITARY and INTERNATIONAL cards (fixed in #628, which also inverted the check to badge
  everything except the deliberately-unbadged `'H'`, so a code added to the lookup is badged
  automatically rather than rendering blank and reading as Interstate).
- **The move-type option list lives in ONE place: the API.** `filter-options.ts` /
  `reference-data.ts` query the legacy `MoveType` lookup (filtered by the per-client
  `moveTypesWhere`) and `FilterTabs` renders `filterOptions.moveType`. A second, hardcoded
  `MOVETYPE_LIST` in tenant-web was deleted in #631: nothing imported it but its own test, and
  it had drifted into a stale, partial mirror — 5 of the 16 codes, with labels that did not
  match the lookup (`Interstate` vs `HHG INTERSTATE`). Don't reintroduce a client-side copy;
  it cannot stay in sync with a per-tenant lookup table.

## A fixed-run chunker pins column HEIGHT and lets column COUNT drift

The planning filter panel (`FilterTabs`) laid its fields out by slicing `FIELDS`
into fixed runs of `Math.ceil(FIELDS.length / COLUMNS)`. That looks like it
produces `COLUMNS` columns, and it did — at 15 fields, `ceil(15/5) = 3` gives
five chunks of 3. But the run length is what's fixed, not the chunk count: at 16
fields it becomes 4, and `slice`-ing 16 items in runs of 4 yields **four**
chunks. Adding one filter would have silently collapsed the panel from 5 columns
to 4, a layout change nothing in the diff mentions and no test caught.

The fix is to distribute the remainder over the leading columns
(16 → 4/3/3/3/3) so the count is `COLUMNS` by construction. The regression test
asserts the **column count**, not per-column length — the counts are the
invariant, the heights are free to reflow.

Generalize: any `for (i += n) push(slice(i, i + n))` layout helper has this
shape. If the intent is "N columns", compute the chunk count directly; if it is
"N per column", say so and accept that the count varies.

## Adding a permission to a persona passes every branch check, then fails the staging E2E gate

Granting an action in a `.cedar` policy means updating **two** pinned permission lists, and
only one of them is enforced before merge:

- `apps/api/src/lib/authz.test.ts` — unit-level, pins each persona's exact allowed set against
  the cedar-wasm backend. **Runs in branch CI.**
- `apps/e2e/tests/api/authz-smoke.spec.ts` — `SALES_PERMISSIONS` / `VIEWER_PERMISSIONS`, pinned
  against **live AVP**. Its `test.skip` guard needs `E2E_COGNITO_USER_POOL_ID` and a real API,
  so it is **skipped locally and in branch CI** and only executes in the deploy pipeline's
  "E2E gate against staging" job — i.e. _after_ the PR has already merged to `main`.

So a PR can be green through the merge queue and still red the deploy. That is what happened
in #620 (`report:read` added to the viewer baseline and to sales); staging deployed, the gate
failed, and prod was correctly blocked — fixed forward in #623.

**When you touch a `30-personas/*.cedar` or `20-viewer.cedar` action list, grep
`apps/e2e/tests/api/authz-smoke.spec.ts` for the persona in the same change.** The spec's own
header says as much ("update both this constant and the matching `.cedar` policy file"); the
trap is that nothing local fails if you forget.

Two adjacent notes:

- The **test titles carry hand-maintained counts** ("viewer has exactly its N read-only
  permissions"). The viewer title had already drifted (said 10, the list held 11) before this
  change, so don't trust the number in the name — count the constant.
- The deploy pipeline's ordering is doing its job here: staging deploy → E2E gate → prod. A
  failure at the gate leaves **staging ahead of prod**, which is a normal, recoverable state,
  but it does mean prod stays on the previous SHA until the forward-fix lands.

## A prop-dropping test mock makes assertions vacuously pass

`ShipmentDetail/index.test.tsx` mocked the driver-planning router-compat `Link`
as `(props: any) => <a>{props.children}</a>`. That renders the text and throws
away everything else — `className`, `to`, `data-*`. Any assertion about how a
ported `Link` is styled or where it points would have passed no matter what the
component did, which is exactly what the item-1 change in #639 needed to assert.

The mock now spreads the remaining props onto the anchor and maps `to` onto
`href`. **When a test's subject is a prop, check that the mock forwards it**
before trusting a green run — a hand-rolled mock that keeps only `children` is
the common shape, and it fails silently in the safe-looking direction.

Related: a new UI label can break an unrelated test that queries the whole
document. Adding the "SIT-Dest" filter field broke a `FilterTabs` assertion
doing `screen.queryByText(/SIT\s*[—-]/)` — written to prove the Last Activity
options use bare abbreviations, but scoped to the entire render. Prefer
`within(row)` for assertions that are really about one part of a panel.

## Ported longhaul links author _legacy_ paths on purpose

`/trip/:id` appears throughout the ported driver-planning UI and matches no
route in `router.tsx` (the real path is `/driver-planning/trips/:id`). It is not
a bug: `features/driver-planning/utils/router-compat.tsx` exports a `Link` whose
`translatePath` rewrites `/`, `/trip/:id`, `/planning`, `/trips` and
`/shipments` into their `/driver-planning/*` equivalents. "Correcting" one of
these paths to the real route double-prefixes it.

Check the import before judging a suspicious path — a `Link` from
`@/features/driver-planning/utils/router-compat` is the shim, a `Link` from
`@tanstack/react-router` is not.

## A nested single-screen `Stack` renders no iOS back chevron

`apps/mobile/app/trip/[id].tsx` and `app/shipment/[orderNum].tsx` each sat in
their own `_layout.tsx` — a `Stack` holding exactly one screen — mounted under
the root stack as the group screens `trip` and `shipment`. Both layouts set
`headerBackTitle: 'Back'`. Neither ever drew a back button on iOS.

The chevron is **UIKit's**, not React Navigation's. `react-native-screens` only
ever _hides_ it (`navitem.hidesBackButton = config.hideBackButton`,
`ios/RNSScreenStackHeaderConfig.mm:628`); UIKit draws it only when the view
controller is not first in its own `UINavigationController`. A nested stack of
one screen is permanently at index 0, so no header option can produce a button
there. Android papered over it with hardware back, so it read as an iOS-only
bug.

Fix (#653): delete the nested layouts and declare the screens directly on the
parent stack, carrying the header styling across. They become real second
entries of the same native stack and the chevron, the "Back" label and the
left-edge swipe all come for free.

Two traps when flattening:

- **Re-declare the screen inside the same `Stack.Protected` guard.** A screen
  that was auth-guarded only by living inside a guarded group (Settings, in the
  `(drawer)` group) becomes publicly reachable once moved, because Expo Router
  auto-registers any filesystem route left undeclared.
- Don't trust the JS-side `canGoBack`. React Navigation v7 propagates a parent's
  back state through `HeaderBackContext`, so the _JS_ `headerLeft({ canGoBack })`
  sees `true` in a nested stack — while the native header still shows nothing.
  It only tells you what a custom `headerLeft` would receive.

Guarded by `__tests__/app/_layout.test.tsx` → "pushed detail screens keep a
native back button (BACK-01)", which fails if either screen is re-nested or
leaves the authenticated guard.

## Shipment-detail popovers keep their state when you switch shipments

The Actual Weight / Coverage / Dispatch Note popovers live inside
`containers/ShipmentDetail`, which renders its rows from a `fields.map` while a
shipment is selected. Picking a **different** shipment does not remount them:
clicking another row deselects (`useOutsideClick` → `selectShipment(null)`) and
selects the new shipment in the **same React batch**, so the pane never renders
with `selectedShipment === null` and the popover components stay mounted at the
same tree position.

Consequence: any `useState(selectedShipment.…)` in one of those components is
seeded **once**, from whichever shipment happened to be selected at mount, and
silently goes stale. `ShipmentWeight` held the previous order's weight, and
saving from the popover would have written it onto the newly selected order —
the same shape as the trip roll-up that wrote 0 over good data (#593). The
parent already resets its own display state on `[selectedShipment]`, which is
what made the omission in the child easy to miss.

Seed from the store on every identity change (an effect keyed on
`selectedShipment?.order_num`, not on `selectedShipment` itself — that re-runs
on every shadow write and clobbers what the user is typing).

Related, same component: an `<input type="number">` hands back a **string** from
`e.target.value`, so a value round-tripped through state reaches the API as a
string. The shadow schema is `weight: z.number().nullable()` and 400s on it —
which is the schema doing its job; coerce in the client, at save, and map a
cleared field to `null` rather than `Number('') === 0`.

## MSSQL ignores trailing whitespace in comparisons — JS `===` does not

`v_longhaul_states.zone` is inconsistently padded on the prod Dolios SQL Server:
seven states — **MA, MD, ME, NH, NJ, PA, WV** — store `'1 '` (`DATALENGTH` 4)
where every other state stores a bare `'1'` (`DATALENGTH` 2). The Zone dropdown's
values come from a _different_ view, `v_longhaul_zones.zone_code`, which is
always unpadded (`'1'`–`'7'`). The two code spaces otherwise agree exactly.

This is invisible to every SQL-side consumer. ANSI comparison semantics pad the
shorter operand, so `os.zone IN ('1')` matches `'1 '` and the Planning screen's
zone filter — which pushes the predicate into the query — has always been
correct. The **client-side** Availability filter compared the same two columns in
JavaScript, where `'1 ' === '1'` is false and `['1'].includes('1 ')` is false.
Result: selecting **North East** silently dropped every driver whose Ready State
was one of those seven states, while NY/CT/DC/DE/RI/VA/VT (clean `'1'`) stayed.
No error, no empty state — just a short list that looked plausible.

**How to apply:** any legacy-view value compared in JS rather than in SQL must be
normalized (`.trim().toUpperCase()`) on **both** sides of the comparison. The SQL
path working is not evidence the data is clean — it is precisely what hides the
dirt. When porting a filter from a `WHERE` clause to a client-side `useMemo`, the
comparison semantics change underneath you.

To check a suspect column, wrap it so padding is visible — `LEN` trims, so use
`DATALENGTH` or bracket the value:

`SELECT DISTINCT '[' + zone + ']' AS zone, DATALENGTH(zone) AS bytes FROM v_longhaul_states`

Fixed in `AvailabilityViewA.tsx` / `AvailabilityViewB.tsx` (`normalizeRefCode`,
duplicated because the A/B variants deliberately share no base). Both copies are
pinned by mutation-checked tests in `routes/driver-planning.index.test.tsx`.

## Read the triggers before widening a legacy table

`LongDistanceDispatchActivity` carries three ENABLED triggers on NWI (insert /
update / delete; Quality Move Management's copy of the table has **none**). Its
AFTER DELETE trigger copies the deleted row into
`LongDistanceDispatchActivityHistory`, and whether widening the parent is safe
depends entirely on how that copy is written.

**Verified against prod 2026-09-04, for the arrival-window columns:** none of the
three trigger bodies contains a `SELECT *`; the only INSERT is the delete
trigger's, and it names all 25 columns explicitly on both sides; the insert and
update triggers only `UPDATE sales SET <named columns>`. So adding nullable
columns to the parent is safe, and only the parent is widened.

**This was close to being a live prod break.** The history table is exactly the
shape that a positional insert would have destroyed: 26 columns to the parent's
24, with trailing audit columns `date_created` / `created_by`. Under
`INSERT INTO …History SELECT *, GETDATE() FROM deleted`, appending three
`varchar(5)` columns to the parent would have shifted `'08:00'` into a `datetime`
and failed **every activity delete** — and so every trip save that drops an
activity — with an error pointing nowhere near the column you added.

So: re-read the triggers before adding any column to this table. An explicit
column list today is not a promise about tomorrow; the legacy VB app owns them.

```
SELECT OBJECT_NAME(parent_id) AS tbl, name, is_disabled, OBJECT_DEFINITION(object_id) AS body FROM sys.triggers WHERE parent_id = OBJECT_ID('LongDistanceDispatchActivity')
```

Two consequences worth knowing. The history table is **delete-only** — there is no
update history, so a bad UPDATE here is unrecoverable from the database itself.
And because the delete trigger names its columns, a deleted activity's arrival
window is **not** preserved in history; closing that gap would mean editing a live
trigger that also writes to `sales`, which was judged riskier than the gap.

## An ALTER and a reference to what it adds cannot share a batch

SQL Server binds column references at **parse** time, so a batch that runs
`ALTER TABLE … ADD col` and then names `col` raises `Invalid column name` on exactly the
tenants the ALTER was written for — the ones that don't have the column yet. The ALTER must
be its own `executeSql` call so it commits before the next statement is parsed.

This is why `ensureArrivalWindowColumns` is awaited separately in both
`activities-write.ts` and `trip-save.ts` rather than being prefixed onto their SQL, and why
`CONFIRMED_SQL` in `driver-planning.ts` carries the same warning. Unit tests assert on SQL
strings and cannot catch a violation of this; the QA round-trip in
`apps/e2e/tests/api/longhaul-qa.spec.ts` is what actually exercises the provisioning path
against a real server.

## A security override outlives its cause, and Dependabot is what tells you

`overrides.protobufjs` was added in `b55299e8` to clear four high protobufjs
advisories: `@temporalio/proto@1.17.2` pinned `protobufjs@7.5.5` with **exact**
version syntax, which npm's `overrides` cannot reach through, so the consumer was
pinned back to `@temporalio/client@1.16.2` and a tree-wide `>=7.6.3 <8` floor was
forced. That commit left an explicit drop-back note: revert once
`@temporalio/proto` relaxes its protobufjs pin.

It did — `@temporalio/common@1.23.0` moved to `protobufjs: ^8.7.1`, the patched
major. But nobody was watching for it. What surfaced the change was a Dependabot
group bump (#665) failing with `Cannot find module 'protobufjs/ext/protojson'`:
the `<8` ceiling held temporal 1.23 down on protobufjs 7.6.3, which has only
`ext/debug` and `ext/descriptor`. Thirteen API test files failed to import. The
error names a missing _file_, which reads like a broken package — the actual
cause was our own override, two majors away in `package.json`.

It was not only the tests. The same CI log carries an esbuild line —
`Could not resolve "protobufjs/ext/protojson"` — from `packages/infra`'s
`NodejsFunction` bundling step. The **API Lambda bundle itself** was broken by our
override, which is the #594 failure mode (an unresolvable import that synth and
deploy will happily carry to production and that only shows up as an INIT crash).
It went unnoticed because the CI job that would have caught it never finished:
`@pegasus/api#test` failed first, turbo cancelled the rest, and
`@pegasus/infra#test` was killed mid-run. The rendered line at the cut —
`api-stack.bundle.test.ts (4 tests | 4 skipped)` — is vitest's in-progress
output, not a verdict. An earlier version of this entry blamed turbo's task
graph. That was wrong: `packages/infra/turbo.json` has declared
`test.dependsOn: ['@pegasus/domain#build']` since `7778372f`, and
`turbo run test --dry=json` confirms it resolves. Do not read a cancelled task's
partial output as a result — check for the `Test Files` summary line before
concluding anything about what a suite did.

**How to apply:** when an override's comment says "remove once X ships Y", that
sentence is the only monitor that exists — nothing checks it. A dependency PR
failing with a missing deep-subpath require is the signature: check our
`overrides` block for a ceiling on that package _before_ investigating upstream.
Removing the override alone does nothing (npm keeps the already-locked version);
run `npm update <pkg> --package-lock-only`, the same tool the `fast-uri` note
calls for. Verify the split landed with `npm ls <pkg>` — here, 7.6.3 at root for
`@grpc/proto-loader`, 8.8.0 nested under temporal — then run the real gate,
`npx audit-ci --config ./audit-ci.jsonc`, since clearing advisories was the whole
point of the override.

## A dependency bump can lower measured coverage — rebase before touching the ratchet

`apps/api/vitest.config.ts` sets `thresholds.autoUpdate: true`, which **only ever
raises** a floor. #665 bumped 57 packages, changed zero source lines, passed
every test — and measured `lines` at 92.18% against the 92.19% floor #651 had
ratcheted to. v8 attributes coverage against the code that actually runs, so a
library taking one fewer branch through our own error paths moves the aggregate
by a hundredth. The gate fails, and `autoUpdate` cannot repair it: it only writes
the floor after a run _passes_.

The instinct is to hand-lower the floor by the measured hundredth. Don't do that
first. #665 sat behind main long enough that #668 landed, and rebasing onto it
brought in well-covered new code that raised the real number to 92.28 — exactly
meeting the floors #668 had itself ratcheted to. The dip was absorbed and no
floor change shipped. Hand-lowering it earlier would have committed a spurious
downward ratchet that the next PR would have had to notice and undo.

**How to apply:** on a dependency-only PR with a sub-0.1% floor miss and every
test green, rebase onto current `main` and re-measure before editing thresholds.
Only lower by hand if the miss survives that, and then by exactly the measured
value with the reason in the commit. Do not chase a per-file diff against main
for the **api** suite: a local main run is not a valid baseline there (its
`node_modules` reflects whatever was last installed, and the DB-backed suites
skip rather than fail without a container up), so the trustworthy comparison is
CI's own last green Test job. A local run _is_ fair for a package with no
external dependencies — `packages/infra` is the example.

## `aws-cdk-lib` 2.267 synthesizes ~2.5x slower — and it flakes local pre-push, not CI

The #665 group bump moved `aws-cdk-lib` 2.261 -> 2.267 and `constructs`
10.4.2 -> 10.8.1. Four `packages/infra` files then failed the husky pre-push hook
with `Test timed out in 5000ms`, always on the first test in a file — the one
that triggers `synth()`. One `apps/tenant-web` `userEvent` test failed the same
way. **The identical commit passed both suites on CI**, where only `apps/api`
failed. Do not read a local pre-push timeout as a CI failure; check the CI job
before writing the bump up as a breakage.

Synth really is slower. Measured serially (one file, one worker, no contention),
`wireguard-stack.test.ts`:

|                | first synth | later assertions | file total |
| -------------- | ----------- | ---------------- | ---------- |
| 2.261 / 10.4.2 | 221ms       | 45-58ms          | 1.86s      |
| 2.267 / 10.8.1 | 930ms       | 117-154ms        | 4.89s      |

Roughly 2.5x across the board, 4.2x on the first call in a process. But that
alone does not blow a 5s budget — CI's own per-test times on the bumped version
run 600-1059ms and pass. What breaks locally is contention: `turbo test` starts
15 package tasks at once and `packages/infra` uses `pool: 'forks'`, so a 12-core
dev box is oversubscribed several times over. The full-suite figure (32s -> 124s
of summed test time) is mostly that, not the library.

**How to apply:** read wall time _and_ summed test time. Summed-over-wall is
effective parallelism — if that ratio moved, part of the slowdown is worker
contention, and the discriminating experiment is running one file alone. Here it
was both, in that order of importance. The fix is `testTimeout` (these tests
assert template shape and DOM behavior, never latency), not shrinking the pool
and not hoisting synth into `beforeAll`.

Worth knowing for the deploy path: `cdk synth` and `cdk diff` in `deploy.yml` pay
the same 2.5x. Seconds, not minutes, so not a blocker — but if the pre-deploy
gate ever starts brushing its timeout, this is why.

## A guard that skips itself reports green exactly when it is least sure

`api-stack.bundle.test.ts` is the only test that catches an unresolvable import
reaching the deployed API bundle — the #594 failure mode, where synth and deploy
both stay green and the breakage surfaces as a Lambda INIT crash in production.
It used to open with `describe.skipIf` on whether `packages/domain/dist/index.js`
existed, because esbuild cannot resolve `@pegasus/domain` without it and the
resulting error is unhelpful.

That is the wrong shape for a guard. The precondition being absent does not mean
"nothing to check here" — it means "I cannot check, and I have no idea whether
the thing I protect against is happening." Reporting that as a skip puts it in
the one bucket nobody reads: a failing test gets investigated, a flaky test gets
investigated, a skipped test is invisible. The suite that would have caught a
genuinely broken production bundle was one `fs.existsSync` away from never
telling anyone.

It now throws with the fix command instead. `turbo run test` satisfies the
precondition through `test.dependsOn: ['@pegasus/domain#build']` in
`packages/infra/turbo.json`, so the throw only fires when `packages/infra`'s
vitest is invoked directly on an unbuilt tree — and then it says so.
`PEGASUS_SKIP_BUNDLE_TESTS=1` remains the single deliberate opt-out, for watch
mode.

**How to apply:** when a test guards a failure mode that ships silently, an
unmet precondition is a failure, not a skip. Reserve `skipIf` for "this genuinely
does not apply here" (wrong platform, feature flag off) and for an explicit
human opt-out — never for "the environment isn't set up," which is precisely
when you want to be told. The same reasoning applies to any check gated on a
built artifact, a running container, or a credential being present.

## An invited user has 7 days, then the tenant admin has no lever at all

Cognito temporary passwords expire after `tempPasswordValidity`, set to 7 days in
`packages/infra/lib/stacks/cognito-stack.ts` (also Cognito's own default). A
tenant invite is an `AdminCreateUser`, so the invitee sits in Cognito
`FORCE_CHANGE_PASSWORD` / `TenantUser.status = PENDING` until first login flips
them to ACTIVE in `cognito/pre-token.ts`. Past day 7 they cannot sign in.

The non-obvious part is that the admin's two apparent remedies were both closed,
each for a locally-reasonable reason:

- `POST /users/invite` 409s — `repo.findByEmail` finds the PENDING TenantUser row.
- `POST /users/:id/reset-password` 422s — it is ACTIVE-only, and the code comment
  said PENDING users "re-resolve through the invite / first-login set-password
  path". That path did not exist.

So the UI rendered no button that did anything. `POST /users/:id/resend-invite`
(`handlers/users.ts` → `resendCognitoInvite` in `handlers/admin/cognito.ts`) is
the way out: `AdminCreateUser` with `MessageAction: 'RESEND'` regenerates the
temporary password and restarts the window.

**Three things that bite when touching that helper:**

1. `MessageAction` is one enum value. `RESEND` cannot be combined with the
   `SUPPRESS` that keeps invite email out of local dev, so the resend path
   short-circuits on `NODE_ENV !== 'production'` instead. Every deployed
   environment including QA sets `NODE_ENV=production` (`api-stack.ts`), so that
   only affects a dev box and vitest.
2. `ClientMetadata` must be re-sent on the RESEND call. Without it
   `cognito/custom-message.ts` passes the event straight through and the invitee
   gets Cognito's stock template — no tenant name, no login link.
3. Branch on `AdminGetUser`'s `UserStatus`, not on exception names — and treat
   `FORCE_CHANGE_PASSWORD` as the **only** state that may be mutated. See below;
   this one is a security boundary, not a style choice.

### The branch that must not exist: `CONFIRMED` → `AdminResetUserPassword`

The first revision of `resendCognitoInvite` mapped `CONFIRMED` to
`AdminResetUserPassword`, reasoning "they set a password but pre-token never
flipped them to ACTIVE." That state cannot occur — `pre-token.ts` flips
PENDING → ACTIVE on _any_ successful login — so the branch's only real-world
population was **active users of some other tenant**, and it was directly
exploitable:

1. `POST /users/invite` accepts an arbitrary email and swallows Cognito's
   `UsernameExistsException`, so any tenant admin can mint a PENDING TenantUser
   row in their _own_ tenant for someone else's address.
2. Resend on that row → `AdminGetUser` → `CONFIRMED` → `AdminResetUserPassword`
   → the victim's password is invalidated pool-wide and their account goes to
   `RESET_REQUIRED`, locking them out of the tenant they actually belong to.

This is the exact failure the `users.ts` header warns about, arrived at from a
new direction: the header forbids `Admin*User` calls on deactivate/reactivate,
and this route was the first to accept a PENDING row and turn it into one.

**The rule that generalizes:** a PENDING TenantUser row proves nothing about who
an email belongs to, because the caller can create one for free. Any tenant route
that reaches the shared pool needs a fact the caller cannot forge. Two are used
here, independently: a cross-tenant roster check (`db.tenantUser.findFirst` with
`tenantId: { not: … }, status: 'ACTIVE'` — `TenantUser` is deliberately **not**
in `TENANT_SCOPED_MODELS`, so that query works from a tenant-scoped client), and
refusing every Cognito state except `FORCE_CHANGE_PASSWORD`, which by definition
means the identity has never completed a login anywhere on the platform.

Residual, accepted: two tenants can each have an outstanding invite for the same
never-logged-in address, and a resend by one invalidates the other's temporary
password. The person still receives a working password by email and pre-token
resolves their tenant at login, so the impact is onboarding churn, not lockout.

**Still open** (deliberately out of scope of that PR, each its own change):
`login.tsx` maps both `NotAuthorizedException` and `InvalidParameterException`
from `ForgotPassword` to "This account signs in through your organization's
identity provider" — so an expired invitee who tries "Forgot password?" is told
they are an SSO account. The platform-admin surface
(`handlers/admin/tenant-users.ts`) has neither reset nor resend. And
`tempPasswordValidity` could be widened (max 365 days) to lower incidence.

## `ClientMetadata` is trustworthy on one CustomMessage source and forgeable on another

`cognito/custom-message.ts` rewrites two of Cognito's stock emails, and the two
sources have opposite trust:

- `CustomMessage_AdminCreateUser` fires from `AdminCreateUser`, an IAM-gated
  admin API whose only callers are ours. Its metadata (`tenantName`, `intent`, …)
  is safe to render.
- `CustomMessage_ForgotPassword` fires from `ForgotPassword`, a **public,
  unauthenticated** Cognito API **that also accepts `ClientMetadata`**. Anyone can
  invoke it for any address with a payload of their choosing.

So anything the trigger renders from metadata on the ForgotPassword source is
attacker-authored prose leaving our own domain, over our own DKIM:

```
tenantName: "Your account is compromised - call 555-0100 to restore it"
```

`escapeHtml` is no defense — the payload is text, not markup. The reset branch
therefore reads **no metadata at all**: fixed copy, link from SSM, and the only
per-recipient value is the address Cognito is already mailing
(`request.userAttributes.email`). `custom-message.test.ts` carries a test named
`SECURITY: renders nothing from clientMetadata …` that fails the moment someone
wires `tenantName` in there. It has been mutation-checked — it does fail when the
guard is removed.

**Corollary for the admin-initiated reset:** there is no
`CustomMessage_AdminResetUserPassword` trigger source (check the enum in
`@types/aws-lambda`). `AdminResetUserPassword` — what
`POST /users/:id/reset-password` calls — arrives as `CustomMessage_ForgotPassword`,
indistinguishable from a self-service reset. You cannot say who started it, and
you cannot offer the usual "your current password still works" reassurance,
because for the admin-initiated half it is false.

### `AdminResetUserPassword` kills the old password immediately

It moves the account to `RESET_REQUIRED` the moment it is called, so the user is
locked out until they complete the reset — it does not wait for them to finish.
The tenant-web reset dialog used to promise the opposite ("Their current password
keeps working until they complete the reset"). If you are writing copy anywhere
near this flow, that is the fact to write against.

### Cognito's ForgotPassword refusal does not tell you why

It refuses with `NotAuthorizedException` or `InvalidParameterException` for a
federated account **and** for one still on an unredeemed invitation, with no way
to tell them apart. The login page used to map both codes to "signs in through
your organization's identity provider", which told every invitee whose 7-day
temporary password had expired that they were an SSO user.

Do not guess from the exception code, and do not ask the API: `resolve-tenants` is
public and unauthenticated, so per-account Cognito state there would make it a
user-enumeration oracle. `auth/forgot-password-message.ts` narrows using only what
that endpoint already returns publicly — whether any tenant behind the address has
an SSO provider configured. No providers anywhere ⇒ the federated explanation is
impossible, so speak plainly about the invitation; otherwise say both. A hedge
that is true beats a specific claim that is false.

## SSO sign-in re-cases the Cognito email — never address a Cognito user by email

Every invite lowercases the email (#245), yet on 2026-09-15 prod held 5 of 30 users
with mixed-case emails (`TimStrey@…`, `SPobuta@…`), all of them SSO-linked and all
`email_verified=false`. The invite code was never the source. `handlers/sso.ts`
creates each IdP with `AttributeMapping: { email: 'email' }`. Once pre-sign-up links
a federated identity to the native user, Cognito copies the IdP-asserted email onto
that **native** user on **every** federated sign-in, in whatever case Entra stores
it, and resets `email_verified` to false.

The pool predates `UsernameConfiguration` (case-sensitive sign-in, immutable per
pool), so any `Username: <lowercase email>` call then misses the user:

- `AdminResetUserPassword` → UserNotFound. The helper swallowed that "fail-open" and
  the route answered 200, so "Reset password" silently did nothing.
- `AdminCreateUser` does **not** raise UsernameExistsException. It mints a second
  native user. The next SSO login then hits pre-sign-up's "multiple native users share
  this email" anomaly and creates a stray unlinked `EXTERNAL_PROVIDER` user as well.

`ListUsers` with `Filter: email = "…"` **is** case-insensitive (checked in prod:
`spobuta@…` returned `SPobuta@…`). So `handlers/admin/cognito.ts` looks users up via
`findCognitoUsersByEmail` and makes every Admin* call with the returned UUID
`Username`.

Hand-repairing the attribute does not stick, because the next SSO login re-cases
it. Removing the email mapping is not an option either: pre-sign-up linking and the
pre-token email guard both need it. Before an admin password reset,
`resetCognitoUserPassword` restores the lowercase, verified email, because Cognito
only mails a verified address.

Read-only check for drift (profile `dolas-pegasus-prod-ro`): `aws cognito-idp
list-users --user-pool-id us-east-1_gg63uAxs0`, then look for uppercase in the
`email` attribute or two users whose emails match when lowercased.

## A longhaul client tag has to match the tenant's lookup DATA

`Tenant.longhaulClient` selects hardcoded SQL fragments (`moveTypesWhere`,
`dispatcherQuery` in `lib/longhaul-client-config.ts`) that are written against one
customer's lookup rows. Tag a tenant with a client whose fragments don't fit its data and
nothing errors. The Planning filters just come back empty, which looks like "no data".

Reliable Van and Storage was tagged `qmm`. QMM's `move_type in ('C','S','N','M','U')` matched
none of RVS's numeric MoveType codes (`0`–`18`), so Move Types was blank. QMM's
`roles like '%cpd%'` matched only two inactive RVS users, so Dispatchers was blank too. The fix
was a third client, `rvs` (`'1=1'` / `roles like '%LO%'`).

When onboarding a longhaul tenant, before choosing its client, query the tenant DB for
`SELECT move_type, move_type_desc FROM MoveType` and for `roles`/`active`/`title` in
`v_longhaul_salesman`. Then run each candidate fragment and confirm it returns rows. A
tenant running a given desktop build tells you nothing about which fragments fit its data.

## A hub that can't boot wedges the stack, and a wedged stack blocks every deploy

On 2026-09-15 four Deploy runs in a row failed at `Deploy to staging / CDK deploy`, so
nothing shipped for three days. The error CDK printed named no cause worth acting on:

`Stack:...pegasus-staging-wireguard... is in UPDATE_ROLLBACK_FAILED state and can not be updated.`

The stack got there during #692's deploy. The hub ASG rolled a new instance, which sent
`cfn-signal` FAILURE ~47s in ("Received 1 FAILURE signal(s) out of 1. Unable to satisfy 100%
MinSuccessfulInstancesPercent"). CloudFormation rolled back, the rollback launched its own
instance, that one failed identically — and a rollback that fails leaves
`UPDATE_ROLLBACK_FAILED`, which refuses all further updates.

**The real cause is only in the instance's console output**, not in CloudFormation, CDK, or
CloudTrail. The surviving instance showed `dnf invoked oom-killer` at t+29.9s,
`Out of memory: Killed process (dnf)`, then `+ exitCode=137`. The hub is a `t4g.nano`
(0.5 GB) and `dnf update -y` was the first thing user-data ran. dnf's metadata footprint
had grown past what that instance can hold. Fixed by creating a 1 GB swapfile as the first
user-data command (`wireguard-stack.ts`), pinned by an ordering assertion in
`wireguard-stack.test.ts`.

Two things worth keeping:

- **Blame the dependency bump last.** #692 (aws-cdk-lib 2.267→2.268) looked like the
  culprit purely from timing. The rollback instance ran the OLD launch template and died
  the same way, which rules the bump out in one observation.
- **Read the console, then decide.** `aws ec2 get-console-output --instance-id <id> --latest`
  on the instance the ASG left running. Re-running `continue-update-rollback` before
  understanding why the instance fails just re-wedges the stack on the next deploy. To
  unstick it once the cause is fixed:
  `aws cloudformation continue-update-rollback --stack-name pegasus-staging-wireguard --resources-to-skip HubAsgASG26763D76`

Prod runs the same hub at the same size, so an unfixed boot failure is dormant there and
surfaces at the next hub replacement, taking the on-prem tunnel with it.

## `importorskip` turns a renamed module into a green build

Dependabot #691 widened the SDK's `mcp` pin from `>=1,<2` to `>=1,<3`. All twelve
checks passed. The bump is a hard break: mcp 2.x **removed** `mcp.server.fastmcp`
(`FastMCP` was renamed `MCPServer`), and `cli/mcp_server.py` imports exactly that.

Three independent masks had to line up, and each is worth recognizing on its own:

- The import is **lazy** — it lives inside `mcp_command()`, so nothing fails at
  import or collection time. Only actually running the command reaches it.
- It was wrapped in `except ImportError` → a message left over from when `mcp`
  was an optional extra. That message told the user to
  `pip install --upgrade pegasus-workflows-sdk`, which re-resolves to the same
  incompatible major and fails identically — a closed loop.
- Every test that builds a server opened with
  `pytest.importorskip("mcp.server.fastmcp", reason="mcp extra not installed")`.
  **`importorskip` cannot tell a renamed module from an uninstalled one**, so the
  four tests that would have failed quietly skipped instead.

Measured against the PR's own constraint: mcp 1.30.0 → `30 passed`; mcp 2.2.0 →
`26 passed, 4 skipped`. Green both times. CI installs via
`pip install -e 'packages/workflows-sdk-python[dev]'` and **never reads
`uv.lock`** (still pinned at 1.28.1), so CI genuinely resolved 2.2.0 — the
lockfile was not protecting anything.

Fixed by hard-importing at the four test sites, adding a test that asserts the
module is importable, and splitting the runtime message so an _incompatible_ mcp
names its version and the recovering pin instead of advising a reinstall. With
that, mcp 2.2.0 gives `5 failed` — the signal that was missing.

**How to apply:** `importorskip` is only correct for a genuinely optional
dependency. For a **base** dependency, import it plainly — the whole point is
that it fails. And when a version constraint is widened across a major, the
question is never "did CI pass" but "did CI actually resolve the new major, and
would anything have failed if it did?" Check what pip installed, not what the
lockfile says. Same family as _A guard that skips itself reports green exactly
when it is least sure_ above.

## A Dependabot lockfile is generated by Dependabot's npm, not this repo's

`package.json` declares `packageManager: npm@10.8.2`, and the root `overrides`
pin `jest-runtime` to exactly `30.3.0` (react-native's jest preset hoists a 29.x
`jest-mock` to the root; jest-runtime 30.4+ calls `clearMocksOnScope()` on it and
takes out all 20 mobile suites). Dependabot resolves with its own npm rather than
the one `packageManager` names — that is the observed outcome; the mechanism is
inferred.

So every Dependabot PR that bumps `jest` lands a lockfile the repo's own npm
rejects. CI fails in 15–44s across Lint, Typecheck, Test and E2E with:

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json ... are in sync.
npm error Invalid: lock file's jest-runtime@30.3.0 does not satisfy jest-runtime@30.5.1
```

This is not a real test failure and not a bad bump — the four fast failures are
all the same failed `npm ci`. Regenerating with the pinned npm fixes it, because
npm@10.8.2 nests `jest-runtime@30.3.0` with its own 30.3.0 subtree next to
`jest@30.5.1`:

```
npx -y npm@10.8.2 install --package-lock-only
npx -y npm@10.8.2 ci --dry-run
```

Gate on `ci`, not `install` — `ci`'s sync check is the one that fails in CI.

**That gate is necessary but not sufficient**, and a second defect hides behind the
first. With the install fixed, `Test` still failed:

```
CommandError: "jest" is added as a dependency in your project's package.json
but it doesn't seem to be installed.
```

The bump moved `apps/mobile`'s range to `^30.5.1`, but the lockfile kept a
98-entry `jest@30.5.0` subtree nested under `apps/mobile/node_modules` from when
the range was `^30.5.0`. Nested entries physically shadow the root, so
apps/mobile resolved 30.5.0 against its own `^30.5.1` and expo reported jest
missing. `npm ci --dry-run` passed the whole time: being internally consistent
and not shadowing a workspace's own declared range are different properties, and
`ci` only checks the first.

So after regenerating, also look for stale `<workspace>/node_modules/<pkg>`
entries whose version no longer satisfies that workspace's `package.json` range,
delete them, re-resolve, and then **run the affected suite for real**
(`npm ci && npm test -w apps/mobile`). A dry-run cannot see this class of break.

**How to apply:** when a Dependabot PR fails fast and identically across
unrelated jobs, read the install step before the test output. And expect this on
_every_ future `jest` bump until the `jest-runtime` pin is lifted — the exit
condition is react-native shipping a jest-30 preset, or coordinated overrides for
`jest-environment-node` / `@jest/environment` / `@jest/fake-timers` / `jest-mock`
(see `plans/todo/2026-05-09T0315-back-out-transitive-dep-workarounds.md`).

## `testTimeout` does not cover `beforeAll` — raise `hookTimeout` too

#674 raised `packages/infra`'s `testTimeout` to 30s with a careful rationale: a
full-stack CDK synth is CPU-bound, `aws-cdk-lib` 2.267 synthesizes ~2.5x slower
than 2.261, and `pool: 'forks'` fanning out under a parallel `turbo run test`
pushes it past the default. All true — and it fixed nothing for two suites,
because `testTimeout` governs **test bodies only**.

`cognito-stack.test.ts` and `api-stack.bundle.test.ts` synth **once** in a
`beforeAll` and share the template — a deliberate optimization, since synthesizing
per-test would be far slower. That hook is governed by `hookTimeout`, which was
still on vitest's 10s default. So the expensive path was the one left unprotected:

```
FAIL lib/stacks/__tests__/cognito-stack.test.ts
Error: Hook timed out in 10000ms.
```

It only fires when the machine is busy. In isolation the suite passes all 378
tests, so it looks like a flake or someone else's regression. It is neither — it is
a budget that was never set. Because husky's pre-push runs
`turbo run typecheck test --affected`, it surfaces as a failed **push** on a branch
that has nothing to do with infra, which is how it ends up costing a session
several attempts and a `--no-verify`.

**How to apply:** when you raise `testTimeout` for something slow, check whether
the slow thing actually runs in a test body. Setup that is hoisted into
`beforeAll`/`beforeEach` — precisely the expensive work people hoist _because_ it
is expensive — needs `hookTimeout`, and the two default independently. A green
suite in isolation plus a failure under parallel load is the signature of a
timeout, not a race.

## Running the api tests rewrites the coverage floors, and can block your own push

`apps/api/vitest.config.ts` sets `thresholds.autoUpdate: true`. That is normally
described as a ratchet against _other_ people's regressions, but it fires on every
local run too: finishing the api suite rewrites the file with whatever this run
measured. Observed in one session — 92.37→92.39 lines, 80.26→80.29 branches,
89.06→89.14 functions, 91.11→91.14 statements.

Coverage varies slightly run to run, so the **next** run measures fractionally
lower and fails against the bar the previous run just set. Since husky's pre-push
runs `turbo run typecheck test --affected`, that lands as:

```
Failed:    @pegasus/api#test
husky - pre-push script failed (code 1)
```

on a branch whose change has nothing to do with coverage — during the #694
lockfile work it blocked a push on a commit that touched only `package-lock.json`.

The tell is `git status` showing `M apps/api/vitest.config.ts` after a test run you
did not intend to change anything with.

**How to apply:** `git checkout -- apps/api/vitest.config.ts`, then push again.
Never commit that file as a side effect of a local test run — a floor raised by
run-to-run noise is exactly what gets a PR ejected from the merge queue later
(see _A dependency bump can lower measured coverage_ above). Check `git status`
after any local api test run, the same way you would after a codegen step.

## A merge-queue entry that is stuck looks exactly like one that is waiting

The `merge-queue-main` ruleset sets `min_entries_to_merge_wait_minutes: 5`, so a
lone PR legitimately sits at position 1 in `AWAITING_CHECKS` for ~5 minutes before
the queue starts building it. Past that, waiting and stalled are visually identical
in `gh pr view` — both read `CLEAN`, both show `autoMergeRequest: false`.

**`autoMergeRequest: null` does not mean auto-merge failed.** It reads null on a PR that is
queued and merging — auto-merge converts into a queue entry and clears the field. Confirmed on
#779 and #762 (2026-10-03/04). The cheapest check is one command: re-run `gh pr merge <N> --auto`
and read its stdout — `! Pull request #N is already queued to merge` is authoritative, and
re-running is idempotent. Note `gh pr view --json isInMergeQueue` is **not a valid field** (it
errors listing the valid ones), so queue state comes only from the GraphQL `mergeQueueEntry`
below.

**That check only rules out "never enqueued" — it does NOT say the queue will build it.** #762
was enqueued and still stalled: 18 minutes at position 1 with no `merge_group` run, while a PR
enqueued _later_ at position 2 had already passed its own group run. Always finish with the run
hunt below.

The next discriminator is whether a `merge_group` run exists **for that PR number**:

```
gh api "repos/DolasDev/pegasus/actions/runs?event=merge_group&per_page=10" \
  --jq '.workflow_runs[] | "\(.id) \(.status)/\(.conclusion // "-") \(.head_branch)"'
```

Look for `gh-readonly-queue/main/pr-<N>-<sha>`. **Position 1 + `AWAITING_CHECKS` +
no run for that PR = stalled**, not waiting. #694 sat 18 minutes with none.

`gh pr merge <N> --disable-auto` does **not** dequeue. Use the GraphQL mutation
with the PR's _node_ id (not its number), then re-enqueue:

```
gh api graphql -f query='{repository(owner:"DolasDev",name:"pegasus"){mergeQueue(branch:"main"){entries(first:10){nodes{position state enqueuedAt pullRequest{number id}}}}}}'
gh api graphql -f query='mutation($pr:ID!){dequeuePullRequest(input:{id:$pr}){mergeQueueEntry{id state}}}' -f pr='<PR node id>'
gh pr merge <N> --auto
```

**How to apply:** capture the before/after gap rather than assuming the dequeue was
warranted — on #694 the re-enqueue produced its `merge_group` run in **12 seconds**
against 18 minutes of nothing, which is what made the stall diagnosis defensible
instead of superstitious. If a re-enqueue also produces no run, the problem is not
the entry.

**Third reproduction, #762 on 2026-10-04**, with the same shape: enqueued 23:57:16 by the
auto-merge workflow's `GITHUB_TOKEN`, 18 minutes at position 1 `AWAITING_CHECKS` and **zero**
`merge_group` runs for `pr-762`; dequeue + `gh pr merge 762 --auto` under a human token produced
the run in **~28 seconds** and it merged. A `GITHUB_TOKEN`-initiated enqueue gets a queue entry
but no `merge_group` checks — which is the `DEPENDABOT_AUTOMERGE_PAT` gap, not a queue bug.

## "Something went wrong" is a RENDER crash, and it used to leave no trace at all

`apps/tenant-web/src/components/ErrorBoundary.tsx` shows "Something went wrong — An
unexpected error occurred, please refresh the page or contact support". It is a React
error boundary, so it catches **render exceptions only**. The QueryClient in `main.tsx`
does not set `throwOnError`, so a failed API call never reaches it — a 500 or a 403
surfaces as an in-page error state, not this screen.

So when a user reports this message, **do not go looking for a matching 5xx in
CloudWatch**. Two hours were spent that way on 2026-09-17 (chasing tunnel 500s and
business-rule 403s on the Operations screens) before the message was read carefully. The
boundary wraps the whole app in `routes/__root.tsx`, so the entire page is replaced.

Until #700 the boundary only called `console.error`, which meant this class of failure was
**invisible server-side by construction**. It now also POSTs to `/api/v1/client-errors`
(`lib/report-client-error.ts`), which logs one `client.error` line:

```
fields @timestamp, clientMessage, url, componentStack, userId, tenantId
  | filter message = 'client.error'
  | sort @timestamp desc
```

`request.completed` now carries `userId` / `tenantId` / `sub` too, so a user's own failures
can be separated from every other tenant's — previously impossible, which is why "is this
403 even his?" had no answer.

Two things the reporter must keep doing, both load-bearing: it never throws (it runs FROM
the boundary — a throwing reporter re-enters it and loops), and it drops repeats of the
same message inside 10s (a render loop fires the same error hundreds of times a second).

**Still not captured:** a crash on `/login`, which happens before there is a token to
authenticate the report with. Widening the endpoint to unauthenticated would hand the
internet a way to write arbitrary strings into our logs.

**First thing to try when someone reports it:** a hard refresh. The CDN maps 404→200→
`index.html` (`frontend-stack.ts`), so after a deploy a stale tab requesting a since-removed
chunk gets HTML where JS was expected, the dynamic import throws, and the page crashes
exactly like this. The `client.error` stack now names the chunk, which is how you tell that
case apart from a real bug.

## A green deploy that skips prod: `[[ … ]] && …` as a block's last command

`_deploy.yml`'s "Summarize outputs" step ended with:

```bash
{
  echo "### Deployed URLs (${ENV_NAME})"
  …
  [[ -n "$COMPANY_URL" ]] && echo "- Company site: $COMPANY_URL"
} >> "$GITHUB_STEP_SUMMARY"
```

A group's exit status is its **last command's**, and `[[ -n "$EMPTY" ]] && echo …`
returns 1. That group was the last thing in the step, so the step exited 1 and the job
failed — **after every stack had already deployed successfully**.

`COMPANY_URL` is empty whenever the `company-site` stack is not in the deploy target, i.e.
on every api-only or web-only deploy. It stayed hidden because the deploys that ran after
the company site shipped happened to include it.

Run 35280898726 (2026-09-17, PR #703) is the shape to recognise: **"CDK deploy" green,
"Summarize outputs" red**, and then `E2E gate`, `Deploy to prod`, `Record deployed SHA`
and `Tag prod release` all **skipped** — so staging was current and prod silently was not.
Read the _step_ list, not just the job result: a failure after the deploy step means the
infrastructure change landed and only the reporting broke.

Fixed with `if … fi`, whose false branch exits 0. Do not "fix" it with `|| true` on the
group — that also swallows a real failure to write `$GITHUB_STEP_SUMMARY`.

The same `[[ … ]] && …` shape appears in `_deploy.yml`'s target resolver,
`mobile-release.yml`'s Decide step and `_temporal-worker.yml`'s rollout poll. Those are
**safe**: each is mid-script, and `set -e` does not abort when the failing command is the
left side of an `&&` list. Only last-in-block occurrences can fail a step, so that is the
thing to grep for.

## A grep that matches nothing is not evidence: the shell's `grep` is ugrep with `-I`

`grep` in this environment is a **shell function** wrapping Claude Code's bundled ugrep with
`-G --ignore-files --hidden -I …`. The `-I` is "skip binary files", and ugrep calls a file
binary as soon as it contains a NUL byte.

**All three** of `packages/domain-reference/tools/`'s generators hold literal NUL bytes, written
directly into template strings as a sort separator — `generate-glossary.ts` and
`generate-catalog.ts`. So every `grep` of either TypeScript file returns **nothing, with exit 0**
— not an error, not a warning, just silence that is indistinguishable from "no match". `file`
reports them as `data`; `sed`, `node` and `tsc` all read them perfectly.

**No count is given here on purpose**, because the last one went stale: this entry used to say
"four literal NUL bytes" in `generate-glossary.ts` alone and that it had been fixed at the source.
Measured 2026-10-03, neither half held — the file still has NULs, `generate-catalog.ts` has one and
was never named, and `tests/conformance/documents.test.ts` had one that nobody had recorded. Name
the files and re-measure; do not trust a number in prose:
`python3 -c "import pathlib,sys; [print(p) for p in pathlib.Path('packages/domain-reference').rglob('*.ts') if p.read_bytes().count(b'\\0')]"`

This is the concrete cause of the class of failure the domain-reference plan warns about —
"two of my own tamper attempts silently matched nothing, which looks exactly like a working
gate". A tamper check, a guard script, or a `grep -q` gate over such a file is a **permanent
false green**.

- **When a negative grep result is load-bearing** — proving a string is absent, confirming a
  tamper landed, gating on a pattern — use **`/usr/bin/grep -a`** (`-a` forces text mode) and
  not the wrapper.
- `/usr/bin/grep` without `-a` is only half a fix: it prints `binary file matches` and
  suppresses the matching lines.
- **The escaping was partial.** This bullet used to say the NULs had been fixed at the source in
  `generate-glossary.ts` (escaped, with the runtime string and the generated glossary
  byte-identical). Whatever landed, the file still holds NULs today — so treat "fixed" claims about
  NULs as needing the re-measure above, not as settled.
- No CI job greps either generator, so this is local-tooling only — worth checking if one ever does.
- **`tests/conformance/documents.test.ts` no longer has one.** Its NUL was the `phrase ?? '\0'`
  never-matching sentinel inside the [SD §4.7.3] disclosure assertion; the cleanup round's A2
  rewrote that assertion to handle `undefined` explicitly, so plain `grep` works on that file
  again. Any file can still acquire a NUL the same way.

## A generator that emits `*emphasis*` breaks its own prettier fixed point

`packages/domain-reference/tools/generate-glossary.ts` writes markdown, and the pre-commit hook
runs `prettier --write` over what it wrote. Prettier normalises markdown emphasis to `_x_`, so a
blurb containing `*and*` makes the generated file **not a fixed point**: the staleness gate compares
the generator's output against the committed file and passes, then the hook rewrites the committed
file, and the next run of the gate fails on a change nobody made.

- In any generated markdown, write `_x_`, never `*x*`. Same class of trap as
  `JSON.stringify(x, null, 2)` not being a fixed point because prettier collapses short arrays.
- The check is one command and it is worth running before every commit that touches a generator:
  `npx prettier --check docs/domain-reference packages/domain-reference`.
  It is clean over both trees with **no exception** as of the cleanup round's A1, which formatted
  `packages/domain-reference/alloy/run.mjs` — the file that had made the rounds since A7 write
  "prettier clean except…" in their verification notes.

### And `_x_` plus "no markdown tables" is still not enough — two more ways it breaks

`generate-context-map.ts` (2026-10-05) emits no table and uses no `*emphasis*` of its own, and it
still failed `prettier --check` twice. Both causes are the same shape: **markdown the generator did
not author, pasted in from source text it read.**

- **A citation whose own text wraps.** A docstring may wrap a citation across a line break —
  `[A1\n * §Cross-area]` — and a reader that keeps the spelling verbatim hands the renderer a link
  label containing a newline. That splits its own bullet in two and prettier re-indents the orphan as
  a continuation. Collapse whitespace in anything you interpolate into a link label or a list item.
- **An emphasis run cut in half.** Taking "the rest of the line" out of a wrapped comment can take
  `**bold` and leave `bold**` behind. Prettier balances the stray `*` and rewrites the file the
  generator just wrote.

**And the obvious repair over-reaches.** Stripping `_` along with `*` turned `NOT_COMPLETED` into
`NOTCOMPLETED`. An intra-word underscore is **not** emphasis in markdown and never needed removing;
strip `*` and backticks, keep `_`.

## A gate on a generated file must read the generator, not the file on disk

`context-map.test.ts` (2026-10-05) shipped two gates holding the context map's refusal to publish a
DDD integration-pattern label. Both read the **committed** `.md` with `readFileSync`. Tampering the
**generator** to leak `shared kernel` into a row and running the suite fired only the staleness check:
the substantive gate read a file the tamper had not touched, and passed.

- A staleness gate plus a content gate that both read the committed file is **one** gate wearing two
  names. The content gate has to call `generate…()`.
- This is the third shape of the same defect in this package — A6 found a gate that passes a
  half-tamper, A7 reproduced it, the cleanup round fixed it. The tell is always the same: **tamper the
  thing the gate is nominally about and check that gate fires, not just its neighbour.**
- What a gate over generated prose genuinely cannot hold is the **wording**. Spell the sentence once as
  an exported constant, have the gate read that constant, and say in the test that rewording is
  deliberate and fires only staleness — no gate in that package reads prose for sense.

## The owed ledger was blind to an owed _vocabulary_ for the model's whole life

`generate-glossary.ts`'s owed ledger read two spellings out of the AST — the `owed(name, owedTo)`
constructor and the `Owed<Name, Owner>` type — and **not** `OwedCode<'x'>`, which is a brand rather
than an object. So `catalog/index.json` and the glossary both reported 21 owed values and **zero owed
vocabularies**, while four closed enums (`reasonCode`, `roleClass`, `unitOfMeasure`,
`identityScheme`) had no members at all. The gap is the exact failure the ledger exists to prevent:
"a reference model that cannot say **how much** is undecided invites a reader to assume the answer is
'not much'".

It surfaced only because landing A4 was _supposed_ to make the inventory shrink and did not. Fixed
with `owedVocabulariesFromCode`, a glossary section and an `owed.vocabularies` field.

**The general lesson:** when a change is supposed to move a generated count, check the count. A
ledger that reads the AST reads the spellings someone thought of, and a new construct is invisible to
it rather than an error.

## JSON Schema cannot carry a per-code obligation — publish it as data

`Reason.remedy` and `Reason.attribution.party` are optional on the record, and A4's vocabulary makes
them **required for specific codes** (`PARTY_ABSENT` must carry a remedy; every `PARTY`-scope code
must name a party). No JSON Schema keyword expresses "required when `code` is one of these", short of
splitting the union into a branch per obligation — which changes the published shape.

So the obligations are published as **data**, in `catalog/index.json`'s `reasons` block, with a note
saying the schema is more permissive than the vocabulary. If a document claims a consumer can read
something from a generated artifact, **open the artifact and check** — `A4 §0` made that claim before
anything emitted it, which is a disclosure defect in the document that introduces the disclosure
rule.

## A count written in prose must be **gated or deleted** — the ungated copies rot

`catalog/index.json`'s generated owed note read _"the authority rows, 19 of 31 of which are owed"_
beside a generated `counts.authorityRows` of **14**. Two more copies of the same numbers were stale
in `published-event-catalog.md` §2.4 and `docs/domain-reference/README.md`, plus a fourth in
`A4-execution-events.md` §7, and `src/outcomes.ts` said "Twenty-three members" of a 24-member enum.

**The interesting part is which copy did _not_ rot.** `published-event-catalog.md` §5 carries the
same five counts and stayed correct across two releases, because
`tests/conformance/catalog.test.ts` parses them out of that section and compares them with
`collectOwedInventory()`.

So the rule is not "write the number once" — a gated copy earns its place, and prose that says
"14 of 31" is more useful to a reader than prose that says "see `counts.authorityRows`". The rule is
**gate it or delete it**, and the same trap bit a tamper test that asserted
`/exactly the 23 members of REASON_CODES/` as a literal where the loader derives it from
`REASON_CODES.length`.

## The test suite knows things the prose does not — read it before writing about a record

A1's first draft said the model "already has the fields" for a cancellation's requestor: the actor on
`assertedBy`, the requestor on `reasons[].attribution`. `[SD §2.3]` invariant 2 **forbids**
`reasons[]` at `outcome = COMPLETED`, so on a cancellation that succeeded — the ordinary case — the
field does not exist. `tests/scenarios/cancelled-after-packing-before-loading.test.ts` had already
asserted exactly that, as a block literally titled `FINDING:`, months earlier.

Nothing in the prose layer would have caught it, because the two sections that collide
(`[SD §4.7.2e]` item 2 and `[SD §2.3]` invariant 2) are thousands of lines apart and neither is
wrong on its own. **Before writing a claim about what a record can carry, grep
`packages/domain-reference/tests/` for the type and read what is already asserted about it.**

## `new-worktree.sh` derives the Postgres port from the slug, and slugs collide

The port is `5433 + (sum of the slug's character ordinals) % 60`. `area-a1` hashes to **5433**, which
the long-lived `domain-reference` worktree already holds, so provisioning fails **after** creating
the git worktree and branch — leaving partial state that `scripts/rm-worktree.sh <slug>` cleans up.
Pick a different slug rather than tearing down another workstream's container; agents are barred from
removing worktrees they did not create.

## An `Exact<>` gate that IS assigned can still be a tautology (A2, PR #724)

`packages/domain-reference/src/primitives.ts` exports
`Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never`, used to make a
hand-written table fail to compile when the vocabulary it is keyed on gains or loses a member.

**A5 (PR #723) found the first trap:** `export type X = Exact<A, B>` on its own is a **comment** — an
alias evaluating to `never` reports nothing. The convention is `const _x: X = true` on the next line,
and that assignment is the whole gate.

**A2 found the next one: the assignment does not always repair it.** An
`Exact<keyof typeof TABLE, MEMBERS>` where `TABLE` is declared as a **mapped type** over `MEMBERS` —

```ts
const TABLE: { readonly [M in Members]: Verdict } = { ... }
export type TableIsTotal = Exact<keyof typeof TABLE, Members> // can NEVER be `never`
const _t: TableIsTotal = true // ...so this is `1 === 1`
```

— **can never fail**, because `keyof` a mapped type **is** its own key set by construction. Assigned
or not, it asserts nothing.

The mapped type was already the gate, and tampering proves it bites both ways:

| Tamper                                        | `tsc`                                                      |
| --------------------------------------------- | ---------------------------------------------------------- |
| A new enum member with no row in the table    | `TS2741: Property '…' is missing in type`                  |
| A row for a member the enum no longer carries | `TS2353: Object literal may only specify known properties` |

**Rule:** an `Exact` earns its place only between two things declared **independently** — a
hand-written `as const` table versus the vocabulary it mirrors, as at `src/catalog.ts:51`,
`src/data.ts:281`, `src/assertions.ts:209` and `src/rules/authority.ts:1019`. Between a mapped type
and its own key set there is nothing to drift, and a decorative assertion beside a gate that already
bites is **worse than nothing**: it tells the next reader the coverage is checked twice.

**Both halves of this were found only by tampering.** A passing build proves neither. Tamper every
new compile-time gate and watch it fail before leaving it green.

## …and the other half: gate a recorded gap only when the gap has an edge the types can see

The entry above says when an `Exact` is worthless. A6 (`docs/domain-reference/analysis/A6-documents-evidence.md` §9)
supplies the positive case and the boundary, because the model now carries three constants that record
a gap and only **one** of them should be a gate:

| Constant                                    | Held by                                   | Why                                                                                            |
| ------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CONDITION_BY_OMISSION_IS_NOT_EXPRESSIBLE`  | `Exact<CaptureMethod, …the seven names…>` | Its claim is **false the moment `CAPTURE_METHODS` gains a member** — an edge `tsc` can see     |
| `DOCUMENT_STATE_IS_NOT_COMPUTABLE`          | a plain `= true`                          | False only when a fact class is **minted**, which already touches three files and a test table |
| `SHIPMENT_BOUNDARY_STAGE_IS_NOT_COMPUTABLE` | a plain `= true`                          | Same                                                                                           |

**Rule:** gate it when the gap has an edge the types can see, and **say why in the docstring when it
does not**. Do not copy the `= true` pattern reflexively — ask first whether the claim has an edge.

## A refusal is not held by asserting the refused thing is absent from a list you wrote

A6's first draft "held" its central refusal (the published `EvidenceRef` union must not gain an
`inboundMessage` branch) with two vitest assertions that **could not fail**:

```ts
const kinds: readonly string[] = ['document', 'assertion']
expect(kinds).not.toContain('inboundMessage') // reads EvidenceRef not at all
expect(handWrittenFixture.evidence).toBeUndefined() // reads a fixture the test wrote
```

Both passed for the same reason the tautological `Exact` above passed: nothing independent was
compared. The fix is the house pattern — a `tests/conformance/*-refuses.ts` file whose
`@ts-expect-error` directives go **unused** (`TS2578`) when the illegal state becomes legal. Widening
the union reports both directives unused and the package stops compiling.

**And one mechanical trap inside that fix.** `@ts-expect-error` suppresses errors on **one** line, and
an inline union literal with a wrong discriminant reports on a **different property** than the one you
expect — an `EvidenceRef` literal with `kind: 'inboundMessage'` reports on its `ref`, not its `kind`.
A directive written above the literal therefore sits above the wrong line. **Name the value first and
annotate the assignment**, so the one error lands on the one line the directive covers:

```ts
const asIngestSpellsIt = { kind: 'inboundMessage', ref: inboundMessageRef('x') } as const
// @ts-expect-error — not a branch of the published union
const refused: EvidenceRef = asIngestSpellsIt
```

## A global oldest-first outbox drain + an infinite "park" = one tenant starves the rest

**Symptom (prod 2026-09-24):** a tenant's RingCentral messages sat `PENDING` with `attempts = 0` for
50+ minutes while the forwarder ran green every 5 minutes, logging `sent: 0, parked: 100`.

**Cause:** `listPendingForwards` took the 100 globally oldest-due outbox rows. 1,467 rows belonged to
a tenant with no `mssqlConnectionString` (captured by a since-deleted RingCentral connection). Each
run parked all 100 for +5 min without spending an attempt — correct for an outage, but they never
leave the queue, so they cycled forever and every other tenant waited a full ~75-min cycle.

**Fix (`fix/ringcentral-forward-skip-unconfigured`):** filter unconfigured tenants out at the query,
cap the drain per tenant, and stop calling a tenant's executor once it is unreachable within a run.
**General rule:** any outbox whose "retry later" state never exhausts needs per-tenant fairness —
a green cron with `sent: 0` is the tell.

## RingCentral FSync silently caps at 250 records

**Symptom (prod 2026-09-25):** a tenant connected with a 90-day backfill window; exactly 250 messages
arrived in the first minute and nothing older, although RingCentral held 5,100 SMS for the window.

**Cause:** `GET …/message-sync?syncType=FSync&dateFrom=…` returns at most 250 records, newest first,
with `syncInfo.olderRecordsExist: true`. There is no page parameter; the next call must be ISync. The
original capture treated the FSync page as the whole backfill.

**Fix (`fix/ringcentral-backfill-pagination`):** keep FSync for the sync token, then page
`…/message-store` (`perPage=1000`, `dateTo` = oldest FSync record) with resumable progress on the
cursor. **General rule:** check every RingCentral "full" response for a truncation flag
(`olderRecordsExist`, `navigation.nextPage`) before trusting its size.

## An `Owed<>` marker's `owedTo` is a published schema `const`, not a comment

**Symptom (domain-reference A7, 2026-09-28):** correcting `chargeValue`'s owner from `A11` to
`A7 / A12` — a one-word fix to a piece of the model's own bookkeeping, in a value the model
explicitly does not publish — turned out to be a **wire change**, and moved `CATALOG_VERSION`
`0.5.0` → `0.6.0`. The round's actual decisions moved nothing.

**Cause:** `tools/generate-catalog.ts` renders `Owed<Name, Owner>` with **both** type parameters as
`const` subschemas, on the captured _and_ the queried face. So a producer emitting the old `owedTo`
string is rejected by the new schema. The reasoning had gone the other way first — an owed marker's
owner _feels_ internal, and the two preceding rounds (A2, A6) had both shipped with empty schema
diffs — and only `git diff` over `catalog/*.schema.json` said otherwise.

**General rules, both from `[catalog §5]`:**

- **Read the emitted `$defs` before classifying any change.** "A compatibility classification argued
  from which fields feel published is a classification waiting to be wrong." This is now the third
  time it has changed an answer, after `keySideRole` at A8 and the two non-bumps at A2 and A6.
- **The published schema and the data table differ in _both_ directions.** A6 found a narrower
  `context` list in `data/canonical-subjects.json` that reaches no consumer; A7 found a docstring-ish
  string that reaches every consumer. Neither direction is the default.

Classified `repointedOwedOwner` at `[catalog §2.3]` — additive, because `owedTo` carries no domain
content and sits inside a branch the wire already marks undecided. Two gaps recorded there and not
closed: `[catalog §2.3]` has **no rule for a breaking change while pre-1.0**, and **every future
owner-correction will cost a bump** for the same reason this one did.

## npm overrides: two mechanics that look identical to success until they aren't

Both found on 2026-09-29 while clearing the dependency-alert backlog. The repo's `//overrides`
notes already carried half of each rule; this records the other half.

### 1. Deleting a lockfile key PRUNES the package — it does not re-resolve it

The gotcha the override notes repeat most often is "editing `overrides` alone does nothing — npm
caches the old resolution, so delete the `*/node_modules/<pkg>` keys from `package-lock.json`
first." That is **only true when the goal is collapsing duplicate nested copies** (the `hono`,
`prisma`, `@prisma/client` entries — there, deletion forces npm to re-hoist).

When the goal is **raising one copy's version floor**, deletion does the opposite. Deleting
`node_modules/protobufjs` and `node_modules/qs`, then `npm install`, printed
`added 7 packages, removed 27 packages` and left `npm ls protobufjs` reporting `(empty)` — npm
took the missing key as "this package is not needed" and pruned it, breaking `@grpc/proto-loader`
and `typed-rest-client` outright. The `fast-uri` note already says this ("deleting the lock key
just prunes the package entirely"); it just wasn't stated as the general rule.

**Rule:** raising a floor → `npm update <pkg> --package-lock-only`, then `npm install`.
Collapsing duplicate copies → delete the keys. Either way, confirm with `npm ls <pkg>` that the
version actually moved, and finish with a real `npm ci` (exit 0), which is what CI runs — an
`install` can succeed against a lockfile `ci` rejects.

### 2. A nested override matches a DIRECT child only, not a subtree

`"@react-navigation/core": { "nanoid": ">=3.3.17 <4" }` works because `nanoid` is a direct
dependency of `@react-navigation/core`. Copying that shape for a different package silently did
nothing: `"@react-navigation/core": { "decode-uri-component": ">=0.5.0" }` resolved
`decode-uri-component@0.2.2` unchanged, because the real path is
`@react-navigation/core > query-string@7.1.3 > decode-uri-component` — a **grandchild**. npm's
nested form names a dependency _path_, so a grandchild needs the intermediate spelled out:
`{"@react-navigation/core": {"query-string": {"decode-uri-component": "..."}}}`.

**Rule:** before parent-scoping an override, run `npm ls <pkg> --all` and scope to the package
that _directly_ declares it. A no-op override is indistinguishable from a working one except by
`npm ls`.

### 3. "The fix version exists" is not the same as "the fix is installable"

Three of the alerts in that backlog had a published patch that could not be used, each for a
reason only visible by reading the consumer:

- **decode-uri-component 0.5.0** is ESM-only (`"type": "module"`, one `export default`), but both
  vulnerable copies sit under the CJS `query-string@7.1.3`, which does
  `const decodeComponent = require('decode-uri-component')`. Under Node 24 that `require()`
  returns `{__esModule, default}` and the call site dies with `decodeComponent is not a function`.
  Same shape as the nanoid-4 trap the `nanoid` override note documents.
- **image-size 2.0.3** dropped file-path input from its main entry (it moved to an async
  `fromFile`), but `metro@0.83.7` passes a path string at `src/Assets.js:177`. It throws
  `TypeError: The "list" argument must be an instance of ... ArrayBufferView`.
- **uuid 11.1.1** is a fix for a bug in `v3`/`v5`/`v6` _when a `buf` argument is passed_. Both
  vulnerable consumers (`exceljs`, `xcode`) call only `v4()` with no arguments, so the patch would
  cost three-to-four forced majors to fix a path neither one executes.

**Rule:** a two-minute probe settles this where an hour of reasoning does not — `npm i <pkg>@<fix>`
in a scratch dir and call it the way the consumer does. Record the finding in `audit-ci.jsonc`
with the call site (`file:line`) so the next reader does not re-derive it.

## `optional-auth.test.ts` times out under a parallel `turbo test` — flake, not a failure

**Symptom (2026-09-29):** `@pegasus/api#test` fails only under a full-tree
`turbo run typecheck test` (which is what the `.husky/pre-push` hook runs across 16 packages),
with exactly one failure:

```
FAIL src/__tests__/optional-auth.test.ts > SKIP_AUTH mode >
     bypasses auth and returns 200 on /api/v1 routes when SKIP_AUTH=true
Error: Test timed out in 15000ms.
```

Same tree passed twice and failed twice, so it is load-sensitive, not a regression.
`turbo test --filter=@pegasus/api` alone passes every time.

**Cause:** the suite is fully mocked — `../db`, `../lib/prisma` and `jose` are all `vi.mock`ed, so
there is no I/O to be slow. What is slow is `await import('../app')`: the file calls
`vi.resetModules()` in `beforeEach` because SKIP_AUTH is read at module-evaluation time, so each
test re-imports and re-transforms the **entire** API module graph. The failing test is the
**first** of the three; the other two then run in ~1s each off the warm transform cache. Under a
full-tree run every workspace's vitest workers are competing for the same cores, and that first
cold import crosses the 15s default `testTimeout`.

**What to do:** re-running is legitimate here (a diagnosed flake, not a red pipeline). The real
fix is a per-test timeout on that first case — `it('…', async () => {…}, 30_000)` — since the cost
it pays is transform time that the other two do not. Note `testTimeout` covers test **bodies**
only; if this ever moves into a hook it needs `hookTimeout` instead (see #701).

**Fixed (2026-10-03, cloud identity I1):** the app's module graph grew (JWKS + company
settings), and the flake spread to every file that cold-imports the app (`health`, `openapi`,
`optional-auth`, `server`): 5 failures, then 2, on consecutive pre-push runs. Each of those files
now sets `vi.setConfig({ testTimeout: 60_000 })` at module scope. Any new test file that does
`await import('../app')` (or imports `../server`) needs the same line.

## `tenant-picker.test.tsx` TENANT-03 times out in CI only — and ejects PRs from the merge queue

**Symptom (2026-09-29):** `@pegasus/mobile#test` fails in CI with

```
FAIL __tests__/app/(auth)/tenant-picker.test.tsx (29.3 s)
  ● TenantPickerScreen › calls selectTenant … when a company is tapped (TENANT-03)
    thrown: "Exceeded timeout of 15000 ms for a test."
```

Hit 3 of 4 runs on one PR, including a `merge_group` run — which means it does not merely fail a
PR check, it **ejects the PR from the merge queue** (`removed_from_merge_queue` by
`github-merge-queue[bot]`). **Diagnosing a queue ejection starts in the wrong place by default:**
the failing run is not among the PR's own checks. Find it with `gh run list --event merge_group`
and look for the `gh-readonly-queue/main/pr-<N>-<base>` branch.

**Does not reproduce locally.** The full suite passes 3/3 in ~1s per run
(`cd apps/mobile && npx jest --forceExit`), so a fix cannot be verified off-runner.

**Diagnosis:** the test is fully mocked — no network, no storage. It hangs inside

```tsx
await act(async () => {
  fireEvent.press(getByText('Acme Moving Co'))
})
```

`fireEvent.press` is synchronous and RNTL already wraps it in `act`; the outer **async** `act`
then drives React's async work loop, which competes with `VirtualizedList`'s real ~50ms
`_updateCellsToRender` batching timers. The run log carries the matching "An update to
VirtualizedList inside a test was not wrapped in act(…)" warning with a stack ending at
`Timeout._onTimeout`. On a saturated 2-core runner each drain cycle waits on a real timer and the
loop outlives jest's 15s default.

**Likely fix, UNVERIFIED:** drop the outer async `act` and use the documented RNTL idiom —
`fireEvent.press(...)` then `await waitFor(() => expect(mockSelectTenant).toHaveBeenCalledWith(…))`.
`waitFor` polls with a bounded timeout instead of draining VirtualizedList's timer loop. **Three**
tests share the pattern — lines 59, 70 and 90 of a 6-test file, counted 2026-10-05; an earlier
version of this entry and of the plan both said "four", which was wrong. Recorded rather than
applied, because it cannot be reproduced locally — it needs its own PR and several real CI runs to
confirm.

**Update 2026-10-03 — the leaked timer was real, and it was in a DIFFERENT FILE.** A later run
added "A worker process has failed to exit gracefully and has been force exited … Active timers
can also cause this", and the natural reading was that TENANT-03 itself leaked. It does not.
`jest --detectOpenHandles` (no `--forceExit`) reported exactly **one** open handle in the whole
22-suite mobile run, reproducibly, and it was
`src/components/__tests__/Dashboard.snapshot.test.tsx` — a `shows loading state initially` test
whose mock resolved through a real `setTimeout(…, 1000)` while the test asserted synchronously
and returned, leaving the timer pending and its worker unable to exit. `tenant-picker.test.tsx`
on its own is clean: 6/6, no handles. Fixed by mocking with a promise that never settles, which
is all a loading-state assertion needs.

Two lessons worth more than the fix:

- **A force-exit warning names the worker, not the test you suspect.** The only way to attribute
  it is `--detectOpenHandles` across the whole suite; `npm run test:handles` in `apps/mobile` now
  does exactly that, since the `test` script's `--forceExit` will keep hiding the next one.
- **The leak and the TENANT-03 timeout are still separate claims.** Removing the handle removes
  the force-exit warning; it is NOT proof the timeout goes away. #775's `testTimeout: 45000` is
  what addresses the timeout, and the `waitFor` rewrite above is still unapplied and still
  unverified. Do not retire it on the strength of this.

**Note the CI `Test` job runs `turbo run test` with no `--affected` and no filter**, so the mobile
suite runs on every code PR and in every merge-queue group. This flake is reachable from a change
that touches nothing in `apps/mobile` — a dependency-only PR hit it.

## `delete arr[i]` inside an RTK reducer writes `undefined`, it does not leave a hole

Immer's array `deleteProperty` trap is `set(prop, undefined)`. So `delete draft.list[i]` produces
an explicit `undefined` element, which `.map` visits (it only skips real holes). The driver-planning
`addActivity` reducer did this to `extraActivities`, so reopening the "+" menu after adding one
activity threw `Cannot read properties of undefined (reading 'activityType')` and dropped the whole
planning page into the root ErrorBoundary. Latent since the April port; surfaced once
`reportClientError` (2026-09-17) made client crashes visible (NWI trip 16992, 2026-09-29).
Use `splice`. The old reducer test _asserted_ the `undefined` slot, so it guarded the bug.

**Finding client crashes:** the ErrorBoundary POSTs to `/api/v1/client-errors`; search the prod
`pegasus-prod-api-ApiLogGroup*` for `"client.error"`. Each event includes the message, stack and page URL.

---

## `vitest` is green while `tsc` is red, and a brand-new test file is where it bites

**Discovered:** A9 round, `packages/domain-reference` (PR #746).

`vitest run` transpiles and does **not** typecheck. A new conformance test file shipped green with
six `strictNullChecks` errors in it — `match[2]` and `registry.split(...)[1]` are `string |
undefined` under `noUncheckedIndexedAccess`, and every one of them happened to be non-null at
runtime, so the suite passed.

**Rule: run `npm run typecheck` after _every_ test edit, not once at the end of the round.** The
window where the two disagree is exactly the window where you believe the new gate works.

Related, same package: the pre-commit hook runs `eslint --fix` + `prettier --write`, so **verify
after the hook, not before**.

---

## The domain-reference drift guard reads `` `type: X` `` in prose as a record-type claim

**Discovered:** A9 round (PR #746).

`packages/domain-reference/tests/conformance/documents.test.ts` scans every `.md` under
`analysis/` and flags, in both directions, any **unqualified** `type` followed by `=` or `:` and an
identifier inside a code span — that is the documents' own type-naming form, and the guard exists so
a document cannot name a record type the vocabulary does not have.

It has a false positive that is easy to hit and easy to misread as a broken test: prose quoting
**someone else's** schema. Writing that an OpenAPI field is `` `type: string` `` makes the guard
report `string` as "a record type named by a document and absent from the vocabulary".

**Fix: reword rather than widen the guard.** "a bare string with `x-nullable: true`" says the same
thing and keeps the guard narrow. Qualifying the span (`Foo.type: string`) also works — "unqualified"
is load-bearing in the guard's rule, which is how `Location.type = warehouse` stays out of it.

---

## A company-site-only deploy failed to bundle the Cognito Lambdas

CDK synthesizes the **whole app** on every deploy and esbuild-bundles every `NodejsFunction` in it,
even when `TARGET` names only `CompanySiteStack`. `@pegasus/domain` resolves through
`main: ./dist/index.js`, so its `dist/` must exist. `_deploy.yml`'s Turbo build added
`--filter=@pegasus/api^...` only when `deploy-api` was true. A company-web-only push (#761,
run 37026172891, 2026-10-02) selected no filters, skipped the build, and failed in "CDK deploy"
with `Could not resolve "@pegasus/domain"` from `apps/api/src/cognito/pre-token.ts`.
The api deps are now built on every deploy. Before #761 no deploy had been company-web-only, so
nothing had exercised that path. The site still went live because the next deploy (#710) ran
`--all`.

## A RingCentral MMS is `type: 'SMS'` — filtering on type never excludes it

**Symptom (prod 2026-09-25):** picture messages reached on-prem as their caption only; the image was
silently gone — no error, no skip log. 30 of 5,100 messages in 90 days (all inbound).

**Cause:** RingCentral files MMS under `messageType=SMS`. The text is in `subject` (and repeated as
a `Text` part); each file is an `attachments[]` part with `type: 'MmsAttachment'`. The normalizer
read only `subject`. **General rule:** when a vendor record has a parts/attachments array, decide
explicitly what happens to every part type — "we only handle SMS" is not a filter the API enforces.

## Under `SKIP_AUTH`, a `vnd_` key is a human — the local e2e cannot test M2M identity

`dualAuthMiddleware` checks `SKIP_AUTH === 'true'` **before** it looks at the bearer, so the
local Playwright API (which runs with `SKIP_AUTH=true`) turns every caller, a seeded `vnd_`
key included, into the synthetic `tenant_admin` with `apiClient` unset. The request
succeeds, so a spec that depends on M2M identity (the usage meter, `apiClient`-scoped logic,
workflow attribution) fails quietly: the close returns 200 and no usage row appears. Prove
M2M behavior in an `apps/api` integration test that drives the real `m2mV1` router with
`SKIP_AUTH` unset, `AUTHZ_OFFLINE=true` and a real DB
(`src/__tests__/usage-meter.integration.test.ts` is the template).

## Outbound integration handlers answer 200 when the PARTNER failed

`deliver-to-external` and `call-external` return HTTP 200 with `data.delivered` /
`data.ok` carrying the partner's `response.ok`. Anything that judges success by `c.res.status`
(a meter, a metric, a retry policy) must read those fields instead. Also, `call-external`
GETs run **live under `run --dry-run`** (only mutations are captured client-side), so a GET
reaching the API is not proof of a real run.

## `node ../../node_modules/.bin/<tool>` requires the ROOT to own the tool

The repo invokes its dev tools by path — `node ../../node_modules/.bin/prisma`,
`.../playwright`, `.../vite`, `node node_modules/.bin/turbo` — about forty call sites across
`.github/workflows/`, `apps/e2e/global-setup.ts` and `apps/e2e/playwright.config.ts`. The
`node` prefix is deliberate: a restored `node_modules` cache loses the exec bit on `.bin`
shims, which is why `.github/actions/setup/action.yml` re-`chmod +x`es them.

The unwritten precondition is that the tool actually lands in the **root** `node_modules`.
That is not automatic for a package only workspaces declare — it is a hoisting outcome, and
hoisting changes under you:

- **prisma** (2026-07): two workspaces declared the same range, npm installed a private copy
  in each instead of hoisting, and nothing linked `.bin/prisma`. Remedy: pin one version so
  it hoists — see the `prisma` entry in `//overrides`.
- **tsx** (#762, 2026-10-02): four workspaces (api, e2e, infra, vpn-agent) declared one range
  and it hoisted by luck for months. Then a group bump nested **vite 8.3.1** under admin-web
  and tenant-web while root stayed on 8.3.0, and arborist filled the root `tsx` slot with
  vite 8.3.0's **optional peer** (`optional: true, peer: true`) instead. npm does not install
  an optional peer nothing depends on, so `node_modules/.bin/tsx` was never linked and E2E
  died on `Cannot find module '<root>/node_modules/.bin/tsx'` — identically on #759 and #762,
  not a flake. Remedy: a real root dependency edge (`tsx` in root `devDependencies`), which
  root already needed anyway for `npm run create-admin-user`.

- **sharp** (#762 again, 2026-10-04 — the same evening, a second consumer). `packages/infra`'s
  DocumentsStack lists `sharp` under CDK `bundling.nodeModules`, and `NodejsFunction` implements
  that by writing a temp package.json, copying the project's **root** lockfile beside it, and
  running `npm ci` — which only resolves packages the lockfile holds at the root. sharp had
  hoisted by luck too; once the bump moved apps/api and apps/mobile to `^0.35.5`, root
  `@emnapi/runtime@1.11.0` could not satisfy sharp 0.35.5's `1.11.3`, so npm nested a copy under
  each workspace and left no root entry. **Staging Deploy failed on
  `npm ci … Missing: sharp@0.35.5 from lock file` while every PR check was green**, because
  bundling runs only at deploy time. Remedy: a root `devDependencies` edge on sharp, which also
  lifts root `@emnapi/runtime` to 1.11.3. **A plain `npm install --package-lock-only` does NOT
  re-hoist it** — only the root edge does; that was checked both ways.

Rule: **if a root script, a `.bin`-by-path call site, or a CDK `bundling.nodeModules` list needs
a package, declare that package in the root `package.json`.** Verified in isolation — a root
`devDependencies` entry always yields `node_modules/.bin/<tool>` and a root lockfile entry; a
package reachable only as an _optional_ peer is not installed at all, so it yields nothing. Keep
the root range equal to the workspaces' or arborist nests theirs beside it (root `^4.23.13`
against workspaces at `^4.23.15` gave one root copy **plus four nested ones** — the bin link is
restored, but it is four wasted copies).

**The `nodeModules` case now has a PR-time gate**, because the tsx case taught the rule and the
sharp case proved nothing was enforcing it:
`packages/infra/lib/stacks/__tests__/cdk-node-modules-root-resolvable.test.ts` scans every
`nodeModules: [...]` in `packages/infra/lib` and asserts each package has a root
`node_modules/<pkg>` lockfile entry. It is static (no synth, milliseconds), it fails red against
the actual #762 lockfile, and it asserts its own scanner still finds the known call sites — a
guard whose regex quietly stops matching would otherwise pass by checking nothing. The other
three entries today (`@napi-rs/canvas`, `@cedar-policy/cedar-wasm`, `expo-server-sdk`) are
root-resolvable **by luck, not by declaration**, so they are the next instances of this bug; the
gate is what will catch them.

## A `grep -v node_modules` filter deletes every hit you were looking for

Hunting the `.bin`-by-path call sites above, `grep -rn 'node_modules/\.bin' … | grep -v
node_modules` returned a short, reassuring list — and it had silently dropped **every**
match, because the matched lines all contain `node_modules` by construction. The pipeline was
filtering out exactly its own signal. It hid `apps/e2e/global-setup.ts` and ~30 workflow lines,
and a narrower `grep -v '/node_modules/'` hid the `../../node_modules/.bin/prisma` call too.
Use `git grep` when you want tracked files only — it needs no exclusion filter and cannot
develop this fault. Same class as "a CI poll filter that matches nothing is a false green":
when a filter's job is to remove noise, confirm it did not remove the subject.

## `Extract<keyof typeof module, 'Name'>` cannot see a type-only export

The house pattern for holding an absence at compile time is `CustodyIsNotAFactClass`:

```ts
type XIsNotAY = Extract<RecordType, 'custody'> extends never ? true : never
const _x: XIsNotAY = true
```

That one is sound, and the reason is easy to miss: `RecordType` is derived from `RECORD_TYPES`, a
**runtime array**. The same shape written over a module is a **permanent false green**:

```ts
import * as model from '../../src/index'
// Looks like it refuses three primitives. Refuses nothing.
type Unadopted =
  Extract<keyof typeof model, 'LocalDate' | 'LocalDateRange' | 'ZonedInstant'> extends never
    ? true
    : never
```

`keyof typeof module` enumerates the module's **value** namespace. A `export type Foo = …` or
`export interface Foo` lives in the type namespace and is not `keyof`-able, so the `Extract` is
always `never` and the assertion always passes. Found 2026-10-05 in
`packages/domain-reference/tests/conformance/time-value-shape-refuses.ts`, by tampering: adding
`export type LocalDateRange = { from: string; to: string }` to `src/primitives.ts` and watching
`tsc` stay silent.

**The absence of a TYPE needs a reader, not a type.** The fix is a test that reads `src/` as text and
asserts no file matches `export (type|interface) <Name>\b` —
`packages/domain-reference/tests/conformance/time-value-shape.test.ts` is the worked example, and it
does fail when tampered the same way. A **value** absence (an array member, an enum member) is still
fine at the type level.

## A prose gate whose scope includes prose about its own finding closes on that prose

A conformance test that reads a markdown document for a declaration must be scoped to the thing that
**declares**, not to the section or paragraph that contains it. Twice on 2026-10-05, in
`packages/domain-reference/tests/conformance/documents.test.ts`:

- A gate for "every prose alias the code carries, `[SD §4.7]` declares" was drafted over the whole of
  §4.7 and **passed** — because note 5's own new paragraph _about_ the one undeclared alias names it.
  Fixed by reading only the `_(…)_` parentheticals in §4.7.1's table's first column.
- A gate for "note 4 quotes every `boundBy` member" was drafted over note 4's paragraph and
  **passed** — because the sentence explaining the gate names the two members the list was missing.
  Fixed by regexing the slash-separated enumeration after `A8 §4.3's:` and nothing else.

This is the cleanup round's lesson one level out: scoping a gate is **half** the fix, and the half
that matters is scoping it to the declaring surface. The corollary is uncomfortable and worth
stating: **a document may have to describe a finding without spelling the token**, so that the
document does not become evidence against its own gate. Say that it is doing so, and why, where it
does it.

## A generic `NOT_FOUND` code cannot be a skip signal

`apps/api/src/app.ts` `app.notFound` answers every unmatched route with `404 {code:
'NOT_FOUND'}`. A handler that also uses `NOT_FOUND` for a _business_ outcome ("this tenant has
no SMS channel") produces a response a client can't tell apart from a misroute, a stale
deploy, or a route that was never mounted. An Automation that skipped on it would turn a real
outage into a quiet COMPLETED. `/sms/send` now returns `SMS_NOT_CONNECTED` for this case, and
the SDK raises `SmsChannelNotConnected` only on that code. When a client is meant to _act on_
an error, give it a specific code. Generic codes are for failures nobody should handle.

## `turbo` ≥ 2.11 writes itself into `AGENTS.md` when it detects an agent

Noticed 2026-10-04 when `AGENTS.md` turned up modified in a worktree nobody had touched — and
again two commits later, after it had been reverted. `turbo` 2.11.5 (arrived with the #762 bump
from 2.10.12) maintains a managed block in the **repo-root `AGENTS.md`**:

```
<!-- BEGIN:turborepo-agent-rules -->
# This is NOT the Turborepo you know
… resolve the `turbo` package from this file's directory or relevant workspace …
<!-- END:turborepo-agent-rules -->
```

**The trigger is an env-var check, not a heuristic.** Strings in the platform binary
(`node_modules/@turbo/linux-64/bin/turbo`) give the list: `CLAUDECODE`, `CLAUDE_CODE`,
`CURSOR_TRACE_ID`, `AUGMENT_AGENT`, `OPENCODE_CLIENT`, `REPL_ID`, `AI_AGENT`, plus a `/opt/.devin`
path probe. **Claude Code sets `CLAUDECODE=1`**, so every agent session that ran any repo-scoped
`turbo` command (`turbo run test` included) found `AGENTS.md` dirty through no action of its own.
A human running `turbo` in a plain shell never sees it.

Measured in a throwaway repo on turbo 2.11.5, with a control:

| config / env                              | `AGENTS.md`                    |
| ----------------------------------------- | ------------------------------ |
| no agent env vars                         | not created                    |
| `CLAUDECODE=1`                            | **created**, one managed block |
| `CLAUDECODE=1` + `"agentGuidance": false` | not created                    |

Why it matters beyond noise: it is a **tracked, team-wide instructions file going dirty by
itself**, so a `git add -A` commits it silently — which happened once in this repo and had to be
amended out. Deleting the block does not stick either; turbo re-adds it on the next qualifying
command. Only the config key stops it, and it does **not** remove an already-committed block.

**Resolved by `"agentGuidance": false` in the root `turbo.json`.** The advice in the block was
legitimate, so it is kept in our own words in `AGENTS.md` ("Turborepo: check the installed
version's own docs") rather than surrendering the file — the bundled `docs/` and `schema.json`
inside the installed package really are the right source, and `turbo docs "<query>"` searches the
version-matched set.

Two smaller traps found doing this:

- **`turbo.json` rejects `//<name>` comment keys** — `Found an unknown key '//agentGuidance'`,
  which fails the whole parse. It accepts a bare `//` key and wants it **first**. That is _not_
  the `//<name>` convention `package.json` uses (npm ignores unknown keys; turbo validates them).
- **A turbo.json parse failure also produces no `AGENTS.md`**, so "no block appeared" is not
  evidence the opt-out works. The first version of this experiment proved nothing for that exact
  reason; it needed a same-config control with the key removed. Same family as the
  "a filter that matches nothing is a false green" entries above.

Finally, the version you think is installed may not be: the primary checkout had
`node_modules/turbo` at **2.9.18 (dated Jul 22)** while the lockfile said **2.11.5**, because it
had not been reinstalled since the bump. Fresh worktrees got 2.11.5 and the behavior; the primary
checkout did not. Check `node -p "require('turbo/package.json').version"` before concluding turbo
does or does not do something.

## Temporal Cloud Ops: async mutations, a token shown once, and no VPC

Found building the 3b.1 provisioner (`apps/api/src/lib/temporal-cloud-ops.ts`,
`lib/temporal-provisioner.ts`), 2026-10-05.

- **Every mutation is asynchronous.** Each one returns an `async_operation` that
  you poll (`GET /cloud/operations/{id}`, honouring `check_duration`). There is a
  cap of **10 concurrent async operations per account**, and staging and prod
  share the account. Don't fan out.
- **`async_operation_id` is Temporal's idempotency key.** Retrying a step that
  ended `STATE_FAILED` with the same id replays the failure. So the provisioner
  uses a per-run nonce in its op ids and makes each step idempotent by
  **checking Cloud state first** (`getNamespace`, `findServiceAccountByName`,
  `listApiKeys`).
- **An API key's `token` is returned once**, in the `POST /cloud/api-keys`
  response. Store it (KMS-encrypted) before any other call that can fail. A key
  whose token was lost can't be recovered: delete it and mint a new one.
- **A Lambda killed by its timeout runs no `catch`.** A status-only guard
  (`PROVISIONING`) would wedge the row forever. `TenantTemporalNamespace` has a
  `leaseExpiresAt` instead, and the provisioner's async invoke has
  `retryAttempts: 0` (the lease would make Lambda's retries skip anyway).
- **The provisioner must not be in the WireGuard VPC.** 3a's DNS Firewall makes
  `saas-api.tmprl.cloud` NXDOMAIN there. API-stack Lambdas aren't VPC-attached,
  and an infra test pins that.
- **The HTML API docs are JS-rendered** (`saas-api.tmprl.cloud/docs/httpapi.html`
  fetches as an empty shell). The source of truth is `temporalio/api-cloud`:
  `cloudservice/v1/service.proto` for the HTTP bindings and
  `request_response.proto` for the bodies. Pin `temporal-cloud-api-version` to
  its `VERSION` file (`v0.23.0` at the time). Note that `GetServiceAccounts`
  returns its repeated field as `service_account` (singular).
- **The `_deploy.yml` secret pre-flight greps every `arn:aws:secretsmanager:`
  literal in `packages/infra/bin/app.ts`, comments included**, and fails the
  deploy on a NotFound. Never write an example ARN in a comment there, and add
  an ARN only once its secret exists.

## A nested `playwright` shadows the runner — never `npx playwright` in `apps/e2e`

A dependency of `apps/e2e` that brings its own `playwright` gets it installed at
`apps/e2e/node_modules/playwright`, so **anything resolving the binary from that directory gets
that copy as the runner** while the specs still `import from '@playwright/test'` at the root's
stable version. `@playwright/mcp` and its **prerelease** `playwright` were the instance that bit
us — see the resolution at the end of this entry — but the hazard belongs to the directory, not to
that package. The mismatch does not announce itself as a version problem:

```
Error: Playwright Test did not expect test.describe() to be called here.
Error: test.skip() can only be called inside test, describe block or fixture
Error: No tests found
```

Root `node_modules/.bin/playwright` is linked from `@playwright/test` **itself**, so runner and
library can never disagree there. **Always invoke it as
`node ../../node_modules/.bin/playwright`** — the same convention as every other tool in this repo
(see the `.bin`-by-path entry above). Bare `playwright` in an `apps/e2e` npm script hits the shadow
too, because npm puts that workspace's `.bin` first on `PATH`.

Broke the **staging E2E gate** on 2026-10-04 after #762 bumped the prerelease to
1.64.0-alpha (fixed in **#784**). Note which invocations survived and why: the PR-level E2E job
uses the `.bin` path and stayed green; only the one step that used `npx` failed. `install:browsers`
was shadowed as well — worse than a failure there, since it would fetch a Chromium build for a
version nothing runs. Reproduced off-runner in one command each:

```
cd apps/e2e && E2E_TARGET=remote E2E_API_BASE_URL=https://example.invalid \
  npx playwright test --list                          # 21 error lines, "No tests found", 0 tests
  node ../../node_modules/.bin/playwright test --list  # 10 tests in 4 files
```

**How close it came to being invisible:** a 0-test run that exited 0 would have read as a pass and
auto-promoted to the prod deploy job. The gate's `E2E_MIN_EXECUTED_TESTS` skip-guard is the only
thing standing between that and a bad release — here Playwright exited 1 first, so the guard was
not needed. Do not remove that floor.

The repo already knew this for **imports** —
`apps/mobile/store-assets/scripts/capture-screens.mjs` has long carried a comment explaining why it
takes `chromium` from `@playwright/test` rather than bare `playwright` — and had simply never
applied the same rule to the **commands**. Rules written for one call-site shape do not transfer
themselves.

**Resolved in #819 — the dependency is gone.** `.claude/settings.json` launches the MCP server as
`npx @playwright/mcp@latest`, so declaring it in `apps/e2e/package.json` bought nothing and its only
observable effect was this shadowing; every bump re-dragged a prerelease runner into the tree.
Dropping it is a 48-line lockfile deletion with no behaviour change, and the proof is positional
rather than a passing suite: `apps/e2e/node_modules/.bin/` **no longer exists at all**, and
`cd apps/e2e && npx --no-install playwright --version` now prints `1.63.0` instead of the alpha.

**But keep invoking it by path anyway.** That is what makes the next such dependency a non-event,
and the next one will arrive without announcing itself — `@playwright/mcp` was a devDependency
nobody thought of as a `playwright` provider either. Note also what the lockfile shows after the
removal: there is **no root `node_modules/playwright`**. The runner comes from
`node_modules/@playwright/test/node_modules/playwright` via the root `.bin` link, so
`require('playwright/...')` does not resolve from `apps/e2e` and is not supposed to.

## Watching a fresh PR's CI: three ways `gh` reports "nothing" when something is wrong

**Symptom (2026-10-06, #804).** Seconds after pushing the branch and running `gh pr create`:

```
$ gh pr checks 804 --watch
no checks reported on the 'chore/dr-roleclass' branch     # exits 0

$ gh run list --branch chore/dr-roleclass --limit 10 --json ...
[]
```

Both false. Three distinct causes, and **the first guess was wrong** — these were traced, not inferred.

**1. The runs did not exist yet, and `--watch` exits 0 on that.** For roughly the first 30–60s after
`gh pr create`, no workflow run has been created and `gh pr view --json statusCheckRollup` is `[]`.
`--watch` does not wait for checks to _appear_; it returns immediately and **exits 0**. A pipeline that
reads that as "CI passed" will merge a PR nothing has run against. Thirty seconds later the same
commands showed `CI | pull_request | queued`.

**2. `gh run list --branch main` is reliably STALE — reproducibly, not as a one-off.** On 2026-10-06 it
returned runs from **2026-09-23** while the repo-wide `gh run list` showed that day's runs carrying
`headBranch: main`. Re-checked minutes later: same stale answer. Cause not established; what is
established is that the result is not usable. **This is the dangerous shape — not empty, plausibly
_short_, so nothing looks wrong.** It is how you would conclude "no deploy run exists for my merge
commit".

**3. `headBranch` for a CodeQL run IS `refs/pull/<N>/head`.** This is the narrower real hazard and it is
specific to the `dynamic` event: `pull_request`-event runs (`CI`, `Dependency Review`,
`Dependabot Auto-Merge`) do carry the branch name, so `--branch <feature>` finds those — but it misses
the PR's CodeQL run, which is a required context. On `main`, CodeQL's `headBranch` is `main` as usual.

**How to work:**

- **List without `--branch` and filter on `headSha` yourself.** Get the SHA from `git rev-parse HEAD`
  (pre-merge) or `gh pr view <N> --json mergeCommit` (post-merge). Never pad a short hash to 40 chars.
- **An instant `--watch` is an alarm, not a pass.** Re-query after a beat; if a watcher finds nothing to
  watch, make it say so rather than fall through to the success branch.
- For the merge queue, query GraphQL — `repository.mergeQueue(branch:"main").entries` gives
  `position` / `state` / `pullRequest.number`. Note `mergeStateStatus: CLEAN` with
  `autoMergeRequest: null` is the **normal** shape for a queued PR, not a failed enqueue.
- Same class as "a `grep -v node_modules` filter deletes every hit you were looking for" above, and as
  the `skipping` ambiguity: **when a filter's job is to narrow, confirm it did not narrow away the
  subject.**

## Two `WebFetch` reads that agree with each other are not a source — parse the bytes

**Symptom (2026-10-06, #804).** A decision rested on what one public page (X12 element 98 on
stedi.com) does and does not contain. I fetched it with `WebFetch` twice, with different prompts. The
two answers **agreed with each other and were wrong on both numbers that mattered**: they reported
**829** code values and said the page carries **no** per-code definitions.

```bash
curl -sL -o el98.html https://www.stedi.com/edi/x12-004010/element/98
# ~15 lines of re.findall over the <tr><td> rows:
#   1312 code values, 161 of them carrying a definition sentence
```

**Why it reads as corroboration and isn't.** `WebFetch` answers via a small fast model. Two runs over
one page share the model and nearly the prompt, so they fail the same way — agreement measures
consistency, not accuracy, and the second answer adds no information while feeling like a check.

**The asymmetry that matters: a summarizer's negative is much weaker than a grep.** #804's whole
decision rested on _absences_ — no class axis, no non-party member, no household-goods role in 1312
codes. "I did not see one" from a summarizer is not evidence of absence. Its positive claims were
wrong too: five of the codes eventually quoted in the capture (`B2`, `8F`, `X2`, `R1`, `QD`) carry
exactly the definition sentences it said did not exist.

**How to work:**

- Use `WebFetch` to **orient** — is the page there, roughly what shape. Do not quote a figure, a code,
  or an absence from it.
- When a number or a negative is load-bearing: `curl -sL` into the scratchpad, parse it, and **retain
  the bytes**. For corpus material that means `docs/domain-reference/sources/<id>/local/` (gitignored)
  with sha256 + URL in `registry.yaml`, so it is re-obtainable without being redistributed — which is
  the half `src:uncefact-mmt-rdm` lacked.
- **Record the method beside the figure.** The capture notes in #804 carry a "How it was read" section
  saying the summarizers were wrong and what replaced them; that section is why the numbers in it can
  be trusted.
- Do not run a second fetch to check a first one. Run a parse.

## A red `Dependabot Updates` run is usually Dependabot declining, not Dependabot broken

**Symptom (2026-10-05 → 10-07).** `Dependabot Updates` showed only failures for two days, each
annotated "Dependabot encountered an error performing the update". That, plus a critical advisory
with no Dependabot PR, was read as "the dependency safety net is down" and written into the CI resume
plan as its highest-consequence item. It was not down.

**Reading the log.** `gh run view <id> --log` and `--log-failed` print **zero lines** for a Dependabot
service run. The job log is reachable directly:

```bash
job=$(gh api repos/DolasDev/pegasus/actions/runs/<run-id>/jobs --jq '.jobs[0].id')
gh api repos/DolasDev/pegasus/actions/jobs/$job/logs | grep -a -A8 -E 'Errors|conflicting dependenc'
```

Logs expire; an old one returns an XML `BlobNotFound` with HTTP 404.

**What the errors meant.** Each red run was a **security** job (title `… for <pkg>`) for one alert it
could not satisfy — `security_update_not_possible` (a parent's range blocks the fix: `mermaid requires
katex@^0.16.47`; or the copy is bundled in another package) or `NoChangeError` (npm would not
re-resolve). Version-update runs were green throughout. A red security run is the expected outcome
for every alert this repo allowlists in `audit-ci.jsonc`; it repeats on each push to `main` while the
alert stays open.

**Why the critical advisory had no PR.** GitHub had not raised an alert yet. Advisory → alert lag
measured over 30 alerts: **median ~24h**, sometimes weeks. `audit-ci` uses npm's advisory endpoint and
saw it the same afternoon. **Dependabot is not an early warning for a same-day advisory, ever** —
the local `audit-ci` run before enqueuing is.

**How to apply:** before calling Dependabot broken, read one failed job's log and check whether any
**version-update** run failed. If only `for <pkg>` security runs are red, the cause is the advisory,
not the service — triage the alert (fix, or dismiss with a reason).

---

## An enumeration can have a home a `grep` for the member name will not find

**Discovered 2026-10-08**, minting the `party` aggregate kind (`packages/domain-reference`,
catalog `0.6.4`).

Adding one member to a closed `as const` enum in `src/` looked like a one-line change, and the
planning pass enumerated every place the enum's _ordinal_ was written down. It missed the place the
enum's _membership_ is written down a second time: **`data/canonical-subjects.json` carries
`families.anyAggregate.members` as a hand-written copy of `AGGREGATE_KINDS`**, and
`loadCanonicalSubjects` compares the two as a **set**.

A `grep` for the new member's name cannot find that file, because the member is not in it yet — that
is the whole failure mode. What found it was the suite:

```
DataDefect: canonical-subjects.families.members.anyAggregate.members:
  is [order, …, externallyPerformedLeg]
  where SUBJECT_FAMILIES.anyAggregate is [order, …, externallyPerformedLeg, party]
```

**Why that message mattered more than the failure.** It names the **set difference**, so the fix was
one read rather than a debugging session. It also took `vocabulary.test.ts` down at _file load_ and
failed eleven cases in `data-tables.test.ts` behind it — sixteen failures, one cause. A gate that
printed only "expected 14, got 15" would have cost an hour.

**How to apply:** before adding a member to any closed vocabulary in `packages/domain-reference/src`,
grep `packages/domain-reference/data/` for a sibling member's name, not the new one. If a data file
lists the members, it is a second home and the loader is comparing them. The same rule generalises
past this repo: **a hand-written copy of a closed set is invisible to a search for what is missing
from it** — search for what is already there.

---

## Replacing a count with a comparison: right fix, and verify the reason before writing it down

**Same round.** `data-tables.test.ts` asserted
`expect(admissibleSubjectKinds(table, 'identity')).toHaveLength(14)`. The new member made it 15 and
the gate went red — a count standing in for "the whole enum", which dates on contact. Replacing it
with `toEqual([...AGGREGATE_KINDS])` is correct and is the house rule (prefer a gate that enumerates
or compares over one that counts).

**What is worth recording is the claim that did not survive.** The write-up was about to say the
count _also_ "passes a half-tamper" — drop one member while adding another and 15 − 1 = 14, so the
length assertion would pass a silently broken family. Running the tamper refuted it: the data-table
loader's set comparison (above) throws **upstream of every assertion in that file**, so the
half-tamper never reaches the count at all. The count was never what held that claim.

**How to apply:** tamper first, then name the tamper's shape. "This gate would pass a half-tamper" is
a claim about _which_ gate holds a property, and in a suite with layered loaders the answer is often
a gate you were not looking at. Fix the dating count anyway — just do not credit it with catching
something.
