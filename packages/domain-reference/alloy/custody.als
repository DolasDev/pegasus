/*
 * custody.als — `custodyAt(goods, instant)`, the fold, asked the two structural questions a type
 * system cannot answer: does a counterexample EXIST.
 *
 *   1. Can `custodyAt` ever return two holders for one instant?
 *   2. Can a handover leave the goods with no holder?
 *
 * The fold is [SD §4.8.3], **as amended by the F1 decision**
 * (`docs/domain-reference/analysis/F1-handover-qualifier-decision.md` §7.1):
 *
 *     custodyAt( goods : shipment | portion , instant ) ->
 *         { holder      partyRole | party   the selected RECEIPT's value.receivingParty
 *           basis       41 | 349            that receipt's custodyBasis, or the leg's
 *           since       instant             that receipt's occurredAt
 *           until       instant?            the occurredAt of the next selected RELEASE by that
 *                                           holder, where one exists
 *           evidencedBy eventId[]           every handover assertion and FactResolved the fold read }
 *       | UNKNOWN( reason )
 *
 * **[ORIGINAL]** ([SD §4.8.2]): the fold, its `UNKNOWN` outcome, and the rule that it is never
 * stored. **[ORIGINAL]** (F1 decision §7.1): rules **C5** (the timeline — a RECEIPT opens a span,
 * the next RELEASE by that holder closes it, the gap between is `UNKNOWN`) and **C6** (the tie —
 * two selected facts at one `occurredAt` that would open and close differently yield `UNKNOWN`,
 * never an ordering the documents do not publish). **Sourced:** the acts, the two bases, and the
 * two-asserter shape of a handover.
 *
 * The module is in two parts and the split is still the finding, now with its second half answered.
 *
 *   PART A models the fold on its own presupposition — that a goods can have a *sequence* of
 *   selected handovers, which is what the `until` field and [A8 §7.4(c)] both require.
 *
 *   PART B asks whether that presupposition survives the fact key.
 *
 * **What changed here, and why.** F1 recorded that it did *not* survive: [SD §4.7.1]'s `handover`
 * row declared **no qualifier**, so every handover about one shipment keyed to `(shipment,
 * handover)`, [SD §4.3] selected one winner per key, and custody could never change hands twice.
 * The F1 decision closes it by giving `handover` the qualifier
 * `{releasing, receiving, side, occurrence?}` — `releasing`/`receiving` members of the published
 * role vocabulary [A8 §2] (NOT `partyRole` references: that is the [SD §4.7.2d(3)] violation, and
 * the decision's §4(b) and §6 R4 are why), `side` ∈ RELEASE|RECEIPT, `occurrence` a 1-based
 * bilateral ordinal (H-OCCUR) that is absent for the first transfer. The two parties move out of
 * `context[]` and into `value` as `releasingParty`/`receivingParty`, which is the other defect
 * (`src/custody.ts`'s owed `HANDOVER_RECEIVING_SIDE`) closed by the same edit.
 *
 * So this module now models the **fixed** rules, and the three commands F1 was found by —
 * `custodyAtReturnsAtMostOneHolder`, `foldsUntilFieldIsReachable`,
 * `custodyChangesHandsUnderTheFactKey` — are the fix's acceptance test. **No `expect` was touched**;
 * they were written against what the binding layer claims, and the claim is what the fix restores.
 *
 * Nothing here is an implementation. Where this module and `src/custody.ts` differ, the difference
 * is noted at the point it arises — and `src/custody.ts` **has now been brought to this decision**
 * (F1 decision §9, applied 2026-09-19): it reads `value.receivingParty` off the selected RECEIPT,
 * implements C5's open/close sequence and C6's tie, carries the three `UNKNOWN` reasons, and has
 * retired the owed `HANDOVER_RECEIVING_SIDE` and its named `receivingSides` input.
 */
module custody

open util/ordering[Instant]

/* --------------------------------------------------------------------------------------------- *
 * The envelope, as far as the fold reads it
 * --------------------------------------------------------------------------------------------- */

/** Wire instants ([SD §4.2]'s three clocks). Totally ordered; two records may share one. */
sig Instant {}

/**
 * [SD §4.7.1]'s `handover` row declares family **`goods`** = {shipment, portion} — [SD §3.3]
 * licenses a separately-timed act to name a Portion directly. The family and its name are
 * **[ORIGINAL]** ([SD §4.7] note 2).
 *
 * The F1 decision does **not** move it: candidate (d) (change the subject to the juncture) is
 * rejected at its §4(d), so `subject-admission.als` and every E-CANON consequence stay untouched.
 */
abstract sig Goods {}
sig Shipment extends Goods {}
sig Portion extends Goods {}

/**
 * The grain the fold returns as `holder`. [SD §4.8.3] says `partyRole`; [SD §8.2]'s `performedBy`
 * is a party; [A8 §9 items 1–3] owe the party entity and the person-vs-organisation grain. The F1
 * decision §5 says in as many words: "Do not invent it here; carry the union" — which is what
 * `src/custody.ts`'s `CustodyHolder` already does. One opaque sig is that union.
 */
sig PartyRole {}

/**
 * The **published role vocabulary** ([A8 §2] — `src:sirva-ade`'s `Resource.Type` cast plus four
 * additions). A `Role` is a vocabulary member exactly as `identity`'s `scheme` is ([SD §7.1]), which
 * is what lets it sit in a qualifier without putting a second `SubjectRef` in the payload
 * ([SD §1.1], Q-KEY(i)). It is deliberately **not** `PartyRole`: a `partyRole` is an aggregate with
 * a fact class of its own ([SD §1.2], [SD §4.7.3]), and a qualifier carrying two of those refs is
 * the violation [SD §4.7.2d(3)] names — F1 decision §4(b).
 */
