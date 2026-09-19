/*
 * cardinality.als — the four structural cardinality questions, asked of the binding layer rather
 * than of an implementation.
 *
 *   1. Can a Portion belong to two Shipments?
 *   2. Can a Shipment hold two open Stays?
 *   3. Can a Stop belong to two Trips?
 *   4. Can a shipment ride two trips at the same instant?
 *
 * Two of the four are asked the other way round from how they read. [SD §5.3] and [A3 §3.3] make
 * (2) and (4) states the model MUST be able to express, so for those an *absent* instance is the
 * finding and the commands carry `expect 1`.
 *
 * Every rule below is a `pred` rather than a `fact`, so that each document sentence is visible as
 * a named antecedent and can be dropped in a counterfactual run. `bindingLayer` composes them.
 */
module cardinality

open util/ordering[Instant]

sig Instant {}

/* --------------------------------------------------------------------------------------------- *
 * The aggregates this module needs, and only those
 * --------------------------------------------------------------------------------------------- */

/** [fork-order §3.1]: "one commitment, to one performing party, to perform a named set of services". */
sig Order {}

/**
 * [fork-order §3.1]: "A shipment is the set of goods committed to move under one transport
 * undertaking", and "**A shipment belongs to exactly one order.** Not many-to-many."
 */
sig Shipment { ofOrder: one Order }

/** [src:cfr-49-375] §375.503's itemized inventory: an article with its own id and condition. */
sig Item { ofShipment: one Shipment }

/**
 * [SD §3.1]. `shipment` is MANDATORY and "exactly one; **a Portion never spans shipments**";
 * `items[]` carries the membership "when ENUMERATED or BOTH".
 *
 * `measure` and `basis` are omitted: they carry no cardinality and this module asks only about
 * cardinality. P-MEMBER ([SD §3.2]) — a Portion minted MEASURED may become ENUMERATED later
 * "without changing its `portionId`" — is why `members` is a plain `set` and not `some`.
 */
sig Portion {
  ofShipment: one Shipment,
  members   : set Item
}

/** [A3 §3.2]: "one vehicle journey performed by an assigned resource set… A trip carries no goods." */
sig Trip {}

/**
 * [A3 §3.2]: "a visit to one place, at one position in one trip's sequence."
 *
 * `onTrip` is a plain `one Trip` field and `a3StopBelongsToOneTrip` states the rule over it anyway,
 * so that command C3b can drop the rule and show what it is holding up. A rule that is only ever a
 * field multiplicity cannot be counterfactualised, and then the check that it holds proves nothing.
 */
sig Stop {
  onTrip   : set Trip,
  visitedAt: one Instant
}

/**
 * [A3 §3.2] **StopAction (the join)** — "one act performed on one shipment (or on one `Portion` of
 * it) at one stop, naming exactly one shipment-or-portion and exactly one stop." It carries no
 * quantity ([SD §3], [A3 §3.1]).
 */
sig StopAction {
  atStop  : one Stop,
  onGoods : one (Shipment + Portion)
}

/**
 * A SIT occupancy. [SD §1.2] makes `stay` an aggregate with its own subject kind; [SD §7.4] gives
 * it a published identifier — `src:dtr-part-iv`'s **SIT control number**, "9 digits — `YY` + Julian
 * day of entry + a 4-digit sequence within that day", with "a split shipment [getting] its own SIT
 * control number per increment".
 */
sig Stay {}

/**
 * [SD §4.7.1]: `storeIn` and `storeOut` declare canonical subject family **`stay`**, with
 * "`shipment`/`portion`, `stop`, `trip`" in **`context[]`**.
 *
 * `contextGoods` is named for what it is. [SD §1.4] rules 1-3: `context[]` is never the subject,
 * never carries values, and is never the resolution key. So the only link from a stay to the goods
 * it holds is a non-authoritative one — see command C2c.
 */
sig StoreIn  { stay: one Stay, contextGoods: one (Shipment + Portion), at: one Instant }
sig StoreOut { stay: one Stay, contextGoods: one (Shipment + Portion), at: one Instant }

/* --------------------------------------------------------------------------------------------- *
 * The rules, each a named sentence of the binding layer
 * --------------------------------------------------------------------------------------------- */

