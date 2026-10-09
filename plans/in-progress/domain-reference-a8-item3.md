# Domain reference — person vs organisation vs crew-member grain (`[A8 §9 item 3]`): plan

**Written 2026-10-08**, to be read by a session with **no prior context**. Everything needed to
start is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-party-entity.md`, whose round landed in full at
catalog `0.6.4`; the record is `plans/completed/domain-reference-party-entity.md`, and its three
plan-was-wrong findings are carried into §4 rather than left to be rediscovered.

---

## Resume here

**THIS ROUND HAS NOT STARTED.** The party round is fully landed and is **not** this round.

### Where

- **Branch:** `chore/dr-person-grain`, cut from `main` at `65a11dfd` (the party round, MERGED). The
  party round landed on `chore/dr-party` in
  `/home/steve/repos/pegasus-deps-advisory-flip` (Postgres `pegasus-pg-deps-advisory-flip`, port
  **5459**). That branch's work is complete; check whether it has merged before branching from it.
- **Last domain-reference commit:** the party round's record and this plan.

### Status

- [x] §1.3 — the measurements, **before** designing anything → **§1.3a**, 2026-10-09
- [ ] §1.2 — the decision: does the model distinguish a person from an organisation, and how?
- [ ] implementation, gates, tamper pass, cross-area edits, round record

### Next action

**§1.3a is written and committed. Write §1.2's decision against it** — and read §1.3a's item 1
first, because item 3's source list was wrong in the same direction item 1's was, and the two
sources it omits are the two that decide the question.

---

## 0. Why this item is now the blocking one, measured rather than asserted

**Three of the four residues `[A8 §9 item 1]` left route through this item**, which is the party
round's measurement and is written into that item's own annotation:

1. **`legal name`** — blocked here. `src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}` whose
   `Id` _"can contain agent, vendor, driver **or equipment** code based on the resource `Type`"_, so
   its `Name` names a company, a person or a **tractor**. **A party must be defined before it can be
   named.**
2. **the branch grain** — blocked here. `agentCode`'s trailing three digits already carry the branch,
   so what is owed is the grain question (_is a branch its own party?_) and not a field.
3. **`custody.ts`'s `TODO([A8 §9 items 2-3])`** — re-pointed by the party round rather than removed.
   Whether a leg's `performedBy` resolves to a `partyRole` needs this item **and** item 2's role
   vocabulary, which is `refusedOnEvidence`.

The fourth residue — the party's id shape (`PartyId` vs `SubjectRef<'party'>`) — does **not** route
through here and is independent. See the record's §3.

---

## 1. THE DELIVERABLE

### 1.1 What `[A8 §9 item 3]` says, and the material it already names

Read the item itself first: `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 3**.
It already gathers four sources that disagree, and names them:

- `src:milmove-mymove`'s **`MTOAgent`** is a _person_ (`RELEASING_AGENT` / `RECEIVING_AGENT`);
- `src:atlas-world-group-api`'s **`OnSiteStaffMember`** carries `role_ID` / `role_Description` bound
  to specific `stop_Number`s — **column names only**, and `[SD §0]` holds that Atlas's vocabulary is
  _"not merely unfetched but unpublished"_, so **nothing may be scheduled against fetching it**;
- `src:sirva-ade`'s **`Resource`** fuses companies, people and **equipment** (`Tractor`, `Trailer`)
  into one `Type` enum;
- `src:dp3-tender-of-service` **NTS §1.4.13.1** requires an **NTS TSP company official** — a named
  individual, not the company — to sight-verify firearms within 72 hours.

And the item states the question it owes — quoted verbatim, bare `§n` and all, because the bare
reference is **A8's own** and resolves inside A8 (see §1.3 item 4): **"§7.3's 'releasing and
receiving parties' is written at company grain, and A8 must decide whether the _individual_ who
signs is a distinct asserter."**

