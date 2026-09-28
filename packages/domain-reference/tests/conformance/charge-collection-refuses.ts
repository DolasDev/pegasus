/**
 * Conformance — the shapes [A7 §3.2]'s refusal must keep illegal.
 *
 * Same contract as `core-vocabulary-refuses.ts` and `document-evidence-refuses.ts`: every
 * `@ts-expect-error` must fire. If an illegal state ever becomes legal, TypeScript reports the
 * directive as unused (`TS2578`) and this file stops compiling.
 *
 * **What it holds is [A7 §3.2]'s central claim**, which is not a claim about a vocabulary member
 * but about the layer above it: _no act on a charge has a record, and the blocker is that the
 * **subject** does not exist._ [SD §1.2]'s fourteen aggregate kinds contain no `invoice` and no
 * `payment`, and `chargeCollection` is recorded absent rather than minted. Each of those three is an
 * edge the type system can see, which is [A6 §9]'s test for whether a recorded gap earns a gate.
 *
 * **The fourth refusal is held elsewhere and deliberately so**: that a payment is not a fourth
 * `{aspect}` value is `ChargeAspectsAreTheThree` in `src/rules/charges.ts`, an `Exact<>` with its
 * assignment beside it — [A5 §9]'s finding — and it is re-declared there from A7's own reading of
 * [SD §4.7.2b] rather than generated from `vocabulary.ts`, so it is not [A2 §9]'s tautology.
 *
 * A type-level suite: nothing here runs. The behavioural half is `charges.test.ts`, which
 * enumerates rather than counts ([A1 §9]).
 */
import type { AggregateKind } from '../../src/ids'
import type { AssertionType } from '../../src/vocabulary'
import { ABSENT_AND_OWED } from '../../src/vocabulary'

/* ------------------------------------------------------------------------------------------------
 * [SD §1.2] — the aggregate enum has no invoice and no payment
 * ---------------------------------------------------------------------------------------------- */

/**
 * Two legal kinds either side of the refusal, so a tamper that empties the enum is caught too.
 * `charge` is the one A7 is about; `stay` is [A5]'s, and is here because `charge`'s `context[]`
 * carries it.
 */
const theChargeItself: AggregateKind = 'charge'
const theStayAChargeMayBeScopedTo: AggregateKind = 'stay'
void theChargeItself
void theStayAChargeMayBeScopedTo

/**
 * [A7 §3.2]: seven publishers group charges into an invoice and **no two group the same things** —
 * `src:milmove-mymove` a mover-chosen subset of service items, `src:alvys-api` four invoice
 * **types**, `src:sirva-ade` an abstract per shipment aggregated into a per-half-month statement,
 * `src:dp3-400ng` the BL, `src:cfr-49-375` one invoice per delivery. Two of the seven group
 * **across shipments**, which no aggregate in [SD §1.2] can be a subject of. The grain disagreement
 * is the sourced reason not to mint, and it is a better reason than absence would have been.
 *
 * Written as a named value rather than an annotated literal for `document-evidence-refuses.ts`'s
 * reason: `@ts-expect-error` covers **one** line.
 */
const theInvoiceSevenPublishersDisagreeAbout = 'invoice'

// @ts-expect-error [A7 §3.2] — [SD §1.2] declares no `invoice` aggregate, and the grain is not settled.
const invoiceIsNotAnAggregate: AggregateKind = theInvoiceSevenPublishersDisagreeAbout
void invoiceIsNotAnAggregate

/**
 * [A7 §3.2]: a payment does not collapse into `aspect = DECIDED`. It names a **counterparty** the
 * charge does not (`src:nmfta-ebol`'s `billTo` with its own account number, under `payment.terms` ∈
 * Prepaid | Collect | Third Party the payer is neither shipper nor carrier), an **instrument** the
 * charge does not (`src:dtr-part-iv`'s DD 139 versus DD 1131, by pay status), and a **reversal link
 * to another payment** (`src:smartmoving-api`'s `refundsJobPaymentId`).
 */
const thePaymentThatIsNotAnAspect = 'payment'

// @ts-expect-error [A7 §3.2] — [SD §1.2] declares no `payment` aggregate.
const paymentIsNotAnAggregate: AggregateKind = thePaymentThatIsNotAnAspect
void paymentIsNotAnAggregate

/* ------------------------------------------------------------------------------------------------
 * [SD §4.7.1] — and the act itself is recorded absent, not minted
 * ---------------------------------------------------------------------------------------------- */

/**
 * `chargeCollection` is in `ABSENT_AND_OWED` and **not** in the published record vocabulary. The
 * assertion below is the pair that says so: it is a member of the first list, and assigning it to
 * `AssertionType` must not compile.
 *
 * If someone mints it, the directive goes unused and this file stops compiling — which is the point,
 * because a mint is a two-file change plus a test-table entry ([SD §4.7.3], the `AS_WRITTEN` table)
 * and whoever makes it should be sent to [A7 §3.2] to read why the subject is the blocker.
 */
const theAbsentAct = 'chargeCollection'
const itIsOnTheAbsentList: boolean = (ABSENT_AND_OWED as readonly string[]).includes(theAbsentAct)
void itIsOnTheAbsentList

// @ts-expect-error [A7 §3.2] — `chargeCollection` is absent and owed, not a published `type`.
const chargeCollectionIsNotAType: AssertionType = theAbsentAct
void chargeCollectionIsNotAType
