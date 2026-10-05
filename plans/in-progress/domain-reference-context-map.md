# Domain reference — the context map: plan and resumption state

**Written 2026-10-05**, to be read by a session with **no prior context**. Everything needed to
resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-owed-closures.md`, whose round landed in full; the
record is `plans/completed/domain-reference-owed-closures.md` and **its transferable lessons are
carried into §3 item 19, §4 and §6 of this file** rather than left to be rediscovered. (No count:
that record has seven headings and this sentence said "four" until the review pass read it, which is
§3 item 10 catching the plan that states it.)

> **§1 IS A SEED, NOT A FINISHED DESIGN.** It came from A9's plan, then the cleanup round's §8, then
> the context-map plan's §1, then the owed-closures plan's §8, and now here — **it has never had a
> planning pass of its own.** Do that pass before executing any of it, and expect it to change the
> deliverable: §1 item 3 says the cheapest useful output may not be a document at all.

**All nine `v1 detail` areas are written, the cleanup round paid down what they found and did not
fix, and the owed-closures round closed everything that was blocked on effort alone.** What is left
is either synthesis over work already done (§1) or blocked on evidence that may not exist (§5).

---

## 0. Where the model actually stands — measured 2026-10-05, and how to re-measure

**Every number here comes from a generated artifact or a command**, named beside it, because
`[A1 §9]`'s rule applies to this plan too. Re-measure rather than trusting this section if it is old.

### Coverage

| What                      | State                                         | Where it comes from                              |
| ------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `v1 detail` areas written | **9 of 9** (A1–A9)                            | `docs/domain-reference/analysis/A*.md`           |
| A10–A13                   | **context-map-only by design** — not gaps     | `rubric.md`'s status column, which says so twice |
| Published record types    | **34**                                        | `catalog/index.json` → `members`                 |
| Catalog `specVersion`     | **0.6.2**                                     | `src/catalog.ts` → `CATALOG_VERSION`             |
| Corpus sources analysed   | **33 of 87** (20 more deliberately `skipped`) | `ls docs/domain-reference/sources/*/analysis.md` |
| Rounds landed             | **12**                                        | `ls plans/completed/ \| grep domain-reference`   |

A3 has an area document but **no round record of its own** — it was written inside the
research-corpus round (`34713637`), which is why `plans/completed/` has no `domain-reference-a3`.
That is not a gap.

### What the model declares owed — and it is NOT a backlog

`catalog/index.json`'s `owed.counts`, which is generated from `src/` and cannot go stale. Read it
with the glossary's **Owed** section, which groups it by reason and is the thing to read rather than
any prose summary — including this one.

> **The inventory went DOWN for the first time in the model's history**, and the shape of that
> matters more than the number: `absentFactClasses` reads 10 → 13 → 14 → 15 → 16 across the area
> rounds in `index.json`'s own history, and **15** now. `authorityRows` went 14 → 13. Both are the
> owed-closures round, and both are a **mint** rather than a redefinition.

**Read the inventory the way the cleanup round's §1 said to**, because the distinction is the whole
thing. These are **not** to-do items. They are carried deliberately under `[SD §0]` because the
corpus does not settle them, and most are blocked on **evidence that may not exist** rather than on
effort. The clearest case is `identityScheme`: `[A9 §3.2]` read its sources and **refused to publish
the vocabulary on the evidence**. That is a decision, and a round that reverses it must overturn an
argument first. **Scoring "percent complete" against this inventory counts a refusal as a gap.**

The wire says which is which: every owed vocabulary carries `x-owed-state`
(`pending` | `refusedOnEvidence`) and `x-owed-why`.

### What is closable on EFFORT ALONE — the list, and it is nearly empty now

**The owed-closures round was the round that drained this list**, which is why §1 is a synthesis
round rather than another closure round.

1. **The context map** (§1) — synthesis over work already done. No new evidence needed, which is
   also why §1 warns it can restate the area documents and call that a deliverable.
2. **`roleClass`** — **pending, not refused**: its sources exist and are unread
   (`src:uncefact-mmt-rdm` ships a 605-value `PartyRoleCode` list as a bare enumeration with no
   names). Reading them is work, not a decision to overturn. It is the only owed **vocabulary** in
   that state.
3. **The command side and the aggregate lifecycles** — **not started at all.** The largest remaining
   piece and the least specified; it would need its own research pass before a plan.

Everything else in §5 is blocked on evidence, on a user answer, or on a decision another area owns.

### How to re-measure all of it

```
python3 -c "import json;d=json.load(open('docs/domain-reference/catalog/index.json'));print(d['owed']['counts'])"
ls docs/domain-reference/sources/*/analysis.md | wc -l      # analysed sources
grep -c '^- id:' docs/domain-reference/sources/registry.yaml # registry entries
```

---

## 1. THE DELIVERABLE — the context map, and it needs a planning pass first

**With A9 landed there is no unwritten v1 area left, so the shape of the work changes.** Every round
since A4 has been: pick an area, audit what is owed to it, read its sources, decide, gate, record.
The context map is not that. It is a **synthesis over work already done**, and its risk is the
opposite of an area's: an area round risks claiming more than its sources say, and this one risks
**restating** what the area documents already say and calling it a deliverable.

1. **Find what the context map is supposed to be before designing one.**
   `/usr/bin/grep -rn -a 'context map' docs/domain-reference plans` — the term does two jobs: a
   DDD-style map of bounded contexts and their relationships, and `rubric.md`'s marker for an area
   that gets a sketch rather than a decision document (`A10`–`A13` are _"context-map-only by
   design"_). **They are not the same thing and a plan that conflates them will produce neither.**
2. **The strongest reason to do it, and it is A9's finding.** `[A9 §3.6]` and `[A8 §9 item 1]`
   between them show the model has a **party** that is an identifier with no aggregate, referenced by
   `assertedBy`, by `vocabularyScope.authority`, by `issuer` and by five witnessed identity schemes —
   discoverable today only by reading four documents. **Start from the things that appear in more
   than one area**: the party, the Portion, `evidence[]`, the identity key, custody, and the owed
   authority rows.
3. **The cheapest useful output may not be a document.** Every generated artefact here is built from
   `src/` through the TypeScript compiler API, and `tools/generate-glossary.ts` already knows every
   document, rule, vocabulary and owed value. **A generated context map would be gated by
   construction**, where a hand-written one joins the prose nothing checks (§4).
4. **Watch for this trap.** A10–A13 are **context-map-only by design and are not gaps** (`rubric.md`
   says so twice). A context-map round must not turn into four thin area documents. If the map wants
   something A10 owes, the map **records** the debt; it does not discharge it.

> **One thing the owed-closures round adds to this seed, and it is an argument FOR the generated
> form.** That round found six stale counts and one stale quotation, spread over two analysis
> documents, two `data/` tables and one `src/` module — every one of them a claim about a set that
> the code already knew. A hand-written context map
> is a document whose entire content is claims about sets that the code already knows. **If the map
> is hand-written, assume it is stale on the day it merges.**

**Nearest models for shape:** `[A8]`'s skeleton — a document whose deliverable is a **table of what
is owed** rather than a set of decisions — and `[catalog]`, a contract **around** the vocabulary
rather than part of it.

---

## 2. Current state

Every area document, the executable layer, the published catalog, the cleanup round and the
owed-closures round are **merged to `main`**. The per-round table is in
`plans/completed/domain-reference-cleanup.md` and
`plans/completed/domain-reference-owed-closures.md`; the short version is that
`docs/domain-reference/` holds the corpus, the thirteen-area rubric, the nine area documents and the
generated glossary, and `packages/domain-reference/` holds the executable specification, the two
generators and the conformance suite.

Catalog at `specVersion` **0.6.2**, bumped by the owed-closures round under `[catalog §2.3.1]` — the
rule that pre-1.0 the **minor** slot carries breaking changes and the **patch** slot carries additive
ones, because that is what makes a caret range behave correctly unaided.

### Gates

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated · `prettier
--check` clean over **both** trees with **no exception** (if an exception appears, it is yours).

**No count is written here on purpose** — §3 item 10 is the rule. The commands produce it in about
five seconds:

```
npm run test      -w @pegasus/domain-reference
npm run lint      -w @pegasus/domain-reference
npm run typecheck -w @pegasus/domain-reference
npm run alloy     -w @pegasus/domain-reference
npm run glossary  -w @pegasus/domain-reference
npm run catalog   -w @pegasus/domain-reference
```

---

## 3. Landing a change — the recipe the area rounds established

Follow this order. **It applies to a synthesis round exactly as it applies to an area round**, and
items 6, 8, 10 and 14 are the ones a non-area round is most tempted to skip.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum**. A
   JSDoc must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or
   the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set**, and
   **put the cross-field invariants in the loader**.
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`,
   the cleanup round added `newAnnotation`), **or that no class applies because nothing published
   changed** (A2, A6, A9). **A change to the owed inventory is NOT a change to what is published** —
   `[catalog §5]` and `[catalog §2.4]`'s `0.5.0` and `0.6.2` rows both say so.
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. **None is auto-discovered,
   and `A8-KEY` was missing from `RULES` for four releases before the owed-closures round noticed.**
   A `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests. One bump may carry two classes for two independent
   deliverables — a `specVersion` names a published state, not a piece of work (`0.6.2`).
6. **Tamper each new gate and watch it fail, then restore** — and **commit first**. `git checkout --`
   on a tracked file with uncommitted work reverts the work.
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. There should be **no** exception to this.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather
   than as a formality. A2's, A6's and A9's were empty and in A6's case the emptiness **was** the
   deliverable — **but A7's was not, and neither was `0.6.2`'s**: `AWARD` never reaches the wire
   (`boundBy` is on no record) and the whole of its diff is one `AuthoritativeHolder` branch, which is
   `keySideRole`'s shape at `0.3.0` exactly. **Twice now the diff has located a change the decision
   did not predict.**
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**; where a claim is a comparison rather than a total, **gate the comparison**.
    **And an ORDINAL is worse than a count: delete it, and name the things.** The owed-closures round
    found six stale counts, including a denominator ("three of **eleven** rows") that survived five
    new rows in two places, and a "six independent publishers" that contradicted its own gate's
    "four publishing bodies" in the row that gate exists for. **A type whose name is a number has the
    same defect as a sentence whose claim is one** — `SixteenRows` is now an enumeration.
    **And an ordinal can be accurate and still date the sentence around it**: `[A1 §9]` rules out an
    ordinal that depends on **who** is counting; "why this is a sixth `boundBy`" depended on **when**.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**. A7's reason is worth reading: a `satisfies` clause checks **membership, not
    exhaustiveness**. **A9 adds the mirror discipline**: it deliberately left its own data table
    _out_ of the comparison, because putting it in would have asserted the closure it declines.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6, A7, A9 and the owed-closures round all ship both halves side by side — and the second half is
    the one that gets skipped. `ZonedInstant` has no edge: a value carrying `zone` beside `at` is
    **structurally assignable** to `{at: Instant}`, because excess-property checking does not reach a
    value arriving through a variable. **Silently dropped is worse than refused**, and only prose can
    say so.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The
    house pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go
    **unused** (`TS2578`) when the illegal state becomes legal. **Then tamper it.**
    **Two mechanical traps inside it:** `@ts-expect-error` covers **one** line, so **name the value
    first and annotate the assignment**; and **the absence of a TYPE has no type-level witness** —
    `Extract<keyof typeof module, 'Name'>` enumerates the **value** namespace, so it can never fire
    for a type alias. `CustodyIsNotAFactClass` is sound only because it reads a runtime array.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`, which A7 edited four times. **Before opening the PR, re-read your own §Cross-area
    list in BOTH directions**: A7 found four `[catalog]` edits with no section declaring them; A9
    found six edits it had **declared and not yet made**. For an **area** document the house pattern
    is a marked annotation (`> **CLOSED 2026-10-05**`, `> **Overturned by [A7 §3.5]**`) rather than a
    rewrite, because the argument is what the new row rests on.
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read
    the rendered diff of every prose file you touched** before opening the PR — and see §4's second
    lesson about _when_.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** The house shape is
    **`Owner — reason`**. **`owedTo` is emitted as a schema `const` on both faces**, so correcting one
    costs a version bump — `repointedOwedOwner`. **Repointing a blocker is a real deliverable**: the
    owed-closures round left `orderCancellation` and `shipmentCommitment` owed and changed what they
    are owed **for**, which stops the next round re-opening a settled schema question.