### 1.2 The decision this turns on, and it is NOT yet a schema question

Unlike the party round — where `ids.ts` stated the schema question outright — **nothing in `src/`
asks this one in a decidable form.** That is the first thing to establish rather than assume. The
candidate shapes, none of them costed yet:

- **One `party` kind with a discriminating attribute** (person / organisation / equipment). Cheap on
  the wire; needs a vocabulary, and a vocabulary needs a source. `src:sirva-ade`'s `Type` enum is the
  only published candidate and it **fuses equipment in**, which `resource` already models.
- **Two aggregate kinds** (`party` and, say, `person`). Additive under `[SD §1.2]`, but it splits
  every `PartyId` reference site and so interacts with the id-shape item the party round left owed.
- **Neither — the individual is an `assertedBy` property, not a subject.** `[SD §1.1]` already _"puts
  the role on the assertion rather than on the party"_, so there is a live precedent for pushing a
  distinction onto the assertion instead of the subject. **Costed at zero on the wire if true.**
- **Refuse on the evidence**, like `roleClass` and `identityScheme`. Four sources disagreeing at
  three grains is the shape that has twice produced a refusal in this corpus rather than a
  vocabulary. **This is a live outcome, not a failure mode** — and `[A9 §3.2]`'s and
  `[A8 §9 item 2]`'s refusals are the worked examples.

### 1.3 What to MEASURE before designing — this is the planning pass

> **ANSWERED 2026-10-09 — the answers are §1.3a below, and two of the five changed the
> design.** The questions are left as written, because what they asked for is the transferable
> part.

Nothing below is a step to execute. **The party round's lesson is that the plan's own framing breaks
first**, so each item is a question whose answer changes the design.

1. **What does each source publish at which grain, enumerated by name rather than counted?** The
   party round's first measurement found `[A8 §9 item 1]`'s own list wrong in **both** directions —
   a two-scheme phrase written as one, and a scheme omitted entirely. **Assume item 3's list has the
   same defect until you have checked it**, and check it against the captures, not the analyses:
   `ls -d docs/domain-reference/sources/*/captured` and `.../local` are the two halves.
2. **Does `resource` already hold the equipment half?** `src:sirva-ade`'s `Resource` fuses equipment
   in, and `[SD §1.2]` already has a `resource` kind with `equipmentNumber` and `sealNumber` schemes
   against it. **If the fusion is SIRVA's accident rather than the domain's, item 3's question is
   narrower than it looks** — person vs organisation only.
3. **Is the individual ever an ASSERTER, or only ever named in a value?** This is the question that
   decides between the third candidate and the others, and it is answerable from the corpus:
   `src:dp3-tender-of-service`'s company official **sight-verifies**, which is an assertion;
   `ProofOfDeliveryName` (`src:sirva-ade`) is a _value_ on a delivery, which is not. **Enumerate
   which of the four sources puts an individual in an asserting position.**
4. **What does `[A8 §7.3]`'s "releasing and receiving parties" actually require?** — **A8's own
   §7.3**, heading _"There is exactly one instant where two roles are jointly authoritative, and the
   model is forbidden to pick"_, which A8 calls _"the strongest-sourced finding in the document"_.
   **Not `[SD §7.3]`**, which is "The vocabulary scope" and has nothing to do with this; §9 item 3
   writes a bare "§7.3" and means its own. _(This plan cited the wrong document on its first draft —
   caught by the §Cross-area pass, and §5's bullet on bare `§n` citations now carries the general
   form: **cite the heading**, and verify by reading the target.)_
   Read it with `[SD §4.8.3]`'s fold before assuming the company grain is a defect — the party round
   found that `custody.ts`'s union exists because two **published inputs** disagree, not because the
   model is careless.
5. **Does any of this reach the wire?** `[SD §1.1]`'s `assertedBy {party, role}` is on **every**
   envelope, so a person/organisation distinction landing there is a change to every record.
   **Measure the emitted diff before classifying** — §3 item 8, which has now located something the
   decision did not predict **four rounds running**.

