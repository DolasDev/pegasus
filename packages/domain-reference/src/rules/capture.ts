/**
 * The machine-assertion rule, cut by **capture method** — [SD §5], M1-M7.
 *
 * > "The rule binds on `capturedBy`, not on 'a device'. `ASSUMED_FROM_PLAN` may never carry
 * > `basis = ACTUAL`. Possession-changing facts and all exceptions require a human or partner
 * > asserter. Geofences may assert arrive and depart. One derivation is sanctioned and named."
 * > — [SD §5]
 *
 * The cut is the decision. "`fork-time` bound the rule to 'a device', which forbade the harmless
 * case (a geofence marking arrival) and left the case the rule exists for — `ASSUMED_FROM_PLAN`,
 * 'nobody asserted it; the plan stood unchallenged' — entirely unguarded" ([SD §5]). So nothing in
 * this module tests for a device; every rule tests a member of `capturedBy` ([SD §5.1]).
 *
 * `capturedBy` itself, and its seven members, live in `envelope.ts` — "this part of `fork-time`
 * §(b)(2) is sound and is carried forward unchanged" ([SD §5.1]).
 */

import type { Assertion, Basis, RuleRef } from '../assertions'
import type { CaptureMethod, EventId } from '../envelope'
import type { Outcome } from '../outcomes'
import type { NonEmptyArray, Owed } from '../primitives'
import { owed } from '../primitives'
import type { ActType, AssertionType, CanonicalFamily, RecordType } from '../vocabulary'

/* ------------------------------------------------------------------------------------------------
 * The three-member asserter set M2 and M3 both name
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M2 and M3 both restrict to this same set: `{OBSERVED_BY_PERSON, KEYED_BY_PERSON,
 * PARTNER_ASSERTED}`. It is named once because the two rules genuinely share it — "the principle is
 * Shippeo's (M3)" and M2 is that principle applied to a list of acts.
 *
 * What the three have in common is the only thing that matters to either rule: a party is
 * answerable for the claim. `DEVICE_*` and `ASSUMED_FROM_PLAN` have nobody to attribute it to, and
 * `DERIVED_BY_RULE` attributes it to us (M4, [SD §6.6]).
 */
export const HUMAN_OR_PARTNER = [
  'OBSERVED_BY_PERSON',
  'KEYED_BY_PERSON',
  'PARTNER_ASSERTED',
] as const satisfies readonly CaptureMethod[]

export type HumanOrPartnerCapture = (typeof HUMAN_OR_PARTNER)[number]

export function isHumanOrPartner(method: CaptureMethod): method is HumanOrPartnerCapture {
  return (HUMAN_OR_PARTNER as readonly CaptureMethod[]).includes(method)
}

/* ------------------------------------------------------------------------------------------------
 * M2 — the possession-changing list
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M2: "The catalog publishes the possession-changing list: **packed, loaded, unloaded,
 * delivered, stored in (`storeIn`), released from storage (`storeOut`), custody handed over, item
 * accepted, item refused.**" **[ORIGINAL]** as a list; the principle is Shippeo's (M3).
 *
 * > "**These are acts, and only acts.** The previous revision's list read 'placed in SIT / released
 * > from SIT', which collided head-on with M4… The collision was real and is resolved in the only
 * > way it can be — **the act and the date are two different fact classes** (§5.3)."
 *
 * Seven of M2's nine names are declared types. The other two are handled below.
 */
export const M2_POSSESSION_CHANGING = [
  'packing',
  'loading',
  'unloading',
  'delivery',
  'storeIn',
  'storeOut',
  'handover',
] as const satisfies readonly ActType[]

export type PossessionChangingType = (typeof M2_POSSESSION_CHANGING)[number]

export function isPossessionChanging(type: AssertionType): type is PossessionChangingType {
  return (M2_POSSESSION_CHANGING as readonly AssertionType[]).includes(type)
}

/**
 * M2's list names nine things; two of them are not members of the record vocabulary.
 *
 * `item refused` has a reading in the shared layer and it is not a type: [SD §5.4] and [SD §3.4]
 * make "delivered, two items short" **one** `delivery` act at `PARTIALLY_COMPLETED` with a Portion
 * named in `reasons[].appliesTo` — "one refused article, named as the scope of a delivery act, is a
 * Portion of one, not an `item`-subject assertion, because the fact being asserted is about the
 * delivery and not about the article." On that reading `item refused` is a scope of an act already
 * on the list, and M2 reaches it through `delivery`.
 *
 * `item accepted` has no such reading. It is neither a declared type nor obviously the scope of one.
 *
 * Recorded rather than minted, on the same terms as every other gap here: [SD §4.7] is the only
 * place a vocabulary member may be declared, "and no other document may declare a family."
 */
export const M2_NAMES_WITHOUT_A_DECLARED_TYPE = [
  owed(
    'itemAccepted',
    '[SD §4.7.1] — M2 names it in the possession-changing list and no type carries it',
  ),
  owed(
    'itemRefused',
    '[SD §4.7.1] — read by [SD §5.4] as a Portion in a delivery’s reasons[].appliesTo, not a type',
  ),
] as const

