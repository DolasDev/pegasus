# Domain reference — the full role vocabulary (`[A8 §9 item 2]`): the round record

**Landed 2026-10-09 at catalog `0.7.0` — the catalog's FIRST BREAKING release.**

**What the bump is for, in one line: the role `customer` is renamed `goodsOwner`.** Everything else
in this record is subordinate to that. `[A8 §9 item 2]` is **partially closed**, with its residue
enumerated and most of its cited debt dissolved rather than filled.

This replaces `plans/in-progress/domain-reference-a8-item2.md`. Its planning pass is preserved as
§8-§10 below, because **the round's central decision was reversed by the user's challenge** and that
exchange is the most transferable thing in it.

---

## 1. What shipped

### The breaking change, and why a rename is breaking at all

`ROLE_NAMES`: **`customer` → `goodsOwner`**. `changedRoleNameSpelling` (`[catalog §2.3]`), and it is
breaking because **F5** established that a role name is a fact-key component after F1 — a role name
rides inside `handover`'s qualifier, `[SD §1.3]` derives the fact key from the qualifier, so two
spellings of one role are **two fact keys** that never pair and never contest, with no integrity
query that would notice.

**Pre-1.0 that takes the MINOR slot, not the major** — `[catalog §2.3.1]`, so `^0.6.0` refuses this
release unaided, which is that assignment's entire purpose.

**Two reasons for the rename, and the second was the user's.**

1. **A8-NAME-2 fixed this name and the enum never carried it.** The rule says of itself that its
   `[ORIGINAL]` part is _"making it a hard rule and **fixing the two names**"_, and the two it fixes
   are `accountParty` and **`goodsOwner`**. The enum spelled the second `customer` from publication
   until `0.7.0`. **F5's defect with a different word instead of a different case.**
