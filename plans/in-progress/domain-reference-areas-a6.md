# Domain reference — the remaining unwritten areas: plan and resumption state

**Written 2026-09-23, after A2 landed**, to be read by a session with **no prior context**.
Everything needed to resume is here or is named by path. Read this whole file before starting.

It replaces `plans/in-progress/domain-reference-areas-a2.md`, which was **deleted** in the A2 PR,
not archived — that round's record is `plans/completed/domain-reference-a2-shipment.md`. The
convention in this effort is that a finished round leaves a **record** in `plans/completed/` and its
**plan** is rewritten as the next round's, so do not go looking for an archived copy of a superseded
plan.

**Five deliverables have landed.** Read their records first; each is short and each carries findings
worth not rediscovering:

- `plans/completed/domain-reference-a4-reasons.md` — the reason vocabulary.
- `plans/completed/domain-reference-a8-authority-rows.md` — A8 §5 rows 12-16. Its count of twelve
  corpus-blocked rows is the count **as at that round**; A1 and A2 have both moved rows out of it.
- `plans/completed/domain-reference-a1-order-lifecycle.md` — the `boundBy` gap, and the rule that a
  count in prose is gated or deleted.
- `plans/completed/domain-reference-a5-storage-in-transit.md` — the physical-vs-administrative
  discriminator on authority rows, and the `Exact<>`-is-a-comment finding.
- `plans/completed/domain-reference-a2-shipment.md` — **the most recent, and the one that most
  changes what to do next.** It closes the oldest open item in the model, finds that the
  `shipment` aggregate has no minting record, and sharpens the `Exact<>` finding into a rule about
  when a compile-time assertion is a tautology. §5 and §6 below carry both forward.

**Next deliverable:** **A6** (documents & evidence), then A7, A9. §6 says why.

---

## 1. Where this stands, in one paragraph

A reference domain model of household-goods moving & storage exists, built from external sources
only. Three layers are live: a **research corpus** (`docs/domain-reference/sources/`, 87 sources, 32
analysed), a **binding decision layer** (`docs/domain-reference/analysis/`), and an **executable
specification** (`packages/domain-reference/`) whose glossary and published event catalog are both
generated from the code and gated against drift. The catalog is at `specVersion` **0.5.0**, carries
**two projections** (`custodyAt`, `orderStageAt`) and, since A2, **one named rule that is neither**
(`shipmentContinuity`). What keeps it pre-1.0 is the fourteen remaining authority rows — and A2
sharpened why for a fourth of them, on the same schema decision A1 named.

---

## 2. Current state — all merged to `main`

| What                                   | Where                                                                    | Landed              |
| -------------------------------------- | ------------------------------------------------------------------------ | ------------------- |
| Research corpus + structural decisions | `docs/domain-reference/`                                                 | `34713637`, PR #705 |
| Executable specification               | `packages/domain-reference/`                                             | `5b7c2ccd`, PR #712 |
| Published event catalog                | `docs/domain-reference/catalog/` + `src/catalog.ts`                      | `a4b0bd7f`, PR #713 |
| A4 reason vocabulary                   | `analysis/A4-execution-events.md` + `src/outcomes.ts`                    | `20971ebe`, PR #716 |
| A8 §5 rows 12-16, closing F3 and F5    | `analysis/A8-authority-skeleton.md`                                      | `984200cd`, PR #717 |
| A1, the order & service lifecycle      | `analysis/A1-order-service-lifecycle.md` + `src/rules/order-stage.ts`    | `1b9e5df3`, PR #719 |
| A5, storage-in-transit                 | `analysis/A5-storage-in-transit.md` + `OpensStay` in `src/outcomes.ts`   | `d4fb4c3f`, PR #723 |
| **A2, shipment structure**             | `analysis/A2-shipment-structure.md` + `src/rules/shipment-continuity.ts` | _this round_        |

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
- **Both remedy shapes** — `newWindow` (`[A4 §3]`) and `opensStay` (`[A5 §3.2]`).
- **Two projections**: `custodyAt` (`[SD §4.8]`) and `orderStageAt` (`[A1 §3.3]`).
- **One rule that is neither** — `shipmentContinuity`, **B-ONWARD** (`[A2 §3.2]`). It takes its
  discriminant as an input because nothing publishes one; §5 says why that matters.
