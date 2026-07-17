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
- **`POST /api/admin/tenants` returning `AUTHZ_ERROR` is opaque by design**: the response is a sanitised "Failed to provision the tenant authorization store" with no class hint, so the only way to distinguish bundling vs IAM vs AVP-eventual-consistency vs Cognito-introspection IAM is to read CloudWatch. Filter command (single line):

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

Cognito wraps any pre-token `throw` as `UserLambdaValidationException` with the
message `PreTokenGeneration failed with error <msg>.`. `unwrapPreTokenMessage`
in `packages/auth/src/cognito-client.ts` strips that wrapper (and Cognito's
appended period) so only the Lambda's own sentence reaches the login UI — keep
pre-token error strings user-ready.

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
