# @pegasus/domain-reference

**An executable specification of the household-goods moving & storage domain.**
Not an implementation. Not a description of what Pegasus II or Pegasus Cloud do.

It exists so that the decisions in
[`docs/domain-reference/analysis/`](../../docs/domain-reference/analysis/) stop being prose that a
careful reader has to verify, and start being something a compiler and a test run check.

## What this is not

- **Not our system's model.** `packages/domain` is what Cloud implements today. This package is the
  target domain as the industry's own sources describe it. They are deliberately different, and
  round 1 of the research showed why: Cloud's `Move` fuses order, shipment and route into one
  aggregate, which makes consolidating several customers' goods onto one van inexpressible.
- **Not integrated with anything.** No I/O, no framework, no persistence, no runtime dependencies.
  It imports nothing from this repo, and nothing in this repo imports it. Migration, adapters and
  any mapping onto pegII or Cloud belong to a later workstream that has not been authorised.

## Layout

| Path                 | What                                                                                  | Authority                        |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| `src/`               | Types (the vocabulary) and pure predicates (the rules types cannot hold)              | Normative for structure          |
| `data/`              | Tables that change on their own cadence — canonical subjects, authority rows, reasons | Normative for content            |
| `tests/scenarios/`   | Nine real household-goods situations, as executable acceptance tests                  | The suite that must keep passing |
| `tests/conformance/` | Checks that the code, the data and the analysis documents agree                       | The drift guard                  |
| `alloy/`             | Structural model-checking for questions a type system cannot answer                   | Finds counterexamples            |
| `tools/`             | The glossary generator — reads `src/` through the TypeScript compiler API             | Generates, never decides         |

## Precedence

1. [`docs/domain-reference/analysis/00-shared-decisions.md`](../../docs/domain-reference/analysis/00-shared-decisions.md) — the binding layer
2. [`A8-authority-skeleton.md`](../../docs/domain-reference/analysis/A8-authority-skeleton.md)
3. The three decision documents (A3, order/shipment cardinality, time/provenance/corrections)

**Code is normative for structure; the documents are normative for rationale.** Where they disagree,
that is a defect in one of them — the conformance tests exist to catch it rather than let it sit.

Every rule in `src/` cites the section that decided it. A rule with no citation and no `[ORIGINAL]`
marker is a defect: the documents' disclosure rule applies here too. That sentence is no longer a
convention a reviewer has to enforce by reading — `tests/conformance/glossary-coverage.test.ts`
checks it over every term the glossary covers, and reports failures rather than repairing them.

## The ubiquitous language is generated

[`docs/domain-reference/glossary.md`](../../docs/domain-reference/glossary.md) is **generated from
this package**, not hand-written. The process originally called for a hand-maintained
ubiquitous-language document; it was deliberately replaced, because the names already live in the
types and the definitions already live in the JSDoc beside them, and a third copy is a third place
to drift — [SD §1.1]'s own reason for deleting the generic `correlation` bag.

So: **to change a definition, change the docstring** and regenerate.

```bash
npm run glossary -w @pegasus/domain-reference    # rewrites docs/domain-reference/glossary.md
```

Two gates in `tests/conformance/` keep it honest. `glossary-staleness.test.ts` regenerates the
document in memory and fails if the committed file differs, naming the first differing line and the
command to re-run. `glossary-coverage.test.ts` is the disclosure rule above, mechanised.

## Running it

```bash
npm run typecheck -w @pegasus/domain-reference   # the vocabulary must compile
npm test          -w @pegasus/domain-reference   # scenarios + conformance
npm run alloy     -w @pegasus/domain-reference   # structural model-checking (needs Java)
```

## Deliberately unfinished

These are declared **owed** in the documents and are represented as owed here rather than guessed:
the order lifecycle's transition mapping (A1), shipment identity across a terminated storage stay
(A2/A5), the `roleClass`, `unitOfMeasure` and `identityScheme` vocabularies, every remedy shape beyond
`newWindow`, and most of A8's authority rows. A test asserts that everything owed is marked owed — so
an unfilled gap is visible rather than silently defaulted, and the glossary's `Owed` section is the
current list.

