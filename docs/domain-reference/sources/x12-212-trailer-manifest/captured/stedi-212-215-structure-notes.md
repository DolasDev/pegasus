# Notes: X12 004010 — 212 and 215 structure, as rendered by Stedi

Read 2026-09-17 via HTML→markdown fetch. Stedi's pages are a free, **non-normative**
rendering of the X12 004010 dictionary; the normative publication is licensed
(src:x12-transportation). These are *notes* of the structure and short quoted
definitions, per `sources/README.md` storage policy — not a mirror, and no licensed
code list is reproduced whole.

URLs read:

| URL | What |
| --- | --- |
| https://www.stedi.com/edi/x12-004010/212 | TS 212 loop/segment table (read twice, second read verifying loop repeats) |
| https://www.stedi.com/edi/x12-004010/215 | TS 215 loop/segment table |
| https://www.stedi.com/edi/x12-004010/segment/ATA | Beginning segment, 212 |
| https://www.stedi.com/edi/x12-004010/segment/TSD | Trailer Shipment Details |
| https://www.stedi.com/edi/x12-004010/segment/MS1 | Equipment/Shipment/Real Property Location |
| https://www.stedi.com/edi/x12-004010/segment/MS2 | Equipment or Container Owner and Type |
| https://www.stedi.com/edi/x12-004010/segment/AT9 | Trailer or Container Dimension and Weight |
| https://www.stedi.com/edi/x12-004010/segment/AT8 | Shipment Weight, Packaging and Quantity Data |
| https://www.stedi.com/edi/x12-004010/segment/BLR | Transportation Carrier Identification |
| https://www.stedi.com/edi/x12-004010/segment/MAN | Marks and Numbers |
| https://www.stedi.com/edi/x12-004010/segment/SPO | Shipment Purchase Order Detail |
| https://www.stedi.com/edi/x12-004010/segment/SDQ | Destination Quantity |
| https://www.stedi.com/edi/x12-004010/segment/SMD | Consolidated Shipment Manifest Data (215) |
| https://www.stedi.com/edi/x12-004010/element/88 | Marks and Numbers Qualifier, 20 codes |
| https://www.stedi.com/edi/x12-004010/element/187 | Weight Qualifier, partial (filtered read) |

---

## TS 212 — Motor Carrier Delivery Trailer Manifest

Purpose, quoted: *"This Draft Standard for Trial Use contains the format and
establishes the data contents of the Motor Carrier Delivery Trailer Manifest
Transaction Set (212) for use within the context of an Electronic Data Interchange
(EDI) environment."*

### Heading

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 010 | ST | Transaction Set Header | M | 1 |
| 020 | ATA | Beginning Segment for Motor Carrier Delivery Trailer Manifest | M | 1 |
| 030 | B2A | Set Purpose | M | 1 |
| 040 | L11 | Business Instructions and Reference Number | O | 300 |

**Loop 0100 — optional, repeat 1**

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 050 | N1 | Name | M | 1 |
| 060 | N2 | Additional Name Information | O | 1 |
| 070 | N3 | Address Information | O | 2 |
| 080 | N4 | Geographic Location | O | 1 |
| 090 | G61 | Contact | O | 1 |
| 100 | G62 | Date/Time | O | 1 |
| 110 | L11 | Business Instructions and Reference Number | O | 10 |

**Loop 0150 — mandatory, repeat 1**

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 120 | AT7 | Shipment Status Details | M | 1 |
| 130 | G62 | Date/Time | O | 5 |
| 140 | MS1 | Equipment, Shipment, or Real Property Location | O | 1 |

**Loop 0160 — optional, repeat 1** (nested in 0150)

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 150 | MS2 | Equipment or Container Owner and Type | M | 1 |
| 160 | M7 | Seal Numbers | O | 1 |
| 170 | AT9 | Trailer or Container Dimension and Weight | O | 1 |

### Detail

