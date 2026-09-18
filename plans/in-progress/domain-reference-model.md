# Domain reference model — moving & storage

**Branch:** `docs/domain-reference` (worktree `../pegasus-domain-reference`)
**Goal:** research external + internal sources and synthesize a technology-agnostic
reference domain model that drives the Pegasus domain event catalog, its
implementation in pegII and Cloud, and later domain enrichment.

## Context (enough to resume cold)

- Prompted by event design for `pegii.sale.saved` → integrations (Weichert status
  sync in `~/repos/pegasus-workflows/platform/weichert-milestone-update`). Today
  events are thin pointers (`domain_events` table, "a pointer, not a snapshot");
  no change detection; no per-aggregate sequence; trigger filters are dot-path
  predicates (`apps/api/src/lib/event-filter.ts`).
- Decisions so far (with the user):
  - Publish **domain/integration events** in domain language, not generic
    `order.changed` diffs. Diffs are internal plumbing (pegII is CRUD, intent must
    be inferred); Cloud should emit natively from commands.
  - Consumers use events to decide _whether to run_; record-sync integrations
    compare against last-delivered state to decide _whether to send_.
  - Model shipment ≠ trip (van consolidation), stops first-class, SIT native,
    telemetry is not domain events (derived via geofence/ETA processing),
    evidence/provenance + authority per event type, occurred vs received time,
    documents (POD) as evidence, commands out / events in for MobileCom.
  - Survey external vocabularies as a **cross-check** (crosswalk), per-area
    winners, internal data fit tagged on every concept.
  - Integrations in view: Weichert (RMC), Sirva ADE / Allied (van line), Atlas
    (docs in `docs/atlas-world-group-api`), EDI X12, project44, FourKites,
    MobileCom = Transflo Mobile+, Omnitracs, Platform Science, ORBCOMM.
- Found while analyzing Weichert rules: no valid service status exists for
  "packed, not yet loaded" (`pre-in-progress-forbids-pack-actual` +
  `in-progress-requires-load-actual`). Use as a validation scenario.
- User direction: work lives in this repo; store **all** resources (whole domain,
  not just v1) so other areas can be built later; prompt the user for gated
  material (inbox); format = whatever is easiest to reference later (Markdown +
  YAML registry, Mermaid diagrams).

## Checklist

### Phase 1 — inventory + rubric

- [x] Worktree + branch
- [x] `docs/domain-reference/README.md` (layers, scope, conventions)
- [x] `docs/domain-reference/rubric.md` (areas A1–A13, criteria C1–C8, S1–S5)
- [x] `docs/domain-reference/templates/source-analysis.md`
- [x] `docs/domain-reference/sources/README.md` (storage policy) + `inbox/`
- [x] `.gitignore`: `sources/*/local/`, `sources/inbox/*`
- [x] Discovery research: HHG/relocation, logistics standards, visibility/telematics, internal
- [x] `sources/registry.yaml` populated — 78 entries (30 P1 / 31 P2 / 17 P3; 21 needs-user)
- [x] Time-sensitive capture: MilMove (GitHub repo 404; Go proxy snapshot → `local/` zip + committed extract); Weichert doc copied from `~/weichert-api.odt` → `local/`
- [x] Gated-material request list to user
- [x] **Checkpoint passed** (2026-09-17). User confirmed tenant reality: agents for **Allied
      (SIRVA)** + **Atlas**; telematics **Omnitracs** + **Samsara**; **no EDI, no visibility
      platform** today but the model must be ready for both. Registry re-prioritized
      accordingly (van lines, Platform Science, Transflo, FourKites, ORBCOMM, tenant EDI
      guides demoted; X12 + project44 kept as vocabulary-only sources).

### Phase 2 — capture + per-source analysis

- [x] Process inbox drops → `uncefact-mmt-rdm` (245 MB RDM package: MMT D19A, SCRDM D22A,
      BuyShipPay), `nmfta-ebol` (eBOL OpenAPI v2.1), `x12-858-implementation-guide`,
      plus new leads registered as sources: `gtfs`, `alvys-api`, `edi-explainer-guides`
