# Branch: main

# Goal: Rename DolasApp → apps/mobile and extract shared packages (@pegasus/theme, @pegasus/api-http) into the monorepo workspace

---

## Context

The mobile app (`DolasApp/`) is currently outside the Turborepo workspace, has a placeholder package name (`minimal-rn-app`), and shares no code with the web or admin frontends despite conceptual overlap. This plan:

1. Moves `DolasApp/` into `apps/mobile/` and renames it `@pegasus/mobile` (making it a proper workspace member)
2. Extracts design tokens into `@pegasus/theme` (consumed by mobile immediately; web/admin can adopt later)
3. Extracts the duplicated HTTP client primitives into `@pegasus/api-http` (consumed by web and admin; mobile wired up when HTTP layer is added)
4. Wires the mobile Jest suite into the root `npm test` pipeline

---

## Checklist

### Step 1 — Rename DolasApp → apps/mobile

- [ ] `git mv DolasApp apps/mobile`
- [ ] `apps/mobile/package.json` — change `name` from `"minimal-rn-app"` to `"@pegasus/mobile"`
- [ ] `apps/mobile/README.md` — update heading to `# Pegasus Mobile — Driver App`
- [ ] Verify root `package.json` `"workspaces"` glob `"apps/*"` now picks up `apps/mobile` (no edit needed — just confirm with `npm install`)
- [ ] Confirm `turbo.json` requires no changes (wildcard coverage, mobile scripts will be discovered automatically)
- [ ] Smoke-test: `cd apps/mobile && npx expo start --non-interactive` exits cleanly

### Step 2 — Extract @pegasus/theme

- [ ] Write `packages/theme/src/__tests__/tokens.test.ts` (type-shape and value-range assertions — all passing immediately since tokens are constants)
- [ ] Create `packages/theme/package.json`
- [ ] Create `packages/theme/tsconfig.json` (extends root `tsconfig.base.json`)
- [ ] Create `packages/theme/src/colors.ts` (moved from `apps/mobile/src/theme/colors.ts`)
- [ ] Create `packages/theme/src/spacing.ts`
- [ ] Create `packages/theme/src/typography.ts`
- [ ] Create `packages/theme/src/index.ts` (barrel)
- [ ] Update `apps/mobile/src/theme/index.ts` — re-export from `@pegasus/theme` and delete `colors.ts`
- [ ] Update every mobile import of `../theme/colors` → `@pegasus/theme`
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/theme`
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/mobile`

### Step 3 — Extract @pegasus/api-http

- [ ] Audit all imports of `ApiError` in `packages/web` and `apps/admin` — list any non-client files that import it
- [ ] Write `packages/api-http/src/__tests__/client.test.ts`
      (covers: ApiError shape, 2xx envelope unwrapping, 4xx/5xx throws ApiError, correlation header injected, paginated response)
      — tests must fail (implementation does not exist yet)
