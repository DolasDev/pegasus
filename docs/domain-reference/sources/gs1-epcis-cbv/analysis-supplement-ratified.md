---
source: src:gs1-epcis-cbv
supplements: sources/gs1-epcis-cbv/analysis.md
analyzed: 2026-09-17
evidence_grade: A
material: |
  All paths below are relative to docs/domain-reference/.
  Newly captured and read for this supplement (sources/gs1-epcis-cbv/local/ratified/):
  - ratified/epcis-2.0.1-standard.pdf - 229 pp, extracted to text and read in the sections
    listed below. Served from https://ref.gs1.org/standards/epcis/ and from
    https://ref.gs1.org/standards/epcis/2.0.1/ (byte-identical, 4,827,202 bytes).
    Cover page reads "EPCIS Standard / Release 2.0, Ratified, Jun 2022".
  - ratified/cbv-2.0.pdf - 124 pp, extracted to text and read in sections 5, 7.1, 7.5, 7.6.
    Served from https://ref.gs1.org/standards/cbv/. Cover reads "Core Business Vocabulary
    (CBV) Standard / Release 2.0, Ratified, Jun 2022".
  - ratified/artefacts/ - the ten ratified machine-readable artefacts, all fetched from
    https://ref.gs1.org/standards/epcis/<file> (NOT .../artefacts/<file>, which 404s):
    epcis-json-schema.json, query-schema.json, openapi.json, epcis-context.jsonld,
    epcis-ontology.ttl, cbv-ontology.ttl, epcis-shacl.ttl, epcglobal-epcis-2_0.xsd,
    epcglobal-epcis-query-2_0.xsd, epcglobal-epcis-masterdata-2_0.xsd.
  Sections of the EPCIS PDF read in full: 7.3.4 (When), 7.3.5 (Where), 7.3.7 + 7.3.7.1.x
  (How), 7.3.8 (ILMD), 7.4.1 + 7.4.1.1 + 7.4.1.2 + 7.4.1.2.1 + 7.4.1.2.2 (EPCISEvent and
  ErrorDeclaration), 8.2.7 (predefined queries, error-declaration filters), 12.3, 12.6,
  12.8.3 (subscriptions), 14 (Conformance, all subsections). CBV read in full: 5.1, 5.2,
  7.1.2, 7.1.3 (all 41 business steps), 7.5.2, 7.5.3, 7.6.3.
  Diffed programmatically: every enum value-set in the dev-repo JSON Schema against the
  ratified one; both ontologies line-by-line; query-schema property sets.
  Not read - see "What is still unread".
---

# GS1 EPCIS / CBV - ratified-artefact supplement, and diff against round 1

Round 1 (`sources/gs1-epcis-cbv/analysis.md`, evidence grade B) read a clone of
`github.com/gs1/EPCIS` - the 2.0 **development** repo - plus four draft implementation-guideline
markdown files, and explicitly flagged that the ratified prose specifications and the ratified
artefact set had never been captured. This supplement closes that gap. **It does not replace
round 1**; it states what now holds, what does not, and what round 1 could not have known.

## What was actually captured, and where the 404s came from

Round 1's capture log records five GS1 fetches that returned identical 2,922-byte error bodies
and one that returned 13 bytes, all against `https://ref.gs1.org/standards/epcis/artefacts/<file>`.
That path is wrong. The artefacts **index** is at `https://ref.gs1.org/standards/epcis/artefacts`
(no trailing slash); its `href`s are relative and therefore resolve to
`https://ref.gs1.org/standards/epcis/<file>`. Fetching that form returns all ten artefacts with
correct content types. The prose PDFs are content-negotiated off the bare standard URLs:
`https://ref.gs1.org/standards/epcis/` returns `application/pdf`, and
`https://ref.gs1.org/standards/cbv/` likewise - which is why round 1's capture log recorded the
CBV fetch as `cbv-index.html` at 1,322,587 bytes. **That file was the CBV 2.0 PDF all along,
mislabelled as HTML and never opened.**

### Is it 2.0.1?

Yes for the artefacts, ambiguously for the prose.

