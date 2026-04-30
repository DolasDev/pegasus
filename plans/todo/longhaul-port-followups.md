# Long Haul Port — Deferred Features

Tracker for features stubbed out during the port of `apps/longhaul`'s
Planning + Dispatch UI into `apps/tenant-web/src/features/driver-planning/`.
Each item is searchable in the codebase via `TODO(longhaul-port)`.

## Stubbed in this phase

- [ ] **`API.jumpToOrder` / `pegasusRemoteFunctionCall`** —
      `apps/tenant-web/src/features/driver-planning/utils/api/index.ts`.
      Originally shelled out to the on-prem WinForms client to open an order
      by `order_num`. Currently shows an alert. Needs a cloud equivalent —
      either a tenant-web move/order detail route or a cloud-side deeplink
      protocol the legacy app can register against.

- [ ] **Unsaved-changes navigation prompt in `PlanningModule`** —
      `apps/tenant-web/src/features/driver-planning/utils/router-compat.tsx`
      `useBlocker`. The legacy code prompted with `window.confirm` when the
      user tried to navigate away from the Planning page with unsaved trip
      edits. The shim is a no-op because react-router's blocker can't see
      TanStack Router navigations. Reimplement with TanStack Router's own
      `useBlocker` hook so cross-app nav (e.g. tenant sidebar) is also caught.

- [ ] **Redux → React Query migration** — out of scope for this phase per
      user direction. The whole `features/driver-planning/redux/` tree is
      ported as-is. Plan a follow-up phase to migrate slices to TanStack
      Query so Driver Planning matches the rest of tenant-web's data layer.

- [ ] **Tailwind/shadcn restyling** — also out of scope. The feature
      ships with the original CSS modules + scoped global stylesheet
      (`features/driver-planning/styles.css`). Re-skin once functionality is
      verified.

- [ ] **Delete `apps/longhaul`** — left in place for the verification
      window. Once the cloud port is confirmed working in production, remove
      the standalone Vite app and its CI/deploy entries.

- [ ] **`redux/nav` slice cleanup** — the legacy top-nav was replaced by
      `DriverPlanningTabs`, but the `nav` reducer is still wired into the
      store. Drop it once any lingering selectors are removed.

- [ ] **`vendor.d.ts` shims** — `redux-logger` and `react-modal` are
      declared but not actually used in the ported code. Trim the shim file
      in `apps/tenant-web/src/features/driver-planning/types/vendor.d.ts`
      once the rest of the cleanup lands.