/* ------------------------------------------------------------------------------------------------
 * M4 — the sanctioned derivation
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M4: "`DERIVED_BY_RULE` is permitted on a fact class the catalog has **declared
 * derived** only where the catalog publishes the derivation as a named rule and the record carries
 * `{ruleId, ruleVersion}` **and the `eventId`s of its inputs**."
 *
 * "One case exists today and it is mandatory, not merely permitted: **the SIT entry date**."
 * Sourced twice, from opposite directions — `src:dp3-400ng` Items 29.4 / 29.6 / 17.20 ("SIT in date
 * will be equal to the TSP's **first available delivery date**"; "**the arrival date must NOT be
 * entered as the SIT entry date**") and `src:dtr-part-iv` §D.5.b(2) NOTE (SIT is effective "the date
 * the shipment was **offered for delivery**, not the date it arrived").
 *
 * `mandatory: true` is M4's own word and it is the half that bites: it makes "a keyed arrival date
 * published as the SIT entry date… a detectable defect, and the catalog can detect it because M4
 * requires the derivation to be declared."
 */
export const M4_DECLARED_DERIVED = {
  sitEntryDate: { mandatory: true },
} as const satisfies { readonly [T in AssertionType]?: { readonly mandatory: boolean } }

export type DeclaredDerivedType = keyof typeof M4_DECLARED_DERIVED

export function isDeclaredDerived(type: AssertionType): type is DeclaredDerivedType {
  return Object.prototype.hasOwnProperty.call(M4_DECLARED_DERIVED, type)
}

export function derivationIsMandatory(type: AssertionType): boolean {
  return isDeclaredDerived(type) && M4_DECLARED_DERIVED[type].mandatory
}

/* ------------------------------------------------------------------------------------------------
 * [SD §5.3] — `storeIn` and `sitEntryDate` are two fact classes
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.3], the table, because it is what makes M2 and M4 consistent:
 *
 * > "`storeIn` (the act of placing goods into a storage facility) and `sitEntryDate` (the date
 * > storage becomes effective for accrual and for the tariff clock) are two distinct members of the
 * > record vocabulary, with different subjects, different asserters and different capture rules.
 * > Neither is derivable from the other and neither may be published as the other."
 *
 * "Why this is forced and not a convenience. The two rules collided in the previous revision — M2
 * demanded a human for 'placed in SIT' and M4 demanded a derivation for the SIT entry date — and a
 * single fact class cannot satisfy both… **A rule that has to forbid entering one date into the
 * other field is a rule asserting that the two are different facts.**"
 *
 * _Sourced:_ that the SIT entry date is computed from the first available delivery date, and that a
 * physically-observed date must not be substituted for it. **[ORIGINAL]:** stating the same
 * separation over the **store-in act** specifically — "the tariff names _arrival_… it does not
 * discuss the moment the crew put the goods on the warehouse floor."
 */
export const STORE_IN_VS_SIT_ENTRY_DATE = {
  storeIn: {
    whatItIs: 'an act: a crew put the goods into the facility',
    capturedBy: HUMAN_OR_PARTNER,
    whoCanSayIt: 'the warehouse agent or the TSP crew who did it',
  },
  sitEntryDate: {
    whatItIs: 'a date: when storage starts counting',
    capturedBy: ['DERIVED_BY_RULE'],
    whoCanSayIt: 'the platform, by named rule, from inputs it names',
  },
} as const satisfies {
  readonly [T in 'storeIn' | 'sitEntryDate']: {
    readonly whatItIs: string
    readonly capturedBy: readonly CaptureMethod[]
    readonly whoCanSayIt: string
  }
}

/**
 * The separation, held at compile time rather than described.
 *
 * Same canonical subject (`stay`), opposite halves of the act/non-act cut. That is precisely the
 * shape [SD §5.3] needs: the two facts are about the same aggregate, so the **only** thing that can
 * tell them apart is the `type` — which is [SD §5.2] M7's closing point, "Where a rule needs to
 * distinguish two facts that one loose type name would fuse… the answer is **two vocabulary
 * entries**, not a second axis."
 */
type StoreInIsAnAct = 'storeIn' extends ActType ? true : never
type SitEntryDateIsNotAnAct = 'sitEntryDate' extends ActType ? never : true
type BothAreStaySubjects = [CanonicalFamily<'storeIn'>, CanonicalFamily<'sitEntryDate'>] extends [
  'stay',
  'stay',
]
  ? true
  : never
const _storeInIsAnAct: StoreInIsAnAct = true
const _sitEntryDateIsNotAnAct: SitEntryDateIsNotAnAct = true
const _bothAreStaySubjects: BothAreStaySubjects = true
void _storeInIsAnAct
void _sitEntryDateIsNotAnAct
void _bothAreStaySubjects

/**
 * [SD §5.3] consequence 2, and [SD §6.6]: "**the cascade is not a correction.** The derived value is
 * an Assertion with `capturedBy = DERIVED_BY_RULE` (M4); when an input is retracted, the platform
 * publishes a **new** derived Assertion and a new `FactResolved`. The platform asserts what it
 * derived, which it plainly has authority to do; it never corrects the warehouse agent's fact."
 *
 * Stated as a predicate over what a retraction of an input licenses, so that the one thing the
 * cascade may **not** produce is named: a `Correction` against the `storeIn` act.
 */
export function cascadeOnRetractedInput(type: AssertionType): {
  readonly publishNewDerivedAssertion: boolean
  readonly republishFactResolved: boolean
  readonly correctTheWitnessedAct: false
} {
  return {
    publishNewDerivedAssertion: isDeclaredDerived(type),
    republishFactResolved: isDeclaredDerived(type),
    // [SD §6.6]: "an automatic cascade is a correction to a warehouse-authoritative, legally
    // load-bearing date, declared by the platform, with no authority the model grants it."
    correctTheWitnessedAct: false,
  }
}

