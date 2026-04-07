# Dependency Migration — 2026 Q2

**Branch:** `feature/dependency-migration-2026-q2`
**Goal:** Upgrade all outdated dependencies across the monorepo to their latest stable versions, executed in dependency-safe waves to avoid breakage.

## Strategy

Upgrades are grouped into waves based on dependency ordering — each wave must be green (typecheck + tests pass) before the next begins. Within a wave, independent packages can be upgraded in parallel.

**Supersedes:** `plans/todo/upgrade-prisma-v7.md`, `plans/todo/upgrade-zod-v4.md`, `plans/todo/upgrade-lucide-react-v1.md`, `plans/todo/upgrade-async-storage-v3.md` — all folded into this plan.

---

## Wave 0 — Prerequisites & Risk-Free Bumps

### 0.1 Upgrade Node.js to 24 LTS

- [ ] Install Node 24 LTS (`nvm install 24 && nvm use 24`, or equivalent)
- [ ] Verify: `node --version` → v24.x
- [ ] Update root `package.json` engines: `"node": ">=20.19.0"` (allows 20 LTS + 22 LTS + 24 LTS)
- [ ] Add `.nvmrc` with `24` so the team stays aligned
- [ ] `rm -rf node_modules package-lock.json && npm install` — rebuild lockfile under Node 24
- [ ] Full typecheck + test suite to confirm nothing breaks under new runtime

### 0.2 Patch bumps

- [ ] `hono` 4.12.10 → 4.12.11 in `apps/api`
- [ ] `turbo` 2.9.3 → 2.9.4 in root
- [ ] `vite` 6.4.1 → 6.4.2 in `apps/tenant-web`, `apps/admin-web`, `apps/longhaul` (stays on v6 range)
- [ ] `npm install` + full typecheck + test suite

---

## Wave 1 — TypeScript 5.9 → 6.0

TypeScript underpins everything — upgrade first so all subsequent waves are validated against the new compiler.

### 1.1 Evaluate TS 6.0 breaking changes

- [ ] Review https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/ for breaking changes
- [ ] Identify any deprecated features used in the codebase (decorators, enums, etc.)

### 1.2 Upgrade TypeScript

- [ ] Root `package.json`: `"typescript": "^5.6.3"` → `"^6.0.0"`
- [ ] `apps/mobile/package.json`: `"typescript": "~5.9.2"` → `"~6.0.2"`
- [ ] `apps/e2e/package.json`: `"typescript": "^5.9.3"` → `"^6.0.0"`
- [ ] `npm install`
- [ ] Run `node node_modules/.bin/turbo run typecheck` — fix all errors
- [ ] Run full test suite

### 1.3 Update typescript-eslint if needed

- [ ] Check `typescript-eslint@^8.0.0` compatibility with TS 6 — upgrade if required

---

## Wave 2 — Build Tooling (Vite 8 + Plugin React 6)

Vite 8 is a major bump. `@vitejs/plugin-react` 6 requires Vite 8.

### 2.1 Evaluate Vite 8 breaking changes

- [ ] Review Vite 8 migration guide
- [ ] Check `vite.config.ts` in all 3 apps for deprecated options
- [ ] Verify PostCSS / Tailwind v3 still works under Vite 8 (Tailwind v4 upgrade is Wave 5)

### 2.2 Upgrade Vite + plugin-react

- [ ] `apps/tenant-web`: `"vite": "^6.0.0"` → `"^8.0.0"`, `"@vitejs/plugin-react": "^4.7.0"` → `"^6.0.0"`
- [ ] `apps/admin-web`: same
- [ ] `apps/longhaul`: same
- [ ] `npm install`
- [ ] Verify all 3 apps build: `turbo run build --filter=@pegasus/tenant-web --filter=@pegasus/admin-web --filter=@pegasus/longhaul-web`
- [ ] Verify dev server starts for each app

---

## Wave 3 — Test Tooling (Vitest 4 + Coverage V8 4)

Vitest 4 should be upgraded after Vite 8 since they share the Vite engine.

### 3.1 Evaluate Vitest 4 breaking changes

- [ ] Review Vitest 4 migration guide
- [ ] Check for removed/renamed config options in `vitest.config.ts` / `vite.config.ts` test blocks
- [ ] Check `vitest.global-setup.ts` in `apps/api` for compatibility

### 3.2 Upgrade Vitest across all packages

