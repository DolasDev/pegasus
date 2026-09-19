/**
 * Corrections outside a legal amendment window — [SD §6].
 *
 * > "**Every correction attempt is recorded. There is no refusal path.** A correction outside its
 * > amendment window is recorded, flagged `INEFFECTIVE`, never applied to the priced record, and
 * > emits its notification obligation." — [SD §6]
 *
 * What this replaced is worth keeping in view, because it is the failure the shape exists to avoid:
 * `fork-time` §5.1 had "a correction outside the window is **refused rather than recorded**", which
 * "obliges the catalog to retain a fact it knows to be false — the exact failure the document exists
 * to prevent — and contradicts its own §5.4, which requires corrections to emit obligations (a
 * refused correction emits nothing)."
 *
 * So the load-bearing property of this module is that {@link decideCorrection} is **total**: every
 * input produces a record. There is no path that returns nothing, throws, or reports a refusal.
 */

import type { Correction, CorrectionEffect, CorrectionReason, EvidenceRef } from '../assertions'
import { CORRECTION_EFFECTS } from '../assertions'
import type { EventId } from '../envelope'
import type { PartyId } from '../ids'
import type { Owed } from '../primitives'
import { assertNever, owed } from '../primitives'
import type { AssertionType } from '../vocabulary'
import type {
  AuthorityClaim,
  AuthorityContext,
  AuthoritativeHolder,
  FactInstant,
} from './authority'
import { authorityToDeclare, authoritativeHolderAt } from './authority'

/**
 * [SD §6.1]'s three outcomes, **all recorded**, and the check that there is no fourth.
 *
 * `CORRECTION_EFFECTS` itself lives in `assertions.ts` with the record class. What is here is the
 * prohibition: a member meaning *refused*, *rejected* or *ignored* would reintroduce `fork-time`
 * §5.1's shape, so its absence is asserted rather than remembered.
 */
type NoRefusalPath =
  Extract<
    CorrectionEffect,
    'REFUSED' | 'REJECTED' | 'IGNORED' | 'DISCARDED' | 'NOT_RECORDED'
  > extends never
    ? true
    : never
const _noRefusalPath: NoRefusalPath = true
void _noRefusalPath

/* -------------------------------------------------------------------------------------------- */
/* The amendment window                                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Whether the legal window for amending this fact is open at the instant the correction is
 * declared.
 *
 * The one published instance is `src:cfr-49-375` **§375.401(i)** — an estimate may be amended by
 * mutual agreement **only before loading**, "You may not amend the estimate after loading the
 * shipment" — with §375.403(a)(7) making silence after loading **reaffirmation** rather than
 * indifference. [SD §6.2] is careful about what that does and does not support: "the regulation
 * binds **the parties and the price**. **[ORIGINAL]:** that a records system may nonetheless
 * _record_ the attempt and mark it ineffective."
 */
export type AmendmentWindow =
  { readonly kind: 'OPEN' } | { readonly kind: 'CLOSED'; readonly closedBy: WindowClosure }

/**
 * What closed the window. Only the first member is sourced; the rest of the vocabulary is owed with
 * {@link AMENDMENT_WINDOWS}.
 */
export const WINDOW_CLOSURES = [
  /** `src:cfr-49-375` §375.401(i): loading began. */
  'LOADING_BEGAN',
  /** [A8 §6]: an instrument whose own time window has closed. Authority **expires**, and an expired
   * instrument produces `INEFFECTIVE`, not `UNAUTHORISED` ([SD §6.1]). */
  'INSTRUMENT_EXPIRED',
] as const

export type WindowClosure = (typeof WINDOW_CLOSURES)[number]