- The artefacts index page is titled "EPCIS / CBV 2.0.1" and labels its first two rows
  "EPCIS standard 2.0.1 (PDF)" and "CBV standard 2.0.0 (PDF)".
- `epcis-json-schema.json` carries `"$id": "https://ref.gs1.org/standards/epcis/2.0.1/epcis-json-schema.json"`;
  `query-schema.json` carries the matching `.../2.0.1/query-schema.json`; `openapi.json` carries
  `"info": {"version": "2.0.1", ...}`. The artefact bundle is unambiguously the 2.0.1 release.
- The **PDF** served at both `/standards/epcis/` and `/standards/epcis/2.0.1/` is byte-identical
  (4,827,202 bytes) and its cover and every page footer read "Release 2.0, Ratified, Jun 2022".
  The string "2.0.1" does not occur anywhere in its extracted text. So GS1's "2.0.1" is an
  artefact-bundle revision published under the Jun 2022 ratified 2.0 prose; there is no separate
  2.0.1 prose document to read. Round 1's open question 7 ("what does the ratified 2.0.1 artefact
  set differ on?") is answered below.
- Internal inconsistency worth noting: EPCIS section 14.7 still pins conformance to
  `https://ref.gs1.org/standards/epcis/2.0.0/epcis-json-schema.json` and
  `.../2.0.0/epcis-shacl.ttl`, i.e. the prose names 2.0.0 while the live artefacts are 2.0.1.

## Diff: development repo vs ratified 2.0.1 artefacts

**Headline: the vocabularies are unchanged, and almost every round-1 citation still resolves.**

| Artefact | dev bytes | ratified bytes | Substantive difference |
| --- | --- | --- | --- |
| `epcis-ontology.ttl` | 60,477 | 60,469 | **Three lines.** `@prefix gs1:` changes `https://gs1.org/voc/` -> `https://ref.gs1.org/voc/`; `epcis:value`'s `rdfs:range`/`schema:rangeIncludes` change `xsd:decimal` -> `xsd:double` (L689-690); one `rdfs:comment` on `uom` re-points a GitHub URL at `https://ref.gs1.org/tools/...`. **Line numbers are preserved** - every round-1 `Ontology/EPCIS.ttl L<n>` citation resolves to the same text in the ratified file (verified for L61-65, L212-217, L348-353, L451-456, L471-476, L743-748). |
| `cbv-ontology.ttl` | 69,075 | 69,079 | **One line** (the same `gs1:` prefix change). Line numbers preserved; verified for L421-427 (`shipping`), L796-809 (error reasons), L827-840 (owning/possessing party). |
| `epcis-json-schema.json` | 55,180 | 55,680 | Reordered throughout, so **line numbers do NOT transfer** (see re-anchoring table below). Two real changes: (a) `persistentDisposition` added to the permitted-property set of **AssociationEvent** and **TransactionEvent** (12 -> 13 properties each); (b) a named `eventType` definition is added (`anyOf [enum of the five event types, any URI]`). |
| `query-schema.json` | 27,075 | 27,229 | `$id` only. Property and pattern-property sets are **identical** - no query parameter added or removed. |
| `epcis-context.jsonld` | 20,687 | 20,690 | Prefix change only. |
| `EPCglobal-epcis-2_0.xsd` | 42,175 | 42,254 | Cosmetic. |
| `openapi.yaml` | present in dev repo | **absent** from ratified bundle (`openapi.json` only) | Round 1's `REST Bindings/openapi.yaml L<n>` citations have no ratified counterpart; re-cite to the PDF (sections 12.3, 12.6, 12.8.3) or to `openapi.json`. |
| `epcis-shacl.ttl` | **not in the dev clone** | 36,297 | New to us: 170 `sh:NodeShape`/`sh:property` declarations. Encodes the invariants as machine-checkable constraints, e.g. `sh:in ("ADD" "OBSERVE" "DELETE")` with message "Within ObjectEvent, AggregationEvent, TransactionEvent, AssociationEvent, action is mandatory..."; "ilmd should not appear within AggregationEvent, AssociationEvent or TransactionEvent"; and `[ sh:path epcis:ilmd; ... sh:in ("ADD") ]`. |
| `Implementation Guideline/*.md` | four drafts in dev repo | **not published as ratified artefacts** | Round 1 quoted these four files repeatedly. They are drafts of a separate non-normative guideline document and are not part of the ratified release. See "Citations that do not hold". |

