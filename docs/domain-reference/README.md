# Domain reference model — moving & storage

A **technology-agnostic reference model** of the household-goods moving & storage
domain. It exists to be the single source for three things:

1. **The domain event catalog** published by Pegasus II (legacy) and Pegasus Cloud.
2. **Implementation** of that catalog and of domain code in either system.
3. **Future enrichment** — any part of the domain not built out yet can be
   developed later from the sources and analysis stored here.

It is built from evidence, not opinion: external standards, vendor APIs,
regulation and tariffs, and our own systems are collected, analyzed against a fixed
rubric, compared per domain area, and synthesized.

## Layers

The model is split by how often each layer changes. Keep them separate — mixing
mappings into the core is what stops a reference model staying pure.

| Layer                    | Where                        | What                                                                                                                                                                  | Changes                 |
| ------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Sources                  | [`sources/`](sources/)       | Registry + stored material + per-source analysis                                                                                                                      | As sources are added    |
| Analysis                 | [`analysis/`](analysis/)     | Per-area comparison and "best source" decisions. **Binding**, and [`analysis/00-shared-decisions.md`](analysis/00-shared-decisions.md) outranks every other file here | Per research round      |
| Executable specification | `packages/domain-reference/` | The core model, as TypeScript that compiles and is model-checked: ubiquitous language, value objects, invariants, the record vocabulary, the capture rules            | Rarely                  |
| Ubiquitous language      | [`glossary.md`](glossary.md) | **Generated** from the specification's docstrings — 15 closed vocabularies, and the owed ledger                                                                       | With the specification  |
| Event catalog            | [`catalog/`](catalog/)       | **Published integration events, generated from the specification — live at `specVersion` 0.2.0**                                                                      | Deliberately, versioned |

**There is no `model/` directory, and that is not a gap.** Most of what a `model/` layer would have
held was written as the executable specification in `packages/domain-reference/` instead, which is
strictly better: an invariant that compiles cannot drift from an invariant that is described, and the
glossary and the catalog are both generated from it rather than maintained beside it. Three of the
pieces a `model/` layer would have held are genuinely absent and are owed:

- **the context map** — the bounded contexts and the relationships between them;
- **the command side** — the specification models assertions, not the commands that produce them;
- **the aggregate lifecycles** — nothing in it models an order or a trip state machine. The only
  transitions it holds are a Portion's membership (**P-MEMBER**).

**There is no `mappings/` directory either, and that absence is deliberate.** Mapping our systems onto
the model is a separate workstream that has not started; doing it inside this one is the drift the
scope rule below exists to prevent.

"Pure" means **no technology** — no pegII field names, API shapes, or database
structure in the specification. It does **not** mean generic: the model uses the moving
industry's own language (booking/origin/hauling/destination agent, binding
estimate, storage-in-transit, reweigh), not abstract logistics terms.

## The published catalog — [`catalog/`](catalog/)

The versioned integration events a consumer subscribes to. Like the glossary, every file in it is
**generated from the executable specification** and gated against drift — see
[`catalog/README.md`](catalog/README.md) for the files and
[`analysis/published-event-catalog.md`](analysis/published-event-catalog.md) for the decisions
behind them (what is published, how it is versioned, what may be filtered on).

- Regenerate: `npm run catalog -w @pegasus/domain-reference`
- Gate: `packages/domain-reference/tests/conformance/catalog.test.ts`

**Do not edit anything under `catalog/` by hand.** Change the type and regenerate.

## Ubiquitous language — [`glossary.md`](glossary.md)

The glossary is **generated from the executable specification**, not hand-written. Every
definition is the JSDoc on the type, enum member or function that declares the term in
[`packages/domain-reference/src/`](../../packages/domain-reference/src/), so there is one home for
each name rather than a code copy and a prose copy that can drift.

- Regenerate: `npm run glossary -w @pegasus/domain-reference`
- Generator: [`packages/domain-reference/tools/generate-glossary.ts`](../../packages/domain-reference/tools/generate-glossary.ts)
- Two gates, both in `packages/domain-reference/tests/conformance/`: `glossary-staleness.test.ts`
  fails when the committed file and the code disagree, and `glossary-coverage.test.ts` fails when a
  covered term has no docstring, or a docstring carrying neither a citation nor an explicit
  `[ORIGINAL]` / `[SYNTHESIS]` marker.

