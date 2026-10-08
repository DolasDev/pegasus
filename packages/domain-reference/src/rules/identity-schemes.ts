/**
 * A9 — identity & cross-references. One rule, one refusal held by the compiler, one table.
 *
 * A9 is the last of the nine v1 areas to be written and the only one whose own subject was already
 * on the model's owed list when it opened: `identityScheme` is one of the three owed closed
 * vocabularies, it is A9's, and [A6 §3.2(a)] had already specified one bit each of its members must
 * carry. So A9 did not have to argue that it owns something. It had to decide whether it can
 * **publish** it, and the answer is no.
 *
 * **[A9 §3.2] refuses to close `identityScheme`, and the refusal is argued from what the corpus
 * publishes rather than from what it omits.** Five sources ship a closed, typed identifier list and
 * **every one of them ships an open slot beside it** — `src:project44`'s `EXTERNAL` /
 * `REFERENCE_NUMBER` / `CUSTOMER_REFERENCE`, `src:nmfta-ebol`'s `additionalReferences[] {name,
 * value}`, X12's `ZZ` _Mutually Defined_ (`src:x12-858-implementation-guide`,
 * `src:stedi-x12-reference`'s `L11` at a header max use of 300), `src:open-trip-model`'s
 * `externalAttributes`, and `src:samsara`'s unbounded `externalIds` map. **Two of the five publish
 * a warning against their own hatch** — OTM's _"Please, use this with caution: having too many
 * external attributes can be a sign of not using OpenTripModel as it was intended"_, and
 * `src:project44`'s analysis calling its escape hatch _"the same gravity well as OTM's
 * `externalAttributes`"_. A closed-versus-open choice is a dichotomy the corpus has already
 * refused, and an enum that admitted only the schemes we can cite would be **less** faithful to the
 * sources than the `OwedCode` the model already ships.
 *
 * So `SchemeName` stays `OwedCode<'identityScheme'>` and {@link IdentitySchemeStaysOwed} is the
 * gate that says so. What A9 publishes instead is [A9 §3.3]'s **witnessed-scheme table**
 * (`data/identity-schemes.json`) and one rule over it, **I-ACCOUNT**, which supplies D-ID's missing
 * input for the schemes the corpus witnesses and declines to for the rest.
 *
 * **Deliberately not here.** [SD §7.1]'s identifier shape, **I-KEY**, the `issuer` / `authority`
 * split, the effective interval, `primary`-by-resolution and canonicalise-to-match are all settled
 * text and are A9's floor, not its question — [A9 §3.1]. `src:dcsa`'s three slots and
 * `src:project44`'s 70-value list are what `round-1-crosscheck.md` §A9 told phase 3 to pick between,
 * and [SD §7.1] picked before A9 opened; A9 supplies the **terms**, never the shape. And [A6 §3.2]'s
 * **D-ID** decides which subject an identifier found on a document attaches to: A9 supplies its
 * input and does not re-answer its question.
 */

import type { Exact, OwedCode } from '../primitives'
import type { IdentityScheme, IdentitySchemeTable } from '../data'
import type { SchemeName } from '../identity'
import type { SchemeAccountability } from './documents'

/* ------------------------------------------------------------------------------------------------
 * I-ACCOUNT — the one bit A6 asked for, as a partial function
 * ---------------------------------------------------------------------------------------------- */

/**
 * What I-ACCOUNT returns. The third branch is the whole reason the rule exists rather than a lookup
 * returning `boolean`, and the two `undetermined` reasons are why it is not simply A6's
 * {@link SchemeAccountability} — see {@link schemeAccountability}.
 */
export type SchemeAccountabilityVerdict =
  | { readonly kind: 'determined'; readonly documentAccountable: boolean }
  | { readonly kind: 'undetermined'; readonly reason: UndeterminedReason }

/** Why I-ACCOUNT declined, and the two reasons are not the same statement. */
export type UndeterminedReason =
  /** The scheme is outside [A9 §3.3]'s table — the ordinary case, and [A9 §3.2]'s consequence. */
  | 'SCHEME_NOT_WITNESSED'
  /** The scheme is in the table and the corpus does not settle the bit — one row, and it is named. */
  | 'SCHEME_WITNESSED_BIT_NOT_PUBLISHED'

