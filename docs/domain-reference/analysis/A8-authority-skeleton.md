# A8 (skeleton) — Assertional authority: the per-fact-class role table, and how authority moves at a custody handoff

**Status:** decided, and deliberately partial · **Date:** 2026-09-18 · **Confidence:** see §10
**This document is subordinate to [`00-shared-decisions.md`](00-shared-decisions.md).** Where the
two disagree, the shared layer wins and this document is wrong.

**Why it exists.** Three mechanisms are already shipped in the settled layer and all three consume
_authority_ as an input that does not exist anywhere:

1. **`FactResolved.rule`** ([shared §4.3](00-shared-decisions.md)) — mandatory `{ruleId, ruleVersion}`
   on every resolution. The document that licenses the class of rule "the destination agent's
   arrival beats the driver's app" is this one.
2. **`Correction.authority`** ([shared §6.2](00-shared-decisions.md)) — "names an _instrument_, not
   just a party."
3. **The `UNAUTHORISED` correction outcome** ([shared §6.1](00-shared-decisions.md)) — "the
   declaring party has no authority over this fact class." Undecidable without a table saying which
   party does.

And one scenario is inexpressible without it. [`round-2-critique.md` L112](round-2-critique.md)
records that at a **mid-journey custody handoff** the resolution "degenerates to recency" — which
would let a stale assertion from a party that no longer holds the goods beat the assertion of the
party that does. [`fork-time` §5.5](fork-time-provenance-corrections.md) concedes the point and
caps its own confidence on it; [`A3` §5.2](A3-trip-stop-assignment.md) modelled `Custody` as an
interval and explicitly declined the authority consequence ("Custody _authority_ … is **not settled
here** … the general rule is A8's, which does not exist yet") — _what custody **is** has since been
settled as a **projection** at [shared §4.8](00-shared-decisions.md), and whose assertions win is
still the question below_; [shared §10.4](00-shared-decisions.md)
lists **"Custody authority's owner (conflict #7)"** as the open item that bars three documents from
scoring a dependent decision high.

**This is not all of A8.** It is the two things the blocker needs: the per-fact-class authoritative-role
table (§5) and the handoff rule (§7). The full party model is **not** here. §9 states exactly what
is still owed and what may not be scored until it lands.

---

**Scope rule in force.** Ideal target model, **external sources only**. Our own systems
(`packages/domain`, the Prisma schema, the integration floors, the pegII order shape, the long-haul
app, our integration configs) are `role: mapping-only` in [`registry.yaml`](../sources/registry.yaml)
and are **not evidence**. Partner contracts (`src:weichert-supplier-api`, `src:sirva-ade`,
`src:atlas-world-group-api`) **are** external evidence — they describe how counterparties behave.
**Rubric S5 is withdrawn.** Nothing here is designed for migration from anything we own.

**Disclosure rule.** Every claim either cites a source that says **that** thing, or is marked
**[ORIGINAL]** inline at the point of use. A source that says something narrower than the claim does
not support it. Where two sources each supply half of a shape and the join is mechanical, the mark
is **[SYNTHESIS]**. This area is the one where the corpus is thinnest, so the ORIGINAL density here
is high and is _supposed_ to be — see §10.

**Atlas is blocked and is cited for structure only.** No `Ocp-Apim-Subscription-Key` exists in the
repo; Atlas's operational vocabulary is **not merely unfetched but unpublished**
([`analysis-supplement-vocabulary.md`](../sources/atlas-world-group-api/analysis-supplement-vocabulary.md)
§1, §2.2), and **Atlas A8 C2 is 1**. Every Atlas element below is **column-name evidence**. Note in
particular that `Agent.authority` (`atlasorder-v1.json:7837`) is _literally a column named
"authority" with no code list_ — it is evidence that a field exists, and evidence of nothing else.
**No claim here is scheduled for resolution by fetching Atlas `/Types` endpoints, and none may be.**

---

## 1. What "authority" means here, and what it is not

> **Authority in this document is _assertional_ authority: whose assertion of a given fact class,
> about a given instant, the catalog selects when assertions disagree. It is not liability, not
> payment, not permission to act, and not ownership of the goods.**

The separation is not a nicety. `src:dp3-tender-of-service` §B.3.g makes the TSP **"solely
responsible for the acts and omissions of any third party it contracts with"** (p.19) — so
liability plainly does _not_ move when the goods do. `src:uncefact-rec24` code **41**
`Handed_over_under_continued_responsibility` describes goods handed over while responsibility stays
put (rev3 p.4). If "authority" meant liability, §7's hinge would be backwards. **[ORIGINAL]:** the
term, the narrowing, and the insistence that the four things be kept apart. No source separates
them, because no source models more than one of them.

Three further non-goals, stated so they are not rediscovered:

- **Authority is not a permission system.** A party with no authority over a fact class may still
  assert it; the assertion is recorded ([shared §6.1](00-shared-decisions.md): _every_ correction
  attempt is recorded, there is no refusal path). Authority changes which assertion **wins**, never
  whether one may be made.
- **Authority never makes another assertion false.** See §7.4. This is the single most
  strongly-sourced statement in the document.
- **Authority does not create a party entity.** §9.1.

---

## 2. Naming the roles — the two traps, and which vocabulary this document takes

[`round-1-crosscheck.md`](round-1-crosscheck.md) §A8 and §Contradiction 10 record two corpus
findings that a role table can walk straight into.

**Trap 1 — three sources use "agent" for three different things.**
`src:milmove-mymove`'s `MTOAgent` is a **person** at the residence (`RELEASING_AGENT` /
`RECEIVING_AGENT`, "people, not companies", `pkg/models/mto_agents.go:16-19`);
`src:cfr-49-375` knows only **prime agent** and **emergency or temporary agent** (§375.205(a)(1)-(2)),
where a prime agent acts "for/on behalf of the carrier" under a signed written agreement retained 24
months and is expressly **not** a broker or forwarder; `src:project44`'s `BOOKING_AGENT` is an
**ocean booking office** — the crosscheck calls it "a dangerous false friend."

**Trap 2 — two regulatory sources invert "shipper".** `src:cfr-49-375` §375.103 makes _individual
shipper_ a four-part conjunctive test (named as shipper/consignor/consignee on the face of the BOL,
**and** owns the goods, **and** pays their own tariff charges). `src:dp3-400ng` inverts it: _"In DPS,
the shipper is typically the Government, except for Self-Procured moves"_, and the person whose goods
move is the **customer/owner** (Definitions pp. 11-12). `src:weichert-supplier-api` adds a fourth
reading in which the corporate client account pays, the transferee's goods move, Weichert is the RMC
and our tenant is the "supplier".

**Decisions taken here.**

> **Rule A8-NAME-1. The bare word `agent` is not a role in this model.** Every agent role is
> spelled with its function (`originAgent`, `destinationAgent`, `loadAgent`, `unloadAgent`,
> `sitAgent`, `r19Agent`, `rr19Agent`). **[ORIGINAL]** as a rule; the _need_ is the crosscheck's
> finding, and the _spelling_ is `src:sirva-ade`'s (`Resource.Type`, GSD p.9).

> **Rule A8-NAME-2. The bare word `shipper` is not a role in this model.** It is replaced by two
> separate roles: **`accountParty`** (the party that contracts and pays — the RMC, the corporate
> account, the Government) and **`goodsOwner`** (the transferee/customer whose property moves). The
> _recommendation_ is sourced — `src:dp3-400ng`'s analysis recommends dropping the bare word in
> favour of separate payer/account-party and goods-owner/transferee roles, and the crosscheck
> elevates it. **[ORIGINAL]:** making it a hard rule and fixing the two names.

> **The enum now carries both names, and until catalog `0.7.0` it did not** — `[A8 §9 item 2]`,
> 2026-10-09. `ROLE_NAMES` spelled the second role **`customer`** from publication, so this rule
> fixed a name the model never adopted: **F5's defect with a different word instead of a different
> case**, and F5 is why it is breaking rather than cosmetic (a role name is a fact-key component, so
> two spellings are two fact keys that never pair and never contest). The rename is
> `changedRoleNameSpelling`.
>
> **The evidence is a count in the captured bytes, and it is the rule's own argument applied to the
> replacement name.** `customer` appears **6** times in `src:cfr-49-375` and **never for a party with
> a duty** — a bank's customer inside the `Cashier's check` definition, a subpart heading, a
> complaint-procedure description, and three in Appendix A's plain-English pamphlet — against **189**
> occurrences of the § 375.103 **defined term** `individual shipper`, which carries every signature
> obligation in the part. That definition's axis is **ownership plus payment**: an `Individual
shipper` is named on the bill of lading **and** owns the goods **and** pays his or her own charges,
> while a `Commercial shipper` is named as consignor or consignee, **is not the owner**, and pays for
> the beneficial owner's account. `consignor` and `consignee` appear six times each, only inside
> those two definitions, as **positions on the bill of lading** rather than as roles with duties.
>
> **So `customer` reintroduced exactly the ambiguity this rule exists to abolish**: it is the word
> the industry commonly uses for _whoever pays_, and this model keeps `accountParty` for that party.
> `goodsOwner` is the one of the two names that cannot be read as the payer.
>
> **And the origin/destination question this raises is already answered elsewhere, not by a third
> role.** `src:cfr-49-375` runs **both ends of the same document** through the one term — §375.503(c)
> has the inventory signed at loading, §375.503(d) has "the individual shipper" noting missing
> articles **at delivery**; §7.3 and `HandoverQualifier` carry releasing/receiving as a qualifier
> **`side`**; and `src:milmove-mymove`'s `RELEASING_AGENT`/`RECEIVING_AGENT` is a **permission**
> ("the shipment this agent is permitted to release/receive"), which `[A8 §9 item 3]` measured. A
> `goodsOwnerOrigin`/`goodsOwnerDestination` split would put the handover's side into the role enum —
> two axes in one enum, which is what § 375.205 produces from the other direction (§9 item 2's
> annotation).

**The role vocabulary this document takes is `src:sirva-ade`'s cast**, as
[shared §10.3 item 13](00-shared-decisions.md) already directs:
`Booker` · `OriginAgent` · `DestinationAgent` · `LoadAgent` · `UnloadAgent` · `Hauler` ·
`R19Agent` · `RR19Agent` · `SITAgent` · `Driver` (GSD p.9; SOE p.6), plus `Packer` / `PortHandler` /
`SettlingAgent` / `SetoffAgent` from the settlement view (GSD pp.12-13, 26).

Four roles are **added** here because they assert facts and ADE has no slot for them:

| Added role                                                  | Why it must exist                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Standing of the addition                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`goodsOwner`** (renamed from `customer`, catalog `0.7.0`) | **Re-cited 2026-10-09; two of the four citations this row carried do not contain a signature.** `src:cfr-49-375` requires **mutual** signatures at **§375.503(c)** (the inventory, "signed by **both** you and the individual shipper") and **§375.401(h)** ("**You and the individual shipper must sign the estimate of charges**" — a **money** document, so it reaches §5 row 11 as well), a "signed, dated receipt" at **§375.213(f)(1)**, and writings at §375.503(d) (noting missing or damaged articles **at delivery**), §375.515(b), §375.401(a)(2), §375.201(c), §375.505's Full Value Protection waiver and §375.403/§375.405's new estimates. **Struck:** §375.505(a), which makes the **carrier** "prepare and issue" the bill of lading and lists this party as item (3), a name and address — being named on a document is not signing it; and §375.701, which forbids release-of-liability language on a delivery receipt and **requires no signature at all**. `src:dp3-tender-of-service` requires per-page e-signature and per-line-item exception annotation **before** signing (§C.9.a(4)-(11)) and makes the customer the **asserter** of real-property damage on a 7-day clock (§B.10.e). | Carried from [`fork-time` §5.3](fork-time-provenance-corrections.md), where it is **[ORIGINAL]**. The _obligation to sign_ is sourced **many times over and two of the four citations this row used to give were wrong** (re-cited 2026-10-09, left column); treating the signature as an **assertion by a role** rather than as evidence attached to the carrier's assertion is the authored step. |
| `accountParty`                                              | `src:dp3-400ng` (the Government is the DPS "shipper"); `src:weichert-supplier-api` (the RMC gates our submission with its own rules); `src:dtr-part-iv` PPSO/PPPO/TO as "the government counterparties who approve, pre-approve, dispute and pay".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Sourced that the party exists and decides things; **[ORIGINAL]** that it is one role rather than three.                                                                                                                                                                                                                                                                                             |
| `weighMaster`                                               | `src:cfr-49-375` §375.519(a)(1)-(6): the weight ticket is **signed by the weigh master** and carries scale name and location — a third party at the scale, neither carrier nor customer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Sourced.                                                                                                                                                                                                                                                                                                                                                                                            |
| `platform` (us)                                             | [shared §4.3](00-shared-decisions.md): `FactResolved` is asserted by the platform with `capturedBy = DERIVED_BY_RULE`; [shared §6.6](00-shared-decisions.md): the platform "asserts what it derived, which it plainly has authority to do."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Carried from the shared layer.                                                                                                                                                                                                                                                                                                                                                                      |

**Two vocabularies are refused.**

- **`src:sirva-ade`'s 2-digit `ServiceProviderFunction` codes are not used.** The published table
  **collides**: `06` is both "Origin Agent" and "R19 Agent", `16` is both "Destination Agent" and
  "RR19 Agent" (GSD p.26), and ADE's own analysis flags it as open question 9 ("a typo or a real
  overload?"). A role table keyed on a colliding code is not a table. We take the `Resource.Type`
  strings.
- **`src:stedi-x12-reference` element 98 is not used, and as of 2026-10-06 the reason is what it
  contains rather than that it was unread.** This bullet used to end "**The vocabulary remains unread
  and §9.9 keeps it on the ledger**", and that was the honest state until the list was opened. It is
  now read (`sources/stedi-x12-reference/captured/stedi-element-98-party-roles-notes.md`) and the
  refusal **stands on stronger ground**: element 98 is `Entity Identifier Code`, the identifier
  qualifier on an `N1` loop, and its own definition is _"Code identifying an organizational entity, a
  physical location, property or an individual"_. The rendered list delivers all four kinds in one
  flat, ungrouped table spanning freight, healthcare, mortgage, oil-and-gas and education — so it is
  **not a role vocabulary at all**, and a cast cut out of it would be ours rather than X12's.

  What it does supply is a **cross-walk**, which is this section's cast checked against an industry
  list for the first time. Counterparts exist for `driver` (`D1`), `customer` (`LW`), `loadAgent`
  (`LP Loading Party`), `unloadAgent` (`UP Unloading Party`), `packer` (`X2 Party to Perform
Packaging`), `sitAgent` (`WH` / `8F Bailment Warehouse` / `NS Non-Temporary Storage Facility` /
  `DE Depositor`) and the `accountParty` payer/remitter split. **None exists** for `originAgent`,
  `destinationAgent`, `hauler`, `r19Agent`, `rr19Agent`, `settlingAgent` or `portHandler` — the
  nearest are a drayman, a terminal and a storage facility, which are different parties. Three
  results bear directly on decisions this section took:

  - **Trap 1 is confirmed by the standard.** `booker`'s only neighbour is `OE Booking Office`, which
    is the ocean/forwarding office — exactly the "dangerous false friend" the crosscheck named in
    `src:project44`'s `BOOKING_AGENT`. A role table keyed on element 98 would have walked into it.
  - **Trap 2 is not resolved by the standard.** `SH Shipper` is in the list, bare and with no
    definition sentence, so X12 adds nothing to the §375.103-versus-DPS inversion. **A8-NAME-2 stands
    as [ORIGINAL]** and element 98 is not a citation for it.
  - **`weighMaster` has a near-miss that is instructive.** `R1 Party to Receive Scale Ticket` is the
    ticket's **recipient**; `src:cfr-49-375` §375.519(a) puts the signature on its **author**. Two
    parties at opposite ends of one document, and taking X12's name would have inverted the role.

  And what it still does supply structurally is unchanged: `N1` typed-party loops appear at
  **header, stop, status and carton grain** in both the 204 and the 214 (C6=3) — the industry places
  a role-qualified party at every grain, which is the shape §4 assumes.

---

> **F5, closed — the canonical spelling is lower-camel, and it is case-significant on the wire.**
> This section carries two spellings of one cast: **A8-NAME-1**'s lower-camel rule
> (`originAgent`, `sitAgent`) and `src:sirva-ade`'s capitalised names (`OriginAgent`, `SITAgent` —
> not even a pure case fold). Before **F1** that was a readability wart. After F1 it is a defect:
> `releasing` and `receiving` sit in `handover`'s **qualifier**, [shared §1.3](00-shared-decisions.md)
> derives the fact key from the qualifier, so two spellings of one role are **two fact keys** — two
> facts that never pair and never contest, and unlike H-OCCUR's gap there is no integrity query that
> would notice.
>
> **Decided: A8-NAME-1 wins, because it is a _rule_ and the ADE cast is a _citation_.** The
> capitalised names above stay, as what they are — the **source** of the names and `src:sirva-ade`'s
> own wire spelling, which a mapping will have to fold — and not as a second set of them. Every role
> name in this model is lower-camel, `ROLE_NAMES` in `envelope.ts` is the canonical list, and
> `HandoverQualifier` types both sides as `RoleName` so a capitalised key cannot be constructed.
> §7.6's worked records are corrected to match; they carried the capitalised spelling inside a
> qualifier, which is the defect itself rather than an example of it.
>
> **A role name is case-significant on the wire.** [catalog §2.3] classifies a change of spelling as
> **`changedRoleNameSpelling`** — breaking, a new major — and [catalog §5] records that this catalog
> already publishes the lower-camel enum. So this is not a presentation choice and settling it the
> other way was never free. What [A8 §9 item 2] still owes is the _full_ vocabulary, including the
> roles §2 names but does not define; it no longer owes the spelling.

## 3. Role is not a property of a party — two axes, and a history

Three facts about roles are sourced, and all three constrain the table in §5.

**(a) Role and ownership are orthogonal, and one company may hold two roles on one shipment.**
`src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}` where `Type` is the function on _this_
shipment and `Owner ∈ Corporate | Agent | Vendor` is what kind of party it is — and the GSD p.17
sample proves the same company holds two roles at once (`TIER ONE RELOCATION` is both `Booker` and
`DestinationAgent`, `Owner: Vendor`). The ADE analysis draws the conclusion for us: "our A8 model
should make role an attribute of the _assignment_, never of the party." Grade A, C2=3.

> **Consequence, [ORIGINAL]. Authority attaches to `(role, factClass, interval)`, never to a party.**
> One company can be authoritative for delivery performance and merely corroborating for
> booking-side facts on the same shipment at the same instant, and a single `FactResolved` run over
> two fact classes may legitimately select two assertions from the same legal entity.

> **Rule A8-SELF. A party holding two roles on one shipment does not corroborate itself.** Where the
> authoritative assertion and a corroborating assertion resolve to the same `partyRef`, the
> corroboration is recorded and **must not** be counted as independent. **[ORIGINAL]**, and it is a
> direct consequence of the GSD p.17 sample: a model that counts role-instances rather than parties
> will read one company agreeing with itself as two-party agreement.

> **UNDER-DETERMINED, found by §9 item 3's measurement on 2026-10-09 and recorded rather than
> fixed.** The rule says "one **company**"; the predicate is `!==` over two `PartyId`s; and
> [shared §1.1](00-shared-decisions.md)'s `assertedBy` carries one `PartyId` for all eighteen roles,
> of which `driver` is "the person driving". So a hauler's driver and that same hauler's office pass
> as two independent parties — **this rule's own defect, one level up**. Closing it needs the
> person→organisation link as a reference, and §9 item 3's measurement is that no source publishes
> one: `src:dp3-tender-of-service` has a noun phrase, `src:milmove-mymove` its own schema's FK,
> `src:sirva-ade` a three-valued affiliation class. It is owed to §9 item 3's residue, and it is
> **adjacent to** §9 item 1's hierarchy rather than identical: both want a party-to-party relation,
> but `parentAgentCode` is organisation→organisation and this is person→organisation. Whether one
> fact class covers both is not decided here.

> **And §9 item 3 extended this bullet's rule rather than contradicting it** (2026-10-09): role is an
> attribute of the assignment, and a party's **grain** is likewise a property of what identifies the
> party and of the role it asserts under — never of the party. `AsserterGrainIsNotOnTheEnvelope` is
> the gate. The step past the sourced finding is **[ORIGINAL]**.

**(b) A role assignment is itself an assertion, with its own asserter and its own clock.**
`src:atlas-world-group-api` carries `Agent {code, type, type_name, authority, personnel,
assigned_date, assigned_by, status}` — a role assignment on the order with its own actor and
timestamp (`atlasorder-v1.json:7837`; also `shipment-management-v1.json:1295`), plus temporal
validity on the party record itself (`CompanyModel.effectiveDate`/`expirationDate`,
`AgentSalesPersonModel.effectiveDate`/`expirationDate`). **Structural evidence only** — Atlas C2=1,
`Agent.type`/`type_name`/`authority` have no code list, and roles are modelled twice (typed
`agents[]` _and_ flat `awg_ord_booker`/`awg_ord_origin_agent`/… fields) with the relation
undocumented. Corroborated in a regulation: `src:dp3-400ng` Item 7.1 requires the origin
representative to be named in DPS at acceptance **and updated to the one who will actually service
the shipment** before the pre-move survey — so "who the origin agent is" is a dated, versioned
assertion, exactly as [shared §4.1](00-shared-decisions.md) already classifies it
(`type = partyRole`).

**(c) The current roster is not the role history, and one partner contract says so outright.**
`src:sirva-ade` GSD p.4: if a service provider responsible for a delay "was replaced with another
service provider to provide the missed service (such as hauling) then this service provider will be
referenced in the Agent Summary Chargeback/responsibility and **will not be found in the shipment
Resource group**." `Resources[]` is current state with no history.

> **Rule A8-HISTORY. Authority is computed over the effective-dated role-assignment _history_, never
> over a current roster.** A `partyRole` assertion carries `effectiveFrom`/`effectiveTo` per
> [shared §7.1](00-shared-decisions.md) and is never overwritten. **[ORIGINAL]** as a rule; it is
> forced by (b) + (c) together, and it is what makes §7.4 work — you cannot ask "who was
> authoritative on 3 March" of a roster that has since been rewritten.

---

## 4. The shape: authority is a **function**, not a field

```
AuthorityRule                      (published catalog content, versioned like any rule)
  ruleId, ruleVersion              MANDATORY   ← the thing FactResolved.rule names
  type                             MANDATORY   ← the fact class it governs; one axis, shared §1.3
  authoritative   holder           MANDATORY   ← usually one; two only at a joint instant (§7.3)
  corroborating   holder[]         OPTIONAL
  competing       holder[]         OPTIONAL    ← eligible to win under a named value rule
  advisory        holder[]         OPTIONAL    ← recorded, never selected
  boundBy         CUSTODY | ASSIGNMENT | SCHEME | PRINCIPAL | NONE   MANDATORY  (§4.3)
  tieBreak        ruleId           MANDATORY when `authoritative` can be empty or plural
