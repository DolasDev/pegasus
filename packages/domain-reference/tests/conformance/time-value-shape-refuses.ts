/**
 * Conformance — **`fork-time` §(b)(5)'s typed time values, and the fact that none was adopted.**
 *
 * A type-level suite: nothing here runs. Same contract as `core-vocabulary-refuses.ts` — every
 * `@ts-expect-error` must fire, so the day an illegal state becomes legal TypeScript reports the
 * directive as unused (`TS2578`) and this file stops compiling.
 *
 * ## The finding, and why it is here rather than in `documents.test.ts`
 *
 * [`fork-time` §(b)(5)] is a **decision**, not a sketch: _"Time values are typed… Adopt both: a
 * delivery spread is a `LocalDateRange` at destination, an arrival is a `ZonedInstant`"_, and its §1
 * summary adds `LocalDate` and the prohibition — _"No bare ISO strings; no zoneless instants."_
 *
 * The shared layer adopted **none of the three**. `primitives.ts` publishes `Instant` ("ISO-8601
 * with an offset", which is an offset and not the IANA zone of the place the fact occurred) and
 * `CalendarDate`; `TimeValue` is `{at: Instant}`; and no range type exists at any grain.
 *
 * **This was invisible until decision C4.** `documents.test.ts`'s `RECORDED_DIVERGENCES` carried
 * `time.delivery` as a type-position token note 5 did not declare, and C4 gave note 5 the row — so
 * the register's entry was struck. [`fork-time` §8.1]'s committed delivery **spread** needed two
 * things to be publishable and C4 supplied one: its `type` now resolves to `delivery`, and its
 * `value` still has nowhere to go. The second reason has no token in a type position, so the
 * register cannot hold it; it has an edge the types can see, so it is held here instead
 * ([A6 §9] / [A9]'s rule, [SD §4.7] note 5's closing paragraph).
 *
 * **It is recorded, not closed.** Closing it means a value shape and a primitive, which is
 * `changedValueShape` — **breaking** under [catalog §2.3] — and it is owed to [SD §4.1] and
 * [SD §4.2], not to this package. The two halves below are what a later round must break.
 */
import type { Exact, Instant, TimeValue, ValueOf } from '../../src/index'

/* ------------------------------------------------------------------------------------------------
 * Not here — "none of the three primitives is published", and why it is not a type-level check
 * ---------------------------------------------------------------------------------------------- */

/**
 * **The first draft of this file opened with a false green, and it is worth keeping the record.**
 *
 * It held "none of `fork-time` §(b)(5)'s three primitives is published" by absence, on
 * `CustodyIsNotAFactClass`'s pattern:
 *
 * ```
 * Extract<keyof typeof model, 'LocalDate' | 'LocalDateRange' | 'ZonedInstant'> extends never
 * ```
 *
 * It was tampered by adding `export type LocalDateRange = {from: string; to: string}` to
 * `primitives.ts` — and **it did not fail.** `keyof typeof model` enumerates a module's **value**
 * namespace, and all three of §(b)(5)'s primitives are type aliases, which live in the type
 * namespace and are not `keyof`-able. So the assertion could never have fired for any shape the
 * finding is actually about.
 *
 * `CustodyIsNotAFactClass` is not wrong — it reads `RECORD_TYPES`, a runtime array — and that is the
 * distinction the pattern turns on. **Absence of a TYPE has no type-level witness**; it needs a
 * reader. `time-value-shape.test.ts` is that reader, and it is tampered the same way and does fail.
 *
 * What stays here is the pair of shape checks below, which are the claims that matter: publishing a
 * range primitive and never wiring it into a value changes nothing a record can carry.
 */

/* ------------------------------------------------------------------------------------------------
 * Half 1 — `fork-time` §8.1's record cannot be written, and the refusal is on the VALUE
 * ---------------------------------------------------------------------------------------------- */

/**
 * The legal record first, so a tamper that breaks `delivery` at `COMMITTED` outright is caught too.
 *
 * `basis = COMMITTED` on an act is **not** the problem and never was: `ActValue` admits every basis
 * and only withholds `outcome` / `reasons` away from `ACTUAL`. A committed delivery _instant_ is
 * publishable today, which is exactly what makes the spread's absence a value-shape finding rather
 * than a basis one.
 */
const committedDeliveryInstant: ValueOf<'delivery', 'COMMITTED'> = {
  occurredAt: '2026-04-02T00:00:00Z' as Instant,
}
void committedDeliveryInstant

/**
 * The refusal. Named first and annotated on the assignment, because `@ts-expect-error` covers
 * **one** line and an inline literal reports on whichever property TypeScript reaches first — the
 * trap `document-evidence-refuses.ts` records.
 *
 * `fork-time` §8.1 writes _"`value` a `LocalDateRange` in the **destination's** zone"_. Two
 * independent errors stand on this line and either one is enough: `occurredAt` is missing, and
 * `from` / `to` are not properties the shape has.
 */
const committedDeliverySpread = { from: '2026-04-02', to: '2026-04-05' }
// @ts-expect-error — [fork-time §8.1] / [SD §4.7] note 5: the shared layer publishes no range
// primitive, so the committed delivery SPREAD has no value shape. Owed to [SD §4.1], [SD §4.2].
const forkTimeDeliverySpread: ValueOf<'delivery', 'COMMITTED'> = committedDeliverySpread
void forkTimeDeliverySpread

/* ------------------------------------------------------------------------------------------------
 * Half 2 — the zone half, which CANNOT be a refusal, and that is itself the finding
 * ---------------------------------------------------------------------------------------------- */

/**
 * `ZonedInstant` is the same decision on `arrival`, and it does **not** get a `@ts-expect-error`.
 * [A6 §9]'s rule has two halves — gate a recorded gap where it has an edge the types can see, and
 * **say why when it does not** — and this is the second half, found by writing the refusal and
 * watching it not fire.
 *
 * §(b)(5) requires the **IANA zone of the place the fact occurred**, "not the publisher's", and
 * §(b)(6) chooses "occurred" over "captured" explicitly against EPCIS's own self-contradiction.
 * `Instant` is a branded ISO-8601 string with an offset, and `-05:00` does not say
 * `America/New_York` — so the distinction the decision turns on is unrepresentable.
 *
 * **But unrepresentable is not refused.** `TimeValue` is `{at: Instant}`, so a value carrying a
 * `zone` alongside `at` is *structurally assignable* to it: excess-property checking applies to
 * fresh object literals and not to a value that reaches the slot through a variable, which is how
 * every real asserter's payload reaches it. An extra zone is therefore **silently dropped**, not
 * rejected. That is a worse failure than the spread's — the spread cannot be written at all, and
 * this one can be written and lost — and it is the asymmetry this half exists to state.
 *
 * What *can* be gated is the shape being exactly one field, which is the claim "there is nowhere for
 * the zone to go" said in the form a compiler can check. A later round adopting `ZonedInstant` fails
 * this line and `time-value-shape.test.ts` together.
 */
export type TimeValueCarriesOnlyTheInstant = Exact<keyof TimeValue, 'at'>
const _timeValueCarriesOnlyTheInstant: TimeValueCarriesOnlyTheInstant = true
void _timeValueCarriesOnlyTheInstant

/** The drop, demonstrated rather than asserted: this compiles, and the zone is gone from the slot. */
const zonedArrival = { at: '2026-04-02T14:30:00-05:00' as Instant, zone: 'America/New_York' }
const forkTimeZonedArrival: ValueOf<'arrival', 'ACTUAL'> = zonedArrival
void forkTimeZonedArrival
