---
source: src:cfr-49-375
analyzed: 2026-09-17
evidence_grade: A
material: sources/cfr-49-375/captured/cfr-49-375.xml (complete: 375.101-375.901 and Appendix A, XML lines 1-885)
---

# 49 CFR Part 375 — Transportation of Household Goods in Interstate Commerce; Consumer Protection Regulations — analysis

## What it is

FMCSA's consumer-protection rule for interstate household-goods carriage (49 CFR
Part 375, source 68 FR 35091, most recently amended 88 FR 80179, Nov. 17 2023 —
`captured/cfr-49-375.xml:8, :286`). **S1 kind:** `regulation`. **S2 adoption: 3** —
binding federal law on every US interstate HHG mover and its agents
(`§ 375.101`, xml:16); non-compliance carries the civil/criminal penalties of
49 U.S.C. ch. 149 (`§ 375.901`, xml:612). **S3 openness:** `public` (US
government work, eCFR). **Our reading covered the whole part**: Subparts A–I and
the full text of Appendix A ("Your Rights and Responsibilities When You Move"),
read from the captured XML end to end. Nothing was gated or unreadable.

Scope caveat that shapes everything below: Part 375 regulates the
**carrier↔individual-shipper relationship only**. It is silent on carrier↔agent
operations, on vehicles and trips, and on tariff content (which it delegates to
the STB — `§ 375.103` *Tariff*, xml:59). It is a **document-and-obligation**
regulation, not a process or status-code standard.

## Model summary

Part 375 recognises four kinds of thing and nothing else:

- **Parties** — the *individual shipper*, the *household goods motor carrier*
  ("you"), its *agents* (prime; emergency or temporary), *household goods
  brokers*, the *warehouseman*, the *weigh master*, and — for non-consumer moves
  — the *commercial shipper* and *government bill of lading shipper*.
- **The shipment** — an undivided quantity of household goods, possibly carried
  on more than one vehicle (`§ 375.705`) and possibly delivered in part
  (`§ 375.403(a)(11)`), with a weight determined by a prescribed method.
- **A chain of documents**, each signed, dated, retained for a stated period, and
  amendable only by attaching a further signed document.
- **A set of obligations with deadlines** attached to those documents.

There is no state machine, no status vocabulary, no event catalog, no trip, no
stop, and no route. The lifecycle is *implied by document order and by what each
document forecloses*:

```
physical survey (or signed waiver, before loading)
  -> written estimate, binding or non-binding, signed+dated by both, copy to shipper
  -> [amendment by mutual agreement — permitted ONLY before loading, 375.401(i)]
  -> bill of lading issued, signed+dated by shipper >= 3 days before scheduled loading
  -> [shipper may rescind the BOL without penalty for 3 days, 375.505(h)]
  -> inventory prepared before/at loading, signed by both, copy to shipper
  -> LOADING   <-- the irreversibility boundary
  -> weighing (origin weigh or back weigh) -> weight ticket(s)
  -> [reweigh on demand: after billing weight disclosed, before unloading begins]
  -> transport "with reasonable dispatch"
  -> [delay => written notice + written record of date/time/manner]
  -> [optional: SIT at shipper request, or carrier-account storage under 375.607]
  -> tender for delivery on the agreed date or within the agreed period
  -> relinquish possession upon tender of the lawful maximum COD amount
  -> delivery receipt (no release-of-liability language) + inventory check-off
  -> invoice within 15 days (excl. Sat/Sun/Fed. holidays); 7-day credit period
```

Three structural observations the core model should take seriously:

1. **Loading is the single load-bearing transition.** An estimate may be amended
   before loading and not after (`§ 375.401(i)`, xml:262); the BOL must be
   signed before loading (`§ 375.505(f)`, xml:378); and once loaded, *failure to
   execute a new estimate constitutes reaffirmation of the original*
   (`§ 375.403(a)(7)`, xml:279; `§ 375.405(b)(8)`, xml:303). "Loaded" — not
   "departed", not "in transit" — is where the commercial terms freeze.