- [ ] Write `packages/api-http/src/__tests__/types.test.ts` (assignability checks for SuccessEnvelope, ErrorEnvelope, PaginationMeta)
- [ ] Create `packages/api-http/package.json`
- [ ] Create `packages/api-http/tsconfig.json`
- [ ] Create `packages/api-http/src/types.ts` (SuccessEnvelope, ErrorEnvelope, ApiEnvelope, PaginationMeta)
- [ ] Create `packages/api-http/src/errors.ts` (ApiError class)
- [ ] Create `packages/api-http/src/client.ts` (createApiClient factory)
- [ ] Create `packages/api-http/src/index.ts` (barrel)
- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/api-http` — all tests pass
- [ ] Refactor `packages/web/src/api/client.ts` to delegate to `createApiClient` — no behaviour change
- [ ] Refactor `apps/admin/src/api/client.ts` to delegate to `createApiClient` — no behaviour change
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/web`
- [ ] `node node_modules/.bin/turbo run typecheck --filter=@pegasus/admin-app`
- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/web`
- [ ] `node node_modules/.bin/turbo run test --filter=@pegasus/admin-app`

### Step 4 — Wire apps/mobile into the root test pipeline

- [ ] Update `apps/mobile/jest.config.js` — add `moduleNameMapper` for `@pegasus/*` paths pointing to each package's `src/index.ts`
- [ ] Run `npm test` from repo root — all packages including `@pegasus/mobile` pass

---

## Files to be modified

| File                                 | Change                                           |
| ------------------------------------ | ------------------------------------------------ |
| `DolasApp/` (entire dir)             | Moved to `apps/mobile/` via `git mv`             |
| `apps/mobile/package.json`           | `name` → `@pegasus/mobile`                       |
| `apps/mobile/README.md`              | Heading updated                                  |
| `apps/mobile/src/theme/colors.ts`    | Deleted — replaced by `@pegasus/theme` re-export |
| `apps/mobile/src/theme/index.ts`     | New re-export shim pointing to `@pegasus/theme`  |
| `apps/mobile/jest.config.js`         | Add `moduleNameMapper` for workspace packages    |
| `apps/mobile/src/**` (theme imports) | Update import paths                              |
| `packages/web/src/api/client.ts`     | Delegate internals to `@pegasus/api-http`        |
| `apps/admin/src/api/client.ts`       | Delegate internals to `@pegasus/api-http`        |

## Files to be created

| File                                             | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `packages/theme/package.json`                    | Package manifest (`@pegasus/theme`)                         |
| `packages/theme/tsconfig.json`                   | Extends root base config                                    |
| `packages/theme/src/colors.ts`                   | Colour palette tokens                                       |
| `packages/theme/src/spacing.ts`                  | Spacing scale                                               |
| `packages/theme/src/typography.ts`               | Font size / weight tokens                                   |
| `packages/theme/src/index.ts`                    | Barrel export                                               |
| `packages/theme/src/__tests__/tokens.test.ts`    | Token shape/value tests                                     |
| `packages/api-http/package.json`                 | Package manifest (`@pegasus/api-http`)                      |
| `packages/api-http/tsconfig.json`                | Extends root base config                                    |
| `packages/api-http/src/types.ts`                 | SuccessEnvelope, ErrorEnvelope, ApiEnvelope, PaginationMeta |
| `packages/api-http/src/errors.ts`                | ApiError class                                              |
| `packages/api-http/src/client.ts`                | createApiClient factory                                     |
| `packages/api-http/src/index.ts`                 | Barrel export                                               |
| `packages/api-http/src/__tests__/client.test.ts` | Unit tests (written before implementation)                  |
| `packages/api-http/src/__tests__/types.test.ts`  | Type-level assignability tests                              |

---

## Risks and side effects

- **DolasApp has its own `package-lock.json`** — after moving to `apps/mobile/`, it becomes a workspace member and npm will hoist its deps into the root `node_modules`. Run `npm install` from the root after the move; the nested lock file becomes irrelevant.
- **Expo / Metro resolver** — Metro does not follow symlinks by default. Workspace packages (`@pegasus/theme`, `@pegasus/api-http`) must be listed in `apps/mobile/metro.config.js` under `watchFolders` pointing to `../../packages/theme` etc., and in `resolver.nodeModulesPaths`. This is a required sub-task under Step 2/3.
- **ApiError import consumers** — any file in web or admin that currently does `import { ApiError } from '../api/client'` will need updating to `import { ApiError } from '@pegasus/api-http'` when Step 3 lands. The audit item at the top of Step 3 must be completed before refactoring client.ts.
- **Mobile React version (19.x) vs web (18.x)** — `@pegasus/api-http` and `@pegasus/theme` have no React dependency so this is a non-issue for these packages. Any future `@pegasus/hooks` must declare `peerDependencies: { "react": ">=18" }`.
- **EAS build** — `eas.json` references `./google-service-account.json` by relative path. After the move this file is now at `apps/mobile/google-service-account.json`. EAS builds run from the project root (apps/mobile) so the relative path remains valid — no change needed, but worth confirming before the first EAS build post-rename.

---

## Sharing boundary rules (enforced for all @pegasus/\* packages)

1. No `import` from `react-dom`, `react-native`, `expo-*`, or any platform runtime
2. No `window`, `document`, `navigator`, `sessionStorage`, `localStorage`, `AsyncStorage`
3. No JSX of any kind
4. No CSS modules, Tailwind class strings, or `StyleSheet.create` calls
5. No `console.log` — accept a logger interface if logging is required

## What is explicitly NOT shared

- Routing (`packages/web`: TanStack Router; `apps/mobile`: Expo Router — stays in each app)
- Components (web uses Radix/Tailwind; mobile uses StyleSheet — incompatible without NativeWind/Tamagui)
- Auth session storage (web uses sessionStorage; mobile will use SecureStore — abstracted via injected TokenStorage interface in @pegasus/api-http)