/**
 * **Owed — and the gap has a sharp edge worth naming.**
 *
 * The corpus publishes exactly one amendment window (§375.401(i)), and it governs the **estimate**
 * — which `vocabulary.ts` lists in `ABSENT_AND_OWED` on [SD §4.7.3]'s instruction, because no `type`
 * for it has been minted. So the only sourced window in the corpus attaches to a fact class the
 * vocabulary cannot yet express, and every other fact class's window is unpublished.
 *
 * Consequently the window is an **input** to {@link decideCorrection} rather than a table it looks
 * up. A caller that does not know the window cannot be given a default here: an assumed-open window
 * would apply corrections the law does not permit, and an assumed-closed one would flag valid
 * corrections ineffective.
 *
 * TODO([SD §4.7.3] / A4): mint `estimate` (and `survey`) as fact classes, then carry §375.401(i) as
 * a row of this table.
 */
export const AMENDMENT_WINDOWS = owed(
  'amendmentWindowTable',
  '[SD §6.2] / [SD §4.7.3] — the one published window governs `estimate`, which has no `type`',
)

/* -------------------------------------------------------------------------------------------- */
/* Authority: an instrument, not just a party                                                    */
/* -------------------------------------------------------------------------------------------- */

/**
 * [SD §6.2]: "`Correction.authority` names an **instrument**, not just a party."
 *
 * Sourced directly: `src:dp3-400ng` Introduction p.14 / Item 17.10 — "The TSP/Agent will not redact,
 * modify, or remove any information on the BL… The government is the only authorized agency who can
 * redact, modify, or remove information on the BL **through an SF1200**", and destination changes
 * arrive as a correction notice that "must be recorded on the BL".
 *
 * The type is [A8 §8] item 2's, imported rather than restated: satisfied by **either** an
 * authoritative role **or** a named instrument, "never by neither". It is mandatory on every
 * attempt — a correction that offers no authority at all is not an edge case, it is the
 * `UNAUTHORISED` row.
 */
export type CorrectionAuthority = AuthorityClaim

/* -------------------------------------------------------------------------------------------- */
/* The priced record, and financial facts                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * [SD §6.3]:
 *
 * > "**Operational facts are corrected by supersede/retract. Financial facts are corrected only by
 * > an offsetting record, never by retraction — and an `INEFFECTIVE` correction never reaches the
 * > priced record at all.**"
 */
export const FINANCIAL_FACT_CLASSES = ['charge'] as const

export type FinancialFactClass = (typeof FINANCIAL_FACT_CLASSES)[number]

/**
 * The fact classes a `Correction` may name. `charge` is excluded **in the type**, so "financial
 * facts are corrected only by an offsetting record" is not a rule a caller can forget: a correction
 * against a charge does not compile, and {@link OffsettingRecord} is the only door.
 */
export type CorrectableType = Exclude<AssertionType, FinancialFactClass>

/** [SD §6.3]: only an `APPLIED` correction reaches the priced record. Both other outcomes are
 * recorded and queryable and neither is applied. */
export function reachesThePricedRecord(effect: CorrectionEffect): boolean {
  switch (effect) {
    case 'APPLIED':
      return true
    case 'INEFFECTIVE':
    case 'UNAUTHORISED':
      return false
    default:
      return assertNever(effect, 'correction effect')
  }
}

/**
 * `src:sirva-ade` ABS p.3's financial correction triple, with the invariant the source states and
 * makes testable: a `CAN` "combined with the 'Original' amounts will **zero out** the shipment".
 * `BatchNbr` distinguishes reruns.
 *
 * Corroborated independently by `src:dp3-400ng` Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c — refunds,
 * reimbursements and re-bills are "**additional coded transactions carrying a narrative note**,
 * never edits to the original charge" — and structurally by `src:uncefact-scrdm`, which models
 * `Financial_Adjustment` as an entity separate from `Delivery_Adjustment`.
 */
export const ADJUSTMENT_CODES = ['ORIGINAL', 'ADJ', 'CAN'] as const

export type AdjustmentCode = (typeof ADJUSTMENT_CODES)[number]

