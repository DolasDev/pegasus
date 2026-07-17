# Plan: publish the `inbound` block via `integration-config` + make config authoring self-serve for an MCP/SDK agent

Two coupled gaps, one goal: **an agent holding only the SDK + MCP resources can author and publish a correct integration config — mapping, rules, corpus, meta(floor), AND the inbound ingress ack/validation block — without reading platform source.**

Prompted by the 0021 review: the ingress ack IS config-driven (`inbound.ackTemplate` + `inbound.validation`, shipped 0.19.0 + 0.20.0), but there is **no authoring path** to publish that block, and no way for an agent to **discover** a floor's contract.

## Verified current state (read, not assumed)

- **API accepts `inbound`.** `apps/api/src/handlers/integration-validation/config.ts` — `ConfigBody.inbound` (z.record, optional) is parsed and persisted (`inbound: row.inbound` on read; persisted on publish). ✅
- **SDK/CLI drop `inbound`.** `packages/workflows-sdk-python/pegasus_workflows/api.py::publish_integration_config` / `validate_integration_config` have **no `inbound` param**; the request body carries `mapping, rules, corpus, floor, displayName, externalShape, externalMapping` only. The CLI `cli/integration_config.py` `_Surface` dataclass + `_load_surface` read `mapping/rules/corpus/meta/external-*` — **no `inbound.json`**; `pull` never writes it. ❌
- **Floors are undiscoverable.** A floor's canonical field paths (legal mapping _targets_), its `factCatalog` (legal rule _facts_), input roots, default action, and projection are **code** in the API (`integration-validation/floors/*`, `registry.ts`). The only published schema is `GET /integrations/mapping-schema` (the mapping-DSL grammar) — nothing tells an agent that `shipment_lifecycle_event` exposes facts `brandPresent, brand, status, statusPresent, deliveryDatePresent` or canonical paths `Reference.Brand, Lifecycle.Status, …`. Without that, an agent's mapping targets / rule facts are guesses the gate rejects. ❌ (This is the deeper "self-serve" blocker.)

## Part A — Author + publish the `inbound` block (closes 0021 end-to-end)

**A1. SDK (`api.py`).** Add `inbound: Any | None = None` to `publish_integration_config` and `validate_integration_config`; include `"inbound"` in the JSON body only when not None (back-compatible). Docstring: the block shape `{eventType, dedupKeyPath?, validation?: {requiredPaths, nonEmptyArrayPaths}, ackTemplate?: {success, failure}}` and that `ackTemplate` supports whole-value `{{key}}` + the `$map` array directive.

**A2. CLI (`cli/integration_config.py`).** Add `INBOUND_FILE = "inbound.json"`; add `inbound: Any | None = None` to `_Surface`; `_load_surface` reads `inbound.json` if present (optional); `publish_command`/`validate_command` pass `surface.inbound`; `pull_command` writes `inbound.json` from the fetched config's `inbound` (the GET already returns it — `config.ts` `toFull` includes `inbound`, so `get_integration_config` round-trips it).

**A3. Tests.** SDK: `publish_integration_config(..., inbound={...})` puts `inbound` in the body; omitted → absent. CLI: `pull` writes `inbound.json`; `publish` from a dir with `inbound.json` sends it (round-trip).

