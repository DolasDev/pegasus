# Domain reference — the context map: plan and resumption state

**Written 2026-10-03, as the cleanup round landed**, to be read by a session with **no prior
context**. Everything needed to resume is here or is named by path. Read this whole file before
starting.

It replaces `plans/in-progress/domain-reference-cleanup.md`, whose record is
`plans/completed/domain-reference-cleanup.md`. The convention in this effort is that a finished round
leaves a **record** in `plans/completed/` and its **plan** is rewritten as the next round's, so do
not go looking for an archived copy of a superseded plan.

> **This plan is a SEED, not a finished design.** §1 below is carried forward from the cleanup
> round's §8, which carried it from A9's plan — it is the shape of the work and the traps around it,
> and it has never had a planning pass of its own. **Do that pass first**, and expect it to change
> the deliverable: §1 item 3 says the cheapest useful output may not be a document at all.

**All nine `v1 detail` areas are written, the unwritten-area phase is over, and the cleanup round has
paid down what those rounds found and did not fix.** What is left is synthesis, the command side, and
the items blocked on the user.

> **If you are picking up this effort cold, read §0 first.** It is where the model actually stands,
> measured rather than recalled, and it lists what is **closable on effort alone** — because the
> context map in §1 is the _planned_ next round and not the only thing available. §0 exists so the
> choice is informed; nothing in it has to be re-derived.

---

## 0. Where the model actually stands — measured 2026-10-03, and how to re-measure

**Every number here comes from a generated artifact or a command**, named beside it, because
`[A1 §9]`'s rule applies to this plan too. Re-measure rather than trusting this section if it is old.

### Coverage

| What                      | State                                         | Where it comes from                              |
| ------------------------- | --------------------------------------------- | ------------------------------------------------ |
| `v1 detail` areas written | **9 of 9** (A1–A9)                            | `docs/domain-reference/analysis/A*.md`           |
| A10–A13                   | **context-map-only by design** — not gaps     | `rubric.md`'s status column, which says so twice |
| Published record types    | **33**                                        | `catalog/index.json` → `members`                 |
| Catalog `specVersion`     | **0.6.1**                                     | `src/catalog.ts` → `CATALOG_VERSION`             |
| Corpus sources analysed   | **33 of 87** (19 more deliberately `skipped`) | `ls docs/domain-reference/sources/*/analysis.md` |
| Rounds landed             | **11**                                        | `ls plans/completed/ \| grep domain-reference`   |

A3 has an area document but **no round record of its own** — it was written inside the
research-corpus round (`34713637`), which is why `plans/completed/` has no `domain-reference-a3`.
That is not a gap.

### What the model declares owed — and it is NOT a backlog

`catalog/index.json`'s `owed.counts`, which is generated from `src/` and cannot go stale:

|                                                                 |                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Declared owed values                                            | **18**                                                 |
| Owed code vocabularies                                          | **3** — `roleClass`, `unitOfMeasure`, `identityScheme` |
| Record types whose authority row is owed                        | **14 of 31**                                           |
| Fact classes named in the corpus and absent from the vocabulary | **16**                                                 |
| Fact-class families the synthesis could not make                | **2**                                                  |
| `[SD §10.4]` explicitly-unsettled items still open              | **2 of 5**                                             |

> **Read this list the way §1 of the cleanup plan said to read it, because the distinction is the
> whole thing.** These are **not** to-do items. They are carried deliberately under `[SD §0]`
> because the corpus does not settle them, and most are blocked on **evidence that may not exist**
> rather than on effort. The clearest case is `identityScheme`: `[A9 §3.2]` read its sources and
> **refused to publish the vocabulary on the evidence** — five publishers ship an escape hatch
> beside a closed list and two warn against relying on it. That is a decision, and a round that
> reverses it must overturn an argument first. **Scoring "percent complete" against this inventory
> counts a refusal as a gap.**
>
> The wire now says which is which: every owed vocabulary carries `x-owed-state`
> (`pending` | `refusedOnEvidence`) and `x-owed-why`, and the glossary's Owed page groups them.