sig Role {}

/** The qualifier's `side`. F1 decision §2: the two halves are **two facts**, not two sides of one. */
abstract sig Side {}
one sig RELEASE, RECEIPT extends Side {}

/**
 * The qualifier's `occurrence` — H-OCCUR: "counts, from 1, the transfers of **this subject** in
 * which **this ordered role pair** stood in these positions, on **this side**", absent meaning 1.
 *
 * MODELLING CHOICE (this module): a small closed domain rather than `Int`. The key needs only the
 * ordinal's *identity* and its distinguished first member, and the absent-means-1 rule is modelled
 * by normalising the derived key onto `Occ1`. Three members is headroom; nothing here needs a
 * fourth. Fidelity note: the published domain is "integer ≥ 1", so a property that depended on
 * arithmetic over `occurrence` would not be testable here — none does, and by foreclosure 8 of the
 * decision none may, because the platform may never derive it.
 */
abstract sig Occurrence {}
one sig Occ1, Occ2, Occ3 extends Occurrence {}

/**
 * `src:uncefact-rec24`'s two codes — the one real distinction the source draws, and the hinge
 * [A8 §7.1] hangs **A8-MOVE** on:
 *
 *   41  Handed_over_under_continued_responsibility — "under responsibility of the same transport
 *       operator" (rev3 p.4). Custody moves, authority does not.
 *   349 Handed_over — "handed over to another party" (rev3 p.15). Authority moves.
 *
 * Kept as the numeric code, not renamed: [A3 §5.2] records that Rec 24 "supplies it as two status
 * codes, **not as an entity**", and the code is the part that is sourced.
 */
abstract sig CustodyBasis {}
one sig B41 extends CustodyBasis {}
one sig B349 extends CustodyBasis {}

/** [SD §4.2]. `outcome` is legal only where `basis = ACTUAL` ([SD §2.3] invariant 1). */
abstract sig Basis {}
one sig REQUESTED, COMMITTED, PLANNED, ESTIMATED, ACTUAL extends Basis {}

/**
 * [SD §8.2] `ExternallyPerformedLeg` — "a named party's undertaking to move goods between two
 * places". [SD §4.8.3] rule 1 makes "that leg's declared `custodyBasis` and `performedBy`" the
 * fold's other input.
 */
sig ExternallyPerformedLeg {
  moved       : one Goods,
  performedBy : one PartyRole,
  legBasis    : one CustodyBasis
}

/**
 * A `handover` Assertion, **with the F1 qualifier**.
 *
 * Its fact key is the derived tuple `(subject, type, qualifier?)` ([SD §1.3]). Under the decision
 * the qualifier is `{releasing, receiving, side, occurrence?}`, so the key of a handover about one
 * goods is `(that goods, handover, {releasing, receiving, side, occurrence})` — see `sameFactKey`.
 * Four fields of this sig are the qualifier; two are `value`.
 *
 * `releasingParty` and `receivingParty` are `one`, and that is the second defect closing. The old
 * model had `receiving : lone PartyRole` because [SD §4.8.3] read `holder` "from the selected
 * handover's **receiving side**" while [SD §4.7.1] put "the releasing and receiving `partyRole`s"
 * in **`context[]`**, which [SD §1.4] rules 2 and 3 make valueless, non-authoritative and
 * unlabelled — so nothing could say *which* of two refs was the receiver, and `src/custody.ts` named
 * the gap `HANDOVER_RECEIVING_SIDE` (now retired). The decision §0(4) moves both parties into `value`,
 * where they are asserted, attributed, contestable and **labelled**; the field is therefore total.
 * `everySelectedReceiptYieldsExactlyOneHolder` below is that closure made testable.
 *
 * Both parties ride **both** records ([F1] §2.2): `src:open-trip-model`'s `HandOver` carries
 * `from`/`to` actor refs and that shape is preserved field-for-field. What is not preserved is the
 * claim that one publisher's record settles both sides.
 */
sig Handover {
  subject       : one Goods,
  /* --- the qualifier ([SD §1.3]'s third key component) --- */
  releasing     : one Role,
  receiving     : one Role,
  side          : one Side,
  occurrence    : one Occurrence,
  /* --- the value ([SD §4.1], [SD §2]) --- */
  occurredAt    : one Instant,
  assertedBasis : one Basis,
  custodyBasis  : one CustodyBasis,
  releasingParty: one PartyRole,
  receivingParty: one PartyRole,
  /**
   * The role that ASSERTED this handover — [SD §1.1]'s `assertedBy.role`.
   *
   * The model had no reason to carry it until **A8-KEY** ([A8 §5] row 12) existed: before F3 was
   * closed there was no published rule that read the asserter, which is exactly what F3 recorded
   * ("found no published rule to transcribe"). It is a `Role` and not a `PartyRole` because
   * authority is a property of the role, never of the party ([A8 §3]).
   */
  assertedBy    : one Role,
  /** [SD §4.7.1]'s handover row: `context[]` carries "both `stop`s / `trip`s, **or the
   *  `externallyPerformedLeg`**". Reading the leg *reference* out of context is not reading a
   *  value out of it ([SD §1.4] rule 2) — the values come off the leg, a published record.
   *  Note the deletion the decision §9 makes here: `partyRole` leaves the `context[]` column, so
   *  there is no longer a second home for the link ([SD §1.1], revision 3's defect C). */
  namesLeg      : lone ExternallyPerformedLeg
}

