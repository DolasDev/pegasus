# Domain reference — `roleClass`: plan and resumption state

**Written 2026-10-05**, to be read by a session with **no prior context**. Everything needed to resume
is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-context-map.md`, whose round landed in full; the
record is `plans/completed/domain-reference-context-map.md`, and its transferable lessons are carried
into §3, §4 and §6 of this file rather than left to be rediscovered.

> **§1 IS NOT A SEED.** Unlike the last two plans, §1 here rests on a measurement taken while writing
> this file, and that measurement **overturned the previous plan's statement of the same item.** Read
> §1.1 before §1.2: the deliverable is not what the last plan said it was.

**All nine `v1 detail` areas are written, the cleanup and owed-closures rounds paid down what was
blocked on effort, and the context map is written and generated.** What is left is `roleClass`, the
command side and the aggregate lifecycles, and §5's recorded questions.

---

## 0. Where the model actually stands — measured 2026-10-05, and how to re-measure

**Every number here comes from a generated artefact or a command**, named beside it, because
`[A1 §9]`'s rule applies to this plan too. Re-measure rather than trusting this section if it is old.

### Coverage

| What                      | State                                         | Where it comes from                              |
| ------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `v1 detail` areas written | **9 of 9** (A1–A9)                            | `docs/domain-reference/analysis/A*.md`           |
| A10–A13                   | **context-map-only by design** — not gaps     | `rubric.md`'s status column, which says so twice |
| The context map           | **written, and generated**                    | `docs/domain-reference/context-map.md`           |
| Published record types    | **34**                                        | `catalog/index.json` → `members`                 |
| Catalog `specVersion`     | **0.6.2**                                     | `src/catalog.ts` → `CATALOG_VERSION`             |
| Corpus sources analysed   | **33 of 87** (20 more deliberately `skipped`) | `ls docs/domain-reference/sources/*/analysis.md` |
| Rounds landed             | **13**                                        | `ls plans/completed/ \| grep domain-reference`   |

A3 has an area document but **no round record of its own** — it was written inside the research-corpus
round (`34713637`), which is why `plans/completed/` has no `domain-reference-a3`. That is not a gap.

### What the model declares owed — and it is NOT a backlog

`catalog/index.json`'s `owed.counts`, generated from `src/` and unable to go stale. Read it with the
glossary's **Owed** section, which groups it by reason — and now also with
`docs/domain-reference/context-map.md`'s **debt** section, which groups the same inventory by **who
has to act** and adds the `TODO(…)` ledger that reaches neither the glossary nor the catalog.

**These are not to-do items.** They are carried deliberately under `[SD §0]` because the corpus does
not settle them, and most are blocked on **evidence that may not exist** rather than on effort. Every
owed vocabulary carries `x-owed-state` (`pending` | `refusedOnEvidence`) and `x-owed-why` on the wire.
**Scoring "percent complete" against this inventory counts a refusal as a gap.**

### What is closable on EFFORT ALONE — and the honest answer is now "nothing, quite"

The last plan listed three items. The context map landed. Of the other two:

1. **`roleClass` — the last plan said "its sources exist and are unread… Reading them is work, not a
   decision to overturn." That is false, and §1.1 is the correction.** It is a one-page public fetch
   plus a decision, not a reading task.
2. **The command side and the aggregate lifecycles** — **not started at all.** The largest remaining
   piece and the least specified; it needs its own research pass before a plan. Still true.

### How to re-measure all of it

```
python3 -c "import json;d=json.load(open('docs/domain-reference/catalog/index.json'));print(d['owed']['counts'])"
ls docs/domain-reference/sources/*/analysis.md | wc -l      # analysed sources
grep -c '^- id:' docs/domain-reference/sources/registry.yaml # registry entries
```

---

## 1. THE DELIVERABLE — `roleClass`, and the previous plan had its state wrong

### 1.1 The correction, measured before this plan was written

The previous plan said `roleClass` was the only owed **vocabulary** in `pending` state, on the ground
that _"its sources exist and are unread (`src:uncefact-mmt-rdm` ships a 605-value `PartyRoleCode` list
as a bare enumeration with no names)"_. **That sentence contradicts itself**, and the corpus says which
half is true:

- **`round-1-crosscheck.md` already read it**, under **`### A8 Parties & roles — thin`**, and in
  capitals: `src:uncefact-mmt-rdm`'s 605-value `PartyRoleCode` list and `src:uncefact-scrdm`'s
  624-value list _"are BARE ENUMERATIONS WITH NO NAMES in the captured package, so the two highest C1
  scores in this area are for a mechanism, not a vocabulary."_ Its **`## Quality problems in round 1`**
  section adds the consequence: _"a phase-3 area file that says 'UN/CEFACT gives us a party-role
  vocabulary' would be **false** — it gives us a mechanism and a count."_ Re-reading the package yields
  the same nothing.

  **Headings, not line numbers.** That document's headings are named rather than numbered, so there is
  no `§n` to cite and a line number would be wrong by the next edit. Find them with
  `/usr/bin/grep -n -a '^#\{1,3\} ' docs/domain-reference/analysis/round-1-crosscheck.md`.