- [x] Capture public material — `cfr-49-375` (eCFR XML), `gs1-epcis-cbv` (EPCIS repo),
      `dcsa` (OpenAPI repo, eBL pruned), `milmove-docs` (docs only, static/ pruned),
      `gtfs`, `project44`, `samsara`, `omnitracs-roadnet`, `open-trip-model`, `alvys-api`.
      Log: `sources/capture-log.tsv`. Registry: 84 entries, 19 captured / 6 obtained.
- [x] Text extractors for unreadable formats (no poppler on this box):
      `$SCRATCH/pdf2txt.py` (pypdf venv at `$SCRATCH/pdfenv`) and `$SCRATCH/odt2txt.py`,
      where `$SCRATCH` = `/tmp/claude-1000/-home-steve-repos-pegasus-workflows/3e7bcbdc-ab34-4070-89ed-3bdd048db92f/scratchpad`.
      **These live in a session scratchpad — recreate them if this session is gone.**
- [x] `sources/<id>/analysis.md` per source — workflow `wf_a5d8d419-96f`, 14 cluster agents + completeness critic, 15/15 clean. **26 analyses, 14,268 lines.** Registry: 25 analyzed
      (`pegii-order` stays `needs-user` — analysis exists but rests on partial evidence).
- [x] Crosscheck persisted → `docs/domain-reference/analysis/round-1-crosscheck.md`
      (area coverage, 11 contradictions, quality problems, unread list, phase-3 order)
- [x] Registry corrections from the analyses: wrong `areas` on `gtfs` / `nmfta-ebol` /
      `stedi-x12-reference` / `milmove-docs`; 858 guide publisher + X12 release (FCA US
      CENTS, 003010 not 004010); missing `files`/sha256 on `project44` + `open-trip-model`;
      `nmfta-ebol` duplicate-file note; `dp3-400ng` path (primary checkout only);
      `gs1-epcis-cbv` capture caveat (dev repo, not ratified 2.0.1).