/** [SD §3.1]: "a Portion never spans shipments", read over the enumerated membership as well as
 *  over the declared field — otherwise the two halves of one Portion can disagree. */
pred sd31PortionNeverSpansShipments {
  all p: Portion | p.members.ofShipment in p.ofShipment
}

/** [A3 §3.1]: "A `Stop` belongs to exactly one `Trip`." */
pred a3StopBelongsToOneTrip {
  all s: Stop | one s.onTrip
}

/**
 * [A3 §3.2]: a `StopAction` names "exactly one shipment-or-portion and exactly one stop", and
 * [A3 §3.1]: "A `Shipment` is joined to a `Trip` **only** through `StopAction`s."
 *
 * The consequence stated as a rule: an act about a Portion is an act about that Portion's shipment
 * and no other. [SD §3.2] **P-IDENTITY** — "A Portion never changes the shipment boundary" —
 * is what makes this safe to derive rather than assert.
 */
pred a3ActsReachOneShipment {
  all a: StopAction | one shipmentOf[a.onGoods]
}

pred bindingLayer {
  sd31PortionNeverSpansShipments
  a3StopBelongsToOneTrip
  a3ActsReachOneShipment
}

/* --------------------------------------------------------------------------------------------- *
 * Derived readings — folds, never stored
 * --------------------------------------------------------------------------------------------- */

/** The shipment a goods reference resolves to. [SD §3.1]: a Portion has exactly one. */
fun shipmentOf[g: Shipment + Portion] : set Shipment {
  (g & Shipment) + (g & Portion).ofShipment
}

/** Every act about these goods, and about any Portion of them — [A3 §3.2]'s StopAction join. */
fun actsAbout[s: Shipment] : set StopAction {
  { a: StopAction | s in shipmentOf[a.onGoods] }
}

/**
 * The trips a shipment is on at an instant.
 *
 * DERIVED (this module), and the derivation is [A3 §3.2]'s **shipment leg** — "one continuous span
 * in which one shipment is in one custody on one trip", which A3 defines as a fold over
 * `StopAction`s and is "**derived, never stored**" because "storing them is how they come to
 * disagree with the records". Read here as: the shipment is on the trip from its first act at a
 * stop of that trip to its last, inclusive.
 */
fun ridesAt[s: Shipment, i: Instant] : set Trip {
  { t: Trip |
      some a1, a2: actsAbout[s] |
        t in a1.atStop.onTrip and t in a2.atStop.onTrip and
        lte[a1.atStop.visitedAt, i] and lte[i, a2.atStop.visitedAt] }
}

/** A stay with a store-in and no store-out. [SD §4.7.1]: `storeOut` is "SIT release / handling-out". */
pred isOpen[y: Stay] {
  some i: StoreIn | i.stay = y
  no o: StoreOut | o.stay = y
}

/* --------------------------------------------------------------------------------------------- *
 * C0 — consistency. A module constrained into vacuity proves nothing.
 * --------------------------------------------------------------------------------------------- */

pred somethingHappens {
  bindingLayer
  some StopAction
  some Portion
  some Stay
}
run somethingHappens for 4 expect 1

/* --------------------------------------------------------------------------------------------- *
 * C1 — can a Portion belong to two Shipments?
 * --------------------------------------------------------------------------------------------- */

/**
 * [SD §3.1]: `shipment` is "exactly one; a Portion never spans shipments". The question is not
 * whether the declared field is single-valued — it is declared that way — but whether any *other*
 * route reaches a second shipment: the enumerated items, or the acts that name the Portion.
 */
assert noPortionReachesTwoShipments {
  bindingLayer implies all p: Portion | one (p.ofShipment + p.members.ofShipment)
}
check noPortionReachesTwoShipments for 5 expect 0

/**
 * C1b. What `sd31PortionNeverSpansShipments` is holding up. Drop that one reading and the declared
 * field still says one shipment while the enumerated membership names articles of another — one
 * Portion, two shipments, no rule broken at the field level. [SD §3.1]'s prose settles it; the
 * structure does not, so the prose is load-bearing and is recorded here as such.
 */