/**
 * The fact key, applied to `handover` under the F1 qualifier.
 *
 * Nothing in the key is a `SubjectRef` (R4), nothing in it is under contest for this fact
 * (Q-KEY(iii) — which is why `occurredAt` is *not* here, and candidate (a) lost), and every
 * component is computable by either party at assertion time from what that party holds (R3).
 */
pred sameFactKey[h1, h2: Handover] {
  h1.subject    = h2.subject
  h1.releasing  = h2.releasing
  h1.receiving  = h2.receiving
  h1.side       = h2.side
  h1.occurrence = h2.occurrence
}

/**
 * [SD §4.3]. `factRef` is an explicit field "here and only here". It now names the **whole** key,
 * not just the goods: `considered[]` "names every assertion in the contest", and the contest is
 * every handover that keys to the same tuple.
 *
 * `selected` is `lone` rather than `one`. [SD §4.3] makes it MANDATORY and [A8 §7.3] **A8-JOINT**
 * is the one published exception — and A8-JOINT names `condition` "and the counts asserted with
 * it", **not** `handover`; the F1 decision §7.3 leaves that untouched and notes A8-JOINT is now
 * visibly not a rule about handovers. So an empty selection on a handover contest is still not
 * licensed by any document. It is modelled as possible because `src/custody.ts` tolerates it
 * (`selectedHandovers` skips a null selection), and command A4 below is what that tolerance costs.
 */
sig FactResolved {
  factGoods     : one Goods,
  keyReleasing  : one Role,
  keyReceiving  : one Role,
  keySide       : one Side,
  keyOccurrence : one Occurrence,
  considered    : some Handover,
  selected      : lone Handover
}

fact envelopeWellFormedness {
  // [SD §4.3]: `considered[]` names every assertion in the contest, and the contest is the fact
  // key — which for `handover` is now `(subject, handover, {releasing, receiving, side,
  // occurrence})` ([SD §4.7.1] as amended, F1 decision §9).
  all r: FactResolved |
    r.considered = { h: Handover |
      h.subject    = r.factGoods    and
      h.releasing  = r.keyReleasing and
      h.receiving  = r.keyReceiving and
      h.side       = r.keySide      and
      h.occurrence = r.keyOccurrence }
  all r: FactResolved | r.selected in r.considered
  // [SD §8.2]: a leg moves the goods the handover is about. A handover naming a leg that moved
  // something else would be a second subject hidden in `context[]`, which [SD §1.1] forbids.
  all h: Handover | some h.namesLeg implies h.namesLeg.moved = h.subject
}

/* --------------------------------------------------------------------------------------------- *
 * PART A — the fold
 * --------------------------------------------------------------------------------------------- */

/** Every handover this goods' published resolutions selected. */
fun selectedFor[g: Goods] : set Handover {
  { r: FactResolved | r.factGoods = g }.selected
}

/**
 * [SD §4.8.3] rule 1's inputs, filtered to the ones the fold reads.
 *
 * DECISION (this package, mirroring `src/custody.ts`): only `basis = ACTUAL` handovers are folded.
 * [SD §4.8.3] does not say so in as many words, but its rule 3 reaches for **M1**'s
 * record-versus-fabrication argument, and a PLANNED handover is an intention ([SD §4.2]) — folding
 * one would have the projection report custody nobody asserted happened. [SD §5] M2 is the other
 * half: a handover is possession-changing, so it can never be `ASSUMED_FROM_PLAN` at all.
 */
fun foldInputs[g: Goods] : set Handover {
  { h: selectedFor[g] | h.assertedBasis = ACTUAL }
}

/**
 * What one selected fact contributes to the timeline — F1 decision §7.1 and **C5**.
 *
 * A **RECEIPT** opens a span and yields its `value.receivingParty` as the holder. A **RELEASE**
 * yields nothing: it closes a span, and between a RELEASE and the next RECEIPT the fold returns
 * `UNKNOWN`. That is the whole of foreclosure 2 — "custody can never move on one party's word" —
 * and it is checked below as `custodyNeverMovesOnTheReleasingPartysWordAlone`.
 *
 * Note what this no longer reads: the old `holderOf` fell back to `namesLeg.performedBy`. Under the
 * amended table the holder is the receipt's `value.receivingParty`, full stop. See
 * `legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt` for what that leaves unsettled.
 */
fun yieldOf[h: Handover] : lone PartyRole {
  (h.side = RECEIPT) => h.receivingParty else none
}

/**
 * The basis a selected fact yields. Where the movement is a leg, [SD §4.8.3] rule 1 makes the
 * **leg's declared** basis the input — F1 decision §7.1 keeps it ("that receipt's `custodyBasis`,
 * or the leg's").
 */
fun basisOf[h: Handover] : one CustodyBasis {
  (some h.namesLeg) => h.namesLeg.legBasis else h.custodyBasis
}

/**
 * The governing facts: the latest selected ones at or before the instant.
 *
 * Returns a *set*, deliberately — two selected facts may share an `occurredAt`. [SD §4.8.3] writes
 * "the selected handover" in the singular and publishes no tie-break, and **C6** is the rule that
 * says what happens instead of one: see `holdersAt`.
 */
fun governing[g: Goods, i: Instant] : set Handover {
  { h: foldInputs[g] |
      lte[h.occurredAt, i] and
      no h2: foldInputs[g] | lte[h2.occurredAt, i] and gt[h2.occurredAt, h.occurredAt] }
}

