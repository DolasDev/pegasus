/**
 * `(outcome, reason)` on every act — [SD §2].
 *
 * > "Every record that asserts the performance of an act carries an `outcome` from a five-member
 * > enum and, unless the outcome is `COMPLETED`, at least one structured `reason`. The event
 * > `type` names the act and never the outcome." — [SD §2]
 *
 * [SD §2] is a **[SYNTHESIS]** of two grade-A sources (`src:shippeo`'s situation/justification
 * grid and `src:open-trip-model`'s result enum) and is written up as one. The parts this module
 * carries that are authored are marked where they occur.
 */

import type { SubjectRef } from './envelope'
import type { PartyId } from './ids'
import type { Exact, Instant, NonEmptyArray, Owed, OwedCode } from './primitives'
import { assertNever } from './primitives'

/**
 * [SD §2.2]. Five members rather than OTM's four "because `COMPLETED_WITH_EXCEPTION` and
 * `PARTIALLY_COMPLETED` differ in **scope of performance**, and that difference is a billing and
 * claims difference, not a shade of meaning."
 */
export const OUTCOMES = [
  /**
   * The act was performed in full, with nothing to report. [SD §2.3] invariant 2 **forbids**
   * `reasons[]` here, and only here: **[ORIGINAL]** in [SD §2.3], "collapsing `CFM` into
   * `COMPLETED` and forbidding a reason there" normalises Shippeo, which always pairs a situation
   * with a justification.
   */
  'COMPLETED',
  /** [SD §2.2] **[ORIGINAL]**: rendering Shippeo's `LIV/RCA` (delivered-with-damage-accepted, which
   * sits under the _completed_ situation) as its own outcome member rather than `COMPLETED` + a
   * reason. */
  'COMPLETED_WITH_EXCEPTION',
  /**
   * The act reached **part** of its scope. [SD §2.2] keeps it apart from
   * `COMPLETED_WITH_EXCEPTION` because the two "differ in **scope of performance**, and that
   * difference is a billing and claims difference, not a shade of meaning". The scope itself is a
   * Portion named in `reasons[].appliesTo` — [SD §3.4]'s required form for "delivered, two items
   * short".
   */
  'PARTIALLY_COMPLETED',
  /**
   * The act did not happen. [SD §2.5] and [SD §2.6]: an **attempted** delivery is `type = delivery`
   * at this outcome with at least one reason, which is why the vocabulary needs no `attempt` type
   * and may not have one (**A-TYPE**).
   */
  'NOT_COMPLETED',
  /**
   * The act was called off. Distinct from `NOT_COMPLETED`, which is a performance that failed.
   * [SD §2.2] takes the five-member enum from `src:open-trip-model`'s result enum plus Shippeo's
   * situation/justification grid.
   */
  'CANCELLED',
] as const

export type Outcome = (typeof OUTCOMES)[number]

/** Every outcome that is not `COMPLETED` — i.e. every outcome that requires a reason. */
export type ExceptionalOutcome = Exclude<Outcome, 'COMPLETED'>

/**
 * [SD §2.4] `Reason.scope` — **[ORIGINAL]**.
 *
 * "It exists so a consumer can separate 'something is wrong with the goods' from 'something is
 * wrong with the site' without reading a code list, and because HHG's authoring gap is
 * concentrated in `SITE` and `ADMINISTRATIVE` — shuttle required, long carry, elevator
 * unavailable, parking permit, COI not on file — none of which Shippeo has."
 */
export const REASON_SCOPES = [
  /**
   * Something is wrong with **the act itself** — its timing, its sequence, its performance.
   * **[ORIGINAL]**: [SD §2.4] marks the whole `scope` axis authored and gives its purpose and its
   * HHG examples; it defines no member individually, so the gloss is this model's.
   */
  'ACT',
  /**
   * Something is wrong with **the goods** — damage, shortage, an item refused. **[ORIGINAL]**, as
   * `ACT`: [SD §2.4] authors the axis and not the member.
   */
  'GOODS',
  /**
   * Something is wrong on **a party's** side — the customer absent, the counterparty unready.
   * **[ORIGINAL]**, as `ACT`. `src:stedi-x12-reference` element 1651's 86 values are organised by
   * responsible party, which is the _fact_ [SD §2.4] rule 6 sources; the attribution itself rides
   * `Reason.attribution` rather than this axis.
   */
  'PARTY',
  /**
   * Something is wrong with **the equipment or crew** — a breakdown, a missing shuttle vehicle.
   * **[ORIGINAL]**, as `ACT`: [SD §2.4] authors the axis and not the member.
   */
  'RESOURCE',
  /**
   * Something is wrong with **the site** — shuttle required, long carry, elevator unavailable,
   * parking permit. [SD §2.4] names these as half of the HHG authoring gap: "none of which Shippeo
   * has". **[ORIGINAL]**, as `ACT`.
   */
  'SITE',
  /**
   * Something is wrong on **paper** — COI not on file, an authorisation missing. The other half of
   * [SD §2.4]'s HHG authoring gap. **[ORIGINAL]**, as `ACT`.
   */
  'ADMINISTRATIVE',
] as const