Every controlled vocabulary is byte-for-byte the same set:

| Vocabulary | dev | ratified 2.0.1 | delta |
| --- | --- | --- | --- |
| `bizStep` | 41 | 41 | none |
| `disposition` | 33 | 33 | none |
| `error-reason` | 2 | 2 | none |
| `bizTransaction-type` | 13 | 13 | none |
| `source-dest-type` | 3 | 3 | none |
| `action` | 3 | 3 | none |
| CBV terms carrying `sw:term_status` | 112, all `"stable"` | 112, all `"stable"` | none |

## Round-1 citations that do NOT hold

Ordered by how much they matter.

### 1. `disposition` is 33 values, not 32

Round 1 states "`disposition` - Business condition of the objects *after* the event. **32** CBV
values" (Vocabulary table) and "`disposition` - 32 values, L525-569" (Lifecycles & events). The
actual count is **33**, in both the dev clone and the ratified artefact - so this was a miscount,
not a version difference. The full ratified set (`epcis-json-schema.json`,
`/definitions/disposition/anyOf/1`, and CBV 2.0 sec. 7.2.3): `active`, `available`,
`completeness_inferred`, `completeness_verified`, `conformant`, `container_closed`,
`container_open`, `damaged`, `destroyed`, `dispensed`, `disposed`, `encoded`, `expired`,
`in_progress`, `in_transit`, `inactive`, `mismatch_class`, `mismatch_instance`,
`mismatch_quantity`, `needs_replacement`, `no_pedigree_match`, `non_conformant`,
`non_sellable_other`, `partially_dispensed`, `recalled`, `reserved`, `retail_sold`, `returned`,
`sellable_accessible`, `sellable_not_accessible`, `stolen`, `unavailable`, `unknown`.

### 2. Every `EPCIS-JSON-Schema.json L<n>` citation is stale

The ratified file is reordered. Round 1 cites ~25 line ranges in it. Re-anchoring table for the
ones that carry load (line numbers in `local/ratified/artefacts/epcis-json-schema.json`,
2,352 lines total):

| Definition | round-1 line cite (dev) | ratified line |
| --- | --- | --- |
| `vocabularyElement` | L252-291 | 203 |
| `eventType` | (did not exist as a named def) | 539 |
| `persistentDisposition` | L570-611 | 557 |
| `errorDeclaration` | L360-394 | 632 |
| `sensorElement` | L1032-1059 | 754 |
| `ilmd` | L1247-1283 | 954 |
| `Extended-Event` | L154-183 | 1012 |
| `disposition` | L525-569 | 1030 |
| `vocab-other-uri` | L341-345 | 1105 |
| `error-reason` | L346-359 | 1129 |
| `bizTransaction-type` | L634-658 | 1143 |
| `source-dest-type` | L674-688 | 1168 |
| `measurementType` | L775-858 | 1183 |
| `bizStep` | L472-524 | 1614 |

The *content* at each is unchanged; only the anchor moved.

### 3. The telemetry-boundary quotation is draft text, not ratified text

Round 1's strengths #1 and #2 - the best material in that analysis - rest on: *"EPCIS is not
meant to transmit raw sensor data dumps... organisations should model EPCIS events transmitting
sensor data very carefully"* and *"provide applications business-oriented, aggregated sensor
data"*, cited to `Implementation Guideline/Section3.5NEW_TheHOWDimension.md` and `Section5dot9.md`.
**Those files are drafts in the development repo and are not part of the ratified release; that
exact wording does not appear in the ratified standard.**

The *substance* survives, with a better cite. EPCIS 2.0 sec. 7.3.7.1 (p.66), under a heading
explicitly marked "Non-normative: Explanation":