/**
 * **C6 [ORIGINAL]** (F1 decision §7.1) — the tie. "Where two selected handover facts about one
 * goods carry the **same** `occurredAt` and would open and close differently, the fold returns
 * `UNKNOWN`. It does not order them by key, by `assertedAt`, by `recordedAt` or by `occurrence`."
 *
 * This is **A8-NAMED** ([A8 §4.4]) in its custody-side form and [SD §4.6.3] step 2's refusal to fall
 * through, applied to ordering instead of to selection. It is the half F1 said was missing.
 */
pred ambiguousOrderAt[g: Goods, i: Instant] {
  some disj h1, h2: governing[g, i] | yieldOf[h1] != yieldOf[h2]
}

/**
 * `custodyAt(g, i).holder`, or nothing where the fold returns UNKNOWN.
 *
 * The three `UNKNOWN` reasons of F1 decision §7.1 are exactly the three ways this is empty:
 * `NO_SELECTED_HANDOVER_AT_OR_BEFORE_INSTANT` (nothing governs), `IN_TRANSFER_GAP` (a RELEASE
 * governs — C5), `AMBIGUOUS_ORDER_AT_INSTANT` (C6). `RECEIVING_SIDE_NOT_PUBLISHED` is **retired**
 * with the move into `value`.
 */
fun holdersAt[g: Goods, i: Instant] : set PartyRole {
  ambiguousOrderAt[g, i] => none
  else { p: PartyRole | some h: governing[g, i] | p = yieldOf[h] }
}

/** [SD §4.8.3] rule 3: `UNKNOWN` is a real outcome and is never filled in. */
pred unknownAt[g: Goods, i: Instant] {
  no holdersAt[g, i]
}

/**
 * **A8-MOVE as amended** — [A8 §7.1] plus F1 decision §7.3: "Authority over every `boundBy =
 * CUSTODY` fact class moves at the selected **`RECEIPT`**'s `occurredAt`, on that receipt's
 * `custodyBasis`: `349` moves it to the receiving role; `41` moves custody and not authority.
 * Across a transfer gap (C5) the **releasing role remains authoritative** until the receipt, so the
 * gap is a custody `UNKNOWN` and not an authority vacuum."
 *
 * So authority at an instant is the receiving party of the latest **349 RECEIPT** at or before it:
 * a 41 receipt moves the goods and is skipped, which is exactly what "authority does not move"
 * means, and a RELEASE moves nothing, which is the gap clause. Evaluated at the instant the fact is
 * *about*, per **A8-INSTANT** ([A8 §4.2]).
 *
 * **Do not score** on the choice of the receipt instant: F1 decision §7.3 marks the amendment
 * [ORIGINAL] and provisional until A8 ratifies it ([SD §4.7] note 3).
 */
fun authorityAt[g: Goods, i: Instant] : set PartyRole {
  { p: PartyRole |
      some h: foldInputs[g] |
        h.side = RECEIPT and basisOf[h] = B349 and lte[h.occurredAt, i] and
        p = h.receivingParty and
        no h2: foldInputs[g] |
          h2.side = RECEIPT and basisOf[h2] = B349 and
          lte[h2.occurredAt, i] and gt[h2.occurredAt, h.occurredAt] }
}

/** No two selected handovers about one goods share an occurrence instant. */
pred noInstantTies {
  all g: Goods | all disj h1, h2: foldInputs[g] | h1.occurredAt != h2.occurredAt
}

/* ---- A0. Consistency. A module that constrains itself into vacuity proves nothing. ----------- */

pred someCustodyIsKnown {
  some g: Goods, i: Instant | some holdersAt[g, i]
}
run someCustodyIsKnown for 4 expect 1

/* ---- A1. Can `custodyAt` return two holders for one instant? -------------------------------- */

/**
 * [SD §4.8.3] types the fold as a function: `custodyAt(goods, instant) -> {holder, ...} | UNKNOWN`
 * — one holder or none. [A8 §4.3] then makes authority over eight fact classes follow it, so a
 * two-valued answer is a two-valued authority.
 *
 * **This is one of F1's three.** It was SAT — a counterexample existed — because relaxing the fact
 * key to let custody move at all left the fold multi-valued at an `occurredAt` tie with no
 * published tie-break. **C6** is what closes it, and `c6ReturnsUnknownAtAnAmbiguousTie` below is
 * the non-vacuity proof: the tie is still constructible, the fold just declines to answer it.
 */
assert custodyAtReturnsAtMostOneHolder {
  all g: Goods, i: Instant | lone holdersAt[g, i]
}
check custodyAtReturnsAtMostOneHolder for 4 expect 0

/**
 * A1c was the other jaw of the pincer. Before the fix the two had to be read together: **keep** the
 * fact key and the fold was single-valued but could never change hands (B1, B3); **relax** it the
 * obvious way and the fold was multi-valued at a tie (A1). Under the F1 qualifier both jaws open —
 * `factKeyHasOneWinner` now holds *per key* and the fold stays single-valued anyway.
 */
assert custodyAtReturnsAtMostOneHolderUnderTheFactKey {
  factKeyHasOneWinner implies all g: Goods, i: Instant | lone holdersAt[g, i]
}
check custodyAtReturnsAtMostOneHolderUnderTheFactKey for 5 expect 0

/**
 * A1b localises A1: away from an instant tie the fold is single-valued for a second, independent
 * reason. Keeping it is what makes A1's new UNSAT informative rather than circular — if C6 were
 * ever weakened, A1 would go red and A1b would stay green, which is the signature of a missing
 * tie-break rather than a broken fold.
 */