```

> **All four columns read `roleRef[]` here until §9 item 11 closed (2026-10-10), and the gap between
> that and what §5 actually needed is the whole of that item.** A **holder** is either a named role
> or a **kind** that designates a party the cast cannot enumerate — "the role holding custody at
> that stop", "the issuer of the scheme", "whichever role performed the act being charged for". The
> authoritative column grew kinds early, because four of §5's rows cannot be written without them;
> the other three kept `roleRef[]`, so three cells that needed a kind were written into their row's
> **prose** instead and sat there for five releases. The columns are now uniform, and the one
> asymmetry that remains is deliberate and gated: every authoritative holder is a legal standing
> holder, and not the reverse.

The record is **[ORIGINAL]**. Its two structural precedents are real and are narrower than it:

- `src:dcsa` makes `publisher {partyName, carrierCode, carrierCodeListProvider}` and
  `publisherRole ∈ CA | AG | VSP | SVP` **mandatory on every event** (`event_domain` L1506-1528,
  L2603-2622, L634-639). It records _which role asserted_; **it does not rank them.** DCSA's own
  analysis asks our question and leaves it open — open question 5: _"How many parties can assert the
  same fact, and does `publisherRole` need a [precedence]?"_
- `src:dcsa` constrains **which basis may be asserted, per event type** — and that is as far as the
  captured corpus goes. `event_domain_v3.2.0.yaml` states it three times, in the schema
  descriptions: _"For `ShipmentEvents` the `eventClassifierCode` **must** be `ACT`"_ (**L778**),
  the same for `ReeferEvents` (**L1231**) and `IoTEvents` (**L1328**). Machine-checkable and
  enforced. **Our step:** extending a constraint on _which basis you may assert_ to the _selection_
  of a winner among same-basis assertions — **and additionally moving it from the event-type axis
  onto the role axis**, which is the larger half of the step and is ours.

  > **RE-SOURCED AND NARROWED 2026-10-10. This bullet previously claimed something stronger on bytes
  > that no longer exist anywhere, and the superlative is withdrawn.** It read: _"`src:dcsa` JIT
  > **does** join role to tense, and **it is the only place in the corpus that joins authority to
  > anything**: `EST`/`PLN`/`ACT` may be published only by the Service Provider, `REQ` only by the
  > Consumer (`jit/v2` L3554-3568)."_
  >
  > The cited file was a **bundled** `jit/v2/JIT_v2.0.0.yaml` in `dcsaorg/DCSA-OpenAPI`. That repo
  > **returns 404**; the standard was renamed to DCSA Port Call; the surviving SwaggerHub specs are
  > unbundled and **none contains the per-publisher-role constraint** (`DCSA_JIT` 2.0.0 has no
  > `EST`/`PLN`/`ACT`/`REQ` enum at all). The JIT spec was removed from `captured/` on 2026-09-18
  > by the _capture only what is cited_ trim — **while this bullet was citing it** — and the
  > gitignored full clone did not survive. See
  > `sources/dcsa/captured/swaggerhub-jit-successor/README.md` and `[A8 §10]`.
  >
  > **What changes, precisely.** The corpus **does** join tense to **event type**, on captured bytes,
  > and the sentence above now says only that. It does **not**, as captured, join tense to **role** —
  > so "the only place in the corpus that joins authority to anything" is **false as stated** and is
  > deleted rather than softened. The claim is not asserted to be wrong about DCSA; it is
  > **unverifiable**, which under `[SD §0]`'s disclosure rule cannot support a precedent. The
  > `publisherRole` bullet above is unaffected — its citations are to `event_domain`, which **is**
  > captured, and it already says DCSA "does not rank them".

### 4.1 The four standings

| Standing          | Definition                                                                                          | Effect on `FactResolved`                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Authoritative** | The rule selects this role's assertion by default for this `factClass` at this instant.             | `selected`, absent a named value rule that overrides (§5, `weight.net`).                               |
| **Corroborating** | A non-authoritative assertion that **agrees**.                                                      | Appears in `considered[]`. Changes no answer. **Its absence is not evidence of anything** — see below. |
| **Competing**     | A non-authoritative assertion that **disagrees** and is _eligible to win_ under a named value rule. | Appears in `considered[]` and may be `selected` **only** by a published rule that says so.             |
| **Advisory**      | A role that can never win for this fact class.                                                      | Appears in `considered[]`, never `selected`.                                                           |

Three notes, each carrying its mark:

1. **"Absence of corroboration is not evidence" is [ORIGINAL] and is a guardrail, not a nicety.**
   `src:dp3-tender-of-service` §C.9.a(24) supplies the domain instinct from the other direction: _"a
   signed bingo card or check-off sheet does not indicate proof of delivery and lost, missing or
   damaged items will still be indicated on the appropriate loss or damage forms."_ A record that
   _looks_ like confirmation is not confirmation. We generalise: silence from a corroborating role
   must never lower the confidence of the authoritative assertion, because most of these roles have
   no obligation to speak.
2. **`advisory` has one clean published precedent.** `src:dcsa`'s `publisherRole` separates the
   principals (`CA` Carrier, `AG` Carrier local agent) from the service providers (`VSP` Visibility
   Service Provider, `SVP` any other service provider) — the corpus does distinguish a publisher who
   _is_ the principal from one who merely observes. DCSA assigns no precedence; the tiering is ours.
   Our own `platform` role and any telemetry vendor sit here for possession-changing facts, which is
   also where [shared §5 M2](00-shared-decisions.md) already puts them by a different route.
3. **`competing` is sourced, and it is the most important of the four.** See §5's `weight.net` row
   and §7.3.

### 4.2 The one rule that closes the blocker

> **Rule A8-INSTANT. A role's standing for a fact is determined by the instant the fact is _about_ —
> its `occurredAt` / the instant its `value` describes — and never by `assertedAt` or `recordedAt`.**

**[ORIGINAL], and it is the whole answer to "degenerates to recency."** Everything else in §7 is a
consequence of it. Under A8-INSTANT:

- The origin agent's assertion about the **load** stays authoritative forever, even if it is keyed a
  week after the goods left its custody.
- The origin agent's assertion about the **delivery** is non-authoritative from the moment it is
  made, however recent — because the delivery's instant falls after the handoff, and the origin
  agent never held authority over that instant.

So there is nothing to "downgrade" at a handoff and nothing to expire. A party's standing over an
instant is fixed by the custody history over that instant — and custody history is not a stored
timeline. It is the fold **`custodyAt(goods, instant)`** ([shared §4.8.3](00-shared-decisions.md))
over the `FactResolved`-selected `handover` assertions and over `ExternallyPerformedLeg.custodyBasis`.
The fold is **recomputed**, never overwritten; what is append-only is the underlying `handover`
assertions, which is where the guarantee actually lives.

The distinction A8-INSTANT rests on is not ours: `src:shippeo` publishes `situation.date` ("the
datetime at which the event **happened**") against `situation.input_date` ("the datetime at which the
event was **recorded**") with the worked example "the driver recorded at 3.30pm that he delivered the
goods at 3pm", and [shared §4.2](00-shared-decisions.md) already carries the three clocks. **What is
ours is keying authority to the first clock rather than the second.** `src:sirva-ade` is the live
counter-example that makes the risk concrete: its event `DateTime` "indicates when event was
**recorded**" (SOE p.2) and there is no occurred-at anywhere in the operational payload — so a
consumer that keyed authority on the wire clock would be keying it on the wrong one for the partner
contract we actually carry.

### 4.3 What authority is bound to — `boundBy`

| `boundBy`    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Which fact classes                                                                                                                                                | Source for the binding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CUSTODY`    | Authority follows **`custodyAt(goods, instant)`** ([shared §4.8.3](00-shared-decisions.md)) — the named, versioned fold over the `FactResolved`-selected `handover` assertions and over `ExternallyPerformedLeg.custodyBasis` — evaluated at the instant the fact is _about_ (A8-INSTANT) and moving at the selected **`RECEIPT`**'s `occurredAt` on that receipt's `custodyBasis` (**A8-MOVE as amended**, §7.1). There is no stored `Custody` entity. Across a **C5** transfer gap the fold returns `UNKNOWN` and the **releasing** role stays authoritative, so a gap is a custody `UNKNOWN` and not an authority vacuum.                                                                                                                                                                                                                                                                                                                                                                                                                    | arrival, departure, load/unload performance, delivery performance, condition, SIT entry inputs, SIT release                                                       | §7; [shared §4.8](00-shared-decisions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `ASSIGNMENT` | Authority follows an `Assignment`'s effective interval, not custody.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | facts about a resource (which driver, which trailer)                                                                                                              | `A3` §6.1 (an `Assignment` has an effective interval)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `SCHEME`     | Authority belongs to the **issuer** of the naming scheme and never moves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | identity                                                                                                                                                          | [shared §7.1](00-shared-decisions.md): `issuer` is "the PARTY that assigned this value under that scheme"                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PRINCIPAL`  | Authority belongs to the party the arrangement is _for_, and moves only when the principal changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | charge, and the depositor case in §7.5                                                                                                                            | `src:dp3-400ng` Item 17-2.5 (§7.5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NONE`       | No role is authoritative; the value is settled by a named value rule or a derivation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | weight.net, SIT entry (the derived date itself)                                                                                                                   | [shared §4.4](00-shared-decisions.md), [§5 M4](00-shared-decisions.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `KEY`        | Authority belongs to the role the fact's own **`qualifier`** names — **A8-KEY**. Exactly one role, computed from the record, so `authoritative` is neither empty nor plural and A8-NAMED never fires; there is no value rule to name, which is why this is a sixth member and not `NONE` plus a tie-break. It breaks **F3**'s circle because it reads the **key**, fixed when the record was minted, and not `custodyAt` — the fold that consumes the answer. **The general principle it is the first instance of:** an act that **mints** the thing a binding follows can never be bound to that thing. `handover` mints custody, so it cannot be `CUSTODY`; `assignmentOffer` mints the assignment, so it cannot be `ASSIGNMENT`; `orderAward` mints the principal relation, so it cannot be `PRINCIPAL`. `KEY` rescues `handover` alone, because it is the only one of them whose **qualifier** names its actor — the other nine name theirs in `context[]`, and [shared §1.4](00-shared-decisions.md) forbids resolution from reading that. | handover (§5 row 12)                                                                                                                                              | `src:stedi-x12-reference`'s interline pair `J1`/`R1`, issued from opposite sides. **[SYNTHESIS]** — the arrangement is stedi's, binding authority to it is ours                                                                                                                                                                                                                                                                                                                                                                                  |
| `AWARD`      | Authority belongs to the role **the order's own award resolved** — the **offeree**, "whoever the award named". Exactly one role, resolved from a published record of the same aggregate, so `authoritative` is neither empty nor plural and **A8-NAMED never fires**. **Resolved, not read off `context[]`**: the path is `subject = order:X` → that order's `orderAward`, the way `ASSIGNMENT` resolves through an `Assignment`, which is why [shared §1.4](00-shared-decisions.md) rule 1 is not engaged — the objection §9 item 8(b) raised against `KEY` here. An act that **mints** the award cannot be bound to it, so `orderAward` is not this.                                                                                                                                                                                                                                                                                                                                                                                          | `orderResponse` (§5 row 18); `orderCancellation`’s **binding**, with its holder still owed; [`A2` §3.6](A2-shipment-structure.md)'s `shipmentCommitment` likewise | **[SYNTHESIS]** on [`A1` §Cross-area](A1-order-service-lifecycle.md)(b)-(c): _"the authoritative role is resolved by the order's own award … structurally the same binding as `ASSIGNMENT` one aggregate over, and A8 has no member for it"_. The **actors** are sourced — `src:dtr-part-iv` A-402 §C.4.a, §F.2.a; `src:dp3-tender-of-service` §B.18.a; `src:milmove-mymove`; `src:atlas-world-group-api`’s `accepted_by` — and converting a recording duty into assertional authority is authored, as §10 records it is for rows 1-5, 8 and 11. |

### 4.4 No silent recency

> **Rule A8-NAMED. Where `authoritative` is empty or plural for a contested fact, `FactResolved`
> MUST name a tie-break rule. `RECENCY` is a legal `ruleId` only where the catalog has published it
> for that specific fact class. A resolution may never fall back to "latest wins" implicitly.**

**[ORIGINAL]** as a rule; the _rejection of implicit last-writer-wins_ is already settled and sourced
at [shared §4.3](00-shared-decisions.md) — `src:gtfs`'s `FULL_DATASET` "will overwrite all preceding
realtime information", defensible there only because GTFS has one publisher by construction. A8-NAMED
is what stops that property leaking back in through an unpopulated authority table. It also means the
gap this document does _not_ close (§9) is **visible in the data**: an unresolved fact class produces
a resolution naming a tie-break rule, not a silently-plausible answer.

---

## 5. The per-fact-class authoritative-role table

Read with three caveats. **(i)** The canonical `subject` per fact class is declared by **E-CANON**
([shared §4.3](00-shared-decisions.md)), and the declaration itself is
[**shared §4.7**](00-shared-decisions.md)'s canonical-subject table — **not here** and not A3/A4. What
E-CANON declares is a **family**, a named closed set of `aggregate` kinds, so the column below names
the family, quoted from §4.7. Every row is now declared there; nothing in this column is assumed.
**(ii)** Roles are `src:sirva-ade`'s spellings plus §2's four additions. **(iii)** Every row's
authority is `boundBy = CUSTODY` unless the row says otherwise — so every row is also a §7 row.
**(iv)** The `handover` row is **row 12**, and it is the one row whose `boundBy` is neither `CUSTODY` nor any of §4.3's original five. It may not be `CUSTODY`: that is the circularity [shared §4.8.2](00-shared-decisions.md) refuses, and it became load-bearing when `handover` took a qualifier, because the fold now selects among a contested pair. **A8-KEY** reads the qualifier instead — the role named on the key's own `side`, which is `src:stedi-x12-reference`'s own arrangement (only the releasing carrier issues `J1`; only the receiving carrier issues `R1`) and breaks the circle because it reads the **key**, not the fold. Recorded as **F3**, now closed.
**(v)** Rows **13-16** close four more of §9 item 8's owed rows — `weight.gross`, `weight.tare`, `packing` and `pieceCount`. They are the four the corpus supports; §9 item 8 now says which of the rest it does **not**.
**(vi)** Row **17** closes `documentIssuance`, and it is the one row in this table whose blocker was **minting alone** — §9 item 8(e)'s fourth category, which asked this document to accept a reading rather than to research one. It inherits row 10's binding and row 10's `ruleId`; it mints neither.
**(vii)** Row **18** closes `orderResponse` on §4.3's new `AWARD` member and **A8-AWARD**. It closes **one** of the three order rows, not three: §9 item 8(b-i) expected two, and [`A1` §3.5](A1-order-service-lifecycle.md)'s own permission table is why it is one — see §9 item 8(b-i) as corrected.
**(viii)** **Three cells in the three right-hand standing columns name a party by its RELATION to the fact rather than by a role**, and since §9 item 11 closed (2026-10-10) they are carried as holder **kinds** rather than as a sentence in the row's prose: rows 10 and 17 corroborating (_"the counterparty echoing the value back"_ and _"the party the instrument is issued **to**"_ — **one** relation, `schemeCounterparty`), and row 11 competing (_"the performing role, on quantum"_, the kind that row's own `PROPOSED` aspect already held). **The readings below are unchanged** — what changed is that the model can hold them, so none of the three depends on a role vocabulary and none is owed. Rows 8's corroborating and 9's advisory are **complements** and need nothing ([§4.1](#41-the-four-standings) note 1); row 8's **warehouseman** and row 11's **`RATED`** tariff owner are still owed to §9 item 2, both on `secondary` grade.

| #   | `type` (= `factClass`, [shared §1.3](00-shared-decisions.md))                           | Canonical subject **family** ([shared §4.7](00-shared-decisions.md))                                                      | **Authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                                       | Corroborating                                                                                                                                                                                                                                 | Competing                                                                                                                                                                                                                                                                                                                                            | Advisory                                                                                                      | Evidence, and what is authored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`arrival`**                                                                           | **`stop`** = {stop, externallyPerformedLeg}                                                                               | The role holding custody at that stop — `Driver` where the stop is on our trip; `Hauler` where the trip is the hauling agent's; the leg's `authoritativeAsserter` on an `ExternallyPerformedLeg` (shared §8.2)                                                                                                                                                                                                                                          | `OriginAgent`/`DestinationAgent` at their own end; `customer`                                                                                                                                                                                 | `DestinationAgent` at destination (see note)                                                                                                                                                                                                                                                                                                         | `Booker`; `platform`; visibility providers (`src:dcsa` `VSP`/`SVP`)                                           | **Sourced:** `src:dp3-tender-of-service` #14 and #20 place the arrival-recording _duty_ on the party performing (arrival/departure at any in-transit facility, storage facility, POE or POD → notify within 3 GBD of pickup or 1 GBD of any change, §C.3.b p.34; "record arrival and/or delivery in DPS", §C.3.a p.34). **[ORIGINAL]:** converting a recording duty into assertional authority. Note the deliberate `competing` entry — the critique's own example is the destination agent's shipment-level claim against the driver's stop-level claim; both are real and E-CANON is what makes them pair.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2   | **`departure`**                                                                         | **`stop`**                                                                                                                | as #1                                                                                                                                                                                                                                                                                                                                                                                                                                                   | as #1                                                                                                                                                                                                                                         | as #1                                                                                                                                                                                                                                                                                                                                                | as #1                                                                                                         | As #1. `src:dp3-tender-of-service` #10 additionally requires the **legal name and US DOT number of the service provider actually hauling** in DPS within 2 GBD of origin departure (§B.3.f p.19) — so at departure the performing party must be _nameable_, which is the precondition for this row to be computable at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | **`loading`** _(load performance; act record, shared §2)_                               | **`goods`** = {shipment, portion}; `context[]` = `stopAction`, `stop`, `trip`                                             | `LoadAgent`; `OriginAgent` where no separate load agent is assigned (`src:sirva-ade` carries both types, GSD p.9)                                                                                                                                                                                                                                                                                                                                       | `Driver`; `customer`                                                                                                                                                                                                                          | `customer`, for the _scope_ of what was loaded (short/refused)                                                                                                                                                                                                                                                                                       | `Booker`; `DestinationAgent`; `platform`                                                                      | **Sourced:** `src:dp3-400ng` Item 7.1 makes the origin representative a named, updatable party of record at origin; `src:dp3-tender-of-service` §B.20 requires the **actual** servicing rep. **[ORIGINAL]:** the role split. The `customer`-as-competing entry is sourced by `src:cfr-49-375` §375.503 + §375.605(b) (customer notations on the inventory) and DP3 ToS §C.9.a(4)-(11) (per-line-item exception annotation before signing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4   | **`unloading`** _(unload performance)_                                                  | **`goods`**; `context[]` = `stopAction`, `stop`, `trip`                                                                   | `UnloadAgent`; `DestinationAgent` where none is separately assigned                                                                                                                                                                                                                                                                                                                                                                                     | `Driver`; `customer`                                                                                                                                                                                                                          | `customer`                                                                                                                                                                                                                                                                                                                                           | `Booker`; `OriginAgent`; `platform`                                                                           | Mirror of #3, same sources. The mirror itself is **[ORIGINAL]**; ADE supplies `LoadAgent` and `UnloadAgent` as distinct types (GSD p.9) but states no authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5   | **`delivery`** _(delivery performance)_                                                 | **`goods`**; `context[]` = `stop` **or** `externallyPerformedLeg`, `trip`                                                 | `DestinationAgent`; the leg's `authoritativeAsserter` where delivery is externally performed (shared §8.2); `RR19Agent` under a Reverse Rule 19                                                                                                                                                                                                                                                                                                         | `Driver`; `Hauler`                                                                                                                                                                                                                            | **`goodsOwner`** — see the joint-signature note in §7.3                                                                                                                                                                                                                                                                                              | `Booker`; `OriginAgent`; `platform`                                                                           | **Sourced, and RE-CITED 2026-10-09 because its first citation was wrong.** This column used to open _"`src:cfr-49-375` §375.701 — the **delivery receipt is signed by the shipper**"_, and §375.701 says no such thing: its heading is _"May I provide for a release of liability on my delivery receipt?"_, it forbids release-of-liability language, permits an "apparent good condition" note, and **requires no signature at all**. The real mutual signatures are **§375.503(c)** (the inventory, "signed by **both** you and the individual shipper") and **§375.401(h)** ("You and the individual shipper must sign the estimate of charges"), plus §375.503(d)'s writing **at delivery** — "the opportunity to note in writing any missing articles and the condition of any damaged or destroyed articles", which is this row's fact class exactly; `src:dp3-tender-of-service` §C.17.a — the DP3 Notification of Loss or Damage AT DELIVERY is "**jointly signed** by my representative and the customer or their authorized agent"; §C.9.a(24) — a signed check-off sheet is _not_ proof of delivery. `src:sirva-ade` carries exactly one human-attestation field, `ProofOfDeliveryName`, "name of person receiving shipment at destination" (SOE p.5). **[ORIGINAL]:** placing `goodsOwner` (renamed from `customer` at catalog `0.7.0`) in `competing` rather than `corroborating` — three sources make the goods owner's signature constitutive, not decorative.                                                                                                                                                                                                                                  |
| 6   | **`weight.net`**                                                                        | **`goods`**                                                                                                               | **`boundBy = NONE` — no role is authoritative.**                                                                                                                                                                                                                                                                                                                                                                                                        | `weighMaster` supplies the evidence, not the assertion                                                                                                                                                                                        | `Hauler`/`OriginAgent` (the weighing) **and** `customer`/`accountParty` (the reweigh)                                                                                                                                                                                                                                                                | `platform`; `Booker`                                                                                          | **The most strongly-sourced row, and the one that proves authority and value-rules are two mechanisms.** [Shared §4.4](00-shared-decisions.md)'s **`R-WEIGHT-LOWER`** already settles the value: `src:dp3-400ng` Item 4 Note 2, "if duplicates occur, DPS must be updated with the **lower** of the net reweigh weights", corroborated at Item 4.11.d and Items 4.9.h-i. The _right to contest_ is held by the other side: `src:cfr-49-375` §375.517 gives the **shipper** the reweigh demand (before unloading begins; the freight bill must then be based on the reweigh weight), §375.515(a)-(b) makes non-observation a presumed waiver but requires a **written** waiver to give up observing a *re*weighing, and §375.519 puts the signature on the **weigh master**. `src:dtr-part-iv` §D.7.a(4) requires interested parties be given "reasonable opportunity… to be present" at a reweigh; `src:dp3-tender-of-service` #11/#15/#16 puts the weigh-and-enter duty on the TSP _expressly_ "to allow the customer or PPSO the opportunity to request a reweight", and #15 requires a **supplemental invoice refunding the difference** if already invoiced. **Authored:** nothing. This row is a citation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | **`sitEntryDate`** _(SIT entry date; distinct from the **`storeIn`** act, shared §5.3)_ | **`stay`**                                                                                                                | **`boundBy = NONE`** — the value is **derived and the derivation is mandatory**, per [shared §5 M4](00-shared-decisions.md). Authority applies only to the **input**, the _first available delivery date_, which is the **`Hauler`/`DestinationAgent`'s** (whichever holds the BL duty)                                                                                                                                                                 | `SITAgent` (handling-in); `accountParty` (approval)                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                    | `platform` (may assert only the derived value, §6.6)                                                          | **Sourced twice, from opposite directions:** `src:dp3-400ng` Items 29.4, 29.6, 17.20 — "SIT in date will be equal to the TSP's **first available delivery date**", "always… not the date of notification", and "the arrival date must **NOT** be entered as the SIT entry date"; `src:dtr-part-iv` §D.5.b(2) NOTE p.18 — SIT is effective "the date the shipment was **offered for delivery**, not the date it arrived." **Consequence, [ORIGINAL] but forced:** because M4 already makes the derivation mandatory, a role table that made anyone authoritative _for the date itself_ would contradict the shared layer. This row is the one where the right answer is "nobody".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 8   | **`storeOut`** _(SIT release / handling-out)_                                           | **`stay`**                                                                                                                | `SITAgent` / the warehouseman holding the goods                                                                                                                                                                                                                                                                                                                                                                                                         | `Hauler` collecting; `DestinationAgent`                                                                                                                                                                                                       | `Hauler` collecting (see §7.3 — this is a handoff, so the exception-sheet rule applies)                                                                                                                                                                                                                                                              | `Booker`; `platform`                                                                                          | **Sourced:** `src:dp3-tender-of-service` #28 puts handling-in on the **warehouseman** (COB the third GBD after SIT approval, §C.14.b p.45); NTS §1.8.1 puts handling-out on the NTS TSP with **5 GBD advance notice from the Government**; NTS §5.8.2 is decisive on the collecting carrier — when the line-haul carrier fails to collect a lot, the **NTS TSP** notifies the TO by the following business day and the **DD 1164 is amended to document the carrier's failure as the cause**, set off against that carrier's BL. The warehouse is the party of record for what happened in the warehouse. `src:dtr-part-iv` corroborates from the identity side: the **lot number is supplied by the warehouseman, not the Government**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | **`condition`** _(per article)_                                                         | **`item`** _(singleton — one value **per article**, shared §5.4; shared §5 M6(a): "per-item against a signed inventory")_ | **Jointly held and deliberately plural** — the party releasing and the party receiving, at each custody boundary                                                                                                                                                                                                                                                                                                                                        | the non-inspecting parties                                                                                                                                                                                                                    | each other (this is the `competing` case by construction)                                                                                                                                                                                                                                                                                            | `platform`; `Booker`                                                                                          | **The best-sourced row in the document, and §7.3's foundation.** `src:dp3-400ng` Item 17.12.c — **both** TSP and warehouseman must hold "the condition of **each article** when received at and forwarded from the storage location." `src:cfr-49-375` §375.503 — itemized inventory with per-article ids and condition, signed by both. `src:dp3-tender-of-service` NTS §1.6.2 — condition **by omission**, with the burden assigned ("failure of electronic items will be assumed to be transit related") and an escape code that still does not bar a claim; §C.9.a(22) — describing cartons as "misc." **waives the right to contest** related claims. And NTS §1.6.10 — §7.3's sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | **`identity`**                                                                          | **every `aggregate` kind** (shared §7.1); `qualifier` **`{scheme, vocabularyScope}`** — the I-KEY tuple                   | **`boundBy = SCHEME`.** The **`issuer`** of the scheme, and nobody else, for the value under that scheme. Authority **never moves.**                                                                                                                                                                                                                                                                                                                    | the counterparty echoing the value back                                                                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                    | everyone else                                                                                                 | **Sourced, and the shared layer already carries the field:** [shared §7.1](00-shared-decisions.md) defines `issuer` as "the PARTY that assigned this value under that scheme" and `scheme` as "the naming system, which DEFINES who assigns and what it identifies". `src:dcsa` supplies the pattern outright — a party is `carrierCode` + `carrierCodeListProvider`, i.e. **code plus the authority that issued it** — and states the echo-back obligation ("carriers share it back when providing track and trace event updates"). `src:sirva-ade` performs the echo (`ExternalReference` = "Agent's internal lead reference", LEP p.3). **The practical consequence** is the one the ADE analysis names: SIRVA's `Brand+RegNumber+RegYear` and Weichert's `serviceOrderNumber` are **peer references, neither authoritative over the other**, because they are values under two different schemes with two different issuers. `src:dtr-part-iv` supplies the counter-case that proves the rule has teeth: the **BL number is serially pre-assigned accountable stock**, audited every 180 days — one issuer, and a laser-generated BL "is only accountable when a number has been assigned to the form." Note that an issuer's _responsibility_ can be reassigned with an effective date (`src:dp3-400ng` GBLOC, Regionalization p.17), which is why §7.1's interval carries it, not a static field.                                                                                                                                                                                                                                                                                                         |
| 11  | **`charge`**                                                                            | **`charge`** (shared §1.2); `qualifier` **`{aspect}`** ∈ `PROPOSED` \| `DECIDED` \| `RATED` (shared §4.7.2b)              | **`boundBy = PRINCIPAL`, and it is a two-sided pair, not one role — resolved across three fact keys, not one.** **Proposal** authority (`aspect = PROPOSED`): the performing role. **Decision** authority (`aspect = DECIDED`): the `accountParty`. **Rating** authority (`aspect = RATED`): the tariff owner (the van line / the party whose tariff prices it).                                                                                        | `SettlingAgent`, `SetoffAgent`                                                                                                                                                                                                                | the performing role, on quantum                                                                                                                                                                                                                                                                                                                      | `platform`                                                                                                    | **Sourced three ways.** _Who asserted each number:_ `src:milmove-mymove` tags every priced input with its origin — `PaymentServiceItemParam.origin ∈ PRIME                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | SYSTEM | PRICER | PAYMENT_REQUEST`— "i.e. *who asserted this number*", and nothing is billable "unless a matching service item was created and **approved**". *The propose/decide split:*`src:dtr-part-iv`models accessorial **pre-approval as a typed record** with states Pending → Approved/Denied and a 3-GBD PPSO SLA, then a reconciliation flagging each submitted service pre-approved or pre-denied (§C.8, §D.6);`src:milmove-mymove`carries the same shape with **both narratives attributed** —`contractorRemarks`on the request,`officeRemarks` on the decision — and an auto-approve threshold (`ShipmentAddressUpdate`is auto-approved *unless* it crosses a pricing boundary). *Rating is the tariff owner's:*`src:sirva-ade`computes charges only "when Rating to calculate charges has completed successfully" (GSD p.3), typically post-delivery, and the agent's only write channels are`AddDocument`and`AddOpportunity`. **And the correction regime is already settled against role:** [shared §6.3](00-shared-decisions.md) — financial facts are corrected **only by an offsetting record**, never by retraction (`src:sirva-ade` `AdjCode` Original/`ADJ`/`CAN`with the zero-out invariant, ABS p.3;`src:dp3-400ng`Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c). **[ORIGINAL]:** naming the three-way split (propose / decide / rate) as three authorities. No source names all three. **Corrected by [shared §4.7.2b](00-shared-decisions.md):** they are not three authorities contesting *one* fact key. Under the derived key`(subject, type, qualifier?)`that would put a proposal, an approval and a price into one contest, where an approval would compete with an amount. The`{aspect}` qualifier makes them **three fact keys**, each with the authority this row already assigns. The three-way split is the finding and does not otherwise change. |
| 12  | **`handover`** _(the custody transfer itself; act record)_                              | **`goods`**; `qualifier` **`{releasing, receiving, side, occurrence?}`** (shared §4.7.2f)                                 | **`boundBy = KEY`, and the member is new.** The role the fact's own **qualifier** names — the releasing role for a `RELEASE` key, the receiving role for a `RECEIPT` key (**A8-KEY**). **Exactly one**, so A8-NAMED never fires and the row names no tie-break.                                                                                                                                                                                         | the roles on the other side of the same transfer — `OriginAgent`, `DestinationAgent`, `SITAgent` at their own end                                                                                                                             | the role named on the **other** side of the same transfer. It may assert the same key and is recorded in `considered[]`; it is never selected.                                                                                                                                                                                                       | `Booker`; `platform` — a geofence may witness a departure, never a change of responsibility (shared §5 M2/M3) | **F3, closed.** §4.7.1 gave this row `CUSTODY` while shared §4.8.2 said of the identical shape that "that row's binding would be `CUSTODY`, so **A8-MOVE would be defined in terms of the thing it defines**" — two published sentences contradicting each other, made load-bearing by **F1**, which gave `handover` a qualifier so the fold now selects among a contested pair. `KEY` resolves it by reading the **key**, fixed at mint time, rather than the fold that consumes the answer. **Sourced:** `src:stedi-x12-reference` issues the interline pair from opposite sides — only the releasing carrier issues `J1`, only the receiving carrier issues `R1` — so _which side may speak_ is already a property of the code in the source. **[SYNTHESIS]:** binding authority to it, and therefore adding a sixth `boundBy`, is ours. Confidence **medium**: stedi sources the arrangement, not the ranking, and no source in the corpus ranks two assertions about one transfer because none models a contest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 13  | **`weight.gross`**                                                                      | **`goods`**; `context[]` = `document` (the ticket), `resource` (the vehicle weighed), `stop`                              | The party that **performed the weighing**, which is the party holding the goods at the scale — `custodyAt(goods, instant)` at the instant of the weighing (**A8-INSTANT**), so `Hauler` or `OriginAgent` as the fold answers.                                                                                                                                                                                                                           | `weighMaster` — it supplies the **evidence**, not the assertion: `src:cfr-49-375` §375.519(a)(1)-(6) puts the signature, the scale name and the scale location on the weigh master. As row 6.                                                 | `customer` / `accountParty` — the **reweigh right**, and it is the shipper's: §375.517 gives the reweigh demand before unloading begins and requires the freight bill to be based on the reweigh weight.                                                                                                                                             | `Booker`; `platform`                                                                                          | **Owed by a ledger that did not list it** — §9 item 8 names neither gross nor tare — and closed here. The row exists because row 6 is `NONE` for a reason that does not reach these two: `R-WEIGHT-LOWER` picks the **net** regardless of who asserted it, which says nothing about who may assert an **input**. Reading row 6 as though it did is what left these cells blank. **Evidence** is row 6's, which §10 calls "a citation": §375.517, §375.515(a)-(b) (non-observation is a presumed waiver; giving up observing a *re*weighing needs a **written** waiver), §375.519; `src:dtr-part-iv` §D.7.a(4); `src:dp3-tender-of-service` #11/#15/#16 (the weigh-and-enter duty is the TSP's, expressly "to allow the customer or PPSO the opportunity to request a reweight"); `src:dp3-400ng` Item 4. **[SYNTHESIS]:** separating input authority from row 6's value rule. Confidence **medium**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | **`weight.tare`**                                                                       | **`goods`**                                                                                                               | as #13 — `sameAs` row 13                                                                                                                                                                                                                                                                                                                                                                                                                                | as #13                                                                                                                                                                                                                                        | as #13                                                                                                                                                                                                                                                                                                                                               | as #13                                                                                                        | §4.7.1 states this row as "as `weight.gross`", and nothing in the sources separates them: the same weighing, the same scale, the same ticket. Two rows rather than one because §4.7.1 declares two **types**, and collapsing them here would make the table disagree with the vocabulary; `sameAs` is how the table says "this row is that row" without duplicating it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 15  | **`packing`** _(pack performance; act record)_                                          | **`goods`**; `context[]` = `stopAction`, `stop`                                                                           | `Packer`; `OriginAgent` where no separate packer is resourced (`src:sirva-ade` resources a `Packer`, GSD pp.12-13). Mutually exclusive circumstances, not a contest — so not plural.                                                                                                                                                                                                                                                                    | `customer`, `DestinationAgent` — the customer observes the pack, the destination agent sees the result. Neither has an obligation to speak, so silence is not evidence (§4.1 note 1).                                                         | `customer`, on **scope** and not on performance: `src:cfr-49-375` §375.503(a) requires an itemized inventory identifying "every carton and every uncartoned item" with a number physically on each article, prepared with the shipper given the opportunity to observe and verify, and §375.503(d) the same opportunity at delivery, **in writing**. | `Booker`, `Hauler`; `platform` (M2/M3 forbid a machine asserting any act in this family)                      | **§9 item 8 named "packing performance" as uncovered.** Covered now, as the **mirror of row 3** — and the mirror is the authored step (**[SYNTHESIS]**), exactly as row 4 is the authored mirror of row 3. The roles and the shipper's contest right are citations; no source states an authority ranking for packing any more than for loading. `src:dp3-400ng` Item 17.12.c reaches the cartons the pack produced. Confidence **medium**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 16  | **`pieceCount`**                                                                        | **`goods`**; `qualifier` **`{unitization}`**                                                                              | **Away from a custody boundary** — the half §4.7.1 left owed — the party **holding the goods** at the instant counted (`custodyAt`, A8-INSTANT). **At a boundary** it is row 9's: jointly held, releasing **and** receiving, `selected[]` may be empty, because **A8-JOINT** reaches "`condition` **and the counts asserted with it**". One type, two standings, split by whether the instant is a boundary — and the split is A8-INSTANT's to compute. | `customer`, `OriginAgent`, `DestinationAgent` — whoever else was present; §375.503 gives the shipper the opportunity to verify at both ends.                                                                                                  | `customer` / `accountParty` — a count is what a shortage claim is built on, and §375.503(d) gives the right to note missing articles **in writing** and receive a copy of the notations. [A4 §3]'s `GOODS_MISSING` is the reason code that records the disagreement.                                                                                 | `Booker`; `platform`                                                                                          | The row was **conditional**, not owed: §4.7.1 already answered the boundary case through A8-JOINT and left the rest open. Closed at **medium**. Every published counting duty falls on the holder — §375.503(a)'s per-article numbering, and `src:dp3-400ng` Item 17.13's partial SIT withdrawal identified by **inventory item numbers** with the TSP obtaining the actual weight of the portion. **[SYNTHESIS]:** splitting one type's standing by whether the instant is a boundary, which is the shape A8-INSTANT already requires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 17  | **`documentIssuance`** _(the act that brings a document into existence; act record)_    | **`document`** = {document} (shared §1.2), a singleton; `qualifier` —                                                     | **`boundBy = SCHEME`.** The **`issuer`** of the document's own number scheme, and nobody else. Authority **never moves** — row 10's binding, inherited rather than re-argued, because [`A6` §3.2(b)](A6-documents-evidence.md) establishes that for the one document kind in the corpus with a scheme of its own the party controlling the number scheme **is** the party issuing the instrument.                                                       | the party the instrument is issued **to**, echoing its number back — `src:nmfta-ebol` returns an acceptance identifier distinct from the document identifier, which is row 10's echo one aggregate over                                       | — (under one scheme there is one issuer; a carrier BL and a GBL covering one shipment are two documents under two schemes, so two facts on two keys and not a contest on one)                                                                                                                                                                        | `Booker`; `platform`                                                                                          | **§9 item 8(e) asked this document to accept a reading rather than to research one, and this row is that acceptance.** It is the first owed row closed on **minting alone**: nothing was owed underneath it, because row 10 determined its holder before the fact class existed. **Sourced** for the act: `src:cfr-49-375` §375.505(a), _"you must prepare and **issue** a bill of lading"_ (primary), with §375.103 defining a `Government bill of lading shipper` separately from a `commercial shipper` — two instruments, each issued by the party whose instrument it is, which is what makes the scheme the discriminator; `src:dtr-part-iv` A-413 §C.2, a BL _"is only accountable when a number has been assigned to the form"_, so number assignment **is** the act, gated by A-402 §F.1 NOTE and `src:dp3-tender-of-service` §C.3.n; `src:dcsa`'s `ISSU` with `eventClassifierCode` forced to `ACT`; `src:nmfta-ebol`'s required `bol.function` with one documented value, `Create`. **[SYNTHESIS]:** binding this row to row 10's rule. It cites `ISSUER-OF-SCHEME` v1 and mints no rule of its own, because a second `ruleId` would claim a second rule and there is not one. Confidence **medium** — §10 caps a row whose authority is converted from a duty, and §375.505(a) states a duty; row 10 is **high** because it is a citation, and this row is one conversion away from it. **A signature is not this act** and is not closed with it ([`A6` §3.3(b)](A6-documents-evidence.md)): §375.505(h) signs the BL _"at least 3 days before"_ loading at no custody boundary and §375.505(g)(2) permits signing an **incomplete** document, and no source publishes what a signature _asserts_. |
| 18  | **`orderResponse`** _(the award accepted or declined; act record)_                      | **`order`** = {order}, a singleton; `qualifier` —                                                                         | **`boundBy = AWARD`.** The **offeree** — the role this order's own `orderAward` resolved — _"and only the offeree"_ ([`A1` §3.5](A1-order-service-lifecycle.md)). **EXACTLY ONE** authoritative role, computed from a published record of the same aggregate, so A8-NAMED never fires and no tie-break is named. Accept and decline are the two **outcomes** of this one act, never two types (A-TYPE).                                                 | — ([`A1` §3.5] publishes who may CAUSE the transition; A1-PERMISSION keeps permission and authority apart, and no source ranks a contest over an order response, so a corroborating role here would be **[ORIGINAL]** with nothing behind it) | — (acceptance and refusal are the offeree's and nobody else's, so there is no second party with standing on this key; the awarding role's recourse is a different act — `orderCancellation`'s pull-back, `src:dtr-part-iv` §C.6.a-b)                                                                                                                 | `platform` (M2/M3 bar a machine from asserting an act)                                                        | **The one row §4.3's seventh member closes, and the correction to §9 item 8(b-i)'s expectation that it would close two.** §9 item 8(b-i) read that deciding the member _"would close two rows"_; it closes **one**. **Sourced** for the actor on both edges: `src:dtr-part-iv` A-402 §C.4.a puts acceptance AND refusal on "the offeree, and only the offeree" with a 24-hour time-zone-aware deadline; §F.2.a and `src:dp3-tender-of-service` §B.18.a make an impermissible refusal a breach carrying 30-day market ineligibility; `src:milmove-mymove` enforces the split in a running system (_"the request and the act are different actors… the Prime cannot update the shipment to any other status"_); `src:atlas-world-group-api` captures `accepted_by` on the order record. **[SYNTHESIS]:** converting that recording duty into assertional authority, which §10 records as authored in rows 1-5, 8 and 11 too — confidence **medium**, capped accordingly. **What this row does not answer**, recorded on it rather than deferred: [`A1` §3.5]'s deadline-lapse edge is an `orderResponse` at `NOT_COMPLETED` carrying `DEADLINE_LAPSED`, which `src:dtr-part-iv` §C.4.b publishes as _"caused by nobody"_ — who **asserts** it is a capture question this row does not reach, and §C.4.b's requirement that the PPSO **overtly** confirm it was not a system fault may make the awarding role competing on that branch alone.                                                                                                                                                                                                                                                                      |

**One structural observation that the table makes visible and that is worth stating on its own.**
**Three** rows have **no authoritative role**, and they are named rather than counted against a
total: `weight.net`, `sitEntryDate` and `condition` — the first two empty, `condition` plural rather
than empty. (This paragraph read _"three of eleven"_ for five rows after the table stopped having
eleven, and `authority-table.json` carried the same stale pair; both are now the member list, and
`data-tables.test.ts` enumerates it. [`A1` §9](A1-order-service-lifecycle.md)'s rule — a count in
prose is gated or deleted — reaches a denominator too.) That is not a failure of the table. In each case a source
supplies something _better_ than a role — a value rule, a mandatory derivation, or a joint record —
and the table's job is to say so rather than to invent a winner. **[ORIGINAL]** as an observation;
each of the three underlying rules is sourced above.

---

## 6. Authority that does not come from a role: **instruments**

[Shared §6.2](00-shared-decisions.md) already fixes that `Correction.authority` names an
**instrument**. This section is the catalogue of instrument _kinds_ the corpus publishes, because
the `UNAUTHORISED` test (§8) has to check role **or** instrument.

| Instrument kind                                              | Published instance                                                                                                                                                                                                                                                                                                                                                                                         | What it does to authority                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A reserved correction form with a stated authority block** | `src:dtr-part-iv` **SF 1200** — _Bill of Lading Now Reads_ (block 11) / _Correct Bill of Lading to Read_ (12) / **Authority for Correction** (13) / Remarks (14); one BL per notice; signed by the initiating official **and** the TSP representative (A-413 §F.1.b).                                                                                                                                      | Grants a party authority it does not hold by role. `src:dp3-400ng` Introduction p.14 / Item 17.10 states the exclusion directly: "The TSP/Agent will not redact, modify, or remove any information on the BL… **The government is the only authorized agency** who can redact, modify, or remove information on the BL **through an SF1200**." |
| **A closed mutability whitelist**                            | `src:dtr-part-iv` **Table A-402-4** (p.47) enumerates _exactly which BL fields are correctable_ — agent code, COS, pack/pickup/required-delivery dates, member identity and authorized weight, orders number and date, extra pickup/delivery addresses, TCN, consignee and delivery address, pickup address, accounting codes, remarks. Everything else is immutable; to change it you cancel and reissue. | Scopes an instrument **by fact class**. This is the published precedent for the table in §5 having per-class granularity at all.                                                                                                                                                                                                               |
| **A time window that closes**                                | `src:cfr-49-375` §375.401(i) — an estimate may be amended by mutual agreement **only before loading**; §375.403(a)(7) — silence after loading is **reaffirmation**.                                                                                                                                                                                                                                        | Authority **expires**. Produces `INEFFECTIVE`, not `UNAUTHORISED` (shared §6.1).                                                                                                                                                                                                                                                               |
| **Authority acquired by the other side's silence**           | `src:dtr-part-iv` A-413 §H.2 — the consignee who believes a correction is needed notifies the issuing office, and _"if a reply to this notification is not received within 30 days, the consignee is permitted to make alterations or corrections"_ — unless the correction is obviously needed to "reflect the exact facts relating to the shipment", in which case they may act at once.                 | **Authority can be _created_ by elapsed silence.** The only instance in the corpus, and a real one: it means the authority table must be evaluable over time, not as a static lookup.                                                                                                                                                          |
| **An authorisation number licensing substitute performance** | `src:sirva-ade` **R19 / RR19** — an "authorized substitute agent performs the pickup/delivery", carrying its own **`R19AuthNumber`**, its own `R19Agent`/`RR19Agent` resource, its own weight and its own charge codes (`R19`, `RR19`, `BR19`, `HR19`) — SOE pp.16-17, ASC pp.2,5, with `R19`/`R19Cancel`/`RR19`/`RR19Cancel` as first-class events.                                                       | Grants a **role**, not a field-level correction — and grants it revocably (`R19Cancel`). Grade A, live partner contract.                                                                                                                                                                                                                       |
| **A notice with a stated effective instant**                 | `src:dp3-400ng` Item 17-2.2 — the TSP's BL responsibility and liability "shall terminate on **midnight of the day specified in the notice** which the TSP receives through DPS… and the warehouse/subcontractor shall become the final destination of the shipment under that BL."                                                                                                                         | Moves a **principal** (§7.5), with an exact instant.                                                                                                                                                                                                                                                                                           |
| **A distribution obligation that survives the instrument**   | `src:dtr-part-iv` §E.3 — cancellation after distribution requires a memorandum copy marked "canceled" sent to **every** original recipient. `src:dp3-tender-of-service` NTS §5.11.1 — notification by e-mail "with **Delivery and Read Receipt as proof of notification**".                                                                                                                                | Corroborates [shared §6.5](00-shared-decisions.md): corrections emit obligations, and the obligation names recipients. An instrument is not spent when it is signed.                                                                                                                                                                           |

**[ORIGINAL]:** grouping these seven into one concept called an _instrument_, and making the concept
a peer of role in the authority test. Each instance is sourced verbatim; none of the sources
generalises, and two of them (`src:dtr-part-iv`, `src:dp3-400ng`) describe the same one.

---

## 7. How authority moves at a custody handoff

### 7.1 The hinge is already in the corpus, and it is the _responsibility_ distinction

`src:uncefact-rec24` draws exactly one real distinction in this area, and it is the one we need:

- **41** `Handed_over_under_continued_responsibility` — _"The goods/consignment/equipment has been
  handed over **under responsibility of the same transport operator**."_ (rev3 p.4)
- **349** `Handed_over` — _"The goods/consignment/equipment has been handed over **to another
  party**."_ (rev3 p.15)

Both codes already ride on records the envelope publishes: `custodyBasis` on the **`handover`**
assertion ([shared §4.7](00-shared-decisions.md)'s `handover` row) and on
`ExternallyPerformedLeg.custodyBasis` ([shared §8.2](00-shared-decisions.md)). Those two are exactly
the inputs of the fold `custodyAt(goods, instant)` ([shared §4.8.3](00-shared-decisions.md)). So the
hinge needs no new field — and it needs no stored interval either.

> **Rule A8-MOVE (as amended). At a custody boundary with `basis = 349` (handed over to another
> party), authority over every `boundBy = CUSTODY` fact class moves to the receiving role, effective
> at the selected `RECEIPT`'s `occurredAt`. At a boundary with `basis = 41` (continued
> responsibility), custody moves and **authority does not**. Across a transfer gap — after a
> `RELEASE` and before the next `RECEIPT` — the **releasing role remains authoritative**, so the gap
> is a custody `UNKNOWN` and not an authority vacuum.**

**Why the rule had to name an instant, and which one.** It used to read "effective at the handoff
instant", which presupposed that a handoff has one. [Shared §4.7.2f](00-shared-decisions.md) settles
that the releasing and receiving parties assert **two facts**, so a transfer has **two** instants —
the release and the receipt — and a rule that moves authority must say which. It names the
**receipt**. **Nothing new is sourced:** 41 versus 349 is `src:uncefact-rec24`, above.
**[ORIGINAL]:** choosing the receipt instant, and the gap clause. The two reasons are internal and
are the same two that decided the two-facts verdict — moving authority at the release would grant it
to a party that has not spoken (**M1**'s record-versus-fabrication argument, [shared
§4.6.1(a)](00-shared-decisions.md)), and §7.4(b) already holds that a former holder _never stops
being authoritative for facts before the handoff_, so nothing is lost by waiting. **Do not score on
the amendment** until this document ratifies it ([shared §4.7 note 3](00-shared-decisions.md); §10's
last row).

**What is sourced:** that the two codes distinguish continued from transferred _responsibility_ —
Rec 24 says so in the definitions, and the Rec 24 analysis names it as the source's one real
discrimination ("physical handover that does or does not transfer responsibility, stated as two
codes with two definitions"). **[ORIGINAL]:** equating _responsibility for the goods_ with
_assertional authority over facts about the goods_. Rec 24 does not say that, and Rec 24 has **no
party identifier of any kind** (A8 C6=0), so it cannot.

The worked HHG case for `41` is `src:dp3-400ng` Item 125 **Shuttle Service** — a truck-to-truck
transfer where linehaul equipment cannot access origin or destination — handing to the _same_
agent's own linehaul van. The worked case for `349` is the interline pair,
`src:stedi-x12-reference` element 1650 **`J1` Delivered to Connecting Line** / **`R1` Received from
Prior Carrier** (plus `BA` Connecting Line or Cartage Pick-up), which the stedi analysis describes
as "two complementary assertions by two different [parties]". `src:open-trip-model`'s `HandOver`
"indicates transferring a consignment from one Actor to another", carries `from`/`to` actor refs and
is **distinct from `unload`** — the structural confirmation that a handover is its own act and not a
side effect of unloading.

Both of those now ride a declared **`qualifier`**. [Shared §4.7.1](00-shared-decisions.md) gives
`handover` the key `{releasing, receiving, side, occurrence?}`, so `J1` and `R1` are two fact keys
and a shipment can change hands more than once — which is what makes "authority moves at a boundary"
a rule with more than one boundary to apply to. Both parties ride **both** records' `value`
(`releasingParty` / `receivingParty`), which preserves OTM's `from`/`to` field-for-field; what is not
preserved is the claim that one publisher's record settles both sides.

### 7.2 Liability does **not** move. Say so, or the rule is wrong.

`src:dp3-tender-of-service` §B.3.g: the TSP is **"solely responsible for the acts and omissions of
any third party it contracts with"** (p.19). §B.3.f **prohibits double brokering** ("when a TSP
assigns a shipment to a carrier who then brokers the shipment to another carrier") and requires the
legal name and US DOT number of the provider _actually hauling_ in DPS within 2 GBD of origin
departure. §B.17.b bars a **Move Management Company** from being named as the origin servicing agent
at all. `src:cfr-49-375` §375.205 permits only two agent types and requires the **prime agent** to
act under a signed written agreement retained 24 months, expressly not as a broker or forwarder.

> **Rule A8-LIABILITY. A custody handoff moves assertional authority and moves nothing else. The
> chain of contractual responsibility is a separate fact and is not modelled here.**

**[ORIGINAL]** as a statement of scope; every constituent is sourced above. The rule is what stops
A8-MOVE being read as "subcontracting launders accountability" — which is precisely what
§B.3.f-g exists to prevent in the real world.

### 7.3 There is exactly one instant where **two roles are jointly authoritative**, and the model is forbidden to pick

This is the strongest-sourced finding in the document.

At a custody boundary, the releasing and receiving parties assert the **same** fact class
(`condition`, and the counts that go with it) about the **same** instant. `src:dp3-tender-of-service`
NTS §1.6.10 (p.34) describes what the industry actually does when they disagree, and it is not
"pick one":

> _"In the event the opinion of the TSP's driver and the NTS TSP's representative differ as to
> shortage/overage or condition, **both opinions will be listed on the exception sheet and
> separately identified as to source**."_

The same section requires an **exception sheet cross-referenced to the original inventory**, and
requires that if there is nothing to report they still write **"no differences noted", sign and
date it** — i.e. agreement is itself an affirmative, dated, attributed record rather than an absence.

Three further sources make joint signature the norm at a boundary rather than an exception:
`src:cfr-49-375` §375.503(c) (inventory signed by both) and §375.503(d) (the individual shipper's
written note of missing or damaged articles **at delivery** — **corrected 2026-10-09 from §375.701,
which requires no signature**, see §9 item 2); `src:dp3-tender-of-service` §C.17.a (the AT DELIVERY notice "jointly signed by my
representative and the customer or their authorized agent") and §B.10.e (a joint walk-around
inspection performed **twice**, on arrival and before departure); `src:dtr-part-iv` A-413 §F.1.b
(SF 1200 signed by the initiating official **and** the TSP representative).
`src:dp3-400ng` Item 17.12.c requires **both** TSP and warehouseman to hold the condition of each
article "when received at and forwarded from the storage location" — two independent records of the
same thing, by design.

> **Rule A8-JOINT. At a custody boundary, for `condition` and for the counts asserted with it, both
> the releasing role and the receiving role are authoritative for the boundary instant. Where they
> disagree, `FactResolved` MUST publish the disagreement — `selected` is empty, `considered[]` names
> both, and `rule` names the joint rule — and MUST NOT select one.**

**[ORIGINAL]:** the rule, and specifically the decision to let `FactResolved.selected` be empty for
this one case. `src:dp3-tender-of-service`'s own analysis draws the conclusion and it is worth
quoting as the justification: _"Most data models force a single truth at custody transfer; this one
does not, and it is right not to."_ The `Assertion`/`FactResolved` shape supports it without change,
because [shared §4.3](00-shared-decisions.md) already requires `considered[]` to name every
assertion in the contest.

A consumer that needs one number for an operational display gets it from a **downstream** named rule
over the published disagreement — not from the resolution silently resolving it.

> **The grain question §9 item 3 asked of this section is answered, and the answer needed nothing
> here to change** (2026-10-09). This rule is written in **roles** — "both the releasing role and the
> receiving role" — while every source quoted above names **individuals**: NTS §1.6.10's _"the
> opinion of the TSP's **driver** and the NTS TSP's **representative**"_, §C.17.a's _"jointly signed
> by my **representative** and the customer"_, A-413 §F.1.b's _"the initiating **official** and the
> TSP **representative**"_. That is not a mismatch to repair: the role is the surface the grain rides
> on, `ROLE_NAMES` already carries `driver` as "the person driving", and element 98 cross-walks that
> member **exactly** to its one individual-kind code, `D1 Driver`. So the phrase "releasing and
> receiving parties" is at company grain in this prose and at whatever grain the role names in the
> model — which is why §9 item 3 minted no field. **What it did leave this section is A8-SELF's
> residue**, since a boundary is exactly where a driver and an office can agree on `condition`
> while being one company.

### 7.4 What happens to the previous holder's assertions

Three answers, in order of how badly each would break things if got wrong.

**(a) They do not become false, are never retracted, and are never deleted.** A retraction is
`DID_NOT_OCCUR` and asserts _that a prior event's assertions are in error_
(`src:gs1-epcis-cbv`'s `errorDeclaration`, `Ontology/EPCIS.ttl` L451-456, carried at
[shared §6.4](00-shared-decisions.md)). A handoff is not an error. Nothing about the origin agent's
load record becomes wrong when the goods leave its custody. The NTS exception sheet is the
regulation making the same point: the disagreeing opinion is **kept and attributed**, not corrected
away.

**(b) They never _stop_ being authoritative for facts before the handoff — they remain so
permanently.** Under **A8-INSTANT** (§4.2), standing is keyed to the instant the fact is _about_. The
origin agent asserting the load date three weeks later, from a different city, having long since
handed the goods to the linehaul hauler, is still the authoritative asserter of the load — because
the load happened inside its custody interval. This is the part that a recency rule gets exactly
backwards, and it is common: `src:sirva-ade`'s whole operational stream is timestamped by _recording_
time (SOE p.2), so late-keyed origin facts are the norm on the wire we actually carry.

**(c) They never _had_ authority for facts after the handoff, so nothing is downgraded.** The
question "do the previous holder's assertions stop being authoritative for facts after the handoff
instant?" has the answer **they were never authoritative for those**, and this is a stronger and
safer answer than "they stop being". Under a _stopping_ rule, the model must re-evaluate published
resolutions whenever a custody record is corrected. Under A8-INSTANT it re-derives them, which is
what an append-only catalog does anyway: a `handover` contest is re-resolved, **the fold
`custodyAt(goods, instant)` over it ([shared §4.8.3](00-shared-decisions.md)) returns a different
answer without anything being rewritten**, the authority function over it changes, and a **new**
`FactResolved` is published over the same `considered[]`. _This paragraph was already describing the
fold; §4.8 supplies its name._ That is exactly the
mechanism [shared §6.6](00-shared-decisions.md) already uses for a corrected derivation input — "the
platform publishes a **new** derived Assertion and a new `FactResolved`" — and it requires no new
authority, because the platform is asserting what it derived.

> **Rule A8-AFTER. A non-authoritative assertion by a former custody holder about a post-handoff
> instant is `advisory` if its role can never win that class, and `competing` if a published value
> rule makes it eligible. It is recorded either way, appears in `considered[]`, and is never
> suppressed from a query.**

**[ORIGINAL].** The nearest published behaviour is the opposite one and is worth naming as the
anti-pattern: `src:sirva-ade` GSD p.4 states that a replaced service provider **"will not be found in
the shipment Resource group"** — the partner contract simply drops the superseded party, so its
assertions become unattributable. We keep the party, keep the assertion, and change only its standing.

### 7.5 One case that looks like a custody handoff and is not: the **principal** changes

`src:dp3-400ng` Item 17-2.5: after SIT termination, _"the TSP/warehouse/subcontractor shall
thereafter recognize the individual DoW customer, **not the Government**, as the depositor of the
property."_ Item 17-2.2 fixes the instant — midnight of the day specified in the notice received
through DPS — and makes the warehouse "the final destination of the shipment under that BL."
`src:cfr-49-375` §375.609 describes the commercial equivalent: on conversion to permanent storage,
carrier liability ends, the warehouseman's rules and charges apply, and the goods are placed **in the
individual shipper's name**; and §375.609(g) adds a computed fallback — if the required notice was
never given, carrier liability **automatically continues** to the end of the day following actual
notice.

Nothing physically moved. What changed is **who the arrangement is for**. That is the `PRINCIPAL`
binding in §4.3, and it moves the `charge` row's decision authority (from `accountParty` = the
Government to `accountParty` = the customer) without touching any `CUSTODY`-bound row.

> **Rule A8-PRINCIPAL. A change of principal moves `boundBy = PRINCIPAL` authority at the instant the
> instrument specifies, and moves nothing bound to custody.** **[ORIGINAL]** as a rule; the instant,
> the instrument and the substitution are all quoted above.

A second, structurally identical instance, from the other side of the relationship:
`src:dtr-part-iv` A-406 §B.8 (pp.10-11) splits **Maintaining PPSO** from **Responsible PPSO** for an
NTS lot stored outside the booking office's area — _one office owns the account, the other owns the
geography_, with a mandatory copy-everyone protocol. The DTR analysis calls it "a genuinely good
idea: account ownership and geographic ownership are different roles over the same lot." It is
direct evidence that **two authorities can coexist over one object on different axes**, which is what
`boundBy` exists to express.

### 7.6 Scenario 8, expressed end to end

_A mid-journey custody handoff: goods move from the origin agent's shuttle to a second van line's
linehaul hauler at a cross-dock. Both later assert a delivery date._

Every record below is written in the envelope of [shared §1.1](00-shared-decisions.md): one
`subject`, one `type`, other aggregates in `context[]`. There is no `factRef` field and no
`factClass` field on an Assertion — the fact key `(subject, type, qualifier?)` is **derived**
([shared §1.3](00-shared-decisions.md)) — so `factRef` is spelled out only on the two `FactResolved`
records, where [shared §4.3](00-shared-decisions.md) makes it an explicit tuple.

```
Act   type=handover        subject=shipment:S   context=[stop:X1, trip:T1]   basis=ACTUAL
      qualifier={releasing: originAgent, receiving: hauler, side: RELEASE}
      outcome=COMPLETED    value.releasingParty=A    value.receivingParty=H
      assertedBy={originAgent A, role: OriginAgent}   capturedBy=KEYED_BY_PERSON
                                                      ← M2: custody handed over is possession-changing
      custodyBasis = 349 Handed_over                  ← src:uncefact-rec24 rev3 p.15
                                                      ← the J1 half: src:stedi-x12-reference 1650

Act   type=handover        subject=shipment:S   context=[stop:X2, trip:T2]   basis=ACTUAL
      qualifier={releasing: originAgent, receiving: hauler, side: RECEIPT}
      outcome=COMPLETED    value.releasingParty=A    value.receivingParty=H
      assertedBy={hauler H, role: Hauler}             capturedBy=PARTNER_ASSERTED
                                                      ← the R1 half
      custodyBasis = 349 Handed_over

FactResolved  subject=shipment:S
      factRef=(shipment:S, handover, {OriginAgent, Hauler, RELEASE})
      considered=[A's]   selected=A's
FactResolved  subject=shipment:S
      factRef=(shipment:S, handover, {OriginAgent, Hauler, RECEIPT})
      considered=[H's]   selected=H's
      rule={ruleId: AUTHORITATIVE-ROLE-AT-INSTANT, ruleVersion: 1}
                                    ← TWO keys, so TWO resolutions. The release and the receipt are
                                      not rivals and nobody is asked to choose between them
                                      (shared §4.7.2f)

                                    ← shipment:S is in handover's `goods` family (shared §4.7)
                                    ← these two acts are the fold's inputs (shared §4.8.3)
                                    ← custody is UNKNOWN between them: C5's transfer gap, which is
                                      the cross-dock dwell this scenario ends by naming

— condition is asserted PER ARTICLE, by each side: one Assertion per item, never a pattern —

Assertion type=condition    subject=item:i7   context=[shipment:S, stop:X1]   basis=ACTUAL
      assertedBy={originAgent A, role: OriginAgent}   ← releasing, at its own stop on T1
Assertion type=condition    subject=item:i7   context=[shipment:S, stop:X2]   basis=ACTUAL
      assertedBy={hauler H, role: Hauler}             ← receiving, at its own stop on T2
      … and the same pair for item:i8, item:i9, … — one Assertion per article per side,
        which is what §5 row 9 and A8-JOINT require ("the condition of each article")
                                    ← the two stops are the same PLACE and not the same Stop
                                      (third bullet below). There is no one stop both sides can
                                      name, and the pair still resolves on ONE fact key, because
                                      context[] is not the resolution key (shared §1.4 rule 3)

FactResolved  subject=item:i7   factRef=(item:i7, condition)
      considered=[A's, H's]   selected=∅
      rule={ruleId: JOINT-AT-CUSTODY-BOUNDARY, ruleVersion: 1}   ← A8-JOINT; the model does not pick
                                                      ← src:dp3-tender-of-service NTS §1.6.10

— three weeks later, both assert the delivery —

Assertion type=delivery     subject=shipment:S   context=[stop:Z]   basis=ACTUAL
      assertedBy={originAgent A, role: OriginAgent}   assertedAt = later of the two
Assertion type=delivery     subject=shipment:S   context=[stop:Z]   basis=ACTUAL
      assertedBy={destinationAgent D, role: DestinationAgent}

FactResolved  subject=shipment:S   context=[stop:Z]   factRef=(shipment:S, delivery)
      considered=[A's, D's]   selected=D's
      rule={ruleId: AUTHORITATIVE-ROLE-AT-INSTANT, ruleVersion: 1}
```

**Three shapes this scenario used to publish and no longer may.** The first two were the old
two-axis envelope showing through; the third is F1's.

- **`subject: item:*` was not a subject.** A `SubjectRef` is `{aggregate, id}` and `subject` is
  _"exactly one"_ typed reference ([shared §1.1–1.2](00-shared-decisions.md)); `*` is not an id, so
  the record named no fact key, entered no contest, and under **E-CANON-STRICT**
  ([shared §4.6.2](00-shared-decisions.md)) would be refused at the boundary. The old parenthetical
  "(per article)" was the fix, unstated: it is **one Assertion per article**, which is what the
  `FactResolved` beneath it was already doing correctly. **Wherever else a worked record in this
  document reaches for a wildcard or a plural subject, the same restatement applies** — the envelope
  has no multi-subject record and no subject pattern, and shared §1.1 forbids both permanently.
- **`delivery` on `subject = stop:Z` contradicted this document's own §5 row 5.** Row 5 gives
  delivery the **`goods`** family with the stop in `context[]`, and [shared §4.7](00-shared-decisions.md)
  declares the same; a `stop`-subject delivery is outside the declared family and E-CANON-STRICT
  refuses it. Subject is the shipment, `context = [stop:Z]`. The type spelling is **`delivery`**;
  `delivery-performance` is a prose alias ([shared §4.7 note 5](00-shared-decisions.md)) and must not
  appear in a record. **The scenario's conclusion is unaffected** — both assertions still pair on one
  fact key, and A's still loses.
- **One `stop:X` on two trips was not one stop.** Both handover records were written
  `context = [stop:X, …]` against `trip:T1` and `trip:T2`, and [shared §8.1](00-shared-decisions.md)
  fixes a `Stop` as "a visit to one place, at **one position in one trip's sequence**". They are two
  stops — `stop:X1` on T1 and `stop:X2` on T2 — which is what [`A3` §8](A3-trip-stop-assignment.md)
  already says ("the releasing side against a stop on trip 1, the receiving side against a stop on
  trip 2"). A transcription slip in the worked example, not a licence for one stop on two trips.
  **The scenario's conclusion is unaffected**, because `context[]` is not the resolution key
  ([shared §1.4](00-shared-decisions.md) rule 3).

**Why A's later assertion loses, stated without hand-waving.** Not because it is older or newer —
it is in fact the _more recent_ of the two, which is the exact case the critique raised. It loses
because the delivery's instant falls after the `349` boundary (**A8-INSTANT** + **A8-MOVE**), so A's
role was never authoritative over that instant; A's assertion is `advisory` for **`delivery`**
under §5 row 5 and appears in `considered[]` (**A8-AFTER**). And A's
**load** assertion, made at the same moment from the same non-custodial position, remains
**authoritative** — because the load's instant sits inside A's custody interval.

**What this scenario still leaves open, stated plainly.** Goods dwelling on the cross-dock overnight
between T1 and T2: whether that dwell is a `stay`, a SIT occupancy or neither is **A5's** question and
is listed as unsettled at [shared §10.4](00-shared-decisions.md). It does not block this document —
the fold `custodyAt(shipment:S, instant)` ([shared §4.8.3](00-shared-decisions.md)) answers who holds
who holds the goods on either side of the dwell, its inputs are the two **`handover`** acts above,
and the authority function is defined over the fold regardless of what the dwell is eventually
called. _(Across the dwell itself the fold returns `UNKNOWN` — **C5**, [shared
§4.8.3](00-shared-decisions.md) — and does not fall through to the last known holder, which is
A8-NAMED's prohibition on implicit last-writer-wins in its custody-side form. Note what that has
become: what §4.8.3 rule 3 used to **state** about a half-published cross-dock is now **derived** from
the two facts. And note what does **not** go dark with it — **A8-MOVE as amended** (§7.1) keeps the
**releasing** role authoritative across the gap, so the dwell is a custody `UNKNOWN` and not an
authority vacuum.)_

---

## 8. What this hands back to the three shipped mechanisms

**(1) `FactResolved.rule` now has a rule class to name.** `AUTHORITATIVE-ROLE-AT-INSTANT` is a real
`{ruleId, ruleVersion}` whose definition is §5 + §4.2. [`fork-time` §5.5](fork-time-provenance-corrections.md)
said this rule class needed a licence to exist; §5 is the licence. The **cap it placed on its own
confidence** ([`fork-time` §7, decision (b)](fork-time-provenance-corrections.md)) may now be
re-argued against §10 below rather than against nothing — but note §10: the table is medium, not
high, so the cap moves rather than disappearing.

**(2) `Correction.authority` now has a typed vocabulary.** §6's seven instrument kinds, each with a
published instance. `Correction.authority` is satisfied by **either** a role that §5 makes
authoritative for the fact class **or** an instrument from §6 — never by neither.

**(3) `UNAUTHORISED` is now decidable.** The test, stated as one rule:

> **Rule A8-UNAUTH. A correction is `UNAUTHORISED` when, for the corrected fact's `factClass` and the
> instant the fact is _about_, the declaring role is neither `authoritative` under the applicable
> `AuthorityRule` nor exercising a named instrument under §6. It is recorded, not applied, and emits
> an obligation to the party that does have authority** ([shared §6.1](00-shared-decisions.md)).

Two worked cases, both sourced:

- **A TSP editing the BL.** `src:dp3-400ng` Introduction p.14 / Item 17.10 — the TSP/Agent "will not
  redact, modify, or remove any information on the BL"; only the Government may, **through an
  SF1200**. A TSP-declared BL correction with no SF 1200 reference is `UNAUTHORISED`. With one, it is
  the Government's correction and is `APPLIED`.
- **A consignee correcting after 30 days of silence.** `src:dtr-part-iv` A-413 §H.2 — the same act
  that is `UNAUTHORISED` on day 1 is authorised on day 31, by the instrument of the issuing office's
  silence. The authority table must therefore be **evaluated at an instant**, which §4.2 already
  requires it to be.

And note the boundary that shared §6 already drew and that this document does not disturb:
**`UNAUTHORISED` and `INEFFECTIVE` are different outcomes.** Wrong party → `UNAUTHORISED` (§5/§6).
Right party, closed window → `INEFFECTIVE` (`src:cfr-49-375` §375.401(i)). Both are recorded; neither
reaches the priced record.

---

## 9. What the rest of A8 still owes

This document is a skeleton by design. The following are **not** decided here, and nothing in this
file may be read as deciding them.

1. **The party entity itself.** There is none anywhere in the corpus — the crosscheck's finding is
   that SIRVA, Atlas and pegII "all carry denormalised name+id string pairs on a flat row." A8 owes:
   legal name, DOT/MC number, SCAC (`src:dtr-part-iv` #665), agent code, the branch grain
   (`src:sirva-ade`'s 7-digit `AgentNbr` where the trailing three digits are the branch, plus
   `SvcProvDataRecipient` naming the receiving branch per push, SOE p.2), and the hierarchy
   (`src:atlas-world-group-api`'s `parentAgentCode` and `/Agents/{agentCode}/Family` — column names
   only). Until it lands, `assertedBy.partyRef` has no target schema.
   **[A9 §3.6] adds a second and independent reason to mint it, and mints nothing itself.** Those
   identifiers are not only **fields** the party entity would carry — each is an `identity`
   assertion whose `subject` is a party, and [SD §1.2] has no party aggregate, so five of the twenty
   schemes [A9 §3.3] witnesses cannot be asserted at all. The widest-witnessed scheme in the whole
   corpus is among them: six witness rows carry a SCAC, from four publishing bodies. A9 records the
   blocker against this item rather than opening one of its own, because an owed inventory that
   counts one gap twice is worse than one that counts it once ([A7 §6]). `ids.ts`'s
   `TODO(A8 §9 item 1)` — whether the party becomes a fifteenth aggregate kind or stays outside the
   subject enum — is the question that decides it, and [A9 §3.6] item 2 records why `partyRole` is
   not the answer: a SCAC belongs to the company whatever it is doing on this shipment.

   > **PARTIALLY CLOSED 2026-10-08 — the subject is minted; the name, the branch grain and the
   > hierarchy are NOT, and the residue is enumerated so nobody has to re-derive it.**
   >
   > `party` is an [SD §1.2] `aggregate` kind at catalog **0.6.4** (`newAggregateKind`, additive).
   > **What that discharges, exactly two things:** `assertedBy.partyRef` has a target schema, and
   > [A9 §3.6]'s five party-grain schemes have a `subject` — their blockers are off and
   > `loadIdentitySchemes` now refuses this item's name on **any** row. No record type, no fact class
   > and no subject family were added, because `identity`'s canonical family **is** the enum
   > ([SD §7.1] "`subject` may be **any** aggregate kind"), so the member alone is the mechanism.
   >
   > **Correction to this item's own list, and it was wrong in both directions.** The schemes blocked
   > on it are **five** — `scac`, `usDotNumber`, `mcNumber`, `gbloc`, `agentCode`, enumerated by name
   > in `identity-schemes.test.ts`. This item's prose names **four**: it writes "DOT/MC number" as
   > one phrase where the table carries two schemes, and **it never names `gbloc` at all**. So
   > [A9 §3.6]'s sentence that this item "already names these very identifiers" held for four of the
   > five. There was no single cardinality to count, which is why the round enumerated instead.
   >
   > **The residue, with each blocker named** — this item stays open on all three:
   >
   > - **legal name** — blocked on **item 3** for one of its three reasons, and **that one fell on
   >   2026-10-09** while the other two stand; see item 3's own annotation. The citation this item
   >   never had now exists and is primary: `src:cfr-49-375` **§ 375.505 _"Must I write up a bill of
   >   lading?"_ (b)(1)**, _"Your legal or trade name (i.e., doing business as name) **as it is
   >   registered with FMCSA**, to include your physical address"_, restated at **Appendix A →
   >   _"Bill of Lading"_ item 1** (the same requirement, not a second witness) and coupled to the
   >   registration at **§ 375.207 _"What items must be in my advertisements?"_ (b)(1)**, _"as it
   >   appears on our document assigning you a U.S. DOT number"_. **Appendix A item 2** is a distinct
   >   requirement: the names **and** USDOT numbers of participating carriers.
   >   `src:dp3-tender-of-service` §B.3.f p.19 corroborates at `secondary` grade — that source has no
   >   `captured/`. **Three reasons it is not modellable yet:** the regulation publishes a
   >   **disjunction** (legal **or** trade/DBA), which under **I-KEY** is two vocabularies and not one
   >   field — the test this corpus already applied to split `mcNumber` from `usDotNumber`; it arrives
   >   **bundled with a physical address** and [SD §1.2] has no `place` aggregate; and decisively,
   >   `src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}` whose `Id` _"can contain agent,
   >   vendor, driver **or equipment** code based on the resource `Type`"_, so its `Name` names a
   >   company, a person or a **tractor**. The one grade-A contract with a name field is the one that
   >   fuses the grains: **a party must be defined before it can be named.**
   > - **the branch grain** — **CLOSED 2026-10-09 by item 3, with nothing added.** The prediction
   >   here was right: the identifier already carried it, and the grain question was all that was
   >   owed. The answer is **yes, a branch is its own party**, on `agentCode` alone — 7 digits, the
   >   trailing three being the branch, `identifies: party`, `definedNotMerelyNamed`. `gbloc`
   >   corroborates with a caveat its own row states (its GBLOC transfers between offices), which
   >   item 3's annotation records because the first draft leaned on it.
   >   `SvcProvDataRecipient` is a push-routing field, which is item 6's territory.
   > - **the hierarchy** — owed with a blocker of a **different kind**: `parentAgentCode` and
   >   `/Agents/{agentCode}/Family` are a party-to-party **relation**, and **no `AssertionType` holds
   >   one**. It is not waiting on item 3; it is waiting on a fact class that does not exist. **Item 3
   >   left it an adjacent claimant** (2026-10-09): A8-SELF's grain residue also wants a
   >   party-to-party relation. **Whether it is the SAME relation is not decided** —
   >   `parentAgentCode` is organisation→organisation and A8-SELF's gap is person→organisation — so a
   >   round that mints one should ask whether one fact class covers both before assuming it does.
   >
   > **One tempting reading recorded and REJECTED**, because the next round will reach for it:
   > _"as it is registered with FMCSA"_ makes FMCSA an `authority` in [SD §7.1]'s exact sense, and the
   > alternatives test above is this corpus's own — together they suggest filing the name as an
   > `identity` assertion under a minted `legalName` scheme. **A name does not identify.** [SD §7.1]
   > defines a scheme as _"the naming system, which **DEFINES** who assigns and what it identifies"_;
   > `scac`'s six witnesses cite the code **because** it identifies a carrier uniquely, and nothing in
   > `src:cfr-49-375` says a name is unique. FMCSA registering a name makes FMCSA an authority without
   > making the name an `id`.
   >
   > **And one thing this item now owes that it did not before.** Two brands for one concept reach the
   > wire: `PartyId` (`x-brand: "party"`) for every reference and `AggregateId.party`
   > (`x-brand: "id:party"`) for the subject. The successor shape is `SubjectRef<'party'>`, because
   > every other aggregate is referenced that way and never by a bare id (`LegEndpoint.stop`,
   > `CustodyHolder.partyRole`) — the brand is the fossil of there having been no party aggregate.
   > **It was measured and deliberately not done:** no published rule compares a party-as-subject with
   > a party-as-reference, A8-SELF (`corroborationIsIndependent`) takes two **references**, and
   > unifying would remove the published `$defs/PartyId` that six defs reference, `AssertedBy` among
   > them. Closing it is `changedValueShape` — breaking — and it wants a rule that needs the
   > comparison first.

2. **The full role vocabulary as a versioned enum**, including the roles §2 names but does not
   define: `accountParty`, `goodsOwner`, `weighMaster`, the government offices
   (PPSO/PPPO/TO/ITO/JPPSO/SB/SPM, `src:dp3-400ng`, `src:dtr-part-iv`), the NTS
   warehouseman and whether it is the same role as ADE's `SITAgent`, the **`TSP for Carriage`**
   (`src:dp3-tender-of-service` NTS §1.6.10, §5.8 — "a named third party in the custody chain"),
   `Move Management Company`, `Trusted Agent`, `Claims Manager`, `Designated Agent`
   (`src:dp3-400ng` Definitions p.11 — appointed by power of attorney to act **in place of the
   customer**), broker, and the prime / emergency-or-temporary agent split (`src:cfr-49-375`
   §375.205). §5's table is stated in roles it does not define.

   > **Two decisions taken 2026-10-06, and this item stays open after both.**
   >
   > **(a) `roleClass` is REFUSED ON THE EVIDENCE, not pending.** The vocabulary this item would cut
   > `roleClass` from is still owed, but `roleClass`'s own state has changed character. It shipped
   > `pending` — "the source exists and is unread" — and the source three documents named was
   > `src:stedi-x12-reference` **element 98**: `round-1-crosscheck.md`'s **`## Unread material`**
   > SHOULD list, [`fork-time` §7]'s `(b)(1)` row, and that source's own **`## Open questions`**
   > item 1. §2's amended bullet is the read. It closes nothing, for two reasons that do not depend
   > on each other — element 98 has **no class axis** (one flat table; a class list cut from it would
   > be ours, which [shared §0](00-shared-decisions.md) forbids) and **no member meaning no party at
   > all** — the nearest misses are `B2 Other Unlisted Type of Organizational Entity`, which is an
   > organization, `QD Responsible Party`, which is a person, and `ZZ Mutually Defined`, which means
   > the slot is filled by something unlisted rather than that it is empty. So this is
   > [`A9` §3.2](A9-identity-cross-references.md)'s shape reached by the opposite argument: A9's
   > sources publish an escape hatch beside every closed list, while element 98 publishes a list at
   > the wrong grain. `RoleClassStaysOwed` in `src/rules/authority.ts` is the gate, and a later round
   > that narrows the type has to answer those two reasons rather than merely do the work.
   >
   > **(b) The non-party value is published, and it is NOT a member of this vocabulary.** A4 handed
   > this item one concrete requirement — an explicit non-party member — and `FORCE_MAJEURE` and
   > `DEADLINE_LAPSED` are the two published codes that need it (`src:dtr-part-iv` §C.4.b calls
   > non-response "a typed event caused by nobody"). It is published as `ATTRIBUTION_NO_PARTY`,
   > declared by `Attribution`'s **shape**, because `roleClass` is the class of _party_ a reason is
   > attributed to and a reason caused by no party has no class of party.
   > [shared §2.6](00-shared-decisions.md)'s own note draws that line by sending a shortfall to "an
   > unknown role class rather than to nobody" — so `unknown` is a class and belongs inside the
   > refused vocabulary, and nobody is outside it. **This item therefore no longer owes a non-party
   > member**, and a round that closes the vocabulary must not add one.
   >
   > **Three pieces of evidence element 98 hands this item, none of them a decision.**
   >
   > 1. **The NTS question above has X12 evidence, and it points to a split.** This item asks whether
   >    "the NTS warehouseman… is the same role as ADE's `SITAgent`". Element 98 keeps them apart as
   >    three codes: `WH Warehouse`, `8F Bailment Warehouse` — _"a warehouse property that is owned
   >    by an organization, but the inventory contained in the warehouse belongs to the supplier until
   >    the organization owning the warehouse legally purchases the goods"_ — and
   >    `NS Non-Temporary Storage Facility`. Evidence toward a split; the decision is still this
   >    item's.
   > 2. **`tariffOwner` has an industry counterpart and stays owed.** `TI Tariff Issuer` (and
   >    `CO Ocean Tariff Conference`) name the function §5 row 11 calls "the tariff owner (the van
   >    line / the party whose tariff prices it)", which `ROLE_NAMES` has no member for. What blocks
   >    the member is **§2's addition test** — a role is added there because it asserts facts and ADE
   >    has no slot for it — and applying that test is this item's. The owed row's reason is therefore
   >    unchanged and was deliberately **not** repointed: X12 naming a function is not X12 asserting a
   >    fact.
   > 3. **Nothing in 1312 codes names a household-goods role.** Searched: `household`, `van line`,
   >    `mover`, `relocat`, `moving company` — zero. The cast §2 takes from `src:sirva-ade` is, as far
   >    as any read source goes, **the only household-goods role vocabulary there is**, and §10's table
   >    has no row for that exposure: it rates §3 "High" on `src:sirva-ade` grade A with a worked
   >    sample, and rates the authority rows, not the cast. **This is a new confidence item rather than
   >    a restatement of one** — a cast resting on one publisher with no industry list to corroborate
   >    it — and it belongs in §10 when this item is written. Recording it here rather than editing §10
   >    on the way past, because the row it needs is a judgement about the vocabulary this item owes
   >    and has not made.

   > **PARTIALLY CLOSED 2026-10-09 at catalog `0.7.0` — and the item's own list turned out not to be
   > an inventory of its debt.** The measurements are
   > `plans/completed/domain-reference-a8-item2.md` §1.3b-§1.3c.
   >
   > **What this item is CITED for and what it NAMES overlap in one entry.** `data/authority-table.json`
   > carries ten `owedTo` entries naming this item, across eight rows; this item's prose names
   > thirteen things; the intersection is **the warehouseman** (row 8, `storeOut`). Nothing else the
   > table wants is in the list, and nothing else the list names appears in any `owedTo`. The list is
   > a list of **names the corpus uses**, which is a different thing from a list of what is owed —
   > item 1's list was wrong about cardinality, item 3's about membership, and this one about **what
   > the list is for.**
   >
   > **Of the ten entries: two resolved, six were never debt, two stay owed.**
   >
   > - **Resolved** — rows 1-2's advisory "visibility providers (`src:dcsa` VSP / SVP)". `ROLE_NAMES`
   >   gains **`visibilityProvider`** (`newClosedEnumMember`), on the one piece of **primary
   >   captured** evidence in this item's whole list: `src:dcsa`'s **`tntPublisherRole`**, _"the
   >   **party function code of the publisher**"_, a closed four-member enum (`CA`, `AG Carrier local
agent`, `VSP Visibility Service Provider`, `SVP Any other service provider`) carried on the
   >   same schema as `transportEventTypeCode`'s `ARRI`/`DEPA`. Both conjuncts of §2's addition test
   >   are met: it asserts arrival and departure, and ADE has no slot for it. **It rests on one
   >   publisher, which is disclosed** — `weighMaster` is the precedent that one is enough, and §10
   >   now carries the standing exposure as a row.
   > - **Never debt — two COMPLEMENTS, and `§4.1` note 1 already licenses them.** Row 8's
   >   corroborating _"the non-inspecting parties"_ and row 9's advisory _"everyone else"_ are defined
   >   by _who is not the authoritative asserter on this fact_, so their extension changes per fact
   >   and a member spelled `nonInspectingParty` would be a role nobody holds. §4.1 note 1 —
   >   "absence of corroboration is not evidence", which "cuts both ways, and a role the table has
   >   not placed is **unplaced, not demoted**" — means an unlisted role is already admitted rather
   >   than excluded. **So the columns were never exhaustive and these entries were describing that,
   >   not owing it.** They become notes.
   > - **Never debt HERE — four RELATIONS, re-pointed to the new item 11.** Row 9's _"the counterparty
   >   echoing the value back"_, row 16's _"the party the instrument is issued TO, echoing its number
   >   back"_, and row 11's _"the performing role"_ twice — whose own `owedTo` **already says** _"Not
   >   fixed — it is whichever role performed the act the charge is for, so it varies by charge"_, so
   >   one of the ten entries states in its own text that a vocabulary cannot close it. These name a
   >   party **by its relation to the fact**, which is what §4's `AuthoritativeHolder` holder **kinds**
   >   exist for — and the standing columns took only role **names**. That asymmetry is item 11.
   >   **(Item 11 is now CLOSED — see it for the three entries it owned, the fourth it never did,
   >   and the empty emitted diff. This bullet's parenthesis used to list four of the union's nine
   >   kinds as if they were all of them; the list is deleted here rather than extended, because
   >   the type is the enumeration and prose beside it only ever rots.)**
   > - **Still owed to THIS item, both on `secondary` grade:** row 8's **warehouseman** and row 11's
   >   **tariff owner**. See below.
   >
   > **§2's addition test, applied per name, gives five outcomes where the item assumed one.**
   >
   > - **Already members; what was owed is a DEFINITION, not a member:** `accountParty`,
   >   `weighMaster`.
   > - **A name this document fixed and the enum did not carry:** `goodsOwner`. **Closed** — see §2's
   >   annotation. Breaking, and the catalog's first breaking release.
   > - **Fails the test, and failing it is a refusal rather than a backlog item:** **`Trusted
Agent`** — _"a named individual expected to be very familiar with DoW processes and readily
   >   accessible to DoW PPA"_ (HHG §B.17.b), an escalation contact disclosed in DPS, asserting
   >   nothing; and **`Claims Manager`** — _"a named role the TSP must **declare in the DPS
   >   Qualifications module**"_, a disclosure requirement, and claims are A11's. A role named by a
   >   regulation as a party to a transaction is not thereby an asserter — the distinction
   >   `weighMaster`'s near-miss turns on (`R1 Party to Receive Scale Ticket` is the ticket's
   >   recipient; §375.519(a) puts the signature on its author) and the one §5 row 6's note states
   >   ("the weigh master supplies the **evidence**, not the assertion").
   > - **A SECOND AXIS, not members — re-pointed to item 4.** `src:cfr-49-375` **§ 375.205** is this
   >   item's only other primary captured witness and it defines both agent types by **on whose
   >   behalf** and **under what agreement**, never by function: a _prime agent_ "provides a
   >   transportation service **for you or on your behalf**, including the selling of, or arranging
   >   for, a transportation service… under the terms of an **agreement or arrangement** with you",
   >   with (b) a signed written agreement and (c) 24-month retention; an _emergency or temporary
   >   agent_ is the same minus the selling. **A prime agent may be a `booker`, an `originAgent` or a
   >   `hauler`**, so these cut across the functional names and `primeAgent` in `ROLE_NAMES` would be
   >   **two axes in one enum** — what [shared §1.1](00-shared-decisions.md)'s "no second
   >   classification axis" and **A8-NAME-1** exist to prevent. `Designated Agent` (_"appointed to act
   >   **in place of the customer**"_, by power of attorney, `src:dp3-400ng` Definitions p.11) and the
   >   **Move Management Company** (_"on behalf of a SCAC"_, and _"may not be named as the origin
   >   servicing agent"_ — an exclusivity rule, which is item 5's) are the same shape from two other
   >   sources. **Item 4 already names § 375.205 as "material [that] exists and is unused"**; this
   >   round hands it the rest.
   > - **Defined only by EXCLUSION, so not definable from what is read:** **`broker`**.
   >   § 375.205(a)(1) says _"A prime agent does **not include** a household goods broker or freight
   >   forwarder"_ and `src:dtr-part-iv` has _"carrier's agent **explicitly distinguished from** a
   >   broker"_. Both say what a broker is **not**. A member minted from a negative would be ours —
   >   [shared §0](00-shared-decisions.md).
   >
   > **The government offices are not a missing name; they are a question about a decision §2 already
   > took and marked authored.** §2's addition table folded PPSO/PPPO/TO into **`accountParty`** with
   > _"Sourced that the party exists and decides things; **[ORIGINAL]** that it is **one role rather
   > than three**"_. So this sub-list asks whether to **unfold** a published member, which is
   > `reinterpretedMember` and **not additive** — and there is evidence for unfolding:
   > `src:dtr-part-iv` A-406 §B.8's **Maintaining vs Responsible PPSO** split, which its analysis
   > calls _"a genuinely good idea: account ownership and geographic ownership are different roles
   > over the same lot, with a mandatory copy-everyone protocol"_. **Left owed deliberately**, because
   > unfolding a member in the same release as a role rename would put two breaking changes in one
   > version with one argument between them.
   >
   > **What stays owed to this item, and why neither closes by effort.**
   >
   > - **The NTS warehouseman** (row 8's authoritative, and the one overlap between the list and the
   >   debt). Three readings and they do not agree: this item asks whether it is ADE's `SITAgent`;
   >   `authority-table.json` already writes them _"separately rather than fused by assumption"_; and
   >   element 98 keeps **three** codes apart (`WH Warehouse`, `8F Bailment Warehouse`,
   >   `NS Non-Temporary Storage Facility`), which its capture calls _"evidence toward a split; not a
   >   decision, which is A8's"_. The **duty** is sourced — `src:dp3-400ng` Item 17.12 requires
   >   **both** TSP and warehouseman to hold each article's condition at receipt and at forwarding —
   >   but on `secondary` grade, that source having no `captured/`.
   > - **The tariff owner** (row 11's `RATED`). Element 98 names the function — `TI Tariff Issuer`,
   >   also `CO Ocean Tariff Conference` — and its capture records that what blocks the member is
   >   §2's addition test, which this round applied and could not settle: **X12 naming a function is
   >   not X12 asserting a fact**, and no read source shows a tariff issuer asserting anything about
   >   a shipment.
   >
   > **The grade line, which splits this item along a boundary its prose does not draw.** Its two
   > **primary captured** witnesses are `src:dcsa` (the one member added) and `src:cfr-49-375` (the
   > material re-pointed to item 4). Every remaining candidate — the government offices, the
   > warehouseman, `TSP for Carriage`, `Move Management Company`, `Trusted Agent`, `Claims Manager`,
   > `Designated Agent` — rests on `src:dp3-400ng`, `src:dtr-part-iv` or
   > `src:dp3-tender-of-service`, **none of which has a `captured/` directory**. That is legitimate
   > (most of the existing cast rests on `secondary` too) and it is why §10 gains a row rather than
   > why anything was refused.

3. **Person vs organisation vs crew-member grain.** `src:milmove-mymove`'s `MTOAgent` is a _person_
   (`RELEASING_AGENT`/`RECEIVING_AGENT`); `src:atlas-world-group-api`'s `OnSiteStaffMember` carries
   `role_ID`/`role_Description` bound to specific `stop_Number`s (column names); `src:sirva-ade`'s
   `Resource` fuses companies, people and **equipment** (`Tractor`, `Trailer`) into one `Type` enum;
   `src:dp3-tender-of-service` NTS §1.4.13.1 requires an **NTS TSP company official** — a named
   individual, not the company — to sight-verify firearms within 72 hours. §7.3's "releasing and
   receiving parties" is written at company grain and A8 must decide whether the _individual_ who
   signs is a distinct asserter.

   > **DECIDED 2026-10-09. The individual who signs is NOT a distinct asserter, the branch grain
   > closes with it, and one residue is left that this item did not predict.** Catalog stays
   > **0.6.4**: the decision emits nothing, which is itself the finding.
   >
   > **The answer.** A party's grain — person, company, office, branch — is a property of **what
   > identifies it** and of **the role it asserts under**, never of the party. No
   > person/organisation field, no second aggregate kind. The gate is
   > `AsserterGrainIsNotOnTheEnvelope` in `src/rules/authority.ts`, with a second half
   > (`AsserterIsExactlyAPartyAndARole`) because the obvious single gate's tamper **passed** — an
   > added **optional** member keeps `Exact<>` true in both directions, and only the key-set
   > comparison catches it. `tests/conformance/party-grain-refuses.ts` holds the second candidate
   > shape, a `person` aggregate kind, which no type over `AssertedBy` can see.
   >
   > **[ORIGINAL]**, as one step past §3(a). §3(a) makes role "an attribute of the _assignment_,
   > never of the party"; the step is that the **grain** is likewise a property of the identifier
   > and the role. No source states it.
   >
   > **Correction to this item's own list, and it is the same defect §9 item 1 had: it omits the two
   > sources that decide the question.**
   >
   > 1. **`src:stedi-x12-reference` element 98 — which this corpus had already read, for item 2.**
   >    Its own definition is this item's question in one sentence: _"Code identifying an
   >    organizational entity, a physical location, property or an individual"_ — the four grains,
   >    named by the publisher — over **one flat table with no class column** (`D1 Driver` beside
   >    `CA Carrier` beside `BA Battery` beside `SF Ship From`). The four-way sort in
   >    `captured/stedi-element-98-party-roles-notes.md` is **ours**, and
   >    [shared §0](00-shared-decisions.md) forbids publishing it. **So the one industry list that
   >    enumerates party slots is the list that publishes no axis to tell the grains apart.** Item 2's
   >    annotation handed element 98's evidence to three other questions and not to this one.
   > 2. **`src:cfr-49-375` § 375.103 — the corpus's only source that _defines_ party classes, and
   >    the only primary captured one. It classifies by FUNCTION.** _"**Individual shipper** means
   >    any person who— … (3) **Owns the goods** being transported; and (4) **Pays his or her own**
   >    tariff transportation charges"_; _"**Commercial shipper** means any person … **who is not the
   >    owner** of the goods … but who assumes the responsibility for payment … for the account of
   >    the beneficial owner"_; _"**Government bill of lading shipper** means any person whose
   >    property is transported under … a government bill of lading"_. The axis is who owns and who
   >    pays. All three definienda are _"any **person**"_, a word that same section uses for
   >    companies — _"any **person** considered to be a household goods motor carrier"_ — and the
   >    only natural-person marker in it is the pronoun in _"his or her own"_.
   >
   > And **this item's one captured witness is the wrong witness for its own question**: `MTOAgent`'s
   > swagger reads _"the shipment this agent is **permitted** to release/receive"_, a permission named
   > in a value. Milmove's records that put an individual in an **asserting** position —
   > `SignedCertification {SubmittingUserID, Signature, Date}` and `EvaluationReport {OfficeUserID,
ObservedDeliveryDate, ViolationsObserved, SeriousIncident}` — go unnamed here.
   >
   > **The three remaining sources split nothing a party carries.** `src:sirva-ade`'s `Owner ∈
Corporate | Agent | Vendor` is an **affiliation** class whose three values are all
   > organisations, so the grain in the one grade-A contract is carried by `Type` alone (`Driver` a
   > person, `Tractor`/`Trailer` equipment, the nine agent roles companies) — which is §3(a)'s
   > finding from a second direction. `src:atlas-world-group-api`'s `CompanyModel`/`ContactModel`
   > (`openapi/agents-v1.json`) is a **directory** with `role_ID` an unlisted integer — §3(b)'s
   > "structural evidence only", C2=1 — and `OnSiteStaffMember`'s `personnelName` is a string, not a
   > reference. `src:dp3-tender-of-service` is a noun phrase.
   >
   > **What the measurement found behind the question, which is the transferable part: wherever a
   > source puts an individual in an asserting position it attaches them to an organisation in the
   > same breath, and NEVER by a reference the model could read** — dp3 in a noun phrase, milmove in
   > its own schema's mandatory FK (`OfficeUser.TransportationOfficeID`), SIRVA as a three-valued
   > class. The one asserting individual with no organisation behind them is the **customer**, and
   > that is not an omission: `src:cfr-49-375` makes the goods owner's signature constitutive — at
   > §375.503(c) and §375.401(h), both **mutual** — which is why §2 already carries the role and §5
   > row 5 lists it **competing**. **A natural person is a party here.** What is refused is a field
   > saying so.
   >
   > **Two things that close with this item, and one that does not.**
   >
   > - **The branch grain (§9 item 1's second residue) CLOSES, on a row the scheme table already
   >   carried.** `agentCode` is _"a 7-digit hierarchical agent id whose **trailing three digits are
   >   the branch**"_, `definedNotMerelyNamed`, `identifies: party`. So **a branch is a party**,
   >   because the identifier that identifies it identifies a party.
   >
   >   **`gbloc` corroborates and does not carry it, and the first draft of this annotation had that
   >   wrong.** Its `src:dtr-part-iv` witness glosses it _"the identity of the **OFFICE**, and the
   >   scope unit for suspensions and blackouts"_, which reads like the closure outright — but its
   >   `src:dp3-400ng` witness, **on the same row**, says responsibility for a GBLOC _"can be
   >   transferred between offices with an effective date"_, and that is precisely what
   >   [shared §7.2](00-shared-decisions.md) sources the identifier's effective interval from. An
   >   identifier that migrates between offices does not identify an office the way a SCAC identifies
   >   a carrier; it identifies something an office **holds** for an interval. **This is the party
   >   round's §4 lesson landing on this round** — a citation is two claims, that the text says this
   >   and that the text is right, and the counter-evidence was on the same JSON row the whole time.
   >   Both witnesses are now asserted in `identity-schemes.test.ts`'s item-3 block, so the office
   >   gloss cannot be quoted without the transfer.
   >
   > - **`legal name`'s third blocker FALLS; its first two stand.** The third was "`Resource.Name`
   >   names a company, a person or a tractor — a party must be defined before it can be named". It
   >   is explained: SIRVA's one `Resource` kind **spans our `party` and our `resource`**
   >   ([shared §1.2] has driver and crew member in `resource` already), with the grain on its
   >   `Type`. Standing: the **disjunction** (legal **or** trade/DBA, two vocabularies under I-KEY)
   >   and the **bundled physical address** with no `place` aggregate. **Nothing was minted.**
   > - **The hierarchy does NOT close**, and now has a second claimant. It is a party-to-party
   >   relation no `AssertionType` holds — and A8-SELF's residue below wants the same relation.
   >
   > **The residue this item leaves, which it did not predict: Rule A8-SELF is under-determined.**
   > §3(a) states its purpose at **legal-entity** grain — _"one **company** agreeing with itself"_ —
   > and `corroborationIsIndependent` is `!==` over two `PartyId`s. But `assertedBy` carries one
   > `PartyId` for all eighteen roles, and under `role: 'driver'` that party is _"the person
   > driving"_. **So a hauler's driver and that same hauler's office, both asserting `condition` at a
   > boundary, pass as two independent parties** — §3(a)'s own defect, one level up. It is recorded
   > and not fixed, because the fix needs the person→organisation link as a reference and the
   > measurement above is that no source publishes one. It is **not** an argument for unifying the
   > `PartyId` brand: this compares two references, which is the shape §9 item 1 already measured.
   > `TODO([A8 §9 item 3])` in `src/rules/authority.ts` is where it lives.
   >
   > **And two markers moved rather than being deleted.** `authorityToDeclare`'s read
   > `[A8 §9 items 2-3, 5]` and now reads `[A8 §9 items 2, 5]` — comparing ROLE NAMES is not a
   > deficiency this item was going to fix, it is reading the surface the grain is on. `custody.ts`'s
   > `CustodyHolder` read `[A8 §9 items 2-3]` and now reads `[A8 §9 item 2]` alone: the union's two
   > arms differ in what they REFER TO, a role-holding versus a party, not in what grain of party
   > they mean. The item does not leave either module — it moves to the marker it actually blocks.

4. **Delegation and on-behalf-of.** §7.2 states that liability does not move; it does not model the
   chain that holds it.

   > **ENLARGED 2026-10-09 by §9 item 2, which measured this material and found it is yours, not
   > its.** § 375.205 defines a _prime agent_ and an _emergency or temporary agent_ by **on whose
   > behalf** they act and **under what agreement**, never by function — "provides a transportation
   > service **for you or on your behalf**… under the terms of an **agreement or arrangement** with
   > you", with (b) a **signed written agreement** and (c) **24-month retention**. A prime agent may
   > be a `booker`, an `originAgent` or a `hauler`, so the split is a **second axis** over the role
   > names and not two more of them; putting `primeAgent` in `ROLE_NAMES` would be two axes in one
   > enum. **Three more sources carry the same shape and arrive here with it:**
   > `src:dp3-400ng`'s **`Designated Agent`** ("appointed to act **in place of the customer** to
   > coordinate with the PPSO for shipping, monitoring SIT, **or receiving the customer's property**",
   > by legal power of attorney — Definitions p.11), `src:dp3-tender-of-service`'s **Move Management
   > Company** ("on behalf of a SCAC"; and it "**may not be named as the origin servicing agent**",
   > which is an exclusivity rule and item 5's), and `src:dtr-part-iv`'s **TSP → subcontractor**
   > pass-through. **So this item now owns the corpus's clearest delegation material, and the
   > `[SD §1.1]` "no second classification axis" argument is the reason it cannot be discharged by
   > adding role names.**

   Material exists and is unused: `src:cfr-49-375` §375.205's written prime-agent
   agreement retained 24 months; `src:dp3-tender-of-service` §B.3.f-g and the MMC bar;
   `src:dp3-400ng`'s TSP → subcontractor pass-through (Introduction pp.15-16); `src:dcsa`'s `isFYI`
   flag, which the DCSA analysis correctly describes as the _only_ on-behalf-of signal there is
   ("no delegation or on-behalf-of model beyond `isFYI`"). `src:sirva-ade`'s `SelfhaulIndicator`
   (GSD p.8) is the one published bit that says whether the booker will haul or surrender.

5. **Role cardinality and exclusivity.** How many `Hauler`s a shipment may carry at once; whether two
   `DestinationAgent`s can coexist; what `A8-SELF` implies when one company holds three roles. ADE's
   analysis records that assign/remove events give a real membership lifecycle with **"no
   cardinality/exclusivity rules stated"** (A8 C3=2). Nothing in §5 depends on the answer; §4's
   `authoritative roleRef[]` is a list precisely so that A8 can widen it without reshaping the record.
6. **The party as a notification target.** `src:dp3-tender-of-service`'s 43-row obligation catalogue
   is _trigger → responsible party → deadline → system of record → consequence_, and
   [shared §6.5](00-shared-decisions.md) requires corrections to emit obligations naming **who must
   be told**. Nothing here resolves a role to a contactable address. Note the sourced anti-pattern A8
   must preserve when it does: `src:dtr-part-iv` A-402 §F.8.d NOTE p.31 **forbids the TSP from
   updating the customer's e-mail address after pickup** because of a conflict of interest — a
   field-level write permission justified by _incentive_, not by ownership, and a shape no
   role-based scheme will produce by accident.
7. **Authority over money beyond §5 row 11.** Revenue allocation is a different question from charge
   assertion: `src:sirva-ade`'s `TransRevenue` is "distributed according to allocation rules to
   Origin Agent, Hauler, Destination Agent, SIRVA" (ABS p.3), with the **payee carried on the line
   item keyed by service** (`Driver1Code`/`Driver2Code` "only present when the Service Code value
   reflects HAULING", ABS p.4); `src:atlas-world-group-api` names `AgentRole`/`AgentGroup`/
   `DistributionMethod` endpoints (bodies not opened). **That is A13's**, and §5 row 11 must not be
   read as settling it.
8. **Fact classes §5 does not cover — and the two reasons it does not, which this item used to
   conflate.** It read as a to-do list, implying every missing row was simply unwritten. It is not.

   **(a) Five rows are now written**, because the corpus supports them: `handover` (row 12, closing
   **F3**), `weight.gross` and `weight.tare` (rows 13-14), **packing performance** (row 15) and
   **piece count** (row 16). Piece count and packing performance were named in this item's own list.

   **(b) Twelve rows are blocked on the corpus, not on this document's effort**, and writing them
   would move the count without moving the capability — [shared §4.7](00-shared-decisions.md) note 3
   and §10's last row both bar a **provisional** reading from scoring a dependent decision, so an
   [ORIGINAL] row closes nothing. The blocked twelve are the plan-, binding- and commitment-side
   lifecycle acts:

   - `tripDelay`, `tripResequence`, `tripCancellation` — blocked for a **different** reason from the
     other nine, and the plainest one: [shared §4.7.1](00-shared-decisions.md) states outright that
     **"no source in the corpus binds a plan change to an asserting role"**. Their provisional reading
     is role-based ("the `Hauler` holding the trip, or the `Booker` where it dispatches"), so nothing
     about `context[]` or a qualifier stands in the way — there is simply no evidence.
   - `membershipOffer` / `Response` / `Release` and `assignmentOffer` / `Response` / `Release` —
     [A3 §7]'s own confidence table rates the membership lifecycle **"Low-to-medium — ORIGINAL,
     seeded"**, because Atlas's two-status-per-service is "structural evidence only (C2=1)" and
     Alvys's `Stops[].Status` "is never enumerated".
   - `orderAward` / `orderResponse` / `orderCancellation` — **corrected by
     [`A1` §Cross-area](A1-order-service-lifecycle.md), and these three are no longer part of the
     blocked-on-the-corpus set.** This item used to read: _"the lifecycle is [`fork-order` §3.1]'s;
     no source in the corpus attaches an authority to it."_ A1 read the corpus for exactly that and
     the sentence is **too strong in one direction and not specific enough in the other**. See
     (b-i). The count of corpus-blocked rows is **nine**, not twelve.

   **(b-i) The order lifecycle, in three lines rather than one — [`A1` §Cross-area].** A1 wrote no
   row and this item asks for none; what follows is the corrected reasoning, and the question it
   leaves is a **schema** question rather than a research one.

   1. **The corpus does attach a party to every order transition.** `src:dtr-part-iv` A-402 §C-§F
      names one on every edge — the TSP accepts, refuses and turns back; the PPSO cancels and pulls
      back; `src:atlas-world-group-api` captures `bookedBy`, `accepted_by`, `cancelledBy` **and**
      `cancelRequestor` on the order record; `src:milmove-mymove` **enforces** which actor may make
      which transition; `src:project44` says a booking may be cancelled "due to actions caused by
      **either party**". That is **permission**, not assertional authority — but it is the same kind
      of material §10 says rows 1-5, 8 and 11 were built from: "converting a recording duty into
      assertional authority is authored in every one of them".
   2. **The `context[]` argument does not reach a fixed-role row.** DTR's actors are fixed **by the
      transition kind**, not read off the record, and §5 row 11 is the published precedent for a
      literal role in `authoritative` — `DECIDED` names `accountParty` with no fold and no key
      behind it.
   3. **What actually blocks them is a `boundBy` gap, and it differs per row.** §4.3 publishes six
      members and none means _"a fixed role, resolved outside this fact"_. `orderResponse` and
      `orderCancellation` resolve their role through **the order's own award** — structurally the
      same binding as `ASSIGNMENT`, one aggregate over — and this document has no member for it.
      **`orderAward` alone is blocked by this document's own mint principle** (§4.3: "`orderAward`
      mints the principal relation, so it cannot be `PRINCIPAL`"), and `KEY` cannot rescue it
      because its actor is in `context[]` rather than in a qualifier. For that one row the original
      sentence was exactly right.

   **The open question was: does §4.3's table need a seventh member? It does, it has one — `AWARD`
   — and it closed ONE row rather than two.** That is this document's own expectation corrected, and
   the correction is the useful part.

   - **`orderResponse` closed**, at §5 row 18. [`A1` §3.5](A1-order-service-lifecycle.md) puts
     acceptance **and** refusal on _"the offeree, and only the offeree"_, so the holder is singular
     and resolved by the award. Nothing else was owed under it.
   - **`orderCancellation` did not.** Its **binding** is `AWARD` and is no longer owed — the award
     resolves the candidate set — but its **holder** is plural. [`A1` §3.5] gives the awarding role
     the pull-back before any response, makes a cancellation after acceptance _"**either party** —
     the distinction is the attribution, not the permission"_, and puts a refused cancellation on
     _"the **counterparty** of whoever requested it"_. Under §4.4 **A8-NAMED** a plural
     `authoritative` makes a tie-break **mandatory**, and no source publishes one.
     [`A1` §8] scenario 7 reaches the same place independently and calls it _"the honest state"_, and
     [`A1` §3.5]'s open defect is underneath it: on a **completed** cancellation —
     the ordinary case — [shared §2.3](00-shared-decisions.md) invariant 2 forbids `reasons[]`, so
     the field [shared §4.7.2e](00-shared-decisions.md) item 2 puts the requestor on does not exist.
     The row stays owed with its blocker **repointed**, which is a narrowing and not a no-op: a
     reader must not re-open the schema question on it.
   - **`orderAward` is blocked harder than before, not less.** It mints the award, so §4.3's mint
     principle now rules out `AWARD` for it as well as `PRINCIPAL`. The principle was stated three
     times in prose and gated nowhere; `MintingActsAreNotBoundToWhatTheyMint` holds all four pairs
     over the table, so a later round that reads "the order rows close with `AWARD`" and sweeps this
     one in fails by name.

   **And [`A2` §3.6](A2-shipment-structure.md)'s `shipmentCommitment` is in `orderCancellation`'s
   position rather than `orderResponse`'s**, which is the second half of the same correction. Its
   own text says the asserter is _"the party that awarded **or** accepted the order"_, and its three
   sources answer differently: `src:sirva-ade`'s `Register` is pushed by the awarding side,
   `src:milmove-mymove` runs a two-actor submit-then-approve protocol, and `src:cfr-49-375` has the
   **carrier** name and price the lot. So §3.6's _"blocked by exactly the gap A1 found … and by
   nothing else"_ is too strong: the enum gap is closed and **who commits** is not.

   **Two worked cases A1 handed over with the correction.** `src:dtr-part-iv` §C.4.a permits refusal
   **only** for a short-fuse or shortened-transit shipment — the same record by the same role,
   authorised or not depending on a property of the thing it is about, which is the cleanest
   published **A8-UNAUTH** case in the corpus (§8).

   > **WITHDRAWN 2026-10-10 — the second half of this paragraph is deleted, not softened.** It read:
   > _"And `src:dcsa`'s JIT `classifierCode` binds an assertion class to a role verbatim — `EST`,
   > `PLN` and `ACT` can **only** be used by the **Service Provider** … `REQ` is **only** to be used
   > by the **Service Consumer** (`jit/v2/JIT_v2.0.0.yaml` L3554-3585). It does not overturn
   > [shared §4.7.1](00-shared-decisions.md)'s 'no source in the corpus binds a **plan change** to an
   > asserting role' — a planned time is not a plan change — but it was not cited when that sentence
   > was written and it is where to look first."_
   >
   > The bytes are unrecoverable (§4's annotation; `[A8 §10]`;
   > `sources/dcsa/captured/swaggerhub-jit-successor/README.md`), so it can no longer be offered as
   > the corpus's statement that an assertion class binds to a role. **The consequence is the
   > opposite of what the withdrawn text said:** `[SD §4.7.1]`'s _"no source in the corpus binds a
   > plan change to an asserting role"_ stands **unqualified**, and so does the stronger reading —
   > as captured, no source binds an assertion **class** to a role either. The captured constraint
   > binds the classifier to the **event type** (§4), which is a different axis. **Nobody should
   > "look there first"; there is nothing there to look at.**

   **Why `KEY` does not rescue the remaining nine, which is the finding worth keeping.** §4.3's new member reads
   the role off a fact's own **qualifier**, and **six of the nine** — the membership and assignment
   offer / response / release families, everything above except the three `trip` rows — name their
   actor in **`context[]`** instead — "the offering and responding `partyRole`s" and "the
   `partyRole` the resource is offered to". (The order family's "the awarding and the responding
   `partyRole`s" is the same shape and is why `KEY` does not reach `orderAward` either, but the
   order rows are now (b-i)'s.) [Shared
   §1.4](00-shared-decisions.md) rule 1 forbids resolution from keying on `context[]`, and moving
   those names into a qualifier is a **`changedQualifierShape`** — breaking, a new major under
   [catalog §2.3]. So the provisional two-sided reading §4.7.1 carries has no legal mechanism, and
   that is why it says **"Do not score on this"** rather than why nobody has got round to it.

   **(c) Still genuinely not reached, and not record types at all:** cube, survey/estimate facts,
   ETA, seal integrity (`src:dp3-tender-of-service` #39-40 has a full actor/deadline model for it),
   tracer results, claim facts, and every A10/A11 class. These are
   [shared §4.7.3](00-shared-decisions.md)'s **absent fact classes** — no `type` exists to carry
   them — which is a different list from the owed rows above and is kept separate deliberately.

   **(d) Two rows are blocked on this document's own §9:** `partyRole` on items 1-2 (the party entity
   and the role enum are both undefined) and `notification` on item 6 (nothing here resolves a role
   to a contactable address). Those are owed to A8, and they are the only two that are.

   **(e) And one absent class arrived with its authority already answered — a category added by
   [`A6` §3.3](A6-documents-evidence.md), and the only one this document has CLOSED.** A6 ran [`A2`
   §3.6]'s check over the `document` aggregate and found the same shape: no row of
   [shared §4.7.1](00-shared-decisions.md) recorded a document being issued, signed, corrected or
   cancelled, and `document` appeared in that table only in six `context[]` columns. So
   **`documentIssuance`** joined (c)'s absent list — but **not** on (c)'s terms, because its
   authoritative role was determinable **today** from a member §4.3 already carried. **§5 row 10**
   binds `identity` with `boundBy = SCHEME`: _"the ISSUER of the scheme, and nobody else, for the
   value under that scheme. Authority NEVER moves."_ [A6 §3.2] establishes that for the one document
   kind in the corpus with a scheme of its own — the bill of lading — the party controlling the number
   scheme **is** the party issuing the instrument, in both published regimes: `src:dtr-part-iv` A-413
   §C.2 accounts for BL numbers as stock assigned to the form and audited, while `src:cfr-49-375`
   §375.505(a) has the carrier issue its own and §375.103 defines a `Government bill of lading
shipper` separately from a `commercial shipper` — two instruments, each issued by the party whose
   instrument it is.

   **A6 was therefore not asking this document for research; it was asking it to accept a reading.
   The reading is accepted and the row is written: §5 row 17**, 2026-10-05. It cites row 10's own
   `ISSUER-OF-SCHEME` v1 and mints no rule, because a second `ruleId` would claim a second rule and
   there is not one. Its confidence is **medium** rather than row 10's **high** for §10's stated
   reason: row 10 is a citation and this row is one duty-to-authority conversion away from it.
   **`documentIssuance` has left [shared §4.7.3](00-shared-decisions.md)'s absent list**, which is
   the first entry to leave it by being minted. The **signature** did not come with it and was never
   part of it ([A6 §3.3(b)]): no source publishes what a signature asserts, and [A6 §6] owes it to
   the user.

   **So the ledger separates four reasons a row can be missing, and one of the four is now empty.**
   The corpus does not bind one (the nine of (b)); A8 itself owes the party (the two of (d));
   **§4.3**'s `boundBy` enum has no member for _the role resolved by the order's own award_
   ([`A1` §Cross-area](A1-order-service-lifecycle.md)'s two and
   [`A2` §3.6](A2-shipment-structure.md)'s one); and **minting alone** — this one, where nothing was
   owed underneath either row, and which no row is now waiting on. A6 also takes this document's
   `Instrument.grants` TODO rather than sharpening it: [A6 §3.6] mapped Table A-402-4's eight rows
   and found **four of the eight fields are not facts the model carries at any grain**, so the
   sub-fact grain the TODO asked for would move none of them.

9. **`src:stedi-x12-reference` element 98 is still unread**, and it remains the one list that would
   let our role vocabulary be checked against an industry one. Stedi's own open question 1 flags it
   as blocking A8; [shared §10.3 item 13](00-shared-decisions.md) requires the fact to be recorded at
   the point of use. It is recorded here, in §2, and again now. Related and also open: stedi's open
   question 5, _"How do we represent custody transfer — one event or two?"_ — §7.6 answers **two**
   (the `J1`/`R1` shape), but that is our answer, not stedi's. **That answer is upheld and now has a
   mechanism rather than only a worked example:** [shared §4.7.2f](00-shared-decisions.md) gives
   `handover` the qualifier `{releasing, receiving, side, occurrence?}`, so the two sides key
   differently and are two facts by construction. It is still our answer.
10. **Consent and disclosure roles.** `src:dp3-tender-of-service` §B.18.a's **Safety Move** — origin
    and destination must not be disclosed outside one named person "**who may not be the customer**" —
    and `src:dtr-part-iv`'s **BLUEBARK** (direct delivery not authorized, the BL annotated) are
    authority rules about _who may be told_, which is a third axis this document does not touch.

**And the explicit non-goal.** This document does **not** settle the cross-dock dwell (A5), the
reason vocabulary's content (A4), or shipment identity across SIT termination and reshipment (A2/A5,
[shared §10.4](00-shared-decisions.md)). _Canonical subjects per fact class have come off this list:
they are settled, at [shared §4.7](00-shared-decisions.md) — not here and not by A3/A4 — and §5's
subject column now quotes that declaration rather than assuming one._

---

11. **The standing columns take role NAMES; `authoritative` takes holder KINDS.** **Minted
    2026-10-09 by §9 item 2**, which went looking for role names and found that four of the ten
    `owedTo` entries citing it name a party **by its relation to the fact** rather than by a role:
    row 9's _"the counterparty echoing the value back"_, row 16's _"the party the instrument is
    issued TO, echoing its number back"_, and row 11's _"the performing role"_ twice — the latter's
    own `owedTo` already conceding _"Not fixed — it is whichever role performed the act the charge
    is for, so it varies by charge"_.

    > **CLOSED 2026-10-10, and the catalog is not re-cut.** The three standing columns now take
    > `StandingHolder` — `AuthoritativeHolder` **extended**, not a second union beside it — and the
    > three entries this item actually owned are listed rather than written into a row's `note` as
    > prose. **The emitted diff is EMPTY** (all four `catalog/*` files byte-identical against the
    > pre-round build, `$defs/AuthoritativeHolder` still nine members), so `0.7.0` stands: the
    > standing columns were never on the wire, which is the same finding that made this round
    > additive rather than the second breaking release in a row. Only `context-map.md` moved.
    >
    > - **Rows 9 and 16 are ONE relation, and row 16's own §5 cell said so** (_"which is row 10's
    >   echo one aggregate over"_). Both now carry the **`schemeCounterparty`** member: _the party
    >   the value was issued TO, echoing it back_. **Primary and captured** — `src:dcsa`'s
    >   `references` field, _"provided by the shipper or freight forwarder … **Carriers share it
    >   back** when providing track and trace event updates"_ (`event_domain_v3.2.0.yaml:2082`, and
    >   the same string in nine further captured files). **The direction is the finding**: the
    >   provider issues, the party provided-to echoes — so the designation picks out one determinate
    >   party from the scheme, exactly as `schemeIssuer` does from the other end, and it is not
    >   "whoever agrees", which is what would have made it a complement. §10 carries the exposure:
    >   the one primary witness is one publisher in an adjacent domain, as `visibilityProvider`'s
    >   was.
    > - **Row 11's `competing`** carries `performingRole` — the kind this row's own `PROPOSED`
    >   aspect has held since §4 was written. Nothing was missing but a column that could hold it.
    > - **Row 11's `PROPOSED` entry was never this item's, and was never debt.** §9 item 2
    >   re-pointed it here with the boilerplate it gave the other three, and that boilerplate argues
    >   _"corroborating/competing/advisory take `RoleName[]`"_ — but `PROPOSED` is on the
    >   **authoritative** column, which has taken holder kinds since §4. It was already closed in
    >   the typed table, and its own `owedTo` already said "Not fixed" before either round touched
    >   it. **The item was minted at four entries and owned three.**
    >
    > The echo member is deliberately **not** in `AuthoritativeHolder`, and
    > `TheEchoIsNotAnAuthoritativeHolder` holds it out: that union is emitted, a `competing` holder
    > can be selected under a named value rule and so reach `FactResolved`, and a corroboration on
    > two rows whose authority never moves can never be. Publishing a member no wire position can
    > hold would be a promise with nothing behind it.

    **§4 already solved this on one side.** `AuthoritativeHolder` is a union of holder **kinds** —
    `role`, `custodyHolder`, `legAuthoritativeAsserter`, `schemeIssuer`, `performingRole`,
    `releasingRoleAcrossTransferGap`, `keySideRole`, `awardedRole`, `owedRole` — precisely so that
    `authoritative` can name a party the table cannot enumerate. The `corroborating`, `competing` and
    `advisory` columns took `RoleName[]` and nothing else, so a standing that depended on the fact
    had nowhere to go. **What was owed was the same treatment one column over**, and it was a shape
    question rather than a vocabulary one: §9 item 2's role enum could not have closed these however
    complete it got.

    > **That nine-member list is itself a correction.** This paragraph named **four** of the kinds
    > as though they were all of them, and the same four-name list had reached §2's annotation above
    > and all four `owedTo` strings in `authority-table.json` — a stale list propagating by being
    > copied, which is what prose naming a type's members does when nothing compares it to the type.
    > `StandingHolderKindsAreExactlyThese` now does compare them.

    **Not to be confused with the two COMPLEMENTS** — _"the non-inspecting parties"_, _"everyone
    else"_ — which need nothing: [§4.1](#41-the-four-standings)'s note 1 makes an unlisted role
    "unplaced, not demoted", so those columns were never exhaustive and saying so is not a debt.
    Conflating the two is how four relations and two complements spent five releases filed as one
    item's vocabulary problem. **The distinction survived the closure and is now gated**:
    `standing-holder-refuses.ts` refuses a member spelled for either complement, and refuses the
    **tariff owner** separately again — a missing _name_ is `owedRole` carrying an `Owed<>`, never a
    bare kind, and that payload is the whole difference between it and `performingRole` one aspect
    over.

## 10. Confidence

| Item                                                                              | Confidence                                                                                  | What would overturn it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§2 role naming (A8-NAME-1/2)**                                                  | **High**                                                                                    | Nothing in the corpus; the traps are documented findings and the fix is a naming discipline. Reading element 98 would add a vocabulary to check against, not reverse the rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **§3 role ⟂ ownership; role on the assignment; history not roster**               | **High**                                                                                    | Grade A, C2=3, with a worked sample (`src:sirva-ade` GSD p.17) and an explicit statement that the roster has no history (GSD p.4). A8-SELF is [ORIGINAL] but is a direct consequence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **§4.2 A8-INSTANT**                                                               | **Medium-high — [ORIGINAL]**                                                                | The three-clock distinction is sourced; keying authority to `occurredAt` is ours. It would be overturned by a published model that keys authority to recording time — none exists, but note that the partner contract we actually carry (`src:sirva-ade`) **only has** a recording clock, so implementing this requires us to supply `occurredAt` ourselves on inbound ADE facts. That is an ingest obligation, not a model defect, and it should be written down before A4 assumes otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **§4.4 A8-NAMED (no silent recency)**                                             | **High**                                                                                    | The rejection of implicit last-writer-wins is already settled at shared §4.3 on `src:gtfs`. A8-NAMED only prevents it re-entering through an empty table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **§5 the table, rows 6, 7, 9, 10** (`weight.net`, SIT entry, condition, identity) | **High**                                                                                    | These four are citations, not designs. Row 6 is three statements in one tariff plus four in the CFR; row 7 is two independent regulations from opposite directions; row 9 is four sources on joint records; row 10 is the shared layer's own `issuer` field plus DCSA's code-plus-issuing-authority pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **§5 the table, rows 1-5, 8, 11**                                                 | **Medium — [ORIGINAL] in the step that matters**                                            | Every row's _duty_ is sourced (who must record, who must perform, who must approve). **Converting a recording duty into assertional authority is authored in every one of them.** The failure mode is a role that has the duty but not the knowledge — e.g. `src:dp3-tender-of-service` puts the arrival-recording duty on the TSP, but on a consolidated van the driver knows and the TSP's office does not. If A8 proper finds a published model that separates duty-to-record from authority-to-assert, revisit these seven rows first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **§7.1 A8-MOVE (41 vs 349 as the hinge)**                                         | **Medium-high**                                                                             | The two codes and their _responsibility_ definitions are sourced verbatim; equating responsibility with assertional authority is [ORIGINAL]. It is the cheapest possible hinge — it adds no field, because `A3` and shared §8.2 already carry `custodyBasis` — which is also why getting it wrong is cheap to fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **§7.1 A8-MOVE's amendment (the receipt instant, and the transfer-gap clause)**   | **Not scored — [ORIGINAL], provisional**                                                    | Forced by [shared §4.7.2f](00-shared-decisions.md): a transfer has two instants now, so the rule must name one. Nothing new is sourced; the reasons for choosing the receipt are internal (M1, and §7.4(b)'s "never stops being authoritative for facts before the handoff"). This document has not ratified it, so [shared §4.7 note 3](00-shared-decisions.md) bars it from scoring a dependent decision at any level. What would overturn it: a published model that moves responsibility at the release, or a §5 `handover` row that decides the question directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **§5's missing `handover` row (F3)**                                              | **Not scored — owed**                                                                       | §5 has no row and the shared table now marks `handover`'s `boundBy` **owed, expressly not `CUSTODY`**. Under **A8-NAMED** every handover `FactResolved` must name a rule and there is none to name. The provisional reading — the role on the key's own `side` — is [ORIGINAL] and is sourced only in the sense that `src:stedi-x12-reference` restricts each code to one carrier. Writing the row is this document's, and it is the highest-value gap F1 left behind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **§7.2 A8-LIABILITY**                                                             | **High**                                                                                    | §B.3.f-g is unambiguous and is reinforced by three further prohibitions. This is the rule most likely to be _forgotten_ rather than disputed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **§7.3 A8-JOINT**                                                                 | **High on the need, [ORIGINAL] on the mechanism**                                           | Five sources require joint or dual records at a boundary and one states the dissent rule verbatim. What is authored is letting `FactResolved.selected` be empty. If a consumer proves it cannot tolerate an unresolved fact, the fix is a **downstream** named rule, never selecting inside the resolution — selecting there would destroy the one thing every source in this row preserves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **§7.4 A8-AFTER**                                                                 | **Medium-high — [ORIGINAL]**                                                                | Follows from A8-INSTANT, so it inherits that confidence. Its value is defensive: it is a _stronger_ answer than "authority stops at the handoff" because it needs no re-evaluation pass, and the corpus's only published behaviour here (`src:sirva-ade` dropping the replaced provider) is the anti-pattern.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **§7.5 A8-PRINCIPAL**                                                             | **Medium-high**                                                                             | The depositor substitution and its exact instant are quoted from two independent regulations; the Maintaining/Responsible PPSO split is a second axis-separation instance. The generalisation to a `boundBy` value is ours.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **§8 A8-UNAUTH**                                                                  | **Medium-high**                                                                             | Decidable, with two sourced worked cases including one where the same act flips authorisation by elapsed silence. It inherits §5's medium on the seven authored rows: an `UNAUTHORISED` verdict is only as good as the row it consults.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **§2's cast as a whole — it rests on ONE publisher**                              | **Medium-low — a new row, owed by §9 item 2 and written by it 2026-10-09**                  | Element 98's capture raised this and deliberately did not write it, because it is a judgement about the vocabulary item 2 owes: _"the cast §2 takes from `src:sirva-ade` is, as far as any read source goes, **the only household-goods role vocabulary there is**"_, and §10 _"has no row for that exposure"_ — it rates §3 High on `src:sirva-ade` grade A with a worked sample, and rates the authority **rows**, not the **cast**. The cross-walk is the measurement: of eighteen members, element 98 has a counterpart for `loadAgent`, `unloadAgent`, `sitAgent`, `driver`, `packer`, `goodsOwner` and `accountParty`, a **false friend** for `booker` (`OE Booking Office` is the ocean office), an **inverted** near-miss for `weighMaster` (`R1` is the scale ticket's recipient; §375.519(a) puts the signature on its author), and **none at all** for `originAgent`, `destinationAgent`, `hauler`, `r19Agent`, `rr19Agent`, `settlingAgent` or `portHandler`. Searched and absent across 1312 codes: `household`, `van line`, `mover`, `relocat`, `moving company`. So seven members and the two sharpest names have no industry corroboration anywhere in the corpus. `visibilityProvider` (catalog `0.7.0`) rests on one publisher too, and `weighMaster` is the precedent that §2's addition test permits it. **What would overturn it:** any read source that publishes a household-goods role vocabulary. `src:x12-transportation` is licensed and `src:nmfta-scac` is `status: skipped`, so this is not closable by effort.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`schemeCounterparty` — the echo standing on rows 10 and 17 (§9 item 11)**       | **Medium — a new row, written by §9 item 11 on closing it 2026-10-10**                      | **The exposure is the same one `visibilityProvider` was given a row for at catalog `0.7.0`, and it is disclosed here for the same reason: the member's only **primary** witness is `src:dcsa`, one publisher in an adjacent domain** (ocean container shipping). That witness is strong on its own terms — captured, and the obligation is stated outright on the `references` field: _"References provided by the shipper or freight forwarder … **Carriers share it back** when providing track and trace event updates"_ (`event_domain_v3.2.0.yaml:2082`, the same string in nine further captured files) — and **its direction is what licenses the member**: the provider issues, the party provided-to echoes, so the designation is determinate from the scheme rather than meaning "whoever agrees". **Its three corroborating witnesses are all `secondary` and do not lift the grade:** `src:nmfta-ebol`'s acceptance identifier distinct from the document identifier (its `local/` bytes are **not in the repo**, so the citation cannot be re-read here), `src:sirva-ade`'s `ExternalReference`, and `src:weichert-supplier-api`'s peer `serviceOrderNumber`. **What limits the exposure:** the member is **not emitted** — `TheEchoIsNotAnAuthoritativeHolder` keeps it off `$defs/AuthoritativeHolder`, the standing columns reach no wire, and the round's emitted diff was empty — so a consumer has nothing to unlearn if it is withdrawn. **What would overturn it:** a household-goods source that publishes the echo as a party function rather than as an API field, or a reading on which the echoer is not determinate from the scheme, in which case this collapses into a **complement** and §4.1 note 1 already covers it with no member at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **§4’s second structural precedent — its bytes are UNRECOVERABLE**                | **Low for the withdrawn claim; the re-sourced one is High — a new row, written 2026-10-10** | **The first instance in this series of a claim whose evidence is not merely uncaptured but **gone**, and it had been cited in FIVE places across three documents.** §4 claimed `src:dcsa` JIT joins **role** to tense — _"`EST`/`PLN`/`ACT` may be published only by the Service Provider, `REQ` only by the Consumer"_ — and called it _"the only place in the corpus that joins authority to anything"_; `[A8 §9]`, `[SD §1.3]` and `[A1]` (×2) cited the same bundled `jit/v2/JIT_v2.0.0.yaml` L3554-3585. **Probed 2026-10-10:** `dcsaorg/DCSA-OpenAPI` returns **404**; the standard was renamed to DCSA Port Call (`DCSA_JIT` 2.0.0 says _"Do NOT use this version"_); the only GitHub copy is from **2020** and predates JIT v2; every surviving SwaggerHub spec is **unbundled** and none carries the constraint — 2.0.0 has **no `EST`/`PLN`/`ACT`/`REQ` enum at all**. The spec was dropped from `captured/` by the 2026-09-18 _capture only what is cited_ trim **while three analyses were citing it**, and `sources/README.md`’s promised gitignored full clone did not survive in any worktree. **What was done:** the role claim is **withdrawn** (not softened) at §4 and `[A8 §9]`, struck at `[SD §1.3]` whose precedent never depended on it, and withdrawn ×2 at `[A1]`; §4’s precedent is **re-sourced and narrowed** onto the per-**event-type** constraint in captured bytes (`event_domain_v3.2.0.yaml` L778, L1231, L1328 — _"For `ShipmentEvents` the `eventClassifierCode` **must** be `ACT`"_), which says nothing about who may publish; the surviving successor specs are captured under `sources/dcsa/captured/swaggerhub-jit-successor/` with a README stating exactly what they do and do not establish (they **do** confirm `isFYI`). **The exposure that remains:** §4’s **Our step** is now larger than it was — moving a basis constraint from the event-type axis onto the **role** axis is ours, with no published precedent for the role half — and `[A8 §9 item 11]` was decided on the unrecovered reading. **It does not overturn item 11:** that round turned on §4’s holder-kind **shape**, not on the JIT constraint. **What would overturn this row:** anyone locating the bundled JIT v2 artifact, or DCSA republishing a per-publisher-role constraint in Port Call. |
| **The document as a whole, as an input to other documents' confidence**           | **Medium**                                                                                  | [Shared §10.4](00-shared-decisions.md) bars a dependent decision from scoring high until A8 is written. **This skeleton lifts that bar to _medium_, not to _high_, and only for the ten fact classes in §5.** §9 lists **eleven** items, of which **item 3 is decided, item 11 is closed (2026-10-10) and items 1 and 2 are partially closed** — so the outstanding set is items 1, 2, 4-10, and it is named rather than totalled because this very sentence has carried a stale count twice ([`A1` §9](A1-order-service-lifecycle.md)). **This sentence is corrected rather than kept:** it read "items 1, 2 and 3 in particular mean `assertedBy.partyRef` still has no schema and half the roles §5 names are undefined". `assertedBy.partyRef` **has** a target schema since catalog `0.6.4` (item 1 minted the `party` aggregate), item 3 is **decided**, and item 2 is partially closed at `0.7.0` — but the roles half stands: §5 still names roles §2 does not define, and item 2's remaining candidates all rest on `secondary` grade. A document that depends on authority for a fact class **not** in §5 gains nothing here and must still cap itself — including a class [shared §4.7](00-shared-decisions.md) marks **owed**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 11. Changed in revision — conformance to the binding layer

[Shared §10.3a](00-shared-decisions.md)'s eight items, applied. All eight are **mechanical**: not one
of them changes a finding, a rule (A8-NAME-1/2, A8-SELF, A8-HISTORY, A8-INSTANT, A8-NAMED, A8-MOVE,
A8-LIABILITY, A8-JOINT, A8-AFTER, A8-PRINCIPAL, A8-UNAUTH), or a confidence score.

| #   | What moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Shared item               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | **§7.6's worked Assertions restated on the one-axis envelope.** `factRef={subject:…, factClass:…}` is gone as a field: each record now carries envelope `subject` + `type`, and `factRef` is spelled out **only** on the two `FactResolved` records, where shared §4.3 makes it an explicit tuple. `AuthorityRule.factClass` → `type`, and §3(b)'s `factClass = party-role` → `type = partyRole`, for the same reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | §10.3a.1                  |
| 2   | **The wildcard subject `item:*` is removed.** A `SubjectRef` is `{aggregate, id}` and `*` is not an id, so under **E-CANON-STRICT** the record named no fact key and would be refused at the boundary. Restated as **one Assertion per article** by each of the releasing and receiving party — which is what §5 row 9 and **A8-JOINT** already required (_"the condition of each article"_) and what §7.6's own `FactResolved` was already doing correctly. The rule is stated generally, so it reaches any other wildcard or plural subject.                                                                                                                                                                                                                                                                                                                                                                                                                               | §10.3a.2                  |
| 3   | **§7.6's delivery moved off `subject = stop:Z`**, where it contradicted **this document's own §5 row 5** (and shared §4.7): delivery's family is `goods`, with the stop in `context[]`. Both Assertions and the `FactResolved` beneath them change subject to `shipment:S`, `context = [stop:Z]`. The type spelling is **`delivery`**; `delivery-performance` is a prose alias (shared §4.7 note 5) and must not appear in a record. **The scenario's conclusion is unaffected** — both assertions still pair on one fact key, and A's still loses under A8-INSTANT.                                                                                                                                                                                                                                                                                                                                                                                                         | §10.3a.3                  |
| 4   | **§5 row 11 takes the `{aspect}` qualifier** ∈ `PROPOSED` \| `DECIDED` \| `RATED`, so propose / decide / rate are **three fact keys** rather than three authorities contesting one — without which the derived key would put an approval into contest with an amount. The row's three-way split is the finding and does not otherwise change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | §10.3a.4 · shared §4.7.2b |
| 5   | **§5's caveat (i) now names shared §4.7 as the declaration** instead of "E-CANON and A3/A4"; the subject column names the **family**, and **all three _(assumed)_ markers are gone** — row 2 `departure` → `stop`, row 6 `weight.net` → `goods`, row 8 SIT release → `stay` (type `storeOut`). Rows 3, 4 and 5's "`shipment`, `context[]` = stop" become the family **`goods` = {shipment, portion}**; a bare `shipment` read as forbidding the Portion-subject act shared §3.3 licenses. Fact-class names are canonicalised to §4.7's spellings with the prose aliases kept in italics.                                                                                                                                                                                                                                                                                                                                                                                     | §10.3a.5                  |
| 6   | **§9's explicit non-goal drops "canonical subjects per fact class (E-CANON, A3/A4)".** It is settled — at shared §4.7, not by A8 and not by A3/A4 — so the sentence was not wrong about A8's scope but was wrong about where the answer lives.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | §10.3a.6                  |
| 7   | **`boundBy = CUSTODY` now points at something that exists in the envelope.** §4.3's row read "Authority follows the `Custody` interval (`A3` §5.2)"; there is no such entity — shared §4.8 makes custody a **projection**. It now reads: authority follows **`custodyAt(goods, instant)`** (shared §4.8.3), the named, versioned fold over the `FactResolved`-selected `handover` assertions and over `ExternallyPerformedLeg.custodyBasis`, evaluated per **A8-INSTANT** and moving per **A8-MOVE** on the selected handover's `custodyBasis`. The same substitution is applied at **§4.2** (the fold is recomputed; what is append-only is the underlying `handover` assertions), at **§7.1** (the two bases ride on records, not on an interval) and at **§7.4(c)**, which already described the fold's behaviour correctly and needed only to name it. **A8's substance does not change:** A8-MOVE, A8-INSTANT, A8-AFTER and §7.6 read the same inputs they read before. | §10.3a.7 · shared §4.8    |
| 8   | **§7.6's two `Handover` acts take shared §4.7's spelling and family:** `type = Handover` → **`handover`**; `subject = shipment:S` was already in the `goods` family and is correct. §7.6 now says outright that these two records are the fold's inputs, which is what makes item 7 checkable against a worked example — and §7.6's closing paragraph names the fold (with its `UNKNOWN` outcome) instead of a `Custody` interval covering the dwell.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | §10.3a.8                  |

### Revision 6 — the F1 decision applied

[Shared §10.3a](00-shared-decisions.md) items 9-12, from [shared §4.7.2f](00-shared-decisions.md).
Unlike items 1-8 these are **not** all mechanical: item 14 amends **A8-MOVE**, which is a rule of
this document, and item 13 opens a gap in §5 that was previously hidden behind a filled-in cell in
the shared table.

| #   | What moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Shared item                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 13  | **§5 gains caveat (iv): there is no `handover` row and one is owed** — and it may not be `boundBy = CUSTODY`, because that is the circularity §4.8.2 refuses and F1's fix made it load-bearing. The provisional side-names-the-authority reading is carried as **[ORIGINAL]**, **do not score**. Until the row lands, **A8-NAMED** has no rule for a handover `FactResolved` to name. Recorded as **F3, open**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | §10.3a.9 · shared §4.7.2f  |
| 14  | **§7.1 A8-MOVE names the RECEIPT instant, and gains the transfer-gap clause.** "Effective at the handoff instant" presupposed one instant; a transfer now has two. Authority moves at the selected `RECEIPT`'s `occurredAt`, and across a **C5** gap the **releasing** role stays authoritative, so a gap is a custody `UNKNOWN` and not an authority vacuum. **Nothing new is sourced** — 41 vs 349 is still `src:uncefact-rec24`. **[ORIGINAL]** and **not scored** (§10's last row). §4.3's `CUSTODY` row takes the same substitution.                                                                                                                                                                                                                                                                                                                                                                                         | §10.3a.10 · shared §4.7.2f |
| 15  | **§7.6's two handover records take the qualifier and gain a `FactResolved` each**, because they now key differently and each is resolved on its own key; and **`stop:X` on two trips is corrected to two stops**, `stop:X1` on T1 and `stop:X2` on T2, which [shared §8.1](00-shared-decisions.md) requires and [`A3` §8](A3-trip-stop-assignment.md) already said — carried through the `condition` records too, which named the now-deleted `stop:X` and are restated against each side's own stop (the pair still resolves on one fact key, because `context[]` is not the resolution key, [shared §1.4](00-shared-decisions.md) rule 3). §7.6's closing paragraph now says the dwell is a C5 gap — `UNKNOWN` custody, with the releasing role still authoritative. **The scenario's conclusion is unaffected:** A's late delivery assertion still loses, because the delivery's instant still falls after the `349` boundary. | §10.3a.11 · shared §4.7.2f |
| 16  | **§9 item 9's _"§7.6 answers two"_ is upheld and now has a mechanism** — the fact key, not a worked example. It is still our answer and not stedi's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | §10.3a.12 · shared §4.7.2f |

**What did not change.** §7.3 **A8-JOINT** is untouched — it names `condition` "and the counts
asserted with it", and it is now visibly **not** a rule about handovers. §7.2 **A8-LIABILITY**, §7.4
**A8-AFTER**, §7.5 **A8-PRINCIPAL**, §4.2 **A8-INSTANT**, §4.4 **A8-NAMED** and §8 **A8-UNAUTH** read
the same inputs they read before.

**Conformed to binding layer rev 6** (`00-shared-decisions.md`, revision 6; previously rev 5).

### Revision 7 — five owed rows closed, and the ledger told apart from the to-do list

1. **§5 gains rows 12-16.** `handover` (**F3**, closed), `weight.gross`, `weight.tare`, `packing`
   performance and `pieceCount`. The canonical-subject table's authority column moves those five from
   `owed`/`conditional` to `assigned` at `capped-medium`, and the generated owed inventory drops from
   **19 of 31** to **14 of 31** — a count, not a claim, and the reason the count is worth checking is
   that it did not move until all three homes of the table agreed (`data/authority-table.json`,
   `AUTHORITY_TABLE` in `src/rules/authority.ts`, and the authority column in
   `data/canonical-subjects.json`).
2. **§4.3 gains a sixth `boundBy`, `KEY`**, and **A8-KEY** with it. It exists because `handover`'s
   authority could be neither `CUSTODY` (circular — the fold folds over `handover`) nor `NONE` (which
   means _no_ role is authoritative, and here exactly one is). It reads the fact's own **qualifier**,
   which is fixed at mint time.
3. **The general principle is stated once, at §4.3 and again at §9 item 8:** an act that **mints** the
   thing a binding follows can never be bound to that thing. F3 was the first instance of a class
   rather than a special case.
4. **§9 item 8 is rewritten, and this is the part worth reading.** It used to read as a to-do list —
   "each needs a row" — which implied the missing rows were merely unwritten. Twelve of the fourteen
   that remain are **blocked on the corpus**: no external source binds a plan change, a membership
   offer, an assignment or an order award to an asserting role, and [A3 §7] rates the membership
   lifecycle "Low-to-medium — ORIGINAL, seeded" on its own evidence. Writing rows for them would move
   the count without moving the capability, because [shared §4.7](00-shared-decisions.md) note 3 and
   §10's last row both bar a provisional reading from scoring. **Only two of the fourteen are owed to
   this document**: `partyRole` (items 1-2) and `notification` (item 6).
5. **§2 closes F5.** Lower-camel is canonical, on the ground the pin already stated — A8-NAME-1 is a
   rule and the ADE cast is a citation — and **a role name is case-significant on the wire**, because
   [catalog §2.3] makes a change of spelling a new major. §7.6's worked records carried the
   capitalised spelling _inside a qualifier_ and are corrected; that was the defect itself, not an
   example of it.
6. **A8-KEY is model-checked, not only written.** F3 recorded that `alloy/custody.als` "found no
   published rule to transcribe"; `custody.als` now carries `a8Key`, a command showing it settling the
   two-sided contest F1 made routine, and a second showing what it costs — where only the side the key
   does **not** name asserted, A8-KEY selects nothing, so the fold goes quiet for a reason distinct
   from "nobody asserted". `Handover` gains an `assertedBy` role, which the model had no reason to
   carry until a rule read it.

**What this revision does to the published contract: `specVersion` goes `0.2.0` → `0.3.0`.** Not
because of the rows — a shrinking owed inventory is the gap list getting shorter, which [catalog §5]
records separately from the compatibility classification — and not because of `KEY`, which no record
carries and which reaches the wire nowhere. Because of **`keySideRole`**: A8-KEY needed a new
`AuthoritativeHolder` member, `ObligationRecipient` references `AuthoritativeHolder`, and the emitted
schemas publish it. So it is `newClosedEnumMember` under [catalog §2.3] — additive.

Worth recording how that was found, because the reasoning nearly went the other way: `boundBy` is not
on a record, so the change looked internal, and it was reading the **emitted schema diff** that said
otherwise. A compatibility claim argued from which fields feel published is a claim waiting to be
wrong.

### Revision 9 — two rows written, and the seventh `boundBy` member

**§5 gains rows 17 and 18, §4.3 gains `AWARD`, and the ledger's expectation of its own next move was
wrong by one.**

1. **Row 17, `documentIssuance`.** §9 item 8(e) asked this document "to accept a reading rather than
   to research one" — that row 10's `boundBy = SCHEME` already determines the holder of a document's
   issuance, on [`A6` §3.2(b)](A6-documents-evidence.md)'s identification of scheme control with
   instrument issuance. Accepted. The row cites row 10's own `ISSUER-OF-SCHEME` v1 and **mints no
   rule**; its confidence is **medium** against row 10's **high**, because §10 caps a row whose
   authority is converted from a duty and §375.505(a) states a duty. It is the first entry to leave
   [shared §4.7.3](00-shared-decisions.md)'s absent list by being minted.

2. **§4.3 gains `AWARD`, and row 18 closes `orderResponse`.** Revision 8 recorded the open question
   — does the table need a seventh member? — and estimated that taking it **"would close two rows"**.
   It closes **one**. `orderResponse`'s holder is singular: [`A1`
   §3.5](A1-order-service-lifecycle.md) puts acceptance _and_ refusal on "the offeree, and only the
   offeree". `orderCancellation`'s is not, and A1's own permission table is what says so — "either
   party" after acceptance — so §4.4 **A8-NAMED** makes a tie-break mandatory and nothing publishes
   one. Its **binding** is no longer owed and its **holder** is; the entry is repointed, not closed.
   [`A2` §3.6](A2-shipment-structure.md)'s `shipmentCommitment` turns out to be in the same position
   and not `orderResponse`'s, on its own three sources.

3. **The mint principle is now gated, and `AWARD` is why it had to be.** §4.3 has stated three times
   that an act minting the thing a binding follows cannot be bound to it, and nothing held it. While
   there was no member meaning "the award", `orderAward` could not be bound to the award by accident;
   now it can. `MintingActsAreNotBoundToWhatTheyMint` holds all four pairs over §5's table in
   `src/rules/authority.ts`, declared independently of it.

4. **A stale quotation found on the way.** [shared §4.7](00-shared-decisions.md) note 4 quoted §4.3's
   members and listed **five** — it had never gained `KEY` from revision 6's F3 close. Note 4 now
   carries all seven and is gated against the code, which is the check that would have caught the
   omission when it was made.

Nothing in §7 or §8 changes, and no owed row is closed by assertion: the two that stay owed say what
they are owed **for**, which is the difference between a ledger and a to-do list that revision 7 was
written to establish.

### Revision 8 — the order rows re-explained, on A1's reading of the corpus

Nothing in §5 changes and no row is written. What changes is **§9 item 8(b)'s reasoning about the
three order types**, which [`A1` §Cross-area](A1-order-service-lifecycle.md) tested against the
corpus and found wrong in both directions.

1. **"No source in the corpus attaches an authority to it" is withdrawn as written.** Four sources
   name a party on every order transition, and one of them enforces it in a running system. What
   they supply is **permission** rather than assertional authority — but so did the material §10
   records this document converting for rows 1-5, 8 and 11.
2. **The blocked-on-the-corpus set is nine, not twelve.** The three order rows leave it.
3. **The remaining blocker is §4.3's `boundBy` enum, which is this document's own.** Two of the
   three — `orderResponse` and `orderCancellation` — need a member meaning "a role resolved by the
   order's own award", structurally `ASSIGNMENT` one aggregate over. `orderAward` stays blocked by
   §4.3's mint principle, where the original sentence was exactly right. **Deciding whether the
   table needs a seventh member would close two rows with no new research**, which is the cheapest
   remaining move on the owed count and is recorded here as an open question rather than taken.
   _(Revision 9 took it, and "two rows" was one row. See below.)_
4. **Two worked cases arrive with it** — `src:dtr-part-iv` §C.4.a's conditional refusal permission
   for §8's `A8-UNAUTH`, and `src:dcsa`'s JIT `classifierCode` for §9 item 9's neighbourhood.

**The lesson, and it is the mirror of [A4 §4.4]'s.** A4 found that a claim about **one publisher**
had been read as a claim about **the corpus**. This is the same error in the other direction: a
claim about **the corpus** that had not been tested against it. Both sentences were written in good
faith from material that was in front of the author; neither survived a read aimed at it.
