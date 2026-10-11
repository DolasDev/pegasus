# Domain reference — person vs organisation vs crew-member grain (`[A8 §9 item 3]`): the round record

**Landed 2026-10-09 at catalog `0.6.4` — the version did not move, and that is the finding.**
`[A8 §9 item 3]` is **DECIDED**: the individual who signs is **not** a distinct asserter. A party's
grain — person, company, office, branch — is a property of **what identifies it** and of **the role
it asserts under**, never of the party. `[A8 §9 item 1]`'s **branch grain** closes with it, and
`legal name`'s third blocker falls. One residue is left that the item did not predict.

This replaces `plans/in-progress/domain-reference-a8-item3.md`. Its planning pass is preserved in
§2 below, because **two of its five framings were wrong and one of this round's own first drafts
was wrong in the corpus's recurring way**, and the refutations are the transferable part.

---

## 1. What shipped

### The deliverable, in one line

**Nothing on the wire, and two gates that make it stay nothing.** `AsserterGrainIsNotOnTheEnvelope`
and `AsserterIsExactlyAPartyAndARole` in `src/rules/authority.ts`, plus
`tests/conformance/party-grain-refuses.ts` for the edge no type over `AssertedBy` can see.

### The emitted diff, read before classifying (`[A8 §9 item 1]` §3 item 8)

**Empty. Byte-identical `captured.schema.json`, `queried.schema.json` and `index.json`.** Measured
by regenerating, not reasoned about — and this is a different result from the previous four rounds
rather than a continuation of them. §3 item 8's practice is "run the generator"; what it has done
for four rounds is **locate** something the decision did not predict, and this time it **confirmed**
one: the decision really does reach the wire as an absence, so **no change class and no version
bump**. What located the unpredicted thing this round was §1.3's _other_ wire question — item 5 —
and that is A8-SELF below.

### The decision, and the two reasons it is a refusal rather than a deferral

`AsserterGrainIsNotOnTheEnvelope` carries both in full. In brief:

1. **No source publishes the axis.** `src:stedi-x12-reference` **element 98** — the one industry
   list that enumerates party slots, and one this corpus had **already read, for item 2** — defines
   itself as _"Code identifying an organizational entity, a physical location, property or an
   individual"_ and publishes **one flat table with no class column** (`D1 Driver` beside
   `CA Carrier` beside `BA Battery` beside `SF Ship From`). The four-way sort in its capture file is
   **ours**, and `[SD §0]` forbids publishing it. `src:cfr-49-375` § 375.103 — the corpus's only
   source that _defines_ party classes, and the only primary captured one — classifies by
   **function**: `Individual shipper` _"owns the goods"_ and _"pays **his or her own**"_ charges,
   `Commercial shipper` _"is **not** the owner"_, and all three definienda read _"any **person**"_,
   a word the same section uses for companies.
2. **The model already carries the grain twice, on the two surfaces the corpus puts it on.** What an
   `identity` scheme identifies, and `assertedBy.role` — whose glosses run from `booker`, "the party
   that books the move", to `driver`, "**the person** driving", which element 98 cross-walks
   **exactly** to its one individual-kind code. A field would be a **third** place to say it.

**`[ORIGINAL]`, as one step past `[A8 §3(a)]`.** §3(a) makes role "an attribute of the _assignment_,
never of the party"; the step is that the **grain** is likewise a property of the identifier and the
role. No source states it.

**And it is NOT a claim that every party is an organisation** — the thing a reader will get
backwards. The corpus's clearest asserting individual is the **customer**, whose signature
`src:cfr-49-375` makes constitutive. A natural person is a party here; what is refused is a field
saying so.

> **CORRECTED by the item-2 round, 2026-10-09.** This sentence read "constitutive **four times**
> (§375.505(a), §375.503, §375.701, §375.515(b))", repeating `[A8 §2]`'s addition table without
> reading the sections. **Two of the four require no signature** — §375.505(a) makes the carrier
> issue the bill of lading and names this party as item (3); §375.701 forbids release-of-liability
> language on a delivery receipt. The real mutual signatures are **§375.503(c)** and
> **§375.401(h)**. The round's point is unaffected; the count was borrowed and wrong, and the role
> is now spelled `goodsOwner`.