The reason vocabulary's codes were on that list and are not any more:
[`A4-execution-events.md`](../../docs/domain-reference/analysis/A4-execution-events.md) published 23
members, which took the catalog to `specVersion` 0.2.0.

### Gaps writing the core vocabulary surfaced

Two records the binding layer requires have no `type` in its own complete declaration
([`00-shared-decisions.md` §4.7.1](../../docs/domain-reference/analysis/00-shared-decisions.md)) —
the same defect §4.7.2e found for the order lifecycle and fixed by minting three members. Both are
recorded as owed in `src/` rather than minted here, because §4.7 is the only place a family may be
declared:

- **the `state` fact class.** §4.1 declares a `state` family — "a party's claim about a lifecycle
  state", worked through SIRVA's dispatch lifecycle against Weichert's procurement lifecycle — and
  §4.7.1 declares no `type` for it. The lifecycle members are acts, and `in-transit` is explicitly
  "not a record at all". See `FACT_CLASS_FAMILY` in `src/vocabulary.ts`.
- **a Portion's membership.** §3.1 says "a Portion is itself asserted… two parties can disagree
  about it", and no declared `type` carries that assertion. See `src/portion.ts`.

### Gaps writing the data tables surfaced

`data/` holds three tables — canonical subjects, A8's authority rows, and the reason vocabulary
(its shape, and since A4 its 23 members with their per-code scope, attribution discipline and remedy
obligation) — and `src/data.ts` is the loader that refuses a bad one. Filling them row by row surfaced
four things, each recorded in the table itself rather than smoothed over.

- **Two rows are owed by a ledger that does not list them.** §4.7.1 marks `weight.gross` and
  `weight.tare` "Owed — not in A8 §5" with `boundBy` **unassigned** — but
  [`A8` §9 item 8](../../docs/domain-reference/analysis/A8-authority-skeleton.md)'s enumeration of
  uncovered classes names cube, piece count, packing performance, survey/estimate, ETA, seal
  integrity, tracer and claim facts, and **not** gross or tare weight. Nobody is on the hook.
- **`owed` and `unassigned` are two different statements**, and §4.7.1 uses both. The lifecycle rows
  say _owed_ and name what owes them; the two weight rows say _unassigned_, which is weaker — nobody
  has said what binds them and nobody has undertaken to. `BOUND_BY_DECLARATIONS` keeps the two
  spellings apart, because collapsing them would invent a ledger entry for the second pair.
- **`pieceCount`'s authority is borrowed, and only half of it.** A8 §5 has no piece-count row: the
  boundary case is covered only because **A8-JOINT** reaches "`condition` **and the counts asserted
  with it**", and away from a boundary it is owed. That needed a third status — `conditional` — and
  the cross-table link is marked `sameType: false` so that a borrowed row cannot read as a row of
  its own. Of the 31 declared types, **11 have an A8 §5 row**, one borrows, two (`storeIn`,
  `handover`) cite A8 outside §5, and **18 carry an authority marked owed**.
- **`partyRole`'s `context[]` names something that cannot be in it.** §4.7.3's row says the context
  carries "the party" — and a party is deliberately not an aggregate kind (§1.2 has `partyRole` and
  no `party`), so it cannot be a `SubjectRef` until A8 §9 item 1 lands. Recorded on the row rather
  than quietly dropped.

One limitation of the loader, stated because a partial check that reads as a total one is worse than
no check: it refuses a reason code containing an **outcome member's own name**
(`CANCELLED_BY_SHIPPER`), and it cannot catch §2.4 rule 1's own example — `DELIVERED_SHORT` /
`REFUSED_SHORT` — which hides the outcome in a verb no document publishes. Rule 1 still needs a
reader.

### Gaps writing the admission and capture rules surfaced

