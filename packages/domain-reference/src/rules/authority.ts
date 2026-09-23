/**
 * Assertional authority — [A8].
 *
 * > "**Authority in this document is _assertional_ authority: whose assertion of a given fact
 * > class, about a given instant, the catalog selects when assertions disagree. It is not
 * > liability, not payment, not permission to act, and not ownership of the goods.**" — [A8 §1]
 *
 * Three shipped mechanisms consume authority as an input ([A8 §Why it exists]): `FactResolved.rule`
 * needs a rule class to name, `Correction.authority` needs a vocabulary, and the `UNAUTHORISED`
 * correction outcome is undecidable without a table saying who *does* have authority. This module
 * is those three, plus the handoff rule.
 *
 * **What it is not.** [A8 §1]: authority is not a permission system — "a party with no authority
 * over a fact class **may still assert it**; the assertion is recorded… Authority changes which
 * assertion **wins**, never whether one may be made." Nothing here returns "refused", and
 * {@link StandingHasNoSuppressedMember} makes that structural.
 *
 * **Confidence, carried from [A8 §10] and not to be lost in translation.** Rows 6, 7, 9 and 10 are
 * citations. Rows 1-5, 8 and 11 are **Medium — [ORIGINAL] in the step that matters**: "every row's
 * _duty_ is sourced (who must record, who must perform, who must approve). **Converting a recording
 * duty into assertional authority is authored in every one of them.**"
 */

import type { Assertion, FactResolved } from '../assertions'
import { ruleRef, type RuleRef } from '../assertions'
import type { RoleName } from '../envelope'
import type {
  CustodyAt,
  CustodyAuthority,
  CustodyBasis,
  CustodyHolder,
  ExternallyPerformedLeg,
} from '../custody'
import { HANDED_OVER, HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY } from '../custody'
import type { PartyId } from '../ids'
import type { Exact, Instant, Owed } from '../primitives'
import { assertNever, owed } from '../primitives'
import type { AssertionType, QualifierByType } from '../vocabulary'
import { isActType } from '../vocabulary'
import { R_WEIGHT_LOWER } from './resolution'

/* -------------------------------------------------------------------------------------------- */
/* §4.1 — the four standings                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * [A8 §4.1]. Four standings, and the differences between them are effects on `FactResolved`, not
 * shades of confidence.
 *
 * - `authoritative` — selected by default, "absent a named value rule that overrides";
 * - `corroborating` — agrees, appears in `considered[]`, **changes no answer**. "**Its absence is
 *   not evidence of anything**" — [ORIGINAL], and a guardrail: most corroborating roles have no
 *   obligation to speak, so silence must never lower the confidence of the authoritative
 *   assertion. `src:dp3-tender-of-service` §C.9.a(24) supplies the instinct from the other side: "a
 *   signed bingo card or check-off sheet does not indicate proof of delivery";
 * - `competing` — disagrees and **is eligible to win** under a named value rule. "The most
 *   important of the four";
 * - `advisory` — can never win this fact class. Recorded, considered, never selected.
 */
export const STANDINGS = ['authoritative', 'corroborating', 'competing', 'advisory'] as const

export type Standing = (typeof STANDINGS)[number]

/**
 * [A8 §1]: "Authority is **not a permission system**… Authority changes which assertion **wins**,
 * never whether one may be made", and [A8 §7.4(a)]: a previous holder's assertions "do not become
 * false, are never retracted, and are never deleted".
 *
 * So there is no standing that means *suppressed*, *refused*, *false* or *withdrawn*, and a later
 * revision that adds one would be changing the model rather than extending it. Checked rather than
 * asserted.
 */
type StandingHasNoSuppressedMember =
  Extract<
    Standing,
    'suppressed' | 'refused' | 'false' | 'withdrawn' | 'retracted' | 'superseded'
  > extends never
    ? true
    : never
const _standingHasNoSuppressedMember: StandingHasNoSuppressedMember = true
void _standingHasNoSuppressedMember

/* -------------------------------------------------------------------------------------------- */
/* §4.3 — what authority is bound to                                                             */
/* -------------------------------------------------------------------------------------------- */

/**
 * [A8 §4.3]. What the row's authority *follows*.
 *
 * - `CUSTODY` — follows {@link CustodyAt}, [SD §4.8.3]'s fold, "evaluated at the instant the fact
 *   is _about_ (A8-INSTANT) and moving at a boundary per A8-MOVE on the selected handover's
 *   `custodyBasis`. **There is no stored `Custody` entity.**"
 * - `ASSIGNMENT` — follows an `Assignment`'s effective interval ([A3] §6.1); facts *about* a
 *   resource. Note [SD §4.7.1]'s warning that this is **not** the `assignmentOffer`/`Response`/
 *   `Release` rows, which are facts about the binding itself.
 * - `SCHEME` — belongs to the **issuer** of the naming scheme and never moves ([SD §7.1]).
 * - `PRINCIPAL` — belongs to the party the arrangement is *for*; moves only when the principal
 *   changes (§7.5, `src:dp3-400ng` Item 17-2.5).
 * - `NONE` — no role is authoritative; a named value rule or a mandatory derivation settles it.
 * - `KEY` — belongs to the role the fact's own **`qualifier`** names. Added to close **F3**; see
 *   {@link A8_KEY} for the rule and for the general principle it is the first instance of.
 */
export const BOUND_BY = ['CUSTODY', 'ASSIGNMENT', 'SCHEME', 'PRINCIPAL', 'NONE', 'KEY'] as const

export type BoundBy = (typeof BOUND_BY)[number]

/* -------------------------------------------------------------------------------------------- */
/* §4.2 — A8-INSTANT                                                                             */
/* -------------------------------------------------------------------------------------------- */

/**
 * **Rule A8-INSTANT** — [A8 §4.2]:
 *
 * > "A role's standing for a fact is determined by **the instant the fact is _about_** — its
 * > `occurredAt` / the instant its `value` describes — and **never by `assertedAt` or
 * > `recordedAt`**."
 *
 * **[ORIGINAL], and it is the whole answer to "degenerates to recency"** ([round-2-critique] L112).
 * Under it there is nothing to downgrade at a handoff and nothing to expire: "the origin agent's
 * assertion about the **load** stays authoritative forever, even if it is keyed a week after the
 * goods left its custody", and its assertion about the **delivery** "is non-authoritative from the
 * moment it is made, however recent."
 *
 * Branded so the wrong clock cannot be passed by accident. {@link Instant} is not assignable to
 * `FactInstant`, and the only constructor is {@link instantTheFactIsAbout}, which reads the value —
 * there is deliberately no constructor from `assertedAt` or `recordedAt`.
 */
export type FactInstant = Instant & { readonly __clock: 'theInstantTheFactIsAbout' }

/**
 * A8-INSTANT, checked: an ordinary wire instant — `assertedAt`, `recordedAt`, "now" — must not
 * satisfy a parameter that wants the instant the fact is about.
 */
type A8InstantIsNotAnyInstant = [Instant] extends [FactInstant] ? never : true
const _a8InstantIsNotAnyInstant: A8InstantIsNotAnyInstant = true
void _a8InstantIsNotAnyInstant

/**
 * The instant a fact is about, where the fact's own value carries one.
 *
 * `resolved: false` is not a failure to look: for a weight, a piece count, a condition or an
 * identity the value **describes no instant** and none of the binding documents supplies one. It is
 * returned as unresolved rather than substituted with `assertedAt` — which is precisely the
 * substitution A8-INSTANT exists to forbid.
 *
 * `sitEntryDate` is unresolved for a second reason worth keeping separate: [SD §5.3] makes it a
 * **date**, and a date is not an instant (`primitives.ts` keeps the two types apart because 400NG
 * Items 29.6 / 17.20 forbid substituting one for the other).
 *
 * TODO([A8 §10] §4.2 row): "`src:sirva-ade` **only has** a recording clock, so implementing this
 * requires us to supply `occurredAt` ourselves on inbound ADE facts. That is an **ingest
 * obligation**, not a model defect, and it should be written down before A4 assumes otherwise." It
 * is written down here.
 */
export type FactInstantResolution =
  | { readonly resolved: true; readonly at: FactInstant }
  | { readonly resolved: false; readonly type: AssertionType }

export function instantTheFactIsAbout(assertion: Assertion): FactInstantResolution {
  const type = assertion.type
  // The union is discriminated by `type`, but `value`'s shape is keyed on it through a table
  // (`ValueByType`), so the narrowing has to be spelled out. What matters is the rule, not the
  // gymnastics: both branches read the VALUE, and neither branch can reach the envelope's clocks.
  if (isActType(type)) {
    return {
      resolved: true,
      at: (assertion.value as { occurredAt: Instant }).occurredAt as FactInstant,
    }
  }
  if (type === 'arrival' || type === 'departure') {
    return { resolved: true, at: (assertion.value as { at: Instant }).at as FactInstant }
  }
  return { resolved: false, type }
}

/* -------------------------------------------------------------------------------------------- */
/* §4 — the shape: authority is a function, not a field                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Who holds a row's authority. More than "a role", because four of the eleven rows are held by
 * something that is not a fixed role name.
 *
 * Two members record a **gap in the role vocabulary** rather than filling it: `performingRole` (row
 * 11's proposal authority is "the performing role", which is a function of the act being charged
 * for) and `owedRole` (row 11's rating authority is "the tariff owner", and [A8 §9 item 2] owes the
 * role enum that would contain it — `ROLE_NAMES` has no van-line member).
 */
