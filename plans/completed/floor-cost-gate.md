# Mappable order-level `estimatedTotalCost` + gate enforcement of `inputFieldRoots`

**Branch:** `feat/floor-cost-gate` — **COMPLETE**, SDK 0.38.0.

**Goal:** Close sdk-feedback **0041** (the `shipment_status_update` floor has no
mappable order-level total cost — `estimatedTotalCost` is a code-derived sum of six
per-shipment add-on components) and **0042** (the publish gate advertises
`inputFieldRoots` enforcement but never checks the source side of a mapping read
inside `$each`).

Both live in `apps/api/src/integration-validation` on the same floor + gate, and both
change the published contract an SDK author writes against — so one plan, one PR, one
SDK release (mirrors #624, which shipped 0039+0040 together).

## Root cause (0042) — verified, not inferred

`analyzeMapping` DOES have an input-side layer, and it is wired
(`gate-pipeline.ts:107` passes `base.inputFieldRoots`). It reads
`collectTopLevelSourcePaths`, which by construction **does not descend into `$each`**
(`mapping-format.ts:294`: "Intentionally do NOT descend into $each — element scope,
not order scope").

The real Weichert mapping builds `shipments` with `"$from": "."` and puts **21 of its
28 `$from` reads inside that `$each`** — including every cost leaf 0042 probed. So the
checker inspects 7 paths and silently ignores the other 21. `demoPartnerInputFieldRoots`
even declares `Id` / `Financials` with the comment "element scope (`$each` over `.`)
reads these off the same root object" — roots declared for reads the checker never looks at.

Fix: compose element-scope paths with the array's own `$from` prefix
(`.` → no prefix; `shipments` → `shipments.<sub>`), then check them like any other.

## Ordered checklist

- [x] **1. New scoped source collector** — `transform/mapping-format.ts`
  - Add `collectScopedSourcePaths(template): { target, source }[]`, composing `$each`
    sub-paths with the array's `$from` (fallback chain → one composed path per prefix;
    nested `$each` recurses; `.` under a prefix yields the prefix itself, never `x..`).
  - Remove `collectTopLevelSourcePaths` / `collectTopLevelSourceRoots` (both are used
    only by the static checker + their own test — confirmed by grep across the repo).
- [x] **2. Enforce it** — `transform/mapping-static-check.ts`
  - Switch layer 3 to the new collector. Report `where` = the **target path** (matching
    the canonical-target check's style); the message names the source path, the unknown
    root, and the allowed list. Drop the current de-dup-by-root wording.
  - Floors with no `inputFieldRoots` keep today's behavior (unchanged).
  - 0042 item **C** (warn on a `$from` null across the whole corpus) is **out of scope** —
    a separate feature; A+B is the plain reading of the item.
- [x] **3. Canonical field (0041A)** — `canonical-demo-partner.ts`
  - Add order-level `estimatedTotalCost: z.number().nullish()`. **Nullish, not
    `moneyOrNull`** — the item's prose says "optional and nullish" but its code sample
    uses `moneyOrNull` (= `z.number().nullable()`, required key), which every existing
    overlay would fail. Same shape as `surveyDate: milestoneDate.nullish()` from 0040.
- [x] **4. Fact prefers the mapped value (0041B)** — `facts/demo-partner-facts.ts`
  - `order.estimatedTotalCost ?? sum(shipments[].surveyed*)`. `??` not `||`, so an
    explicit `0` is honored rather than falling back to the sum.
  - Update `factDocs.estimatedTotalCost` + the file header — the current one-liner
    ("Sum of every surveyed cost field") becomes false the moment the fallback lands.
- [x] **5. Tests**
  - `transform/mapping-static-check.test.ts` — a bad root inside `$each` is now rejected
    and names its target path; a legal `$each` read still passes; a dotted-root sibling
    (`UnusedFields.something_else`) is rejected; `.`, `DocumentationDates[0]` and nested
    paths produce **no** false positives.
  - `transform/mapping-format.test.ts` — update for the new collector.
  - `facts/demo-partner-facts.test.ts` — mapped wins (4200, no components → 4200);
    explicit zero honored (0 + Storage 250 → 0, submit rule fires); unmapped falls back
    (byte-identical to today).
  - `gate-pipeline.test.ts` — the built-in demo-partner mapping still gates clean end to
    end, and an external mapping with `$each` produces no false positive (the external
    stage reuses `analyzeMapping` with the canonical roots — `gate-pipeline.ts:153`).
  - `handlers/integration-validation/validate.test.ts` — update any pinned wording.
- [x] **6. Discovery surfaces** (CLAUDE.md: an API capability not reachable +
      discoverable through the SDK is a gap)
  - `packages/workflows-sdk-python/pegasus_workflows/api.py` `get_floor` docstring —
    the `inputFieldRoots` claim becomes true; add that reads **inside `$each`** are
    checked in element scope. Kill any prose describing `estimatedTotalCost` as a sum.
  - `pegasus_workflows/cli/mcp_server.py` (mirrored resource), SDK `README.md`,
    `docs/integration-mapping-format.md`, `apps/api/src/lib/openapi-spec.ts` (floors
    endpoint description).
  - Bump `pyproject.toml` 0.37.0 → **0.38.0** + CHANGELOG (contract change: new canonical
    field; the gate gets stricter).
- [x] **7. Gates:** `npm run typecheck && npm test` (root), then `/workstream-finish`.
- [~] **8. Ship the SDK once main is green:** tag the merged commit `sdk-python-v0.38.0`,
  push, watch `release-sdk-python.yml` → PyPI. Never publish locally. (Post-merge —
  this plan is archived in the implementation commit, so the tag comes after it.)

## Outcome — verified against the LIVE weichert config, not just fixtures

Ran `analyzeMapping` over `~/repos/pegasus-workflows/platform/integrations/weichert/
mapping.json` with the floor's real `inputFieldRoots` (scratch test, not committed):

| Probe                                                                      | Result                                                                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The live config, unchanged                                                 | `[]` — **no false positives** (all 28 reads legal)                                                                  |
| `surveyedThirdPartyCosts` ← `ZZZ_NoSuchRoot.Nope` (0042's filed probe)     | rejected at `shipments[].surveyedThirdPartyCosts`, message names the source + the eight allowed roots               |
| `estimatedTotalCost` ← `SurveyResults.CoreCost` (0041's _wrong_ candidate) | rejected — the gate now distinguishes the two candidates that both validated green and cost 0041 a hand-built probe |
| `estimatedTotalCost` ← `Survey.CoreCost` (0041's mapping)                  | `[]` — accepted                                                                                                     |

The same probe pair runs in-repo as `gate-pipeline.test.ts` → "undeclared input roots
inside `$each` (0042)", end to end through the real pipeline including the corpus,
which stays green in both cases — the point of the item.

## Files

| File                                                                    | Change                                                            |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/api/src/integration-validation/transform/mapping-format.ts`       | new `collectScopedSourcePaths`; drop the two top-level collectors |
| `apps/api/src/integration-validation/transform/mapping-static-check.ts` | layer 3 checks element scope; new problem wording                 |
| `apps/api/src/integration-validation/canonical-demo-partner.ts`         | order-level `estimatedTotalCost` (nullish)                        |
| `apps/api/src/integration-validation/facts/demo-partner-facts.ts`       | mapped-wins fact + factDocs                                       |
| `apps/api/src/lib/openapi-spec.ts`                                      | floors-endpoint description                                       |
| tests above                                                             | new + updated cases                                               |
| `packages/workflows-sdk-python/**`                                      | docstring, MCP resource, README, CHANGELOG, version               |
| `docs/integration-mapping-format.md`                                    | input-root enforcement incl. `$each`                              |

## Risks / side effects

- **False positives on a real published config are the main risk** — a gate that was
  never enforcing now rejects. Checked statically before writing code: every `$from` in
  the live Weichert `mapping.json` (28 reads, 21 of them inside `$each`) resolves to
  `InvolvedParties` / `Survey` / `DocumentationDates` / `KeyMoveDates` / `Id` /
  `Financials` — all six declared. `DocumentationDates[0]` normalizes index-free today
  and must keep doing so.
- `shipment_status_update` is the **only** floor declaring `inputFieldRoots`
  (`shipment-lifecycle-event` explicitly declares none, and the four generic inbound
  floors declare none) — so the blast radius is exactly one floor plus the
  external-mapping stage, which passes canonical top-level roots.
- Backward compatibility of the fact is by construction: no overlay maps the new field
  today, so `?? sum(...)` is the identity change for all of them.

## Out of scope (consumer-repo cutover, not platform)

- Changing the Weichert overlay to map `Survey.CoreCost` and unmap the six component
  fields.
- Confirming `CoreCost`'s real native path against a live pegII order — 0041's own
  caveat. If it turns out to sit under a root the floor does not declare
  (`SurveyResults` among them), that is a follow-up one-line `inputFieldRoots` addition.
- A per-shipment `shipments[].estimatedTotalCost` — 0041 explicitly defers it.