17. **`vitest` does not typecheck, and a test that passes can still be a type error.** Run
    `npm run typecheck` after **every** test edit. It bites in both directions: striking an entry from
    a two-entry register narrowed its inferred union and turned the surviving filter into a
    comparison `tsc` reports as impossible (`TS2367`).
18. **When a finding looks like your area's, measure whether it is systemic first.** A9's first
    instinct was to repair fourteen registry entries; measuring showed the gap in all thirteen areas.
19. **A gate must read the thing that DECLARES, and "the paragraph" is not it.** The cleanup round's
    lesson was that scoping a gate is half the fix; the owed-closures round found the other half
    twice. **A gate scoped to a region that contains prose about the finding closes on that prose** —
    once over a whole `[SD]` section whose note explains the divergence it is about, and once over a
    note whose own sentence names the members it quotes. Scope to the table column, or to the
    slash-separated enumeration, and nothing wider. The corollary: **a document may have to describe
    a finding without spelling its token**, and should say that it is doing so and why.

---

## 4. The procedural lessons

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, one level out: **the suite says nothing about prose, and prose is where the counts, the
superlatives and the conventions live.** Budget a deliberate read-the-diff-and-recount pass.

A9's, which is A7's lesson tested and found insufficient: **budgeting the pass is not the same as the
pass working.** A9 ran it, found four defects in a round that had read A7's warning about exactly
those shapes — and then **ran it again after the cross-area edits and found four more**. Two
consequences:

- **The review pass must run after the LAST prose is written**, and the last prose a round writes is
  always the part that edits other people's documents. Bracket the cross-area pass; do not precede
  it.
- **A superlative is usually a comparison you have not made yet, and an ordinal is usually a count
  someone else is keeping differently.**

The cleanup round's, about plans rather than prose: four of its seven planned items carried something
the plan had wrong or did not predict. **A plan is a claim to audit, not a specification to execute.**

> **The owed-closures round adds two.**
>
> **The review pass reaches your commit messages.** Running it after the cross-area edits found four
> defects in prose written the same day — including a count in the message of the commit immediately
> before it. A commit message is part of the record and nothing regenerates it.
>
> **And a contradiction can be _inside_ one document, between two of its own sections.** `[A1]`'s
> §Cross-area asked A8 for a member that would close two rows; `[A1 §3.5]`'s own permission table and
> `[A1 §8]`'s scenario 7 both say the second row cannot close. Nothing in the suite compares two
> sections of one document, and the round that reads a document's ask should read its evidence too.

---

## 5. What is blocked, and on what — ask the user items, do not schedule them

### Still the user's, and only one

1. **C2 — what a signature asserts.** **ANSWERED IN PRINCIPLE 2026-10-04: the user will supply the
   wording, and it has not arrived yet.** `[A6 §6]` owes it to the user explicitly, no corpus source
   publishes it, and **it must not be inferred from the four published procedures** — that is the
   `[ORIGINAL]` guess `[SD §0]` forbids, and A9 set the precedent for refusing rather than guessing.
   Record it as **`[USER]`** evidence with the user's own words quoted when it comes.
   **Minting `documentIssuance` did not discharge it** and the two were never the same item
   (`[A6 §3.3(b)]`).

