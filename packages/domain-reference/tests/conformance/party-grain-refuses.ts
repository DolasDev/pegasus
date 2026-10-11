/**
 * Conformance — the shapes [A8 §9 item 3]'s decision must keep illegal.
 *
 * Same contract as `identity-scheme-refuses.ts`, `role-class-refuses.ts`,
 * `core-vocabulary-refuses.ts`, `document-evidence-refuses.ts` and `charge-collection-refuses.ts`:
 * every `@ts-expect-error` must fire. If an illegal state ever becomes legal, TypeScript reports
 * the directive as unused (`TS2578`) and this file stops compiling.
 *
 * **The decision itself is held elsewhere and deliberately so**: that a party's grain is not a
 * field on the party is `AsserterGrainIsNotOnTheEnvelope` in `src/rules/authority.ts`, an `Exact<>`
 * with its assignment beside it ([A5 §9]), written in A8's own module against a shape `envelope.ts`
 * declares from [SD §1.1] rather than generated from it, so it is not [A2 §9]'s tautology.
 *
 * **What this file holds is the edge that type cannot see.** `AsserterGrainIsNotOnTheEnvelope`
 * watches the **field**; [A8 §9 item 3]'s second candidate shape was a second aggregate **kind**
 * (`party` and, say, `person`), and a new member of `AGGREGATE_KINDS` would leave `AssertedBy`
 * untouched. So half 1 below watches the kind, from the member rather than from the type.
 *
 * **It is not a claim that a natural person is not a party.** A person is a party here — `driver`
 * is _"the person driving"_ and `goodsOwner`'s signature is constitutive in `src:cfr-49-375`
 * (§375.503(c) and §375.401(h), both **mutual**). What is refused is a **second subject kind** for
 * them and a **field** saying which they are. (Role renamed from `customer` and the citation
 * corrected at [A8 §9 item 2], catalog `0.7.0`: this file said "four times" and two of the four
 * sections require no signature.) The day a round means to overturn that, these directives go unused and it is sent
 * to the two reasons in `AsserterGrainIsNotOnTheEnvelope`.
 *
 * A type-level suite: nothing here runs. The behavioural halves are `identity-schemes.test.ts`
 * (which grains the published schemes identify) and `data-tables.test.ts`.
 */
import type { AggregateKind } from '../../src/ids'
import { partyId } from '../../src/ids'
import type { AssertedBy } from '../../src/envelope'
import { subjectRef } from '../../src/envelope'

/* ------------------------------------------------------------------------------------------------
 * Half 1 — the person is not a second aggregate kind
 * ---------------------------------------------------------------------------------------------- */

/**
 * Written as a named value rather than an annotated literal for `identity-scheme-refuses.ts`'s
 * reason: `@ts-expect-error` covers **one** line, so the spelling is named first and the assignment
 * is what carries the directive.
 *
 * `person` and `organisation` are the two spellings [A8 §9 item 3]'s second candidate would have
 * added. `place` is **not** here on purpose: [SD §1.2] has no `place` kind either, but that one is
 * owed rather than refused (`custody.ts`'s `LegEndpoint`), and a directive here would send whoever
 * legitimately mints it to the wrong document.
 */
const thePersonSpelling = 'person'
const theOrganisationSpelling = 'organisation'

// @ts-expect-error [A8 §9 item 3] — the person is not a second aggregate kind. The grain rides on
// the role and on the scheme that identifies the party; see `AsserterGrainIsNotOnTheEnvelope`.
const personIsNotAKind: AggregateKind = thePersonSpelling
void personIsNotAKind

// @ts-expect-error [A8 §9 item 3] — and neither is the organisation. Splitting the subject in two
// would split every `PartyId` reference site, which is [A8 §9 item 1]'s owed brand, not this item's.
const organisationIsNotAKind: AggregateKind = theOrganisationSpelling
void organisationIsNotAKind

// @ts-expect-error [A8 §9 item 3] — the constructor refuses it too, which is the half a consumer
// hits: `subjectRef` is parameterised by the enum, so there is no subject to assert a person about.
const noPersonSubject = subjectRef('person', partyId('party:the-driver'))
void noPersonSubject

/* ------------------------------------------------------------------------------------------------
 * Half 2 — the asserter carries no class, under any of the spellings it would arrive under
 * ---------------------------------------------------------------------------------------------- */

/**
 * The three spellings the field would arrive under, each refused by [SD §1.1]'s excess-property
 * check over the shape `AsserterGrainIsNotOnTheEnvelope` pins. Three rather than one because the
 * gate in `authority.ts` fails on **any** widening while these say what widening was attempted, and
 * a refusal a reader cannot name is a refusal they will re-attempt.
 */
const theParty = partyId('party:the-hauler')

// @ts-expect-error [A8 §9 item 3] — element 98 names the four grains in its definition and
// publishes no class column; a `partyClass` here would be the missing axis, cut by us ([SD §0]).
const noPartyClass: AssertedBy = { party: theParty, role: 'driver', partyClass: 'individual' }
void noPartyClass

// @ts-expect-error [A8 §9 item 3] — `src:sirva-ade`'s `Owner ∈ Corporate | Agent | Vendor` is an
// affiliation class whose three values are all organisations, so it is not this axis either.
const noPartyKind: AssertedBy = { party: theParty, role: 'driver', partyKind: 'person' }
void noPartyKind

// @ts-expect-error [A8 §9 item 3] — nor the boolean form. `src:cfr-49-375` § 375.103 is the only
// source that defines party classes and its axis is who owns the goods and who pays, not what the
// party is; `Individual shipper` is a function, not a kind.
const noIsIndividual: AssertedBy = { party: theParty, role: 'driver', isIndividual: true }
void noIsIndividual
