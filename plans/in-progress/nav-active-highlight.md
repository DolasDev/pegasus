# Fix: sidebar submenu / App Settings rail active-highlight doesn't follow the selected route

## Context

In the tenant app, the highlighted (active) state of navigation items is stuck: when
you select a **submenu** item — under **Operations** or **App Settings** in the left
sidebar, and also in the **App Settings page's own left rail** — the highlight does not
move to the newly-selected item. The user confirmed it affects both the sidebar
submenus and the App Settings page's in-page rail.

**Root cause:** every "is this nav item active?" check reads the current path via
`const router = useRouter(); const pathname = router.state.location.pathname`.
`useRouter()` returns the stable router instance and reading `.state` off it does **not**
subscribe the component to router updates. These nav containers are layout-level
components whose `<Outlet>` swaps the page without re-invoking the parent, so they don't
re-render on client-side navigation — the computed `isActive`/`childActive` is stale and
the highlight sticks to wherever it was on first render. The per-item matching logic
itself is correct; only the pathname source is non-reactive.

The complete set of non-reactive readers (grep `state.location.pathname` over
`apps/tenant-web/src`):

- `apps/tenant-web/src/components/AppShell.tsx:218` (`NavItem`), `:253` (`NavGroup`)
- `apps/tenant-web/src/features/settings/app/AppSettingsLayout.tsx:28`
- `apps/tenant-web/src/routes/__root.tsx:12` (shell/shell-free toggle)

## Fix

Replace the non-reactive read with a **reactive selector subscription** in each
component, preserving all existing matching logic:

```ts
import { useRouterState } from '@tanstack/react-router'
const pathname = useRouterState({ select: (s) => s.location.pathname })
```

`useRouterState` is already exported by the installed `@tanstack/react-router@^1.168.23`.
This re-renders the component whenever the location changes, so `isActive`,
`isParentActive`, `isInSection`, and the child `childActive` all track the current route.
Keep `NavGroup`'s existing `open`/`isInSection` expander logic exactly as-is — it just
now reads a reactive `pathname`.

Files:

- `apps/tenant-web/src/components/AppShell.tsx` — in `NavItem` (~218) and `NavGroup`
  (~253), swap `useRouter().state.location.pathname` for the `useRouterState` selector.
  Drop the now-unused `useRouter` import if nothing else needs it (it isn't used
  elsewhere in this file).
- `apps/tenant-web/src/features/settings/app/AppSettingsLayout.tsx` — same swap at line 28
  (rail active highlight). This is the "App Settings page's own left nav" the user called
  out.
- `apps/tenant-web/src/routes/__root.tsx` — same swap at line 12. Not the reported
  symptom (it only toggles on full page loads today), but it is the identical footgun;
  fixing it removes a latent bug and keeps the pattern consistent.

Prefer this surgical `useRouterState` swap over rewriting to `<Link activeProps>` /
render-prop `isActive`: `NavGroup` must derive `isInSection` for its expander state from
the pathname regardless, so a single reactive pathname is the smallest correct change and
preserves current behavior/semantics.

## Tests

- `apps/tenant-web/src/__tests__/AppShell.test.tsx` — the module mock of
  `@tanstack/react-router` (lines 15-26) only stubs `Link` + `useRouter`. Add a
  `useRouterState` stub that honors the selector, e.g.
  `useRouterState: (opts) => opts.select({ location: { pathname: currentPathname } })`,
  backed by a mutable `currentPathname` so a test can point it at a child route. Existing
  role-visibility tests keep passing.
- Add a regression test (in that file or a sibling): with the mocked pathname set to a
  submenu child (e.g. `/settings/app/quotes`, and `/driver-planning/trips` for
  Operations), assert the matching child `<Link>` carries the active class
  (`bg-accent`) while its siblings carry the inactive class (`text-muted-foreground`).
  This guards the matching logic; note it can't prove reactivity on its own (a mocked
  router is inherently reactive) — the browser check below is the reactivity proof.

## Verification

- **Browser (authoritative — this is a reactivity bug):** use the `apps/tenant-web:verify`
  skill (`npx vite --mode e2e`, stub the API at the network layer). Navigate to
  `/settings/app`, click through the rail items (Dashboard → Moves → Quotes …) and the
  sidebar **App Settings** and **Operations** submenu children, and confirm the
  `bg-accent` highlight moves to the clicked item each time (assert `data-testid`
  /`class` on the active link, or screenshot). Confirm parent-group highlight + expander
  still behave.
- `npx vitest run src/__tests__/AppShell.test.tsx` (+ any new spec) green.
- `npm run typecheck` for `@pegasus/tenant-web` clean (unused-import check catches a
  leftover `useRouter`).
