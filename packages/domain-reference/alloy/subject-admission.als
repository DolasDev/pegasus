/*
 * subject-admission.als — E-CANON at the boundary.
 *
 *   1. Under E-CANON-STRICT, is every admitted record's subject in its type's family?
 *   2. Is there a record shape that admits under one rule and rejects under another?
 *
 * The declaration under test is [SD §4.7.1]'s canonical-subject table, which [SD §1.3] makes "the
 * **complete** declaration" and [SD §4.7] makes binding: "It is the shared layer's, and it outranks
 * any per-document restatement." It is transcribed here in full rather than sampled, because a
 * partial transcription would answer question 1 about a table that does not exist.
 *
 * The three rules sit at three different places and this module keeps them apart, because that
 * separation is the decision ([SD §4.6.2]): E-CANON-RESOLVE runs **before** the boundary,
 * E-CANON-STRICT **is** the boundary, and E-CANON-OBLIGATION governs what is kept outside it.
 */
module subjectAdmission

/* --------------------------------------------------------------------------------------------- *
 * [SD §1.2] — the aggregate enum, "a versioned closed enum, open to addition in a later
 * `specVersion`, never to reinterpretation". Fourteen members.
 *
 * `custody` is deliberately not one: "its absence is a decision rather than an omission"
 * ([SD §1.2], [SD §4.8]) — Custody is the fold `custodyAt(goods, instant)`, see custody.als.
 * --------------------------------------------------------------------------------------------- */

abstract sig Kind {}
one sig K_order, K_shipment, K_portion, K_stay, K_trip, K_stop, K_stopAction,
        K_assignment, K_partyRole, K_item, K_charge, K_resource, K_document,
        K_externallyPerformedLeg extends Kind {}

/* --------------------------------------------------------------------------------------------- *
 * [SD §4.7] note 2 — the families. "A family is a named, closed set of `aggregate` kinds — usually
 * a singleton." Three are not, and each is argued where it is declared.
 * --------------------------------------------------------------------------------------------- */

/** [SD §8.2] — "which is what lets an arrival be asserted about a leg performed by someone whose
 *  journey we cannot see". */
fun F_stop : set Kind { K_stop + K_externallyPerformedLeg }

/** [SD §3.3] — "which is what lets a separately-timed act name a Portion directly". The family and
 *  its name are **[ORIGINAL]** ([SD §4.7] note 2). */
fun F_goods : set Kind { K_shipment + K_portion }

/** [SD §7.1]: "`subject` may be **any** aggregate kind." Named `anyAggregate` in `vocabulary.ts`;
 *  [SD §4.7] describes it as "the whole `aggregate` enum" without naming it. */
fun F_anyAggregate : set Kind { Kind }

fun F_stay       : set Kind { K_stay }
fun F_item       : set Kind { K_item }
fun F_charge     : set Kind { K_charge }
fun F_trip       : set Kind { K_trip }
fun F_stopAction : set Kind { K_stopAction }
fun F_assignment : set Kind { K_assignment }
fun F_order      : set Kind { K_order }
fun F_partyRole  : set Kind { K_partyRole }

/** The eleven declared families, as a set of sets is not expressible — so as the test that a
 *  declared member-set is one of them. Used by command S1. */
pred isADeclaredFamily[m: set Kind] {
  m = F_stop or m = F_goods or m = F_stay or m = F_item or m = F_charge or
  m = F_trip or m = F_stopAction or m = F_assignment or m = F_order or
  m = F_partyRole or m = F_anyAggregate
}

/* --------------------------------------------------------------------------------------------- *
 * [SD §4.7.1] — the table. `family` holds the member set the row declares.
 *
 * Note 5: "The spellings in the first column are the vocabulary; the rest are prose aliases and
 * must not appear in a record." `weight.net` etc. are spelled `T_weightNet` here only because
 * Alloy has no dotted identifiers.
 * --------------------------------------------------------------------------------------------- */

abstract sig Type { family: set Kind }

/* Time facts about a visit — not acts ([SD §4.7.1] last row): "they are time facts about a
 * _visit_, which is why their family is `stop` and why M5 lets a geofence assert them while M2/M3
 * forbid a geofence asserting any act in this row." */
one sig T_arrival   extends Type {} { family = F_stop }
one sig T_departure extends Type {} { family = F_stop }

/* The seven goods-side acts. */
one sig T_packing   extends Type {} { family = F_goods }
one sig T_loading   extends Type {} { family = F_goods }
one sig T_unloading extends Type {} { family = F_goods }
one sig T_delivery  extends Type {} { family = F_goods }
one sig T_handover  extends Type {} { family = F_goods }

