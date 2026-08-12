# Integration date coercions + milestone estimated/survey dates (sdk-feedback 0039 + 0040)

- **Branch:** `feat/integration-date-fields`
- **Goal:** make a partner's documented date contract reachable from a _published
  config_ — both **which** date fields may be emitted (0040) and in **what format**
  (0039) — without a platform code change per partner.

## Context (so any agent can resume without re-reading the codebase)

Two `~/repos/pegasus-workflows/sdk-feedback` items, filed 2026-08-12 against SDK
0.36.1, are the remaining gap between the Weichert config and the partner's
documented contract. They are independent; both are platform-side.

**0039 — the mapping DSL cannot format dates.** The mapping DSL's whole toolkit is
`$from` / `default` / `$map` / `coerce` / `$each`, and `coerce` is a closed enum of
four (`toNumber`, `toNumberOrNull`, `toString`, `identity`) in
`apps/api/src/integration-validation/transform/mapping-format.ts:66` +
`engine.ts:15`. pegII emits .NET datetimes (`2026-07-16T00:00:00`); Weichert
documents **every** date field as `YYYY-MM-DD`. There is no config-only fix: `$map`
is a finite lookup table, so "truncate any datetime to its date part" would need
one entry per representable date. The sibling half of that defect (the .NET
sentinel `0001-01-01T00:00:00`) _is_ `$map`-expressible and already shipped as
Weichert GLOBAL v6/v7 — which isolates _formatting_ as the sole remaining defect.
The gate cannot catch it: the corpus validates against the canonical floor, which
types these generically, so a wrongly-formatted date publishes green and surfaces
only at the partner — on a production write with no reversal path.