### Recorded modelling questions, for a later round — none is a user ask

- **`fork-time §(b)(5)`'s typed time values are unadopted, and it is NEW** (owed-closures round).
  The decision adopts `LocalDate` · `LocalDateRange` · `ZonedInstant` and _"no bare ISO strings; no
  zoneless instants"_; the shared layer publishes `Instant` ("ISO-8601 with an offset") and
  `CalendarDate` and nothing else. So `[fork-time §8.1]`'s committed delivery **spread** is
  unpublishable. Held by `tests/conformance/time-value-shape-refuses.ts` and
  `time-value-shape.test.ts`, and recorded in `[SD §4.7]` note 5. **Closing it is
  `changedValueShape` — breaking** — and it is owed to `[SD §4.1]` and `[SD §4.2]`.
- **`orderCancellation`'s holder.** Binding settled (`AWARD`); holder plural, so `[A8 §4.4]`
  A8-NAMED needs a tie-break and no source publishes one. Underneath it is **`[A1 §3.5]`'s open
  defect**: `[SD §2.3]` invariant 2 forbids `reasons[]` at `COMPLETED`, so on the ordinary completed
  cancellation the field `[SD §4.7.2e]` item 2 puts the requestor on does not exist. Two candidate
  fixes, both `[SD]`'s: a new field on the act, or an outcome reading that makes a
  requested-and-performed cancellation exceptional.
