# Plan — sdk-feedback 0028: readable `UnusedFields` sub-paths on the `shipment_status_update` floor

## Goal

Let a per-partner overlay on the `shipment_status_update` floor map a canonical
field **directly** from a curated, vetted sub-path of Pegii's `UnusedFields`
junk-drawer (`UnusedFields.survey_received`, `UnusedFields.survey_confirm`) —
without pushing the read into a pre-map workflow enrichment lift — while keeping
the rest of `UnusedFields` closed.

Source: `~/repos/pegasus-workflows/sdk-feedback/0028-floor-input-roots-exclude-partner-fields.md`

## Root cause

The mapping static-check input guard (`analyzeMapping` in
`apps/api/src/integration-validation/transform/mapping-static-check.ts`) allows
source reads **by top-level root only** — it collects the first path segment of
every `$from` (`collectTopLevelSourceRoots`) and checks it against the floor's
`inputFieldRoots` allowlist. So a floor can open a whole root or nothing; it has
no way to open a single vetted sub-path under an otherwise-closed root. Adding
bare `UnusedFields` would open the entire junk-drawer (violates AC#4).

## Changes (all under `apps/api/src/integration-validation/`)

1. **`transform/mapping-format.ts`** — add `collectTopLevelSourcePaths(template)`:
   returns the **full** order-scope dotted source paths (does NOT descend into
   `$each`, mirroring the existing `collectTopLevelSourceRoots`).

2. **`transform/mapping-static-check.ts`** — replace the top-level-root input
   check with a dotted-aware matcher over `collectTopLevelSourcePaths`:
   - allowlist entry with **no dot** → bare root, whole root open (back-compat with
     existing floors: `InvolvedParties`, `Survey`, `DocumentationDates`, …).
   - allowlist entry **with a dot** → only that exact path and its descendants open.
   - a **bare-root read** (e.g. reads `UnusedFields`) when only sub-paths are
     declared still fails → guardrail intact.
   - error keeps the existing root form (`reads undeclared input field "<root>"`),
     matching the gate output in the feedback and the existing test.

3. **`transform/demo-partner.transform.ts`** — add `'UnusedFields.survey_received'`
   and `'UnusedFields.survey_confirm'` to `demoPartnerInputFieldRoots`. (The floor
   `shipment-status-update.floor.ts` already consumes this list via
   `inputFieldRoots`; `registry.ts` + `gate-pipeline.ts` already thread it into the
   real publish gate — no wiring change needed.)

## Tests (map 1:1 to the feedback's acceptance criteria)

- `transform/mapping-format.test.ts` — `collectTopLevelSourcePaths` returns full
  dotted order-scope paths and excludes `$each` element-scope paths.
- `transform/mapping-static-check.test.ts`:
  - AC#1: a mapping reading `surveyDate` from `UnusedFields.survey_received`
    passes (no `reads undeclared input field "UnusedFields"`); `survey_confirm` too.
  - AC#4: `UnusedFields.truck_name` fails; a bare `UnusedFields` read fails —
    guardrail intact.
- `floor-overlay.test.ts` (scratch GLOBAL overlay, mirroring the `acme_status`
  pattern already in that file):
  - AC#2: `mapFromExternal` on an overlay whose `surveyDate` reads
    `UnusedFields.survey_received` returns that value in `canonical.surveyDate`
    with **no** pre-lift into `Survey.SurveyReceived`.
  - AC#3: an empty / sentinel `survey_received` maps through the mapping `default`
    (empty stays empty), not a gate error.

No `__corpus__/demo_partner/*` churn: the reference `demoPartnerMapping` keeps
reading `surveyDate` from `KeyMoveDates.Survey.Planned`; the new capability is
proven via the mechanism tests + a scratch overlay.

## Discovery-surface follow-up (per CLAUDE.md SDK boundary)

The readable-source surface widened but the canonical contract + fact catalog are
unchanged. Confirm whether any SDK/MCP/OpenAPI floor-introspection surface
enumerates a floor's declared input roots; if it does, ensure the two new
sub-paths surface there. (Likely no change — the feedback notes the canonical
contract and fact catalog are untouched.)

## Verification

- `npm run typecheck` + targeted `vitest` on the integration-validation suite.
- Confirm the "every registered integration has a statically valid mapping" test
  still passes (demo_partner / allied_status mappings unchanged).

## Out of scope (per feedback)

- The coordinator email (genuinely-absent field) — a separate person/employee
  endpoint, owned by the platform team, arranged separately.
- The pegasus-workflows-side repoint of the live `demo_partner` config +
  dropping its enrichment lift + filling the 0028 validation log — that lands in
  the `pegasus-workflows` repo once this platform change ships.
