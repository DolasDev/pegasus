# Domain reference — the context map: round record

**Landed 2026-10-05.** The plan this replaces was
`plans/in-progress/domain-reference-context-map.md`, whose §1 was marked **a seed, not a finished
design**, with an instruction to give it a planning pass before executing any of it. That pass
happened and it changed the deliverable twice, which is the thing worth reading here.

**What landed:** `docs/domain-reference/context-map.md`, **generated**, with
`packages/domain-reference/tools/generate-context-map.ts` and
`tests/conformance/context-map.test.ts`. No published byte moves — the emitted schema diff is empty
and there is no `specVersion` bump, as for A2, A6 and A9.

---

## 1. The decision — what the map is, and what it refuses

**The nodes are `rubric.md`'s thirteen areas. The edges are the three things `src/` can be asked
about. It publishes no DDD integration-pattern label, and that refusal is the round's one new
refusal.**

The seed's first instruction was to find out what a context map is supposed to be here before
designing one, on the ground that the term does two jobs — _"a DDD-style map of bounded contexts and
their relationships, and `rubric.md`'s marker for an area that gets a sketch rather than a decision
document"_ — and that _"they are not the same thing and a plan that conflates them will produce
neither."_

**That was wrong, and the grep the plan itself prescribed is what shows it.** `README.md` line 103
reads _"Named on the context map only, sources retained for later"_. The `v1 detail` column's `context
map` value and the README's owed `context map` are **one artefact seen from two sides**: the column
marks the areas that appear **on** the map without a decision document of their own. There was never
a choice between two artefacts, so there was nothing to conflate. `grep -rn -ai 'bounded context'`
over the whole corpus returns **nothing** outside the one README sentence, which settles it the other
way too: no document has ever named a bounded context here.

What **did** need refusing is something the seed never named. A context map in the usual sense carries
a vocabulary for the relationships — shared kernel, customer–supplier, conformist, anticorruption
layer, published language — and **no source in the corpus publishes one for this domain**. Assigning
them would be the `[ORIGINAL]` guess `[SD §0]` forbids, on the axis a reader would be least likely to
check, because a pattern label reads as a finding and is unfalsifiable from the document. `[A9 §3.2]`
is the precedent in shape: a vocabulary refused on the evidence rather than minted to make the
artefact look finished.

**The refusal has no edge the types can see**, and `§3 item 12`'s second half says to state why rather
than leave it. There is no vocabulary for it to leave a hole in, and the absence of a **type** has no
type-level witness — a check over a module's value namespace can never fire for a type alias, which is
the trap `CustodyIsNotAFactClass` escapes only by reading a runtime array. So it is held at runtime
over the emitted bytes: a pattern name may appear in the paragraph that refuses it and nowhere else.
`REFUSAL_SENTENCE` is spelled once in the generator and the gate reads **that**, not a paraphrase.

What the map publishes instead of a pattern name is the join itself: every concept that crosses,
**every place it is referenced from**, and the document cited at that place. A relationship stated as
a pattern name is a claim; a relationship stated as a list of reference sites is a fact about the code.

---

## 2. What the plan had wrong, or did not predict — and (b) is the one that mattered

`§4`'s lesson says a plan is a claim to audit. Audited:

### (a) The conflation warning was itself the error

Above. The two readings are one artefact; the thing that needed refusing was unnamed.

### (b) `§1 item 2`'s list is not a hub rule, and the obvious rule finds half of it

The seed said to **start from the things that appear in more than one area** and named six: _the
party, the Portion, `evidence[]`, the identity key, custody, and the owed authority rows._ The obvious
mechanisation is a citation join — a concept whose docstrings cite two or more area documents. It was
measured before any generator was written, and **it does not find the party**:

| concept      | modules referencing it | area documents cited at its sites |
| ------------ | ---------------------- | --------------------------------- |
| `PartyId`    | 8                      | **1** (`[A8]`)                    |
| `SchemeName` | **2**                  | 6                                 |

Almost every `PartyId` site cites `[SD §…]` and `[A8 §…]`, and the binding layer is not an area. So the
concept `[A9 §3.6]` calls the structural finding of its round — _"the best-witnessed scheme in the
corpus has no subject"_ — would have been absent from the map whose strongest stated reason was to
show it. The mirror holds: module spread alone misses the identity key.

**The rule is the union of the two axes, and the union was measured rather than assumed.** The
comparison is what the gate holds — `PartyId` is on the map on spread **and is below the reach
threshold**, `SchemeName` the other way round — because a later round simplifying "spread or reach" to
one axis is exactly the plausible edit, and a gate on two totals would not stop it.

**Two of the six are not hubs at all, and that is a node class the seed did not distinguish.** The
Portion is an **aggregate** and custody is a **projection**; they cross at the level of the records
asserted about them, not at the level of a type reference, and `PortionId` reaches two modules.
Treating them as hubs would have found nothing. The map carries them in their own section — the
aggregates with the record types that may name them, which is the **inverse** of the glossary's join
and the direction nothing published before.

### (c) `§1 item 3` was right for a reason it did not give

The seed argued for a generated map because a hand-written one is _"a document whose entire content is
claims about sets that the code already knows"_ and would be stale on the day it merged. True. The
stronger reason only appeared in the build: **a generated map found a register nothing else reads.**
`collectOwedInventory` knows `owed(…)`, `Owed<…>` and `OwedCode<…>`, and those three reach the glossary
and `catalog/index.json`. The **`TODO(…)` markers in `src/` are a second owed ledger of the same kind**
— each names the document or module that has to act — and no generated artefact had ever published
them. One of them says in as many words that revenue allocation is **A13's**: an edge from the
published vocabulary to a context-map-only area, in the code, on no map. A hand-written map would have
restated the glossary's owed section and missed it.

### (d) The gate's first form passed a half-tamper — the third shape of a familiar defect

The two refusal gates read the **committed** file. Tampering the generator to leak `shared kernel`
into a row and running the suite fired **only** the staleness check: the leak gate read a file the
tamper had not touched and passed. A6 found a gate that passes a half-tamper, A7 reproduced it, the
cleanup round fixed it; this is a third shape of it. **A gate whose subject is what a generator emits
must read what the generator emits**, not what happens to be on disk. Re-tampered after the fix: both
fire.

Its honest limit is recorded beside it. `REFUSAL_SENTENCE` is the declaring surface, so a round that
**rewords** the refusal rewords the gate with it and only staleness fires — which is right, because no
gate in this package reads prose for sense. What is held is the substance: no pattern name outside the
refusing paragraph, whatever that paragraph has come to say.

### (e) "No markdown tables" is necessary and not sufficient for a prettier fixed point

The glossary generator's header gives one reason an emitted markdown file drifts: prettier re-pads
table cells. The context map contains no table and **still** failed `prettier --check` twice, for two
unrelated reasons:

- **A citation whose own text wraps.** `citationsIn` keeps a citation's spelling verbatim, and a
  docstring may wrap one across a line break — `[A1\n * §Cross-area]`. The link label arrived carrying
  a newline, split its own bullet in two, and prettier re-indented the orphan as a continuation.
- **An emphasis run cut in half.** The `TODO(…)` notes are the first line of a wrapped comment, so a
  `**bold**` run can arrive with one marker on the next line. Prettier balances the stray `*` and
  rewrites the file the generator just wrote.

Both are now handled in the generator, each with the reason beside it. One repair of the second
over-reached and had to be narrowed: stripping `_` along with `*` turned `NOT_COMPLETED` into
`NOTCOMPLETED`, and an intra-word underscore is not emphasis in markdown and never needed removing.

---

## 3. What the map publishes

`docs/domain-reference/context-map.md`, in five parts:

1. **What this map is, and what it refuses** — §1 above, in the document.
2. **The join surface** — one entry per crossing concept: where it is declared, which aggregate is
   behind it (`none` on a branded identifier is `[A9 §3.6]`'s finding), the modules that reference it,
   and every reference site split into the ones whose docstring **names an area** — the edges the map
   is about — and the ones that do not, which are listed anyway, because a reference a map does not
   name is a reference a reader cannot find.
3. **The aggregates** — each with the subject families that admit it, the record types that may name
   it, and the areas cited on those rows. The inverse of the glossary's join. `custody` and the order
   stage are absent and the document says why: a projection has no `subject`, so nothing is asserted
   about it.
4. **The debt, as directed edges** — the `TODO(…)` ledger, then the declared owed values **keyed on
   the owner** rather than on the value, then the unassigned authority rows. The glossary groups the
   same debt by what is undecided; this groups it by who has to act.
5. **The thirteen areas** — one node each, with the concepts that cite it, the areas it **shares
   with** (a projection of part 2, not a second computation, so the two cannot disagree), the
   aggregates whose rows cite it, and what is owed to it. A10–A13 are nodes with whatever reaches
   them and nothing more.

### Three things the generator does that are worth keeping

- **The nodes are read from `rubric.md`, not restated in code.** The rubric **is** the declaration, and
  a second copy is a second place to be wrong. Scoped to the table under `## Domain areas` and nothing
  wider — `§3 item 19`'s lesson, and that file carries blockquote after blockquote of prose about
  those very rows.
