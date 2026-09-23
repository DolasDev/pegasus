# Domain reference model — executable layer (TypeScript + Alloy)

> **ARCHIVED PLAN — not a record.** Its work landed in **`5b7c2ccd`** (PR #712) and this file is the
> plan **as it was written beforehand**, moved here on 2026-09-23 so `plans/in-progress/` stops
> reading as in-flight. It was never rewritten into a post-hoc record the way
> `domain-reference-a4-reasons.md`, `-a8-authority-rows.md` and `-a1-order-lifecycle.md` were, so
> read it as intent rather than as an account of what shipped — where the two differ, the code and
> the analysis documents win. What shipped is `packages/domain-reference/` and its `alloy/` models.

**Type/slug:** `feat` / `domain-model`
**Goal:** turn the settled structural decisions into a specification that compiles, runs and
fails loudly — types, pure predicates, Alloy specs and an executable scenario suite.

**This is a standalone reference resource. It does not integrate with the product.** See
[OUT OF SCOPE](#out-of-scope--deferred-do-not-smuggle-back-in) before adding anything.

## Context (enough to resume cold)

- Upstream branch `docs/domain-reference`, commit `e29be40d`, worktree
  `~/repos/pegasus-domain-reference`: 87 sources indexed / 32 analyzed, and the settled structural
  layer under `docs/domain-reference/analysis/`. **That commit is not on `origin/main` yet** — see
  Dependencies.
- **Scope rule (user, binding):** the model is an IDEAL TARGET from EXTERNAL sources only. Our own
  systems are excluded as evidence (`role: mapping-only` in `sources/registry.yaml`) and the rubric's
  "fit to Pegasus data" criterion is withdrawn. Partner contracts stay in as external evidence.
  Nothing in `packages/domain-reference` may import from `packages/domain`, or vice versa.
- **Precedence:** `analysis/00-shared-decisions.md` (the binding layer) outranks
  `A8-authority-skeleton.md`, which outranks the three decision documents.
- **Disclosure rule:** every claim cites a source that says that thing, or is marked `[ORIGINAL]` at
  the point of use. Carry this into code comments — a rule with no citation and no ORIGINAL marker
  is a defect.
- **Language decision (user):** TypeScript for the model, Alloy for structural model-checking.
  Reasons: the errors this project actually produced were multiplicity/consistency errors, not type
  errors — Alloy catches those, a stronger type system would not; the catalog's deliverable is JSON
  Schema, which is one step from TS; the repo already type-checks and tests TS in CI; no .NET
  toolchain exists here, so F# could not be verified. Java 21 is present, so Alloy runs headless.

## Dependencies / sequencing

The code cites `docs/domain-reference/**` by path. `origin/main` does not have it yet. Either:

- **(a) land the docs branch first** (PR → merge queue), then this workstream branches off a `main`
  that contains it — preferred; or
- **(b) start now** and read the docs from the sibling worktree, accepting that this branch's links
  resolve only after the docs PR lands. Merge order then matters: docs first.
  Record which was chosen in the first commit message.

## Checklist

### 1. Package skeleton

- [ ] `packages/domain-reference/` — zero runtime deps, mirroring `packages/domain`'s setup
      (`tsc`, `vitest`, `eslint`); scripts: `typecheck`, `test`, `lint`
- [ ] Strict compiler settings beyond the repo default: `noUncheckedIndexedAccess`,
      `exactOptionalPropertyTypes`, `noImplicitOverride`
- [ ] `README.md` stating: this is a SPECIFICATION of the target domain, not our system's model;
      no I/O, no frameworks, no dependencies; imports nothing and nothing imports it
- [ ] CI guard: nothing under `apps/` or `packages/` (other than its own tests) may import it

### 2. Types — the vocabulary (from the binding layer)

- [ ] `envelope.ts` — `SubjectRef {aggregate, id}` over the 14 aggregate kinds; the seven mandatory
      envelope fields; `recordedAt` server-authored (forbidden on capture, mandatory on query);
      non-authoritative `context[]`; the permanent prohibitions expressed as types where possible
      (no second subject, no subject path, no tense on the envelope, no mutable state field)
- [ ] `vocabulary.ts` — the 21 record types (§4.7.1) as a closed union; `factClass` subsumes `type`
      (one classification axis, §1.3); canonical subject **families** as a `satisfies`-checked
      mapped type so the table itself type-checks, singleton except `stop = {stop, externallyPerformedLeg}`
- [ ] `assertions.ts` — `Assertion {subject, type, qualifier?, basis, value, asOf, evidence[], supersedes?}`;
      `basis` incl. ACTUAL; `FactResolved {selected, considered[], rule{id,version}}`
- [ ] `outcomes.ts` — outcome enum; `Reason {code, scope, attribution, appliesTo[], remedy, remark}`;
      encode "outcome legal only where basis=ACTUAL" and "reasons forbidden when COMPLETED,
      ≥1 otherwise" in the types, not in prose
- [ ] `identity.ts` — `Identifier` keyed `(subject, scheme, vocabularyScope)`; `vocabularyScope.authority`
      (defines the vocabulary) vs `issuer` (assigned this id); N per tuple, `primary` per tuple
- [ ] `portion.ts` — the one sub-shipment grain; membership `MEASURED | ENUMERATED | BOTH`
- [ ] Branded nominal ids for every aggregate (a shipment id must not be assignable to a stop id)
- [ ] `assertNever` exhaustiveness + the eslint exhaustiveness rule enabled

### 3. Predicates — what types cannot hold

- [ ] `rules/e-canon.ts` — subject admission: STRICT (reject, never re-key) / RESOLVE (named
      versioned ingest-side rule returning exactly one candidate) / OBLIGATION (cardinality ≠ 1)
- [ ] `rules/capture.ts` — M1-M7, cut by capture method: `ASSUMED_FROM_PLAN` may never carry
      basis=ACTUAL; possession-changing facts need a human/partner asserter; every non-COMPLETED
      outcome and every reason needs a human/partner asserter; `DEVICE_GEOFENCE` may assert
      arrive/depart/position/ETA; the sanctioned derived SIT entry date carve-out
- [ ] `rules/authority.ts` — A8 §5's eleven rows, A8-INSTANT / A8-MOVE / A8-AFTER / A8-NAMED;
      rows A8 marks **owed** must be representable as owed, not guessed
- [ ] `rules/corrections.ts` — APPLIED / INEFFECTIVE / UNAUTHORISED; always recorded, never refused;
      retraction semantics (no-replacement rule); financial facts corrected by offsetting records
- [ ] `custody.ts` — `custodyAt(goods, instant)` as a pure fold over selected `handover` assertions
      plus `ExternallyPerformedLeg.custodyBasis`; returns UNKNOWN and never falls through
- [ ] `resolution.ts` — weight rule R-WEIGHT-LOWER (cite per pairing: Item 4 Note 2 reweigh-vs-reweigh;
      4.11.d original-vs-reweigh; 4.9.h-i ticket-vs-constructive)

### 4. Data — what changes on its own cadence

- [ ] `data/canonical-subjects.json` — the §4.7 table (type → family, qualifier, context, authority)
- [ ] `data/authority-table.json` — A8 §5, with `owed` as a first-class value
- [ ] `data/reasons.json` — the A4 vocabulary: SHAPE now, codes later; ships provisional/empty
- [ ] Loader types so every data file is validated against the model at test time

### 5. Scenario tests — the acceptance suite

- [ ] The nine scenarios as vitest fixtures: five families on one van over four days; SIT delivered
      six weeks later by a different agent; delivery attempted twice (absent, then refused for
      damage, two items short); reweigh in transit; a car on a separate carrier a week apart;
      cancellation after packing before loading with materials charged; the same arrival asserted
      by the driver's app and the destination agent; mid-journey custody handoff; a partial load
      under one bill of lading
- [ ] Conformance tests: every record type has a canonical family; every family member is an
      aggregate kind; every authority row is present or explicitly owed; no type outside §4.7.1
- [ ] A doc-conformance test: every `type` named in the analysis documents exists in the vocabulary
      (this is the drift check that five review rounds had to do by hand)

### 6. Alloy — structural model-checking

- [ ] `alloy/custody.als` — can the fold ever return two holders; can a handover orphan goods
- [ ] `alloy/cardinality.als` — can a portion belong to two shipments; can a shipment hold two open
      stays; can a stop belong to two trips
- [ ] `alloy/subject-admission.als` — is every record's subject in its family under E-CANON-STRICT
- [ ] Runner script + how to run headless (Java 21 is installed); record any counterexample found
      as a finding against the binding layer, not as a code fix

### 7. Generated outputs

- [ ] A generated glossary — names come from the types, so there is no hand-written third copy to
      drift. This replaces the ubiquitous-language document the process originally called for.
- [ ] JSON Schema emission for the event catalog (later; only once the catalog is designed)

## OUT OF SCOPE — deferred, do not smuggle back in

This is a **standalone reference resource. Nothing integrates with the product yet.** Anything that
reaches toward pegII or Cloud belongs to a future mapping workstream that has not been authorised:

- A legacy lens (native path ↔ canonical concept ↔ code symbol).
- Invariants run over real order extracts to find data that violates the model.
- Anything needing native pegII orders. **Do not ask for them again.** The registry keeps
  `src:pegii-order` at `needs-user` for the eventual mapping work; it blocks nothing here.
- Migration sequencing, adapters, or "how would Cloud emit this".

The same discipline as the evidence rule: our systems are excluded, and they stay excluded until the
model exists on its own terms. If a task seems to need them, it is a mapping task and belongs
elsewhere.

## Files

Created: `packages/domain-reference/**`, `alloy/**` (inside the package), plan file.
Modified: root `package.json` workspaces if needed; `turbo.json` only if the package needs a
non-default pipeline entry.
Not touched: `packages/domain`, `apps/**`, anything under `docs/domain-reference/sources/`.

## Risks / notes

- **Prettier must not reformat captured evidence** — root `.prettierignore` already excludes
  `docs/domain-reference/sources/`. Do not remove it; the sha256s in the registry depend on it.
- **The pre-commit hook lints everything staged.** Keep generated artifacts out of the staged set or
  make them lint-clean; a 1,400-file commit killed the hook once already.
- **Do not let the code re-import excluded evidence.** Nothing in this workstream reads the
  `mapping-only` analyses. If a type or rule seems to need one, that is the signal it is a mapping
  task, not a model task.
- The extractors used by the research phase (`pdf2txt.py`, `odt2txt.py`) live in a session scratchpad
  and will not survive; recreate if source material must be re-read.
- Open, tracked in the registry, none blocking except where noted: Atlas subscription key (47 of 63
  reference endpoints, the whole semantic layer of a van line our tenants are agents for);
  Omnitracs One/XRS driver-form definitions; ISO 17451 (paid, matters when inventory/claims land).