/* ------------------------------------------------------------------------------------------------
 * M5 — what a geofence may assert
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M5: "`DEVICE_GEOFENCE` may carry `basis = ACTUAL` for **arrival at a stop, departure
 * from a stop, position, and ETA change**. _Sourced:_ five of Shippeo's seven geofence-eligible rows
 * are exactly these (`ARR_LOAD`, `LEFT_LOADING_SITE`, `ARR_UNLOAD`, `DRIVER_LEFT_UNLOAD`,
 * `ETA_EVENT`)."
 *
 * Two of M5's four have declared types. The other two are below, and one of them is a gap nothing
 * in the shared layer has yet recorded.
 */
export const M5_GEOFENCE_ELIGIBLE = [
  'arrival',
  'departure',
] as const satisfies readonly AssertionType[]

export type GeofenceEligibleType = (typeof M5_GEOFENCE_ELIGIBLE)[number]

export function isGeofenceEligible(type: AssertionType): type is GeofenceEligibleType {
  return (M5_GEOFENCE_ELIGIBLE as readonly AssertionType[]).includes(type)
}

/**
 * The two M5 names with no `type` to attach to.
 *
 * `eta` is already recorded absent-and-owed at [SD §4.7.3] (`ABSENT_AND_OWED` in `vocabulary.ts`),
 * so M5's fourth member licenses a fact class the vocabulary does not yet carry. Note also that an
 * ETA is not a fact class of its own in this model at all: [SD §4.5] replaces Alvys's
 * `Eta {Planned, Live, Manual}` with `basis` + `capturedBy`, which makes an ETA an `arrival` at
 * `basis = ESTIMATED` — on that reading M5's "ETA change" is already covered by `arrival`.
 *
 * `position` is the genuine gap: **it appears in no table in the shared layer.** It is not a member
 * of the record vocabulary ([SD §4.7.1]) and not among the classes [SD §4.7.3] lists as
 * deliberately absent, so M5 permits a geofence to assert something the catalog cannot publish.
 * TODO([SD §4.7.3]): record `position` as absent and owed, or mint it — either is [SD §4.7]'s to do.
 */
export const M5_NAMES_WITHOUT_A_DECLARED_TYPE = [
  owed('position', '[SD §4.7.1] and [SD §4.7.3] — named by M5, in no table at all'),
  owed(
    'etaChange',
    '[SD §4.7.3] — `eta` is absent-and-owed; [SD §4.5] reads it as `arrival` at basis = ESTIMATED',
  ),
] as const

/* ------------------------------------------------------------------------------------------------
 * M3 — the sourced count, and where our rule goes past it
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M3's citation, with the count correction [SD §5.2] makes and all four documents
 * inherited. Carried as numbers so the sourced claim is checkable rather than remembered.
 *
 * > "Every document said '41 rows' and '7 of 41'. The committed file
 * > `sources/shippeo/local/event-list-order-level.md` is 40 lines: one header, one separator,
 * > **38 data rows**… The '24 exception rows' figure is likewise an inherited approximation and is
 * > replaced by the measured 25 non-conform rows above. **The finding is unaffected in every
 * > document that uses it** — seven geofence-marked rows, none of them an exception."
 */
export const M3_SHIPPEO_GEOFENCE_COLUMN = {
  dataRows: 38,
  geofenceMarkedRows: 7,
  /** `ARR_LOAD`, `CON_LOAD`, `LEFT_LOADING_SITE`, `ARR_UNLOAD`, `CON_UNLOAD`, `DRIVER_LEFT_UNLOAD`,
   * `ETA_EVENT` (`:7, :8, :11, :19, :20, :24, :39`). */
  geofenceMarked: [
    'ARR_LOAD',
    'CON_LOAD',
    'LEFT_LOADING_SITE',
    'ARR_UNLOAD',
    'CON_UNLOAD',
    'DRIVER_LEFT_UNLOAD',
    'ETA_EVENT',
  ],
  /** Rows carrying a justification other than `CFM` conform, `ARS` arrival or `DES` departure. */
  nonConformRows: 25,
  /** "**Not one of the geofence-marked rows is an exception row**" — the finding M3 rests on. */
  geofenceMarkedExceptionRows: 0,
} as const

/**
 * **[ORIGINAL] where the rule goes beyond the cite** — [SD §5.2] M3, and the direction matters:
 *
 * > "Shippeo's published rule is about _geofence eligibility_ over those 38 order-level rows.
 * > Extending it to all machine assertion of exceptions is our step, and it makes our rule
 * > **stricter than the source** — Shippeo itself derives
 * > `CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}` from position, i.e. a machine asserting
 * > _why something is late_. We forbid that; Shippeo does not."
 */
export const M3_EXTENSION_BEYOND_THE_SOURCE = {
  sourceRule: 'geofence eligibility over 38 order-level rows',
  ourRule: 'every machine assertion of an exception or a reason, by any capture method',
  strictness: 'STRICTER_THAN_THE_SOURCE',
  theCaseTheSourceAllowsAndWeForbid: 'CALCULATED_DELAY_DRIVING_TOWARD_SITE_{LOAD,UNLOAD}',
} as const

/* ------------------------------------------------------------------------------------------------
 * M6 — the two defects, named and rejected
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M6(a): geofence-derived conformity. `CON_LOAD` and `CON_UNLOAD` are "_conformity_
 * assertions, 'goods were loaded conform', 'goods delivered with no observations'. A geofence can
 * witness a departure; it cannot witness that nothing was missing. Shippeo's own analysis calls it
 * 'a convenience, and adopting it would silently manufacture evidence.'"
 *
 * "Under M2 and M3 it is inexpressible here" — and doubly so, because of the parenthesis: "(HHG
 * conformity is not one bit anyway: it is per-item against a signed inventory — which is why it is
 * a `condition` fact class at `item` grain, §4.1, not a flag on a delivery.)" There is no
 * conformity type to assert, and `condition`'s subject is the `item` ([SD §5.4]).
 */
