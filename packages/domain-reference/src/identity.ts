/**
 * Identifier shape — [SD §7].
 *
 * > "An identifier is an Assertion of `type = identity`. It carries a vocabulary scope and an
 * > effective interval, it attaches at every aggregate grain, and `primary` is not a stored flag
 * > but the output of `FactResolved` — resolved per `(subject, scheme, vocabularyScope)`, which is
 * > the identity type's own fact key and nothing special." — [SD §7]
 */

import type { EventId, SubjectRef } from './envelope'
import type { AggregateKind, PartyId } from './ids'
import type { Instant, OwedCode } from './primitives'

/**
 * The naming system, "which DEFINES who assigns and what it identifies" — [SD §7.1].
 *
 * **Owed.** The documents name schemes in passing (`vanline.registration`, `QPDTripNumber`,
 * `CamisTripNumber`, the SIT control number, GBLOC, SCAC) but publish no scheme vocabulary, and
 * [A8 §9] does not owe one either.
 *
 * TODO(A9): the scheme list is A9's. Until it lands, a scheme is an owed code.
 */
export type SchemeName = OwedCode<'identityScheme'>

export const schemeName = (raw: string): SchemeName => raw as SchemeName

/**
 * [SD §7.1] `vocabularyScope { authority, tariff?, brand?, year?, programme? }`.
 *
 * Sourced at grade A: `src:sirva-ade`'s addressable key is the **triple** `Brand + RegNumber +
 * RegYear` — "reg numbers recycle across years and brands" — and `Brand` "scopes every id"
 * (GSD p.15). Corroborated, as grade-B structural evidence, by eleven of Atlas's 47 reachable
 * reference endpoints taking a **required** `tariffName` / `effectiveDate` qualifier, and by the
 * same carton reading `1.5 cf` under `ATVL1000TR` and `1.5cu` under a Canadian tariff [SD §7.3].
 */
export interface VocabularyScope {
  /**
   * "The body that **defines and maintains the naming vocabulary** this id is drawn from"
   * — [SD §7.1].
   *
   * Kept distinct from {@link IdentityValue.issuer}. Revision 3 defect D: the previous shape
   * "carried `issuer` twice — once inside `vocabularyScope` and once beside it — with no stated
   * difference. They are two different things and are now named as two." Atlas's tariff is an
   * authority in this sense; X12 `MS2`'s equipment owner is an issuer.
   */
  readonly authority: PartyId
  readonly tariff?: string
  readonly brand?: string
  readonly year?: number
  readonly programme?: string
}

/** [SD §1.3], [SD §4.7.1]: `identity`'s declared qualifier — and the I-KEY tuple's tail. */
export interface IdentityQualifier {
  readonly scheme: SchemeName
  readonly vocabularyScope: VocabularyScope
}

/** [SD §7.1] the `value` of an identity Assertion. */
export interface IdentityValue {
  /** "verbatim as the counterparty gave it; **never canonicalised in storage**" — [SD §7.1]. */
  readonly id: string
  /**
   * "The **party that assigned this particular id** to this particular subject" — [SD §7.1].
   *
   * X12's `MS2` is the case that forces it to exist separately from the vocabulary's authority:
   * "equipment identity is the **owner's** SCAC plus the number _that owner_ assigned"; the
   * vocabulary is "trailer numbers", the issuer is the carrier whose numbering this `12345`
   * belongs to. [A8 §4.3] binds `identity` `boundBy = SCHEME` to this party: authority "belongs
   * to the **issuer** of the naming scheme and never moves."
   */
  readonly issuer: PartyId
  /**
   * [SD §7.2] the effective interval, sourced twice: `src:x12-212-trailer-manifest` `BLR-02` makes
   * the carrier-of-record for a shipment time-scoped, and `src:dp3-400ng`'s GBLOC responsibility
   * "can be **reassigned mid-life**, with a transfer list and effective dates".
   *
   * `effectiveTo` is absent for an attribution that has not ended.
   * DECISION: the documents give the field and not its obligation. Absent-means-open is chosen
   * over a sentinel because [SD §7.5] already solves the reissue case with `supersedes` plus a
   * new `effectiveFrom`, which requires the earlier row to be closable but not pre-closed.
   */
  readonly effectiveFrom: Instant
  readonly effectiveTo?: Instant
  /**
   * [SD §7.5] "**`primary` is not a stored flag.** It is the output of `FactResolved` over the
   * identity assertions for one `(subject, scheme, vocabularyScope)`… at an instant."
   * `src:project44`'s `primaryForType` is the precedent for the concept; **[ORIGINAL]**: deriving
   * it rather than storing it. This closes cross-document conflict #5.
   */
  readonly primary?: never
  /** [SD §7.5] "The reissued-BOL problem is solved by the interval, not by a new field… No
   * `issuedAt` field is added." */
  readonly issuedAt?: never
}

/**
 * **Rule I-KEY** — [SD §7.1]. "The identity fact key is `(subject, scheme, vocabularyScope)`.
 * Arity is N per that tuple, and `primary` resolves per that tuple. One key, stated once, used by
 * both rules."
 *
 * Revision 3 defect D: keying arity on the triple while resolving `primary` on `(subject, scheme)`
 * was "a real, load-bearing mismatch and not a typo" — an agent booking for two van lines holds
 * two registrations under the one scheme with different brand scopes, both concurrently valid,
 * and the looser key obliged `FactResolved` to declare one the loser.
 */
export interface IdentityFactKey<K extends AggregateKind = AggregateKind> {
  readonly subject: SubjectRef<K>
  readonly scheme: SchemeName
  readonly vocabularyScope: VocabularyScope
}

/** Structural equality of the scope half of I-KEY. */
export function sameVocabularyScope(left: VocabularyScope, right: VocabularyScope): boolean {
  return (
    left.authority === right.authority &&
    left.tariff === right.tariff &&
    left.brand === right.brand &&
    left.year === right.year &&
    left.programme === right.programme
  )
}

/** I-KEY equality: two identity assertions are in the same contest exactly when this holds. */
export function sameIdentityFactKey(left: IdentityFactKey, right: IdentityFactKey): boolean {
  return (
    left.subject.aggregate === right.subject.aggregate &&
    left.subject.id === right.subject.id &&
    left.scheme === right.scheme &&
    sameVocabularyScope(left.vocabularyScope, right.vocabularyScope)
  )
}

/**
 * [SD §7.5] "**Canonicalise to match; never to store.**"
 *
 * `src:shippeo`'s Smart Reference Matching, "removing all special characters… and removing
 * leading zeros" so `00AB C-D*E` matches `A-B-C-D-E`, "is adopted as a **published policy**,
 * forbidden from mutating `value`. A canonical match is an Assertion with a resolvable verdict,
 * never a truth. The failure mode is a false positive, which is worse than a miss."
 *
 * The return type is deliberately `string` and not `IdentityValue['id']`: the output of this
 * function may never be written back.
 */
export function canonicaliseForMatch(raw: string): string {
  return raw
    .replace(/[^0-9A-Za-z]/g, '')
    .replace(/^0+(?=.)/, '')
    .toUpperCase()
}

/**
 * [SD §7.5] `primary` is the output of resolution over one I-KEY tuple, at an instant.
 *
 * Takes the selected eventId a `FactResolved` published for an identity contest. `null` is
 * returned unchanged and means the resolution declined to select — legal only where a published
 * rule says so ([A8 §7.3] A8-JOINT, [A8 §4.4] A8-NAMED).
 */
export function primaryFromResolution(selected: EventId | null): EventId | null {
  return selected
}
