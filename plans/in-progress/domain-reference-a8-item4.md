# `[A8 §9 item 4]` — delegation and on-behalf-of: plan

**Branch:** `feat/dr-a8-item4` off `a8e6608b` (= `origin/main`, item 11's merge).
**Worktree:** `/home/steve/repos/pegasus-deps-advisory-flip`. Postgres not needed.
**Started 2026-10-10.** Written to be read by a session with **no memory of it**.

**Baseline saved:** `scratchpad/item4/{catalog/,glossary.md,context-map.md}`, and the three
generators were verified to reproduce `HEAD` byte-identically before anything was touched.

---

> # ⛔ DO NOT RESUME THIS ROUND. PRIORITY CHANGED 2026-10-10.
>
> **The `[A8 §9]` item rounds are PAUSED. Read `## 8. The priority change` at the bottom of this
> file before doing anything else.** Everything above §8 is still accurate and worth reading — the
> measurements are good and the `(1b)` evidence repair in M6a is **done and landed**. What has
> changed is that **item 4's design round should not be the next thing anybody does.**
>
> **Why, in one line:** the reference model's consumer is the **MVVM/domain refactor of the legacy
> `peg2`/`movemanager` repo** — Claude Code sessions reading messy WinForms business logic — and
> measured against that consumer, item 4's question (where a second delegation axis lives) is one a
> migrator never asks, while three absent fact classes it _will_ hit on day one are unwritten.
>
> §8 names the four things to do instead, in order.

---

## Resume here — checkpoint 2026-10-11 (second, after §8.3(2))

### Where

- **Branch: `feat/dr-retention-at-point-of-use`**, off `87b53057` (= `origin/main`, PR #832's merge).
- **Worktree:** `/home/steve/repos/pegasus-deps-advisory-flip` (the long-lived domain-reference
  worktree). Postgres not needed.
- **Commits:** `13bd3b81` — _feat(domain-reference): surface the evidence grade at the point of use —
  retention, per authority row_ — plus the plan/GOTCHAS checkpoint you are reading.
- **`chore/parked-dr` is parked at `origin/main` and clean.** Keep it that way; `CLAUDE.md`'s
  parallel-work rule requires it and §8.3(1) was committed onto it by mistake once already.

### Status

- [x] **M1-M5** — item 4's measurements. Done, bytes checked rather than prose trusted.
- [x] **M6a — the `(1b)` evidence repair.** **MERGED, PR #828 → `e9b2808e`.** Main + Deploy green.
      Verified post-merge: the published catalog is byte-identical and `0.7.0` stands.
- [x] **§8.3(1) — THE SYMPTOM INDEX. MERGED, PR #832 → `87b53057`.** Main + Deploy green (Deploy a
      verified path-filter no-op: 45 files since the `last-deploy` base, zero deployable).
      `docs/domain-reference/symptom-index.md` (generated) + `tools/generate-symptom-index.ts` +
      `tests/conformance/symptom-index.test.ts` + `data/legacy-correspondence.json` (the one
      authored input) + a `symptom-index` npm script.
- [x] **§8.3(2) — RETENTION AT THE POINT OF USE. Committed (`13bd3b81`), gates green.**
      `retention:` declared on the 12 sources `data/authority-table.json` cites, with the schema and
      the reasoning in `registry.yaml`'s header; `RETENTION_STATES` / `registryRetention` /
      `retentionDisagreements` / `analysisEvidenceGrade` / `citedSourceIds` in
      `tools/source-registry.ts`; two derived sections and a **can you re-check it?** column in the
      symptom index; `tests/conformance/retention.test.ts` (19 assertions). **Six tampers run, red
      on the intended assertion.** Catalog **unchanged at `0.7.0`** — glossary, context map and all
      four `catalog/*` files byte-identical.
- [x] **§8.3(3) — DONE as `[A10]`, catalog `0.7.1`, 2026-10-12. See
      `plans/in-progress/domain-reference-a10-carrier-role-survey-estimate.md`.** It became a round
      about a **ROLE**: all three candidates are asserted by _"you, the motor carrier"_ and the cast
      had no carrier-side member, so none could be given an authority row. `contractingCarrier`
      minted (`newClosedEnumMember`), `survey` and `estimate` minted with [A8 §5] rows 19-20
      (`newRecordType` ×2), **`claim` refused** with its blocker written — the decider is an adjuster
      and the cast names no decider. **First real catalog diff in four rounds**, and additive.
- [ ] **§8.3(4) — stop, let usage drive it.**
- [ ] **Item 4's own design round — PAUSED, do not resume.** See the banner and §8.2.

### Next action

**First, land the retention PR** (`feat/dr-retention-at-point-of-use` → find it with
`gh pr list --head feat/dr-retention-at-point-of-use`): watch branch CI, `gh pr merge <N> --auto`
(**no `--squash`** — silence on a healthy enqueue is normal), then the merge-queue group run through
to main's Deploy. Deploy will be a **no-op** again, and that is correct — nothing here is under a
deployable component path. Verify it rather than assume it: read `Detect changes`' job conclusions,
because a 10-second green and a gate that never ran look identical.

**Then §8.3(3) — write `survey`, `estimate` and `claim`**, the three absent fact classes with real
mass (99 of the 103 absent-surface files: `survey` 57 · `estimate` 25 · `claim` 17). `estimate` has
**primary captured** evidence sitting unused — `src:cfr-49-375` §375.401 (written estimate signed and
dated by both parties before the BOL), §375.403 (silence after loading is reaffirmation; the
propose/decide pair at (a)(8)), §375.409 (the broker-adopted estimate, see M3). All three were read
in an earlier session for other reasons. **This is the first of these rounds that will emit a real
catalog diff**, so expect a version bump and a `[catalog §2.4]` row — unlike §8.3(1) and §8.3(2),
which both left the catalog byte-identical.

**Owed from §8.3(2), small and real:** the **per-citation** grain. A per-source retention state is a
floor — `src:dcsa` is `captured-here` with 125 files and still lost the cited JIT sub-spec. Measured
2026-10-11, **neither** `src:dcsa` citation in `authority-table.json` reaches JIT, so nothing
currently rendered is overstated, and that is why the per-citation override was **not** built: there
was no instance to gate. Build it when one appears.

### Uncommitted work

**None.** The plan and `GOTCHAS.md` checkpoint you are reading is committed alongside the retention
work on `feat/dr-retention-at-point-of-use`.

### In flight

**The retention PR** on `feat/dr-retention-at-point-of-use` — the only thing of this stream's. PRs
**#827**, **#828**, **#826** and **#832** are all **MERGED**; remote branches auto-deleted, local
branches removed, monitors ended.

Open PRs at checkpoint, none of the rest this stream's: **#829**, **#830**, **#831** (Dependabot —
hono, aws-cdk, minor-and-patch) and **#145** (Cognito/SES, DRAFT, on HOLD for the SES sandbox).
Re-check with `gh pr list --state open --limit 10`.

### What §8.3(2) found, because the plan's premise did not survive contact

- **The spec said "derive retention from the filesystem". That is wrong**, for **3 of the 9**
  directories that have a `captured/`, in three different directions: two hold **our own notes**
  with the raw bytes gitignored (`src:stedi-x12-reference`, and `src:x12-212-trailer-manifest`,
  which no gotcha had named); and `src:atlas-world-group-api`'s holds a README reading `EMPTY` plus
  a **derived** file, while its real bytes are 24 OpenAPI documents elsewhere **in this repo**. So
  retention is **declared** in `registry.yaml` and a gate holds it to what the filesystem can prove.