export type ReasonScope = (typeof REASON_SCOPES)[number]

/**
 * The published reason vocabulary — the list [SD §2.4] fixed the shape of and left to this area:
 * "the list itself is A4's job". See [A4 §3] for the evidence table and [A4 §4] for what was
 * deliberately collapsed or refused.
 *
 * Twenty-three members, which is [SD §2.4] rule 2's **magnitude** ("~20 reasons × 5 outcomes, not
 * ~100 types") rather than a quota. Every member is orthogonal to the outcome (rule 1) and
 * grain-independent (rule 4): the same code appears under several outcomes, and it does not change
 * when the subject changes grain. {@link ReasonCodesAreOutcomeFree} is rule 1's mechanical half.
 *
 * `OTHER` is deliberately **not** a member — it is declared by the shape itself ([SD §2.4] rule 3)
 * and carries an obligation the others do not. See {@link REASON_CODE_OTHER}.
 *
 * Each member's default scope, attribution discipline, remedy obligation, marker and citations are
 * declared once in `data/reasons.json` and cross-checked against this list as a **set** by
 * `loadReasonVocabulary`: a code in one place and not the other is a defect, not a widening. The
 * docstrings here carry the evidence; the table carries the discipline.
 */
export const REASON_CODES = [
  /**
   * The goods, or some of them, are damaged — default scope `GOODS`.
   *
   * The worked proof of [SD §2.4] rule 1. `src:shippeo` publishes damage under **two** situations —
   * `LIV/RCA` "not conform (damage), accepted with damage" and `REN/AVA` "damage, refused for
   * damage" — and its analysis calls the pair "the HHG claims hook. Whether the shipper took the
   * damaged item changes the claim, not just the note." One code, two outcomes:
   * `COMPLETED_WITH_EXCEPTION` and `NOT_COMPLETED`. Corroborated by `src:macropoint` `x014 Damaged`,
   * `src:open-trip-model` 5.7 `damage`, `src:uncefact-rec24` 97 `Damage_surveyed`, and
   * `src:cfr-49-375` §375.503(d), which gives the shipper the opportunity to note damage in writing
   * at delivery.
   */
  'GOODS_DAMAGED',
  /**
   * Goods the act expected to handle are not accounted for — default scope `GOODS`.
   *
   * Where `src:shippeo`'s `MQP` "partially missing package" and `MQT` "entirely missing package"
   * **collapse into one code**, deliberately: the magnitude is the difference between
   * `PARTIALLY_COMPLETED` and `NOT_COMPLETED` on the outcome axis and the extent is named by
   * `appliesTo` ([SD §3.4]), so two codes would carry magnitude on both axes at once.
   * **[SYNTHESIS]** — both codes are Shippeo's; the collapse is ours ([A4 §4.1]).
   *
   * Sourced widely: `src:stedi-x12-reference` element 1651 `S1 Delivery Shortage`;
   * `src:uncefact-rec24` 283 `Delivery_refused_delivery_incomplete`, 285
   * `Delivery_refused_remainder_not_accepted` and 330 `Consignment_partially_lost_or_missing`;
   * `src:open-trip-model` 5.7 `incomplete`; and `src:cfr-49-375` §375.503(d), the shipper's
   * opportunity "to note missing articles… in writing".
   */
  'GOODS_MISSING',
  /**
   * The goods were not in a state that allowed the act to proceed — default scope `GOODS`.
   *
   * `src:shippeo`'s `ENE/MQP` and `ENE/MQT` `ORDER_NOT_LOADED_*_MISSING` read across to household
   * goods as a near-transfer its analysis states in those terms: "Shippeo means 'the packages
   * weren't there'; HHG means 'the customer hasn't finished packing'. Same shape, needs its own
   * label." `src:macropoint` `x025` "Rework needed: parcel/pallet not sealed or wrapped securely"
   * is the same concept with the HHG reading spelled out in its analysis — customer-packed cartons
   * unsealed or unlabelled, items not disassembled as agreed. Also `src:uncefact-rec24` 190
   * `Waiting_for_cargo`. Declared at [A4 §3]; kept apart from `PARTY_NOT_READY` there.
   */
  'GOODS_NOT_READY',
  /**
   * Goods have left custody other than by delivery — default scope `GOODS`.
   *
   * Kept apart from {@link REASON_CODES} member `GOODS_MISSING` because the sources keep it apart
   * and because the claims path differs: `GOODS_MISSING` is *unaccounted for* at the act, which is
   * frequently resolved when the items surface in storage; this is a **determined** loss from
   * custody. `src:macropoint` `x015 Thefts` exists only under its `3xxx` undeliverable and `5xxx`
   * returning outcomes, never under a delay, which is the same distinction.
   * `src:uncefact-rec24` publishes both, as 329 `Consignment_partially_stolen` beside 330
   * `Consignment_partially_lost_or_missing`. Both members are declared at [A4 §3].
   */
  'GOODS_LOST_OR_STOLEN',
  /**
   * More goods than the equipment assigned to the act can take — default scope `RESOURCE`.
   *
   * `src:sirva-ade`'s `Overflow` event is the van-line-native name, and it "carries `Weight` — the
   * weight of the overflow portion — and nothing else" ([SD §3.2]), which is also why an overflow
   * Portion is minted `MEASURED` under **P-MEMBER**. `src:macropoint` `x028` "Delivery vehicle
   * capacity limitation" is the nearest freight analogue and its analysis names it "the closest
   * thing in **either** source to HHG's shuttle-and-overflow family… even though HHG needs it split
   * three ways (won't fit the van; van can't reach the residence; second trip required)". This code
   * is the first of those three; the second is `SITE_INACCESSIBLE`; the third is a Portion, not a
   * reason.
   *
   * Scope is `RESOURCE` and not `GOODS` **[ORIGINAL]**: nothing is wrong with the goods, and the
   * side that can be remedied is the equipment. Also `src:stedi-x12-reference` element 1651
   * `BQ Shipment Overweight` and `AV Exceeds Service Limitations`.
   */
  'OVERFLOW',
  /**
   * A party the act required on site was not there, or could not be reached — default scope
   * `PARTY`, and the most common household-goods delivery failure there is.
   *
   * `src:shippeo` `REN/DAF` "consignee closed or absent", which its analysis calls "the single most
   * common HHG delivery failure. One-for-one." Regulation-grade twice over: `src:dp3-400ng`
   * Item 17-1's **attempted delivery** — a delivery run that fails through no fault of the TSP, with
   * one hour of free waiting time to locate the customer — and `src:dtr-part-iv` §D.5.b(2)'s "two
   * documented contact attempts 6 h apart". Also `src:uncefact-rec24` 269 consignee absent, 317
   * premises closed in normal hours and 243 no recipient contact;
   * `src:stedi-x12-reference` element 1651 `B1 Consignee Closed`, `A5 Unable to Locate`,
   * `AQ Recipient Unavailable - Delivery Delayed`; `src:macropoint` `x012`;
   * `src:open-trip-model` 5.7 `receiverAbsent`.
   *
   * Carries a **required remedy**: [SD §2.4] rule 5's sourced case is exactly this one, "a failed
   * delivery that does not say when it will be retried is an incomplete record".
   */
  'PARTY_ABSENT',
  /**
   * A party declined to permit the act, or to accept what it delivered — default scope `PARTY`.
   *
   * Not an outcome. `src:shippeo` puts refusal on the **justification** axis, splitting `NJU` "not
   * justified by carrier" from `DIV` "by the counterparty", and its analysis takes that split as
   * "fault attribution on the reason itself… cheap and load-bearing for who pays" — which is what
   * [SD §2.4] rule 6 lifts into `attribution` instead of into the code.
   * `src:uncefact-rec24` carries 22 distinct `Delivery_refused_*` codes, including 281 refused
   * pending instructions. Also `src:stedi-x12-reference` element 1651 `BS Refused by Customer`,
   * `src:macropoint` `x013`, `src:open-trip-model` 5.7 `rejectedByReceiver`.
   */
  'PARTY_REFUSED',
  /**
   * A party moved the appointment — default scope `PARTY`. The **time** half of the pair it forms
   * with `INSTRUCTED_CHANGE`, which is the place-or-pattern half.
   *
   * `src:shippeo` `REN/NRV` `APPOINTMENT_UNLOAD_TAKEN`, whose analysis notes that "the exception
   * carries its own remedy. HHG delivery attempts almost always end in a new appointment; making
   * the new window part of the exception event is exactly right." `src:macropoint` `x023` "Request
   * for change of delivery date" and `x024` "Request for appointment", the first of which its
   * analysis calls "extremely common in HHG — the delivery spread exists precisely because this
   * happens". Also `src:stedi-x12-reference` element 1651 `AD Customer Requested Future Delivery`,
   * `BJ Customer Wanted Earlier Delivery` and `HB Held Pending Appointment`; and `src:dp3-400ng`
   * Item 17-1.3.a, which obliges the TSP to publish the agreed date within two hours.
   *
   * Carries a **required remedy**, on [SD §2.4] rule 5, for the same reason `PARTY_ABSENT` does.
   */
  'PARTY_RESCHEDULED',
  /**
   * A party was present but not ready, so the act waited or could not proceed — default scope
   * `PARTY`.
   *
   * Distinct from `GOODS_NOT_READY` (the goods' state) and from `PARTY_ABSENT` (nobody there).
   * `src:macropoint` `x021` "Late acceptance by consignee", whose analysis reads it as "customer
   * delayed the crew on site… transfers directly and is billable (waiting time)". The billable
   * clock is regulation-grade: `src:dtr-part-iv` A-406 §A.8.a's free waiting time, 2 hours domestic
   * and 1 hour international, and `src:dp3-400ng` Item 17-1.4's one hour. `src:uncefact-rec24`'s
   * `Waiting_for_*` family is the cause taxonomy — 189 location, 191 workers, 200 operational
   * periods, 236 instructions. Also `src:stedi-x12-reference` element 1651 `B9 Receiving Time
   * Restricted`.
   *
   * This is also the code a destination-not-ready delivery carries when the goods go to storage in
   * transit. The **remedy that opens a SIT stay is owed to A5** — `src:shippeo`'s analysis calls
   * this "the deepest structural gap": in freight an exception is a retry, in household goods it
   * starts a whole new phase. [A4 §5] item 2 carries that as owed.
   */
  'PARTY_NOT_READY',
  /**
   * A party instructed a change to **where** or **how** the act is performed — default scope
   * `PARTY`. The place-or-pattern half of the pair it forms with `PARTY_RESCHEDULED`.
   *
   * Deliberately wider than any one tariff category, and the width is what makes it right.
   * `src:shippeo` `REN/LNA` "deliver to new address" is kept apart from `REN/DEM` "consignee changed
   * address" by its analysis — "a customer redirecting a delivery mid-move is routine and
   * **charge-bearing**… Shippeo's separation of this from `DEM` is the valuable part" — and the
   * `DEM` side is `ADDRESS_INCORRECT`, "a data defect, not a customer request". `src:dp3-400ng`
   * gives two priced forms of the same instruction, and they are **not** one category: Item 28.4
   * **Diversion** is "a change while enroute… outside of the BPC of the original destination, or in
   * the route at the request of the Government", and is explicitly *not* a diversion "if the change
   * arrives before the shipment moves", which is Item 28.3's authorised **stop-off** instead. A
   * reason code that named either would name a tariff outcome the record cannot yet know, so this
   * one names the instruction and leaves the classification to A7. `src:uncefact-rec24` 333
   * `Action_by_logistics_service_provider_on_instruction_by_owner` is the generic form; Atlas
   * (`src:atlas-world-group-api`) carries a `Diversion` record. [A4 §4.6] is the full argument for
   * naming the instruction rather than the tariff category.
   */
  'INSTRUCTED_CHANGE',
  /**
   * The address or contact of record is wrong, incomplete or obsolete — default scope
   * `ADMINISTRATIVE`, because it is a defect in our own paper rather than a request.
   *
   * `src:shippeo` `REN/DEM` "consignee changed address", which its analysis reads as "the address on
   * file is wrong… a data defect, not a customer request. Different owner, different remedy,
   * different billing. Keep the two apart" — the two being this and `INSTRUCTED_CHANGE`.
   * `src:macropoint` `x011` "Incorrect delivery details" conflates them, and its analysis says so:
   * "prefer Shippeo's split." Also `src:uncefact-rec24` 234 and 274 address incorrect/incomplete and
   * 213 further address needed; `src:stedi-x12-reference` element 1651 `A2 Incorrect Address` and
   * `A6 Address Corrected - Delivery Attempted`; `src:open-trip-model` 5.7 `invalidAddress`. The
   * split from `INSTRUCTED_CHANGE` is [A4 §4.6].
   */
  'ADDRESS_INCORRECT',
  /**
   * Money the act required before it could proceed was not collected — default scope
   * `ADMINISTRATIVE`.
   *
   * `src:shippeo`'s OpenAPI-only `ORDER_NOT_DELIVERED_RECEIVER_CANT_PAY`, which its analysis says
   * "transfers *better* to HHG than to EU FTL. A van operator who will not unload until the
   * customer pays is standard HHG practice." Also `src:uncefact-rec24` 291 and 292 refused for
   * non-payment and 250 `Transport_payment_not_received`; `src:stedi-x12-reference` element 1651
   * `B4 Held for Payment` and `C2 Credit Hold`. Declared at [A4 §3].
   */
  'PAYMENT_NOT_RECEIVED',
  /**
   * An approval the act required was not in place — default scope `ADMINISTRATIVE`, and the one
   * scope member household-goods regulation supplies more of than any freight source.
   *
   * `src:dp3-400ng` gates three separate services on prior approval: Item 125's shuttle service
   * ("pre-approval required with comprehensive notes"), Item 17-1's attempted delivery ("billable
   * only with PPSO pre-approval obtained **while the crew is at the delivery point**") and Item 29's
   * SIT entry. `src:dtr-part-iv` §D.5.b(2) states the same sequence for storage — "TSP requests,
   * PPSO approves, DPS issues the control number". `src:atlas-world-group-api` carries
   * `nO_Prior_OPS_Approval` and `long_Cartage_Denied` as named causes on its SIT record. Also
   * `src:uncefact-rec24` 2 `Loading_authorized` and 236 `Waiting_for_instructions`.
   *
   * Spelled with an `s`: `UNAUTHORISED` is already on the wire as a `CORRECTION_EFFECTS` member, so
   * British spelling is this package's established convention for this word. [A4 §4.4] is why this
   * member is better sourced than [SD §2.4]'s `ADMINISTRATIVE` examples suggested.
   */
  'AUTHORISATION_MISSING',
  /**
   * A document the act required is absent or defective — default scope `ADMINISTRATIVE`.
   *
   * `src:uncefact-rec24` 343 `Document_incorrect`, against 359 `Bill_of_Lading_issued`;
   * `src:stedi-x12-reference` element 1651 `BC Missing Documents` and the beautifully specific
   * `OO Paperwork Received - Did not Receive Shipment or Equipment`; `src:open-trip-model` 5.7
   * `invalidShippingLabel`; `src:cfr-49-375`, where the order for service and the bill of lading are
   * prerequisites to transportation.
   *
   * A certificate of insurance not on file with a building is an **instance of this code**, not a
   * member of its own: [SD §2.4] names "COI not on file" as half of HHG's authoring gap, and the gap
   * is in the *examples* rather than in the concept. Minting `COI_NOT_ON_FILE` would put a single
   * document's name in a closed enum and need [ORIGINAL] to do it ([A4 §4.4]).
   */
  'DOCUMENT_MISSING_OR_INCORRECT',
  /**
   * The site cannot be reached by the equipment the act was planned with — default scope `SITE`.
   * This is the shuttle reason, and it is **sourced**, not authored.
   *
   * `src:dp3-400ng` Item 125 defines shuttle service as "a truck-to-truck transfer where linehaul
   * equipment cannot access origin or destination" and **enumerates the valid causes**: building
   * structure, inaccessibility by highway, inadequate or unsafe road, overhead obstructions, narrow
   * gates, sharp turns, trees and shrubbery, roadway deterioration due to rain, flood or snow, and
   * the nature of an article. Item 33 **Impractical Operations** adds road and approach conditions
   * creating unreasonable risk, inadequate loading or unloading facilities, and legal restrictions
   * on linehaul equipment. That is a regulation-grade cause list for this code, and it is why
   * [A4 §4.4] corrects the reading that HHG's `SITE` members had to be invented.
   *
   * Also `src:shippeo`'s OpenAPI-only `ORDER_NOT_DELIVERED_NO_ACCESS_TO_SITE` — "the only source in
   * the corpus with a named 'couldn't get to the site' exception" — `src:open-trip-model` 5.7
   * `inaccessibleAddress`, and `src:stedi-x12-reference` element 1651 `B8 Improper Unloading
   * Facility or Equipment`.
   *
   * Its most useful outcome is not a failure. At `COMPLETED_WITH_EXCEPTION` it says "we performed
   * it, differently, and it costs more" — the cell `src:shippeo`'s grid has no room for, and the
   * reason its analysis files shuttle under a "charge-bearing execution variant" rather than an
   * exception.
   */
  'SITE_INACCESSIBLE',
  /**
   * The site imposes handling the act was not planned for — default scope `SITE`. Long carry, stair
   * carry, a lift out of service.
   *
   * `src:cfr-49-375` §375.401(f) names "elevators, long carries" as accessorial charges and requires
   * them to be determined **before** preparing the bill of lading, on pain of the carrier having to
   * deliver and bill after 30 days. `src:dp3-400ng` Item 33 names "inadequate loading/unloading
   * facilities". So the *conditions* are sourced and priced.
   *
   * **[SYNTHESIS]**: reading them as an execution-time reason is ours. §375.401(f) is a rule about
   * the estimate, and a condition discovered at the door after the bill of lading exists is exactly
   * the case it penalises — which is the argument for recording it as a reason on the act rather
   * than only as a charge. A parking permit not obtained is **[ORIGINAL]** within this code: no
   * source in the corpus names it ([A4 §4.4]).
   */
  'SITE_HANDLING_EXCESS',
  /**
   * The site is reachable but its access is restricted at the time the act needed it — default
   * scope `SITE`. A building move-in window, a lift reservation, quiet hours, a dock appointment.
   *
   * `src:shippeo` `REN/FCO` "closed for holidays or inventory" and `REN/FHB` "weekly closing times"
   * are freight-only as written — a residence has neither posted opening hours nor an annual
   * stock-take — but its analysis is explicit that "**the shape survives**: HHG's equivalents are
   * building move-in windows, elevator reservations and HOA quiet hours. Re-label, don't drop."
   * This is that re-label. Also `src:uncefact-rec24` 186 `Waiting_for_entry_permission`, 317
   * premises closed in normal hours, 211 and 352-354 business closed, and 184 `Waiting_for_action_
   * by_authorities`; `src:stedi-x12-reference` element 1651 `B9 Receiving Time Restricted` and
   * `AW Past Cut-off Time`. Declared at [A4 §3]; [A4 §4.4] is why the `SITE` members are not
   * authored.
   */
  'SITE_ACCESS_RESTRICTED',
  /**
   * Equipment, storage or crew the act needed was not available — default scope `RESOURCE`.
   *
   * `src:stedi-x12-reference` element 1651 organises a whole cluster this way: `T1`-`T6` (tractor
   * with sleeper, conventional tractor, trailer not available, trailer not usable due to prior
   * product, trailer class, trailer volume), `D2 Driver Not Available`, `P4 Held for Full Carrier
   * Load`. `src:uncefact-rec24`'s `Waiting_for_*` family names the same shape per resource — 191
   * workers, 192 **storage area**, 193 equipment, 194 other means of transport, 195 handling
   * equipment. 192 is the code `src:atlas-world-group-api`'s `warehouse_full` and
   * `market_Saturated` SIT causes fall under. Also `src:shippeo`'s OpenAPI-only
   * `ORDER_NOT_DELIVERED_RESOURCE_INCIDENT`. Declared at [A4 §3].
   */
  'RESOURCE_UNAVAILABLE',
  /**
   * Equipment or crew assigned to the act failed during it — default scope `RESOURCE`. A van
   * breakdown, a lift-gate failure.
   *
   * Kept apart from `RESOURCE_UNAVAILABLE` because the sources keep it apart and because the
   * remedy differs: a resource that was never assigned is a planning problem, one that failed
   * mid-act is a recovery problem. `src:stedi-x12-reference` element 1651 `AI Mechanical Breakdown`
   * beside the `T`-series, and `T4` "trailer not usable due to prior product" on the boundary.
   * `src:shippeo`'s `ORDER_NOT_DELIVERED_RESOURCE_INCIDENT` reads, in its analysis, as "equipment
   * failure. Van breakdown, lift-gate failure. Direct." Also `src:macropoint` `x026`, which folds
   * accidents in with weather. Declared at [A4 §3].
   */
  'RESOURCE_FAILURE',
  /**
   * The act happened, or was attempted, outside the window agreed for it — default scope `ACT`.
   *
   * `src:shippeo` `TAR` "carrier arrived too late / delayed", which appears under both `AEC`
   * (`UNLOADING_POSTPONED`) and `REN` (`ORDER_DELIVERY_REFUSED_LATE`) — one reason, a
   * carrier-initiated postponement in one outcome and a customer's refusal in the other, and its
   * analysis notes "attribution matters for the waiting-time charge". `src:macropoint` `x029` "Late
   * delivery", which "in HHG… has tariff consequences". `src:atlas-world-group-api` splits arrival
   * from departure as `stp_reasonlate` and `stp_reasonlate_depart` with an `stp_delayhours` figure.
   * `src:smdg-delay-codes` is 49 codes of nothing but this. Also `src:stedi-x12-reference` element
   * 1651 `AW Past Cut-off Time` and status `SD Shipment Delayed`; `src:dp3-400ng` Item 17-1.3's
   * scheduled-delivery-date duty.
   *
   * Lateness is the reason, never the magnitude: `src:smdg-delay-codes`' analysis keeps "the
   * *distinction* must be kept" between a reason and a measured delay, and a duration is a fact
   * about the act, not a member of this enum. Declared at [A4 §3].
   */
  'LATE_ARRIVAL',
  /**
   * Something outside every party's control prevented or altered the act — default scope `ACT`.
   *
   * `src:dp3-400ng` Item 33 enumerates it as part of impractical operations: force majeure, war,
   * riot, strike and picketing. `src:macropoint` `x026` "Uncontrollable events: weather, strikes,
   * accidents, traffic, road closed", which its analysis calls "the one reason where freight and HHG
   * are identical". `src:smdg-delay-codes` gives a whole group to it — `WEA` bad weather, `STR`
   * strike, `HOL` bank holidays, `OTF` "Others - Force Majeure Related" — and its Notes sheet
   * scopes the list to the "unplanned, unwanted". Also `src:stedi-x12-reference` element 1651
   * `AO Weather or Natural Disaster Related`, `BE Road Conditions`, `AF Accident`; and
   * `src:uncefact-rec24` 182 `Waiting_for_meteorological_circumstances`.
   *
   * This is the member that proves `attribution.roleClass` needs an explicit non-party value, which
   * [A8 §9 item 2] owes: force majeure attributes to nobody, and [SD §2.4] forbids attributing to
   * nobody at all.
   */
  'FORCE_MAJEURE',
  /**
   * The act was requested after the point at which it could still take effect — default scope
   * `ACT`.
   *
   * **[ORIGINAL]**. No source in the corpus publishes it, and [SD §4.7.2e] item 3 is what needs it:
   * "a cancellation is an act with an outcome, and a refused cancellation needs no new mechanism…
   * `orderCancellation` carries `outcome` like every other act." An order cancelled after the pack
   * crew has used the materials is refused for this reason, and the refusal is a
   * `NOT_COMPLETED` `orderCancellation` rather than a type of its own.
   *
   * It names **the request's** place in the sequence, not this record's outcome, which is the
   * distinction [SD §2.4] rule 1 turns on. The earlier spelling `ALREADY_PERFORMED` was rejected for
   * putting a completion verb in a closed enum, where `outcomeWordIn` cannot see it and only a
   * reader can ([A4 §4.3]).
   */
  'OUT_OF_SEQUENCE',
  /**
   * The act did not complete as intended and the asserter does not know why — default scope `ACT`.
   *
   * `src:uncefact-rec24` 265 `Reason_unknown`, "the reason is unknown", beside 125 `No_status`. Its
   * analysis singles the pair out: "a vocabulary that lets a publisher say 'I have nothing' and
   * 'something happened and I don't know why' is honest about the real world and keeps those cases
   * out of free text."
   *
   * Not `OTHER`. `OTHER` means *there is a reason and this list has no code for it*, and owes a
   * narrative ([SD §2.4] rule 3); this means *there is no reason to give yet*. Publishing both is
   * what stops a producer fabricating a remark to satisfy the open member ([A4 §4.5]).
   */
  'CAUSE_UNKNOWN',
] as const

