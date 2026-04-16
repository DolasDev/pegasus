# Gotchas and Environment Quirks

- **Local Integration Testing**: Vitest integration tests for API handlers require Docker to be running, as they spin up a local Postgres container.
- **Deployment Script Workflow**:
  - The deployment script (`bash packages/infra/deploy.sh`) performs a multi-step process for the full stack.
  - The `apps/admin` deployment requires two passes: one to provision the AWS infrastructure (to get the CloudFront URL) and a second pass to upload the Vite bundle after securely injecting `VITE_COGNITO_REDIRECT_URI`.
- **Apps Ports**: Running `npm run dev` in `apps/admin` explicitly binds to port `5174`, unlike generic Vite apps which default to `5173`.
- **Type Checking Strategy**: The system firmly enforces strict imports and avoids circular dependencies. Always verify architecture graph constraints with `madge` or `tsc --traceResolution` when modifying the domain model.

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