pred enumeratedMembershipEscapesTheDeclaredShipment {
  a3StopBelongsToOneTrip
  a3ActsReachOneShipment
  some p: Portion | some p.members and not (p.members.ofShipment in p.ofShipment)
}
run enumeratedMembershipEscapesTheDeclaredShipment for 5 expect 1

/**
 * C1c. [SD §3.2] **P-OVERLAP**: "Portions may overlap and may nest. 'The twelve items that went
 * into SIT' and 'the three of those refused on delivery-out' are both Portions, and the second is a
 * subset of the first. **[ORIGINAL]** — forbidding overlap would make the normal SIT case
 * inexpressible."
 */
pred portionsOverlapAndNest {
  bindingLayer
  some disj p1, p2: Portion | p2.members in p1.members and some p2.members and p1.members != p2.members
}
run portionsOverlapAndNest for 5 expect 1

/** C1d. Overlap is safe precisely because it cannot cross the shipment boundary. */
assert overlappingPortionsShareOneShipment {
  bindingLayer implies
    all disj p1, p2: Portion | some (p1.members & p2.members) implies p1.ofShipment = p2.ofShipment
}
check overlappingPortionsShareOneShipment for 5 expect 0

/* --------------------------------------------------------------------------------------------- *
 * C2 — can a Shipment hold two open Stays?
 * --------------------------------------------------------------------------------------------- */

/**
 * It must. [SD §5.3] consequence 1: "**Origin-side SIT and destination-side SIT both get this
 * treatment**, because both are `stay` subjects, and **a shipment may carry one of each
 * concurrently**" — with `src:sirva-ade`'s `ChangeSIT`/`DeleteSIT`, which "cannot say which of the
 * two [it] refers to", as the worked failure the stay grain exists to prevent.
 *
 * So `expect 1`: an absent instance would be a finding that the model cannot express a state the
 * binding layer declares normal.
 */
pred shipmentHoldsTwoOpenStays {
  bindingLayer
  some s: Shipment | some disj y1, y2: Stay |
    isOpen[y1] and isOpen[y2] and
    (some i1: StoreIn | i1.stay = y1 and s in shipmentOf[i1.contextGoods]) and
    (some i2: StoreIn | i2.stay = y2 and s in shipmentOf[i2.contextGoods])
}
run shipmentHoldsTwoOpenStays for 5 expect 1

/**
 * C2b. And the two are distinguishable, which is the whole argument for the grain. Every storage
 * record's **subject** is the stay ([SD §4.7.1]), so a release names `stay:X` and not "the SIT".
 * This is [SD §7.4]'s claim, checked: the failure it describes in a live partner contract cannot be
 * reproduced here.
 */
assert twoOpenStaysAreToldApartByTheirSubject {
  bindingLayer implies
    all disj y1, y2: Stay | all o: StoreOut | not (o.stay = y1 and o.stay = y2)
}
check twoOpenStaysAreToldApartByTheirSubject for 5 expect 0

/**
 * C2c. What the stay grain does **not** supply, recorded because it is load-bearing for anyone
 * reading a stay back.
 *
 * Every published route from a stay to the goods it holds runs through `context[]` — [SD §4.7.1]
 * gives `storeIn`/`storeOut`/`sitEntryDate` the `stay` family with "`shipment`/`portion`" in the
 * context column — and [SD §1.4] makes `context[]` non-authoritative, valueless and never the
 * resolution key. So "which goods are in stay X" is not an asserted fact about anything, and two
 * open stays can name the same shipment with nothing published that says which holds what.
 *
 * TODO(A5 / [SD §10.4]): the storage area owns the stay's internal structure, and [SD §10.4]
 * leaves "whether a terminated stay that moves onward is a new shipment" explicitly unsettled. The
 * goods-side binding is owed there, not decided here — [SD §4.7] is the only declaration and "no
 * other document may declare a family".
 */
pred twoOpenStaysNameOneShipmentThroughContextOnly {
  bindingLayer
  some s: Shipment | some disj y1, y2: Stay |
    isOpen[y1] and isOpen[y2] and
    (all i: StoreIn | i.stay in (y1 + y2) implies s in shipmentOf[i.contextGoods])
}
run twoOpenStaysNameOneShipmentThroughContextOnly for 5 expect 1

