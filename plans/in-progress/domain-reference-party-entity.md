# Domain reference — the party entity (`[A8 §9 item 1]`): plan and resumption state

**Written 2026-10-06**, to be read by a session with **no prior context**. Everything needed to resume
is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-roleclass.md`, whose round landed in full; the record
is `plans/completed/domain-reference-roleclass.md`, and its transferable lessons are carried into §3,
§4 and §6 of this file rather than left to be rediscovered.

---

## Resume here

**Checkpointed 2026-10-07.** Everything below was checked in the session that wrote it, not recalled.

### Where

- **Branch:** `chore/dr-party`, cut from `chore/parked-dr` at `main`'s head on 2026-10-07. This
  worktree's parked branch `chore/parked-dr` is left parked and untouched, per §9's last box — the
  owed-closures, context-map and `roleClass` rounds all worked on a branch in an existing worktree
  and it cost nothing.
- **Worktree:** `/home/steve/repos/pegasus-deps-advisory-flip` (Postgres `pegasus-pg-deps-advisory-flip`
  on port **5459**, migrations applied 2026-10-06 and current as of then).
- **Last commit:** `6f992717` — this round's first, carrying the previous session's resume
  checkpoint, over `be16d7d2` (`main`'s head, `#817`).

### Status — the planning pass has started; nothing is implemented

- [x] **§1.3 item 1 — DONE, and it refuted the question's own dichotomy. `§1.3.1` is the record.**
      Five of the attributes are `identity` assertions, **one** (`legal name`) is a field, and **two**
      (the branch grain, the hierarchy) are neither — they are already witnesses on the `agentCode`
      row plus a residue belonging to `[A8 §9 item 3]`. **And `[A8 §9 item 1]` omits a fifth
      party-grain scheme, `gbloc`.**
- [x] **§1.3 item 2 — answered for the assertion half by the same measurement.** `identity`'s
      canonical subject family is `anyAggregate`, whose membership **is** `AGGREGATE_KINDS`, so
      minting the member admits a party subject by construction: **no new record type, no new fact
      class, no new subject family.** What is left of item 2 is only `legal name`'s home.
- [x] **§1.3 item 4 — measured: `custody.ts`'s TODO does NOT come off**, it re-points. See §1.3.1's
      closing paragraph.
- [x] **§1.3 item 2, residue — ANSWERED: the round does NOT carry `legal name`.** `§1.3.1`'s
      `AMENDED 2026-10-08` block is the measurement. The name is blocked on `[A8 §9 item 3]`, is
      published as a **disjunction** ("legal **or** trade name"), and arrives bundled with an address
      the model has no aggregate for. It stays owed, now with the primary citation `[A8 §9 item 1]`
      never had.
- [ ] §1.3 item 3 — take or explicitly decline `[A8 §9 item 3]` (person vs organisation vs crew grain)
- [ ] §1.3 item 5 — is `[A8 §9 item 5]` (role cardinality) reachable once a party exists?
- [x] **§1.2 — DECIDED. `§1.2.1` is the record, written from the measured emitted diff.**
      `party` becomes the **fifteenth `aggregate` kind** (`newAggregateKind`, additive). **And the
      measurement refuted the planned fix for the brand collision**, which turns the round
      **breaking**: see below.
- [ ] implementation, gates, tamper pass, cross-area edits, round record
- [ ] **the ordinal sweep §1.3.1 found and enumerates** — `fourteen` / `fifteenth`, where half the
      hits for the word are a different claim wearing the same number; one of the real ones
      **renders into `glossary.md`**
- [x] **the `PartyId` brand collision — DECIDED, and it is REQUIRED rather than polish.** A8-SELF
      compares two parties, so the subject brand and the reference brand must be one or the round
      ships a capability it cannot prove. **`PartyId = AggregateId<'party'>` was measured and does NOT
      work** — it emits two byte-identical `$defs` under two names. The alias must be **deleted**,
      which removes the published `$defs/PartyId` that six defs reference, `AssertedBy` among them.
- [ ] **mint `removedPublishedDef` in `[catalog §2.3]`'s Breaking table** — no existing row
      fits, so this round mints a change class after all
- [ ] **version: `0.7.0`, not `0.6.4`** — breaking takes the minor slot pre-1.0 (`[catalog §2.3.1]`),
      and one `specVersion` carries both decisions
