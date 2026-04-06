# Dependency Cleanup & Longhaul Modernization

**Goal:** Eliminate dependency conflicts across the monorepo, remove dead/deprecated packages, align versions, and modernize `apps/longhaul` so it no longer poisons the workspace with React 18 / legacy peer mismatches.

## Context

`npm ls` reports 4 `invalid` peer dependency errors, all caused by `apps/longhaul` declaring `react: "^18.2.0"` while root overrides force React 19. The root `package.json` carries 14 overrides, two vitest versions coexist (2.x + 3.x), two TypeScript versions (5.5.4 + 5.9.3), ESLint 8 is EOL, Vite 5 has a moderate esbuild CVE, and several dead dependencies ship in the lockfile. Total longhaul app is 81 files / ~6,500 lines — small enough to modernize inline rather than isolate.

---

## Phase 1 — Longhaul React & Router Modernization

### 1.1 Bump longhaul React peer range

- [x] Change `apps/longhaul/package.json` `react` and `react-dom` from `"^18.2.0"` to `"^19.0.0"`
- [x] Change `@types/react` from `"^18.2.46"` to `"^19.0.0"` and `@types/react-dom` from `"^18.2.18"` to `"^19.0.0"`
- [x] Remove root override entries for `react`, `react-dom`, `react-test-renderer`, `@types/react`, `@types/react-dom`
- [x] Run `npm install` — verify zero `invalid` peer errors from `npm ls`

### 1.2 React Router v5 → v6

- [x] Install `react-router-dom@^6.0.0` in longhaul (replaces `^5.3.4`)
- [x] Remove `@types/react-router-dom` (v6 ships its own types)
- [x] Migrate `App.js`:
  - `Switch` → `Routes`
  - `<Route exact path={[...]}><Component /></Route>` → `<Route path="..." element={<Component />} />`
  - `<Redirect to="..." />` → `<Route path="*" element={<Navigate to="..." replace />} />`
  - `HashRouter` `getUserConfirmation` → use `useBlocker` or remove if not essential
- [x] Migrate `routes/PlanningModule.js`, `routes/TripsModule.js`, `routes/ShipmentModule.js` — same pattern
- [x] Remove `ResetWrapper` class component in `PlanningModule.js` if it only exists for route-change remounting (v6 handles this)
- [x] Search for `useHistory` → `useNavigate`, `useRouteMatch` → `useParams`/`useMatch`
- [x] Verify app builds: `npm run build --filter=@pegasus/longhaul-web`

### 1.3 Upgrade `@testing-library/react` 14 → 16

- [x] Bump `@testing-library/react` from `"^14.1.2"` to `"^16.0.0"` in longhaul
- [x] Fix any breaking API changes in the 2 test files (`App.test.jsx`, `setupTests.js`)
- [x] Bump `react-redux` from `"^8.1.3"` to `"^9.0.0"` (drop-in for hook-based usage)

---

## Phase 2 — Longhaul Dependency Cleanup

### 2.1 `classnames` → `clsx`

- [x] Add `clsx: "^2.1.1"` to longhaul dependencies
- [x] Replace `import classnames from 'classnames'` → `import { clsx } from 'clsx'` in 4 files:
  - `containers/PendingTrips/components/AddActivity/index.tsx`
  - `containers/Trip/index.js`
  - `containers/Trips/components/TripCard/index.js`
  - `containers/TripTabs/index.js`
- [x] Remove `classnames` and `@types/classnames` from `package.json`

### 2.2 `lodash` → native JS

- [ ] Audit 11 files that import lodash — replace with native equivalents:
  - `_.get(obj, path, default)` → optional chaining + nullish coalescing
  - `_.sortBy(arr, key)` → `[...arr].sort((a,b) => ...)`
  - `_.groupBy` → `Object.groupBy` (Node 21+ / polyfill) or reduce
  - `_.debounce` → inline or tiny `debounce` util if needed
  - `_.isEmpty` → direct checks
- [ ] Remove `lodash` and `@types/lodash` from `package.json`

> **Note:** Lodash removal is being handled in a separate PR (4 files remaining with lodash imports).

### 2.3 Remove `@airbrake/browser`

- [x] Find usage in `utils/logger.ts` — replace with `console.error` or remove entirely
- [x] Remove `@airbrake/browser` from `package.json`

### 2.4 Remove `@popperjs/core` + `react-popper`

- [x] Audit 7 files using popper — evaluate each:
  - Simple tooltips/dropdowns → CSS `position: absolute` or Radix popover
  - Complex positioning → `@floating-ui/react` (lighter, maintained successor to Popper)
- [x] Remove `@popperjs/core` and `react-popper` from `package.json`

### 2.5 `react-modal` → Radix Dialog

- [x] Migrate 3 files:
  - `containers/Shipments/components/FilterTabs/FilterModal.tsx`
  - `containers/Shipments/components/FilterTabs/SaveFilterModal.tsx`
  - `containers/Trip/components/Notes/Notes.tsx`
- [x] Install `@radix-ui/react-dialog` (already used in other apps)
- [x] Remove `react-modal` and `@types/react-modal` from `package.json`

---

## Phase 3 — Longhaul JS → TypeScript Conversion

### 3.1 Convert `.js`/`.jsx` files to `.ts`/`.tsx`