export const M6A_GEOFENCE_DERIVED_CONFORMITY = {
  rejected: true,
  shippeoRows: ['CON_LOAD', 'CON_UNLOAD'],
  whyInexpressible:
    'no conformity type exists; conformity is `condition` at `item` grain [SD §4.1]',
  whyRejected: 'a geofence can witness a departure; it cannot witness that nothing was missing',
} as const

/**
 * [SD §5.2] M6(b): "a two-valued trigger enum that cannot describe its own publisher."
 * `trigger.type ∈ {manual, geofencing}` is required on every outbound standard event and "Shippeo
 * emits at least **four** kinds… **Two of the four have to lie on the wire.**"
 *
 * "Our seven-member enum covers all four: schedule-derived is `ASSUMED_FROM_PLAN` (and therefore,
 * under M1, may not be ACTUAL), computation-derived is `DERIVED_BY_RULE`."
 *
 * The first row is the one the source spells two ways for one thing; ours splits it, which is why
 * it maps to two members.
 */
export const M6B_PUBLISHER_KINDS = {
  declarative: ['KEYED_BY_PERSON', 'PARTNER_ASSERTED'],
  geofenceDerived: ['DEVICE_GEOFENCE'],
  /** `DRIVING_TO_LOAD` "can be declarative (by the carrier) **or Shippeo triggered 1 hour before
   * the beginning of the pickup start slot**" (`event-list-order-level.md:6`, `:17`). */
  scheduleDerived: ['ASSUMED_FROM_PLAN'],
  /** `CALCULATED_DELAY_DRIVING_TOWARD_SITE_*` — and under M3 we forbid it asserting an exception. */
  computationDerived: ['DERIVED_BY_RULE'],
} as const satisfies Record<string, readonly CaptureMethod[]>

/* ------------------------------------------------------------------------------------------------
 * M7 — eligibility declared per record type
 * ---------------------------------------------------------------------------------------------- */

/**
 * [SD §5.2] M7: "`capturedBy` eligibility is declared per record `type` in the catalog and enforced
 * on the wire… **[ORIGINAL]:** promoting the table to a wire-enforced per-type declaration.
 * Shippeo's analysis recommends the direction — 'make it a property of the event type, not a runtime
 * guess' — but the enforcement is ours."
 *
 * Three shapes, because the documents fix three different amounts:
 *
 * - `CLOSED_AT_EVERY_BASIS` — a rule closes the set outright (M4's mandatory derivation).
 * - `CLOSED_AT_ACTUAL` — M2 and M3 are written at `basis = ACTUAL` and say nothing about the plan
 *   bases. Declaring the plan-basis set by analogy would be exactly the guess [SD §0] forbids, so
 *   it is carried as owed and the boundary reports it as undeclared rather than admitting on it.
 * - `OWED` — M7 requires a declaration and no document supplies one. A row may still name methods
 *   a rule **permits** (M5's geofence): a permission can admit, but it cannot refuse, because
 *   refusing needs the closed set that is owed.
 */
export type CaptureEligibility =
  | {
      readonly declaration: 'CLOSED_AT_EVERY_BASIS'
      readonly methods: NonEmptyArray<CaptureMethod>
    }
  | {
      readonly declaration: 'CLOSED_AT_ACTUAL'
      readonly atActual: NonEmptyArray<CaptureMethod>
      readonly atPlanBasis: Owed<'captureEligibilityAtPlanBasis', string>
    }
  | {
      readonly declaration: 'OWED'
      readonly knownPermittedAtActual: readonly CaptureMethod[]
      readonly owed: Owed<'captureEligibility', string>
    }

const closedAtEveryBasis = (methods: NonEmptyArray<CaptureMethod>): CaptureEligibility => ({
  declaration: 'CLOSED_AT_EVERY_BASIS',
  methods,
})

const closedAtActual = (
  atActual: NonEmptyArray<CaptureMethod>,
  whyPlanBasisIsOwed: string,
): CaptureEligibility => ({
  declaration: 'CLOSED_AT_ACTUAL',
  atActual,
  atPlanBasis: owed('captureEligibilityAtPlanBasis', whyPlanBasisIsOwed),
})

const eligibilityOwed = (
  owedTo: string,
  knownPermittedAtActual: readonly CaptureMethod[] = [],
): CaptureEligibility => ({
  declaration: 'OWED',
  knownPermittedAtActual,
  owed: owed('captureEligibility', owedTo),
})

/** M2's three, at ACTUAL; the plan bases are owed for all seven acts for one reason, stated once. */
const M2_ROW = (): CaptureEligibility =>
  closedAtActual(
    [...HUMAN_OR_PARTNER],
    '[SD §5.2] M2 is written at basis = ACTUAL and M7 owes the plan-basis declaration',
  )

/** Every type whose eligibility M7 requires and no document declares, with who owes it. */
const M7_OWED = '[SD §5.2] M7 — the per-type eligibility declaration is required and undeclared'