### Two gates, because the obvious single one PASSED ITS TAMPER

The first draft was the shape comparison alone — `Exact<AssertedBy, { party; role }>`. Adding
`partyClass?: 'person' | 'organisation'` to `AssertedBy` left it evaluating to **`true`**: an
**optional** member keeps assignability in both directions. `keyof` sees optional keys; the shape
does not. So the key-set comparison is the gate and the shape comparison is kept beside it, for what
it alone catches — `party` being widened off its `PartyId` brand, which was tampered too and does
fire.

`tests/conformance/party-grain-refuses.ts` holds the **second candidate shape**, a `person`
aggregate kind, which no type over `AssertedBy` can see. Tampered: `TS2578` at compile time **and**
the suite, where the `canonical-subjects.json` loader names the set difference.

### Everything else the round touched

| What                                                                                    | Why                                                                                                                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity-schemes.test.ts` — a new item-3 block                                         | the branch-grain closure, gated by reading the **witnesses** rather than restating them                                                                     |
| `data/identity-schemes.json` — `agentCode` and `gbloc` notes                            | both said the branch grain was "not acted on here"; it is acted on now, and `gbloc`'s caveat is written down                                                |
| `src/ids.ts` — the `party` member docstring                                             | it said the name **and** the branch grain stay owed to item 3                                                                                               |
| `src/envelope.ts` — `AssertedBy`'s docstring                                            | two members is a decision now, not just a shape, and this type is on **every** envelope                                                                     |
| `src/custody.ts` — `CustodyHolder` **re-pointed** to item 2                             | the union's arms differ in what they REFER TO, a role-holding versus a party, not in what grain of party they mean                                          |
| `src/custody.ts` — `sameHolder`'s comment                                               | cross-arm equality would resolve a `partyRole` to a party, which is item 2's refused vocabulary                                                             |
| `src/rules/authority.ts` — `authorityToDeclare` **re-pointed** to items 2, 5            | comparing ROLE NAMES is not a deficiency this item was going to fix — it reads the surface the grain is on                                                  |
| `src/assertions.ts` — `HandoverValuePart`                                               | "grain is **owed**" was the reason the union is kept; it is not the reason any more                                                                         |
| `src/catalog.ts` — the `0.6.4` narrative                                                | annotated rather than re-cut, since the decision emits nothing                                                                                              |
| `tools/generate-glossary.ts` — two `RULES` entries                                      | "a gate is registered here when it is written" (`[A8 §9]`'s own note); with no `owed-vocabularies` row, this register is the only place a consumer finds it |
| `context-map.test.ts` — one concept, three markers                                      | `AssertedBy` is promoted to a hub, which is the deliverable rather than a side effect                                                                       |
| `[A8 §9 item 3]`, `[A8 §9 item 1]`, `[A8 §3(a)]`, `[A8 §7.3]`, `[SD §1.1]`, `[SD §1.2]` | marked annotations, in both directions                                                                                                                      |

### What it deliberately did not do

- **No `data/owed-vocabularies.json` row, and that is a decision.** The other two refusals
  (`identityScheme`, `roleClass`) refuse a vocabulary the model has a **field** for; this one refuses
  the field. That table derives a vocabulary's state from a live `Exact<…, OwedCode<'v'>>` gate, so
  minting `OwedCode<'partyClass'>` would **invent the slot the decision declines** — and the table's
  own conformance test would have accepted it, which is why the reasoning is written into the gate.
- **No `place` kind**, and `party-grain-refuses.ts` deliberately has no directive for the spelling:
  `place` is **owed** rather than refused (`custody.ts`'s `LegEndpoint`), and a directive would send
  whoever legitimately mints it to the wrong document.
- **No `legalName` field or scheme**, and the hierarchy stays owed.
- **Nothing scheduled against fetching Atlas.** `src:atlas-world-group-api`'s contribution was read
  from `docs/atlas-world-group-api/openapi/`, bytes this repo already holds — **a read, not a
  fetch** — and it confirmed item 3's "column names only" exactly.

---

## 2. The two things the plan got wrong, and the one this round got wrong

> As with the party round, what is worth carrying is not that they were wrong but **how each was
> caught**. This time: one by doing the measurement the plan asked for, one by reading a published
> field list, and one by a reviewer pointing at a witness I had already read **and set aside**.

### (a) The item's own source list omits the two sources that decide it — caught by checking it against the captures

§1.3 item 1 said to assume item 3's list had item 1's defect "until you have checked it". It does,
and worse: item 1's list was wrong about **cardinality**, item 3's is wrong about **membership**.

- **`src:stedi-x12-reference` element 98** names all four grains in its own definition sentence and
  publishes no axis to tell them apart. **This corpus read it three days earlier**, for item 2, and
  item 2's annotation handed its evidence to three other questions and not to this one.
- **`src:cfr-49-375` § 375.103** is the only source that _defines_ party classes, is the only
  primary captured one, and classifies by function.

**And the one captured witness item 3 does name is the wrong witness for its own question.**
`MTOAgent`'s swagger reads _"the shipment this agent is **permitted** to release/receive"_ — a
permission in a value. Milmove's records that put an individual in an **asserting** position,
`SignedCertification {SubmittingUserID, Signature, Date}` and `EvaluationReport {OfficeUserID,
ObservedDeliveryDate, ViolationsObserved, SeriousIncident}`, go unnamed.

**Lesson: a plan that hands you a source list has given you a hypothesis, not an inventory —
and the omission to look for is the source you have ALREADY READ for something else.** An unread
source is at least visible as unread; a source read under another item's name is invisible.

### (b) `src:sirva-ade`'s `Owner` is not the person/organisation axis — caught by reading the published value list

The plan's §1.2 offered "one `party` kind with a discriminating attribute" and said SIRVA's `Type`
enum "is the only published candidate". The nearer-looking candidate is `Owner ∈
Corporate | Agent | Vendor`, and **all three values are organisations** — it is an _affiliation_
class. In the one grade-A contract the grain is inferable **only from `Type`** (`Driver` a person,
`Tractor`/`Trailer` equipment, the nine agent roles companies), which is `[A8 §3(a)]`'s finding
arriving from a second direction and is why the decision went the way it did.

**Lesson: before classifying an enum as an axis, read its members.** A three-valued field next to a
role field reads like a kind discriminator and was not one.

### (c) The branch grain's headline witness was wrong, and the counter-evidence was on the same JSON row

The first implementation commit closed the branch grain on **both** `gbloc` and `agentCode`, leaning
on `gbloc`'s `src:dtr-part-iv` gloss — _"the identity of the **OFFICE**"_. Its **other** witness, on
the same row, says responsibility for a GBLOC _"can be transferred between offices with an effective
date"_ — which is what `[SD §7.2]` sources the identifier's effective interval from. **An identifier
that migrates between offices does not identify an office the way a SCAC identifies a carrier.**

The closure stands on `agentCode` alone, which needs no help. `gbloc` corroborates with its caveat
stated, and the gate now asserts **both** of its witnesses so the office gloss cannot be quoted
without the transfer.

**Lesson, and it is the party round's §4 lesson one turn further in: a citation is two claims — that
the text says this, and that the text is right — and the second claim's counter-evidence can be a
witness you have already read and set aside as off-topic.** I had read the transfer sentence while
measuring `gbloc`'s subject and filed it as "SD §7.2's business". Reading a row and _using_ a row
are different passes, and only the second one tests it.

---

## 3. Landing a change — what the recipe caught this round

Read §3 of `plans/completed/domain-reference-party-entity.md`, which carries the accumulated list.
Four items earned their place again, and two gained evidence:

- **§3 item 8 — read the emitted diff.** Here it was **empty**, and that is a result rather than a
  non-event: it is what licenses "no version bump" and it is the only way to know. **Note the
  distinction the record above draws**: item 8 _confirmed_ this round rather than _located_, and the
  unpredicted finding came from §1.3's other wire question instead.
- **§3 item 2 — the per-member table in `data/`.** Not exercised as an edit this round, but it is
  what makes the `person`-kind tamper fail loudly instead of silently, and that is the second half
  of `party-grain-refuses.ts`'s claim.
- **Run the tamper before naming its shape** (the party round's own addition). It is the reason there
  are two gates rather than one. The first draft's tamper **passed**, and nothing but running it
  would have said so — reading `Exact<>` does not make the optional-member hole visible.
- **Sweep the ITEM, not the phrase.** `grep` for `A8 §9 item 3` across `src/`, `data/`, `tests/` and
  `docs/domain-reference/` found seven live sites, of which **two were markers to re-point rather
  than prose to rewrite**, and one was a sentence **older than this round**:
  `identity-schemes.test.ts`'s header still said `identity-scheme-refuses.ts` "keeps `party` out of
  `AggregateKind`", which catalog `0.6.4` had inverted. Second round running that an item sweep has
  turned up a stale sentence a previous round's own phrase sweep missed.

---

## 4. The procedural lessons, with this round's three added

Read §4 of `plans/completed/domain-reference-party-entity.md` for the accumulated list. This round
adds three, and the second is the one most likely to recur:

> **An `Exact<>` over an object shape does not refuse an OPTIONAL member.** `[A] extends [B]` and
> `[B] extends [A]` both hold when A has one extra optional property, so the gate evaluates to
> `true` and the field is in. Gate the **key set** (`Exact<keyof T, 'a' | 'b'>`) when the thing being
> refused is a field; keep the shape comparison beside it for what it alone catches. Found by running
> the tamper, which is the only way it is findable.
>
> **The source you have already read for another item is the one a list omits invisibly.** An unread
> source is at least recorded as unread — `round-1-crosscheck.md` has a section for it. A source read
> under item 2's name, and filed against item 2's question, is not visible to item 3 at all. Element
> 98 answered this round's question in its own definition sentence three days before the round
> started.
>
> **Reading a row and USING a row are two passes, and only the second tests it.** `gbloc`'s transfer
> witness was read during the measurement and filed as another section's business; it became
> counter-evidence the moment the row was used as a citation. **When you promote something you read
> into something you cite, re-read the whole of it.**

---

## 5. What is blocked, and on what — ask-the-user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and it must not be inferred from the four published procedures — the `[ORIGINAL]`
   guess `[SD §0]` forbids. Record it as **`[USER]`** with the user's own words quoted.
   **This round deliberately did not touch it**, and it is now adjacent in a sharper way than the
   plan predicted: item 3 established that the individual who signs asserts **under a role**, so the
   wording C2 owes is about what the _act_ asserts and not about _who_ the asserter is. The second
   half is settled; the first is still the user's.

### Recorded modelling questions — none is a user ask

- **`[A8 §9 item 3]`'s own residue — Rule A8-SELF is under-determined.** `[A8 §3(a)]` states its
  purpose at legal-entity grain ("one **company** agreeing with itself") and
  `corroborationIsIndependent` is `!==` over two `PartyId`s, but `assertedBy` carries one `PartyId`
  for all eighteen roles, of which `driver` is "the person driving". A hauler's driver and that same
  hauler's office, both asserting `condition` at a boundary, pass as two independent parties.
  **Not closable by effort**: it needs the person→organisation link as a **reference**, and no source
  publishes one (dp3 a noun phrase, milmove its own schema's FK, SIRVA a three-valued class).
  `TODO([A8 §9 item 3])` in `src/rules/authority.ts`.
- **`[A8 §9 item 1]`'s hierarchy** — `parentAgentCode` and `/Agents/{agentCode}/Family`, a
  party-to-party relation no `AssertionType` holds. **Adjacent to the residue above, not identical**:
  that one is organisation→organisation and this one is person→organisation. **Whether one fact class
  covers both is not decided** — ask before assuming.
- **`legal name`** — two of three blockers stand: the **disjunction** (legal **or** trade/DBA, two
  vocabularies under **I-KEY**) and the **bundled physical address** with no `place` aggregate. The
  third fell with this round: `src:sirva-ade`'s `Resource` fuses company, person and tractor because
  **it spans our `party` and our `resource`**, with the grain on its `Type`.
- **`[SD §1.2]`'s `resource` row is uncited for half of what it admits.** Its citation
  (`src:x12-212-trailer-manifest` `MS2`) covers **equipment**; the words _"driver or crew member"_
  carry none. The live consequence is benign — one human is a `resource` (what an `Assignment` binds)
  and a **party** (who asserts) — and it is why item 3's crew-member third already had a home.
  **Recorded, not repaired: it is `[SD §1.2]`'s and `[A3]`'s.**
- **`[A8 §9 item 2]`** (`roleClass`) and **`[A9 §3.2]`** (`identityScheme`) stay
  `refusedOnEvidence` with live gates. **Item 2 is now the sole blocker on two markers this round
  re-pointed**, so the pressure on a refused vocabulary has gone up without the refusal weakening.
- **`[A8 §9 item 5]`** (role cardinality) — not reached, not promised. It is now one of two owners of
  `authorityToDeclare`'s marker.
- **`[A9 §3.3(b)]`'s SCAC gap** stays open with the fetch ruled out; `definedNotMerelyNamed` is still
  `false`.
- **`[SD §10.4]`** still carries items open, and **`custody.ts` still wants a `place`** — the
  standing candidate for the next aggregate kind.
- **A bare `§n` cited ACROSS documents.** `[A2]`'s §Cross-area note to `[A3]` cites line offsets as
  if they were headings; repairing it is `[A2]`'s and `[A3]`'s. **This round is the positive case for
  the rule the plan wrote**: §1.3 item 4 named `[A8 §7.3]` by its heading, read it, and the citation
  held — the plan's first draft had read it as `[SD §7.3]`, which is "The vocabulary scope".

---

## 6. How to work here

Read §6 of the party round's record; nothing in it is superseded. The two entries that mattered
most here:

- **A gate must read the thing that DECLARES.** The branch-grain gate reads
  `data/identity-schemes.json`'s **witnesses**, which is why softening one of them fails the suite.
- **Read the existing tests for the records you are writing about.** The A8-SELF residue surfaced
  because `tests/conformance/core-vocabulary-refuses.ts`'s own fixture is
  `{ party: partyId('p1'), role: 'driver' }` — a person-grain role against a bare party id, written
  years of rounds before anyone asked what grain it was.

And one new entry, for the next round that writes a refusal:

- **Before adding a row to `data/owed-vocabularies.json`, ask whether the model has a FIELD for the
  vocabulary.** If it does not, the refusal is of the field and the row would invent the slot. The
  table's own conformance test does not catch that — it checks the row against a gate, not the gate
  against the model — so the reasoning has to be written into the gate's docstring.

---

## 7. Where the round landed

- **Branch:** `chore/dr-person-grain`, cut from `main` at `65a11dfd`.
- **Three commits:** the measurements (`39490ff9`), the decision (`e722619c`), the branch-grain
  witness correction (`28e0ab8e`).
- **Gates, all seven:** `test` 543 in 26 files · `lint` · `typecheck` · `alloy` · `glossary` ·
  `catalog` (**byte-identical** — the point) · `context-map`.
- **Catalog `specVersion` unchanged at `0.6.4`**, and no change class minted, because there is no
  emitted change to classify.

---

## 8. The measurements, preserved verbatim from the plan

> Written into `plans/in-progress/domain-reference-a8-item3.md` as its §1.3a on 2026-10-09 and
> committed **before** anything was designed (`39490ff9`), which is the party round's practice. Kept
> here word for word, because §2 above summarises what it refuted and this is the evidence.

Each answer is written against the **captures** where there are any, and says so where there are
none. The headline is §1.3 item 1's own prediction coming true for the second round running:
**item 3's list of sources is wrong, and in the same direction item 1's was — it omits the two
sources that decide the question, one of which this corpus has already read.**

#### item 1 — what each source publishes, at which grain, enumerated by name

| source                      | `captured/`?           | what it publishes, at which grain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src:milmove-mymove`        | **yes** (Go + swagger) | **Both grains, as separate tables.** Person: `MTOAgent {FirstName, LastName, Email, Phone, MTOAgentType ∈ RELEASING_AGENT\|RECEIVING_AGENT}`, FK to one `mto_shipment`, **no company column at all**; `OfficeUser` _"someone who works in one of the TransportationOffices"_, with a **non-nullable** `TransportationOfficeID` and a **nullable** `UserID`. Organisation: `Organization {Name, PocEmail, PocPhone}`, `Contractor {Name, Type, ContractNumber}`, `TransportationOffice`, `StorageFacility`. Account: `User` _"an entity with a registered profile ID and email in Okta"_. |
| `src:atlas-world-group-api` | yes, but not this part | **Column names only — item 3 is right.** `OnSiteStaffMember {onSiteStaff_ID, ord_Hdrnumber, ord_Number, role_ID (int, no code list), personnelName (a STRING, not a ref), source, ciD_Number (undefined anywhere in the catalogue), type, run_Date, lastUpdatedBy/On, createdBy/On, onSiteStaffMemberLocations[] → stop_Number}` — `openapi/atlasorder-v1.json:11209`, read in-repo under `docs/atlas-world-group-api/`, which is a **read of bytes we hold**, not the fetch `[SD §0]` forbids.                                                                                          |
| `src:sirva-ade`             | **no** — analysis only | One `Resource {Id, Name, Type, Owner}`; `Type ∈ Booker, OriginAgent, DestinationAgent, LoadAgent, UnloadAgent, Hauler, R19Agent, RR19Agent, SITAgent, Driver, Tractor, Trailer`; `Owner ∈ Corporate, Agent, Vendor`.                                                                                                                                                                                                                                                                                                                                                                     |
| `src:dp3-tender-of-service` | **no** — analysis only | NTS §1.4.13.1 pp.25-26 — an **NTS TSP company official** sight-verifies firearms and certifies in writing to the PPSO within 72 h. §B.17.a p.28 row 42 — any change to **officials** must be disclosed in the DPS Qualifications module within 5 days, and the obligated party there is the **TSP**. §C.17.a — the AT DELIVERY notice is _"jointly signed by my representative and the customer or their authorized agent"_.                                                                                                                                                             |