- **`shipmentCommitment`'s "who commits".** Same position as `orderCancellation` after the
  owed-closures round, and the gap is a **reading of three sources that disagree**, not a schema
  change: `src:sirva-ade`'s `Register` is pushed by the awarding side, `src:milmove-mymove` runs a
  two-actor submit-then-approve, `src:cfr-49-375` has the carrier name and price the lot. It still
  blocks `[A2 §3.2]`'s B-ONWARD, `[fork-order §5.2]`'s B-STAGE and an `[A1 §3.4]` `COMPLETE` rule.
- **`orderAward` is blocked harder than before.** It mints the award, so the mint principle rules out
  `AWARD` as well as `PRINCIPAL`. `MintingActsAreNotBoundToWhatTheyMint` holds all four pairs over
  the table, so a round that reads "the order rows close with `AWARD`" fails by name.
- **F4 is open.** `ExternallyPerformedLeg.performedBy` has no consumer —
  `analysis/findings-from-alloy.md`, against `[SD §4.8.3]` rule 1 versus its own amended fold table.
- **A7's cross-subject set-off is a silence, not a refusal.** `OffsettingRecord.offsets` is an
  `EventId` and says nothing about whether the two assertions share a subject, while
  `src:dp3-tender-of-service` NTS §5.8.2 publishes a set-off across bills of lading (`[A7 §3.8]`).
- **`[A9 §3.3(b)]`'s SCAC gap stays open with the fetch ruled out.** C1 decided we are not buying the
  authority's material; `definedNotMerelyNamed` is still `false`. A round that wants SCAC _defined_
  must reopen the registry entry and argue for the purchase.
