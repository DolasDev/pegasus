# Unit 13 — components-display: Bugs & smells found while testing

Scope: `apps/tenant-web/src/features/driver-planning/components/{Table, Tabs, Snackbar, Popover, ErrorBoundary}`.

## Snackbar (`Snackbar/index.tsx`)

### 1. `useEffect`s run on every render (no dependency arrays)

```tsx
useEffect(() => {
  const timeout = setTimeout(() => {
    if (open !== isOpen) {
      setIsOpen(open)
    }
  }, 300)
  return () => clearTimeout(timeout)
})  // <-- no deps array

useEffect(() => {
  if (open && autoHideDuration) {
    setTimeout(() => {
      onClose()
    }, autoHideDuration)
  }
})  // <-- no deps array
```

Both effects run after every render. The second effect schedules an `onClose`
on a new timer each render and **never clears the previous timer**, so:

- Multiple `onClose` callbacks can stack up if the component re-renders while
  open. The component will fire `onClose` once per render that occurs while
  `open` is true.
- The first effect creates a 300ms deferred state sync that fights against
  the parent `open` prop and can cause flicker (`isOpen` may briefly be the
  prior render's value).

**Fix sketch:** add deps arrays (`[open]`, `[open, autoHideDuration]`) and
return cleanup functions that `clearTimeout` the autohide timer.

### 2. `type` prop is unconditionally indexed into `styles`

```tsx
${styles[type]}
```

When `type` is `undefined` (the default — no default value), this becomes
`styles[undefined]` → `undefined`, which then renders the literal string
`"undefined"` into the className via template interpolation. Visible in tests
that omit `type`. Should guard with `type ? styles[type] : ''`.

## Table (`Table/index.tsx`)

### 3. `tableConfig` keyed by `label`, but labels are not guaranteed unique

```tsx
{tableConfig.map(({ label }: TableColumn) => (
  <th className={styles.th} key={label}>
```

If two columns share a label (e.g. two empty-string spacer headers), React
will warn about duplicate keys. Low-impact but worth noting.

### 4. `data-id` only meaningful for moves rows

`<tr ... data-id={row['order_num']}>` is hardcoded — the Table is "generic"
in shape but assumes every row has an `order_num`. Rows without that field
get `data-id="undefined"`. Either drop it or make it configurable.

### 5. Heavy use of `any`

`rows: any[]`, `accessor: (row: any) => …`, `row[property as string]`. No
type-safety on column ↔ row binding. Migrating to a generic
`<T>{ rows: T[]; tableConfig: Column<T>[] }` would catch typos at compile
time.

## ErrorBoundary (`ErrorBoundary/index.tsx`)

### 6. `closeErrorMessage` is wired to `<Link to="/trips">`

```tsx
<Link className={styles.closeErrorMessage} to={'/trips'} onClick={this.closeErrorMessage}>
  <i className="fa fa-close"></i>
</Link>
```

A "close the error toast" affordance that **also navigates the user away to
/trips** is surprising. Two responsibilities in one click. If the user is on
some other longhaul screen and an error pops up, hitting × ejects them from
their context. Should be a plain `<button>` that only resets state.

### 7. Logger is a singleton with hard-coded name

`logger.error(e)` from `'../../utils/logger'` exports a default singleton
named `'default'`. Multiple call sites all log under the same prefix — the
boundary should probably use a named logger like `new Logger('ErrorBoundary')`.

## Popover (`Popover/index.tsx`)

### 8. Component name "Popover" is misleading

This component is **not a popover** in the floating-ui / interactive sense.
It is a styled `<div>` wrapper with `forwardRef`. It has:

- No anchor concept
- No open/close state
- No portal
- No positioning logic

Anywhere this is used as if it were a true popover (positioned, dismissible,
focus-trapped), the actual behavior is just an inline div. Renaming it
(`PopoverShell`, `Surface`, etc.) would make the contract clearer; or
implementing real popover behavior would match the name.