/**
 * Rule **I-ACCOUNT**, [A9 §3.4]:
 *
 * > "Whether a scheme is document-accountable is a property of the scheme, and A9 answers it for the
 * > schemes the external corpus witnesses and for no others. The answer is a **partial function**,
 * > never a default."
 *
 * [A6 §3.2(a)] states the requirement exactly: `documentIdentitySubject` — **D-ID** — takes the
 * discriminant as a parameter and returns `undetermined` when it is unknown, "which is exactly
 * **B-ONWARD**'s shape ([A2 §3.2]) and for the same reason: the rule is decidable, its input is not
 * published, and a default would be a guess in the one place [SD §0] forbids one." A9's contribution
 * is to make the input **available** for the schemes it can cite, which narrows how often D-ID
 * returns `undetermined` without weakening why it does.
 *
 * **Three things this rule is not.**
 *
 * 1. **It is not a vocabulary.** A scheme absent from the table gets `SCHEME_NOT_WITNESSED`, which
 *    is a statement about the corpus and not about the scheme's legality. [A9 §3.2] refuses
 *    closure; a rule that treated absence as a verdict would smuggle the closure back in through
 *    the rule.
 * 2. **It does not re-answer D-ID.** D-ID chooses a **subject**; I-ACCOUNT supplies the bit D-ID
 *    chooses on. Composing them is the caller's business, and [A9 §3.4] keeps them apart because
 *    the two questions have different owners: A6 owns the difference between a document's own fact
 *    and a fact it carries, A9 owns the scheme list.
 * 3. **It says nothing about whether the assertion can be made.** The five rows that identify a
 *    **party** used to have no `subject` at all ([A9 §3.6]) and still answered
 *    `documentAccountable: false` here, correctly and uselessly; [A8 §9 item 1] gave them one at
 *    catalog 0.6.4. {@link schemeBlocker} is still the separate question and keeping them separate
 *    is still deliberate: a scheme can be perfectly determined and still be unassertable, and the
 *    next such row is likelier than not.
 *
 * The two `undetermined` reasons are kept distinct because they fail for opposite causes. A scheme
 * the corpus never names is the ordinary path. A scheme the corpus names and leaves open is a
 * **finding**, and there is exactly one — `shipmentConfirmationNumber`, `src:nmfta-ebol`'s
 * acceptance identifier, which [A6 §Cross-area] to [A9] calls "the model case of a scheme over the
 * lodging rather than over the document". Its bit is unsettled because the subject the source names
 * is an **act** of accepting, and [SD §1.2] has no aggregate for one.
 */
export function schemeAccountability(
  table: IdentitySchemeTable,
  scheme: SchemeName,
): SchemeAccountabilityVerdict {
  const row = table.rows.get(scheme)
  if (row === undefined) return { kind: 'undetermined', reason: 'SCHEME_NOT_WITNESSED' }
  if (row.documentAccountable === 'undetermined') {
    return { kind: 'undetermined', reason: 'SCHEME_WITNESSED_BIT_NOT_PUBLISHED' }
  }
  return { kind: 'determined', documentAccountable: row.documentAccountable }
}

/**
 * I-ACCOUNT's answer in the shape **D-ID** takes it — [A9 §Cross-area] to [A6].
 *
 * A6's {@link SchemeAccountability} is `boolean | undefined`, and its docstring says what the third
 * value means: _"`undefined` is not 'no' — it is 'A9 has not said'."_ This function is A9 saying,
 * for the schemes it can cite, and it deliberately **collapses** the two `undetermined` reasons
 * {@link schemeAccountability} keeps apart, because D-ID does not distinguish them and should not
 * be made to: from D-ID's chair a scheme nobody witnesses and a scheme whose bit nobody settles are
 * the same unanswered question, and its single `SCHEME_ACCOUNTABILITY_NOT_PUBLISHED` reason is
 * still exactly right for both.
 *
 * **What this does not do is change D-ID.** [A6 §3.2(a)] is untouched, `documentIdentitySubject`
 * keeps its three-valued parameter, and its `undetermined` branch stays reachable — [A9 §3.2]
 * guarantees it stays reachable **forever**, because a scheme outside the table is always possible
 * while `identityScheme` is open. A9 narrows how often the branch is taken and removes no branch.
 */