export interface OffsettingRecord {
  /** The charge assertion this record offsets. A link, never an edit. */
  readonly offsets: EventId
  /** `ORIGINAL` is the thing being offset, not an offset, so it cannot be spelled here. */
  readonly adjCode: Exclude<AdjustmentCode, 'ORIGINAL'>
  /** ADE's `BatchNbr` — distinguishes reruns from genuine second adjustments. */
  readonly batch?: string
  /** 400NG's "narrative note", mandatory on a coded refund or re-bill. */
  readonly narrative: string
}

/**
 * ADE's stated invariant, as a check. Deliberately takes amounts rather than assertions:
 * `ValueByType['charge']` is **owed** ([SD §4.7.3] — "no document gives any of the three a shape"),
 * so there is no value to read off a charge assertion yet.
 *
 * TODO([SD §4.7.2b] / A11): when the charge value lands, this should take the two assertions and
 * read them, and should be evaluated per `{aspect}` fact key rather than per shipment.
 */
export function cancellationZeroesOut(originalTotal: number, cancelTotal: number): boolean {
  return originalTotal + cancelTotal === 0
}

/* -------------------------------------------------------------------------------------------- */
/* Retraction                                                                                    */
/* -------------------------------------------------------------------------------------------- */

/**
 * [SD §6.4] fixes what `fork-time` had adopted as two incompatible rules in one paragraph:
 *
 * > "**EPCIS's rule is kept: a `DID_NOT_OCCUR` retraction names no replacement. The 858's
 * > restore-to-previous is kept as an _intent_ and dropped as a _mechanism_. A retraction removes
 * > the retracted assertion from the contest; the catalog then republishes `FactResolved` over what
 * > remains.**"
 *
 * Why the mechanism goes: the 858's `01` is defined over an ordered status history on **one
 * carrier's own message stream**, not over multi-party assertions of arbitrary facts. "Applied
 * across parties it **silently promotes some other company's assertion, which the retracting party
 * may have no authority to affirm**." Republishing achieves the 858's intent — the answer reverts
 * to the best remaining one — "with the authority chain intact and the rule named".
 *
 * The naming half is already structural: `CorrectionReason` in `assertions.ts` gives
 * `DID_NOT_OCCUR` a `replacement?: never`. This function is the dropped mechanism's replacement:
 * the retraction changes the **contest**, and the catalog re-resolves.
 */
export function contestAfterRetraction(
  considered: readonly EventId[],
  retracted: EventId,
): readonly EventId[] {
  return considered.filter((candidate) => candidate !== retracted)
}

/**
 * [SD §6.6]: "**the cascade is not a correction.**"
 *
 * `fork-time` §5.2 required a correction to an input of a derived actual to cascade as an automatic
 * supersession; the critique found three rules colliding on the SIT case — "an automatic cascade is
 * a correction to a warehouse-authoritative, legally load-bearing date, **declared by the platform,
 * with no authority the model grants it**."
 *
 * Resolved by the shape: the derived value is an Assertion with `capturedBy = DERIVED_BY_RULE`
 * ([SD §5.2] M4); when an input is retracted, the platform publishes a **new** derived Assertion and
 * a new `FactResolved`. "The platform asserts what it derived, which it plainly has authority to do;
 * **it never corrects the warehouse agent's fact.**"
 *
 * Always `false`, as a value a caller can assert against rather than a paragraph it may skip.
 */
export const CORRECTED_DERIVATION_INPUT_EMITS_A_CORRECTION = false

/* -------------------------------------------------------------------------------------------- */
/* Obligations                                                                                   */
/* -------------------------------------------------------------------------------------------- */

/**
 * [SD §6.5]: `fork-time` §5.4 — a fact carries the clocks that depend on it, and correcting such a
 * fact emits a notification event naming **who must be told and by when** — is "retained, correctly
 * marked **[ORIGINAL]**, and is now **extended to `INEFFECTIVE` and `UNAUTHORISED` corrections**,
 * which is what resolves the §5.1/§5.4 contradiction."
 *
 * Why obligations exist at all is sourced: DP3 ToS §C.3.c makes delivery notification a duty with a
 * deadline (at least 24 hours' notice), an escalation (two documented unsuccessful contact attempts
 * six hours apart, the final one telephonic), a required content list and a recording obligation;
 * `src:cfr-49-375` opens a nine-month claims window.
 */
