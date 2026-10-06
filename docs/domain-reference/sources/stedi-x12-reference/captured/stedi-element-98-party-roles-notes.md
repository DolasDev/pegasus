# Notes: X12 004010 element 98 — Entity Identifier Code, as rendered by Stedi

Read 2026-10-06. Stedi's pages are a free, **non-normative** rendering of the X12 004010
dictionary; the normative publication is licensed (src:x12-transportation, whose registry
entry says *"Reference code lists, never copy them into the repo."*). These are **notes**
of one element plus short quoted excerpts, per `sources/README.md`'s storage policy — not a
mirror, and the code list is **not** reproduced whole. The raw page is retained at
`../local/element-98.html`, gitignored, with its sha256 in `registry.yaml`.

| URL | What |
| --- | --- |
| https://www.stedi.com/edi/x12-004010/element/98 | Element 98 Entity Identifier Code, full code list rendered inline |

This is the read that three documents named as the blocker on `roleClass` and on checking
`assertedBy.role` against an industry vocabulary:
`analysis/round-1-crosscheck.md` (**`## Unread material`**, its SHOULD list),
`analysis/fork-time-provenance-corrections.md` §7 (the `(b)(1)` row), and this source's own
`analysis.md` (**`## Open questions`** item 1). It is now read.

## How it was read, and why the method is recorded

Two HTML→markdown summarizer reads of the same page agreed with each other and were **wrong
on both numbers that matter**: they reported 829 code values and said the page carries no
per-code definitions. A parse of the retained page bytes gives **1312** code values and
**161** of them carrying a definition sentence. Every figure and every quotation below comes
from that parse, not from a summary. (`docs/domain-reference/` discipline: a summarizer's
negative is weaker than a grep, and two agreeing summaries are not a primary source.)

## What the element is

Heading, quoted: **`98 Entity Identifier Code`**.

Definition, quoted in full — it is one sentence and it is the whole of the element's
semantics on this page:

> Code identifying an organizational entity, a physical location, property or an individual

Attributes: data type `ID`, min length 2, max length 3. The page carries one heading, one
definition and one table; **104 of the 1312 codes are three characters** (`001 Pumper`,
`AAA Sub-account`, `RGA Responsible Government Agency`), the rest two.

## The shape of the list, which is the finding

**It is one flat table of code + description, with no grouping, no category column, no party
class, no role family and no industry tag.** The page has exactly one heading (the element
name) and one table. There is no second axis to read a classification off.

**And it is not a list of roles.** Its own definition names four kinds of referent and the
list delivers all four:

| Kind | Codes quoted |
| --- | --- |
| organizational entity | `CA Carrier` · `MC Motor Carrier` · `WH Warehouse` · `TI Tariff Issuer` |
| physical location | `SF Ship From` · `ST Ship To` · `T3 Terminal Location` · `SL Origin Sublocation` · `CT Country of Origin` · `9C Country of Destination` · `AAC Incorporated Location` |
| property | `BA Battery` — *"That portion of the surface of land, other than a wellsite or roadway, required for access to and to accommodate all equ…"* · `AAE Lot` · `0A Comparable Rentals` |
| individual | `D1 Driver` · `QD Responsible Party` — *"Person responsible for the affairs of the person having services rendered"* |

It is an **identifier qualifier for an `N1` loop** — "what sort of thing is the name and
address that follows" — and the industries it serves are mixed in one sequence: healthcare
(`1H Kidney Dialysis Unit`), mortgage (`0B Interim Funding Organization`), oil and gas
(`006 Drilling Contractor`), education (`E4 Other Person or Entity Associated with Student`)
and freight all share the alphabet. A subset cut for household goods would be **our** cut,
not X12's.

## Searched for and absent

Each of these is a zero result over the parsed page bytes, not over a summary:

| Searched | Result |
| --- | --- |
| `household`, `van line`, `mover`, `relocat`, `moving (company\|services)` | **none** |
| `unknown`, `not applicable`, `no party`, `none`, `nobody` | **none** |
| `weigh ?master` | **none** |
| `settl` (a settling agent) | **none** |
| `stevedore`, `port` (a port handler) | **none** |
| `origin agent`, `destination agent`, `booking agent` as such | **none** |

The nearest things to a "no party" value are `B2 Other Unlisted Type of Organizational
Entity` — *"An organization, e.g., a business, the description of which cannot be
accomplished using the existing code list and for which the trading partners have not
mutually agreed to a definition for it"* — `ZZ Mutually Defined`, and `QD Responsible Party`,
*"person responsible for the affairs of the person having services rendered"*. `B2` is an
organization and `QD` is a person. `ZZ` is the one a reader could mistake for a no-party
value and it is not: it means the slot is filled by **something the partners agreed**, not
that the slot is empty. Nothing in the list means *no party at all*.

## Cross-walk: `ROLE_NAMES` against element 98

`ROLE_NAMES` is the canonical role list (`packages/domain-reference/src/envelope.ts`,
[A8 §2]). This is the check `fork-time` §7's `(b)(1)` row wanted — "the one list that would
let this be checked against an industry vocabulary" — and it is a check, not a source: no
name below is adopted from X12.

| `ROLE_NAMES` member | Element 98 counterpart | Reading |
| --- | --- | --- |
| `booker` | `OE Booking Office` | **False friend, and element 98 confirms round-1's finding.** X12's booking office is the ocean/forwarding office, as `src:project44`'s `BOOKING_AGENT` is; the HHG booker is the agent that takes the order. |
| `originAgent` | **none** | Nearest are a drayman, a terminal, a storage facility and an account: `OR Origin Drayman`, `OT Origin Terminal`, `WO Storage Facility at Origin`, `AP Account of (Origin Party)`. None is the party that surveys, packs and tenders at origin. |
| `destinationAgent` | **none** | Same shape: `DR Destination Drayman`, `DT Destination Terminal`, `WD Storage Facility at Destination`, `AQ Account of (Destination Party)`. |
| `loadAgent` | `LP Loading Party` | Counterpart. |
| `unloadAgent` | `UP Unloading Party` | Counterpart. |
| `hauler` | **none** | `CA Carrier` and `MC Motor Carrier` are the carrier of record, not the hauling agent inside a van line's network; the only "transporter" is `HX Transporter of Hazardous Waste`. |
| `r19Agent` | **none** | Nothing matching `substitut`. The substitute-agent instrument is `src:sirva-ade`'s and has no X12 shape. |
| `rr19Agent` | **none** | As above. |
| `sitAgent` | `WH Warehouse`, `8F Bailment Warehouse`, `NS Non-Temporary Storage Facility`, `DE Depositor`, `SB Storage Area` | Counterparts, **and the set is evidence for an open question** — see below. |
| `driver` | `D1 Driver` | Exact. |
| `packer` | `X2 Party to Perform Packaging` — *"A party responsible for packaging an item after it has been produced"* | Counterpart at manufacturing grain. |
| `portHandler` | `T6 Terminal Operator`, `TR Terminal`, `T3 Terminal Location`, `FB First Break Terminal`, `LB Last Break Terminal` | Terminals, not a port handler. X12 004010's party vocabulary is terminal-centric in the same way its 1650 status list is (this source's `analysis.md`, **`## What this buys and what it costs`**). |
| `settlingAgent` | **none** | |
| `setoffAgent` | **none** | `OF Offset Operator` is an adjacent oil-and-gas property; `A1 Adjuster` / `IP Independent Adjuster` are claims roles. |
| `customer` | `LW Customer`; also `CN`/`CD`/`CE`/`UC`/`IC Consignee`, `OW Owner of Property or Unit` | Counterpart, and the goods-owner sense has one too. |
| `accountParty` | `BT Bill-to-Party`, `PR Payer`, `RM Party that remits payment`, `RI Remit To`, `SO Sold To If Different From Bill To` | Counterparts — X12 splits payer from remitter where A8-NAME-2 has one role. |
| `weighMaster` | **near-miss, and the miss is the point** | `R1 Party to Receive Scale Ticket` — *"Party receiving document containing weight information from scale"* — is the ticket's **recipient**. A8's `weighMaster` is its **signer** (`src:cfr-49-375` §375.519(a)(1)-(6)). Opposite ends of the same document. |
| `platform` | `SJ Service Provider`, `13 Contracted Service Provider`, `AY Clearinghouse`, `QB Purchase Service Provider` | Generic service-provider codes; none is the system of record asserting a derived fact. |

