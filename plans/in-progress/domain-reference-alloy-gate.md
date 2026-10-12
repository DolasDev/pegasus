# `alloy` — stop the Alloy specs drifting from the vocabulary, and decide whether they run in CI

**Branch:** `feat/dr-alloy-gate`, off `origin/main` at **`e65c5edc`**.
**Worktree:** `/home/steve/repos/pegasus-deps-advisory-flip` (the long-lived domain-reference
worktree). Postgres not needed.
**Goal:** `packages/domain-reference/alloy/subject-admission.als` enumerates fact classes **by hand**
and had silently fallen three behind the vocabulary. Add the missing declarations **and** gate the
list so it cannot drift again. Then decide, separately, whether the analyzer itself runs in CI.

---

## Resume here — checkpoint 2026-10-12 (second, after steps 1-2)

### Where

- **Branch `feat/dr-alloy-gate`** → **PR #837**, three commits:
  - `df418920` the spec + the gate (`subject-admission.als`, `tests/conformance/alloy-vocabulary.test.ts`)
  - `5ace5b09` this plan + archiving the [A10] round
  - `5f13116c` `GOTCHAS.md` + `PATTERNS.md`
- **CI green on PR #837, and the gate was confirmed in the log rather than from the badge:**
  `✓ tests/conformance/alloy-vocabulary.test.ts (10 tests)` under `@pegasus/domain-reference:test`.
  `ci.yml:489` runs `turbo run test` **unfiltered**, so the package is always in scope.
- **Steps 1 and 2 are DONE and verified.** **Step 3 is NOT, deliberately** — see below.
- `chore/parked-dr` was re-parked at `origin/main` (`e65c5edc`); it had been left behind at
  `9d105a19` while `#835` and `#836` landed.

### Status

- [x] **The defect is measured** — see "The measurement".
- [x] **Root cause established:** the `.als` type list is hand-maintained, and `npm run alloy` runs
      **nowhere** in CI, so nothing reported the drift.
- [x] **Step 1 — the four coupled edits** to `subject-admission.als`. Done.
- [x] **Step 2 — the gate**, `tests/conformance/alloy-vocabulary.test.ts`. Done, tampered three
      ways, runs under `npm run test` and therefore in CI.
- [ ] **Step 3 — decide whether the analyzer runs in CI.** Argued below, **not decided**. Needs a
      call from the user on putting a JVM in the `Test` job's critical path.

### Next action

**Step 3, and it is a decision, not a chore.** Everything else here has landed. The argument is
written out under "Step 3" below; what it needs is a yes or no on the cost, not more measurement.

---

## What landed

### Step 1 — the four coupled edits

All four, in `subject-admission.als`:

1. `fun F_document : set Kind { K_document }`, last in the singleton-family block. `K_document` was
   already in the `Kind` enum; only the family was missing.
2. `m = F_document` added to `isADeclaredFamily`.
3. `...ElevenFamilies` → `...TwelveFamilies` in **all four** places the count is spelled — the
   predicate's doc comment, the assertion's doc comment, the `assert`, and the `check`. (The plan's
   first draft counted three; there were four.)
4. The three missing rows, placed **last and in the vocabulary's own order**, each carrying the
   vocabulary's own argument:
   - `one sig T_documentIssuance extends Type {} { family = F_document }`
   - `one sig T_survey   extends Type {} { family = F_goods }`
   - `one sig T_estimate extends Type {} { family = F_goods }`

   Not scattered into the existing goods block, because `survey` is an **act** and `estimate` is a
   **non-act** — mirroring `CANONICAL_SUBJECT_FAMILY`'s own layout keeps the two files diffable.

**The coupling of edits 2 and 4 is now demonstrated, not just asserted.** Tamper 3 (below) dropped
`m = F_document` with the rows in place and `check everyTypeDeclaresOneOfTheTwelveFamilies` came
back **SAT** — exactly what the first draft of this plan predicted.

### Step 2 — the gate

`packages/domain-reference/tests/conformance/alloy-vocabulary.test.ts`, ten assertions, modelled on
`tests/conformance/documents.test.ts` (which does this job for the prose). It parses the `.als` as
**text** and needs no JVM, which is why it belongs in the vitest suite rather than waiting on
step 3. It asserts, both directions:

- one `one sig T_x` per `ASSERTION_TYPES` member, and no row the vocabulary lacks;
- each row's `family = F_y` equals `CANONICAL_SUBJECT_FAMILY[x]` — the half that catches a **wrong**
  family, which the real defect never exercised;
- the `fun F_*` declarations **and** `isADeclaredFamily`'s members each equal the keys of
  `SUBJECT_FAMILIES`, checked **separately** because they fail differently (a family declared but
  not admitted turns S1 SAT; a family admitted with no `fun` is a parse error only the analyzer
  sees, and the analyzer runs nowhere);
