# Domain reference — the remaining unwritten areas: plan and resumption state

**Written 2026-09-23, after A5 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a2-a5.md`, which was **deleted** in the A5 PR,
not archived — that round's record is `plans/completed/domain-reference-a5-storage-in-transit.md`.
The convention in this effort is that a finished round leaves a **record** in `plans/completed/` and
its **plan** is rewritten as the next round's, so do not go looking for an archived copy of a
superseded plan.

**Four deliverables have landed.** Read their records first; each is short and each carries findings
worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary, 24 members after A1.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. Its count of twelve
  corpus-blocked rows is the count **as at that round**; A1 moved the three order rows out of it.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — the `boundBy` gap, and the rule that a
  count in prose is gated or deleted.
- `plans/completed/domain-reference-a5-storage-in-transit.md` — **the most recent, and the one that
  most changes what to do next.** Its A8 finding is that three concrete rows are blocked on
  [A8 §9 item **1**] (the party entity), not item 8, and that the discriminator is whether the
  asserter was physically present. That pattern will repeat in A6, A7 and A10.

**Next deliverable:** **A2** (shipment structure), then A6, A7, A9. §6 says why, and §5 says what
changed about the A8 ledger.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.5.0** and
carries **two projections** — `custodyAt` and `orderStageAt` — and, since A5, a `Remedy` union with
no owed branch. What keeps it pre-1.0 is the **fourteen remaining authority rows**; A1 sharpened why
for three of them and A5 sharpened why for a different three that are not yet rows at all.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                                  | Landed              |
| -------------------------------------- | ---------------------------------------------------------------------- | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                                               | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                                           | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`                    | `a4b0bd7f`, PR #713 |
| A4 reason vocabulary                   | `analysis/A4-execution-events.md` + `src/outcomes.ts`                  | `20971ebe`, PR #716 |
| A8 §5 rows 12-16, closing F3 and F5    | `analysis/A8-authority-skeleton.md`                                    | `984200cd`, PR #717 |
| A1, the order & service lifecycle      | `analysis/A1-order-service-lifecycle.md` + `src/rules/order-stage.ts`  | `1b9e5df3`, PR #719 |
| **A5, storage-in-transit**             | `analysis/A5-storage-in-transit.md` + `OpensStay` in `src/outcomes.ts` | _this round_        |

Repo: `github.com/DolasDev/pegasus`, primary checkout `~/repos/pegasus`.

### Gates, all green

`tsc` silent · the vitest suite green · Alloy runner exits non-zero on a counterexample · glossary is
a prettier fixed point · catalog is a prettier fixed point and round-trip-validated.

**No count is written here on purpose** — §4 item 10 is the rule. The commands below produce it in
about five seconds.

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
- **Both remedy shapes** — `newWindow` (`[A4 §3]`) and `opensStay` (`[A5 §3.2]`). The union carries
  no owed branch, and no remaining shape has a named requester in the corpus.
- **Two projections**: `custodyAt` (`[SD §4.8]`) and `orderStageAt` (`[A1 §3.3]`). Neither is stored,
  neither is asserted, both name the rule that produced the answer.
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion, correction
  semantics, the identity key, the capture rules M1–M7.
- **Five of thirteen areas written**: A1, A3, A5, A8, and A4 (**vocabulary only** — its own scope
  note says so).

### What is NOT ready

1. **Four of the nine detail areas have no analysis at all**: A2, A6, A7, A9. `rubric.md`'s note is
   current and says exactly this. (A10–A13 are context-map-only **by design** — not gaps.)
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — see §5, which now has two different shapes of blocker in it.
3. **Three owed code vocabularies**: `roleClass` (required to carry an explicit **non-party** member
   by three codes — `[A1 §Cross-area]`), `unitOfMeasure`, `identityScheme`.
4. **F4 open** in `analysis/findings-from-alloy.md`; 18 declared owed values; **13** fact classes the
   corpus names that the vocabulary does not carry — three of them added by `[A5 §3.6]`.
5. **A2's half of `[SD §10.4]` bullet 1 is the oldest open item in the model** and is now the only
   half left: A5 closed the stay side. **This is the strongest reason to do A2 next** — §6.
6. **A1 handed [SD] one defect**: the requestor of a **completed** cancellation has no field, because
   [SD §2.3] invariant 2 forbids `reasons[]` at `COMPLETED` and [SD §4.7.2e] item 2 puts the
   requestor there. Two candidate fixes, both shared-layer. `[A1 §3.5]`, `[A1 §6]`.
7. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence. A1 hit the sharpest form of this
   (`src:pegasus-integration-floors`' order-status enum is **ours**); A5 hit the scoring form
   (`src:pegii-longhaul` scores `C2 = 3` on A5 and is ours).
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**.
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use.
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess.
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the
   area documents `[A1]`, `[A4]`, `[A5]`, `[A3]`, the forks. Then `[catalog]`, which derives from
   [SD].

---

## 4. Landing a change — the recipe A4, A8, A1 and A5 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring. A JSDoc must not start with a bold marker, and markdown
   emphasis must be `_x_`, not `*x*`, or the glossary stops being a prettier fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set.**
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet. A5 added `publishedOwedShape`.
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered.
5. Bump `CATALOG_VERSION`, then `npm run glossary` **and** `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — pre-existing.
8. **Read the emitted schema diff before classifying the change.**
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted** — `[catalog §5]`'s five are the gated ones.
11. **An `Exact<>` alias is not a gate until something is assigned to it — new, from A5.**
    `export type X = Exact<A, B>` on its own evaluates to `never` and reports nothing. The
    convention is `const _x: X = true` on the next line; `src/catalog.ts:51`, `src/data.ts:281`,
    `src/assertions.ts:209` and `src/rules/authority.ts:1019` all do it. **This was found by
    tampering and by nothing else.**

---

## 5. The authority rows — two different blockers now

Read `[A5 §Cross-area]` to [A8] and `[A1 §Cross-area]` before `[A8 §9 item 8]`; between them they
reframe it.

- **Owed to A8 and doable:** `partyRole` (§9 items 1-2) and `notification` (§9 item 6).
- **`orderResponse` and `orderCancellation` are NOT corpus-blocked** (A1). Their authoritative role
  is resolved by the order's own award — structurally `ASSIGNMENT` one aggregate over — and A8's six
  `boundBy` members have nothing that means it. **A schema decision A8 can take today**, and still
  the cheapest remaining move on the owed count.
- **`orderAward` genuinely is blocked** by A8's own mint principle.
- **The nine plan-, membership- and assignment-side rows** are still corpus-blocked, but `src:dcsa`'s
  JIT `classifierCode` is where to look first (A1).
- **And three rows that do not exist yet are blocked on [A8 §9 item 1] — new, from A5.**
  `stayAuthorisation`, `stayAllowance` and `stayTermination` are absent fact classes precisely
  because their asserter is a Government transportation office or an approving supervisor and there
  is no party entity for either. A5's generalisation is the useful part: **in any area, the physical
  acts have closeable authority rows and the administrative acts do not, and the discriminator is
  whether the asserter was physically present.** Expect the same in A6 (who certifies a document),
  A7 (who approves a charge) and A10 (who accepts a survey).
- **F4** is the only open Alloy finding.
- **Three pieces of the old `model/` layer are missing**: the context map, the command side, the
  aggregate lifecycles. The context map is the cheapest and would help the area work.

---

## 6. THE NEXT DELIVERABLE — A2, then A6, A7, A9

**A2 was already next after A5 in the previous plan, and A5 strengthened the case rather than
changing it.**

1. **A5 closed the stay half of `[SD §10.4]` bullet 1 and left A2's half explicitly open**, with a
   constraint attached: the stay id is not the thing that answers the shipment-identity question,
   because the stay is a bailment and the shipment is a movement, and only one of them ends at
   termination (`[A5 §3.4]`). A2 is now the only document that can close the oldest open item in the
   model.
2. **A5 handed A2 its object's name.** `src:dp3-400ng` Item 17.9 defines a **Split Shipment** as "a
   shipment where only a portion is stored in transit enroute, or where overflow property is
   delivered to the storage location on different dates" — a shipment-structure definition sitting
   in a storage tariff. `[A5 §Cross-area]` to A2 has the other two.
3. **A1 left A2 the zero-shipment order.** `[A1 §3.4]`'s `COMPLETE` fork is A2's to close together
   with A4, and it needs a settled reading of the order that carries no shipments.
4. **The `fork-order-shipment-cardinality.md` fork is A2's inheritance**, and `[SD §10.2]` lists
   seventeen things it must change. That is the largest single backlog attached to any unwritten
   area and it is A2's whether or not A2 wants it.

A2's own best sources, from the score rows: `src:sirva-ade` (`3/3/2/3/1/3/1/1` — `HaulingSegmentType`
MainLoad/Overflow/MassMove/Transfer, the `CamisRegNumber` decomposition, five weight/cube variants),
`src:dp3-tender-of-service` (loose load vs containerised vs UB as operationally distinct shapes),
`src:milmove-mymove` (the diverted-shipment chain, which `[A3 §3.3]` **rejects** — read that
rejection before scoring it), and `src:weichert-supplier-api` (Auto/Pet as separate _order types_,
not shipment types, which `[SD §10.2]` item 7 says `fork-order` over-read).

Pattern to follow: `analysis/A1-order-service-lifecycle.md` and `analysis/A5-storage-in-transit.md`
are the two closest models — both sit on a settled shared layer and both have a small §3 because of
it. **A5's §3.6 is the model for the rubric-row triage** (record type / projection / somebody else's
/ absent and owed), and its §3.8 is the model for a rejections table that argues rather than lists.
Start §1 by finding the **named owed items**: grep the glossary's Owed section and `[SD §10.4]` for
the area's id, exactly as A1's and A5's §1 tables were built. The rubric — 13 areas, 8 criteria,
evidence grades — is `docs/domain-reference/rubric.md`.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red — and A5's round is the
  proof: one of its two new compile-time gates did not work at all, and only the tamper found it
  (§4 item 11).
- **Read the existing tests for the records you are writing about.** A1's first draft was
  contradicted by a scenario test that had asserted the opposite as a FINDING months earlier; A5's
  scenario-2 test carried an `OWED` block pointing at A5 that had to be rewritten once A5 spoke.
  **An `OWED` label naming your own area is a to-do item in the test suite.**
- **`grep` here is a ugrep wrapper with `-I`, and one NUL byte makes it skip a file silently.**
  `generate-glossary.ts` and `tests/conformance/documents.test.ts` both hold literal NULs. **When a
  negative grep result is load-bearing, use `/usr/bin/grep -a`.** Recorded in
  `dolas/agents/project/GOTCHAS.md`.
- **The same trap has a `gh` shape.** `mergeQueueEntry` is not a valid `gh pr view --json` field.
  Queue state comes from GraphQL.
- **Verify AFTER the pre-commit hook, not before.** It runs `eslint --fix` + `prettier --write` and
  folds the result into the commit.

### Working with the generators

Both live in `packages/domain-reference/tools/` and read `src/` through the **TypeScript compiler
API**. If you extend either:

- **Prettier must run inside the generator.** `JSON.stringify(x, null, 2)` is not a fixed point.
- **`anyOf`, never `oneOf`** when rendering a TypeScript union.
- **`aliasSymbol` is lost when a distributive conditional is instantiated.** `SubjectRef<'stay'>`
  renders correctly anyway — A5 uses one inside `OpensStay` and the emitted `$ref` is
  `SubjectRef.stay`.
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker.**
- A new analysis document is gated automatically: `tests/conformance/documents.test.ts` scans every
  `.md` in `analysis/`, so any `` `type = X` `` span must name a real vocabulary member — write a
  rejected candidate in prose, never in a code span. To make a `[yourdoc §x]` citation link, add it
  to `DOCUMENTS`. It also holds every published reason code to being named by `[A4]`, and every
  member of `ABSENT_AND_OWED` to being named in `[SD §4.7.3]` by a phrase recorded in `AS_WRITTEN`
  — so adding an absent class is a **two-file** change plus a test-table entry.

### Workflows and CI

- **Parallel authoring causes drift.** Settle a shared layer FIRST, then fan out. Keep a workflow
  under ~6 agents when each does heavy reading.
- **CI runners are slower than this machine.** `testTimeout` covers test **bodies** only —
  `beforeAll` needs `hookTimeout`.
- **Betterleaks scans full history**, so removing a file in a later commit does not help — amend.
- **Dependency Review** reads any `package.json` in the diff, **including inside captured
  third-party material**.
- **`new-worktree.sh` rewrites `apps/e2e/.env.test`** with the worktree's Postgres port. It is
  tracked, so it shows up as a modification — `git checkout -- apps/e2e/.env.test` before committing.
- **Extractors:** `pdf2txt.py` / `odt2txt.py` are **gone**. Recreate if source PDFs/ODTs must be
  re-read (pypdf in a venv; ODT is a zip containing `content.xml`). No poppler on this machine.
- **Worktree slugs collide on the derived Postgres port.** `new-worktree.sh` computes it as
  `5433 + (sum of the slug's character ordinals) % 60`, so two unrelated names can land on one port.
  It fails **after** creating the worktree and branch, leaving partial state that
  `scripts/rm-worktree.sh <slug>` clears.

---

## 8. Housekeeping left over

- **Separate repo, unrelated to this plan** — `~/repos/pegasus-workflows`,
  `platform/integrations/weichert/rules.json`: six rules carry `sourceRef: "Weichert API: …"` quoting
  sentences that appear nowhere in `weichert-api.odt`. Confirmed by the user: they came from
  **observed API error responses**. Reword them, and fix the packed-but-not-loaded dead end —
  `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combined with Weichert's real
  load-actual requirement leaves no valid status for a shipment packed but not yet loaded. Live in
  GLOBAL and the `nw` tenant.

---

## 9. Starting the next session

```bash
cd ~/repos/pegasus && git fetch && git pull --ff-only    # primary checkout, parked on main
scripts/workstream-start.sh feat a2-shipment plans/in-progress/domain-reference-areas-a2.md
```

Check the derived Postgres port is free before committing to the slug — see §7.

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that worked twice: write the new record
> at `plans/completed/domain-reference-a2-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file.
> And the script provisions Postgres **after** creating the worktree and branch, so a port collision
> fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a5-storage-in-transit.md` — the most recent, and the source of
   §4 item 11 and §5's new blocker class.
2. `docs/domain-reference/analysis/A5-storage-in-transit.md` — the closest model for an area
   document whose main output is a set of refusals, and where A2's three hand-offs are written down.
3. `docs/domain-reference/analysis/fork-order-shipment-cardinality.md` and `[SD §10.2]`'s seventeen
   required changes to it — A2's inheritance.
4. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
5. `docs/domain-reference/analysis/00-shared-decisions.md` §10.4 — what the shared layer explicitly
   did not settle. Two of its five items are now closed; A2 owns a third.
6. `docs/domain-reference/analysis/published-event-catalog.md` §2.3 and §5 — what is promised to
   consumers, and what changing a role name's spelling costs (**breaking, a new major**).