> Even though it would technically be feasible, EPCIS SHOULD NOT be used to accommodate raw
> sensor data unless there is a strong reason to do so. The added value of the sensorElement in
> EPCIS consists in the abstraction from raw sensor data and provisioning of aggregated,
> business-oriented data to accessing applications. For instance, instead of capturing thousands
> of time-stamped datasets, it is often far more appropriate and efficient to only indicate the
> range of values of a given sensor property within a given period of time... Even if there is a
> business need to have the ability to access the underlying raw sensor data, it is neither
> required nor advisable to include raw data in the EPCIS event. Instead, it is advisable to
> include a Web URI in the rawData element, pointing to a resource through which clients can
> access the underlying raw sensor data.

Re-cite round 1's strengths #1/#2 to **EPCIS 2.0 sec. 7.3.7.1, p.66**. Note the standard files
this as non-normative explanation, so it is guidance, not a conformance rule.

### 4. Round 1's error-declaration description is materially incomplete

Round 1: *"A **new** event is published whose `eventTime` **must equal** the original's, and
whose `declarationTime` says when the correction was asserted. Append-only, with the correction
timestamped separately from the occurrence."*

The ratified rule is far stronger (EPCIS 2.0 sec. 7.4.1.2, p.76):

> An event containing an `ErrorDeclaration` element **SHALL be otherwise identical to a prior
> event**, "otherwise identical" meaning that **all fields** of the event other than the
> `ErrorDeclaration` element and the value of `recordTime` are exactly equal to the prior event.
> (Note that includes the `eventID` field: the `eventID` of the error declaration will be equal
> to the `eventID` of the prior event or null if the `eventID` of the prior event is null. **This
> is the sole case where the same non-null `eventID` may appear in two events**.)

It is not "eventTime must match" - it is *every field must match, including the event id*. The
error declaration is a byte-for-byte replay of the erroneous event with one block added. Round 1
understated this by an order of magnitude, and the understatement produces the next error.

### 5. Round 1's "content-hash event ids give free idempotency" is wrong as written

Round 1, strength #11: *"Content-hash event ids (`ni:///sha-256;...?ver=CBV2.0`)... free
idempotency under at-least-once delivery."* Combined with finding 4, this is a trap: **a receiver
that dedupes on `eventID` will silently discard every error declaration**, because the error
declaration carries the *same* `eventID` as the event it retracts. Idempotency keyed on `eventID`
alone is incorrect under EPCIS; the key must be `(eventID, presence/declarationTime of
errorDeclaration)`.

The ratified artefacts contradict each other on this point, which is worth recording: EPCIS 2.0
sec. 7.4.1 says the id is "globally unique across all events **other than error declarations**",
while the ratified `openapi.json` says flatly "An EPCIS event ID must be unique across all events
in the system."

### 6. Round 1 missed the CBV two-tier conformance model entirely, which changes its C8 story

Round 1, strength #10 and Versioning: *"Every vocabulary field is `anyOf [ your-own-URI, CBV-enum ]`...
So `bizStep`, `disposition`, `bizTransaction-type`, `source-dest-type` and `error-reason` are all
open: mint `https://pegasus.example/cbv/bizstep/sit_in` and it validates."*

True at the JSON-Schema level, and true of a **CBV-Compatible Document**. It is **false** of a
**CBV-Compliant Document**. CBV 2.0 sec. 5.1 (p.30) lists the requirements:

> - Each EPCIS event in a CBV-Compliant Document **SHALL include a `bizStep` field**. The value
>   of the `bizStep` field SHALL be a URI consisting of one of the following two prefixes:
>   `urn:epcglobal:cbv:bizstep:` / `https://ref.gs1.org/cbv/BizStep-` followed by the string
>   specified in the first column of some row of the table in section 7.1.3.
> - A CBV-Compliant Document **MAY** include a `disposition` field. If present, the value SHALL
>   be [a CBV disposition URI].
> - ... equivalent SHALL clauses for `persistentDisposition`, `bizTransaction` `type`,
>   `source`/`destination` `type`, and `ErrorDeclaration.reason`.
> - A CBV-Compliant Document **SHALL NOT** use any URI beginning with `urn:epcglobal:cbv:` except
>   as specified in this standard.