assert custodyAtIsSingleValuedAwayFromInstantTies {
  noInstantTies implies all g: Goods, i: Instant | lone holdersAt[g, i]
}
check custodyAtIsSingleValuedAwayFromInstantTies for 5 expect 0

/** The same property one function to the left: authority inherits it through [A8 §4.3] `CUSTODY`. */
assert authorityAtIsSingleValuedAwayFromInstantTies {
  noInstantTies implies all g: Goods, i: Instant | lone authorityAt[g, i]
}
check authorityAtIsSingleValuedAwayFromInstantTies for 5 expect 0

/* ---- A2. Can a handover leave the goods with no holder? ------------------------------------- */

/**
 * Yes, and by design. [SD §4.8.3] rule 3 names two cases — "Before the first handover, and across a
 * cross-dock dwell where only one of the two handovers has been published, the fold returns
 * `UNKNOWN`" — and under the fix both are **derived** rather than stipulated, which is itself
 * evidence for the decision's §2 verdict (F1 decision §7.1). The third case, the receiving side no
 * authoritative field carried, is **gone**: it was the `HANDOVER_RECEIVING_SIDE` gap, and §0(4)
 * closes it.
 *
 * So the instance this command now finds is C5's: a RELEASE governs, and the fold declines.
 */
pred handoverLeavesGoodsWithNoHolder {
  some g: Goods, i: Instant | some governing[g, i] and unknownAt[g, i]
}
run handoverLeavesGoodsWithNoHolder for 4 expect 1

/** "Before the first handover" — [SD §4.8.3] rule 3. */
pred unknownBeforeAnyHandover {
  some g: Goods, i: Instant | no governing[g, i] and unknownAt[g, i]
}
run unknownBeforeAnyHandover for 4 expect 1

/**
 * A4. A resolution that declines to select. Not licensed for `handover` by any document — [A8 §7.3]
 * A8-JOINT is the only published empty-`selected` case and it names `condition` and its counts.
 * The instance exists because `src/custody.ts` tolerates a null selection; what it costs is that a
 * published, resolved contest yields no custody at all.
 */
pred declinedSelectionYieldsNoCustody {
  some r: FactResolved | no r.selected
  some g: Goods, i: Instant | some { h: Handover | h.subject = g and lte[h.occurredAt, i] } and unknownAt[g, i]
}
run declinedSelectionYieldsNoCustody for 4 expect 1

/* ---- A5. The fall-through the fold is forbidden to take ------------------------------------- */

/**
 * The tempting wrong fold: the last holder anyone published, and keep him there. Under the fix it
 * has a sharper shape than it did — it is the fold that ignores RELEASEs, i.e. the one that never
 * opens a transfer gap.
 */
fun lastWriterWinsHolder[g: Goods] : set PartyRole {
  { p: PartyRole |
      some h: foldInputs[g] |
        h.side = RECEIPT and p = h.receivingParty and
        no h2: foldInputs[g] | h2.side = RECEIPT and gt[h2.occurredAt, h.occurredAt] }
}

/**
 * [SD §4.8.3] rule 3: `UNKNOWN` "does not fall through to the last known holder, to the trip's
 * current assignee, or to the party that spoke most recently — that would be **A8-NAMED**'s
 * implicit last-writer-wins returning through the back door, and **M1**'s record-versus-fabrication
 * argument applies unchanged."
 *
 * An instance here is the evidence that rule 3 is load-bearing rather than decorative: there is a
 * state where the forbidden fold answers and the specified fold says UNKNOWN, so the two are
 * distinguishable and the prohibition has teeth. C5's gap is now exactly that state.
 */
pred lastWriterWinsWouldAnswerWhereTheFoldSaysUnknown {
  some g: Goods, i: Instant | unknownAt[g, i] and some lastWriterWinsHolder[g]
}
run lastWriterWinsWouldAnswerWhereTheFoldSaysUnknown for 4 expect 1

/* ---- A6. 41 versus 349 ----------------------------------------------------------------------- */

/**
 * The worked HHG case for `41` is `src:dp3-400ng` Item 125 **Shuttle Service** — a truck-to-truck
 * transfer handing to the *same* agent's own linehaul van ([A8 §7.1]). Custody moves; authority
 * does not. An instance is what makes A8-MOVE a distinction rather than a synonym.
 */
pred custodyMovesWhileAuthorityStaysAt41 {
  some g: Goods, i: Instant |
    (some h: governing[g, i] | basisOf[h] = B41) and
    some holdersAt[g, i] and
    holdersAt[g, i] != authorityAt[g, i]
}
run custodyMovesWhileAuthorityStaysAt41 for 4 expect 1

/**
 * **A8-MOVE has nothing to move authority to while the fold is UNKNOWN**, and that is handled
 * rather than broken: authority is simply empty, which is the case **A8-NAMED** ([A8 §4.4]) exists
 * for — "Where `authoritative` is empty or plural for a contested fact, `FactResolved` MUST name a
 * tie-break rule." The gap is visible in the data instead of being papered over.
 *
 * Note the one case this is *not*: a C5 transfer gap. There, F1 decision §7.3 holds the releasing
 * role authoritative until the receipt, so custody is UNKNOWN and authority is **not** empty. The
 * instance this command finds is the other one — before any 349 receipt at all.
 */
pred unknownCustodyLeavesAuthorityEmpty {
  some g: Goods, i: Instant | unknownAt[g, i] and no authorityAt[g, i]
}
run unknownCustodyLeavesAuthorityEmpty for 4 expect 1