export type AuthoritativeHolder =
  /** A named member of [A8 §2]'s cast. */
  | { readonly kind: 'role'; readonly role: RoleName }
  /** [A8 §5] rows 1-2: "the role holding custody at that stop" — resolved through the fold. */
  | { readonly kind: 'custodyHolder' }
  /** [SD §8.2]: "the party whose assertions govern this leg", where the movement is external. */
  | { readonly kind: 'legAuthoritativeAsserter' }
  /** [A8 §5] row 10: the **issuer** of the scheme, and nobody else. Never moves. */
  | { readonly kind: 'schemeIssuer' }
  /** [A8 §5] row 11, `aspect = PROPOSED`: whichever role performed the service being charged. */
  | { readonly kind: 'performingRole' }
  /**
   * [SD §4.7.2f] §7.3, **A8-MOVE as amended**: across a **C5 transfer gap** — after a `RELEASE` and
   * before the next `RECEIPT` — the **releasing** side remains authoritative, "so the gap is a
   * custody `UNKNOWN` and not an authority vacuum".
   *
   * Resolved through {@link custodyAuthorityAt} and **not** through the fold, because the fold is
   * deliberately silent across the gap (C5) while authority is not. That is why this is its own
   * member rather than `custodyHolder` with a wider fold: two different questions over the same
   * published records, and fusing them would reintroduce the vacuum.
   *
   * **[ORIGINAL]** and provisional — **do not score** until A8 ratifies it ([SD §4.7] note 3).
   */
  | { readonly kind: 'releasingRoleAcrossTransferGap'; readonly holder: CustodyHolder }
  /**
   * [A8 §5] row 12, **A8-KEY**: the role the fact's own `qualifier` names — the releasing role for a
   * `RELEASE` key, the receiving role for a `RECEIPT` key.
   *
   * Its own member rather than `custodyHolder` with a different fold, and that is the whole of F3's
   * fix: `custodyHolder` resolves through {@link CustodyAt}, and `handover` is the record the fold
   * reads, so resolving a handover contest through the fold would define A8-MOVE in terms of the
   * thing it defines ([SD §4.8.2]). This member reads the **key**, which is fixed when the record is
   * minted.
   */
  | { readonly kind: 'keySideRole' }
  /** A holder the role vocabulary cannot yet name — carried as owed, never as "nobody". */
  | { readonly kind: 'owedRole'; readonly owedRole: Owed<string, string> }

/**
 * The circumstances under which a row's authority sits with an alternate holder. These are
 * **mutually exclusive circumstances, not a contest** — which is why they do not make
 * `authoritative` plural and therefore do not trigger A8-NAMED's tie-break requirement.
 */
export const AUTHORITY_CONDITIONS = [
  /** [A8 §5] row 3: "`OriginAgent` where no separate load agent is assigned". */
  'NO_SEPARATE_LOAD_AGENT_ASSIGNED',
  /** [A8 §5] row 4, the mirror. */
  'NO_SEPARATE_UNLOAD_AGENT_ASSIGNED',
  /** [SD §8.2] / [A8 §5] rows 1, 2, 5: the movement is an `ExternallyPerformedLeg`. */
  'EXTERNALLY_PERFORMED_LEG',
  /**
   * [A8 §5] row 15, the mirror of rows 3 and 4: `originAgent` where no separate packer is resourced.
   * `src:sirva-ade` resources a `Packer` separately (GSD pp.12-13), so the circumstance is published
   * even though the row that consumes it is [SYNTHESIS].
   */
  'NO_SEPARATE_PACKER_ASSIGNED',
  /** [A8 §6] / `src:sirva-ade` SOE pp.16-17: an `R19AuthNumber` licenses a substitute performer. */
  'REVERSE_RULE_19',
] as const

export type AuthorityCondition = (typeof AUTHORITY_CONDITIONS)[number]

export interface AuthorityAlternate {
  readonly holder: AuthoritativeHolder
  readonly when: AuthorityCondition
}

/** What settles a row whose `authoritative` is empty — [A8 §5]'s "something better than a role". */
export type SettlementMechanism =
  /** [A8 §5] row 6: `R-WEIGHT-LOWER` ([SD §4.4]). "This row is a citation." */
  | { readonly kind: 'valueRule'; readonly rule: RuleRef }
  /** [A8 §5] row 7: [SD §5.2] M4 makes the derivation mandatory, so "the right answer is nobody". */
  | { readonly kind: 'mandatoryDerivation' }

export type ChargeAspect = QualifierByType['charge']['aspect']

export type AuthoritativeSpec =
  /** One holder, with the alternates its circumstances name. */
  | {
      readonly kind: 'held'
      readonly primary: AuthoritativeHolder
      readonly alternates?: readonly AuthorityAlternate[]
    }
  /** [A8 §5] rows 6 and 7 — **no role is authoritative**, and that is the finding, not a gap. */
  | {
      readonly kind: 'none'
      readonly settledBy: SettlementMechanism
      /** Row 7: "authority applies only to the **input**, the _first available delivery date_". */
      readonly inputAuthority?: AuthoritativeHolder
    }
  /** [A8 §7.3] **A8-JOINT** — row 9, and the counts asserted with it. Deliberately plural. */
  | { readonly kind: 'jointAtCustodyBoundary' }
  /** [A8 §5] row 11 as corrected by [SD §4.7.2b]: three **fact keys**, not three authorities in
   * one contest. Without the `{aspect}` qualifier "an approval would compete with an amount". */
  | {
      readonly kind: 'perQualifierAspect'
      readonly by: Readonly<Record<ChargeAspect, AuthoritativeHolder>>
    }

/**
 * **Rule A8-NAMED** — [A8 §4.4]:
 *
 * > "Where `authoritative` is empty or plural for a contested fact, `FactResolved` **MUST** name a
 * > tie-break rule. `RECENCY` is a legal `ruleId` only where the catalog has published it for that
 * > specific fact class. **A resolution may never fall back to 'latest wins' implicitly.**"
 *
 * The rejection of implicit last-writer-wins is already settled at [SD §4.3] on `src:gtfs`'s
 * `FULL_DATASET`, "defensible there only because GTFS has one publisher by construction". A8-NAMED
 * is what stops it re-entering through an unpopulated authority table — which is also why an
 * unresolved fact class below produces a resolution naming a rule rather than "a silently-plausible
 * answer".
 */
export type TieBreak =
  | { readonly kind: 'rule'; readonly rule: RuleRef }
  /** [SD §5.2] M4: the derivation's `{ruleId, ruleVersion}` rides on each derived record, so the
   * row names the mechanism and the record names the rule. */
  | { readonly kind: 'perRecordDerivation' }
  | { readonly kind: 'owed'; readonly tieBreak: Owed<string, string> }

interface AuthorityRuleCommon<T extends AssertionType> {
  /** [A8 §5]'s row number, so a reader can find the evidence column that licenses this row. */
  readonly a8Row: A8Row
  /** [SD §1.1]'s single classification axis — [A8 §11] item 1 renamed `factClass` to `type`. */
  readonly type: T
  /** [A8 §4]: "published catalog content, **versioned like any rule**" — what `FactResolved.rule`
   * names. [A8 §8]: `AUTHORITATIVE-ROLE-AT-INSTANT` "is a real `{ruleId, ruleVersion}` whose
   * definition is [A8 §5] + [A8 §4.2]". */
  readonly rule: RuleRef
  readonly boundBy: BoundBy
  readonly authoritative: AuthoritativeSpec
  readonly corroborating?: readonly RoleName[]
  readonly competing?: readonly RoleName[]
  readonly advisory?: readonly RoleName[]
  /** Prose the columns cannot hold — always a quotation or a citation, never a new rule. */
  readonly note?: string
}

/**
 * [A8 §4]'s record. `tieBreak` is **mandatory exactly where A8-NAMED makes it mandatory** — where
 * `authoritative` is empty (`none`) or plural (`jointAtCustodyBoundary`) — and optional elsewhere.
 *
 * `held` is not plural: its alternates are mutually exclusive circumstances. `perQualifierAspect`
 * is not plural either, because [SD §4.7.2b] splits it into three **fact keys**, each with one
 * holder.
 */
export type AuthorityRule<T extends AssertionType = AssertionType> = AuthorityRuleCommon<T> &
  (
    | {
        readonly authoritative: Extract<AuthoritativeSpec, { kind: 'held' | 'perQualifierAspect' }>
        readonly tieBreak?: TieBreak
      }
    | {
        readonly authoritative: Extract<
          AuthoritativeSpec,
          { kind: 'none' | 'jointAtCustodyBoundary' }
        >
        readonly tieBreak: TieBreak
      }
  )

export type A8Row = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16

/**
 * A fact class [A8 §5] does not reach — [A8 §9 item 8] lists them: "cube, piece count, packing
 * performance, survey/estimate facts, ETA, seal integrity, tracer results, claim facts, and every
 * A10/A11 class. **Each needs a row before its area can score a dependent decision high.**"
 *
 * Represented as a **distinct value**, never as an absent row or a null holder: [SD §4.7.1] already
 * makes the difference load-bearing by having one row ([A8 §5] row 7) whose authoritative role is
 * genuinely **nobody**. An owed row and a `boundBy = NONE` row must not be confusable.
 */