/**
 * **The M7 declaration table.**
 *
 * [SD §5.2] puts it in the same per-type entry as E-CANON's canonical subject family — "**one entry
 * per record type, carrying everything the boundary must check about it**: its legal subject family,
 * its `qualifier` shape, its `value` shape, and its eligible capture methods." It is in this module
 * rather than beside `CANONICAL_SUBJECT_FAMILY` only because M1-M6 are what give most rows a value;
 * the two tables are one declaration and the conformance suite keys both off `RecordType`.
 *
 * `satisfies` over `RecordType` is the same mechanism [SD §4.7] needs: a vocabulary member with no
 * eligibility row does not compile, so M7's "declared per record type" cannot quietly become
 * "declared for the types somebody got to".
 */
export const M7_ELIGIBILITY = {
  // M2's possession-changing acts — [SD §5.2] M2, and [SD §5.3]'s table for `storeIn`.
  packing: M2_ROW(),
  loading: M2_ROW(),
  unloading: M2_ROW(),
  delivery: M2_ROW(),
  storeIn: M2_ROW(),
  storeOut: M2_ROW(),
  handover: M2_ROW(),
  // M4's one declared-derived class, mandatorily derived — [SD §5.2] M4, [SD §5.3].
  sitEntryDate: closedAtEveryBasis(['DERIVED_BY_RULE']),
  // M5 permits a geofence here; it does not close the set. [SD §4.7.1] keeps these out of M2/M3 by
  // making them "time facts about a _visit_", not acts — which is why they have no outcome to guard.
  //
  // The other two permitted methods are cited rather than assumed: [SD §4.6.3]'s worked case is a
  // destination agent who "keys 'shipment S arrived'" (`KEYED_BY_PERSON`), and [SD §4.6.2]
  // E-CANON-RESOLVE mints that same arrival with `capturedBy = PARTNER_ASSERTED`. Note what is
  // deliberately NOT here: `OBSERVED_BY_PERSON`, which no document names on an arrival. Adding it
  // by analogy with M2's three would be the guess [SD §0] forbids, so it falls to `UNDECLARED`.
  arrival: eligibilityOwed(M7_OWED, ['DEVICE_GEOFENCE', 'KEYED_BY_PERSON', 'PARTNER_ASSERTED']),
  departure: eligibilityOwed(M7_OWED, ['DEVICE_GEOFENCE', 'KEYED_BY_PERSON', 'PARTNER_ASSERTED']),
  // Measures, counts, conditions, identifiers, money, notifications, role-holdings. No document
  // declares an eligible set for any of them.
  'weight.net': eligibilityOwed(M7_OWED),
  'weight.gross': eligibilityOwed(M7_OWED),
  'weight.tare': eligibilityOwed(M7_OWED),
  pieceCount: eligibilityOwed(M7_OWED),
  condition: eligibilityOwed(M7_OWED),
  identity: eligibilityOwed(M7_OWED),
  charge: eligibilityOwed(M7_OWED),
  notification: eligibilityOwed(M7_OWED),
  partyRole: eligibilityOwed(M7_OWED),
  // The twelve plan-, binding- and commitment-side acts. They are acts, so M3 reaches their
  // exceptional outcomes; M2 does not reach them, because none changes possession of goods.
  tripDelay: eligibilityOwed(M7_OWED),
  tripResequence: eligibilityOwed(M7_OWED),
  tripCancellation: eligibilityOwed(M7_OWED),
  membershipOffer: eligibilityOwed(M7_OWED),
  membershipResponse: eligibilityOwed(M7_OWED),
  membershipRelease: eligibilityOwed(M7_OWED),
  assignmentOffer: eligibilityOwed(M7_OWED),
  assignmentResponse: eligibilityOwed(M7_OWED),
  assignmentRelease: eligibilityOwed(M7_OWED),
  orderAward: eligibilityOwed(M7_OWED),
  orderResponse: eligibilityOwed(M7_OWED),
  orderCancellation: eligibilityOwed(M7_OWED),
  // The meta-records. [SD §4.3] fixes `FactResolved`'s capture method as part of the record class,
  // which is a closed declaration by another name. [SD §6] fixes none for `Correction`.
  FactResolved: closedAtEveryBasis(['DERIVED_BY_RULE']),
  Correction: eligibilityOwed(
    '[SD §6] — the corrections area owes `Correction`’s eligible capture methods',
  ),
} as const satisfies { readonly [T in RecordType]: CaptureEligibility }

/* ------------------------------------------------------------------------------------------------
 * The verdict
 * ---------------------------------------------------------------------------------------------- */

export const CAPTURE_RULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'] as const

export type CaptureRuleId = (typeof CAPTURE_RULE_IDS)[number]

/**
 * Why a record's capture method is refused. Discriminated on `(rule, code)` so a consumer can act
 * on the specific defect — M4's three codes are three different repairs.
 *
 * M6 has no code: it is not a runtime test but two named defects we decline to model, and both are
 * refused by M2/M3/M1 when they arrive. `M6A_GEOFENCE_DERIVED_CONFORMITY` records why.
 */
