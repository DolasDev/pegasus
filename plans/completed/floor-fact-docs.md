# Floor fact semantics are discoverable (`factDocs`) + SDK 0.34.0

**Type:** feat · **Slug:** `floor-fact-docs` · **Follows:** #558 (sdk-feedback 0035 per-date actuals facts)

## Why

#558 added four milestone facts, so `shipment_status_update` now publishes **six** similarly-named
`shipmentsWith*Actual` counts. `factCatalog` is `name → type` only, so an author (or their agent)
reading the floor contract cannot tell:

- that `shipmentsWithLoadActual` + `shipmentsWithDeliveryActual` AND-ed in one rule count
  **independently** across shipments, while `shipmentsWithLoadDeliveryActual` requires the **same**
  shipment — the exact distinction sdk-feedback 0035 asked to be "resolved explicitly";
- that the counts carry "at least one of the related Shipment Orders" semantics, so the idiom is
  `{op: 'lte', value: 0}`.

That is a reachability gap, not an ergonomics one: the meaning of a fact is not derivable from
anything the API serves. Per CLAUDE.md ("prefer **live introspection** over static docs where the
contract is code") the fix belongs on the floor contract endpoint, not in a README paragraph.

## Change — platform (`apps/api`)

1. `TypeFloor.factDocs?: Record<string, string>` (`integration-validation/types.ts`) — optional,
   one line per fact. Purely additive; `FactCatalog` and everything that consumes it
   (`static-check`, `gate-pipeline`, `registry`) are untouched.
2. Populate `demoPartnerFactDocs` in `facts/demo-partner-facts.ts` next to the catalog (so catalog +
   docs drift together or not at all), covering all facts and stating the independent-vs-same-shipment
   distinction on the milestone counts. Wire it into `shipment-status-update.floor.ts`.
3. Populate `factDocs` for the four generic inbound floors too (`shipment_lifecycle_event`,
   `sales_lead`, `financial_settlement`, `document_record`) — a handful of facts each, and a
   half-documented surface is worse than a consistently documented one.
4. `floorDetail()` (`handlers/integration-validation/validate.ts`) emits `factDocs` when the floor
   declares it, matching how `inputFieldRoots` is conditionally spread.
5. OpenAPI (`lib/openapi-spec.ts`): add `factDocs` to the `/integrations/floors/{floorId}` response
   schema and mention it in both floor endpoints' descriptions.

## Change — SDK (`packages/workflows-sdk-python`), 0.33.0 → 0.34.0

The MCP `pegasus://reference/floors` resource and `list_floors()`/`get_floor()` proxy the live
payload, so `factDocs` flows through the moment the API deploys — only the prose that tells an agent
to _read_ it needs updating:

6. `api.py` `get_floor()` docstring — document `factDocs` in the returned shape.
7. `README.md` integration-config section — show `factDocs` in the floor-discovery snippet.
8. `mcp_server.py` — the `pegasus://reference/floors` resource header + the integration-config
   authoring guide's "Discover the floor FIRST" block mention `factDocs`.
9. `CHANGELOG.md` + `pyproject.toml` version bump.

## Tests

- Handler: `GET /integrations/floors/shipment_status_update` returns `factDocs` documenting the
  per-date vs paired distinction; a floor that declares none omits the key.
- Floors unit: for every registered floor, every `factDocs` key exists in that floor's `factCatalog`
  (no drift, no docs for a fact that isn't real) — and, for the floors that declare docs, every
  catalog fact is documented.
- OpenAPI: the existing spec test stays green; assert `factDocs` is in the `getFloor` response schema.
- SDK: `tests/test_api.py` floor fixture carries `factDocs` and the assertion reads it.

## Publish

After the PR merges and Deploy is green: push the `sdk-python-v0.34.0` tag → `release-sdk-python.yml`
→ PyPI. SDK publishing is platform work and is explicitly requested here; integration/workflow
_config_ publishing is not part of this.

## Verification

`npm test` + `npm run typecheck` + `npm run lint` in `apps/api`; `uv run pytest` + `ruff` in the SDK;
one PR through the merge queue with the plan file; tag only after main's Deploy is green.

## Outcome (completed)

Shipped as planned. All five floors declare `factDocs`; the endpoint, the OpenAPI schema, and the
three SDK surfaces carry it. `apps/api` 2788 tests green, coverage floors unmoved; SDK 359 tests +
`ruff check` green (`ruff format` drift is pre-existing on 23 files and CI does not run it).

The `shipment_status_update` docs spell out the two things a name + type cannot: the "at least one"
`{op:'lte', value:0}` idiom, and that AND-ed count predicates evaluate **independently** — so the
paired `shipmentsWithLoadDeliveryActual` exists for the same-shipment reading. Both are also stated
in the OpenAPI description, the SDK `get_floor()` docstring, the README (with a worked rule pair),
and both MCP prose surfaces; the MCP `pegasus://reference/floors` resource proxies the live payload,
so the docs themselves flow through with no SDK change.

### Found en route — a pre-existing flake, fixed here

`resolve-tenant-config.test.ts` publishes a degenerate GLOBAL `demo_partner` overlay into the shared
test Postgres and refreshes the registry, so `map-to-external.test.ts` / `validate.test.ts` running
concurrently in another worker intermittently resolve it and fail with a wall of
`structural-contract` issues. Reproduced on a **clean tree** (2/10 for the directory, 5/8 for that
file pair) — independent of this change, but it then failed the pre-push gate, so it is fixed here
rather than deferred: the writing file now overlays `allied_status` (a built-in on the same floor
that only a Prisma-mocking test reads) instead of `demo_partner`. Pair 5/8 → 0/10, directory
2/10 → 0/6. Written up in `dolas/agents/project/GOTCHAS.md` — a GLOBAL row has no tenant scope, so
publishing one in a test publishes it for every concurrently-running file.