CBV 2.0 sec. 5.2 defines the looser **CBV-Compatible Document**, where each of those fields "MAY
be any other URI that meets the general requirements specified in [EPCIS2.0], section 6.4".

Two consequences for round 1:

- **`bizStep` is mandatory at the compliant tier.** Round 1 never says this and treats `bizStep`
  as just another optional context field.
- **"Open vocabulary" is a conformance-tier choice, not a property of the standard.** Round 1's
  open question 6 ("should our vocabulary fields be open, EPCIS style, or closed, DCSA style?")
  is posed as a binary. EPCIS's actual answer is *both, named, with a declared tier* - which is a
  better option than either pole and should be on the table in phase 4.

### 7. Round 1 missed the normative preference for ordinary events over error declarations

EPCIS 2.0 sec. 7.4.1.2 (p.76), immediately after the ErrorDeclaration field table:

> An `ErrorDeclaration` element **SHOULD NOT** be used if there is a way to model the real-world
> situation as an ordinary event (that is, using an event that does not contain an
> `ErrorDeclaration` element).

and sec. 7.4.1.2.1 (p.77): *"The **preferred** way to arrive at the additional events is to
recognise that the discovery of an erroneous event and its remediation is itself a business
process which can be modelled by creating suitable EPCIS events."* The spec's worked examples
make the rule concrete: an over-ship is remediated by a *new shipping event*, not an error
declaration; a short-ship by a *void event*; only cases where ordinary semantics cannot express
the retraction (an `action=DELETE` that must be undone; a wrong PO reference after the counterpart
already recorded a receiving event) justify an error declaration.

Round 1's strength #5 recommends copying the correction protocol "nearly verbatim" and its
strength #9 praises `void_shipping`, but never states the ordering between them. **Operational
compensation first; data retraction only when compensation cannot express it.** That ordering is
the actual design rule, and it is the part most worth copying.

### 8. `eventTimeZoneOffset`: "occurred" vs "captured" - the standard says both

Round 1 leans hard on the offset being "the offset at the **place the event occurred**, not the
publisher's zone". The normative field table (sec. 7.4.1, p.75) says "occurred"; the non-normative
explanation one page later (sec. 7.4.1.1, p.76) says "to identify what time zone offset was in
effect at the time and place the event **was captured**". For an agent keying a milestone from an
office in another state those are different answers. Round 1's reading is the normative one, but
the tension is real and we should decide explicitly which we mean.

### 9. Minor: round 1 missed the sensor `exception` field, so "only two reason codes" overstates