/**
 * A member of the published reason vocabulary — [SD §2.4], [A4 §3].
 *
 * No longer an owed code: A4 published the list, and the type narrowed from a branded string to a
 * closed union. `OTHER` is not a member of it, which is what lets the {@link Reason} union make
 * `remark` mandatory for `OTHER` alone.
 */
export type ReasonCode = (typeof REASON_CODES)[number]

/**
 * The one code the shape itself declares — [SD §2.4] rule 3, "an open member with a mandatory
 * narrative", sourced twice and one of them regulation-grade: `src:open-trip-model` 5.7's `other`
 * with "the specific reason is provided in the `remark` property", and `src:dp3-400ng` Item 226A's
 * Miscellaneous charge for anything without a designated service code, with a **mandatory** detailed
 * note.
 *
 * It is not an extension point ([catalog §2.2]): it carries a narrative, not a vocabulary, and
 * nothing switches on it.
 */
export const REASON_CODE_OTHER = 'OTHER' as const

/** Whether a string is a member of the published reason vocabulary. `OTHER` is not. [A4 §3] */
export function isReasonCode(code: string): code is ReasonCode {
  return (REASON_CODES as readonly string[]).includes(code)
}

/**
 * Parse a string into a {@link ReasonCode} — the boundary check A4 made possible.
 *
 * While the vocabulary was owed this function could only reject the empty string; now that
 * [A4 §3] publishes the list it rejects anything outside it, which is **E-TYPE**'s discipline
 * ([SD §1.3]) applied one axis over.
 */