- **The shipment boundary across an interruption**, which was the oldest open item in the model.
- **The cross-cutting mechanics**: `(outcome, reason)` factorisation, the Portion (whose `[SD §11]`
  revisit check A2 ran and passed), correction semantics, the identity key, the capture rules M1–M7.
- **Six of thirteen areas written**: A1, A2, A3, A5, A8, and A4 (**vocabulary only** — its own scope
  note says so).

### What is NOT ready

1. **Three of the nine detail areas have no analysis at all**: A6, A7, A9. `rubric.md`'s note is
   current. (A10–A13 are context-map-only **by design** — not gaps.)
2. **14 of 31 record types carry an owed authority row.** Still the single thing capping the catalog
   at pre-1.0 — see §5, whose shape A2 changed.
3. **Three owed code vocabularies**: `roleClass`, `unitOfMeasure`, `identityScheme`.
4. **F4 open** in `analysis/findings-from-alloy.md`; 18 declared owed values; **14** fact classes the
   corpus names that the vocabulary does not carry — the newest being `shipmentCommitment`, which is
   older than all the rest (§5).
5. **`[SD §10.4]` is now down to two open bullets.** A2 closed bullet 1; A5 closed bullet 2. What is
   left is the directional stop-type pairs (A3's) and custody authority's owner (A8's).
6. **A1 handed [SD] one defect** that is still open: the requestor of a **completed** cancellation
   has no field, because [SD §2.3] invariant 2 forbids `reasons[]` at `COMPLETED` and [SD §4.7.2e]
   item 2 puts the requestor there. `[A1 §3.5]`, `[A1 §6]`.
7. **32 of 87 sources analysed**; 15 registry entries `needs-user`.

---

## 3. Rules that govern this work — binding, not preferences

1. **SCOPE.** An **IDEAL TARGET built from EXTERNAL sources only**. Our own systems are
   `role: mapping-only` in `sources/registry.yaml`. Never cite them for what the domain IS. Partner
   contracts (Weichert, SIRVA ADE, Atlas) ARE external evidence. A2 hit the widest form of this —
   it is the area our own systems have most to say about (`src:pegii-longhaul`'s move types and four
   weight slots, `src:pegasus-integration-floors`' order-to-`shipments[]` containment) and its §2
   lists neither.
2. **STANDALONE.** **No product integration.** No legacy lens, no invariants over real extracts, no
   migration sequencing, and **do not ask for native pegII orders**.
3. **DISCLOSURE.** Every claim cites a source that says **that** thing, or is marked **[ORIGINAL]** /
   **[SYNTHESIS]** inline at the point of use.
4. **OWED means owed.** A distinct value, never a null that reads as "nobody", never a guess.
5. **Code is normative for structure; documents are normative for rationale.**
6. **Precedence.** `00-shared-decisions.md` (**[SD]**) outranks everything. Then `[A8]`. Then the
   area documents `[A1]`, `[A2]`, `[A4]`, `[A5]`, `[A3]`, the forks. Then `[catalog]`.

---

## 4. Landing a change — the recipe A4, A8, A1, A5 and A2 established

Follow this order.

1. Add members to the `as const` array in `src/`, one JSDoc each **carrying a citation or a marker**
   — the disclosure gate reads the docstring, **including on the members of a two-member enum** (A2
   lost a glossary run to two undocumented verdict names). A JSDoc must not start with a bold
   marker, and markdown emphasis must be `_x_`, not `*x*`, or the glossary stops being a prettier
   fixed point.
2. Fill the per-member table in `data/` and extend the loader. **Cross-check the two as a set.**
3. Classify the change against `[catalog §2.3]` **before** picking the version — and note that the
   class you need may not exist yet (A5 added `publishedOwedShape`), **or that no class applies
   because nothing published changed** (A2, and `[catalog §2.4]` now carries a non-bump row).
4. Register new vocabularies in `VOCABULARIES`, new documents in `DOCUMENTS`, and any new **named
   rule or fold** in `RULES` — all three in `tools/generate-glossary.ts`. None is auto-discovered.
5. Bump `CATALOG_VERSION` **only if the emitted schemas changed**, then `npm run glossary` **and**
   `npm run catalog`, then the tests.
6. **Tamper each new gate and watch it fail, then restore.**
7. `npx prettier --check` over `docs/domain-reference` and `packages/domain-reference` **before**
   committing. `packages/domain-reference/alloy/run.mjs` fails this on `main` already — verify that
   with `git show main:` rather than assuming it, which is a ten-second check.
8. **Read the emitted schema diff before classifying the change** — and read it as evidence, not as a
   formality. A2's was empty, and that emptiness was the decision.
9. **A data table may have more than two homes.** The authority table has three.
10. **A COUNT written in prose must be gated or deleted** — `[catalog §5]`'s five are the gated ones.
11. **An `Exact<>` alias is not a gate until something is assigned to it** (A5) — **and an assigned
    one can still be a tautology** (A2). `Exact<keyof typeof T, K>` where `T` is a mapped type over
    `K` can never fail: the mapped type is the gate and the alias is decoration. **An `Exact` earns
    its place only between two things declared _independently_.** Both findings came from tampering
    and from nothing else.

---

## 5. The authority rows — the ledger's shape, as A1, A5 and A2 left it

Read `[A2 §Cross-area]` to [A8] before `[A8 §9 item 8]`. Three areas have now looked at the ledger
and between them they have sorted it into two kinds of blocker.

- **Blocked on a missing _party entity_ — `[A8 §9 item 1]`.** `partyRole` (§9 items 1-2),
  `notification` (§9 item 6), and A5's three absent classes (`stayAuthorisation`, `stayAllowance`,
  `stayTermination`), whose asserter is a Government transportation office or an approving
  supervisor. A5's discriminator is the generalisation: **the physical acts have closeable authority
  rows and the administrative acts do not, and the test is whether the asserter was physically
  present.** Expect it again in A6 (who certifies a document) and A10 (who accepts a survey).
- **Blocked on a missing `boundBy` _enum member_ — a schema decision A8 can take today.**
  `orderResponse` and `orderCancellation` (A1), and now **`shipmentCommitment`** (A2). All three want
  the same member: _the role resolved by the order's own award_. **This is the cheapest remaining
  move on the owed count by a wide margin, and A2 is the reason it is now four things and not two.**
- **`orderAward`** is blocked by A8's own mint principle.
- **The nine plan-, membership- and assignment-side rows** are still corpus-blocked, but `src:dcsa`'s
  JIT `classifierCode` is where to look first (A1).
- **F4** is the only open Alloy finding.
- **Three pieces of the old `model/` layer are missing**: the context map, the command side, the
  aggregate lifecycles. The context map is the cheapest and would help the area work.

### And one absent class that is older than the rest

**`shipmentCommitment`** (`[A2 §3.6]`) is not a fact the model has yet to reach — it is the
**precondition of nineteen act rows that were written on top of it**. `[SD §4.7.1]` carries no record
for the act that mints a shipment, so `[fork-order §5.2]`'s **B-STAGE** has been a projection with no
input records since it was written, `[A2 §3.2]`'s B-ONWARD is decidable in prose and not in code, and
an `[A1 §3.4]` `COMPLETE` rule cannot read the set it would quantify over. **A6, A7 and A9 should each
check whether their own central act has a record before designing around one.** A2 did not, until §3.

---

## 6. THE NEXT DELIVERABLE — A6, then A7, A9

**A6 (documents & evidence) is next, and three landed areas have been handing it material.**

1. **A6 has the largest inbound hand-off pile of the three.** `[A5 §Cross-area]` gives it
   `src:dp3-400ng` Item 17.12, a **records-required** clause obliging both the TSP and the
   warehouseman to hold an itemised property list carrying the BL number, origin and destination,
   **the condition of each article when received at and forwarded from storage**, and the dates of
   all charges, payments and movements — which implies a `condition` assertion per article at **both**
   ends of a stay, i.e. `[SD §5.4]`'s item grain and `[A8 §5]` row 9's joint holding at a boundary
   nobody has looked at. `[A2 §Cross-area]` gives it `src:dtr-part-iv`'s **SF 1200** correction
   notice and **Table A-402-4**, a closed whitelist of exactly which bill-of-lading fields are
   correctable, with a before / after / justification structure and the rule that _"everything else
   on the BL is immutable; to change it you cancel and reissue."_ That is a published correction
   regime over a document, and A2 notes its consequence for B-ONWARD: **a correction is not a
   reissue, and the source draws the line for us.**
2. **`document` is already an aggregate and already appears in three `context[]` columns**
   (`weight.net`'s weight ticket, `pieceCount`'s inventory, `condition`'s signed inventory,
   `identity`'s instrument) — and **no record type has `document` as its canonical subject**. A6
   should expect to meet A2's structural finding in its own area: check first whether the act that
   issues, certifies or corrects a document has a row, before designing on the assumption that it
   does.
3. **`src:dtr-part-iv` scores `3/3/2/3/1/3/3/1` on A6** and its analysis calls it _"a
   document-centric regulation"_ — BL, SF 1200, DD 1299, DD 1797, DD 1780, DD 1814, DD 1857, DD 1164,
   DD 619, DD 1840/1840R, DD 1384 TCMD, warehouse receipt, weight tickets, Diversion Certificate,
   each with an issuer, a distribution list and a retention rule, and the BL with serial
   accountability and audits. **C7 = 3**, its highest in any area. Its own recorded limit is the one
   A6 must decide: document **state** (issued / corrected / cancelled / superseded) _"is described in
   prose, never enumerated"_ — which is exactly the `[SD §1.1]` mutable-state trap A5 §3.8 and
   A2 §3.8 each refused once already.
4. **A4's execution-event model is still unwritten** and A6's "documents as evidence for events" row
   touches it. A6 should take `evidence[]` as settled (`[SD §1.4]`) and not reach into A4.

A6's own best sources, from the score rows: `src:dtr-part-iv` (above), `src:dp3-400ng` Items 4.10 and
17.12, `src:cfr-49-375` (the weight-ticket evidence chain at `C7 = 3`), `src:nmfta-ebol`,
`src:gs1-epcis-cbv` (`errorDeclaration`, retraction vs supersession — already partly spent at
`[SD §6]`), and `src:x12-212-trailer-manifest`.

Pattern to follow: `analysis/A2-shipment-structure.md` and `analysis/A5-storage-in-transit.md` are
the two closest models. **A2's §1 is the one to copy for the opening**: it starts by auditing what is
actually owed to the area by name, and its first finding is that one of the things the plan said was
owed had already been discharged. **Do that audit before trusting this file's §6.** A5's §3.6 is the
model for rubric-row triage; A2's §3.3 is the model for a refusal argued from a facet analysis rather
than asserted; and A2's §3.8 is the model for a rejections table where one row says **"not rejected —
sharpened."** Start §1 by grepping the glossary's Owed section, `[SD §10.4]` and every landed area's
`§Cross-area` for the area's id. The rubric — 13 areas, 8 criteria, evidence grades — is
`docs/domain-reference/rubric.md`, which now also carries A2's observation that **an operation can be
scored in one area and live in another**.

---

## 7. How to work here — hard-won, and worth keeping

### Verification discipline

- **Run the gates yourself. Never trust a report.**
- **Prove a gate bites by tampering.** A false green is worse than a red, and the last two rounds are
  both proof: A5 shipped a compile-time assertion that did nothing, and A2 shipped one that could
  never fail even though it was assigned (§4 item 11). Only the tamper found either.
- **Read the existing tests for the records you are writing about.** An `OWED` label or a test title
  naming your own area is a to-do item in the test suite; A2's was
  `tests/scenarios/storage-in-transit-delivered-by-another-agent.test.ts`'s
  _"A2 still owns the other half"_, and rewriting it was the round's cleanest deliverable.
- **Check whether the source captures exist before planning to quote primary text.** Only
  `atlas-world-group-api`, `cfr-49-375`, `dcsa`, `gs1-epcis-cbv`, `gtfs`, `milmove-docs`,
  `milmove-mymove` and `x12-212-trailer-manifest` have a `captured/` directory. `dtr-part-iv`,
  `dp3-400ng`, `dp3-tender-of-service`, `sirva-ade` and `weichert-supplier-api` are **analysis-only**,
  so every quotation from them is secondary — which is how A2 came to flag a citation A5 reads more
  confidently than its secondary text supports, and to record it rather than resolve it.
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
- **`aliasSymbol` is lost when a distributive conditional is instantiated.**
- **`checker.getUnionType` is internal API** — it runs and does not typecheck.
- **A JSDoc must not start with a bold marker**, and every member of every registered vocabulary
  needs one, however obvious the name.
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
  `scripts/rm-worktree.sh <slug>` clears. Compute it and check it is free before choosing a slug:
  `python3 -c "s='<slug>'; print(5433 + sum(ord(c) for c in s) % 60)"`.

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
python3 -c "s='a6-documents'; print(5433 + sum(ord(c) for c in s) % 60)"   # check that port is free
scripts/workstream-start.sh feat a6-documents plans/in-progress/domain-reference-areas-a6.md
```

Then work in the new worktree; commits land with the implementation as **one PR**, and the plan is
archived to `plans/completed/<slug>.md` **before** opening it.

> **Two things about `workstream-start.sh`.** It **copies** the plan to
> `plans/in-progress/<slug>.md` inside the worktree, so the worktree ends up with **two** copies —
> the seeded one and this file. Do not edit both. The pattern that worked three times: write the new
> record at `plans/completed/domain-reference-a6-<slug>.md`, write the **next** round's plan as a new
> `plans/in-progress/domain-reference-<next>.md`, then delete the seeded copy and remove this file.
> And the script provisions Postgres **after** creating the worktree and branch, so a port collision
> fails late and leaves partial state — `scripts/rm-worktree.sh <slug>` cleans it up.

**Read before writing anything:**

1. `plans/completed/domain-reference-a2-shipment.md` — the most recent, and the source of §4 item
   11's second half, §5's re-shaped ledger, and the discipline of auditing what is owed before
   trusting a plan that says what is owed.
2. `docs/domain-reference/analysis/A2-shipment-structure.md` — the closest model for an area document
   that closes one hard question and refuses one tempting vocabulary, and where A6's two hand-offs
   are written down.
3. `docs/domain-reference/analysis/A5-storage-in-transit.md` — the model for rubric-row triage, and
   the source of the physical-vs-administrative authority discriminator A6 will meet.
4. `docs/domain-reference/glossary.md`, the **Owed** section — the honest state, always current.
5. `docs/domain-reference/analysis/00-shared-decisions.md` §10.4 (now two open bullets, both other
   areas'), §4.7.3 (the absent classes) and §6 (corrections — A6's own subject matter, already
   partly settled).
6. `docs/domain-reference/analysis/published-event-catalog.md` §2.3 and §5 — what is promised to
   consumers, what changing a role name's spelling costs (**breaking, a new major**), and §2.4's
   **non-bump row**, which is the precedent for a release that changes no published byte.
