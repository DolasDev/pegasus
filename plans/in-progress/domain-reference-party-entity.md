# Domain reference — the party entity (`[A8 §9 item 1]`): plan and resumption state

**Written 2026-10-06**, to be read by a session with **no prior context**. Everything needed to resume
is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-roleclass.md`, whose round landed in full; the record
is `plans/completed/domain-reference-roleclass.md`, and its transferable lessons are carried into §3,
§4 and §6 of this file rather than left to be rediscovered.

> **Current as of 2026-10-06 (late), `main` @ `c60c00db`.** Three PRs landed after this file was first
> written and two of them were not domain-reference work at all: **#804** the `roleClass` round,
> **#808** a critical-advisory fix that had turned `main` red, and **#807** two new `GOTCHAS.md`
> entries. §6's "Workflows and CI" carries what the detour taught, because the next round will meet
> the same three hazards and two of them are invisible from inside this package.

> **§1 IS A SEED, AND IT SAYS SO.** Unlike the last plan, §1 here is **not** a measured design. It
> names a deliverable the corpus has owed since A8 was written, and **the one decision it turns on is a
> schema question nobody has answered in writing.** §1.3 is a list of what to measure before designing
> anything. **Give §1 a planning pass before executing any of it** — the last three rounds each found
> the plan wrong about something, and the one that found it earliest cost one script.

**All nine `v1 detail` areas are written, the context map is written and generated, and both of the
model's two refusable vocabularies are now refused on the evidence.** What is left is the party entity,
the command side and the aggregate lifecycles, and §5's recorded questions.

---

## 0. Where the model actually stands — measured 2026-10-06, and how to re-measure

**Every number here comes from a generated artefact or a command**, named beside it, because
`[A1 §9]`'s rule applies to this plan too. Re-measure rather than trusting this section if it is old.

| What                      | State                                         | Where it comes from                              |
| ------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `v1 detail` areas written | **9 of 9** (A1–A9)                            | `docs/domain-reference/analysis/A*.md`           |
| A10–A13                   | **context-map-only by design** — not gaps     | `rubric.md`'s status column, which says so twice |
| The context map           | **written, and generated**                    | `docs/domain-reference/context-map.md`           |
| Published record types    | **34**                                        | `catalog/index.json` → `members`                 |
| Catalog `specVersion`     | **0.6.3**                                     | `src/catalog.ts` → `CATALOG_VERSION`             |
| Corpus sources analysed   | **33 of 87** (20 more deliberately `skipped`) | `ls docs/domain-reference/sources/*/analysis.md` |
| Rounds landed             | **14**                                        | `ls plans/completed/ \| grep domain-reference`   |

A3 has an area document but **no round record of its own** — it was written inside the research-corpus
round (`34713637`), which is why `plans/completed/` has no `domain-reference-a3`. That is not a gap.

### What changed in the last round, because it changes how to read the Owed page

`roleClass` moved from `pending` to **`refusedOnEvidence`**. So **two** of the three owed vocabularies
are refused and **one** is pending (`unitOfMeasure`), and the glossary's Owed page groups them under
those two headings. `[A9 §6]` item 1 used to be the place that explained the difference in prose; it is
now annotated to say the explanation has moved onto the wire as `x-owed-state` / `x-owed-why`.

**Scoring "percent complete" against the owed inventory counts a refusal as a gap.** That was true
before and it is twice as wrong now.

### How to re-measure all of it

```
python3 -c "import json;d=json.load(open('docs/domain-reference/catalog/index.json'));print(d['owed']['counts'])"
ls docs/domain-reference/sources/*/analysis.md | wc -l      # analysed sources
grep -c '^- id:' docs/domain-reference/sources/registry.yaml # registry entries
```

---

## 1. THE DELIVERABLE — the party entity, and the one question it turns on

### 1.1 Why this is the load-bearing item, which is measured rather than asserted

**`PartyId` is the widest-spread concept on the context map's join surface with no aggregate behind
it.** That is the context-map round's measurement, not a judgement:
`docs/domain-reference/context-map.md`'s join surface ranks it, and `ids.ts` says the same thing in
prose — _"the party is represented here as an identifier with no aggregate behind it rather than by
silently widening `[SD §1.2]`'s closed enum."_

Four things are blocked on it, and all four are enumerated somewhere a gate can see:

1. **Five identity schemes cannot be asserted at all.** `data/identity-schemes.json`'s `scac`,
   `usDotNumber`, `mcNumber`, `gbloc` and `agentCode` each carry the blocker _"`[A8 §9 item 1]` — no
   party entity, so a … assertion has no `subject`"_, and the loader **enforces** that a `party`-grain
   row names it and that no other row does. `scac` is the **widest-witnessed scheme in the whole
   corpus**. `[A9 §3.6]` is the argument.
2. **`assertedBy.partyRef` has no target schema**, which is `[A8 §9 item 1]`'s own first sentence.
3. **`authorityToDeclare` compares ROLE NAMES rather than parties** —
   `rules/authority.ts`'s closing `TODO([A8 §9 items 1-3, 5])`, and A8-SELF ("a party holding two roles
   does not corroborate itself") is unenforceable without a party identity to compare.
4. **Three `TODO(…)` markers in `src/` name the item**, and the context map's **debt** section
   enumerates them with the document that owes each: `ids.ts:167`, `custody.ts:139`,
   `rules/authority.ts:1815`. A new `TODO(…)` fails `context-map.test.ts` **by name**, so the ledger is
   enumerated rather than counted.

### 1.2 The one question, and it is a schema question rather than a research one

`ids.ts:167` states it exactly:

> `TODO(A8 §9 item 1)`: when the party entity lands, decide whether it becomes a **fifteenth aggregate
> kind** (an addition the enum permits) or **stays outside the subject enum**.

Both branches are already costed in the corpus, which is why this is a decision and not a search:

- **A fifteenth `aggregate` kind** is `newAggregateKind` — **additive**, and `[SD §1.2]` states the
  permission outright: the enum is _"open to addition in a later `specVersion`, never to
  reinterpretation"_. It gives the five schemes a `subject` and makes `identity` assertions about a
  party expressible.
- **Outside the subject enum** keeps `PartyId` an identifier and leaves those five schemes
  unassertable, which is the state `[A9 §3.6]` records as a defect rather than a design.

**`[A9 §3.6]` item 2 already rules out the third option a reader will reach for:** `partyRole` is not
the answer, because _"a SCAC belongs to the company whatever it is doing on this shipment"_. Do not
re-derive that; it is decided.

**`tests/conformance/identity-scheme-refuses.ts` makes the day `party` becomes an aggregate kind a
compile failure**, deliberately — its `@ts-expect-error` on `const partyIsNotAnAggregate:
AggregateKind = thePartyFiveSchemesIdentify` goes unused and the file stops compiling. **That gate is
written to be inverted, which is the house move** (`§6`'s "a gate's own comment can tell you it is due
to be inverted"). Inverting it is part of the deliverable, not an obstacle to it.

### 1.3 What to MEASURE before designing — this is the planning pass

Nothing below is a step to execute; each is a question whose answer changes the design, and the
context-map round's lesson is that measuring first cost one script and measuring after would have cost a
round.

1. **What fields does the corpus actually publish for a party?** `[A8 §9 item 1]` names legal name,
   DOT/MC number, SCAC (`src:dtr-part-iv` #665), agent code, the **branch grain**
   (`src:sirva-ade`'s 7-digit `AgentNbr` whose trailing three digits are the branch, plus
   `SvcProvDataRecipient`, SOE p.2) and the **hierarchy** (`src:atlas-world-group-api`'s
   `parentAgentCode` and `/Agents/{agentCode}/Family` — **column names only**). Measure how many of
   those are **fields** versus **`identity` assertions under `[SD §7.1]`**, because `[A9 §3.6]`'s whole
   point is that they are the latter. **A party entity that carries SCAC as a field would re-make the
   mistake A9 found.**
2. **Does the party need any fact class of its own, or is it a bare subject?** If every attribute is an
   `identity` assertion, the aggregate may need **no new record type at all** — which would make this
   round's diff one `AggregateKind` member plus five blockers coming off, and nothing else. Measure
   before assuming a record type is needed; A6's central deliverable was a decision **not** to widen a
   published union and its diff was empty.
3. **Person versus organisation versus crew-member grain** — `[A8 §9 item 3]`, and it is a **separate
   owed item**. Decide whether this round takes it or explicitly does not, and say which. The material
   is already gathered there: `src:milmove-mymove`'s `MTOAgent` is a _person_,
   `src:atlas-world-group-api`'s `OnSiteStaffMember` is bound to stop numbers, `src:sirva-ade`'s
   `Resource` fuses companies, people and **equipment** into one `Type` enum, and
   `src:dp3-tender-of-service` NTS §1.4.13.1 requires a **named individual** to sight-verify firearms.
   **A party entity that cannot tell a company from the individual who signs would not discharge
   `[A8 §9 item 3]` and must not be described as if it had.**
4. **What does `custody.ts:139`'s `TODO([A8 §9 items 1-3])` actually need?** It asks whether a leg's
   `performedBy` is a party or something else. That TODO names three items, so measure which of them it
   is really blocked on before claiming this round unblocks it.
5. **Is `[A8 §9 item 5]` (role cardinality and exclusivity) reachable once a party exists?** A8-SELF
   needs party identity to compare, so some of item 5 may become decidable as a side effect. Measure;
   do not promise.

### 1.4 What this round must not do

- **It must not reopen either refused vocabulary.** `identityScheme` (`[A9 §3.2]`) and `roleClass`
  (`[A8 §9 item 2]`) are `refusedOnEvidence` with live `Exact<>` gates. A party entity gives SCAC a
  **subject**; it does not give `identityScheme` a closed list, and it says nothing about `roleClass`.
- **It must not add a `ROLE_NAMES` member.** `tariffOwner` is owed to `[A8 §9 item 2]` and blocked on
  `[A8 §2]`'s addition test. Element 98's `TI Tariff Issuer` is a counterpart, not a closure.
- **It must not resolve `CAUSE_UNKNOWN`'s attribution** (§5), which needs the refused `roleClass`
  vocabulary.

---

## 2. Current state

Every area document, the executable layer, the published catalog, the context map, the cleanup round,
the owed-closures round and the `roleClass` round are **merged to `main`**. `docs/domain-reference/`
holds the corpus, the thirteen-area rubric, the nine area documents, the generated glossary and the
generated context map; `packages/domain-reference/` holds the executable specification, **three**
generators and the conformance suite.

Catalog at `specVersion` **0.6.3**, bumped by the `roleClass` round under `[catalog §2.3.1]` — the rule
that pre-1.0 the **minor** slot carries breaking changes and the **patch** slot carries additive ones,
because that is what makes a caret range behave correctly unaided.

### Gates

`tsc` silent · `eslint` clean · the vitest suite green · Alloy runner exits non-zero on a
counterexample · glossary is a prettier fixed point · context map is a prettier fixed point · catalog
is a prettier fixed point and round-trip-validated · `prettier --check` clean over **both** trees with
**no exception** (if an exception appears, it is yours).

**No count is written here on purpose** — §3 item 10 is the rule. The commands produce it in about five
seconds:

```
npm run test        -w @pegasus/domain-reference
npm run lint        -w @pegasus/domain-reference
npm run typecheck   -w @pegasus/domain-reference
npm run alloy       -w @pegasus/domain-reference
npm run glossary    -w @pegasus/domain-reference
npm run catalog     -w @pegasus/domain-reference
npm run context-map -w @pegasus/domain-reference
```

---

## 3. Landing a change — the recipe the area rounds established

Follow this order. **It applies to an aggregate round exactly as it applies to an area round**, and
items 6, 8, 10 and 14 are the ones a round is most tempted to skip.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker** —
   the disclosure gate reads the docstring, **including on the members of a two-member enum**. A JSDoc
   must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or the
   glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set**, and
   **put the cross-field invariants in the loader**.
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet. A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`, the
   cleanup round added `newAnnotation`, and **the `roleClass` round added two in one round**
   (`refusedOwedVocabulary`, `newShapeBranch`) — **or that no class applies because nothing published
   changed** (A2, A6, A9, the context map). **A change to the owed inventory is NOT a change to what is
   published**; **closing or refusing an owed vocabulary IS**. For this round, `newAggregateKind`
   already exists and `[SD §1.2]` states its permission outright. Read the diff (item 8) before naming
   the class.
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named rule
   or fold** in `RULES` — all three in `tools/generate-glossary.ts`. **None is auto-discovered, and
   `A8-KEY` was missing from `RULES` for four releases before the owed-closures round noticed.** A
   `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary`,
   `npm run catalog` **and `npm run context-map`**, then the tests. One bump may carry several classes
   for independent deliverables — a `specVersion` names a published state, not a piece of work
   (`0.6.2`, `0.6.3`).
