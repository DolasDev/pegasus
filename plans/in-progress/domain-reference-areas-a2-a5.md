# Domain reference — the remaining unwritten areas: plan and resumption state

**Written 2026-09-23, revised the same day once A1 merged**, to be read by a session with **no prior
context**. Everything needed to resume is here or is named by path. Read this whole file before
starting.

It replaces `plans/in-progress/domain-reference-a8-and-areas.md`, which was **deleted** in PR #719,
not archived — that round's record is `plans/completed/domain-reference-a8-authority-rows.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

**Three deliverables have landed.** Read their records first; each is short and each carries findings
worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary, 23 members.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. **Read its "headline"
  before planning any area work**: rows that were expected to be effort turned out to be corpus. Its
  count of twelve is the count **as at that round**; A1 later moved the three order rows out of it,
  so the corpus-blocked set is **nine** — `[A8 §11]` revision 8.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — **the most recent, and the one that
  most changes how to read the other two.** A1 found that A8's "no source in the corpus attaches an
  authority to [the order lifecycle]" is too strong in one direction and not specific enough in the
  other, and that the real blocker is a **`boundBy` gap** — a schema question, not a research one.

**Next deliverable:** **A5** (storage-in-transit), then **A2** (shipment structure), then A6, A7, A9.
§6 says why that order changed from the previous plan's.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.4.0** and now
carries **two projections** — `custodyAt` on the goods side, `orderStageAt` on the commitment side.
What keeps it pre-1.0 is the **fourteen remaining authority rows**, and A1 has now sharpened why: for
`orderResponse` and `orderCancellation` the corpus is not the blocker, the `boundBy` enum is.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                                 | Landed              |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                                              | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                                          | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`                   | `a4b0bd7f`, PR #713 |
| A4 reason vocabulary, 23 members       | `analysis/A4-execution-events.md` + `src/outcomes.ts`                 | `20971ebe`, PR #716 |
| A8 §5 rows 12-16, closing F3 and F5    | `analysis/A8-authority-skeleton.md`                                   | `984200cd`, PR #717 |
| **A1, the order & service lifecycle**  | `analysis/A1-order-service-lifecycle.md` + `src/rules/order-stage.ts` | `1b9e5df3`, PR #719 |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`.

### Gates, all green

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

**No count is written here on purpose.** The line under this one used to read "336 tests in 19 files"
and was wrong within the hour, because two tests were added after it was typed. §4 item 10 is the
rule: a number in prose is gated or it is deleted, and nothing gates this one — the commands below
produce it in about five seconds.

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
- **Two projections**: `custodyAt` (`[SD §4.8]`) and `orderStageAt` (`[A1 §3.3]`). Neither is stored,
  neither is asserted, both name the rule that produced the answer.
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion, correction
  semantics, the identity key, the capture rules M1–M7.
- **Four of thirteen areas written**: A1, A3, A8, and A4 (**vocabulary only** — its own scope note
  says so).

### What is NOT ready

1. **Five of the nine detail areas have no analysis at all**: A2, A5, A6, A7, A9. `rubric.md`'s note
   is current and says exactly this. (A10–A13 are context-map-only **by design** — not gaps.)
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — but see §5, which is now a different shape of problem than it was.
3. **Three owed code vocabularies**: `roleClass` (now required to carry an explicit **non-party**
   member by **three** codes, one of them regulation-grade — `[A1 §Cross-area]`), `unitOfMeasure`,
   `identityScheme`.
4. **F4 open** in `analysis/findings-from-alloy.md`; 19 declared owed values; 10 fact classes the
   corpus names that the vocabulary does not carry.
5. **A remedy that opens a SIT stay** is owed to A5 — `PARTY_NOT_READY` wants it, and `src:shippeo`'s
   analysis calls it "the deepest structural gap". **This is now the strongest reason to do A5 next.**
6. **A1 handed [SD] one defect**: the requestor of a **completed** cancellation has no field, because
   [SD §2.3] invariant 2 forbids `reasons[]` at `COMPLETED` and [SD §4.7.2e] item 2 puts the requestor
   there. Two candidate fixes, both shared-layer. `[A1 §3.5]`, `[A1 §6]`.
7. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence. A1 hit the sharpest form of this:
   `src:pegasus-integration-floors`' nine-value order-status enum is **ours**, not evidence.
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**. (Corrected three times in one
   earlier session. Don't be the fourth.)
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use. Note the two mirrors already caught: a source saying
   something about one publisher does not license a claim about the corpus (A4), and a claim that
   "no source attaches X" needs the corpus read for X specifically (A1).
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess.
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the area
   documents `[A1]`, `[A4]`, `[A3]`, the forks. Then `[catalog]`, which derives from [SD].

---

## 4. Landing a change — the recipe A4, A8 and A1 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring. A JSDoc must not start with a bold marker, and markdown
   emphasis must be `_x_`, not `*x*`, or the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set.**
3. Classify the change against `[catalog §2.3]` **before** picking the version.
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered.
5. Bump `CATALOG_VERSION`, then `npm run glossary` **and** `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — pre-existing.
8. **Read the emitted schema diff before classifying the change.** A8's rows looked internal until
   `git diff docs/domain-reference/catalog/*.json` showed a new reachable enum member.
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted — new, from A1.** `[catalog §5]`'s five owed
    counts are read by `tests/conformance/catalog.test.ts` and stayed correct across two releases;
    three ungated copies of the same numbers rotted. The same trap bit a tamper test that hard-coded
    "23 members" where the loader derives it.

---

## 5. The authority rows — what A1 changed about this problem

Read `[A1 §Cross-area]` before `[A8 §9 item 8]`; it reframes it.

- **Owed to A8 and doable:** `partyRole` (§9 items 1-2) and `notification` (§9 item 6).
- **`orderResponse` and `orderCancellation` are NOT corpus-blocked.** Their authoritative role is
  resolved by the order's own award — structurally `ASSIGNMENT` one aggregate over — and A8's six
  `boundBy` members have nothing that means it. **That is a schema decision A8 can take today**, and
  it is the cheapest remaining move on the owed count.
- **`orderAward` genuinely is blocked**, by A8's own mint principle: it mints the principal relation,
  so it cannot be `PRINCIPAL`, and `KEY` cannot rescue it because its actor is in `context[]`.
- **The nine plan-, membership- and assignment-side rows** are still corpus-blocked, but A1 found one
  citation nobody had: `src:dcsa`'s JIT `classifierCode` binds a **planned time** to a role verbatim.
  It does not overturn `[SD §4.7.1]`'s "no source binds a plan change to an asserting role" — a time
  is not a change — but it is where to look first.
- **F4** is the only open Alloy finding.
- **Three pieces of the old `model/` layer are missing**: the context map, the command side, the
  aggregate lifecycles. The context map is the cheapest and would help the area work.

---

## 6. THE NEXT DELIVERABLE — A5, then A2

**The previous plan said A1, A2, A5. A1 is done and the order of the other two has swapped**, for
two reasons that came out of A1:

1. **A5 is owed a typed remedy by A4** — "a remedy that opens a SIT stay", which `src:shippeo`'s
   analysis calls the deepest structural gap in the corpus, and which `PARTY_NOT_READY` is waiting
   for. It is the only owed item in the model with a _named requester_ and a _named shape_.
2. **A2's central question depends on A5.** Shipment identity across a terminated SIT stay is
   `[SD §10.4]`'s explicitly-not-settled item, and A1 added a second dependency: `src:dtr-part-iv`
   §D.5.c(2) says that on SIT termination "the warehouse becomes the final destination of the
   shipment" and the TSP's BL liability ends — while §D.5.c(1) NOTE says the customer is still
   entitled to delivery out. **One obligation survives the death of the contract that created it**,
   and under `[A1 §3.3]` a terminated-SIT order is still `ACCEPTED`. A5 has to say what that means
   before A2 can say what the shipment is.

A5 also inherits the richest single-source material in the corpus — `src:atlas-world-group-api`
scores `C1 = 3`, `C4 = 3`, `C5 = 3`, `C6 = 3`, `C7 = 3` on A5, its standout area — plus
`src:dtr-part-iv`'s escalating notification ladder (a different actor and a different evidence
requirement per rung) and `src:cfr-49-375` §375.609's conversion-to-permanent-storage notice rules.

Pattern to follow: `analysis/A1-order-service-lifecycle.md` is the closest model — it has the same
shape as A3 with a much smaller §3, because most of its structure was settled above it. Start §1 by
finding the **named owed items**: grep the glossary's Owed section and `[SD §10.4]` for the area's
id, exactly as A1's §1 table was built. The rubric — 13 areas, 8 criteria, evidence grades — is
`docs/domain-reference/rubric.md`.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red.
- **Read the existing tests for the records you are writing about — new, from A1.** A1's first draft
  of `A1-PERM-2` said the model "already has the fields" for a cancellation's requestor. The
  scenario-6 test had asserted the opposite as a FINDING months earlier. Prose beside a table is not
  a claim the code makes, and the test suite is where that gets settled.
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` held four literal NULs. **When a negative grep result is load-bearing, use
  `/usr/bin/grep -a`.** Recorded in `dolas/agents/project/GOTCHAS.md`.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
  Queue state comes from GraphQL.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write` and
  folds the result into the commit.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point.
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker.**
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — write a
  rejected candidate in prose, never in a code span. To make a `[yourdoc §x]` citation link, add it
  to `DOCUMENTS`. **It also holds every published reason code to being named by `[A4]`**, which is
  what forced A1's mint into A4's own evidence table — correctly.

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out. Keep a workflow
  under ~6 agents when each does heavy reading.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only —
  `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, **including inside captured
  third-party material**.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. Recreate if source PDFs/ODTs must be
  re-read (pypdf in a venv; ODT is a zip containing `content.xml`). No poppler on this machine.
- **Worktree slugs collide on the derived Postgres port.** `new-worktree.sh` computes it as
  `5433 + (sum of the slug's character ordinals) % 60`, so two unrelated names can land on one port.
  It fails **after** creating the worktree and branch, leaving partial state that
  `scripts/rm-worktree.sh <slug>` clears. Only **5451** (`mobile-store-assets`) and 5432 (the shared
  compose DB) are taken as of 2026-09-23, so a collision is unlikely now — but check rather than
  assume, and pick another slug rather than tearing down someone else's container.

---

## 8. Housekeeping left over

**Two items that used to be here are DONE** (2026-09-23, after #719 merged), recorded so nobody
re-raises them: the four merged worktrees were removed — `a1-lifecycle`, `domain-reference`,
`domain-model`, `event-catalogue`, with their branches and Postgres containers — leaving only
`pegasus-mobile-store-assets`, which belongs to a different workstream; and the stale untracked
`plans/in-progress/domain-reference-a4-reasons.md` was deleted from `main`.

What is actually left:

- **Two spent plans are still sitting in `plans/in-progress/`, and they are not in-flight.** This is
  the known trap that `plans/in-progress/` is **not** an in-flight signal (#567): the directory accumulates
  plans whose work shipped. `domain-model.md` is the executable layer, which **landed** as
  `5b7c2ccd` / PR #712; `domain-reference-model.md` is the research corpus, which **landed** as
  `34713637` / PR #705. Both worktrees are gone. Neither has a record in `plans/completed/`, which
  is why moving them is a judgement call rather than a chore — a plan is not a record, and this
  effort's convention is that the session which finishes the work **rewrites** the plan as a record.
  **Of the three `domain-reference*` files in `plans/in-progress/`, this one is the only live plan.**
- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end —
  `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in
  GLOBAL and the `nw` tenant.

---

## 9. Starting the next session

**State as of 2026-09-23:** `main` is at `1b9e5df3` (A1, PR #719), merged **and deployed** — `CI`,
`Deploy` and `Push on main` all green. The primary checkout is clean and parked on `main`. Nothing is
in flight. One unrelated worktree exists (`pegasus-mobile-store-assets`, port 5451).

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
scripts/workstream-start.sh feat a5-storage plans/in-progress/domain-reference-areas-a2-a5.md
```

`a5-storage` hashes to port **5485**, which is free — see §7's slug/port note before choosing any
other name.

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh` that cost the A1 session time.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies — the
> seeded one and this file. Do not edit both. The pattern that worked: write the new record at
> `plans/completed/domain-reference-a5-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file
> from the index. And the script provisions Postgres **after** creating the worktree and branch, so a
> port collision fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a1-order-lifecycle.md` — the most recent, and the one that
   changes how the A8 ledger reads.
2. `docs/domain-reference/analysis/A1-order-service-lifecycle.md` — the closest model for an area
   document that sits on a settled shared layer, and the source of §4 item 10 and §7's test rule.
3. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
4. `docs/domain-reference/analysis/00-shared-decisions.md` §10.4 — what the shared layer explicitly
   did not settle, which is where A5's and A2's owed items are named.
5. `docs/domain-reference/analysis/published-event-catalog.md` §2.3 and §5 — what is promised to
   consumers, and what changing a role name's spelling costs (**breaking, a new major**).
