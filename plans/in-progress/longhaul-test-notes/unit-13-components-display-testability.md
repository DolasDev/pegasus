# Unit 13 — components-display: Testability notes

Scope: `apps/tenant-web/src/features/driver-planning/components/{Table, Tabs, Snackbar, Popover, ErrorBoundary}`.

## What was easy to test

- **Tabs:** Pure functional component, props in / clicks out. 100% line
  coverage with five small tests, no mocks.
- **Popover:** `forwardRef` + spread props on a div. Trivial to test.
- **Table:** Pure rendering. The unit task expected sortable headers, but
  the component is render-only — it has no internal state. Tests adapted to
  the actual contract.

## What needed mocking, and why

### `ErrorBoundary` → `@tanstack/react-router`

The fallback UI renders `<Link to="/trips">` from
`features/driver-planning/utils/router-compat`, which wraps
`@tanstack/react-router`'s `Link`. TanStack `Link` requires being mounted
inside a `RouterProvider`, which is far too heavy for a unit test of the
boundary.

**Workaround:** mock `@tanstack/react-router` with a plain `<a>` for `Link`
and stubs for `useLocation` / `useNavigate` / `useParams`. The ErrorBoundary
itself is then tested in isolation.

**Production-code suggestion (logged, not done):** ErrorBoundary's fallback
shouldn't use a router-aware `Link` for what is effectively a "dismiss this
error" affordance — see bug #6 in the bugs file. Replacing with a plain
`<button>` would also remove this mocking burden.

### `ErrorBoundary` → `logger`

`logger.error(e)` writes to the real console. Mocked the logger module to a
no-op so Vitest output stays clean. (React itself still logs the boundary
error to `console.error`; that is suppressed per-test with
`vi.spyOn(console, 'error').mockImplementation(() => {})`.)

## What I deliberately did NOT test

### `Snackbar`'s `isOpen` deferred-state effect

The first useEffect in `Snackbar` runs on every render with no deps. Testing
its real behavior would require simulating the 300ms deferred state sync
through multiple renders, which is brittle and exercises what is almost
certainly a bug (see bugs file #1). I covered the visible/hidden surface
(`open=true` → renders message; `open=false` initial → renders nothing) and
the autohide timer, and skipped the racy transition logic.

### Popover positioning

The unit task description suggested floating-ui pixel positioning. The
component does not use floating-ui — there is nothing to skip in jsdom
because there is no positioning code in the first place.

### Table sorting

The unit task description mentioned sortable headers. The component does
not sort; tests verify the actual rendering contract instead.

## Refactors that would help testing (not done — production code untouched)

1. **Snackbar:** add proper deps arrays and timer cleanup (also a real bug).
   Would let us write deterministic tests for the deferred-open behavior.
2. **Snackbar:** guard `styles[type]` so it doesn't render the literal
   `"undefined"` into className. Would let us assert on the className
   without a custom matcher.
3. **ErrorBoundary:** replace the dismiss `<Link>` with a `<button>`. Would
   remove the need to mock `@tanstack/react-router` at all.
4. **ErrorBoundary:** allow the logger to be injected (constructor or
   context). Would remove the need to module-mock the logger.
5. **Table:** make it generic over row type and column accessor. Tests
   would not need `any` casts.

## Coverage achieved

Scoped to the five target components only:

| File                       | Lines % |
| -------------------------- | ------- |
| Table/index.tsx            | 100     |
| Tabs/index.tsx             | 100     |
| Snackbar/index.tsx         | 91.66   |
| Popover/index.tsx          | 100     |
| ErrorBoundary/index.tsx    | 100     |
| **All target components**  | **96.96** |

Well above the 70% per-component target. The single uncovered line in
Snackbar (line 17) is the `open !== isOpen` early-return inside the racy
deferred-state effect described above.