export function reasonCode(code: string): ReasonCode {
  if (code === REASON_CODE_OTHER) {
    // `OTHER` is declared by the shape, not by the vocabulary A4 published, and it carries an
    // obligation the others do not ([SD §2.4] rule 3). Keeping it out of this constructor is what
    // lets the `Reason` union make `remark` mandatory for it alone.
    throw new RangeError('use REASON_CODE_OTHER; it is declared by [SD §2.4], not by A4')
  }
  if (!isReasonCode(code)) {
    throw new RangeError(`${code === '' ? '<empty>' : code} is not a published reason code [A4 §3]`)
  }
  return code
}

/**
 * The class of party a reason is attributed to.
 *
 * **Owed.** [SD §2.4] rule 6 makes attribution a structured field and sources the _fact_ that
 * reason vocabularies are organised by responsible party (`src:stedi-x12-reference` element
 * 1651's 86 values; Shippeo's `NJU` vs `DIV`), but no document publishes the class list.
 * [SD §2.6]'s worked example uses `customer`, `carrier` and `unknown`; three examples are not a
 * vocabulary, and [A8 §9 item 2] owes the role enum this would be cut from.
 */
export type RoleClass = OwedCode<'roleClass'>

export const roleClass = (code: string): RoleClass => code as RoleClass

