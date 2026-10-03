# Domain reference — the cleanup round: plan and resumption state

**Written 2026-09-29, after A9 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a9.md`, which was **deleted** in the A9 PR,
not archived — that round's record is `plans/completed/domain-reference-a9-identity.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

> **Why this round exists, and it is not the one A9 planned.** A9's plan named the **context map** as
> the natural next deliverable. The user's instruction on 2026-09-29, after reading A9's summary,
> was: _"i want this done right. If that means going back and fixing things in cleanup jobs then
> lets do it. Update the plan so that next up we are fixing any of the issues found before
> proceeding."_ So the context map moves behind this round, and §8 carries it forward unchanged.

**All nine `v1 detail` areas are written and the unwritten-area phase is over.** What this round does
is pay down what those rounds **found, recorded and did not fix**.

---

## 1. The distinction this whole plan rests on — read this before anything else

**There are two lists, they look alike on a page, and only one of them is this round's business.**

### The model's OWED items are the work, not defects

`docs/domain-reference/glossary.md`'s **Owed** section — 18 declared owed values, 14 record types
with an owed authority row, 3 owed code vocabularies, 16 fact classes named in the corpus and absent
from the vocabulary, `[SD §10.4]`'s two open bullets. **Every one of these is the honest state of
the model**, carried deliberately under `[SD §0]` because the corpus does not settle them. Most are
**blocked on the corpus**, not on effort.

**Do not treat any of them as a cleanup item.** Closing `roleClass` because it is on a list would be
exactly the guess `[SD §0]` forbids. They are closed by an area round with sources in hand, or they
stay open and say why. `identityScheme` is the model case: `[A9 §3.2]` looked at its own owed
vocabulary, read the sources, and **left it owed on the evidence**.

### The DEFECTS are this round's business

Things a round **found, recorded, and left** — a gate that does not bite, a generated page that
cannot say what it means, a file that fails a check every round works around. They are enumerated in
§3 and **none is a modelling question**.

> **One sentence for whoever reads this next:** if closing it needs a source, it is not a cleanup
> item. If closing it needs an afternoon and a tamper, it is.

---

## 2. Current state — all merged to `main` (plus this round's own branch)

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
| A9, identity & cross-references        | `analysis/A9-identity-cross-references.md` + `src/rules/identity-schemes.ts` | `5db81c74`, PR #746 |
| ↳ this round, A1 + A2                  | `alloy/run.mjs` formatted; `tests/conformance/documents.test.ts` rescoped    | this round's PR     |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`. Catalog at `specVersion`
**0.6.0**.

### Gates

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

**No count is written here on purpose** — §5 item 10 is the rule. The commands produce it in about
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

## 3. THE DELIVERABLE — the defects, in three groups

**Group A (four items) and Group B (three) are this round's deliverable. Group C (six) is blocked on
someone outside it and is listed so the round does not rediscover them.** No ordinal is attached to
any item's discovery order, per §5 item 10 — where it came from is named instead.

**Verify each one still exists before fixing it.** Every item below was confirmed on 2026-09-29 at
the paths given, but a plan that says a defect exists is a claim like any other — `[A9 §1]` is the
fifth round to find its own plan wrong about what was owed, and this plan is written by that round.

### Group A — mechanical, no judgement needed, fixable today

> **A1 and A2 are DONE** (`a68038f3`, `a7bad124`). A3 and A4 remain, and §4 item 4 still wants
> them classified together with B2. The two struck items are kept below with what was found, because
> both turned out to carry something the plan did not predict.

**A1. ~~`packages/domain-reference/alloy/run.mjs` fails `npx prettier --check`.~~ DONE, `a68038f3`.**
Verified still failing on a clean checkout before fixing. `prettier --write`, then `npm run alloy`
to prove the runner still works (it does — every command matched its expectation). `npx prettier
--check docs/domain-reference packages/domain-reference` is now clean with **no exception**, which
is what §5 item 7 already anticipated. The one sentence that had to be edited rather than left
standing is in `GOTCHAS.md` — the parenthetical telling the next reader that `run.mjs` "fails it on
`main` already — pre-existing".
_The entry as the plan wrote it, kept as the record:_ It had failed on the default branch for at
least four rounds. Every round since A7 verified it was pre-existing (`git show main:`,
`git diff main --stat`) and worked around it in its own verification notes. One command fixed it,
and it removes a permanent asterisk from every future round's "prettier clean except…" sentence.