- [ ] **four defects found in passing** (§1.3.1's own list) — three counts and two colliding ordinals

**The previous round (`roleClass`) is fully landed and is NOT this round.** `plans/completed/domain-reference-roleclass.md`.

### Next action

**The planning pass is COMPLETE. Read `§1.3.1` then `§1.2.1`, in that order, and start
implementing — beginning with the ordinal sweep, NOT with the enum member.**

`§1.2.1`'s last subsection says why the sweep goes first: `custody.ts`'s `TODO` claims the ordinal
_"fifteenth aggregate kind"_ for a **place**, and the context map publishes that sentence verbatim,
so minting `party` as the fifteenth makes both wrong. Sweep first and the tree is never in a state
where two things claim one ordinal. **Prefer deleting each ordinal to incrementing it** (§3 item 10).

Then, in order:

1. **The ordinal sweep**, enumerated in `§1.3.1`'s defect 4 — and read each hit, because **half the
   hits for the word `fourteen` are a different claim wearing the same number** and must be left
   alone.
2. **Mint `'party'` in `AGGREGATE_KINDS`** with a JSDoc carrying a citation (§3 item 1 — no leading
   bold marker, `_x_` never `*x*`).
3. **`data/canonical-subjects.json`'s `families.anyAggregate.members`** — the home §1.2 and §1.3.1
   both missed, and the loader fails by name with the set difference. Measured, not predicted.
4. **Delete the `PartyId` alias**, repointing `AssertedBy`, `Attribution`, `CustodyHolder`,
   `IdentityValue`, `PartyRoleValue` and `VocabularyScope` to `AggregateId<'party'>`, and replace
   `partyId()`. **`tsc`'s 29 `TS2305`s are the checklist for this step** — they are import lines and
   nothing else; the whole semantic fan-out is one `TS2578` (§1.2.1).
5. **Take the five blockers off** `data/identity-schemes.json`, and **invert all three enforcement
   sites plus the `$comment`** — §1.3.1's "THREE things invert" list. `loadIdentitySchemes`'s two
   refusals are the ones most easily missed, because they are in `src/` and not in a test.
6. **Fix the two `six party-grain rows` docstrings** (§1.3.1 defects 1 and 2) — they contradict a
   live gate.
7. **Mint `removedPublishedDef`** in `[catalog §2.3]`'s Breaking table, bump
   `CATALOG_VERSION` to **`0.7.0`**, then `npm run glossary`, `npm run catalog`,
   `npm run context-map`, then the suite.
8. **Cross-area edits**: a marked `> **AMENDED 2026-10-08**` on `[A8 §9 item 1]` naming the **five**
   party-grain schemes (it omits `gbloc`) and recording the legal-name citation and its item-3
   blocker; re-point `custody.ts`'s `TODO` to items 2-3 rather than deleting it; `[catalog]`'s new
   row. **Then re-read the §Cross-area list in BOTH directions** (§3 item 14).

**Then** the tamper pass (§3 item 6 — commit first), the prose re-read after the LAST prose (§4), and
the round record.

### Uncommitted work

**None at the checkpoint.** The previous session's `/keep-going` checkpoint — this file's
`## Resume here` section — was committed as `6f992717` on `chore/dr-party` before any measurement was
taken, precisely so the round's starting state is in history rather than in a working tree. `§1.3.1`
and this section land with the commit after it.

**Nothing of the round's implementation exists**: `src/`, `data/`, `tests/` and the generated artefacts
are untouched, and no `AggregateKind` member has been minted. A _fresh worktree_ provisioned by
`scripts/workstream-start.sh` branches from `origin/main` and so would carry none of this; resume on
`chore/dr-party` in this worktree.

### In flight

**Nothing of this round.** Everything this session opened is merged and verified on `main`:

| PR   | What                                       | Merge commit |
| ---- | ------------------------------------------ | ------------ |
| #804 | the `roleClass` round, catalog `0.6.3`     | `89f4767a`   |
| #808 | `shell-quote >=1.11.0` — critical advisory | `1fd5f284`   |
| #807 | two new `GOTCHAS.md` entries               | `c60c00db`   |
| #810 | both resume points refreshed               | `fb57d5ae`   |

Re-check with `gh pr view <N> --json state,mergedAt,mergeCommit`. No branches of mine survive; no
watchers, deploys or queue entries are outstanding.

### Decisions & dead ends from the session that wrote this

- **`chore/parked-dr` was fast-forwarded to `main`** so this worktree's files are current. It had no
  commits of its own, so this restores its parked meaning rather than changing anything.
- **`.claude/skills/keep-going/` does not exist on `chore/parked-dr`'s old tip**, which is why the
  skill was not loadable until the fast-forward. If a skill the repo has is missing from a session,
  check whether the worktree is behind.
- **Two worktrees were deliberately left alone** on the user's instruction: `pegasus-a9-identity`
  (#746 merged) and `pegasus-ringcentral-forward-skip-unconfigured` (#728 merged) both hold
  merged-and-deleted branches and are teardown candidates for a session that owns them
  (`scripts/rm-worktree.sh <slug>`). `pegasus-retire-workflow` is **live** — do not touch.
- **Eleven merged local branches were deleted; four were kept and why matters.**
  `chore/enable-ses-invite-email` is PR #145, on hold for the SES sandbox.
  `chore/archive-feedback-requests-plan` is PR **#536 CLOSED UNMERGED** — a `gone`/deleted remote ref
  and a closed-unmerged PR look identical from `git branch -vv`, so **verify PR state, never the
  tracking marker**. (Its one commit is a stale rename of a file `main` already has, so it is moot.)
  `pr505` has no upstream and one commit not on `main`; unverifiable, so left.

### Gotchas the next step depends on

- **§0's numbers were re-measured 2026-10-07 and all still hold**: catalog `0.6.3`, 34 published record
  types, 33 of 87 sources analysed, 14 rounds landed, owed vocabularies
  `identityScheme` / `roleClass` / `unitOfMeasure` with **two refused** and `unitOfMeasure` the only
  `pending` one. **No other session has touched `docs/domain-reference` or
  `packages/domain-reference` since #804** — verified with
  `git log 89f4767a..HEAD -- docs/domain-reference packages/domain-reference`, whose only hit is #810.
- **`npm install` is already current in this worktree** after the fast-forward (`npm install --dry-run`
  changes 1 package; `shell-quote@1.12.0` resolved). A _fresh_ worktree will need a real `npm install`.
- **Read §6's "Workflows and CI" before pushing anything.** A `docs/` + `packages/domain-reference/`
  PR path-filters `Lint` away, passes every branch check, and can then be **ejected** from the merge
  queue by a pre-existing `main` failure. Check `main`'s head first:
  `gh api "repos/DolasDev/pegasus/commits/$(git rev-parse origin/main)/check-runs?per_page=50"`.
- **`Dependabot Updates` is still failing** (since 2026-10-05), so no bot PR no longer means no
  advisory. #816 added a daily `audit-ci` run on `main` that files an issue, which mitigates but does
  not fix it. Run `npx --no-install audit-ci --config ./audit-ci.jsonc` before enqueuing.
- **Never commit `apps/api/vitest.config.ts`.** Running the api suite locally lets the coverage
  ratchet raise the floors, and a locally-measured floor ejects a later PR.
- **`tests/conformance/identity-scheme-refuses.ts` is written to be INVERTED by this round** — its
  `@ts-expect-error` on `partyIsNotAnAggregate` stops compiling the day `party` becomes an
  `AggregateKind`. That is the deliverable, not an obstacle.

### Verification still owed

Nothing for this round — it has not started. The gate commands are in §2; `tsc`, `eslint`, the vitest
suite, Alloy, the three generators and `prettier --check` were all green at `#810` and nothing has
touched the package since.

---

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

### 1.2.1 THE DECISION — taken 2026-10-08, from the measured emitted diff

**Both halves below were measured by patching `src/ids.ts`, running `npm run catalog`, reading
`git diff` over `docs/domain-reference/catalog/`, and reverting.** §3 item 8 says read the diff
before classifying, and it has now located something the decision did not predict **four rounds
running** — this time it refuted the fix, not the deliverable.

#### Decision 1 — `party` becomes the fifteenth `aggregate` kind. `newAggregateKind`, additive.

The question `ids.ts` asks is answered **"a fifteenth aggregate kind"**, and nothing in the round
rests on judgement:

- `[SD §1.2]` states the permission outright — the enum is _"open to **addition** in a later
  `specVersion`, never to reinterpretation"_.
- `identity`'s canonical subject family is `anyAggregate`, whose membership **is** `AGGREGATE_KINDS`,
  so the five `party`-grain schemes become assertable **by construction** (§1.3.1).
- `[A9 §3.6]` item 2 rules out the one alternative a reader reaches for: `partyRole` _"would key it
  on a tuple it does not vary with"_, because a SCAC belongs to the company whatever it is doing.
- **Staying outside the subject enum** is the state `[A9 §3.6]` already records **as a defect rather
  than a design**, so it is not a live branch.

**The emitted diff, measured and purely additive** — nothing removed, nothing repointed, on **both**
faces:

- a new `$defs/AggregateId.party` — `{"type":"string","x-brand":"id:party","x-aggregate":"party"}`
- a new `$defs/SubjectRef.party`, and **it discriminates**: `"aggregate": {"const": "party"}`. §3
  item 8's warning that _"a new `anyOf` branch is not necessarily a discriminating one"_ was checked
  rather than assumed.
- one new branch in `SubjectRef`'s `anyOf`, and one new `$ref` from
  `$defs/SubjectRef.family.anyAggregate`
- in `index.json`, exactly one line: `identity`'s subject list gains `party`. **That single line is
  the deliverable** — five schemes becoming assertable, visible on the wire.

**Class: `newAggregateKind`.** It already exists, so this is the first round since A5 that mints no
change class — provided Decision 2 does not need one, which is the next subsection. Under
`[catalog §2.3.1]` additive takes the **patch** slot: `0.6.3` → **`0.6.4`**.

#### Decision 2 — the `PartyId` brand, and the measurement REFUTED the planned fix

**This is required, not polish, and the round's own deliverable is what requires it.** §3 item 22
says publishing a value makes old claims testable, and names this round's instance: **A8-SELF** — _"a
party holding two roles does not corroborate itself"_ — becomes testable for the first time. A8-SELF
is a **comparison of two parties**. If the party-as-subject and the party-as-reference are different
branded types, that comparison does not typecheck, and the round would ship the capability it claims
while making the claim unprovable. So the brands must be one.

**The planned fix was `PartyId = AggregateId<'party'>`. Measured, it does not work** — and this is
the round's plan-was-wrong finding:

> `generate-catalog.ts`'s `refineName` names a branded `$def` `<alias>.<brand-suffix>`, and the
> generator emits **one `$def` per exported type alias**. So aliasing `PartyId` to
> `AggregateId<'party'>` publishes **two `$defs` with byte-identical bodies under two names** —
> `AggregateId.party` **and** `PartyId.party`, both
> `{"type":"string","x-brand":"id:party","x-aggregate":"party"}` — while `#/$defs/PartyId` **ceases
> to exist** and the six defs that referenced it repoint to `PartyId.party`. **It trades two brands
> for one concept for two `$defs` for one concept, and dangles a published `$ref` as well.**
> Re-measured with `export type { PartyId }` instead of an inline export: **identical result**, so
> it is the alias that is emitted and not the export syntax.

**So the only arrangement that publishes one party id is to DELETE the `PartyId` alias** and have its
referencing sites name `AggregateId<'party'>` directly. On the wire that leaves `AggregateId.party`
alone — and it **removes the published `$defs/PartyId`**, which six published defs reference:
`AssertedBy`, `Attribution`, `CustodyHolder`, `IdentityValue`, `PartyRoleValue` and
`VocabularyScope`. **`AssertedBy` is on every envelope**, so `PartyId` is reachable from every record
the catalog publishes.

**Class: `[catalog §2.3]` has no row for this, in either table — so the round mints one after all.**
Neither `newAnnotation` (nothing is added; a published `$def` is **removed**) nor any Breaking row
fits: `removedOrRenamedRecordType` is about a `type` and its "why" is _"it is a fact key component"_,
which a `$def` name is not; the rest are about families, qualifiers, obligations, meanings and role
spellings.

**Name it for what it does, and say WHICH READER breaks — because the two answers differ.** The
change is a published `$def` removed and six `$ref`s repointed: `AssertedBy`, `Attribution`,
`CustodyHolder`, `IdentityValue`, `PartyRoleValue` and `VocabularyScope` stop pointing at
`#/$defs/PartyId` and point at `#/$defs/AggregateId.party`.

- **A validator does not break.** Both targets are `{"type": "string"}`, so **every record that
  validated still validates** — which is the exact test every §2.3 **additive** row turns on.
- **A `$ref`-following schema reader does break.** `#/$defs/PartyId` ceases to exist, so anything
  that dereferences it by name — codegen, a doc tool, a pinned fragment — dangles.

**So it is breaking, and the reader it breaks is the schema reader rather than the record.** The row
must say so, because reading `[catalog §2.3]`'s mechanical test alone would classify this additive
and be wrong. Proposed name: **`removedPublishedDef`**, _why breaking_: _"a `$ref`-following reader
dangles; records are unaffected"_. `[catalog §2.3]`'s Breaking table is edited to carry it (§3 item
14 — if your decision narrows a sentence in `[catalog]`, edit `[catalog]`).

**Breaking takes the MINOR slot pre-1.0 — so the round publishes `0.7.0`, not `0.6.4`.** One
`specVersion` names a published state rather than a piece of work (§3 item 5), so `0.7.0` carries
**both** decisions: `newAggregateKind` and `removedPublishedDef`.

> **And the cost argument for doing it now is NOT that later is dearer — that would be wrong.**
> `[catalog §2.3.1]` makes breaking cost the minor slot for as long as the major is `0`, and
> `[catalog §2.4]` forbids `1.0.0` until §5's inventory is discharged, which is far off. **This round
> and a later round pay the same slot.** The argument for now is that the alternative **publishes a
> defect**: two branded types for one real-world identifier, which is the crosscheck's own finding
> one level up — _"all carry denormalised name+id string pairs on a flat row"_ — committed by the
> document that exists to catch it. And `PartyId`'s docstring justification evaporates the moment
> Decision 1 lands: it reads _"an identifier with no aggregate behind it"_, and after Decision 1
> there is one.

#### What Decision 2 does NOT license

- **It is not a rename of `assertedBy.party`.** `[SD §1.1]` quotes the shape as `{partyRef, role}`
  while the code declares `party` (§1.3.1's recorded drift). **Leave it.** Renaming a field on every
  envelope is `changedFieldObligation`-adjacent and belongs to whichever round repairs the citation.
- **It is not a `place` aggregate.** `custody.ts`'s `TODO([SD §1.2] / A3)` wants one, §1.3.1 found
  the legal name arrives bundled with a physical address that would need one, and **this round mints
  exactly one member.** A second would make Decision 1's ordinal wrong twice over.
- **It does not discharge `[A8 §9 item 1]`.** The item gets a marked annotation, not a closure, and
  **the annotation must state the residue rather than the word "partially"** — otherwise the next
  session re-derives what §1.3.1 already measured. **After this round `[A8 §9 item 1]` owes exactly
  three things, and each with its blocker:**
  - **`legal name`** — blocked on `[A8 §9 item 3]`: `src:sirva-ade`'s `Resource.Name` names a
    company, a person or a tractor, so the party must be defined before it can be named. Published
    as a **disjunction** and bundled with an address besides.
  - **the branch grain** — `[A8 §9 item 3]`'s too, and the identifier already carries it
    (`agentCode`'s trailing three digits), so what is owed is the **grain question**, not a field.
  - **the hierarchy** — owed with **no blocker of the same kind**: `parentAgentCode` is a party→party
    relation and **no `AssertionType` holds one**. It is not waiting on item 3; it is waiting on a
    fact class that does not exist.

  **And what it no longer owes:** the `subject` for the five `party`-grain schemes, and
  `assertedBy`'s target schema. Those are this round's, and the annotation says so.

#### The cost, MEASURED rather than asserted — and the suite found a home §1.3.1 missed

The first write-up of this decision said _"`tsc` is the checklist here"_ **without having run it**.
Run now, in two variants, because the variants separate mechanical repair from real fan-out.

**Variant A — delete the `PartyId` alias (the shipping shape): `tsc` reports 30 errors**, and the
breakdown is the point rather than the total: **29 are `TS2305`** _"module has no exported member"_ —
one import line per file across `src/assertions.ts`, `src/custody.ts`, `src/envelope.ts`,
`src/identity.ts`, `src/outcomes.ts`, `src/rules/authority.ts`, `src/rules/corrections.ts`,
`src/rules/e-canon.ts` and twenty-one test files. **Mechanical, and they mask whatever is behind
them.**

**Variant B — retype the alias in place (`PartyId = AggregateId<'party'>`), so every import still
resolves: `tsc` reports EXACTLY ONE error.**

```
tests/conformance/identity-scheme-refuses.ts(65,1): error TS2578: Unused '@ts-expect-error' directive.
```

**That is `partyIsNotAnAggregate`, and it is the whole compile-time fan-out.** So the two decisions
together break **no `Exact<>`, no `satisfies` clause and no other `@ts-expect-error`** — the thing
worth knowing, and the thing variant A's 29 import errors would have hidden. §1.3.1's
"THREE things invert" list is confirmed complete **at the type level**.

**At RUNTIME it is not complete, and this is the finding.** The suite in variant B reports **16
failures**, and they have one root cause plus three consequences:

> **`data/canonical-subjects.json` carries `families.anyAggregate.members` as a hand-written literal
> copy of the whole enum, written out member by member, and the loader cross-checks it against
> `SUBJECT_FAMILIES.anyAggregate` as a set.** `loadCanonicalSubjects` throws `DataDefect` by name —
> _"`canonical-subjects.families.members.anyAggregate.members`: is [order, …, externallyPerformedLeg]
> where `SUBJECT_FAMILIES.anyAggregate` is [order, …, externallyPerformedLeg, party]"_ — which takes
> `vocabulary.test.ts` down at **file load** and fails eleven `data-tables.test.ts` cases behind it.

**So the aggregate-kind enumeration has a home in `data/` that neither §1.2 nor §1.3.1 named.** That
is §3 item 2 (_"fill the per-member table in `data/` and extend the loader"_) and §3 item 9 (_"a data
table may have more than two homes"_) arriving together, and the gate is **enumerated and names the
set difference**, which is why it took one read rather than a debugging session.

The other three failures are expected and are not defects: the **three generated artefacts** stop
being fixed points (`catalog`, `context-map`, `glossary` — _"is committed in the state the generator
produces"_), and the **disclosure gate** fails because the experiment's member carried
`/** EXPERIMENT */` rather than a JSDoc with a citation (§3 item 1).

**The implementation checklist that follows from the measurement**, in the order the gates force:

1. the ordinal sweep (below — it goes first);
2. `'party'` into `AGGREGATE_KINDS` **with a JSDoc carrying a citation**;
3. **`data/canonical-subjects.json`'s `anyAggregate.members`** — the home the plan missed;
4. delete the `PartyId` alias and repoint the six declaring sites plus `partyId()`; **variant A's 29
   `TS2305`s are the checklist for this step and nothing more**;
5. the five blockers, the three enforcement sites and the `$comment` (§1.3.1);
6. regenerate all three artefacts, bump to `0.7.0`, re-run.

#### The first implementation step is the ordinal sweep, not the enum member

§1.3.1 enumerated it; Decision 1 is what makes it due. **`custody.ts`'s own `TODO` says a place _"is
either a fifteenth aggregate kind or an attribute of a Stop"_, and the context map publishes that
sentence verbatim** — so the moment `party` is the fifteenth, that TODO and the context map are both
wrong. Sweep first, then mint, so the tree is never in a state where two things claim one ordinal.
**And prefer deleting each ordinal to incrementing it** (§3 item 10): `generate-glossary.ts`'s
`aggregate` blurb renders its count into `glossary.md`, and the glossary enumerates the members
immediately below it.

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

### 1.3.1 THE MEASUREMENT — taken 2026-10-07, and it refutes §1.3 item 1's dichotomy

**§1.3 item 1 asked a binary question — field or `identity` assertion — and the corpus answers in
three buckets.** **The branch grain** and **the hierarchy** are neither: they are already _witnesses
on one scheme row_ plus a residue that belongs to a different owed item. **Legal name** is a field
with nowhere to go. And the enumeration itself is wrong in one direction: **`gbloc` is blocked on
this item and `[A8 §9 item 1]` does not name it.**

> **Do not tally this section.** `[A8 §9 item 1]`'s prose and the scheme table disagree about what
> the set even is, in **both** directions — A8 writes "DOT/MC number" as one phrase where the table
> carries `usDotNumber` and `mcNumber` as two rows, and A8 omits `gbloc` which the table carries and
> blocks on this very item. So "the party's attributes" has no single cardinality to count, and every
> claim below is enumerated by name instead (§3 item 10).

Measured against `packages/domain-reference/data/identity-schemes.json` (its five rows whose
`identifies` is `party`), `[SD §7.1]`'s identifier shape, and `src/vocabulary.ts`'s
`CANONICAL_SUBJECT_FAMILY` / `SUBJECT_FAMILIES`.

| What `[A8 §9 item 1]` names   | Where it lands                                                                                                    | The evidence                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SCAC**                      | `identity` assertion, `subject` = the party                                                                       | the `scac` row — six witness rows, four publishing bodies, `definedNotMerelyNamed: false`                                                                                                                                                                                                                                                                                                            |
| **DOT number**                | `identity` assertion                                                                                              | the `usDotNumber` row — `src:cfr-49-375` Appendix A item 2, captured and primary                                                                                                                                                                                                                                                                                                                     |
| **MC number**                 | `identity` assertion                                                                                              | the `mcNumber` row — kept separate because the regulation offers the two as **alternatives**, which under **I-KEY** makes two vocabularies rather than two values                                                                                                                                                                                                                                    |
| **agent code**                | `identity` assertion                                                                                              | the `agentCode` row — `authority: "the van line"`, `definedNotMerelyNamed: true`                                                                                                                                                                                                                                                                                                                     |
| **the branch grain**          | **neither** — already inside `agentCode`, plus a grain question that is `[A8 §9 item 3]`'s                        | the `agentCode` row's own note: _"the code CARRIES the branch, so the identifier encodes a hierarchy the model would otherwise have to store"_. `src:sirva-ade`'s trailing three digits are **part of the id**, so nothing is left to carry as a field. The residue — _is a branch its own party?_ — is a question about the **subject's grain**, which is item 3's                                  |
| **the hierarchy**             | **neither** — also inside `agentCode`'s witnesses, and the rest is a party→party **relation** no fact class holds | the same row's second witness: `src:atlas-world-group-api`'s `parentAgentCode` and `/Agents/{agentCode}/Family`, **column names only**. A parent-of edge is not an `identity` assertion (it names no scheme and assigns no id) and not a field on either party (it is symmetric debt between two). **No `AssertionType` in `src/vocabulary.ts` takes it**                                            |
| **legal name**                | **an attribute whose GRAIN is undecided** — not a field, not an assertion. **AMENDED 2026-10-08**, below          | no row of the twenty is a name scheme, and no member of `ASSERTION_TYPES` carries a name of anything. The crosscheck's finding, quoted in item 1 itself, is that SIRVA, Atlas and pegII _"all carry denormalised name+id string pairs on a flat row"_. The 2026-10-08 measurement went to the primary bytes and found the shapes **disagree**, which the phrase "denormalised string pairs" conceals |
| _(not named by A8)_ **GBLOC** | `identity` assertion — **and `[A8 §9 item 1]` omits it**                                                          | the `gbloc` row, blocked on this item, `definedNotMerelyNamed: true`. `[A9 §3.6]`'s set is _"`scac`, `usDotNumber`, `mcNumber`, `gbloc` and `agentCode`"_ — five, enumerated by name in `identity-schemes.test.ts` — while A8's prose names four                                                                                                                                                     |

> **AMENDED 2026-10-08 — the `legal name` row, measured against the primary bytes.**
>
> The table's first pass called `legal name` a **field**, on the ground that nothing else in the model
> could hold it. **That was an inference from the model's own silence, not a measurement of the
> corpus**, and it is the defect `[SD §0]`'s disclosure rule exists to stop: no source was cited for
> it, because `[A8 §9 item 1]` cites none either — it cites `src:dtr-part-iv` for SCAC,
> `src:sirva-ade` for the branch grain and `src:atlas-world-group-api` for the hierarchy, and **"legal
> name" is the one attribute in its own list with no citation at all.**
>
> **It has one now, and it is primary and captured.** `src:cfr-49-375`, read from
> `captured/cfr-49-375.xml` rather than from an analysis, publishes the requirement **three times in
> two independent places** — and headings, not line numbers (§5's last bullet):
>
> - **§ 375.505 _"Must I write up a bill of lading?"_ (b)(1)** — _"Your legal or trade name (i.e.,
>   doing business as name) **as it is registered with FMCSA**, to include your physical address."_
>   The binding rule, first of the seventeen items a bill of lading must carry.
> - **Appendix A → _"Bill of Lading"_ item 1** — the **same** requirement restated for the consumer.
>   **Not an independent witness**, and must not be counted as one.
> - **Appendix A → _"Bill of Lading"_ item 2** — _"The **names**, telephone numbers, addresses, and
>   USDOT Numbers of any motor carriers, when known, who will participate in transportation of the
>   shipment."_ A **different** requirement: the participating carriers, plural, name paired with
>   USDOT.
> - **§ 375.207 _"What items must be in my advertisements?"_ (b)(1)** — _"Your name or trade name, **as
>   it appears on our document assigning you a U.S. DOT number**"_. A different context again, and the
>   one that **couples the name to the USDOT registration** rather than to the party.
>
> And a second publisher corroborates the coupling at `secondary` grade — `src:dp3-tender-of-service`
> §B.3.f p.19, obligation row 10: the TSP must record the _"legal name and US DOT number of the
> service provider **actually hauling** the shipment"_ within 2 GBD, **in DPS General Remarks**.
> Graded `secondary` deliberately: that source has **no `captured/` and no `local/` directory**, so
> the sentence is quoted from its own `analysis.md` and the rule in `data/identity-schemes.json`'s
> `$comment` applies.
>
> **Three findings, and the third decides §1.2.**
>
> 1. **What the regulation publishes is a DISJUNCTION, not a field.** _"legal **or** trade name (i.e.,
>    doing business as name)"_ — two kinds of name, offered as alternatives, with DBA named as the
>    second. A record with one `legalName: string` slot flattens that, and the table already contains
>    the house ruling on exactly this shape: the `mcNumber` row is separate from `usDotNumber`
>    _"because the regulation offers them as alternatives, which under **I-KEY** makes them two
>    vocabularies and not two values"_.
> 2. **It arrives bundled with an address, which the model cannot hold either.** Both statements of
>    the rule end _"to include its physical address"_, and `[SD §1.2]` has no `place` aggregate —
>    `custody.ts`'s own `TODO([SD §1.2] / A3)` says a place _"is either a fifteenth aggregate kind or
>    an attribute of a Stop"_. So carrying the name as published needs a second owed aggregate.
> 3. **THE DECIDING ONE: the name is blocked on `[A8 §9 item 3]`, not on item 1.**
>    `src:sirva-ade`'s `Resource` is `{Id, Name, Type, Owner}`, and its own contract says `Id` _"can
>    contain agent, vendor, driver **or equipment** code based on the resource `Type`"_ — so `Name`
>    names **whatever `Type` says**: a company, a person, or a **tractor**. The grade-A partner
>    contract that has a name field is the same one that fuses the three grains. **Naming a party
>    requires first deciding what a party is**, which is `[A8 §9 item 3]` verbatim. `src:atlas-world-group-api`
>    is no help: it has a party **record** with temporal validity (`AgentModel`,
>    `CompanyModel.effectiveDate`/`expirationDate`) and **no visible name field**, and `[SD §0]` holds
>    that its vocabulary is _"not merely unfetched but unpublished"_, so nothing may be scheduled
>    against fetching it.
>
> **One parallel recorded and REJECTED, because the next session will reach for it.** _"As it is
> registered with FMCSA"_ makes FMCSA an `authority` in `[SD §7.1]`'s exact sense, and the alternatives
> test above is the table's own. Both tempt toward minting a `legalName` **scheme** and filing the name
> as an `identity` assertion. **It is still wrong:** `[SD §7.1]` defines a scheme as _"the naming
> system, which DEFINES who assigns and what it identifies"_, and **a name does not identify.** The
> `scac` row's six witnesses cite the code **because** it identifies a carrier uniquely; nothing in
> `src:cfr-49-375` says a name is unique, and two carriers may trade under one name in two states.
> FMCSA registering a name makes FMCSA an authority **without making the name an `id`**.

#### The answer, stated so the next step can use it

**`scac`, `usDotNumber`, `mcNumber`, `agentCode` and `gbloc` are `identity` assertions whose
`subject` is a party — the table's whole `party`-grain set, gated by name. `legal name` is a field.
The branch grain and the hierarchy dissolve.** And the assertion half needs **nothing minted beyond
the enum member itself**, which is the measurement's sharpest result:

> `src/vocabulary.ts` declares `identity`'s canonical subject family as **`anyAggregate`**, whose
> membership is `AGGREGATE_KINDS` **itself** — quoted from `[SD §7.1]`, _"`subject` may be **any**
> aggregate kind"_. So the moment `party` is a member of that enum, `Assertion<'identity'>` admits a
> party subject **by construction**. There is nothing to widen, no family to extend, and no row to
> add to `CANONICAL_SUBJECT_FAMILY`.

**That answers §1.3 item 2 before it is asked, for the assertion half.** Minting the `AggregateKind`
member is the whole mechanism for all five schemes: **no new record type, no new fact class, no new
subject family.**

> **It is not, however, "no new machinery" — there is one brand collision and it is §1.2's cost, not
> a detail.** `PartyId` is `Brand<string, 'party'>`, while `AggregateId<'party'>` would be
> `Brand<string, 'id:party'>`. So the moment `party` is a kind, **one identity record carries two
> different brands for the same concept**: `subject` as `AggregateId<'party'>` beside `issuer` and
> `vocabularyScope.authority` as `PartyId`. Two branches, and the round must pick one in writing:
>
> - **`PartyId` becomes `AggregateId<'party'>`** and `partyId()` becomes `makeId('party', …)` — one
>   concept, one brand. The alias is referenced from `data.ts`, `ids.ts`, `custody.ts`,
>   `outcomes.ts`, `envelope.ts`, `assertions.ts`, `identity.ts` and `rules/`'s
>   `identity-schemes.ts`, `authority.ts` and `corrections.ts`, plus two `tests/conformance/*-refuses.ts`
>   files, `context-map.test.ts` and `generate-context-map.ts` — wide, and probably breaking nothing.
>   **Read the emitted schema diff before believing that** (§3 item 8): the question is whether
>   either brand reaches the wire.
> - **Both brands coexist**, with a stated reason — which would need one, since a reader meeting both
>   on one record will otherwise read the difference as meaningful.
>
> Measured, not decided here. It belongs to §1.2 and is a cost §1 did not carry.

#### What the measurement hands forward, and what it deliberately does not decide

1. **ANSWERED 2026-10-08: the round does NOT carry `legal name`, and the reason is sourced rather
   than scope control.** The AMENDED block above is the measurement. The name is blocked on
   `[A8 §9 item 3]` — a party that cannot tell a company from a tractor cannot be named — it is
   published as a **disjunction** rather than a field, and it arrives bundled with an address the
   model has no aggregate for. Choosing one of those shapes would be the `[ORIGINAL]` guess
   `[SD §0]` forbids. **It stays owed on `[A8 §9 item 1]`, now with the citation item 1 never had.**

   > **And there is a THIRD branch that typechecks today, which is why it has to be ruled out in
   > writing rather than left unmentioned.** `SchemeName` is `OwedCode<'identityScheme'>` and
   > `schemeName(raw)` casts **any** string, so an identity assertion under a `legalName` scheme
   > compiles right now. **It is still wrong**: `data/identity-schemes.json` is the catalogue of what
   > the **external corpus witnesses** — `[A9 §3.2]` refuses to close `identityScheme` precisely so
   > the table is never read as the list of schemes that exist — and no source publishes a legal name
   > as a scheme-assigned identifier. Minting one would be the `[ORIGINAL]` guess `[SD §0]` forbids,
   > reached through a cast rather than through a decision. Say so where a reader will meet it.

2. **The branch grain and the hierarchy must not be described as discharged by this round.** The
   first is `[A8 §9 item 3]`'s and the second has no fact class; §1.3 item 3's warning —
   _"a party entity that cannot tell a company from the individual who signs would not discharge
   `[A8 §9 item 3]`"_ — applies verbatim to claiming either.
3. **`[A9 §3.6]` overclaims against `[A8 §9 item 1]`, by one row.** Its opening says item 1 _"already
   names these very identifiers among its fields"_. It names four of the five; **GBLOC it does not
   name**, and A9's own §3.6 closing paragraph and `[SD §7.2]`'s A9 note both rely on GBLOC being
   one of them. The house fix is a marked `> **AMENDED 2026-10-07**` on `[A8 §9 item 1]` naming the
   five, **not** a rewrite and **not** an edit to A9 — §3 item 14.

#### Four defects found on the way, three of them counts

None was predicted by this plan, and all four are §3 item 10's shape.

1. **`data/identity-schemes.json`'s `gbloc` note says _"one of the six party-grain rows"_. There are
   five**, and `[A9 §3.6]` names five. Not emitted — a note body reaches no generated artefact — so
   the fix costs no bump.
2. **`src/data.ts`'s `SchemeSubject` docstring says _"six of the table's rows identify a party"_.
   Same defect, same five, second home.** §3 item 9's rule generalises: a **count** may have more
   than two homes too. Also not emitted; the context map carries only the citations off that
   docstring (`data.ts:SchemeSubject.aggregate`), not its prose.

   > **And both contradict a LIVE gate rather than merely being stale.**
   > `identity-schemes.test.ts`'s test is titled _"exactly five rows identify a party, and they are
   > named"_ and asserts the five by name. So this is not a count nobody is keeping — it is a count
   > kept **correctly in a gate and wrongly in two docstrings**, which is the inverse of §3 item 10's
   > usual failure and worth saying out loud: a passing suite did not protect the prose.

3. **`tools/generate-glossary.ts`'s `aggregate` blurb says _"The fourteen members of `[SD §1.2]`'s
   versioned closed enum"_, and it RENDERS** — `docs/domain-reference/glossary.md`. A hand-written
   count inside a generator, ungated, which minting a fifteenth member makes wrong in the published
   artefact. §3 item 10's remedy is to delete it rather than increment it; the glossary enumerates
   the members immediately below, so the count carries nothing.
4. **Two independent `TODO(…)`s each claim the SAME ordinal.** `ids.ts`'s says the party may become
   _"a fifteenth aggregate kind"_; `custody.ts`'s says a **place** is _"either a fifteenth aggregate
   kind or an attribute of a Stop"_ — and the **context map publishes custody's text verbatim** in
   its debt section. Whichever lands first makes the other's ordinal wrong, which is §4's
   _"an ordinal is usually a count someone else is keeping differently"_ with both keepers inside
   this package.

   **The sweep, enumerated — and a `grep` for the word is NOT the sweep.** `fourteen` appears in
   eleven files and **only these say "fourteen aggregate kinds"** or a paraphrase of it:
   `src/vocabulary.ts`, `src/rules/charges.ts`, `tests/conformance/charge-collection-refuses.ts`,
   `tools/generate-catalog.ts` (twice — "fourteen aggregate id types" and "the fourteen-member
   envelope union"), `tools/generate-glossary.ts` (defect 3, which renders into `glossary.md`),
   `[A7]` and `[SD]`. The other hits are **different fourteens and must be left alone**: `[A6]`'s is
   fourteen _named instruments_, `[A9]`'s two are fourteen _registry pairs_ (and its second hit is
   A9 retracting that very number), and `[A8]`'s two count the owed **authority rows** of its own §9
   item 8 ledger (_"Twelve of the fourteen that remain are blocked on the corpus"_). `fifteenth`
   is the smaller and cleaner set — `src/ids.ts`, `src/custody.ts`,
   `tests/conformance/identity-scheme-refuses.ts`, `context-map.md`, `[A8]` and `[A9]` — and every
   one of those six is about an aggregate kind.

   So the blast radius of minting a member is a real ordinal sweep and a real cost input into §1.2
   that §1 did not cost — **and the sweep has to be read, not grepped**, which is §4's lesson one
   level in: half the hits for the word are a different claim wearing the same number.

#### THREE things invert, not one — §6's list is short by two

§6 and §1.2 both name `identity-scheme-refuses.ts`'s `partyIsNotAnAggregate` as the gate written to be
inverted by this round. **It is one of three, and the other two are enforcement rather than a
compile-time witness**, so a round that inverts only the named one leaves the suite red for reasons it
did not predict:

1. **`tests/conformance/identity-scheme-refuses.ts`** — `partyIsNotAnAggregate`'s `@ts-expect-error`
   goes unused (`TS2578`). The one §6 names.
2. **`identity-schemes.test.ts`'s blocker invariant**, whose own comment says so:
   _"If a later round mints the party, these blockers come off and this fails by name."_ It asserts
   every `party` row carries `[A8 §9 item 1]` **and** every aggregate row's blocker is `null`, so it
   fails from both sides once the blockers come off.
3. **`loadIdentitySchemes`'s two load-time refusals** — it throws on a `party` row with no blocker and
   on `[A8 §9 item 1]` written onto an aggregate-grain row, and **both have their own tamper tests**.
   Taking the blockers off makes the first refusal reject the corrected data. This is the one most
   easily missed, because it is in `src/` and not in a test file.

**And the `$comment` at the head of `data/identity-schemes.json` states the premise in prose** —
`identifies` is _"an `[SD §1.2]` aggregate kind or the literal `party`, which is not one"_ — so it is a
fourth place the decision has to reach, with no gate on it at all.

#### One drift recorded and deliberately not fixed

**`assertedBy.partyRef` names a field the code spells `party`.** `[SD §1.1]` quotes the shape as
`{partyRef, role}`; `src/envelope.ts`'s `AssertedBy` declares `readonly party: PartyId` — and
`[A8 §9 item 1]`'s first sentence and `rules/authority.ts`'s closing `TODO([A8 §9 items 1-3, 5])`
both cite `partyRef`. **Renaming the field is breaking and out of this round's scope**; recorded so
a later round does not read the citation as naming a field that exists.

#### And one thing this round must not claim, measured rather than assumed — §1.3 item 4

**`custody.ts`'s `TODO([A8 §9 items 1-3])` does not come off.** Its `CustodyHolder` union exists
because `[SD §4.8.3]` returns `holder` as a **`partyRole`** while `[SD §8.2]`'s `performedBy` is a
**party**; minting the party aggregate gives the second a subject and **does not resolve one to the
other**. That resolution is the person-vs-organisation grain, i.e. item 3. Expect to **re-point**
the marker, not delete it — and re-pointing is a real deliverable only under §3 item 16's test
(what the item is owed **for** has changed), which here it has: the TODO currently names item 1
among its blockers and after this round it would not.

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