- **The material is on no checkout of this repository.** `registry.yaml` records it as `local/`-only
  (245 MB, gitignored) with **`sha256: n/a`**, from a user browser download. Checked across the primary
  checkout and every worktree — `ls -d ~/repos/pegasus*/docs/domain-reference/sources/*/local` returns
  nothing, in any of them, and `find ~/repos -type d -name 'uncefact*'` finds only the per-source
  directories holding `analysis.md`. So it cannot be re-read, and could not be verified against what
  was read if it were. **`§6`'s rule applies and this is the instance it was written for:** check
  whether the capture exists before planning to quote primary text — and check **every** worktree, not
  the one you are in.
- **`[A9 §6]` item 1 carries the same self-contradicting sentence**, which is where the plan got it.
  It is `[A9]`'s to amend, and §3 item 14's house pattern is a marked annotation rather than a rewrite.

**The source that would settle it is a different one, it is one page, and it is free.** X12
**element 98** (party role codes), on stedi.com. Three documents already flag it as the blocker and
none of them is `[A8]`'s:

- `round-1-crosscheck.md`, **`## Unread material`**, under its **SHOULD** list: _"Element 98 is the
  single list the stedi analysis did not read, and it holds the thing A8 most needs from X12; the A8
  score there is explicitly provisional without it."_
- `[fork-time §7]`'s confidence table, the row labelled **`(b)(1)` the HHG `assertedBy.role`
  vocabulary**: _"`src:stedi-x12-reference` element 98 is still unread, and it is the one list that
  would let this be checked against an industry vocabulary; the stedi analysis scores A8 C2=1/C4=0 on
  exactly that ground."_ The same section's closing list names it again. (`fork-time`'s §-numbered
  headings exist, so this one cites a section; the `(b)(1)` label is the table's own row key, not a
  heading.)
- `round-2-critique.md`, **`## fork-time-provenance-corrections.md` → `### Original design presented as
though a source supported it`**, which is the sharpest: the HHG role vocabulary for
  `assertedBy.role` is `src:sirva-ade`'s cast presented as DCSA's shape, _"uncited at the point of use
  and unmarked as authored"_, while `[fork-time §7]` concedes element 98 is unread.

Note the shape of that: `src:stedi-x12-reference` is **`status: analyzed`**. The gap is one element
inside an analysed source, not an unanalysed source — which is why no count over `registry.yaml` shows
it and why three documents had to say it in prose. **A source's `status:` is not a statement about
every list inside it**, and that is a fourth routing-hint-read-as-a-record in this corpus, beside
`[A9 §1]`'s `v1 detail`, `Covers` and `areas:`.

### 1.2 So the round is a fetch, two decisions and an amendment

1. **Fetch X12 element 98** from stedi.com and store it under
   `docs/domain-reference/sources/stedi-x12-reference/captured/` with its URL, retrieval date and
   sha256 in `registry.yaml` — `sources/README.md` is the storage policy and it is public,
   non-normative material, so it is committable. **Check the directory first**:
   `ls -d docs/domain-reference/sources/stedi-x12-reference/captured` — it does not exist today.
2. **Decide `roleClass` on that evidence** — close it or refuse it, with `x-owed-state` saying which.
   `[A9 §3.2]` is the precedent for refusing on the evidence and the context map's refusal is the
   precedent for a refusal with no type-level edge. **Do not close it to make the inventory shrink**;
   `[A4 §7]` is the round that tried and found the inventory grow instead.