/**
 * **Rule A8-KEY** — [A8 §5] row 12, `boundBy = KEY`, transcribed. This is what F3 could not write:
 * "`alloy/custody.als` had to decide what `FactResolved` does with a handover contest in order to
 * model F1's fix, and found no published rule to transcribe."
 *
 * > Authority for a handover key belongs to the role named on that key's own `side` — the releasing
 * > role for a `RELEASE`, the receiving role for a `RECEIPT`.
 *
 * Note what it reads: `keySide`, `keyReleasing`, `keyReceiving` — all three are **fact-key**
 * components, fixed when the record was minted. It does not read `holdersAt` or `authorityAt`, which
 * is the whole of why it is not circular: [SD §4.8.2] refused a `CUSTODY` binding here because
 * "A8-MOVE would be defined in terms of the thing it defines".
 */
pred a8Key {
  all r: FactResolved | some r.selected implies
    (r.keySide = RELEASE
       implies r.selected.assertedBy = r.keyReleasing
       else    r.selected.assertedBy = r.keyReceiving)
}

/**
 * B0a. **The contest F1 made routine and F3 could not settle, now settled.** Two assertions on ONE
 * key from opposite sides, and A8-KEY picks the key-side one — so `FactResolved` resolves it without
 * A8-NAMED ([A8 §4.4]) having any tie-break to name.
 */
pred a8KeySettlesATwoSidedContest {
  a8Key
  some r: FactResolved |
    some r.selected and
    some h: r.considered | h != r.selected and h.assertedBy != r.selected.assertedBy
}
run a8KeySettlesATwoSidedContest for 4 expect 1

/**
 * B0b. **The cost of A8-KEY, surfaced rather than assumed away.** Where the key-side role never
 * asserted and only the other side did, A8-KEY selects **nothing** — `selected` is `lone`, so an
 * empty selection is representable, and `src/custody.ts`'s `selectedHandovers` skips it.
 *
 * That is not a defect in the rule; it is the rule declining to let the wrong side speak, which is
 * the property [A8 §5] row 12 exists to guarantee. It matters because it is a second way to reach
 * the state command A4 is about: a fold that goes quiet not because nobody asserted, but because
 * the only assertion came from the side the key does not name. A consumer that reads an absent
 * custody edge as "no transfer happened" would be wrong in both cases, and for different reasons.
 */
pred a8KeyLeavesTheFoldQuietWhenOnlyTheOtherSideAsserted {
  a8Key
  some r: FactResolved |
    no r.selected and
    some h: r.considered |
      (r.keySide = RELEASE implies h.assertedBy != r.keyReleasing
                            else   h.assertedBy != r.keyReceiving)
}
run a8KeyLeavesTheFoldQuietWhenOnlyTheOtherSideAsserted for 4 expect 1

/* --------------------------------------------------------------------------------------------- *
 * PART B — whether the fold's own presupposition survives the fact key
 * --------------------------------------------------------------------------------------------- */

/**
 * [SD §4.3] restated **per key**, which is the restatement F1 decision §8 asks for.
 *
 * It used to read `all g: Goods | lone selectedFor[g]` — one winner per *goods* — because
 * [SD §4.7.1]'s handover row declared no qualifier and the key collapsed onto the subject.
 * [SD §4.7.2d] item 3's doctrine ("the discriminator stays the subject: two trips are two trips,
 * two memberships are two `stopAction`s") has no purchase on `handover`, whose subject is the one
 * aggregate that does **not** change across successive handovers of it — which is precisely why it
 * is the type that needed a qualifier instead.
 *
 * Now: no two **selected** handovers share a fact key. Two selected handovers about one goods are
 * fine, and must be, provided they key differently.
 */
pred factKeyHasOneWinner {
  all disj h1, h2: FactResolved.selected | not sameFactKey[h1, h2]
}

/**
 * B1. **One of F1's three.** The claim under test is the binding layer's, in three places:
 *
 *   - [SD §4.8.3]'s `until` field — "**the next selected handover's** `occurredAt`, where one
 *     exists" (F1 decision §7.1: the next selected RELEASE by that holder) — which is unreachable
 *     unless one goods can have two selected handovers;
 *   - [A8 §7.6]'s cross-dock scenario, which publishes a handover into T1 and a handover out to T2
 *     for `shipment:S` and says "these two acts are the fold's inputs";
 *   - [A3 §3.3]'s agent-to-agent handoff and SIT-interruption rows, which require a shipment to
 *     change hands more than once over its life.
 *
 * `expect 1` records that claim, and it was written before the fix — **unchanged by it**. The
 * evidence is the pre-fix run itself, which reported this command as "got UNSAT, **expected SAT**"
 * (quoted in full at `findings-from-alloy.md` F1): the expectation it failed against is the one it
 * carries now. The same holds for B3. An earlier draft of the F1 decision's §9 edit list said to
 * "flip B1/B3's `expect`"; that instruction was wrong, was not followed, and is struck there.
 *
 * Under the qualifier the state is constructible: the two handovers key differently on `side`, on
 * the role pair, or on `occurrence`, so `FactResolved` selects each on its own key.
 */
pred foldsUntilFieldIsReachable {
  factKeyHasOneWinner
  some g: Goods | #selectedFor[g] > 1
}
run foldsUntilFieldIsReachable for 6 expect 1

/**
 * B2. The control. It proved B1's UNSAT was the fact key talking and not a scope artefact or an
 * over-constrained module; it keeps that job in the other direction now, as the case where the
 * discriminator is the **subject** rather than the qualifier. Two goods, two contests, two winners.
 */