**Loop 0200 — optional, repeat 9999**

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 010 | LX | Assigned Number | M | 1 |
| 020 | L11 | Business Instructions and Reference Number | O | 10 |
| 030 | BLR | Transportation Carrier Identification | O | 1 |
| 040 | MAN | Marks and Numbers | O | 9999 |
| 050 | AT8 | Shipment Weight, Packaging and Quantity Data | O | 1 |
| 060 | G62 | Date/Time | O | 5 |
| 070 | TSD | Trailer Shipment Details | O | 1 |

**Loop 0210 — optional, repeat 999999** (nested in 0200)

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 080 | SPO | Shipment Purchase Order Detail | M | 1 |
| 090 | SDQ | Destination Quantity | O | 9999 |

**Loop 0220 — optional, repeat 1** (nested in 0200)

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 100 | N1 | Name | M | 1 |
| 110 | N2 | Additional Name Information | O | 1 |
| 120 | N3 | Address Information | O | 2 |
| 130 | N4 | Geographic Location | O | 1 |
| 140 | L11 | Business Instructions and Reference Number | O | 5 |

### Summary

| Pos | Seg | Name | Usage | Max use |
| --- | --- | --- | --- | --- |
| 150 | SE | Transaction Set Trailer | M | 1 |

### Verified negatives (second read of /212, asked explicitly)

- **No `S5` (Stop Off Details) segment, and no `S5A`/`S5B`, anywhere in the 212.**
- **No `N7` (Equipment Details) segment.**
- `AT7` appears exactly once, in loop 0150, mandatory, max use 1.
- Complete segment-id list, in order: `ST, ATA, B2A, L11, N1, N2, N3, N4, G61, G62,
  AT7, MS1, MS2, M7, AT9, LX, BLR, MAN, AT8, TSD, SPO, SDQ, SE`.

---

## Segment element tables (212)

### ATA — Beginning Segment for Motor Carrier Delivery Trailer Manifest
Purpose, quoted: *"To transmit identifying numbers and other basic data relating to
the Motor Carrier Delivery Trailer Manifest Transaction Set"*

| Pos | El | Name | Type | Usage | Min/Max | Note (quoted) |
| --- | --- | --- | --- | --- | --- | --- |
| ATA-01 | 140 | Standard Carrier Alpha Code | ID | M | 2/4 | SCAC of the delivering carrier |
| ATA-02 | 127 | Reference Identification | AN | M | 1/30 | "Delivery trailer manifest number assigned by carrier" |
| ATA-03 | 373 | Date | DT | O | 8/8 | date manifest created, CCYYMMDD |

### TSD — Trailer Shipment Details
Purpose, quoted: *"To specify details of shipments on a trailer"*

| Pos | El | Name | Type | Usage | Min/Max | Note (quoted) |
| --- | --- | --- | --- | --- | --- | --- |
| TSD-01 | 350 | Assigned Identification | AN | O | 1/20 | "Indicates the loading sequence and relative shipment position on the trailer" |
| TSD-02 | 219 | Position | AN | O | 1/3 | "Relative position of shipment in car, trailer, or container" — mutually defined |

Also appears in 856 (Ship Notice/Manifest).

### MS1 — Equipment, Shipment, or Real Property Location
Purpose, quoted: *"To specify the location of a piece of equipment, a shipment, or
real property in terms of city and state or longitude and latitude"*

| Pos | El | Name | Type | Usage | Min/Max |
| --- | --- | --- | --- | --- | --- |
| MS1-01 | 19 | City Name | AN | C | 2/30 |
| MS1-02 | 156 | State or Province Code | ID | C | 2/2 |
| MS1-03 | 26 | Country Code | ID | C | 2/3 |
| MS1-04 | 1654 | Longitude Code | ID | C | 7/7 (DDDMMSS) |
| MS1-05 | 1655 | Latitude Code | ID | C | 7/7 (DDDMMSS) |
| MS1-06 | 1280 | Direction Identifier Code | ID | O | 1/1 (E or W, requires MS1-04) |
| MS1-07 | 1280 | Direction Identifier Code | ID | O | 1/1 (N or S, requires MS1-05) |

