/**
 * A7 — charges & billing hooks. One rule, one recorded gap, one gate.
 *
 * The area's structural finding is [A7 §3.2], and it is [A2 §3.6]'s check in a third aggregate with
 * a third answer. `charge` is better provisioned than either of its predecessors: it is a declared
 * `type` with a declared qualifier, a six-member `context[]` and an **assigned** authority row
 * ([A8 §5] row 11). What it does not have is any record of an act performed **on** a charge —
 * nothing says a charge was billed, collected, paid, disputed, denied or set off — and the reason
 * sits one level above the record vocabulary: [SD §1.2]'s fourteen aggregate kinds contain no
 * `invoice` and no `payment`. So unlike A2's gap and A6's gap, **the subject is missing too**, and
 * the question never reaches [A8 §9 item 8]'s ledger.
 *
 * Nothing here mints a vocabulary member. One thing is refused outright ([A7 §3.3]: a charge- or
 * invoice-state vocabulary, and the `chargeStateAt` projection that would follow it), one is
 * recorded as absent and owed (`chargeCollection`, in `vocabulary.ts`), one rule is named
 * ({@link COLLECTABILITY_IS_A_RULE_OVER_PAIRS}, which is [A6 §3.5]'s **D-CITE** generalised past
 * documents), and one refusal is held by the compiler ({@link ChargeAspectsAreTheThree}).
 *
 * **Deliberately not here.** The correction regime over a charge is [SD §6.3]'s and is already held
 * in the type — `CorrectableType = Exclude<AssertionType, FinancialFactClass>` in `corrections.ts`,
 * with its refusal gated and tampered at `tests/conformance/authority-custody-corrections-refuses.ts`.
 * [A7 §3.8] measures that door against the four money corrections the corpus names; it does not
 * rehang it.
 */

import type { Exact } from '../primitives'
import type { AggregateKind } from '../ids'
import type { QualifierByType } from '../vocabulary'

/* ------------------------------------------------------------------------------------------------
 * A-COLLECT — collectability is a rule over pairs
 * ---------------------------------------------------------------------------------------------- */

/**
 * Rule **A-COLLECT**, [A7 §3.7]:
 *
 * > "A charge's collectability is determined by a rule naming a **(charge, gating fact)** pair. It
 * > is not a property of the charge assertion, it is not an `{aspect}` value, and it is not carried
 * > in `evidence[]`."
 *
 * [A6 §3.5]'s **D-CITE** scopes evidentiary standing to a _(document kind, fact class)_ pair and
 * hands A7 the rule that stands behind its own third source — `src:cfr-49-375` §375.519(d),
 * **primary**: true copies of all weight tickets must accompany a freight bill _"in order to
 * collect any shipment charges dependent upon the weight transported."_ A7 inherits the pair and
 * finds it is not a document pair: of the seven collection preconditions the corpus publishes, four
 * gate on something that is not a document at all — a notification, a weight assertion, the
 * shipment's own outcome, a moment. {@link COLLECTION_PRECONDITION_SUBJECTS} carries the kinds.
 *
 * **Three consequences**, and the third is why the rule is stated rather than assumed:
 *
 * 1. It generalises D-CITE past documents: the gating fact's aggregate kind **varies**.
 * 2. It keeps [A7 §3.3]'s refusal honest. The tempting way to model "denied for want of a
 *    notification" is a charge **state** — refused there, because eleven publishers cannot agree on
 *    one. Under A-COLLECT the denial is not a state the charge enters; it is the outcome of
 *    evaluating a rule whose other operand is elsewhere.
 * 3. It does not say what the rules are, and says so. **Four** of the seven are DoD programme rules
 *    and `src:dp3-400ng`'s own analysis warns against promoting programme rules into the core model;
 *    the **three** `src:cfr-49-375` rows are federal law. And the publisher count is smaller than
 *    the row count suggests: three sources, of which `src:dp3-tender-of-service` and
 *    `src:dp3-400ng` are the **same programme**, so the genuinely independent count is **two**.
 *    `charges.test.ts` gates both counts rather than leaving them in prose ([A1 §9]).
 *
 * **[ORIGINAL]**, and it is the round's one original step: seven publishers state preconditions and
 * none states that collectability is therefore a rule over pairs rather than a property of the
 * charge. It is the same step [A6 §3.5] took from _"citation does not confer standing"_ to
 * _"citation claims nothing"_, and [A7 §7] records it as an assertion no source supports.
 *
 * **Refused beside it** ([A7 §3.7]): a `collectable` boolean on the charge, which would be a mutable
 * current-state field on the envelope and is what [SD §1.1] forbids `in-transit` for; and reading
 * collectability off `evidence[]`, which is precisely what D-CITE refuses.
 */