/**
 * [SD §2.4] "Attribution is a structured field on the reason, not baked into the code and not on
 * the assertion."
 *
 * This **supersedes `fork-time` §(b)(7)** ("attribution belongs on the assertion"), which
 * [round-2-critique] "correctly identified as a placement rule no source states". `party` is
 * optional because the responsible party is often unknown at the time the reason is recorded;
 * `roleClass` is not, because a reason that attributes to nobody at all is the `DIV` overload
 * [SD §2.3] invariant 2 exists to remove.
 */
export interface Attribution {
  readonly party?: PartyId
  readonly roleClass: RoleClass
}

/**
 * A new window offered in place of the act that did not happen — [SD §2.4] rule 5's **one sourced
 * remedy shape**, and the only one A4 types.
 *
 * `src:shippeo`'s `new_slot {start, end}` is _required_ on its appointment events
 * (`OrderAppointmentEvent`, `SharedTrackingSlot`): "a failed delivery that does not say when it will
 * be retried is an incomplete record." Spelled `newWindow` after [SD §2.6]'s worked scenario rather
 * than after Shippeo's wire name, because [SD] outranks the citation.
 */
export interface NewWindow {
  readonly start: Instant
  readonly end: Instant
}

/**
 * [SD §2.4] "A reason may carry its own remedy, and for some codes must."
 *
 * A4 types the one shape a source states and carries the rest as owed, rather than inventing shapes
 * to make the union look finished ([SD §0]). Which codes **require** a remedy is published per code
 * in `data/reasons.json`; `PARTY_ABSENT` and `PARTY_RESCHEDULED` are the two that do, and
 * {@link NewWindow} is what they carry.
 *
 * Still owed: a remedy that **opens a storage-in-transit stay**, which is the remedy
 * `PARTY_NOT_READY` wants and which `src:shippeo`'s analysis calls "the deepest structural gap" —
 * in freight an exception is a retry, in household goods it starts a whole new phase. That belongs
 * to A5, not here.
 */