export interface CorrectionObligation {
  readonly because: CorrectionEffect
  readonly recipient: ObligationRecipient
  /**
   * **Owed.** The sourced deadlines belong to specific duties (24 hours' notice of delivery; three
   * GBD; nine months to claim) and no document states a deadline for *notifying a correction*.
   */
  readonly by: Owed<'obligationDeadline', 'A4 / [SD §6.5] — no source states a correction deadline'>
}

/**
 * Who must be told.
 *
 * [SD §6.1] names the recipient for one of the three outcomes — `UNAUTHORISED` "emits an obligation
 * to **the party that does have authority**" — which is computable from [A8 §5]'s table, so it is
 * carried as the holder rather than as a party id. For the other two the recipient is genuinely
 * owed: [A8 §9 item 6] owes "the party as a notification target", and "[SD §6.5]'s obligations
 * cannot name a contactable party until it lands" ([SD §4.7.3]).
 *
 * TODO([A8 §9 item 6]): note the sourced **anti-pattern** the resolution must preserve when it
 * lands — `src:dtr-part-iv` A-402 §F.8.d forbids the TSP updating the customer's e-mail address
 * after pickup **because of a conflict of interest**: "a field-level write permission justified by
 * _incentive_, not by ownership, and a shape no role-based scheme will produce by accident."
 */
export type ObligationRecipient =
  | { readonly kind: 'holderOfAuthority'; readonly holder: AuthoritativeHolder }
  | {
      readonly kind: 'owed'
      readonly recipient: Owed<
        'obligationRecipient',
        '[A8 §9 item 6] — the party as a notification target'
      >
    }

/* -------------------------------------------------------------------------------------------- */
/* The decision procedure                                                                        */
/* -------------------------------------------------------------------------------------------- */

/**
 * A correction as it arrives. Note `at`: **A8-INSTANT** — the authority test is run at the instant
 * the corrected fact is *about*, never at the instant the correction was declared, which is why
 * this field is a {@link FactInstant} and the declaration clock does not appear at all.
 */
export interface CorrectionAttempt<T extends CorrectableType = CorrectableType> {
  /** [SD §1.1]: MANDATORY, "the obligation a generic link bag could not state". */
  readonly corrects: EventId
  /** The corrected fact's class — [SD §1.3]: one axis, and on an Assertion it **is** the fact class. */
  readonly type: T
  readonly reason: CorrectionReason
  readonly authority: CorrectionAuthority
  readonly declaredBy: PartyId
  /** A8-INSTANT: the instant the corrected fact is about. */
  readonly at: FactInstant
  readonly evidence?: readonly EvidenceRef[]
  /**
   * `src:x12-858-implementation-guide`'s restore-to-previous, forbidden as a **mechanism**
   * ([SD §6.4]) — it "silently promotes some other company's assertion". The intent is kept and is
   * served by {@link contestAfterRetraction} plus a republished `FactResolved`.
   */
  readonly restoresPrevious?: never
}

/** The correction as recorded — the record class from `assertions.ts`, plus what [SD §6] adds. */
export type RecordedCorrection<T extends CorrectableType = CorrectableType> = Correction<T> & {
  readonly authority: CorrectionAuthority
  readonly obligations: readonly CorrectionObligation[]
  readonly restoresPrevious?: never
}

/** What the decision procedure returns before an envelope is minted around it. */
export interface CorrectionVerdict {
  readonly effect: CorrectionEffect
  readonly obligations: readonly CorrectionObligation[]
  /** [SD §6.3]: only `APPLIED` reaches it. Carried explicitly because [SD §6.1] states the
   * priced-record consequence as part of the outcome's meaning, not as a downstream detail. */
  readonly reachesThePricedRecord: boolean
  /** [SD §6.1] `APPLIED`: "Enters the contest; `FactResolved` republished." The other two do not. */
  readonly entersTheContest: boolean
}

