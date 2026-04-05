# Dependency Cleanup & Longhaul Modernization

**Goal:** Eliminate dependency conflicts across the monorepo, remove dead/deprecated packages, align versions, and modernize `apps/longhaul` so it no longer poisons the workspace with React 18 / legacy peer mismatches.

## Context

`npm ls` reports 4 `invalid` peer dependency errors, all caused by `apps/longhaul` declaring `react: "^18.2.0"` while root overrides force React 19. The root `package.json` carries 14 overrides, two vitest versions coexist (2.x + 3.x), two TypeScript versions (5.5.4 + 5.9.3), ESLint 8 is EOL, Vite 5 has a moderate esbuild CVE, and several dead dependencies ship in the lockfile. Total longhaul app is 81 files / ~6,500 lines — small enough to modernize inline rather than isolate.

---

## Phase 1 — Longhaul React & Router Modernization

### 1.1 Bump longhaul React peer range
- [ ] Change `apps/longhaul/package.json` `react` and `react-dom` from `"^18.2.0"` to `"^19.0.0"`
- [ ] Change `@types/react` from `"^18.2.46"` to `"^19.0.0"` and `@types/react-dom` from `"^18.2.18"` to `"^19.0.0"`
- [ ] Remove root override entries for `react`, `react-dom`, `react-test-renderer`, `@types/react`, `@types/react-dom`
- [ ] Run `npm install` — verify zero `invalid` peer errors from `npm ls` 

### 1.2 React Router v5 → v6
- [ ] Install `react-router-dom@^6.0.0` in longhaul (replaces `^5.3.4`)
- [ ] Remove `@types/react-router-dom` (v6 ships its own types)
- [ ] Migrate `App.js`:
  - `Switch` → `Routes`
  - `<Route exact path={[...]}><Component /></Route>` → `<Route path="..." element={<Component />} />`
  - `<Redirect to="..." />` → `<Route path="*" element={<Navigate to="..." replace />} />`
  - `HashRouter` `getUserConfirmation` → use `useBlocker` or remove if not essential
- [ ] Migrate `routes/PlanningModule.js`, `routes/TripsModule.js`, `routes/ShipmentModule.js` — same pattern
- [ ] Remove `ResetWrapper` class component in `PlanningModule.js` if it only exists for route-change remounting (v6 handles this)
- [ ] Search for `useHistory` → `useNavigate`, `useRouteMatch` → `useParams`/`useMatch`
- [ ] Verify app builds: `npm run build --filter=@pegasus/longhaul-web`

### 1.3 Upgrade `@testing-library/react` 14 → 16
- [ ] Bump `@testing-library/react` from `"^14.1.2"` to `"^16.0.0"` in longhaul
- [ ] Fix any breaking API changes in the 2 test files (`App.test.jsx`, `setupTests.js`)
- [ ] Bump `react-redux` from `"^8.1.3"` to `"^9.0.0"` (drop-in for hook-based usage)

---

## Phase 2 — Longhaul Dependency Cleanup

### 2.1 `classnames` → `clsx`
- [ ] Add `clsx: "^2.1.1"` to longhaul dependencies
- [ ] Replace `import classnames from 'classnames'` → `import { clsx } from 'clsx'` in 4 files:
  - `containers/PendingTrips/components/AddActivity/index.tsx`
  - `containers/Trip/index.js`
  - `containers/Trips/components/TripCard/index.js`
  - `containers/TripTabs/index.js`
- [ ] Remove `classnames` and `@types/classnames` from `package.json`

### 2.2 `lodash` → native JS
- [ ] Audit 11 files that import lodash — replace with native equivalents:
  - `_.get(obj, path, default)` → optional chaining + nullish coalescing
  - `_.sortBy(arr, key)` → `[...arr].sort((a,b) => ...)`
  - `_.groupBy` → `Object.groupBy` (Node 21+ / polyfill) or reduce
  - `_.debounce` → inline or tiny `debounce` util if needed
  - `_.isEmpty` → direct checks
- [ ] Remove `lodash` and `@types/lodash` from `package.json`

### 2.3 Remove `@airbrake/browser`
- [ ] Find usage in `utils/logger.ts` — replace with `console.error` or remove entirely
- [ ] Remove `@airbrake/browser` from `package.json`

### 2.4 Remove `@popperjs/core` + `react-popper`
- [ ] Audit 7 files using popper — evaluate each:
  - Simple tooltips/dropdowns → CSS `position: absolute` or Radix popover
  - Complex positioning → `@floating-ui/react` (lighter, maintained successor to Popper)
- [ ] Remove `@popperjs/core` and `react-popper` from `package.json`

### 2.5 `react-modal` → Radix Dialog
- [ ] Migrate 3 files:
  - `containers/Shipments/components/FilterTabs/FilterModal.tsx`
  - `containers/Shipments/components/FilterTabs/SaveFilterModal.tsx`
  - `containers/Trip/components/Notes/Notes.tsx`
- [ ] Install `@radix-ui/react-dialog` (already used in other apps)
- [ ] Remove `react-modal` and `@types/react-modal` from `package.json`

---

## Phase 3 — Longhaul JS → TypeScript Conversion