- the count word spelled into the S1 assertion's **own name** tracks that key count;
- the parsed row count equals the raw `^one sig T_` line count;
- `custody.als` and `cardinality.als` still enumerate no types, so covering one file covers the
  corpus.

**Two decisions inside it worth not re-litigating:**

- **Spelling is compared case-sensitively**, applying the `.als`'s own rule forwards
  (`weight.net` → `T_weightNet`), **not** by stripping dots and lower-casing both sides. The lossy
  normaliser was the obvious move and it would accept `T_Survey` and `T_WEIGHTNET` as conforming
  spellings — of the names that are the thing being checked.
- **A parse failure is a test failure.** A line the pattern stops understanding would otherwise drop
  out of **both** directions and leave the guard green on a file it had stopped reading.

### The measurement — do not re-derive it

Re-confirmed 2026-10-12 at `e65c5edc` by running the new gate against the **unmodified** spec, which
named exactly three types and one family and **nothing else**:

```
vocabulary assertion types (ASSERTION_TYPES): 34   (21 act + 13 non-act)
concrete types in subject-admission.als     : 31
MISSING: documentIssuance, survey, estimate
SUBJECT_FAMILIES: 12 members; spec declared 11 (F_document absent)
```

- **`documentIssuance`** has been missing since catalog **`0.6.2`** — not this stream's regression.
- **`survey` and `estimate`** were added by **`[A10]`**, catalog `0.7.1`, PR **#834** — the most
  recent round made it worse and nothing said so.
- **Only `subject-admission.als` enumerates types**, and the gate now asserts that stays true.

### Why a model checker could not see this

`all t: Type | isADeclaredFamily[t.family]` is **silent about the `Type`s nobody wrote down**. The
hole was in the quantifier's domain, so S1 kept coming back UNSAT while the table it checked was
three rows short. A stale spec is worse than no spec precisely because its commands stay green —
which is why the fix is a text gate over the transcription and not another Alloy command.

### Tampers — all three verified with `git diff --stat` first (gotcha 5)

| tamper                              | result                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| delete `one sig T_survey`           | red, 1 of 10 — named `survey: absent` + the exact line to add          |
| `T_pieceCount` family → `F_stay`    | red, 1 of 10 — named `subject-admission.als:99`, declared vs. expected |
| drop `m = F_document` from the pred | red, 1 of 10 — **and `npm run alloy` went SAT on S1**                  |

Each tamper changed exactly one thing, and the commit was made **before** any of them (gotcha 6), so
`git checkout -- <file>` was safe.

### Verification — all run, all green

```
npm run test          -w @pegasus/domain-reference   30 files, 593 tests
npm run lint          -w @pegasus/domain-reference   clean
npm run typecheck     -w @pegasus/domain-reference   clean
npm run alloy         -w @pegasus/domain-reference   every command matched its expectation
npm run glossary / catalog / context-map / symptom-index
```

**The emitted diff is EMPTY** — `catalog/*`, `glossary.md`, `context-map.md` and `symptom-index.md`
all re-emit **byte-identical** against a pre-change scratchpad baseline, and `specVersion` stays
**`0.7.1`**. This work touches a checking spec and a test; it mints nothing and publishes nothing.

---

## Step 3 — CI, and it is a genuine decision