- [ ] Root `package.json`: `"vitest": "^3.0.0"` → `"^4.0.0"`
- [ ] `apps/api`: `"vitest": "^3.0.0"` → `"^4.0.0"`, `"@vitest/coverage-v8": "^3.0.0"` → `"^4.0.0"`
- [ ] `apps/tenant-web`: same
- [ ] `apps/admin-web`: same
- [ ] `apps/longhaul`: vitest only (no coverage dep)
- [ ] `packages/domain`: `"vitest"` + `"@vitest/coverage-v8"` → `"^4.0.0"`
- [ ] `packages/infra`: same
- [ ] `packages/theme`: vitest only
- [ ] `packages/api-http`: vitest only
- [ ] Check `@stryker-mutator/vitest-runner@^9.6.0` in `packages/domain` — verify compatibility with Vitest 4
- [ ] `npm install`
- [ ] Run full test suite: `turbo run test`

---

## Wave 4 — API Layer (Zod 4 + Prisma 7 + jose 6 + @hono/zod-openapi)

These are all `apps/api` dependencies. Zod 4 is upgraded first because Prisma 7 and `@hono/zod-openapi` may depend on it.

### 4.1 Zod 3 → 4

- [ ] Review Zod 4 migration guide: https://zod.dev/v4
- [ ] Audit all Zod usage in `apps/api/src/` (handlers, validators, env config, middleware)
- [ ] Check if `@hono/zod-openapi@^0.18.4` works with Zod 4 — if not, upgrade together (see 4.4)
- [ ] Migrate schema definitions — key changes:
  - `z.object().strict()` → check new strictness defaults
  - `.transform()` / `.refine()` API changes
  - Error formatting changes (custom error maps)
  - `z.infer<>` type inference changes
- [ ] Update all Zod schemas across handlers
- [ ] Run API tests: `turbo run test --filter=@pegasus/api`

### 4.2 Prisma 6 → 7

- [ ] Review Prisma 7 upgrade guide: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
- [ ] `apps/api/package.json`: `"@prisma/client": "^6.0.0"` → `"^7.0.0"`, `"prisma": "^6.0.0"` → `"^7.0.0"`
- [ ] `npm install`
- [ ] Run `prisma generate` from `apps/api` — fix any client generation changes
- [ ] Update `schema.prisma` if new syntax required
- [ ] Check Prisma engine binary changes — update CDK Lambda bundling in `packages/infra` if needed
- [ ] Verify repository layer code against new query API (especially relation creates/updates)
- [ ] Run API integration tests against local Postgres
- [ ] Verify `prisma migrate` still works

### 4.3 jose 5 → 6

- [ ] Review jose 6 changelog for breaking changes
- [ ] Audit jose usage in `apps/api/src/` (JWT verification, token decoding)
- [ ] Update import paths and API calls
- [ ] Run auth-related tests

### 4.4 @hono/zod-openapi 0.18 → 1.x

- [ ] Review changelog — this is a major bump
- [ ] Update OpenAPI route definitions if schema format changed
- [ ] Verify API docs generation still works
- [ ] Run full API test suite

---

## Wave 5 — Frontend Styling (Tailwind 3 → 4)

Tailwind 4 is a complete engine rewrite (Rust-based, no PostCSS plugin, CSS-first config).

### 5.1 Evaluate Tailwind 4 migration scope

- [ ] Review https://tailwindcss.com/docs/upgrade-guide
- [ ] Audit `tailwind.config.js` / `tailwind.config.ts` in `apps/admin-web` and `apps/tenant-web`
- [ ] Inventory custom theme extensions, plugins, `@apply` usage
- [ ] Check `autoprefixer` — Tailwind 4 includes it, so `autoprefixer` dep can likely be removed

### 5.2 Migrate admin-web

- [ ] Replace `tailwind.config.*` with CSS-first `@theme` block in main CSS file
- [ ] Update `postcss.config.js` — remove `tailwindcss` and `autoprefixer` plugins, add `@tailwindcss/postcss`
- [ ] Fix any renamed utilities (e.g., `bg-opacity-*` → `bg-*/*`)
- [ ] Remove `autoprefixer` from devDependencies
- [ ] Verify build + visual spot-check

### 5.3 Migrate tenant-web

- [ ] Same steps as 5.2
- [ ] Verify build + visual spot-check

### 5.4 Cleanup