**The two omissions, and they are the decisive ones.**

1. **`src:stedi-x12-reference` element 98 — already read, already captured, and it is the only
   industry list that enumerates party slots.** `[A8 §9 item 2]` read it on 2026-10-06 into
   `sources/stedi-x12-reference/captured/stedi-element-98-party-roles-notes.md`, and its own
   definition is **item 3's question, in one sentence**:

   > _"Code identifying an organizational entity, a physical location, property or an individual"_

   Four grains, named by the publisher: organisation, place, equipment, person. Beneath that
   sentence the list is **one flat table with no class column** — `D1 Driver` beside `CA Carrier`
   beside `BA Battery` beside `SF Ship From`. The four-way sort in that capture file is **ours**,
   and `[SD §0]` is what forbids publishing it. So the list that names all four grains is the list
   that publishes **no axis to tell them apart**. Item 3 does not cite it, and `[A8 §9 item 2]`'s
   own annotation hands element 98's evidence to three other questions and not to this one.

2. **`src:cfr-49-375` — the corpus's only source that _defines_ party classes, primary and
   captured, and it classifies by FUNCTION rather than by kind.** § 375.103:

   - _"**Individual shipper** means any person who— (1) Is the shipper, consignor, or consignee of a
     household goods shipment; (2) Is identified as the shipper, consignor, or consignee on the face
     of the bill of lading; (3) **Owns the goods** being transported; and (4) **Pays his or her own**
     tariff transportation charges"_
   - _"**Commercial shipper** means any person who is named as the consignor or consignee … **who is
     not the owner** of the goods … but who assumes the responsibility for payment … for the account
     of the beneficial owner"_
   - _"**Government bill of lading shipper** means any person whose property is transported under
     the terms and conditions of a government bill of lading"_

   Three classes, and the axis is **who owns the goods and who pays** — not what the party is. The
   definiendum in all three is _"any **person**"_, a word the same section uses for companies:
   _"the term includes any **person** considered to be a **household goods motor carrier**"_. The
   only natural-person marker anywhere in it is the pronoun in _"pays **his or her** own"_, and it
   is incidental to a four-part functional test.