export const COLLECTABILITY_IS_A_RULE_OVER_PAIRS = true

/**
 * The aggregate kinds a collection precondition's **gating fact** is about, read off
 * `data/collection-preconditions.json`'s rows and declared here so the claim in
 * {@link COLLECTABILITY_IS_A_RULE_OVER_PAIRS} — that the kind _varies_ — is checkable rather than
 * asserted.
 *
 * `document` is §375.519(d)'s weight tickets and `src:dp3-tender-of-service` §C.12's package.
 * `shipment` covers three unlike cases and that is the point: an **outcome** (§375.709, total loss
 * ⇒ no freight charges at all), a **moment** (§375.401(f), accessorials determined before the bill
 * of lading), a **weight assertion's existence** (`src:dp3-400ng` Item 4.11.c, no invoicing until
 * the reweigh is recorded) and a **notification** (§C.3.h's SIT denial — `shipment` because
 * [SD §4.7.3] gives `notification` the canonical subject family `goods`, the duty being stated per
 * shipment; **not** `stay`, because what the rule tests is whether the notice was given and not
 * anything about the storage that followed).
 *
 * **Not a closed vocabulary and not published.** These are the kinds the seven sourced rows
 * happen to name; [A7 §3.7] is explicit that the list of rules is neither complete nor generalised
 * beyond the programs that publish it.
 */
export const COLLECTION_PRECONDITION_SUBJECTS = [
  'document',
  'shipment',
] as const satisfies readonly AggregateKind[]

export type CollectionPreconditionSubject = (typeof COLLECTION_PRECONDITION_SUBJECTS)[number]

/* ------------------------------------------------------------------------------------------------
 * The state refusal, and why it is a constant rather than a gate
 * ---------------------------------------------------------------------------------------------- */

/**
 * [A7 §3.3]: **no charge-state or invoice-state vocabulary is published, and no `chargeStateAt`
 * projection is written.**
 *
 * This is [A2 §3.3]'s facet refusal for the third time and the best-evidenced of the three, because
 * here the publishers disagree about the **grain** as well as about the values. Eleven positions,
 * no two alike: `src:milmove-mymove` runs six states at _payment-request_ grain;
 * `src:alvys-api` runs three at _invoice_ grain and separately fuses five financial values into a
 * sixteen-value _load_ ladder; `src:sirva-ade` has a **flag** (`ThruAcctCompleted`) and describes
 * rated → abstract → statement as prose; `src:atlas-world-group-api` has **three untyped status
 * fields** for the one question; `src:dp3-400ng`'s own analysis records that billed / disputed /
 * denied / re-billed / refunded are _"referenced but never enumerated"_; `src:smartmoving-api` has
 * a boolean and a nullable date; `src:cfr-49-375` has no invoice state at all but a **credit**
 * ladder; `src:uncefact-scrdm` publishes four **dates** instead of states; and
 * `src:uncefact-mmt-rdm` and `src:weichert-supplier-api` have nothing.
 *
 * **The projection is the worse temptation, not the safer one**, and it fails twice:
 *
 * - **It has no inputs.** A fold folds assertions, and no assertion records a charge being billed,
 *   collected or paid — that is `chargeCollection`'s absence. Quantifying over the empty set is
 *   [`fork-order` §5.2]'s **B-STAGE** a third time, after [A2 §3.6]'s shipment stage and
 *   [A6 §3.4(a)]'s `documentStateAt`.
 * - **It would fuse two axes the corpus warns about by name.** `src:alvys-api`'s own analysis:
 *   _"a load that is `Delivered` and a load that is `Paid` differ in which lifecycle moved."_ [A1]
 *   kept them apart without being asked — `ORDER_STAGES` is five members and not one of them is
 *   financial.
 *
 * **A plain `= true`, and the reason is [A6 §9]'s distinction rather than a copy of its pattern.**
 * Compare {@link ChargeAspectsAreTheThree} immediately below, which **is** a gate. The rule is not
 * "always gate a recorded gap"; it is _"gate it when the gap has an edge the types can see, and say
 * why when it does not."_ This claim's edge is a **mint**: it becomes false only when a fact class
 * is minted, and a mint already touches `vocabulary.ts`, [SD §4.7.3], the `AS_WRITTEN` table and a
 * canonical-subjects row. Nothing in the type system moves when that happens, so a typed assertion
 * here would be a decoration.
 */