export type Remedy =
  | { readonly newWindow: NewWindow }
  | Owed<'remedy', 'A5 — a remedy that opens a SIT stay; [SD §2.4] rule 5 types only newWindow'>

interface ReasonCommon {
  readonly scope: ReasonScope
  readonly attribution: Attribution
  /**
   * [SD §2.4] "OPTIONAL — `SubjectRef[]` at portion or item grain".
   *
   * This is the field that carries [SD §3.4]'s required form for "delivered, two items short",
   * and the field OTM 5.8's nested sub-results become here: [SD §3.3] publishes them "as
   * `appliesTo` refs on the reasons of one act, because our envelope has no nesting and because
   * the shortfall is frequently learned after the act was published".
   *
   * It is not a second subject ([SD §1.1]): it is the _scope_ of one asserted value, and
   * [SD §1.3]'s fact key does not read it.
   */
  readonly appliesTo?: ReadonlyArray<SubjectRef<'portion' | 'item'>>
  readonly remedy?: Remedy
}

/**
 * [SD §2.4] `remark` is "MANDATORY when code = OTHER", and only then.
 *
 * Two members rather than one optional field: `OTHER` without a narrative is the record
 * `src:dp3-400ng` Item 226A and OTM 5.7 both forbid, so it must not compile.
 */