- **Machinery is excluded mechanically, not by name.** A declaration carrying **type parameters** is a
  type constructor and is not a concept. Without it the top of the join surface, ranked on reference
  spread, is `primitives.ts`'s `Exact`, `Brand` and `NonEmptyArray` above every concept in the model.
- **Area references are read in both spellings the corpus uses.** A1–A9 have documents and are cited
  bracketed; A10–A13 have none by design and are named bare, and the `TODO` ledger mixes the two in
  one comment. A reader that took only the bracketed form would show the published vocabulary's edges
  to the context-map-only areas as absent — the assumption `rubric.md`'s own note says the `v1 detail`
  column invites.

### What the map shows that nothing showed before

- **`PartyId` is referenced across modules the map enumerates, and has no aggregate behind it.**
  Assembling that
  needed four documents; it is now one entry, with `[A8 §9 item 1]` named at the sites that cite it.
- **A10, A11, A12 and A13 are all reachable from the published model** — A10 and A11 through
  `AssertionType` and `BoundBy`, A12 through a `TODO` in `rules/corrections.ts`, A13 through one in
  `rules/authority.ts`. Gated, so a round cannot quietly decide they are isolated.
- **The `TODO(…)` ledger**, enumerated and owned, for the first time.

---

## 4. Gates — tampered and watched to fail

