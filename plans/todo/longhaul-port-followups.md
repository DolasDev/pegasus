# Long Haul Port — Deferred Features

Tracker for features stubbed out during the port of `apps/longhaul`'s
Planning + Dispatch UI into `apps/tenant-web/src/features/driver-planning/`.

> **Sweep 2026-05-30:** `grep -rn "TODO(longhaul-port)"` returns zero hits —
> every individually-marked stub has been resolved. Remaining items below
> (Redux→TanStack, restyling, `apps/longhaul` removal) are tracked as
> standalone follow-up phases, not as inline code TODOs.

## Stubbed in this phase

- [x] **`API.jumpToOrder` / `pegasusRemoteFunctionCall`** — shipped 2026-05-29
      as a `pegasus-desktop://` URI-scheme handoff. The WinForms client
      registers the scheme; the web app fires the URI fire-and-forget
      (config-gated). Implementation: `utils/jump-to-order.ts` + tests, wired
      via `utils/api/index.ts:71`. Commits `638b356` (web) + `a36e011`
      (WinForms scheme registration).

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

- [ ] **Delete `apps/longhaul`** — **UNBLOCKED 2026-05-30.** The verification
      window is over: the strangler-fig migration is complete (see
      `plans/completed/longhaul-strangler-fig-cloud-migration.md`) and the
      cloud port has been live in prod for weeks. Only external references
      remaining are: `package-lock.json` workspace entry (auto-cleans on
      removal), a historical `dolas/agents/project/GOTCHAS.md` note (about
      CSS reset), and reference-only comments in
      `apps/e2e/tests/browser/trip-date-container.spec.ts`. No CI workflow
      depends on it — `e2e-qa-longhaul.yml` targets the cloud port at
      `/driver-planning`, not this app. Ready to `rm -rf apps/longhaul` +
      `npm install` in a one-PR cleanup.

- [x] **`redux/nav` slice cleanup** — `redux/nav/` directory removed and
      its reducer dropped from `redux/store.ts` and the test-only
      `__test-utils__/render-with-store.tsx`. No remaining references.

- [x] **`vendor.d.ts` shims** — `redux-logger` declaration removed from
      `types/vendor.d.ts`. Unused `react-modal` declarations also dropped
      (`types/react-modal.d.ts` deleted; `react-modal` augmentation removed
      from `types/react-compat.d.ts`).