Same shape again: a binding rule names a fact class that §4.7.1 does not declare. All four are
recorded as owed in `src/rules/capture.ts` rather than minted.

- **`position`** — §5.2 M5 permits a geofence to assert it, and it appears in **no table at all**:
  neither in §4.7.1's vocabulary nor in §4.7.3's list of classes that are deliberately absent. M5
  licenses a record the catalog cannot publish.
- **`eta`** — M5's fourth member. §4.7.3 already records it absent-and-owed, and §4.5 arguably
  supplies the reading that makes it unnecessary: an ETA is an `arrival` at `basis = ESTIMATED`.
- **`item accepted` / `item refused`** — two of the nine names in M2's possession-changing list have
  no `type`. §5.4 and §3.4 read a refused item as the _scope_ of a `delivery` act (a Portion in
  `reasons[].appliesTo`), which accounts for one of them and leaves `item accepted` with no reading.

One structural finding rather than a gap: **most types have no `capturedBy` eligibility
declaration**, though §5.2 M7 requires one per record type. `checkCapture` therefore returns three
verdicts, not two — `ADMITTED`, `REJECTED`, and `UNDECLARED`, the last meaning M1-M5 all passed and
no rule in the shared layer speaks to this `(type, basis, capturedBy)`. Admitting on a gap would
claim a check ran that did not; refusing on one would refuse traffic on the strength of our own
missing table.

### Gaps writing authority, custody and corrections surfaced

`src/custody.ts` is [§4.8.3](../../docs/domain-reference/analysis/00-shared-decisions.md)'s fold;
`src/rules/authority.ts` is [A8](../../docs/domain-reference/analysis/A8-authority-skeleton.md)'s
eleven rows and its seven rules; `src/rules/corrections.ts` is §6; `src/rules/resolution.ts` is
§4.4's one value rule. Four things surfaced, each represented rather than smoothed over.

- **The fold reads a receiving side that no authoritative field carries.** §4.8.3 returns
  `holder` "from the selected handover's **receiving side**"; §4.7.1's handover row puts the
  releasing and receiving `partyRole`s in **`context[]`**, which §1.4 rules 2-3 make valueless,
  unordered and non-authoritative — so nothing can say _which_ ref is the receiver. Not fixed by
  minting a field (§4.7 owns record shapes). Fixed by making the receiving side a named input, so a
  caller who cannot supply it gets the fold's own `UNKNOWN` instead of a guess.
- **The fold's two inputs disagree about grain.** §4.8.3's `holder` is a `partyRole`; §8.2's
  `performedBy` — the other input — is a **party**, and §1.2 has no `party` aggregate. `CustodyHolder`
  carries both and says why, rather than picking one and losing the distinction.
- **The only published amendment window governs a fact class that has no `type`.** §6's
  `INEFFECTIVE` outcome needs a window; the corpus supplies exactly one (§375.401(i), an estimate may
  be amended only before loading), and `estimate` is in `ABSENT_AND_OWED` on §4.7.3's instruction. So
  the window is an **input** to the decision procedure, never a table lookup — an assumed-open
  default would apply corrections the law forbids, and an assumed-closed one would void valid ones.
- **"Distinct weighings" is undefined.** `R-WEIGHT-LOWER` applies only to two ACTUAL net weights
  "produced by **distinct weighings**" and no document says how to tell. `areDistinctWeighings` is
  three-valued — disjoint evidence is `DISTINCT`, shared evidence is `SAME_WEIGHING`, and missing
  evidence is `UNDETERMINED`, which does **not** resolve. Reading "no evidence" as distinct would let
  one weighing keyed by two parties look like a reweigh.

And one duplication that wants a decision rather than a note: **A8 §5's table is carried twice** —
as types in `src/rules/authority.ts`, which the rules compute over, and as JSON in
`data/authority-table.json`, on §4.7 note 3's instruction that the authority column is quoted rather
than re-derived. Nothing checks that the two agree. One must become the source of truth and the other
be derived from it; every rule reads a table rather than a hard-coded row, so they can be re-pointed
without a rule changing.

