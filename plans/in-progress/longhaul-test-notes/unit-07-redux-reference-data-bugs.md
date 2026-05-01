# Unit 07 — Redux reference-data: bugs found while writing tests

These were observed while writing tests for `apps/tenant-web/src/features/driver-planning/redux/`. **No production code was changed**; logging here for review during the upcoming refactor.

## 1. `fetchDriversSuccess` driver sort comparator is broken

**File:** `apps/tenant-web/src/features/driver-planning/redux/common/index.ts` (lines ~33-40)

```ts
fetchDriversSuccess(state, action: PayloadAction<any[]>) {
  state.driversList = action.payload
    .map(({ driver_name, ...rest }: any) => ({
      driver_name: (driver_name || '').trim(),
      ...rest,
    }))
    .sort((a: any, b: any) => b.driver_name - a.driver_name)
  state.loading = false
},
```

`driver_name` is a string. `b.driver_name - a.driver_name` coerces both to numbers (yielding `NaN`), so the comparator always returns `NaN` and the sort is effectively a no-op. The list is therefore stored in whatever order the server returned, **not** sorted alphabetically as the code clearly intends.

**Suspected fix during refactor:** use a string comparator, e.g.
```ts
.sort((a, b) => a.driver_name.localeCompare(b.driver_name))
```
(Confirm desired order — the current `b - a` hints at descending intent, which seems wrong for a UI dropdown but worth verifying with product.)

**Test impact:** my reducer test for `fetchDriversSuccess` does not assert ordering — only that both entries are present. The comparator brokenness would mask any expectation of a specific order, so I avoided locking in the buggy behaviour.

## 2. (Minor) Spread order in `fetchDriversSuccess` allows incoming `rest` to clobber the trimmed `driver_name`

```ts
.map(({ driver_name, ...rest }: any) => ({
  driver_name: (driver_name || '').trim(),
  ...rest,
}))
```

Because `driver_name` was destructured out, `rest` cannot contain it and the issue cannot manifest in practice — but this is fragile: if the destructure is ever changed (e.g. to keep `driver_name` for inspection), `...rest` would silently overwrite the trimmed value. Worth tightening during refactor by spreading `rest` first and the sanitized fields second.

No test was written against this, since it is not observable today.