**Of the 14 owed authority rows** — the glossary's own breakdown, read it there for the current
split: **9 are blocked on the corpus** (no external source binds a plan change, a membership offer
or an assignment to an asserting role, and `[SD §4.7]` note 3 bars inventing one), **2 are owed to
A8 itself** (`partyRole`, `notification`), and **3 are the order lifecycle** — of which two are
blocked only on a missing `[A8 §4.3]` `boundBy` member, which `[A1 §Cross-area]` says A8 can take
today.

### What is closable on EFFORT ALONE — the short list, cheapest first

**This is the part worth having before choosing a round.** Everything else in the owed inventory is
waiting on evidence; these are not.

1. **`documentIssuance`** — the cheapest owed row in the model. `[A8 §5]` row 10's
   `boundBy = SCHEME` **already determines its holder**, so a row in `[SD §4.7.1]` and a row in
   `[A8 §5]` are _all_ that is owed, with nothing owed underneath either. `[A6 §3.3]` has the
   sourcing. **The only entry in `[SD §4.7.3]` whose blocker is minting alone.**
2. **`orderResponse` and `orderCancellation`'s authority rows** — blocked on one new `boundBy`
   member meaning _the role resolved by the order's own award_. `[A1 §Cross-area]` shows the corpus
   names a party on every order transition; `[A2 §3.6]`'s `shipmentCommitment` is a **fourth** thing
   waiting on the same member, so closing it discharges more than these two.
3. **`roleClass`** — **pending, not refused**: its sources exist and are unread
   (`src:uncefact-mmt-rdm` ships a 605-value `PartyRoleCode` list as a bare enumeration with no
   names). Reading them is work, not a decision to overturn.
4. **`src:nmfta-scac`** — a **fetch**, not a modelling question, and §5 carries it as a user ask.
   The issuing authority for SCAC, the corpus's widest-witnessed identity scheme, which six sources
   use and none defines.
5. **The context map** (§1) — synthesis over work already done. No new evidence needed, which is
   also why §1 warns it can restate the area documents and call that a deliverable.
6. **The command side and the aggregate lifecycles** — **not started at all.** The largest remaining
   piece and the least specified; it would need its own research pass before a plan.

### How to re-measure all of it

```
python3 -c "import json;d=json.load(open('docs/domain-reference/catalog/index.json'));print(d['owed']['counts'])"
ls docs/domain-reference/sources/*/analysis.md | wc -l      # analysed sources
grep -c '^- id:' docs/domain-reference/sources/registry.yaml # registry entries
```

The glossary's **Owed** section is the human-readable version and is generated from `src/`, so it is
the thing to read rather than any prose summary — including this one.

---

## 1. What this round is — carried forward unchanged from the cleanup round's §8

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

**Nearest models for shape:** `[A8]`'s skeleton — a document whose deliverable is a **table of what
is owed** rather than a set of decisions — and `[catalog]`, a contract **around** the vocabulary
rather than part of it.

After the context map, what remains is the command side, the aggregate lifecycles, `[A8]`'s ledger,
the owed vocabularies, and `[SD §10.4]`'s two bullets.

---

## 2. Current state

Every area document, the executable layer, the published catalog and the cleanup round are **merged
to `main`**. The per-round table is in `plans/completed/domain-reference-cleanup.md`; the short
version is that `docs/domain-reference/` holds the corpus, the thirteen-area rubric, the nine area
documents and the generated glossary, and `packages/domain-reference/` holds the executable
specification, the two generators and the conformance suite.

Catalog at `specVersion` **0.6.1**, bumped by the cleanup round under `[catalog §2.3.1]` — the rule
that pre-1.0 the **minor** slot carries breaking changes and the **patch** slot carries additive
ones, because that is what makes a caret range behave correctly unaided.

### Gates

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated · `prettier
--check` clean over **both** trees with **no exception** (the cleanup round's A1 removed the last
one — if an exception appears, it is yours).

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