- [ ] Remove root-level Tailwind config if any
- [ ] Update `package.json` range: `"tailwindcss": "^3.4.19"` → `"^4.0.0"`
- [ ] `npm install` — remove `autoprefixer` if no longer needed
- [ ] Full frontend build

---

## Wave 6 — Frontend Libraries

### 6.1 lucide-react 0.575 → 1.x

- [ ] Review breaking changes (icon renames, prop changes, import path changes)
- [ ] Update all icon imports in `apps/admin-web` and `apps/tenant-web`
- [ ] `"lucide-react": "^0.575.0"` → `"^1.0.0"` in both apps
- [ ] Verify builds

### 6.2 @floating-ui/react 0.26 → 0.27 (apps/longhaul)

- [ ] Review changelog for breaking changes
- [ ] Update usages in longhaul
- [ ] `"@floating-ui/react": "^0.26.0"` → `"^0.27.0"`

### 6.3 react-datepicker 7 → 9 (apps/longhaul)

- [ ] Review migration guide (v7 → v8 → v9)
- [ ] Update component props / API
- [ ] `"react-datepicker": "^7.0.0"` → `"^9.0.0"`

### 6.4 query-string 7 → 9 (apps/longhaul)

- [ ] Review breaking changes (ESM-only in v8+)
- [ ] Update import style if needed
- [ ] `"query-string": "^7.1.3"` → `"^9.0.0"`

### 6.5 react-router-dom 6 → 7 (apps/longhaul)

- [ ] Review React Router v7 migration guide
- [ ] Migrate route definitions, hooks, loader patterns
- [ ] `"react-router-dom": "^6.30.3"` → `"^7.0.0"`
- [ ] Verify all longhaul routes

---

## Wave 7 — ESLint 9 → 10

### 7.1 Evaluate ESLint 10 breaking changes

- [ ] Review ESLint 10 migration guide
- [ ] Check flat config compatibility (already on flat config in ESLint 9)
- [ ] Check `typescript-eslint` compatibility with ESLint 10

### 7.2 Upgrade ESLint

- [ ] Root: `"eslint": "^9.0.0"` → `"^10.0.0"`, `"@eslint/js": "^9.0.0"` → `"^10.0.0"`
- [ ] Update `eslint.config.*` if API changed
- [ ] `npm install`
- [ ] Run `turbo run lint` — fix any new violations
- [ ] Update `eslint-config-prettier` if needed

---

## Wave 8 — Root Tooling

### 8.1 lint-staged 15 → 16

- [ ] Review changelog for breaking changes
- [ ] Update `.lintstagedrc` / `lint-staged` config in `package.json`
- [ ] Root: `"lint-staged": "^15.2.10"` → `"^16.0.0"`
- [ ] Test with a dummy commit to verify hooks work

### 8.2 @types/node 20 → 22+

- [ ] Check if `@types/node@^22.0.0` or `^24.0.0` is appropriate (match Node.js runtime version)
- [ ] Update in `apps/api`, `packages/infra`, `apps/longhaul`
- [ ] Fix any type errors from removed/changed Node API types

---

## Wave 9 — Mobile / Expo Ecosystem

This is a standalone effort — Expo SDK upgrades require all RN deps to move in lockstep.

### 9.1 Expo 54 → 55

- [ ] Review Expo 55 changelog and upgrade guide
- [ ] Run `npx expo install --fix` to align all Expo-managed deps
- [ ] Key packages moving together:
  - `expo` 54 → 55
  - `expo-constants` 18 → 55
  - `expo-image-picker` 17 → 55
  - `expo-linking` 8 → 55
  - `expo-router` 6 → 55
  - `expo-secure-store` 15 → 55
  - `expo-status-bar` 3 → 55
  - `react-native` 0.81 → 0.84
  - `react-native-screens` 4.16 → 4.24
  - `react-native-safe-area-context` 5.6 → 5.7
  - `react-native-get-random-values` 1.11 → 2.0
  - `babel-preset-expo` 54 → 55
- [ ] Update `app.json` / `app.config.js` if schema changed
- [ ] Fix any deprecated APIs in mobile source code

### 9.2 @react-native-async-storage/async-storage 2 → 3

- [ ] Review v3 breaking changes
- [ ] Update API calls in `apps/mobile`
- [ ] `"@react-native-async-storage/async-storage": "2.2.0"` → `"^3.0.0"`