**And item 3's one captured witness is the wrong witness for its own question.** `MTOAgent`'s
swagger says `mtoShipmentID` is _"The ID of the shipment this agent is **permitted** to
release/receive"_ — a **permission**, named in a value. Milmove's records that actually put an
individual in an **asserting** position are `SignedCertification` and `EvaluationReport`, and item 3
names neither. Second round running that a `[A8 §9]` item's source list has had to be corrected
before it could be answered.

#### item 2 — does `resource` already hold the equipment half? MORE than that, and it is sourced thin

`[SD §1.2]`'s `resource` is _"a vehicle, trailer, **driver or crew member**"_ — so our own aggregate
makes exactly `src:sirva-ade`'s fusion minus the companies, and `equipmentNumber` and `sealNumber`
are already `identifies: resource` rows. **Item 3's title therefore asks about a grain that already
has a home: a crew member is a `resource`, bound to a trip by an `assignment`.** What is left is
person-vs-organisation for a party that **asserts**.

**One thing to record and NOT repair.** `[SD §1.2]`'s citation for `resource` covers the equipment
half only — _"an equipment identifier must attach to the equipment (`src:x12-212-trailer-manifest`
`MS2`… ) Without it, §7's **equipment grain** has nothing to attach to"_. The words _"driver or crew
member"_ in that same row carry **no citation**. So one human can be a `resource` (assignable) and a
party (asserting), and whether that is a decision or a fossil of an uncited phrase is `[SD §1.2]`'s
and `[A3]`'s, not this round's.