### What the Alloy specs found — and why `npm run alloy` is red

`alloy/` asks the questions a type system cannot: does a counterexample **exist**. Three small
specs — `custody.als`, `cardinality.als`, `subject-admission.als` — carry 35 commands, each with an
`expect` transcribed from the document that makes the claim. `alloy/run.mjs` compares every result
against its `expect` and exits non-zero on a mismatch, so a refuted claim is a red gate rather than
a paragraph nobody reads.

**Three commands are red, and they are one defect seen from three sides.** The `handover` type
declares canonical subject family `goods` and **no qualifier** ([§4.7.1]), so the derived fact key
([§1.3]) of every handover of one shipment is the same tuple `(shipment:S, handover)`. [§4.3] pairs
assertions on that key into one contest with one `selected`, and [§4.7.2d] item 3 states the
doctrine for every type that legitimately recurs — "successive changes ride `supersedes`… **the
discriminator stays the subject**: two trips are two trips, two memberships are two `stopAction`s".
`handover`'s subject is the goods, which is the one aggregate that does _not_ change across
successive handovers of it. So it has no discriminator.

- `foldsUntilFieldIsReachable` — UNSAT. [§4.8.3]'s `until` is "**the next selected handover's**
  `occurredAt`, where one exists", and under the fact key there is never a next one.
- `custodyChangesHandsUnderTheFactKey` — UNSAT. The operational form of the same thing: custody can
  never change hands, so [A8 §7.6]'s cross-dock scenario (a handover into T1 and a handover out to
  T2, "these two acts are the fold's inputs") and [A3 §3.3]'s agent-to-agent handoff row have at
  most one boundary between them.
- `custodyAtReturnsAtMostOneHolder` — SAT, i.e. a counterexample. This is the other jaw: relax the
  fact key the obvious way — let a goods have a sequence of selected handovers — and two of them
  timestamped at the same instant give the fold two holders, with no tie-break published anywhere.
  [§4.6.3] step 2 and **A8-NAMED** both forbid inventing one, and A8-NAMED's `tieBreak` ranks
  _asserters_, not two already-selected handovers. `custodyAtIsSingleValuedAwayFromInstantTies`
  passes, which localises the defect to exactly that gap.

Neither half survives alone, and the repair is the binding layer's: either `handover` gets a
discriminator (a subject that changes, or the qualifier [§4.7.2d] argues against), or [§4.8.3]
stops presupposing a sequence. Nothing in `src/` is coded around it — `src/custody.ts` folds a
sequence of selected handovers, which is the reading [§4.8.3] requires and the fact key forbids.

**Two more shapes the specs pinned down, both green because they are expected:**

- `bothKeysAdmitAndInvariant3ForbidsThePair` — a `delivery` on `shipment:S` and a `delivery` on
  `portion:P` of S, at one stop and one instant, are both admitted by **E-CANON-STRICT** (both kinds
  are in the `goods` family) and land in two fact keys, so they never meet in a contest — while
  [§2.3] invariant 3 forbids the pair outright ("Sibling acts on Portions are the required form only
  when the acts happened at different stops or different times"). Invariant 3 is a well-formedness
  rule with no admission rule behind it, and [§4.6.2]'s boundary is "purely structural" by its own
  definition, so it cannot acquire one.
- `resolutionCanSmuggleANonCanonicalSubjectPastTheBoundary` — `ingest()` in `src/rules/e-canon.ts`
  admits a re-phrased submission without re-running the boundary on the resolved subject. In the
  TypeScript that is safe, because `AttemptedResolution.candidates` is typed
  `SubjectRef<CanonicalSubjectKind<T>>[]`; the guarantee is carried entirely by the type, which is
  worth knowing for anyone reading the pipeline as a description of a runtime boundary.

`wholeShipmentRidesTwoTripsAtOneInstant` is green for the same reason: the model admits it, no
published rule excludes it, and [A3 §3.3] narrates overflow with Portions without constraining the
whole-goods form.