Syntax: `E0104` — only one of MS1-01 or MS1-04 may be present (city **xor** coordinates);
`L010203` — if MS1-01 present, at least one of MS1-02/MS1-03 required.

### MS2 — Equipment or Container Owner and Type
Purpose, quoted: *"To specify the owner, the identification number assigned by that
owner, and the type of equipment"*

| Pos | El | Name | Type | Usage | Min/Max | Note |
| --- | --- | --- | --- | --- | --- | --- |
| MS2-01 | 140 | Standard Carrier Alpha Code | ID | C | 2/4 | P0102 with MS2-02 |
| MS2-02 | 207 | Equipment Number | AN | C | 1/10 | |
| MS2-03 | 40 | Equipment Description Code | ID | O | 2/2 | 134 codes (not read) |
| MS2-04 | 761 | Equipment Number Check Digit | N0 | O | 1/1 | C0402 requires MS2-02 |

Appears in 106, 107, 211, 212, 214.

### AT9 — Trailer or Container Dimension and Weight
Purpose, quoted: *"To specify trailer or container dimensions"*

| Pos | El | Name | Type | Usage | Min/Max | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AT9-01 | 567 | Equipment Length | N0 | O | 4/5 | FFFII, feet + inches (00–11) |
| AT9-02 | 65 | Height | R | O | 1/8 | inches |
| AT9-03 | 189 | Width | R | O | 1/8 | inches |
| AT9-04 | 187 | Weight Qualifier | ID | C | 1/2 | P040506 |
| AT9-05 | 188 | Weight Unit Code | ID | C | 1/1 | |
| AT9-06 | 81 | Weight | R | C | 1/10 | "Tare weight of trailer or container" |
| AT9-07 | 184 | Volume Unit Qualifier | ID | C | 1/1 | P0708 |
| AT9-08 | 183 | Volume | R | C | 1/8 | volumetric capacity |

### AT8 — Shipment Weight, Packaging and Quantity Data
Purpose, quoted: *"To specify shipment details in terms of weight, and quantity of
handling units"*

| Pos | El | Name | Type | Usage | Min/Max | Note |
| --- | --- | --- | --- | --- | --- | --- |
| AT8-01 | 187 | Weight Qualifier | ID | C | 1/2 | 51 codes; P010203 binds 01/02/03 |
| AT8-02 | 188 | Weight Unit Code | ID | C | 1/1 | |
| AT8-03 | 81 | Weight | R | C | 1/10 | |
| AT8-04 | 80 | Lading Quantity | N0 | O | 1/7 | non-unitized handling units (cartons) |
| AT8-05 | 80 | Lading Quantity | N0 | O | 1/7 | unitized handling units (pallets/slip sheets) |
| AT8-06 | 184 | Volume Unit Qualifier | ID | C | 1/1 | P0607 |
| AT8-07 | 183 | Volume | R | C | 1/8 | |

Appears in 204, 212, 214.

### BLR — Transportation Carrier Identification
Purpose, quoted: *"To transmit the identifying SCAC code and effective date for the
data in the transaction set"*

| Pos | El | Name | Type | Usage | Min/Max |
| --- | --- | --- | --- | --- | --- |
| BLR-01 | 140 | Standard Carrier Alpha Code | ID | M | 2/4 |
| BLR-02 | 373 | Date | DT | O | 8/8 (effective date) |

Appears in 106, 108, **212**, **215**, 217, 432, 455.

### MAN — Marks and Numbers
Purpose, quoted: *"To indicate identifying marks and numbers for shipping containers"*

| Pos | El | Name | Type | Usage | Min/Max | Note |
| --- | --- | --- | --- | --- | --- | --- |
| MAN-01 | 88 | Marks and Numbers Qualifier | ID | M | 1/2 | |
| MAN-02 | 87 | Marks and Numbers | AN | M | 1/48 | start of range when used with MAN-03 |
| MAN-03 | 87 | Marks and Numbers | AN | O | 1/48 | end of range |
| MAN-04 | 88 | Marks and Numbers Qualifier | ID | C | 1/2 | P0405 |
| MAN-05 | 87 | Marks and Numbers | AN | C | 1/48 | second range start |
| MAN-06 | 87 | Marks and Numbers | AN | O | 1/48 | second range end |

