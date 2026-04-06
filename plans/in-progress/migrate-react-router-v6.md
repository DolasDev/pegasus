# Migrate longhaul app to react-router-dom v6

## Goal

Remove react-router v5 and upgrade all longhaul code to react-router-dom v6, eliminating the need for multiple versions, manual `node_modules` copies, and custom v5 type declarations.

## Context

The longhaul app currently uses react-router-dom v5 patterns (`withRouter`, `Switch`, `Redirect`, `Prompt`, `RouteComponentProps`). npm resolves react-router-dom v6 by default, and fighting hoisting to keep v5 violates our dependency management rule. The code should be migrated to v6 hooks-based API.

## Files to Change

### 1. Package config

- **`apps/longhaul/package.json`** — Change `react-router-dom` to `^6.30.0`, remove `react-router` (v6 bundles it). Remove `history` if present.
- **Remove** manually copied v5 packages from `apps/longhaul/node_modules/` (react-router-dom, react-router, history, tiny-invariant, tiny-warning, path-to-regexp).

### 2. App.tsx — Routing shell (already partially done)

- **`apps/longhaul/src/App.tsx`** — Revert to v6 API:
  - `Switch` → `Routes`
  - `Redirect` → `Navigate`
  - `Route component={X}` → `Route element={<X />}`
  - Import `HashRouter`, `Routes`, `Route`, `Navigate` from `react-router-dom`

### 3. Remove `withRouter` — 4 files

Each component wrapped with `withRouter` needs to replace injected `props.match`, `props.location`, `props.history` with v6 hooks.

- **`apps/longhaul/src/containers/Nav/index.tsx`**
  - Remove `withRouter` wrapper and `RouteComponentProps`
  - Replace `{ location }` prop with `useLocation()` hook
  - Export `Nav` directly as a function component

- **`apps/longhaul/src/containers/Trip/index.tsx`**
  - Remove `withRouter` wrapper
  - Replace `props.match.params.tripId` → `useParams().tripId`
  - Replace `props.history.push(...)` → `useNavigate()` hook
  - Export `Trip` directly

- **`apps/longhaul/src/containers/PendingTrips/index.tsx`**
  - Remove `withRouter` wrapper
  - `PendingTripsInternal` doesn't use route props directly — just remove the wrapper
  - Export `PendingTrips` directly

- **`apps/longhaul/src/routes/PlanningModule.tsx`**
  - Remove `withRouter` wrapper
  - Replace `props.location.search` → `useLocation().search`

### 4. Replace `Prompt` ��� 1 file

- **`apps/longhaul/src/routes/PlanningModule.tsx`**
  - `Prompt` was removed in react-router v6. Replace with `useBlocker()` hook (available in v6.7+) or `window.onbeforeunload` for unsaved-changes guard.
  - `useBlocker` approach:
    ```tsx
    const blocker = useBlocker(shouldBlockNavigation)
    useEffect(() => {
      if (blocker.state === 'blocked') {
        if (window.confirm('You have unsaved changes, are you sure you want to leave?')) {
          blocker.proceed()
        } else {
          blocker.reset()
        }
      }
    }, [blocker])
    ```

### 5. Remove v5 type declarations — 3 files

- **`apps/longhaul/src/types/react-router-dom.d.ts`** — Delete entire file (v6 ships its own types)
- **`apps/longhaul/src/types/react-router.d.ts`** — Delete entire file
- **`apps/longhaul/src/types/react-compat.d.ts`** — Remove the `declare module 'react-router-dom'` and `declare module 'react-router'` blocks (keep the `react` augmentation and `react-modal` block)

### 6. Update tsconfig paths

- **`apps/longhaul/tsconfig.json`** — Remove the `react-router-dom` and `react-router` path overrides from `compilerOptions.paths` (no longer needed since v6 types are compatible with React 19)

## Migration cheat sheet

| v5 pattern                            | v6 replacement                                   |
| ------------------------------------- | ------------------------------------------------ |
| `withRouter(Component)`               | Use hooks directly in component                  |
| `props.match.params.x`                | `const { x } = useParams()`                      |
| `props.location`                      | `const location = useLocation()`                 |
| `props.history.push(path)`            | `const navigate = useNavigate(); navigate(path)` |
| `<Switch>`                            | `<Routes>`                                       |
| `<Route component={X} />`             | `<Route element={<X />} />`                      |
| `<Redirect to="..." />`               | `<Navigate to="..." replace />`                  |
| `<Prompt when={...} message="..." />` | `useBlocker()` hook                              |
| `RouteComponentProps` type            | Remove — use hook return types                   |

## Verification

1. `npm run typecheck` passes (from `apps/longhaul`)
2. `npm run build` passes (from `apps/longhaul`)
3. `npm ls react-router-dom` shows single v6 version, no invalid/extraneous
4. No `react-router` v5 packages in any `node_modules`
5. No remaining imports from custom v5 type declaration files
6. Hash-based routing still works (dev server test)