- **The four states measured out as SEVEN**, and three of the extras are indistinguishable today
  from one of the four: `refs-in-repo`, `notes-only`, `local-only`. That is the plan's own thesis
  turning out larger than the plan measured.
- **"Evidence grade" was already taken, and the plan used it loosely for retention.** `evidence_grade`
  is rubric **S4** (`rubric.md:152`) — how thoroughly _we read_ a source, `A`/`B`/`C`, in each
  `analysis.md`'s front matter. Retention is the **reader's recourse**. Four axes are rendered as
  four columns and none is folded: the pairing that manufactures false confidence is a high S4 on a
  poor retention, and **4 of the 12 cited sources are `evidence_grade: A` and unverifiable**.
- **`src:dp3-400ng` is `local-only`, NOT `analysis-only`** — #832's own hand-written paragraph got
  this wrong about the **most-cited source in the model** (223 citations). Its bytes are real and its
  registry ref says where: _"PRIMARY CHECKOUT ONLY (gitignored); absent from this worktree"_. Calling
  it analysis-only is the `src:sirva-ade` error in reverse. A gate now refuses it.
- **Two bugs this round caught in itself**, both the kind it exists to prevent: an earlier cut had
  two recourse tiers and rendered `unloading` (sole source `src:sirva-ade`) as "no recourse" —
  re-committing the sirva-ade conflation inside a generator; and reading citations from `evidence`
  alone rendered `sitEntryDate` as **uncited** when its evidence literally says _"SOURCED twice …
  see settlement"_. **Citations live in 11 distinct field paths**; recourse is computed over the
  whole row.
- **A tamper that silently matched nothing passed.** `sed 's/| can you re-check it? |/…/'` found no
  match because Prettier pads table columns, so the "tamper" was a no-op and the gates stayed green —
  which reads exactly like a gate that works. Gotcha 1 again, now in the tamper rather than the
  assertion: **verify a tamper changed the file** (`git diff --stat`) before believing the red or the
  green.

### Decisions & dead ends

- **The consumer was named this session and it reframed the whole backlog.** The reference model is
  to be supplied to the **MVVM/domain refactor of the legacy `peg2`/`movemanager` repo**, read by
  Claude Code sessions. **"Nothing imports `@pegasus/domain-reference`" is NOT a defect** — the
  prose is the product and the TypeScript is a harness that stops it rotting. An earlier
  recommendation in this session to "give it a consumer" was **wrong** and was withdrawn.
- **Item 4's design round was dropped as the next step**, not abandoned. Three of the last four
  rounds emitted nothing, and a migrator never asks where a second delegation axis lives.
- **`src:sirva-ade` is `retained-elsewhere`, NOT `secondary`** — corrected mid-session after this
  plan asserted the opposite. Its bytes are real and version-controlled (13 ADE PDFs, private repo
  `pegasus-workflows`). **Do not re-derive this; the manifest is in `registry.yaml`.**
- **Option 1 (recapture the JIT spec) could not be completed as specified** and the reasons are
  permanent: `dcsaorg/DCSA-OpenAPI` is **404**, the standard was renamed to DCSA Port Call, the only
  GitHub copy is from 2020, and every surviving SwaggerHub spec is **unbundled** so none carries the
  cited line numbering. `(1b)` was the fallback and it landed.
- **Capturing the SIRVA PDFs into this repo was REFUSED** — `license: partner-confidential` and
  `DolasDev/pegasus` is **public** (user has confirmed public is fine, but that does not extend to
  partner-confidential material). Making the reference _resolvable_ was the answer instead.
- **The symptom index's generated/authored split was deliberate**: only the legacy→concept mapping
  is authored, because the reference knows nothing about MoveManager ([SD §0]). Everything else is
  derived from the published catalog, and the generator **refuses to build** on disagreement.

### Gotchas

1. **The symptom-index generator is `async` and formats its own output through Prettier.** The
   pre-commit hook pads markdown table columns, so unformatted tables are rewritten on commit and
   the reproduce gate fails on **whitespace alone**. Any new assertion against table text must be
   **whitespace-tolerant** (a regex, not a literal) — one already caught this.
2. **A generator cannot `import` from `src/` at runtime.** `src/` modules import each other without
   file extensions and nothing ever runs them; `vocabulary.ts` → `../src/ids` fails on the first
   hop. The symptom-index generator reads the **published catalog** instead
   (`index.json` members for fact classes, `captured.schema.json`'s `$defs/AggregateId.*` for
   aggregate kinds). The other generators use the TypeScript compiler API.
3. **`charge` and `partyRole` are the ONLY two names that are both a fact class and an aggregate
   kind** — measured against the wire. Everything else in `AGGREGATE_KINDS` is a subject only.
   Listing `order`/`trip`/`stop` as a _concept_ is the error the new gate caught on its first run.
4. **`git` is heavily restricted in this worktree.** Heredocs are refused; so is any `git` the guard
   cannot verify stays inside the worktree — including `git -C <other worktree>` and
   `cd <shared checkout> && git …`, **even when the user runs it with `!`**. Write commit messages
   to a file (`git commit -F`), and split compound commands.
5. **Never build a commit message with `printf`/`echo` containing backticks** — the shell evaluates
   them and mangles the message. It happened this session and needed an `--amend`. Use the Write
   tool.
6. **The primary checkout `/home/steve/repos/pegasus` is ~4 commits behind `main`** and **cannot be
   synced from this session** (the guard blocks it, `!` included). It needs a plain shell outside
   Claude Code, or a session started in that checkout.
7. **Sources with NO `captured/`** (all `analysis-only`): `dp3-400ng`, `dtr-part-iv`,
   `dp3-tender-of-service`, `nmfta-ebol`, `weichert-supplier-api`. `nmfta-ebol` is the trap —
   `registry.yaml` lists sha256 hashes so it _reads_ as captured, but `local/` is not in the repo.
   `stedi-x12-reference`'s `captured/` holds only a **notes** file.
8. **`movemanager` is at `/home/steve/repos/movemanager`**, branch `master`, commit `f0abdf16`
   (2026-09-03) — which is what the correspondence table was measured against. Re-measure with
   `scratchpad/measure_modules.py` if the counts need refreshing, and bump `measuredAt`.
9. **A resume checkpoint that says "the working tree is clean" is itself the uncommitted change.**
   This plan's 2026-10-11 checkpoint asserted a clean tree and prescribed
   `git checkout chore/parked-dr && git reset --hard origin/main` to re-park the branch — while the
   checkpoint was an unstaged edit to this very file, which that sequence would have destroyed.
   **`git status` before believing a plan about the working tree**, and prefer
   **`git branch -f <branch> <ref>`** to re-point a branch you are not on: it needs no checkout, so
   nothing in the tree is at risk. `git checkout -b` carries a dirty tree across to the new branch,
   which is what saved it here.

### Verification still owed

**Nothing for the merged work.** PR #828's gates were green on the branch, on the merge-queue group
run and on `main`; the published catalog was verified byte-identical post-merge.

**For `935bc47d` (the symptom index), all eight gates passed locally and nothing is owed except CI:**

```
npm run test          -w @pegasus/domain-reference
npm run lint          -w @pegasus/domain-reference
npm run typecheck     -w @pegasus/domain-reference
npm run alloy         -w @pegasus/domain-reference
npm run glossary      -w @pegasus/domain-reference
npm run catalog       -w @pegasus/domain-reference
npm run context-map   -w @pegasus/domain-reference
npm run symptom-index -w @pegasus/domain-reference
```

