# A13 — In-area vs out-of-area move classification (scoped enrichment)

Cited elsewhere as **[A13-IOA §x]**.

> **Status.** A **scoped enrichment**, not an A13 decision document. A13 (crew, driver &
> settlement) is context-map-only by design and is **not a gap** — see [`rubric.md`](../rubric.md)
> and the A13 node in [`context-map.md`](../context-map.md), which records that it "has no decision
> document". This file does **not** change that. It carves out exactly **one** concept within A13 —
> the in-area / out-of-area classification that governs which compensation applies to an origin
> service — because a downstream implementation (the legacy pegII driver-settlement screen) needs a
> domain reading of it and the alternative is to reverse-engineer one from a WinForms form, which
> [SD §0] and the [README](../README.md#what-this-model-is--and-is-not) forbid. It does **not** build
> out crew scheduling, the revenue-split arithmetic, or the full compensation-code catalogue, and it
> does not touch the executable specification. Where it would conflict with [`00-shared-decisions.md`]
> (00-shared-decisions.md) (**[SD]**) or [`A8-authority-skeleton.md`](A8-authority-skeleton.md),
> those win.

> **Scope.** Two adjacent areas meet here. The **classification** — is an origin service in-area or
> out-of-area, and who is paid for it — is A13 (compensation, revenue splits). The **thing the
> classification is relative to** — an agent's tariff-defined service area — is A12 (rating &
> tariffs). Both are context-map-only; this note reads only as far as the classification needs and
> stops at the rate structure's edge.

---

## 0. Rules this document is written under

[SD §0]'s three, unchanged:

1. **External sources only.** Our own systems (pegII, Pegasus Cloud, the integration floors) are
   `role: mapping-only` in `sources/registry.yaml` and are never cited for what the domain _is_. In
   particular, pegII's `is_local` column and its "in-area move" flag are **not evidence**; they are
   the subject of the mapping workstream, and §4 below is written for that consumer without treating
   its code as a source.
2. **Every claim cites a source that says that thing, or is marked [ORIGINAL].**
3. **No guessing to make a type tidy.** Where the corpus settles the _shape_ of a concept but not a
   specific operational predicate, §3 says so rather than inventing the predicate.

All three sources cited here are already registered and analyzed; this enrichment adds none.

## 1. What the corpus settles

**1.1 An agent operates within a tariff-defined _service area_ (A12).** The DP3 domestic 400NG
tariff rates on a four-level geographic lattice whose operative unit is the **Service Area** —
`street → ZIP3 → Base Point City → Service Area (227: 20 metro + 207 non-metro) → Region`
(`src:dp3-400ng`, p. 32; the lattice is set out in
[`sources/dp3-400ng/analysis.md`](../sources/dp3-400ng/analysis.md) §1). Non-linehaul (accessorial)
charges — packing, unpacking, origin/destination service — are priced per CWT "from the
Geographical Schedule tab **by Service Area**" (`src:dp3-400ng`, pp. 80-82, 98-99). So "the area" an
origin service belongs to is a first-class, published geographic fact, and origin/destination
service charges are already area-keyed at the rating layer.

**1.2 Compensation distinguishes service performed _out of_ an agent's area, keyed to which agent
performed it (A13).** SIRVA ADE's abstract service-code catalogue carries dedicated **out-of-area
compensation codes**: `OASABA` and `OASAOA` — "out-of-area by booker vs OA [origin agent]"
(`src:sirva-ade`, ASC pp. 1-6, summarized at
[`sources/sirva-ade/analysis.md`](../sources/sirva-ade/analysis.md) §A13). They sit beside the
role-keyed compensation codes `BOOK` (booking compensation), `ORGN` (origin compensation) and `HAUL`
(hauling compensation). Two facts matter for this classification:

- **Out-of-area is a named settlement outcome, not a mileage band.** It is a compensation *code*, in
  the same catalogue as origin and hauling compensation — i.e. the domain pays *differently* for an
  out-of-area service than for the in-area equivalent.
- **It is agent-relative.** There are two out-of-area codes, one for the **booker** and one for the
  **origin agent** (`OASABA` vs `OASAOA`). "Out of area" is therefore always "out of _whose_ area",
  and the responsible agent is part of the classification.

**1.3 Revenue is allocated per role, and the payee is carried on the compensated line.** `TransRevenue`
is "distributed according to allocation rules to **Origin Agent, Hauler, Destination Agent, SIRVA**"
(`src:sirva-ade`, ABS p. 3), and the payee is carried on the line item keyed by service
(`Driver1Code`/`Driver2Code` present only on hauling lines; `SalesPersonCode` only on the booking
service line — ABS p. 4). So the classification feeds a per-role split, which is exactly what the
downstream driver-settlement screen computes.