3. **Decide the non-party member separately, because element 98 will not supply it.**
   `fork-time` §941 says so in as many words: the non-party value is _"the member of the role
   vocabulary that element 98 is least likely to supply"_. `[A1 §1129]` and `[A4 §3 item 1]` both owe
   it: `FORCE_MAJEURE` and `CAUSE_UNKNOWN` are reasons caused by **no party at all**, `[SD §2.4]` makes
   `roleClass` mandatory, and without such a member those two codes cannot be recorded. Whatever it is
   called it is **`[ORIGINAL]`** and the marker travels with it.
4. **Then `[A8 §9 item 2]`**, which is `roleClass`'s owner and also owes _"the role enum has no van-line
   member"_ (`tariffOwner`). Closing the enum may close that row; check rather than assume, and
   `§3 item 3` governs the change class.
5. **Amend `[A9 §6]` item 1's sentence** (above), and the same courtesy to `round-1-crosscheck.md` if
   its SHOULD item is discharged.

**What this round must not do.** It must not touch `identityScheme`, which `[A9 §3.2]` refused on the
evidence — reversing that needs an argument, not a round. And the two are deliberately different: `[A9
§6]` item 1 exists to say so, and this round makes that sentence true rather than merely present.

---

## 2. Current state

Every area document, the executable layer, the published catalog, the context map, the cleanup round
and the owed-closures round are **merged to `main`**. The per-round table is in
`plans/completed/domain-reference-cleanup.md` and `plans/completed/domain-reference-owed-closures.md`;
the short version is that `docs/domain-reference/` holds the corpus, the thirteen-area rubric, the nine
area documents, the generated glossary and the generated context map, and
`packages/domain-reference/` holds the executable specification, **three** generators and the
conformance suite.

Catalog at `specVersion` **0.6.2**, bumped by the owed-closures round under `[catalog §2.3.1]` — the
rule that pre-1.0 the **minor** slot carries breaking changes and the **patch** slot carries additive
ones, because that is what makes a caret range behave correctly unaided.

### Gates

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is a
prettier fixed point · **context map is a prettier fixed point** · catalog is a prettier fixed point
and round-trip-validated · `prettier --check` clean over **both** trees with **no exception** (if an
exception appears, it is yours).

**No count is written here on purpose** — §3 item 10 is the rule. The commands produce it in about
five seconds:

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