**One thing NOT verified and worth a look before the PR:** the `symptom-index` script is **not wired
into any CI workflow or `turbo.json` pipeline.** The other three generators are gated by
`tests/conformance/*.test.ts`, which `npm run test` runs — and `symptom-index.test.ts` does hold the
reproduce gate, so CI _will_ catch a stale artifact. But confirm no workflow needs the new script
added explicitly: `grep -rn "context-map" .github/ turbo.json`.

### Not done, deliberately

- **movemanager was not touched.** Wiring the index into its `CLAUDE.md` and
  `.claude/commands/extract-domain-rules.md` is the user's step and they have said so. Note that
  `extract-domain-rules.md` currently has **zero** references to the reference model, so that
  wiring is entirely still to do.
- **19 of the 28 correspondence rows are `●● read`; 9 are `●○ from names`.** `_zUnsorted/`
  (25 forms, 4,675 lines) is the highest-value row to triage properly — large, and nobody has
  classified it.
- **`dcsa/analysis.md`'s untriaged `jit/…` citations** (M6b) remain **A3's and A4's**, blanket-
  disclosed, not re-graded.

---

## 0. Why this item, of the three candidates

Named by `plans/completed/domain-reference-a8-item11.md` §8. Chosen because:

- it is **the only candidate whose best evidence is primary captured**, and that is now **verified
  in the bytes** rather than taken from the skeleton (§1 below);
- its shape question **is** the `acts-for` half of the party-to-party candidate, so starting here
  does half of that round's work either way;
- the government-office unfold stays deferred for the third time, on the same two grounds: it is
  **breaking** (`reinterpretedMember` over `accountParty`) on **`secondary`** evidence.

**A correction this round starts from.** Both the item-11 record and `[A8 §9 item 2]`'s record say
item 4 "has to argue with `[SD §1.1]`'s _no second classification axis_". **Read directly, `[SD §1.1]`
forbids a second `type` on the envelope** — "One record, one `type`… a record that could be filed
under two independent vocabularies cannot be the basis of ubiquitous language". It says nothing about
modelling delegation. The constraint item 4 actually argues with is **`[A8 §2]`'s**: the role enum is
one **functional** axis, which is why `primeAgent` in `ROLE_NAMES` is refused. Those are different
rules and the records conflated them. **Do not inherit the conflation.**

---

## 1. Measurements already done — read these before designing

### M1 — §375.205 is primary, captured, and verified verbatim

`docs/domain-reference/sources/cfr-49-375/captured/cfr-49-375.xml`, § 375.205 _"May I have agents?"_:

> (a)(1) "A **prime agent** provides a transportation service **for you or on your behalf**,
> including the selling of, or arranging for, a transportation service. You permit or require the
> agent to provide services **under the terms of an agreement or arrangement with you**. A prime
> agent does not provide services on an emergency or temporary basis. **A prime agent does not
> include a household goods broker or freight forwarder.**"
> (a)(2) "An **emergency or temporary agent** provides origin or destination services **on your
> behalf**, **excluding** the selling of, or arranging for, a transportation service… only on an
> emergency or temporary basis."
> (b) "you must have **written agreements**… You and your retained prime agent **must sign** them."
> (c) "Copies… in your files for at least **24 months** following termination."

**Two things the skeleton's quote dropped, and both shape the model:**

1. **The two agent types differ on TWO dimensions, not one** — _basis_ (emergency/temporary or not)
   and _scope_ (includes selling/arranging or not). So prime-vs-emergency is **not a boolean**.
2. **(b) and (c) are obligations on the carrier that EVIDENCE the instrument, not its shape.** A
   signed agreement and a 24-month retention period belong in `evidence[]` / obligation territory;
   putting a retention period on an instrument's type would be modelling a filing rule as authority.

### M2 — THE FINDING: the instrument half of A8-UNAUTH authorises the BEARER, not the grantee

`authorityToDeclare` (`src/rules/authority.ts:1917`), instrument branch:

```ts
if (claim.kind === 'instrument') {
  if (!instrumentReaches(claim.instrument, type)) return UNAUTHORISED
  if (!instrumentIsInForceAt(claim.instrument, context.at)) return UNAUTHORISED
  return { kind: 'AUTHORISED', by: claim } // ← no party is ever compared
}
```

**Any party presenting an in-force instrument that reaches the fact class is authorised.** Compare
the **role** branch three lines down, which _does_ check `verdict.holder.role === claim.role`.

**It is invisible because two independent things are missing and neither looks like a defect alone:**

- `Instrument` (`:1831`) is `{kind, instance, grants, effectiveFrom?, effectiveTo?}` — **no grantee,
  no grantor**;
- `authorityToDeclare(type, claim, context)` is **never passed the declaring party**, although
  `CorrectionAttempt.declaredBy: PartyId` exists and the only caller
  (`decideCorrection`, `corrections.ts:366`) has it in hand.

Nothing upstream compensates: `decideCorrection` passes `attempt.authority` straight through.
The existing `TODO` at `authority.ts:1975` covers the **role** branch's gaps (items 2, 5) and says
nothing about this.

**Why this is item 4's and not a separate bug:** delegation _is_ "A may act because B authorised A".
`SUBSTITUTE_PERFORMANCE_AUTHORISATION` (R19) is already carrier→agent delegation modelled as an
instrument, and it "works" only because the model never asks whose `R19AuthNumber` it is.

### M3 — the `booker` miscitation check: the sentence SURVIVES, and the exclusion is real material

`[A8 §9 item 4]` says _"a prime agent may be a `booker`"_ while §375.205(a)(1) says a prime agent
**does not include a household goods broker**. Checked rather than assumed:

- `booker` is glossed _"the party that books the move"_, from `src:sirva-ade`'s `Resource.Type` cast
  — a van-line agent booking **for the carrier under agreement**. That is a prime agent. **Not the
  broker**, who arranges as an independent intermediary. **The sentence stands.**
- But the **exclusion is sourced and unexploited**, and the corpus carries a _separate_ mechanism
  for the broker: **§ 375.409** — brokers may estimate _"provided there is a **written agreement
  between the broker and you, the motor carrier, adopting the broker's estimate as your own
  estimate**"_. That is **not** "acts on my behalf"; it is **the broker's assertion becoming the
  carrier's**. An **attribution transfer**, which is a third delegation shape.
- **`freight forwarder` is classed on the other side entirely:** _"A freight forwarder tendering a
  shipment to a carrier… **is also a commercial shipper**."_ So it sits on the
  `goodsOwner`/`accountParty` axis, not the agent axis.

Counted in the captured bytes: `broker` **16**, `freight forwarder` **3**, and **neither is a
§375.103 defined term here** — the exclusion points at statuses defined outside this corpus
(§371.113 is cited but not captured). **So the exclusion is real but not applicable by this model**,
and that is the finding rather than a gap to fill.

