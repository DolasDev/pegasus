/**
 * Conformance — what [A8 §9 item 1] keeps illegal now that [A9 §3.6]'s finding is discharged.
 *
 * Same contract as `core-vocabulary-refuses.ts`, `document-evidence-refuses.ts` and
 * `charge-collection-refuses.ts`: every `@ts-expect-error` must fire. If an illegal state ever
 * becomes legal, TypeScript reports the directive as unused (`TS2578`) and this file stops
 * compiling.
 *
 * **INVERTED at [A8 §9 item 1] (catalog 0.6.4), which is what this file was written to force.**
 * It used to hold [A9 §3.6]'s structural claim — _the best-witnessed identity scheme in the corpus
 * identifies a **party**, and [SD §1.2] has no party aggregate, so the assertion has no `subject`._
 * `party` **is** an aggregate kind now, so that directive went unused (`TS2578`) and the file
 * stopped compiling, exactly as designed. The two halves were then changed deliberately rather than
 * loosened, which is the house move ([A6 §9]):
 *
 * 1. **The discharged claim is now asserted positively**, below — `party` is an `AggregateKind`, so
 *    an `identity` assertion about a party has a `subject`. If a later round removed the member,
 *    this stops compiling from the other side.
 * 2. **A new refusal takes its place, and it is the one the round's own decision creates:** the
 *    party is a **bare subject**, so it is not a fact class. [A9 §3.6] needed only a `subject`, and
 *    minting a record type was measured to be unnecessary — every attribute [A8 §9 item 1] named is
 *    either an `identity` assertion or still owed to [A8 §9 item 3]. A round that mints a party
 *    record type inverts the directive below, and should answer that measurement rather than merely
 *    do the work.
 *
 * **What is NOT held here, and why.** [A9 §3.6] item 2's rule — that a SCAC must not be filed
 * against `partyRole`, because it "belongs to the company whatever it is doing on this shipment" —
 * **has no edge the types can see**: `partyRole` is a legal `AggregateKind` and `identity`'s family
 * is the whole enum, so filing it there typechecks and always did. It is a modelling rule, stated in
 * `ids.ts`'s two member docstrings, and [A6 §9]'s test says to say so rather than gate it badly.
 *
 * **The second refusal is held elsewhere and deliberately so**: that `identityScheme` is still owed
 * is `IdentitySchemeStaysOwed` in `src/rules/identity-schemes.ts`, an `Exact<>` with its assignment
 * beside it — [A5 §9]'s finding — re-declared there from [A9 §3.2]'s own reading rather than
 * generated from `identity.ts`, so it is not [A2 §9]'s tautology.
 *
 * A type-level suite: nothing here runs. The behavioural half is `identity-schemes.test.ts`, which
 * enumerates rather than counts ([A1 §9]).
 */
import type { AggregateKind } from '../../src/ids'
import type { AssertionType } from '../../src/vocabulary'

/* ------------------------------------------------------------------------------------------------
 * [SD §1.2] — the aggregate enum HAS a party, and the party has no fact class
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two legal kinds beside the party, so a tamper that empties the enum is caught too.
 * `partyRole` is the near miss worth keeping named: the enum carries a party-**role** as well as a
 * party, and [SD §1.1] "puts the role on the assertion rather than on the party". A SCAC is not a
 * fact about a role — it belongs to the company whatever it is doing on this shipment — so the
 * *nearest* legal subject is still the wrong one even now that the right one exists, which is the
 * trap a reader falls into. `document` is the other neighbour, and is here because [A9 §3.3]'s
 * table has four rows on it.
 */
const theRoleThatIsNotTheParty: AggregateKind = 'partyRole'
const theFormItself: AggregateKind = 'document'
void theRoleThatIsNotTheParty
void theFormItself

/**
 * [A9 §3.6]: five of [A9 §3.3]'s rows identify a party — `scac`, `usDotNumber`, `mcNumber`,
 * `gbloc` and `agentCode` — and **their blockers came off at [A8 §9 item 1]**, because the party is
 * a subject now. `loadIdentitySchemes` enforces the new state as it enforced the old one, and
 * `identity-schemes.test.ts` enumerates the five by name rather than counting them ([A1 §9]).
 *
 * Written as a named value rather than an annotated literal for `document-evidence-refuses.ts`'s
 * reason: `@ts-expect-error` covers **one** line, so the value is named first and the assignment is
 * what carries the directive.
 */
const thePartyFiveSchemesIdentify = 'party'

/**
 * **The deliverable, asserted so its removal fails here too.** `party` is an `AggregateKind`, which
 * is the whole mechanism [A9 §3.6] needed: [SD §7.1] says "`subject` may be **any** aggregate kind"
 * and `identity`'s canonical family is the enum itself, so this one member is what makes a SCAC
 * assertion expressible. No directive — it is meant to compile.
 */
const thePartyIsAnAggregate: AggregateKind = thePartyFiveSchemesIdentify
void thePartyIsAnAggregate

/**
 * **The new refusal: the party is a BARE subject.** [A8 §9 item 1] minted a subject and no fact
 * class, because every attribute it named is either an `identity` assertion ([SD §7.1]) or still
 * owed to [A8 §9 item 3] — the name and the branch grain, since `src:sirva-ade`'s `Resource.Name`
 * names a company, a person or a tractor. So `party` is an `aggregate` kind and **not** an
 * `AssertionType`, and a round that mints a party fact class inverts this.
 */
// @ts-expect-error [A8 §9 item 1] — `party` is a subject, not a fact class; no record type was minted.
const partyIsNotAFactClass: AssertionType = thePartyFiveSchemesIdentify
void partyIsNotAFactClass