**A2. ~~The `[SD §4.7.3]` documentation gate passes a half-tamper.~~ DONE, `a7bad124`.**
Reproduced first: renaming `chargeCollection`'s declaring item to `chargeCollectionXX` left all 14
tests in the file passing. **Five of the sixteen entries were maskable** — `survey`, `weighing`,
`unpacking`, `documentIssuance`, `chargeCollection` — the other eleven are named once and were never
at risk. The check is now scoped to each class's **declaration unit**, of which §4.7.3 has **three**
kinds (a list item of its own; the one disclosure paragraph for the eight prose classes; the leading
bold run of the act-types paragraph, because the prose after it names `weighing` again), split at
list-**item** granularity so `[A5 §3.6]`'s three classes cannot hide behind each other. The phrase
must also appear **exactly once** in its unit, which is what closes masking rather than moving it
somewhere smaller. Tampered three ways and watched to fail: rename the declaring item (fails,
passed before), rename both mentions (fails), duplicate the phrase in the unit (fails on
exactly-once). **Side effect worth knowing:** the file's only NUL byte was the `phrase ?? '\0'`
sentinel in the old assertion, so removing it un-breaks plain `grep` on that file — see §9.
_The entry as the plan wrote it, kept as the record_ — note the line reference was already
drifting and the rewritten gate has moved it again, so find the assertion by name rather than by
number. `packages/domain-reference/tests/conformance/documents.test.ts`, formerly at line 487:

```ts
expect(section.includes(phrase ?? ' '), ...).toBe(true)
```

`section` is the **whole of `[SD §4.7.3]`**, not the bullet the assertion appears to check. So a
member named twice in that section survives having one mention renamed, and the gate reports green.
**Found by [A6 §9], reproduced by [A7 §9] as a deliberate re-test, and never fixed** — three rounds
had documented a gate they knew did not bite. The plan's prescription was to scope the check to the
bullet that declares the member and tamper it both ways. **That was right about the tamper and
incomplete about the scope:** only six of the sixteen entries have a declaring bullet at all, so the
fix needed three declaration shapes rather than one, plus an exactly-once rule — see the DONE note
above.

**A3. The generator annotates the two owed shapes asymmetrically.**
`tools/generate-catalog.ts:358-359` attaches `x-owed-vocabulary` and `x-owed` to **`OwedCode`** —
the owed _vocabularies_ — and nothing to **`Owed`**, the owed _values_, although an `Owed` branch's
whole content is a statement about the model's incompleteness. Confirmed in the emitted schema:
`Owed.chargeValue` carries `owed`, `owedTo` and `provisional` and no annotation.

`[A7 §9]` recorded this and could not lean on it, which is why `repointedOwedOwner` stands on one
ground rather than two. **Closing it strengthens a published change class retroactively.**

> **This one moves the wire.** `[A7]` says so in as many words: emitting `x-owed` on the `Owed`
> branches _"would itself be an additive schema change"_. Classify it against `[catalog §2.3]`
> before writing it, read the emitted diff, and expect the **first version bump since A7**.

**A4. The `x-owed` text is one hardcoded string for all three owed vocabularies.**
`tools/generate-catalog.ts:359` emits the same sentence — _"the code list is owed; the shape is
published and the members are not ([SD §0])"_ — for `identityScheme`, `roleClass` and
`unitOfMeasure`. After `[A9 §3.2]` that sentence is **wrong for one of the three**: `identityScheme`
is not awaiting a list, it is **refused on the evidence**, and a consumer reading the wire cannot
tell. See B2, which is the same defect one layer up.

### Group B — needs a decision, and §7 names who makes it