#### item 3 — is the individual ever an ASSERTER, or only named in a value? Enumerated

| source                      | individual in an asserting position?                                                                                                                                                         | and what it attaches them to                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src:dp3-tender-of-service` | **Yes** — the NTS TSP company official **sight-verifies and certifies in writing** (§1.4.13.1)                                                                                               | the sentence itself: _"NTS TSP **company** official"_. §B.17.a makes the **TSP** the party that discloses changes to officials.                                                                                                                                       |
| `src:milmove-mymove`        | **Yes, twice** — `EvaluationReport {OfficeUserID, ObservedPickupDate, ObservedDeliveryDate, ViolationsObserved, SeriousIncident}`; `SignedCertification {SubmittingUserID, Signature, Date}` | `OfficeUser.TransportationOfficeID` is **mandatory** — the individual asserter resolves to an organisation by a required join. `SignedCertification`'s asserter is a bare Okta `users` row: an **authenticated principal**, which is milmove's authn and not a party. |
| `src:atlas-world-group-api` | **No** — `createdBy` / `lastUpdatedBy` are audit strings on the row, not a modelled asserter                                                                                                 | nothing; `personnelName` is a string too.                                                                                                                                                                                                                             |
| `src:sirva-ade`             | **No** — `ProofOfDeliveryName` is _"Name of person receiving shipment at destination"_, a **value** on a `Deliver` event; the one agent→SIRVA assertion channel is documents                 | `Resource.Owner ∈ Corporate\|Agent\|Vendor` on a `Type: Driver` row — an **affiliation class**, never a reference to the owning party.                                                                                                                                |

**The pattern, and it holds in every source that has one: wherever an individual asserts, the source
attaches them to an organisation in the same breath — and never by a reference the model could
read.** dp3 does it in a noun phrase, milmove in its own schema's FK, SIRVA as a three-valued class.
The one asserting individual with **no** organisation behind them is the **customer**, and that is
not an omission: `src:cfr-49-375` makes the goods owner's signature constitutive — §375.503(c) and
§375.401(h), both **mutual** (**corrected by the item-2 round**; this read "four times" and named two
sections that require no signature),
which is why `ROLE_NAMES` already carries `customer` and `[A8 §5]` row 5 lists it **competing**.

**`src:sirva-ade`'s `Owner` is not the axis the plan's §1.2 took it for.** Its three values are all
organisation classes; the person/organisation/equipment grain in the one grade-A contract is
inferable **only from `Type`** — `Driver` is a person, `Tractor`/`Trailer` are equipment, the nine
agent roles are companies. **So in the best-sourced contract in the corpus the grain is carried by
the ROLE, not by the party** — which is `[A8 §3(a)]`'s own finding arriving from a second direction.

#### item 4 — what `[A8 §7.3]` actually requires (**A8's own** §7.3, _"There is exactly one instant where two roles are jointly authoritative, and the model is forbidden to pick"_)

**A8-JOINT is written in ROLES, and every source under it names INDIVIDUALS.** The rule: _"both the
**releasing role** and the **receiving role** are authoritative for the boundary instant"_. Its
quoted evidence: NTS §1.6.10 _"the opinion of the TSP's **driver** and the NTS TSP's
**representative**"_; §375.503 (inventory signed by both); §C.17.a (_"jointly signed by my
**representative** and the customer"_); A-413 §F.1.b (SF 1200 signed by the **initiating official**
and the **TSP representative**).

So §7.3's quoted phrase _"releasing and receiving parties"_ is at company grain while its sources are
at individual grain — and **the gap is already closed by the mechanism A8 chose**: the rule keys on
`role`, `assertedBy.role` carries the role, and `ROLE_NAMES` already holds `driver`, whose docstring
reads _"**The person** driving"_. Element 98 cross-walks that member **exactly** to its one
individual-kind code, `D1 Driver` (capture, _"Exact."_).

#### item 5 — does any of this reach the wire?

`assertedBy {party, role}` is on **every** envelope (`[SD §1.1]`, MANDATORY), so a person/organisation
discriminator there is a change to every record in the catalog. Two things already reach the wire and
carry the distinction:

- **`identity` assertions whose `subject` is a party** — and the five party-grain rows say what grain
  a party may be, by what they identify: `gbloc` is _"the identity of the **OFFICE**, and the scope
  unit for suspensions and blackouts"_ (`definedNotMerelyNamed: true`); `agentCode` is _"a 7-digit
  hierarchical agent id whose **trailing three digits are the branch**"_ (`definedNotMerelyNamed:
true`); `scac`, `usDotNumber` and `mcNumber` identify a carrier **company**. **Not one of the
  twenty witnessed schemes identifies a natural person.**
- **`assertedBy.role`** — eighteen members whose glosses run from `booker`, _"the party that books
  the move"_, to `driver`, _"the person driving"_.

**The one thing the measurement found that the decision did not predict** — `[A8 §9 item 1]`'s §3
item 8 holding for a fifth round — is that **Rule A8-SELF is under-determined, and it is the rule
`[A8 §9 item 1]` went looking for and did not find.** `corroborationIsIndependent(authoritative,
corroborating)` is `authoritative !== corroborating` over two `PartyId`s, and `[A8 §3(a)]` states its
purpose at **legal-entity** grain: _"a model that counts role-instances rather than parties will read
one **company** agreeing with itself as two-party agreement."_ But `assertedBy.party` is one
`PartyId` for all eighteen roles, and under `role: 'driver'` the docstring says that party is a
**person**. So a hauler's driver and that same hauler's office, both asserting `condition` at a
boundary, pass `!==` as two independent parties — which is the defect §3(a) names, one level up.
`tests/conformance/core-vocabulary-refuses.ts`'s own fixture is written that way:
`{ party: partyId('p1'), role: 'driver' }`.

**It is recorded, not fixed.** Fixing it needs the person→organisation link as a **reference**, and
item 3's own measurement is that no source publishes one: dp3 has a noun phrase, milmove has its own
schema's FK, SIRVA has a three-valued class. And it does **not** license unifying the `PartyId`
brand: this is a comparison between two **references**, which is the shape `[A8 §9 item 1]` already
measured.
