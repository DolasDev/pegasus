---
source: src:smdg-delay-codes
analyzed: 2026-09-17
evidence_grade: A
material: >
  sources/smdg-delay-codes/local/SMDG-Delay-Reason-Codes-20220511.xlsx (published as
  ...xlsx.xlsx at the URL; 37,894 bytes; sha256 2e3bf6b40298dcbabf39a32b197cac552df0bc42ed00a78f006de3b366b7efc9;
  retrieved 2026-09-17) and
  sources/smdg-delay-codes/local/SMDG-Port-Call-Activity-Codes-v20260610.xlsx
  (36,608 bytes; sha256 72529a4281dc0f36bf86b7af54aebf67ff5bf33b811c67c77eec9045d83a3a26;
  retrieved 2026-09-17), both from
  https://smdg.org/documents/smdg-code-lists/delay-reason-and-port-call-activity/ .
  ALL sheets of both workbooks were read in full: `Delay Codes` (49 codes in 4 groups),
  `PC Activity Codes` (13 codes), and the `Change Log` and `Notes` sheets of each.
  Nothing in either workbook was left unread - this is a complete reading of a small
  source, hence grade A.
---

# SMDG Delay Reason & Port Call Activity code lists - analysis

## What it is

Two published code lists maintained by **SMDG** (the Ship Message Design Group, the
user group for shipping-line and container-terminal EDI). Kind **S1 =
`reference-data`** - not a model, not a message, not an API: two spreadsheets of
codes with names and one-line definitions, plus a change log and a notes page.