Follow this order. **It applies to a vocabulary round exactly as it applies to an area round**, and
items 6, 8, 10 and 14 are the ones a round is most tempted to skip.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker** —
   the disclosure gate reads the docstring, **including on the members of a two-member enum**. A JSDoc
   must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or the
   glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set**, and
   **put the cross-field invariants in the loader**.
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`, the
   cleanup round added `newAnnotation`), **or that no class applies because nothing published changed**
   (A2, A6, A9, the context map). **A change to the owed inventory is NOT a change to what is
   published** — `[catalog §5]` and `[catalog §2.4]`'s `0.5.0` and `0.6.2` rows both say so. **Closing
   an owed vocabulary IS**: `roleClass` is an `OwedCode` on the wire, so minting its members changes
   the emitted schema. Read the diff (item 8) before naming the class.
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named rule
   or fold** in `RULES` — all three in `tools/generate-glossary.ts`. **None is auto-discovered, and
   `A8-KEY` was missing from `RULES` for four releases before the owed-closures round noticed.** A
   `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary`,
   `npm run catalog` **and `npm run context-map`**, then the tests. One bump may carry two classes for
   two independent deliverables — a `specVersion` names a published state, not a piece of work
   (`0.6.2`).
6. **Tamper each new gate and watch it fail, then restore** — and **commit first**. `git checkout --`
   on a tracked file with uncommitted work reverts the work.
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. There should be **no** exception to this.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather than
   as a formality. A2's, A6's, A9's and the context map's were empty and in A6's case the emptiness
   **was** the deliverable — **but A7's was not, and neither was `0.6.2`'s**: `AWARD` never reaches the
   wire (`boundBy` is on no record) and the whole of its diff is one `AuthoritativeHolder` branch,
   which is `keySideRole`'s shape at `0.3.0` exactly. **Twice now the diff has located a change the
   decision did not predict.**
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**; where a claim is a comparison rather than a total, **gate the comparison**. **And
    an ORDINAL is worse than a count: delete it, and name the things.** The owed-closures round found
    six stale counts, including a denominator ("three of **eleven** rows") that survived five new rows
    in two places, and a "six independent publishers" that contradicted its own gate's "four publishing
    bodies" in the row that gate exists for. **A type whose name is a number has the same defect as a
    sentence whose claim is one** — `SixteenRows` is now an enumeration. **And an ordinal can be
    accurate and still date the sentence around it**: `[A1 §9]` rules out an ordinal that depends on
    **who** is counting; "why this is a sixth `boundBy`" depended on **when**. **The context map adds
    the positive form:** where a rule needs a threshold, declare the threshold in code and gate the
    **membership it produces**, enumerated by name — then an edit that moves the boundary fails naming
    the thing that moved.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned one
    can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**. A7's reason is worth reading: a `satisfies` clause checks **membership, not
    exhaustiveness**. **A9 adds the mirror discipline**: it deliberately left its own data table _out_
    of the comparison, because putting it in would have asserted the closure it declines.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6, A7, A9, the owed-closures round and the context map all ship both halves side by side — and the
    second half is the one that gets skipped. `ZonedInstant` has no edge: a value carrying `zone`
    beside `at` is **structurally assignable** to `{at: Instant}`, because excess-property checking
    does not reach a value arriving through a variable. The context map's pattern-label refusal has no
    edge either, for a different reason: **there is no vocabulary for it to leave a hole in**, so it is
    held over the bytes a generator emits. **Silently dropped is worse than refused**, and only prose
    can say so.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The house
    pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go **unused**
    (`TS2578`) when the illegal state becomes legal. **Then tamper it.** **Two mechanical traps inside
    it:** `@ts-expect-error` covers **one** line, so **name the value first and annotate the
    assignment**; and **the absence of a TYPE has no type-level witness** —
    `Extract<keyof typeof module, 'Name'>` enumerates the **value** namespace, so it can never fire for
    a type alias. `CustodyIsNotAFactClass` is sound only because it reads a runtime array.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`, which A7 edited four times. **Before opening the PR, re-read your own §Cross-area list
    in BOTH directions**: A7 found four `[catalog]` edits with no section declaring them; A9 found six
    edits it had **declared and not yet made**. For an **area** document the house pattern is a marked
    annotation (`> **CLOSED 2026-10-05**`, `> **Overturned by [A7 §3.5]**`) rather than a rewrite,
    because the argument is what the new row rests on. **This round owes `[A9 §6]` item 1 one.**
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read the
    rendered diff of every prose file you touched** before opening the PR — and see §4's second lesson
    about _when_.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** The house shape is
    **`Owner — reason`**. **`owedTo` is emitted as a schema `const` on both faces**, so correcting one
    costs a version bump — `repointedOwedOwner`. **Repointing a blocker is a real deliverable**: the
    owed-closures round left `orderCancellation` and `shipmentCommitment` owed and changed what they are
    owed **for**, which stops the next round re-opening a settled schema question.
17. **`vitest` does not typecheck, and a test that passes can still be a type error.** Run
    `npm run typecheck` after **every** test edit. It bites in both directions: striking an entry from a
    two-entry register narrowed its inferred union and turned the surviving filter into a comparison
    `tsc` reports as impossible (`TS2367`).
18. **When a finding looks like your area's, measure whether it is systemic first.** A9's first instinct
    was to repair fourteen registry entries; measuring showed the gap in all thirteen areas.
19. **A gate must read the thing that DECLARES, and "the paragraph" is not it.** The cleanup round's
    lesson was that scoping a gate is half the fix; the owed-closures round found the other half twice.
    **A gate scoped to a region that contains prose about the finding closes on that prose** — once over
    a whole `[SD]` section whose note explains the divergence it is about, and once over a note whose own
    sentence names the members it quotes. Scope to the table column, or to the slash-separated
    enumeration, and nothing wider. The corollary: **a document may have to describe a finding without
    spelling its token**, and should say that it is doing so and why.
20. **A gate whose subject is what a generator EMITS must read what the generator emits.** The context
    map's two refusal gates first read the committed file; tampering the generator fired only the
    staleness check and the substantive gate passed on a file the tamper had not touched. That is A6's
    half-tamper defect in a third shape, and the fix is one line: read `generate…()`, not
    `readFileSync(…)`.