2. **`customer` is the one word in this area `src:cfr-49-375` never uses for a party with a duty.**
   Counted in the captured bytes: **6** occurrences — a bank's customer inside the `Cashier's check`
   definition, a subpart heading, a complaint-procedure description, and three in Appendix A's
   plain-English pamphlet — against **189** of the § 375.103 **defined term** `individual shipper`,
   which carries every signature obligation in the part. That definition's axis is **ownership plus
   payment**: an `Individual shipper` is named on the bill of lading **and** owns the goods **and**
   pays his or her own charges; a `Commercial shipper` is named as consignor or consignee, **is not
   the owner**, and pays for the beneficial owner's account. `consignor` and `consignee` appear six
   times each, only inside those two definitions, as **positions on the bill of lading**. So
   `customer` invited a reader to file the **payer** here — the ambiguity A8-NAME-2 exists to
   abolish, with `accountParty` sitting beside it for exactly that party.

### The additive half

**`visibilityProvider`** (`newClosedEnumMember`), resolving `[A8 §5]` rows 1-2's advisory
`unresolved` entries. `src:dcsa`'s **`tntPublisherRole`** is a closed four-member enum described as
_"the **party function code of the publisher**"_ — `CA`, `AG Carrier local agent`,
`VSP Visibility Service Provider`, `SVP Any other service provider` — carried on the same schema as
`transportEventTypeCode`'s `ARRI`/`DEPA`. So a publisher that is neither the carrier nor its agent
**asserts arrival and departure**, and ADE has no slot for it: both conjuncts of `[A8 §2]`'s addition
test, on the item's only **primary captured** member evidence.

**Three honest limits, all recorded rather than smoothed:** it rests on **one publisher**
(`weighMaster` is the precedent that one is enough under §2's test); that publisher is in an
**adjacent domain** (DCSA is ocean container shipping; rows 1-2 are stops on an HHG van's trip); and
it was **already proposed in the corpus** — `[fork-time §7]` lists `visibility provider` as an
`[ORIGINAL]` role with _"a near-cite (DCSA's `VSP`)"_ — so this round carried a name rather than
invented one. `[A8 §10]` gains a row for the exposure.

### The emitted diff, read before classifying

Both faces, plus `index.json` and the README: `customer` → `goodsOwner` and `visibilityProvider`
added wherever the role enum is inlined, and `x-spec-version` `0.6.4` → `0.7.0`. Nothing else
removed, nothing else narrowed.

### What item 2 was actually owed, which is the round's main finding

**Its prose list and the debt it is cited for overlap in ONE entry.** The list names thirteen things;
`data/authority-table.json` carries ten `owedTo` entries naming the item across eight rows; the
intersection is **the warehouseman** (row 8, `storeOut`).

**Of the ten: two resolved, six were never this item's debt, two stay owed.**

| what the entry named                                           | outcome                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| rows 1-2 advisory — "visibility providers (`src:dcsa`)"        | **RESOLVED** — `visibilityProvider`                                                                          |
| row 8 corroborating — "the non-inspecting parties"             | **never debt** — a COMPLEMENT; `[A8 §4.1]` note 1 already licenses it                                        |
| row 9 advisory — "everyone else"                               | **never debt** — a COMPLEMENT                                                                                |
| row 9 corroborating — "the counterparty echoing back"          | **re-pointed** to the new `[A8 §9 item 11]` — a RELATION                                                     |
| row 16 corroborating — "the party the instrument is issued TO" | **re-pointed** to item 11 — a RELATION                                                                       |
| row 11 PROPOSED + competing — "the performing role" ×2         | **re-pointed** to item 11 — a RELATION, and its own `owedTo` already said _"Not fixed… it varies by charge"_ |
| row 8 authoritative — "the warehouseman holding the goods"     | **stays owed** to item 2, `secondary` grade                                                                  |
| row 11 RATED — "the tariff owner"                              | **stays owed** to item 2, `secondary` grade                                                                  |

**The two kinds that are not vocabulary problems, and the distinction is the deliverable:**

- **Complements** — "the non-inspecting parties", "everyone else" — are defined by _who is not the
  authoritative asserter on this fact_, so their extension changes per fact and a member spelled
  `nonInspectingParty` would be a role nobody holds. **`[A8 §4.1]` note 1 already settles it**: an
  unlisted role is _"unplaced, not demoted"_, so the columns were never exhaustive and these entries
  were **describing that rather than owing it**.
- **Relations to the fact** need the treatment `authoritative` already has. `AuthoritativeHolder` is
  a union of holder **kinds** (`custodyHolder`, `legAuthoritativeAsserter`, `keySideRole`,
  `awardedRole`) precisely so `authoritative` can name a party the table cannot enumerate, while
  `corroborating` / `competing` / `advisory` take `RoleName[]` and nothing else. **That asymmetry is
  the newly minted `[A8 §9 item 11]`**, and no role vocabulary closes it however complete it gets.

### `[A8 §2]`'s addition test, applied per name — five outcomes where the item assumed one

- **Already members; a DEFINITION was owed, not a member:** `accountParty`, `weighMaster`.
- **A name this document fixed and the enum did not carry:** `goodsOwner`. **Closed** (breaking).
- **Fails the test — a refusal, not a backlog item:** **`Trusted Agent`** (_"readily accessible to
  DoW PPA"_ — an escalation contact) and **`Claims Manager`** (_"a named role the TSP must declare in
  the DPS Qualifications module"_ — a disclosure requirement). Neither asserts a fact. A role named
  by a regulation as a party to a transaction is not thereby an asserter.
- **A SECOND AXIS, re-pointed to `[A8 §9 item 4]`:** `src:cfr-49-375` **§ 375.205** defines a _prime
  agent_ and an _emergency or temporary agent_ by **on whose behalf** and **under what agreement**,
  never by function — so a prime agent may be a `booker`, an `originAgent` or a `hauler`, and
  `primeAgent` in `ROLE_NAMES` would be **two axes in one enum**, which `[SD §1.1]`'s "no second
  classification axis" and A8-NAME-1 exist to prevent. `Designated Agent` (_"in place of the
  customer"_, by power of attorney) and the **Move Management Company** (_"on behalf of a SCAC"_) are
  the same shape from two other sources. Item 4 already named § 375.205 as unused material; this
  round handed it the rest.
- **Defined only by EXCLUSION:** **`broker`**. § 375.205(a)(1) says a prime agent _"does **not
  include** a household goods broker or freight forwarder"_; `src:dtr-part-iv` has _"carrier's agent
  **explicitly distinguished from** a broker"_. A member minted from a negative would be ours —
  `[SD §0]`.

**And the government offices are not a missing name at all.** §2's addition table folded
PPSO/PPPO/TO into **`accountParty`** and marked the fold _"**[ORIGINAL]** that it is one role rather
than three"_, so the sub-list asks whether to **unfold a published member** — `reinterpretedMember`,
not additive. There is evidence for unfolding (`src:dtr-part-iv` A-406 §B.8's **Maintaining vs
Responsible PPSO** split), and it is **left owed deliberately**: two breaking changes in one release
with one argument between them is one argument too few.

### The miscitation, which is older than this round and which I had propagated

`[A8 §2]`, `[A8 §5]` row 5, `[A8 §7.3]`, `data/authority-table.json` and `envelope.ts` all cited
**§ 375.505(a)** and **§ 375.701** for the goods owner's signature. Neither contains one:

- **§ 375.505(a)** — _"Before you receive a shipment… **you must prepare and issue** a bill of
  lading"_. The obligation is the **carrier's**; this party appears in the 17 required items as
  **item (3), a name and address**. Being named on a document is not signing it.
- **§ 375.701** — heading _"May I provide for a release of liability on my delivery receipt?"_. It
  forbids release-of-liability language and permits an "apparent good condition" note. **No
  signature appears in the section.**

**The two strongest real instances were cited nowhere in the corpus:** **§ 375.503(c)** (the
inventory, _"signed by **both** you and the individual shipper"_) and **§ 375.401(h)** (_"**You and
the individual shipper must sign the estimate of charges**"_ — a **mutual** signature on a **money**
document, so it reaches `[A8 §5]` row 11 as well as row 5), plus § 375.213(f)(1)'s signed dated
receipt and a dozen writings (§ 375.201(c), § 375.203, § 375.217(a), § 375.401(a)(2), § 375.403,
§ 375.405, § 375.407(a), § 375.503(d), § 375.505's FVP waiver, § 375.515(b)).

**`[A8 §5]` row 5's `competing` standing survives on better citations than it had** — its
`[ORIGINAL]` reason was that the signature is constitutive, and it is; what changed is which sections
say so. **And the "four times" phrasing had been propagated into the item-3 round** — its gate
docstring, `party-grain-refuses.ts`, `[A8 §9 item 3]`'s annotation and that round's record — all of
which now carry marked corrections.

### `[catalog §2.3.1]` rewritten, and its gate replaced rather than weakened

§2.3.1 rested on _"no bump already published was breaking"_, held by a test whose failure message
said that if a row ever was, _"that ground is gone and §2.3.1 needs rewriting, not this test"_. This
release spends that ground — **once, and as designed**. The paragraph now rests on the mechanical
property that does not age (`^0.6.0` admits `0.6.1` and excludes `0.7.0`), and the gate is replaced
by **the claim the rule actually makes**: a breaking row bumps the MINOR and resets the patch, an
additive row bumps the PATCH. That catches a breaking change put in a patch slot — an error the old
gate could never have caught, because it could only ever catch the _existence_ of a breaking release.

**Bounded at the rule's ADOPTION, which running it is what found.** The first draft checked every row
and failed on `0.1.0` → `0.2.0`: every bump before `0.6.0` → `0.6.1` spent the minor slot on an
additive change **because the rule did not exist yet**, which is exactly what the retrofit paragraph
said mislabelled nothing.

### Everything else the round touched

| What                                                           | Why                                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `data/authority-table.json` — 14 role values, 10 `owedTo`      | the rename, two resolutions, two complements, four re-points                                      |
| `src/rules/authority.ts` — 14 role literals, 2 advisory arrays | the rename, and `visibilityProvider` on rows 1-2                                                  |
| `data/canonical-subjects.json` — 6 prose mentions              | its `summary` strings mirror `[A8 §5]`'s standings                                                |
| `00-shared-decisions.md` §4.7.1 — three rows                   | the same table one document up; found by grepping for the role **outside A8**                     |
| `fork-time-provenance-corrections.md` §7, §5.3                 | annotated, not rewritten — and §7 is where **both** uncarried names were visible all along        |
| `data/owed-vocabularies.json`'s `note`                         | why a per-MEMBER refusal gets no row, because the plan's §6 told the next session to look for one |
| `tests/conformance/catalog.test.ts`                            | the replacement gate, its four-cell shape check, and three tampers                                |
| `[catalog §2.4]`'s `0.6.3` → `0.6.4` row                       | **its Class cell had been missing since the party round wrote it** — see §3                       |
| `[A8 §9 item 11]` minted; items 2, 3, 4 and §10 annotated      | marked annotations in both directions                                                             |

### What it deliberately did not do

- **No `owed-vocabularies.json` row**, and the reasoning is written into that table's own `note`:
  it is per-**vocabulary**, item 2's refusals are per-**member**, and `ROLE_NAMES` itself is not
  refused (§2 calls it "provisional").
- **No government-office unfold**, no NTS-warehouseman split, no `tariffOwner` — all three on
  `secondary` grade, each needing its own argument.
- **No reopening of `roleClass`.** It is `refusedOnEvidence` with a live gate, it is a **different
  vocabulary** from the role enum owed by the same item, and **this round's rename deliberately left
  `roleClass('customer')` alone** — in `data/reasons.json`, `reason-attribution.test.ts`,
  `role-class-refuses.ts` and `delivery-attempted-twice-absent-then-refused.test.ts`. A blind
  rename would have corrupted a refused vocabulary; the rename was classified per occurrence
  instead. **A side benefit: one word no longer serves both vocabularies.**

---

## 2. The three things the plan got wrong, and who caught each

### (a) `customer` is the better-sourced name — REFUTED BY THE USER, then measured

The plan's §5 recommended **keeping** `customer` and annotating the rule, on the ground that
`customer` was "the better-sourced name for who signs at the residence". The user pushed back from
practice: _customer_ is whoever **pays**, _shipper_ is responsible at **origin**, _consignee_ at
**destination**.

**Checking it in the captured bytes refuted the plan's sentence** — the counts above — and the user's
reading of "customer" as the payer is exactly why the word was wrong: this model has a separate role
for paying. **The decision reversed.**

**And the origin/destination half of the challenge was answered without a third role**, which is its
own finding: `src:cfr-49-375` runs **both ends of the same document** through the one term
(§ 375.503(c) at loading, § 375.503(d) at delivery); `[A8 §7.3]` and `HandoverQualifier` carry
releasing/receiving as a qualifier **`side`**; `src:milmove-mymove`'s `RELEASING_AGENT` /
`RECEIVING_AGENT` is a **permission**, which item 3 had already measured. A
`goodsOwnerOrigin`/`goodsOwnerDestination` split would put the handover's side into the role enum —
the same two-axes-in-one-enum defect § 375.205 produces from the other direction.

**Lesson: a recommendation resting on "better-sourced" is a claim about a count, and a count is
cheap to run.** The plan asserted it without counting. One `grep -c` over a captured file reversed
the round's central decision.

### (b) This item's refusals belong in `owed-vocabularies.json` — WRONG, caught by a reviewer

Plan §6 told the next session that because the model has a field for the vocabulary, "this item's
refusals, if any, **do** belong in that table". They do not: the table is per-vocabulary, and
`Trusted Agent` / `Claims Manager` are per-member refusals from a vocabulary that stays open.
**Corrected in the plan and in the table's own `note`, because the next session would have gone
looking for a row.**

**Lesson: an instruction a plan gives its successor is a claim like any other, and leaving it
silently unfollowed is worse than having never written it.**

### (c) The replacement gate was sound — UNTESTED, and the tamper found a defect behind it

The new §2.3.1 gate passed on the first run, which proved only that it ran. Tampering it three ways
made it bite — and the second tamper's error message echoed the party round's entire **prose** as a
change class, which exposed that **§2.4's `0.6.3` → `0.6.4` row had been missing its Class cell since
the party round wrote it.** The gate reads the last cell; that row's last cell was prose; the prose
matched no breaking class, so the slot check **passed by luck**.

Both halves fixed: the row carries its classes, and the gate requires four cells per row.

**Lesson: a gate that indexes by position needs a SHAPE check, or reading the wrong cell looks
exactly like a pass.** And the round's inherited lesson held again — run the tamper before naming the
gate's shape.

---

## 3. Landing a change — what the recipe caught this round

Read §3 of `plans/completed/domain-reference-party-entity.md` and of
`plans/completed/domain-reference-a8-item3.md`. What earned its place here:

- **§3 item 8 — read the emitted diff.** This round emits, unlike item 3's. The diff confirmed two
  changes on both faces and nothing else, which is what licensed the change classes.
- **Run the tamper before naming its shape.** Three tampers, one defect found behind the gate.
- **Sweep the ITEM, not the phrase — and then sweep the ROLE outside the document that owns it.**
  `grep 'A8 §9 item 2'` found the markers. What found the stale role names was a second sweep for
  the role itself **outside A8**: three rows in `00-shared-decisions.md` §4.7.1 and two arguments in
  `fork-time`. The second sweep is the one that found `visibility provider` sitting in `fork-time`
  §7, uncarried, for the whole life of the enum.
- **The type system is the rename's gate.** Renaming the enum member broke exactly the role-position
  sites and no others, which is what made it safe to leave `roleClass('customer')` alone — the
  compiler could not have told them apart if the two vocabularies shared a type, and it did because
  they do not.

---

## 4. The procedural lessons, with this round's four added

Read §4 of both previous records. This round adds four:

> **A recommendation that rests on "better-sourced" rests on a count, and a count is cheap.** The
> plan recommended keeping a name on an unmeasured claim about which word the corpus favours. One
> `grep -c` over a captured file reversed it — six occurrences against a hundred and eighty-nine.
>
> **A gate that indexes by position needs a shape check.** Reading "the last cell" of a table row is
> only safe if the row's shape is asserted. A missing cell made a positional read return prose, and
> prose matched nothing, and matching nothing looked like passing.
>
> **An instruction a plan leaves its successor is a claim, and it can be wrong.** Plan §6 told the
> next session to add a row to a table where the row did not belong. Correct it where the successor
> will look — in the table itself — not only in the plan.
>
> **When one word serves two vocabularies, a rename is a per-occurrence classification, never a
> `sed`.** `customer` was a `ROLE_NAMES` member **and** a `roleClass` value in the same repo, and
> `roleClass` is `refusedOnEvidence`. Fourteen occurrences moved and five stayed. The thing that made
> it safe is that the two have different types.

---

## 5. What is blocked, and on what — ask-the-user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — the
   `[ORIGINAL]` guess `[SD §0]` forbids. Record it as **`[USER]`** with the user's own words quoted.
   **This round went past it twice and did not touch it**: item 3 settled that the individual who
   signs asserts **under a role**, and this round corrected **which sections require the signature**
   (§ 375.503(c) and § 375.401(h), both mutual) and **what the role is called**. All three are facts
   about the act's surroundings. What the act _asserts_ is still the user's wording.

### Recorded modelling questions — none is a user ask

- **`[A8 §9 item 2]`'s own residue:** the **NTS warehouseman** (row 8's authoritative — the one
  overlap between the item's list and its debt; the duty is sourced at `src:dp3-400ng` Item 17.12,
  element 98 keeps three codes apart as _"evidence toward a split"_, and `authority-table.json`
  already writes them separately) and the **tariff owner** (row 11's `RATED`; element 98 names the
  function as `TI Tariff Issuer`, but **X12 naming a function is not X12 asserting a fact**). Both
  `secondary` grade.
- **`[A8 §9 item 11]`, minted here:** the standing columns take role **names** while `authoritative`
  takes holder **kinds**. Four owed entries need the second. **Not closable by a vocabulary.**
- **The government-office unfold:** `reinterpretedMember` over `accountParty`, with evidence
  (`src:dtr-part-iv` A-406 §B.8's Maintaining vs Responsible PPSO).
- **`[A8 §9 item 4]`** now owns the corpus's clearest delegation material — § 375.205's signed
  written agreement with 24-month retention, `Designated Agent`'s power of attorney, the MMC's
  on-behalf-of — and **cannot be discharged by adding role names.**
- **`[A8 §9 item 5]`** gained a published exclusivity rule it can use: the MMC _"may not be named as
  the origin servicing agent"_.
- **`[A8 §9 item 3]`'s residue — A8-SELF is under-determined.** Needs a person→organisation relation
  no source publishes as a reference. Adjacent to `[A8 §9 item 1]`'s hierarchy, **not identical**.
- **`[A8 §9 item 1]`'s residue:** the party's **name** (two blockers), the **hierarchy**, the
  **`PartyId` brand** (breaking).
- **`[SD §1.2]`'s `resource` row is uncited for half of what it admits** — "driver or crew member"
  carries no citation. Recorded by item 3; `[SD §1.2]`'s and `[A3]`'s to repair.
- **`[A8 §10]`'s new row — §2's cast rests on ONE publisher** — is written now, and it is not
  closable by effort: `src:x12-transportation` is licensed and `src:nmfta-scac` is `status: skipped`.
- **A bare `§n` cited ACROSS documents** (`[A2]` → `[A3]`): still `[A2]`'s and `[A3]`'s.

---

## 6. How to work here

Read §6 of both previous records; nothing is superseded. Added by this round:

- **A rename across two vocabularies that share a word is classified per occurrence.** Grep the
  value, then decide per hit which vocabulary it belongs to. The compiler finds the typed half; the
  untyped half (JSON data, prose, test fixtures) is yours.
- **After sweeping the item, sweep the THING outside the document that owns it.** `[A8 §9 item 2]`'s
  markers were in A8. The stale role names were in `00-shared-decisions.md` and `fork-time`.
- **`data/owed-vocabularies.json` is per-VOCABULARY.** A refused **member** of an open vocabulary and
  a refused **field** both get no row; the table's own `note` now says so with the worked examples.

---

## 7. Where the round landed

- **Branch:** `chore/dr-role-vocabulary`, cut from `main` at `118110b2`.
- **Five commits:** the plan (`72d08c64`), the measurements (`82481d31`), the citation finding
  (`3c6daceb`), the implementation (`189e752f`), the tamper pass and its defect (`890becea`).
- **Gates, all seven:** `test` 543 in 26 files · `lint` · `typecheck` · `alloy` · `glossary` ·
  `catalog` · `context-map`.
- **Catalog `0.6.4` → `0.7.0`**, classes `changedRoleNameSpelling` + `newClosedEnumMember`. **The
  first breaking release**, in the minor slot, under a rule this round had to rewrite to keep honest.

---

> **Preserved verbatim from `plans/in-progress/domain-reference-a8-item2.md`, committed before
> anything was designed (`82481d31`, `3c6daceb`).** §2 above says which of these readings held and
> which were refuted; this is the evidence they are claims about. §1.3a's preliminary readings are
> left marked as preliminary, because one of them was refuted by going to the bytes and that is the
> transferable part.

---

## 8. The planning pass, preserved — the questions of §1.3

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

---

## 9. The measurements, preserved verbatim — §1.3a and §1.3b

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

---

## 10. The citation finding, preserved verbatim — §1.3c

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