### 1.3a The measurements, ANSWERED — 2026-10-09, before anything was designed

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
not an omission: `src:cfr-49-375` makes the customer's signature constitutive four times
(§375.505(a) BOL, §375.503 inventory, §375.701 delivery receipt, §375.515(b) the weighing waiver),
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

---

### 1.4 What this round must not do

- **It must not reopen either refused vocabulary.** `identityScheme` (`[A9 §3.2]`) and `roleClass`
  (`[A8 §9 item 2]`) are `refusedOnEvidence` with live gates.
- **It must not mint a `legalName` field or scheme as a side effect.** The party round recorded the
  evidence **and** the rejection of the scheme reading; closing the name is a decision of its own
  once this item lands.
- **It must not schedule anything against fetching Atlas.** `[SD §0]` forbids it, in terms.
- **It must not unify the `PartyId` brand** unless it finds the rule that needs the comparison. That
  item is independent and the record's §3 states what closing it costs.

---

## 2. Current state and the gate commands

Catalog at `specVersion` **0.6.4**. `party` is an `aggregate` kind. `[A9 §3.6]` is closed.

```
npm run test        -w @pegasus/domain-reference
npm run lint        -w @pegasus/domain-reference
npm run typecheck   -w @pegasus/domain-reference
npm run alloy       -w @pegasus/domain-reference
npm run glossary    -w @pegasus/domain-reference
npm run catalog     -w @pegasus/domain-reference
npm run context-map -w @pegasus/domain-reference
```

**No count is written here on purpose** (§3 item 10). The commands produce it in about five seconds.

---

## 3. Landing a change — the recipe, unchanged and still load-bearing

The party round followed `plans/completed/domain-reference-party-entity.md`'s §3 and **items 2, 8, 10
and 14 each caught something**. Rather than restate the list, read §3 of the **previous** plan as
preserved in that record, and note the two items the party round added evidence for:

- **§3 item 2 — "fill the per-member table in `data/`" is not optional, and the table may not be
  where you look.** `data/canonical-subjects.json`'s `families.anyAggregate.members` is a
  hand-written copy of `AGGREGATE_KINDS` that the loader compares as a **set**. A `grep` for the new
  member's name does not find it. The suite does, and names the set difference.
- **§3 item 8 — read the emitted diff, and run the experiment rather than reasoning about it.** The
  party round's planned fix for the brand collision was **refuted by regenerating the catalog**: it
  produced two byte-identical `$defs` under two names, which no amount of reading the source would
  have predicted.

---

## 4. The procedural lessons, with the party round's three added

Read §4 of the record (`plans/completed/domain-reference-party-entity.md`), which carries the
accumulated list. The party round adds three, and the third is the sharpest yet:

> **A plan that asks you to sort a set into two buckets may be wrong about the buckets AND the set.**
> `[A8 §9 item 1]`'s attributes needed three buckets, and its own enumeration was wrong in both
> directions. **Count the set before you sort it.**
>
> **"Nothing in our model can hold it, therefore it is X" is a claim about us, not about the
> source.** That inference is how `legal name` got classified as a field with no citation, in a
> corpus whose `[SD §0]` exists to stop exactly that.
>
> **A citation is two claims — that the text says this, and that the text is right — and this time
> the plan that failed the test was my own, one draft earlier.** The brand unification was argued as
> required because A8-SELF "compares two parties across two brands". `corroborationIsIndependent`
> types **both** parameters as `PartyId`. One look at the declaration. **And the over-correction is
> part of the lesson**: having lost the premise, the next instinct was "so the brand is fine", which
> is also wrong — every other aggregate is referenced by `SubjectRef<K>`, so the brand is a fossil.
> **Losing an argument for a change is not an argument against it.**
>
> **And one about tampering: run the tamper before naming its shape.** The party round nearly
> recorded that a count gate "passes a half-tamper". It does not — the loader's set comparison
> catches it upstream. The count was still worth replacing, for the narrower reason that it **dates**.