**B1. `sources/registry.yaml`'s `areas:` field is not an inventory and is read as one.**
`[A9 §1]` measured it: a source can score an area non-zero without that area appearing in its
`areas:` list, **for every one of the thirteen areas** — roughly 118 (source, area) pairs, A2 worse
than A9. The sharpest instance is `src:dtr-part-iv`, whose own analysis calls A9 _"the strongest
area"_ and whose `areas:` omits A9.

A9 changed **no entry** and added one sentence to the schema comment, because repairing fourteen of
a hundred-odd pairs would make the field look trustworthy where it is not. **That was a holding
action, not a fix.**

> **DECIDED by the user, 2026-09-30: recompute it from the score rows and gate it.** The options
> considered were (a) recompute-and-gate, (b) delete the field and point every reader at the score
> rows, (c) leave it as A9 left it. The argument that settled it against (c) is empirical and A9 is
> the evidence: **a field that exists gets read as an inventory whatever its comment says**, and
> A9's own plan was misled by this one. (b) is honest and loses a genuinely useful index.

#### What (a) actually is, and it is a HYBRID — sized before the round, not during it

**Only 33 of the 87 registry entries can have a generated `areas:`.** The rest have no score table
at all: 20 `candidate`, 19 `skipped`, 13 `needs-user`, one `obtained`, one `captured`. For those 54,
`areas:` is a hand-written discovery hint and is **the only signal there is** — regenerating it would
delete real information, and a gate over all 87 would fail on every one of them.

So the deliverable is two halves, and the schema comment must say which is which:

| Half                              | Rule                                                                        | Gate                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **33 sources with a score table** | `areas:` **is generated** — exactly the areas scored non-zero, nothing else | A conformance test; every mismatch **named**, never counted (§5 item 10) |
| **54 sources without one**        | `areas:` **stays hand-written** — a discovery hint, as the header now says  | None possible. The comment says so, per source half, not once at the top |

**Two rules the generator needs, both already established by `[A9 §1]`'s measurement:**

1. **A row counts only when some criterion is non-zero.** A scored row of all `0` / `n-a` is not
   evidence the source informs the area. `src:uncefact-rec24` forces it — it carries an A9 row
   scored `0 / n-a / … / 0` and belongs in nobody's list.
2. **The reader already exists.** `tests/conformance/source-registry.test.ts`'s `scoredAreas` is it,
   written by A9 and gated. **The generator is its inverse, and the test is how they stay agreed** —
   do not write a second, subtly different parser for the score-row regex; export the one that is
   already tamper-tested (§9.2 item 9 tampers its column index).
3. **Split the two halves on the presence of a SCORE TABLE, never on `status:`.** The two do not
   agree, and the disagreement is deliberate: `src:pegii-order` has an `analysis.md` **with** a score
   table and `status: needs-user`, because `status` records whether the **material** was obtained —
   its `notes:` say no complete native pegII order exists on disk — and not whether an analysis was
   written. A gate keyed on `status: analyzed` would exclude a source that has scores, and a round
   that "fixed" the status to make the gate pass would destroy a true statement. **This was found
   while sizing the round, by two counts disagreeing by one** (32 entries marked `analyzed`, 33
   directories holding an `analysis.md`), which is the argument for computing a number before
   writing it down.

**One thing to decide while writing it, and the plan does not decide it:** whether the generated
half is emitted by a `tools/` generator run on demand (the house pattern for the glossary and the
catalog) or simply asserted by the test and fixed by hand when it fails. **The second is cheaper and
probably right here** — the input changes only when a source is analysed, which is a handful of times
a year, and a generator that rewrites YAML has to preserve comments, of which `registry.yaml` has
many and several are load-bearing. **Check what a YAML round-trip costs before committing to a
generator**; `js-yaml` is present in the workspace but is **not** a dependency of
`@pegasus/domain-reference`, and adding one for this is a poor trade.

**And update the schema comment A9 wrote.** It currently says `areas:` is a discovery hint, full
stop. After this round that is true of 54 entries and false of 33, and the comment that does not say
so is the same defect one turn later.