Round 1: *"EPCIS has exactly two reason codes... There is **no free-text reason field at all**
anywhere in the event schema."* The free-text part is correct. But `sensorReport.exception` is a
third, separate exception vocabulary (EPCIS 2.0 sec. 7.3.7.1.2, p.68: "Required if there is no
`type` field in SensorReport"), populated from `gs1:SensorAlertType`, whose CBV 2.0 sec. 7.6.3
values are `ALARM_CONDITION` and `ERROR_CONDITION`. Two values, sensor-scoped - so round 1's
*conclusion* (EPCIS has no operational exception vocabulary) stands, but the claim that only two
reason codes exist anywhere is not accurate.

## Round-1 citations that DO hold (verified against the ratified text)

- **All bizStep definitions quoted in round 1's "Business steps worth quoting verbatim"** -
  `shipping` (incl. "The use of `shipping` is mutually exclusive from the use of
  `staging_outbound`, `departing`, or `loading`"), `loading`, `departing`, `arriving` (incl. the
  example "Truckload of a shipment arrives into a yard. Shipment has not yet been received or
  accepted."), `receiving` (incl. "mutually exclusive from the use of `arriving` and
  `accepting`"), `accepting`, `storing` ("moved into and out of storage within a location"),
  `holding`, `packing`/`unpacking`, `void_shipping`. Verbatim in **CBV 2.0 sec. 7.1.3, pp.36-43**,
  and unchanged in `cbv-ontology.ttl` at the cited line numbers. The ratified prose adds a rich
  "Examples of use (non-exhaustive)" column that round 1 did not have; the `shipping` row spells
  out the typical flow `staging_outbound` -> `loading` -> `departing` and says "If those process
  steps are not captured, the single business step of `shipping` would be used."
- **`did_not_occur` / `incorrect_data` definitions**, including the parenthetical "(In a
  CBV-Compliant Document, this error reason SHALL NOT be used in an error declaration that
  contains one or more corrective event IDs.)" - verbatim in **CBV 2.0 sec. 7.5.3, p.55**.
  Round 1's separation of *retract* from *supersede* is exactly right. One refinement: `reason`
  is **Optional** on `ErrorDeclaration`, so a correction may carry no reason at all.
- **`owning_party` vs `possessing_party`** - verbatim, CBV 2.0 sec. 7.4.3 / `cbv-ontology.ttl`
  L827-840.
- **`eventTime` / `recordTime` two-clock model** - EPCIS 2.0 sec. 7.4.1, pp.74-75, and stronger
  than round 1 knew: `recordTime` "**SHALL** be ignored when an event is presented to the EPCIS
  Capture Interface, and **SHALL** be present when an event is retrieved through the EPCIS Query
  Interfaces", and conformance sections 14.3 and 14.5 make each half a conformance criterion for
  capture servers and query servers respectively.
- **`readPoint` vs `bizLocation`** - EPCIS 2.0 sec. 7.3.5, p.56: read point is "where objects
  were at the time of the EPCIS event", business location is "where objects are following the
  EPCIS event", "until it is reported to be at a different Business Location by a subsequent
  EPCIS event".
- **`ilmd` only on `action=ADD`** - EPCIS 2.0 sec. 7.3.8, p.73 ("ILMD may only be included in
  ObjectEvents with action ADD, and in TransformationEvents"; for a TransformationEvent it applies
  to the outputs, not the inputs - a detail round 1 omitted). Enforced in `epcis-shacl.ttl` as
  well as in the JSON Schema.
- **Error declarations are queryable as a class** - `EXISTS_errorDeclaration`, `EQ_errorReason`,
  `EQ_correctiveEventID`, `GE_errorDeclarationTime` / `LT_errorDeclarationTime`: EPCIS 2.0 sec.
  8.2.7, and the query-schema property set is identical to the dev-repo one.
- **Capture is asynchronous, transactional, and rollback by default** - EPCIS 2.0 sec. 12.6:
  "the server SHALL respond with 202 Accepted and a captureID"; "The default value of
  `GS1-Capture-Error-Behaviour` SHALL be `rollback`"; "If `GS1-Capture-Error-Behaviour` is
  `rollback`, the server SHALL guarantee that either all events are captured, or all events are
  rejected." Capture limits (`GS1-EPCIS-Capture-Limit`, `GS1-EPCIS-Capture-File-Size-Limit`) are
  SHALL-support per sec. 14.8.
- **Webhook subscriptions are mandatory** - EPCIS 2.0 sec. 12.8.3, p.196: "A named EPCIS events
  query **SHALL** support subscription using HTTP callbacks (aka Webhooks) and **MAY** support
  subscription using WebSockets"; repeated as a conformance criterion in sec. 14.8. Round 1 had
  the SHALL right and missed the WebSocket alternative entirely (sec. 12.8.3, "Unlike Webhook
  subscriptions, Websocket query subscription parameters are [in the URL]").
- **`eventID` is optional on capture and the server may mint one** - `openapi.json`: "EPCIS 2.0
  keeps event IDs optional. If event IDs are missing, the server should populate the event ID
  with a unique value"; EPCIS 2.0 sec. 12.6: "Upon capture, a server MAY populate the unique
  `eventID` field within each event."
- **`Extended-Event` and `vocab-other-uri` both exist in the ratified schema** (at the new line
  numbers above), so round 1's extensibility claim is structurally correct - subject to the
  CBV-Compliant caveat in finding 6.
- **Round 1's scores are not invalidated.** The only score-bearing fact that changed is the
  disposition count (32 -> 33), which does not move a criterion. Everything that drove A4 C2=3,
  C7=3 and C8=3 is confirmed in the ratified text; the C8=3 now deserves the two-tier gloss.

## New material round 1 could not have had

1. **`epcis-shacl.ttl` is a ratified artefact and we now hold it.** 170 shape declarations,
   each with a human-readable `sh:message`. It is the only place the invariants are stated as
   machine-checkable constraints with an error string attached - a direct model for how our own
   event catalog should ship its rules (a validator artefact, not prose).
2. **The two-tier conformance model (CBV-Compliant / CBV-Compatible), sec. 5.1-5.2** - see
   finding 6. This is the most transferable idea in the ratified prose that round 1 missed:
   *one* schema, *two* named conformance levels, with the strict level closing the vocabularies
   and the loose level opening them. A tenant can publish Compatible; a partner integration can
   demand Compliant.
3. **The error-declaration design rationale, sec. 7.4.1.2.1** - three stated reasons for
   replaying the whole event: (a) no event id is required to point at the erroneous event, so ids
   need not be minted defensively on every event; (b) *any query that matches an event also
   matches its error declaration*, so consumers need no special logic to notice corrections; (c) a
   consumer holding only the error declaration has every field of the original and need not fetch
   it. That third property is why the "identical content" rule exists, and it is a genuinely good
   argument for a full-replay correction over a delta-patch correction.
4. **Section 7.4.1.2.2, "Matching an error declaration to the original event"** - a caveat round 1
   could not have seen: "The **only** way to recognise that an event is the original event
   matching an error declaration is to confirm that all data elements in the events (save the
   `ErrorDeclaration` element and record time) match." There is no back-pointer. Full-replay
   corrections are cheap for the consumer that only wants the latest truth and expensive for the
   consumer that wants an audit trail.
5. **Conformance is decomposed by role** (sec. 14.1-14.8): XML data, capture client, capture
   server, query client, query server, query-callback implementation, JSON/JSON-LD binding, REST
   server - eight separately claimable conformance targets. If we ever publish an event API with
   a conformance statement, this decomposition is the model.
6. **`persistentDisposition` is now legal on AssociationEvent and TransactionEvent** (2.0.1
   schema change). Round 1's strength #12 (`set`/`unset` as a flag mechanism) got slightly wider
   in 2.0.1.
7. **`assembling` vs `transformation`, stated as a modelling rule** (CBV 2.0 sec. 7.1.3): "In
   contrast to transformation, in the output of `assembling` the original objects are still
   recognisable and/or the process is reversible; hence, `assembling` would be used preferably in
   an Association Event or, alternatively, an Aggregation Event, but not a Transformation Event."
   A reversible-vs-irreversible composition test - relevant if we ever model crating, vaulting or
   containerisation, where the contents must stay individually identifiable.

## What is still unread

- **EPCIS 2.0 sections 9 (XML bindings), 10 (JSON/JSON-LD bindings), 11 (capture bindings), 13
  (query bindings/WSDL)** - skimmed for the specific claims above, not read end to end.
- **The `Conformance Requirements/` matrices in the dev clone** - still not read; they are a
  development artefact and have no ratified counterpart in the artefact bundle.
- **The GS1 Tag Data Standard**, which defines the EPC URI schemes - still not captured. Round 1
  flagged it; it remains the gap under every EPCIS identifier claim.
- **The EPCIS/CBV Implementation Guideline as a published document.** The dev repo holds four
  draft markdown sections; the ratified bundle does not carry the guideline, and `[EPCISGuideline]`
  is referenced normatively (sec. 7.4.1.2.2). Not located.
- **The CBV 2.0 `Diagrams/` and the GS1 Web Vocabulary** (`https://ref.gs1.org/voc/`) - the
  ratified ontologies now point at it for `gs1:CertificationDetails` and the sensor measurement
  types; not fetched.

## Registry corrections to apply

The `capture_caveat` on `src:gs1-epcis-cbv` in `registry.yaml` should be rewritten (the reader is
not editing it, per instructions). Proposed replacement is in the result message accompanying this
analysis, along with new `files:` rows for `local/ratified/`.