export interface OwedAuthorityRow<T extends AssertionType = AssertionType> {
  readonly type: T
  readonly row: Owed<'authorityRow', string>
  readonly boundBy: BoundBy | Owed<'boundBy', string>
  /**
   * [SD §4.7.1] carries an **[ORIGINAL] provisional** guess for several of these rows and appends
   * "**Do not score on this**" to every one. Carried verbatim as prose so it cannot be read as a
   * decision, and deliberately not typed as an {@link AuthoritativeSpec}.
   */
  readonly provisional?: string
}

export type AuthorityTableEntry<T extends AssertionType = AssertionType> =
  AuthorityRule<T> | OwedAuthorityRow<T>

/* -------------------------------------------------------------------------------------------- */
/* Rule ids                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/** [A8 §8] item 1, and [A8 §7.6]'s worked `FactResolved`. */
export const AUTHORITATIVE_ROLE_AT_INSTANT: RuleRef = ruleRef('AUTHORITATIVE-ROLE-AT-INSTANT', '1')

/** [A8 §7.3] / [A8 §7.6]: the rule a joint resolution names while declining to select. */
export const JOINT_AT_CUSTODY_BOUNDARY: RuleRef = ruleRef('JOINT-AT-CUSTODY-BOUNDARY', '1')

/** [A8 §5] row 10: the scheme's issuer, and nobody else. */
export const ISSUER_OF_SCHEME: RuleRef = ruleRef('ISSUER-OF-SCHEME', '1')

/** [A8 §5] row 11: three aspects, three fact keys, three authorities ([SD §4.7.2b]). */
export const PRINCIPAL_AT_ASPECT: RuleRef = ruleRef('PRINCIPAL-AT-ASPECT', '1')

/** [A8 §5] row 7: [SD §5.2] M4's mandatory derivation. */
export const SIT_ENTRY_DERIVED: RuleRef = ruleRef('SIT-ENTRY-DATE-DERIVED', '1')

/**
 * **Rule A8-KEY** — [A8 §5] row 12, and the rule that closes **F3**.
 *
 * > Where a fact's own `qualifier` names a role, authority for that fact belongs to **that** role.
 * > `handover` is the one published member whose qualifier does: authority for a `RELEASE` key
 * > belongs to the releasing role, and for a `RECEIPT` key to the receiving role.
 *
 * **Why this is a sixth `boundBy` and not `NONE` plus a tie-break.** Under `NONE` "no role is
 * authoritative" and a value rule settles the fact ([A8 §5] row 6, `weight.net`). Here exactly
 * **one** role is authoritative and it is computable from the record alone, so `authoritative` is
 * neither empty nor plural, **A8-NAMED never fires**, and there is no value rule to name. Calling
 * it `NONE` would have required inventing one.
 *
 * **Why it is not circular**, which is F3's whole complaint: it reads the **fact key**, fixed when
 * the record was minted, and not {@link CustodyAt} — the fold that consumes the answer. [SD §4.8.2]
 * refused a `custody` fact class for the identical shape, "so A8-MOVE would be defined in terms of
 * the thing it defines".
 *
 * **Sourced**, and the arrangement is not ours: `src:stedi-x12-reference` issues the interline pair
 * from opposite sides — only the **releasing** carrier issues `J1`, only the **receiving** carrier
 * issues `R1` — so the side that may speak is already a property of the code in the source.
 * **[SYNTHESIS]**: binding *authority* to it is this model's step.
 *
 * **The general principle, stated once because it explains the rows this does _not_ close.** An act
 * that **mints** the thing a binding follows can never be bound to that thing. `handover` mints
 * custody, so it cannot be `CUSTODY`; `assignmentOffer` mints the assignment, so it cannot be
 * `ASSIGNMENT`; `orderAward` mints the principal relation, so it cannot be `PRINCIPAL`. F3 is the
 * first instance of a class, not a special case. `KEY` rescues `handover` alone, because
 * `handover` is the only one of them whose **qualifier** names its actor — the other nine name
 * theirs in `context[]`, which [SD §1.4] forbids resolution from reading. See [A8 §9 item 8].
 */
export const A8_KEY: RuleRef = ruleRef('A8-KEY', '1')

/**
 * **A8-NAMED's registry, and it is empty.**
 *
 * "`RECENCY` is a legal `ruleId` **only where the catalog has published it for that specific fact
 * class**." The catalog publishes none, so every lookup fails and no resolution may claim recency.
 * The empty table is the point: it is what makes the prohibition checkable instead of remembered.
 */
export const PUBLISHED_RECENCY_RULES: Partial<Record<AssertionType, RuleRef>> = {}

export function recencyIsPublishedFor(type: AssertionType): boolean {
  return PUBLISHED_RECENCY_RULES[type] !== undefined
}

/* -------------------------------------------------------------------------------------------- */
/* §5 — the per-fact-class table                                                                 */
/* -------------------------------------------------------------------------------------------- */

/**
 * [A8 §5]. Eleven rows, and every other member of the vocabulary marked **owed**.
 *
 * Read with [A8 §5]'s own three caveats: the canonical subject **family** is declared by
 * [SD §4.7]'s table and not here (`vocabulary.ts` carries it); roles are `src:sirva-ade`'s cast plus
 * [A8 §2]'s four additions; and "every row's authority is `boundBy = CUSTODY` unless the row says
 * otherwise — so every row is also a §7 row."
 *
 * The structural observation [A8 §5] asks to be stated on its own: **three of eleven rows have no
 * authoritative role** (`weight.net`, `sitEntryDate`, and `condition`, which is plural rather than
 * empty). "That is not a failure of the table. In each case a source supplies something _better_
 * than a role — a value rule, a mandatory derivation, or a joint record — and the table's job is to
 * say so rather than to invent a winner."
 *
 * TODO(reconcile with `data/authority-table.json`): [A8 §5] is currently carried **twice** in this
 * package — here, as types the rules below compute over, and in `data/` as JSON, on [SD §4.7] note
 * 3's instruction that the authority column is "[A8]'s, **quoted, not re-derived**". Two
 * representations of one table is [SD §1.1]'s "two homes for one fact" defect a level up: they can
 * drift, and nothing checks that they have not. One of the two must become the source of truth and
 * the other derived from it. Every rule below reads a table rather than hard-coding a row, so they
 * can be re-pointed without a rule changing. **Not decided here** — deciding it would mean one
 * reading of a section silently overwriting a concurrent one.
 */
