# Domain reference — the full role vocabulary (`[A8 §9 item 2]`): plan

**Written 2026-10-09**, to be read by a session with **no prior context**. Everything needed to
start is here or is named by path. Read this whole file before starting.

It follows `plans/completed/domain-reference-a8-item3.md`, whose round landed at catalog `0.6.4`
with a **byte-identical** emitted diff. **This round will not be like that one**: item 2's debt is
**emitted** (§0), so it ends in a version bump and a change class.

---

## Resume here

**THIS ROUND HAS NOT STARTED.** No design decision has been taken.

### Where

- **Branch:** `chore/dr-role-vocabulary`, cut from `main` at `118110b2` in
  `/home/steve/repos/pegasus-deps-advisory-flip` (Postgres `pegasus-pg-deps-advisory-flip`, port
  **5459** — **not needed**; nothing in `packages/domain-reference` touches it).
- **Last domain-reference commit:** `118110b2`, the item-3 round (#823).

### Status

- [x] §1.3 — the measurements → **§1.3b**, 2026-10-09. §1.3a's preliminary readings were
      re-verified there; one was **refuted**.
- [ ] §1.2 — the decision: what does item 2 actually owe, and is any of it closable?
      **One sub-decision is the USER'S** — §5's `customer`/`goodsOwner` question, which is breaking.
- [ ] implementation, gates, tamper pass, cross-area edits, round record

### Next action

**§1.3b is written and committed. Write §1.2's decision against it** — and note that it reframes
the item: the prose list and the cited debt overlap in **one** entry of thirteen-and-ten, **seven**
of the ten owed entries want something no enum can supply, and §375.205's material belongs to
`[A8 §9 item 4]`. One sub-decision is **the user's** and is asked in §5.

---

## 0. Why this item is the blocking one, measured rather than asserted

**Item 2 is now the sole blocker on two markers the item-3 round re-pointed to it**, and it is the
only `[A8 §9]` item whose debt reaches the **wire**:

1. **`src/custody.ts`'s `CustodyHolder`** — `TODO([A8 §9 item 2])`. The union's two arms are a
   `partyRole` ref and a `party` ref; collapsing it means resolving a role-holding to a party, which
   needs the role vocabulary. Item 3 took its own name off this marker on 2026-10-09.
2. **`src/rules/authority.ts`'s `authorityToDeclare`** — `TODO([A8 §9 items 2, 5])`.
3. **`data/authority-table.json` carries TEN `owedTo` entries naming this item, across EIGHT rows**
   (`arrival`, `departure`, `storeOut`, `condition`, `identity`, `charge` ×3, `documentIssuance`).
   **`owedTo` is a published `const`** — it is emitted into the catalog — so **any** of these
   resolving changes emitted bytes. Contrast item 3, which emitted nothing.

**And one thing it is NOT blocked by, which a reader will assume it is.** `roleClass` is
`refusedOnEvidence` (`[A8 §9 item 2]`, 2026-10-06) with a live gate, `RoleClassStaysOwed`. That
refusal is of **the class-of-party vocabulary a reason is attributed to**, which is a _different
vocabulary_ from the role enum this item owes. **Closing some of the role enum does not touch the
refusal, and must not be written as if it did.** See §1.4.

---

## 1. THE DELIVERABLE

### 1.1 What `[A8 §9 item 2]` says, and the material it already names

Read the item itself first: `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 2**,
**including its two annotations** — (a) the `roleClass` refusal and (b) the non-party value — and the
**three pieces of evidence element 98 hands this item** that are recorded there and are not
decisions.

Then read **§2** (heading _"Naming the roles — the two traps, and which vocabulary this document
takes"_), which is where the vocabulary comes from and where **the addition test** lives:

> Four roles are **added** here because **they assert facts and ADE has no slot for them**.

**That test is the whole of this round's method.** Element 98's capture says so in terms about
`tariffOwner`: _"What still blocks the member is A8 §2's addition test… and that is A8's to apply, so
the row stays owed."_ Applying it is this item's job.

The names item 2 enumerates: `accountParty`, `goodsOwner`, `weighMaster`, the **government offices**
(PPSO/PPPO/TO/ITO/JPPSO/SB/SPM — `src:dp3-400ng`, `src:dtr-part-iv`), the **NTS warehouseman** and
whether it is ADE's `SITAgent`, the **`TSP for Carriage`** (`src:dp3-tender-of-service` NTS §1.6.10,
§5.8 — _"a named third party in the custody chain"_), `Move Management Company`, `Trusted Agent`,
`Claims Manager`, `Designated Agent` (`src:dp3-400ng` Definitions p.11 — appointed by power of
attorney to act **in place of the customer**), **broker**, and the **prime / emergency-or-temporary
agent** split (`src:cfr-49-375` §375.205).

Already read and in the repo, so **nothing may be scheduled against fetching it**:
`docs/domain-reference/sources/stedi-x12-reference/captured/stedi-element-98-party-roles-notes.md`
carries a full `ROLE_NAMES` ↔ element 98 cross-walk. **Read it before measuring anything**, because
it has already done the "is there an industry counterpart?" pass for every existing member.

### 1.2 The candidate shapes — none costed, and the decision is NOT pre-committed

- **Add the well-sourced roles to `ROLE_NAMES` and resolve the rows that name them.** Additive on the
  enum; **but every resolved `owedTo` is an emitted change**, so this has a version cost item 3 did
  not. The addition test is what licenses each member, one at a time.
- **Split the item.** §1.3a's preliminary reading is that the table asks for two different kinds of
  thing and only one of them can be an enum member. If that holds, the item closes **in part** and
  re-points the rest, which is the shape `[A8 §9 item 1]` used.
- **Refuse, in whole or in part**, like `roleClass` and `identityScheme`. A role named by a
  regulation but **asserting nothing** fails §2's addition test, and failing the test is a reason to
  record a refusal rather than a backlog item. **This is a live outcome, not a failure mode.**
- **Partially close and leave the government offices owed**, since they are the largest sub-list and
  the one most likely to need `accountParty`'s "one role rather than three" decision reopened —
  which §2 marks **[ORIGINAL]**.

### 1.3 What to MEASURE before designing — this is the planning pass

> **ANSWERED 2026-10-09 — the answers are §1.3b below.** The questions and §1.3a's preliminary
> readings are left as written: two of those readings survived re-verification, one was **refuted**
> by going to the bytes (§1.3b item 6), and which is which is the transferable part.

Nothing below is a step to execute. **Both previous rounds found the plan's own framing broke
first**, so each item is a question whose answer changes the design.

1. **Does item 2's prose list name the same things the authority table asks for?** Enumerate both
   sides by name. The table's eight rows are listed in §0 item 3; the prose list is in §1.1. **Assume
   they disagree until you have checked**, because that is what both previous rounds found about a
   `[A8 §9]` item's own list — item 1's was wrong about cardinality, item 3's about membership.
2. **For each owed `owedTo`, is what it wants a ROLE at all?** §1.3a's preliminary reading says some
   are **complements and relations** (_"the non-inspecting parties"_, _"the counterparty echoing the
   value back"_, _"everyone else"_, _"the party the instrument is issued TO"_), which no enum member
   can express. **If that holds, those rows are not this item's debt** and saying so is worth more
   than a member. Check every one; do not generalise from the three quoted here.
3. **Apply §2's addition test, per candidate role, and write down the answer per role.** The test is
   two conjuncts: _does it assert facts_, **and** _does ADE have no slot for it_. A role that fails
   either is not a member. The second conjunct needs `src:sirva-ade`'s cast
   (`Resource.Type` + the settlement view), which is in that source's `analysis.md`.
4. **Does `ROLE_NAMES` already disagree with a RULE about a name?** §1.3a's preliminary reading is
   that **A8-NAME-2 fixes the name `goodsOwner` and the enum carries `customer`**. If so this is
   **F5's defect one level up** — F5 closed a _case_ mismatch between a rule and the enum, and
   `[catalog §2.3]` classifies a spelling change as **`changedRoleNameSpelling`, breaking**. Decide
   which of the two is wrong before adding anything, because a round that adds members on top of a
   name defect ships the defect.
5. **What does the NTS question actually turn on?** Item 2 asks outright whether the NTS
   warehouseman is ADE's `SITAgent`; `authority-table.json` row `storeOut` says the two are _"written
   separately rather than fused by assumption"_; element 98 keeps **three** codes apart
   (`WH Warehouse`, `8F Bailment Warehouse`, `NS Non-Temporary Storage Facility`) and its capture
   calls that _"evidence toward a split; not a decision, which is A8's"_. **Read `src:dp3-400ng` and
   `src:dp3-tender-of-service` on the NTS warehouseman's duties before deciding**, and note that
   neither has a `captured/` directory — grade accordingly.
6. **Does any of this reach the wire, and how much?** `owedTo` is a published `const`. **Regenerate
   the catalog and read the diff before classifying** — §3 item 8, which has now located something
   the decision did not predict four rounds running and **confirmed** one on the fifth. Expect a
   bump; find out which slot.

### 1.3a Readings already taken while writing this plan — EACH MUST BE RE-VERIFIED

> **Recorded rather than hidden, and marked rather than presented as settled.** A plan that hides
> its author's preliminary readings makes the next session redo them; a plan that states them as
> findings repeats the failure both previous rounds recorded. These were taken in one orientation
> pass on 2026-10-09 and **none of them has been tamper-tested or cross-checked.**

1. **The authority table's ten `owedTo` entries, with what each asks for** (from
   `data/authority-table.json`, read by walking the `standings` tree):

   | row                | standing                 | what the entry names                                                   |
   | ------------------ | ------------------------ | ---------------------------------------------------------------------- |
   | `arrival`          | advisory                 | "visibility providers (`src:dcsa` VSP / SVP)"                          |
   | `departure`        | advisory                 | "visibility providers (`src:dcsa` VSP / SVP)"                          |
   | `storeOut`         | **authoritative**        | "the warehouseman holding the goods"                                   |
   | `condition`        | corroborating            | "the non-inspecting parties"                                           |
   | `identity`         | corroborating / advisory | "the counterparty echoing the value back" / "everyone else"            |
   | `charge` PROPOSED  | authoritative-by-value   | "the performing role" — and its `owedTo` says **"Not fixed"**          |
   | `charge` RATED     | authoritative-by-value   | "the tariff owner — the van line, or the party whose tariff prices it" |
   | `charge`           | competing                | "the performing role, on quantum"                                      |
   | `documentIssuance` | corroborating            | "the party the instrument is issued TO, echoing its number back"       |

2. **Preliminary reading, to be checked as §1.3 item 2:** only **two or three** of those want an enum
   member — `storeOut`'s warehouseman, `charge` RATED's tariff owner, and arguably the visibility
   providers. The rest are **complements** ("the non-inspecting parties", "everyone else") or
   **relations to the fact** ("the counterparty echoing the value back", "the party the instrument is
   issued TO", "whichever role performed the act this charge is for"). **If that holds, item 2 is
   owed for things no role enum can supply, and the finding is a re-point rather than a vocabulary.**
3. **Preliminary reading, to be checked as §1.3 item 4:** `ROLE_NAMES` has **18** members and
   `goodsOwner` is **not** one of them — it appears once in the whole of `src/`, inside `customer`'s
   docstring (`src/envelope.ts:222`). A8-NAME-2's text says it is _"replaced by two separate roles:
   `accountParty` … and `goodsOwner`"_ and that the **[ORIGINAL]** part is _"making it a hard rule and
   **fixing the two names**"_.
4. **Preliminary reading:** of item 2's prose list, `accountParty` and `weighMaster` **are already
   members** — so for those the item owes a _definition_, not a member. That makes three distinct
   states conflated in one list: member-exists-definition-owed, rule-fixed-a-name-the-enum-lacks, and
   no-member-at-all. **Check whether that three-way split is real before using it.**
5. **Element 98 is read and must not be re-read as if unread.** Its capture already supplies: the NTS
   split evidence, `TI Tariff Issuer` for the tariff owner, the `weighMaster` near-miss inversion
   (`R1` is the ticket's _recipient_, `src:cfr-49-375` §375.519(a) puts the signature on its
   _author_), the `booker`/`OE Booking Office` false friend, and **"nothing in 1312 codes names a
   household-goods role"** — zero results for `household`, `van line`, `mover`, `relocat`,
   `moving company`.

### 1.3b The measurements, ANSWERED — 2026-10-09, before anything was designed

**The headline, and it is the third round running that an `[A8 §9]` item's own framing broke first:
item 2's prose list and the debt item 2 is CITED FOR overlap in ONE entry.** The prose list names
thirteen things; `data/authority-table.json` asks for ten; the intersection is the **warehouseman**
(`storeOut`). And of the ten the table asks for, **seven want something no role enum can supply.**

#### item 1 — does item 2's prose list name the same things the authority table asks for? NO

| the table asks for (10, across 8 rows)                                                              | is it in item 2's prose list? |
| --------------------------------------------------------------------------------------------------- | ----------------------------- |
| `arrival` advisory — "visibility providers (`src:dcsa` VSP / SVP)"                                  | **no**                        |
| `departure` advisory — same                                                                         | **no**                        |
| `storeOut` **authoritative** — "the warehouseman holding the goods"                                 | **YES** — the one overlap     |
| `condition` corroborating — "the non-inspecting parties"                                            | **no**                        |
| `identity` corroborating — "the counterparty echoing the value back"                                | **no**                        |
| `identity` advisory — "everyone else"                                                               | **no**                        |
| `charge` PROPOSED — "the performing role", `owedTo` says **"Not fixed"**                            | **no**                        |
| `charge` RATED — "the tariff owner — the van line, or the party whose tariff prices it"             | **no**                        |
| `charge` competing — "the performing role, on quantum"                                              | **no**                        |
| `documentIssuance` corroborating — "the party the instrument is issued TO, echoing its number back" | **no**                        |

And in the other direction, **none** of `goodsOwner`, the government offices, `TSP for Carriage`,
`Move Management Company`, `Trusted Agent`, `Claims Manager`, `Designated Agent`, `broker` or the
prime / emergency-or-temporary split appears in any `owedTo`. **The item's list is not an inventory
of its debt; it is a list of names the corpus uses.** Those are different things, and this is the
third `[A8 §9]` item in a row whose own list had to be corrected before the item could be answered
(item 1's was wrong about cardinality, item 3's about membership, item 2's about **what the list is
for**).

#### item 2 — for each owed entry, is what it wants a ROLE at all? THREE of TEN

- **Wants an enum member (3):** `storeOut`'s warehouseman; `charge` RATED's **tariff owner** (which
  element 98 already cross-walked to `TI Tariff Issuer`, also `CO Ocean Tariff Conference`); and
  `arrival`/`departure`'s **visibility providers**, one designation used twice — and **the
  best-graded candidate in the whole item**, see item 6.
- **Cannot be an enum member (7), in two distinct ways:**
  - **Complements** — "the non-inspecting parties", "everyone else". These are defined by
    _who is not the authoritative asserter on this fact_, so their extension changes per fact. A
    member spelled `nonInspectingParty` would be a role nobody holds.
  - **Relations to the fact or the instrument** — "the counterparty echoing the value back", "the
    party the instrument is issued TO", and **"the performing role" twice, whose own `owedTo` says
    _"Not fixed — it is whichever role performed the act the charge is for, so it varies by
    charge"_.** The table has already written down that this one is a _function of the charge_, not
    a member — so one of the ten entries **says in its own text that item 2 cannot close it**.

**Consequence to decide in §1.2, not here: seven of the ten rows are owed to the wrong item.** What
they want is a rule that computes a standing from the fact (`[A8 §4]`'s shape — authority as a
function), which is `[A8 §9 item 5]`'s territory (cardinality and exclusivity) or a new item, not a
vocabulary.

#### item 3 — §2's addition test, applied per candidate. FIVE outcomes, not one

> The test, quoted from §2: a role is added "because **they assert facts** and **ADE has no slot for
> them**". Two conjuncts. Applied per name:

| candidate                                       | asserts facts?                                                                                                                                                                       | verdict                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `accountParty`, `weighMaster`                   | yes — and they are **already members**                                                                                                                                               | **the item owes a DEFINITION, not a member**      |
| `goodsOwner`                                    | yes — but the enum spells it **`customer`**                                                                                                                                          | **a NAME defect, see item 4 below**               |
| NTS **warehouseman**                            | **yes, sourced**: `src:dp3-400ng` Item 17.12 requires **both** TSP and warehouseman to hold the condition of each article "when received at and forwarded from the storage location" | **candidate member**                              |
| **`TSP for Carriage`**                          | yes — "the line-haul carrier that collects a lot **from** an NTS warehouse, a named third party in the custody chain", i.e. a party to a **handover**                                | **candidate member, but check against `hauler`**  |
| **tariff owner** (from the table, not the list) | `[A8 §5]` row 11 makes it the rating authority                                                                                                                                       | **candidate member**                              |
| `Trusted Agent`                                 | **no** — "a named individual _expected to be very familiar with DoW processes and readily accessible to DoW PPA_". An escalation contact, disclosed in DPS                           | **fails the test**                                |
| `Claims Manager`                                | **no** — "a named role the TSP must **declare in the DPS Qualifications module**". A disclosure requirement                                                                          | **fails the test** (and claims are A11's)         |
| `prime agent` / `emergency or temporary agent`  | see below — they are a **second axis**                                                                                                                                               | **`[A8 §9 item 4]`'s, not this item's**           |
| `Designated Agent`                              | yes, but **"in place of the customer"** by power of attorney                                                                                                                         | **`[A8 §9 item 4]`'s**                            |
| `Move Management Company`                       | yes, but **"on behalf of a SCAC"** — and "**may not be named as the origin servicing agent**"                                                                                        | **item 4's, plus an item 5 exclusivity rule**     |
| `broker`                                        | the corpus defines it by **exclusion**                                                                                                                                               | **not definable from what is read**               |
| the **government offices**                      | yes — "approve, pre-approve, dispute and pay"                                                                                                                                        | **already folded into `accountParty`; see below** |

**The sharpest result, and it is one of this item's two primary captured witnesses** (the other is
`src:dcsa`, item 6). `src:cfr-49-375`
**§ 375.205 _"May I have agents?"_** defines both agent types by **on whose behalf** and **under
what agreement**, not by function:

> _"(1) A **prime agent** provides a transportation service **for you or on your behalf**, including
> the selling of, or arranging for, a transportation service. You permit or require the agent to
> provide services under the terms of an **agreement or arrangement** with you. A prime agent does
> not provide services on an emergency or temporary basis. A prime agent does not include a
> household goods **broker** or freight forwarder. (2) An **emergency or temporary agent** provides
> origin or destination services on your behalf, **excluding** the selling of, or arranging for, a
> transportation service…"_ — plus (b) a **signed written agreement** and (c) **24-month retention**.

**That is not a pair of role names; it is a second axis over the names we already have.** A prime
agent may be a `booker` ("the selling of, or arranging for"), an `originAgent` or a `hauler`; the
emergency-or-temporary agent is the same functions minus the selling. Putting `primeAgent` in
`ROLE_NAMES` would put **two axes in one enum** — which is the defect `[A8 §3(a)]` and `[SD §1.1]`'s
"no second classification axis" both exist to prevent, and which **A8-NAME-1 already half-saw**
("the bare word `agent` is not a role in this model"). And `[A8 §9 item 4]` already names this exact
material as its own: _"Delegation and on-behalf-of… it does not model the chain that holds it.
Material exists and is unused: `src:cfr-49-375` §375.205's written prime-agent [agreement]"_.
`Designated Agent` ("in place of the customer") and the MMC ("on behalf of a SCAC") are the same
shape from two other sources.

**`broker` is defined in this corpus only by exclusion.** §375.205(a)(1): _"A prime agent does not
include a household goods broker or freight forwarder"_; `src:dtr-part-iv` has _"carrier's agent
**explicitly distinguished from a broker**"_. Both say what a broker is **not**. A member minted
from a negative would be ours — `[SD §0]`.

**The government offices are not a missing name; they are a question about an existing `[ORIGINAL]`
decision.** §2's own addition table folded PPSO/PPPO/TO into **`accountParty`** and marked the fold
authored: _"Sourced that the party exists and decides things; **[ORIGINAL]** that it is **one role
rather than three**."_ So this sub-list asks whether to **unfold** it — and there is evidence:
`src:dtr-part-iv` A-406 §B.8's **Maintaining vs Responsible PPSO** split, which its analysis calls
_"a genuinely good idea: account ownership and geographic ownership are different roles over the
same lot, with a mandatory copy-everyone protocol"_. **Unfolding is a change to a published member's
meaning, which is not additive.** Decide deliberately or leave it owed.

#### item 4 — does `ROLE_NAMES` already disagree with a RULE about a name? YES

**A8-NAME-2 fixes the names `accountParty` and `goodsOwner`** — and says so about itself:
_"**[ORIGINAL]:** making it a hard rule and **fixing the two names**"_. **`ROLE_NAMES` carries
`customer`, not `goodsOwner`.** Verified: 18 members, and `goodsOwner` occurs exactly once in all of
`src/` — inside `customer`'s own docstring (`src/envelope.ts:222`), as a gloss: _"The party whose
goods move — `goodsOwner` at the residence, per **A8-NAME-2**'s two-way split"_.

**This is F5's defect one level up.** F5 closed a _case_ mismatch between a rule and the enum and
recorded why it was not cosmetic: a role name rides inside `handover`'s **qualifier**, `[SD §1.3]`
derives the fact key from the qualifier, so **two spellings of one role are two fact keys** — facts
that never pair and never contest. F5's mismatch was `OriginAgent`/`originAgent`; this one is a
different **word**.

**It is NOT obvious which side is wrong, and that is why it is a decision rather than a fix.**
~~`customer` is the better-sourced name for who signs at the residence~~ — **REFUTED 2026-10-09 by
the user's challenge, see §1.3c.** `src:cfr-49-375` uses the word `customer` **six** times and
**never for a party with a duty**; its defined term is `individual shipper`, **189** occurrences, and
**two of the four signature citations behind that sentence contain no signature at all**.
`goodsOwner` is the name the **rule** fixed, it matches the axis the regulation turns on
(ownership-plus-payment), and it does not collide with `src:dp3-400ng`'s inversion of "customer". **Changing the enum is
`changedRoleNameSpelling` — breaking, a new major (`[catalog §2.3]`)**; annotating the rule is free.
**→ ASK THE USER** (§5).

#### item 5 — what does the NTS question turn on?

Three readings, and they do not agree:

- **`[A8 §9 item 2]`** asks outright whether the NTS warehouseman "is the same role as ADE's
  `SITAgent`".
- **`data/authority-table.json`** row `storeOut` already writes them _"separately rather than fused
  by assumption"_ — so the table has taken the conservative branch and is waiting to be told.
- **element 98 keeps three apart** — `WH Warehouse`, `8F Bailment Warehouse`
  (_"owned by an organization, but the inventory … belongs to the supplier until the organization
  owning the warehouse legally purchases the goods"_) and `NS Non-Temporary Storage Facility` — which
  its capture calls _"evidence toward a split; not a decision, which is A8's"_.

**And the duty that makes the warehouseman an asserter is sourced**: `src:dp3-400ng` Item 17.12
requires **both** TSP and warehouseman to hold the condition of each article at receipt and at
forwarding — _"two independent records of the same thing, by design"_, which is also what
`[A8 §7.3]` quotes it for.

#### item 6 — the GRADE, which splits the list along a line the item does not draw

| source                      | `captured/`? | which of item 2's candidates it is the witness for                                                                |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `src:cfr-49-375`            | **yes** (1)  | the prime / emergency-or-temporary split, and `broker`-by-exclusion — i.e. **the material that is item 4's**      |
| `src:dcsa`                  | **yes**      | the **visibility providers** — and this one was checked in the captured bytes rather than the analysis, see below |
| `src:milmove-mymove`        | **yes** (4)  | nothing on this list directly                                                                                     |
| `src:dp3-400ng`             | **no**       | the government offices, the NTS warehouseman, `Designated Agent`                                                  |
| `src:dtr-part-iv`           | **no**       | the government offices, `TSP for Carriage`, broker-by-distinction, the Maintaining/Responsible PPSO split         |
| `src:dp3-tender-of-service` | **no**       | `TSP for Carriage`, `Move Management Company`, `Trusted Agent`, `Claims Manager`                                  |
| `src:sirva-ade`             | **no**       | the whole existing cast                                                                                           |

**The first draft of this table said "every candidate MEMBER rests on `secondary` grade, and the
item's only primary captured evidence is for the material that belongs to item 4". Going to the
DCSA bytes refuted it, and the refutation is the best news in the measurement.**
`captured/DCSA-OpenAPI/domain/event/event_domain_v3.2.0.yaml:2609-2628` publishes
**`tntPublisherRole`**, described as:

> _"The **party function code of the publisher**. The values are divided into 2 categories:
> **Carrier** — `CA (Carrier)`, `AG (Carrier local agent)`; **Service Provider** —
> `VSP (Visibility Service Provider)`, `SVP (Any other service provider)`"_

— a **closed four-member enum**, primary and captured, and it is explicitly the role of **the party
that PUBLISHES the event**, i.e. an **asserter**. It sits on the same schema as
`transportEventTypeCode` (`ARRI (Arrived)` / `DEPA (Departed)`), which is exactly the two rows
(`arrival`, `departure`) whose advisory standing is owed to this item.

**So the visibility provider passes §2's addition test on primary captured evidence** — it asserts
(it publishes the event) and ADE has no slot for it — and it is the only candidate in the item that
does. The warehouseman, the `TSP for Carriage` and the tariff owner rest on `secondary` grade, which
is legitimate here and is what most of the existing cast rests on, but **this round must not describe
those three as well-sourced**. That exposure is the shape of the **new `[A8 §10]` confidence row**
this item already owes (§5).

**And `tntPublisherRole` hands this item two more things it did not ask for.** `AG (Carrier local
agent)` distinguishes a carrier from its own local agent, which is A8-NAME-1's concern from a second
publisher; and `SVP (Any other service provider)` is an **explicit open slot beside a closed list**,
which is precisely the shape `[A9 §3.2]` refused `identityScheme` on. **Whether that makes the role
enum unclosable too is a question this round must answer rather than inherit** — `[A8 §2]` already
calls `ROLE_NAMES` "provisional" and says an authority module "may refine this; it may not quietly
widen it".

#### item 7 — does it reach the wire? NOT MEASURED YET

`owedTo` is a published `const`, so resolving any entry emits. **Regenerate and read the diff before
classifying** — do not pick the change class from the intent. Item 3's expectation was "probably
nothing" and the generator confirmed it; this round's expectation is "a bump", and the generator
decides which slot.

---

### 1.3c The `customer` name, measured in the primary bytes — and a MISCITATION older than this round

**Opened by the user on 2026-10-09, challenging this plan's own claim** that `customer` is "the
better-sourced word for who signs at the residence". The user's reading: in practice _customer_ is
whoever **pays**, _shipper_ is whoever is responsible for the goods **at origin**, and _consignee_ is
whoever is responsible **at destination** — effectively a goods-owner at each end. **The challenge
was right to be made, and checking it in the captured bytes refuted two of this corpus's citations
and the plan's own sentence.**

#### (a) `customer` is not a term `src:cfr-49-375` uses for anybody with a duty

Counted over the captured XML:

| word                      | occurrences | what they are                                                                                                                                                                       |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`individual shipper`**  | **189**     | a **§ 375.103 defined term**, and the subject of every signature and every writing obligation in the part                                                                           |
| `consignor` / `consignee` | 6 / 6       | **only** inside the two shipper definitions, as **positions on the bill of lading** — "is identified as the shipper, consignor, or consignee **on the face of the bill of lading**" |
| `customer`                | **6**       | **not a defined term, and never carries a duty**                                                                                                                                    |

All six `customer` occurrences, enumerated rather than counted: a **bank's** customer (inside the
`Cashier's check` definition), the **subpart heading** _"Before Offering Services to My Customers"_,
a complaint-procedure description, the consumer pamphlet's heading _"Customer's Responsibilities"_,
that pamphlet's plain-English address to the reader (_"As a customer, you have responsibilities both
to your mover and to yourself"_), and _"another customer's move"_. **Four of the six are a heading or
Appendix A's plain-English pamphlet, not the regulation's operative text.**

**So the regulation's own axis is ownership-plus-payment, not customer-hood**: `Individual shipper`
is named on the BOL **and** owns the goods **and** pays his or her own charges; `Commercial shipper`
is named as consignor or consignee, **is not the owner**, and pays for the beneficial owner's
account. Consignor and consignee are **where you are named**, not what you are.

**The user's three-way decomposition is real practice and the corpus cuts it differently.** It is not
that the model is wrong to have one role; it is that **`customer` is the one word in the area that
`src:cfr-49-375` never uses for the party with the duties**, while the model keeps a _separate_ role
for whoever pays (`accountParty`). Naming the residence party `customer` therefore invites a reader
to file the payer there — **which is the exact ambiguity A8-NAME-2 was created to abolish**,
reintroduced by the enum's choice of word rather than by the rule's.

#### (b) The origin / destination half is separable, and the model already answers it elsewhere

Three independent readings agree that "responsible at origin" vs "responsible at destination" is
**not** two roles in this model:

- `src:cfr-49-375` makes consignor/consignee **BOL positions** and runs every duty through the one
  term `individual shipper` — **including both ends of the same document**: § 375.503(c) has the
  inventory _"signed by both you and the individual shipper"_ at loading, and § 375.503(d) gives
  _"the individual shipper"_ the opportunity to note missing or damaged articles **at delivery**. One
  term, both ends.
- `[A8 §7.3]` and `HandoverQualifier` already carry **releasing / receiving as a qualifier `side`**,
  which is where F5 found the fact key is derived from.
- `src:milmove-mymove` publishes the split at **person** grain — `MTOAgent`
  `RELEASING_AGENT` / `RECEIVING_AGENT` — and item 3 measured that record as a **permission**, not an
  assertion.

**And `[A8 §9 item 3]` just settled the pattern this follows**: a distinction the corpus draws per
act belongs on the assertion, not on the party. So a `goodsOwnerOrigin` / `goodsOwnerDestination`
split would be putting the handover's `side` into the role enum — two axes in one enum again, the
same defect § 375.205 produces from the other direction (§1.3b item 3).

#### (c) The MISCITATION, which is this item's and is older than this round

`[A8 §2]`'s addition table and `envelope.ts`'s `customer` docstring both say:

> _"`src:cfr-49-375` requires the customer's signature on the BOL (**§375.505(a)**), the inventory
> (§375.503), the delivery receipt (**§375.701**) and any waiver of a weighing observation
> (§375.515(b))… The obligation to sign is sourced **four times**."_

**Two of the four do not say that.** Read in the capture:

- **§ 375.505(a)** — _"Before you receive a shipment… **you must prepare and issue** a bill of
  lading"_. The obligation is the **carrier's**, and the individual shipper appears in the 17 required
  items as **item (3), a name and address**. Being named on a document is not signing it.
- **§ 375.701** — heading _"May I provide for a release of liability on my delivery receipt?"_. It
  says the receipt _"must not contain any language purporting to release or discharge you or your
  agents from liability"_ and **may** state apparent good condition. **There is no signature in the
  section at all.**

**And the two strongest real instances are cited NOWHERE in the corpus.** Enumerated from the bytes,
the individual shipper signs or writes in at least a dozen places, and these two are the sharpest:

- **§ 375.401(h)** — _"**You and the individual shipper must sign the estimate of charges.**"_ A
  **mutual** signature, and on a **money** document — so it bears on `[A8 §5]` row 11 (`charge`) and
  on `[A7]`, not only on `delivery`.
- **§ 375.213(f)(1)** — _"you must obtain a **signed, dated receipt** showing the individual shipper
  has received…"_ the consumer-protection publications, retained one year.

Others, for the record: § 375.201(c) waiving full-value liability in writing; § 375.203(b)-(c)
notifying in writing of articles over $100/lb; § 375.217(a) and § 375.407(a) agreeing in writing to a
change in the form of payment; § 375.401(a)(2) the physical-survey waiver _"signed by the shipper
before the shipment is loaded"_; § 375.403 and § 375.405 the new estimates and their written
attachments _"signed by the individual shipper"_; § 375.503(c) the inventory; § 375.503(d) noting
missing articles at delivery; § 375.505's Full Value Protection waiver _"in writing on the STB's
valuation statement"_; § 375.515(b) the re-weighing waiver.

> **This is not a miscount; it is two citations that do not contain what they are cited for, in a
> corpus whose `[SD §0]` exists to stop exactly that — and it is load-bearing.** `[A8 §5]` row 5's
> evidence column opens **"Sourced, heavily:"** and its first clause is _"`src:cfr-49-375`
> § 375.701 — **the delivery receipt is signed by the shipper**"_, which § 375.701 does not say; the
> same sentence is in `data/authority-table.json` row `delivery`. Row 5's **[ORIGINAL]** places
> `customer` in **competing** rather than corroborating _because_ "three sources make the customer's
> signature constitutive". **The standing survives on the real citations** — § 375.503(c)'s mutual
> signature, § 375.401(h)'s mutual signature, `src:dp3-tender-of-service` § C.17.a's jointly-signed
> notice — **but the row must be re-cited, not left as it stands.**
>
> **And I propagated it.** "Constitutive four times (§375.505(a), §375.503, §375.701, §375.515(b))"
> is in the item-3 round's `AsserterGrainIsNotOnTheEnvelope` docstring, in
> `party-grain-refuses.ts`, in `[A8 §9 item 3]`'s annotation, in that round's record, and in this
> plan — **repeated from `[A8 §2]` without reading the sections.** Correcting it is this round's,
> because `customer` is a role and this is the role round.

---

### 1.4 What this round must not do

- **It must not reopen either refused vocabulary, and must not let the role enum's progress read as
  progress on `roleClass`.** `identityScheme` (`[A9 §3.2]`) and `roleClass` (`[A8 §9 item 2]`) are
  `refusedOnEvidence` with live gates (`IdentitySchemeStaysOwed`, `RoleClassStaysOwed`). **The
  likeliest mistake this round can make is writing "item 2 is partially closed" in a way that implies
  the refusal softened** — they are two vocabularies owed by one item, and `data/owed-vocabularies.json`
  keys on the vocabulary, not the item.
- **It must not add a role that asserts nothing.** §2's addition test is two conjuncts. A role named
  by a regulation as a party to a transaction is not thereby an asserter — that is the distinction
  `weighMaster`'s near-miss and `[A8 §5]` row 6's note (_"the weigh master supplies the **evidence**,
  not the assertion"_) both turn on.
- **It must not change an existing role's spelling** without taking `[catalog §2.3]`'s
  **`changedRoleNameSpelling`** class and the **breaking** consequence deliberately, with the user
  told. F5 settled the lower-camel rule; §1.3 item 4 is about a different question (which _word_),
  and the answer may still be "annotate the rule, not the enum".
- **It must not schedule anything against fetching Atlas**, `src:x12-transportation`, or
  `src:nmfta-scac`. `[SD §0]` forbids the first in terms; the second is licensed (_"Reference code
  lists, never copy them into the repo"_); the third is `status: skipped` on the 2026-10-04 C1
  decision.
- **It must not re-point `custody.ts`'s or `authorityToDeclare`'s markers unless what they are owed
  FOR has changed.** That is the test `[A8 §9 item 1]` applied to itself and item 3 applied twice.

---

## 2. Current state and the gate commands

Catalog at `specVersion` **0.6.4**. `ROLE_NAMES` has 18 members. `party` is an `aggregate` kind.
`[A8 §9 item 1]` is partially closed, **item 3 is DECIDED**, `[A9 §3.6]` and `[A9 §3.2]` are closed.

```
npm run test        -w @pegasus/domain-reference
npm run lint        -w @pegasus/domain-reference
npm run typecheck   -w @pegasus/domain-reference
npm run alloy       -w @pegasus/domain-reference
npm run glossary    -w @pegasus/domain-reference
npm run catalog     -w @pegasus/domain-reference
npm run context-map -w @pegasus/domain-reference
```

**No count of the suite is written here on purpose** (§3 item 10). The commands produce it in about
a few seconds.

---

## 3. Landing a change — the recipe

Read §3 of `plans/completed/domain-reference-party-entity.md`, which carries the accumulated list,
then §3 of `plans/completed/domain-reference-a8-item3.md`, which records which items earned their
place most recently. The three most likely to matter here:

- **§3 item 2 — the per-member table in `data/`.** `ROLE_NAMES` is referenced by
  `data/authority-table.json`'s role names, which the loader validates. **A new member is not just an
  enum edit**, and the loader is what will tell you where else it has to appear — run the suite early
  rather than reasoning about it.
- **§3 item 8 — read the emitted diff.** Unlike item 3, this round **will** emit. Find out what, and
  pick the change class from what the diff shows rather than from the intent.
- **Sweep the ITEM, not the phrase.** `grep -rn 'A8 §9 item 2'` across `src/`, `data/`, `tests/`,
  `tools/` and `docs/domain-reference/`, and **triage by tense**. Item 3's sweep found a stale
  sentence older than its own round, and so did item 1's. Note that this item's name appears in
  **two** meanings — the role enum and the refused `roleClass` — so the sweep has to read each hit
  for _which_ debt it names.

---

## 4. The procedural lessons

Read §4 of both records. The ones most likely to bite here:

> **A plan that asks you to sort a set into two buckets may be wrong about the buckets AND the set.
> Count the set before you sort it.** (item 1) — §1.3 items 1-2 are this, applied to item 2's list.
>
> **"Nothing in our model can hold it, therefore it is X" is a claim about us, not about the
> source.** (item 1) — the trap when a regulation names a party our enum has no member for.
>
> **A citation is two claims — that the text says this, and that the text is right.** (item 1, and
> item 3 hit it again on `gbloc`) — **and the second claim's counter-evidence can be a witness you
> have already read and set aside.** Item 2's sources are heavy on prose definitions; expect this.
>
> **An `Exact<>` over an object shape does not refuse an OPTIONAL member; gate the key set.**
> (item 3) — in `dolas/agents/project/GOTCHAS.md` now, with the worked fix.
>
> **The source you have already read for ANOTHER item is the one a list omits invisibly.** (item 3) —
> element 98 was read _for this item_ and its evidence is listed in this item's own annotation, so
> here the trap runs the other way: **do not re-derive what the capture already settled.**

---

## 5. What is blocked, and on what — ask-the-user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — the
   `[ORIGINAL]` guess `[SD §0]` forbids. Record it as **`[USER]`** with the user's own words quoted.
   **Item 3 settled the half of it that was answerable**: the individual who signs asserts **under a
   role**, so what C2 still owes is what the _act_ asserts. **This round is where the roles that sign
   get named** (`Designated Agent` acts _in place of the customer_ under power of attorney), so the
   temptation to answer C2 in passing is higher here than it was in either previous round. **Do not.**

2. **`customer` or `goodsOwner`? — RAISED 2026-10-09, and it is the user's because it is BREAKING.**
   **A8-NAME-2** says of itself that the **[ORIGINAL]** part is _"making it a hard rule and **fixing
   the two names**"_, and the two names it fixes are `accountParty` and **`goodsOwner`**.
   `ROLE_NAMES` carries **`customer`**. Verified: 18 members, and `goodsOwner` occurs exactly once in
   all of `src/` — inside `customer`'s own docstring. **This is F5's defect with a different word
   instead of a different case**, and F5 recorded why it is not cosmetic: a role name rides inside
   `handover`'s qualifier, `[SD §1.3]` derives the fact key from it, so two spellings of one role are
   **two fact keys** — facts that never pair and never contest.

   **Three ways to settle it, and they do not cost the same:**

   - **Annotate the RULE** — A8-NAME-2 fixed a name the model then improved on, and `customer` stays.
     **Free**, emits nothing. `customer` is the better-sourced word for who signs at the residence
     (`src:cfr-49-375` four times; element 98's `LW Customer`), and `[fork-time §5.3]` minted it.
   - **Rename the MEMBER** to `goodsOwner`. `[catalog §2.3]`'s **`changedRoleNameSpelling`** —
     **breaking, a new major** — for consistency with the rule, against a word the corpus itself uses
     less.
   - **Keep both as two roles.** Only if the corpus distinguishes the goods' owner from the person at
     the residence; `src:cfr-49-375` § 375.103's `Individual shipper` conjoins _owns the goods_ with
     _pays his or her own charges_, and `src:dp3-400ng` splits payer from owner — so **this is not
     obviously empty** and it is item 2's to measure before it is anyone's to choose.

   **Nothing in this round depends on the answer except the write-up**, so the measurement and the
   rest of §1.2 can proceed while it is open — but **no member may be added on top of an unresolved
   name defect** (§1.4), so it gates the implementation.

### Recorded modelling questions — none is a user ask

- **`[A8 §9 item 3]`'s residue — Rule A8-SELF is under-determined.** Its independence test is at
  legal-entity grain while `assertedBy.party` may be a person, an office or a branch. **Not closable
  by effort**: it needs the person→organisation link as a _reference_ and no source publishes one. It
  wants a party-to-party relation, **adjacent to** `[A8 §9 item 1]`'s hierarchy and not identical
  (that is organisation→organisation, this is person→organisation). Whether one fact class covers
  both is **undecided** — do not assume it does.
- **`[A8 §9 item 1]`'s residue:** the party's **name** (two blockers — the legal-or-DBA disjunction,
  and the bundled address with no `place` aggregate), the **hierarchy**, and the **`PartyId` brand**
  (`SubjectRef<'party'>` is the successor shape at six sites; closing it is **breaking**).
- **`[A8 §9 item 5]`** (role cardinality and exclusivity) — now one of two owners of
  `authorityToDeclare`'s marker, and **it may become decidable as a side effect of this round**,
  since it asks how many `Hauler`s a shipment may carry. **Measure; do not promise** — item 1's §3
  item 22 is the worked example of a claim that rested on a false premise.
- **`[SD §1.2]`'s `resource` row is uncited for half of what it admits.** Its citation covers
  equipment; the words _"driver or crew member"_ carry none. Recorded by item 3, **not repaired** —
  it is `[SD §1.2]`'s and `[A3]`'s.
- **A new `[A8 §10]` confidence row is owed BY THIS ROUND.** Element 98's capture records it and says
  so: _"the cast §2 takes from `src:sirva-ade` is, as far as any read source goes, the only
  household-goods role vocabulary there is"_, and §10 _"has no row for that exposure"_. It
  _"belongs in §10 when this item is written"_. **This round is that round.** It is a judgement about
  the vocabulary, which is why the capture declined to write it.
- **`[A9 §3.3(b)]`'s SCAC gap** stays open with the fetch ruled out; `definedNotMerelyNamed: false`.
- **`[SD §10.4]`** still carries items open, and **`custody.ts` still wants a `place`** — the
  standing candidate for the next aggregate kind.
- **A bare `§n` cited ACROSS documents**: `[A2]`'s §Cross-area note to `[A3]` cites line offsets as
  if they were headings. Repairing it is `[A2]`'s and `[A3]`'s; recorded so a round that opens either
  document fixes it in passing. **Cite the heading, and verify by reading the target.**

---

## 6. How to work here

Read §6 of both records. Nothing in either is superseded. The three entries most likely to matter:

- **A gate must read the thing that DECLARES**, and **a gate whose subject is what a generator EMITS
  must read what the generator emits.**
- **Read the existing tests for the records you are writing about.** `vocabulary.test.ts` already
  builds `const roleNames = new Set<string>(ROLE_NAMES)` and checks **every role-position value in
  `data/canonical-subjects.json` and `data/authority-table.json` against it** — `authorityRoles()`
  reads the provisional rows, `tableRoles()` walks the standings. So a new member is admitted by the
  enum _and_ every table cell is already held to it. **Read that file before adding anything**: it
  tells you where a member has to appear and it is the gate that will fail if it does not.
- **Two role names contain DIGITS** — `r19Agent` and `rr19Agent`. A `grep`/regex of
  `'[a-zA-Z]+'` over the enum silently drops both and returns 16 where the answer is 18. **This
  happened while writing this plan**, to a check meant to verify the plan's own count; the count was
  right and the check was wrong. Use `[A-Za-z0-9]+`, and prefer the suite's own enumeration over any
  pattern you write.
- **Before adding a row to `data/owed-vocabularies.json`, ask whether the model has a FIELD for the
  vocabulary.** (item 3's addition.) ~~Here it does — `assertedBy.role` — so unlike item 3 this
  item's refusals, if any, **do** belong in that table.~~ **WRONG, corrected 2026-10-09:** that table
  is **per-vocabulary**, and this item's refusals are **per-member** — `Trusted Agent` and
  `Claims Manager` fail §2's addition test, but `ROLE_NAMES` itself is not refused (§2 calls it
  "provisional" and this item stays open), so no owed vocabulary's state changed and there is nothing
  to put in a `state` field. **Three things to tell apart**: a vocabulary refused (`identityScheme`,
  `roleClass` — rows here), a **member** refused from an open vocabulary (these two — no row; the
  refusal lives in `[A8 §9 item 2]`'s annotation), and a **field** refused outright (item 3's party
  class — no row, because a row needs a live `Exact<…, OwedCode<'v'>>` gate). That distinction is now
  written into the table's own `note`, which is where a reader following this instruction will look.

---

## 7. Starting the next session

Work on `chore/dr-role-vocabulary` in this worktree; nothing in `packages/domain-reference` needs
Postgres.

**Read before writing anything:**

1. **§1.3 and §1.3a of this file** — the measurements, and the preliminary readings that must be
   re-verified. §1.1 and §1.2 are a seed and say so.
2. `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 2 and both its annotations**,
   then **§2** (the addition test), then **§5**'s table and **§10**.
3. `docs/domain-reference/sources/stedi-x12-reference/captured/stedi-element-98-party-roles-notes.md`
   — **in full.** It has already done the industry cross-walk for every existing member.
4. `plans/completed/domain-reference-a8-item3.md` — §2, §3 and §4.
5. `plans/todo/ci-blockers-after-security-backlog.md` — **"Five diagnosis traps"** and **"Do not
   commit these"**, before touching anything.
