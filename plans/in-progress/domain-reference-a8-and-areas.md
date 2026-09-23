# Domain reference — A8's authority rows and the unwritten areas: plan and resumption state

**Written 2026-09-22, revised 2026-09-23** to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

**Deliverable 1 of the previous revision — the A4 reason vocabulary — LANDED.** Its record, including
five findings worth not rediscovering, is `plans/completed/domain-reference-a4-reasons.md`. Read that
first; it is short.

**Next deliverable:** **A8's owed authority rows** (§5). Then the unwritten area comparisons (§6).

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. It has three layers that are all live: a **research corpus** (`docs/domain-reference/sources/`,
87 sources, 32 analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an
**executable specification** (`packages/domain-reference/`) whose glossary and published event
catalog are both **generated from the code and gated against drift**. The catalog is at `specVersion`
**0.2.0** — A4 published the reason vocabulary, which took it off `0.1.0`. What keeps it pre-1.0 now
is **the authority rows**, and no amount of vocabulary work moves that.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                 | Landed              |
| -------------------------------------- | ----------------------------------------------------- | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                              | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                          | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`   | `a4b0bd7f`, PR #713 |
| **A4 reason vocabulary, 23 members**   | `analysis/A4-execution-events.md` + `src/outcomes.ts` | this branch         |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`.

### Gates, all green

`tsc` silent · **306 tests in 18 files** · Alloy runner exits non-zero on a counterexample ·
glossary is a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

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

- **The envelope and the single classification axis** — `[SD §1.1]`, `[SD §1.3]`. One subject, one
  `type`, tense on the value as `basis`. Model-checked in Alloy.
- **The 33-member record vocabulary** with canonical subject families and qualifiers, published as
  JSON Schema for both faces.
- **The 23-member reason vocabulary** — `[A4 §3]`, with the per-code scope, attribution discipline
  and remedy obligation in `data/reasons.json` and held to `REASON_CODES` as a set.
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion as the one
  sub-shipment grain, custody as a **projection** (never stored), correction semantics, the identity
  key, the capture rules M1–M7.
- **The ubiquitous language** — the generated glossary, 15 closed vocabularies plus the reason codes.
- **Three of thirteen areas written**: A3 (trip/stop/assignment), A8 (authority skeleton), A4
  (**vocabulary only** — its scope note and `rubric.md`'s note both say so).

### What is NOT ready — the work this plan sequences

1. **Six of the nine detail areas have no analysis at all**: A1 order lifecycle, A2 shipment
   structure, A5 SIT, A6 documents, A7 charges, A9 identity. `rubric.md` now carries a note saying
   exactly this, so the claim is no longer unbacked — but the areas are still unwritten. (A10–A13 are
   context-map-only **by design** — not gaps.)
2. **19 of 31 record types carry an owed authority row** — "who wins when two parties disagree" is
   unanswered for most fact classes. **This is now the single thing capping the catalog at pre-1.0.**
3. **Three owed code vocabularies remain**: `roleClass` ([A8 §9 item 2] — and **A4 handed it a
   concrete requirement: it needs an explicit non-party member**, because `FORCE_MAJEURE` and
   `CAUSE_UNKNOWN` attribute to nobody), `unitOfMeasure`, `identityScheme`. The glossary's Owed
   section lists them; before A4 the ledger could not see them at all.
4. **F3, F4, F5 open** in `analysis/findings-from-alloy.md`; 21 declared owed values; 10 fact classes
   the corpus names that the vocabulary does not carry (`weighing`, `unpacking`, `eta`, `cube`,
   `survey`, `estimate`, `claim`, `sealIntegrity`, `tracerResult`, `resourceTareWeight`).
5. **A remedy that opens a SIT stay** is owed to A5 — `PARTY_NOT_READY` wants it, and
   `src:shippeo`'s analysis calls it "the deepest structural gap".
6. **32 of 87 sources analysed**; 15 registry entries `needs-user` (Atlas reference-data needs a
   subscription key that does not exist in the repo; `iso-17451` is paid; `omnitracs-one-xrs`).

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** The model is an **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml` (`pegasus-cloud-domain`, `pegasus-cloud-prisma`,
   `pegasus-integration-floors`, `pegii-order`, `pegii-longhaul`, `pegasus-domain-plans`,
   `equus-sender-legacy`). Never cite them for what the domain IS. Partner contracts (Weichert,
   SIRVA ADE, Atlas) ARE external evidence.
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**. If a task appears to need pegII
   or Cloud data, that is the signal it is a _mapping_ task belonging to a workstream that does not
   exist yet. (This was corrected three times in one earlier session. Don't be the fourth.)
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use. A source saying something narrower does not support
   the claim — and note the mirror, which A4 hit: **a source saying something about one publisher
   does not license a claim about the corpus.** [SD §2.4]'s "none of which Shippeo has" had been read
   as "no source publishes these", and 400NG Item 125.1 publishes an enumerated list. Read the
   sentence, not the summary. The glossary coverage gate enforces the rule mechanically; it cannot
   catch this.
4. **OWED means owed.** Where a document declares something owed, represent it as owed — a distinct
   value, never a null that reads as "nobody" and never a guess that makes the types tidy.
5. **Code is normative for structure; documents are normative for rationale.** Disagreement is a
   defect, which is what the conformance tests exist to catch.
6. **Precedence.** `analysis/00-shared-decisions.md` (**[SD]**) outranks everything. Then
   `A8-authority-skeleton.md` (**[A8]**). Then `A4-…`, `A3-…`, `fork-order-…`, `fork-time-…`. Then
   `published-event-catalog.md` (**[catalog]**), which derives from [SD] and does **not** outrank it.

---

## 4. Landing a change to a published vocabulary — the recipe A4 established

Follow this order; it is what made A4 land without a false green.

1. Add the members to the `as const` array in `src/`, one JSDoc each, **each carrying a citation or a
   marker** — the disclosure gate reads the docstring. A JSDoc must not start with a bold marker
   (the extractor eats one asterisk), and markdown emphasis must be `_x_`, not `*x*`, or the
   generated glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader in `src/data.ts`. **Cross-check the two
   as a set**, and remember `readReasonCodeEntry`-style readers are shared with the
   `illustrativeOnly` block, which needs the new fields too.
3. Classify the change against `[catalog §2.3]` **before** picking the version. Adding a member to a
   published enum and publishing a vocabulary that shipped owed are different changes — the second
   narrows `string` → enum and needed a new class, `publishedOwedVocabulary`.
4. Register the vocabulary in `VOCABULARIES` in `tools/generate-glossary.ts` (closed enums are **not**
   auto-discovered) and add the new document to `DOCUMENTS` so `[X §y]` citations link.
5. Bump `CATALOG_VERSION`, then `npm run glossary` **and** `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.** A4's four: drop a code from the table
   (set check), rename one in the document (naming gate), edit the generated glossary (staleness),
   add a code naming an outcome (compile-time rule 1).
7. Run `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — pre-existing,
   not yours.

---

## 5. Deliverable 1 — A8's owed authority rows (do this first)

19 of 31. Since A4 landed this is **the** thing keeping the catalog pre-1.0, and it unblocks scoring
in **every** area:
`[A8 §10]`'s last row and `[SD §4.7]` note 3 both bar a provisional reading from scoring a dependent
decision above medium.

- The ledger is `[A8 §9 item 8]`. The current list is generated — read the **Owed** section of
  `docs/domain-reference/glossary.md`, never a copy of it.
- **F3 and F5 land with this work**, and F5 is the one with a published consequence: role names
  became fact-key components at F1, so their spelling is load-bearing. `ROLE_NAMES` in
  `envelope.ts` pins A8-NAME-1's lower-camel spelling over `src:sirva-ade`'s capitalised cast, and
  **the catalog now publishes that spelling on the wire**. If A8 settles the other way it is a
  `changedRoleNameSpelling` — **breaking, a new major**. `[catalog §5]` item 2 records this.
- **F4** — `ExternallyPerformedLeg.performedBy` has no consumer: `[SD §4.8.3]` rule 1 names it as a
  fold input but `holder` comes solely from the selected receipt, and Alloy shows they can disagree.

---

## 6. Deliverable 2 — the unwritten area comparisons

In the order the model's own owed list keeps pointing at: **A1** (order lifecycle transition
mapping), **A2** (shipment identity across a terminated SIT stay, with A5), **A5** (SIT). Then A6,
A7, A9.

Pattern to follow: `analysis/A3-trip-stop-assignment.md` for an area document,
`templates/source-analysis.md` for a per-source one. The rubric — 13 areas, 8 criteria, evidence
grades — is `docs/domain-reference/rubric.md`.

---

## 7. Documentation defects — FIXED, recorded so they are not re-fixed

Both were the previous revision's warm-up items and both landed with A4.

- `docs/domain-reference/README.md` advertised a **`model/`** and a **`mappings/`** layer, neither of
  which exists. It now describes what does — the executable specification and the generated
  glossary — records the three pieces of `model/` that genuinely are missing (**the context map**,
  **the command side**, **the aggregate lifecycles**) as owed, says `mappings/` is absent
  deliberately, and carries an honest Process table.
- `docs/domain-reference/rubric.md` marked all nine detail areas "modeled in detail" with nothing
  saying which actually were. A note under the table now states it. **Keep that note current** — it
  is the one place a reader learns that six areas have no analysis.

The three missing `model/` pieces are real work nobody has picked up. They are not blocked on
anything, and the context map is the cheapest of the three.

---

## 8. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.** In an earlier session an agent reported a
  document conformed and stamped it so, without making the edits; a verifier caught it by reading
  the file.
- **Prove a gate bites by tampering.** Edit the artifact, watch it fail, restore. A false green is
  worse than a red — Alloy found the F1 defect precisely because a passing TypeScript scenario test
  was running on a history the catalog could not publish.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` held four literal NULs, so every `grep` of it returned nothing with
  **exit 0**. That is the concrete cause of "two of my own tamper attempts silently matched
  nothing". **When a negative grep result is load-bearing, use `/usr/bin/grep -a`.** Recorded in
  `dolas/agents/project/GOTCHAS.md`.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field;
  asking for it fails the whole call, and a poll loop that swallows the error reports nothing for
  half an hour while looking healthy. Queue state comes from GraphQL.
- **Verify AFTER the pre-commit hook, not before.** The hook runs `eslint --fix` + `prettier --write`
  and folds the result into the commit. Prettier has previously displaced 35 `@ts-expect-error`
  directives away from the lines they suppress — a green pre-commit run, a broken commit.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is **not** a prettier
  fixed point — prettier collapses short arrays onto one line — so without it the commit hook
  rewrites every emitted file behind a green staleness run. The glossary avoids markdown tables for
  the same reason (prettier re-pads cells).
- **`anyOf`, never `oneOf`** when rendering a TypeScript union. A union means "assignable to at least
  one member" and members are not always disjoint — `Reason`'s two branches overlap on a code of
  `OTHER` carrying a remark, so `oneOf` rejects records the types admit. **This matters directly to
  A4.**
- **`aliasSymbol` is lost when a distributive conditional is instantiated.** `SubjectRef` inlined
  fourteen ways until it was recognised by _shape_ and named by its canonical family.
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker** — the glossary's doc extractor eats one asterisk.
  Write "the fact-class family — **derived**; …", not "\*\*Derived.\*\* the fact-class family".
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member. To make a
  `[yourdoc §x]` citation link, add it to `DOCUMENTS` in `generate-glossary.ts`.

### Workflows and CI

- **Parallel authoring causes drift** — three decision documents once contradicted each other and
  needed a reconciliation round. **Settle a shared layer FIRST, then fan out.** Keep a workflow under
  ~6 agents when each does heavy reading; one 10-agent run died on a session limit (its file writes
  survived, its results did not).
- **CI runners are slower than this machine.** Compiler-driven tests need explicit timeouts; vitest's
  default 5s passed locally and timed out in CI (#712). The catalog and glossary suites carry
  explicit budgets. `testTimeout` covers test **bodies** only — `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json`/`pom.xml` in the diff, **including inside captured
  third-party material**. Capture policy: commit only the artefacts the analyses cite; keep full
  clones in gitignored `local/`; never commit a clone's manifests, build scripts or CI config
  (`docs/domain-reference/sources/README.md`).
- **Extractors:** `pdf2txt.py` / `odt2txt.py` lived in a session scratchpad and are **gone**. If
  source PDFs/ODTs must be re-read, recreate them (pypdf in a venv; ODT is a zip containing
  `content.xml`). No poppler on this machine.

---

## 9. Housekeeping left over

- **Worktrees on disk, merged and safe to remove — agents are barred from doing it**, so ask:
  `scripts/rm-worktree.sh domain-reference` · `scripts/rm-worktree.sh domain-model` ·
  `scripts/rm-worktree.sh event-catalogue`.
- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end — which
  is ours: `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in
  GLOBAL and the `nw` tenant.

---

## 10. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
scripts/workstream-start.sh feat a8-authority plans/in-progress/domain-reference-a8-and-areas.md
```

Then work in the new worktree; the plan is seeded into `plans/in-progress/` there and commits with
the implementation as **one PR**. Archive it to `plans/completed/<short-hash>-<slug>.md` **before**
opening the PR.

**Read before writing anything:**

1. `plans/completed/domain-reference-a4-reasons.md` — short, and five findings worth not
   rediscovering.
2. `docs/domain-reference/analysis/A8-authority-skeleton.md` in full, especially §5 (the rows that
   exist), §9 (the ledger of what is owed) and §10's last row (the scoring cap).
3. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current, and
   since A4 it lists owed **vocabularies** as well as owed values.
4. `docs/domain-reference/analysis/findings-from-alloy.md` — F3, F4 and F5, which land with this work.
5. `docs/domain-reference/analysis/published-event-catalog.md` §2.3 and §5 — what is already promised
   to consumers, and what changing a role name's spelling costs (**breaking, a new major**).