Note (quoted, paraphrased from page): MAN01/MAN02 and MAN04/MAN05 may identify two
different marks for the **same** container.

### SPO — Shipment Purchase Order Detail
Purpose, quoted: *"To specify the purchase order details for a shipment"*

| Pos | El | Name | Type | Usage | Min/Max | Note |
| --- | --- | --- | --- | --- | --- | --- |
| SPO-01 | 324 | Purchase Order Number | AN | M | 1/22 | |
| SPO-02 | 127 | Reference Identification | AN | O | 1/30 | department number |
| SPO-03 | 355 | Unit or Basis for Measurement Code | ID | C | 2/2 | 794 codes (not read) |
| SPO-04 | 380 | Quantity | R | C | 1/15 | total for the PO |
| SPO-05 | 188 | Weight Unit Code | ID | C | 1/1 | |
| SPO-06 | 81 | Weight | R | C | 1/10 | total for the PO |
| SPO-07 | 647 | Application Error Condition Code | ID | O | 1/3 | 162 codes (not read) |
| SPO-08 | 127 | Reference Identification | AN | O | 1/30 | sort/segregate ref for receiving locations |

### SDQ — Destination Quantity
Purpose, quoted: *"To specify destination and quantity detail"*
`SDQ-01` unit of measure (element 355), `SDQ-02` id-code qualifier (66), then up to
**ten** `Identification Code` (67) + `Quantity` (380) pairs — `SDQ-03/04` through
`SDQ-21/22` — and `SDQ-23` Location Identifier (310), quoted: *"identifies area within
location (e.g., front room, back room, end aisle display)"*. `SDQ-03` is glossed
**"Store number"**.

### Element 88 — Marks and Numbers Qualifier (20 codes, full list, small enough to quote)
Definition, quoted: *"Code specifying the application or source of Marks and Numbers (87)"*
`AA` SSCC-18 · `AI` UCC/EAN-128 Application Identifier and Data · `CA` Shipper-Assigned
Case Number · `CP` Carrier-Assigned Package ID Number · `DZ` Receiver Assigned Drop
Zone · `GM` SSCC-18 and Application Identifier · `L` Line Item Only · `MC` Master
Carton Number · `PB` Premarked by Buyer · `R` Originator Assigned · `S` **Entire
Shipment** · `SI` Self-Identifying Container via Radio Frequency ID Device · `SM`
Shipper Assigned · `SR` Shipper Assigned Roll Number · `SS` Shipper Assigned Skid
Number · `UC` U.P.C. Shipping Container Code · `UP` U.P.C. Consumer Package Code
(1-5-5-1) · `W` Pallet Number · `X` Pallet Configuration Number · `ZZ` Mutually Defined

### Element 187 — Weight Qualifier (filtered read; 51–57 codes total, full list not read)
Definition, quoted: *"Code defining the type of weight"*. ID 1/2. Members retrieved by
a filtered query (terms: tare/gross/net/actual/estimated/reweigh/billed/legal/
maximum/minimum/dunnage):
`G` Gross Weight · `N` Actual Net Weight · `T` Tare Weight · `B` Billed Weight ·
`E` Estimated Net Weight · **`RG` Reweigh Gross Weight · `RN` Reweigh Net Weight ·
`RT` Reweigh Tare Weight** · `L` Legal Weight · `X` Maximum Weight (for Rate) ·
`M` Minimum Weight (for rate) · `CD` Chargeable Dunnage · `ND` Nonchargeable Dunnage ·
`C` Actual Net Repeated for Combination · `F` Deficit Weight · `A3` Shippers Weight ·
`LC` Maximum Lading Capacity. Remaining ~40 codes not read.

---