export type Reason =
  | (ReasonCommon & { readonly code: typeof REASON_CODE_OTHER; readonly remark: string })
  | (ReasonCommon & { readonly code: ReasonCode; readonly remark?: string })

/**
 * The outcome half of an act's `value` — [SD §2.3] invariant 2.
 *
 * "`reasons[]` has at least one member unless `outcome = COMPLETED`, where it is **forbidden**."
 * Both halves are in the type: `COMPLETED` cannot carry reasons, and nothing else can omit them.
 *
 * **[ORIGINAL]** in [SD §2.3]: "collapsing `CFM` into `COMPLETED` and forbidding a reason there"
 * is a normalisation of Shippeo, which always pairs a situation with a justification.
 */
export type ActOutcome =
  | { readonly outcome: 'COMPLETED'; readonly reasons?: never }
  | { readonly outcome: ExceptionalOutcome; readonly reasons: NonEmptyArray<Reason> }

/** [SD §2.3] invariant 2, as a predicate — for consumers holding a runtime value. */
export function reasonsAreRequired(outcome: Outcome): boolean {
  switch (outcome) {
    case 'COMPLETED':
      return false
    case 'COMPLETED_WITH_EXCEPTION':
    case 'PARTIALLY_COMPLETED':
    case 'NOT_COMPLETED':
    case 'CANCELLED':
      return true
    default:
      return assertNever(outcome, 'outcome')
  }
}