/* --------------------------------------------------------------------------------------------- *
 * C3 — can a Stop belong to two Trips?
 * --------------------------------------------------------------------------------------------- */

/** [A3 §3.1]: "A `Stop` belongs to exactly one `Trip`. A `Shipment` never owns a `Stop`." */
assert stopBelongsToExactlyOneTrip {
  bindingLayer implies all s: Stop | one s.onTrip
}
check stopBelongsToExactlyOneTrip for 5 expect 0

/**
 * C3b. The counterfactual, which is why the rule is worth stating rather than assuming.
 *
 * Drop [A3 §3.1] and one act at one shared stop puts the shipment on two trips — so the derived
 * reads A3 exists to serve ("which trips did this shipment ride", and the manifest, [A3 §3.3])
 * answer with a trip nobody dispatched the goods onto. A3's second weighted criterion is exactly
 * this: "a model that puts the stop on the shipment is repaired by re-keying every published
 * record" ([A3 §3.4]).
 */
pred oneActPutsAShipmentOnTwoTrips {
  sd31PortionNeverSpansShipments
  a3ActsReachOneShipment
  some a: StopAction | #(a.atStop.onTrip) > 1
}
run oneActPutsAShipmentOnTwoTrips for 5 expect 1

/* --------------------------------------------------------------------------------------------- *
 * C4 — can a shipment ride two trips at the same instant?
 * --------------------------------------------------------------------------------------------- */

/**
 * It must. [A3 §3.3]'s **Overflow** row: "Two `load` acts naming two `Portion`s on **two different
 * trips**. One shipment, two vehicles." `src:sirva-ade` names the operational case and its
 * `Overflow` event "carries the portion's `Weight` and nothing else — a `MEASURED` Portion,
 * exactly".
 *
 * [SD §4.6.1] (c) counts the same case among the reasons E-CANON refuses to re-key: "Split
 * delivery, overflow riding two trips (§3.3), origin-side and destination-side SIT on one shipment
 * — cardinality ≠ 1 is the normal HHG case."
 */
pred shipmentRidesTwoTripsAtOneInstantViaPortions {
  bindingLayer
  some s: Shipment, i: Instant |
    #(ridesAt[s, i]) > 1 and (all a: actsAbout[s] | a.onGoods in Portion)
}
run shipmentRidesTwoTripsAtOneInstantViaPortions for 6 expect 1

/**
 * C4b. And the same state with the acts naming the **whole shipment** rather than Portions of it.
 *
 * Physically this is the one that cannot happen — the whole of a shipment is not on two vans at
 * once — and no published rule excludes it. [A3 §3.3] narrates overflow with Portions but states
 * no constraint; [SD §2.3] invariant 3 is the nearest rule and governs the scope of **one act**
 * ("One act, one outcome, one occurrence time"), not the membership of goods on two trips.
 *
 * Recorded as admissible rather than repaired here: the remedy would be a new rule, and [SD §4.7]
 * and [SD §10] reserve rule-making to the binding layer.
 *
 * TODO([A3 §5.8] / A5): a membership rule of the form "a shipment's whole-goods memberships must
 * not overlap in time, and an overflow is a Portion" would close it, and belongs in the membership
 * lifecycle rather than here.
 */
pred wholeShipmentRidesTwoTripsAtOneInstant {
  bindingLayer
  some s: Shipment, i: Instant |
    #(ridesAt[s, i]) > 1 and (all a: actsAbout[s] | a.onGoods = s)
}
run wholeShipmentRidesTwoTripsAtOneInstant for 6 expect 1

/**
 * C4c. Riding two trips at one instant does not put one Stop on two Trips, and does not give one
 * act two shipments. The two cardinality rules that must survive the case, checked together with
 * it rather than in isolation — a rule that holds only in the easy states is not a rule.
 */
assert ridingTwoTripsBreaksNeitherCardinalityRule {
  (bindingLayer and (some s: Shipment, i: Instant | #(ridesAt[s, i]) > 1)) implies
    ((all st: Stop | one st.onTrip) and (all a: StopAction | one shipmentOf[a.onGoods]))
}
check ridingTwoTripsBreaksNeitherCardinalityRule for 6 expect 0
