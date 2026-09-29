# Domain reference — the context map, and what is left: plan and resumption state

**Written 2026-09-29, after A9 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a9.md`, which was **deleted** in the A9 PR,
not archived — that round's record is `plans/completed/domain-reference-a9-identity.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

**Eight deliverables have landed, and the unwritten-area phase is over.** Read their records first;
each is short and each carries findings worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary, and the first
  `publishedOwedVocabulary`.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. Its count of twelve
  corpus-blocked rows is the count **as at that round**; every area since has moved it.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — the `boundBy` gap, and the rule that a
  count in prose is gated or deleted.
- `plans/completed/domain-reference-a5-storage-in-transit.md` — the physical-vs-administrative
  discriminator on authority rows, which A6 then found does not generalise.
- `plans/completed/domain-reference-a2-shipment.md` — the `Exact<>`-is-a-tautology finding. **Read
  it knowing A7 overturned its billable-weight placement** on binding text A2 did not check.
- `plans/completed/domain-reference-a6-documents.md` — three shipped defects, all of one shape.
- `plans/completed/domain-reference-a7-charges.md` — the round whose **audit** moved the version
  when its decisions moved nothing, because `owedTo` is emitted as a schema `const`.
- `plans/completed/domain-reference-a9-identity.md` — **the most recent, and the one this plan is
  the sequel to.** It is the first round to **refuse** to publish an owed vocabulary on the
  evidence, and its four drafting defects are the sharpest instance yet of the read-and-recount
  pass earning its place.