export function isWellFormedActOutcome(candidate: ActOutcome): boolean {
  const reasons = candidate.reasons ?? []
  return reasonsAreRequired(candidate.outcome) ? reasons.length > 0 : reasons.length === 0
}

/**
 * **Rule A-TYPE** — [SD §2.5]. "A record `type` names the fact class — which, for an act, is the
 * act itself (`delivery`, `loading`, `packing`, `storeIn`). It MUST NOT encode the outcome.
 * `Delivery.Completed` is not a legal type name."
 *
 * A type name containing an outcome word resolves to `never`, so a vocabulary carrying one cannot
 * satisfy the conformance check in `vocabulary.ts`. Directly sourced, and the source is a defect
 * report: Shippeo's `…OrderNotLoadedPartiallyMissing` schema declares
 * `event: "ORDER_NOT_LOADED_ENTIRELY_MISSING"` — "concrete evidence for why the event name must be
 * an alias for the code pair and never the identity."
 *
 * This is also what makes the single classification axis survivable ([SD §2.5]): "an
 * outcome-bearing type name would force a second, outcome-free axis to exist beside it purely so
 * the domain could still be talked about."
 */
export type OutcomeFreeTypeName<T extends string> = T extends string
  ? Lowercase<T> extends `${string}${Lowercase<Outcome>}${string}`
    ? never
    : T
  : never
// The outer `T extends string` is not redundant. Without it the checked type is `Lowercase<T>`
// rather than a naked `T`, the conditional stops distributing, and a union containing one
// offending name is tested — and passed — as a whole. The check then holds for every vocabulary
// and catches nothing.

/**
 * Rule 1's mechanical half — [SD §2.4] rule 1, "the catalog MUST NOT mint `DELIVERED_SHORT` and
 * `REFUSED_SHORT` as two codes".
 *
 * {@link OutcomeFreeTypeName} maps any member naming an outcome to `never`, so if one ever did, the
 * mapped union would be narrower than {@link ReasonCode} and this line would stop compiling. It is
 * the same check **A-TYPE** runs over the record vocabulary, applied one axis over — which is the
 * mirror `data.ts`'s `outcomeWordIn` performs at run time on the data table.
 *
 * What it cannot catch is stated where the run-time check states it: a code that encodes the outcome
 * in a **verb** rather than in an outcome member's own name. `ALREADY_PERFORMED` was such a code and
 * a reader caught it, not this line ([A4 §4.3]).
 */
export type ReasonCodesAreOutcomeFree = Exact<OutcomeFreeTypeName<ReasonCode>, ReasonCode>
const _reasonCodesAreOutcomeFree: ReasonCodesAreOutcomeFree = true
void _reasonCodesAreOutcomeFree
