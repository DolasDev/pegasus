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

- [x] **Unsaved-changes navigation prompt in `PlanningModule`** —
      `apps/tenant-web/src/features/driver-planning/utils/router-compat.tsx`
      `useBlocker` now delegates to TanStack Router's `useBlocker` with
      `withResolver: true`, mapping its `idle` / `blocked` status onto the
      legacy `BlockerState` shape. Cross-app navigations (tenant sidebar) and
      `beforeunload` are caught when there are unsaved trip edits.

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

- [x] **`redux/nav` slice cleanup** — `redux/nav/` directory removed and
      its reducer dropped from `redux/store.ts` and the test-only
      `__test-utils__/render-with-store.tsx`. No remaining references.

- [x] **`vendor.d.ts` shims** — `redux-logger` declaration removed from
      `types/vendor.d.ts`. Unused `react-modal` declarations also dropped
      (`types/react-modal.d.ts` deleted; `react-modal` augmentation removed
      from `types/react-compat.d.ts`).