**1.4 "Local move" exists as a distinct order kind, and its boundary is a pricing boundary.** MilMove
publishes a `LOCAL_MOVE` orders type (`src:milmove-mymove`, `swagger/*.yaml`), and treats the
in/out-of-area edge as a *pricing* boundary: a destination-address change is auto-approved "unless it
crosses a pricing boundary (**service area**, mileage bracket, >50 mi, shorthaul/linehaul flip)"
(`src:milmove-mymove`, `swagger/prime.yaml:477-520`;
[`sources/milmove-mymove/analysis.md`](../sources/milmove-mymove/analysis.md) A2/A7 row). This
corroborates 1.1-1.2 from a second, public corpus: crossing a service area changes the price, and a
local move is a recognized, separately-priced kind.

## 2. The synthesis

**There is no single, uniformly-defined "in-area / out-of-area" term in the corpus** — the phrase is
not a published enum member anywhere. What the corpus settles is a concept with three stable
properties, and they are enough to anchor an implementation:

> An **origin service is in-area** when it falls within the **service area of the agent responsible
> for it**; it is **out-of-area** otherwise. The distinction is (a) **geographic** — relative to a
> tariff-defined service area [1.1]; (b) **agent-relative** — "out of _whose_ area" is part of it,
> and booker and origin agent are classified separately [1.2]; and (c) **a settlement outcome** — it
> selects which compensation code and which revenue split applies, not merely a label [1.2-1.3].

This is **[SYNTHESIS]** across `src:dp3-400ng` (the area), `src:sirva-ade` (the agent-relative
compensation outcome) and `src:milmove-mymove` (the local-move kind and the pricing-boundary
corroboration). No single source states all three.

## 3. What the corpus does NOT settle — and must not be guessed

The corpus gives the **shape** (agent-relative, service-area-based, settlement-affecting) but **not a
specific predicate** for deciding in-area at an individual order. In particular:

- It does **not** say "in-area ⟺ the origin agent is one of the carrier's own agents/offices." That
  is one reasonable *realization* of the agent-relative concept in [2], but the corpus supplies
  neither that predicate nor a competing one. Under [SD §0] it is therefore **[ORIGINAL]** at the
  predicate level and must be recorded as a local operational reading, not cited to a source.
- It does **not** fix the granularity: service-area membership (BPC/SA lattice) and "performed by our
  own office" are different tests that usually agree but can diverge (our office can perform a
  service outside its filed area; a third-party agent can sit inside it). The corpus's own answer is
  the **service area** [1.1]; "our own office" is a proxy for it.

## 4. For the mapping / implementation consumer (pegII driver settlement)

This section is written for the mapping workstream and for the pegII `movemanager` change that
prompted the enrichment. It is **guidance for mapping, not part of the model** (it names our systems,
which §0.1 bars from the model itself).

- **The concept pegII calls "in-area move" is the [2] classification.** Treating it as "the origin
  service is in our own service area" is faithful to the domain. The downstream screen's use of it to
  pick in-area vs out-of-area packing / crating / unpacking driver percentages is the [1.2-1.3]
  "different compensation for out-of-area service, split per role" behaviour.
- **"Origin agent ∈ the company's own branches/offices" is a defensible proxy for the [2] predicate,
  explicitly a [§3] local realization.** Each company branch runs a service-area operation; a move
  whose origin agent resolves to one of our own branches is being originated inside our own footprint
  (in-area), and one whose origin agent is a third party is, to us, out-of-area — which is precisely
  the booker-vs-origin-agent agent-relativity of [1.2]. The implementation owns this predicate; the
  model owns only its shape.
- **A per-company setting for the predicate is domain-consistent, not an ad-hoc toggle.** Tariff
  service areas, discounts and the `dLHS`/`dSIT` factors are filed **per TSP / per channel** — a
  channel being "a unique combination of (1) origin rate area, (2) destination rate area, (3) code of
  service" (`src:dp3-400ng`, Definitions p. 11). Different carriers legitimately have different
  in-area footprints and rate bases, so letting each company choose how in-area is decided reflects
  the domain rather than papering over it.
- **What stays out.** The revenue-split arithmetic and the compensation-code catalogue
  (`BOOK`/`ORGN`/`HAUL`/`OASA*`/…) are A13 proper and remain context-map-only; this note classifies
  the service, it does not compute the split.

## 5. Owed

- The **predicate** in [§3] is `[ORIGINAL]` and is owed a source if one ever enters the corpus that
  defines in-area membership operationally (a tariff rule keying service compensation to the
  performing agent's filed service area would settle it). Until then it is a local reading.
- The broader A13 build-out (crew scheduling, the revenue-split rules, the compensation-code
  vocabulary) remains **owed to A13** exactly as the context map records at
  [`context-map.md`](../context-map.md) A13 (`authority.ts:956 → [A8 §9 item 7]`). This note
  discharges none of it.