export type CaptureRejection =
  | {
      readonly rule: 'M1'
      readonly code: 'ASSUMED_FROM_PLAN_AT_ACTUAL'
      readonly capturedBy: 'ASSUMED_FROM_PLAN'
    }
  | {
      readonly rule: 'M2'
      readonly code: 'POSSESSION_CHANGING_NEEDS_HUMAN_OR_PARTNER'
      readonly type: PossessionChangingType
      readonly capturedBy: CaptureMethod
    }
  | {
      /** M4 "does **not** reach into M2's list: it licenses a _different_ fact class, never a
       * derived substitute for an act somebody was supposed to witness (§5.3)." */
      readonly rule: 'M2'
      readonly code: 'DERIVED_SUBSTITUTE_FOR_A_WITNESSED_ACT'
      readonly type: PossessionChangingType
      readonly theDifferentFactClass: 'sitEntryDate'
    }
  | {
      readonly rule: 'M3'
      readonly code: 'EXCEPTION_NEEDS_HUMAN_OR_PARTNER'
      readonly outcome: Outcome | undefined
      readonly reasonCount: number
      readonly capturedBy: CaptureMethod
    }
  | {
      readonly rule: 'M4'
      readonly code: 'DERIVATION_NOT_DECLARED'
      readonly type: AssertionType
    }
  | {
      readonly rule: 'M4'
      readonly code: 'DERIVATION_MISSING_RULE_OR_INPUTS'
      readonly type: DeclaredDerivedType
    }
  | {
      readonly rule: 'M4'
      readonly code: 'DECLARED_DERIVED_MUST_BE_DERIVED'
      readonly type: DeclaredDerivedType
      readonly capturedBy: CaptureMethod
    }
  | {
      readonly rule: 'M5'
      readonly code: 'GEOFENCE_MAY_NOT_ASSERT_THIS'
      readonly type: AssertionType
      readonly eligible: readonly AssertionType[]
    }
  | {
      readonly rule: 'M7'
      readonly code: 'NOT_ELIGIBLE_FOR_TYPE'
      readonly type: AssertionType
      readonly capturedBy: CaptureMethod
      readonly declared: readonly CaptureMethod[]
    }

/**
 * Three arms, not two.
 *
 * `UNDECLARED` is not a hedge and it is not a pass: M7 requires an eligibility declaration per
 * record type, most types have none, and the two dishonest options are to admit (claiming a check
 * ran that did not) or to refuse (refusing traffic on the strength of a gap in our own table).
 * [SD §0] forbids guessing a value to make the types tidy, and an eligibility set is a value.
 * M1-M5 still run and still refuse, so an `UNDECLARED` verdict means only that **no rule in the
 * shared layer speaks to this (type, basis, method)**.
 */
export type CaptureVerdict<T extends AssertionType = AssertionType> =
  | {
      readonly verdict: 'ADMITTED'
      readonly type: T
      readonly capturedBy: CaptureMethod
      /**
       * On what basis, because the two are not equally strong and the difference is M7's whole
       * point. `M7_CLOSED_DECLARATION` is the rule doing its job: the catalog declares this type's
       * eligible set and this method is in it. `EXPLICIT_PERMISSION` is weaker — some rule permits
       * this method (M5 for a geofence; [SD §4.6.2]/[SD §4.6.3] for a keyed or partner-asserted
       * arrival) while M7's closed set for the type is still owed, so nothing here could have
       * refused a method the permission does not name.
       */
      readonly licensedBy: 'M7_CLOSED_DECLARATION' | 'EXPLICIT_PERMISSION'
    }
  | { readonly verdict: 'REJECTED'; readonly type: T; readonly rejection: CaptureRejection }
  | {
      readonly verdict: 'UNDECLARED'
      readonly type: T
      readonly rule: 'M7'
      readonly capturedBy: CaptureMethod
      readonly owed: Owed<'captureEligibility' | 'captureEligibilityAtPlanBasis', string>
    }

/**
 * The fields M1-M7 actually read, projected off a record.
 *
 * Deliberately not `Assertion<T>`: M1-M7 are predicates over `(type, basis, capturedBy, outcome)`
 * plus M4's derivation, and taking the whole record would let a rule reach a field it has no
 * business reading. {@link captureFactsOf} is the projection from a real Assertion.
 */
export interface CaptureFacts<T extends AssertionType = AssertionType> {
  readonly type: T
  readonly basis: Basis
  readonly capturedBy: CaptureMethod
  /** [SD §4.1]: present only on an act at `basis = ACTUAL`; `undefined` on every other record. */
  readonly outcome?: Outcome
  /** [SD §2.3] invariant 2. Zero unless the act carries reasons. */
  readonly reasonCount: number
  /** M4: "`{ruleId, ruleVersion}` **and the `eventId`s of its inputs**". */
  readonly derivation?: { readonly rule: RuleRef; readonly inputs: NonEmptyArray<EventId> }
}

/**
 * Project an Assertion onto the fields the capture rules read.
 *
 * `SitEntryDateValue` carries M4's `{derivedBy, inputs}` on the **value**, because M4 requires the
 * record to carry them; act values carry `{outcome, reasons}`. One cast reads both, for the same
 * reason `factRefOf` uses one ([SD §1.3]): `Assertion<T>` is a distributive union over five bases
 * and the projection is over fields every arm shares or omits.
 */
export function captureFactsOf<T extends AssertionType>(assertion: Assertion<T>): CaptureFacts<T> {
  const record = assertion as unknown as {
    readonly type: T
    readonly basis: Basis
    readonly capturedBy: CaptureMethod
    readonly value: {
      readonly outcome?: Outcome
      readonly reasons?: readonly unknown[]
      readonly derivedBy?: RuleRef
      readonly inputs?: NonEmptyArray<EventId>
    }
  }
  const { outcome, reasons, derivedBy, inputs } = record.value
  return {
    type: record.type,
    basis: record.basis,
    capturedBy: record.capturedBy,
    ...(outcome === undefined ? {} : { outcome }),
    reasonCount: reasons === undefined ? 0 : reasons.length,
    ...(derivedBy !== undefined && inputs !== undefined
      ? { derivation: { rule: derivedBy, inputs } }
      : {}),
  }
}