export const AUTHORITY_TABLE = {
  /* ---- Row 1 — arrival. Sourced: the recording DUTY. [ORIGINAL]: making it authority. -------- */
  arrival: {
    a8Row: 1,
    type: 'arrival',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      // "The role holding custody at that stop — `Driver` where the stop is on our trip; `Hauler`
      // where the trip is the hauling agent's" — both are the fold's answer, not two rows.
      primary: { kind: 'custodyHolder' },
      alternates: [
        { holder: { kind: 'legAuthoritativeAsserter' }, when: 'EXTERNALLY_PERFORMED_LEG' },
      ],
    },
    corroborating: ['originAgent', 'destinationAgent', 'customer'],
    // The deliberate `competing` entry: [round-2-critique]'s own example is the destination agent's
    // shipment-level claim against the driver's stop-level claim — "both are real and E-CANON is
    // what makes them pair" ([SD §4.6.3] is where the pairing is worked).
    competing: ['destinationAgent'],
    advisory: ['booker', 'platform'],
    note:
      '`src:dp3-tender-of-service` #14/#20 place the arrival-recording DUTY on the performing party ' +
      '(§C.3.a-b p.34). [ORIGINAL]: converting a recording duty into assertional authority. ' +
      '[A8 §10] caps this row at Medium: the failure mode is a role that has the duty but not the ' +
      'knowledge — "on a consolidated van the driver knows and the TSP\'s office does not".',
  },

  /* ---- Row 2 — departure. As row 1. ---------------------------------------------------------- */
  departure: {
    a8Row: 2,
    type: 'departure',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      primary: { kind: 'custodyHolder' },
      alternates: [
        { holder: { kind: 'legAuthoritativeAsserter' }, when: 'EXTERNALLY_PERFORMED_LEG' },
      ],
    },
    corroborating: ['originAgent', 'destinationAgent', 'customer'],
    competing: ['destinationAgent'],
    advisory: ['booker', 'platform'],
    note:
      '`src:dp3-tender-of-service` #10 additionally requires the legal name and US DOT number of the ' +
      'provider ACTUALLY HAULING in DPS within 2 GBD of origin departure (§B.3.f p.19) — so at ' +
      'departure the performing party must be nameable, which is the precondition for this row to be ' +
      'computable at all.',
  },

  /* ---- Row 3 — loading. --------------------------------------------------------------------- */
  loading: {
    a8Row: 3,
    type: 'loading',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      primary: { kind: 'role', role: 'loadAgent' },
      alternates: [
        { holder: { kind: 'role', role: 'originAgent' }, when: 'NO_SEPARATE_LOAD_AGENT_ASSIGNED' },
      ],
    },
    corroborating: ['driver', 'customer'],
    // Sourced, not authored: `src:cfr-49-375` §375.503 + §375.605(b) (customer notations on the
    // inventory) and DP3 ToS §C.9.a(4)-(11) (per-line-item exception annotation BEFORE signing).
    competing: ['customer'],
    advisory: ['booker', 'destinationAgent', 'platform'],
    note: 'The customer competes on the SCOPE of what was loaded (short / refused), which is a Portion question ([SD §3.4]).',
  },

  /* ---- Row 4 — unloading. The mirror of row 3, and the mirror itself is [ORIGINAL]. ---------- */
  unloading: {
    a8Row: 4,
    type: 'unloading',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      primary: { kind: 'role', role: 'unloadAgent' },
      alternates: [
        {
          holder: { kind: 'role', role: 'destinationAgent' },
          when: 'NO_SEPARATE_UNLOAD_AGENT_ASSIGNED',
        },
      ],
    },
    corroborating: ['driver', 'customer'],
    competing: ['customer'],
    advisory: ['booker', 'originAgent', 'platform'],
    note: 'ADE supplies `LoadAgent` and `UnloadAgent` as distinct types (GSD p.9) but states no authority — [A8 §5] row 4 marks the mirroring [ORIGINAL].',
  },

  /* ---- Row 5 — delivery. Sourced heavily; the customer placement is [ORIGINAL]. -------------- */
  delivery: {
    a8Row: 5,
    type: 'delivery',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      primary: { kind: 'role', role: 'destinationAgent' },
      alternates: [
        { holder: { kind: 'legAuthoritativeAsserter' }, when: 'EXTERNALLY_PERFORMED_LEG' },
        { holder: { kind: 'role', role: 'rr19Agent' }, when: 'REVERSE_RULE_19' },
      ],
    },
    corroborating: ['driver', 'hauler'],
    // [ORIGINAL]: placing `customer` in `competing` rather than `corroborating`. "Three sources make
    // the customer's signature CONSTITUTIVE, not decorative" — `src:cfr-49-375` §375.701 (the
    // delivery receipt is signed by the shipper and may carry no release-of-liability language);
    // DP3 ToS §C.17.a (the AT DELIVERY notice is "jointly signed"); §C.9.a(24) (a signed check-off
    // sheet is NOT proof of delivery).
    competing: ['customer'],
    advisory: ['booker', 'originAgent', 'platform'],
  },

  /* ---- Row 6 — weight.net. "The most strongly-sourced row… **Authored: nothing.** ------------ */
  'weight.net': {
    a8Row: 6,
    type: 'weight.net',
    rule: R_WEIGHT_LOWER,
    boundBy: 'NONE',
    authoritative: { kind: 'none', settledBy: { kind: 'valueRule', rule: R_WEIGHT_LOWER } },
    // The weigh master SUPPLIES THE EVIDENCE, NOT THE ASSERTION (`src:cfr-49-375` §375.519 puts the
    // signature on the weigh master). Listed as corroborating because the row must place the role
    // somewhere; the distinction is the note, and `capturedBy` + `evidence[]` is where it lives.
    corroborating: ['weighMaster'],
    // The weighing side and the reweigh-demanding side are BOTH competing: §375.517 gives the
    // shipper the reweigh demand before unloading begins, and the freight bill must then be based
    // on the reweigh weight.
    competing: ['hauler', 'originAgent', 'customer', 'accountParty'],
    advisory: ['platform', 'booker'],
    tieBreak: { kind: 'rule', rule: R_WEIGHT_LOWER },
    note: 'This row proves authority and value rules are two mechanisms. [A8 §5]: "**Authored: nothing.** This row is a citation."',
  },

  /* ---- Row 7 — sitEntryDate. The row where the right answer is "nobody". --------------------- */
  sitEntryDate: {
    a8Row: 7,
    type: 'sitEntryDate',
    rule: SIT_ENTRY_DERIVED,
    boundBy: 'NONE',
    authoritative: {
      kind: 'none',
      settledBy: { kind: 'mandatoryDerivation' },
      // "Authority applies only to the INPUT, the *first available delivery date*, which is the
      // `Hauler`/`DestinationAgent`'s (whichever holds the BL duty)." Modelled as the Hauler with
      // the BL-duty case as the alternate would be inventing a condition; carried as the Hauler and
      // the note keeps the disjunction visible.
      inputAuthority: { kind: 'role', role: 'hauler' },
    },
    corroborating: ['sitAgent', 'accountParty'],
    advisory: ['platform'],
    tieBreak: { kind: 'perRecordDerivation' },
    note:
      'Sourced twice from opposite directions: 400NG Items 29.4/29.6/17.20 ("SIT in date will be equal ' +
      "to the TSP's first available delivery date… the arrival date must NOT be entered as the SIT " +
      'entry date") and DTR Part IV §D.5.b(2) ("the date the shipment was OFFERED FOR DELIVERY, not ' +
      'the date it arrived"). Input authority is the `Hauler` OR the `DestinationAgent`, whichever ' +
      "holds the BL duty — the disjunction is [A8 §5] row 7's and is not resolved here.",
  },

  /* ---- Row 8 — storeOut. The warehouse is the party of record for what happened inside it. --- */
  storeOut: {
    a8Row: 8,
    type: 'storeOut',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: { kind: 'held', primary: { kind: 'role', role: 'sitAgent' } },
    corroborating: ['hauler', 'destinationAgent'],
    // "`Hauler` collecting — this is a handoff, so the exception-sheet rule applies" (§7.3).
    competing: ['hauler'],
    advisory: ['booker', 'platform'],
    note:
      'DP3 ToS #28 puts handling-in on the warehouseman; NTS §5.8.2 is decisive on the collecting ' +
      "carrier — the NTS TSP notifies the TO and the DD 1164 documents the carrier's failure. DTR " +
      'corroborates from the identity side: the lot number is supplied by the warehouseman, not the ' +
      "Government. TODO([A8 §9 item 2]): whether the NTS warehouseman is ADE's `SITAgent` is owed.",
  },

  /* ---- Row 9 — condition. The best-sourced row, and §7.3's foundation. ---------------------- */
  condition: {
    a8Row: 9,
    type: 'condition',
    rule: JOINT_AT_CUSTODY_BOUNDARY,
    boundBy: 'CUSTODY',
    authoritative: { kind: 'jointAtCustodyBoundary' },
    // "The non-inspecting parties" — not enumerable as roles, because which roles are inspecting is
    // a property of the boundary, not of the fact class. Left empty rather than guessed.
    competing: [],
    advisory: ['platform', 'booker'],
    tieBreak: { kind: 'rule', rule: JOINT_AT_CUSTODY_BOUNDARY },
    note:
      '400NG Item 17.12.c requires BOTH TSP and warehouseman to hold "the condition of EACH ARTICLE ' +
      'when received at and forwarded from the storage location"; §375.503 requires an itemized ' +
      'inventory signed by both; NTS §1.6.2 makes condition assertable BY OMISSION; §C.9.a(22) makes ' +
      'describing cartons as "misc." a WAIVER of the right to contest related claims.',
  },

  /* ---- Row 10 — identity. Authority never moves. -------------------------------------------- */
  identity: {
    a8Row: 10,
    type: 'identity',
    rule: ISSUER_OF_SCHEME,
    boundBy: 'SCHEME',
    authoritative: { kind: 'held', primary: { kind: 'schemeIssuer' } },
    note:
      "The practical consequence [A8 §5] row 10 names: SIRVA's `Brand+RegNumber+RegYear` and " +
      "Weichert's `serviceOrderNumber` are PEER references, neither authoritative over the other, " +
      'because they are values under two schemes with two issuers. Corroboration is "the counterparty ' +
      'echoing the value back" — a relation, not a role, so it is not listed as one. An issuer\'s ' +
      'RESPONSIBILITY can be reassigned with an effective date (400NG GBLOC regionalization p.17), ' +
      "which is why [SD §7.2]'s interval carries it and a static field would not.",
  },

  /* ---- Row 11 — charge. Corrected by [SD §4.7.2b] into three fact keys. --------------------- */
  charge: {
    a8Row: 11,
    type: 'charge',
    rule: PRINCIPAL_AT_ASPECT,
    boundBy: 'PRINCIPAL',
    authoritative: {
      kind: 'perQualifierAspect',
      by: {
        PROPOSED: { kind: 'performingRole' },
        DECIDED: { kind: 'role', role: 'accountParty' },
        // "The tariff owner (the van line / the party whose tariff prices it)" — [A8 §2]'s cast has
        // no member for it, so the holder is carried as owed rather than bent onto `booker`.
        RATED: {
          kind: 'owedRole',
          owedRole: owed('tariffOwner', '[A8 §9 item 2] — the role enum has no van-line member'),
        },
      },
    },
    corroborating: ['settlingAgent', 'setoffAgent'],
    competing: [],
    advisory: ['platform'],
    note:
      '[ORIGINAL]: naming the three-way split (propose / decide / rate) as three authorities; no ' +
      'source names all three. The performing role competes ON QUANTUM. [SD §6.3] already settles the ' +
      'correction regime against role: financial facts are corrected ONLY by an offsetting record. ' +
      "TODO([A8 §9 item 7]): revenue allocation is A13's and this row must not be read as settling it.",
  },

  /* ---- Everything else: owed. [A8 §9 item 8]. ----------------------------------------------- */

  packing: {
    a8Row: 15,
    type: 'packing',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: {
      kind: 'held',
      primary: { kind: 'role', role: 'packer' },
      alternates: [
        { holder: { kind: 'role', role: 'originAgent' }, when: 'NO_SEPARATE_PACKER_ASSIGNED' },
      ],
    },
    corroborating: ['customer', 'destinationAgent'],
    // Sourced: `src:cfr-49-375` §375.503(a) requires an itemized inventory identifying "every
    // carton and every uncartoned item" with the shipper given the opportunity to observe and
    // verify, and §375.503(d) the same at delivery, in writing.
    competing: ['customer'],
    advisory: ['booker', 'hauler', 'platform'],
    note:
      'The mirror of row 3, and the mirror is the authored step (**[SYNTHESIS]**). The customer ' +
      'competes on the SCOPE of what was packed, not on the performance — which is a Portion ' +
      'question ([SD §3.4]), exactly as it is for loading.',
  },

  handover: {
    a8Row: 12,
    type: 'handover',
    // **F3, closed.** This entry read `row: owed(…)` with `boundBy` owed and expressly not
    // `CUSTODY`, because [SD §4.7.1] gave the row `CUSTODY` while [SD §4.8.2] said of the identical
    // shape that "that row's binding would be `CUSTODY`, so **A8-MOVE would be defined in terms of
    // the thing it defines**". Two published sentences contradicting each other, made load-bearing
    // by F1 — which gave `handover` a qualifier, so the fold now selects among a contested pair.
    // {@link A8_KEY} resolves it by reading the qualifier instead of the fold.
    rule: A8_KEY,
    boundBy: 'KEY',
    authoritative: { kind: 'held', primary: { kind: 'keySideRole' } },
    corroborating: ['originAgent', 'destinationAgent', 'sitAgent'],
    competing: [],
    advisory: ['booker', 'platform'],
    note:
      'EXACTLY ONE authoritative role, computed from the record — so A8-NAMED never fires and no ' +
      'tie-break is named. The other side of the same transfer may assert the same key and is ' +
      'recorded in `considered[]`; it is never selected, because `src:stedi-x12-reference` issues ' +
      'the interline pair from opposite sides (only the releasing carrier issues `J1`, only the ' +
      'receiving carrier issues `R1`).',
  },

  'weight.gross': {
    a8Row: 13,
    type: 'weight.gross',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: { kind: 'held', primary: { kind: 'custodyHolder' } },
    // `weighMaster` supplies the EVIDENCE, not the assertion — `src:cfr-49-375` §375.519(a)(1)-(6)
    // puts the signature, the scale name and the scale location on the weigh master. As row 6.
    corroborating: ['weighMaster'],
    competing: ['customer', 'accountParty'],
    advisory: ['booker', 'platform'],
    note:
      'Row 6 is `boundBy = NONE` because `R-WEIGHT-LOWER` picks the NET regardless of who ' +
      'asserted it. That says nothing about who may assert an INPUT, and reading it as though ' +
      'it did is what left this row owed by a ledger that does not list it. The reweigh right ' +
      'belongs to the shipper (`src:cfr-49-375` §375.517), so `customer`/`accountParty` ' +
      'compete, and the contest is settled on the net by row 6.',
  },

  'weight.tare': {
    a8Row: 14,
    type: 'weight.tare',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    authoritative: { kind: 'held', primary: { kind: 'custodyHolder' } },
    // `weighMaster` supplies the EVIDENCE, not the assertion — `src:cfr-49-375` §375.519(a)(1)-(6)
    // puts the signature, the scale name and the scale location on the weigh master. As row 6.
    corroborating: ['weighMaster'],
    competing: ['customer', 'accountParty'],
    advisory: ['booker', 'platform'],
    note:
      'As row 13: the same weighing, the same scale, the same ticket — [SD §4.7.1] states this ' +
      'row as "as `weight.gross`".',
  },

  pieceCount: {
    a8Row: 16,
    type: 'pieceCount',
    rule: AUTHORITATIVE_ROLE_AT_INSTANT,
    boundBy: 'CUSTODY',
    // AWAY FROM a custody boundary, which is the half [SD §4.7.1] left owed. AT a boundary the
    // answer is row 9's and is already computed by {@link jointRuleApplies} — A8-JOINT reaches
    // "`condition` AND THE COUNTS ASSERTED WITH IT". One type, two standings, split by whether the
    // instant is a boundary; the split is A8-INSTANT's to compute, which is why it needs no new
    // `AuthoritativeSpec` kind.
    authoritative: { kind: 'held', primary: { kind: 'custodyHolder' } },
    corroborating: ['customer', 'originAgent', 'destinationAgent'],
    competing: ['customer', 'accountParty'],
    advisory: ['booker', 'platform'],
    note:
      'Every published counting duty falls on the party holding the goods: `src:cfr-49-375` ' +
      '§375.503(a) (an itemized inventory numbering every carton and every uncartoned item) and ' +
      '`src:dp3-400ng` Item 17.13 (a partial SIT withdrawal identified by INVENTORY ITEM NUMBERS, ' +
      'with the TSP obtaining the actual weight). §375.503(d) gives the right to note missing ' +
      "articles in writing, which is what makes `customer` competing, and [A4 §3]'s " +
      '`GOODS_MISSING` is the reason code that records it.',
  },

  storeIn: {
    type: 'storeIn',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: 'CUSTODY',
    provisional:
      '[SD §4.7.1]: "The warehouse agent or TSP crew who performed it; `SITAgent` (handling-in). M2: ' +
      'human or partner asserter, never derived." [A8 §5] row 7 reaches storeIn only as an INPUT to ' +
      'the SIT entry date, not as a row of its own.',
  },

  notification: {
    type: 'notification',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional:
      '[SD §4.7.3] makes the whole fact class provisional, and [A8 §9 item 6] owes "the party as a ' +
      'notification target" — so this row cannot be written before a role can be resolved to a ' +
      'contactable address. Note the sourced ANTI-PATTERN it must preserve: DTR A-402 §F.8.d FORBIDS ' +
      "the TSP updating the customer's e-mail address after pickup, on grounds of INCENTIVE rather " +
      'than ownership — "a shape no role-based scheme will produce by accident".',
  },

  partyRole: {
    type: 'partyRole',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional:
      "Who is authoritative about WHO HOLDS A ROLE is [A8 §9 items 1-5]'s, and it is the row this " +
      'module most needs and least has: **A8-HISTORY** ([A8 §3]) computes authority over the ' +
      'effective-dated role-assignment history, so a wrong answer here is wrong everywhere. ' +
      '`src:atlas-world-group-api` carries `Agent.assigned_by`/`assigned_date` as column names only ' +
      '(C2=1), and `src:sirva-ade` states outright that a replaced provider "will not be found in the ' +
      'shipment Resource group" — the anti-pattern, not a source.',
  },

  tripDelay: {
    type: 'tripDelay',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: a plan change is not a fact about the goods',
    ),
    provisional:
      '[SD §4.7.1], [ORIGINAL] provisional: the party dispatching the trip — the `Hauler` holding the ' +
      'trip, or the `Booker` where it dispatches. **Do not score on this.**',
  },
  tripResequence: {
    type: 'tripResequence',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: a plan change is not a fact about the goods',
    ),
    provisional: '[SD §4.7.1]: as `tripDelay`. **Do not score on this.**',
  },
  tripCancellation: {
    type: 'tripCancellation',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: a plan change is not a fact about the goods',
    ),
    provisional: '[SD §4.7.1]: as `tripDelay`. **Do not score on this.**',
  },

  membershipOffer: {
    type: 'membershipOffer',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional:
      '[SD §4.7.1], [ORIGINAL] provisional: two-sided — the offering party for `membershipOffer` and ' +
      '`membershipRelease`, the responding party for `membershipResponse`. **Do not score on this.**',
  },
  membershipResponse: {
    type: 'membershipResponse',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional: '[SD §4.7.1]: as `membershipOffer`, responding side. **Do not score on this.**',
  },
  membershipRelease: {
    type: 'membershipRelease',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional: '[SD §4.7.1]: as `membershipOffer`, offering side. **Do not score on this.**',
  },

  assignmentOffer: {
    type: 'assignmentOffer',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional:
      '[SD §4.7.1]: as the membership rows, two-sided. **Do not score on this.** NOTE this is NOT ' +
      "[A8 §4.3]'s `ASSIGNMENT` binding, which governs facts ABOUT a resource; these are facts about " +
      'the BINDING ITSELF.',
  },
  assignmentResponse: {
    type: 'assignmentResponse',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional: '[SD §4.7.1]: as `assignmentOffer`. **Do not score on this.**',
  },
  assignmentRelease: {
    type: 'assignmentRelease',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed('boundBy', '[SD §4.7.1] — the binding is owed with the row'),
    provisional: '[SD §4.7.1]: as `assignmentOffer`. **Do not score on this.**',
  },

  orderAward: {
    type: 'orderAward',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: an order is a commitment, not a fact about the goods',
    ),
    provisional:
      '[SD §4.7.1], [ORIGINAL] provisional: two-sided — the awarding party for `orderAward`, the ' +
      'offeree for `orderResponse`, and for `orderCancellation` whichever party ended it. **Do not ' +
      'score on this.**',
  },
  orderResponse: {
    type: 'orderResponse',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: an order is a commitment, not a fact about the goods',
    ),
    provisional: '[SD §4.7.1]: as `orderAward`, offeree side. **Do not score on this.**',
  },
  orderCancellation: {
    type: 'orderCancellation',
    row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
    boundBy: owed(
      'boundBy',
      '[SD §4.7.1] — NOT `CUSTODY`: an order is a commitment, not a fact about the goods',
    ),
    provisional:
      '[SD §4.7.1]: whichever party ended it — "the distinction `src:dcsa` spends three status values ' +
      'on". **Do not score on this.**',
  },
} as const satisfies { readonly [T in AssertionType]: AuthorityTableEntry<T> }