**Next deliverable:** the **context map** — the first of the three missing pieces of the old
`model/` layer. §6 says what it is and why it is the cheapest thing left.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.6.0**, carries
**two projections** (`custodyAt`, `orderStageAt`) and **five named rules that are neither**
(`shipmentContinuity`, A6's `documentIdentitySubject` and `CITATION_CLAIMS_NOTHING`, A7's
`A-COLLECT`, and A9's `I-ACCOUNT`). **Eight of the nine v1 detail areas now have a full area
document and the ninth, A4, has a vocabulary-only one** — `rubric.md`'s note is current — so what
remains is the ledger, the owed vocabularies, and the old `model/` layer (§5).

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                                        | Landed              |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                                                     | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                                                 | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`                          | `a4b0bd7f`, PR #713 |
| A4 reason vocabulary                   | `analysis/A4-execution-events.md` + `src/outcomes.ts`                        | `20971ebe`, PR #716 |
| A8 §5 rows 12-16, closing F3 and F5    | `analysis/A8-authority-skeleton.md`                                          | `984200cd`, PR #717 |
| A1, the order & service lifecycle      | `analysis/A1-order-service-lifecycle.md` + `src/rules/order-stage.ts`        | `1b9e5df3`, PR #719 |
| A5, storage-in-transit                 | `analysis/A5-storage-in-transit.md` + `OpensStay` in `src/outcomes.ts`       | `d4fb4c3f`, PR #723 |
| A2, shipment structure                 | `analysis/A2-shipment-structure.md` + `src/rules/shipment-continuity.ts`     | `4dbd3b17`, PR #724 |
| A6, documents & evidence               | `analysis/A6-documents-evidence.md` + `src/rules/documents.ts`               | `a614b016`, PR #725 |
| ↳ A6 follow-ups                        | `rubric.md` paragraph repair                                                 | `a3b84942`, PR #727 |
| A7, charges & billing hooks            | `analysis/A7-charges-billing.md` + `src/rules/charges.ts`                    | `c72cfcce`, PR #737 |
| A9, identity & cross-references        | `analysis/A9-identity-cross-references.md` + `src/rules/identity-schemes.ts` | _this round_        |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`.

### Gates, all green

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

**No count is written here on purpose** — §4 item 10 is the rule. The commands below produce it in
about five seconds.

```
npm run test      -w @pegasus/domain-reference
npm run lint      -w @pegasus/domain-reference
npm run typecheck -w @pegasus/domain-reference
npm run alloy     -w @pegasus/domain-reference
npm run glossary  -w @pegasus/domain-reference
npm run catalog   -w @pegasus/domain-reference
```

### What is READY to use as a reference

Settled, executable, and gated. Safe to design against today:

- **The envelope and the single classification axis** — `[SD §1.1]`, `[SD §1.3]`. Model-checked.
- **The 33-member record vocabulary**, published as JSON Schema for both faces.
- **The 24-member reason vocabulary** — `[A4 §3]` plus `DEADLINE_LAPSED` at `[A1 §3.6]`.
- **Both remedy shapes** — `newWindow` (`[A4 §3]`) and `opensStay` (`[A5 §3.2]`).
- **Two projections**: `custodyAt` (`[SD §4.8]`) and `orderStageAt` (`[A1 §3.3]`).
- **Five rules that are neither** — `shipmentContinuity` / **B-ONWARD** (`[A2 §3.2]`), A6's **D-ID**
  and **D-CITE**, A7's **A-COLLECT** (`[A7 §3.7]`) and A9's **I-ACCOUNT** (`[A9 §3.4]`). All five
  take a discriminant as an input or are a semantics decision, because nothing publishes one.
- **The identifier shape and I-KEY** (`[SD §7]`), now with A9's **witnessed-scheme table** behind it.
- **The shipment boundary across an interruption**, **the storage stay**, **what a charge is and who
  may say it**, and **which identity schemes the corpus actually witnesses**, all closed.
- **What `evidence[]` means** — a pointer, never a claim (`[A6 §3.5]`).
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion, correction
  semantics, the identity key, the capture rules M1–M7, and `[A8 §8]`'s `Instrument`.
- **All nine v1 detail areas written**: A1, A2, A3, A5, A6, A7, A8, A9, and A4 (**vocabulary only** —
  its own scope note says so).

### What is NOT ready

1. **The old `model/` layer is missing three pieces**: the context map, the command side, the
   aggregate lifecycles. **This is now the largest single gap** and §6 takes the first of them.
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — see §5.
3. **Three owed code vocabularies**: `roleClass`, `unitOfMeasure`, `identityScheme` — and **all
   three now have a reason on record.** A9's is the different one: refused on the evidence rather
   than pending (`[A9 §3.2]`). `[A9 §6]` item 1 records that the Owed page cannot tell the two kinds
   apart, which is a real defect in that page and is nobody's yet.
4. **F4 open** in `analysis/findings-from-alloy.md`; 18 declared owed values; 16 fact classes the
   corpus names that the vocabulary does not carry.
5. **`[SD §10.4]` is down to two open bullets** — the directional stop-type pairs (A3's) and custody
   authority's owner (A8's).
6. **A1's one open defect stands**: the requestor of a **completed** cancellation has no field.
   `[A1 §3.5]`, `[A1 §6]`.
7. **A6's defect stands**: no source publishes what a **signature asserts**. `[A6 §3.3(b)]`,
   `[A6 §6]` — owed to the **user** and to A10.
8. **A7's silence stands**: nothing says whether an `OffsettingRecord` may **cross subjects**, and
   `src:dp3-tender-of-service` NTS §5.8.2 publishes the cross-subject set-off. `[A7 §3.8]`,
   `[A7 §6]`.
9. **A9's cheapest open item is a fetch, not a modelling question**: `src:nmfta-scac` — the only
   registry entry whose `areas:` is `[A9]` alone, and SCAC's issuing authority — is
   `status: candidate` and has never been obtained. Six sources use the code and none defines it.
10. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence — **check `role:` in the registry
   per source rather than trusting a list**, in both directions: A7 found a plan calling an external
   contract one of ours, and A9's own scope trap was the reverse (`round-1-crosscheck.md` §A9 names
   `src:pegasus-integration-floors` among A9's strong sources, and it is `mapping-only`).
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**.
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use.
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess — **and
   the owner is part of the value.** A7 found one owed to the wrong area entirely (§4 item 16).
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the
   area documents `[A1]`, `[A2]`, `[A4]`, `[A5]`, `[A6]`, `[A7]`, `[A9]`, `[A3]`, the forks. Then
   `[catalog]`.

---

## 4. Landing a change — the recipe A4, A8, A1, A5, A2, A6, A7 and A9 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum**. A
   JSDoc must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or
   the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set**, and
   **put the cross-field invariants in the loader** — A9's table refuses a party-grain row with no
   blocker and refuses an accountability claim that does not identify a document, and both were
   tampered.
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`),
   **or that no class applies because nothing published changed** (A2, A6, and now A9).
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered. A
   `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — verify that
   with `git show main:` and `git diff main --stat` rather than assuming it.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather
   than as a formality. A2's, A6's and A9's were empty and in A6's case the emptiness **was** the
   deliverable — **but A7's was not**, and the line that moved it was one no decision in the
   document put there (item 16).
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**. A7 is the warning; **A9 is the warning repeated after it was read** — it
    shipped "six party-grain rows" into three files where the table holds five, and "two DoD sources
    supplying ten of twenty rows" where the answer is three and nine. **Count the table, then gate
    the count** — and where a claim is a comparison rather than a total, **gate the comparison**, so
    it survives the data changing (A9's `C6`-density gate).
    **And an ORDINAL is worse than a count: delete it, and name the things.** "The third routing
    column", "a fourth kind of blocker", "the second area to weight C4" — A7 had to correct one in
    three places and A9 shipped four documents counting the same finding four different ways, one of
    them with a "fourth" that had no third. A count can be gated; an ordinal depends on which
    document is counting, and §5 says so about the ledger specifically. An ordinal that rests on an
    **example** rather than a record is the worst case — A9's rested on `rubric.md`'s illustrative
    _"A8 weights C4/C6"_, which [A8] never recorded.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**. A7's reason is worth reading: a `satisfies` clause checks **membership, not
    exhaustiveness**, so a data table that `satisfies` a type built from the thing under test is not
    a second declaration. **A9 adds the mirror discipline**: it deliberately left its own data table
    _out_ of the comparison, because putting it in would have asserted the closure the document
    declines.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6, A7 and A9 all ship both halves side by side.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The
    house pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go
    **unused** (`TS2578`) when the illegal state becomes legal. **Then tamper it.** And check the
    file is actually in the typecheck — a tamper that reports `TS2578` proves it.
    **One mechanical trap inside it:** `@ts-expect-error` covers **one** line, so **name the value
    first and annotate the assignment**.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`, which A7 edited four times. **Before opening the PR, re-read your own
    §Cross-area list and check each item was actually written into the target document.** A7 found
    it had made four `[catalog]` edits with no section declaring them; A9 found it had **declared
    six edits it had not yet made**, which is the same defect from the other end.
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read
    the rendered diff of every prose file you touched** before opening the PR.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** A7 found `chargeValue`
    owed to **A11**, a claims area, when the value of a charge is not a claim. Two consequences:
    - The house shape of an `owedTo` is **`Owner — reason`**, and the owner names the area whose
      **subject** it is, not the area that will publish it next.
    - **`owedTo` is emitted as a schema `const` on both faces**, so correcting one is a published
      change and costs a version bump. `repointedOwedOwner` at `[catalog §2.3]` is the class.
17. **`vitest` does not typecheck, and a test that passes can still be a type error.** A9 shipped a
    green new test file with six `strictNullChecks` errors in it. Run `npm run typecheck` after
    **every** test edit, not at the end.
18. **When a finding looks like your area's, measure whether it is systemic first.** A9's first
    instinct was to repair fourteen registry entries; measuring showed the same gap in all thirteen
    areas, which turned a fix into a **documentation** change and stopped a half-repair that would
    have made a discovery hint look like an inventory.

---

## 5. The authority rows — the ledger's shape, as six areas have left it

Read `[A7 §3.2]`, `[A6 §Cross-area]` to [A8], `[A9 §3.6]` and `[A8 §9 item 8]` **(a)–(e)** together.
Six areas have now looked at the ledger and between them they have sorted it into these kinds of
blocker. **Do not write an ordinal into a document** — A7 had to correct exactly that phrasing in
three places, because the glossary, `[A8 §9 item 8]` and this file each count differently. Name the
blocker, not its position.

- **Blocked on nothing but minting** — `documentIssuance` (A6). `[A8 §5]` row 10's
  `boundBy = SCHEME` already determines its holder. Still the cheapest move in the model.
- **Blocked on a missing `boundBy` _enum member_ — a schema decision A8 can take today.**
  `orderResponse` and `orderCancellation` (A1), and `shipmentCommitment` (A2). All three want the
  same member: _the role resolved by the order's own award_. Four things wait on it.
- **Blocked on a missing _party entity_ — `[A8 §9 item 1]`.** `partyRole` (§9 items 1-2),
  `notification` (§9 item 6), A5's three storage classes — **and, since A9, five identity schemes
  that cannot be asserted at all.** A9 gives the item a second, independent reason to be minted:
  those identifiers are not only fields the entity would carry, they are assertions with no
  `subject`. **This is now the most-blocked item in the model** and it is a schema decision plus a
  corpus gap rather than a pure corpus gap.
- **Blocked on a missing _subject_ — A7's, and it never reaches the ledger at all.**
  `chargeCollection`: `[SD §1.2]` has no `invoice` and no `payment` aggregate. The model's other
  instances are `placeRef` and, since A9, **the subject of an acceptance** (`[A9 §6]` item 3) — so
  there are now three, which is worth someone taking as a question of its own.
- **Blocked on the corpus.** The nine plan-, membership- and assignment-side rows; `src:dcsa`'s JIT
  `classifierCode` is where to look first (A1). Plus `orderAward`.

### The three procedural lessons, which are A6's, A7's and A9's

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, one level out: **the suite says nothing about prose, and prose is where the counts, the
superlatives and the conventions live.** Budget a deliberate read-the-diff-and-recount pass.

A9's, which is A7's lesson tested and found insufficient: **budgeting the pass is not the same as
the pass working.** A9 ran it, found four defects in a round that had read A7's warning about
exactly those shapes — and then **ran it again after the cross-area edits and found four more**,
including an ordinal it had already corrected once. Two consequences:

- **The review pass must run after the LAST prose is written**, and the last prose a round writes is
  always the part that edits other people's documents. Bracket the cross-area pass; do not precede
  it.
- **A superlative is usually a comparison you have not made yet, and an ordinal is usually a count
  someone else is keeping differently.** Both of A9's surviving superlatives became better sentences
  once replaced by the comparison they stood in for; every ordinal it wrote was **deleted** rather
  than corrected, because four documents were counting the same finding four ways. §4 item 10 now
  says: **delete the ordinal, name the things.**

### Three pieces of the old `model/` layer are still missing

The context map, the command side, the aggregate lifecycles. **§6 takes the context map.**

---

## 6. THE NEXT DELIVERABLE — the context map

**With A9 landed there is no unwritten v1 area left, so the shape of the work changes.** Every round
since A4 has been: pick an area, audit what is owed to it, read its sources, decide, gate, record.
The context map is not that. It is a **synthesis over work already done**, and its risk is the
opposite of an area's: an area round risks claiming more than its sources say, and this one risks
**restating** what nine documents already say and calling it a deliverable.

1. **Read `[A9 §1]` first and run its audit on this plan.** Five rounds running have found their own
   plan wrong about what was owed, and this plan is written by the round that found four defects in
   its own prose. **Assume it contains some.** In particular: this section is written without having
   read the old `model/` layer's remains, so check what actually exists before trusting the phrase
   "three missing pieces".
2. **Find what the context map is supposed to be.** The phrase comes from the original structure and
   is used in `rubric.md` (`A10`–`A13` are _"context-map-only by design"_) and in the earlier plans.
   **Grep for it before designing one** — `/usr/bin/grep -rn -a 'context map' docs/domain-reference
plans` — because the term is doing two jobs: a DDD-style map of bounded contexts and their
   relationships, and the rubric's marker for an area that gets a sketch rather than a decision
   document. **They are not the same thing and the plan that conflates them will produce neither.**
3. **The strongest reason to do it now, and it is A9's finding.** `[A9 §3.6]` and `[A8 §9 item 1]`
   between them show the model has a **party** that is an identifier with no aggregate, referenced by
   `assertedBy`, by `vocabularyScope.authority`, by `issuer` and by five witnessed identity schemes.
   That is exactly the kind of cross-cutting fact a context map exists to make visible, and it is
   currently discoverable only by reading four documents. **Start from the things that appear in
   more than one area**: the party, the Portion, `evidence[]`, the identity key, custody, and the
   fourteen owed authority rows.
4. **The cheapest useful output may not be a document.** Every generated artefact in this package is
   built from `src/` through the TypeScript compiler API, and `tools/generate-glossary.ts` already
   knows every document, rule, vocabulary and owed value. **A generated context map would be gated
   by construction**, where a hand-written one joins the prose nothing checks (§5's second lesson).
   Consider it before writing prose — and note that A6's and A9's findings both say the same thing
   about `data/` tables: they are documentation unless a generator reads them.
5. **Watch for this specific trap.** A10–A13 are **context-map-only by design and are not gaps**
   (`rubric.md` says so twice). A context-map round must not turn into four thin area documents.
   If the map wants something A10 owes, the map records the debt; it does not discharge it.

**Pattern to follow:** there is no close model for this one, which is itself worth noticing. The
nearest are `[A8]`'s skeleton — a document whose deliverable is a **table of what is owed** rather
than a set of decisions — and `[catalog]`, which is a contract **around** the vocabulary rather than
part of it. Read both for shape before starting.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red. A5 shipped a compile-time
  assertion that did nothing; A2 shipped one that could never fail even though it was assigned; A6's
  tamper of a documentation gate revealed it passes a **half-tamper**, because it is a substring
  search over a section rather than over the bullet it looks like it checks — **A7 re-tested that and
  reproduced it exactly**. **A9 adds the third form**: a gate that reads a **position** in a table it
  does not own (a column index), which is silently wrong if the table is reshaped — tamper the index.
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §4 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §4
  item 13. And beware the reverse: an `expect(x).toBe(x)` written as a diagnostic label is a no-op.
- **Re-read your own §Cross-area list before opening the PR** — §4 item 14, in **both** directions:
  edits you made and did not declare, and edits you declared and did not make.
- **Read the rendered diff of every prose file you touched, and re-count every count.** §4 items 10
  and 15. **No gate in this package reads prose for sense.**
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title,
  **or a comment inside a passing assertion** naming your own area is a to-do item.
- **Check whether the source captures exist before planning to quote primary text**, and note that
  **evidence grade is not the same as having a capture** — and, since A9, that **a capture is not
  the same as a definition**: `src:milmove-mymove`'s `serviceOrderNumber` is captured, and is a bare
  nullable string with no description. `ls -d docs/domain-reference/sources/*/captured` is the check.
- **`sources/registry.yaml`'s `areas:` field is a discovery hint, not an inventory** (`[A9 §1]`, and
  the registry's own schema comment now says so). To find which sources bear on an area, read the
  per-area score rows in `sources/*/analysis.md`.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` and `tests/conformance/documents.test.ts` both hold literal NULs. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** Recorded in
  `dolas/agents/project/GOTCHAS.md`.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit — §4 item 17.
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
  unqualified `` `type: X` `` span is read the same way**, which is how A9's prose about an OpenAPI
  field tripped it. To make a `[yourdoc §x]` citation link, add it to `DOCUMENTS`.
- **The published schema is not the same as the data table** — A6's D-ID and A9's scheme table both
  cost no bump because a `data/` list is documentation, not a published constraint. **But the reverse
  also happens**: A7 found `owedTo` emitted as a `const`. **Check the emitted schema both ways.**

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

## 8. Housekeeping left over

- **After the context map**, what remains is `[A8]`'s ledger (§5), the command side and the aggregate
  lifecycles, the three owed vocabularies, and `[SD §10.4]`'s two bullets.
- **One cheap, non-modelling item**: `src:nmfta-scac` is `status: candidate` and is the issuing
  authority's own material for the corpus's best-witnessed identity scheme (`[A9 §6]` item 2). It is
  a fetch.
- **The Owed page cannot distinguish "unread sources" from "read sources that disagree with
  closing"** (`[A9 §6]` item 1). That is a defect in a generated page and is nobody's yet.
- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end —
  `pre-in-progress-forbids-pack-actual` combined with Weichert's real load-actual requirement leaves
  no valid status for a shipment packed but not yet loaded. Live in GLOBAL and the `nw` tenant.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='context-map'; print(5433 + sum(ord(c) for c in s) % 60)"   # → 5489
ss -ltn | grep -E ':(54[3-9][0-9])'                                        # …against what is listening
scripts/workstream-start.sh feat context-map plans/in-progress/domain-reference-context-map.md
```

> **`context-map` derives port 5489, and it was free when this plan was written** — five other
> worktree databases were listening and none of them on it, though one was on **5486**, which is
> A9's own and will be gone by the time you read this. **Re-run both commands anyway**: the point of
> the check is what is listening _now_, and this note is a convenience rather than a substitute.
> (The first draft of this line guessed 5438 and was wrong by fifty-one; the derivation is cheap and
> the guess is worthless.)

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that worked six times: write the new
> record at `plans/completed/domain-reference-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file
> — **and update `rubric.md`'s link to this plan**, which is the one cross-reference to it outside
> `plans/`. And the script provisions Postgres **after** creating the worktree and branch, so a port
> collision fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a9-identity.md` — the most recent, the source of §4 items
   **10 (the comparison half), 17 and 18**, and §5's third procedural lesson. **Its "four drafting
   defects" section is the one to read twice**: it was written by a round that had read A7's warning
   about those exact shapes and shipped them anyway until the pass caught them.
2. `plans/completed/domain-reference-a7-charges.md` — the source of §4 items **14, 15 and 16** and
   of the `owedTo`-is-a-`const` finding.
3. `docs/domain-reference/analysis/A9-identity-cross-references.md` — §1 for the audit, §3.2 for a
   refusal argued from **agreement** rather than disagreement (a shape this effort had not used
   before), and §3.6 for the party-grain finding the context map should start from.
4. `docs/domain-reference/analysis/A8-authority-skeleton.md` — **§9** is the owed ledger and is the
   nearest thing to a context map the effort already has.
5. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
6. `docs/domain-reference/rubric.md` — and note that its `v1 detail` and `Covers` columns, and the
   registry's `areas:` field, are all prompts rather than inventories (`[A9 §3.8]`, `[A9 §1]`).
7. `docs/domain-reference/analysis/00-shared-decisions.md` **§1.2** (the fourteen aggregate kinds,
   and what is deliberately not among them) and **§10.4**.
