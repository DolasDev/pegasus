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

## Domain Types Over the Wire

Domain entities have `Date` fields (`createdAt`, `updatedAt`, `scheduledDate`) and branded IDs (`CustomerId`, `MoveId`). JSON serialization turns `Date` → `string` and branded IDs → plain `string`. If a frontend query is typed `apiFetch<Customer>`, TypeScript will claim `createdAt: Date` — but at runtime it's a string. Use `Serialized<T>` from `@pegasus/domain` instead.

## Per-Handler Catch Blocks (Anti-Pattern)

Historically, every API handler had `try { ... } catch { return 500 }`. This prevents `DomainError` from reaching `app.onError` (which routes it to 422), suppresses structured logging, and makes error paths untestable. These catch blocks should be removed — see `fix-handler-error-swallowing` plan.

## Mobile App Isolation

The mobile app (`apps/mobile`) historically did not import `@pegasus/api-http` or `@pegasus/domain`. It used raw `fetch()`, local `AsyncStorage` mock data, and its own type definitions. The `mobile-api-integration` plan addresses this convergence. Until it lands, do not assume mobile shares any code with the web apps beyond `@pegasus/theme`.