/**
 * The table is complete over the vocabulary (a type with no entry does not compile, by `satisfies`
 * above) **and** carries exactly the rows [A8 §5] publishes. If a row were written here without a
 * section to cite, this stops compiling — which is the disclosure rule, mechanised.
 *
 * Eleven at `0.1.0`; **sixteen** now. Rows 12-16 closed `handover` (**F3**), `weight.gross`,
 * `weight.tare`, `packing` and `pieceCount` — the five of [A8 §9 item 8]'s owed rows the corpus
 * supports. The other fourteen are still owed and are still owed *here*: twelve of them are blocked
 * on the corpus rather than on effort, which [A8 §9 item 8] now says in as many words.
 */
type RowedTypes = {
  [T in AssertionType]: (typeof AUTHORITY_TABLE)[T] extends { readonly a8Row: A8Row } ? T : never
}[AssertionType]

type SixteenRows = Exact<
  RowedTypes,
  | 'arrival'
  | 'departure'
  | 'loading'
  | 'unloading'
  | 'delivery'
  | 'weight.net'
  | 'sitEntryDate'
  | 'storeOut'
  | 'condition'
  | 'identity'
  | 'charge'
  | 'handover'
  | 'weight.gross'
  | 'weight.tare'
  | 'packing'
  | 'pieceCount'