21. **"No markdown tables" is necessary and not sufficient for a prettier fixed point.** The glossary
    generator's header gives one reason an emitted markdown file drifts. The context map has no table
    and still drifted twice: a **citation whose own text wrapped across a line**, which split its own
    bullet and got re-indented; and a **`**bold**` run cut in half** by the line a note was truncated
    at. And one repair over-reached — stripping `_` with `*` turned `NOT_COMPLETED` into
    `NOTCOMPLETED`. An intra-word underscore is not emphasis and never needed removing.

---

## 4. The procedural lessons

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, one level out: **the suite says nothing about prose, and prose is where the counts, the
superlatives and the conventions live.** Budget a deliberate read-the-diff-and-recount pass.

A9's, which is A7's lesson tested and found insufficient: **budgeting the pass is not the same as the
pass working.** A9 ran it, found four defects in a round that had read A7's warning about exactly those
shapes — and then **ran it again after the cross-area edits and found four more**. Two consequences:

- **The review pass must run after the LAST prose is written**, and the last prose a round writes is
  always the part that edits other people's documents. Bracket the cross-area pass; do not precede it.
- **A superlative is usually a comparison you have not made yet, and an ordinal is usually a count
  someone else is keeping differently.**

The cleanup round's, about plans rather than prose: four of its seven planned items carried something
the plan had wrong or did not predict. **A plan is a claim to audit, not a specification to execute.**

The owed-closures round adds two. **The review pass reaches your commit messages** — running it after
the cross-area edits found a count in the message of the commit immediately before it, and nothing
regenerates a commit message. **And a contradiction can be _inside_ one document, between two of its own
sections**: `[A1]`'s §Cross-area asked A8 for a member that would close two rows, while `[A1 §3.5]`'s own
permission table and `[A1 §8]`'s scenario 7 both say the second row cannot close.

> **The context-map round adds two more, and the first is the sharpest form of "audit the plan" yet.**
>
> **A plan can be wrong about an item it did not invent, by carrying one half of a self-contradicting
> sentence.** The last plan called `roleClass` "sources exist and are unread" and quoted, in the same
> breath, the finding that the list "ships as a bare enumeration with no names" — which only a reading
> could establish. The sentence came from `[A9 §6]`, which wrote both halves. **A clause that describes
> what a source contains is a clause that reports a reading**, and a plan that calls the same source
> unread is carrying a contradiction it inherited. §1.1 is the whole of this lesson.
>
> **And a measurement taken to design a rule can refute the rule's premise.** The citation join that
> looked like the obvious way to find what crosses areas was measured before anything was written, and
> it gives the party **one** area — the concept whose discoverability was the strongest stated reason
> for the deliverable. Measuring first cost one script and changed the design; measuring after would
> have cost a round.

---

## 5. What is blocked, and on what — ask the user items, do not schedule them

### Still the user's, and only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived yet.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — that is the
   `[ORIGINAL]` guess `[SD §0]` forbids, and A9 set the precedent for refusing rather than guessing.
   Record it as **`[USER]`** evidence with the user's own words quoted when it comes. **Minting
   `documentIssuance` did not discharge it** and the two were never the same item (`[A6 §3.3(b)]`).

### Possibly the user's, and new

2. **`src:uncefact-mmt-rdm`'s 245 MB local package is gone from this machine, and `registry.yaml`
   records it with `sha256: n/a`.** Nothing in §1 needs it — the names are not in it (§1.1) — so this
   is **not** a blocker for this round. But the registry currently claims a retained file that does not
   exist, which is the kind of claim this corpus gates everywhere else. Two honest options, both
   cheap: re-obtain it (free, UNECE, a browser download the user already did once), or amend the entry
   to say the package was read in round 1 and not retained. **Ask; do not pick.** The same question
   applies to `src:uncefact-scrdm` if its entry has the same shape.

### Recorded modelling questions, for a later round — none is a user ask

