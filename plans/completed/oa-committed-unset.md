# fix: "OA Committed?" unset (`?`) does not survive a reload

## Symptom

In Operations Planning → shipment details panel, setting **OA Committed?** to the
middle `?` (unset) and saving appears not to persist: reopen the panel and the
toggle is back on **No** (brown).

## Root cause — the write is fine, the READ drops the field

Verified against prod NWI (`longhaul_shipmentcoverage`, 13,805 rows):

| `is_covered` | rows   |
| ------------ | ------ |
| NULL         | 2,326  |
| 1 (yes)      | 10,415 |
| 0 (no)       | 1,064  |

The NULL **is** written and stored. The loss happens on read.

`apps/api/src/handlers/longhaul-cloud/shipments-list.ts:327` serializes the
coverage row with:

```
(SELECT cov.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS __payload
```

`FOR JSON` **omits NULL-valued keys entirely** unless `INCLUDE_NULL_VALUES` is
given. Confirmed on prod — a row with `is_covered IS NULL` comes back as:

```json
{
  "id": 68,
  "order_num": 415743,
  "created_by_id": 2076,
  "activity_code": "PACK",
  "note": "...",
  "coverage_agent_id": "0443",
  "created_date": "...",
  "updated_date": "..."
}
```

No `is_covered` key at all. So the client receives `undefined`, not `null`.

Confirming asymmetry: the **trip-detail** route reads coverage via a plain
`SELECT * FROM longhaul_shipmentcoverage` (`apps/api/src/lib/longhaul-trip-fetch.ts:114`)
and returns `is_covered: null` correctly. Only the `FOR JSON` path is affected.

### Downstream damage from `undefined`

1. `Coverage/index.tsx:27-31` — `isCovered` becomes `undefined`, not `null`.
   The icon color check `isCovered === null ? 'orange' : isCovered ? 'green' : 'brown'`
   falls to **brown**, and `YesNoToggle`'s `status !== null && !status` highlights
   **No**. This is exactly the reported symptom.
2. `ShipmentCard/index.tsx:75` — `packing_coverage?.is_covered !== null` is `true`
   for `undefined`, so the card renders a decided shield instead of the unknown state.
3. `Coverage/index.tsx:104` — on a _subsequent_ save the DTO builds
   `is_covered: isCovered === null ? null : isCovered` → `undefined` →
   `JSON.stringify` drops the key → `pickColumns` (`longhaul-cloud-write.ts:36`)
   skips the column → the UPDATE never touches `is_covered`. A genuine second-order
   write bug, latent behind the same cause.

## Plan

### 1. API — stop dropping nulls (the actual fix)

`apps/api/src/handlers/longhaul-cloud/shipments-list.ts`

- Add `INCLUDE_NULL_VALUES` to the **coverage** `FOR JSON PATH` subquery so every
  column round-trips, null or not. **Already validated read-only against prod** —
  the same row now serializes as
  `{...,"updated_by_id":null,...,"is_covered":null,...}`.
- Leave the `activity` and `type` payloads alone in this PR — they are consumed by
  `buildShipmentActivities` and a wide surface of ported planning UI. Note them as
  a follow-up audit rather than widening blast radius here.

### 2. tenant-web — treat `undefined` as `null` (defense in depth)

Even with the API fixed, the client should not read a missing key as "No".

- `Coverage/index.tsx` — initialize `isCovered` with `?? null`, and build the DTO
  as `is_covered: isCovered ?? null` so an absent value is written explicitly
  rather than silently skipped.
- `ShipmentCard/index.tsx:75` — use a nullish check so `undefined` renders the
  unknown state, matching `null`.

### 3. Tests

Genuinely **red-first** (fail before the fix):

- `apps/api/.../shipments-list.test.ts` — assert the coverage subquery carries
  `INCLUDE_NULL_VALUES`.
- `Coverage.test.tsx` — a shipment whose `packing_coverage` lacks `is_covered`
  renders the unknown/orange state, and saving emits `is_covered: null`.
- `ShipmentCard` — undefined `is_covered` renders the unknown state.

**Pins** (pass immediately — regression guards, not TDD):

- `shipments-list.test.ts` fixture whose coverage payload has `"is_covered": null`,
  asserting it survives onto `packing_coverage`.
- `shipments-write.test.ts` — the currently-missing `is_covered: null` case,
  asserting the param is bound rather than skipped.

### 4. Verify

- `npm run typecheck` + targeted vitest for the touched packages.
- Re-run the prod read query to confirm the `FOR JSON ... INCLUDE_NULL_VALUES`
  form returns the `is_covered: null` key (read-only, via the mssql executor).
- Optionally drive the real SPA with the `apps/tenant-web:verify` skill to watch
  the save payload and the reload state.

## Out of scope / follow-ups

- Auditing the `activity` and `type` `FOR JSON` payloads for the same null-omission
  class — same bug, wider blast radius, deserves its own change.
- `updated_by_id` is also dropped by the same mechanism (visible in the prod row
  above) and the DTO sets it from `user.updated_by_id`, which looks wrong; noted,
  not fixed here.