6. **Tamper each new gate and watch it fail, then restore** — and **commit first**. `git checkout --`
   on a tracked file with uncommitted work reverts the work.
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. There should be **no** exception to this.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather than
   as a formality. A2's, A6's, A9's and the context map's were empty and in A6's case the emptiness
   **was** the deliverable. **Three times now the diff has located something the decision did not
   predict:** `keySideRole` at `0.3.0`, `awardedRole` at `0.6.2` (where `AWARD` never reaches the wire
   at all), and `0.6.3`'s no-party branch, which emits `"party": false` — a real prohibition — beside a
   sibling branch that accepts everything it forbids, so the `anyOf` **discloses** a constraint it
   cannot enforce. **A new `anyOf` branch is not necessarily a discriminating one. Check.**
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**; where a claim is a comparison rather than a total, **gate the comparison**. **And
    an ORDINAL is worse than a count: delete it, and name the things.** A type whose name is a number has
    the same defect as a sentence whose claim is one. **An ordinal can be accurate and still date the
    sentence around it.** Where a rule needs a threshold, declare the threshold in code and gate the
    **membership it produces**, enumerated by name. **And a count can smuggle in a claim:** `[A1 §3.6]`'s
    "three members of a published vocabulary" was carrying the assertion that `CAUSE_UNKNOWN` attributes
    to nobody, which `[SD §2.6]` contradicts — so re-reading a count means re-reading what it asserts,
    not only whether it adds up. **The review pass reaches commit messages**, and nothing regenerates
    one.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned one
    can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**; a `satisfies` clause checks **membership, not exhaustiveness** (A7). A9 adds the
    mirror discipline: it deliberately left its own data table _out_ of the comparison, because putting
    it in would have asserted the closure it declines. `RoleClassStaysOwed` follows A9's arrangement —
    the type in `outcomes.ts`, the right-hand side written out in A8's own module.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6, A7, A9, the owed-closures round, the context map and the `roleClass` round all ship both halves
    side by side — and the second half is the one that gets skipped. `ZonedInstant` has no edge. The
    context map's pattern-label refusal has no edge because **there is no vocabulary for it to leave a
    hole in**. And `0.6.3`'s no-party branch has an edge the **type** can see and the **wire** cannot
    yet, which is a third shape: say which layer holds it.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The house
    pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go **unused**
    (`TS2578`) when the illegal state becomes legal. **Then tamper it.** Two mechanical traps:
    `@ts-expect-error` covers **one** line, so **name the value first and annotate the assignment**; and
    **the absence of a TYPE has no type-level witness**. **A third, from `0.6.3`:** excess-property
    checking would have caught an inline object literal for a reason unrelated to the union under test,
    so route the value through a **named variable** and make the branch do the work.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`. **Before opening the PR, re-read your own §Cross-area list in BOTH directions**: A7
    found four `[catalog]` edits with no section declaring them; A9 found six edits it had **declared
    and not yet made**; the `roleClass` round found a cross-reference to `[A8 §10]` asserting something
    **that section does not say**. For an **area** document the house pattern is a marked annotation
    (`> **CLOSED 2026-10-06**`, `> **AMENDED 2026-10-06**`) rather than a rewrite. **Verify a
    cross-reference by reading the target section, not by remembering it.**
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read the
    rendered diff of every prose file you touched** before opening the PR — and see §4 about _when_.
    **A table-row anchor carries trailing padding prettier owns**, so anchor on a short unique substring
    inside the cell instead and let prettier re-pad.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** The house shape is
    **`Owner — reason`**. **`owedTo` is emitted as a schema `const` on both faces**, so correcting one
    costs a version bump — `repointedOwedOwner`. **Repointing a blocker is a real deliverable** — but
    **only when what the item is owed FOR has changed.** The `roleClass` round declined to repoint
    `tariffOwner` on exactly that test: element 98 named the function, which does not change why the
    role is blocked.
17. **`vitest` does not typecheck, and a test that passes can still be a type error.** Run
    `npm run typecheck` after **every** test edit.
18. **When a finding looks like your area's, measure whether it is systemic first.** A9's first instinct
    was to repair fourteen registry entries; measuring showed the gap in all thirteen areas.
19. **A gate must read the thing that DECLARES, and "the paragraph" is not it.** A gate scoped to a
    region that contains prose about the finding closes on that prose. Scope to the table column, or to
    the slash-separated enumeration, and nothing wider. The corollary: **a document may have to describe
    a finding without spelling its token**, and should say that it is doing so and why.
20. **A gate whose subject is what a generator EMITS must read what the generator emits.** Read
    `generate…()`, not `readFileSync(…)`.
21. **"No markdown tables" is necessary and not sufficient for a prettier fixed point.** A citation
    whose own text wraps across a line splits its own bullet; a `**bold**` run cut in half by a
    truncation breaks. And an intra-word underscore is not emphasis and never needed removing.
22. **A claim becomes falsifiable when a value it contradicts is published, and `grep` will not find
    it.** `data/reasons.json`'s `partyRequired` and `[A4 §5]` item 1's biconditional were both
    unfalsifiable until `ATTRIBUTION_NO_PARTY` existed — nothing about `partyRequired` mentions
    no-party. **So when you publish a value, go looking for the claims it has just made testable.**
    **This round's instance is sitting there:** publishing a `party` aggregate makes **A8-SELF** ("a
    party holding two roles does not corroborate itself") testable for the first time, and A8-SELF is
    currently prose.

---

## 4. The procedural lessons

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, one level out: **the suite says nothing about prose, and prose is where the counts, the
superlatives and the conventions live.** Budget a deliberate read-the-diff-and-recount pass.

A9's, which is A7's lesson tested and found insufficient: **budgeting the pass is not the same as the
pass working.** A9 ran it, found four defects, then **ran it again after the cross-area edits and found
four more**. Two consequences:

- **The review pass must run after the LAST prose is written**, and the last prose a round writes is
  always the part that edits other people's documents. Bracket the cross-area pass; do not precede it.
- **A superlative is usually a comparison you have not made yet, and an ordinal is usually a count
  someone else is keeping differently.**

The cleanup round's, about plans rather than prose: four of its seven planned items carried something
the plan had wrong or did not predict. **A plan is a claim to audit, not a specification to execute.**

The owed-closures round adds two. **The review pass reaches your commit messages.** **And a
contradiction can be _inside_ one document, between two of its own sections.**

The context-map round adds two. **A plan can be wrong about an item it did not invent, by carrying one
half of a self-contradicting sentence.** **And a measurement taken to design a rule can refute the
rule's premise** — measuring first cost one script; measuring after would have cost a round.

> **The `roleClass` round adds three, and the first is the sharpest form of "audit the plan" yet.**
>
> **A plan can cite a real sentence for a claim that sentence does not make.** The plan quoted
> `fork-time` for the prediction that element 98 would not supply a non-party value. The sentence is
> `[fork-time §5.3]`'s and it is about **`customer`** — and element 98 **does** carry `LW Customer`, so
> the real prediction was wrong too. **A citation is two claims: that the text says this, and that the
> text is right.** The plan checked neither, and it could not have checked the first, because **it cited
> a line number as if it were a section** — the defect §5's last bullet names in this very corpus.
> **Cite the heading.** `fork-time` §5.3's heading is "The customer is an asserter", and no one who had
> read that heading would have read the sentence under it as being about nobody.
>
> **A policy stated in a registry entry governs a round that never opens that entry.**
> `src:x12-transportation`'s notes say _"Reference code lists, never copy them into the repo"_, and the
> plan prescribed committing a licensed code list under `captured/` without mentioning it. The
> precedent for doing it right was already on disk — `src:x12-212-trailer-manifest`'s capture. **Read
> `sources/README.md` and the registry entry for the FAMILY, not only for the source.**
>
> **Two agreeing summarizer reads are not a primary source.** They agreed with each other and were
> wrong on both numbers that mattered — 829 codes and no per-code definitions, where a parse of the
> page bytes gives 1312 and 161. They agree because they share a model and a prompt, not because they
> checked each other. **Retain the bytes and parse them**, and record which standard each figure was
> gathered to.

---

## 5. What is blocked, and on what — ask the user items, do not schedule them

### Still the user's, and still only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived yet.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — that is the
   `[ORIGINAL]` guess `[SD §0]` forbids. Record it as **`[USER]`** evidence with the user's own words
   quoted when it comes. **Minting `documentIssuance` did not discharge it** and the two were never the
   same item (`[A6 §3.3(b)]`).

> **The previous plan's §5 item 2 is CLOSED and must not be re-asked.** It proposed asking the user
> whether to re-obtain `src:uncefact-mmt-rdm`'s 245 MB package or amend the registry entry. The entry
> was already fixed (`#798`) to say the package was read in round 1 and **not retained**. Nothing is
> owed to the user here.