### 3.1 Convert `.js`/`.jsx` files to `.ts`/`.tsx`
- [ ] Add strict `tsconfig.json` for longhaul (match tenant-web/admin-web config)
- [ ] Batch-rename 55 `.js` files and 2 `.jsx` files to `.ts`/`.tsx`
- [ ] Add type annotations — prioritize:
  - Redux slice state types and action payloads
  - Component props interfaces
  - API response types (use types from `@pegasus/domain` or `@pegasus/api-http` where possible)
- [ ] Fix type errors iteratively: `npx tsc --noEmit`
- [ ] Remove `react-app-env.d.ts` (CRA artifact), ensure `vite-env.d.ts` covers ambient types
- [ ] Remove `serviceWorker.js` (CRA artifact, unused)

### 3.2 Convert remaining class component
- [ ] `ErrorBoundary` must stay as a class (no hook equivalent) — just convert to `.tsx` with proper types
- [ ] Delete `ResetWrapper` if removed in Phase 1.2, otherwise convert

### 3.3 Verify
- [ ] `npm run typecheck --filter=@pegasus/longhaul-web` passes
- [ ] `npm run build --filter=@pegasus/longhaul-web` passes
- [ ] `npm run test --filter=@pegasus/longhaul-web` passes

---

## Phase 4 — Monorepo-Wide Version Alignment

### 4.1 Align vitest across all packages
- [ ] Change `packages/theme/package.json` vitest from `"^3.0.0"` to `"^2.1.8"` (match everything else)
  - OR upgrade all packages to vitest 3.x if no breaking changes found
- [ ] Verify single vitest version in `npm ls vitest`

### 4.2 Align TypeScript across all packages
- [ ] Change `packages/api-http/package.json` typescript from `"~5.5.4"` to `"*"`
- [ ] Change `packages/theme/package.json` typescript from `"~5.5.4"` to `"*"`
- [ ] Verify single TS version in `npm ls typescript`

### 4.3 Normalize `@vitest/coverage-v8` pinning
- [ ] Change exact pin `"2.1.9"` to `"^2.1.8"` in all packages (api, domain, infra, admin-web, tenant-web)
  - Ensures coverage plugin stays in sync with vitest semver range

---

## Phase 5 — Remove Dead & Unnecessary Dependencies

### 5.1 `apps/api`
- [ ] Remove `node-windows` from `optionalDependencies` — zero imports found in source
- [ ] Evaluate `knex` + `mssql` + `@types/mssql` — these serve the longhaul legacy MSSQL bridge
  - If legacy bridge is still needed: keep, but document why
  - If migration is complete: remove all three

### 5.2 `packages/infra`
- [ ] Remove `source-map-support` and `@types/source-map-support` — Node 18+ has `--enable-source-maps` built in

### 5.3 `apps/mobile`
- [ ] Remove `@testing-library/jest-native` — deprecated, merged into `@testing-library/react-native` v12+
- [ ] Remove `react-test-renderer` — deprecated in React 19, use `@testing-library/react-native` instead

### 5.4 `apps/longhaul`
- [ ] Remove `jsdom` pin `"^23.0.1"` — let it resolve from hoisted version (29.x), or remove if unused

---

## Phase 6 — Tooling Upgrades

### 6.1 ESLint 8 → 9+ with flat config
- [ ] Install `eslint@^9.0.0`, `@typescript-eslint/eslint-plugin@^8.0.0`, `@typescript-eslint/parser@^8.0.0`
- [ ] Convert `.eslintrc` → `eslint.config.js` (flat config format)
- [ ] Update all per-package `lint` scripts if needed
- [ ] Verify: `npm run lint` passes across all packages

### 6.2 Vite 5 → 6+
- [ ] Upgrade `vite` from `"^5.4.11"` to `"^6.0.0"` in tenant-web, admin-web, longhaul
- [ ] Upgrade `@vitejs/plugin-react` from `"^4.3.3"` to `"^6.0.0"`
- [ ] Resolves moderate esbuild CVE (GHSA-67mh-4wv8-2f99)
- [ ] Verify: `npm run build` passes for all Vite apps

### 6.3 Clean up root overrides
- [ ] After all phases complete, audit remaining overrides
- [ ] Remove any overrides that are no longer necessary (React ones gone after Phase 1)
- [ ] Keep legitimate security overrides (`handlebars`, `undici`, etc.) — add comments explaining why

---

## Phase 7 — Validation

- [ ] `npm install` — clean, no peer warnings
- [ ] `npm ls 2>&1 | grep invalid` — zero results
- [ ] `npm audit` — zero moderate+ vulnerabilities
- [ ] `npm run typecheck` — passes all packages
- [ ] `npm run test` — passes all packages
- [ ] `npm run build` — passes all packages
- [ ] `npm run lint` — passes all packages

---

## Files Summary

| Phase | Key files modified |
|-------|-------------------|
| 1 | `apps/longhaul/package.json`, `package.json` (root overrides), `apps/longhaul/src/App.js`, route files |
| 2 | 4 classnames files, 11 lodash files, 7 popper files, 3 modal files, `utils/logger.ts` |
| 3 | 55 `.js` → `.ts`, 2 `.jsx` → `.tsx`, new `tsconfig.json` |
| 4 | `packages/theme/package.json`, `packages/api-http/package.json`, 5 coverage-v8 pins |
| 5 | `apps/api/package.json`, `packages/infra/package.json`, `apps/mobile/package.json` |
| 6 | Root + per-package eslint configs, 3 Vite app `package.json` files |
| 7 | None — verification only |
