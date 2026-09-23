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

**The role vocabulary this document takes is `src:sirva-ade`'s cast**, as
[shared §10.3 item 13](00-shared-decisions.md) already directs:
`Booker` · `OriginAgent` · `DestinationAgent` · `LoadAgent` · `UnloadAgent` · `Hauler` ·
`R19Agent` · `RR19Agent` · `SITAgent` · `Driver` (GSD p.9; SOE p.6), plus `Packer` / `PortHandler` /
`SettlingAgent` / `SetoffAgent` from the settlement view (GSD pp.12-13, 26).

Four roles are **added** here because they assert facts and ADE has no slot for them:

| Added role                                   | Why it must exist                                                                                                                                                                                                                                                                                                                                                                                                               | Standing of the addition                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer` (= `goodsOwner` at the residence) | `src:cfr-49-375` requires the customer's signature on the BOL (§375.505(a)), the inventory (§375.503), the delivery receipt (§375.701) and any waiver of a weighing observation (§375.515(b)); `src:dp3-tender-of-service` requires per-page e-signature and per-line-item exception annotation **before** signing (§C.9.a(4)-(11)) and makes the customer the **asserter** of real-property damage on a 7-day clock (§B.10.e). | Carried from [`fork-time` §5.3](fork-time-provenance-corrections.md), where it is **[ORIGINAL]**. The _obligation to sign_ is sourced four times; treating the signature as an **assertion by a role** rather than as evidence attached to the carrier's assertion is the authored step. |
| `accountParty`                               | `src:dp3-400ng` (the Government is the DPS "shipper"); `src:weichert-supplier-api` (the RMC gates our submission with its own rules); `src:dtr-part-iv` PPSO/PPPO/TO as "the government counterparties who approve, pre-approve, dispute and pay".                                                                                                                                                                              | Sourced that the party exists and decides things; **[ORIGINAL]** that it is one role rather than three.                                                                                                                                                                                  |
| `weighMaster`                                | `src:cfr-49-375` §375.519(a)(1)-(6): the weight ticket is **signed by the weigh master** and carries scale name and location — a third party at the scale, neither carrier nor customer.                                                                                                                                                                                                                                        | Sourced.                                                                                                                                                                                                                                                                                 |
| `platform` (us)                              | [shared §4.3](00-shared-decisions.md): `FactResolved` is asserted by the platform with `capturedBy = DERIVED_BY_RULE`; [shared §6.6](00-shared-decisions.md): the platform "asserts what it derived, which it plainly has authority to do."                                                                                                                                                                                     | Carried from the shared layer.                                                                                                                                                                                                                                                           |

**Two vocabularies are refused.**

- **`src:sirva-ade`'s 2-digit `ServiceProviderFunction` codes are not used.** The published table
  **collides**: `06` is both "Origin Agent" and "R19 Agent", `16` is both "Destination Agent" and
  "RR19 Agent" (GSD p.26), and ADE's own analysis flags it as open question 9 ("a typo or a real
  overload?"). A role table keyed on a colliding code is not a table. We take the `Resource.Type`
  strings.
- **`src:stedi-x12-reference` element 98 is not used, because it was not read.** The analysis is
  explicit: "the role vocabulary itself is element 98's code list, **which we did not read** — so we
  can say parties are typed and placed, but not what the types are," and stedi's own open question 1
  flags it as blocking A8. What element 98 _does_ supply, structurally, is that `N1` typed-party
  loops appear at **header, stop, status and carton grain** in both the 204 and the 214 (C6=3) —
  i.e. the industry places a role-qualified party at every grain, which is the shape §4 assumes.
  **The vocabulary remains unread and §9.9 keeps it on the ledger.**

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
  authoritative   roleRef[]        MANDATORY   ← usually one; two only at a joint instant (§7.3)
  corroborating   roleRef[]        OPTIONAL
  competing       roleRef[]        OPTIONAL    ← eligible to win under a named value rule
  advisory        roleRef[]        OPTIONAL    ← recorded, never selected
  boundBy         CUSTODY | ASSIGNMENT | SCHEME | PRINCIPAL | NONE   MANDATORY  (§4.3)
  tieBreak        ruleId           MANDATORY when `authoritative` can be empty or plural
```

The record is **[ORIGINAL]**. Its two structural precedents are real and are narrower than it:

- `src:dcsa` makes `publisher {partyName, carrierCode, carrierCodeListProvider}` and
  `publisherRole ∈ CA | AG | VSP | SVP` **mandatory on every event** (`event_domain` L1506-1528,
  L2603-2622, L634-639). It records _which role asserted_; **it does not rank them.** DCSA's own
  analysis asks our question and leaves it open — open question 5: _"How many parties can assert the
  same fact, and does `publisherRole` need a [precedence]?"_
- `src:dcsa` JIT **does** join role to tense, and it is the only place in the corpus that joins
  authority to anything: `EST`/`PLN`/`ACT` may be published only by the Service Provider, `REQ` only
  by the Consumer (`jit/v2` L3554-3568). That is a per-role constraint on _which basis you may
  assert_, machine-checkable and enforced. **Our step:** extending a role constraint from the
  `basis` axis to the _selection_ of a winner among same-basis assertions.

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