### Recorded modelling questions, for a later round — none is a user ask

- **`CAUSE_UNKNOWN`'s attribution is open, and it is NEW.** `outcomes.ts`'s `CAUSE_UNKNOWN` member
  records three candidate readings and picks none: a party acted and its class is unknown (`unknown`,
  inside the refused vocabulary); no party acted (`ATTRIBUTION_NO_PARTY`); or it is unknown **whether**
  any party acted, which is a third state neither value expresses. `[A4 §5]` wrote "attributes to
  nobody **yet**" and `[A1 §3.6]` dropped the "yet"; `[SD §2.6]` breaks the tie toward `unknown`.
  **Deciding it needs the `roleClass` vocabulary `[A8 §9 item 2]` owes and which is now refused**, so it
  is not closable by effort.
- **`[A8 §2]`'s cast rests on ONE publisher and no industry list corroborates it.** Element 98 names no
  household-goods role at all — searched for `household`, `van line`, `mover`, `relocat`,
  `moving company`, all zero. `[A8 §9 item 2]`'s annotation records this as **a new confidence item for
  `[A8 §10]` to add**, deliberately not added on the way past because the row is a judgement about the
  vocabulary that item owes.
- **`fork-time §(b)(5)`'s typed time values are unadopted.** The decision adopts `LocalDate` ·
  `LocalDateRange` · `ZonedInstant`; the shared layer publishes `Instant` and `CalendarDate` and
  nothing else, so `[fork-time §8.1]`'s committed delivery **spread** is unpublishable. Held by
  `tests/conformance/time-value-shape-refuses.ts` and recorded in `[SD §4.7]` note 5. **Closing it is
  `changedValueShape` — breaking.** The context map ranks `Instant` first on reference spread, which is
  the measure of what a breaking change there would cost.