- **`fork-time §(b)(5)`'s typed time values are unadopted.** The decision adopts `LocalDate` ·
  `LocalDateRange` · `ZonedInstant` and _"no bare ISO strings; no zoneless instants"_; the shared layer
  publishes `Instant` ("ISO-8601 with an offset") and `CalendarDate` and nothing else. So
  `[fork-time §8.1]`'s committed delivery **spread** is unpublishable. Held by
  `tests/conformance/time-value-shape-refuses.ts` and `time-value-shape.test.ts`, and recorded in
  `[SD §4.7]` note 5. **Closing it is `changedValueShape` — breaking** — and it is owed to `[SD §4.1]`
  and `[SD §4.2]`. The context map now ranks `Instant` first on reference spread, which is the measure
  of what a breaking change there would cost.
- **`orderCancellation`'s holder.** Binding settled (`AWARD`); holder plural, so `[A8 §4.4]` A8-NAMED
  needs a tie-break and no source publishes one. Underneath it is **`[A1 §3.5]`'s open defect**:
  `[SD §2.3]` invariant 2 forbids `reasons[]` at `COMPLETED`, so on the ordinary completed cancellation
  the field `[SD §4.7.2e]` item 2 puts the requestor on does not exist.
- **`shipmentCommitment`'s "who commits".** A **reading of three sources that disagree**, not a schema
  change: `src:sirva-ade`'s `Register` is pushed by the awarding side, `src:milmove-mymove` runs a
  two-actor submit-then-approve, `src:cfr-49-375` has the carrier name and price the lot. It still
  blocks `[A2 §3.2]`'s B-ONWARD, `[fork-order §5.2]`'s B-STAGE and an `[A1 §3.4]` `COMPLETE` rule.
- **`orderAward` is blocked harder than before.** It mints the award, so the mint principle rules out
  `AWARD` as well as `PRINCIPAL`. `MintingActsAreNotBoundToWhatTheyMint` holds all four pairs over the
  table, so a round that reads "the order rows close with `AWARD`" fails by name.
- **`[A8 §9 item 1]` — the party entity — is the load-bearing one, and the context map is the new
  evidence for that.** `PartyId` is the widest-spread concept on the join surface with **no
  aggregate behind it**, and
  three `TODO(…)` markers name the item (`ids.ts:167`, `custody.ts:139`, `rules/authority.ts:1813`).
  `[A9 §3.6]` is the argument; the map is the measurement. It is a plausible round after this one.
- **F4 is open.** `ExternallyPerformedLeg.performedBy` has no consumer —
  `analysis/findings-from-alloy.md`, against `[SD §4.8.3]` rule 1 versus its own amended fold table.
- **A7's cross-subject set-off is a silence, not a refusal.** `OffsettingRecord.offsets` is an `EventId`
  and says nothing about whether the two assertions share a subject, while
  `src:dp3-tender-of-service` NTS §5.8.2 publishes a set-off across bills of lading (`[A7 §3.8]`).
- **`[A9 §3.3(b)]`'s SCAC gap stays open with the fetch ruled out.** C1 decided we are not buying the
  authority's material; `definedNotMerelyNamed` is still `false`. A round that wants SCAC _defined_ must
  reopen the registry entry and argue for the purchase. **Note the contrast with §1's fetch**, which is
  free and one page: "the fetch is ruled out" is a decision per source, not a policy.