**B2. The glossary's Owed page cannot say why something is owed.**
It lists `identityScheme`, `roleClass` and `unitOfMeasure` under one heading with one explanation.
After `[A9 §3.2]` they are **two different states**:

- **Pending** — `roleClass`'s sources are unread (`src:uncefact-mmt-rdm`'s 605-value `PartyRoleCode`
  list ships as a bare enumeration with no names), so the gap closes when someone reads them.
- **Refused on the evidence** — `identityScheme`'s sources **are** read and they publish an escape
  hatch beside every closed list, two of them with a warning attached. The gap does not close by
  effort, and a round that tries has to overturn an argument first.

`[A9 §6]` item 1 records this and calls it _"a defect in a generated page and nobody's yet"_. **It is
this round's.**

> **Check what it costs before promising it.** `OwedCode<Vocabulary>` (`src/primitives.ts:96`) is a
> brand carrying a vocabulary name and **no reason slot**, and the generator hardcodes the `x-owed`
> sentence. Carrying the distinction means either a small `data/` table the generator reads (the
> house pattern — `[A6 §3.2(d)]` and `[A9 §9.1]` both establish that a `data/` list is documentation
> and costs no bump) **or** a change to the brand (which reaches the wire). **Prefer the table**, and
> if the `x-owed` string becomes per-vocabulary, that is A4's wire change and the two should be
> classified together.

**B3. `[catalog §2.3]` has no rule for a breaking change while the catalog is pre-1.0.**
The Breaking column says _"a new major"_ and `[catalog §2.4]` forbids a `1.0.0` while `[catalog §5]`'s
inventory stands, so the two sentences cannot both be followed. `[A7 §9]` recorded the gap and did
not need the answer, because it classified additive. **Write the rule before a round needs it under
time pressure** — which is the only circumstance in which it will otherwise get written.

### Group C — found, recorded, and blocked on something this round does not control

**Do not schedule these as deliverables.** They are listed so the round does not rediscover them, and
§7 turns each into a one-line ask.

**C1. `src:nmfta-scac` has never been fetched.** `status: candidate`, and it is the **only** registry
entry whose `areas:` is `[A9]` and nothing else. It is the issuing authority's own material for
**SCAC** — the corpus's widest-witnessed identity scheme, which six sources use and none defines
(`[A9 §3.3(b)]`, `[A9 §6]` item 2). A fetch, not a modelling question.

**C2. What a signature asserts is unpublished, and `[A6 §6]` owes it to the user.** Four sources
publish the _procedure_ — per-page e-signature with post-signature immutability, inventory signed by
both parties, BL signed at both ends, DVIR first/second/third signatures — and **none says what the
signer is asserting**. `[A6 §3.3(b)]`.

**C3. F4 is open.** `ExternallyPerformedLeg.performedBy` has no consumer —
`analysis/findings-from-alloy.md`, found while applying F1's fix, against `[SD §4.8.3]` rule 1 versus
its own amended fold table.

**C4. Two `RECORDED_DIVERGENCES` carry a TODO to the binding layer.**
`documents.test.ts:212`: _"both entries need a decision from the binding layer, not from this
package"_ — `[SD §4.7]` note 5's prose-alias table versus the documents that use it. One is
`time.delivery`. **Note the register is doing its job**: the test asserts the divergence set is
exactly this list in both directions, so neither can decay into a permanent exception.

**C5. A7's cross-subject set-off is a silence, not a refusal.** `OffsettingRecord.offsets` is an
`EventId` and says nothing about whether the two assertions share a subject, while
`src:dp3-tender-of-service` NTS §5.8.2 publishes a set-off across bills of lading. `[A7 §3.8]`,
`[A7 §6]`.

**C6. A1's open defect stands.** The requestor of a **completed** cancellation has no field.
`[A1 §3.5]`, `[A1 §6]`.

---

## 4. Suggested order, and why

1. **A1** (prettier) — five minutes, and it clears the asterisk every other item's verification
   sentence has to carry.
2. **A2** (the half-tamper gate) — the only item where the repo is currently **claiming a guarantee
   it does not provide**. Highest value per line.