- **`orderCancellation`'s holder.** Binding settled (`AWARD`); holder plural, so `[A8 §4.4]` A8-NAMED
  needs a tie-break and no source publishes one. Underneath it is **`[A1 §3.5]`'s open defect**:
  `[SD §2.3]` invariant 2 forbids `reasons[]` at `COMPLETED`, so on the ordinary completed cancellation
  the field `[SD §4.7.2e]` item 2 puts the requestor on does not exist.
- **`shipmentCommitment`'s "who commits".** A **reading of three sources that disagree**, not a schema
  change: `src:sirva-ade`'s `Register` is pushed by the awarding side, `src:milmove-mymove` runs a
  two-actor submit-then-approve, `src:cfr-49-375` has the carrier name and price the lot. It blocks
  `[A2 §3.2]`'s B-ONWARD, `[fork-order §5.2]`'s B-STAGE and an `[A1 §3.4]` `COMPLETE` rule.
- **`orderAward` is blocked harder than before.** It mints the award, so the mint principle rules out
  `AWARD` as well as `PRINCIPAL`. `MintingActsAreNotBoundToWhatTheyMint` holds all four pairs over the
  table, so a round that reads "the order rows close with `AWARD`" fails by name.
- **`[A8 §9 item 2]`'s NTS question has new evidence and is still open.** Element 98 keeps
  `WH Warehouse`, `8F Bailment Warehouse` and `NS Non-Temporary Storage Facility` apart as three codes,
  which is evidence toward splitting the NTS warehouseman from ADE's `SITAgent`. Evidence, not a
  decision.