pred twoWinnersUnderTwoSubjects {
  factKeyHasOneWinner
  #(FactResolved.selected) > 1
}
run twoWinnersUnderTwoSubjects for 6 expect 1

/**
 * B3. **One of F1's three,** and the one that states what the defect cost operationally: under the
 * old key, custody could never change hands — `until` was always absent, the goods had at most one
 * holder for all time, and [A8 §7.6]'s "why A's later assertion loses" argument, which turns on the
 * delivery's instant falling **after** the 349 boundary, had at most one boundary to fall after.
 *
 * Under the qualifier an ordinary interstate move — origin agent → hauler → destination agent — is
 * representable: four keys, two custody spans, two boundaries (F1 decision §6 R1).
 */
pred custodyChangesHandsUnderTheFactKey {
  factKeyHasOneWinner
  some g: Goods, disj i1, i2: Instant |
    some holdersAt[g, i1] and some holdersAt[g, i2] and holdersAt[g, i1] != holdersAt[g, i2]
}
run custodyChangesHandsUnderTheFactKey for 6 expect 1

/* --------------------------------------------------------------------------------------------- *
 * PART C — what the fix itself now claims
 *
 * PART B asks whether the fold's presupposition survives. These ask whether the *fix* does what its
 * decision says it does. Each names the clause it transcribes.
 * --------------------------------------------------------------------------------------------- */

/**
 * C1. **The two sides are two facts** — F1 decision §2's verdict and §0(1), which is the part of
 * the decision everything else hangs off.
 *
 * One transfer: same goods, same ordered role pair, same `occurrence`, differing **only** in
 * `side`. The claim is not merely that they *may* be two facts but that they *are*: they key
 * differently, so `FactResolved` never asks anyone to choose between them (F1 decision §2.1(b)), and
 * the fold still yields exactly one holder afterwards — the receipt's `value.receivingParty`
 * (§0(4), and §7.2's closure of the `context[]`-sourced receiving side).
 *
 * The release is also constrained to come first, which is the ordinary case and is what makes the
 * instance a *transfer* rather than two unrelated records.
 */
pred bothSidesOfOneTransferAreTwoFactsYieldingOneHolder {
  factKeyHasOneWinner
  some g: Goods, rel, rec: Handover, i: Instant |
    rel.subject = g and rec.subject = g and
    rel.side = RELEASE and rec.side = RECEIPT and
    rel.releasing = rec.releasing and rel.receiving = rec.receiving and
    rel.occurrence = rec.occurrence and
    not sameFactKey[rel, rec] and                     // two facts, not two sides of one
    rel + rec in foldInputs[g] and
    lt[rel.occurredAt, rec.occurredAt] and
    gte[i, rec.occurredAt] and
    holdersAt[g, i] = rec.receivingParty              // and the fold is single-valued on it
}
run bothSidesOfOneTransferAreTwoFactsYieldingOneHolder for 6 expect 1

/**
 * C2. **What survives of R2** — F1 decision §2.3: "Where two parties speak about the same side of
 * the same transfer, they pair." The driver and the origin agent both asserting A's release; a
 * `DestinationAgent` asserting a receipt the `Hauler` also asserts. Each is one key with a real
 * contest — here, a disagreement about **who took the goods**, which is exactly what
 * `value.receivingParty` is for and exactly what Q-KEY(iii) keeps out of the key.
 *
 * The contest resolves in the ordinary way ([SD §4.3], [SD §4.5]): one `FactResolved`, one winner,
 * and the fold reads the winner's party and no one else's.
 */
pred twoAssertionsAboutOneSidePairUnderOneKey {
  factKeyHasOneWinner
  some disj h1, h2: Handover, r: FactResolved |
    sameFactKey[h1, h2] and                           // same key ⇒ they pair and contest
    h1.side = RECEIPT and
    h1.receivingParty != h2.receivingParty and        // a real disagreement about the receiver
    r.considered = h1 + h2 and
    one r.selected and
    r.selected.assertedBasis = ACTUAL and
    holdersAt[h1.subject, r.selected.occurredAt] = r.selected.receivingParty
}
run twoAssertionsAboutOneSidePairUnderOneKey for 6 expect 1

/**
 * C3. **R5 / H-OCCUR** — F1 decision §5 and §6 R5: "The same ordered role pair transferring the
 * same goods twice publishes `occurrence = 1` and `occurrence = 2` on each side."
 *
 * This is the component candidate (c) — a catalog-minted custody-transfer sequence number — was
 * rejected for, and the difference is R3: `occurrence` counts only the asserting party's own
 * dealings with the counterparty named in the same key, never transfers it was not party to. What
 * the model can check is the consequence: same subject, same pair, same side, different
 * `occurrence` ⇒ different keys ⇒ both selectable, and the fold single-valued at each.
 */
pred sameRolePairHandingOverTwiceProducesDistinctFacts {
  factKeyHasOneWinner
  some g: Goods, disj h1, h2: Handover |
    h1.subject = g and h2.subject = g and
    h1.releasing = h2.releasing and h1.receiving = h2.receiving and
    h1.side = RECEIPT and h2.side = RECEIPT and
    h1.occurrence != h2.occurrence and
    not sameFactKey[h1, h2] and
    h1 + h2 in foldInputs[g] and
    lt[h1.occurredAt, h2.occurredAt] and
    one holdersAt[g, h1.occurredAt] and
    one holdersAt[g, h2.occurredAt]
}
run sameRolePairHandingOverTwiceProducesDistinctFacts for 6 expect 1