/**
 * M1 — **[ORIGINAL], and it departs from a source.**
 *
 * > "`ASSUMED_FROM_PLAN` may never carry `basis = ACTUAL`. A plan that nothing contradicted is a
 * > plan. It is published at `basis = PLANNED`, and `FactResolved` is what answers 'our best current
 * > value' — so the operational need is met without fabricating an observation."
 *
 * The source it departs from is `src:omnitracs-roadnet`, which "carries `AssumedFromProjection` as a
 * `DataSource` value _on a measured actual_. We forbid that." The argument is `fork-time`'s own:
 * "a planned value that nothing contradicted is indistinguishable from an observation, which is the
 * difference between a record and a fabrication."
 *
 * This is also the rule [SD §4.6.1](a) leans on to refuse a boundary re-key — "a guessed subject is
 * the same defect one field to the left."
 */
function checkM1(facts: CaptureFacts): CaptureRejection | null {
  if (facts.capturedBy === 'ASSUMED_FROM_PLAN' && facts.basis === 'ACTUAL') {
    return { rule: 'M1', code: 'ASSUMED_FROM_PLAN_AT_ACTUAL', capturedBy: 'ASSUMED_FROM_PLAN' }
  }
  return null
}

/**
 * M2 — "Possession-changing facts may be asserted at `basis = ACTUAL` only with
 * `capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}` — never `DEVICE_*`, never
 * `ASSUMED_FROM_PLAN` (already excluded by M1), and `DERIVED_BY_RULE` only under M4."
 *
 * The last clause is read against M4's own sentence, which is the reconciliation [SD §5.3] exists
 * to make: "M4 does **not** reach into M2's list: it licenses a _different_ fact class, never a
 * derived substitute for an act somebody was supposed to witness." So on the seven acts,
 * `DERIVED_BY_RULE` is refused — and refused with its own code, because the repair is not "get a
 * human to key it" but "publish the `sitEntryDate` you actually meant."
 */
function checkM2(facts: CaptureFacts): CaptureRejection | null {
  if (facts.basis !== 'ACTUAL') return null
  if (!isPossessionChanging(facts.type)) return null
  if (isHumanOrPartner(facts.capturedBy)) return null
  if (facts.capturedBy === 'DERIVED_BY_RULE') {
    return {
      rule: 'M2',
      code: 'DERIVED_SUBSTITUTE_FOR_A_WITNESSED_ACT',
      type: facts.type,
      theDifferentFactClass: 'sitEntryDate',
    }
  }
  return {
    rule: 'M2',
    code: 'POSSESSION_CHANGING_NEEDS_HUMAN_OR_PARTNER',
    type: facts.type,
    capturedBy: facts.capturedBy,
  }
}

/**
 * M3 — "Every act record with `outcome ≠ COMPLETED`, and every `Reason`, requires
 * `capturedBy ∈ {OBSERVED_BY_PERSON, KEYED_BY_PERSON, PARTNER_ASSERTED}`."
 *
 * Both halves are tested, and in this model the second is the wider one only in principle: [SD §2]
 * puts `reasons[]` inside an act's `value` at `basis = ACTUAL`, so a `Reason` cannot presently occur
 * anywhere an outcome does not. Testing it separately anyway is deliberate — if a later fact class
 * carries reasons, M3 already covers it rather than needing to be remembered.
 */
function checkM3(facts: CaptureFacts): CaptureRejection | null {
  const isException = facts.outcome !== undefined && facts.outcome !== 'COMPLETED'
  if (!isException && facts.reasonCount === 0) return null
  if (isHumanOrPartner(facts.capturedBy)) return null
  return {
    rule: 'M3',
    code: 'EXCEPTION_NEEDS_HUMAN_OR_PARTNER',
    ...(facts.outcome === undefined ? { outcome: undefined } : { outcome: facts.outcome }),
    reasonCount: facts.reasonCount,
    capturedBy: facts.capturedBy,
  }
}

/**
 * M4 — the sanctioned carve-out, in both directions.
 *
 * Permission: `DERIVED_BY_RULE` needs a **declared-derived** fact class and a record carrying
 * `{ruleId, ruleVersion}` and its inputs' `eventId`s. Obligation: a class the catalog declares
 * *mandatorily* derived may not arrive any other way — which is what makes "a keyed arrival date
 * published as the SIT entry date… a detectable defect" ([SD §5.2] M4, `src:dp3-400ng` Item 17.20).
 *
 * M2's list is checked before this one, so the "derived substitute for a witnessed act" case never
 * reaches here.
 */
function checkM4(facts: CaptureFacts): CaptureRejection | null {
  if (facts.capturedBy === 'DERIVED_BY_RULE') {
    if (!isDeclaredDerived(facts.type)) {
      return { rule: 'M4', code: 'DERIVATION_NOT_DECLARED', type: facts.type }
    }
    if (facts.derivation === undefined) {
      return { rule: 'M4', code: 'DERIVATION_MISSING_RULE_OR_INPUTS', type: facts.type }
    }
    return null
  }
  if (derivationIsMandatory(facts.type) && isDeclaredDerived(facts.type)) {
    return {
      rule: 'M4',
      code: 'DECLARED_DERIVED_MUST_BE_DERIVED',
      type: facts.type,
      capturedBy: facts.capturedBy,
    }
  }
  return null
}