/* Measures and counts about the goods. `weight.tare` is the **consignment's** and never the
 * equipment's ([SD §4.7.2c]); the equipment's own tare is a `resource`-subject fact needing its
 * own `type`, left owed at [SD §4.7.3]. */
one sig T_weightNet   extends Type {} { family = F_goods }
one sig T_weightGross extends Type {} { family = F_goods }
one sig T_weightTare  extends Type {} { family = F_goods }
one sig T_pieceCount  extends Type {} { family = F_goods }

/* The storage stay. [SD §5.3]: `storeIn` and `sitEntryDate` are two fact classes, not one. */
one sig T_storeIn      extends Type {} { family = F_stay }
one sig T_sitEntryDate extends Type {} { family = F_stay }
one sig T_storeOut     extends Type {} { family = F_stay }

/* [SD §5.4]: a value **per article** is an `item`-subject fact; a scope of an act is a Portion. */
one sig T_condition extends Type {} { family = F_item }

/* [SD §7.1] I-KEY. `boundBy = SCHEME`: "authority never moves." */
one sig T_identity extends Type {} { family = F_anyAggregate }

one sig T_charge extends Type {} { family = F_charge }

/* [SD §4.7.3] provisional: "no source fixes a subject for either". */
one sig T_notification extends Type {} { family = F_goods }
one sig T_partyRole    extends Type {} { family = F_partyRole }

/* The nine aggregate-lifecycle members; subjects quoted from [A3 §3.2] ([SD §4.7.2d]). */
one sig T_tripDelay         extends Type {} { family = F_trip }
one sig T_tripResequence    extends Type {} { family = F_trip }
one sig T_tripCancellation  extends Type {} { family = F_trip }
one sig T_membershipOffer   extends Type {} { family = F_stopAction }
one sig T_membershipResponse extends Type {} { family = F_stopAction }
one sig T_membershipRelease extends Type {} { family = F_stopAction }
one sig T_assignmentOffer   extends Type {} { family = F_assignment }
one sig T_assignmentResponse extends Type {} { family = F_assignment }
one sig T_assignmentRelease extends Type {} { family = F_assignment }

/* [SD §4.7.2e] minted rather than deferred, because [SD §1] and [fork-order §3.1] require them —
 * without a row "a binding document was specifying a record that could not be published." */
one sig T_orderAward        extends Type {} { family = F_order }
one sig T_orderResponse     extends Type {} { family = F_order }
one sig T_orderCancellation extends Type {} { family = F_order }

/* --------------------------------------------------------------------------------------------- *
 * Subjects and submissions
 * --------------------------------------------------------------------------------------------- */

/**
 * [SD §1.2] `SubjectRef {aggregate, id}`. [SD §1.1] forbids a subject **path** permanently — "a
 * path presumes a containment hierarchy, and the hierarchy is exactly what the three documents
 * disagree about" — so `partOf` is not a path: it is the Portion's own `shipment` field
 * ([SD §3.1]), read here only by command S4b.
 */
sig Subject {
  kind  : one Kind,
  partOf: lone Subject
}

fact portionsAreTheOnlyThingInsideAShipment {
  // [SD §3.1]: a Portion names "exactly one" shipment and never spans shipments.
  all s: Subject | some s.partOf implies (s.kind = K_portion and s.partOf.kind = K_shipment)
  all s: Subject | s.kind = K_portion implies one s.partOf
}

/**
 * A claim as it arrives, **before** the boundary — [SD §4.6.2].
 *
 * `resolvedTo` is what a published, versioned **subject-resolution rule** returned, where one was
 * attempted. [SD §4.6.2] E-CANON-RESOLVE: the rule "must return **exactly one** candidate"; "Where
 * it yields zero or more than one, resolution **fails** and E-CANON-STRICT applies." So a `lone`
 * field is the successful case and its absence covers both failures.
 */
sig Submission {
  ty          : one Type,
  namedSubject: one Subject,
  resolvedTo  : lone Subject
}

/**
 * **Rule E-CANON-STRICT** — [SD §4.6.2]: "The admission check is purely structural: is
 * `subject.aggregate` a member of the family declared for `type` at this `specVersion`?"
 */
pred admits[t: Type, s: Subject] {
  s.kind in t.family
}

/**
 * Ingest as `src/rules/e-canon.ts` composes it: the boundary first, then resolution for what the
 * boundary refused.
 *
 * Note what this does **not** do: re-run the boundary on the re-phrased subject. In the TypeScript
 * that is safe because `AttemptedResolution.candidates` is typed
 * `SubjectRef<CanonicalSubjectKind<T>>[]`, so a non-canonical candidate does not compile. The
 * guarantee is carried entirely by the type. Command S3 is what that costs when the type is not
 * there — which is the situation of every partner and every operator keying a subject by hand.
 */
