# Fix: clearing a confirmed ready date doesn't save (driver availability)

## Bug

In the driver availability dashboard (Operations → `/driver-planning`), clearing a
manually-entered ready date via the calendar UI does not persist. On reload the old
date is still there.

## Root cause

`/driver-planning` mounts one of three A/B-test variants at random per load
(`routes/driver-planning.index.tsx`, `pickRandomVariant`). Two of them — **Variant A**
and **Variant C** — model the confirmed ready date + state + city as a _linked_ unit
committed on blur by `commitLinked()`:

```ts
function commitLinked() {
  const date = form.confirmedDate.trim()
  const state = form.confirmedState.trim()
  const city = form.confirmedCity.trim()
  // Partial commits are a no-op — the user must populate all three before saving.
  if (!date || !state || !city) return
  commitWith(form) // (View A)  / inline mutation.mutate (View C)
}
```

- `AvailabilityViewA.tsx:441-449`
- `AvailabilityViewC.tsx:336-352`

The `if (!date || ...) return` guard is intentional for **building up** a new entry
(the user shouldn't save a half-filled triple — covered by the test at
`driver-planning.index.test.tsx:497`). But it _also_ swallows a **clear**: when a
dispatcher empties the date on an already-confirmed row, `date` becomes `''`, the guard
returns, and `commitWith`/`mutate` is never called. Everything downstream is correct —
the mutation sends `confirmedDate: null`, the PATCH handler + SQL upsert set the column
unconditionally — but the mutation never fires. The clear dies in the browser.

**Variant B is unaffected** — it commits each field independently and already sends
`confirmedDate: f.confirmedDate || null` on clear.

## Product decision (confirmed with user)

Date + location are one linked unit. Clearing the date on a confirmed row clears the
**whole** confirmed availability — `confirmedDate: null` **and** `confirmedLocation:
null`. A location with no date is a dangling half-record the row can't even render as
confirmed (`driver.confirmedAvailableDate ? confirmed-tier : guess-tier`).

## Fix

In `commitLinked()` of **both** View A and View C, split the guard into three cases:

1. **Full triple** (`date && state && city`) → normal save (unchanged).
2. **Genuine clear** (`!date && driver.confirmedAvailableDate`) → commit the cleared
   unit: `confirmedDate: null`, `confirmedLocation: null` (also reset the local form's
   state/city so the mounted inputs reflect the clear).
3. **Partial mid-entry** (anything else, e.g. building a new triple) → no-op, inputs
   stay open (unchanged).

The discriminator for case 2 vs 3 is the **persisted** value `driver.confirmedAvailableDate`:
if it was set and the form date is now empty, the user cleared an existing date; if it
was never set, an empty date is just a new entry still being filled in. (A native
`<input type="date">` replaces its value directly on edit, so _changing_ a date never
passes through empty — only an explicit clear does.)

### View A (`commitLinked`, ~line 441)

`commitWith` already sends the full roster field set, so pass a cleared form:

```ts
function commitLinked() {
  const date = form.confirmedDate.trim()
  const state = form.confirmedState.trim()
  const city = form.confirmedCity.trim()

  if (date && state && city) {
    commitWith(form)
    return
  }

  // Clearing the date of a previously-confirmed row removes the whole confirmed
  // availability — date + location are one linked unit, so a location with no date
  // would be a dangling half-record the row can't render as confirmed. Detect a real
  // clear by the persisted date having been set; an empty date with no persisted value
  // is a new entry still being filled in, which stays a no-op.
  if (!date && driver.confirmedAvailableDate) {
    const cleared = { ...form, confirmedDate: '', confirmedState: '', confirmedCity: '' }
    setForm(cleared)
    commitWith(cleared)
    return
  }

  // Partial triple mid-entry — no-op; inputs stay rendered so the user can finish.
}
```

### View C (`commitLinked`, ~line 336)

View C inlines `mutation.mutate` (date/location/notes only — no roster fields):

```ts
if (!date && driver.confirmedAvailableDate) {
  setForm((f) => ({ ...f, confirmedDate: '', confirmedState: '', confirmedCity: '' }))
  mutation.mutate(
    {
      driverId: driver.driverId,
      confirmedDate: null,
      confirmedLocation: null,
      notes: form.notes || null,
    },
    { onSuccess: () => setEditMode(null) },
  )
  return
}
```

## Tests

Add to `apps/tenant-web/src/routes/driver-planning.index.test.tsx`, one per affected
variant (pin the variant with `vi.spyOn(Math, 'random').mockReturnValue(...)` — `0` → A,
`0.9` → C):

- **Clears a confirmed date → commits null date + null location.** Driver with
  `confirmedAvailableDate` and `confirmedAvailableLocation` set. Click `ready-date-cell`,
  clear `confirmed-date-input` to `''`, blur. Assert `mutateMock` called with
  `confirmedDate: null, confirmedLocation: null`.
- **Regression guard:** the existing "refuses to save until date AND state AND city"
  build-up test (`:497`) must still pass — a _new_ entry with an empty date and no
  persisted value stays a no-op.

Backend (`driver-planning-patch.ts`) already handles `null` correctly and is well
covered — no change.

## Out of scope

- No API/SQL/redux change — the entire chain past the mutation trigger already handles
  the clear correctly.
- No change to Variant B (already correct) or to the build-up no-op semantics.
- Not consolidating the three variants — they're a live experiment.

## Verification

- New unit tests green for A and C; existing build-up test still green.
- `typecheck`, `lint`, `npm test` (tenant-web) pass.
- Manual (optional, via tenant-web verify seam): open a confirmed row, clear the date,
  confirm the row drops to its guess/estimated tier and stays cleared after refetch.