**0040 — the floor models only `{ actual }`.**
`apps/api/src/integration-validation/canonical-demo-partner.ts:55` declares
`const actualDate = z.object({ actual: optDate })` for `packDate1` / `loadDate1` /
`deliveryDate1`, with a comment saying the shape was chosen for what the
_validator_ needed. `netWeight` in the same schema carries both `estimated` and
`actual`, so this is not a floor-model limitation. Weichert documents the estimated
halves plus a per-shipment `surveyDate.{estimated,actual}`, and pegII's keyed
`KeyMoveDates` now supplies them (`.Planned` is exactly the partner's `estimated`);
`KeyMoveDates` is already a legal input root. So nothing is missing but the output
fields, and mapping them today fails the gate with `maps to unknown canonical
field`. This is the third instance of the class after 0028 (input roots are code)
and 0035 (fact catalog is code).

**Deliberately deferred** (both items say so explicitly): `packDate2/3`,
`loadDate2/3`, `deliveryDate2/3` — Weichert documents them but pegII exposes one
slot per milestone, so add them when a second slot is real, not speculatively. And
`KeyMoveDates.Earliest`/`Latest` — no counterpart on the partner payload, and they
duplicate `LocalDispatchUniqueInfo.{Earliest,Latest}{Pack,Load,Deliver}Date`.

**Out of scope for this session** (platform repo): republishing the Weichert
config and the order-490317 end-to-end probe. Those are the last acceptance
criterion of each item and belong to an **authoring-repo** session after this
deploys — integrations are never published from a platform session. The feedback
items' Validation Log sections stay empty here; step 4 of the feedback loop fills
them once the capability is live.

## Design decisions

1. **Extend the closed `coerce` enum; do not add an expression language.** The
   format's docblock states the bounded-vocabulary constraint deliberately, and
   0039's preferred proposal keeps it: two new members rather than a second
   mini-language (`format: {type, pattern}`). Additive and backward compatible —
   every existing mapping is untouched, and a v2 validator's `.strict()` directive
   rejects an unknown `coerce` loudly rather than silently passing the wrong
   format through.
2. **Wall-clock truncation, never timezone conversion.** These are dates with a
   `T00:00:00` suffix, not instants. Parse the leading `YYYY-MM-DD` with a regex
   and validate it via a `Date.UTC` round-trip (so `2026-02-30` is rejected), then
   re-emit the parsed parts. Never `new Date(string)` — that reintroduces the
   local-timezone day shift this repo has been bitten by before (the `MM/DD`
   calendar-day contract, #619).
3. **`coerce` already runs after `$map` in `applyOne`** — so
   `{"$map": {"0001-01-01T00:00:00": null}, "coerce": "toDateOnly"}` nulls the
   sentinel and formats everything else in one leaf, with no new evaluation order.
   Verify this rather than change it.
4. **Carry the new coercions' semantics in the published JSON Schema itself**
   (zod `.describe()` → `description`), so an authoring agent discovers _no
   timezone shifting / null-safe / composes after `$map`_ through live
   introspection (`GET /integrations/mapping-schema`,
   `PegasusClient.get_mapping_schema()`) rather than static prose. Preferring live
   introspection is the repo's SDK-discoverability rule.
5. **Do not touch `demo-partner.transform.ts` or `demo-partner-facts.ts`.** The
   built-in mapping _is_ the "overlay that maps only `.actual`" whose canonical
   output must stay byte-identical; leaving it unchanged and green is the proof of
   0040's compatibility criterion. Facts derive from `.actual` and must not move.
6. **No SDK version bump.** Both new contracts reach the SDK by live fetch
   (`get_mapping_schema()`, `get_floor()`/`list_floors()` → `canonicalFields`), so
   no Python change ships and no PyPI release is needed.

## Checklist

### 0039 — date coercions

- [x] `transform/engine.ts` — add `toDateOnly` + `toIsoDateTime` to `CoerceName`
      and `COERCIONS`, with a shared strict leading-date parser. Null-safe: `null`,
      `undefined`, `''`, a non-string, and a non-date string each yield `null` —
      never `Invalid Date`, never `1970-01-01`, never a throw.
- [x] `transform/mapping-format.ts` — add both to `CoerceSchema`, `.describe()`
      the field with the semantics, bump `MAPPING_FORMAT_SCHEMA_ID` to **v3** and
      the schema `title` string (it hardcodes "v2"), and update the id comment.
- [x] Regenerate `docs/schemas/integration-mapping.schema.json` with the tsx
      one-liner in `mapping-schema-published.test.ts` (the sync test fails
      otherwise).
- [x] `docs/integration-mapping-format.md` — list the two coercions with their
      wall-clock semantics, and fix the stale `$id: …/v1.json` reference in
      "The published schema" (code was already at v2 before this change).
- [x] Tests — `transform/engine.test.ts`: `2026-07-16T00:00:00` → `2026-07-16`;
      `2026-08-10T17:06:13.093` → `2026-08-10` (no day shift); each null-safety
      input → `null`; `toIsoDateTime` pads a date-only input and drops fractional
      seconds / a trailing offset. `transform/mapping-format.test.ts`: the schema
      accepts the new coercions and still rejects an unknown one.
- [x] Test — `$map` + `coerce` composition in ONE leaf: sentinel → `null`, real
      date → `2026-07-16`, and the same nested inside `$each`.

### 0040 — estimated + per-shipment survey dates

- [x] `canonical-demo-partner.ts` — replace `actualDate` with
      `milestoneDate = z.object({ estimated: optDate, actual: optDate })` for
      `packDate1` / `loadDate1` / `deliveryDate1`, add a per-shipment
      `surveyDate: milestoneDate` (distinct from the order-level `surveyDate`),
      and rewrite the stale "we validate only the actual" comment.
- [x] Test — a candidate mapping targeting `shipments[].packDate1.estimated`,
      `loadDate1.estimated`, `deliveryDate1.estimated`,
      `surveyDate.{estimated,actual}` no longer reports `maps to unknown canonical
field` (static-check and/or gate-pipeline level).
- [x] Test — **facts unchanged**: a shipment with `packDate1.estimated` set and
      `packDate1.actual` null still counts as _absent_ in
      `shipmentsWithPackActual` (and the paired/composite variants), so Weichert's
      `in-progress-requires-load-actual` /
      `delivered-requires-load-delivery-actuals` keep their meaning.
- [x] Confirm byte-identical canonical output for an actual-only overlay by
      re-running the existing demo-partner corpus + static-check suites unchanged.

### Land

- [x] `npm run typecheck` and the full `apps/api` suite green in the worktree
      (`npm run db:generate` first — a fresh worktree's Prisma client is stale).
      Run the whole integration-validation suite, not just touched files: corpus
      and mapping-static-check re-run every registered integration.
- [x] `git mv plans/in-progress/integration-date-fields.md plans/completed/` in the
      implementation commit, then one PR through the merge queue.

### Discovery surfaces (repo rule: an integrations change updates the SDK's four surfaces)

- [x] The published mapping schema carries the coercions' semantics as a
      `description` on the `coerce` directive, so `client.get_mapping_schema()` /
      `GET /integrations/mapping-schema` is the self-serve source of truth.
- [x] The floor's `canonicalFields` pick up the new date fields automatically —
      `/integrations/floors/:id` derives them from `z.toJSONSchema`, so
      `client.get_floor('shipment_status_update')` lists them with no code change.
- [x] SDK README authoring section + the `pegasus://reference/integration-config`
      MCP resource state the date rules and enumerate the leaf directives (the
      0039 filer concluded formatting was impossible from these surfaces).
- [x] SDK 0.36.1 → **0.36.2** (docs only) + CHANGELOG. Release after merge by
      pushing the `sdk-python-v0.36.2` tag.

## Deferred to an authoring-repo session (deliberate, not missed)

Both items' final acceptance criterion is an end-to-end probe of the live Weichert
config, which is authoring work and must not be published from a platform session:

- Republish Weichert GLOBAL with `toDateOnly` on all six date leaves and the
  estimated halves sourced from `KeyMoveDates.*.Planned`.
- Confirm `map_to_external` for order 490317 emits `contactMadeDate: "2026-07-01"`,
  `packDate1.actual: "2026-07-16"`, `packDate1.estimated: "2026-07-16"`,
  `loadDate1.estimated: "2026-07-17"`, `deliveryDate1.estimated: "2026-07-18"`,
  `surveyDate.estimated: "2026-07-09"` with `surveyDate.actual: null`.
- Re-gate the config UNCHANGED first (`ok=True 13/13`) — that is the live proof of
  the byte-identical criterion, alongside the corpus evidence here.
- Then fill both items' Validation Log sections (step 4 of the feedback loop) and
  update `~/repos/pegasus-workflows/CLAUDE.md` if the authoring guidance there
  needs the date rules restated.

This requires the API deploy to land first — the coercion and the floor fields must
exist server-side before a config can reference them.

## Files touched

| File                                                                         | Change                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------- |
| `apps/api/src/integration-validation/transform/engine.ts`                    | two new coercions + strict date parser          |
| `apps/api/src/integration-validation/transform/mapping-format.ts`            | enum + `.describe()` + schema id/title v3       |
| `apps/api/src/integration-validation/canonical-demo-partner.ts`              | `milestoneDate` × 3 + per-shipment `surveyDate` |
| `docs/schemas/integration-mapping.schema.json`                               | regenerated                                     |
| `docs/integration-mapping-format.md`                                         | new coercions documented; stale `$id` fixed     |
| `apps/api/src/integration-validation/transform/engine.test.ts`               | coercion unit tests                             |
| `apps/api/src/integration-validation/transform/mapping-format.test.ts`       | schema-accepts tests                            |
| `apps/api/src/integration-validation/transform/mapping-static-check.test.ts` | new canonical targets accepted                  |
| `apps/api/src/integration-validation/facts/demo-partner-facts.test.ts`       | estimated-set / actual-null fact invariance     |

## Risks / side effects

- **Schema `$id` bump to v3 is the intended breaking signal.** A consumer pinned
  to the v2 `$id` will reject a `toDateOnly` document — that is the point (fail
  loudly rather than silently emit the wrong format). Nothing in this repo pins
  the id except `mapping-schema-published.test.ts`, which reads it from code.
- **`optDate` is `.nullish()`**, so an overlay that maps only `.actual` parses
  exactly as before — the new key is simply absent. If a future coercion made an
  absent path materialize as explicit `null`, the canonical object would differ
  structurally (though not semantically); the corpus round-trip is the guard.
- **Facts must not move.** Adding `.estimated` next to `.actual` is fact-neutral by
  construction (every predicate reads `.actual`), but the counts gate real
  Weichert rules on production writes, so the invariance test is not optional. An
  `estimated`-bearing fact, if ever wanted, is a separate additive catalog entry.
- **Not a hot file.** Nothing here touches the merge-magnet list, so no
  serialization against other streams is needed.
