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

- [ ] §1.3 — the measurements, **before** designing anything. §1.3a holds the readings already taken
      while writing this plan; **each is marked and each must be re-verified.**
- [ ] §1.2 — the decision: what does item 2 actually owe, and is any of it closable?
- [ ] implementation, gates, tamper pass, cross-area edits, round record

### Next action

**Run §1.3 item 1 — compare what item 2's own prose list names against what the authority table's
`owedTo` entries actually ask for.** They are not the same set, and §1.3a's preliminary reading is
that they are not even the same _kind_ of thing. Do not start with §1.2.

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
  vocabulary.** (item 3's addition.) Here it does — `assertedBy.role` — so unlike item 3 this
  item's refusals, if any, **do** belong in that table.

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