/**
 * C4. **C6 has teeth** — the non-vacuity proof for `custodyAtReturnsAtMostOneHolder`'s new UNSAT.
 *
 * A1 going green would be worthless if ties had become unconstructible; it would mean the fix had
 * removed the question rather than answered it. This command builds the tie — two selected facts
 * about one goods at one `occurredAt`, under distinct keys, that would open and close differently —
 * and asserts the fold returns `UNKNOWN` (`AMBIGUOUS_ORDER_AT_INSTANT`) rather than two holders.
 */
pred c6ReturnsUnknownAtAnAmbiguousTie {
  factKeyHasOneWinner
  some g: Goods, i: Instant |
    some governing[g, i] and ambiguousOrderAt[g, i] and unknownAt[g, i]
}
run c6ReturnsUnknownAtAnAmbiguousTie for 6 expect 1

/**
 * C5run. **The transfer gap** — F1 decision §7.1 rule **C5**, and the row F1 decision §8's
 * acceptance table adds: "a new run: `UNKNOWN` across a transfer gap (C5)".
 *
 * A RECEIPT opens a span; the RELEASE by that same holder closes it; at and after the release the
 * fold returns `UNKNOWN` (`IN_TRANSFER_GAP`) while custody inside the span is known. This is
 * [SD §4.8.3] rule 3's cross-dock dwell and [A3 §8]'s "thin part", now **produced** by the fold
 * rather than stipulated about it — which is the strongest internal evidence for §2's two-facts
 * verdict.
 */
pred unknownAcrossATransferGap {
  factKeyHasOneWinner
  some g: Goods, rec, rel: Handover, iGap: Instant |
    rec.side = RECEIPT and rel.side = RELEASE and
    rec + rel in foldInputs[g] and
    lt[rec.occurredAt, rel.occurredAt] and
    rel.releasingParty = rec.receivingParty and       // the RELEASE closes the open span (C5)
    one holdersAt[g, rec.occurredAt] and              // custody known inside the span
    gte[iGap, rel.occurredAt] and
    unknownAt[g, iGap]                                // and UNKNOWN across the gap
}
run unknownAcrossATransferGap for 6 expect 1

/**
 * C6chk. **Custody never moves on the releasing party's word alone** — F1 decision §10 foreclosure
 * 2, [SD §4.8.3] rule 3, and M1's record-versus-fabrication argument.
 *
 * This is the property the one-fact reading could not produce (F1 decision §2.1(a)): if release and
 * receipt were one contested fact, a lone `J1` would be a contest of one, `FactResolved` would
 * select it, and the fold would report custody moving on the releasing party's word. Here it does
 * not, and a partner that emits only `J1` leaves a permanent `UNKNOWN` span — the intended
 * operational cost, named rather than discovered.
 */
assert custodyNeverMovesOnTheReleasingPartysWordAlone {
  all g: Goods, i: Instant |
    (no h: foldInputs[g] | h.side = RECEIPT and lte[h.occurredAt, i])
      implies no holdersAt[g, i]
}
check custodyNeverMovesOnTheReleasingPartysWordAlone for 5 expect 0

/**
 * C7. **F2 closed** — the receiving side now comes off an authoritative, labelled field.
 *
 * Before the fix this assertion had a counterexample by construction: `Handover.receiving` was
 * `lone`, because [SD §4.7.1] put the two `partyRole`s in `context[]` and [SD §1.4] rules 2 and 3
 * make `context[]` valueless, non-authoritative and unlabelled — so the fold was reading an
 * authoritative output off a non-authoritative field, and `src/custody.ts` still carries the gap as
 * `HANDOVER_RECEIVING_SIDE` with a `RECEIVING_SIDE_NOT_PUBLISHED` reason — both now retired. F1
 * decision §0(4) and §7.2 close it; this is the check that says so, and `findings-from-alloy.md`
 * records it as **F2, resolved**.
 */
assert everySelectedReceiptYieldsExactlyOneHolder {
  all g: Goods, h: foldInputs[g] | h.side = RECEIPT implies one yieldOf[h]
}
check everySelectedReceiptYieldsExactlyOneHolder for 5 expect 0

/**
 * C8. **An edge the decision leaves open, recorded rather than smoothed over.**
 *
 * [SD §4.8.3] rule 1 still names "that leg's declared `custodyBasis` and **`performedBy`**" as the
 * fold's other input, and F1 decision §7.5 says `ExternallyPerformedLeg` "is unchanged: it still
 * carries `custodyBasis` and `performedBy` as the fold's other input". But §7.1's amended table
 * sources `holder` from "the selected RECEIPT's `value.receivingParty`" — full stop — so
 * `performedBy` no longer has a consumer, and nothing published says the two must agree.
 *
 * This command builds the disagreement: a selected RECEIPT naming a leg whose `performedBy` is a
 * different party, where the fold reports the receipt's party and ignores the leg's. The instance
 * is not a defect in the fix; it is the question the fix does not answer, and it is `expect 1`
 * because the state is constructible under the documents as they now stand. Whether `performedBy`
 * becomes a cross-check, a fallback, or is struck from rule 1 is [SD §4.8.3]'s to decide.
 */
pred legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt {
  factKeyHasOneWinner
  some g: Goods, h: Handover, l: ExternallyPerformedLeg |
    h in foldInputs[g] and
    h.side = RECEIPT and
    h.namesLeg = l and
    l.performedBy != h.receivingParty and
    holdersAt[g, h.occurredAt] = h.receivingParty
}
run legPerformerCanDisagreeWithTheReceiptAndTheFoldReadsTheReceipt for 5 expect 1
