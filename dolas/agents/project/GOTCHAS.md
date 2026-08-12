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

## Planning's `move_type` filter and the `Is_Trip_Planning` whitelist constrain the SAME column

Filtering Operations → Planning by move type **INTERNATIONAL** returned zero shipments —
for every date range, zone and tenant. `move_type` has no column of its own: it filters
`import_export` (`shipments-list.ts:223`), which is also the column the `Is_Trip_Planning`
predicate ANDs its per-client eligibility whitelist onto (`:250`). Selecting a code outside
that whitelist produces an unsatisfiable conjunction:

```sql
import_export IN ('Z') AND import_export IN ('H','HA','M','A','SS')
```

#615 added `'Z'` to NWI's `importExportTypes`. **The general case is still live**: any other
non-whitelisted move type filters to nothing by the same mechanism. The alternative fix —
letting an explicit `move_type` filter override the whitelist — was considered and declined
(it would change the default planning list's meaning); see `plans/completed/intl-move-type.md`.

Three things make it invisible:

- `Is_Trip_Planning: true` is hardcoded in tenant-web's `DEFAULT_QUERY` and is **not** a
  FilterTab, so a user cannot turn it off to work around the contradiction.
- NWI's Move Types dropdown is built from the `MoveType` lookup with `moveTypesWhere = '1=1'`,
  so it offers **every** code — including ones the whitelist forbids. The dropdown advertises
  filters that cannot match. (QMM's `moveTypesWhere` is restrictive, which is why it needs no
  `'Z'`: the code never reaches a filter.)
- An empty list is indistinguishable from "no matching shipments". Nothing surfaces the clash.

Not a port regression — legacy `shipment.repository.v2.ts:171`/`:214` AND'd the same two
predicates onto the same column, so INTERNATIONAL returned nothing there too.

What generalizes:

- **`importExportTypes` is not merely "default eligibility."** A code missing from it makes
  _filtering by that code_ impossible, not just excluded-by-default. Conversely, adding one
  widens the **default unfiltered** planning list — mind the 1000-row `RESULT_LIMIT_EXCEEDED`
  cap.
- **Test satisfiability, not spelling.** The regression test extracts every
  `import_export IN (...)` clause from the generated SQL, resolves the placeholders back
  through the bound params, and asserts the sets intersect. Asserting that a letter appears
  in a list would not have caught this.
- **A new code usually needs the UI badge too.** `getMoveType`'s `visible` list in
  `ShipmentCard/index.tsx` deliberately omits `'H'` (Interstate = the unbadged common case),
  so any code missing there renders a blank badge indistinguishable from Interstate.
- `apps/tenant-web/src/features/driver-planning/utils/movetype-list.ts` (`MOVETYPE_LIST`) is
  **dead code** — its only consumer is its own test; the real dropdown comes from the API's
  `filter-options.ts`. Don't extend it.

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