2. **Tender-for-delivery, delivery, and relinquishing possession are three
   different things.** The carrier must *tender* on the agreed date
   (`§ 375.603`); it must *relinquish possession* only upon payment of the lawful
   maximum (`§ 375.407(a)`, `§ 375.217(e)`); and refusing to relinquish after a
   valid tender of payment is itself a defined violation ("failure to transport
   with reasonable dispatch", `§ 375.403(a)(10)`, `§ 375.407(b)`). A model with a
   single `delivered` state cannot represent "at destination, tendered, unpaid,
   possession retained" — which is a lawful and common state.
3. **Nothing is ever edited; everything is superseded by a further signed
   document.** New estimates; written attachments signed by the shipper for
   post-BOL additional services (`§ 375.403(a)(8)-(9)`); written notations of
   missing/damaged articles on the inventory at delivery (`§ 375.503(d)`);
   written records of every delay notification carrying *date, time and manner*
   (`§ 375.605(b)(1)-(3)`). This is the strongest provenance/correction model in
   the corpus and it is append-only by construction.

## Vocabulary

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **Bill of lading** | "both the receipt and the contract for the transportation of the individual shipper's household goods" | A6 | 375.103, xml:26 |
| **Individual shipper** | a person who is shipper/consignor/consignee, *is named as such on the face of the BOL*, *owns the goods*, **and** *pays his or her own tariff charges* — all four conjunctively | A8 | 375.103, xml:50-54 |
| **Commercial shipper** | consignor/consignee on the BOL who is *not* the owner but assumes payment for the beneficial owner; a freight forwarder tendering to a carrier is also a commercial shipper; the Federal government is *not* | A8 | 375.103, xml:32 |
| **Government bill of lading shipper** | person whose property moves under a GBL issued by a federal department/agency | A8 | 375.103, xml:34 |
| **Household goods motor carrier** | a motor carrier that, in the ordinary course, offers some/all of: binding & nonbinding estimates, inventorying, protective packing/unpacking at residences, loading/unloading at residences. Excludes carriers whose containers/trailers are entirely loaded and unloaded by someone other than carrier personnel | A8 | 375.103, xml:39-48 |
| **Household goods** | personal effects or property used, or to be used, in a dwelling, when part of its equipment or supplies; transportation arranged and paid by the individual shipper or another on their behalf | A2 | 375.103, xml:38 |
| **prime agent** / **emergency or temporary agent** | the *only* two agent types the rule knows. Prime agent provides transportation service for/on behalf of the carrier including selling or arranging service, under a signed written agreement retained 24 months; is **not** a broker or forwarder. Emergency/temporary agent provides *origin or destination services only*, excluding selling/arranging, on an emergency or temporary basis | A8 | 375.205(a)(1)-(2),(b),(c), xml:99-102 |
| **Agent** (Appendix A gloss) | "A local moving company authorized to act on behalf of a larger national company" | A8 | App. A, xml:628 |
| **Binding estimate** | "an agreement made in advance… It guarantees the total cost of the move based upon the quantities and services shown on your estimate", based on the physical survey if required; a fee may be charged for it; must state on its face that it binds both parties and that the charges apply only to the services identified | A10/A7 | 375.401(b)(1), xml:252; 375.403(a)(4) |
| **Non-binding estimate** | "what you believe the total cost will be", based on estimated weight or volume, services requested, and the physical survey if required; not binding; final charges from actual weight + tariff; **no charge may be imposed for it** | A10/A7 | 375.401(b)(2), xml:253 |
| **110 percent rule** | on a COD non-binding-estimate shipment the carrier must relinquish possession on payment of up to 110% of the estimate (+ post-BOL requested services + capped impracticable-operations charges) | A7 | 375.407(a), 375.217(e), 375.703(b) |
| **Physical survey** | "a survey which is conducted on-site or virtually… live or pre-recorded video that allows it to clearly identify the household goods" — waivable only in writing, signed before loading, retained as a BOL addendum | A10 | 375.103, xml:56; 375.401(a) |
| **Reasonable dispatch** | performance on the dates, or during the period, agreed and shown on the BOL; excludes guaranteed-service-date tariff provisions; force-majeure defence available | A4 | 375.103, xml:58 |
| **Force majeure** | defence where part of the contract cannot be performed due to causes outside the parties' control and unavoidable by due care | A4 | 375.103, xml:33 |
| **Certified scale** | scale inspected and certified by an authorised inspection/licensing authority, designed for weighing motor vehicles, or a platform/warehouse-type scale | A6 | 375.103, xml:31 |
| **first method — origin weigh** | gross-after-loading minus tare-before-loading, same vehicle | A2/A6 | 375.509(a)(1), xml:400 |
| **second method — back weigh** | gross-with-shipment-loaded minus tare-after-unloading, same vehicle | A2/A6 | 375.509(a)(2), xml:401 |
| **net weight (containers)** | gross weight of the container with the shipment loaded minus tare weight of the container *including all pads, blocking and bracing* | A2 | 375.509(d), xml:407 |
| **constructive weight** | basis (alternative to actual) for apportioning charges on a partially lost or destroyed shipment | A7 | 375.707(b), xml:553 |
| **Weight ticket** | per-weighing evidence signed by the **weigh master**, carrying scale name+location, date, tare/gross/net identification, vehicle company/carrier id, shipper's last name as on the BOL, and *the carrier's shipment registration or bill of lading number* | A6/A9 | 375.519(a)(1)-(6), xml:436-442 |
| **Inventory** | written, itemized list identifying *every carton and every uncartoned item*, with a corresponding identification number placed on each article | A6/A10 | 375.503(a), xml:341 |
| **storage-in-transit (SIT)** | used but **never defined** in the part; the maximum period is whatever the carrier's own tariff provides | A5 | 375.609(c)(2), xml:509 |
| **conversion to permanent storage** | dated event ending carrier liability and subjecting the goods to "the rules, regulations, and charges of the warehouseman"; opens a 9-month claims window; goods must be placed **in the individual shipper's name** with shipper contact details | A5 | 375.609(b),(h), xml:503-506, 514 |
| **delivery spread** | (Appendix A term) "the timeframe in which you can expect your shipment to be delivered" | A4/A5 | App. A, xml:811 |
| **Accessorial (Additional) Services** | services such as packing, unpacking, appliance servicing, piano carrying, requested or necessitated by landlord requirements or special circumstances | A7 | App. A, xml:626 |
| **Advanced Charges** | charges for services performed by a third party at the shipper's request; *the mover pays and adds them to the bill of lading* | A7 | App. A, xml:627 |
| **Line-Haul Charges** | "the charges for the transportation portion of your move" | A7 | App. A, xml:651 |
| **Impracticable Operations** | conditions making pickup/delivery physically impossible with normally assigned road-haul equipment, requiring specialised equipment and/or additional labour; **defined in the carrier's tariff**, chargeable even if not requested, capped at 15% of all other charges due at delivery | A7 | App. A, xml:649; 375.703, 375.407(d) |
| **Flight Charge** | additional charge for carrying items up or down flights of stairs | A7 | App. A, xml:638 |
| **High-Value Article** | item valued at more than $100 per pound | A11 | App. A, xml:641 |
| **Full Value Protection** | default liability level: repair, replace, or settle at replacement value, capped at the declared value of the shipment; minimum valuation $6.00/lb x shipment weight | A11 | 375.201(b), App. A xml:706-710 |
| **Released Value (Waiver of FVP)** | 60 cents/lb per article, no charge to the shipper | A11 | 375.303(a), App. A xml:711-713 |
| **Collect on Delivery (COD)** | payment required at the time of delivery at the destination residence **or warehouse** | A7 | App. A, xml:632 |
| **Guaranteed Pickup and/or Delivery Service** | service level with guaranteed dates and carrier reimbursement for delay; BOL carries the *penalty or per diem entitlements* | A1/A4/A7 | 375.505(b)(7), App. A xml:640 |
| **service options** | space reservation / expedited service / exclusive use of a vehicle / guaranteed service on or between agreed dates / liability insurance | A2 | 375.301(a), xml:219-223 |
| **balance due invoice** | the trigger, with extension of credit, for the Subpart H collection regime | A7 | 375.801, xml:574 |
| **Commercial Zone** | roughly the local metropolitan area; interstate moves entirely within one are **exempt** from FMCSA HHG jurisdiction | A2 | App. A, xml:634 |

## Lifecycles & events

Part 375 publishes **no status codes and no reason codes**. What it publishes is
a set of hard ordering constraints and deadlines, with an explicit actor for
each. These are the transitions worth lifting:

| Transition | Who may cause it | Constraint / invariant | Cite |
| --- | --- | --- | --- |
| physical survey waived | shipper only | written, signed **before the shipment is loaded**, retained as a BOL addendum under BOL retention rules | 375.401(a)(1)-(3) |
| estimate amended | carrier **and** shipper, mutually | only **before loading**; "You may not amend the estimate after loading the shipment" | 375.401(i) |
| additional goods/services appear at origin | carrier decides whether to service at all | before loading must do exactly one of: reaffirm / issue a new signed binding estimate / agree in writing to treat the original as non-binding | 375.403(a)(6)(i)-(iii) |
| estimate reaffirmed by silence | *the act of loading* | "Once you load a shipment, failure to execute a new binding estimate or a non-binding estimate signifies you have reaffirmed the original" | 375.403(a)(7), 375.405(b)(8) |
| BOL issued | carrier | before receiving the shipment; >= 3 days before scheduled loading; signed and dated by the shipper | 375.505(a),(h) |
| BOL rescinded | shipper | within 3 days of signing, without penalty. A same-day new estimate under 403(a)(6)(ii)/405(b)(7)(ii) does **not** restart the 3-day period | 375.505(h) |
| post-BOL additional services proposed by carrier | carrier proposes, shipper decides | shipper must be given **at least one hour** to decide; agreement becomes a signed written attachment to the BOL; billed **after 30 days from delivery** | 375.403(a)(8) |
| post-BOL additional services requested by shipper | shipper | new binding estimate prepared and signed; may be required in full at destination | 375.403(a)(9) |
| reweigh demanded | shipper | only after the carrier has disclosed billing weight and total charges, and **before unloading begins**, and only for origin-weighed shipments; freight bill must then be based on the reweigh weight | 375.517 |
| weighing observed / waived | shipper | not observing a *weighing* is a presumed waiver; waiving observation of a *reweighing* must be **in writing** | 375.515(a),(b) |
| pickup/delivery delay | carrier must notify | as soon as the delay becomes apparent, at carrier's expense, by one of six enumerated channels; written record of date/time/manner + amended date/period, retained 1 year | 375.605(a),(b) |
| early tender >24h before the specified date | carrier, at its discretion | may place in storage **on its own account and at its own expense** near destination; must immediately notify the shipper of the warehouse name and address; carrier retains BOL liability and bears redelivery, handling and storage | 375.607(a)-(c) |
| SIT period about to expire | carrier must notify | written notice >= 10 days before expiry (or **1 day** before, if the SIT period is under 10 days) by fax, e-mail, overnight courier, or certified mail RRR; must state (1) date of conversion to permanent storage, (2) the 9-month claims window, (3) that carrier liability is ending, (4) that the warehouseman's rules and charges will apply | 375.609(b),(c),(d),(e) |
| notice not given | — | **carrier liability automatically continues** "until the end of the day following the date when you actually gave notice" | 375.609(g) |
| conversion to permanent storage | carrier (dated) | goods placed **in the individual shipper's name** with a phone number, mailing address and/or e-mail for the shipper | 375.609(h) |
| possession relinquished | carrier must, on shipper tender of payment | binding: 100% of the estimate + post-BOL requested services + impracticable ops <= 15% of all other charges due. Non-binding: up to 110% on the same basis. Partial delivery: prorate by **delivered weight / total weight** | 375.703, 375.407(a),(c),(d), 375.403(a)(11) |
| delivery receipt signed | shipper | receipt may **not** contain release/discharge-of-liability language; may state "received in apparent good condition except as noted" | 375.701 |
| total loss in transit | — | carrier is **forbidden** to collect any freight charges (incl. accessorial/terminal), except a specific valuation charge; unless the loss was caused by the shipper | 375.709 |
| invoice presented | carrier | within 15 days of delivery, excluding Sat/Sun/Federal holidays | 375.807(a) |
| credit period | — | 7 days **including** Sat/Sun/holidays -> automatic extension to 30 calendar days -> 1% service charge, $20 minimum, per 30-day extension -> credit denied | 375.807(b),(c)(1)-(3) |

Claims/arbitration lifecycle (out of v1, kept for A11): 9 months to file from
delivery (or from the date delivery should have occurred, for a total loss) ->
carrier acknowledges within 30 days -> disposition within 120 days -> 60-day
extensions with written notice. Arbitration is binding for claims <= $10,000 at
the shipper's election, and > $10,000 only if the carrier also agrees; the
arbitrator decides within 60 days, extendable for late information
(375.211(a)(7)-(11); App. A xml:729, 853).

## Time, identity, evidence

**Time.** Part 375's time model is *agreed date or period*, not planned/estimated/
actual. The BOL carries, as separate required items: "the agreed date or period
of time for pickup… and the agreed date or period of time for the delivery"
(non-guaranteed, 375.505(b)(6)), "the dates for pickup and delivery" plus
penalty/per-diem entitlements (guaranteed, (b)(7)), and separately **"The actual
date of pickup"** (b)(8). Appendix A adds the operational term *delivery spread*
(xml:811). So the regulation distinguishes exactly three date roles — agreed,
guaranteed, actual — and *only for pickup is the actual date a document field*.

The **calendar convention differs per rule and is never uniform**, which any
implementation must carry as data rather than assume:

- invoice presentation: 15 days **excluding** Sat/Sun/Federal holidays (375.807(a))
- credit period: 7 days **including** Sat/Sun/Federal holidays (375.807(b))
- credit extension: 30 **calendar** days (375.807(c)(1))
- pre-delivery weight/charge notice: "at least one full 24-hour day before any
  tender… excluding Saturdays, Sundays and Federal holidays" (375.521(b))
- SIT expiry notice: 10 days, or 1 day if the SIT period itself is < 10 days
  (375.609(c),(e))
- BOL: signed >= 3 days before scheduled loading, rescindable for 3 days (375.505(h))
- liability continuance on missed SIT notice: "end of the day following the date
  when you actually gave notice" (375.609(g)) — a *computed* instant that depends
  on an evidenced act.

No time zones anywhere. Dates are date-only; the only sub-day granularity is the
"at least one hour" decision window for post-BOL additional services
(375.403(a)(8)) and the written record of the **time** of a delay notification
(375.605(b)(1)).

**Identity.** Several typed party and shipment references, but no correlation
scheme between parties:

- **U.S. DOT number**, assigned by FMCSA, mandatory in every advertisement in the
  exact form `U.S. DOT No. (number)` (375.207(b)(2),(c)) and on the BOL for the
  issuing carrier and for *every* participating motor carrier when known
  (375.505(b)(1),(2)). MC number appears in Appendix A's carrier-lookup procedure
  (xml:858).
- **"the carrier's shipment registration or bill of lading number"** — the
  shipment's own identifier, and a *required field on every weight ticket*
  (375.519(a)(6)). That is the one genuine cross-reference in the part: an
  evidence document typed back to the shipment.
- **"Any identification or registration number you assign to the shipment"** —
  BOL item 16 (375.505(b)(16)), explicitly the carrier's own id, implying more
  than one id may exist.
- **company or carrier identification number of the vehicle(s)** — BOL item 9
  (375.505(b)(9)) and a required weight-ticket field (375.519(a)(4)).
- **inventory identification number** placed physically on each article
  (375.503(a)) — an item-level identifier, the only one in the part.
- **scale name and location** on each weight ticket (375.519(a)(1)).
- shipper matched across documents by **last name as it appears on the bill of
  lading** (375.519(a)(5)) — a weak natural key, worth noting as the regulation's
  own admission that there is no shipper id.

**Evidence and corrections.** This is the source's outstanding contribution.
Every material fact is tied to (a) an artefact, (b) a signature or a recorded
act, and (c) a retention period:

| Fact | Evidence artefact | Signed by | Retention |
| --- | --- | --- | --- |
| survey waived | written waiver | shipper, before loading | as an addendum under BOL rules, 375.401(a)(3) |
| charges agreed | estimate, dated | both parties | 1 year from the date made, as an integral BOL attachment, 375.403(c), 375.405(d) |
| goods received & condition | inventory | both parties, and again at delivery | 1 year, integral BOL attachment, 375.503(e) |
| contract terms | bill of lading | both, **at origin and at destination** | 1 year, 375.505(d),(f) |
| weight | weight ticket(s), one per weighing | the weigh master | original retained in the shipment file; **true copies must accompany the freight bill** to collect any weight-dependent charge, 375.519(c),(d) |
| delay | written record of date, time and manner of notification + the amended date/period | carrier | 1 year from notification, 375.605(b)(3) |
| SIT expiry notice | record of notification | carrier | part of the shipment records, 375.609(f) |
| consumer-information receipt | signed, dated receipt when the shipper opts for the web links | shipper | 1 year, 375.213(f)(2) |
| agency relationship | written prime-agent agreement | carrier and agent | 24 months after termination, 375.205(c) |

Corrections are **never mutations**. A changed price is a *new signed estimate*
or a *written attachment to the BOL*; missing or damaged articles are *written
notations on the inventory at delivery, with a copy of the notations to the
shipper* (375.503(d)); a changed delivery date is a *recorded notification plus
an amended date*. The carrier may present blank or incomplete documents but "may
not require an individual shipper to sign a blank document" (375.505(g)(3)), and
incompleteness is permitted **only** for facts that cannot be known before
loading — actual weight and unforeseen in-transit charges (375.505(g)(2)). A
domain model that gives itself an "amend the order" command with no artefact has
already diverged from this source.

## Scores

Grade A reading, so no C2/C3 cap applies.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 Order & service lifecycle | 2 | 3 | 2 | 3 | 2 | 1 | 3 | 1 | Covers estimate->BOL->load->transport->tender->deliver->invoice with hard ordering rules and named actors (375.401(i), 375.403(a)(6)-(7), 375.505(h)). **No offer/award/accept/decline, no cancel, no booking, no order for service** — "order for service" appears 0 times in the whole part (case-insensitive grep over `captured/cfr-49-375.xml`). C8=1: the carrier's tariff is the declared extension point (375.103 *Tariff*). |
| A2 Shipment structure | 2 | 3 | 1 | 3 | n/a | 1 | 3 | 1 | Shipment, portion of a shipment, multi-vehicle shipment (375.705), partial delivery prorated by weight (375.403(a)(11)), container net weight (375.509(d)), minimum weight/volume rates on the BOL (375.505(b)(14)), five service options (375.301). **No shipment-type taxonomy** — no vehicle shipment, no PPM/self-move, no storage-only. C7=3 on the weight-ticket evidence chain. |
| A3 Trip, stop & assignment | 1 | 1 | 0 | 1 | 0 | 1 | 1 | n/a | Almost absent. Only: vehicle id(s) on the BOL (375.505(b)(9)); driver must hold the BOL before the vehicle leaves the residence of origin (375.505(c)); "transported on more than one vehicle" as a *charging* rule (375.705). No trip, stop, sequence, leg, consolidation, crew or equipment assignment. Do not use this source for A3. |
| A4 Execution events & tracking | 1 | 2 | 1 | 2 | 2 | 1 | 3 | 0 | Events exist only where a duty attaches: pickup, tender for delivery, relinquish possession, delay notification, weighing, unloading-start. C2=2 for genuinely distinguishing *tender* / *delivery* / *relinquish possession* (375.603, 375.407) and for "before actually beginning to unload" as an event boundary (375.517). C5=2 (agreed date-or-period, delivery spread, 24-hour notice with holiday exclusion). C7=3: every delay notice must be recorded with date, time and manner (375.605(b)(1)). **No ETA, no arrive/depart, no exception reason codes.** |
| A5 Storage-in-transit | 2 | 3 | 3 | 3 | 2 | 1 | 3 | 1 | C2=3 because it separates **three** storage situations most models conflate: SIT at shipper request (375.609); carrier-account storage when the carrier can tender >24h early and the shipper will not accept — carrier's own account, carrier's expense, carrier keeps BOL liability and pays redelivery/handling/storage (375.607); and permanent storage after conversion. C3=3 for a real invariant: notice >= 10 days (1 day if SIT < 10 days), and failure to notify **automatically continues carrier liability to the end of the day following actual notice** (375.609(g)). C1=2 only because there is no SIT-in/SIT-out event, no delivery-out leg, and **no maximum duration** — that is delegated to the carrier's tariff (375.609(c)(2)). |
| A6 Documents & evidence | 3 | 3 | 2 | 3 | 2 | 2 | 3 | 1 | The best source in this cluster for A6. Estimate, inventory, BOL (17 enumerated items, 375.505(b)), weight tickets (6 enumerated items, 375.519(a)), delivery receipt (375.701), invoice (375.215, 375.807), waivers, and "each attachment… is an integral part of the bill of lading contract" (375.505(b)(15)). C3=2: documents have a real lifecycle — issue, sign at origin *and* destination, 3-day rescission, amend only by attachment, retain 1 year. |
| A7 Charges & billing hooks | 3 | 3 | 3 | 3 | 2 | 1 | 3 | 1 | Line-haul vs accessorial/additional vs advanced charges vs impracticable operations vs valuation charge, all defined (App. A xml:626-651). C3=3 for the arithmetic invariants: 100% binding / 110% non-binding; impracticable ops <= 15% of all other charges due at delivery; partial delivery prorated by delivered/total weight; total loss => zero freight charges; 15-day invoice; 7-day credit -> 30 days -> 1%/$20 service charge -> credit denied (375.403, 375.407, 375.703-375.709, 375.807). |
| A8 Parties & roles | 2 | 3 | 1 | 2 | n/a | 2 | 2 | 0 | C2=3 — *individual shipper* is a four-part conjunctive test, and commercial shipper / GBL shipper are carved out against it (375.103). C4=2 is a deliberate mark-down: the only agent types are **prime agent** and **emergency or temporary agent** (375.205(a)); there is **no booking / origin / hauling / destination agent** anywhere in the part. Broker is present but bounded (375.409, 371.113). |
| A9 Identity & cross-references | 1 | 2 | n/a | 1 | n/a | 2 | 2 | 0 | US DOT number (carrier), MC number, "carrier's shipment registration or bill of lading number", "any identification or registration number you assign to the shipment", vehicle company/carrier id, per-article inventory id, scale name+location. C6=2 for one real typed cross-reference — the weight ticket must carry the shipment/BOL number (375.519(a)(6)) — and for the tacit admission that the shipper has no id, being matched by *last name as it appears on the bill of lading* (375.519(a)(5)). No correlation between *parties'* identifier systems. |
| A10 Survey, estimating & inventory *(out of v1)* | 3 | 3 | 2 | 3 | 1 | 1 | 3 | 1 | Physical survey incl. virtual (375.103); waiver mechanics (375.401(a)); binding vs non-binding with full procedural rules (375.403, 375.405); broker-provided estimates (375.409); volume->weight conversion disclosure (375.401(e)); itemized inventory with per-article ids and condition (375.503). |
| A11 Claims & valuation *(out of v1)* | 2 | 3 | 2 | 3 | 2 | 0 | 2 | 1 | FVP vs released-value 60c/lb; $100/lb high-value declaration; $6.00/lb minimum valuation; 9-month filing / 30-day acknowledgement / 120-day disposition / 60-day extensions; arbitration thresholds and 60-day decision (375.201, 375.203, 375.303, 375.211; App. A xml:706-729). |
| A12 Rating & tariffs *(out of v1)* | 1 | 2 | 0 | 2 | n/a | 0 | 1 | 2 | Does not contain rates; *defines* what a tariff is and requires it to permit "determination of the exact rate(s) and service terms applicable to any given shipment" (375.103 *Tariff*, citing 1310.3(a)). C8=2: the tariff is the explicit, named extension point for impracticable operations, the SIT maximum, COD rules, credit-card acceptance and minimum charges. |

**S5 fit to Pegasus data:** `unknown` for every area. This task read only the
regulation; no pegII or Cloud schema was inspected. The S5 judgement belongs to
`src:pegii-order`, `src:pegii-longhaul` and `src:pegasus-cloud-prisma` in this
same round, and should be settled in the phase-3 area files rather than guessed
here.

## Strengths worth adopting

1. **Make *loaded* an explicit state, and make it the point where commercial
   terms freeze.** 375.401(i) and 375.403(a)(7) turn loading into a legal
   boundary: before it the estimate is amendable by agreement; after it, silence
   *is* reaffirmation. Our A1 lifecycle should have a transition whose invariant
   is "no estimate amendment after this point", not merely a `loaded` status
   string.
2. **Separate `tendered for delivery`, `possession relinquished` and
   `delivered`.** 375.603 / 375.407 / 375.701 are three distinct acts with
   different actors and different money attached. The lawful state "at
   destination, tendered, payment not made, possession retained" must be
   representable.
3. **Three storage situations, not one.** SIT (shipper-requested, tariff-bounded,
   carrier liability continues); carrier-account storage under 375.607 (carrier's
   election, carrier's expense, carrier's liability, near destination, because it
   can tender early and the shipper will not take it); permanent storage (dated
   conversion, liability ends, warehouseman's rules apply, goods held in the
   shipper's name). Collapsing 375.607 storage into SIT would be a real modelling
   error, because the payer and the cause differ.
4. **Conversion to permanent storage as a dated, notified event with a
   liability-shifting effect** — and, crucially, with a **computed fallback**: if
   the notice was never given, liability runs to the end of the day *after* the
   notice was actually given (375.609(g)). That is a domain event whose effective
   time depends on evidence of an act, which a naive `sitConvertedAt` field loses.
5. **Evidence-first facts.** Adopt the pattern wholesale: every asserted fact
   (weight, condition, agreed charges, a delay, a waiver) carries an artefact, an
   asserting party, and a signature or a recorded act with date/time/manner. The
   delay-notification record (*date, time, and manner*, 375.605(b)(1)) is the
   single best template for an event-provenance value object in this corpus.
6. **Corrections are append-only supersessions.** New signed estimate; written
   attachment to the BOL; notations added to the inventory at delivery with a
   copy to the shipper. No source in this cluster models mutation, and neither
   should the core model.
7. **Weight as a method + evidence, not a number.** `origin weigh` vs `back
   weigh` are named methods with preconditions (all equipment aboard, no persons
   on the vehicle, fuel tanks full or no fuel added between weighings,
   375.509(b)). Which method was used determines whether a reweigh right even
   exists (375.517 — origin-weighed only). Model weight as
   {value, method, scale, ticket, asserted-by, superseded-by}.
8. **Per-rule calendar conventions.** Store "15 business days excluding federal
   holidays" and "7 days including weekends" as part of the rule, never as a bare
   day count.
9. **Charge taxonomy with a named tariff-defined open class.** line-haul /
   accessorial-additional / advanced (third-party, carrier-paid, added to the
   BOL) / impracticable operations (tariff-defined, capped) / valuation charge.
   The *advanced charge* concept — a third party performs, the carrier pays and
   passes it through on the BOL — is a distinct billing shape worth keeping.

## Weaknesses / traps

1. **"Order for service" is not a federal term.** It appears **zero** times in
   Part 375 (case-insensitive grep over the captured XML). The federally required
   pre-move documents are the *estimate* and the *bill of lading*. Do not cite
   49 CFR 375 as authority for an `OrderForService` aggregate; that artefact is a
   carrier/van-line construct and must be sourced from van-line and internal
   sources instead.
2. **Its agent vocabulary is the wrong shape for agency work.** Part 375 knows
   only *prime agent* and *emergency or temporary agent*, split on whether the
   agent may sell or arrange transportation. Tenants acting as Allied/Atlas
   agents need **booking / origin / hauling / destination agent**, which this
   source does not contain at any point. Taking A8 role names from Part 375 would
   produce a role set that cannot express the business. Use Part 375 for the
   *shipper-facing* roles (individual shipper, commercial shipper, GBL shipper,
   household goods motor carrier, broker, warehouseman) and get the agency roles
   elsewhere.
3. **There are two estimate types, not three.** 375.401(b) defines *binding* and
   *non-binding* only. "Not-to-exceed" / "guaranteed not to exceed" is **not a
   regulatory estimate type** — the 110% ceiling is a statutory *collection*
   limit that applies to a non-binding estimate (375.407(a)), and a GNTE product
   is a tariff/commercial construct layered on top. Modelling
   `EstimateType = {BINDING, NON_BINDING, NOT_TO_EXCEED}` and citing this
   regulation for it would be an error. If we carry a third type it must be cited
   to a tariff or van-line source and labelled as such.
4. **"Storage-in-transit" is used but never defined here, and has no maximum.**
   375.609 regulates only the *notice* obligations at the end of SIT; the period
   itself is "the maximum period of time provided in your tariff"
   (375.609(c)(2)). Any fixed SIT limit in our model (30/90/180 days) must be
   attributed to a tariff or a program, never to Part 375.
5. **No trip, no stop, no route, no ETA, no telemetry.** Reading A3/A4 from this
   source would produce an execution model with nothing between "picked up" and
   "tendered for delivery". The regulation is deliberately silent on how the
   carrier gets the goods there.
6. **Scope is interstate, individual-shipper, consumer.** Commercial-shipper and
   GBL-shipper moves are explicitly carved out of the *individual shipper*
   definition, and interstate moves entirely within a commercial zone are exempt
   from FMCSA HHG jurisdiction altogether (App. A, *Commercial Zone*, xml:634).
   Corporate/RMC and military work is governed elsewhere. Do not treat Part 375
   rules (110%, 3-day rescission, reweigh right) as universal domain invariants —
   they are conditional on the shipment being a consumer interstate move.
7. **The 110% / 15% / 3-day numbers are regulation-version-dependent.** The
   section-level amendment history is long (e.g. 375.505 amended in 2004, 2007,
   2012, 2015, 2018, 2022 and 2023 — xml:383). Treat these constants as versioned
   policy data, not as literals in the model.
8. **Appendix A is a consumer booklet, not independent authority.** Where it
   paraphrases (e.g. "you also have the right to request a reweigh at no charge",
   xml:875 — the body text at 375.517 says nothing about cost), prefer the
   regulatory text. Cite Appendix A for *vocabulary* (its Definitions and Common
   Terms list, xml:624-651, is the best plain-language glossary available) and
   the body for *rules*.

## Out-of-v1 material

- **A10 — survey & estimating.** *Physical survey* explicitly includes a virtual
  survey conducted over live or pre-recorded video sufficient to "clearly
  identify the household goods" (375.103, xml:56) — keep as the definition of a
  survey modality. Waiver is written, signed **before loading**, retained as a
  BOL addendum (375.401(a)). Volume-based estimates must disclose the
  volume->weight conversion formula in writing and state that final charges are
  by actual weight subject to the 110% rule (375.401(e)). Accessorial charges
  (elevators, long carries) must be determined **before preparing the BOL**; if
  the carrier fails to ask, it must deliver and bill after 30 days (375.401(f)).
  Brokers may estimate only under a written agreement adopting the broker's
  estimate as the carrier's own (375.409).
- **A10 — inventory.** Itemized, identifying "every carton and every uncartoned
  item", with a corresponding identification number placed physically on each
  article (375.503(a)); prepared before or at loading with the shipper given the
  opportunity to observe and verify; at delivery the shipper gets the opportunity
  to verify the same articles and their condition, to note missing articles and
  damage **in writing**, and to receive a copy of those notations (375.503(d)).
- **A11 — valuation.** Full Value Protection is the default and must be priced
  into the initial estimate; minimum valuation $6.00/lb x shipment weight;
  deductible levels permitted; articles of extraordinary value (>$100/lb) may be
  liability-limited unless specifically listed on the shipping documents (App. A,
  xml:706-710). Waiver of FVP = released value 60c/lb per article, at no charge
  (375.303(a), App. A xml:711). Carrier liability may be limited to $100/lb per
  article if the shipper ships >60c/lb goods and fails to notify in writing of
  >$100/lb articles (375.203(b),(c)). Selling insurance without issuing a policy
  => **full liability** (375.303(c)(5)).
- **A11 — claims.** 9 months to file from delivery (or from when delivery should
  have occurred, for total loss); 30 days to acknowledge; 120 days to dispose,
  with 60-day written extensions (App. A xml:729). Delay claims are a *separate*
  claim type, available where guaranteed pickup/delivery was contracted, with
  penalty or per-diem entitlements stated on the BOL (App. A xml:730-732;
  375.505(b)(7)). Cargo delay claims under part 370 are the remedy for failure to
  relinquish possession (375.403(a)(10)).
- **A11 — arbitration.** 11 mandatory programme elements; notice **before
  execution of the bill of lading**; arbitrator independence; cost split capped
  at one half for the shipper; no pre-dispute arbitration agreements; binding
  <= $10,000 at the shipper's election; 60-day decision (375.211).
- **A12 — tariffs.** The definition of *Tariff* (375.103) and its requirement
  that a tariff "be arranged in a way that allows for the determination of the
  exact rate(s) and service terms applicable to any given shipment" is the
  cleanest available statement of what a rating engine must be able to do. The
  tariff is the named home for: impracticable-operations definitions, the SIT
  maximum, COD rules, charge/credit-card acceptance, minimum charges, released
  rates and guaranteed-service provisions.
- **Consumer-information artefacts** (A6-adjacent): "Ready to Move?"
  (FMCSA-ESA-03-005) and Appendix A itself (FMCSA-ESA-03-006) must be furnished
  with the written estimate, with a signed dated receipt retained 1 year if the
  shipper accepts web links instead of copies (375.213(a),(f)).

## Open questions

1. **Where does "order for service" come from, and what is it?** Part 375 has no
   such concept. We need a van-line or internal source (`src:sirva-ade`,
   `src:atlas-world-group-api`, `src:pegii-order`) to say whether it is (a) a
   pre-BOL commitment artefact, (b) the agent-facing work order, or (c) both —
   and whether it can exist without an estimate.
2. **What SIT maximum do our tenants' tariffs actually set?** Part 375 defers
   entirely to the carrier's tariff. Allied/Atlas agency work will be governed by
   the van line's tariff; DoD work by the 400NG's 90-day rule (`src:dp3-400ng`,
   Item 17.3). The model must treat the SIT limit as a per-programme policy
   value. **User input needed** on which tariffs apply.
3. **Is "not-to-exceed"/GNTE a product our tenants sell?** If so, where is it
   defined — van-line tariff, or an internal pegII estimate type? It is not a
   federal type and must not be sourced here.
4. **Does pegII record *how* a shipment was weighed** (origin weigh vs back
   weigh)? The reweigh right exists only for origin-weighed shipments (375.517),
   so the method is not decoration. Question for `src:pegii-order` /
   `src:pegii-longhaul`.
5. **Does any system hold the 375.607 carrier-account storage case distinctly
   from SIT?** They differ in payer, cause and who elects. If both are stored as
   "storage", the mapping layer will have to reconstruct the distinction, and it
   may not be recoverable.
6. **Do we retain the evidence artefacts at all** (signed estimate, signed
   inventory, weight tickets, delay-notification records) or only their derived
   values? Part 375 mandates 1-year retention and mandates that weight-ticket
   copies accompany the freight bill. If the document store is outside pegII, A6
   will need an external-reference concept.
7. **Timezone.** Part 375 states no timezone anywhere, yet several deadlines are
   "end of the day" or "24 hours before". For A4/A5 the model must decide whose
   local day governs — almost certainly the stop's local day. No source here
   settles it; flag for phase 3.