- **`[SD §10.4]`** still carries **two of its five** items open: the directional stop-type pairs
  (A3's) and custody authority's owner, partially closed with the cap moved rather than lifted.
- **The `needs-user` backlog is not a backlog anyone is working.** The number is in `registry.yaml`
  and this plan deliberately does not restate it (§3 item 10).

---

## 6. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering, and commit before you do.** A false green is worse than a red.
  A5 shipped a compile-time assertion that did nothing; A2 shipped one that could never fail even
  though it was assigned; A6 found a gate that passes a half-tamper, A7 reproduced it, and the
  cleanup round fixed it — the fix needing three declaration shapes where the plan predicted one,
  plus an exactly-once rule. A9 adds a gate that reads a **position** in a table it does not own.
  **The owed-closures round adds two more:** a compile-time absence check over a module's value
  namespace, which can never fire for a type alias; and a gate whose scope includes prose about its
  own finding, which closes on that prose (§3 item 19).
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §3 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §3
  item 13. And beware the reverse: an `expect(x).toBe(x)` written as a diagnostic label is a no-op.
- **Re-read your own §Cross-area list before opening the PR** — §3 item 14, in **both** directions.
- **Read the rendered diff of every prose file you touched, and re-count every count** — §3 items 10
  and 15 — **including your own commit messages.** No gate in this package reads prose for sense.
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title,
  **or a comment inside a passing assertion** naming your own area is a to-do item. The
  owed-closures round found one waiting for it in
  `tests/scenarios/car-on-a-separate-carrier.test.ts` and another in
  `tests/conformance/document-identity-and-evidence.test.ts` that said in as many words what minting
  the class would mean.
- **Check whether the source captures exist before planning to quote primary text**; **evidence grade
  is not the same as having a capture**; and **a capture is not the same as a definition**.
  `ls -d docs/domain-reference/sources/*/captured` is the check.
- **A gate's own comment can tell you it is due to be inverted**, and inverting is the house move:
  `source-registry.test.ts`'s `[A9 §1]` block, and the owed-closures round's two inverted assertions
  in `document-identity-and-evidence.test.ts`, which now hold a closure where they held a gap.
- **`sources/registry.yaml`'s `areas:` field is TWO HALVES**, and the registry's own schema comment
  states both. Generated for a source with a score table (a conformance test holds it per source);
  the hand-written discovery hint `[A9 §1]` describes for an entry with no analysis, where empty is
  legitimate for a `skipped` one. The split is on the presence of a score table and **never** on
  `status:`. `tools/source-registry.ts` is the one reader; import it rather than writing a second
  parser. **A count over the registry is deliberately deleted rather than gated** — that file's own
  header says why, and `[A9 §7]` follows it.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  **Both generators** hold literal NULs. **When a negative grep result is load-bearing, use
  `/usr/bin/grep -a`.** In `dolas/agents/project/GOTCHAS.md`.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit — §3 item 17.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write`.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point.
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, every member of every registered vocabulary needs
  one, and **emphasis must be `_x_`, never `*x*`**.
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — **and any
  unqualified `` `type: X` `` span is read the same way**. In `GOTCHAS.md`.
- **The published schema is not the same as the data table** — A6's D-ID and A9's scheme table both
  cost no bump because a `data/` list is documentation, not a published constraint. **But the reverse
  also happens**: A7 found `owedTo` emitted as a `const`, the cleanup round found that `x-owed`
  reached the `OwedCode` vocabularies and not the `Owed` value branches, and the owed-closures round
  found that a new `boundBy` member reaches the wire **only** through `AuthoritativeHolder`.
  **Check the emitted schema both ways**, and read the diff before classifying.

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only —
  `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, including inside captured material.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is
  tracked, so `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. A captured XML can be read with a small
  `re`-based tag-stripper.
- **Worktree slugs collide on the derived Postgres port** —
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`, and check it is free with
  `ss -ltn` before choosing a slug.

---

## 7. Housekeeping unrelated to this plan

- **Separate repo** — `~/repos/pegasus-workflows`, `platform/integrations/weichert/rules.json`: six
  rules carry `sourceRef: "Weichert API: …"` quoting sentences that appear nowhere in
  `weichert-api.odt`. Confirmed by the user: they came from **observed API error responses**. Reword
  them, and fix the packed-but-not-loaded dead end — `pre-in-progress-forbids-pack-actual` combined
  with Weichert's real load-actual requirement leaves no valid status for a shipment packed but not
  yet loaded. Live in GLOBAL and the `nw` tenant.

---

## 8. What follows this round

After the context map, what remains is **the command side and the aggregate lifecycles** (not
started, and the least specified — it needs its own research pass before a plan), `roleClass`
(pending, sources unread), `[A8]`'s remaining ledger, the two refused vocabularies, and §5's
recorded modelling questions.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='dr-context-map'; print(5433 + sum(ord(c) for c in s) % 60)"   # derive the DB port
ss -ltn | grep -E ':(54[3-9][0-9])'                                        # …against what is listening
scripts/workstream-start.sh chore dr-context-map plans/in-progress/domain-reference-context-map.md
```

> **Derive the port, do not trust a number written here.** A9's plan wrote a guessed port and was
> wrong by fifty-one. A different slug derives a different port, so do not "improve" the slug without
> recomputing.

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that has worked every round: write the
> new record at `plans/completed/domain-reference-<slug>.md`, write the **next** round's plan as a
> new `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this
> file — **and update `rubric.md`'s link to this plan**, which is the one cross-reference to it
> outside `plans/`. The script provisions Postgres **after** creating the worktree and branch, so a
> port collision fails late and leaves partial state; `scripts/rm-worktree.sh <slug>` cleans it up.
>
> **And one harness limit worth knowing before you start.** `EnterWorktree` only manages worktrees
> under `.claude/worktrees/`, while this repo's convention puts them at `~/repos/pegasus-<slug>`. A
> worktree-isolated session therefore **cannot move into a worktree it provisions**. Either start the
> session in the worktree, or work on a branch in the one you are already in — which is fine for
> `packages/domain-reference`, since nothing in it needs Postgres. **The owed-closures round did
> exactly that** and it cost nothing.

**Read before writing anything:**

1. **§0 of this file** — where the model stands, and the near-empty "closable on effort alone" list
   that is why §1 is a synthesis round. Then **§1**, and note that it is a **SEED**: give it a
   planning pass before executing any of it.
2. `plans/completed/domain-reference-owed-closures.md` — the round that just landed, its
   plan-was-wrong findings, and the two lessons it adds to §4.
3. `plans/completed/domain-reference-cleanup.md` — the round before, and the origin of the
   gate-scoping lesson §3 item 19 generalises.
4. `docs/domain-reference/analysis/published-event-catalog.md` **§2.3** and **§2.3.1** — the change
   classes and the pre-1.0 version rule, if anything this round does reaches the wire.
5. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state of the model on one
   page, now carrying a reason per owed vocabulary and a per-group explanation with no counts in it.