- **`[SD §10.4]`** still carries **two of its five** items open: the directional stop-type pairs (A3's)
  and custody authority's owner, partially closed with the cap moved rather than lifted.
- **The `needs-user` backlog is not a backlog anyone is working.** The number is in `registry.yaml` and
  this plan deliberately does not restate it (§3 item 10).
- **A `§n` citation whose `n` is a LINE number, and it is not only this plan's defect.** §1.1's
  citations into `round-1-crosscheck.md` were line numbers dressed as sections and were corrected
  before this plan landed. The same shape is already in the corpus: `[A2]`'s §Cross-area note to `[A3]`
  cites _"(§1207, §1289, §3.3's diversion row, §5.1's note at :544)"_, and neither `1207` nor `1289` is
  a heading in either document — they are line offsets into `[A3]`, and the `:544` is explicit about
  being one. **`§3 item 10`'s rule extends to this**: a line number is an ordinal over a file, it dates
  the sentence around it, and nothing regenerates it. Repairing it is `[A2]`'s and `[A3]`'s, via a
  marked annotation (§3 item 14); recorded here so a round that opens either document for another
  reason knows to fix it in passing. **The general form: cite a heading, and if the document's headings
  are named rather than numbered, name the heading.**

---

## 6. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering, and commit before you do.** A false green is worse than a red. A5
  shipped a compile-time assertion that did nothing; A2 shipped one that could never fail even though it
  was assigned; A6 found a gate that passes a half-tamper, A7 reproduced it, and the cleanup round fixed
  it — the fix needing three declaration shapes where the plan predicted one, plus an exactly-once rule.
  A9 adds a gate that reads a **position** in a table it does not own. The owed-closures round adds a
  compile-time absence check over a module's value namespace, which can never fire for a type alias, and
  a gate whose scope includes prose about its own finding. **The context map adds the third shape of the
  half-tamper: a gate that read the committed file instead of the generated bytes** (§3 item 20).
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §3 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §3 item
  13 — **unless there is nothing for a type to hold**, which is the context map's case and is stated
  rather than papered over.
- **Re-read your own §Cross-area list before opening the PR** — §3 item 14, in **both** directions.
- **Read the rendered diff of every prose file you touched, and re-count every count** — §3 items 10
  and 15 — **including your own commit messages.** No gate in this package reads prose for sense.
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title, **or
  a comment inside a passing assertion** naming your own area is a to-do item. The owed-closures round
  found one in `tests/scenarios/car-on-a-separate-carrier.test.ts` and another in
  `tests/conformance/document-identity-and-evidence.test.ts`. **And now read the context map's debt
  section too**, which enumerates every `TODO(…)` in `src/` with the document that owes it — that is
  the register this discipline used to find by grep.
- **Check whether the source captures exist before planning to quote primary text**; **evidence grade is
  not the same as having a capture**; and **a capture is not the same as a definition**.
  `ls -d docs/domain-reference/sources/*/captured` is the check, and
  `ls -d docs/domain-reference/sources/*/local` is the other half — **§1.1 is the round that needed
  both**, and a `local/` entry with `sha256: n/a` cannot be verified even when the file is there.
- **A source's `status: analyzed` is not a statement about every list inside it.** Element 98 sat unread
  inside an analysed source, named only in prose by three documents (§1.1).
- **A gate's own comment can tell you it is due to be inverted**, and inverting is the house move:
  `source-registry.test.ts`'s `[A9 §1]` block, and the owed-closures round's two inverted assertions in
  `document-identity-and-evidence.test.ts`, which now hold a closure where they held a gap.
- **`sources/registry.yaml`'s `areas:` field is TWO HALVES**, and the registry's own schema comment
  states both. Generated for a source with a score table (a conformance test holds it per source); the
  hand-written discovery hint `[A9 §1]` describes for an entry with no analysis, where empty is
  legitimate for a `skipped` one. The split is on the presence of a score table and **never** on
  `status:`. `tools/source-registry.ts` is the one reader; import it rather than writing a second
  parser. **A count over the registry is deliberately deleted rather than gated** — that file's own
  header says why, and `[A9 §7]` follows it.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.** **All
  three generators** hold literal NULs. **When a negative grep result is load-bearing, use
  `/usr/bin/grep -a`.** In `dolas/agents/project/GOTCHAS.md`. **§1.1's `bounded context` search was such
  a result** and was run that way.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit — §3 item 17.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write`.

### Working with the generators

All three live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. `generate-context-map.ts` imports its model, citation and owed readers from
`generate-glossary.ts` rather than copying them; the `invokedDirectly` guard is what makes that safe. If
you extend any of them:

- **Prettier must run inside the generator**, or the output must already be a fixed point.
  `JSON.stringify(x, null, 2)` is not one. **No markdown tables** — and that is necessary, not
  sufficient (§3 item 21).
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, every member of every registered vocabulary needs one,
  and **emphasis must be `_x_`, never `*x*`**.
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every `.md`
  in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — **and any
  unqualified `` `type: X` `` span is read the same way**. In `GOTCHAS.md`.
- **The published schema is not the same as the data table** — A6's D-ID and A9's scheme table both cost
  no bump because a `data/` list is documentation, not a published constraint. **But the reverse also
  happens**: A7 found `owedTo` emitted as a `const`, the cleanup round found that `x-owed` reached the
  `OwedCode` vocabularies and not the `Owed` value branches, and the owed-closures round found that a new
  `boundBy` member reaches the wire **only** through `AuthoritativeHolder`. **Check the emitted schema
  both ways**, and read the diff before classifying.
- **A new `TODO(…)` in `src/` fails `context-map.test.ts` by name.** That is deliberate — the ledger is
  enumerated, not counted — and the fix is to add it to the list, not to loosen the reader.
- **A new type reference in `src/` can promote a concept onto the join surface** and fail the same file.
  Decide whether the concept really does cross before changing the enumeration, and never widen a
  threshold to make a failure go away.

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only — `beforeAll`
  needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, including inside captured material.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is tracked,
  so `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. A captured XML can be read with a small
  `re`-based tag-stripper.
- **Worktree slugs collide on the derived Postgres port** —
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`, and check it is free with
  `ss -ltn` before choosing a slug.

---

## 7. Housekeeping unrelated to this plan

- **Separate repo** — `~/repos/pegasus-workflows`, `platform/integrations/weichert/rules.json`: six rules
  carry `sourceRef: "Weichert API: …"` quoting sentences that appear nowhere in `weichert-api.odt`.
  Confirmed by the user: they came from **observed API error responses**. Reword them, and fix the
  packed-but-not-loaded dead end — `pre-in-progress-forbids-pack-actual` combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in GLOBAL
  and the `nw` tenant.

---

## 8. What follows this round

After `roleClass`: **`[A8 §9 item 1]`, the party entity**, which the context map measured as the
load-bearing blocker (§5); then **the command side and the aggregate lifecycles** (not started, the least
specified — it needs its own research pass before a plan); then `[A8]`'s remaining ledger, the two
refused vocabularies, and §5's recorded modelling questions.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='dr-roleclass'; print(5433 + sum(ord(c) for c in s) % 60)"   # derive the DB port
ss -ltn | grep -E ':(54[3-9][0-9])'                                        # …against what is listening
scripts/workstream-start.sh chore dr-roleclass plans/in-progress/domain-reference-roleclass.md
```

> **Derive the port, do not trust a number written here.** A9's plan wrote a guessed port and was wrong
> by fifty-one. A different slug derives a different port, so do not "improve" the slug without
> recomputing.

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to `plans/in-progress/<slug>.md`
> inside the worktree, so the worktree ends up with **two** copies — the seeded one and this file. Do not
> edit both. The pattern that has worked every round: write the new record at
> `plans/completed/domain-reference-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file —
> **and update `rubric.md`'s link to this plan**, which is the one cross-reference to it outside
> `plans/`. The script provisions Postgres **after** creating the worktree and branch, so a port
> collision fails late and leaves partial state; `scripts/rm-worktree.sh <slug>` cleans it up.
>
> **And one harness limit worth knowing before you start.** `EnterWorktree` only manages worktrees under
> `.claude/worktrees/`, while this repo's convention puts them at `~/repos/pegasus-<slug>`. A
> worktree-isolated session therefore **cannot move into a worktree it provisions**. Either start the
> session in the worktree, or work on a branch in the one you are already in — which is fine for
> `packages/domain-reference`, since nothing in it needs Postgres. **The owed-closures round and the
> context-map round both did exactly that** and it cost nothing.

**Read before writing anything:**

1. **§1.1 of this file** — the correction to the previous plan's statement of this very item. Then §1.2,
   which is the round.
2. `plans/completed/domain-reference-context-map.md` — the round that just landed, its
   plan-was-wrong findings, and the two lessons it adds to §4.
3. `docs/domain-reference/context-map.md` — specifically its **debt** section, which is the register the
   glossary does not publish, and its **join surface**, which is where `RoleName` and `PartyId` are.
4. `docs/domain-reference/analysis/round-1-crosscheck.md` — its **`### A8 Parties & roles`**,
   **`## Quality problems in round 1`** and **`## Unread material`** sections, which are the reading
   §1.1 rests on, including the SHOULD item this round discharges. Its headings are named, not
   numbered; §1.1 says how to find them.
5. `docs/domain-reference/analysis/published-event-catalog.md` **§2.3** and **§2.3.1** — the change
   classes and the pre-1.0 version rule. Closing `roleClass` **does** reach the wire (§3 item 3).
6. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state of the model on one page,
   carrying a reason per owed vocabulary and a per-group explanation with no counts in it.