/**
 * [SD §6.1]'s table, executed. **Total by construction** — every path returns a verdict, and the
 * verdict always carries an obligation.
 *
 * Order matters and is [A8 §8]'s: "**Wrong party → `UNAUTHORISED`. Right party, closed window →
 * `INEFFECTIVE`.** Both are recorded; neither reaches the priced record." So authority is the first
 * gate; the window is only asked once the declarer is entitled to be asking.
 */
export function decideCorrection(
  attempt: CorrectionAttempt,
  window: AmendmentWindow,
  context: AuthorityContext,
): CorrectionVerdict {
  const test = authorityToDeclare(attempt.type, attempt.authority, context)
  if (test.kind === 'UNAUTHORISED') {
    return {
      effect: 'UNAUTHORISED',
      // [SD §6.1]: "emits an obligation to the party that does have authority".
      obligations: [
        {
          because: 'UNAUTHORISED',
          recipient: recipientWithAuthority(attempt.type, context),
          by: owed('obligationDeadline', 'A4 / [SD §6.5] — no source states a correction deadline'),
        },
      ],
      reachesThePricedRecord: false,
      entersTheContest: false,
    }
  }

  switch (window.kind) {
    case 'CLOSED':
      return {
        // [SD §6.1]: "Recorded. Flagged legally ineffective. Never applied to the priced record.
        // Emits the obligation. **Queryable as a class.**"
        effect: 'INEFFECTIVE',
        obligations: [ineffectiveObligation()],
        reachesThePricedRecord: false,
        entersTheContest: false,
      }
    case 'OPEN':
      return {
        effect: 'APPLIED',
        obligations: [appliedObligation()],
        reachesThePricedRecord: true,
        entersTheContest: true,
      }
    default:
      return assertNever(window, 'amendment window')
  }
}

function recipientWithAuthority(
  type: AssertionType,
  context: AuthorityContext,
): ObligationRecipient {
  const verdict = authoritativeHolderAt(type, context)
  return verdict.kind === 'holder'
    ? { kind: 'holderOfAuthority', holder: verdict.holder }
    : {
        kind: 'owed',
        recipient: owed(
          'obligationRecipient',
          '[A8 §9 item 6] — the party as a notification target',
        ),
      }
}

function ineffectiveObligation(): CorrectionObligation {
  return {
    because: 'INEFFECTIVE',
    recipient: {
      kind: 'owed',
      recipient: owed('obligationRecipient', '[A8 §9 item 6] — the party as a notification target'),
    },
    by: owed('obligationDeadline', 'A4 / [SD §6.5] — no source states a correction deadline'),
  }
}

function appliedObligation(): CorrectionObligation {
  return {
    because: 'APPLIED',
    recipient: {
      kind: 'owed',
      recipient: owed('obligationRecipient', '[A8 §9 item 6] — the party as a notification target'),
    },
    by: owed('obligationDeadline', 'A4 / [SD §6.5] — no source states a correction deadline'),
  }
}

/**
 * [SD §6.1]: every one of the three outcomes is "**queryable as a class**" — including the two that
 * were never applied, which is the whole difference between recording a correction and honouring
 * it.
 *
 * `src:gs1-epcis-cbv` is the precedent, retained in full from `fork-time`:
 * `EXISTS_errorDeclaration`, `EQ_errorReason`, `EQ_correctiveEventID`, `GE_/LT_errorDeclaration_Time`.
 * The set is the whole enum by construction rather than by choice: a model that records an
 * ineffective correction but cannot enumerate ineffective corrections has not really recorded it.
 */
export const QUERYABLE_CORRECTION_CLASSES: readonly CorrectionEffect[] = CORRECTION_EFFECTS