Follow this order. **It applies to a cleanup round exactly as it applies to an area round**, and
items 6, 8, 10 and 14 are the ones a cleanup round is most tempted to skip.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum**. A
   JSDoc must not start with a bold marker, and **markdown emphasis must be `_x_`, never `*x*`**, or
   the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set**, and
   **put the cross-field invariants in the loader** — `[A9]`'s table refuses a party-grain row with
   no blocker and refuses an accountability claim that does not identify a document; both tampered.
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`, A7 added `repointedOwedOwner`),
   **or that no class applies because nothing published changed** (A2, A6, A9).
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered. A
   `RULES` entry may point at a **type** or a **constant**, not only a function.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.** A2 above is what happens when a round
   documents a gate it knows does not bite instead of fixing it.
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. After A1, there should be **no** exception to this — if one appears, it is yours.
8. **Read the emitted schema diff before classifying the change**, and read it as evidence rather
   than as a formality. A2's, A6's and A9's were empty and in A6's case the emptiness **was** the
   deliverable — **but A7's was not**, and the line that moved it was one no decision in the
   document put there (item 16).
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted**, and **prefer a gate that _enumerates_ over
    one that counts**; where a claim is a comparison rather than a total, **gate the comparison**, so
    it survives the data changing (`[A9]`'s `C6`-density gate).
    **And an ORDINAL is worse than a count: delete it, and name the things.** "The third routing
    column", "a fourth kind of blocker", "the second area to weight C4" — A7 had to correct one in
    three places and A9 shipped four documents counting one finding four different ways, one of them
    with a "fourth" that had no third. A count can be gated; an ordinal depends on which document is
    counting. **An ordinal resting on an _example_ rather than a record is the worst case** — A9's
    rested on `rubric.md`'s illustrative _"A8 weights C4/C6"_, which `[A8]` never recorded.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2). An `Exact` earns its place only between two things declared
    **independently**. A7's reason is worth reading: a `satisfies` clause checks **membership, not
    exhaustiveness**. **A9 adds the mirror discipline**: it deliberately left its own data table
    _out_ of the comparison, because putting it in would have asserted the closure it declines.
12. **Gate a recorded gap when the gap has an edge the types can see, and say why when it does not.**
    A6, A7 and A9 all ship both halves side by side.
13. **A refusal is not held by asserting the refused thing is absent from a list you wrote.** The
    house pattern is a `tests/conformance/*-refuses.ts` file whose `@ts-expect-error` directives go
    **unused** (`TS2578`) when the illegal state becomes legal. **Then tamper it.**
    **One mechanical trap inside it:** `@ts-expect-error` covers **one** line, so **name the value
    first and annotate the assignment**.
14. **If your decision narrows a sentence in `[SD]`, EDIT `[SD]`** — and the same courtesy applies to
    `[catalog]`, which A7 edited four times. **Before opening the PR, re-read your own §Cross-area
    list in BOTH directions**: A7 found four `[catalog]` edits with no section declaring them; A9
    found six edits it had **declared and not yet made**.
15. **When you insert into an existing paragraph, re-read the whole paragraph afterwards**, and
    **anchor a scripted replace on a whole paragraph rather than on a sentence inside one**. **Read
    the rendered diff of every prose file you touched** before opening the PR — and see §4's second
    lesson about _when_.
16. **An owed item's OWNER is part of the value, and the owner is auditable.** The house shape is
    **`Owner — reason`**; the owner names the area whose **subject** it is. **`owedTo` is emitted as
    a schema `const` on both faces**, so correcting one costs a version bump — `repointedOwedOwner`.
17. **`vitest` does not typecheck, and a test that passes can still be a type error.** A9 shipped a
    green new test file with six `strictNullChecks` errors in it. Run `npm run typecheck` after
    **every** test edit.
18. **When a finding looks like your area's, measure whether it is systemic first.** A9's first
    instinct was to repair fourteen registry entries; measuring showed the gap in all thirteen areas,
    which turned a fix into a documentation change — and is why B1 above is a decision rather than a
    task.

---

## 4. The procedural lessons, which are A6's, A7's, A9's and the cleanup round's

A6's: **a round is not done when the suite is green.** It is done when every refusal is held by
something that can fail and every consequence claimed for another document has been written into it.

A7's, one level out: **the suite says nothing about prose, and prose is where the counts, the
superlatives and the conventions live.** Budget a deliberate read-the-diff-and-recount pass.

A9's, which is A7's lesson tested and found insufficient: **budgeting the pass is not the same as the
pass working.** A9 ran it, found four defects in a round that had read A7's warning about exactly
those shapes — and then **ran it again after the cross-area edits and found four more**, including an
ordinal it had already corrected once. Two consequences:

- **The review pass must run after the LAST prose is written**, and the last prose a round writes is
  always the part that edits other people's documents. Bracket the cross-area pass; do not precede
  it.
- **A superlative is usually a comparison you have not made yet, and an ordinal is usually a count
  someone else is keeping differently.**

**A cleanup round is more exposed to all three, not less.** It touches many files shallowly, its
changes are individually obvious, and "obvious" is the condition under which nobody re-reads.

> **The cleanup round adds a fourth, and it is about plans rather than prose.** Four of its seven
> planned items carried something the plan had wrong or did not predict — a prescription that covered
> six of sixteen cases, a gate designed the wrong way round, a defect nobody had recorded, and a
> tautology. **A plan is a claim to audit, not a specification to execute.** Its record's
> "What the round found that its own plan did not know" has the four.

---

## 5. What is blocked on the user — ask these, do not schedule them

Each is one line. **None of them blocks the round starting** — B1, the one that did, is answered.

0. **B1 — ANSWERED, 2026-09-30: recompute and gate, and DONE 2026-10-03.** Left here as the
   record of the ask; `plans/completed/domain-reference-cleanup.md` carries what the hybrid turned
   out to be.
1. **C1 — `src:nmfta-scac`.** Worth obtaining? It is the issuing authority for SCAC, which six
   sources use and none defines. `registry.yaml`'s `obtain:` field says what is needed.
2. **C2 — what a signature asserts.** `[A6 §6]` owes this to the user explicitly; no source in the
   corpus publishes it.
3. **C4 — the two prose-alias divergences** need a decision from `[SD §4.7]` note 5, which is the
   binding layer's and not the package's.
4. **The `needs-user` backlog is not a backlog anyone is working.** Worth knowing rather than acting
   on; the number is in `registry.yaml` and this plan deliberately does not restate it (§3 item 10).

> **B1 is answered and done** — the registry's `areas:` is generated for every source with a score
> table and gated per source; the hand-written hint stays for the rest. The entry below is kept as
> the record of the ask. Everything else in this section is still open, and **Group C of the cleanup
> round joins it**: `src:nmfta-scac` has never been fetched and is the issuing authority for SCAC,
> the corpus's widest-witnessed identity scheme; what a signature asserts is unpublished and
> `[A6 §6]` owes it to the user; `[SD §4.7]` note 5's two prose-alias divergences need a decision from
> the binding layer; `ExternallyPerformedLeg.performedBy` has no consumer (F4);
> `OffsettingRecord.offsets` says nothing about whether the two assertions share a subject; and the
> requestor of a **completed** cancellation has no field (`[A1 §3.5]`).

---

## 6. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red. A5 shipped a compile-time
  assertion that did nothing; A2 shipped one that could never fail even though it was assigned;
  **A6 found a gate that passes a half-tamper, A7 reproduced it, and the cleanup round finally
  fixed it** — and the fix needed three declaration shapes where the plan predicted one, plus an
  exactly-once rule, because scoping alone only moves masking somewhere smaller. A9 adds a third form: a gate that reads a **position** in a table it does not own (a column
  index), silently wrong if the table is reshaped. Tamper the index.
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §3 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §3
  item 13. And beware the reverse: an `expect(x).toBe(x)` written as a diagnostic label is a no-op.
- **Re-read your own §Cross-area list before opening the PR** — §3 item 14, in **both** directions.
- **Read the rendered diff of every prose file you touched, and re-count every count.** §3 items 10
  and 15. **No gate in this package reads prose for sense.**
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title,
  **or a comment inside a passing assertion** naming your own area is a to-do item.
- **Check whether the source captures exist before planning to quote primary text**; **evidence grade
  is not the same as having a capture**; and **a capture is not the same as a definition** —
  `src:milmove-mymove`'s `serviceOrderNumber` is captured and is a bare nullable string with no
  description. `ls -d docs/domain-reference/sources/*/captured` is the check.
- **A gate's own comment can tell you it is due to be inverted.** `source-registry.test.ts`'s
  `[A9 §1]` block gated the sharp instance of A9's finding and said in as many words that a later
  curation pass should make it fail and send the reader back to amend the claim. The cleanup round
  was that pass; the assertion is **inverted rather than deleted** and `[A9 §1]` is amended. **Read
  the existing tests for what you are about to change** — one of them may be waiting for you.
- **`sources/registry.yaml`'s `areas:` field is now TWO HALVES**, and the registry's own schema
  comment states both. For a source with a score table it is **generated** — exactly the areas that
  analysis scores non-zero — and a conformance test holds it there per source. For an entry with no
  analysis it is still the hand-written discovery hint `[A9 §1]` describes, and empty is legitimate
  for a `skipped` one. The split is on the presence of a score table and **never** on `status:`.
  `tools/source-registry.ts` is the one reader; import it rather than writing a second parser.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  **both generators** — `generate-glossary.ts` and `generate-catalog.ts` — hold literal NULs, and
  `tests/conformance/documents.test.ts` did until this round's A2 removed it. The old claim here and
  in `GOTCHAS.md` named one file, gave a count and said it was fixed; measured 2026-10-03, no part of
  that held. `GOTCHAS.md` now names the files and carries the one-line re-measure command instead of
  a number. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** In `dolas/agents/project/GOTCHAS.md`.
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
  unqualified `` `type: X` `` span is read the same way**, which is how A9's prose about an OpenAPI
  field tripped it. In `GOTCHAS.md`.
- **The published schema is not the same as the data table** — A6's D-ID and A9's scheme table both
  cost no bump because a `data/` list is documentation, not a published constraint. **But the reverse
  also happens**: A7 found `owedTo` emitted as a `const`, and the cleanup round found that `x-owed`
  reached the `OwedCode` vocabularies and not the `Owed` value branches. **Check the emitted schema
  both ways**, and read the diff before classifying — it is the rule that has changed an answer
  every time it has been followed.

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

## 8. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='dr-context-map'; print(5433 + sum(ord(c) for c in s) % 60)"   # derive the DB port
ss -ltn | grep -E ':(54[3-9][0-9])'                                          # …against what is listening
scripts/workstream-start.sh chore dr-context-map plans/in-progress/domain-reference-context-map.md
```

> **Derive the port, do not trust a number written here.** A9's plan wrote a guessed port and was
> wrong by fifty-one; the derivation is two seconds and the guess is worthless. A different slug
> derives a different port, so do not "improve" the slug without recomputing.

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
> `packages/domain-reference`, since nothing in it needs Postgres.

**Read before writing anything:**

1. **§0 of this file** — where the model stands and what is closable on effort alone, so the
   choice of round is informed. Then **§1**, and then `rubric.md` — the term "context map" does two
   jobs there and conflating them will produce neither.
2. `plans/completed/domain-reference-cleanup.md` — the round that just landed, its four
   plan-was-wrong findings, and its transferable lessons.
3. `plans/completed/domain-reference-a9-identity.md` — the last area round, and the source of §1's
   strongest argument (`[A9 §3.6]`'s party with no aggregate).
4. `docs/domain-reference/analysis/published-event-catalog.md` **§2.3** and **§2.3.1** — the change
   classes and the pre-1.0 version rule, if anything this round does reaches the wire.
5. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state of the model on one
   page, now carrying a reason per owed vocabulary.