/**
 * M5 — "`DEVICE_GEOFENCE` may carry `basis = ACTUAL` for arrival at a stop, departure from a stop,
 * position, and ETA change."
 *
 * Tested at ACTUAL only, because that is where the rule is written. A geofence at a plan basis is
 * left to M7's per-type declaration, which for every type here is owed — reported as `UNDECLARED`
 * rather than waved through.
 *
 * `DEVICE_TELEMETRY` is deliberately **not** given a permission of its own: [SD §5.1] retains it as
 * a capture method and no rule in [SD §5.2] says what it may assert. That is M7's gap, not a licence.
 */
function checkM5(facts: CaptureFacts): CaptureRejection | null {
  if (facts.capturedBy !== 'DEVICE_GEOFENCE') return null
  if (facts.basis !== 'ACTUAL') return null
  if (isGeofenceEligible(facts.type)) return null
  return {
    rule: 'M5',
    code: 'GEOFENCE_MAY_NOT_ASSERT_THIS',
    type: facts.type,
    eligible: M5_GEOFENCE_ELIGIBLE,
  }
}

/**
 * M7 — the per-type declaration, enforced at the boundary.
 *
 * Returns a verdict rather than a rejection, because this is the one rule whose table can be silent:
 * a row that declares a closed set refuses or admits, and a row that is owed can only admit on an
 * explicit permission (M5's geofence) or report itself undeclared.
 */
export function checkEligibility(
  type: RecordType,
  basis: Basis,
  capturedBy: CaptureMethod,
):
  | {
      readonly outcome: 'ELIGIBLE'
      readonly licensedBy: 'M7_CLOSED_DECLARATION' | 'EXPLICIT_PERMISSION'
    }
  | { readonly outcome: 'NOT_ELIGIBLE'; readonly declared: readonly CaptureMethod[] }
  | {
      readonly outcome: 'UNDECLARED'
      readonly owed: Owed<'captureEligibility' | 'captureEligibilityAtPlanBasis', string>
    } {
  const row: CaptureEligibility = M7_ELIGIBILITY[type]
  switch (row.declaration) {
    case 'CLOSED_AT_EVERY_BASIS':
      return row.methods.includes(capturedBy)
        ? { outcome: 'ELIGIBLE', licensedBy: 'M7_CLOSED_DECLARATION' }
        : { outcome: 'NOT_ELIGIBLE', declared: row.methods }
    case 'CLOSED_AT_ACTUAL':
      if (basis !== 'ACTUAL') return { outcome: 'UNDECLARED', owed: row.atPlanBasis }
      return row.atActual.includes(capturedBy)
        ? { outcome: 'ELIGIBLE', licensedBy: 'M7_CLOSED_DECLARATION' }
        : { outcome: 'NOT_ELIGIBLE', declared: row.atActual }
    case 'OWED':
      if (basis === 'ACTUAL' && row.knownPermittedAtActual.includes(capturedBy)) {
        return { outcome: 'ELIGIBLE', licensedBy: 'EXPLICIT_PERMISSION' }
      }
      return { outcome: 'UNDECLARED', owed: row.owed }
    default:
      // Unreachable: `declaration` is a closed three-member union. It returns rather than calling
      // `assertNever` because a boundary check must not throw — a record it cannot judge is
      // undeclared, which is the same verdict a fourth, undecided shape would deserve.
      return { outcome: 'UNDECLARED', owed: owed('captureEligibility', M7_OWED) }
  }
}

/**
 * M1-M7 over one record, in the order the rules constrain each other.
 *
 * M1 first, because M2 cites it as already having excluded `ASSUMED_FROM_PLAN`. M2 before M4,
 * because M4's carve-out must not be reachable on M2's list ([SD §5.3]). M7 last, because it is the
 * declaration the first six rules populate.
 *
 * Never throws: an inadmissible record is a published outcome of this model ([SD §4.6.2]), not an
 * exceptional condition of a program.
 */
export function checkCapture<T extends AssertionType>(facts: CaptureFacts<T>): CaptureVerdict<T> {
  for (const check of [checkM1, checkM2, checkM3, checkM4, checkM5]) {
    const rejection = check(facts)
    if (rejection !== null) {
      return { verdict: 'REJECTED', type: facts.type, rejection }
    }
  }
  const eligibility = checkEligibility(facts.type, facts.basis, facts.capturedBy)
  switch (eligibility.outcome) {
    case 'ELIGIBLE':
      return {
        verdict: 'ADMITTED',
        type: facts.type,
        capturedBy: facts.capturedBy,
        licensedBy: eligibility.licensedBy,
      }
    case 'NOT_ELIGIBLE':
      return {
        verdict: 'REJECTED',
        type: facts.type,
        rejection: {
          rule: 'M7',
          code: 'NOT_ELIGIBLE_FOR_TYPE',
          type: facts.type,
          capturedBy: facts.capturedBy,
          declared: eligibility.declared,
        },
      }
    case 'UNDECLARED':
      return {
        verdict: 'UNDECLARED',
        type: facts.type,
        rule: 'M7',
        capturedBy: facts.capturedBy,
        owed: eligibility.owed,
      }
    default:
      // Unreachable, and not an `assertNever` for the reason given in `checkEligibility`.
      return {
        verdict: 'UNDECLARED',
        type: facts.type,
        rule: 'M7',
        capturedBy: facts.capturedBy,
        owed: owed('captureEligibility', M7_OWED),
      }
  }
}

/** The same check, taking a real Assertion. */
export function checkCaptureOf<T extends AssertionType>(
  assertion: Assertion<T>,
): CaptureVerdict<T> {
  return checkCapture(captureFactsOf(assertion))
}
