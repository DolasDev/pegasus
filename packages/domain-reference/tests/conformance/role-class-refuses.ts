/**
 * Conformance — the shapes [A8 §9 item 2]'s `roleClass` refusal must keep illegal.
 *
 * Same contract as `identity-scheme-refuses.ts`, `core-vocabulary-refuses.ts`,
 * `document-evidence-refuses.ts` and `charge-collection-refuses.ts`: every `@ts-expect-error` must
 * fire. If an illegal state ever becomes legal, TypeScript reports the directive as unused
 * (`TS2578`) and this file stops compiling.
 *
 * **The refusal itself is held elsewhere and deliberately so**: that `roleClass` is still owed is
 * `RoleClassStaysOwed` in `src/rules/authority.ts`, an `Exact<>` with its assignment beside it
 * ([A5 §9]), declared in A8's own module from [A8 §9 item 2]'s reading of element 98 rather than
 * generated from `outcomes.ts`, so it is not [A2 §9]'s tautology.
 *
 * **What this file holds is the thing a reader of that refusal gets backwards.** `roleClass` is
 * refused *and* `ATTRIBUTION_NO_PARTY` is published, which looks like publishing one member of a
 * refused vocabulary. It is not: no-party is declared by `Attribution`'s **shape**, exactly as
 * `OTHER` is declared by `Reason`'s shape and not by the vocabulary A4 published. The two halves
 * below are the two ways that could silently stop being true — the shape could stop forbidding
 * `party` on the no-party branch, or the constructor could start admitting the spelling into the
 * vocabulary.
 *
 * A type-level suite: nothing here runs. The behavioural half is `reason-attribution.test.ts`.
 */
import type { PartyId } from '../../src/ids'
import { partyId } from '../../src/ids'
import type { Attribution } from '../../src/outcomes'
import { ATTRIBUTION_NO_PARTY, roleClass } from '../../src/outcomes'

/* ------------------------------------------------------------------------------------------------
 * Half 1 — the no-party branch forbids `party`, because naming one contradicts it
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two legal attributions either side of the refusal, so a tamper that collapses the union to
 * `unknown` is caught too.
 *
 * The first is the ordinary case [SD §2.6] works: a class **and** the party, which is the branch
 * `party` is optional on. The second is the no-party case with nothing beside it.
 */
const aClassAndTheParty: Attribution = {
  roleClass: roleClass('customer'),
  party: partyId('party:the-householder'),
}
const noPartyAtAll: Attribution = { roleClass: ATTRIBUTION_NO_PARTY }
void aClassAndTheParty
void noPartyAtAll

/**
 * Written as a named value rather than an annotated literal for `identity-scheme-refuses.ts`'s
 * reason: `@ts-expect-error` covers **one** line, so the value is named first and the assignment is
 * what carries the directive.
 *
 * And it is named as a `PartyId` rather than inlined, because [SD §2.4]'s excess-property check
 * would catch an inline object literal for a reason that has nothing to do with the union — the
 * `ZonedInstant` lesson ([A9 §9]) in the direction that flatters a gate. Routing the value through
 * a variable makes the branch do the work.
 */
const someParty: PartyId = partyId('party:somebody')

// @ts-expect-error [A8 §9 item 2] — `FORCE_MAJEURE` is caused by no party, so naming one is a
// contradiction rather than a record. `ATTRIBUTION_NO_PARTY`'s branch forbids `party`.
const noPartyCannotNameOne: Attribution = {
  roleClass: ATTRIBUTION_NO_PARTY,
  party: someParty,
}
void noPartyCannotNameOne

/* ------------------------------------------------------------------------------------------------
 * Half 2 — the spelling is NOT a member of the refused vocabulary
 * ---------------------------------------------------------------------------------------------- */

/**
 * `RoleClass` is `OwedCode<'roleClass'>`, a brand, so the bare literal is **not** assignable to it.
 * That is what keeps the two branches of `Attribution` disjoint, and it is the compile-time half of
 * the runtime guard in `roleClass()`.
 *
 * The day a round narrows `RoleClass` to a union of published members that includes this spelling,
 * this directive goes unused and the file stops compiling — which is the same edge
 * `RoleClassStaysOwed` watches, approached from the member rather than from the type.
 */
const theNoPartySpelling = ATTRIBUTION_NO_PARTY

// @ts-expect-error [A8 §9 item 2] — no-party is declared by the `Attribution` shape, not by the
// owed `roleClass` vocabulary; a brand is what stops the spelling being read as a member of it.
const spellingIsNotAVocabularyMember: ReturnType<typeof roleClass> = theNoPartySpelling
void spellingIsNotAVocabularyMember