export function schemeAccountabilityForDId(
  table: IdentitySchemeTable,
  scheme: SchemeName,
): SchemeAccountability {
  const verdict = schemeAccountability(table, scheme)
  return verdict.kind === 'determined' ? verdict.documentAccountable : undefined
}

/**
 * The separate question I-ACCOUNT deliberately does not fold in: can an assertion under this scheme
 * be made at all?
 *
 * Returns the blocker's text where there is one, `null` where the scheme's subject exists.
 *
 * **[A9 §3.6] is DISCHARGED, and this function now returns `null` for every row** — [A8 §9 item 1]
 * minted the `party` aggregate at catalog 0.6.4. The finding it exposed was that the corpus's
 * best-witnessed scheme identified the one thing [SD §1.2] had no aggregate for: six witness rows
 * carry a SCAC and they are four publishing bodies — the DoD twice (`src:dtr-part-iv`,
 * `src:dp3-400ng`), X12 twice (`src:stedi-x12-reference`, `src:x12-212-trailer-manifest`), NMFTA
 * and project44 — and not one of those statements was expressible. All five party-grain rows
 * (`scac`, `usDotNumber`, `mcNumber`, `gbloc`, `agentCode`) now assert against a `party` subject.
 *
 * **A9 minted nothing for this, and that was the decision rather than the omission — unchanged by
 * the discharge.** [A7 §3.2] is the precedent in shape — a question that never reaches
 * [A8 §9 item 8]'s ledger because the subject is missing — and the difference was that A7's missing
 * subject was nobody's while this one was already owed by name. Recording it as A9's own owed item
 * would have double-counted a single gap, which is what [A7 §6] warns about one level down: an owed
 * inventory is a set of claims like any other. **The round that closed it closed [A8 §9 item 1],
 * which is the item A9 named** — so the arrangement is what made the discharge a one-line change
 * rather than a reconciliation of two ledgers.
 *
 * **The function stays, and that is deliberate rather than tidiness deferred.** [A9 §3.2] refuses
 * to close `identityScheme`, so the table keeps growing from the corpus, and a later row may name a
 * subject the model does not have — `placeRef` is the standing candidate ([SD §1.2] has no `place`
 * aggregate, `custody.ts`'s own TODO). The question "can an assertion under this scheme be made at
 * all?" is not answered by this round; it is answered `yes` for every row this round can see.
 * {@link loadIdentitySchemes} holds the discharge as an invariant: no row may name [A8 §9 item 1].
 */
export function schemeBlocker(table: IdentitySchemeTable, scheme: SchemeName): string | null {
  return table.rows.get(scheme)?.blocker ?? null
}

/**
 * The rows whose subject is a party, in table order — [A9 §3.6]'s set.
 *
 * Still five and still named, but no longer the blocked set: since [A8 §9 item 1] these are simply
 * the rows whose `identifies` is `party`, like the four whose `identifies` is `document`.
 */
export function partyGrainSchemes(table: IdentitySchemeTable): readonly IdentityScheme[] {
  return [...table.rows.values()].filter((row) => row.identifies === 'party')
}

/* ------------------------------------------------------------------------------------------------
 * The gate — `identityScheme` is still owed, and stays owed
 * ---------------------------------------------------------------------------------------------- */