fun admittedSubject[sub: Submission] : lone Subject {
  admits[sub.ty, sub.namedSubject] => sub.namedSubject else sub.resolvedTo
}

/** The same pipeline with E-CANON-STRICT applied to the re-phrased record as well, which is what
 *  [SD §4.6.2] says happens — re-phrasing is "an ingest-side act, performed **before** the
 *  boundary", so the boundary still runs on what it produces. */
fun admittedSubjectWithBoundaryRecheck[sub: Submission] : lone Subject {
  admits[sub.ty, sub.namedSubject] => sub.namedSubject
    else ((some sub.resolvedTo and admits[sub.ty, sub.resolvedTo]) => sub.resolvedTo else none)
}

/* --------------------------------------------------------------------------------------------- *
 * S0 — consistency
 * --------------------------------------------------------------------------------------------- */

pred somethingIsAdmitted {
  some sub: Submission | some admittedSubjectWithBoundaryRecheck[sub]
}
run somethingIsAdmitted for 4 expect 1

/* --------------------------------------------------------------------------------------------- *
 * S1 — is the transcribed table well-formed?
 * --------------------------------------------------------------------------------------------- */

/**
 * [SD §4.7] note 2: "Every family is a singleton except three." A row declaring an ad-hoc member
 * set rather than one of the eleven families would make E-CANON's "exactly one family" arity false
 * without any record being malformed, so the table is checked before it is used.
 */
assert everyTypeDeclaresOneOfTheElevenFamilies {
  all t: Type | isADeclaredFamily[t.family]
}
check everyTypeDeclaresOneOfTheElevenFamilies for 4 expect 0

/**
 * S1b. Every aggregate kind is reachable as some type's subject — so no kind is declared in
 * [SD §1.2] and then unable to be asserted about. It holds only because `identity`'s family is the
 * whole enum ([SD §7.1]), which is worth knowing: `resource` and `document` have **no other** row
 * in [SD §4.7.1], so the only fact anyone may assert about a vehicle or a weight ticket is its
 * identity. [SD §4.7.3] records the missing rows as owed — "the equipment's own tare weight… a
 * `resource`-subject fact needing its own `type`".
 */
assert everyAggregateKindCanBeSomeTypesSubject {
  all k: Kind | some t: Type | k in t.family
}
check everyAggregateKindCanBeSomeTypesSubject for 4 expect 0

/* --------------------------------------------------------------------------------------------- *
 * S2 — is every admitted record's subject in its type's family?
 * --------------------------------------------------------------------------------------------- */

/**
 * [SD §4.6.2] E-CANON-STRICT, as the invariant it is meant to be: nothing reaches the catalog whose
 * subject kind is outside the family its type declares. "It acquires no `eventId`, is filed under
 * no fact key, and enters no contest."
 */
assert everyAdmittedSubjectIsInItsTypesFamily {
  all sub: Submission |
    some admittedSubjectWithBoundaryRecheck[sub] implies
      admits[sub.ty, admittedSubjectWithBoundaryRecheck[sub]]
}
check everyAdmittedSubjectIsInItsTypesFamily for 5 expect 0

/**
 * S3. The same question of the pipeline **without** the re-check — the shape `ingest()` in
 * `src/rules/e-canon.ts` actually has, where the resolved candidate is admitted on the strength of
 * its static type alone.
 *
 * An instance is a record in the catalog whose subject kind is outside its type's declared family,
 * arriving by the one door [SD §4.6.1] (a) says must stay shut: "A re-key is a fact the boundary is
 * not entitled to assert… A boundary re-key has none of the three [`assertedBy`, `assertedAt`,
 * `capturedBy`]. **M1 already forbids this exact shape** — a value nobody asserted, published as
 * though somebody had."
 *
 * Reported, not repaired: the repair is a runtime check in `e-canon.ts`, and this module does not
 * edit the package it is checking.
 *
 * TODO(`src/rules/e-canon.ts`): have `ingest` re-run `admitAtBoundary` on the re-phrased submission
 * so E-CANON-STRICT is enforced by the boundary rather than by `CanonicalSubjectKind<T>`.
 */
pred resolutionCanSmuggleANonCanonicalSubjectPastTheBoundary {
  some sub: Submission |
    not admits[sub.ty, sub.namedSubject] and
    some sub.resolvedTo and
    not admits[sub.ty, sub.resolvedTo] and
    some admittedSubject[sub]
}
run resolutionCanSmuggleANonCanonicalSubjectPastTheBoundary for 4 expect 1

/* --------------------------------------------------------------------------------------------- *
 * S4 — a record shape that admits under one rule and rejects under another
 * --------------------------------------------------------------------------------------------- */

