# Driver rating — 2 decimal places on the Availability screen

## Context

Driver rating already exists on the tenant app's Driver Planning → Availability
screen (both live variants, View A and View B) as a click-to-edit cell backed by
`DriverConfirmedAvailability.rating`.

The storage column is already **`decimal(3,2)`** (`driver-confirmed-availability-schema.ts:26,38`)
— it can hold 2 decimals today. Nothing to migrate. The gap is entirely in the
client (display + parse + input step) and one missing server-side guard.

## Current behaviour

| Layer   | Today                                                                    | Problem                                                                                                                                       |
| ------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Display | `formatRating` → `rating.toFixed(1)` (ViewA:89, ViewB:65)                | `4.75` renders as `4.8`                                                                                                                       |
| Input   | `<Input type="number" step="0.1">` (ViewA:804, ViewB:490)                | Chrome rejects `4.75` as a step mismatch                                                                                                      |
| Parse   | `parseRating` clamps 0..5, no rounding (ViewA:92, ViewB:267)             | `4.567` is sent to the server verbatim                                                                                                        |
| Server  | `rating: z.number().nullable().optional()` (driver-planning-patch.ts:31) | No bounds, no precision — SQL Server silently rounds into `decimal(3,2)`; a non-UI client (SDK/curl) can write values the UI can't round-trip |

## Scope

1. **Display** — `formatRating` → `toFixed(2)` in `AvailabilityViewA.tsx` and
   `AvailabilityViewB.tsx`. (`4.5` → `4.50`, `5` → `5.00`.)
2. **Input** — `step: '0.1'` → `step: '0.01'` at both rating call sites, so the
   browser accepts 2-decimal entry.
3. **Parse** — `parseRating` rounds to 2dp (`Math.round(r * 100) / 100`) before
   clamping 0..5, in both views.
4. **Server guard** — tighten the patch schema's `rating` to `0..5` with a 2dp
   refine (explicit refine, not `.multipleOf(0.01)` — float noise).
5. `ratingClass`'s `< 4.5` red-highlight threshold is unchanged.

Both views change together — A is the default, B is still reachable via the
Change View toggle; letting them diverge on a formatting rule is the bug that
variant split already invites.

## Tests (TDD — red first)

- `apps/tenant-web/src/routes/driver-planning.index.test.tsx`
  - View A + View B: a driver with `rating: 4.75` renders `4.75` in the
    `driver-rating` cell (new).
  - View A + View B: typing `4.567` commits `4.57` through the mutation (new).
  - Existing rating specs (`4.2`, `4.9` commit assertions, red-highlight specs)
    keep passing untouched — they assert commit values and classes, not the
    formatted string, so no fixture churn expected. Verify, don't assume.
- `apps/api/src/handlers/longhaul-cloud/driver-planning-patch.test.ts`
  - accepts `4.75`; rejects `6`, `-1`, and `4.567` with `VALIDATION_ERROR` (new).

## Non-goals

- No Prisma migration, no legacy-view change, no `decimal(3,2)` widening
  (2dp × max 5 fits).
- No change to who may edit the field (existing RBAC stands).
- No e2e/browser spec — this is a formatting change on an already-covered cell.

## Verification gate

`npm run typecheck` + `npm test` at the repo root, both green, before the PR.