>
const _sixteenRows: SixteenRows = true
void _sixteenRows

/** Whether [A8 §5] reaches this fact class at all. An owed row is not a row. */
export function hasAuthorityRow(type: AssertionType): boolean {
  return 'a8Row' in AUTHORITY_TABLE[type]
}

export function authorityRowFor(type: AssertionType): AuthorityTableEntry {
  return AUTHORITY_TABLE[type]
}

/* -------------------------------------------------------------------------------------------- */
/* Standing, evaluated                                                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * Everything the authority function is allowed to read at one instant. Note what is **not** here:
 * `assertedAt`, `recordedAt` and the current roster. The first two are A8-INSTANT; the third is
 * **A8-HISTORY** ([A8 §3]) — "authority is computed over the effective-dated role-assignment
 * _history_, never over a current roster… you cannot ask 'who was authoritative on 3 March' of a
 * roster that has since been rewritten." A `partyRole` assertion's `effectiveFrom`/`effectiveTo`
 * ([SD §7.1], `PartyRoleValue`) is what a caller resolves `roleAt` from.
 */
export interface AuthorityContext {
  readonly at: FactInstant
  readonly custody: CustodyAt
  /**
   * **A8-MOVE as amended** ([SD §4.7.2f] §7.3) — {@link custodyAuthorityAt} over the same evidence.
   *
   * Optional, and its absence is not a default: a caller that does not supply it gets
   * `custodyUnknown` wherever the fold is `UNKNOWN`, which is the answer A8 gave before the
   * amendment. Supplying it is what lets a **C5 transfer gap** answer with the releasing side
   * instead of an authority vacuum.
   */
  readonly custodyAuthority?: CustodyAuthority
  /** Present only where the movement is external — supplies rows 1, 2 and 5's alternate. */
  readonly leg?: ExternallyPerformedLeg
  /** Which of a row's mutually-exclusive circumstances hold at {@link at}. */
  readonly conditions?: readonly AuthorityCondition[]
  /** Row 11 resolves per `{aspect}`, because [SD §4.7.2b] makes the three aspects three fact keys. */
  readonly aspect?: ChargeAspect
}

export type AuthorityVerdict =
  | { readonly kind: 'holder'; readonly holder: AuthoritativeHolder; readonly rule: RuleRef }
  /** Rows 6 and 7 — nobody, and a named mechanism settles the value instead. */
  | {
      readonly kind: 'noRole'
      readonly settledBy: SettlementMechanism
      readonly tieBreak: TieBreak
      readonly rule: RuleRef
    }
  /** Row 9 — A8-JOINT. Both sides, and the model is forbidden to pick. */
  | { readonly kind: 'joint'; readonly rule: RuleRef }
  /** [A8 §9 item 8] — the fact class has no row. Never a silent "nobody". */
  | { readonly kind: 'owed'; readonly row: OwedAuthorityRow }
  /** The fold returned `UNKNOWN` and a `CUSTODY`-bound row cannot be evaluated without it. */
  | { readonly kind: 'custodyUnknown'; readonly rule: RuleRef }

/**
 * Who is authoritative for this fact class **at the instant the fact is about** — A8-INSTANT, as a
 * function rather than a field ([A8 §4]).
 *
 * The `custodyUnknown` verdict is [SD §4.8.3] rule 3 propagating: where the fold does not know who
 * held the goods, a `CUSTODY`-bound row has no answer, and inventing one here would be the
 * last-writer-wins fall-through the fold refused two modules down.
 */
export function authoritativeHolderAt(
  type: AssertionType,
  context: AuthorityContext,
): AuthorityVerdict {
  const row = AUTHORITY_TABLE[type] as AuthorityTableEntry
  if (!('a8Row' in row)) return { kind: 'owed', row }

  const spec = row.authoritative
  switch (spec.kind) {
    case 'none':
      return {
        kind: 'noRole',
        settledBy: spec.settledBy,
        tieBreak: row.tieBreak as TieBreak,
        rule: row.rule,
      }
    case 'jointAtCustodyBoundary':
      return { kind: 'joint', rule: row.rule }
    case 'perQualifierAspect': {
      // [SD §4.7.2b]: three fact keys. Asking row 11 for an authority without naming the aspect is
      // asking which of a proposal, an approval and a price wins — the contest the qualifier exists
      // to prevent.
      const aspect = context.aspect
      if (aspect === undefined) return { kind: 'owed', row: chargeNeedsAnAspect }
      return { kind: 'holder', holder: spec.by[aspect], rule: row.rule }
    }
    case 'held': {
      const conditions = context.conditions ?? []
      for (const alternate of spec.alternates ?? []) {
        if (conditions.includes(alternate.when)) {
          return { kind: 'holder', holder: alternate.holder, rule: row.rule }
        }
      }
      if (spec.primary.kind === 'custodyHolder' && context.custody.custody === 'UNKNOWN') {
        // **A8-MOVE as amended** ([SD §4.7.2f] §7.3). One of the fold's three `UNKNOWN`s is not an
        // authority gap: across a **C5 transfer gap** the releasing role stays authoritative until
        // the receipt. The other two are — nothing published yet, and C6's tie — and both fall
        // through to `custodyUnknown`, which is [SD §4.8.3] rule 3 propagating rather than a guess.
        const gap = context.custody.why === 'IN_TRANSFER_GAP'
        const authority = context.custodyAuthority
        if (gap && authority !== undefined && authority.authority === 'HELD') {
          return {
            kind: 'holder',
            holder: { kind: 'releasingRoleAcrossTransferGap', holder: authority.holder },
            rule: row.rule,
          }
        }
        return { kind: 'custodyUnknown', rule: row.rule }
      }
      return { kind: 'holder', holder: spec.primary, rule: row.rule }
    }
    default:
      return assertNever(spec, 'authoritative spec')
  }
}

const chargeNeedsAnAspect: OwedAuthorityRow<'charge'> = {
  type: 'charge',
  row: owed('authorityRow', '[A8 §9 item 8] — the fact class has no row in A8 §5'),
  boundBy: 'PRINCIPAL',
  provisional:
    'Not owed by [A8]: owed by the CALLER. [SD §4.7.2b] makes `charge` three fact keys, so a ' +
    'standing question about a charge must name its `{aspect}` before it has an answer.',
}

/**
 * The standing a role holds for a fact class, from the row's four columns.
 *
 * `undefined` means the row does not list the role, and that is deliberately **not** `advisory`:
 * [A8 §4.1]'s note 1 — "absence of corroboration is not evidence" — cuts both ways, and a role the
 * table has not placed is unplaced, not demoted.
 */
export function listedStandingOf(type: AssertionType, role: RoleName): Standing | undefined {
  const row = AUTHORITY_TABLE[type] as AuthorityTableEntry
  if (!('a8Row' in row)) return undefined
  const spec = row.authoritative
  if (spec.kind === 'held' && spec.primary.kind === 'role' && spec.primary.role === role) {
    return 'authoritative'
  }
  if (spec.kind === 'held') {
    for (const alternate of spec.alternates ?? []) {
      if (alternate.holder.kind === 'role' && alternate.holder.role === role) return 'authoritative'
    }
  }
  if (spec.kind === 'perQualifierAspect') {
    for (const holder of Object.values(spec.by)) {
      if (holder.kind === 'role' && holder.role === role) return 'authoritative'
    }
  }
  if ((row.competing ?? []).includes(role)) return 'competing'
  if ((row.corroborating ?? []).includes(role)) return 'corroborating'
  if ((row.advisory ?? []).includes(role)) return 'advisory'
  return undefined
}

/**
 * **Rule A8-SELF** — [A8 §3(a)]: "A party holding two roles on one shipment **does not corroborate
 * itself.** Where the authoritative assertion and a corroborating assertion resolve to the same
 * `partyRef`, the corroboration is recorded and **must not** be counted as independent."
 *
 * **[ORIGINAL]**, and a direct consequence of the GSD p.17 sample, where `TIER ONE RELOCATION` is
 * both `Booker` and `DestinationAgent` on one shipment: "a model that counts role-instances rather
 * than parties will read one company agreeing with itself as two-party agreement."
 */
export function corroborationIsIndependent(
  authoritative: PartyId,
  corroborating: PartyId,
): boolean {
  return authoritative !== corroborating
}

/* -------------------------------------------------------------------------------------------- */
/* §7 — how authority moves at a custody handoff                                                 */
/* -------------------------------------------------------------------------------------------- */

