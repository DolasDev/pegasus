# Event catalogue — plan and resumption state

**Written 2026-09-20** to be read by a session with **no prior context**. Everything needed to resume
is here or is named by path. Read this whole file before starting.

**Next deliverable:** the **published event catalogue** — the versioned integration events derived
from the reference domain model. This is the thing the whole effort was started for.

---

## 1. How this came about (the motivation, in one paragraph)

The original question was about event design across Pegasus II (legacy) and Pegasus Cloud: whether an
"order changed" event should carry a projection of the order plus per-property state changes, so that
integrations could filter on the fields they care about. Working that through produced a conclusion
that redirected the work: **publish domain events in the industry's own language, not generic
change/diff events.** A diff stream is internal plumbing (pegII is a form-and-save CRUD system, so
intent has to be inferred from data changes); what integrations should consume is meaningful events.
That required knowing what the domain's events actually _are_ — hence a reference domain model, built
from external sources, which is what now exists. The catalogue is the return to the original question.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                   | Landed              |
| -------------------------------------- | --------------------------------------- | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/` (795 files)    | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/` (49 files) | `5b7c2ccd`, PR #712 |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`. Both are on `main`; CI and
the Deploy workflow (staging → E2E gate → prod → release tag) went green after the merge.

### The documents (`docs/domain-reference/`)

- `README.md` — what the model is and is not; the scope rule.
- `rubric.md` — 13 domain areas (A1–A13), 8 criteria (C1–C8), evidence grades.
- `sources/registry.yaml` — **87 sources**, **32 analyzed**, each with access, licence, status,
  `role`. Captured material under `sources/<id>/captured/`; licensed/bulky material local + gitignored
  with sha256 and retrieval date.
- `analysis/` — in **precedence order**:
  1. `00-shared-decisions.md` — **THE BINDING LAYER**, outranks everything below
  2. `A8-authority-skeleton.md`
  3. `A3-trip-stop-assignment.md`, `fork-order-shipment-cardinality.md`,
     `fork-time-provenance-corrections.md`
  - plus `F1-handover-qualifier-decision.md`, `findings-from-alloy.md`,
    `round-1-crosscheck.md`, `round-2-critique.md` (the review history — kept deliberately)
- `glossary.md` — **generated**, 126 entries. Do not hand-edit.

### The executable specification (`packages/domain-reference/`)

Zero runtime dependencies. No I/O in `src/`. Imports nothing; nothing imports it.

```
src/      primitives ids envelope vocabulary assertions outcomes identity portion custody data
src/rules e-canon capture authority corrections resolution
data/     canonical-subjects.json authority-table.json reasons.json
tests/    scenarios/ (9 household-goods situations)  conformance/ (vocabulary, documents-drift,
          invariants, data-tables, glossary-staleness, glossary-coverage, *-refuses type-level suites)
alloy/    custody.als cardinality.als subject-admission.als run.mjs
tools/    generate-glossary.ts
```

Scripts (`npm run <x> -w @pegasus/domain-reference`): `test`, `lint`, `typecheck`, `alloy`, `glossary`.

**Gates, all green at merge:** `tsc` silent · **264 tests in 17 files** · Alloy runner reports every
command matching and **exits non-zero** on a counterexample · glossary is a prettier fixed point.

---

## 3. Rules that govern this work — these are binding, not preferences