**S2 adoption = 2.** Within its own niche it is the list: the Notes sheets record
that the codes are used in the EDIFACT `IFTSAI` (vessel schedule) and `TPFREP`
(Terminal Performance Report) messages, and that the Port Call Activity codes are
used "in the DCSA OVS (operational vessel schedule) API for exchange of vessel
schedules" (`Notes` sheet, Port Call Activity workbook). It is the list src:dcsa's
`delayReasonCode` points at (`dcsa_domain` L479-485: "Reason code for the delay. See
SMDG Code list DELAY", examples `WEA`, `STR`). Outside container liner shipping,
adoption is **zero** - no road carrier, no van line, no HHG system uses it.

**S3 openness = `public`.** Direct download, no registration, no paywall, no stated
licence (recorded as `unstated`). The Notes sheets actively solicit adoption ("The
codes should also be used in other electronic message formats such as an API") and
publish a change-request address, `coderequest@smdg.org`.

This source was fetched to answer one specific question carried over from round 1:
the crosscheck records that **no source in the set supplies an HHG-appropriate
reason-code vocabulary**, that X12 element 1651's organising principle is "the only
defensible skeleton" and is licensed and LTL-shaped, and that src:dcsa's
`delayReasonCode` "points at an SMDG list that is not captured"
(`analysis/round-1-crosscheck.md` L27, L226, L246). It is now captured. The question
is not "should we use these codes" - obviously not, they are about tides and tugs -
but **"is the way this list is built worth copying for A4?"**

The answer is yes, for four structural reasons, none of which is the code values.

## Model summary

There is no object model. There is a **shape**, and the shape is the finding:

```
SMDG code lists
├── DELAY  (3-char codes, 49 values, v2022-05-11)
│     "By nature, these delay reason codes describe an unplanned, unwanted delay."
│     ├── 1 - SHIP related    (10 codes, incl. OTV "Others - Vessel Related")
│     ├── 2 - SHORE related   (17 codes, incl. OTS "Others - Shore Related")
│     ├── 3 - CARGO related   (10 codes, incl. OTC "Others - Cargo Related")
│     └── 4 - Other Reasons   (9 codes,  incl. OTF "Others - Force Majeure Related")
│
└── PCACTIVITY  (4-char codes, 13 values, v2026-06-10)
      "the port call activity code describes a planned event which is communicated
       before vessel arrival"
      ADHO BLNK BUNK CUTR DRYD OMIT OOSV PHIN PHOT ROTC SLID AMP
```

The two lists were **one list until May 2022**. The split is documented twice, in
identical words, on both Notes sheets:

> "In a previous version, the Port Call Activity codes were contained as group #5 in
> this list. The Port Call Activity codes are now split into a separate list because
> they are **of different nature** than the delay reason codes, and also **of
> different length of 4 characters**."
> - `Notes` sheet, both workbooks

That sentence is the most valuable thing in this source. A maintained industry code
list discovered, in production, that it had conflated *an unwanted delay* with *a
planned change to the plan*; the correction was not a new attribute or a flag but a
**separate list with a physically different code shape**, so the two can never again
be assigned to the same field or confused by a consumer. The list is now
self-describing: a 3-character code in this domain is always a failure, a
4-character code is always a plan change.

## Vocabulary

Selected codes - the full 49 + 13 are in the stored workbooks (`Delay Codes` and
`PC Activity Codes` sheets); the group structure, not the values, is what is cited
below.

| Term (as the source spells it) | Definition / meaning | Area | Cite |
| --- | --- | --- | --- |
| **DELAY** | The EDIFACT code-list name (DE 1131 = `DELAY`), carried in an `FTX+ACD` segment: worked example on the sheet is `FTX+ACD++WEA:DELAY:306+GALE'` - code, **list name**, list version qualifier, then free text. | A4 | `Delay Codes` sheet, header rows |
| **PCACTIVITY** | The second list's code-list name; example `FTX+ACD++PHIN:PCACTIVITY:306+PhaseIn'`. Same slot, different list identifier. | A4, A3 | `PC Activity Codes` sheet, header rows |
| **Group 1 - SHIP related** | Causes inside the carrier's own asset and crew. `ACC` accident involving personnel (vessel), `ENG` engine repairs, `SPE` "Ship - personnel or equipment not ready or unavailable", `VGR` vessel gear breakdown, `STW` stowage adjustment, `MVX` proforma moves exceeded, `PAU` vessel detained by port authorities, `DEV` deviation to avoid bad weather, `EDD` emergency dry docking, `OTV` others. | A4 | `Delay Codes` sheet |
| **Group 2 - SHORE related** | Causes inside the facility being served. `LAB` labour shortage, `LOT` labour - other, `CRN` crane shortage, `FTE` failure or unavailability of terminal equipment, `HLD` hatch lids, `LAS` lashing delays, `PLT` planning at terminal, `PRD` low productivity, `YRD` yard congestion, `PIT` pilot/tug not available, `ANA` authorities not available, `BUN` bunkering delays, `QUA` quarantine inspection by authorities, `MIL` military exercise, plus `PBC`/`CGS` below, `OTS` others. | A4 | same |
| **Group 3 - CARGO related** | Causes in the goods and their paperwork. `CAE` cargo awaiting exports, `CIN` cargo inspection by authorities, `DIN` "deficient or inadequate information", `WGT` misdeclared cargo weight, `STF` misstuffed container, `LEK` leaking container, `REF` reefer malfunction, `SPH` special cargo handling incl. dangerous goods, `UCC` non-containerised/out-of-gauge cargo "requiring manual intervention", `OTC` others. | A4, A6 | same |
| **Group 4 - Other Reasons** | Causes outside everyone. `WEA` bad weather, `STR` strike, `TID` tidal restrictions, `HOL` bank holidays, `PTF` port traffic restrictions, `RSC` save and rescue, `QUV` "quarantine vessel before berthing due to epidemic", `VIN` vessel inspections by Coast Guard, `OTF` "Others - Force Majeure Related". | A4 | same |
| **`PBC` vs `CGS`** | `PBC` = "Arr **ON** Proforma - Berth congestion"; `CGS` = "Arr **OFF** Proforma - Berth congestion". Identical physical cause, two codes, separated by **whether we were on plan when it hit us**. | A4 | `Delay Codes` sheet, group 2 |
| **`OTV` / `OTS` / `OTC` / `OTF`** | One catch-all **per group**, never a single global "Other". An unclassifiable cause still lands in the right locus. | A4 | all four groups |
| **`ROTC` Rotation change** | "The sequence of port calls is changed compared to the proforma." A resequence, as a *planned* activity code. | A3 | `PC Activity Codes` |
| **`OMIT` Port Omission** / **`ADHO` Adhoc call** | Drop a stop that was in the original schedule / add a stop that was not in it, "for load+discharge operations". Add-stop and drop-stop as named, opposite codes. | A3 | same |
| **`BUNK` Bunker call** | A stop added "**only** for bunkering, **not** for load+discharge operations" - a stop that exists for the vehicle's needs, not the cargo's, and is typed as such. | A3 | same |
| **`SLID` Sliding** | "Vessel falling back in a service schedule, due to heavy delay, resulting in one or more voyages to be cancelled. The vessel is sliding to the next weekly voyage." A delay large enough to stop being a delay and become a **re-plan**. | A3, A4 | same; added 2022-05-24 |
| **`CUTR` Cut and Run** | "The vessel must sail at the scheduled time even if cargo operations are not completed." Departing with the work unfinished, as a first-class named outcome. | A3, A4 | same; added 2025-09-05 |
| **`BLNK` Blank Sailing** | "The whole voyage was cancelled to the effect that **each port call in the voyage is cancelled**." Cancellation of the parent stated in terms of its effect on the children. | A3 | same |
| **`PHIN` / `PHOT`** | Phase-in / phase-out - "the vessel joins / leaves a Service in this port". An asset entering and leaving a recurring plan. | A3 | same |

## Lifecycles & events

None. Neither list contains a state, a transition, or an actor. A code is a value for
one attribute of something else's event. `C3` is `n/a` for this source everywhere,
and it would be wrong to score it 0 - the source does not attempt lifecycles.

What it does contain, and what most code lists omit, is a **statement of the code's
effect on the plan, scoped by the message it appears in** (`Notes` sheet, DELAY
workbook):

> "In a vessel schedule, the code describes the reason why a vessel arrived or will
> arrive later than planned at a terminal. **The result is a new ETA/ETB.**"
>
> "In a Terminal Performance Report, the code describes the reason for non-working
> times at the terminal during vessel operation. **The result is extended working
> time at the terminal.**"

The same code carries two different consequences depending on the context it is
asserted in, and both consequences are written down. That is a documentation
discipline worth copying verbatim: **a reason code's definition should say what it
does to the plan, not only what happened.**

And the scope exclusion, stated positively:

> "By nature, these delay reason codes describe an **unplanned, unwanted** delay."

Most code lists never say what they are *not* for. This one does, and then enforces
it by moving the planned things out of the list entirely.

## Time, identity, evidence

- **Time.** No time model. The only temporal content is the consequential statement
  above (a delay produces a new ETA/ETB; non-working time extends the working
  window). `PBC`/`CGS` encode a *relationship to plan at the moment of the event* -
  on proforma vs off proforma - which is a time-model idea smuggled into a code
  value.
- **Identity.** The EDIFACT examples show the governed pattern: a code is never bare.
  `WEA:DELAY:306` = value, **code-list name**, code-list responsible-agency qualifier.
  Identical in spirit to src:dcsa's `carrierCode` + `carrierCodeListProvider` and to
  UN/CEFACT's qualified code lists. Adopt this: a reason code in our catalog should
  always carry the vocabulary it was drawn from, so a partner's code and ours can
  coexist in one field.
- **Evidence / provenance.** The codes describe the *cause*, never the *source of the
  claim*: there is no asserter, no confidence, no supporting document, no
  free-text partner. (The `FTX+ACD` example pairs the code with free text - `+GALE`
  after `WEA` - so in practice the code is narrowed by prose at the message level,
  not in the list.) Contrast src:atlas-world-group-api's `EXTDate`, which the round-1
  crosscheck identifies as the richest exception record we hold: reason + explanation
  + location at the time + **who bears the delay-claim responsibility and why** + who
  asserted + who approved + who was notified, by whom, when, and whether that
  notification was late (`analysis/round-1-crosscheck.md` L246). SMDG supplies the
  *vocabulary axis* Atlas lacks; Atlas supplies the *record* SMDG lacks. They are
  complementary, not competing.
- **Versioning / governance.** Strong, and visible in the artefact itself: version
  stamped in the filename *and* in cell text; a `Change Log` sheet with one row per
  change (`SLID` new code 2022-05-24, `CUTR` 2025-09-05, `AMP` 2026-06-10), each with
  a date and reason; a published change-request address; and the 2022 split recorded
  as a change-log entry in both files. Four years of maintenance, four codes added,
  one restructuring. A code list can be governed without being a committee standard.

## Scores

Scores are for what this source contributes, not for what a code list could in
principle contain. Weights are set in phase 3.

| Area | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | Cite / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A4 Execution events & tracking | 1 | 3 | n/a | 0 | 1 | n/a | 1 | 3 | C1=1: it covers **one attribute** of A4 - the reason on a delay - and nothing else (no events, no ETA model, no telemetry boundary). C2=3: every one of the 49 codes has a name *and* a distinct definition, several of which disambiguate deliberately (`PBC` vs `CGS` on-proforma vs off-proforma; `SPE` "not ready **or** unavailable"; `UCC` scoped to cargo "requiring manual intervention"; `LOT` "Labour - Other" as a within-group catch-all *beside* `LAB`), and the Notes sheet defines the list's own scope ("unplanned, unwanted"). C3=n/a: no transitions attempted. C4=0: entirely maritime; nothing HHG. C5=1: the only time content is "the result is a new ETA/ETB" / "extended working time" - a consequence, not a model. C7=1: the list's own provenance is excellent (change log, versioned file, code-request address) but a code carries no asserter, no evidence and no responsibility. C8=3: per-code dated change log, published change-request channel, version in filename and content, and a precedent for splitting a list when its members turn out to be of different kinds. |
| A3 Trip, stop & assignment | 1 | 2 | n/a | 0 | n/a | n/a | n/a | 3 | Entirely from the **Port Call Activity** list, and better than expected: `ADHO` add an unplanned stop, `OMIT` drop a planned stop, `ROTC` change the stop sequence, `BLNK` cancel the whole journey "to the effect that each port call in the voyage is cancelled", `SLID` roll the work to the next scheduled trip, `CUTR` depart with work unfinished, `BUNK` a stop for the vehicle's needs rather than the cargo's, `PHIN`/`PHOT` an asset joining/leaving a recurring service. That is a small but coherent **vocabulary of plan changes to a multi-stop journey**, which is exactly the A3 gap. C2=2: each has a one-line definition; none says who may cause it or what it invalidates. C1=1: plan changes only - no stop model, no assignment, no legs. |
| A5, A7 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. `YRD` (yard congestion) and `CAE` (cargo awaiting exports) touch dwell but model nothing about held goods. |
| A1, A2, A6, A8, A9 | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Absent. (`DIN` "deficient or inadequate information" and `WGT` "misdeclared cargo weight" are documentation *failures* named as delay causes, which is an A6 hint and nothing more.) |

S5 is withdrawn (rubric, 2026-09-17) and is not recorded.

## Strengths worth adopting

**Verdict on the question that was asked: the organising principle is worth
borrowing. The codes are not.** Five specific ideas, in descending order of value.

1. **Separate the list of failures from the list of plan changes, and give them
   different code shapes.** SMDG shipped one list, found it held two kinds of thing,
   and split it - 3-char codes for "something went wrong", 4-char codes for "the plan
   changed" - precisely so a consumer can never confuse them. HHG has the identical
   confusion waiting: *the shipper asked to move delivery to Thursday*, *the residence
   was not ready so the goods went to SIT*, and *the crew sat for four hours at the
   elevator* are three different kinds of fact, and every system we have seen (and
   would naturally build) drops all three into one `reason` field. Model them as two
   vocabularies from the start. The HHG plan-change list is close to already written
   by SMDG's second list: add a stop, omit a stop, resequence, cancel the trip,
   roll to the next trip, depart with work unfinished, stop for the vehicle's sake.
2. **One catch-all per group, never a single global "Other".** `OTV`/`OTS`/`OTC`/`OTF`
   keep the group-level analytic valid even when the specific cause is unclassifiable
   - "we don't know exactly, but we know it was the terminal's" is still a usable
   fact, where a lone `OTHER` is not. This also solves, cleanly, the constraint the
   crosscheck records from X12 (a status without a reason is syntactically invalid,
   which forces `NS Normal Status` / `NA Normal Appointment` fillers into the list):
   with a per-group catch-all, "a reason is always required" is always satisfiable
   **without** polluting the vocabulary with non-reasons.
3. **Group by locus of cause - but note that this is only one of the two axes we
   need.** SMDG groups by *whose domain the cause sits in* (the vessel / the facility
   / the goods / nobody's). X12 element 1651 groups by *who is answerable*
   (consignee-related, shipper-related, driver-related, other-carrier-related, cartage
   agent). These are different questions and both get asked in HHG: operations asks
   "where do I go to fix this", billing and claims ask "who pays for the wait". Neither
   source gives both. **Recommend: one code list organised by locus (SMDG's principle,
   because it is the stable, observable one), plus a separate `responsibility`
   attribute on the exception record (Atlas's `EXTDate` carries exactly this, with a
   justification and an approver).** Do not try to encode blame into the code value -
   SMDG does not, and its codes have survived four years unchanged as a result.
4. **`PBC` vs `CGS` - encode "were we on plan when it hit us".** The same congestion
   is two different facts depending on whether the vessel arrived on proforma. The HHG
   analogue is exact and immediately useful: a crew waiting at a residence is a
   different fact if the crew arrived inside the agreed spread than if it arrived
   late. Rather than copying the two-codes-per-cause device, carry
   `onPlanAtOnset: bool` (or the deviation, as Samsara's `arrivalStatus` +
   `deviationMinutes` already does) alongside the reason - but the *distinction* must
   be captured, and this is the source that proves it matters commercially.
5. **Definition discipline.** Every code has a name *and* a definition, the two are
   allowed to differ (`SPE` "Ship - personnel or equipment unavailable" ->
   "...not ready **or** unavailable"), the list states its own scope ("unplanned,
   unwanted"), each usage context states the code's **consequence for the plan** ("the
   result is a new ETA/ETB"), and every change is dated with a reason in a change-log
   sheet shipped inside the artefact. Our published vocabulary should meet this bar:
   name, definition, scope statement, consequence, and a dated change log - and a
   code-request channel, because a reason vocabulary that cannot grow gets bypassed
   with free text.

Also worth taking, small: the qualified-code convention (`WEA:DELAY:306` - value +
list name + list authority) so partner codes and ours can share one field; and
`SLID`'s insight that **a delay can become large enough to stop being a delay and
become a re-plan** - an HHG shipment bumped to the next available load is not "late",
it is rescheduled, and the event catalog should be able to say so.

## Weaknesses / traps

1. **The vocabulary itself is unusable.** Of 49 codes, roughly five have HHG
   analogues (`WEA`, `STR`, `HOL`, `ACC`, `LAB`); the rest are tides, tugs, bunkers,
   stowage, hatch lids, reefers, drydock, proforma moves. Do not translate this list.
   Re-derive the groups from HHG causes and keep only the *structure*.
2. **The group set has no customer.** There is no group for "cargo interests" or
   "consignee" because in liner shipping the consignee cannot hold up a vessel. In
   HHG the shipper/consignee is the single most common cause of delay - not ready,
   not home, no certificate of occupancy, no elevator reservation, no parking permit,
   refused delivery. A borrowed four-group skeleton would silently have nowhere to put
   the most frequent real cause. **Any HHG adaptation must add a party-of-the-move
   group before it is used once.**
3. **Flat, single-level, and untyped.** No severity, no expected duration, no
   billable/non-billable flag, no required-evidence indicator, no allowed-parent
   relationship (which codes may attach to which events). All of that has to come from
   us.
4. **The code attaches to a port call, not to a consignment.** A vessel delay is one
   fact about one vessel at one terminal; every container aboard inherits it
   implicitly. HHG needs a delay that is *about a shipment* - on a consolidated trip,
   one shipment can be delayed (goods not ready) while the trip is not, and the trip
   can be delayed while one shipment is unaffected. Nothing in SMDG models that, and
   copying the attachment point would re-import the same flattening that round 1
   flagged in our own systems.
5. **No asserter, no evidence, no correction.** A code says what happened, never who
   said so, on what basis, or how a wrong reason is retracted. Pair with Atlas's
   `EXTDate` record shape and with Samsara's correction-as-its-own-operation pattern.
6. **`DEV` is misfiled, and it shows the limit of a one-axis list.** "Deviation to
   avoid bad weather" sits in **group 1, SHIP related** while `WEA` "bad weather" sits
   in **group 4, force majeure** - the same underlying cause, split across groups by
   *who acted* rather than by *what caused it*. Even the source cannot hold its own
   principle consistently when cause and response differ. Expect the same pressure in
   HHG (a crew standing down for a storm) and decide the rule explicitly: classify by
   **cause**, and record the response as a separate fact.
7. **Provenance of the artefact.** No stated licence, and the delay list is four years
   old (v2022-05-11) against an actively-maintained companion (v2026-06-10). Treat the
   sha256 and retrieval date in the registry as the citation of record.

## Out-of-v1 material

- **A12 (rating & tariffs), indirectly.** `MVX` "proforma moves exceeded" and `PRD`
  "low productivity" are *performance-against-a-contracted-rate* codes - the cause
  of a cost variance, not of a time variance. HHG has the same class of fact (an
  extra flight of stairs, a long carry, a shuttle required) and it is not a delay
  reason; it is an accessorial trigger. Another argument for more than one
  vocabulary: reasons that change the **plan**, reasons that change the **bill**, and
  reasons that change **who pays**.
- **A11 (claims).** `LEK` leaking container, `STF` misstuffed container, `REF` reefer
  malfunction: condition-of-goods causes named in a *delay* list. HHG's equivalents
  (damage discovered at delivery, missing item at inventory check) belong in a claims
  vocabulary, and the fact that SMDG lets them leak into the delay list is a warning
  about boundaries, not a pattern to copy.

## Open questions

1. **Does anyone publish a road-side or HHG reason-code list with this structure?**
   Round 1 concluded no (`analysis/round-1-crosscheck.md` L27: X12 1651 is "the only
   defensible skeleton"). SMDG confirms the shape is achievable and cheap to maintain
   but does not close the gap. Remaining candidates worth one fetch each before we
   author our own: the AMSA/ATA or NMFTA status-and-reason guidance behind the eBOL
   work, and any published van-line dispatch exception list. - research.
2. **How many groups, and which?** A first cut from the HHG causes visible across the
   partner contracts, following SMDG's locus principle plus the missing customer
   group: *carrier & equipment* - *crew & labour* - *origin/destination site* -
   *shipper/consignee* - *goods & documentation* - *agent/partner* - *external*. Each
   with its own catch-all. Needs the user's operational judgement, not another source.
   - user.
3. **Is `responsibility` a code, a party reference, or both?** Atlas's `EXTDate` treats
   it as a party plus a justification plus an approver; X12 1651 folds it into the
   reason code. The rubric's C7 pushes toward the Atlas shape. - model decision (A4).
4. **Where does the plan-change vocabulary live - A3 or A4?** SMDG's split puts plan
   changes in their own list and the DCSA OVS API consumes them alongside schedules,
   i.e. as *schedule* data, not *event* data. Our equivalent (resequence, add stop,
   omit stop, roll to next trip) sits on the A3/A4 boundary and should be decided
   once, in phase 3, rather than per-event. - model decision.
5. **Do we need the Port Call Activity list's `CUTR` idea - departing with work
   unfinished - as an HHG event?** A crew that must leave a residence before the load
   is complete (building loading-dock hours, permit expiry, HOS) is a real and
   expensive occurrence, and nothing in any source we hold names it. - user.