/**
 * **Rule A8-MOVE** — [A8 §7.1]:
 *
 * > "At a custody boundary with `basis = 349` (handed over to another party), authority over every
 * > `boundBy = CUSTODY` fact class moves to the receiving role, effective at the handoff instant.
 * > At a boundary with `basis = 41` (continued responsibility), custody moves and **authority does
 * > not**."
 *
 * **Sourced:** that the two Rec 24 codes distinguish continued from transferred *responsibility*.
 * **[ORIGINAL]:** equating responsibility for the goods with assertional authority over facts about
 * them — "Rec 24 does not say that, and Rec 24 has **no party identifier of any kind**, so it
 * cannot."
 *
 * The worked case for 41 is 400NG Item 125 **Shuttle Service** (a truck-to-truck transfer to the
 * same agent's own linehaul van); for 349 it is the interline pair `J1` Delivered to Connecting
 * Line / `R1` Received from Prior Carrier.
 *
 * **Amended by [SD §4.7.2f] §7.3, and the amendment was forced.** "Effective at the handoff
 * instant" presupposed one instant. Under F1 a transfer has two — the release and the receipt — and
 * the rule must name one:
 *
 * > "Authority over every `boundBy = CUSTODY` fact class moves at the selected **`RECEIPT`**'s
 * > `occurredAt`, on that receipt's `custodyBasis`… Across a transfer gap (C5) the **releasing
 * > role remains authoritative** until the receipt, so the gap is a custody `UNKNOWN` and not an
 * > authority vacuum."
 *
 * Nothing new is sourced: 41 vs 349 is `src:uncefact-rec24` as quoted above. **[ORIGINAL]:**
 * choosing the receipt instant — because moving authority at the release would grant it to a party
 * that has not spoken (**M1**), and because [A8 §7.4(b)] already holds a former holder
 * authoritative for everything before the handoff, so nothing is lost by waiting. **Do not score**
 * until A8 ratifies it ([SD §4.7] note 3). {@link custodyAuthorityAt} is the amended rule as a
 * function; this predicate is the 41-vs-349 half and is unchanged.
 */
export function authorityMovesAtHandover(basis: CustodyBasis): boolean {
  switch (basis) {
    case HANDED_OVER:
      return true
    case HANDED_OVER_UNDER_CONTINUED_RESPONSIBILITY:
      return false
    default:
      return assertNever(basis, 'custody basis')
  }
}

export interface AuthorityBoundary {
  /** Custody always moves at a handover; the question A8-MOVE answers is whether authority did. */
  readonly custodyMoved: true
  readonly authorityMoved: boolean
  readonly basis: CustodyBasis
  /** Present only where authority moved — otherwise the previous holder keeps it (basis 41). */
  readonly authorityNowHeldBy?: CustodyHolder
  /**
   * **Rule A8-LIABILITY** — [A8 §7.2]: "A custody handoff moves assertional authority and **moves
   * nothing else.** The chain of contractual responsibility is a separate fact and is not modelled
   * here."
   *
   * Always `false`, and it is a field rather than a comment because [A8 §10] calls this "the rule
   * most likely to be **forgotten** rather than disputed". DP3 ToS §B.3.g makes the TSP "solely
   * responsible for the acts and omissions of any third party it contracts with"; §B.3.f prohibits
   * double brokering. A8-MOVE must never be read as "subcontracting launders accountability".
   */
  readonly liabilityMoved: false
}

/**
 * A8-MOVE, applied to the fold's answer on either side of a boundary.
 *
 * Under [SD §4.7.2f] the fold's `KNOWN` answer can only have come from a selected **`RECEIPT`**
 * (C5), so "the boundary" this reads is the receipt instant and the amended rule holds without a
 * change here. What did change is what an `UNKNOWN` means: a C5 transfer gap is not a boundary at
 * all and returns `undefined`, and the caller asks {@link custodyAuthorityAt} — through
 * {@link AuthorityContext.custodyAuthority} — who remains authoritative across it.
 */
export function authorityAtBoundary(after: CustodyAt): AuthorityBoundary | undefined {
  if (after.custody !== 'KNOWN') return undefined
  const moved = authorityMovesAtHandover(after.basis)
  const boundary = {
    custodyMoved: true,
    authorityMoved: moved,
    basis: after.basis,
    liabilityMoved: false,
  } as const
  return moved ? { ...boundary, authorityNowHeldBy: after.holder } : boundary
}

/**
 * **Rule A8-AFTER** — [A8 §7.4]:
 *
 * > "A non-authoritative assertion by a former custody holder about a post-handoff instant is
 * > `advisory` if its role can never win that class, and `competing` if a published value rule
 * > makes it eligible. **It is recorded either way, appears in `considered[]`, and is never
 * > suppressed from a query.**"
 *
 * Three things it deliberately does **not** say, each of which would be a worse answer ([A8 §7.4]):
 *
 * (a) the assertions do not become false, are never retracted and are never deleted — "a handoff is
 *     not an error", and a retraction is `DID_NOT_OCCUR` ([SD §6.4]);
 * (b) they never *stop* being authoritative for facts **before** the handoff — they remain so
 *     permanently, which is what makes the origin agent's late-keyed load record still win;
 * (c) they never *had* authority for facts after it, "so nothing is downgraded" — a stronger and
 *     safer answer than "they stop being", because a stopping rule would force re-evaluation of
 *     published resolutions whenever a custody record is corrected.
 *
 * The published anti-pattern is worth keeping in view: `src:sirva-ade` GSD p.4 drops a replaced
 * service provider from the Resource group entirely, so its assertions become unattributable. "We
 * keep the party, keep the assertion, and change only its standing."
 */
export function standingAfterBoundary(
  type: AssertionType,
  role: RoleName,
): 'advisory' | 'competing' {
  const row = AUTHORITY_TABLE[type] as AuthorityTableEntry
  if (!('a8Row' in row)) return 'advisory'
  // "`competing` if a published value rule makes it eligible" — the row's `competing` column is
  // exactly the set of roles a published rule can select ([A8 §4.1]), so eligibility is a lookup
  // rather than a judgement.
  return (row.competing ?? []).includes(role) ? 'competing' : 'advisory'
}

/**
 * **Rule A8-JOINT** — [A8 §7.3], the strongest-sourced finding in the document:
 *
 * > "At a custody boundary, for `condition` and for the counts asserted with it, **both** the
 * > releasing role and the receiving role are authoritative for the boundary instant. Where they
 * > disagree, `FactResolved` MUST publish the disagreement — `selected` is empty, `considered[]`
 * > names both, and `rule` names the joint rule — and **MUST NOT select one**."
 *
 * The sentence the rule is cut from is a regulation, not an intuition: DP3 ToS NTS §1.6.10 — "in
 * the event the opinion of the TSP's driver and the NTS TSP's representative differ as to
 * shortage/overage or condition, **both opinions will be listed on the exception sheet and
 * separately identified as to source**."
 *
 * "the counts asserted with it" is `pieceCount` ([SD §4.7.1]'s pieceCount row says so outright),
 * which is why this predicate reaches a type whose own authority row is otherwise owed.
 */
export function jointRuleApplies(type: AssertionType, atCustodyBoundary: boolean): boolean {
  if (!atCustodyBoundary) return false
  return type === 'condition' || type === 'pieceCount'
}

/**
 * A8-JOINT's obligation on the resolution itself.
 *
 * Agreement is **not** the absence of disagreement: NTS §1.6.10 requires that where there is
 * nothing to report the parties still write "no differences noted", sign and date it — "agreement
 * is itself an affirmative, dated, attributed record rather than an absence." So a joint
 * resolution over two agreeing assertions may select; one over two disagreeing assertions may not.
 *
 * **[ORIGINAL]** ([A8 §7.3]): letting `FactResolved.selected` be empty for this one case. "If a
 * consumer proves it cannot tolerate an unresolved fact, the fix is a **downstream** named rule,
 * never selecting inside the resolution — selecting there would destroy the one thing every source
 * in this row preserves."
 */
export function jointResolutionIsWellFormed(
  resolved: FactResolved,
  sidesDisagree: boolean,
): boolean {
  if (!sidesDisagree) return true
  return (
    resolved.selected === null &&
    resolved.considered.length >= 2 &&
    resolved.rule.ruleId === JOINT_AT_CUSTODY_BOUNDARY.ruleId
  )
}

/**
 * **Rule A8-PRINCIPAL** — [A8 §7.5]: "A change of principal moves `boundBy = PRINCIPAL` authority
 * at the instant the instrument specifies, and **moves nothing bound to custody.**"
 *
 * The case that looks like a handoff and is not: 400NG Item 17-2.5 — after SIT termination "the
 * TSP/warehouse/subcontractor shall thereafter recognize the individual DoW customer, **not the
 * Government**, as the depositor of the property" — with Item 17-2.2 fixing the instant at
 * "midnight of the day specified in the notice". `src:cfr-49-375` §375.609 is the commercial
 * equivalent, and §375.609(g) adds a computed fallback where the notice was never given.
 *
 * **Nothing physically moved. What changed is who the arrangement is _for_.**
 */
export interface PrincipalChange {
  readonly effectiveAt: FactInstant
  readonly from: PartyId
  readonly to: PartyId
  /** [SD §6.2] / [A8 §6]: the thing that moved it. A principal does not change by itself. */
  readonly instrument: Instrument
}

/** A8-PRINCIPAL, as the one-line test it is: does this row's authority move with the principal? */
export function movesWithPrincipal(type: AssertionType): boolean {
  const row = AUTHORITY_TABLE[type] as AuthorityTableEntry
  return 'a8Row' in row && row.boundBy === 'PRINCIPAL'
}