/**
 * S4a. The intended case, and it is worth pinning down as intended rather than as a defect.
 *
 * One subject admits under one type and is refused under another, because [SD §1.3] item 5 divides
 * the labour: "E-TYPE governs the vocabulary; E-CANON governs the subject… that `type` fixes what
 * the record may be about." [SD §4.6.3]'s two worked cases are both of this shape and run in
 * opposite directions — the agent's `arrival` on `shipment:S`, and the driver's `delivery` on
 * `stop:T` — which is the sentence that stops E-CANON being read as a partner-hygiene rule:
 * "**both of our own first-party producers hit it, in opposite directions.**"
 */
pred oneSubjectAdmitsUnderOneTypeAndIsRefusedUnderAnother {
  some s: Subject, disj t1, t2: Type | admits[t1, s] and not admits[t2, s]
}
run oneSubjectAdmitsUnderOneTypeAndIsRefusedUnderAnother for 4 expect 1

/**
 * S4b. **The finding.** A record pair that E-CANON-STRICT admits and [SD §2.3] invariant 3
 * forbids — two rules of the same binding layer, disagreeing about one shape, with only one of
 * them enforceable at the boundary.
 *
 * The shape: a `delivery` whose subject is `shipment:S`, and a `delivery` whose subject is
 * `portion:P` of that same S, both at one instant and one stop.
 *
 * - **E-CANON-STRICT admits both.** `delivery` declares family `goods` = {shipment, portion}
 *   ([SD §4.7.1]) and both kinds are members. The admission check "is purely structural"
 *   ([SD §4.6.2]) and has no access to the instant, the stop, or the containment between the two
 *   subjects.
 * - **[SD §2.3] invariant 3 forbids the pair.** "One act, one outcome, one occurrence time. Where a
 *   single visit produced two different outcomes over two subsets of the goods, it is **one** act on
 *   the shipment with `outcome = PARTIALLY_COMPLETED` and the shortfall named by a `Portion` in
 *   `reasons[].appliesTo`. **Sibling acts on Portions are the required form only when the acts
 *   happened at different stops or different times.**" [SD §3.4] states the same requirement as the
 *   required form for "delivered, two items short": "Not two acts (that double-counts the visit and
 *   erases the fact that a delivery happened)."
 * - **And the fact key cannot reconcile them after the fact.** The key is `(subject, type,
 *   qualifier?)` ([SD §1.3]) and `delivery` declares no qualifier, so `(shipment:S, delivery)` and
 *   `(portion:P, delivery)` are two keys, two contests and two `FactResolved` records. The two
 *   claims never meet, and [SD §4.3]'s "`considered[]` names every assertion in the contest" is
 *   satisfied by each of them separately while the double count survives.
 *
 * So invariant 3 is a well-formedness rule with no admission rule behind it, and [SD §4.6.2]'s
 * boundary is by its own definition unable to acquire one — it is "purely structural" and this
 * defect is not structural.
 *
 * TODO([SD §2.3] / [SD §4.6.2]): either invariant 3 names the rule that enforces it and where it
 * runs, or the model accepts that a visit can be double-counted across two fact keys. This module
 * does not choose; [SD §4.7] and [SD §10] reserve rule-making to the binding layer.
 */
pred bothKeysAdmitAndInvariant3ForbidsThePair {
  some sub1, sub2: Submission |
    sub1 != sub2 and
    sub1.ty = T_delivery and sub2.ty = T_delivery and
    sub1.namedSubject.kind = K_shipment and
    sub2.namedSubject.kind = K_portion and
    sub2.namedSubject.partOf = sub1.namedSubject and
    some admittedSubjectWithBoundaryRecheck[sub1] and
    some admittedSubjectWithBoundaryRecheck[sub2]
}
run bothKeysAdmitAndInvariant3ForbidsThePair for 4 expect 1

/**
 * S4c. The same shape under `condition`, which is the control that shows S4b is about the `goods`
 * family rather than about containment in general.
 *
 * `condition` declares family `item` — "singleton — a value **per article**, [SD §5.4]" — so a
 * condition asserted about a Portion is never filed under the Portion and the ambiguity cannot
 * arise. [SD §5.4] is the rule that puts it there: "If the fact has a value _per article_, its
 * subject is the `item` and no Portion is minted."
 *
 * Stated as "never admitted **as named**" rather than "never admitted", because ingest may still
 * re-phrase it onto an article — that is what E-CANON-RESOLVE is for, and the re-phrased record is
 * an `item`-subject one ([SD §4.6.2]).
 */
assert conditionAboutAPortionIsNeverAdmittedAsNamed {
  all sub: Submission |
    (sub.ty = T_condition and sub.namedSubject.kind = K_portion) implies
      admittedSubjectWithBoundaryRecheck[sub] != sub.namedSubject
}
check conditionAboutAPortionIsNeverAdmittedAsNamed for 4 expect 0
