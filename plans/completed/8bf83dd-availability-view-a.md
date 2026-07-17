# Driver Availability — View A restructure

## Context

The driver-planning Availability screen renders one of three parallel view variants (A/B/C) behind a "Change View" toggle. Each is an independent copy — divergence is intentional. The user wants **View A** reworked to be a richer roster while keeping its move-centric Deliveries cell:

1. The driver **name should not be bold**.
2. Bring the seven **View B** planner columns into View A **after Deliveries**, in this order: **Canada, California, WGS, Rating, Equipment, Home State, Home City** (note: Home State **before** Home City — the reverse of View B's order, per the user's explicit sequence).
3. **Move Deliveries ahead of Notes** (currently Notes precedes Deliveries).
4. **Move the phone + chat-bubble icons out of the Contact column into the Driver column, after the driver name, then delete the Contact column.**

The seven new columns will be **interactive** (click-to-edit / toggle), matching View B (confirmed with user).

**Critical hazard this plan must also close:** the PATCH endpoint `apps/api/.../longhaul-cloud/driver-planning-patch.ts` is a **full-row overwrite** — every column is written on every call, with omitted fields coerced to `NULL`. View A's current `commitLinked`/`commitNotes` send only `confirmedDate`/`confirmedLocation`/`notes`, so today editing a date or note in View A would **wipe** any Canada/California/WGS/Rating/Equipment/Home values a planner set in View B. Threading all seven fields through View A's saves is therefore mandatory, not optional — and is exactly what interactivity requires anyway.

## Final View A column order (13 columns)

`Driver` (name + phone + SMS icons, not bold) · `Ready Date` · `Ready State` · `Ready City` · `Deliveries` · `Notes` · `Canada?` · `California?` · `WGS` · `Rating` · `Equipment` · `Home State` · `Home City`

## Files to modify

### 1. `apps/tenant-web/src/features/driver-planning/availability/AvailabilityViewA.tsx` (primary)

All changes are self-contained; the data already exists on `DriverPlanningRow` (`canada`, `california`, `rating`, `equipment`, `homeCity`, `homeState`, `wgs`) and the mutation already accepts them. Port the cell logic verbatim from `AvailabilityViewB.tsx` (same directory) — do not invent new patterns.

**a. Driver cell (currently `AvailabilityViewA.tsx:403-405`)**

- Remove `className="font-bold"` from the `driver-name` `TableCell`.
- After the name, inline the phone `<a>` (`fa-phone`, `data-testid="driver-call"`, `tel:${PLACEHOLDER_PHONE}`) and the SMS `<a>` (`fa-comment-sms`, `data-testid="driver-sms"`, `smsDriver({...})` onClick) — moved verbatim from the Contact cell at `527-556`. Wrap name + icons so the icons sit after the name (e.g. name span + the existing `inline-flex items-center gap-2` icon group). Keep `stopPropagation` on both anchors. `PLACEHOLDER_PHONE` and the `smsDriver` import are already present.

**b. Delete the Contact column**

- Remove the `<TableCell data-testid="driver-contact">…</TableCell>` block (`527-556`).
- Remove `<TableHead …>Contact</TableHead>` (`702`).

**c. Reorder Deliveries ahead of Notes**

- Header: move `Deliveries` `<TableHead>` (`701`) before `Notes` `<TableHead>` (`700`).
- Body: move the Deliveries `<TableCell data-testid="driver-deliveries">` (`496-525`) before the Notes `<TableCell>` (`473-494`).

**d. Add the seven interactive columns after Notes.** Port from View B:

- **Extend `EditState`** (`82-87`) to add `canada: boolean`, `california: boolean`, `rating: string`, `equipment: string`, `homeCity: string`, `homeState: string`, `wgs: boolean | null`.
- **Extend `initialForm()`** (`303-311`) to seed those from `driver.*` (mirror View B's `useState` initializer at `AvailabilityViewB.tsx:258-269`).
- **Extend `EditMode`** (`299`) with a per-field variant for the text/number/select fields, e.g. `| { kind: 'field'; field: 'rating' | 'equipment' | 'homeCity' | 'homeState' }`. Canada/California/WGS commit immediately (no edit mode).
- **Add a single full-payload commit** `commitWith(f: EditState)` mirroring `AvailabilityViewB.tsx:285-302` (sends `confirmedDate`, `confirmedLocation`, `notes`, and all seven roster fields via `parseRating`). Route **every** save through it:
  - `commitNotes` → `commitWith(form)`.
  - `commitLinked` → keep the "date+state+city all present" guard, then `commitWith(form)`.
  - `toggleBool('canada'|'california')`, `cycleWgs()`, and field-edit blurs → `commitWith(next/form)`.
  - `handleBlur` gains a `kind === 'field'` branch → `commitWith(form)`.
  - This simultaneously closes the wipe hazard for the existing date/notes edits.
- **Port helpers** from View B: `ratingClass`, `formatRating`, `parseRating`, `wgsLabel`, `wgsGlyph`, `WGS_CYCLE`, `EQUIPMENT_OPTIONS`, and the `boolCell` / `wgsCell` / `equipmentSelect` cell renderers (View B `53-59`, `109-117`, `250-254`, `361-413`). Reuse View A's existing `Input` for rating (number) and Home City/State (text), following View B's rating cell (`457-472`) and home cells (`500-522`).
- **Header cells** (after Notes, in order): `Canada?`, `California?`, `WGS`, `Rating`, `Equipment`, `Home State`, `Home City` — all `className={CARD_TEXT_CLASS}`. **Body cells** in the same order, with testids matching View B: `driver-canada`, `driver-california`, `driver-wgs`, `driver-rating`, `driver-equipment`, `driver-home-state`, `driver-home-city`.

**e. Empty-state colSpan** (`709`): `7` → `13`.

### 2. `apps/tenant-web/src/routes/driver-planning.index.test.tsx` (tests — variant pinned to A via `Math.random → 0`)

Two existing View-A tests assert the old layout and **will fail**:

- **`'formats the driver name as "Last, F." and renders it bold'`** (`194-204`): drop the `font-bold` assertion (assert it does **not** match `/font-bold/`), and assert the `driver-name` cell now contains `driver-call` + `driver-sms`.
- **`'renders one phone + SMS quick-action pair per driver row in the Contact column'`** (`713-748`): retarget from `driver-contact` to the `driver-name` cell (icons now live there); assert `queryByTestId('driver-contact')` is `null`. Keep the per-`shipment-line` "no icons" checks.
- Header test (`166-192`): add `expect(screen.queryByText('Contact')).not.toBeInTheDocument()` and presence checks for the new headers (`Canada?`, `California?`, `WGS`, `Rating`, `Equipment`, `Home State`, `Home City`).
- **Add coverage for the new interactive cells** (toggle Canada, cycle WGS, edit Rating, edit Home State/City) — asserting `mutateMock` fires with the full field set. This both documents behavior and guards against the merge-queue coverage-floor ejection gotcha (View A gains substantial new lines). Note: the existing Notes-commit test (`508-523`) uses `objectContaining`, so widening the payload keeps it green.

Unaffected (verified): `ready-date-cell` keeps `font-bold` (`547`); `delivery-effective` not-bold assertions (`660`/`684`); the e2e page object `AvailabilityPage.ts` only uses `notes-cell`, which is unchanged.

## Verification

- `cd apps/tenant-web && npm test -- driver-planning.index` — unit suite green (variant-A assertions updated, new-cell tests pass).
- `npm run typecheck` at the `apps/tenant-web` (and root) level — the widened `EditState`/`EditMode` and payload thread cleanly.
- Drive the real SPA with the tenant-web verify skill (`/verify` or the `apps/tenant-web:verify` skill): open driver-planning on View A and confirm — name not bold with phone/SMS icons trailing it; column order Deliveries→Notes→Canada→California→WGS→Rating→Equipment→Home State→Home City; no Contact column; toggling Canada/California, cycling WGS, and editing Rating/Equipment/Home fields each issue a **single** PATCH carrying the full field set; and — the key regression — editing a Note or Ready Date no longer nulls the roster fields (inspect the captured request body).