export const CHARGE_STATE_IS_NOT_COMPUTABLE = true

/* ------------------------------------------------------------------------------------------------
 * The gate — a payment is not a fourth aspect
 * ---------------------------------------------------------------------------------------------- */

/**
 * The gate behind [A7 §3.2]'s refusal to mint a fourth `{aspect}` member, and the next case along
 * from [A5 §9], [A2 §9] and [A6 §9].
 *
 * [A5 §9]: a bare `Exact<>` alias is a comment until something is assigned to it. [A2 §9]: an
 * assigned one can still be a **tautology**, because `Exact<keyof typeof T, K>` over a mapped type
 * can never fail — _"an `Exact` earns its place only between two things declared **independently**."_
 * [A6 §9] shipped the positive case and stated the generalisation.
 *
 * This claim has an edge the type system can see. **"A payment is not a fourth `{aspect}` value"**
 * is false the moment `QualifierByType['charge']['aspect']` gains a member. So the three names are
 * written out **here**, in A7's own module, from A7's own reading of [SD §4.7.2b] — nothing
 * generates them from `vocabulary.ts`, nothing generates `QualifierByType` from them, and
 * `data.ts`'s `QUALIFIER_VALUES` only `satisfies` a type built from `QualifierByType`, which checks
 * membership and not exhaustiveness. A fourth member makes this `never`, the assignment below stops
 * compiling, and whoever added it is sent to [A7 §3.2].
 *
 * **What the gate holds is exactly that claim and nothing wider.** It does not hold A-COLLECT, and
 * it does not hold [A7 §3.3]'s state refusal. [A7 §3.2] gives three reasons a payment cannot be an
 * aspect, and all three are about what the value would have to carry that [SD §4.7.2b]'s _"an
 * amount, an approval and a price"_ does not admit: a **counterparty** the charge does not name
 * (`src:nmfta-ebol`'s `billTo` with its own account number, and `payment.terms` ∈ Prepaid | Collect
 * | Third Party, under which the payer is neither the shipper nor the carrier); an **instrument**
 * the charge does not name (`src:dtr-part-iv`'s DD 139 versus DD 1131, chosen by pay status; and
 * `src:cfr-49-375` §375.407's tender of payment as an act with its own moment); and a **reversal
 * link to another payment** (`src:smartmoving-api`'s `refundsJobPaymentId` / `isRefund` /
 * `amountRefunded`, which sit on the payment while its charge-side link points the other way).
 */
export type ChargeAspectsAreTheThree = Exact<
  QualifierByType['charge']['aspect'],
  'PROPOSED' | 'DECIDED' | 'RATED'
>

/**
 * The assignment that makes {@link ChargeAspectsAreTheThree} a gate rather than an alias — [A5 §9]'s
 * finding, applied. Without it the type may evaluate to `never` and nothing says so.
 */
const _chargeAspectsAreTheThree: ChargeAspectsAreTheThree = true
void _chargeAspectsAreTheThree