---

## 5. What is blocked, and on what — ask the user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived yet.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — that is the
   `[ORIGINAL]` guess `[SD §0]` forbids. Record it as **`[USER]`** with the user's own words quoted.
   **This item is adjacent to the present round**: a signature is the case where an _individual_ acts
   and `src:dp3-tender-of-service`'s company official is the corpus's clearest instance. **Do not
   resolve C2 as a side effect of item 3.**

### Recorded modelling questions — none is a user ask

Unchanged from the previous plan's §5 except as noted; read it in the record. The ones this round
touches:

- **`[A8 §9 item 1]`'s four residues** — §0 above. Three route through this item.
- **`CAUSE_UNKNOWN`'s attribution** needs the refused `roleClass` vocabulary; not closable by effort.
- **`[A8 §9 item 5]`** (role cardinality) — the party round did **not** reach it, and did not promise
  to. A8-SELF is now testable against a party **subject** for the first time, which may make part of
  item 5 decidable. **Measure; do not promise** — the party round's own §3 item 22 instance was the
  claim that turned out to rest on a false premise.
- **`[A9 §3.3(b)]`'s SCAC gap** stays open with the fetch ruled out. The party round gave SCAC a
  `subject`; it did **not** give it a definition. `definedNotMerelyNamed` is still `false`.
- **`[SD §10.4]`** still carries items open, and **`custody.ts` still wants a `place`** — the
  standing candidate for the next aggregate kind, whose `TODO` deliberately no longer claims an
  ordinal.
- **A bare `§n` cited ACROSS documents, and it is not one plan's defect.** `[A2]`'s §Cross-area note
  to `[A3]` cites _"(§1207, §1289, §3.3's diversion row, §5.1's note at :544)"_, and neither `1207`
  nor `1289` is a heading in either document — they are **line offsets** into `[A3]`. Repairing it is
  `[A2]`'s and `[A3]`'s, via a marked annotation; recorded here so a round that opens either document
  for another reason fixes it in passing. **The same defect has a second form that this corpus hits
  more often: a bare `§n` that is a real heading in the WRONG document.** `[A8 §9 item 3]` writes
  "§7.3" meaning **A8's own**, and this plan's own §1.3 item 4 read it as `[SD §7.3]` on its first
  draft — which is "The vocabulary scope" and unrelated. **The general form: cite the heading, and
  where the headings are named rather than numbered, name the heading.** The `roleClass` round is the
  proof it is not cosmetic: a line-number citation is what let a plan attribute a prediction to a
  section making a different claim.

---

## 6. How to work here

Read §6 of the record. Nothing in it is superseded. The two entries most likely to matter here:

- **A gate must read the thing that DECLARES**, and **a gate whose subject is what a generator EMITS
  must read what the generator emits.**
- **Read the existing tests for the records you are writing about**, and **read the context map's
  debt section**, which enumerates every `TODO(…)` in `src/` with the document that owes it — two of
  them now name this item.

---

## 7. Starting the next session

Work on a branch in an existing worktree; nothing in `packages/domain-reference` needs Postgres, and
the owed-closures, context-map, `roleClass` and party rounds all did exactly that at no cost.

**Read before writing anything:**

1. **§1.3 of this file** — the measurements. §1 is a seed and says so.
2. `plans/completed/domain-reference-party-entity.md` — **§2 especially**, the three plan-was-wrong
   findings, and §5 for the residue this item inherits.
3. `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 3** and its **§9 item 1
   annotation**, then **§7.3** and **§3**.
4. `plans/todo/ci-blockers-after-security-backlog.md` — **"Five diagnosis traps"** and **"Do not
   commit these"**, before touching anything.