3. **B1** (the registry) — the largest, and the one whose decision §7 asks for. Independent of the
   rest; can be done by a different session in parallel if the merge queue allows.
4. **B2 + A4 + A3 together** — all three touch how owed-ness is represented, two of them reach the
   wire, and classifying them as one change is cheaper and more honest than three separate bumps.
   **Read the emitted `$defs` before classifying** — `[A7 §9]`, three times operative now.
5. **B3** — prose, half an hour, and it is the one that will otherwise be written badly in a hurry.

**Stop when Group A and Group B are done.** Group C is §7's, and the context map (§8) is the round
after.

---

## 5. Landing a change — the recipe the area rounds established

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
    the rendered diff of every prose file you touched** before opening the PR — and see §6's second
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

## 6. The three procedural lessons, which are A6's, A7's and A9's

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

---

## 7. What is blocked on the user — ask these, do not schedule them

Each is one line. **None of them blocks the round starting** — B1, the one that did, is answered.

0. **B1 — ANSWERED, 2026-09-30: recompute and gate.** Left here as the record of the ask. §3 B1
   carries the decision and the hybrid it turned out to be.
1. **C1 — `src:nmfta-scac`.** Worth obtaining? It is the issuing authority for SCAC, which six
   sources use and none defines. `registry.yaml`'s `obtain:` field says what is needed.
2. **C2 — what a signature asserts.** `[A6 §6]` owes this to the user explicitly; no source in the
   corpus publishes it.
3. **C4 — the two prose-alias divergences** need a decision from `[SD §4.7]` note 5, which is the
   binding layer's and not the package's.
4. **The `needs-user` backlog is not a backlog anyone is working.** Worth knowing rather than acting
   on; the number is in `registry.yaml` and this plan deliberately does not restate it (§5 item 10).

---

## 8. What follows this round — the context map, carried forward from A9's plan

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
   construction**, where a hand-written one joins the prose nothing checks (§6).
4. **Watch for this trap.** A10–A13 are **context-map-only by design and are not gaps** (`rubric.md`
   says so twice). A context-map round must not turn into four thin area documents. If the map wants
   something A10 owes, the map **records** the debt; it does not discharge it.

**Nearest models for shape:** `[A8]`'s skeleton — a document whose deliverable is a **table of what
is owed** rather than a set of decisions — and `[catalog]`, a contract **around** the vocabulary
rather than part of it.

After the context map, what remains is the command side, the aggregate lifecycles, `[A8]`'s ledger,
the owed vocabularies, and `[SD §10.4]`'s two bullets.

---

## 9. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red. A5 shipped a compile-time
  assertion that did nothing; A2 shipped one that could never fail even though it was assigned;
  **A6 found a gate that passes a half-tamper, A7 reproduced it, and it is still there — §3 item
  A2.** A9 adds a third form: a gate that reads a **position** in a table it does not own (a column
  index), silently wrong if the table is reshaped. Tamper the index.
- **Prefer a gate that enumerates over one that counts, and a comparison over a total** — §5 item 10.
- **Hold a refusal in the type system, not in a runtime assertion over a literal you wrote.** §5
  item 13. And beware the reverse: an `expect(x).toBe(x)` written as a diagnostic label is a no-op.
- **Re-read your own §Cross-area list before opening the PR** — §5 item 14, in **both** directions.
- **Read the rendered diff of every prose file you touched, and re-count every count.** §5 items 10
  and 15. **No gate in this package reads prose for sense.**
- **Read the existing tests for the records you are writing about.** An `OWED` label, a test title,
  **or a comment inside a passing assertion** naming your own area is a to-do item.
- **Check whether the source captures exist before planning to quote primary text**; **evidence grade
  is not the same as having a capture**; and **a capture is not the same as a definition** —
  `src:milmove-mymove`'s `serviceOrderNumber` is captured and is a bare nullable string with no
  description. `ls -d docs/domain-reference/sources/*/captured` is the check.