**§375.409 is already cited — by `[A7 §3.6]` and `[A1]`, for PROPOSAL authority** ("both roles are
named pre-commitment"). Neither reads it as delegation or attribution. Same pattern as element 98
being invisible to item 3 because it was read for item 2. **Read it for this axis; do not claim it
unread.**

### M4 — wire baseline

`$defs/Instrument` **is** emitted (both faces), `required: [grants, instance, kind]`,
`additionalProperties: false`. Therefore:

- a new `InstrumentKind` member → **`newClosedEnumMember`**, additive;
- a new **optional** party field on `Instrument` → additive on the wire, **but** gotcha 8 applies to
  any `Exact<>` gate written over it (an added optional member keeps assignability both ways);
- a new **required** field → **breaking on the captured face**. Which is needed falls out of §2.

`AuthorityClaim` is also emitted and is `{kind:'role',role} | {kind:'instrument',instrument}`.
`CorrectionAuthority` is a straight alias of it (`corrections.ts:131`).

---

### M5 — STOP AND DECIDE: five documents cite the DCSA **JIT** spec, which is NOT in the repo

The advisor's instruction was to verify item 4's `isFYI` citation — _"the **only** on-behalf-of
signal there is"_ — because a negative claim about a captured source is cheap to check. It does not
check out, and the reason is bigger than item 4.

**`isFYI` has ZERO occurrences in `sources/dcsa/captured/`** (also zero for `is_fyi`, `fyi`
case-insensitively). It is cited at `dcsa/analysis.md:233` and `:454` as `jit L3604-3611`.

**`find sources/ -iname "*jit*"` returns NOTHING. The JIT spec is nowhere in the repo.**
`captured/DCSA-OpenAPI/` holds `bkg`, `cs`, `domain`, `tnt` — no `jit`. The `dcsa` registry entry
has **no `files:` list at all**, only two GitHub URLs, so nothing records that JIT was ever
retrieved.

**Five live citations point into those absent bytes, with precise line numbers:**

| site                                 | what it is cited for                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `00-shared-decisions.md:328`         | **the binding layer** — the per-role basis constraint, "**[ORIGINAL]:** applying that constraint mechanism to…"      |
| `A8-authority-skeleton.md:333`       | **§4's second structural precedent**, described as _"the only place in the corpus that joins authority to anything"_ |
| `A8-authority-skeleton.md:1399`      | §9, "it does not overturn…"                                                                                          |
| `A1-order-service-lifecycle.md:132`  | §Cross-area, handed to A8                                                                                            |
| `A1-order-service-lifecycle.md:1137` | the Service Consumer quotation                                                                                       |

**Why this was invisible, and it is a NEW shape of the grade trap.** `src:dcsa` **has** a
`captured/` directory, so every citation to it reads as primary captured. The gotcha list so far
tracks sources with **no** `captured/` (now including `nmfta-ebol` and `weichert-supplier-api`).
This is the next case along: **a source with captured bytes, cited into a sub-spec those bytes do
not contain.** The rule has to be per-**citation**, not per-source.

**What is NOT claimed here.** JIT is real and public, and nothing suggests the quotations are
wrong — `event_domain`'s `eventClassifierCode` _is_ captured and does constrain per event type, so
the adjacent claim stands on its own bytes. What cannot be done **from this repo** is re-reading
`L3554-3568` to check what it says, which is precisely the test `[SD §0]` and the
"retain the bytes" rule exist to make possible.

**This is a decision, not a task, and it is DELIBERATELY NOT TAKEN HERE** — it spans the binding
layer, A1 and A8, and A8 §4 is a pillar `[A8 §9 item 11]` just built on. Options, for the user:

- **(i)** its own small round: re-capture the JIT spec (a fetch — note `[SD §0]`), then the
  citations are verifiable and nothing else changes;
- **(ii)** record it as a **disclosure** in `[A8 §10]` and each citing document, re-grading the five
  citations `secondary` without touching the claims;
- **(iii)** item 4 absorbs only its own one (`isFYI`) and leaves the other four — **cheapest, and
  it leaves the §4 pillar undisclosed**, which is the option to argue against.

**Item 4's own exposure, independent of which option wins:** `isFYI` must be re-graded
**`secondary`** wherever this round cites it, and it must **not** be used as the primary witness for
anything. Item 4 does not need it — §375.205 and §375.409 are primary captured and verified (M1,
M3).

### M6 — option 1 was CHOSEN (user, 2026-10-10) and CANNOT BE COMPLETED AS SPECIFIED

The user chose **re-capture**. Attempted; here is what the attempt established. `[SD §0]`'s fetch
prohibition is **Atlas-specific** ("no claim… is scheduled for resolution by fetching Atlas
`/Types` endpoints"), not general, and DCSA is public + Apache-2.0 with `status: analyzed`, so the
fetch itself was in order.

**The cause of the gap is recorded in `sources/README.md` and it is not an oversight about
retrieval.** Under _"Capture only what is cited"_: _"Trimmed on 2026-09-18: … **DCSA (to the
`domain` / `tnt` / `bkg` / `cs` specs)**"_. JIT was trimmed as uncited — **while SD, A1 and A8 were
citing it.** The same README promises the full clone survives at `<id>/local/full-clone/`,
gitignored; it does **not** survive — checked in all five worktrees, and
`find /home/steve/repos -iname "JIT_v*.yaml"` finds nothing.

**The cited artifact no longer exists upstream either:**

| probe                                                    | result                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `dcsaorg/DCSA-OpenAPI` (the URL `registry.yaml` records) | **404 — deleted**                                                             |
| `dcsaorg/DCSA-JIT`                                       | exists, but is the **Java implementation**; no OpenAPI spec                   |
| GitHub search for a mirror/fork                          | only `nateshg/DCSA-OpenAPI`, pushed **2020-07-07** — predates JIT v2 entirely |
| SwaggerHub `dcsaorg/DCSA_JIT`                            | **exists**, and is where the specs live now                                   |

**And the standard has been renamed.** Current `DCSA_JIT` 2.0.0 opens with
_"⛔ **STANDARD RENAMED TO PORT CALL 2.0.0** … Do NOT use this version"_ — there is now a separate
`DCSA_PORT_CALL` API. Also: every SwaggerHub artifact is **unbundled** (6–46 KB, `$ref`-ing out to
shared domain specs), whereas the citations point at **L3554-3568 of a ~3600-line file** — a
**bundled** build that existed only in the deleted repo.

**What the fetch DID and DID NOT verify:**

- ✅ **`isFYI` is CONFIRMED** in `DCSA_JIT` 2.0.0: _"Flag indicating that this **event** is
  primarily meant for another party - but is sent as a FYI (for your information)."_ The substance
  of item 4's citation holds. Note the **wording drifted** — `analysis.md` quotes _"this **message**
  is primarily meant for…"_ and the older _"If set to `true` it indicates that…"_ phrasing — so this
  is a different build, and the quotation in `analysis.md` should not be presented as verbatim from
  a file we hold.
- ❌ **The load-bearing `[A8 §4]` / `[SD §328]` / `[A1]` claim is NOT FOUND in any surviving JIT
  artifact.** Searched `DCSA_JIT` 2.0.0, 1.2.0-Beta-2, 1.1.0, 1.0.1 and `JIT_EVENT_HUB`
  1.2.0-Beta-1 for `Service Provider`, `Service Consumer`, `eventClassifierCode` and every
  `only`-shaped publishing constraint. 2.0.0 has **no `EST`/`PLN`/`ACT`/`REQ` enum at all**;
  `1.2.0-Beta-2` mentions `eventClassifierCode` once with no role constraint attached.

**So the claim that §4 calls _"the only place in the corpus that joins authority to anything"_ — and
which `[A8 §9 item 11]` has just built on — currently rests on bytes that exist nowhere:
not in the repo, not in the recorded upstream, and not in the surviving successor specs.**

Nothing here says the claim is **false**; DCSA plainly had an ERP pattern with publisher semantics,
and `event_domain`'s captured `eventClassifierCode` constraint ("for `ShipmentEvents` the
`eventClassifierCode` must be…") is real and **is** captured. What is gone is the ability to check
_this_ claim, at _this_ precision, against anything.

**NEXT DECISION IS THE USER'S** — it is strictly larger than item 4 and must not be absorbed into
it silently:

- **(1a)** capture the surviving `DCSA_JIT` 2.0.0 (+ `JIT_EVENT_HUB` 1.2.0-Beta-1) **clearly
  labelled as successor artifacts, not as the cited ones**; re-grade the `isFYI` citation to this
  artifact; and disclose the §4 / SD / A1 claim as **unverifiable** with an `[A8 §10]` row.
- **(1b)** as (1a), plus **re-derive** §4's precedent from the captured `event_domain`
  `eventClassifierCode` constraint, which is primary captured and says something adjacent — then
  §4's argument stands on bytes we hold, possibly narrower than it currently claims.
- **(1c)** treat §4's claim as withdrawn pending re-sourcing. **Most expensive and most honest**;
  it touches `[SD §1.1]`-adjacent prose and three documents, and §4 is a pillar of item 11.

**Recommendation: (1b), but it is NARROWER than §4 currently claims — measured, not assumed.**

The captured substitute is real and verifiable. `captured/DCSA-OpenAPI/domain/event/
event_domain_v3.2.0.yaml`, **three live (uncommented) instances**:

- `:778` — _"For `ShipmentEvents` the `eventClassifierCode` **must** be `ACT`"_
- `:1231` — _"For `ReeferEvents` … **must** be `ACT`"_
- `:1328` — _"For `IoTEvents` … **must** be `ACT`"_

**But it constrains the classifier by EVENT TYPE, not by PUBLISHER ROLE.** §4's claim is
specifically about role — _"`EST`/`PLN`/`ACT` may be published only by the Service Provider, `REQ`
only by the Consumer"_ — and it calls this _"the only place in the corpus that joins authority to
anything"_. The captured bytes join **tense to event type**; they say nothing about **who may
publish**. So (1b) re-sources §4's precedent onto bytes we hold, **but §4's sentence has to be
restated and its superlative withdrawn** — the corpus, as captured, does **not** join authority to
tense anywhere.

**Also note a trap in the same field:** in `event_domain_v3.2.0.yaml` the `eventClassifierCode`
**query-parameter** description is almost entirely **commented out** (`#`-prefixed), including the
useful _"not all events support REQ"_ line. Only _"Unique identifier for `eventClassifierCode`"_ is
live there. The three constraints above are in the **schema** descriptions, not the parameter — so
grep for the constraint, never for the field name, and check the `#`.

**Carry this to `[A8 §10]` either way:** this is the first instance in the series of a claim whose
bytes are **unrecoverable** — not merely uncaptured. `visibilityProvider`'s and
`schemeCounterparty`'s exposures are about _thin_ evidence; this one is about _absent_ evidence
behind a precedent two rounds have already built on.

### M6a — (1b) IS DONE (user chose it 2026-10-10). Emitted diff EMPTY; seven gates green.

**All six emitted files are byte-identical to the pre-round baseline**, so catalog stays `0.7.0`
and `[catalog §2.4]` gains no row. This was evidence and prose only — **no model change**.

| what                                                                                                                             | where                                             |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| successor specs captured + a README stating exactly what they do and do not establish                                            | `sources/dcsa/captured/swaggerhub-jit-successor/` |
| `files:` (2, with sha256[0:16] + retrieved + from) and an `upstream_note` recording the 404 and the rename                       | `sources/registry.yaml`, `dcsa` entry             |
| 2 rows, house format `id⇥file⇥size⇥sha256[0:16]⇥url`                                                                             | `sources/capture-log.tsv`                         |
| the role claim **withdrawn, not softened**; precedent **re-sourced + narrowed** onto `event_domain_v3.2.0.yaml` L778/L1231/L1328 | `[A8 §4]`                                         |
| the "nearest published thing / look there first" paragraph **deleted**                                                           | `[A8 §9]`                                         |
| the JIT clause **struck**; the per-event-type precedent it actually needed is untouched                                          | `[SD §1.3]`                                       |
| both citations **withdrawn**, and the A8 hand-off withdrawn with them                                                            | `[A1]` ×2                                         |
| `isFYI` **re-sourced** to the captured successor, with the drifted wording corrected                                             | `dcsa/analysis.md` (table row + prose)            |
| a new disclosure row for an **unrecoverable** claim — the series' first                                                          | `[A8 §10]`                                        |

**The withdrawals STRENGTHEN two existing statements rather than weakening them**, and that is the
part to carry: `[SD §4.7.1]`'s _"no source in the corpus binds a **plan change** to an asserting
role"_ now stands with nothing adjacent to it, and as captured the corpus binds a classifier to an
**event type**, never to a **role**. So `[A8 §4]`'s "**Our step**" is now _larger_ than it was —
moving a basis constraint onto the role axis has **no published precedent for the role half**.

**Item 11 is NOT overturned** — that round turned on §4's holder-kind **shape**, not on the JIT
constraint. Stated in the `[A8 §10]` row so nobody has to re-derive it.

### M6b — RESIDUE DELIBERATELY LEFT, and it is another area's to triage

`dcsa/analysis.md` carries **further live `jit/…` citations that were NOT triaged**: the
`Timestamp` / **ERP-A** model, `TerminalCall`, `PortCallService`, `replyToTimestampID`, the
_"timestamps as a conversation, not a feed"_ reading, and the **A3/A4 rubric scores** resting on
them. Those are **A3's and A4's evidence, not A8's**, and re-grading another area's claims was out
of scope here.

A **blanket disclosure** now sits at the head of that file's JIT file-list telling any reader to
treat every remaining `jit/…` citation as `secondary` until its own area triages it. The successor
spec still carries the ERP pattern and the `PortCall`/`TerminalCall`/`PortCallService` schemas, so
most are probably re-sourceable — **at different wording and with no line correspondence**, so each
needs checking rather than assuming. **This is a real owed item for A3/A4 and is not item 4's.**

## 2. Measurements still owed, before any design

1. **Direction — classify every witness by `(principal, agent)`.** The skeleton lumps them and they
   do not agree:
   | witness                                                                                       | principal → agent                                                                                           | grade              |
   | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------ |
   | §375.205 prime / emergency agent                                                              | **carrier → agent** ("you" is the motor carrier; Subpart B is _"Before Offering Services to My Customers"_) | primary captured ✓ |
   | `src:dp3-400ng` `Designated Agent`                                                            | **customer → agent** ("in place of the customer", by power of attorney)                                     | secondary          |
   | `src:dp3-tender-of-service` MMC                                                               | "on behalf of a **SCAC**" — carrier → company?                                                              | secondary          |
   | `src:dtr-part-iv` TSP → subcontractor                                                         | carrier → carrier                                                                                           | secondary          |
   | §375.409 broker-adopted estimate                                                              | **broker → carrier** (attribution flows _to_ the principal)                                                 | primary captured ✓ |
   | **Decide whether this is one kind with a direction, or more than one, from that table** — not |
   | from the item's prose. Note the last row's arrow points the other way.                        |
2. **Verify `isFYI` in the captured `src:dcsa` bytes.** Item 4 cites it as _"the **only**
   on-behalf-of signal there is"_. A negative claim about a captured source is cheap to check and
   expensive to carry wrong — the `[A8 §9 item 2]` round shipped two miscitations of exactly this
   shape.
3. **Does any non-correction path construct an `AuthorityClaim`?** M2 is scoped to corrections
   because that is the only caller found. Confirm before describing the blast radius.
4. **`grep -rn "item 4"` across the repo and triage by TENSE** — item 2 handed material here, so
   expect present-tense "owes" prose that is now this round's to update. The item-2 record's §§8-10
   is the planning pass that says what was handed over.

---

## 3. The shape question, stated but NOT decided

Delegation needs to say **A acts under B's authority**. Three candidate homes, and the round must
pick with an argument:

- **(a) `Instrument` gains parties** — a `grantedBy` / `grantedTo`, and `authorityToDeclare` gains
  the declaring party so it can compare. Closes M2 directly. Cheapest, and it uses §6's existing
  "peer of role" mechanism. Risk: optional fields leave M2 open for anyone who omits them.
- **(b) a party-to-party relation** (`acts-for`), which an instrument _evidences_. This is the
  party-to-party candidate's `acts-for` half. Larger; needs a new `AssertionType` + a canonical
  subject row.
- **(c) refuse, on grade** — only §375.205 and §375.409 are primary, and both are **carrier-side**;
  the customer→agent direction rests entirely on `secondary` (`Designated Agent`). A partial close
  is legitimate: close the carrier-side on primary evidence, refuse the customer-side on grade.

**Do not inherit an answer for whether ONE fact class covers `acts-for` and `parent-of`.** That is
the item-11 record's explicit instruction. **`parent-of` stays with `[A8 §9 item 1]`.**

---

## 4. Scope lines

- **Do NOT touch** `authority.ts:562`'s two-homes `TODO` (it says "Not decided here"); it has a
  documented drift instance from the item-11 round and wants its own round.
- **`[A8 §9 item 5]`** gets the MMC exclusivity rule (_"may not be named as the origin servicing
  agent"_) **noted, not closed**.
- Still owed to **item 2**, not this round's: the NTS **warehouseman** and the **`RATED` tariff
  owner**, both `secondary`.
- **Hot file:** `data/authority-table.json`. `git fetch && git rebase origin/main` before landing.

## 5. Gotchas carried forward (each cost time in a previous round)

1. **`git` with a heredoc is REFUSED in this worktree**, and so is any `git` in a command the guard
   cannot verify stays inside it — including `git -C <other worktree>` and `cd <shared checkout> &&
git …`, **even when the user runs it with `!`**. Write commit messages to a file and use
   `git commit -F`. Split compound commands.
2. **`packages/domain-reference/tools/*.ts` contain literal NUL bytes** — use `/usr/bin/grep -a`.
3. **Prettier runs in the pre-commit hook and rewrites markdown.** Address table rows by **anchor
   text**, never by line number, and re-read between a prettier run and the next scripted edit.
4. **Sources with NO `captured/`** (all `secondary`): `dp3-400ng`, `dtr-part-iv`,
   `dp3-tender-of-service`, `sirva-ade`, **`nmfta-ebol`**, **`weichert-supplier-api`**.
   `nmfta-ebol` is the trap — `registry.yaml` lists sha256 hashes so it reads as captured, but
   `local/` is not in the repo. `stedi-x12-reference`'s `captured/` holds only a **notes** file.
5. **A closure gate must triage by TENSE**, not by the item's name — a closed entry cites the item
   that closed it, so `grep "item 4"` would fire on its own fix.
6. **An assertion comparing two things to EACH OTHER gates co-drift, not drift.** Add a literal
   anchor beside any `expect(a).toEqual(b)` whose expectation is read out of the system under test.
7. **`Exact<>` over an object shape does not refuse an added OPTIONAL member** — gate the key set
   too. Directly relevant to §3(a).
8. **Tamper every new gate and watch it fail**, and ask whether every tamper changed only **one**
   thing — the co-ordinated tamper is the one usually left untried.

## 6. The seven gates

```
npm run test        -w @pegasus/domain-reference
npm run lint        -w @pegasus/domain-reference
npm run typecheck   -w @pegasus/domain-reference
npm run alloy       -w @pegasus/domain-reference
npm run glossary    -w @pegasus/domain-reference
npm run catalog     -w @pegasus/domain-reference
npm run context-map -w @pegasus/domain-reference
```

Then **diff all six emitted files against `scratchpad/item4/`** and classify only the four
`catalog/*` ones for the version. `glossary.md` / `context-map.md` moving is not a version concern.

## 7. SUPERSEDED — the 2026-10-10 mid-session state, kept for its §M6a pointer only

> **This is NOT the resume point. `## Resume here — checkpoint 2026-10-11` at the top of the file
> is.** Everything below was true when `feat/dr-a8-item4` was still unpushed; that branch has since
> **merged as PR #828** and the symptom index has been built on top of it. The one paragraph still
> worth reading is the last — _"The one thing to re-read first"_ — because `[A8 §4]`'s "Our step"
> genuinely did get larger, and that still bears on §3's three candidate shapes.

**Branch `feat/dr-a8-item4`, committed, NOT pushed and NO PR.** Base `a8e6608b` (= `origin/main`).
Working tree clean. Seven gates green; all six emitted files byte-identical to the baseline.

### What is done

- **§1's measurements M1-M5** — all five, with the bytes checked rather than the prose trusted.
- **§M6a — the (1b) evidence repair, complete.** This is a self-contained, landable change on its
  own: it touches no model code and emits nothing.
- **The plan you are reading.**

### What is NOT done — item 4's actual round has not started

**No design decision has been taken and no model code has been written.** §3's three candidate
shapes are stated and deliberately left open.

### Next action, in order

1. **Decide whether to land M6a first, on its own.** It is prose + captured evidence, zero emitted
   diff, and it de-risks item 4 rather than depending on it. Landing it separately keeps the
   delegation round's diff readable. **Recommended.**
2. **Run §2's four remaining measurements**, starting with the **direction table** — it is the one
   that decides whether §3 is one kind or several. Note §2 item 2 (`isFYI`) is **already done**: it
   is confirmed in the captured successor spec and re-graded.
3. **Then** choose between §3(a), (b) and (c) and **write the argument before the code.**

### The one thing to re-read first

**§M6a's closing paragraph.** `[A8 §4]`'s "Our step" got _larger_ on 2026-10-10: as captured, the
corpus binds a basis constraint to an **event type** and **never to a role**. Item 4's whole
business is role-shaped delegation, so it now has **less** published precedent behind it than the
skeleton implied when it was enlarged. That changes how strong §3(c) — _partial close, refuse the
customer-side on grade_ — looks relative to (a) and (b). **Do not inherit the old reading.**

---

## 8. The priority change — 2026-10-10, and the measurement behind it

**The consumer was named for the first time this session, and it reframes the whole backlog.** The
reference model exists to be supplied to the **MVVM / domain-rule refactor of the legacy
`peg2`/`movemanager` repository** — read by Claude Code sessions (and humans) to recover what the
messy business logic embedded in WinForms front-end code actually _means_ in domain terms. The
intent was to wire it into Claude Code memory and the MVVM migration skills once it is ready.

> **✅ THE HANDOFF IS DONE — 2026-10-12, `movemanager` commit `abe7d206`** on branch
> `docs/domain-reference-handoff` off `origin/dev`. `movemanager/CLAUDE.md` gains a
> `## Domain Reference` section (where it is — `../pegasus/docs/domain-reference/`, both clone
> layouts keep the repos as siblings — which surface answers what, read `symptom-index.md` first,
> use its spellings, do **not** port the TypeScript), the **Pre-Implementation Requirement** gains
> a step 4 requiring every domain concept in a plan to carry its reference anchor, and
> `/extract-domain-rules` + `/migrate-form-to-mvvm` gain the lookup in their prerequisites with a
> per-rule anchoring step in Discovery.
>
> **The rule the user asked for, in three outcomes:** a point exists → use it; recorded **absent or
> owed** → read the reason first and quote it; **nothing at all** → **STOP and ask whether the
> domain reference should be extended before proceeding.** Justified on the rubric's own
> _"our own systems are not evidence for what the domain is"_ — reverse-engineering a reading out of
> a form and baking it into `Pegasus.Domain` launders an implementation accident into a domain rule,
> in the one project that is supposed to be pure.
>
> Verified: all six referenced paths resolve from the `movemanager` root, and the chain was walked
> end to end on a real case (`grep FlashClaim` → the `_Flash/` row marked
> `ABSENT fact class: claim` → the glossary's `Owed` entry).
>
> **So §8.3(4) — "stop and let usage drive it" — is now live.** The next input on this model should
> be a real migration session reporting a gap, not another audit round.

**Nothing imports `@pegasus/domain-reference` and nothing ever will.** It is a workspace dependency
of zero packages, and its own `package.json` says so. **That is not a defect** — for this consumer
the **prose is the product** and the TypeScript is a harness that stops the prose rotting. Any
future round that treats "no consumer" as a problem to fix has misread the purpose.

### 8.1 What was measured against the real consumer

`/home/steve/repos/movemanager`, **3,514** `.vb`/`.cs` files (excluding `.Designer`), filenames
split into CamelCase tokens and matched as **whole tokens**:

|                                                             | files   |
| ----------------------------------------------------------- | ------- |
| touch a concept the model **publishes**                     | **495** |
| touch a concept the model lists as an **absent fact class** | **103** |

**Coverage is good — roughly 83% of the measurable surface already has a domain reading.** Biggest
published hits: storage/stay **175**, charge/invoice **81**, party/agent/role **71**, order **71**,
document **43**, inventory/item **25**, weight **20**.

**The absent surface is concentrated in THREE classes**, which are 99 of the 103:
**`survey` 57 · `estimate` 25 · `claim` 17.** Everything else absent is noise here (`unpacking` 2,
`eta` 1, `chargeCollection` 1, and **zero** for `cube`, `weighing`, `sealIntegrity`, `tracerResult`,
`shipmentCommitment`, `resourceTareWeight`, the three `stay*` classes).

**Migration progress, as a sense of how much the reference will be read:** **240** forms
(non-test, non-ViewModel) against **50** ViewModels — so roughly 17% converted, and the reference
gets used a great deal from here.

> **Measurement caveat, recorded because it nearly shipped.** The first pass used substring matching
> and reported **`eta` = 312 files**. That is `detail`, `metadata`, `beta`, `retail`. Token matching
> gives **1**. A filename count is a proxy for "how much logic lives here", not for complexity —
> good enough to rank, not to size.

### 8.2 Why item 4 is the wrong next round — and it is nothing to do with its quality

The plan above is well-measured and its findings are real. But measured against the consumer, the
last several rounds went somewhere orthogonal to it:

- `[A8 §9 item 3]` — whether a party's grain rides on the role. **Emitted diff empty.**
- `[A8 §9 item 11]` — whether a corroborating standing is typed as a holder kind. **Empty.**
- today's `(1b)` — citation grades and a withdrawn precedent. **Empty.**

**A session reading a WinForms save button touches none of that.** It needs to know what a
corroborating standing _is_ — and `[A8 §4.1]` has said so for five releases. Item 4 asks where a
second delegation axis lives; a migrator never asks that question.

**Three of the last four rounds emitted nothing.** That is what auditing looks like, and the
authority internals are now considerably more rigorous than the consumer requires while three
form-clusters it will hit immediately have no fact class at all.

### 8.3 Do these instead, in this order

1. **A SYMPTOM INDEX — ✅ DONE 2026-10-10, commit `935bc47d` (PR open; see "Resume here").** Landed as `docs/domain-reference/symptom-index.md` (generated, 281 lines) with `tools/generate-symptom-index.ts`, `tests/conformance/symptom-index.test.ts` (9 assertions, 5 tampers) and `data/legacy-correspondence.json` as the single authored input. The description below is kept as written, because it is the specification the artifact was built against.

   **~~A SYMPTOM INDEX — the highest-value thing left, and it is small (~300 lines, generated).~~**
   **The model is indexed by vocabulary, not by symptom, and that is the actual readiness blocker.**
   `glossary.md`'s 246 headings are "Aggregates (15)", "Record types (32)", "Bases (5)". A session
   opening `AcctMemosMaintenanceForm.vb` arrives holding _"accounting memo"_ or _"this form writes
   three fields on save"_ and there is **no path in from either**. Only three files in 37k lines
   mention legacy/MVVM at all, one of which is the README.
   Wanted: legacy concept / form-cluster / field name → fact class · aggregate · authority row ·
   **and the owed cases named as owed**, so a migrator is told "this is undecided" instead of
   finding silence. Generate it from `data/` + the vocabulary so it cannot rot.
   **Wiring the MVVM skill to the model before this exists would hand sessions 3.9k lines of good
   reference they cannot find their way into.**

2. **SURFACE THE EVIDENCE GRADE AT THE POINT OF USE — ✅ DONE 2026-10-11, commit `13bd3b81`.**
   Shipped as `retention:` in `registry.yaml` + the recourse surface in the symptom index; see
   "What §8.3(2) found" in the checkpoint at the top, because **this specification was wrong in
   three places** and the corrections matter more than the text below. In short: retention cannot be
   derived from the filesystem, there are **seven** states rather than four, and "evidence grade"
   already means rubric **S4** (how well _we_ read it) so retention must not borrow the name. The
   description below is kept as written, because it is the specification the artifact was built
   against and argued with.

   **~~SURFACE THE EVIDENCE GRADE AT THE POINT OF USE.~~** Generated, cheap, and it belongs with (1) —
   the symptom index is the surface that needs it most.

   **The measurement that makes this the second priority, not a nicety.** Counting `src:` citations
   across the analysis documents: **2,210 citations, and 65% of them come from the top 10 sources.**
   The top five:

   | source                  | citations | retention                                         |
   | ----------------------- | --------- | ------------------------------------------------- |
   | `sirva-ade`             | 228       | **retained-elsewhere** — private repo, 13 PDFs ✅ |
   | `dp3-400ng`             | 223       | **analysis-only** — no bytes anywhere             |
   | `dtr-part-iv`           | 204       | **analysis-only** — no bytes anywhere             |
   | `cfr-49-375`            | 179       | **captured here**                                 |
   | `dp3-tender-of-service` | 115       | **analysis-only** — no bytes anywhere             |

   > **CORRECTED 2026-10-10, same day, and the error is instructive.** This table first read
   > `sirva-ade` as **secondary** and claimed _"three of the top five have no retained bytes."_
   > **That was wrong about the most-cited source in the model.** `src:sirva-ade`'s bytes **are**
   > retained and version-controlled — 13 ADE PDFs in the **private** repo `pegasus-workflows` at
   > `platform/allied-vanlines/docs/` — and the registry said so all along ("Committed in
   > pegasus-workflows, **referenced not copied**"). The mistake was conflating **"no `captured/`
   > directory in this repo"** with **"bytes not retained"**, which is exactly the conflation the
   > grade work exists to stop. `registry.yaml` now carries a per-tag manifest (file, bytes,
   > sha256); all 13 tags resolve. The remaining two of the top five really are analysis-only.

   **So the grade is not binary — there are FOUR states, and a migrator needs to tell them apart:**

   | state                  | meaning                                                                                                                           | example                        |
   | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
   | **captured here**      | bytes in `<id>/captured/`, greppable now                                                                                          | `cfr-49-375`                   |
   | **retained-elsewhere** | primary bytes exist and are version-controlled, but not in this repo (licence/visibility) — **checkable by a reader with access** | `sirva-ade` (228 citations)    |
   | **analysis-only**      | `analysis.md` prose; nobody can re-check the claim                                                                                | `dp3-400ng`, `dtr-part-iv`     |
   | **unrecoverable**      | the bytes are gone from the world                                                                                                 | the DCSA JIT spec (`[A8 §10]`) |

   **The second and third look identical today and warrant very different confidence.** That, not
   thin evidence, is the actual defect: **542 citations are analysis-only** — `dp3-400ng` **223** +
   `dtr-part-iv` **204** + `dp3-tender-of-service` **115** — and nothing a migrator reads says so.
   That exceeds the top five's captured-plus-retained total (**179 + 228 = 407**).

   **The grade IS already recorded — in `registry.yaml`, which a migrator will never open.** So a
   migration session gets uniformly confident-sounding domain readings and no signal about which
   ones it may lean on. Wanted: every entry in the symptom index (and ideally the glossary) carries
   its state from the four above, plus whether the reading is **`[ORIGINAL]`/`[SYNTHESIS]`** —
   authored by this model rather than found in a source.

   Derive it, do not hand-maintain it: `registry.yaml` now has `retention` / `retained_files`, the
   filesystem has `<id>/captured/`, and the disclosure marks are already in the prose. **A
   per-citation check is the right grain, not per-source** — DCSA has 105 captured files and still
   lost the JIT sub-spec, which is exactly how five citations came to rest on nothing.

   **This is the difference between a migrator trusting the model appropriately and trusting it
   uniformly**, and uniform trust is the failure mode that matters: the model's confident readings
   and its unverifiable ones currently look identical.

3. **Write `survey`, `estimate` and `claim`** — the three absent classes with real mass (99 files).
   `estimate` already has **primary captured** evidence sitting unused: `src:cfr-49-375` §375.401
   (written estimate signed and dated by both parties before the BOL), §375.403 (silence after
   loading is reaffirmation; the propose/decide pair at (a)(8)), §375.409 (the broker-adopted
   estimate — see M3). All three were read this session for other reasons.
4. **Then stop and let usage drive it. ✅ NOW LIVE** — the consumer handoff landed 2026-10-12
   (`movemanager` `abe7d206`; see the banner in §8). Real migration sessions will report what is
   missing far better than another audit round will, and they can now see the model to do it.

   **One wart found while walking the chain, worth fixing when something next touches the
   generator:** the glossary's `Owed` entry for `claim` cites **"§8.3(3)"** — a section of _this
   plan file_, which a `movemanager` reader cannot resolve. The docstring it is generated from
   should cite a published surface (or state the reason in full) rather than a plan.

**One thing worth rescuing from item 4, as a fix and not a round:** **M2** — `authorityToDeclare`
**authorises whoever presents an instrument.** No grantee check, because `Instrument` has no
grantee and the function is never passed `declaredBy` although its only caller has it. That is a
~50-line correctness fix with teeth, and it does not need the delegation design argument settled.

### 8.4 If item 4 is ever resumed

Everything above §8 stands. Start at §7's resume list, and re-read **§M6a's closing paragraph
first** — `[A8 §4]`'s "Our step" got _larger_ on 2026-10-10 (as captured, the corpus binds a basis
constraint to an **event type** and **never to a role**), so §3(c) — partial close, refuse the
customer-side on grade — now looks stronger relative to (a) and (b) than it did when this plan was
written. **Do not inherit the old reading.**

### 8.5 Still owed, and not superseded by any of the above

- **`dcsa/analysis.md`'s untriaged `jit/…` citations** (M6b) — the ERP-A / `Timestamp` /
  `TerminalCall` / `PortCallService` readings and the A3/A4 rubric scores resting on them. **A3's
  and A4's**, blanket-disclosed, each needs checking against the captured successor spec rather
  than assuming.
- **`[A8 §9]` items 1, 2, 4-10** remain open. Item 2's residue (NTS warehouseman, `RATED` tariff
  owner) is blocked on `secondary` grade; the government-office unfold is breaking on `secondary`
  and has now been deferred three times.
- **`authority.ts:562`'s two-homes `TODO`** — `[A8 §5]` is carried twice and nothing checks the two
  agree. It has a documented drift instance from the item-11 round.

### 8.6 Source coverage — measured, because "only 9 of 87 captured" is the wrong number

Asked why so few of the registered sources are covered. Three different numbers, and the
pessimistic one is the least meaningful:

| measure                                      | count  | of 87   |
| -------------------------------------------- | ------ | ------- |
| have **captured bytes**                      | 9      | 10%     |
| status **`analyzed`**                        | 32     | 37%     |
| **actually cited** in the analysis documents | **52** | **60%** |

**Every `analyzed` source is cited — 32 of 32, zero analyzed-but-unused.** No analysis effort has
been wasted. And the **20 cited-but-not-analyzed** are not a gap: `iso-17451`,
`x12-transportation`, `sap-tm`, `oracle-otm`, `nmfta-scac` and the rest appear in "what we could
not see" / "what would overturn this" passages. That is the model **disclosing its own blind
spots**, which is `[SD §0]` working as designed.

**Most of what is left is behind a locked door, not behind effort.** Openness across all 87:
**53 public, 18 gated-partner, 8 internal, 3 paid, 3 free-registration, 2 licensed.** Cross-tabbed:

| status       | n   | behind an access gate |
| ------------ | --- | --------------------- |
| `needs-user` | 14  | **11** (79%)          |
| `skipped`    | 20  | 11                    |

And it bites hardest where it would matter most: **`iso-17451` is P1 and paid**,
`x12-transportation` is licensed, `nmfta-scac` and `en-12522-2024` are paid. Those are the
industry standards that would most constrain the model, and they cost **money**, not rounds.

**The remaining tail is 35 P3 sources and skipping them is correct.** They are overwhelmingly
telematics / visibility vendors — `geotab`, `motive`, `orbcomm`, `platform-science`,
`trimble-peoplenet`, `fourkites`, `transflo`, `trucker-tools` — describing **trucking telemetry**,
not household-goods moving.

**So concentration is the appropriate shape for this domain**: very few published sources actually
describe household-goods moving, the model found them early and mined them hard. **Breadth is not
the problem.** The problem is in §8.3 item 2: the concentrated core sits in **four different
retention states that currently look identical to a reader**, and the two that matter most are the
ones nobody can tell apart —

- `sirva-ade`, **228 citations**, is **retained-elsewhere**: primary bytes, version-controlled in a
  private repo, checkable by anyone with access. Its lack of a `captured/` directory here is a
  **licence and repo-visibility decision**, not an evidence weakness. (`registry.yaml` now carries
  the per-tag manifest. **This plan asserted the opposite earlier the same day — see the correction
  in §8.3 item 2**, which is itself the clearest argument for doing the grade work.)
- **542 citations are genuinely analysis-only** — `dp3-400ng` **223** + `dtr-part-iv` **204** +
  `dp3-tender-of-service` **115** — prose nobody can re-check, and **nothing a migrator reads says
  so.** That is **more than the captured and retained-elsewhere top-five entries combined** (179 +
  228 = 407).

**That is the defect: not thin evidence, but indistinguishable states.** Fixing it is generated and
cheap; leaving it means a migration session trusts a re-checkable 228 and an unverifiable 223
exactly alike.