## TS 215 — Motor Carrier Pick-up Manifest (read for contrast)

Purpose, quoted: *"This Draft Standard for Trial Use contains the format and
establishes the data contents of the Motor Carrier Pick-up Manifest Transaction Set
(215)…"* Page gloss: enables shippers and other parties to furnish motor carriers with
**manifests of all shipments tendered**; explicitly *not* for load tenders, bills of
lading, pick-up notifications, or appointment scheduling.

### Heading
`ST` (M,1) · `B2A` Set Purpose (M,1) · `BLR` (O,1) · `C3` Currency (O,1) ·
`L11` (M,10) · `G62` (O,6)

**Loop 0100 — repeat 1:** `N1` (M,1) · `N2` · `N3` (2) · `N4` (2) · `L11` (M,10) ·
`PER` Administrative Communications Contact (O,10) · `X1` Export License (O,10) ·
`X2` Import License (O,10)

### Detail
**Loop 0200 — repeat 999999** (one iteration per shipment):
`SMD` Consolidated Shipment Manifest Data (M,1) · `L11` (O,20) · `L5` Description,
Marks and Numbers (O,10) · `MS6` Shipment Quantity and Weight (O,1) · `MS5` Shipment
Rates and Charges (O,5) · `MS4` Shipment or Package Dimensions (O,1) · `ACS` Ancillary
Charges (O,10) · `NTE` (O,10)

**Loop 0220 — repeat 10** (parties per shipment): `N1` (M,1) · `N2` · `N3` (2) ·
`N4` (1) · `L11` (10) · `G61` Contact (10) · `X1` (10) · `X2` (10) · `R4` Port or
Terminal (10)

**Loop 0240 — repeat 999999** (cartons): `CD3` Carton (Package) Detail (M,1) ·
`MAN` (O,100) · `MS4` (O,1) · `L11` (O,10) · `L5` (O,10) · `ACS` (O,10) · `NTE` (O,10)

**Loop 0260 — repeat 999999:** `AT6` International Manifest Information (M,1) ·
`MS5` · `IT1` Baseline Item Data (Invoice) · `CGS` Charge (10) · `L11` · `PID`
Product/Item Description (1000) · `TXI` Tax Information (10) · `MS4` · `L5`

**Loop 0280 — repeat 999999:** `SLN` Subline Item Detail (M,1) · `L11` (10) ·
`PID` (10) · `TC2` Commodity (10) · `TXI` (10) · `NTE` (10)

### Summary
`SE` (M,1)

### SMD — Consolidated Shipment Manifest Data
Purpose, quoted: *"To transmit shipment manifest data"*

| Pos | El | Name | Type | Usage | Min/Max | Note (quoted) |
| --- | --- | --- | --- | --- | --- | --- |
| SMD-01 | 284 | Service Level Code | ID | M | 2/2 | *"Code indicating the level of transportation service or the billing service offered by the transportation carrier"* — 66 codes (not read) |
| SMD-02 | 146 | Shipment Method of Payment | ID | M | 2/2 | *"Code identifying payment terms for transportation charges"* — 28 codes (not read) |
| SMD-03 | 108 | Pick-up or Delivery Code | ID | O | 1/2 | *"Specifies the location or type of pickup or delivery"* — 32 codes (not read) |

---

## Read caveats

- Pages were retrieved through an HTML→markdown fetch that summarises with a small
  model. **Structure and quoted definitions were re-verified by a second, narrowly
  scoped read** of /212 (loop repeats, segment inventory, explicit S5/N7 negatives).
- The fetcher's *count* claims are unreliable: on element 1651 it reported "106
  codes" and "96 codes" on two passes while the enumerated list is 86 (matching the
  round-1 read in `sources/stedi-x12-reference/analysis.md`). Enumerations were
  trustworthy; totals were not. Treat any bare count below as approximate.
- Code lists behind "Codes (N)" links were not opened except elements 88, 187
  (filtered) and 98 / 1651 (see the supplement in `sources/stedi-x12-reference/`).