- **Two things about B1 that were measured on 2026-10-03 and are not in §3 above.** First, the
  reader §3 B1 tells you to reuse — `scoredAreas` in `tests/conformance/source-registry.test.ts` —
  **is a local function, not an export**, so "export the one that is already tamper-tested" is a
  real refactor and belongs in B1's own diff rather than ahead of it. Second, **B1 will flip a
  currently-passing assertion**: `source-registry.test.ts`'s `[A9 §1]` block gates the sharp
  instance — that `src:dtr-part-iv` scores A9 while `areas:` does not route A9 to it — and
  recomputing `areas:` makes that false. The test's own comment anticipates it and says to send the
  reader to `[A9 §1]` to delete the claim, so **B1 carries a mandatory `[A9 §1]` prose edit**. The
  plan's 33/54 split was re-measured and is exactly right, including the one `needs-user` entry
  (`src:pegii-order`) that has a score table and is why the split cannot key on `status:`.
- **`sources/registry.yaml`'s `areas:` field is a discovery hint, not an inventory** (`[A9 §1]`) —
  **until §3 item B1 is done**. To find which sources bear on an area, read the per-area score rows
  in `sources/*/analysis.md`.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  **both generators** — `generate-glossary.ts` and `generate-catalog.ts` — hold literal NULs, and
  `tests/conformance/documents.test.ts` did until this round's A2 removed it. The old claim here and
  in `GOTCHAS.md` named one file, gave a count and said it was fixed; measured 2026-10-03, no part of
  that held. `GOTCHAS.md` now names the files and carries the one-line re-measure command instead of
  a number. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** In `dolas/agents/project/GOTCHAS.md`.
- **`vitest` does not typecheck.** Run `npm run typecheck` after every test edit — §5 item 17.
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
  also happens**: A7 found `owedTo` emitted as a `const`. **Check the emitted schema both ways** —
  and §3 items A3, A4 and B2 are all in this territory at once.

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

## 10. Housekeeping unrelated to this plan

- **Separate repo** — `~/repos/pegasus-workflows`, `platform/integrations/weichert/rules.json`: six
  rules carry `sourceRef: "Weichert API: …"` quoting sentences that appear nowhere in
  `weichert-api.odt`. Confirmed by the user: they came from **observed API error responses**. Reword
  them, and fix the packed-but-not-loaded dead end — `pre-in-progress-forbids-pack-actual` combined
  with Weichert's real load-actual requirement leaves no valid status for a shipment packed but not
  yet loaded. Live in GLOBAL and the `nw` tenant.

---

## 11. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
python3 -c "s='dr-cleanup'; print(5433 + sum(ord(c) for c in s) % 60)"   # derive the DB port
ss -ltn | grep -E ':(54[3-9][0-9])'                                       # …against what is listening
scripts/workstream-start.sh chore dr-cleanup plans/in-progress/domain-reference-cleanup.md
```

> **Derive the port, do not trust a number written here.** A9's plan wrote a guessed port and was
> wrong by fifty-one; the derivation is two seconds and the guess is worthless. Note also that a
> different slug derives a different port, so do not "improve" the slug without recomputing.

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

1. **§1 of this file**, twice. The difference between a defect and an owed item is the whole plan.
2. `plans/completed/domain-reference-a9-identity.md` — the most recent round, and the source of
   items A4, B1, B2 and C1 in §3. Its **"four drafting defects"** and **"a second pass found four more"**
   sections are why §6 says what it says.
3. `plans/completed/domain-reference-a7-charges.md` — the source of §5 items 14, 15 and 16, and of
   the `owedTo`-is-a-`const` finding that §3 items A3/A4/B2 all sit downstream of.
4. `docs/domain-reference/analysis/published-event-catalog.md` **§2.3** — the change classes, the
   three owed ones, and the three gaps `[A7]` recorded there and did not close. §3 item B3 is one.
5. `docs/domain-reference/glossary.md`, the **Owed** section — and read it as §1 says to.
6. `packages/domain-reference/tests/conformance/documents.test.ts` — §3 item A2 lives at line 487,
   and the file's own header explains the extraction rule it is built on.