| `boundBy`    | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Which fact classes                                                                                          | Source for the binding                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUSTODY`    | Authority follows **`custodyAt(goods, instant)`** ([shared §4.8.3](00-shared-decisions.md)) — the named, versioned fold over the `FactResolved`-selected `handover` assertions and over `ExternallyPerformedLeg.custodyBasis` — evaluated at the instant the fact is _about_ (A8-INSTANT) and moving at the selected **`RECEIPT`**'s `occurredAt` on that receipt's `custodyBasis` (**A8-MOVE as amended**, §7.1). There is no stored `Custody` entity. Across a **C5** transfer gap the fold returns `UNKNOWN` and the **releasing** role stays authoritative, so a gap is a custody `UNKNOWN` and not an authority vacuum.                                                                                                                                                                                                                                                                                                                                                                                                                    | arrival, departure, load/unload performance, delivery performance, condition, SIT entry inputs, SIT release | §7; [shared §4.8](00-shared-decisions.md)                                                                                                                       |
| `ASSIGNMENT` | Authority follows an `Assignment`'s effective interval, not custody.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | facts about a resource (which driver, which trailer)                                                        | `A3` §6.1 (an `Assignment` has an effective interval)                                                                                                           |
| `SCHEME`     | Authority belongs to the **issuer** of the naming scheme and never moves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | identity                                                                                                    | [shared §7.1](00-shared-decisions.md): `issuer` is "the PARTY that assigned this value under that scheme"                                                       |
| `PRINCIPAL`  | Authority belongs to the party the arrangement is _for_, and moves only when the principal changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | charge, and the depositor case in §7.5                                                                      | `src:dp3-400ng` Item 17-2.5 (§7.5)                                                                                                                              |
| `NONE`       | No role is authoritative; the value is settled by a named value rule or a derivation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | weight.net, SIT entry (the derived date itself)                                                             | [shared §4.4](00-shared-decisions.md), [§5 M4](00-shared-decisions.md)                                                                                          |
| `KEY`        | Authority belongs to the role the fact's own **`qualifier`** names — **A8-KEY**. Exactly one role, computed from the record, so `authoritative` is neither empty nor plural and A8-NAMED never fires; there is no value rule to name, which is why this is a sixth member and not `NONE` plus a tie-break. It breaks **F3**'s circle because it reads the **key**, fixed when the record was minted, and not `custodyAt` — the fold that consumes the answer. **The general principle it is the first instance of:** an act that **mints** the thing a binding follows can never be bound to that thing. `handover` mints custody, so it cannot be `CUSTODY`; `assignmentOffer` mints the assignment, so it cannot be `ASSIGNMENT`; `orderAward` mints the principal relation, so it cannot be `PRINCIPAL`. `KEY` rescues `handover` alone, because it is the only one of them whose **qualifier** names its actor — the other nine name theirs in `context[]`, and [shared §1.4](00-shared-decisions.md) forbids resolution from reading that. | handover (§5 row 12)                                                                                        | `src:stedi-x12-reference`'s interline pair `J1`/`R1`, issued from opposite sides. **[SYNTHESIS]** — the arrangement is stedi's, binding authority to it is ours |

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

| #   | `type` (= `factClass`, [shared §1.3](00-shared-decisions.md))                           | Canonical subject **family** ([shared §4.7](00-shared-decisions.md))                                                      | **Authoritative**                                                                                                                                                                                                                                                                                                                                                                                                                                       | Corroborating                                                                                                                                                                                 | Competing                                                                                                                                                                                                                                                                                                                                            | Advisory                                                                                                      | Evidence, and what is authored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`arrival`**                                                                           | **`stop`** = {stop, externallyPerformedLeg}                                                                               | The role holding custody at that stop — `Driver` where the stop is on our trip; `Hauler` where the trip is the hauling agent's; the leg's `authoritativeAsserter` on an `ExternallyPerformedLeg` (shared §8.2)                                                                                                                                                                                                                                          | `OriginAgent`/`DestinationAgent` at their own end; `customer`                                                                                                                                 | `DestinationAgent` at destination (see note)                                                                                                                                                                                                                                                                                                         | `Booker`; `platform`; visibility providers (`src:dcsa` `VSP`/`SVP`)                                           | **Sourced:** `src:dp3-tender-of-service` #14 and #20 place the arrival-recording _duty_ on the party performing (arrival/departure at any in-transit facility, storage facility, POE or POD → notify within 3 GBD of pickup or 1 GBD of any change, §C.3.b p.34; "record arrival and/or delivery in DPS", §C.3.a p.34). **[ORIGINAL]:** converting a recording duty into assertional authority. Note the deliberate `competing` entry — the critique's own example is the destination agent's shipment-level claim against the driver's stop-level claim; both are real and E-CANON is what makes them pair.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | **`departure`**                                                                         | **`stop`**                                                                                                                | as #1                                                                                                                                                                                                                                                                                                                                                                                                                                                   | as #1                                                                                                                                                                                         | as #1                                                                                                                                                                                                                                                                                                                                                | as #1                                                                                                         | As #1. `src:dp3-tender-of-service` #10 additionally requires the **legal name and US DOT number of the service provider actually hauling** in DPS within 2 GBD of origin departure (§B.3.f p.19) — so at departure the performing party must be _nameable_, which is the precondition for this row to be computable at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3   | **`loading`** _(load performance; act record, shared §2)_                               | **`goods`** = {shipment, portion}; `context[]` = `stopAction`, `stop`, `trip`                                             | `LoadAgent`; `OriginAgent` where no separate load agent is assigned (`src:sirva-ade` carries both types, GSD p.9)                                                                                                                                                                                                                                                                                                                                       | `Driver`; `customer`                                                                                                                                                                          | `customer`, for the _scope_ of what was loaded (short/refused)                                                                                                                                                                                                                                                                                       | `Booker`; `DestinationAgent`; `platform`                                                                      | **Sourced:** `src:dp3-400ng` Item 7.1 makes the origin representative a named, updatable party of record at origin; `src:dp3-tender-of-service` §B.20 requires the **actual** servicing rep. **[ORIGINAL]:** the role split. The `customer`-as-competing entry is sourced by `src:cfr-49-375` §375.503 + §375.605(b) (customer notations on the inventory) and DP3 ToS §C.9.a(4)-(11) (per-line-item exception annotation before signing).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | **`unloading`** _(unload performance)_                                                  | **`goods`**; `context[]` = `stopAction`, `stop`, `trip`                                                                   | `UnloadAgent`; `DestinationAgent` where none is separately assigned                                                                                                                                                                                                                                                                                                                                                                                     | `Driver`; `customer`                                                                                                                                                                          | `customer`                                                                                                                                                                                                                                                                                                                                           | `Booker`; `OriginAgent`; `platform`                                                                           | Mirror of #3, same sources. The mirror itself is **[ORIGINAL]**; ADE supplies `LoadAgent` and `UnloadAgent` as distinct types (GSD p.9) but states no authority.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5   | **`delivery`** _(delivery performance)_                                                 | **`goods`**; `context[]` = `stop` **or** `externallyPerformedLeg`, `trip`                                                 | `DestinationAgent`; the leg's `authoritativeAsserter` where delivery is externally performed (shared §8.2); `RR19Agent` under a Reverse Rule 19                                                                                                                                                                                                                                                                                                         | `Driver`; `Hauler`                                                                                                                                                                            | **`customer`** — see the joint-signature note in §7.3                                                                                                                                                                                                                                                                                                | `Booker`; `OriginAgent`; `platform`                                                                           | **Sourced, heavily:** `src:cfr-49-375` §375.701 — the **delivery receipt is signed by the shipper** and "may not contain release/discharge-of-liability language"; `src:dp3-tender-of-service` §C.17.a — the DP3 Notification of Loss or Damage AT DELIVERY is "**jointly signed** by my representative and the customer or their authorized agent"; §C.9.a(24) — a signed check-off sheet is _not_ proof of delivery. `src:sirva-ade` carries exactly one human-attestation field, `ProofOfDeliveryName`, "name of person receiving shipment at destination" (SOE p.5). **[ORIGINAL]:** placing `customer` in `competing` rather than `corroborating` — three sources make the customer's signature constitutive, not decorative.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | **`weight.net`**                                                                        | **`goods`**                                                                                                               | **`boundBy = NONE` — no role is authoritative.**                                                                                                                                                                                                                                                                                                                                                                                                        | `weighMaster` supplies the evidence, not the assertion                                                                                                                                        | `Hauler`/`OriginAgent` (the weighing) **and** `customer`/`accountParty` (the reweigh)                                                                                                                                                                                                                                                                | `platform`; `Booker`                                                                                          | **The most strongly-sourced row, and the one that proves authority and value-rules are two mechanisms.** [Shared §4.4](00-shared-decisions.md)'s **`R-WEIGHT-LOWER`** already settles the value: `src:dp3-400ng` Item 4 Note 2, "if duplicates occur, DPS must be updated with the **lower** of the net reweigh weights", corroborated at Item 4.11.d and Items 4.9.h-i. The _right to contest_ is held by the other side: `src:cfr-49-375` §375.517 gives the **shipper** the reweigh demand (before unloading begins; the freight bill must then be based on the reweigh weight), §375.515(a)-(b) makes non-observation a presumed waiver but requires a **written** waiver to give up observing a *re*weighing, and §375.519 puts the signature on the **weigh master**. `src:dtr-part-iv` §D.7.a(4) requires interested parties be given "reasonable opportunity… to be present" at a reweigh; `src:dp3-tender-of-service` #11/#15/#16 puts the weigh-and-enter duty on the TSP _expressly_ "to allow the customer or PPSO the opportunity to request a reweight", and #15 requires a **supplemental invoice refunding the difference** if already invoiced. **Authored:** nothing. This row is a citation.                                                                                                                                                                                         |
| 7   | **`sitEntryDate`** _(SIT entry date; distinct from the **`storeIn`** act, shared §5.3)_ | **`stay`**                                                                                                                | **`boundBy = NONE`** — the value is **derived and the derivation is mandatory**, per [shared §5 M4](00-shared-decisions.md). Authority applies only to the **input**, the _first available delivery date_, which is the **`Hauler`/`DestinationAgent`'s** (whichever holds the BL duty)                                                                                                                                                                 | `SITAgent` (handling-in); `accountParty` (approval)                                                                                                                                           | —                                                                                                                                                                                                                                                                                                                                                    | `platform` (may assert only the derived value, §6.6)                                                          | **Sourced twice, from opposite directions:** `src:dp3-400ng` Items 29.4, 29.6, 17.20 — "SIT in date will be equal to the TSP's **first available delivery date**", "always… not the date of notification", and "the arrival date must **NOT** be entered as the SIT entry date"; `src:dtr-part-iv` §D.5.b(2) NOTE p.18 — SIT is effective "the date the shipment was **offered for delivery**, not the date it arrived." **Consequence, [ORIGINAL] but forced:** because M4 already makes the derivation mandatory, a role table that made anyone authoritative _for the date itself_ would contradict the shared layer. This row is the one where the right answer is "nobody".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | **`storeOut`** _(SIT release / handling-out)_                                           | **`stay`**                                                                                                                | `SITAgent` / the warehouseman holding the goods                                                                                                                                                                                                                                                                                                                                                                                                         | `Hauler` collecting; `DestinationAgent`                                                                                                                                                       | `Hauler` collecting (see §7.3 — this is a handoff, so the exception-sheet rule applies)                                                                                                                                                                                                                                                              | `Booker`; `platform`                                                                                          | **Sourced:** `src:dp3-tender-of-service` #28 puts handling-in on the **warehouseman** (COB the third GBD after SIT approval, §C.14.b p.45); NTS §1.8.1 puts handling-out on the NTS TSP with **5 GBD advance notice from the Government**; NTS §5.8.2 is decisive on the collecting carrier — when the line-haul carrier fails to collect a lot, the **NTS TSP** notifies the TO by the following business day and the **DD 1164 is amended to document the carrier's failure as the cause**, set off against that carrier's BL. The warehouse is the party of record for what happened in the warehouse. `src:dtr-part-iv` corroborates from the identity side: the **lot number is supplied by the warehouseman, not the Government**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | **`condition`** _(per article)_                                                         | **`item`** _(singleton — one value **per article**, shared §5.4; shared §5 M6(a): "per-item against a signed inventory")_ | **Jointly held and deliberately plural** — the party releasing and the party receiving, at each custody boundary                                                                                                                                                                                                                                                                                                                                        | the non-inspecting parties                                                                                                                                                                    | each other (this is the `competing` case by construction)                                                                                                                                                                                                                                                                                            | `platform`; `Booker`                                                                                          | **The best-sourced row in the document, and §7.3's foundation.** `src:dp3-400ng` Item 17.12.c — **both** TSP and warehouseman must hold "the condition of **each article** when received at and forwarded from the storage location." `src:cfr-49-375` §375.503 — itemized inventory with per-article ids and condition, signed by both. `src:dp3-tender-of-service` NTS §1.6.2 — condition **by omission**, with the burden assigned ("failure of electronic items will be assumed to be transit related") and an escape code that still does not bar a claim; §C.9.a(22) — describing cartons as "misc." **waives the right to contest** related claims. And NTS §1.6.10 — §7.3's sentence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 10  | **`identity`**                                                                          | **every `aggregate` kind** (shared §7.1); `qualifier` **`{scheme, vocabularyScope}`** — the I-KEY tuple                   | **`boundBy = SCHEME`.** The **`issuer`** of the scheme, and nobody else, for the value under that scheme. Authority **never moves.**                                                                                                                                                                                                                                                                                                                    | the counterparty echoing the value back                                                                                                                                                       | —                                                                                                                                                                                                                                                                                                                                                    | everyone else                                                                                                 | **Sourced, and the shared layer already carries the field:** [shared §7.1](00-shared-decisions.md) defines `issuer` as "the PARTY that assigned this value under that scheme" and `scheme` as "the naming system, which DEFINES who assigns and what it identifies". `src:dcsa` supplies the pattern outright — a party is `carrierCode` + `carrierCodeListProvider`, i.e. **code plus the authority that issued it** — and states the echo-back obligation ("carriers share it back when providing track and trace event updates"). `src:sirva-ade` performs the echo (`ExternalReference` = "Agent's internal lead reference", LEP p.3). **The practical consequence** is the one the ADE analysis names: SIRVA's `Brand+RegNumber+RegYear` and Weichert's `serviceOrderNumber` are **peer references, neither authoritative over the other**, because they are values under two different schemes with two different issuers. `src:dtr-part-iv` supplies the counter-case that proves the rule has teeth: the **BL number is serially pre-assigned accountable stock**, audited every 180 days — one issuer, and a laser-generated BL "is only accountable when a number has been assigned to the form." Note that an issuer's _responsibility_ can be reassigned with an effective date (`src:dp3-400ng` GBLOC, Regionalization p.17), which is why §7.1's interval carries it, not a static field. |
| 11  | **`charge`**                                                                            | **`charge`** (shared §1.2); `qualifier` **`{aspect}`** ∈ `PROPOSED` \| `DECIDED` \| `RATED` (shared §4.7.2b)              | **`boundBy = PRINCIPAL`, and it is a two-sided pair, not one role — resolved across three fact keys, not one.** **Proposal** authority (`aspect = PROPOSED`): the performing role. **Decision** authority (`aspect = DECIDED`): the `accountParty`. **Rating** authority (`aspect = RATED`): the tariff owner (the van line / the party whose tariff prices it).                                                                                        | `SettlingAgent`, `SetoffAgent`                                                                                                                                                                | the performing role, on quantum                                                                                                                                                                                                                                                                                                                      | `platform`                                                                                                    | **Sourced three ways.** _Who asserted each number:_ `src:milmove-mymove` tags every priced input with its origin — `PaymentServiceItemParam.origin ∈ PRIME                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | SYSTEM | PRICER | PAYMENT_REQUEST`— "i.e. *who asserted this number*", and nothing is billable "unless a matching service item was created and **approved**". *The propose/decide split:*`src:dtr-part-iv`models accessorial **pre-approval as a typed record** with states Pending → Approved/Denied and a 3-GBD PPSO SLA, then a reconciliation flagging each submitted service pre-approved or pre-denied (§C.8, §D.6);`src:milmove-mymove`carries the same shape with **both narratives attributed** —`contractorRemarks`on the request,`officeRemarks` on the decision — and an auto-approve threshold (`ShipmentAddressUpdate`is auto-approved *unless* it crosses a pricing boundary). *Rating is the tariff owner's:*`src:sirva-ade`computes charges only "when Rating to calculate charges has completed successfully" (GSD p.3), typically post-delivery, and the agent's only write channels are`AddDocument`and`AddOpportunity`. **And the correction regime is already settled against role:** [shared §6.3](00-shared-decisions.md) — financial facts are corrected **only by an offsetting record**, never by retraction (`src:sirva-ade` `AdjCode` Original/`ADJ`/`CAN`with the zero-out invariant, ABS p.3;`src:dp3-400ng`Items 4.12, 4.13.3.b, 17-2.7, 27.4.b-c). **[ORIGINAL]:** naming the three-way split (propose / decide / rate) as three authorities. No source names all three. **Corrected by [shared §4.7.2b](00-shared-decisions.md):** they are not three authorities contesting *one* fact key. Under the derived key`(subject, type, qualifier?)`that would put a proposal, an approval and a price into one contest, where an approval would compete with an amount. The`{aspect}` qualifier makes them **three fact keys**, each with the authority this row already assigns. The three-way split is the finding and does not otherwise change. |
| 12  | **`handover`** _(the custody transfer itself; act record)_                              | **`goods`**; `qualifier` **`{releasing, receiving, side, occurrence?}`** (shared §4.7.2f)                                 | **`boundBy = KEY`, and the member is new.** The role the fact's own **qualifier** names — the releasing role for a `RELEASE` key, the receiving role for a `RECEIPT` key (**A8-KEY**). **Exactly one**, so A8-NAMED never fires and the row names no tie-break.                                                                                                                                                                                         | the roles on the other side of the same transfer — `OriginAgent`, `DestinationAgent`, `SITAgent` at their own end                                                                             | the role named on the **other** side of the same transfer. It may assert the same key and is recorded in `considered[]`; it is never selected.                                                                                                                                                                                                       | `Booker`; `platform` — a geofence may witness a departure, never a change of responsibility (shared §5 M2/M3) | **F3, closed.** §4.7.1 gave this row `CUSTODY` while shared §4.8.2 said of the identical shape that "that row's binding would be `CUSTODY`, so **A8-MOVE would be defined in terms of the thing it defines**" — two published sentences contradicting each other, made load-bearing by **F1**, which gave `handover` a qualifier so the fold now selects among a contested pair. `KEY` resolves it by reading the **key**, fixed at mint time, rather than the fold that consumes the answer. **Sourced:** `src:stedi-x12-reference` issues the interline pair from opposite sides — only the releasing carrier issues `J1`, only the receiving carrier issues `R1` — so _which side may speak_ is already a property of the code in the source. **[SYNTHESIS]:** binding authority to it, and therefore adding a sixth `boundBy`, is ours. Confidence **medium**: stedi sources the arrangement, not the ranking, and no source in the corpus ranks two assertions about one transfer because none models a contest.                                                                                                                                                                                                                                                                                                                                                                                   |
| 13  | **`weight.gross`**                                                                      | **`goods`**; `context[]` = `document` (the ticket), `resource` (the vehicle weighed), `stop`                              | The party that **performed the weighing**, which is the party holding the goods at the scale — `custodyAt(goods, instant)` at the instant of the weighing (**A8-INSTANT**), so `Hauler` or `OriginAgent` as the fold answers.                                                                                                                                                                                                                           | `weighMaster` — it supplies the **evidence**, not the assertion: `src:cfr-49-375` §375.519(a)(1)-(6) puts the signature, the scale name and the scale location on the weigh master. As row 6. | `customer` / `accountParty` — the **reweigh right**, and it is the shipper's: §375.517 gives the reweigh demand before unloading begins and requires the freight bill to be based on the reweigh weight.                                                                                                                                             | `Booker`; `platform`                                                                                          | **Owed by a ledger that did not list it** — §9 item 8 names neither gross nor tare — and closed here. The row exists because row 6 is `NONE` for a reason that does not reach these two: `R-WEIGHT-LOWER` picks the **net** regardless of who asserted it, which says nothing about who may assert an **input**. Reading row 6 as though it did is what left these cells blank. **Evidence** is row 6's, which §10 calls "a citation": §375.517, §375.515(a)-(b) (non-observation is a presumed waiver; giving up observing a *re*weighing needs a **written** waiver), §375.519; `src:dtr-part-iv` §D.7.a(4); `src:dp3-tender-of-service` #11/#15/#16 (the weigh-and-enter duty is the TSP's, expressly "to allow the customer or PPSO the opportunity to request a reweight"); `src:dp3-400ng` Item 4. **[SYNTHESIS]:** separating input authority from row 6's value rule. Confidence **medium**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 14  | **`weight.tare`**                                                                       | **`goods`**                                                                                                               | as #13 — `sameAs` row 13                                                                                                                                                                                                                                                                                                                                                                                                                                | as #13                                                                                                                                                                                        | as #13                                                                                                                                                                                                                                                                                                                                               | as #13                                                                                                        | §4.7.1 states this row as "as `weight.gross`", and nothing in the sources separates them: the same weighing, the same scale, the same ticket. Two rows rather than one because §4.7.1 declares two **types**, and collapsing them here would make the table disagree with the vocabulary; `sameAs` is how the table says "this row is that row" without duplicating it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 15  | **`packing`** _(pack performance; act record)_                                          | **`goods`**; `context[]` = `stopAction`, `stop`                                                                           | `Packer`; `OriginAgent` where no separate packer is resourced (`src:sirva-ade` resources a `Packer`, GSD pp.12-13). Mutually exclusive circumstances, not a contest — so not plural.                                                                                                                                                                                                                                                                    | `customer`, `DestinationAgent` — the customer observes the pack, the destination agent sees the result. Neither has an obligation to speak, so silence is not evidence (§4.1 note 1).         | `customer`, on **scope** and not on performance: `src:cfr-49-375` §375.503(a) requires an itemized inventory identifying "every carton and every uncartoned item" with a number physically on each article, prepared with the shipper given the opportunity to observe and verify, and §375.503(d) the same opportunity at delivery, **in writing**. | `Booker`, `Hauler`; `platform` (M2/M3 forbid a machine asserting any act in this family)                      | **§9 item 8 named "packing performance" as uncovered.** Covered now, as the **mirror of row 3** — and the mirror is the authored step (**[SYNTHESIS]**), exactly as row 4 is the authored mirror of row 3. The roles and the shipper's contest right are citations; no source states an authority ranking for packing any more than for loading. `src:dp3-400ng` Item 17.12.c reaches the cartons the pack produced. Confidence **medium**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 16  | **`pieceCount`**                                                                        | **`goods`**; `qualifier` **`{unitization}`**                                                                              | **Away from a custody boundary** — the half §4.7.1 left owed — the party **holding the goods** at the instant counted (`custodyAt`, A8-INSTANT). **At a boundary** it is row 9's: jointly held, releasing **and** receiving, `selected[]` may be empty, because **A8-JOINT** reaches "`condition` **and the counts asserted with it**". One type, two standings, split by whether the instant is a boundary — and the split is A8-INSTANT's to compute. | `customer`, `OriginAgent`, `DestinationAgent` — whoever else was present; §375.503 gives the shipper the opportunity to verify at both ends.                                                  | `customer` / `accountParty` — a count is what a shortage claim is built on, and §375.503(d) gives the right to note missing articles **in writing** and receive a copy of the notations. [A4 §3]'s `GOODS_MISSING` is the reason code that records the disagreement.                                                                                 | `Booker`; `platform`                                                                                          | The row was **conditional**, not owed: §4.7.1 already answered the boundary case through A8-JOINT and left the rest open. Closed at **medium**. Every published counting duty falls on the holder — §375.503(a)'s per-article numbering, and `src:dp3-400ng` Item 17.13's partial SIT withdrawal identified by **inventory item numbers** with the TSP obtaining the actual weight of the portion. **[SYNTHESIS]:** splitting one type's standing by whether the instant is a boundary, which is the shape A8-INSTANT already requires.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**One structural observation that the table makes visible and that is worth stating on its own.**
Three of eleven rows have **no authoritative role** (`weight.net`, `SIT entry`, and `condition`,
which is plural rather than empty). That is not a failure of the table. In each case a source
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
`src:cfr-49-375` §375.503 (inventory signed by both) and §375.701 (delivery receipt signed by the
shipper); `src:dp3-tender-of-service` §C.17.a (the AT DELIVERY notice "jointly signed by my
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
2. **The full role vocabulary as a versioned enum**, including the roles §2 names but does not
   define: `accountParty`, `goodsOwner`, `weighMaster`, the government offices
   (PPSO/PPPO/TO/ITO/JPPSO/SB/SPM, `src:dp3-400ng`, `src:dtr-part-iv`), the NTS
   warehouseman and whether it is the same role as ADE's `SITAgent`, the **`TSP for Carriage`**
   (`src:dp3-tender-of-service` NTS §1.6.10, §5.8 — "a named third party in the custody chain"),
   `Move Management Company`, `Trusted Agent`, `Claims Manager`, `Designated Agent`
   (`src:dp3-400ng` Definitions p.11 — appointed by power of attorney to act **in place of the
   customer**), broker, and the prime / emergency-or-temporary agent split (`src:cfr-49-375`
   §375.205). §5's table is stated in roles it does not define.
3. **Person vs organisation vs crew-member grain.** `src:milmove-mymove`'s `MTOAgent` is a _person_
   (`RELEASING_AGENT`/`RECEIVING_AGENT`); `src:atlas-world-group-api`'s `OnSiteStaffMember` carries
   `role_ID`/`role_Description` bound to specific `stop_Number`s (column names); `src:sirva-ade`'s
   `Resource` fuses companies, people and **equipment** (`Tractor`, `Trailer`) into one `Type` enum;
   `src:dp3-tender-of-service` NTS §1.4.13.1 requires an **NTS TSP company official** — a named
   individual, not the company — to sight-verify firearms within 72 hours. §7.3's "releasing and
   receiving parties" is written at company grain and A8 must decide whether the _individual_ who
   signs is a distinct asserter.
4. **Delegation and on-behalf-of.** §7.2 states that liability does not move; it does not model the
   chain that holds it. Material exists and is unused: `src:cfr-49-375` §375.205's written prime-agent
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

   **So the open question for A8 is: does §4.3's table need a seventh member?** Deciding it would
   close two rows without new research, which makes it the cheapest remaining move on the owed
   count. This document has not decided it.

   **Two worked cases A1 handed over with the correction.** `src:dtr-part-iv` §C.4.a permits refusal
   **only** for a short-fuse or shortened-transit shipment — the same record by the same role,
   authorised or not depending on a property of the thing it is about, which is the cleanest
   published **A8-UNAUTH** case in the corpus (§8). And `src:dcsa`'s JIT `classifierCode` binds an
   assertion class to a role verbatim — _"`EST`, `PLN` and `ACT` can **only** be used by the
   **Service Provider** … `REQ` is **only** to be used by the **Service Consumer**"_
   (`jit/v2/JIT_v2.0.0.yaml` L3554-3585). It does not overturn
   [shared §4.7.1](00-shared-decisions.md)'s "no source in the corpus binds a **plan change** to an
   asserting role" — a planned time is not a plan change — but it was not cited when that sentence
   was written and it is where to look first.

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

## 10. Confidence

| Item                                                                              | Confidence                                        | What would overturn it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **§2 role naming (A8-NAME-1/2)**                                                  | **High**                                          | Nothing in the corpus; the traps are documented findings and the fix is a naming discipline. Reading element 98 would add a vocabulary to check against, not reverse the rule.                                                                                                                                                                                                                                                                                                                                                                                          |
| **§3 role ⟂ ownership; role on the assignment; history not roster**               | **High**                                          | Grade A, C2=3, with a worked sample (`src:sirva-ade` GSD p.17) and an explicit statement that the roster has no history (GSD p.4). A8-SELF is [ORIGINAL] but is a direct consequence.                                                                                                                                                                                                                                                                                                                                                                                   |
| **§4.2 A8-INSTANT**                                                               | **Medium-high — [ORIGINAL]**                      | The three-clock distinction is sourced; keying authority to `occurredAt` is ours. It would be overturned by a published model that keys authority to recording time — none exists, but note that the partner contract we actually carry (`src:sirva-ade`) **only has** a recording clock, so implementing this requires us to supply `occurredAt` ourselves on inbound ADE facts. That is an ingest obligation, not a model defect, and it should be written down before A4 assumes otherwise.                                                                          |
| **§4.4 A8-NAMED (no silent recency)**                                             | **High**                                          | The rejection of implicit last-writer-wins is already settled at shared §4.3 on `src:gtfs`. A8-NAMED only prevents it re-entering through an empty table.                                                                                                                                                                                                                                                                                                                                                                                                               |
| **§5 the table, rows 6, 7, 9, 10** (`weight.net`, SIT entry, condition, identity) | **High**                                          | These four are citations, not designs. Row 6 is three statements in one tariff plus four in the CFR; row 7 is two independent regulations from opposite directions; row 9 is four sources on joint records; row 10 is the shared layer's own `issuer` field plus DCSA's code-plus-issuing-authority pattern.                                                                                                                                                                                                                                                            |
| **§5 the table, rows 1-5, 8, 11**                                                 | **Medium — [ORIGINAL] in the step that matters**  | Every row's _duty_ is sourced (who must record, who must perform, who must approve). **Converting a recording duty into assertional authority is authored in every one of them.** The failure mode is a role that has the duty but not the knowledge — e.g. `src:dp3-tender-of-service` puts the arrival-recording duty on the TSP, but on a consolidated van the driver knows and the TSP's office does not. If A8 proper finds a published model that separates duty-to-record from authority-to-assert, revisit these seven rows first.                              |
| **§7.1 A8-MOVE (41 vs 349 as the hinge)**                                         | **Medium-high**                                   | The two codes and their _responsibility_ definitions are sourced verbatim; equating responsibility with assertional authority is [ORIGINAL]. It is the cheapest possible hinge — it adds no field, because `A3` and shared §8.2 already carry `custodyBasis` — which is also why getting it wrong is cheap to fix.                                                                                                                                                                                                                                                      |
| **§7.1 A8-MOVE's amendment (the receipt instant, and the transfer-gap clause)**   | **Not scored — [ORIGINAL], provisional**          | Forced by [shared §4.7.2f](00-shared-decisions.md): a transfer has two instants now, so the rule must name one. Nothing new is sourced; the reasons for choosing the receipt are internal (M1, and §7.4(b)'s "never stops being authoritative for facts before the handoff"). This document has not ratified it, so [shared §4.7 note 3](00-shared-decisions.md) bars it from scoring a dependent decision at any level. What would overturn it: a published model that moves responsibility at the release, or a §5 `handover` row that decides the question directly. |
| **§5's missing `handover` row (F3)**                                              | **Not scored — owed**                             | §5 has no row and the shared table now marks `handover`'s `boundBy` **owed, expressly not `CUSTODY`**. Under **A8-NAMED** every handover `FactResolved` must name a rule and there is none to name. The provisional reading — the role on the key's own `side` — is [ORIGINAL] and is sourced only in the sense that `src:stedi-x12-reference` restricts each code to one carrier. Writing the row is this document's, and it is the highest-value gap F1 left behind.                                                                                                  |
| **§7.2 A8-LIABILITY**                                                             | **High**                                          | §B.3.f-g is unambiguous and is reinforced by three further prohibitions. This is the rule most likely to be _forgotten_ rather than disputed.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **§7.3 A8-JOINT**                                                                 | **High on the need, [ORIGINAL] on the mechanism** | Five sources require joint or dual records at a boundary and one states the dissent rule verbatim. What is authored is letting `FactResolved.selected` be empty. If a consumer proves it cannot tolerate an unresolved fact, the fix is a **downstream** named rule, never selecting inside the resolution — selecting there would destroy the one thing every source in this row preserves.                                                                                                                                                                            |
| **§7.4 A8-AFTER**                                                                 | **Medium-high — [ORIGINAL]**                      | Follows from A8-INSTANT, so it inherits that confidence. Its value is defensive: it is a _stronger_ answer than "authority stops at the handoff" because it needs no re-evaluation pass, and the corpus's only published behaviour here (`src:sirva-ade` dropping the replaced provider) is the anti-pattern.                                                                                                                                                                                                                                                           |
| **§7.5 A8-PRINCIPAL**                                                             | **Medium-high**                                   | The depositor substitution and its exact instant are quoted from two independent regulations; the Maintaining/Responsible PPSO split is a second axis-separation instance. The generalisation to a `boundBy` value is ours.                                                                                                                                                                                                                                                                                                                                             |
| **§8 A8-UNAUTH**                                                                  | **Medium-high**                                   | Decidable, with two sourced worked cases including one where the same act flips authorisation by elapsed silence. It inherits §5's medium on the seven authored rows: an `UNAUTHORISED` verdict is only as good as the row it consults.                                                                                                                                                                                                                                                                                                                                 |
| **The document as a whole, as an input to other documents' confidence**           | **Medium**                                        | [Shared §10.4](00-shared-decisions.md) bars a dependent decision from scoring high until A8 is written. **This skeleton lifts that bar to _medium_, not to _high_, and only for the ten fact classes in §5.** §9 lists ten outstanding items; items 1, 2 and 3 in particular mean `assertedBy.partyRef` still has no schema and half the roles §5 names are undefined. A document that depends on authority for a fact class **not** in §5 gains nothing here and must still cap itself — including a class [shared §4.7](00-shared-decisions.md) marks **owed**.       |

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
4. **Two worked cases arrive with it** — `src:dtr-part-iv` §C.4.a's conditional refusal permission
   for §8's `A8-UNAUTH`, and `src:dcsa`'s JIT `classifierCode` for §9 item 9's neighbourhood.

**The lesson, and it is the mirror of [A4 §4.4]'s.** A4 found that a claim about **one publisher**
had been read as a claim about **the corpus**. This is the same error in the other direction: a
claim about **the corpus** that had not been tested against it. Both sentences were written in good
faith from material that was in front of the author; neither survived a read aimed at it.