1. **SCOPE.** The model is an **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   excluded from the evidence base and marked `role: mapping-only` in the registry
   (`pegasus-cloud-domain`, `pegasus-cloud-prisma`, `pegasus-integration-floors`, `pegii-order`,
   `pegii-longhaul`, `pegasus-domain-plans`, `equus-sender-legacy`). Never cite them for what the
   domain IS. Partner contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence — they describe how
   counterparties behave, including behaviour observed from their live APIs.
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders** — `src:pegii-order` stays
   `needs-user` for eventual mapping work and blocks nothing. If a task appears to need pegII or Cloud
   data, that is the signal it is a _mapping_ task belonging to a workstream that does not exist yet.
   (This was corrected three times in the last session. Don't be the fourth.)
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use. A source saying something narrower does not support the
   claim. Marking something ORIGINAL is not a defect; presenting invention as sourced is. The glossary
   coverage gate now enforces this mechanically.
4. **OWED means owed.** Where a document declares something owed, represent it as owed — a distinct
   value, never a null that reads as "nobody" and never a guess that makes the types tidy.
5. **Code is normative for structure; documents are normative for rationale.** Disagreement between
   them is a defect, which is what the conformance tests exist to catch.

---

## 4. What the catalogue must respect (decisions already made)

Read `00-shared-decisions.md` in full first. The load-bearing parts for a catalogue:

- **§1.1 Envelope** — `subject` is ONE typed `SubjectRef {aggregate, id}` over the 14 aggregate kinds.
  Seven mandatory fields: `eventId`, `type`, `specVersion`, `subject`, `assertedBy {party, role}`,
  `assertedAt`, `capturedBy`. `recordedAt` is server-authored — forbidden on capture, mandatory on
  query (two types, not one optional field). Non-authoritative `context[]`. **Permanently forbidden:**
  a second subject, a subject path, a tense qualifier on the envelope, any mutable current-state field.
- **§1.3 One classification axis** — `factClass` subsumes `type`; `factRef` is the _derived_ key
  `(subject, type, qualifier?)`, not a field.
- **§2 (outcome, reason)** — `COMPLETED | COMPLETED_WITH_EXCEPTION | PARTIALLY_COMPLETED |
NOT_COMPLETED | CANCELLED`, legal only at `basis = ACTUAL`; reasons forbidden when COMPLETED, ≥1
  otherwise. Rule **A-TYPE**: the type names the ACT, never the outcome.
- **§4.1 / §4.3 Assertion + FactResolved** — one record class over any fact class; `basis = ACTUAL` is
  legal; competing assertions pair on the derived key and resolve under a named, versioned rule with
  the losers retained in `considered[]`.
- **§4.6 E-CANON** — subject admission: STRICT (reject, never re-key), RESOLVE (named versioned
  ingest-side rule returning exactly one candidate), OBLIGATION (cardinality ≠ 1).
- **§4.7 Vocabulary** — 31 record types with canonical subject families; the type→family table is
  `satisfies`-checked in `src/vocabulary.ts`, so a missing entry fails to compile.
- **§4.8 Custody** — a **projection**, the fold `custodyAt(goods, instant)`. Never stored, never
  asserted, never corrected; returns UNKNOWN and never falls through.
- **§5 M1–M7 Capture** — cut by capture method. `ASSUMED_FROM_PLAN` may never carry `ACTUAL`;
  possession-changing facts need a human/partner asserter; `DEVICE_GEOFENCE` may assert
  arrive/depart/position/ETA; one sanctioned `DERIVED_BY_RULE` carve-out (the SIT entry date).
- **§6 Corrections** — always recorded, never refused: `APPLIED | INEFFECTIVE | UNAUTHORISED`.
  Authority names an **instrument**, not just a party. Financial facts correct by offsetting records.
- **§7 I-KEY** — identity key `(subject, scheme, vocabularyScope)`; arity N per tuple and `primary`
  resolves per tuple; `vocabularyScope.authority` (defines the vocabulary) ≠ `issuer` (assigned this id).
- **A8** — the authority skeleton: which role's assertion governs per fact class, A8-INSTANT (evaluate
  at the fact's instant, not now), A8-MOVE (authority moves at a 349 handover, not a 41), A8-AFTER.

---

## 5. Open findings and what is owed

`analysis/findings-from-alloy.md` — **F1, F2 resolved**; **F3, F4, F5 open**:

- **F3** — `handover`'s `boundBy = CUSTODY` is circular per §4.8.2, and A8 §5 owes it a row.
- **F4** — `ExternallyPerformedLeg.performedBy` has no consumer: §4.8.3 rule 1 names it as a fold
  input, but `holder` comes solely from the selected receipt. Alloy shows they can disagree.
- **F5** — role names are fact-key components after F1, so spelling is load-bearing, and A8 §2 carries
  two spellings with nothing cross-checking. A8 owes the canonical list.

**Owed content** (see the glossary's generated `Owed` section — 4 parts, always current): the A4
**reason vocabulary** (shape only, no codes — this one matters most for the catalogue); the A1 order
lifecycle transition mapping; shipment identity across a terminated SIT stay (A2/A5); **19 of 31**
authority rows; 10 absent-and-owed fact classes.

**Areas never written as comparisons:** A1, A2, A4, A5, A6, A7, A9. Only A3 exists as a decision
document. A4 and A5 are the two the catalogue is most likely to need.

**Gated sources still unobtained** (registry `needs-user`): `atlas-world-group-api` reference-data
vocabulary — **no subscription key exists in the repo**, and 47 of 63 endpoints would be reachable
with the documented grant; `omnitracs-one-xrs` (a tenant runs Omnitracs); `iso-17451` (paid, the only
formal removals data standard); plus `dteb-edi-conventions`, `werc-mobility-data-standard`, and others.

---

## 6. The next deliverable — the event catalogue

> **DONE — 2026-09-21.** All five items below are settled or explicitly deferred; see §10 for what
> landed, what was found on the way, and what the _next_ session should pick up. The paragraphs
> below are kept as written so the decisions can be read against the questions they answer.

**Goal:** the published, versioned integration events a consumer subscribes to, derived from the model
rather than invented alongside it.

Open questions to settle first, with the material to settle them from:

1. **Catalogue vs vocabulary — what is the difference?** `src/vocabulary.ts` already declares 31
   record types. Is the catalogue exactly those, a curated subset, or a coarser published layer over
   them? §4.7's act rows are fine-grained by design; §6 of the _earlier_ discussion argued a published
   contract should be coarse enough to stay stable. **Decide deliberately, do not assume.**
2. **Versioning.** `specVersion` exists on the envelope. Per-event-type versioning, vocabulary
   extension (open-by-namespace vs closed-with-process — the corpus has both: EPCIS open by URI, DCSA
   closed with a release), and what a consumer may rely on.
3. **Subscription and filtering.** The original motivation. What may a consumer filter on — subject
   kind, type, fact class, qualifier? Note the corpus finding that a machine may assert _where_ a
   vehicle is but never _why_ something went wrong (Shippeo's geofence rule), and that filtering on
   changes is a routing hint while per-integration comparison against last-delivered state is what
   makes it correct.
4. **JSON Schema emission** — the deferred item from the previous plan. Generate from the types
   (never hand-write), with a staleness gate exactly like the glossary's. EPCIS and DCSA both publish
   JSON Schema; this is the format the corpus itself uses.
5. **A4 reason vocabulary** — `data/reasons.json` ships shape-only. A catalogue that publishes
   outcomes without reasons is half a contract. The evidence is already captured: Shippeo's two-axis
   `(situation, justification)` grid (38 data rows, 18 justification codes across 10 situations, 7
   geofence-eligible and no exception among them), MacroPoint's deployed EDI-214 codes, X12 element
   1651 organised by responsible party, UNECE Rec 24's named status list.

Suggested shape of the work: **decide (1)–(3) as a written decision document under `analysis/`**
before generating anything, because a published contract is the one artifact that cannot be quietly
revised later. Then emit schemas from the types, gate them, and only then consider A4.

---

## 7. How to work here — hard-won, and worth keeping

- **Run the gates yourself. Never trust a report.** In the last session an agent reported a document
  conformed and stamped it so, without making the edits; a verifier caught it by reading the file.
- **Verify AFTER the pre-commit hook, not before.** The hook runs `eslint --fix` + `prettier --write`
  and folds the result into the commit. Prettier reflowed object literals and displaced 35
  `@ts-expect-error` directives away from the lines they suppress — a green pre-commit run, a broken
  commit. Prettier also prints numeric arrays in fill mode, which detached an enum member's JSDoc.
- **Prove a gate bites by tampering.** Edit the artifact, watch it fail, restore. Two of my own tamper
  attempts silently matched nothing, which looks exactly like a working gate.
- **A false green is worse than a red.** Alloy found the F1 defect precisely because a passing
  TypeScript scenario test was running on a history the catalogue could not publish.
- **CI specifics:** Betterleaks scans **full history**, so removing a file in a later commit does not
  help — amend instead (`.betterleaksignore` fingerprints do not work for unmerged PRs; see
  `dolas/agents/project/GOTCHAS.md`). Dependency Review reads any `package.json`/`pom.xml` in the
  diff, including inside captured third-party material. **Capture policy:** commit only the artefacts
  the analyses cite; keep full clones in gitignored `local/`; never commit a clone's manifests, build
  scripts or CI config (`docs/domain-reference/sources/README.md`).
- **CI runners are slower than this machine.** Compiler-driven tests need explicit timeouts; vitest's
  default 5s passed locally and timed out in CI.
- **Workflows:** parallel authoring causes drift — the three decision documents contradicted each
  other and needed a reconciliation round. Settle a shared layer FIRST, then fan out. Keep a workflow
  under ~6 agents when each does heavy reading; one 10-agent run died on a session limit (its file
  writes survived, its results did not).
- **Extractors:** `pdf2txt.py` / `odt2txt.py` lived in a session scratchpad and are **gone**. If
  source PDFs/ODTs must be re-read, recreate them (pypdf in a venv; ODT is a zip containing
  `content.xml`). No poppler on this machine.

---

## 8. Housekeeping left over

- **Worktrees still on disk**, both merged and safe to remove — agents are barred from doing it:
  `~/repos/pegasus-domain-reference` (`docs/domain-reference`) and `~/repos/pegasus-domain-model`
  (`feat/domain-model`). `scripts/rm-worktree.sh domain-reference` / `... domain-model`.
- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from **observed
  API error responses**. Reword them, and fix the packed-but-not-loaded dead end — which is ours:
  `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in
  GLOBAL and the `nw` tenant.

## 9. Starting a session on this plan

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
scripts/workstream-start.sh feat <slug> plans/in-progress/<plan>.md
```

Then work in the new worktree; the plan is seeded into `plans/in-progress/` there and commits with the
implementation as one PR. Read `docs/domain-reference/analysis/00-shared-decisions.md` and
`glossary.md` before writing anything.

_(The path above said `~/.claude/plans/event-catalogue.md` and no such file existed — the plan lived,
untracked, in the primary checkout's `plans/in-progress/`. Corrected so the next reader does not
spend the same two minutes.)_

---

## 10. What landed — 2026-09-21

**Branch `feat/event-catalogue`.** The catalog is published at `specVersion` **0.1.0**.

### The decision — `docs/domain-reference/analysis/published-event-catalog.md`, cited as `[catalog §x]`

1. **The catalog IS the record vocabulary, exactly** — 33 members (31 assertion types + `FactResolved`
   - `Correction`). Not a new decision: [SD §1.3] already says "the catalog publishes **one** versioned
     record vocabulary" and names both meta-records as members. A coarser published layer is refused
     because it is a **second classification axis**, which [SD §1.1] forbids permanently; the stability
     it was wanted for comes instead from A-TYPE, addition-only versioning, and the derived families as
     filter axes. This also closes `src:gs1-epcis-cbv`'s open question 4 (one granularity, DCSA's side).
     The published `Correction` is `RecordedCorrection` — [SD §6.2] requires the authorising instrument.
2. **Versioning: catalog-wide, closed, addition-only within a major.** `specVersion` is already
   defined catalog-wide, so per-type versioning is refused. Closed rather than EPCIS-style
   open-by-URI — this settles the EPCIS analysis's own open question 6, "the biggest C8 decision in
   the catalog". Consumer rule: **validate against the `specVersion` the record carries**, and treat
   an unfamiliar closed-enum member as unhandled, not invalid. `0.1.0` and not `1.0.0` because §5's
   owed inventory is real; the inventory ships inside `index.json`.
3. **Filtering: twelve axes, all envelope / payload / derived. Never `context[]` by default.** The
   nicest consequence, and it is a guarantee rather than a hope: because M3 requires a human or
   partner asserter for every non-`COMPLETED` outcome, **an exception subscription and a
   machine-capture subscription are disjoint by construction**. §3.4 answers the question that started
   all of this: no diff stream, because two assertions on one fact key _are_ the change.
4. **JSON Schema emission — done**, generated, gated, tamper-proved.
5. **A4 reasons — deliberately NOT done.** `codes: []` stands. The schemas publish the owed marker.

### The artifacts

- `docs/domain-reference/catalog/` — `captured.schema.json`, `queried.schema.json` (JSON Schema
  2020-12, one face each per [SD §1.1]'s `recordedAt` rule), `index.json` (manifest + owed inventory),
  `README.md`. **All generated; do not hand-edit.**
- `packages/domain-reference/src/catalog.ts` — the executable half: `CATALOG_MEMBERS` (with a
  type-level proof it equals `RECORD_TYPES`), `CATALOG_VERSION`, `CATALOG_FACES`, `FILTER_AXES` +
  `FILTER_AXIS_SOURCE` / `FILTER_AXIS_FACES`, `REFUSED_FILTER_AXES`, `ADDITIVE_CHANGES` /
  `BREAKING_CHANGES`.
- `packages/domain-reference/tools/generate-catalog.ts` — `npm run catalog -w @pegasus/domain-reference`.
- `packages/domain-reference/tests/conformance/catalog.test.ts` — 37 tests. **301 tests in 18 files**
  overall, up from 264 in 17.

### Techniques worth keeping

- **The checker resolves the whole vocabulary from three probe aliases.** `Assertion` with its default
  parameter is _already_ the union of every type × five bases × both faces, so the generator names
  three types, not thirty-three, and buckets each resolved variant by the literal value of its own
  `type` — the single classification axis, read off the record. The probe is a **virtual source
  file** via a wrapped `CompilerHost`, so a crashed run leaves nothing in `src/`.
- **`recordedAt` is the face discriminator.** No `Extract`/`Exclude` gymnastics: a variant whose
  `recordedAt` is `never` is captured; one carrying an instant is queried.
- **`anyOf`, never `oneOf`.** A TypeScript union means "assignable to at least one member", and the
  members are not always disjoint — `Reason`'s two branches overlap on a code of `OTHER` with a
  remark, so `oneOf` would have rejected records the types admit. This nearly shipped as a bug.
- **`"field": false`** renders [SD §1.1]'s permanently-forbidden list mechanically, instead of leaving
  it to `additionalProperties` to refuse anonymously.
- **`$defs` names must survive instantiation.** `aliasSymbol` is _lost_ when a distributive
  conditional is instantiated, so `SubjectRef` was inlined fourteen ways; it is now recognised by
  shape and named by its canonical subject family (`SubjectRef.family.goods`). Compact output went
  810KB → 265KB. `SubjectRef.stop` is the **kind**; `SubjectRef.family.stop` is the **family**.
- **`checker.getUnionType` is internal API.** It runs and does not typecheck. The union branch of the
  converter already drops the `undefined` optionality adds, so no type surgery is needed.
- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point —
  prettier collapses short arrays onto one line — so the hook would have rewritten every file behind
  a green staleness run. Exactly §7's warning, one file type over.

### Two defects found and fixed on the way

- **`grep` silently matched nothing in `tools/generate-glossary.ts`.** The shell `grep` here is a
  ugrep wrapper with `-I`, and the file held **four literal NUL bytes** used as sort separators, so
  ugrep classified it as binary and skipped it — _exactly_ §7's "tamper attempts silently matched
  nothing". Replaced with `�` escapes; output byte-identical. **Use `/usr/bin/grep` when a
  negative result has to mean something.**
- **The glossary's citation regex swallowed across brackets.** `((?:\s|\])[^\]]*)?` let the `\]`
  branch eat a citation's own closing bracket and run on to the next, so a bare
  `[findings-from-alloy]` followed later by `[A8 §2]` rendered as one broken nested link. Now
  `(\s[^\]]*)?`. No existing entry changed — the glossary diff is purely additive.

### Still open, for whoever picks this up

1. **A4 — the reason vocabulary.** The single biggest gap in the published contract, and the evidence
   is already captured (§6 item 5 above). It needs its own decision document; it must not be filled
   in from the shape.
2. **F3, F4, F5** in `findings-from-alloy.md`. F5 touches the contract directly: role names are
   fact-key components, so filter axis 9 currently names a vocabulary whose canonical spelling is owed.
3. **The 19 owed authority rows**, which are what keeps this at `0.1.0`.
4. **Areas never written as comparisons:** A1, A2, A4, A5, A6, A7, A9.
5. **`alloy/run.mjs` is not prettier-clean** — pre-existing, untouched here, and outside lint-staged's
   globs (which cover `*.{ts,tsx}` and `*.{json,md,yaml,yml}`, not `.mjs`).