/**
 * The gate behind [A9 §3.2]'s refusal, and the next case along from [A5 §9], [A2 §9], [A6 §9] and
 * [A7 §9].
 *
 * [A5 §9]: a bare `Exact<>` alias is a comment until something is assigned to it. [A2 §9]: an
 * assigned one can still be a **tautology**, because `Exact<keyof typeof T, K>` over a mapped type
 * can never fail — "an `Exact` earns its place only between two things declared **independently**."
 * [A7 §9] adds the sharpest instance of that: a `satisfies` clause checks membership and **not**
 * exhaustiveness, so a data table that `satisfies` a type built from the thing under test is not a
 * second independent declaration.
 *
 * This one clears both bars. `SchemeName` is declared in `identity.ts`, from [SD §7.1]; the
 * right-hand side is written out **here**, in A9's own module, from [A9 §3.2]'s own reading. Nothing
 * generates either from the other, and `data/identity-schemes.json` — which is where a reader might
 * expect the closure to live — is deliberately **not** in the comparison, because the table is a
 * catalogue of witnesses and not a vocabulary.
 *
 * **The edge the type system can see is a publication.** The day a round narrows `SchemeName` from
 * `OwedCode<'identityScheme'>` to a union of published members, this evaluates to `never`, the
 * assignment below stops compiling, and whoever narrowed it is sent to [A9 §3.2] to answer its
 * argument — which is not "nobody has done the work" but "five publishers ship an escape hatch and
 * two of them warn about it." That is a claim a later round may overturn on new evidence; what the
 * gate forbids is overturning it silently.
 *
 * **What it does not hold.** It does not hold I-ACCOUNT, it does not hold [A9 §3.6]'s party-grain
 * finding — `identity-scheme-refuses.ts` holds that one — and it says nothing about the table's
 * contents. It holds one sentence: `identityScheme` is still owed.
 */
export type IdentitySchemeStaysOwed = Exact<SchemeName, OwedCode<'identityScheme'>>

/**
 * The assignment that makes {@link IdentitySchemeStaysOwed} a gate rather than an alias — [A5 §9]'s
 * finding, applied for the fifth time.
 */
const _identitySchemeStaysOwed: IdentitySchemeStaysOwed = true
void _identitySchemeStaysOwed

/* ------------------------------------------------------------------------------------------------
 * The recorded gap with no edge the types can see
 * ---------------------------------------------------------------------------------------------- */

/**
 * [A9 §3.5]: **a correlation between two identifiers is not a link, and the corpus states it as an
 * obligation rather than as a structure.**
 *
 * The model already carries the answer and [SD §7.5] already states it: two identifiers of the same
 * subject are two assertions under two schemes, `primary` resolves per I-KEY tuple so there is no
 * contest between them, and a canonical match "is an Assertion with a resolvable verdict, never a
 * truth." What A9 adds is that the corpus never publishes a correlation as a **field**: it
 * publishes an **obligation to echo** (`src:dcsa`'s references shared back on track-and-trace),
 * an obligation to **print** (`src:dtr-part-iv`'s NTS lot number and service order number into the
 * BL's block 19; consolidated BLs listing sibling BL numbers in block 27), and an obligation to
 * **annotate** (`src:dp3-tender-of-service`'s seal numbers cross-referencing the container number).
 * Three regimes, three obligations, no link.
 *
 * The one case where a correlation crosses aggregates is [A5 §Cross-area]'s and A5 already declined
 * to model it: `src:weichert-supplier-api` carries `ltsRequestNumber` with `hhgRequestNumber` as a
 * **back-reference**, correlating two orders across the permanent-storage boundary [A5 §3.4(c)]
 * excludes. A9 does not reopen it. Under [SD §7.1] the back-reference is an identity assertion whose
 * subject is one order and whose scheme is the other programme's — which is expressible today and
 * carries no claim that the two orders are one thing.
 *
 * **A plain `= true`, on [A6 §9]'s distinction and not on a copy of its pattern.** The rule is
 * "gate a recorded gap when the gap has an edge the types can see, and say why when it does not."
 * This claim has no edge: it becomes false only if a later round adds a correlation FIELD, and
 * adding one touches [SD §7], the envelope and the emitted schemas — nothing in this module moves.
 * {@link IdentitySchemeStaysOwed} immediately above is the contrasting case, and the two shipping
 * side by side is the point.
 */
export const CORRELATION_IS_AN_OBLIGATION_NOT_A_LINK = true