**A4. Author the ADE `inbound` blocks.** Add `inbound.json` to `sirva_ade_shipment` / `sirva_ade_lead` / `sirva_ade_compensation` (push integrations) with the ADE `Result` success/failure `ackTemplate` (incl. the `$map` failure array) + `validation` (`requiredPaths: ["SvcProvDataRecipient"]`, `nonEmptyArrayPaths: ["Events"]`). (Folds into pegasus-workflows PR #6 or a follow-up.)

## Part B — Make floors + the authoring surface discoverable (the self-serve core)

**B1. API: floor-introspection (read, public — like `mapping-schema`).** Add (verify none exists):

- `GET /api/v1/integrations/floors` → `[{floor, displayName?}]` (from `listFloorIds()` + floor metadata).
- `GET /api/v1/integrations/floors/:floorId` → `{ floor, canonicalFields: string[] (paths from z.toJSONSchema of the structuralContract, arrays marked []), factCatalog: {name: type}, defaultAction, projection: {entityType} }` — the machine-readable contract an agent authors mapping _targets_ + rule _facts_ against.
- `GET /api/v1/integrations/inbound-schema` → JSON Schema for the `inbound` block (mirrors `mapping-schema`), so the ack/validation shape is discoverable + validatable.
- Rule-operator list: surface the closed operator set (incl. `nin`) either in the rules JSON schema or the inbound/authoring reference.

**B2. SDK methods.** `list_floors()` / `get_floor(floor_id)` wrapping B1, so an SDK/agent can introspect a floor's facts + canonical fields before authoring. Reads (idempotent) — classify in the testing harness `_READS`.

**B3. MCP resources** (`cli/mcp_server.py`) — the agent's self-serve context:

- `pegasus://reference/integration-config` (new, static): the full authoring guide — working-dir file layout (`mapping.json`, `rules.json`, `corpus.json`, `meta.json` `{floor, displayName}`, `inbound.json`, `external-*.json`); the floor/overlay model; how to pick a floor; the mapping DSL (`$from`/`$each`/`coerce`/`default`); the rule operators incl. **`nin`** and the "value-sets in config, not floor code" idiom; the `inbound` ack schema + `$map`; the publish flow + gating (platform tenant, `PublishIntegrationConfig`, `INTEGRATION_CONFIG_PUBLISH_ENABLED`); the `corpus.input.order` = native-payload convention.
- `pegasus://reference/floors` (new, **live-fetched** from B1): each floor's id + `canonicalFields` + `factCatalog`, so the agent authors against the real contract, not a guess. (Falls back gracefully if unauthenticated/offline.)
- The `api` reference already auto-surfaces `map_from_external` etc. — verify `list_floors`/`get_floor` appear once added.

**B4. MCP tools.** Extend the existing dry-run **validate-integration-config** MCP tool to accept + validate the `inbound` block against the `inbound-schema`, and to surface unknown-fact / unknown-target problems with the floor's catalog (so the agent gets actionable errors). Optionally an `author_integration_config` scaffolding tool that, given a floor id, emits a starter `meta.json` + skeleton `mapping.json` (canonical fields pre-listed) + empty `rules.json`/`corpus.json`.

## Part C — Docs

- **SDK README** `### Authoring an integration-validator config`: add `inbound.json` to the file list; a worked `inbound.json` (ADE `Result` + `$map` + `validation`); a "discover the floor first" step (`list_floors`/`get_floor` or the MCP `reference/floors`); note the `floor` in `meta.json` for a new id.
- **pegasus-workflows `CLAUDE.md`**: add `inbound.json` to the authoring file list + the ack/validation example (the floor/`meta.json`/`nin` docs already landed in PR #6).
- Version bump **SDK 0.21.0** + CHANGELOG.

## Sequencing

1. API: floor-introspection + inbound-schema endpoints (B1). Independent, unblocks everything.
2. SDK: `inbound` on publish/validate (A1) + `list_floors`/`get_floor` (B2); CLI `inbound.json` surface (A2); tests (A3); README (C). → 0.21.0.
3. MCP: resources + validate-tool extension (B3/B4).
4. Author ADE `inbound.json` (A4) + publish the ADE configs against the deployed floors → close the 0021/0024 live-validation checkboxes.

## Acceptance (self-serve proof)

An agent given **only** the SDK + MCP resources (no source) can:

1. `list_floors` → pick `shipment_lifecycle_event`; `get_floor` → read its `factCatalog` + `canonicalFields`.
2. Author `meta.json`(floor) + `mapping.json`(targets ⊂ canonicalFields) + `rules.json`(facts ⊂ catalog, `nin` for value sets) + `corpus.json`(`input.order`) + `inbound.json`(ADE `Result` ack + validation).
3. Dry-run **validate** (incl. inbound) → gate ok.
4. **publish** → the config takes effect; a POST to the ingress returns the ADE `Result{Results:"Success"|"Failed", …}` envelope.

Nothing above required reading `apps/api` source.

## Part D — OpenAPI spec of the internal API (agent-inspectable)

External AI agents should be able to inspect the API's **OpenAPI spec** in addition to the MCP/docs/CLI-help. The app is plain Hono + Zod (no `@hono/zod-openapi`), so:

- **D1. Serve an OpenAPI 3.1 doc** for the SDK-facing surface (the endpoints `PegasusClient` calls: `/integrations/*` validate/map-to/map-from/config/floors, `/workflows/*`, `/sms`, blobs, projections, ingress-management, …) at a stable public path, e.g. `GET /api/v1/openapi.json`. Reuse existing Zod schemas via `z.toJSONSchema` for request/response bodies where they exist (`ConfigBody`, `MapToExternalBody`, `MapFromExternalBody`, the floor/inbound schemas from B1) so the spec tracks code; hand-fill paths/verbs/auth. Keep it a **single generator module** so it's maintained in one place.
- **D2. MCP resource `pegasus://reference/openapi`** returning the spec (live-fetched), plus a short note in the authoring guide pointing agents at it.
- **D3. Docs**: SDK README + CLAUDE.md mention the OpenAPI endpoint + MCP resource as a discovery surface.

Scope note: cover the **SDK-relevant** surface first (what an external author needs), not every internal admin route. Mark it as such in the spec `info.description`.

## Part E — Standing principle (process, documented)

Document the durable rule (also in team memory): **whenever an integrations/workflows platform feature changes, update the SDK to expose it AND update the SDK MCP/docs/OpenAPI in turn**; prefer live introspection over static docs. Add to:

- Root `CLAUDE.md` (a short "SDK is the external product boundary — keep it + its MCP/docs/OpenAPI in lockstep with integration/workflow features" note), and
- The SDK README (a "Keeping the SDK in sync" maintainer note).

## Follow-up (separate phase, after A–E land) — full SDK discoverability review

A dedicated review of the **entire** SDK MCP/docs + backing functionality, verifying an external dev / AI agent can discover and use the **full** SDK without platform source:

- Enumerate every `PegasusClient` method + CLI command + capability/action, and confirm each is documented (README/CLAUDE.md), MCP-surfaced (`reference/api` + guides), and in the OpenAPI spec; flag any that exist in `apps/api` but aren't reachable/discoverable through the SDK.
- Confirm the MCP `reference/*` resources + CLI `--help` + OpenAPI together answer "how do I do X" for each feature (workflows, integrations, ingress, blobs, projections, secrets/config, SMS, schedules).
- Produce a punch-list; fold trivial doc fixes in, file the rest.

## Delivery

Implement Parts A–E in **one PR** in the pegasus repo (SDK + API + MCP + docs), SDK **0.21.0**. Author the ADE `inbound.json` blocks (A4) in the pegasus-workflows repo (fold into PR #6 or a small follow-up). Do NOT track this as an sdk-feedback spec (per direction). 0021's remaining checkbox (malformed → ADE `Failed`) closes once a real ADE config with an `inbound.json` is published.
