/**
 * Conformance — the shapes [A9 §3.6]'s finding must keep illegal.
 *
 * Same contract as `core-vocabulary-refuses.ts`, `document-evidence-refuses.ts` and
 * `charge-collection-refuses.ts`: every `@ts-expect-error` must fire. If an illegal state ever
 * becomes legal, TypeScript reports the directive as unused (`TS2578`) and this file stops
 * compiling.
 *
 * **What it holds is [A9 §3.6]'s structural claim**, and like [A7 §3.2]'s it is a claim about the
 * layer above the vocabulary rather than about a member of one: _the best-witnessed identity scheme
 * in the corpus identifies a **party**, and [SD §1.2] has no party aggregate, so the assertion has
 * no `subject`._ Six witness rows carry a SCAC, from four publishing bodies; `ids.ts` already records that
 * `PartyId` "is an identifier with no aggregate behind it"; and [A8 §9 item 1] already owes the
 * party entity and already names "DOT/MC number, SCAC (`src:dtr-part-iv` #665), agent code" among
 * its fields.
 *
 * **The difference from A7's file, and it is the reason A9 mints nothing.** A7's `invoice` and
 * `payment` were nobody's: no area owed them, so [A7 §3.2] had to argue from the grain
 * disagreement why minting was wrong. A9's missing subject is **already owed by name**, so the only
 * thing to hold is that it has not quietly arrived. `ids.ts`'s own `TODO(A8 §9 item 1)` asks
 * whether the party becomes a fifteenth aggregate kind or stays outside the subject enum — this
 * file makes the day it becomes one a compile failure, which sends whoever does it to
 * `data/identity-schemes.json`'s five party-grain rows to take their blockers off.
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

/* ------------------------------------------------------------------------------------------------
 * [SD §1.2] — the aggregate enum has no party
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two legal kinds either side of the refusal, so a tamper that empties the enum is caught too.
 * `partyRole` is the near miss that makes the refusal worth stating: the enum **does** carry a
 * party-**role**, and [SD §1.1] "puts the role on the assertion rather than on the party". A SCAC
 * is not a fact about a role — it belongs to the company whatever it is doing on this shipment —
 * so the nearest legal subject is the wrong one, which is exactly the trap a reader falls into.
 * `document` is the other neighbour, and is here because [A9 §3.3]'s table has four rows on it.
 */
const theRoleThatIsNotTheParty: AggregateKind = 'partyRole'
const theFormItself: AggregateKind = 'document'
void theRoleThatIsNotTheParty
void theFormItself

/**
 * [A9 §3.6]: five of [A9 §3.3]'s rows identify a party — `scac`, `usDotNumber`, `mcNumber`,
 * `gbloc` and `agentCode` — and every one of them carries [A8 §9 item 1] as its blocker, enforced
 * at load by `loadIdentitySchemes`. The scheme with the widest publisher base in the whole table is
 * among them. Both counts are gated in `identity-schemes.test.ts`, which enumerates the five by
 * name rather than counting them ([A1 §9]).
 *
 * Written as a named value rather than an annotated literal for `document-evidence-refuses.ts`'s
 * reason: `@ts-expect-error` covers **one** line, so the value is named first and the assignment is
 * what carries the directive.
 */
const thePartyFiveSchemesIdentify = 'party'

// @ts-expect-error [A9 §3.6] — [SD §1.2] declares no `party` aggregate; [A8 §9 item 1] owes it.
const partyIsNotAnAggregate: AggregateKind = thePartyFiveSchemesIdentify
void partyIsNotAnAggregate
