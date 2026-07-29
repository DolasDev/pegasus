# Per-date actuals facts on the `shipment_status_update` floor (sdk-feedback 0035)

**Type:** feat · **Slug:** `actuals-facts` · **Source:** `pegasus-workflows/sdk-feedback/0035-load-only-actuals-facts-on-shipment-status-update-floor.md`

## Problem

The `shipment_status_update` floor publishes only two milestone facts, and both weld pack in:

```ts
const packLoad = (s) => has(s.packDate1.actual) && has(s.loadDate1.actual)
shipmentsWithPackLoadActual
shipmentsWithPackLoadDeliveryActual
```

Rules are a decision table over scalar facts (`rules/types.ts` predicate = `{fact, op, value}`;
`engine.ts` resolves `facts[p.fact]`), so an overlay can decide _whether_ to require the milestone
but not _which dates_ compose it. Weichert has real load-without-pack moves (shipper self-packs), so
every such order is rejected on the way to `In Progress` / `Delivered` / `Completed` with a message
demanding a Pack Date 1 Actual that will never exist. The only config-only workarounds are dropping
the rules entirely or mapping `packDate1.actual` from the load date — a lie in a canonical field that
feeds the order projection and every downstream consumer.

## Change (purely additive — no existing fact changes value)

`apps/api/src/integration-validation/facts/demo-partner-facts.ts`:

Add four facts to `demoPartnerFactCatalog` (all `'number'`) and derive them in
`deriveDemoPartnerFacts`, each a plain count over `order.shipments` matching the existing
"at least one of the related Shipment Orders" semantics:

| fact                              | predicate                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `shipmentsWithPackActual`         | `has(s.packDate1.actual)`                                                     |
| `shipmentsWithLoadActual`         | `has(s.loadDate1.actual)`                                                     |
| `shipmentsWithDeliveryActual`     | `has(s.deliveryDate1.actual)`                                                 |
| `shipmentsWithLoadDeliveryActual` | `has(s.loadDate1.actual) && has(s.deliveryDate1.actual)` (same-shipment pair) |

The fourth resolves the semantics wrinkle called out in 0035: separate per-date predicates count
independently, so with 2+ shipments "one shipment has load, a different one has delivery" would pass
the decomposed form. Shipping the paired fact too (0035 says "ship both if cheap") lets an overlay
pick strict same-shipment or loose independent semantics. Document the distinction in the file's
header comment so it is discoverable from the floor contract.

`shipmentsWithPackLoadActual` and `shipmentsWithPackLoadDeliveryActual` stay untouched and still
derive their pre-change values — every published config (`allied_status`, the live `weichert` GLOBAL
v2, any tenant overlay) keeps working with no edits.

## Discoverability (SDK boundary)

The fact catalog is served live by `GET /integrations/floors/:floorId`
(`apps/api/src/handlers/integration-validation/validate.ts:132`) and the SDK reads it there — no
static enumeration of fact names exists in `packages/workflows-sdk-python` (verified by grep), so the
new facts are discoverable the moment the API deploys. No SDK version bump required. Confirm the
floor-contract test in `validate.test.ts` still passes (it asserts the machine-readable contract).

## Tests (TDD — write first, watch them fail on the missing facts)

New unit tests for `deriveDemoPartnerFacts` (no gate, no DB) covering the 0035 acceptance criteria:

1. Load actual present + pack absent → `shipmentsWithLoadActual: 1`, `shipmentsWithPackActual: 0`,
   `shipmentsWithPackLoadActual: 0` (back-compat: composite still 0).
2. Load + delivery actuals, no pack → `shipmentsWithLoadDeliveryActual: 1`,
   `shipmentsWithPackLoadDeliveryActual: 0`.
3. Zero shipments → all four new facts derive `0`.
4. Two shipments, load on one and delivery on the other → per-date facts each `1`, paired fact `0`
   (pins the decomposed-vs-composite semantics explicitly).
5. Full pack+load+delivery shipment → all new facts `1` **and** both composite facts unchanged at `1`.
6. Catalog assertion: every key returned by `deriveDemoPartnerFacts` is declared in
   `demoPartnerFactCatalog` with the matching type (guards the "unknown fact" gate failure mode).

Plus a rules-level check that a rule keyed on `shipmentsWithLoadActual` passes the static check
(`static-check.ts` is what emitted `unknown fact "shipmentsWithLoadActual"`).

The existing 8-case demo-partner corpus and `demo-partner.rules.ts` are **not** modified — the
reference partner still requires pack, proving back-compat (`corpus 8/8`).

## Out of scope (different repo / session)

Repointing Weichert's two rules at the new facts is a config change in
`pegasus-workflows/platform/integrations/weichert/rules.json` and must be published from the
`pegasus-workflows` session, not this platform session. This PR only makes it expressible. Fill in
the 0035 validation log there once the API is deployed.

## Verification

- `npm test` in `apps/api` (integration-validation suites) + `npm run typecheck` + `npm run lint`.
- Coverage floors: re-pin only downward if a parallel merge raised them; never lower deliberately.
- Land as one PR through the merge queue with the plan file in the same commit.

## Outcome (completed)

Shipped as planned. All four facts are additive; nothing existing changed value.

- `facts/demo-partner-facts.ts` — catalog + derivation for `shipmentsWithPackActual`,
  `shipmentsWithLoadActual`, `shipmentsWithDeliveryActual`, `shipmentsWithLoadDeliveryActual`;
  header comment documents the composite / per-date / paired granularities and the independent-count
  caveat (the 0035 semantics decision, resolved by shipping the pair rather than only documenting it).
- `facts/demo-partner-facts.test.ts` (new, 11 cases) — the 0035 acceptance criteria, plus a
  both-directions catalog↔derivation assertion, plus the load-only rules from 0035 run through
  `analyzeRuleSet` (no problems) and `evaluateRules` (accept load-without-pack at In Progress, still
  reject with no load, accept load+delivery at Delivered).
- `handlers/integration-validation/validate.test.ts` — pins the new facts as visible on
  `GET /integrations/floors/shipment_status_update`, the surface an SDK user reads without repo access.

No SDK change: `list_floors`/`get_floor`, the MCP `pegasus://reference/floors` resource, and the
README all read the catalog **live** — there is no static fact enumeration anywhere in
`packages/workflows-sdk-python` (verified by grep), so the facts are discoverable the moment the API
deploys.

Back-compat verified: the 8-case demo-partner corpus and `demo-partner.rules.ts` are untouched and
still pass 8/8; both composite facts derive their pre-change values.

Full `apps/api` suite green; coverage floors auto-raised (lines 91.66→91.67, branches 78.82→78.83,
functions 87.79→87.82).