/* -------------------------------------------------------------------------------------------- */
/* §6 — instruments, and §8 — A8-UNAUTH                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * [A8 §6] "Authority that does not come from a role: **instruments**."
 *
 * Seven kinds, each with a published instance. **[ORIGINAL]:** "grouping these seven into one
 * concept called an _instrument_, and making the concept a peer of role in the authority test. Each
 * instance is sourced verbatim; **none of the sources generalises.**"
 */
export const INSTRUMENT_KINDS = [
  /** `src:dtr-part-iv` **SF 1200** — blocks 11/12/13/14, one BL per notice, signed by the
   * initiating official AND the TSP representative. "The government is the only authorized agency
   * who can redact, modify, or remove information on the BL **through an SF1200**." */
  'RESERVED_CORRECTION_FORM',
  /** `src:dtr-part-iv` **Table A-402-4** enumerates exactly which BL fields are correctable;
   * everything else is immutable and must be cancelled and reissued. This is the published
   * precedent for [A8 §5]'s table having per-class granularity at all. */
  'CLOSED_MUTABILITY_WHITELIST',
  /** `src:cfr-49-375` §375.401(i) — an estimate may be amended only BEFORE loading; §375.403(a)(7)
   * makes silence after loading REAFFIRMATION. Authority **expires**, and an expired instrument
   * produces `INEFFECTIVE`, **not** `UNAUTHORISED` ([SD §6.1]). */
  'TIME_WINDOW_THAT_CLOSES',
  /** `src:dtr-part-iv` A-413 §H.2 — after 30 days of the issuing office's silence "the consignee is
   * permitted to make alterations or corrections". **Authority can be CREATED by elapsed silence**,
   * which is why the table must be evaluable over time rather than as a static lookup. */
  'AUTHORITY_BY_SILENCE',
  /** `src:sirva-ade` **R19 / RR19** — an `R19AuthNumber` licensing a substitute performer. Grants a
   * ROLE rather than a field-level correction, and grants it revocably (`R19Cancel`). */
  'SUBSTITUTE_PERFORMANCE_AUTHORISATION',
  /** `src:dp3-400ng` Item 17-2.2 — responsibility terminates "on midnight of the day specified in
   * the notice". Moves a PRINCIPAL (§7.5), with an exact instant. */
  'NOTICE_WITH_EFFECTIVE_INSTANT',
  /** `src:dtr-part-iv` §E.3 — cancellation after distribution requires a memorandum copy marked
   * "canceled" sent to EVERY original recipient. "An instrument is not spent when it is signed."
   * Corroborates [SD §6.5]: corrections emit obligations, and the obligation names recipients. */
  'DISTRIBUTION_OBLIGATION',
] as const

export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number]

export interface Instrument {
  readonly kind: InstrumentKind
  /** The published instance — `SF1200`, `A-413 §H.2`, an `R19AuthNumber`. Free text because the
   * instruments are drawn from six different regulations and no source enumerates them. */
  readonly instance: string
  /**
   * The fact classes this instrument reaches. `'ALL'` is legal but rare; Table A-402-4 is the
   * published precedent for an instrument scoped by what it may touch.
   *
   * TODO([A8 §6]): Table A-402-4's granularity is **field-level within one fact class** (agent code,
   * COS, dates, member identity, TCN…). The vocabulary has no sub-fact grain, so a whitelist is
   * represented here at fact-class grain and is coarser than its source.
   */
  readonly grants: readonly AssertionType[] | 'ALL'
  /** Instruments are evaluated at an instant ([A8 §8]): "the same act that is `UNAUTHORISED` on day
   * 1 is authorised on day 31, by the instrument of the issuing office's silence." */
  readonly effectiveFrom?: Instant
  readonly effectiveTo?: Instant
}

export function instrumentIsInForceAt(instrument: Instrument, at: FactInstant): boolean {
  const from = instrument.effectiveFrom
  const to = instrument.effectiveTo
  if (from !== undefined && Date.parse(at) < Date.parse(from)) return false
  if (to !== undefined && Date.parse(at) > Date.parse(to)) return false
  return true
}

export function instrumentReaches(instrument: Instrument, type: AssertionType): boolean {
  return instrument.grants === 'ALL' || instrument.grants.includes(type)
}

/**
 * What a declaring party offers as its authority — [A8 §8] item 2: "`Correction.authority` is
 * satisfied by **either** a role that [A8 §5] makes authoritative for the fact class **or** an
 * instrument from [A8 §6] — never by neither."
 *
 * "Never by neither" is held in the type: there is no third member and no absent case.
 */
export type AuthorityClaim =
  | { readonly kind: 'role'; readonly role: RoleName }
  | { readonly kind: 'instrument'; readonly instrument: Instrument }

export type AuthorityTestResult =
  | { readonly kind: 'AUTHORISED'; readonly by: AuthorityClaim }
  /** [A8 §8] **A8-UNAUTH**. Recorded, not applied, and emits an obligation ([SD §6.1]). */
  | { readonly kind: 'UNAUTHORISED'; readonly because: UnauthorisedBecause }

export const UNAUTHORISED_BECAUSE = [
  'ROLE_IS_NOT_AUTHORITATIVE_FOR_THIS_CLASS_AT_THIS_INSTANT',
  'INSTRUMENT_DOES_NOT_REACH_THIS_FACT_CLASS',
  'INSTRUMENT_NOT_IN_FORCE_AT_THIS_INSTANT',
  /** [A8 §9 item 8]: the row is owed, so the test cannot say the party IS authoritative. It says
   * so rather than defaulting either way — an owed row must not silently authorise. */
  'NO_AUTHORITY_ROW_FOR_THIS_FACT_CLASS',
] as const

export type UnauthorisedBecause = (typeof UNAUTHORISED_BECAUSE)[number]

/**
 * **Rule A8-UNAUTH** — [A8 §8]:
 *
 * > "A correction is `UNAUTHORISED` when, for the corrected fact's `factClass` and **the instant
 * > the fact is _about_**, the declaring role is neither `authoritative` under the applicable
 * > `AuthorityRule` nor exercising a named instrument under [A8 §6]. It is recorded, not applied,
 * > and emits an obligation to the party that does have authority."
 *
 * Two worked cases, both sourced: a TSP-declared BL correction with no SF 1200 is `UNAUTHORISED`
 * (400NG Introduction p.14 / Item 17.10); with one, it is the Government's correction and is
 * `APPLIED`. And the consignee of `src:dtr-part-iv` A-413 §H.2, unauthorised on day 1 and
 * authorised on day 31 by the instrument of silence.
 *
 * Note the boundary [SD §6] draws and this test does not disturb: **wrong party → `UNAUTHORISED`;
 * right party, closed window → `INEFFECTIVE`.** This function answers only the first. The window is
 * `rules/corrections.ts`'s.
 */
export function authorityToDeclare(
  type: AssertionType,
  claim: AuthorityClaim,
  context: AuthorityContext,
): AuthorityTestResult {
  if (claim.kind === 'instrument') {
    if (!instrumentReaches(claim.instrument, type)) {
      return { kind: 'UNAUTHORISED', because: 'INSTRUMENT_DOES_NOT_REACH_THIS_FACT_CLASS' }
    }
    if (!instrumentIsInForceAt(claim.instrument, context.at)) {
      return { kind: 'UNAUTHORISED', because: 'INSTRUMENT_NOT_IN_FORCE_AT_THIS_INSTANT' }
    }
    return { kind: 'AUTHORISED', by: claim }
  }

  const verdict = authoritativeHolderAt(type, context)
  switch (verdict.kind) {
    case 'owed':
      return { kind: 'UNAUTHORISED', because: 'NO_AUTHORITY_ROW_FOR_THIS_FACT_CLASS' }
    case 'holder':
      return verdict.holder.kind === 'role' && verdict.holder.role === claim.role
        ? { kind: 'AUTHORISED', by: claim }
        : {
            kind: 'UNAUTHORISED',
            because: 'ROLE_IS_NOT_AUTHORITATIVE_FOR_THIS_CLASS_AT_THIS_INSTANT',
          }
    case 'joint':
      // A8-JOINT makes BOTH sides authoritative, so a role listed by the table as participating in
      // the boundary is authorised. Which roles those are is a property of the boundary, not of the
      // fact class ([A8 §5] row 9 corroborating column), so this cannot be decided from the row
      // alone — and it is reported as unauthorised rather than waved through. See the TODO below.
      return {
        kind: 'UNAUTHORISED',
        because: 'ROLE_IS_NOT_AUTHORITATIVE_FOR_THIS_CLASS_AT_THIS_INSTANT',
      }
    case 'noRole':
    case 'custodyUnknown':
      return {
        kind: 'UNAUTHORISED',
        because: 'ROLE_IS_NOT_AUTHORITATIVE_FOR_THIS_CLASS_AT_THIS_INSTANT',
      }
    default:
      return assertNever(verdict, 'authority verdict')
  }
}

// TODO([A8 §9 items 1-3, 5]): `authorityToDeclare` compares ROLE NAMES, because `assertedBy.partyRef`
// has no target schema until the party entity lands, and because the releasing/receiving roles at a
// custody boundary are a property of the boundary rather than of the fact class. Two consequences
// are visible above and neither is papered over: a `custodyHolder` row can only be matched once a
// caller resolves the fold's holder to a role (A8-HISTORY's effective-dated role assignments), and
// an A8-JOINT row returns UNAUTHORISED for every role rather than authorising both sides blind.
