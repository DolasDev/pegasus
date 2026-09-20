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

| Layer         | Folder                   | What                                                                                                         | Changes                 |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Sources       | [`sources/`](sources/)   | Registry + stored material + per-source analysis                                                             | As sources are added    |
| Analysis      | [`analysis/`](analysis/) | Per-area comparison and "best source" decisions                                                              | Per research round      |
| Core model    | [`model/`](model/)       | Ubiquitous language, context map, aggregates, value objects, lifecycles, invariants, domain events, commands | Rarely                  |
| Event catalog | [`catalog/`](catalog/)   | Published integration events, derived from the core                                                          | Deliberately, versioned |
| Mappings      | [`mappings/`](mappings/) | pegII ↔ model, Cloud ↔ model, partner ↔ model                                                                | Often                   |

"Pure" means **no technology** — no pegII field names, API shapes, or database
structure in `model/`. It does **not** mean generic: the model uses the moving
industry's own language (booking/origin/hauling/destination agent, binding
estimate, storage-in-transit, reweigh), not abstract logistics terms.

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
they are the raw material for [`mappings/`](mappings/), which asks the separate question of what
our systems can supply and what the gap costs. That question comes **after** the model exists.

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

| Phase                    | Output                                                                                           | Status      |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| 1. Inventory + rubric    | `sources/registry.yaml`, `rubric.md`, inbox requests                                             | in progress |
| 2. Per-source analysis   | `sources/<id>/analysis.md` (from [`templates/source-analysis.md`](templates/source-analysis.md)) | —           |
| 3. Comparison            | `analysis/<area>.md` — best source per area, with reasons                                        | —           |
| 4. Core model            | `model/`                                                                                         | —           |
| 5. Validation + mappings | `model/scenarios/`, `mappings/`, gap list                                                        | —           |

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