**Verified by hand (not just reported):** six rules in the live GLOBAL `weichert` config carry
`sourceRef: "Weichert API: …"` quoting sentences that do **not** appear anywhere in
`weichert-api.odt`. Grep over the full 3,578-line extraction: "required to submit" 0 hits,
"Pack Date 1" 0, "Estimated Total Cost" 0, "before Service Status" 0. The doc states
`serviceStatus` as a flat enum ("Possible options are Requested, Accepted, Submitted, Awarded,
In Progress, Delivered, Declined or Cancelled") and never states a transition precondition. The
.odt holds no images beyond a thumbnail, so nothing is hidden in screenshots. Most likely the
rules came from Supplier Portal UI validation messages — a real but different source with no
registry entry. Until resolved, no phase-3 claim may rest on "Weichert requires X".

### SCOPE DECISION — 2026-09-17 (binding, re-read before any modelling)

**The model is an IDEAL TARGET, built from EXTERNAL sources only.** Our own systems are excluded
from the evidence base — a model shaped to fit the legacy code inherits its limits, and round 1
showed the risk concretely (Cloud's `Move` fuses order+shipment+route; pegII treats one sale as one
shipment; both foreclose consolidation, which is a normal HHG move).

- Excluded → `role: mapping-only` in registry.yaml: `pegasus-cloud-domain`, `pegasus-cloud-prisma`,
  `pegasus-integration-floors`, `pegii-order`, `pegii-longhaul`, `pegasus-domain-plans`,
  `equus-sender-legacy`. Their analyses are KEPT as raw material for `mappings/`.
- Retained as external evidence → `role: model-evidence`: partner contracts (`weichert-supplier-api`,
  `sirva-ade`, `atlas-world-group-api`) describe how counterparties behave.
- **Rubric S5 (fit to Pegasus data) withdrawn.** "Can we supply this?" is a `mappings/` question,
  asked after the model exists. Round-1 files still carry S5 lines; ignore them when comparing.
- Consequence: the native pegII order pull is **no longer blocking** — it moves to the mapping phase.
- Consequence: A3 and A8 lost their main internal evidence (`pegii-longhaul`), which raises the
  weight of X12 212, OTM5 and the Atlas reference data.

**Weichert provenance RESOLVED (user):** the six rules citing "Weichert API: …" quote **observed API
error responses**, not the vendor doc. So they are valid external evidence — and the doc understates
its own API, which enforces undocumented milestone preconditions. Cite as observed-behaviour (grade
B), never as the doc.

- [ ] **Separate follow-up, different repo:** in `~/repos/pegasus-workflows/platform/integrations/weichert/rules.json`,
      reword those six `sourceRef` strings so they say "observed API error response" rather than
      implying the vendor document, and fix the packed-but-not-loaded dead end — which is OURS: it
      only arises because `pre-in-progress-forbids-pack-actual` (a Pegasus-added rule) combines with
      Weichert's real load-actual requirement. Live in GLOBAL + `nw` TENANT.

### Phase 3 — comparison (running)

**`wf_7b0f9aa6-dc1` DIED — session limit, all 10 agents errored.** Partial work survived on disk
(agents write files before returning), so recovery was cheap. Salvaged:

- `x12-212-trailer-manifest/analysis.md` — **half-answers A3.** Consolidation IS first-class (9999
  shipments under one `MS2` equipment; `TSD` loading sequence + physical position on the trailer;
  `BLR` per-shipment SCAC so one trailer carries interline freight) but **stops, sequence, legs and
  driver are absent** (no `S5`, no `N7` anywhere in the set). It is a LOAD PLAN, not a trip, and
  consolidation is expressed by re-issuing documents rather than by a persistent trip entity.
- `smdg-delay-codes/analysis.md` + both code-list spreadsheets.
- `atlas-world-group-api/analysis-supplement-vocabulary.md` — **capture blocked, no key in the repo.**
  Corrects round 1: with the documented grant **47 of 63** reference endpoints are reachable, not 5.
- Downloads only (analyses pending): `shippeo/local` (4 files), `macropoint/local` (3),
  `dtr-part-iv/local` (13 chapter PDFs), `dp3-tender-of-service/local` (4 PDFs).

- [~] `wf_031acbe0-34f` — round-2 gap-fill, 5 agents, re-running only what was lost
  (shippeo+macropoint, DTR Part IV + DP3 ToS, Samsara webhooks, UNECE Rec 24 + ratified GS1,
  X12 elements 98/1651). Registry now 87 entries.
- [x] Gap-fill round 2 (`wf_031acbe0-34f`, 5/5): shippeo, macropoint, dtr-part-iv,
      dp3-tender-of-service, uncefact-rec24, gs1 ratified supplement, X12 98/1651 supplement.
      **32 sources analyzed** (28 external model-evidence).
- [x] Three decision documents + adversarial critique (`wf_c75db6d1-789`, 4/4) →
      `analysis/A3-trip-stop-assignment.md`, `fork-order-shipment-cardinality.md`,
      `fork-time-provenance-corrections.md`, critique persisted as `analysis/round-2-critique.md`.
      **All three came back `needs-revision`** — written in parallel, so they conflicted on the
      envelope, the sub-shipment grain, plan/actual representation and identity; and the adversary
      caught invention laundered as evidence (the stop-ownership fork was rated HIGH partly on "DCSA
      states the principle explicitly" — that sentence was our own analyst's formulation).
- [x] Reconciliation (`wf_39f79734-583`, 5/5) → `analysis/00-shared-decisions.md`, which **outranks**
      the three decision documents, plus all three revised against it.
      Verifier: **11/12 must-fixes FIXED, all 8 cross-document conflicts CLOSED, 6/9 scenarios
      passing across all four documents together**, `readyToModel: false` for four narrow reasons.
- [~] Closing round (`w7d8431k8` / `wf_55467547-4d2`): (1) `type` vs `factClass` — two competing
  classifiers on one record, blocking because UL work names record types; (2) E-CANON boundary
  behaviour (re-key vs reject — published both ways) + the canonical-subject table, called "the
  single highest-leverage unwritten thing in the model"; (3) the **A8 authority skeleton**, which
  three shipped mechanisms already consume as an input and without which scenario 8 degenerates
  to recency; (4) the Identifier key tuple. Plus inherited citation fixes (Shippeo's table is 38
  data rows, not 41 — the geofence finding holds, the count does not).

### The settled layer — precedence order (read before any modelling)

1. `analysis/00-shared-decisions.md` — envelope + subject typing (14 aggregate kinds, no subject
   path, no tense on the envelope, no mutable state), (outcome, reason) factorisation marked
   **[SYNTHESIS]** of Shippeo + OTM, one sub-shipment grain (`Portion`, membership
   MEASURED|ENUMERATED|BOTH), a generic `Assertion` over any fact class with `FactResolved`,
   capture-method rules (M1-M7), corrections always recorded, Identifier shape.
2. `analysis/A8-authority-skeleton.md` (in flight)
3. The three decision documents.

**Disclosure rule now in force:** every claim cites a source that says THAT thing, or is marked
**[ORIGINAL]** inline at the point of use. Marking something ORIGINAL is not a defect; presenting it
as sourced is. Four citations were withdrawn in full in the revision round and are named as withdrawn.

**Lesson for future rounds:** cap a workflow at ~6 agents when each does heavy reading. The dead run
burned 1.1M subagent tokens in 13 minutes and returned nothing through the API, even though most of
its file writes had already landed.
Order is set by `analysis/round-1-crosscheck.md`:

- [ ] **A3 first** (trip/stop/assignment) — 9 sources score C1=3, none scores C4 above 2;
      no source models several shipments on one van with interleaved stops, a SIT
      interruption and agent-to-agent handoffs. Read X12 212 (Delivery Trailer Manifest)
      before declaring it an original design decision.
- [ ] Settle three structural forks in writing: order↔shipment cardinality; stop ownership
      (trip vs shipment — decides whether Cloud's `Stop.moveId` is validated or needs a new
      aggregate); where the planned/estimated/actual qualifier lives (6 incompatible answers).
      Cheap empirical check first: does pegII keep planned and actual as separate columns, or
      does a form save overwrite one field?
- [ ] A5 (storage-in-transit) — open with the "can we even supply it" finding, not the
      best-source pick. Needs the native-order pull (`WarehouseSummary` never opened).
- [ ] A4 reason codes — no source supplies an HHG vocabulary; design deliberately.
- [ ] A1 as an explicit machinery+vocabulary pairing; then A2, A6, A7, A8, A9.
- [ ] One rule for absent-area scoring (explicit 0 vs decline-to-score) before the first file.

### Phase 3 — comparison

- [ ] `analysis/<area>.md` per v1 area with weights, scores, best source, reasons
- [ ] Crosswalk matrix (candidate events × integrations)

### Phase 4 — core model

- [ ] `model/` glossary, context map, aggregates/VOs, lifecycles, invariants, events, commands

### Phase 5 — validation + mappings

- [ ] `model/scenarios/` (490317 end-to-end, two-day pack/load, consolidated van + SIT, geofence vs driver disagreement, corrected load date, Weichert award→decline)
- [ ] `mappings/` pegII, Cloud (`packages/domain`, prisma), Weichert, Sirva ADE
- [ ] Gap list
- [ ] Event catalog (follow-on deliverable in `catalog/`)

## Files

Created: everything under `docs/domain-reference/`; this plan.
Modified: `.gitignore` (append-only block).

## Side effects / risks

- `scripts/new-worktree.sh` rewrote `apps/e2e/.env.test` to the isolated DB — do
  **not** commit it.
- Licensed/gated material lives only in gitignored `local/` on this machine
  (durability gap noted in `sources/README.md`).
- Docs-only; no code, tests, or deploy paths touched.