**`SH Shipper` is in the list, bare and undefined**, which is why element 98 cannot resolve
A8 §2's Trap 2: the word is exactly as ambiguous here as `src:cfr-49-375` §375.103 and
`src:dp3-400ng` make it, and X12 adds no definition sentence to it.

## Four things this read settles that are not `roleClass`

1. **`[A8 §9 item 2]`'s NTS question has X12 evidence.** That item asks whether "the NTS
   warehouseman… is the same role as ADE's `SITAgent`". Element 98 keeps them **apart**:
   `WH Warehouse`, `8F Bailment Warehouse` (*"A warehouse property that is owned by an
   organization, but the inventory contained in the warehouse belongs to the supplier until
   the organization owning the warehouse legally purchases the goods"*) and
   `NS Non-Temporary Storage Facility` are three codes, not one. Evidence toward a split;
   not a decision, which is A8's.
2. **`tariffOwner` has an industry counterpart — `TI Tariff Issuer`** (also
   `CO Ocean Tariff Conference`). `[A8 §5]` row 11's rating authority is "the tariff owner
   (the van line / the party whose tariff prices it)", and `ROLE_NAMES` has no such member.
   X12 names the function. What still blocks the member is A8 §2's addition test — a role is
   added there because it **asserts facts** and ADE has no slot for it — and that is A8's to
   apply, so the row stays owed.
3. **`[fork-time §5.3]`'s prediction about `customer` is refuted in the letter and upheld in the
   substance.** That section mints `customer` as a role and adds: *"It is also the member of the
   role vocabulary that element 98 is least likely to supply, since X12's party codes are
   trading-partner codes."* Element 98 **does** carry `LW Customer`, so the prediction is wrong as
   stated. Its reasoning is right, though, and the cross-walk shows why: X12's customer is the
   trading-partner customer in an `N1` loop, the `BY Buying Party (Purchaser)` end of a commercial
   relationship, whereas `[fork-time §5.3]`'s customer is the householder who signs the inventory
   and refuses an item. The code exists; the asserter does not.
4. **The A8 score on this source was provisional on this read and no longer is.** `analysis.md`'s
   score table carries **C2=1 and C4=0** for A8 with the note *"the role vocabulary itself is
   element 98's code list, which we did not read"*. The list is read; the scores are annotated
   rather than rescored, because rescoring would regenerate the registry's `areas` field for a
   reason this capture does not establish.

## What it does not supply, which is the `roleClass` answer

`roleClass` is *"the class of party a reason is attributed to"*. Element 98 is at the wrong
grain for it in two independent ways, and both are visible above rather than inferred:

- **No class axis.** One flat table; nothing to cut classes from. A class list derived by
  hand from 1312 flat codes spanning freight, healthcare, mortgage, oil-and-gas and education would be
ours.
- **No non-party member.** Nothing in 1312 codes means *no party at all*; the searched-and-absent
  table above is the check, and `B2` / `ZZ` / `QD` are the nearest misses. **No document in the
  corpus predicted this** — the sentence that looks like a prediction is `[fork-time §5.3]`'s and
  it is about `customer` (item 3 above), so the absence is a finding of this read rather than a
  confirmation of anyone's forecast.

The decision that follows is `[A8 §9 item 2]`'s and is recorded in
`packages/domain-reference/data/owed-vocabularies.json`.