**Do not edit `glossary.md`.** Change the docstring and regenerate.

## What this model is — and is not

It is an **ideal target model of the domain**, not a description of what Pegasus II or Pegasus
Cloud do today. Decided 2026-09-17: **only external sources shape it.** Our own systems are
deliberately excluded from the evidence base, because a model built to fit the legacy code would
inherit the legacy code's limits — and round 1 showed exactly that risk (Cloud's `Move` fuses
order, shipment and route into one aggregate; pegII treats one sale as one shipment; both
foreclose consolidation, which is a normal household-goods move).

What counts as external: standards and reference models, regulation and tariffs, **partner
contracts** (Weichert, SIRVA ADE, Atlas — how counterparties actually behave, including behavior
observed from their live APIs), competing products, and telematics vendors.

What does not: `packages/domain`, the Prisma schema, the integration floors, the pegII order
shape, the long-haul app, and our own integration configs. Their round-1 analyses are kept —
they are the raw material for the **mapping workstream** — which does not exist yet and has no
directory here — and which asks the separate question of what our systems can supply and what the gap
costs. That question comes **after** the model exists.

## Scope

**v1 — modeled in detail** (areas are defined in [`rubric.md`](rubric.md)):
order & service lifecycle · shipment structure · trip, stop & assignment ·
execution events & tracking · storage-in-transit · documents & evidence ·
charges & billing hooks · parties & roles · identity & cross-references.

**Named on the context map only, sources retained for later:** survey &
estimating detail, inventory detail, claims & valuation, sales/CRM, crew &
driver settlement/payroll, warehouse operations, rating/tariffs.

Sources are collected for the **whole** domain, not only v1 — an out-of-scope area
gets its registry entries and stored material now so it can be built later
without repeating the research.

## Process

| Phase                  | Output                                                                                                                                                                 | Status                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1. Inventory + rubric  | `sources/registry.yaml`, `rubric.md`, inbox requests                                                                                                                   | **done** — 87 sources registered                       |
| 2. Per-source analysis | `sources/<id>/analysis.md` (from [`templates/source-analysis.md`](templates/source-analysis.md))                                                                       | in progress — 32 of 87; 15 blocked on access           |
| 3. Comparison          | `analysis/<area>.md` — best source per area, with reasons                                                                                                              | in progress — see the note in [`rubric.md`](rubric.md) |
| 4. Core model          | `packages/domain-reference/` — not `model/`; see above                                                                                                                 | **live**, minus the context map, commands, lifecycles  |
| 5. Validation          | `packages/domain-reference/tests/scenarios/` + the Alloy models in `alloy/`                                                                                            | **live** — nine scenarios, model-checked               |
| 6. Event catalog       | [`catalog/`](catalog/) — two JSON Schema faces, a manifest, an owed inventory; decided in [`analysis/published-event-catalog.md`](analysis/published-event-catalog.md) | **live** at `0.2.0`                                    |
| 7. Mappings            | A separate workstream, no directory here                                                                                                                               | not started, deliberately                              |

## Conventions (for humans and agents)

- **Stable ids.** Sources: `src:<id>` (the `id` in `registry.yaml`). Areas:
  `A1`…`A10` (rubric). Model concepts, once they exist: `dm:<Context>.<Concept>`.
  Cite by id so references survive file moves.
- **Registry is the index.** Every source — internal, public, gated — has one
  entry in `sources/registry.yaml`, including ones not analyzed yet. Grep it before
  searching the web again.
- **Every claim cites evidence.** Analysis notes quote or point at the exact
  section/path/URL. Mark the evidence grade (A/B/C, see rubric) so "read the spec"
  is never confused with "saw a marketing page".
- **Storage policy** — see [`sources/README.md`](sources/README.md). Committed:
  text, specs, and excerpts we are allowed to keep. Local-only (gitignored):
  licensed, gated, or large binaries — recorded in the registry with URL,
  retrieval date and sha256 so they can be re-obtained.
