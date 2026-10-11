# DCSA JIT — SUCCESSOR artifacts, **not** the artifacts this corpus cites

Retrieved **2026-10-10** from SwaggerHub, which is where DCSA publishes its specs now.

**Read this before citing anything in this directory.** These two files are here to make one
specific claim checkable and to document that another one is not. They are **not** the files
`00-shared-decisions.md`, `A1-order-service-lifecycle.md` and `A8-authority-skeleton.md` cite.

| file | SwaggerHub api / version | bytes | sha256[0:16] |
| --- | --- | --- | --- |
| `DCSA_JIT-2.0.0.json` | `dcsaorg/DCSA_JIT` 2.0.0 | 46331 | `e69b9ae8fb64e7a3` |
| `JIT_EVENT_HUB-1.2.0-Beta-1.json` | `dcsaorg/JIT_EVENT_HUB` 1.2.0-Beta-1 | 14739 | `936f7297d12ac7ad` |

Both are served as **JSON** by the SwaggerHub API (`?format=yaml` is ignored), hence the `.json`
extension even though the cited originals were `.yaml`. Not reformatted — `.prettierignore`
excludes `docs/domain-reference/sources/`.

## Why the cited files are not here

The corpus cites `jit/v2/JIT_v2.0.0.yaml` at **L3554-3568 / L3554-3585**. That file was a
**bundled** build (all `$ref`s inlined, ~3600 lines) in the GitHub repo `dcsaorg/DCSA-OpenAPI`,
which `registry.yaml` still records as the upstream URL. As of 2026-10-10:

- **`dcsaorg/DCSA-OpenAPI` returns 404 — the repo is deleted.**
- `dcsaorg/DCSA-JIT` exists but is the **Java implementation**; it contains no OpenAPI spec.
- A GitHub search finds no usable mirror — only `nateshg/DCSA-OpenAPI`, last pushed **2020-07-07**,
  which predates JIT v2 entirely.
- Every surviving SwaggerHub artifact is **unbundled** (6–46 KB, `$ref`-ing out to shared domain
  specs), so none of them has the line numbering the citations use.
- **The standard has been renamed.** `DCSA_JIT` 2.0.0 opens with
  _"⛔ STANDARD RENAMED TO PORT CALL 2.0.0 … Do NOT use this version"_; there is now a separate
  `dcsaorg/DCSA_PORT_CALL` API.

The local copy did not survive either: `sources/README.md` promises the full clone at
`<id>/local/full-clone/` (gitignored), and it is absent from every worktree. The gap itself was
created deliberately — that README records _"Trimmed on 2026-09-18: … DCSA (to the
`domain`/`tnt`/`bkg`/`cs` specs)"_ under **capture only what is cited** — and JIT was trimmed as
uncited **while three analyses were citing it**.

## What these files DO establish

**`isFYI` exists and means what the analysis says it means.** `DCSA_JIT-2.0.0.json`:

> `isFYI`: _"Flag indicating that this **event** is primarily meant for another party - but is sent
> as a FYI (for your information)."_

`dcsa/analysis.md` quotes an older build — _"If set to `true` it indicates that this **message** is
primarily meant for another party…"_ — so the **substance** is confirmed and the **quotation is not
verbatim from any file we hold.** Cite this file, and quote it as it reads here.

## What these files DO NOT establish

**The per-publisher-role basis constraint is not in any surviving JIT artifact.** The claim —
_"`EST`/`PLN`/`ACT` may be published only by the Service Provider, `REQ` only by the Consumer"_,
cited at `A8-authority-skeleton.md:333` (§4), `:1399`, `00-shared-decisions.md:328`,
`A1-order-service-lifecycle.md:132` and `:1137` — was searched for in `DCSA_JIT` 2.0.0,
1.2.0-Beta-2, 1.1.0, 1.0.1 and `JIT_EVENT_HUB` 1.2.0-Beta-1, under `Service Provider`,
`Service Consumer`, `eventClassifierCode` and every `only`-shaped publishing constraint.

**2.0.0 has no `EST`/`PLN`/`ACT`/`REQ` enum at all.** `1.2.0-Beta-2` mentions
`eventClassifierCode` once, with no role constraint attached.

Nothing here says the claim is false — DCSA plainly had an ERP pattern with publisher semantics.
What is gone is the ability to check it. §4's precedent has therefore been **re-sourced** onto bytes
this repo does hold, and **narrowed** in the process: see
`../DCSA-OpenAPI/domain/event/event_domain_v3.2.0.yaml` lines **778**, **1231** and **1328**, which
constrain the classifier **by event type** (`"For ShipmentEvents the eventClassifierCode must be
ACT"`) and say nothing about **who may publish**. `[A8 §10]` carries the exposure.

> Beware a trap in that same file: the `eventClassifierCode` **query-parameter** description is
> almost entirely **commented out**, including the useful _"not all events support REQ"_ line. The
> three live constraints are in the **schema** descriptions. Grep for the constraint text, not for
> the field name, and check for a leading `#`.
