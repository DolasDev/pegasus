# A5 — Storage-in-transit

Cited elsewhere as **[A5 §x]**.

> **Status.** A decision document and the area comparison for A5. It derives from
> [`00-shared-decisions.md`](00-shared-decisions.md) (**[SD]**) and **does not outrank it**, nor
> [`A8-authority-skeleton.md`](A8-authority-skeleton.md). Where this document and **[SD]** disagree,
> **[SD]** wins and the disagreement is a defect in this file.

> **Scope.** A5 owns the **stay**: the occupancy of a warehouse by goods that are still under a
> transportation commitment. It covers entry and release, where a stay sits in the move, how long it
> may run, when it ends, and what survives its ending. It is **not** the warehouse visit — that is a
> `stop` and A3 owns it — and it is **not** the storage charge, which is A7's. It is also not
> **non-temporary storage**: §3.4 rules that the permanent-storage boundary is the edge of this
> model rather than a flag inside it, and says which three sources force that reading.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged, plus one this area needs stated.

1. **Scope.** An ideal target built from **external sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain is. The
   trap in A5 is specific, and it is a scoring trap rather than a modelling one: `src:pegii-longhaul`
   scores `C2 = 3` and `C4 = 3` on this area — better than most of the corpus — because SIT is
   first-class in it as activity types with written-down meanings. It is **ours**, and §2 does not
   list it.
2. **Disclosure.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]**
   (ours) or **[SYNTHESIS]** (ours, from sourced parts) at the point of use.
3. **Owed means owed.** §6 carries what A5 does not settle and names who owes it. §3.6 refuses to
   mint, and gives the argument every time rather than once — which is most of this document's
   output.
4. **A bailment is not a movement.** A5's four hardest questions all turn on one distinction: the
   **stay** is a holding of goods by a warehouseman, the **shipment** is a movement under a
   commitment, and they begin, end and are identified separately. Where a source fuses them, §3 says
   which half it is being cited for.

---

## 1. The question, stated sharply

Five things are owed to this area by name. Every one is a sentence in a binding document, a marker
in the code, or the rubric's own row, that says A5 decides it.

| #   | Owed item                                                                                                                                                                                                    | Owed by                                                          | Settled at |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------- |
| 1   | **A remedy that opens a SIT stay.** Typed in the code as an owed value, and named at [SD §10.4] as "every remedy shape beyond `newWindow`, of which the one that matters opens a SIT stay and is owed to A5" | [A4 §5] item 2; [SD §2.4] rule 5; `src/outcomes.ts`              | §3.2       |
| 2   | **SIT as a stop vs SIT as a service at a stop.** "Also not settled here (it is an A5/A3 question)… §10.1 requires it to be answered deliberately rather than by inheritance"                                 | [SD §9] item 2; [SD §10.4] bullet 2                              | §3.3       |
| 3   | **What a _terminated_ stay is**, and what survives it. [SD §10.4] bullet 1 splits this with A2; the half that asks what termination does to the **stay** is A5's                                             | [SD §10.4] bullet 1; handed on by [A1 §Cross-area] and [A3 §3.2] | §3.4       |
| 4   | **What the cross-dock dwell between two handovers is** — "whether the cross-dock dwell between two handovers is a `stay`, a SIT occupancy or neither remains A5's"                                           | [SD §4.8.3], closing paragraph; [A3 §8] scenario 8               | §3.5       |
| 5   | **SIT in/out, the warehouse as a stop, duration, the delivery-out leg and the permanent-storage boundary** — record types, projections, or someone else's                                                    | [`../rubric.md`](../rubric.md), the A5 row                       | §3.6       |

### What is already fixed above A5, and is quoted rather than re-derived

A5 inherits more settled structure than any area written so far, because the shared layer used SIT
as its worked example twice. Three of the five decisions below are **forced** by what follows, and a
reader who does not know they are fixed will read a forced choice as a free one.

- **The `stay` is an aggregate** with its own subject kind ([SD §1.2]) and its own published
  identifier — `src:dtr-part-iv`'s SIT control number, `YY` + Julian day of entry + a 4-digit
  intra-day sequence, one **per increment** of a split shipment ([SD §7.4]).
- **Three record types already exist on it**: `storeIn`, `sitEntryDate` and `storeOut`, all family
  `stay` ([SD §4.7.1]). [SD §5.3] is the decision that the store-in **act** and the SIT entry
  **date** are two fact classes and not one, on 400NG Items 29.6 / 17.20 and DTR §D.5.b(2) NOTE.
- **Their authority rows are closed**, which is rare: `storeIn` at [A8 §5] row 7, `storeOut` at row
  8, and `sitEntryDate` at row 7 with authority over its **input** only. A5 is the only unwritten
  area whose central records are not authority-owed.
- **A shipment may be in origin SIT and destination SIT at once**, and the `stay` grain is what makes
  that expressible ([SD §5.3], consequence 1).
- **Custody over a stay is a fold, not an interval** ([SD §4.8.3]). Who held the goods for six weeks
  is `custodyAt(goods, instant)`, and A5 neither stores nor asserts it.
- **A delivery-out day already has a home**: a Trip with one Stop ([SD §8.4]), or an
  `ExternallyPerformedLeg` where the performing party is somebody else's ([SD §8.2]).
- **The SIT remainder does not split the shipment.** It is a Portion ([SD §3]), and [A4 §6.1] gives
  it `PARTY_NOT_READY` as its basis.

### Why getting this wrong is expensive

The two candidate errors are not symmetric, and in A5 the asymmetry is sharper than in A1 because
the corpus itself is split.

- **Publishing the stay as a record with in/out date fields** is the shape two van-line contracts
  actually use — `src:sirva-ade`'s `AddSIT`/`ChangeSIT`/`DeleteSIT` carrying `InDate`/`OutDate`, and
  `src:atlas-world-group-api`'s `SIT` object with `sit_date`/`siT_Out_Date`. It is cheap to write and
  it is **already refused** by [SD §4.7.1], which made the two ends two acts. Re-opening it would put
  a mutable field where an assertion belongs ([SD §1.1]) and would reintroduce the exact defect
  `src:sirva-ade` demonstrates: with no stay identity and no in/out acts, a `ChangeSIT` on a shipment
  that has both an origin and a destination stay **cannot say which one it means** ([SD §7.4]).
- **Minting a type per storage administrative act** — authorise, extend, terminate, convert — is the
  error the corpus most invites, because every regulation-grade source has all four. §3.6 refuses all
  four and §6 records what it would take to un-refuse them. The cost of refusing is gaps the glossary
  carries honestly; the cost of minting is four authority rows owed to a party class that does not
  exist ([A8 §9 item 1]), which is a worse position than the one we are in.

---

## 2. The positions in the external corpus

Twenty-nine external sources were scored for A5 in their own analyses; the per-source scores and
their citations live there and are not restated. What follows is the **positions** — the distinct
answers the corpus gives, and which of them A5 takes.

**A5 is the corpus's best-covered detail area, and it is the only one where the four best sources
are complementary rather than competing.** Four score `C1 = 3` with `C4 = 3`, and each owns a
different face of the same object: the 400NG owns **charging**, the DTR owns **administration**, the
Tender of Service owns the **mover's obligations**, and MilMove owns the **data shapes**. Below them,
two van-line-adjacent APIs and one partner contract show how the industry actually stores it — and
they disagree with each other on the two questions §3.3 and §3.4 have to answer.

### 2.1 "SIT is a defined holding with a cap, a clock and a forced entry" — `src:dp3-400ng` (grade A, `3/3/3/3/3/2/2/1`)

Its own analysis calls it "**the best SIT source we are likely to have**", and it is the only source
in the corpus that **defines** the term: storage-in-transit is "the holding of the shipment, **or
portion thereof**, (except mobile home and boat shipments) in the warehouse used by the TSP or its
agent for storage, **pending further transportation**, and will be affected only at specific request
of the shipper or under the conditions specified below" (Item 17.2, p. 27).

Five things only this source supplies:

1. **Entry has two causes, and the second is not a request.** At the shipper's request (Item 17.2),
   or **forced**: "If delivery cannot be made at the address specified on the BL because of
   impractical operation as defined in Item 33, or for any other reason other than the fault of the
   TSP, and neither shipper, consignor, nor customer designates another address at which delivery can
   be made, TSP will place the property under the SIT provision" (Item 17.15).
2. **A cap that is aggregate, not per-stay.** "may be placed in SIT **one or more times** for an
   aggregate period **not to exceed 90 days** unless the authorized Government representative
   authorizes additional storage" (Item 17.3), extendable in 90-day increments (Item 17.5.c).
3. **Day counting is not calendar occupancy.** Both the day placed in and the day removed count, and
   charges "apply each time SIT service is rendered" (Item 185.3) — so a re-entry restarts a
   **first-day** charge, and a failed delivery attempt that returns the goods to the warehouse incurs
   "a second first day storage charge" (Item 17-1.1.b). Accrual can also stop **before** removal: not
   removed by the 5th GBD after the requested delivery date, and charges "cease to accrue after such
   date" (Item 17.7.a-b).
4. **Segmented entry is rated per segment at its own placement date** (Item 17.17), and partial
   withdrawal is a full sub-procedure — identified by **inventory item numbers**, complete cartons
   only, cartons not opened, the TSP must obtain the actual weight of the portion withdrawn, and
   storage keeps accruing on the remainder (Item 17.13). "During the SIT period, the customer may not
   add property to that already in SIT" (Item 17.14).
5. **Termination has a clock and is irreversible.** Liability ends at **midnight of the day specified
   in the DPS notice**; the warehouse becomes the final destination under that BL; the Government
   "may not revive the TSP's liability under the original BL, or reinstate the original BL"; the
   customer becomes the **depositor**; delivery-out afterwards is billed at current 400NG minus a 25%
   discount (Item 17-2).

**Taken:** the definition (§3.3, §3.5), the two entry causes (§3.2), the irreversibility of
termination (§3.4), and the cap and the day arithmetic as an **absent fact class** rather than a type
(§3.6). **Not taken:** nothing. This source is not contradicted anywhere in the corpus.

### 2.2 "SIT is administered by a third party, and expiry is a ladder" — `src:dtr-part-iv` (grade A, `3/3/3/3/3/3/2/1`)

The Government side of the same regime, and its analysis is explicit that it "complements rather than
duplicates the 400NG's SIT treatment: the 400NG owns SIT _charging_, this owns SIT
_administration_". Four contributions:

1. **Entry is a three-party act.** "TSP requests in DPS → PPSO approves or denies → DPS issues the
   SIT control number" (§C.9.b, §D.5.a). The preconditions branch on whether a direct-delivery
   address was printed on the BL (§D.5.b(1)-(2), p. 18). This is §3.2's evidence that the remedy does
   **not** authorise anything.
2. **The days are one pool, with published arithmetic.** `Days SIT Used = Release Date - Date Placed
in Storage + 1`; `Remaining Days at Destination = Days Authorized - Days Used` (§C.9.c, p. 11),
   carried forward by an SF 1200 setting a new RDD and extended on a **DD 1857**. Origin, in-transit
   and destination SIT draw on the same pool — which is why the location must be recorded at entry,
   and is §3.2's evidence for the third enum member.
3. **Expiry is an obligation ladder where each rung has a different actor and a different evidence
   requirement** (A-406 §A.5, pp. 2-3): a weekly expiration report, then notifications at 30, 20, 15
   and 10 calendar days — the last "by mail **with delivery confirmation**", the USPS proof printed
   into the case file — then a 7-day case file carrying an **SCRA certificate**, then a 5-day forward
   for concurrence, then termination.
4. **Termination is absolute, and one obligation outlives it.** "Shipments remain in SIT until
   terminated by the PPSO and cannot be retroactive" (§A.6.e); the TSP acts "only at midnight on the
   effective date" (§A.6.f(1)); at that moment "**the warehouse becomes the final destination of the
   shipment**" and BL liability ends (§D.5.c(2), p. 19). **And yet**: "When converted to customer
   expense, the customer is still entitled to delivery out of storage paid for by the Government"
   (§D.5.c(1) NOTE).

It also draws the trichotomy §3.4 adopts wholesale: **diversion** (identity and BL kept, destination
changed — and expressly **excluding shipments already in SIT at destination**), **termination**, and
**reshipment** of a terminated shipment, which "moves onward on a **new BL**" (§E.1, §E.4(4)(c)).

**Taken:** all four, plus the trichotomy. This is the source §3.4 rests on.

### 2.3 "Every storage duty has a trigger, a clock, an evidence record and a consequence" — `src:dp3-tender-of-service` (grade A, `3/2/3/3/3/2/2/1`)

The mover's side. Its contribution to A5 is the **preconditions of entry as enforceable
obligations**, and one of them has teeth this document cites more than once:

- Before delivering to SIT instead of the residence: **two documented unsuccessful contact attempts,
  six hours apart**, and "if the first fails the **final attempt must be telephonic**" (§C.3.c).
- **"If PPSO determines the TSP did not provide at least 24 hour notice to the customer before
  placing shipment in SIT, PPSO will deny the SIT and delivery out charges"** (§C.3.h). The
  notification is not advisory; it is the precondition of being paid for the storage.
- "SIT cannot start on weekends and/or holidays" (§C.3.g). Handling-in by **COB of the third GBD**
  after approval (§C.14.b); containerised shipments must not be de-containerised in SIT (§C.14.c);
  loose lots identified in plain view by customer name, BL number and **SIT control number**
  (§C.14.d).
- **Delivery out has a two-branch deadline**: within 7 GBD of the customer's first contact requesting
  delivery, **or** within 2 GBD of the requested delivery date where that is more than 7 GBD out —
  "whichever is later" (§B.11.f(2)).
- The **NTS side is a different contract under one registry id** — its unit is the **lot**, its clock
  is the **storage period**, its counterparty is a Transportation Officer, and "an enforceable
  contract is entered into when the NTS TSP receives the Government service order" (§5.6.3). Its own
  analysis warns that "merging their vocabularies would produce a storage model that is wrong for
  both". §3.4 takes that warning as evidence.

**Taken:** the entry preconditions as **permission**, not authority (§3.2, on the distinction
[A1 §3.5] drew); the HHG/NTS split as an argument for §3.4's boundary.

### 2.4 "Storage is grouped per stay, with an allowance and an extension lifecycle" — `src:milmove-mymove` (grade A, `3/3/3/3/3/3/2/2`)

"The strongest area in the source", and the only place in the corpus where someone has built the data
shapes A5 needs and can be read at grade A:

- `SITLocationType` — `ORIGIN` | `DESTINATION`.
- `sitDaysAllowance`, default 90, and "includes time spent in **both** origin and destination SIT" —
  the DTR's single pool, implemented.
- **`SITServiceItemGrouping` / `SITSummary`**: "a sub-grouping of the SIT service items for one
  _instance_ of SIT — i.e. one stay — with `daysInSIT`, entry, departure and authorized-end dates",
  grouped "by the date they went into SIT". **This is the `stay` grain, arrived at independently.**
- `SITDurationUpdate` (formerly `SITExtension`): `PENDING` → `APPROVED` | `DENIED`, `requestedDays`
  vs `approvedDays`, `contractorRemarks` vs `officeRemarks`, `decisionDate`, and a **closed
  seven-member reason picklist** — `SERIOUS_ILLNESS_MEMBER`, `SERIOUS_ILLNESS_DEPENDENT`,
  `IMPENDING_ASSIGNEMENT` [sic], `DIRECTED_TEMPORARY_DUTY`, `NONAVAILABILITY_OF_CIVILIAN_HOUSING`,
  `AWAITING_COMPLETION_OF_RESIDENCE`, `OTHER`.
- `convertToCustomerExpense` + `customerExpenseReason` — **a stay that continues while its account
  changes**, which §3.4 separates from termination.
- 20 SIT service codes split into four valid sets, and `StorageFacility` (`facilityName`, address,
  `lotNumber`) hung off the **shipment**, not off a stop.

**Taken:** the per-stay grouping as independent corroboration of the `stay` aggregate (§3.3); the
allowance and the extension as one absent fact class rather than two (§3.6); the
customer-expense/termination split (§3.4).

### 2.5 "SIT is a record hung off a stop, with named causes and dated approvals" — `src:atlas-world-group-api` (grade B, `3/2/2/3/3/3/3/1`)

"The standout area" for this source, and the richest single field list in the corpus: `SIT`
(`atlasorder-v1.json:13215`) with `sit_date`/`siT_Out_Date`, `days_authorized` +
`additional_authorized_days`, `location_id`/`agent`/`storageWarehouse`, `permanent`,
`storage_In_Van`/`bonded_Storage`, `extension_request_sent_date`/`extension_request_received_date`,
`supervisor_approval_by`/`_on`, `auto_authorized`, `customer_contacted`, `crossdocked_by`/`_date`,
`sit_stop_number` and `sit_xdl_stop_number` — the latter naming "the cross-dock-delivery stop paired
with the SIT stop", i.e. **the delivery-out leg, identified**.

It also publishes **named causes of a SIT as booleans**: `market_Saturated`, `warehouse_full`,
`long_Cartage_Denied`, `carrier_Convenience`, `nO_Prior_OPS_Approval`, `airport_Handling`.

**Two things about its standing, and they pull in opposite directions.** [SD §9] re-cites every Atlas
operational element as **column-name evidence** and corrects this area's `C2` to 1: "`SIT.status` and
`SIT.reason` remain untyped with no lookup endpoint". But the supplement also records that round 1's
**`C1 = 3` and `C4 = 3` stand and are strengthened** by the independent `estimating-v2` rendering —
and it is that rendering, not the operational one, that carries [SD §9] item 2's usable observation:
`StorageInTransitModel` hangs off `StopModel.storageInTransit`, the declared stop-type enum contains
no storage member, and "a worked example shows origin-side and destination-side SIT coexisting on one
order".

**Taken:** the field inventory as evidence that these facts **exist** (§3.6), the approval pair as
evidence for `stayAuthorisation` (§3.6), and the estimating-side observation as half of §3.3's
evidence. **Not taken:** the causes as reason codes (§3.8), and `permanent` as a flag (§3.4).

### 2.6 "STORAGE IN TRANSIT is a location type" — `src:sirva-ade` (grade A, `3/2/2/3/1/1/1/1`)

A van line's own contract, and **the source that contradicts Atlas on §3.3's question**. Its
`LocationTypeName` enum is `MAINLOAD PICKUP`, `MAINLOAD DELIVERY`, `EXTRA STOP PICKUP`,
`EXTRA STOP DELIVERY`, **`STORAGE IN TRANSIT`** (GSD p.25) — storage as a member of the stop-type
vocabulary, which is precisely what Atlas's estimating enums do not have. It also carries
`LocationSITIndicator` on a location, a `SITAgent` resource type, `SITLocation` ∈ `Origin` |
`Destination`, and `InDate` "Into Warehouse Date" / `OutDate` "Out of Warehouse Date".

And it carries the corpus's clearest **worked failure**, which [SD §7.4] already cites: SIT is
"modeled as a record with dates, not as in/out events — there is no `SITIn`/`SITOut` event", the
record has **no identifier**, and the correction channel is `AddSIT`/`ChangeSIT`/`DeleteSIT`. On a
shipment with origin **and** destination SIT, a `ChangeSIT` cannot say which one it means. Its events
also "carry no reason codes at all — `Cancel`, `Break`, `DeleteSIT`, `ExtendADP` all carry none".

**Taken:** the contradiction itself, which §3.3 resolves rather than ignores, and the worked failure
as the argument for why. **Not taken:** SIT as a dated record, refused at [SD §4.7.1] before A5; and
`NTSP` "NON-TEMP STORAGE CHARGE" as the permanent-storage boundary, which is a charge code and not a
boundary (§3.4).

### 2.7 "Permanent storage is a different product" — `src:weichert-supplier-api` (grade B, `3/3/1/3/2/2/0/1`)

"The best-covered area in this source", and the one that answers §3.4 most directly. It has
`directOrSIT` as an **explicit routing decision** ("Possible options are **Direct or SIT**",
odt:426); four date pairs distinguishing in/out × origin/destination (odt:495-529);
`assignedStorageAgent` and `physicalstorageLocation`; and a SIT cost split first-day /
additional-days / **delivery-out** (odt:561-568).

Its `C2 = 3` is earned by one design choice: **the permanent-storage boundary is modelled as a
separate product.** Long-term storage is its own order type with its own endpoints
(`/v1/supplier/inbound/hhg/lts/`), its own dates (`ltsInDate`/`ltsOutDate`, "**Scheduled**/Actual",
not estimated), its own monthly-storage and warehouse-handling costs, its own `ltsRequestNumber`
(`LTS-00053160`), and a **back-reference** `hhgRequestNumber` to the originating HHG move.