**The state of play, measured:** `npm run alloy` runs **nowhere**. No `.github/workflows/*` mentions
it, `turbo.json` has **no `alloy` task**, and **no vitest test executes the analyzer** — the tests
only _cite_ command names in comments (e.g. `invariants.test.ts:708` cites "C8 in
`alloy/custody.als`"). So the model-checking that found the worst defect in this corpus is a manual
local step.

**What it would take.** `run.mjs` pins `ALLOY_VERSION = '6.2.0'` with
`ALLOY_SHA256 = 6b8c1cb5bc93bedfc7c61435c4e1ab6e688a242dc702a394628d9a9801edb78d` and downloads to
`packages/domain-reference/alloy/.tools/`, which is **gitignored** (`.gitignore:120`). It supports
`--no-fetch` / `ALLOY_NO_FETCH=1` to fail instead of downloading, and `ALLOY_JAR` to point at an
existing copy — so a CI job would cache `.tools/` and pass `ALLOY_JAR`, or accept one download per
cache miss. A JVM is also needed; **local is OpenJDK 21** and the analyzer ran fine on it.

**For:** it re-runs the proofs on every PR. The findings register
(`docs/domain-reference/analysis/findings-from-alloy.md`, F1-F5) is the evidence this pays —
**F1** alone (`handover` had no qualifier, so **custody could never change hands twice**, which
"made a normal van-line move unrepresentable") was found on the **first** Alloy run after **five
rounds of human review missed it**, with the TypeScript tests passing throughout.

**Against:** a JVM plus a ~40MB jar in the critical path of the `Test` job, for a spec that changes
only when the vocabulary does — and **the gate that just landed is what catches that**. The full run
takes seconds locally, so the cost is setup, not solve time.

**The honest shape of the decision:** step 2 removes the failure mode that actually bit. Step 3 buys
re-proving the invariants against **edits to the specs' own logic**, which is a different and rarer
risk. A middle option exists and is probably the right one: run `alloy` in CI **only on changes
under `packages/domain-reference/alloy/**`**, path-filtered the way `deploy.yml` already filters
components, so the JVM never touches the common path. **Not decided — needs the user's call.**

---

## Not in scope, deliberately

- **F4 stays open.** `ExternallyPerformedLeg.performedBy` has no consumer — recorded in
  `findings-from-alloy.md` as open and "recorded rather than decided".
- **`cube` is the narrowest gap in the model** and is not this plan's: `survey` is published and one
  of the values it produces is not, blocked on `unitOfMeasure`. See
  `plans/completed/domain-reference-a10-carrier-role-survey-estimate.md` §9.
- **Do not rewrite the specs.** This is maintenance on something that works — see "Decisions".

## Observation, recorded not fixed

`subject-admission.als`'s comment **"The seven goods-side acts"** heads a block of **five**
declarations (`packing`, `loading`, `unloading`, `delivery`, `handover`), and the goods **family**
holds nine members once `survey` and `estimate` land. The count is wrong under every reading and it
predates this round. **Left alone deliberately:** it is a prose count this gate does not check, and
changing it would be a claim about [SD §4.7.1]'s intent that no measurement here supports. Worth a
sentence in the next round that touches the table.

## Plan housekeeping done this session

- `domain-reference-a10-carrier-role-survey-estimate.md` → **archived to `plans/completed/`**. Its
  §9 says outright "the round is complete and the plan above is a design record".
- `domain-reference-a8-item4.md` → **stays in `plans/in-progress/`**. Read before deciding: its
  banner says the `[A8 §9]` item rounds are PAUSED and line 66 says item 4's own design round is
  "PAUSED, do not resume". Paused is not complete, so it is not archived.

## Decisions & dead ends

- **Alloy is used for its intended purpose and it is the highest-leverage thing in the package.**
  `findings-from-alloy.md` carries F1-F5, four resolved and F4 open-and-recorded. Findings drove
  real model changes: F1 → the handover qualifier + parties out of `context[]` into `value` + fold
  rules C5/C6; F3 → `boundBy = KEY` and [A8 §5] row 12; F5 → the role-spelling work that became
  `customer` → `goodsOwner`.
- **Step 2 was chosen over step 1 alone** because adding three `sig` lines resets the clock without
  removing the failure mode. The drift was invisible precisely because the list is hand-maintained
  and unchecked.
- **A follow-up PR was chosen over dequeuing #834.** #834 was green in the queue and the staleness
  predated it, so holding a passing PR bought nothing.
- **Scopes are 4 and 5 and that is left alone.** `check ... for 4 expect 0` means "no counterexample
  with ≤4 atoms per signature" — the small-scope hypothesis, evidence rather than proof. The
  documents do not overclaim it, so there is nothing to fix.

## Gotchas

1. **An unexpected Alloy result is a FINDING, not a test to fix.** `run.mjs`'s header: a
   `check ... expect 0` coming back SAT means a counterexample exists to something a document
   asserts; a `run ... expect 1` coming back UNSAT means a state a document requires cannot be
   built. "Neither is a bug in the spec to be coded around... the redness _is_ the report." Every
   command must carry an explicit `expect` — the runner **fails on a command without one**.
2. **`packages/domain-reference/tools/*.ts` contain literal NUL bytes** — use `/usr/bin/grep -a`.
   The `.als` files are clean.
3. **`git` is heavily restricted in this worktree.** Heredocs are refused, and so is any `git` the
   guard cannot verify stays inside the worktree. Write commit messages to a file and use
   `git commit -F`; split compound commands; **a `sed -n` whose range is computed from command
   substitution is also refused**, so look up line numbers in a separate call.
4. **Node cannot run `src/*.ts` directly** — the imports are extensionless, so an ad-hoc
   `node measure.ts` dies on `ERR_MODULE_NOT_FOUND`. Measure from inside **vitest**, which resolves
   them. (And vitest swallows `console.log` under the default reporter — assert instead of printing.
   Writing the gate first and reading its red output **is** the measurement.)
5. **Verify a tamper actually changed the file before believing red OR green** — `git diff --stat`
   first. A `sed` tamper in an earlier round matched nothing and the gates stayed green, which reads
   exactly like a gate that works.
6. **Commit before any destructive experiment**, and keep `chore/parked-dr` parked and clean —
   re-park with `git branch -f chore/parked-dr origin/main`, never `reset --hard`.
7. **Prettier runs in the pre-commit hook and rewrites TS** — it reformatted the new test on commit.
   `.als` files are **not** Prettier-formatted. Address rows by anchor text, never by line number.