- **`tariffOwner` has an industry counterpart (`TI Tariff Issuer`) and stays owed**, blocked on
  `[A8 §2]`'s addition test rather than on evidence that the function exists.
- **F4 is open.** `ExternallyPerformedLeg.performedBy` has no consumer —
  `analysis/findings-from-alloy.md`, against `[SD §4.8.3]` rule 1 versus its own amended fold table.
  **It is also `custody.ts:139`'s TODO and §1.3 item 4's measurement.**
- **A7's cross-subject set-off is a silence, not a refusal.** `OffsettingRecord.offsets` is an `EventId`
  and says nothing about whether the two assertions share a subject, while
  `src:dp3-tender-of-service` NTS §5.8.2 publishes a set-off across bills of lading (`[A7 §3.8]`).
- **`[A9 §3.3(b)]`'s SCAC gap stays open with the fetch ruled out.** C1 decided we are not buying the
  authority's material; `definedNotMerelyNamed` is still `false`. **Note the contrast with the
  `roleClass` round's fetch**, which was free and one page: "the fetch is ruled out" is a decision per
  source, not a policy. **And note what this round does and does not change:** a party entity gives
  SCAC a `subject`; it does not give it a definition.
- **`[SD §10.4]`** still carries items open: the directional stop-type pairs (A3's) and custody
  authority's owner, partially closed with the cap moved rather than lifted.
- **The `needs-user` backlog is not a backlog anyone is working.** The number is in `registry.yaml` and
  this plan deliberately does not restate it (§3 item 10).
- **A `§n` citation whose `n` is a LINE number, and it is not only one plan's defect.** `[A2]`'s
  §Cross-area note to `[A3]` cites _"(§1207, §1289, §3.3's diversion row, §5.1's note at :544)"_, and
  neither `1207` nor `1289` is a heading in either document — they are line offsets into `[A3]`.
  Repairing it is `[A2]`'s and `[A3]`'s, via a marked annotation (§3 item 14); recorded here so a round
  that opens either document for another reason fixes it in passing. **The `roleClass` round is the
  proof this is not cosmetic**: a line-number citation is what let a plan attribute a prediction to a
  section that makes a different claim. **The general form: cite a heading, and if the document's
  headings are named rather than numbered, name the heading.**

---

## 6. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering, and commit before you do.** A false green is worse than a red. A5
  shipped a compile-time assertion that did nothing; A2 shipped one that could never fail even though it
  was assigned; A6 found a gate that passes a half-tamper, A7 reproduced it, and the cleanup round fixed
  it. A9 adds a gate that reads a **position** in a table it does not own. The owed-closures round adds
  a compile-time absence check over a module's value namespace, which can never fire for a type alias,
  and a gate whose scope includes prose about its own finding. The context map adds a gate that read the
  committed file instead of the generated bytes (§3 item 20). **The `roleClass` round adds the fifth
  shape: a gate whose subject exists in the TYPE and not yet on the WIRE** — say which layer holds it
  rather than letting a reader assume both do.
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §3 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §3 item
  13 — **unless there is nothing for a type to hold**, which is the context map's case and is stated
  rather than papered over.
- **Re-read your own §Cross-area list before opening the PR** — §3 item 14, in **both** directions, and
  **verify each cross-reference by reading the target section.** The `roleClass` round asserted that
  `[A8 §10]` said something it does not.
- **Read the rendered diff of every prose file you touched, and re-count every count** — §3 items 10
  and 15 — **including your own commit messages.** No gate in this package reads prose for sense.
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title, **or
  a comment inside a passing assertion** naming your own area is a to-do item. **And read the context
  map's debt section**, which enumerates every `TODO(…)` in `src/` with the document that owes it.
- **A published value makes old claims testable** — §3 item 22, and **A8-SELF is this round's.**
- **Check whether the source captures exist before planning to quote primary text**; **evidence grade is
  not the same as having a capture**; and **a capture is not the same as a definition**.
  `ls -d docs/domain-reference/sources/*/captured` is the check and
  `ls -d docs/domain-reference/sources/*/local` is the other half — and a `local/` entry with
  `sha256: n/a` cannot be verified even when the file is there.
- **Read the STORAGE POLICY before committing captured material, and read the registry entry for the
  licensed sibling.** `sources/README.md` puts a public page with no stated license in `captured/` as
  **notes + short excerpts, not a mirror**, and `src:x12-transportation` says "never copy [code lists]
  into the repo". A plan that says "it is public, so it is committable" has skipped both.
- **`local/element-98.html` exists on THIS machine only.** It is gitignored, and `registry.yaml`
  carries its sha256 and its public URL — so unlike `src:uncefact-mmt-rdm` before `#798` it is
  re-obtainable: re-fetch from the URL and compare the hash if it is needed on another checkout. Said
  here because `sources/README.md`'s **Durability gap** box names exactly this shape, and the last plan
  spent a whole §5 item on an instance of it.
- **Two conformance tests carry a known trap, and neither is a defect today.**
  `catalog.test.ts`'s owed-state set-equality asserts that **both** `pending` and `refusedOnEvidence`
  appear on the wire; `unitOfMeasure` is the only `pending` vocabulary left, so the day it closes or is
  refused that test fails for a reason unrelated to the change. And
  `identity-scheme-refuses.ts`'s `partyIsNotAnAggregate` is written to be **inverted** by this very
  round (§1.2). In both cases the fix is to change the assertion deliberately, not to loosen it.
- **A source's `status: analyzed` is not a statement about every list inside it.** Element 98 sat unread
  inside an analysed source, named only in prose by three documents — which is why no count over
  `registry.yaml` showed it.
- **A gate's own comment can tell you it is due to be inverted**, and inverting is the house move:
  `source-registry.test.ts`'s `[A9 §1]` block, the owed-closures round's two inverted assertions in
  `document-identity-and-evidence.test.ts`, and — **for this round** —
  `identity-scheme-refuses.ts`'s `partyIsNotAnAggregate`.
- **`sources/registry.yaml`'s `areas:` field is TWO HALVES**, and the registry's own schema comment
  states both. Generated for a source with a score table; a hand-written discovery hint for an entry
  with no analysis. The split is on the presence of a score table and **never** on `status:`.
  `tools/source-registry.ts` is the one reader; import it rather than writing a second parser. **A count
  over the registry is deliberately deleted rather than gated.**
- **Two new `GOTCHAS.md` entries (#807) are the durable home for traps this effort keeps re-hitting**,
  and both are about a tool reporting _nothing_: "Watching a fresh PR's CI: three ways `gh` reports
  'nothing' when something is wrong" (an instant `--watch` is an alarm, not a pass;
  `gh run list --branch` answers with stale data; filter on `headSha` yourself) and "Two `WebFetch`
  reads that agree with each other are not a source — parse the bytes".
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.** **All
  three generators** hold literal NULs. **When a negative grep result is load-bearing, use
  `/usr/bin/grep -a`.** In `dolas/agents/project/GOTCHAS.md`.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit — §3 item 17.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write`. **And
  if a `captured/` file's sha256 is in `registry.yaml`, recompute it after the hook runs**, not before
  the edit.

### Working with the generators

All three live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. `generate-context-map.ts` imports its model, citation and owed readers from
`generate-glossary.ts`; the `invokedDirectly` guard is what makes that safe. If you extend any of them:

- **Prettier must run inside the generator**, or the output must already be a fixed point.
  `JSON.stringify(x, null, 2)` is not one. **No markdown tables** — necessary, not sufficient (§3 item
  21).
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, every member of every registered vocabulary needs one,
  and **emphasis must be `_x_`, never `*x*`**. **A `RULES` entry also needs a citation or a marker in
  its export's docstring** — the disclosure gate reports `NO_CITATION_AND_NO_MARKER` by term name.
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — **and any
  unqualified `` `type: X` `` span is read the same way**. Files under `sources/` are **not** scanned
  and are **prettier-ignored**, which is why a capture may use markdown tables.
- **The published schema is not the same as the data table** — A6's D-ID and A9's scheme table both cost
  no bump. **But the reverse also happens**: A7 found `owedTo` emitted as a `const`, the cleanup round
  found that `x-owed` reached the `OwedCode` vocabularies and not the `Owed` value branches, and the
  owed-closures round found that a new `boundBy` member reaches the wire **only** through
  `AuthoritativeHolder`. **Check the emitted schema both ways**, and read the diff before classifying.
- **A new `TODO(…)` in `src/` fails `context-map.test.ts` by name.** That is deliberate — the ledger is
  enumerated, not counted — and the fix is to add it to the list, not to loosen the reader.
- **A new type reference in `src/` can promote a concept onto the join surface** and fail the same file.
  Decide whether the concept really does cross before changing the enumeration, and **never widen a
  threshold to make a failure go away.** `RoleClass` was promoted at `0.6.3` and the promotion was the
  deliverable.

### Workflows and CI

- **A docs-only PR is green on every branch check and can still be EJECTED from the merge queue, by a
  failure on `main` that has nothing to do with it.** This round's own shape, and it will be the next
  round's too, because a domain-reference PR is often `docs/` + `packages/domain-reference/` only.
  `ci.yml` path-filters the heavy jobs away for such a diff — `Lint`, which carries
  **`Audit dependencies`**, reports `skipping` and branch protection is satisfied vacuously. The merge
  queue runs every job **unconditionally**. So the first PR to enter the queue discovers any
  pre-existing `main` failure and gets blamed for it. #807 was ejected by a critical `shell-quote`
  advisory (#808). **Before blaming your diff, check whether the same job passes on `main`'s head
  commit**, and read `plans/todo/ci-blockers-after-security-backlog.md` → "Five diagnosis traps"
  first — it had the answers to two of the three traps that round hit.
- **The advisory gate can flip red mid-round with no code change, and right now there is NO warning.**
  `audit-ci` reads a live feed. Worse, **`Dependabot Updates` has been failing since 2026-10-05**, so no
  bot PR appears when an advisory lands and "no Dependabot PR" no longer means "no advisory". Until that
  is fixed, run `npx --no-install audit-ci --config ./audit-ci.jsonc` **before enqueuing**. Tracked as
  the first Live-work item in the CI-blockers plan.
- **`apps/api/vitest.config.ts` goes dirty on its own and must NOT be committed.** Running the api
  suite locally lets the coverage ratchet's `autoUpdate` **raise** the floors to whatever the local run
  measured; committing those ejects a later PR. `git checkout -- apps/api/vitest.config.ts`. Same for
  `apps/e2e/.env.test` (worktree Postgres port) and stray `package-lock.json` churn — the CI-blockers
  plan's "Do not commit these" is the list. **Nothing in `packages/domain-reference` needs the api
  suite**, so the cheapest avoidance is not to run it; the pre-push hook will, and that is fine because
  it reverts nothing — you must.
- **A fresh worktree's Postgres can be many migrations behind `main`**, which fails the pre-push hook in
  the api suite with `The table public.<x> does not exist` — nothing to do with your change. Fix:
  `DATABASE_URL=<the worktree's url> npx prisma migrate deploy` then `npx prisma generate` from
  `apps/api`. **Check which `DATABASE_URL` line is live first** — `apps/api/.env` also carries an inert
  Neon URL (prefixed `1DATABASE_URL` to disable it), and running migrations against that would be a
  very bad afternoon.
- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out.
- **`GOTCHAS.md` is a hot file** — every stream appends to its tail, so two active sessions conflict
  there. Resolve append-vs-append by keeping both entries, theirs first.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only — `beforeAll`
  needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, including inside captured material.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is tracked,
  so `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. A captured XML can be read with a small
  `re`-based tag-stripper, and a rendered HTML page with a small regex parse — the `roleClass` round's
  element-98 parse is the worked example, and it is what caught the summarizer's wrong figures.
- **Worktree slugs collide on the derived Postgres port** —
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`, and check it is free with
  `ss -ltn` before choosing a slug.

---

## 7. Housekeeping unrelated to this plan

- **Separate repo** — `~/repos/pegasus-workflows`, `platform/integrations/weichert/rules.json`: six
  rules carry `sourceRef: "Weichert API: …"` quoting sentences that appear nowhere in
  `weichert-api.odt`. Confirmed by the user: they came from **observed API error responses**. Reword
  them, and fix the packed-but-not-loaded dead end — `pre-in-progress-forbids-pack-actual` combined with
  Weichert's real load-actual requirement leaves no valid status for a shipment packed but not yet
  loaded. Live in GLOBAL and the `nw` tenant.

---

## 8. What follows this round

After the party entity: `[A8 §9 item 3]` (person vs organisation vs crew-member grain) if this round
does not take it; then **the command side and the aggregate lifecycles** (not started, the least
specified — it needs its own research pass before a plan); then `[A8]`'s remaining ledger and §5's
recorded modelling questions.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='dr-party'; print(5433 + sum(ord(c) for c in s) % 60)"   # derive the DB port
ss -ltn | grep -E ':(54[3-9][0-9])'                                    # …against what is listening
scripts/workstream-start.sh chore dr-party plans/in-progress/domain-reference-party-entity.md
```

> **Derive the port, do not trust a number written here.** A9's plan wrote a guessed port and was wrong
> by fifty-one. A different slug derives a different port, so do not "improve" the slug without
> recomputing.

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to `plans/in-progress/<slug>.md`
> inside the worktree, so the worktree ends up with **two** copies. Do not edit both. The pattern that
> has worked every round: write the new record at `plans/completed/domain-reference-<slug>.md`, write
> the **next** round's plan as a new `plans/in-progress/domain-reference-<next>.md`, then delete the
> seeded copy and remove this file — **and update `rubric.md`'s link to this plan**, which is the one
> cross-reference to it outside `plans/`.
>
> **And one harness limit worth knowing before you start.** `EnterWorktree` only manages worktrees
> under `.claude/worktrees/`, while this repo's convention puts them at `~/repos/pegasus-<slug>`. A
> worktree-isolated session therefore **cannot move into a worktree it provisions**. Either start the
> session in the worktree, or work on a branch in the one you are already in — which is fine for
> `packages/domain-reference`, since nothing in it needs Postgres. **The owed-closures, context-map and
> `roleClass` rounds all did exactly that** and it cost nothing.

**Read before writing anything:**

1. **§1.3 of this file** — the measurements to take before designing. §1 is a **seed**; the last three
   rounds each found their plan wrong about something.
2. `plans/completed/domain-reference-roleclass.md` — the round that just landed, its three
   plan-was-wrong findings, and the three lessons it adds to §4.
3. `plans/todo/ci-blockers-after-security-backlog.md` — **"Five diagnosis traps" and "Do not commit
   these", before you touch anything.** Not domain-reference work, but the `roleClass` round lost real
   time to two traps already written down there, and its first Live-work item (`Dependabot Updates`
   failing) is why the advisory gate can now go red without warning.
4. `docs/domain-reference/analysis/A8-authority-skeleton.md` **§9 item 1**, and **§3** — item 1 is the
   deliverable; §3 is why authority attaches to `(role, factClass, interval)` and never to a party, and
   A8-SELF is the rule this round makes testable.
5. `docs/domain-reference/analysis/A9-identity-cross-references.md` **§3.6** — the second and
   independent reason to mint the party, and §3.6 item 2's ruling-out of `partyRole`. Then
   `data/identity-schemes.json`'s five `party`-grain rows and the loader invariant that holds their
   blockers.
6. `docs/domain-reference/context-map.md` — its **join surface**, where `PartyId` is measured as the
   widest-spread concept with no aggregate behind it, and its **debt** section, which enumerates the
   three `TODO(…)` markers naming this item.
7. `docs/domain-reference/analysis/published-event-catalog.md` **§2.3** and **§2.3.1** — the change
   classes and the pre-1.0 version rule. `newAggregateKind` already exists and `[SD §1.2]` states its
   permission outright, so this round may not need to mint a class — **which would be the first round
   since A5 that did not**.