**Taken:** the whole of it, at §3.4. This is a commercial van line making by design the boundary the
DTR makes by regulation.

### 2.8 "Storage is an account, and the boundary is an enum" — `src:smartmoving-api` (grade A on vocabulary, `3/2/2/3/1/2/1/1`)

"The strongest area" in this source, and the counter-position to §2.7: **`StorageType = SIT(0) |
Permanent(1)`** makes the permanent-storage boundary a typed distinction on **one** object rather
than two. The object is a `StorageAccount` per customer — `accountNumber`, `status` (`Creating` |
`Active` | `Closed`), `jobId`, `storageBillingPreOrPostPay`, `storageValuationMethod`
(`ByCWT` | `ByFlatRate` | `ByCubicFoot`), `nextInvoiceAt`, `warehouseName`. `JobType.StorageInBound`
and `StorageOutBound` are the two movements — and note that they are **jobs**, days of service, not
stops. `JobChargeCategory` separates `Storage` from `StorageInTransit`;
`DocumentType.WarehouseRelease` is the release paperwork; `PaymentType.StorageCredit` closes the
loop.

**Taken:** the in/out movements as **acts** rather than dates, corroborating [SD §4.7.1] from a third
direction; the storage account as evidence that the billing relationship is a separate object
(§Cross-area, to A7). **Not taken:** `StorageType` as a flag (§3.4), and the storage account itself,
which is A7's and A11's.

### 2.9 "Nothing pairs with `Stored`" — `src:uncefact-rec24` (grade A, `1/1/0/0/1/0/0/2`)

The one status list in the corpus with a storage vocabulary: 91 `Stored` "The
goods/consignment/equipment has been placed into storage", 267 `Free_storage_time_expired`, 192
`Waiting_for_storage_area`, 375 `Equipment_storage_period_at_terminal_exceeded`, 112
`Held_at_consignee's_disposal`, 315 `Held_by_logistic_service_provider`, 326
`Goods_held_by_third_party_on_instruction_from_owner`, 328 `Moved_internally`, 46 `Moved_into_bond`,
47 `Moved_into_packing_depot`.

Its analysis states the finding A5 needs: "**There is no storage-out code** — nothing pairs with 91,
which is the single most important thing A5 needs." An international status standard has a way to say
goods went in and no way to say they came out. Its `C5 = 1` is earned only by 267 and 375, which
encode "the free period elapsed" — i.e. storage has a billable clock.

**Taken:** the asymmetry, as the sharpest evidence that [SD §4.7.1]'s paired acts were the right call
(§3.6); the free-time codes as corroboration that the clock is a real fact (§3.6, and §Cross-area to
A7).

### 2.10 "SIT is a shipment status" — `src:stedi-x12-reference` (grade A/B, `1/2/0/2/1/n/a/n/a`)

One code, but the right code: **`BC` Storage in Transit** (`/element/1650`) — and its analysis's
observation is the interesting part: it is modelled "as a **shipment status** rather than a stop type
or a separate entity". Adjacent material: `DT` Drop Trailer, `SL`/`SU` Spot for Load/Unload, `S1`
Trailer Spotted at Consignee's Location, and the hold family `B4` Held for Payment, `B5` Held for
Consignee, `BB` Held per Shipper. Element 98 carries `WO`/`WD` storage facility at
origin/destination.

**Taken:** as the third of three mutually incompatible placements — status, stop type, record hung
off a stop — which is §3.3's whole point. **Not taken:** SIT as a status, forbidden by [SD §1.1]
before A5 reaches it.

### 2.11 The twelve sources that have nothing, and what their absence proves

`src:shippeo`, `src:project44`, `src:macropoint`, `src:samsara`, `src:alvys-api`,
`src:omnitracs-roadnet`, `src:open-trip-model`, `src:dcsa`, `src:gs1-epcis-cbv`, `src:gtfs`,
`src:nmfta-ebol` and `src:x12-212-trailer-manifest` all score `C1 ∈ {0, 1}` on A5. That is not filler
— it is the finding `src:shippeo`'s analysis states in as many words, and that [A4 §5] item 2
inherited:

> "**Destination not ready → goods go to SIT.** The deepest structural gap. In freight an exception
> is a _retry_. In HHG this exception starts **a whole new phase** — storage in transit, with its own
> in/out events, duration, charges and a later delivery-out leg (A5). Shippeo, MacroPoint, and every
> freight vocabulary in the corpus model exceptions as 'something to resolve', never as 'something
> that forks the shipment'."

Two of the twelve are worth more than a zero, and both are structural rather than semantic:

- **`src:x12-212-trailer-manifest`** is scored at all because "the entire business case is equipment
  dwelling at a site": a trailer that is `E` Empty is "available for re-use", has a `REF~YS` yard
  position, an arrival, a departure, and a stop reason `CL` Complete distinguishing "sitting here"
  from `LD` Load. That is the skeleton of a storage interval with no storage in it.
- **`src:project44`**'s dwell machinery (`totalDwellTime`, `recordedEntries` = "ordered list of all
  paired entries and exits events", the `DWELL_AT_STOP` exception) "measures hours at a gate, not a
  storage account". §3.5 turns on exactly that distinction.

**Taken:** the gap statement as §3.2's mandate, and the two structural analogues as §3.5's evidence
that a dwell and a stay are different objects.

---

## 3. The decision

### 3.1 The shape, in one picture

Nothing in this picture is new except the remedy. That is the finding, not an apology: the shared
layer minted the aggregate and three of its record types before A5 was written, and A5's work is to
say what they mean at the boundaries — where a stay sits, when it ends, and what a dwell that
nobody opened is.

```
                      a delivery that did not happen
                                  │
                      reasons[0].remedy = { opensStay }          ← §3.2, the only new shape
                                  │  names a `stay` and a location
                                  ▼
   ┌──────────────────────── stay (an aggregate, [SD §1.2]) ───────────────────────┐
   │  identity:  the model's stay id  +  the SIT control number as an `identity`   │
   │             assertion under I-KEY ([SD §7.1], [SD §7.4])                      │
   │                                                                               │
   │  storeIn       ─ act, family `stay`, [A8 §5 r7] ─ the warehouse crew          │
   │  sitEntryDate  ─ date, DERIVED_BY_RULE from the first available delivery date │
   │  storeOut      ─ act, family `stay`, [A8 §5 r8] ─ the warehouseman            │
   │                                                                               │
   │  ABSENT and owed (§3.6): stayAuthorisation · stayAllowance · stayTermination  │
   └───────────────────────────────────────────────────────────────────────────────┘
        │                                 │                              │
   context[] ──▶ stop                context[] ──▶ shipment/portion   evidence for
   the warehouse VISIT               the goods that are held         charges (A7)
   (A3 owns it — §3.3)               (A2 owns the boundary — §3.4)
```

Read three things off it.

1. **The stay and the stop are peers, and neither contains the other** (§3.3). The visit is where a
   vehicle went; the stay is what the goods are doing. Each is in the other's `context[]`, which is
   non-authoritative and is never the resolution key ([SD §1.4]).
2. **Every administrative fact about a stay is absent** (§3.6) — and every **physical** fact about
   it is present and has a closed authority row. That split is not an accident of effort: the
   physical acts have a warehouseman who performs them, and the administrative acts have a
   Government transportation office that [A8 §9 item 1] has not defined.
3. **There is no stay status anywhere.** [SD §1.1] forbids a mutable current-state field, and A5
   does not add a projection to compensate — §3.6 says why the obvious candidate is not publishable
   yet.

### 3.2 The remedy that opens a stay — owed item 1

> **Decision.** `Remedy` gains a second member, `{ opensStay: { stay, location } }`, where `stay` is
> a `SubjectRef` at the `stay` grain and `location` is one of `ORIGIN` | `IN_TRANSIT` |
> `DESTINATION`. It is **permitted on every reason code and required on none**. The owed value
> `Owed<'remedy', 'A5 — …'>` is **discharged**, not re-owned.

**Why the shape is two fields and stops there.** A remedy is a **promise**, not a performance. That
is [SD §2.4] rule 5's own framing — Shippeo's `new_slot {start, end}` is required on appointment
events because "a failed delivery that does not say when it will be retried is an incomplete record"
— and the whole of the HHG case is that there are **two** ways to complete the record, not one. The
goods are either coming back at a new time, or they are going into storage. `newWindow` says the
first; `opensStay` says the second; and a `PARTY_NOT_READY` at a destination that carries neither is
exactly the incomplete record the rule is about.

Everything the corpus hangs off a SIT record that is **not** in this shape belongs somewhere else,
and each has a named home:

| Field the corpus carries                                                          | Where it goes instead                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `sit_date` / `InDate` — when the goods went in                                    | the `storeIn` act's `occurredAt` ([SD §4.7.1]); the accrual date is `sitEntryDate`, a different fact ([SD §5.3]) |
| `siT_Out_Date` / `OutDate`                                                        | the `storeOut` act's `occurredAt`                                                                                |
| `days_authorized`, `sitDaysAllowance`, the DD 1857 extension                      | `stayAllowance` — **absent and owed** (§3.6)                                                                     |
| `supervisor_approval_by`/`_on`, `auto_authorized`, the PPSO's approval            | `stayAuthorisation` — **absent and owed** (§3.6)                                                                 |
| `storageWarehouse`, `assignedStorageAgent`, `StorageFacility`                     | a `partyRole` over the stay — [A8 §9 items 1-2] owe the party entity and the role enum                           |
| `SITFirstDayActivity`, `SITCFD`/`SITCAD`, the first-day/additional-days/out split | `charge` facts with the stay in `context[]` ([SD §4.7.1]'s `charge` row already lists `stay` there) — A7's       |
| `permanent`, `StorageType`                                                        | not a field at all — §3.4                                                                                        |
| `sit_xdl_stop_number`, the delivery-out stop                                      | a Trip with one Stop ([SD §8.4]) or an `ExternallyPerformedLeg` ([SD §8.2]) — already settled, §3.6              |

**`location` earns its place; nothing else on the entry record does.** Three independent sources fix
the location **at entry** and administer or rate the stay differently by it: `src:dp3-400ng` makes
origin SIT and destination SIT separate rate items (Items 17.4, 17.5) governed by different BL blocks
(Items 185.2, 210.1.a); `src:dtr-part-iv` §C.9.c draws origin, in-transit and destination from **one
cumulative pool**, which is only expressible if each entry says which it is; and
`src:weichert-supplier-api` carries four date fields rather than two for the same reason
(odt:495-529). It is also the one field that cannot be recovered later: the goods are in a warehouse
either way, and only the entry decision says which leg of the move that warehouse belongs to.

**The three-member enum against two two-member enums, and the argument for the wider one.**
`src:milmove-mymove`'s `SITLocationType` and `src:sirva-ade`'s `SITLocation` both publish `ORIGIN` |
`DESTINATION` only. Both are **narrower programmes** rather than contradictions: MilMove implements
DP3, which moves under the DTR whose own arithmetic names the in-transit leg explicitly, and
`src:sirva-ade` is a domestic van-line feed whose `C5` on this area is 1. Two regulation-grade
sources carry three and two implementations carry two, so the model carries three and records the
subset. **[SYNTHESIS]**: the members are each sourced; taking the union is ours.

**Why the stay reference is not a second subject.** [SD §1.1] forbids "a second subject hidden inside
the payload", and a `SubjectRef` inside a remedy is exactly the shape that prohibition is worded to
catch. It does not reach this case, and the reason is structural rather than by analogy with
`appliesTo`:

- The prohibition exists because two subjects "make the resolution rule (§4.3) undecidable". A remedy
  cannot reach that rule: **reasons are not facts**. Nothing inside a `reasons[]` member is ever
  selected by a `FactResolved`; what is resolved is the act the reasons hang off, keyed by
  `(subject, type, qualifier?)` ([SD §1.3]) — a key that reads the envelope and never the payload.
- Nothing in the remedy **asserts** anything about the stay. The first record that does is a
  `storeIn` whose **envelope** `subject` is that stay, asserted by the warehouseman under
  [A8 §5] row 7. If it is never published, the promise is a promise that was not kept — which is a
  fact about the delivery, not a half-made aggregate.
- It is therefore a **forward reference**, and the model already has forward references that nobody
  reads as subjects: `context[]` is one ([SD §1.4]), and `evidence[]` is another.

**What it does not do: authorise the stay.** This matters because the corpus's entry procedure is a
three-party act and a naive reading would let one party's remedy stand in for it. `src:dtr-part-iv`
§D.5.a: the TSP **requests** in DPS, the PPSO **approves or denies**, DPS **issues** the control
number. `src:atlas-world-group-api` has the same shape commercially
(`supervisor_approval_by`/`_on`, `auto_authorized`), and `src:dp3-tender-of-service` §C.3.h makes the
customer notification itself a precondition of being paid — "PPSO will deny the SIT and delivery out
charges". The authorisation is its own act, it is **absent and owed** (§3.6), and until it lands the
model can say a stay was promised and can say goods were put in a warehouse, and cannot say anybody
was entitled to do so. **That is the honest state and it is stated rather than papered over**; [A5 §6]
carries it.

**Why it is not required on any code, including `PARTY_NOT_READY`.** The temptation is real, because
`src:dp3-400ng` Item 17.15 is mandatory in fact — where delivery cannot be made and no alternative
address is designated, "TSP **will** place the property under the SIT provision". But Item 17.15
compels the **placement**, not the **record**, and the two come apart in three of the corpus's own
cases: the shipper may designate another address (17.15's own escape), the customer may agree a new
delivery date on the spot (the `newWindow` branch), or the carrier may store on **its own account**
under `src:cfr-49-375` §375.607 — see the next paragraph — where the customer's record should not
say a SIT stay was opened at all. A `remedyRequired` on `PARTY_NOT_READY` would need a
two-shape disjunction in a column that carries one shape, and would make three legitimate outcomes
unrepresentable to remove one incomplete record. `remedyRequired` stays `false` and the
argument lives here. **[ORIGINAL]** as a refusal; the three cases are each sourced.

**And not every stay is opened by a remedy — which is the second entry path and is easy to miss.**
`src:cfr-49-375` §375.607(a)-(c): where the carrier can tender more than 24 hours before the agreed
date and the shipper will not accept, the carrier "may place [the shipment] in storage **on its own
account and at its own expense**" near destination, must immediately notify the shipper of the
warehouse name and address, **retains BOL liability**, and bears redelivery, handling and storage.
No delivery failed; no act carries a reason; there is nothing for a remedy to hang off. That stay is
a `storeIn` with nothing behind it, and the model expresses it without difficulty — which is the
test that the remedy is genuinely optional rather than optional on paper. `src:cfr-49-375`'s analysis
is explicit that it "separates **three** storage situations most models conflate", and this is the
one nobody else has.

### 3.3 SIT is neither a stop nor a service at a stop — owed item 2

> **Decision.** The question as [SD §9] item 2 poses it is a **false alternative**, and A5 answers it
> by refusing both halves. A stay is a `stay` — an aggregate, not a property of a visit. The
> warehouse **visit** is a `stop`, because a vehicle went to a place and someone did something there.
> Neither contains the other; each appears in the other's `context[]`. [A3 §5.1] already reached this
> answer and A5 **ratifies** it rather than reopening it.

**The corpus is split three ways, which is why this could not be settled by counting.**

| Position                                  | Source                                                                                         | Standing                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SIT is a **service at** a stop            | `src:atlas-world-group-api` — `StopModel.storageInTransit`, no storage member in the stop enum | grade B; the estimating-side enums, which [SD §9] rates as usable |
| SIT is a **stop type**                    | `src:sirva-ade` — `STORAGE IN TRANSIT` in `LocationTypeName` (GSD p.25)                        | grade A                                                           |
| SIT is a **shipment status**              | `src:stedi-x12-reference` — element 1650 `BC`                                                  | grade A/B                                                         |
| SIT is a **per-stay grouping of service** | `src:milmove-mymove` — `SITServiceItemGrouping` / `SITSummary`, grouped by entry date          | grade A                                                           |

Three of the four are incompatible with each other and the fourth is the shape the model already has.
**Two of the three are foreclosed above A5** and A5 does not get to relitigate them: a shipment status
is a mutable current-state field, forbidden by [SD §1.1]; and a stop type that names storage is a
second classification axis over the same fact, which is the `facilityTypeCode` question [SD §9] item
1 hands to A3 and not to A5.

**What A5 does decide is the remaining one, and the argument is the stay's arithmetic.** A stay has
properties no visit can carry, and the test is whether they survive when the visit does not:

1. **A stay outlives every visit that touches it.** The goods arrive on one trip and leave on
   another, days or months later, possibly on a different agent's vehicle ([SD §8.2]). The DTR's
   `Days SIT Used = Release Date - Date Placed in Storage + 1` spans both. A property of a visit
   cannot be the subject of an arithmetic that ends at a different visit.
2. **A stay can exist with no visit of ours at all.** `src:cfr-49-375` §375.607's carrier-account
   storage, and any lot delivered out by a party whose vehicle we never see.
3. **A shipment can have two stays at once** (§1) and `src:sirva-ade` proves the cost of not being
   able to name them apart.
4. **Conversely, one visit can serve several stays** — `src:dp3-400ng` Item 17.17's segmented entry
   rates each segment at its own placement date, and `src:dtr-part-iv` gives a split shipment "its
   own SIT control number per increment".

**And the warehouse visit is still a stop, which is the half A3 got right and must keep.** [A3 §5.1]
states it and A5 adopts the wording: "a vehicle physically went somewhere, someone was there,
something was unloaded… Treating the visit as an attribute of a service would leave cartage, warehouse
handling and the delivery-out day with nowhere to be." What [A3 §5.1] also says — and this is the part
that makes the two documents agree — is that the previous revision's error "was not that it used a
warehouse **stop** — it is that it made a warehouse stop the _entire_ SIT seam, with no stay".

**So A5's contribution here is ratification plus one correction of emphasis, and no amendment to A3.**
The correction is to the framing rather than to A3: [SD §9] item 2 records the question as
"SIT-as-a-stop vs SIT-as-a-service-at-a-stop", and both horns assume the stay is a property of
something. It is not; it is an aggregate, and [SD §1.2] and [SD §7.4] had already made it one before
the question was written down. Where the estimating-side Atlas observation is right is **negatively**:
SIT is not a stop _type_, and the declared enum's silence is evidence for that. Where
`src:sirva-ade` is right is that a warehouse visit is a real place in a real sequence. Both are
accommodated; neither wins.

### 3.4 Termination, conversion and the customer-expense switch — owed item 3

> **Decision.** Three different endings exist in the corpus and the model keeps them apart.
> **(a)** Conversion to **customer expense** changes who pays and nothing else — the stay continues,
> the identity is untouched, and it is A7's. **(b)** **Termination** ends the carrier's bill-of-lading
> liability and makes the warehouse the final destination; it does **not** end the occupancy, does
> **not** change the stay's identity, and does **not** end the order. **(c)** Conversion to
> **permanent storage** ends the stay and leaves this model: what follows is a different bailment
> under a different contract, and v1 does not carry it.

**(a) Customer expense is not an ending at all, and one source models it correctly.**
`src:milmove-mymove`'s `convertToCustomerExpense` + `customerExpenseReason` reclassify a SIT service
item so the customer rather than the Government pays it. Nothing about the goods, the warehouse or
the occupancy changes. In this model that is a `charge` fact — [SD §4.7.1]'s `charge` row already
lists `stay` in its `context[]` — and A7 owns it. It is listed here only because
`src:dtr-part-iv` uses the phrase "converted to customer expense" **in the same sentence** as
termination (§D.5.c(1) NOTE), and a reader who collapses the two will conclude that termination
changes the payer, which it does not.

**(b) Termination: what ends, and what does not.** The sources are unusually precise, and they are
precise about the same facts from two sides:

| What termination does                                       | Cite                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| Ends the TSP's bill-of-lading liability                     | `src:dtr-part-iv` §D.5.c(2); `src:dp3-400ng` Item 17-2.2 |
| Makes the warehouse "the final destination of the shipment" | `src:dtr-part-iv` §D.5.c(2); `src:dp3-400ng` Item 17-2.2 |
| Makes the customer, not the Government, the **depositor**   | `src:dp3-400ng` Item 17-2.5                              |
| Takes effect **only at midnight** on the effective date     | `src:dtr-part-iv` A-406 §A.6.f(1)                        |
| Cannot be retroactive and cannot be revived                 | `src:dtr-part-iv` §A.6.e; `src:dp3-400ng` Item 17-2.2    |
| Leaves the customer entitled to delivery out of storage     | `src:dtr-part-iv` §D.5.c(1) NOTE                         |

**Nothing in that list is a fact about the stay's identity, and nothing in it moves the goods.** The
same lot is in the same warehouse under the same SIT control number the minute after midnight as the
minute before. What changed is a **liability**, a **destination designation** and a **party role** —
three facts with three different subjects, none of which is the stay. So:

> **A5's half of [SD §10.4] bullet 1: `storeOut` after a terminated stay names the same `stay` as
> its `storeIn`.** The occupancy is one occupancy. **[SYNTHESIS]** — every input is sourced; the
> inference that a bailment survives the death of the carriage contract is ours, and it is the only
> reading under which §D.5.c(1) NOTE's surviving delivery-out entitlement has anything to be an
> entitlement **to**.

**What A5 does not decide, and hands back:** whether the goods moving onward are the same
**shipment**. `src:dtr-part-iv` §E.4(4)(c) says a terminated shipment moves on a **new BL**, and
§E.1's diversion expressly **excludes shipments already in SIT at destination** — so the documentary
event is real and A2 owns it ([SD §10.4], [A3 §3.2]). A5's contribution is a constraint: **the stay
is not the thing that answers it.** A reader looking for shipment identity across termination will
find the stay id unchanged and must not read that as the shipment's identity surviving; the stay is a
bailment and the shipment is a movement, and only one of them ended.

**And the hand-off from [A1 §Cross-area] closes here.** A1 recorded the tension — "one obligation
survives the death of the contract that created it… under A1-STAGE a terminated-SIT order is still
`ACCEPTED`, so the commitment does not end when liability does. If A5 needs the two to part company,
A1's stage is not the mechanism." **A5 does not need them to part company.** The obligation that
survives is an obligation **of the order** — delivery out of storage, paid for by the Government —
and an order whose commitment is still outstanding is exactly what `ACCEPTED` means under
[A1 §3.3]. The liability that ended is the carrier's liability **for the goods**, which is a custody
and claims fact and is not what the order's stage encodes. A1's stage is right, and needed no
mechanism.

**(c) Permanent storage is the edge of the model, not a flag inside it.** Two sources model it as a
flag on the storage object — `src:atlas-world-group-api`'s `permanent` boolean and
`src:smartmoving-api`'s `StorageType = SIT | Permanent`. **Four model it as a different thing**, and
three of those four are the highest-graded sources in the area:

- `src:cfr-49-375` §375.609(b),(h): conversion is a **dated event** that ends carrier liability and
  subjects the goods to "the rules, regulations, and charges of the warehouseman"; it opens a
  nine-month claims window; and the goods must be placed **in the individual shipper's name** with
  the shipper's contact details. A bailment with a new bailor is a new bailment.
- `src:dp3-400ng` Item 27.3 separates NTS/NTSR as "a **separate program**", where NTS delivery makes
  the facility the final destination and "further movement moves under a separate BL".
- `src:dp3-tender-of-service`: the NTS side is a **different contract** with a different unit (the
  lot), a different clock (the storage period), a different counterparty and a different formation
  rule — and its own analysis warns that "merging their vocabularies would produce a storage model
  that is wrong for both".
- `src:weichert-supplier-api` does the same thing commercially and by design: LTS is its own order
  type, its own endpoints, its own dates, its own costs, and a back-reference to the HHG move it came
  from.

**The flag loses, and the reason is not a head-count.** A flag asserts that the object is the same
object with a different value; all four sources above assert that the obligations, the parties, the
clock and the charging basis all change together. That is not a property, it is a different
aggregate — and modelling it as a flag would mean every rule in this document silently acquires an
"unless `permanent`" clause. A5 therefore rules that **conversion to permanent storage terminates the
stay**, and what follows is out of scope for v1 and owed forward (§6, §Cross-area to A2 and A11).
The one thing A5 does fix is that the boundary is **crossable in one direction only** and leaves a
record: `src:cfr-49-375` §375.609(b)-(g) gives it a notice with a deadline (≥ 10 days, or 1 day where
the SIT period is under 10 days), four mandatory contents, and a consequence for not giving it —
carrier liability "automatically continues until the end of the day following the date when you
actually gave notice" (§375.609(g)). That notice is a `notification`, whose recipient field
[A8 §9 item 6] owes.

### 3.5 The cross-dock dwell — owed item 4

> **Decision.** A dwell is a stay **if and only if a stay was opened for it**. There is no test on
> duration, on facility type, on who is holding the goods or on why. Where no stay exists, the dwell
> is the gap between two `handover` assertions, `custodyAt` answers who held the goods across it, and
> the model says nothing else about it — which is what [SD §4.8.3] means by "the fold is deliberately
> indifferent to it".

[SD §4.8.3] left this open in one sentence — "whether the cross-dock dwell between two handovers is
a `stay`, a SIT occupancy or neither remains A5's" — and [A3 §8] scenario 8 is rated "dwell
classification deferred to A5". The temptation is to write a test, and the corpus is what defeats
every candidate test:

- **Not duration.** `src:dp3-400ng` Item 17.2's definition is "holding… **pending further
  transportation**", which describes a cross-dock exactly. Nothing in it is about how long.
- **Not the facility.** `src:dcsa`'s `DEPO` depot and `OFFD` off-dock storage, `src:project44`'s
  `WAREHOUSE` stop type, and `src:nmfta-ebol`'s `Storage-18`/`Storage-71` limited-access sites are
  all **destination types**, not storage states. [A3 §2.1] already flags
  `src:open-trip-model`'s `Location.type = warehouse` as "a trap".
- **Not the cause, and this is the one that looks like it should work.**
  `src:atlas-world-group-api` publishes `carrier_Convenience` as a **named cause of a SIT**,
  alongside `market_Saturated` and `warehouse_full`. A cross-dock is carrier convenience by
  definition — so a test that excluded carrier-convenience dwells from being stays would contradict
  a source that says carrier convenience is a reason a SIT exists.
- **Not who holds the goods.** That is `custodyAt`, and [SD §4.8.3] says in terms that the fold
  "answers who holds the goods over the dwell without naming what the dwell is".

**So the classification is not derivable from the dwell, and A5 does not derive it.** It is made by
the record that opens the stay — a `storeIn` whose subject is a stay, or a promise of one under §3.2
— and that record exists because a party with a reason to create it created it. This is the same
discipline the model applies everywhere else: [SD §1.1] makes state a projection rather than an
inference, [SD §4.8] makes custody a fold over published acts rather than a guess from position, and
[SD §5.2] M1 forbids `ASSUMED_FROM_PLAN` at `basis = ACTUAL` precisely because "nobody asserted it;
the plan stood unchallenged" is not a fact. **A dwell that nobody called storage is not storage.**
**[ORIGINAL]** — no source states this rule; what the sources supply is the refutation of every
alternative.

Two consequences worth stating so they are not rediscovered:

1. **The same physical situation can be a stay on one move and not on another**, and that is correct
   rather than sloppy. `src:atlas-world-group-api`'s `crossdocked_by`/`crossdocked_date` sit **on the
   SIT record** — the same cross-dock, recorded as part of a storage stay because one was opened.
   `src:project44`'s `DWELL_AT_STOP` measures the same hours with no storage anywhere. Both are real
   and the difference between them is commercial, not physical.
2. **An unclassified dwell is not a gap in the model.** The goods have an arrival and a departure at
   the stop ([SD §4.7.1], family `stop`), a `handover` at each end if custody moved, and a
   `custodyAt` answer at every instant in between, with `IN_TRANSFER_GAP` where only the release side
   is published ([SD §4.8.3] C5). What it does not have is a duration anybody can bill, which is the
   correct answer when no one opened a storage account.

### 3.6 The rubric's five, triaged — owed item 5

The rubric gives A5 "SIT in/out, warehouse as a stop, duration, delivery-out leg, permanent storage
boundary". A1's §3.4 established the discipline for a row like this: say of each whether it is a
record type, a projection, or somebody else's — and refuse to mint where the mint would cost more
than the gap.

| Rubric item                    | Verdict                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SIT in / SIT out**           | **Record types, and they already exist** — `storeIn` and `storeOut`, family `stay`, authority closed at [A8 §5] rows 7 and 8. A5 adds nothing and changes nothing |
| **Warehouse as a stop**        | **Somebody else's** — a `stop`, A3's, §3.3                                                                                                                        |
| **Duration**                   | **Absent and owed** — `stayAllowance`, below                                                                                                                      |
| **Delivery-out leg**           | **Somebody else's, and already settled** — a Trip with one Stop ([SD §8.4]) or an `ExternallyPerformedLeg` ([SD §8.2]); scenario 2 runs it                        |
| **Permanent-storage boundary** | **Not in the model** — it terminates the stay and leaves, §3.4(c)                                                                                                 |

**Three fact classes the corpus names and no table carries, recorded as absent under [SD §4.7.3].**
Each is named by four or more sources, at least two of them regulation-grade. None is minted, and the
argument is the same one in all three cases, so it is given once:

> **Each of these acts is performed by a Government transportation office or by a van line's own
> approving supervisor.** [A8 §9 item 1] has not defined the party entity and [A8 §9 item 2] has not
> defined the role enum — so a [SD §4.7.1] row written today would carry `authority: owed` and would
> land on [A8 §9 item 8]'s ledger on the day it was written. That trades one honest gap for two, and
> [SD §4.7] note 3 already bars a provisional authority reading from scoring. The physical acts on a
> stay have a warehouseman who performs them and are therefore closed; the administrative acts do
> not, and are therefore not.

- **`stayAuthorisation`** — the act that authorises a stay. `src:dtr-part-iv` §D.5.a (TSP requests →
  PPSO approves or denies → DPS issues the control number); `src:atlas-world-group-api`
  (`supervisor_approval_by`/`_on`, `auto_authorized`); `src:milmove-mymove` (SIT service items
  `SUBMITTED` → `APPROVED` | `REJECTED`, with an explicit resubmission protocol whose `updateReason`
  "must have a different value than the current `reason` value"); `src:dp3-tender-of-service` §C.3.h,
  which makes the 24-hour customer notification a precondition of payment.
- **`stayAllowance`** — the days authorised, and the extensions that change it. `src:dp3-400ng` Item
  17.3 (90-day aggregate, 90-day increments); `src:dtr-part-iv` §C.9.c (`Days Authorized`, DD 1857);
  `src:milmove-mymove` (`sitDaysAllowance`, `SITDurationUpdate` with seven reason codes);
  `src:atlas-world-group-api` (`days_authorized` + `additional_authorized_days`, with an extension
  request/receipt date pair). **An extension is not a fourth class**: it is a later assertion of this
  one riding `supersedes` ([SD §4.1]), which is what MilMove's `requestedDays` vs `approvedDays`
  already is once the request and the decision are two records. Minting `stayExtension` beside
  `stayAllowance` would be two types for one fact.
- **`stayTermination`** — the act that ends a stay without ending the occupancy (§3.4).
  `src:dtr-part-iv` A-406 §A.6.e-f and §D.5.c(2); `src:dp3-400ng` Item 17-2; `src:cfr-49-375`
  §375.609(b); `src:sirva-ade`'s `DeleteSIT`, which is the same act with no reason code on it.

**And one fold that is _not_ published, which is the harder refusal.** `src:dtr-part-iv` §C.9.c
publishes the SIT day arithmetic **verbatim** — two equations, grade A, regulation-grade — and
`src:dp3-400ng` Items 185.3, 17-1.1.b and 17.7.a-b supply every edge case: both end days count, a
re-entry restarts the first-day charge, and accrual stops at the 5th GBD after the requested delivery
date whether or not the goods have moved. That is more support than `custodyAt` or `orderStageAt` had.
It is still not publishable, for one reason: **its principal input is `stayAllowance`, which does not
exist.** `Remaining Days = Days Authorized - Days Used` over an owed value is a fold that returns
owed. Publishing the half that does compute — days used, from `storeIn` and `storeOut` — would be
publishing an accrual number with no cap beside it, and `src:dp3-400ng` Item 17.7's whole point is
that occupancy and accrual are not the same count. **Recorded at [A5 §6] as owed forward**, to land
with `stayAllowance`, and the arithmetic is cited here so that whoever writes it does not have to
find it again.

### 3.7 The criteria weighted, and why

The rubric requires the weights to be recorded per area. A5 weights **C4 heaviest** — the only area
so far to do so — then C3, then C2; it discounts C1 and C6 and treats C7 as a tie-breaker.

1. **C4 — HHG fidelity, weighted highest, because this area does not exist outside household
   goods.** Twelve of the twenty-nine sources score `C1 ∈ {0, 1}`, and they include every general
   freight standard in the corpus: DCSA, EPCIS, OTM, GTFS, project44, Shippeo, Samsara, MacroPoint.
   In every other area a freight standard supplies the structure and HHG supplies the detail; here a
   freight standard supplies **nothing**, and `src:shippeo`'s own analysis says why in terms. The
   four sources that decide this document all score `C4 = 3`.
2. **C3 — lifecycle rigor, second, and it is what separates the top four from the next three.**
   `src:dp3-400ng`, `src:dtr-part-iv` and `src:dp3-tender-of-service` each score `C3 = 3` and
   `src:milmove-mymove` scores 3; `src:atlas-world-group-api` scores 2, `src:sirva-ade` 2 and
   `src:weichert-supplier-api` 1. Every question A5 was actually asked — when a stay may be opened,
   what ends it, what survives — is a C3 question, and the three sources with rich field lists and
   low C3 contributed **inventories** rather than rules.
3. **C2 — semantic precision, third, and it decides §3.4.** Only one source in the corpus **defines**
   storage-in-transit (`src:dp3-400ng` Item 17.2) and only one defines the permanent-storage boundary
   by construction (`src:weichert-supplier-api`, `C2 = 3`, LTS as a separate product). The two
   sources that carry the boundary as a flag score `C2 = 2` and `C2 = 2`, and neither defines either
   member of its own enum.
4. **C7 — provenance, a tie-breaker rather than a weight.** It is where
   `src:atlas-world-group-api` scores its only 3 in this area and earns its place in §3.6: dated
   actor pairs on every administrative act (`supervisor_approval_by`/`_on`, `crossdocked_by`/`_date`,
   `cancelled_by`/`_date`) are exactly the evidence that these acts have asserters, which is the
   premise of the refusal to mint. It is a weight of 3 on a source graded B, so it supports an
   existence claim and never a semantic one.
5. **C1 — coverage, discounted deliberately, and more sharply than A1 discounted it.** Coverage in
   A5 means "has SIT fields", and five sources have those while disagreeing with each other about
   what SIT **is** (§3.3's table). `src:sirva-ade` scores `C1 = 3` and has no stay identifier at all.
6. **C6 — identity, discounted because it is already spent.** `src:dtr-part-iv` scores `C6 = 3` on
   the constructed SIT control number, and that score has already been cashed: [SD §7.4] used it to
   withdraw `fork-order`'s foreclosure #3. A5 inherits the result and re-earns nothing.
7. **C5 — time, carried, not weighted.** A5's time model is [SD §4.2]'s and [SD §5.3]'s and is not
   relitigated. The one A5-specific datum is `src:dp3-400ng` Item 17.7's accrual-ceases rule, which
   §3.6 records as belonging to the unpublished fold.

**The best source per criterion**, which is what phase 3 asks for: `src:dp3-400ng` on C2 and C4;
`src:dtr-part-iv` on C3, C6 and the whole of §3.4; `src:dp3-tender-of-service` on the entry
preconditions; `src:milmove-mymove` on the data shapes and on C7 at grade A;
`src:atlas-world-group-api` on C7 at grade B and on the field inventory;
`src:weichert-supplier-api` on the permanent-storage boundary. **No single source wins A5** — but it
is the closest the corpus comes, because the top four are complementary by construction rather than
by luck: they are four faces of one regulated regime.

### 3.8 Explicitly rejected

| Rejected                                                     | Source                                                                             | Why                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `SIT` **record with in/out date fields**                   | `src:sirva-ade` `InDate`/`OutDate`; `src:atlas-world-group-api` `sit_date`         | Refused at [SD §4.7.1] before A5; the two ends are two acts with two asserters. `src:sirva-ade`'s own `ChangeSIT` ambiguity is the worked cost ([SD §7.4])                                                                                                                                    |
| **SIT as a shipment status**                                 | `src:stedi-x12-reference` element 1650 `BC`                                        | [SD §1.1] forbids a mutable current-state field. It is also the wrong subject: the status would be on the goods, and the stay is what has the duration                                                                                                                                        |
| **SIT as a stop type**                                       | `src:sirva-ade` `STORAGE IN TRANSIT` in `LocationTypeName`                         | §3.3. A stay outlives its visits, can exist without one of ours, and can be two at once                                                                                                                                                                                                       |
| **`permanent` as a flag on the stay**                        | `src:atlas-world-group-api` `permanent`; `src:smartmoving-api` `StorageType`       | §3.4(c). Four sources change obligations, parties, clock and charging basis together, which is a different aggregate and not a property                                                                                                                                                       |
| The **Atlas SIT causes as reason codes**                     | `market_Saturated`, `warehouse_full`, `long_Cartage_Denied`, `carrier_Convenience` | They are properties of the **stay**, not reasons on a failed act — nothing about them explains an `outcome`. Two are already covered where they do explain one (`RESOURCE_UNAVAILABLE`, `AUTHORISATION_MISSING` for `nO_Prior_OPS_Approval`, [A4 §3]); the rest belong to `stayAuthorisation` |
| A **`stayExtension`** type beside the allowance              | `src:milmove-mymove` `SITDurationUpdate`; `src:atlas-world-group-api`              | §3.6. A later assertion of the same fact on `supersedes` ([SD §4.1]). Two types for one fact                                                                                                                                                                                                  |
| A **`sitDaysUsedAt` projection** published now               | `src:dtr-part-iv` §C.9.c's two equations, verbatim                                 | §3.6. Its principal input is owed; a fold over an owed value returns owed, and half of it is an accrual figure with no cap beside it                                                                                                                                                          |
| **MilMove's two-member `SITLocationType`** as the enum       | `src:milmove-mymove`; corroborated by `src:sirva-ade`                              | §3.2. Two regulation-grade sources carry the in-transit leg; the two-member enums are narrower programmes and are recorded as the subset                                                                                                                                                      |
| The **storage account** as an A5 object                      | `src:smartmoving-api` `StorageAccount`                                             | It is a billing relationship with a customer, not an occupancy: it has a `nextInvoiceAt` and a valuation method and survives every stay under it. A7's and A11's                                                                                                                              |
| **`remedyRequired` on `PARTY_NOT_READY`**                    | available, and tempting — `src:dp3-400ng` Item 17.15 is mandatory                  | §3.2. Item 17.15 compels the placement, not the record, and three legitimate outcomes would become unrepresentable                                                                                                                                                                            |
| A **dwell-classification rule** on duration or facility type | the obvious shape                                                                  | §3.5. Every candidate test is refuted by a source, and `src:atlas-world-group-api`'s `carrier_Convenience` refutes the most plausible one                                                                                                                                                     |

---

## 4. What this forecloses, and the cost if it is wrong

**Foreclosed by design:**

1. **A stay cannot be inferred.** §3.5 makes the classification a consequence of a published record
   and of nothing else, so there is no rule a consumer can run over arrivals and departures to
   discover storage. **If this is wrong**, it is wrong in the direction of under-reporting: goods
   that sat in a warehouse for a month with nobody recording a stay produce no stay. The repair is
   cheap — publish the `storeIn` — and it is the same repair the model prescribes everywhere else
   that a fact was not asserted. The alternative error is not cheap: an inferred stay would be an
   accrual clock nobody started, and `src:dp3-tender-of-service` §C.3.h says what an unearned
   storage charge costs.
2. **A stay's administrative state cannot be read.** With `stayAuthorisation`, `stayAllowance` and
   `stayTermination` all absent, there is no way to ask "is this stay authorised", "how many days are
   left" or "has it been terminated". **This is the largest hole A5 leaves** and it is deliberate;
   §6 carries it and §3.6 gives the price of the alternative. The cost if the refusal is wrong is one
   round of work that lands three rows together with the party entity — not a migration, because
   nothing was published in their place.
3. **The permanent-storage boundary cannot be crossed inside the model.** §3.4(c). **If this is
   wrong** — if the industry really does treat SIT and permanent storage as one object with a flag,
   as two of the seven sources do — the cost is real: every conversion becomes a stay that ends and
   an out-of-model bailment that begins, and the link between them is an `identity` correlation
   rather than a field. `src:weichert-supplier-api` shows that exact link being made in practice
   (`ltsRequestNumber` carrying `hhgRequestNumber` as a back-reference), which is the evidence that
   the cost is one the industry already pays.
4. **The remedy cannot carry the stay's dates, duration, warehouse or charges.** §3.2's table. **If
   this is wrong**, a consumer that wanted the whole entry in one record has to read two — the
   remedy and the later `storeIn` — which is the cost [SD §5.3] already accepted when it split the
   act from the date.

**Not foreclosed, and worth saying so:**

- **Adding the three absent classes later is additive** ([catalog §2.3], `newRecordType`), because
  nothing was published in their place and no existing row moves.
- **A stay with no `storeOut`** is legal and is modelled — the Alloy `cardinality` model has the
  predicate for exactly this case, and it is what an unterminated stay looks like from the outside.
- **`storeIn` on a Portion's worth of goods** needs no new mechanism: the Portion rides
  `context[]` and `src:dp3-400ng` Item 17.13's partial withdrawal is [SD §3]'s `ENUMERATED` Portion
  by inventory item number, which is the form [SD §5.4] requires.

---

## 5. ORIGINAL design — what household-goods moving needs that no source supplied

Three things, and they are smaller than A3's list because the shared layer had already done the
structural work.

1. **The dwell rule — [ORIGINAL], §3.5.** "A dwell is a stay if and only if a stay was opened for
   it." No source states it; what the corpus supplies is the refutation of every alternative test.
   Its falsification condition is stated so it can be checked: **if a source is found that classifies
   a dwell as storage by a property of the dwell itself — a duration threshold, a facility type, a
   custody rule — this rule is contested and must be re-argued.** `src:atlas-world-group-api`'s
   `carrier_Convenience` is the nearest thing to such a source and it points the other way.
2. **The survival of the stay across termination — [SYNTHESIS], §3.4(b).** Every input is sourced;
   the inference that the bailment outlives the carriage contract is ours. It is the only reading
   under which `src:dtr-part-iv` §D.5.c(1) NOTE's surviving delivery-out entitlement has an object,
   and it is what lets A1's `ACCEPTED` stage stand without a special case.
3. **The union of the two location enums — [SYNTHESIS], §3.2.** Each member is sourced; taking the
   wider of two published enums and recording the narrower as a subset is ours.

**And one refusal that is as much a design decision as a mint would have been.** §3.6 declines to
publish the SIT day fold although two regulation-grade sources publish its arithmetic verbatim. A
model that published every fold it had the equations for would have an accrual clock with no cap, and
`src:dp3-400ng` Item 17.7 exists to say those are different numbers. Recording the equations at §3.6
without executing them is the honest middle, and it is what [SD §0] asks for.

---

## 6. What only the user can decide, and what is owed elsewhere

### Owed, with an owner

| #   | Owed                                                                                                                        | Owner                        | Why it is not settled here                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`stayAuthorisation`** — a [SD §4.7.1] row and an [A8 §5] row                                                              | [SD §4.7.3] + [A8 §9 item 1] | The asserting party is a Government transportation office or an approving supervisor; the party class does not exist (§3.6)     |
| 2   | **`stayAllowance`** — the same pair                                                                                         | [SD §4.7.3] + [A8 §9 item 1] | Same. The extension rides `supersedes` and needs no fourth class                                                                |
| 3   | **`stayTermination`** — the same pair                                                                                       | [SD §4.7.3] + [A8 §9 item 1] | Same. §3.4 says what the act **means**; what it lacks is an asserter the model can name                                         |
| 4   | **The SIT day fold** — `Days Used`, `Remaining Days`                                                                        | A5, with item 2              | Its principal input is item 2. The arithmetic is cited at §3.6 so it need not be found again                                    |
| 5   | **Whether a terminated shipment moving on a new BL is the same `shipment`**                                                 | A2                           | [SD §10.4] bullet 1's other half. A5 supplies the constraint that the stay id does not answer it (§3.4)                         |
| 6   | **The warehouse party** — `storageWarehouse`, `assignedStorageAgent`, `StorageFacility`, `SITAgent` as a role over the stay | [A8 §9 items 1-2]            | Four sources name it; the role enum has no member and the party entity is undefined                                             |
| 7   | **The permanent-storage bailment itself** — what an order, a shipment and a stay become after conversion                    | A2, A11, and a later v       | §3.4(c) fixes the boundary and declines the far side                                                                            |
| 8   | **The SIT-expiry notification ladder** as records                                                                           | [A8 §9 item 6]               | `src:dtr-part-iv` A-406 §A.5's eight rungs are eight `notification`s whose recipient field is owed; the ladder is cited at §2.2 |

### What only the user can decide

1. **Whether v1 carries non-temporary storage at all.** §3.4(c) rules that it is a different
   bailment; it does not rule that the platform never touches it. `src:weichert-supplier-api` shows a
   partner for whom LTS is a first-class product with its own order type, and
   `src:dp3-tender-of-service`'s NTS side is a whole second contract. Modelling it is a **scope**
   decision, not a domain one, and the domain answer ("it is not SIT") does not make it.
2. **Whether the storage account is in scope.** `src:smartmoving-api` models a per-customer billing
   object that outlives every stay; `src:atlas-world-group-api` and `src:sirva-ade` model storage
   purely as charges on the move. Both are coherent, and which one the platform needs depends on
   whether it will ever bill storage directly.
3. **Whether the catalog should tell a consumer that a bare `PARTY_NOT_READY` is incomplete in
   practice.** §3.2 leaves the remedy optional on every code, so `catalog/index.json`'s `reasons`
   note — "the rows below say which codes require them" — is accurate and still leaves a consumer
   unaware that `src:dp3-400ng` Item 17.15 compels the **placement** whenever a destination
   delivery fails. That is a documentation choice about the published contract, not a domain
   question, and A5 records it rather than making it.
4. **Whether `IN_TRANSIT` is worth carrying** if the platform never moves DoD freight. It is in the
   enum because two regulation-grade sources need it (§3.2); a purely commercial deployment would
   never populate it, and removing it later is **breaking** ([catalog §2.3]).

---

## 7. Confidence

| Claim                                                   | Confidence                     | On what                                                                                                                                                                                     |
| ------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `opensStay` remedy exists and is the missing branch | **High**                       | `src:shippeo`'s own statement of the gap, `src:dp3-400ng` Item 17.15's mandatory placement, and [SD §2.4] rule 5's framing. Three sources, one of them the one that reported the gap        |
| Its **shape** — two fields                              | **Medium — [SYNTHESIS]**       | No source puts anything on a failed-delivery record pointing at storage; what the sources supply is the entry record's field list, and §3.2's table is an argument about where each belongs |
| `location` as a three-member enum                       | **Medium-to-high**             | Three sources fix it at entry; two publish two members and two publish three. The union is ours                                                                                             |
| The stay is an aggregate and not a property of a stop   | **High, and inherited**        | [SD §1.2], [SD §7.4] and [A3 §5.1] settled it; §3.3 adds the four-part argument and the resolution of the Atlas/ADE contradiction                                                           |
| Termination leaves the stay's identity untouched        | **Medium — [SYNTHESIS]**       | Every input is grade-A regulation; the inference is ours, and it is the only reading that gives §D.5.c(1) NOTE an object                                                                    |
| Permanent storage is a different bailment               | **High**                       | Four sources, three of them grade A, changing obligations, parties, clock and charging basis together — and one commercial van line building it as a separate product by design             |
| The dwell rule                                          | **Low-to-medium — [ORIGINAL]** | No source states it. Its support is the failure of every alternative test, which is weaker evidence than a citation. §5 states the falsification condition                                  |
| The three refusals to mint                              | **High as refusals**           | They follow from [A8 §9 item 1] mechanically. If A8 defines the party entity, all three become cheap and the refusal expires                                                                |
| `remedyRequired` stays `false`                          | **Medium — [ORIGINAL]**        | The three cases that would break under a requirement are each sourced; the decision to weigh them above the incomplete-record argument is ours                                              |

### Assertions made here that no source supports

1. **"A dwell is a stay if and only if a stay was opened for it"** (§3.5) — [ORIGINAL].
2. **"The stay's identity survives termination"** (§3.4) — [SYNTHESIS] from sourced parts.
3. **"`location` has three members"** (§3.2) — [SYNTHESIS]; each member sourced, the union ours.
4. **"An extension is the allowance re-asserted"** (§3.6) — [SYNTHESIS]; MilMove's request/decision
   pair is the evidence, the collapse onto `supersedes` is ours.

---

## 8. Acceptance — the nine scenarios, run explicitly

A5 is decisive in two, contributes a precondition to three, and is silent in four. Silence is
recorded rather than skipped, because an area document that finds something to say about every
scenario is not scoping itself.

### 1. Five families' goods on one van over four days — **A5 is silent**

No storage. A5 contributes nothing and correctly has nothing to contribute.

### 2. Goods into SIT, delivered out six weeks later by a different agent — **A5 is decisive, and this is its scenario**

Every piece is now named. The `storeIn` act is the warehouseman's ([A8 §5] row 7); the `sitEntryDate`
is derived from the first available delivery date and is a different fact ([SD §5.3]); the stay is a
`stay` with its own identity and the SIT control number as an `identity` assertion over it; the
warehouse **visit** is a `stop` and the stay is not (§3.3); the `storeOut` is the warehouseman's with
the collecting carrier competing ([A8 §5] row 8); the different agent's delivery-out is an
`ExternallyPerformedLeg` ([SD §8.2]); and `custodyAt` answers who held the goods across all six weeks
without anyone storing an interval. **What A5 adds** is that six weeks is ordinary — and that if the
stay had been terminated in week five, the `storeOut` would still name the same stay (§3.4), while
whether the goods leaving are the same **shipment** is A2's.

### 3. Delivery attempted twice — absent, then refused for damage, two items short — **A5 contributes the second branch**

The first attempt carries `PARTY_ABSENT` with a required `newWindow`. A5's contribution is that the
**other** branch now exists: had the customer been unreachable rather than merely absent, the same
record would carry `PARTY_NOT_READY` with `{ opensStay }`, and `src:dp3-tender-of-service` §C.3.c's
two documented attempts six hours apart is the precondition for taking it. Both branches are typed;
neither is required (§3.2).

### 4. A reweigh in transit — **A5 is silent, with one note**

`weighing` is an absent fact class ([SD §4.7.3]) and A5 does not change that. The note is that
`src:dp3-400ng` Item 17.13 requires the TSP to "obtain the actual weight of the portion withdrawn"
from SIT — so a partial withdrawal produces a weighing, and the class it needs is the one already
owed.

### 5. A car on a separate carrier, delivered a week apart — **A5 is silent**

No storage. `src:dp3-400ng` Item 17.2's definition expressly excludes mobile homes and boats from
SIT, which is adjacent and not this.

### 6. Cancelled after packing, before loading, with materials charged — **A5 is silent**

A1's scenario. No stay exists because no goods left the residence.

### 7. The same arrival asserted differently by the driver's app and the destination agent — **A5 is silent, with one consequence**

An arrival at a **warehouse dock** is an `arrival` on the `stop`, not on the stay — §3.3's split, and
the reason the two asserters contest the same fact key rather than two. The contest resolves exactly
as it does anywhere else.

### 8. A mid-journey custody handoff — **A5 is decisive, and it is the scenario [SD §4.8.3] deferred**

[A3 §8] rated this "dwell classification deferred to A5". §3.5 answers it: the dwell between the two
`handover`s is a stay **only if a stay was opened**, and with no `storeIn` it is the gap the fold
already handles — `custodyAt` returns the releasing holder up to the selected `RECEIPT` and
`IN_TRANSFER_GAP` between them ([SD §4.8.3] C5). Nothing about the dwell's duration or the facility
changes that. If the cross-dock **was** a storage stay — `src:atlas-world-group-api` puts
`crossdocked_by` on its SIT record precisely for this case — then a `storeIn` and a `storeOut` name
it, and the same two handovers are unaffected.

### 9. A partial load under one bill of lading — **A5 contributes a precondition**

The overflow Portion may go into SIT while the remainder moves. `src:dp3-400ng` Item 17.9 has the
name for it — a **Split Shipment** is "a shipment where only a portion is stored in transit enroute,
or where overflow property is delivered to the storage location on different dates" — and
`src:dtr-part-iv` gives each increment its own SIT control number. The precondition A5 supplies is
that this needs no new mechanism: the Portion is [SD §3]'s, the stay is per-increment, and
[SD §5.3]'s "a shipment may carry one of each concurrently" is the same property one level down.

### Summary

| Scenario                        | A5's part                                      |
| ------------------------------- | ---------------------------------------------- |
| 1 Five families on one van      | silent                                         |
| 2 SIT, delivered out by another | **decisive** — §3.3, §3.4, §3.6                |
| 3 Two delivery attempts         | contributes §3.2's second branch               |
| 4 Reweigh in transit            | silent; one note on Item 17.13                 |
| 5 Car on a separate carrier     | silent                                         |
| 6 Cancelled after packing       | silent                                         |
| 7 One arrival, two asserters    | silent; one consequence of §3.3                |
| 8 Mid-journey custody handoff   | **decisive** — §3.5 closes [SD §4.8.3]'s defer |
| 9 Partial load under one BL     | contributes a precondition                     |

---

## Cross-area consequences to record

### To [SD] — two of §10.4's open items are answered, and one is answered by refusing its framing

- **Bullet 2, "SIT as a stop vs SIT as a service at a stop", is a false alternative.** §3.3. The stay
  is an aggregate and was one before the question was written; both horns assume it is a property of
  something. The usable half of the Atlas observation is **negative** (SIT is not a stop _type_), and
  `src:sirva-ade`'s `STORAGE IN TRANSIT` location type is the contradiction that has to be resolved
  rather than inherited. No amendment to [A3] is needed: [A3 §5.1] already reached this answer and
  A5 ratifies it.
- **Bullet 1's A5 half is closed** (§3.4): a terminated stay keeps its identity, and `storeOut` after
  one names the same `stay` as its `storeIn`. The A2 half — the shipment boundary — is untouched and
  A5 supplies the constraint that the stay id does not answer it.
- **§4.7.3 gains three rows** (§3.6), which is the first time the absent list has grown rather than
  shrunk. [catalog §5] records why that is a healthy direction.

### To [A8] — one ledger observation, and it is not a request for a row

A5's three refusals all reduce to the same missing thing, and it is **[A8 §9 item 1]**, not item 8.
The pattern is worth recording because it will repeat in A6, A7 and A10: **the physical acts in this
area have closed authority rows and the administrative acts cannot have any**, and the discriminator
is whether the asserter is someone who was in the warehouse. `storeIn`, `storeOut` and
`sitEntryDate`'s input all have one. Authorising, extending and terminating a stay are done by a
Government transportation office or an approving supervisor, and there is no party entity for either.
**So item 1 is not a prerequisite for a tidy party model — it is the blocker on three concrete rows
in the corpus's best-covered area**, which is a sharper argument for doing it than the one the ledger
currently carries.

### To [A1] — the hand-off is closed, and A1's stage needed no change

[A1 §Cross-area] asked whether A5 would need the commitment and the liability to part company.
**It does not** (§3.4(b)): the obligation that survives termination is an obligation of the **order**
— delivery out of storage, paid for by the Government — and an outstanding obligation is what
`ACCEPTED` means under [A1 §3.3]. The liability that ends is the carrier's liability for the
**goods**, which the stage does not encode. Nothing in [A1] changes.

### To [A2]

Three things, in the order A2 will need them.

1. **The stay is not the shipment and does not answer the shipment's question** (§3.4). A2 will find
   the stay id unchanged across termination and must not read that as the shipment's identity
   surviving.
2. **`src:dp3-400ng` Item 17.9 names A2's object**: a **Split Shipment** is "a shipment where only a
   portion is stored in transit enroute, or where overflow property is delivered to the storage
   location on different dates". That is a shipment-structure definition sitting in a storage tariff,
   and A2 should not have to find it in A5.
3. **The reshipment path is documentary**: `src:dtr-part-iv` §E.4(4)(c)'s new BL, and §E.1's
   diversion exclusion for shipments already in destination SIT.

### To [A7]

The whole of A5's charge surface, deliberately left: the first-day / additional-days / delivery-out
triple (`src:dp3-400ng` Items 17.5, 210A-F; `src:weichert-supplier-api` odt:561-568;
`src:sirva-ade` `SITCFD`/`SITCAD`; `src:atlas-world-group-api`'s three billing activity kinds); the
re-entry first-day rule (Item 17-1.1.b); the accrual-ceases rule (Item 17.7.a-b); the 25% discount
after termination (Item 17-2); and the 1,000-lb minimum applied to the **combined** weight of
separately-rated portions (Item 17.9.b.2). [SD §4.7.1]'s `charge` row already permits `stay` in
`context[]`, so none of this needs a new mechanism — it needs A7.

### To [A6]

`src:dp3-400ng` Item 17.12 is a **records-required** clause and it is the sharpest A6 material in the
storage corpus: both the TSP and the warehouseman must hold an itemised property list carrying the BL
number, the shipment's origin and destination, **the condition of each article when received at and
forwarded from the storage location**, the dates of all charges and payments, and the dates the
property was delivered to and forwarded from storage. Note what the middle one implies: a
`condition` assertion per article at **both** ends of a stay, which is [SD §5.4]'s item grain and
[A8 §5] row 9's joint holding, applied at a boundary A6 has not yet looked at.

### To [A9]

The SIT control number is already spent ([SD §7.4]) and A9 inherits it. What A9 should also know is
that `src:weichert-supplier-api` carries `ltsRequestNumber` with `hhgRequestNumber` as a
**back-reference** — a correlation between two orders across the permanent-storage boundary §3.4(c)
declines to model. If A9 wants a worked case of a cross-aggregate correlation that the domain model
deliberately does not carry as a link, that is it.

### To [A10] / [A11]

`src:cfr-49-375` §375.609(b) opens a **nine-month claims window** at conversion to permanent storage,
and `src:dp3-400ng` Item 17.12.c requires per-article condition at receipt into and forwarding from
storage. Between them they make a stay a claims boundary, which is A11's. A10 inherits
`src:dp3-400ng` Item 17.13's partial-withdrawal procedure, which is an inventory operation described
by inventory item number.

---

## 9. What this puts in the executable specification, and how each part is held

Every decision above that can be executed is, and every gate below was **tampered with and watched
to fail** before being left green.

| What                               | Where                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The remedy shape and its enum      | `OpensStay` and `STAY_LOCATIONS` in `packages/domain-reference/src/outcomes.ts`                                                                                                                          |
| The union with no owed branch      | `Remedy` in the same file — two members, and `Owed` is no longer imported                                                                                                                                |
| The shape names, held to the union | `REMEDY_SHAPES` + `RemedyShapesCoverTheUnion` — an `Exact` in both directions, **assigned `true`**: a bare `Exact<>` alias evaluates to `never` and reports nothing, so the assignment is the whole gate |
| The loader gate                    | `loadReasonVocabulary` refuses a `remedyShape` the union does not carry — ungated until the union had two members                                                                                        |
| The three absent classes           | `ABSENT_AND_OWED` in `src/vocabulary.ts`, and the matching prose in [SD §4.7.3], gated by `documents.test.ts`                                                                                            |
| §3.4's answer, asserted            | `tests/scenarios/storage-in-transit-delivered-by-another-agent.test.ts` — the `OWED` block is now two assertions                                                                                         |
| §3.2's second branch, asserted     | `tests/scenarios/delivery-attempted-twice-absent-then-refused.test.ts`                                                                                                                                   |
| The version and its class          | `CATALOG_VERSION = '0.5.0'`; `publishedOwedShape`, a new member of `ADDITIVE_CHANGES`, read off the schema diff                                                                                          |
| Registration                       | `A5` in `DOCUMENTS` and `STAY_LOCATIONS` in `VOCABULARIES`, both in `tools/generate-glossary.ts`                                                                                                         |

**What is deliberately not in the code:** no `stayStatusAt` projection, no day fold, no
authorisation, allowance or termination type, and no dwell classifier. §3.5, §3.6 and §6 each say
why, and the glossary's Owed section carries the three absent classes so the gap is queryable rather
than remembered.