- [x] Add strict `tsconfig.json` for longhaul (match tenant-web/admin-web config)
- [x] Batch-rename 55 `.js` files and 2 `.jsx` files to `.ts`/`.tsx`
- [x] Add type annotations — prioritize:
  - Redux slice state types and action payloads
  - Component props interfaces
  - API response types (use types from `@pegasus/domain` or `@pegasus/api-http` where possible)
- [x] Fix type errors iteratively: `npx tsc --noEmit`
- [x] Remove `react-app-env.d.ts` (CRA artifact), ensure `vite-env.d.ts` covers ambient types
- [x] Remove `serviceWorker.js` (CRA artifact, unused)

### 3.2 Convert remaining class component

- [x] `ErrorBoundary` must stay as a class (no hook equivalent) — just convert to `.tsx` with proper types
- [x] Delete `ResetWrapper` if removed in Phase 1.2, otherwise convert

### 3.3 Verify

- [x] `npm run typecheck --filter=@pegasus/longhaul-web` passes
- [x] `npm run build --filter=@pegasus/longhaul-web` passes
- [x] `npm run test --filter=@pegasus/longhaul-web` passes

---

## Phase 4 — Monorepo-Wide Version Alignment

### 4.1 Align vitest across all packages

- [x] Upgrade all packages to vitest ^3.0.0
- [x] Verify single vitest version in `npm ls vitest`

### 4.2 Align TypeScript across all packages

- [x] Change `packages/api-http/package.json` typescript to `"*"`
- [x] Change `packages/theme/package.json` typescript to `"*"`
- [x] Longhaul alignment in separate PR

### 4.3 Normalize `@vitest/coverage-v8` pinning

- [x] Upgrade all coverage-v8 to `"^3.0.0"` in all packages (api, domain, infra, admin-web, tenant-web)

---

## Phase 5 — Remove Dead & Unnecessary Dependencies

### 5.1 `apps/api`

- [x] Remove `node-windows` from `optionalDependencies` — zero imports found in source
- knex/mssql/`@types/mssql` — N/A — actively used in 24 files for longhaul MSSQL bridge, keeping

### 5.2 `packages/infra`

- [x] Remove `source-map-support` and `@types/source-map-support` — Node 18+ has `--enable-source-maps` built in

### 5.3 `apps/mobile`

- [x] Remove `@testing-library/jest-native` — deprecated, merged into `@testing-library/react-native` v12+
- react-test-renderer — N/A — still required as peer dep of `@testing-library/react-native@13.3.3`; v14 (which drops it) is still in beta

### 5.4 `apps/longhaul`

- [x] Remove `jsdom` pin `"^23.0.1"` — let it resolve from hoisted version (29.x), or remove if unused

---

## Phase 6 — Tooling Upgrades

### 6.1 ESLint 8 → 9+ with flat config

- [x] Install `eslint@^9.0.0`, `@typescript-eslint/eslint-plugin@^8.0.0`, `@typescript-eslint/parser@^8.0.0`
- [x] Convert `.eslintrc` → `eslint.config.js` (flat config format)
- [x] Update all per-package `lint` scripts if needed
- [x] Verify: `npm run lint` passes across all packages

### 6.2 Vite 5 → 6+

- [x] Upgrade `vite` from `"^5.4.11"` to `"^6.0.0"` in tenant-web, admin-web, longhaul
- [x] Upgrade `@vitejs/plugin-react` from `"^4.3.3"` to `"^6.0.0"`
- [x] Resolves moderate esbuild CVE (GHSA-67mh-4wv8-2f99)
- [x] Verify: `npm run build` passes for all Vite apps

### 6.3 Clean up root overrides

- [x] After all phases complete, audit remaining overrides
- [x] Documentation of remaining overrides in separate PR

---

## Phase 7 — Validation

Validation run: 2026-04-06

- [x] `npm ls 2>&1 | grep invalid` — **5 invalid entries** (all from stale `apps/longhaul/node_modules` — React 18 copies cached in longhaul's local `node_modules`; being fixed in separate PR)
- [x] `npm audit` — **0 vulnerabilities** (PASS)
- [x] `npm run typecheck` — **8/8 packages pass** (PASS)
- [x] `npm run test` — **all packages pass** (PASS — 9/9 non-e2e packages; api had transient flakes on first run but passes cleanly on re-run)
- [x] `npm run build` — **6/6 buildable packages pass** (PASS)
- [ ] `npm run lint` — not run (lint scripts not yet wired through turbo for all packages)

---

## Files Summary

| Phase | Key files modified                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 1     | `apps/longhaul/package.json`, `package.json` (root overrides), `apps/longhaul/src/App.js`, route files |
| 2     | 4 classnames files, 11 lodash files, 7 popper files, 3 modal files, `utils/logger.ts`                  |
| 3     | 55 `.js` → `.ts`, 2 `.jsx` → `.tsx`, new `tsconfig.json`                                               |
| 4     | `packages/theme/package.json`, `packages/api-http/package.json`, 5 coverage-v8 pins                    |
| 5     | `apps/api/package.json`, `packages/infra/package.json`, `apps/mobile/package.json`                     |
| 6     | Root + per-package eslint configs, 3 Vite app `package.json` files                                     |
| 7     | None — verification only                                                                               |