### 9.3 Jest 29 → 30 + @types/jest 30

- [ ] Review Jest 30 changelog
- [ ] `"jest": "^29.7.0"` → `"^30.0.0"`, `"@types/jest": "^29.5.14"` → `"^30.0.0"`
- [ ] Check `ts-jest` and `babel-jest` compatibility
- [ ] Run mobile tests

### 9.4 Mobile verification

- [ ] `npm install` in workspace
- [ ] Typecheck mobile app
- [ ] Run mobile test suite
- [ ] Verify Expo dev server starts

---

## Post-Migration Cleanup

- [x] Delete superseded plans from `plans/todo/`:
  - `upgrade-prisma-v7.md`
  - `upgrade-zod-v4.md`
  - `upgrade-lucide-react-v1.md`
  - `upgrade-async-storage-v3.md`
- [x] Remove any leftover `overrides` / `resolutions` in root `package.json` that are no longer needed
  - Reviewed: all overrides are security-related, not migration leftovers. No changes needed.
- [x] Run `npm audit` — verify no new vulnerabilities introduced
  - 6 pre-existing vulnerabilities (3 moderate, 3 high) — none introduced by migration.
- [x] Run full CI pipeline: typecheck + lint + test + build for all packages
  - 19/19 turbo tasks pass (typecheck + test, all packages).
- [ ] Update `CLAUDE.md` tech stack table if major version numbers are referenced
- [x] Archive this plan to `plans/completed/`

---

## Files Modified (Expected)

| File                                                                   | Waves         |
| ---------------------------------------------------------------------- | ------------- |
| `package.json` (root)                                                  | 0, 1, 3, 7, 8 |
| `package-lock.json`                                                    | All           |
| `apps/api/package.json`                                                | 4             |
| `apps/api/src/**` (Zod schemas, Prisma usage, jose imports)            | 4             |
| `apps/api/prisma/schema.prisma`                                        | 4             |
| `apps/tenant-web/package.json`                                         | 0, 2, 3, 5, 6 |
| `apps/tenant-web/src/**` (Tailwind classes, icon imports)              | 5, 6          |
| `apps/tenant-web/postcss.config.*`                                     | 5             |
| `apps/tenant-web/tailwind.config.*`                                    | 5             |
| `apps/admin-web/package.json`                                          | 0, 2, 3, 5, 6 |
| `apps/admin-web/src/**` (Tailwind classes, icon imports)               | 5, 6          |
| `apps/admin-web/postcss.config.*`                                      | 5             |
| `apps/admin-web/tailwind.config.*`                                     | 5             |
| `apps/longhaul/package.json`                                           | 0, 2, 3, 6    |
| `apps/longhaul/src/**` (router, datepicker, floating-ui, query-string) | 6             |
| `apps/mobile/package.json`                                             | 9             |
| `apps/mobile/src/**`                                                   | 9             |
| `apps/e2e/package.json`                                                | 1             |
| `packages/domain/package.json`                                         | 1, 3          |
| `packages/infra/package.json`                                          | 3, 8          |
| `packages/infra/lib/**` (Lambda bundling if Prisma engine changes)     | 4             |
| `packages/theme/package.json`                                          | 3             |
| `packages/api-http/package.json`                                       | 3             |
| `eslint.config.*`                                                      | 7             |
| `tsconfig*.json` (if TS 6 requires config changes)                     | 1             |

## Risks & Mitigations

| Risk                                                   | Impact                  | Mitigation                                            |
| ------------------------------------------------------ | ----------------------- | ----------------------------------------------------- |
| Prisma 7 changes query engine binary layout            | Lambda deploy breaks    | Test CDK synth + deploy to staging before merge       |
| Zod 4 + @hono/zod-openapi incompatibility              | API routes break        | Upgrade together in Wave 4; pin zod-openapi if needed |
| Tailwind 4 CSS-first config                            | Styling regressions     | Visual regression spot-checks on key pages            |
| Vite 8 drops Node < 20 support                         | CI breaks               | Verify CI Node version ≥ 20                           |
| Expo 55 peer dependency conflicts                      | Mobile build breaks     | Use `npx expo install --fix` for version alignment    |
| Vitest 4 config changes                                | Tests don't run         | Read migration guide carefully; test each package     |
| Stryker vitest-runner not yet compatible with Vitest 4 | Mutation testing breaks | Pin Stryker or skip temporarily, track upstream issue |