`tests/conformance/context-map.test.ts`. Each tamper was run against a **committed**
tree and reverted with `git checkout --`.

| Tamper                                     | Fired                                                             |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Hand-edit the generated file               | staleness, naming the line                                        |
| Drop the **reach** axis from the hub rule  | staleness · the enumeration · **both-axes**, naming `SchemeName`  |
| Drop the **spread** axis from the hub rule | staleness · the enumeration · **both-axes**, naming `PartyId`     |
| Admit type constructors                    | staleness · the enumeration · the machinery check, naming `Exact` |
| Add a `TODO(A11)` to `src/portion.ts`      | staleness · the ledger enumeration, naming the new marker         |
| Leak `shared kernel` into a row            | staleness · the pattern-leak gate — **after (d) was fixed**       |
| Reword `REFUSAL_SENTENCE`                  | staleness only — the recorded limit, by design                    |
| Delete `rubric.md`'s A13 row               | staleness · the node set · the A10–A13 checks · the reach check   |
| Leave a site label unresolved              | staleness · the site-label check, naming `data.ts:?`              |

Full suite green (`npm test`), `tsc` silent, `eslint` clean, Alloy every command matching its
expectation, glossary and catalog regenerated with **no diff**, `prettier --check` clean over both
trees with no exception.

---

## 5. Cross-area consequences, written

- **`docs/domain-reference/README.md`** — the owed list now names **two** absent pieces, not three,
  with the context map moved out of it and the difference from the DDD artefact stated as a decision;
  a `Layers` row; a `Process` row; a `## The context map` section beside the glossary's; and the
  `Scope` paragraph's _"named on the context map only"_ now links to the map and says what reaches
  A10–A13.
- **`packages/domain-reference/README.md`** — the `tools/` row now names three generators, and a
  `## So is the context map` section follows the glossary's.
- **`docs/domain-reference/rubric.md`** — the one cross-reference to the live plan, repointed.
- **`packages/domain-reference/package.json`** — `npm run context-map`.
- **`tools/generate-glossary.ts`** — the compiler-model, citation, anchor, declaration, member,
  owed and canonical-subject readers exported for reuse rather than copied, and
  `CanonicalRow` gains the optional `citations` the data already carried. Both in `tools/`; `src/` is
  untouched, which is why no published byte moves.
- **`dolas/agents/project/GOTCHAS.md`** — the NUL-byte entry now says three generators; the prettier
  fixed-point entry gains the two causes in §2(e); and a new entry carries §2(d).

**Deliberately NOT edited:** `plans/completed/domain-reference-cleanup.md` and
`plans/completed/domain-reference-owed-closures.md` each say _"the live plan is **now**
`plans/in-progress/domain-reference-context-map.md`"_. Those are dated statements that were true when
they landed, and the file is findable at the same slug under `plans/completed/`. Repointing them every
round would make each record lie about its own date, and would be an N-file edit per round. A later
round should leave them.

---

## 6. What this hands the next round

The hub table is new evidence about **which** owed item is load-bearing, and it points one way:
`[A8 §9 item 1]`, the party entity, is named by three of the `TODO` markers the map enumerates and
sits under the widest-spread concept with no aggregate behind it. `roleClass` is the next closable item on effort alone and is `[A8 §9 item 2]`'s blocker as
well. Both are A8-ward, and the next plan is
`plans/in-progress/domain-reference-roleclass.md`.
