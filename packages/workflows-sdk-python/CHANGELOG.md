# Changelog

All notable changes to `pegasus-workflows-sdk` are documented here. The project
follows [Semantic Versioning](https://semver.org/).

## 0.33.0

### Added — declare an integration's required secrets/configs

The integration-config counterpart to 0.32.0's workflow feature. An integration
config can now declare the specific secret/config **keys** it reads at runtime —
e.g. the `SEND_API_KEY` + `SEND_URL` that `deliver_to_external` uses — via
`required_secrets` / `required_configs` on `validate_integration_config` /
`publish_integration_config` (each a list of `{key, group?, description?}`), or as
`requiredSecrets` / `requiredConfigs` in the config directory's `meta.json` (the CLI
`pull` round-trips them). Informational — the runtime read still resolves lazily —
but it surfaces a present/missing view on the integration's detail page and the
Settings → Developer → Configs summary.

- Resolved status for every integration is served at
  `GET /api/v1/integrations/requirements-summary` (presence only — never values).

## 0.32.0

### Added — declare a workflow's required secrets/configs

A workflow manifest can now declare the specific secret/config **keys** it reads
at runtime, via `required_secrets` / `required_configs` in `pegasus-workflows.toml`
(each a table with a required `key`, optional `group` defaulting to `"global"`,
and optional `description`). This is informational — the runtime read still
resolves lazily via `get_secret`/`get_config` — but it lets the tenant see up
front which values a workflow needs and whether they are set, surfaced as badges
on the workflow's detail page and a "keys still needed" summary in
Settings → Developer → Configs.

- New `Requirement` dataclass and `Manifest.required_secrets` / `required_configs`
  (validated in lockstep with the server's `RequirementSchema`).
- `Manifest.to_api_manifest()` emits `requiredSecrets` / `requiredConfigs`.
- Resolved present/missing state for all visible workflows is served at
  `GET /api/v1/workflows/requirements-summary` (presence only — never values).

## 0.31.0

### Added — feedback (magic-link surveys)

Solicit feedback from customers/drivers via a tokenized capability link, parse the
response, and route it into a workflow. A tenant authors a versioned form; a
workflow mints a per-recipient link and sends it; a submitted response emits the
built-in `feedback.submitted` domain event a workflow EVENT trigger fires on.

- **`PegasusClient.create_feedback_request(form_key, *, subject_type, subject_id,
ttl_hours=None, channel=None, to=None)`** — the mint primitive. Returns
  `{requestId, url, expiresAt}`; pass `channel="sms"` + `to` to also send the
  rendered link through the tenant's RingCentral connection (the response then
  carries a `delivery` sub-object; a send failure never loses the link). Gated by
  the new `CreateFeedbackRequest` action (granted to `workflow_runtime`).
- **`PegasusClient.get_feedback_request(request_id)`** — poll a request's status
  (`PENDING` → `SUBMITTED`, with the `response` payload).
- **Form authoring** — `validate_feedback_form` / `publish_feedback_form` /
  `get_feedback_form` / `list_feedback_forms` / `list_feedback_form_versions` /
  `rollback_feedback_form`, gated by the new `ManageFeedbackForms` action. Question
  types: `rating`, `number`, `text`, `select`, `boolean`.
- **New CLI group `pegasus-workflows feedback-form`** — `validate` / `publish` /
  `pull` / `versions` / `rollback`, mirroring `integration-config`. The editable
  surface is `form.json` (`{title, definition}`) + optional `message.txt`.

The whole surface is server-gated behind `FEEDBACK_ENABLED` (404 when off). Email
delivery is not in this release (SMS only).

## 0.30.0

### Added — re-sync a forked integration config (`fork_integration_config(force=True)`)

Completes the withdrawal/refresh story 0.29.0 started: a tenant overlay could be
_dropped_ (`delete_integration_config`) but never _rebased_ on a newer GLOBAL
(sdk-feedback 0030 part B).

- **`PegasusClient.fork_integration_config(integration_id, force=False)`** — the new
  `force` flag turns the one-shot fork into a re-sync. Without it, a tenant that
  already owns an overlay gets `409 CONFLICT`, so an overlay forked from an old
  GLOBAL could never pick up upstream fixes except by hand-republishing a copy that
  then tracks nothing. With it the overlay is re-seeded from the **current** GLOBAL
  as a **new version** — prior versions stay in
  `list_integration_config_versions` and remain reachable via
  `rollback_integration_config`, so a refresh you regret is reversible. (Contrast
  `delete_integration_config`, which hard-drops the whole lineage so the tenant
  re-inherits GLOBAL live.) The `409` now names `force=true` as the way forward.
- **`pegasus-workflows integration-config fork <id> [--force] [--yes]`** — fork had
  no CLI surface at all; it is now alongside `publish`/`pull`/`versions`/`rollback`/
  `delete`. A plain fork is additive and runs unprompted; `--force` confirms first
  (it demotes the tenant's current config), and `--yes` skips that for CI.
- The publish gate re-runs against the current floor either way, so neither a fork
  nor a refresh can resurrect a GLOBAL config the contract has outgrown (`422`), and
  the platform tenant still cannot fork its own GLOBAL (`400`).
- Platform: `POST /api/v1/integrations/{integrationId}/config/fork?force=true`, gated
  by `PublishIntegrationConfig` + `INTEGRATION_CONFIG_PUBLISH_ENABLED` (the same gate
  as publish) and documented in the OpenAPI spec, including the `409`. A forced
  refresh logs `refreshedFromVersion` so a re-sync is distinguishable from a seed.

## 0.29.0

### Added — delete a published integration config (`delete_integration_config`)

Closes the gap that a published integration config could never be withdrawn — only
superseded (sdk-feedback 0031, plus 0030's tenant-overlay half).

- **`PegasusClient.delete_integration_config(integration_id, force=False)`** and
  **`pegasus-workflows integration-config delete <id> [--force] [--yes]`** — ONE
  verb, scoped by _who_ calls it, removing only the config lineage the caller's own
  tenant owns:
  - **platform tenant → the GLOBAL config.** Retires a placeholder or renamed id
    (e.g. `demo_partner` after a rename to `weichert`) so it stops resolving, drops
    out of `list_integrations()`, and can no longer be forked — instead of living
    forever as an orphan next to the real id.
  - **any other tenant → its own TENANT overlay.** Afterwards
    `get_integration_config(id)` returns the platform GLOBAL again, so a tenant on a
    stale overlay can re-inherit upstream instead of hand-republishing a copy that
    never tracks GLOBAL.
- **Irreversible by design**: the ENTIRE version lineage is hard-deleted, so
  `list_integration_config_versions` comes back empty and `rollback` cannot undo it;
  a later publish starts again at `v1`. The CLI confirms before acting (`--yes`
  skips it for CI).
- **Dependency guard**: deleting a GLOBAL that other tenants still overlay is
  refused with `409 DEPENDENTS_EXIST` (reporting the count) unless `force=True` /
  `--force`, which acknowledges them but never touches their rows.
- An id that also has a **built-in** definition in platform code keeps resolving to
  that code baseline afterwards (still listed, `published: false`) — a built-in is
  code, not configuration. A config-only id disappears entirely: `get`,
  `map_from_external` and `fork` all return 404.
- Platform: `DELETE /api/v1/integrations/{integrationId}/config`, gated by
  `PublishIntegrationConfig` + `INTEGRATION_CONFIG_PUBLISH_ENABLED` (the same gate
  as publish) and documented in the OpenAPI spec. Dry-run captures the call as a
  `PublishIntegrationConfig` mutation instead of sending it.

## 0.28.0

### Added — pegII salesman reads (`get_salesman` / `list_salesmen`)

- **`PegasusClient.get_salesman(salesman_id)`** and **`list_salesmen(**params)`** —
read the legacy pegII (MoveManager) **salesman** (the sales user / employee tied
to an order) over the WireGuard tunnel, alongside the existing `get_order`/`get_task`pegII bridge.`get_salesman`re-fetches authoritative salesman detail
from the code carried on an order;`list_salesmen`accepts an`active` filter.
Both require the new **`ReadSalesman`** action in the workflow manifest
`required_actions`. Returns `{id, avlCode, firstName, lastName, name, title,
  email, extension, branch, agencyCode, roles, employeeType, active, startDate,
  dateTerminated}`. Single-salesman reads are LIVE (`GET
  /api/v1/pegii/salesmen/:id`); listing is reachability-probed but stub-backed
until pegII exposes a salesman collection endpoint, mirroring `list_orders`.

## 0.27.0

### Added — dry-run a published integration against a real order id (`shape="native"`, `dry_run_integration`)

- **`get_order(order_id, shape="native")`** now returns an order's RAW serialized
  pegII payload (`{Id, Survey, InvolvedParties, KeyMoveDates, …}`) — the same shape
  a partner posts to the ingress — instead of the projected row. Feed it to
  `map_from_external` to validate a published mapping against a real order id with
  no hand-pasting. Omitting `shape` is unchanged (projected row).
- **`dry_run_integration(integration_id, order_id)`** — one call that fetches the
  native payload and normalizes it through a published integration's inbound
  mapping, returning `{canonical, valid, issues, degraded}`. Requires `ReadOrder`;
  the map step needs no manifest action.
- Platform: `GET /api/v1/pegii/orders/{id}?shape=native` exposes the raw payload
  (same `ReadOrder` gate); documented in the OpenAPI spec.

### Fixed — pegII order projection returned an `"undefined"` stub as a 200

- `get_order` (default projected shape) previously returned
  `{id:"undefined", orderNumber:"SO-undefined", customerName:null, …}` as a **200**
  for fully-populated orders — the bridge mapper read guessed native keys
  (`SaleId`, `OrderNumber`, …) that don't exist on the wire. It now reads the real
  keys (`Id`, `Survey.SerivceStatus`, `Survey.ShipperName`,
  `InvolvedParties.ShipperEmployer.Identity.Description`, `KeyMoveDates.*`) and a
  payload with no resolvable `Id` yields an honest **404**, never an `"undefined"`
  stub (sdk-feedback 0029).

## 0.26.0

### Added — floors advertise their legal mapping _source_ roots (`inputFieldRoots`)

- **`get_floor` / `list_floors` now surface `inputFieldRoots`** — the legal mapping
  source roots a `$from` may READ, present when the floor declares them. A bare
  entry (`"Survey"`) opens a whole native root; a **dotted** entry
  (`"UnusedFields.survey_received"`) opens ONLY that curated sub-path, leaving
  un-listed siblings under the same root closed. Authors can now discover which
  specific native fields are mappable instead of hitting the publish gate blind
  (`reads undeclared input field "…"`).
- Platform: the `shipment_status_update` floor opens the vetted survey-date fields
  `UnusedFields.survey_received` / `UnusedFields.survey_confirm` out of Pegii's
  `UnusedFields` junk-drawer, so an overlay can map `surveyDate` straight from
  them — no pre-map enrichment lift into `Survey.SurveyReceived`. The rest of
  `UnusedFields` stays closed. (sdk-feedback 0028)

## 0.25.0

### Added — generic read passthrough (`api_get`)

- **`PegasusClient.api_get(path, **params)`** — a read-only escape hatch that GETs
any Pegasus API path with the caller's key and returns the full JSON body (so
`meta`/`nextCursor`survive). Reaches endpoints without a dedicated helper —
notably the **projection read-model**`GET /integrations/{id}/projections/{entityType}`
(`status`/`updatedSince`/ keyset`cursor`), which `get_projection`/`list_projections` (the runtime cache) don't cover. GET-only and Pegasus-host-only
  by design (an absolute URL raises); for writes use the typed methods, which route
  through the dry-run capture path a generic call would bypass. Not stubbed by the
  offline test harness — use a typed read helper there.

### Changed — OpenAPI now documents the full `vnd_` read surface

- The served spec (`GET /openapi.json`, `pegasus://reference/openapi`) is widened
  from the authoring surface to **every `vnd_`-reachable GET route** (workflows /
  executions / triggers, pegII orders+tasks, secrets/config reads, the projection
  cache + 0026 read-model, events, blobs, integration reads), so `api_get`'s
  catalog is discoverable. A **route-coverage test** now fails CI if a new m2m GET
  route is added without a spec entry (or an explicit allowlist), keeping the spec
  from drifting.

## 0.24.0

### Added — SDK completeness (discoverability punch-list P2)

New `PegasusClient` methods for platform capabilities that existed server-side but
had no SDK accessor (all on already-granted persona actions — no policy change):

- **`cancel_execution(workflow_id, execution_id)`** / **`retry_execution(...)`** —
  drive an execution from the SDK (previously tenant-web only). `CancelWorkflowExecution` / `RetryWorkflowExecution` (workflow_developer).
- **`fork_integration_config(integration_id)`** — fork the platform GLOBAL config
  into the tenant scope (the config analog of `fork_workflow`). `PublishIntegrationConfig`.
- **`list_integrations()`** — list the tenant's configured integration ids +
  active-config summary. Backed by a new m2m route `GET /api/v1/integrations/configs`
  (the vnd\_-reachable sibling of the Cognito-only `GET /integrations`). `ReadIntegrationConfig`.
- **`get_mapping_schema()`** / **`get_inbound_schema()`** — fetch the published
  JSON Schemas for live introspection (validate a mapping / inbound block before publishing).

### Docs (P3)

- README: `schedule` + `ingress` CLI commands; a worked `emit_event` (custom-event
  chaining) example; pegII orders/tasks reads; SDK `cancel`/`retry` on executions.
- Fleshed out thin docstrings (`list_workflows`, `get_workflow`, `list_triggers`,
  `delete_trigger`, `download_artifact`) so they render fully in MCP
  `pegasus://reference/api`.
- OpenAPI gains the new SDK-relevant paths (executions cancel/retry, config fork,
  `/integrations/configs`).

## 0.23.0

### Fixed — the operational-entity read helpers now actually work under a `vnd_` key

The `list_customers` / `list_quotes` / `list_moves` / `list_invoices` helpers hit
the browser `/api/v1/*` CRUD routes, which are Cognito-only and **reject the
`vnd_` workflow-runtime key** (`from_runtime`) every SDK caller uses — so they
401'd in practice. They now read a new m2m surface **`GET /api/v1/runtime/*`**
(RBAC: `ReadCustomer` / `ReadQuote` / `ReadMove` / `ReadInvoice`, already granted
to the `workflow_runtime` persona — no policy change). Response shape is unchanged
(`{data, meta}`).

### Changed

- **`list_events(event_type)`** now takes a required event type and reads
  `GET /api/v1/events/{event_type}` (the inbound platform-event queue is keyed by
  type). The old no-arg call hit a route that did not exist.

### Removed

- **`list_inventory`** — inventory has no runtime read grant (the `workflow_runtime`
  persona deliberately omits it) and is nested under moves, so the method never
  worked. A workflow reads item-level data from the move it is processing. (No real
  caller breaks — the method 401/404'd before.)

### Added — multi-shape push partners

- **`validation.oneOf`** on the ingress `inbound` block. A partner that POSTs
  structurally different bodies to a single ingress id (e.g. ADE Abstract
  `{…, AgentNbr, StatementEntry[]}` vs Statement `{AgentStatementHdr:{AgentNbr},
PostingTickets[]}`) can now be validated: list each accepted shape under
  `validation.oneOf` and the body must fully satisfy at least one (in addition to
  any top-level `requiredPaths`/`nonEmptyArrayPaths`); a body matching none gets
  the `failure` ack. Closes the last authoring gap for ADE agent-compensation.
- **Array `dedupKeyPath`.** `dedupKeyPath` now accepts a list of dot-paths (each
  tried in order, first present wins), so each `oneOf` variant can dedup on its
  own id path.

These are platform + doc changes; the `inbound=` param is unchanged (free-form),
so no SDK signature change. Documented in the README `inbound` section, the MCP
`pegasus://reference/integration-config` guide, and the served
`GET /api/v1/integrations/inbound-schema`.

## 0.21.0

### Added — self-serve config authoring (no platform source needed)

- **Publish the ingress `inbound` block.** `publish_integration_config` /
  `validate_integration_config` gain an `inbound=` param, and the CLI
  `integration-config` reads/writes an **`inbound.json`** in the working directory
  (round-tripped by `pull`). This is the missing authoring path for the ADE
  `Result` ack + body validation (sdk-feedback 0021): the API accepted `inbound`,
  but nothing could publish it. Now `pull → edit → validate → publish` carries it.
- **Floor introspection.** `PegasusClient.list_floors()` / `get_floor(floor_id)`
  return a floor's machine-readable contract — `canonicalFields` (the only legal
  mapping _targets_) + `factCatalog` (the only legal rule _facts_) + `defaultAction`
  - `projection`. Author `mapping.json`/`rules.json` against these so the gate
    accepts them. Backed by public `GET /api/v1/integrations/floors[/{id}]`.
- **Discovery schemas.** `GET /api/v1/integrations/inbound-schema` (the publishable
  `inbound` block's JSON Schema) joins the existing `mapping-schema`.
- **MCP resources** for AI coding agents: `pegasus://reference/integration-config`
  (the full authoring guide — files, floors, `nin`, the `inbound` block, the publish
  gate), `pegasus://reference/floors` (live floor list), and
  `pegasus://reference/openapi` (the API's live OpenAPI 3.1 spec). The
  `validate_integration_config` MCP tool now accepts `floor` + `inbound`.
- **OpenAPI**: the served spec (`GET /openapi.json`, Swagger UI at `/docs`) now
  covers the integration-authoring surface (validate / map-to / map-from / config /
  floors / schemas) with the `vnd_` Bearer security scheme.

## 0.20.0

### Added

- **Runtime inbound mapping — `PegasusClient.map_from_external(integration_id, payload)`**
  (sdk-feedback/0024). The inbound mirror of `map_to_external`: runs a published
  integration's mapping _native → canonical_ and returns the normalized
  **canonical entity** plus the gate verdict — `{canonical, valid, issues, degraded}`.
  An ingest workflow (the consumer of an 0021 inbound event) uses `canonical` as
  the entity to persist and `valid` to fail closed. **Fails closed** (`404`) on an
  unknown integration / no floor, so an ingest never proceeds on an empty entity.
  Open API-key surface — no manifest action. Auto-surfaces in
  `pegasus://reference/api`.
- **Generic, reusable inbound-ingest floors** (sdk-feedback/0024) — four
  partner-neutral type floors any partner can build on via a published config
  overlay (the mapping + rules live in **configuration**, not code):
  `shipment_lifecycle_event`, `sales_lead`, `financial_settlement`,
  `document_record`. Sirva ADE is the first partner to use them (its
  `sirva_ade_*` configs reference these floors).
- **`nin` (not-in) rule operator** — the symmetric complement of `in`, so a
  config can express _"a field must be one of an allowed set"_ (the forbidden
  condition is "outside the set", e.g. `{brandPresent eq true} AND {brand nin [AVL,NVL]}`)
  without baking the value set into floor code. This is what keeps the floors
  partner-neutral: value vocabularies (brand codes, statuses, file types) live in
  the published rules, not the API.

### Changed

- **Inbound ingress ack now supports the full partner envelope** (sdk-feedback/0021):
  - The `inbound` block gains an optional **`validation`** sub-block
    (`{requiredPaths, nonEmptyArrayPaths}`): a malformed/rejected body now returns
    the partner's **failure** ack (e.g. ADE `Result{Results:"Failed", …}`) instead
    of a generic accepted ack.
  - The `ackTemplate` renderer gains a **`$map`** array directive
    (`{ "$map": "issues", "as": {…} }`) so the failure ack can shape a per-message
    array like ADE's `ResultsMessage: [{ResultsMessageCode, ResultsMessageDescription}]`
    from the structured validation issues. The success envelope
    (`Result{Results:"Success", ResultsMessageCount:0, ResultsMessage:[]}`) was
    already expressible via whole-value substitution.

## 0.19.0

### Added

- **Inbound integration ingress** (sdk-feedback/0021) — a platform-hosted endpoint
  a third party (e.g. Sirva ADE) POSTs events to, so push-only partner APIs are
  authorable without an off-platform daemon:
  - **`pegasus-workflows ingress create|rotate|list <integration>`** provisions the
    per-integration bearer (`PegasusClient.create_ingress` / `rotate_ingress` /
    `get_ingress`, gated by a new `ManageIngress` action). `create`/`rotate` print
    the URL + a **one-time token** to register partner-side.
  - The endpoint authenticates the bearer (resolving the tenant), **dedups** on an
    id derived from the payload, persists the raw body, **emits a domain event**
    (an ordinary EVENT trigger fires the bound workflow), and returns a
    **synchronous, partner-shaped ack** derived from ingestion — never waiting on
    the workflow.
  - The ack shape, dedup path, and emitted event type are **published as part of
    the integration definition** (a new `inbound` block on the integration config:
    `{ eventType, dedupKeyPath, ackTemplate: {success, failure} }`), so a tenant
    defines its partner's ADE `Result{…}` envelope itself. A definition with no
    `inbound` block falls back to a generic `{status:"accepted"}` ack.

## 0.18.0

### Added

- **Workflow blob transfer** (sdk-feedback/0025) — a workflow can stage binary
  files to upload and land binary files it fetches, without holding the bytes in
  workflow memory:
  - `PegasusClient.put_blob(bytes, content_type)` → `{blobId, size}` and
    `get_blob(blob_id)` → `bytes` / `get_blob_url(blob_id)`. Bytes stream
    **runner↔S3 directly via presigned URLs**, so they are not bounded by the API
    Lambda payload limit (up to the platform blob cap; over-cap → 413). Requires
    `WriteBlob` (put) / `ReadBlob` (get) — new Cedar actions granted to
    `workflow_runtime`. `put_blob` is a mutation (captured under `--dry-run`);
    `get_blob`/`get_blob_url` are reads (live).
  - `call_external(..., response_to_blob=True)` lands the partner response into a
    blob (returns `{blobId, ...}`), and a request `body` may reference a staged
    blob as `FileData: {"$blob": blob_id}`, resolved to the blob's bytes
    server-side. **Small-file cut** — these two paths still round-trip the bytes
    through the API Lambda (≤ ~5 MB); true 200 MB/2 GB streaming is a follow-up.
  - Blobs are tenant-scoped (a tenant can only address its own) and expire via an
    S3 lifecycle TTL.

## 0.17.0

### Added

- **`pegasus-workflows schedule` — attach cron schedules to a workflow**
  (sdk-feedback/0023). A terminal wrapper over the workflow-trigger API for the
  on-platform replacement of an external cron calling `pegasus-workflows run`:
  - `schedule create <workflow> --cron "*/5 * * * *"` / `schedule list <workflow>`
    / `schedule delete <workflow> <trigger-id>`.
  - New `PegasusClient.create_trigger` / `list_triggers` / `delete_trigger`
    (management surface, needs the `workflow_developer`/`tenant_admin`
    `ManageWorkflowTriggers` action — not a `workflow_runtime` key).
- **Documented fourth `run()` input shape — the scheduled tick** (input-contract
  guide, Shape 4): a SCHEDULE firing passes
  `arg["input"] = {"scheduledAt": "<ISO>", "schedule": "<cron>", "triggerId": …}`,
  detected by the `scheduledAt` key and distinct from event/manual/CLI-test runs.

### Note

- The platform dispatcher (already cron-aware) now emits the `scheduledAt`
  envelope (was `scheduledFor`) and applies an **overlap policy** — a scheduled
  tick is skipped while a prior run of the same trigger is still in-flight, so a
  slow run never piles up concurrent duplicates.

## 0.16.0

### Added

- **`PegasusClient.call_external` — a generic authenticated outbound HTTP caller**
  (sdk-feedback/0022). The read/arbitrary-method counterpart to
  `deliver_to_external`'s single fixed JSON `POST`: name a `method` + `path` (+
  `query`/`body`) and the platform performs the call **server-side** against the
  integration's configured `BASE_URL`, authenticating per its `AUTH_MODE`.
  - `AUTH_MODE=oauth2_client_credentials` mints, caches, and **re-mints on a
    partner `401`** an OAuth2 client-credentials token server-side (the RingCentral
    token-cache pattern, generalized), parsing an **XML `<Access>`** or JSON token
    body — so `client_id`/`client_secret` never appear in workflow code.
    `AUTH_MODE=bearer` uses a static `API_KEY` secret; `none` sends no auth.
  - Config + credentials are read from the tenant's workflow config/secret store
    by name + `group` (`BASE_URL`/`AUTH_MODE`/`TOKEN_URL` configs;
    `CLIENT_ID`/`CLIENT_SECRET` or `API_KEY` secrets).
  - **Dry-run split (sdk-feedback/0015):** a `GET` is a read and runs **live** under
    `run --dry-run`; a `POST`/`PUT`/… is a mutation and is **captured, not
    performed**. A `mutating` flag overrides the method-based default. The offline
    `fake_client` serves a `GET` from a path-keyed `reads={"call_external": …}`
    fixture and captures a mutation via the shared dry-run path.
  - Requires `required_actions = ["CallExternal"]` (a new Cedar action granted to
    the `workflow_runtime` persona). Returns `{status, ok, response, headers,
dryRun}`; auto-documented in the `pegasus://reference/api` MCP resource.

## 0.15.0

### Added

- **Integration overlays carry a floor + displayName + external shape**
  (sdk-feedback/0019 + 0020). The platform split an integration "floor" into a
  reusable per-_type_ fact abstraction and a per-_partner_ overlay that owns the
  external output shape. The `integration-config` surface now round-trips the new
  overlay fields:
  - `PegasusClient.validate_integration_config` / `publish_integration_config`
    accept optional `floor`, `display_name`, `external_shape`, `external_mapping`
    and send them (camelCase) only when provided — a plain publish is
    byte-identical.
  - The CLI reads an optional `meta.json` (`{floor, displayName}`),
    `external-shape.json` and `external-mapping.json` alongside
    `mapping.json`/`rules.json`/`corpus.json`, and `pull` now **writes** them, so a
    `pull → edit → publish` cycle no longer silently strips the floor/displayName/
    external shape. A NEW partner on an existing type is now authorable from a
    working directory alone: set `floor` in `meta.json` and `publish` a new id.
  - `map_to_external(id, data)` is unchanged — the server resolves `id → floor`.

## 0.14.0

### Fixed

- **Offline capture records now match the server-side dry-run shape**
  (sdk-feedback/0016). `pegasus_workflows.testing.fake_client` recorded a
  mutation's arguments as a positional `args` tuple plus a separate `kwargs`
  dict, with a snake_case `would_return` key — while the server-side dry-run
  client (the shape the web-UI trace renders) records a curated named `args`
  dict and a camelCase `wouldReturn`, with no `kwargs`. An offline
  `client.captured` assertion therefore did not describe a real dry-run trace.
  The fake now delegates each mutation to a real dry-run `PegasusClient`, so both
  emit the **identical** record `{method, capability, args: <named dict>,
wouldReturn}` by construction — a single helper reading `record["args"]["body"]`
  works against either. **Breaking for tests** that asserted the old offline
  shape: replace `entry["kwargs"]`/`entry["would_return"]` with
  `entry["args"]`/`entry["wouldReturn"]` (args is now a named dict). A parity
  test now guards the two shapes against future drift.

## 0.13.0

### Added

- **Dry-run execution** (spec 0015, Part A). `pegasus-workflows run <name>
--dry-run` (and `PegasusClient.run_workflow(id, input, dry_run=True)`) starts a
  benign rehearsal: the real workflow runs on the tenant runner with reads live
  but every mutation **captured, never performed**. The runtime enables this by
  setting `PEGASUS_DRY_RUN`, which `PegasusClient.from_runtime()` reads to return
  a dry-run client: `client.is_dry_run` is `True`, mutating methods append a
  capture record and return a synthetic success, and `client.record_side_effect`
  logs effects the SDK can't infer. Only tenant-runner workflows support it — a
  curated workflow returns 422 `DRY_RUN_UNSUPPORTED`. Author code needs no
  changes: the same activity body runs; the injected client makes it benign.

## 0.12.0

### Added

- **`PegasusClient.deliver_to_external(integration_id, body, …)`** (spec 0015,
  Part B). The mutating counterpart to `map_to_external`: build the partner body
  with `map_to_external`, then deliver it here instead of a raw `httpx.post`. The
  platform performs the outbound POST **server-side**, using the workflow's own
  delivery URL (config `SEND_URL`) and API key (secret `SEND_API_KEY`) — so the
  send flows through the one boundary a dry run controls (captured, not
  performed) rather than a raw call the runtime can't see. `integration_id` is
  validated against the registry (404 if unknown) and recorded; the
  URL/key/headers config keys and group are overridable. Requires the manifest to
  declare `required_actions = ["DeliverToExternal"]` (a new Cedar action granted
  to `workflow_runtime`). Returns `{delivered, status, response, dryRun}`.
  Auto-surfaces in the `pegasus://reference/api` MCP resource, and the offline
  test harness captures it with capability `DeliverToExternal`.

## 0.11.0

### Added

- **`pegasus_workflows.testing` — an offline activity harness** (spec 0015,
  Part C). `fake_client(reads={...})` returns a `PegasusClient`-shaped double that
  serves reads from canned fixtures and **captures** mutations (`send_sms`,
  `emit_event`, `close_task`, `put_projection`/`delete_projection`, …) to
  `client.captured` instead of performing them — each entry carries its Cedar
  `capability`, so a test asserts _what would have been sent_ without sending it.
  `run_activity(activity_fn, *args, client=...)` runs an activity's **real** body
  inside Temporal's own `temporalio.testing.ActivityEnvironment` (no Docker, no
  network), injecting the fake by patching `PegasusClient.from_runtime` for the
  call — so activity code that does `PegasusClient.from_runtime()` runs its real
  logic against the fake and the `if client is None: return {"stub": True}` stub
  branch is retired from shipped source. The fake exposes the same `is_dry_run` /
  `record_side_effect` surface as the forthcoming server-side `--dry-run` mode, so
  author code behaves identically offline and server-side. A drift guard asserts
  every `PegasusClient` runtime method is classified read-vs-mutation, so a new
  SDK method can't slip through unclassified.

## 0.8.1

### Fixed

- **The MCP server now ships in the base package** (spec 0012). `mcp` was an
  optional `[mcp]` extra, so a clean `pip install pegasus-workflows-sdk` produced
  an SDK whose `pegasus-workflows mcp` server could not start — which broke the
  0.8.0 onboarding promise: `pegasus-workflows setup` registers a `pegasus` MCP
  server in `.mcp.json`, but on a fresh install that server dead-ended at launch
  with an `ImportError`. `mcp>=1,<2` is now a base dependency, so a plain install
  yields a working server. The `[mcp]` extra is kept as a **no-op alias** so
  existing `pip install 'pegasus-workflows-sdk[mcp]'` commands still resolve. Docs
  (README) updated to match; the `mcp` command's missing-dependency message now
  points at a base reinstall rather than the extra.

## 0.8.0

### Added

- **`pegasus-workflows setup` — one guided first-run bootstrap** (spec 0010). Seeds
  a `~/.pegasus/credentials` profile at `0600` (delegating to `configure`) and
  registers the bundled MCP server by writing a `pegasus` entry into the agent
  host's `.mcp.json` (Claude Code project config). Never clobbers an existing
  `pegasus` entry without `--force`; `--print-mcp-config` emits the stanza to
  stdout for other hosts/CI; `--skip-mcp` seeds only the profile. Performs no
  network calls and writes the `api_key` only to the `0600` credentials file —
  never into `.mcp.json`. Fully scriptable (zero prompts) when inputs are passed
  as flags. The obvious `--setup` / `--configure` guesses now point at it, and
  the onboarding flow is documented in the README.
- **Order + task reads on `PegasusClient`** (spec 0009). New activity-side methods
  `get_order` / `list_orders` (gated `ReadOrder`), `list_tasks` / `get_task`
  (gated `ReadTask`), and an idempotent `close_task(*, order_id, task_type,
reason=None)` (gated `CloseTask`) for lifecycle workflows that advance or close
  out an order's operational tasks. All auto-surface in the
  `pegasus://reference/api` MCP resource.

### Changed

- **MCP authoring guidance synced to 0.6.0 behavior** (spec 0011). The
  `pegasus://guide/authoring` Activities example (and the secrets-config runtime
  example) now build the client with `PegasusClient.from_runtime()` instead of a
  hardcoded `base_url`/`token`, and reference the `PEGASUS_API_BASE_URL` /
  `PEGASUS_RUNTIME_TOKEN` runtime contract. `pegasus://reference/manifest` now
  documents the `workflow.mmd` packaging requirement, and the MCP
  `package_project` tool's missing-diagram error names the in-MCP remedy (the
  `diagram_prompt` tool) so a non-Claude agent isn't dead-ended at a shell command.

> **Platform note (spec 0009):** the SDK's order/task methods target a namespaced
> `/api/v1/pegii/*` legacy-bridge surface (like the retired `/onprem/longhaul/*`
> handlers) — `get_order`/`list_orders` → `/api/v1/pegii/orders`,
> `list_tasks`/`get_task`/`close_task` → `/api/v1/pegii/tasks`. That surface + the
> `ReadOrder`/`ReadTask`/`CloseTask` Cedar actions ship in `apps/api` backed by
> in-memory **stubs** (`services/pegii-orders.ts` + `services/pegii-tasks.ts`) that
> bridge to the pegII API later — the same cutover pattern the retired longhaul
> surface used. `close_task` is idempotent today against the stub. This is distinct
> from the untouched M2M `/api/v1/orders` reporting view of cloud moves.

## 0.7.0

### Added

- **MCP `diagram_prompt` tool + authoring-guide coverage.** The `pegasus-workflows
mcp` server now exposes a read-only `diagram_prompt(project_dir, workflow=None)`
  tool — the MCP-native equivalent of the CLI command — returning each workflow's
  source plus its `workflow.mmd` output path and Mermaid rules so an AI coding
  agent draws the diagram itself. The `pegasus://guide/authoring` resource now
  documents that a `workflow.mmd` is required to publish and that the agent (not
  any AI service) draws it. No new mutating/network tools; the no-write invariant
  holds.

### Changed

- **`pegasus-workflows diagram` is now bring-your-own-agent.** The command no
  longer calls the Anthropic API. Instead it prints a ready-to-use prompt — the
  workflow's Python source plus the exact `<source_dir>/workflow.mmd` output path
  and formatting rules — for **whatever coding agent the developer already uses**
  (Claude Code, Cursor, Copilot, …) to act on, on their own subscription. No
  `ANTHROPIC_API_KEY`, no provider lock-in. `--out/-o FILE` writes the prompt to a
  file; `--workflow/-w` scopes to one workflow. What's required to publish is
  unchanged: the `workflow.mmd` file must exist — its contents may be hand-written
  or produced by any tool.

### Removed

- **The `[diagram]` extra** (the bundled `anthropic` dependency) and the
  `--model` / `--force` flags and `$PEGASUS_DIAGRAM_MODEL` env var — the command
  no longer generates or writes the diagram itself, so none apply. Anyone who
  installed `pegasus-workflows-sdk[diagram]` should drop the extra; the command
  works with no extras.

## 0.6.0

### Added

- **`PegasusClient.from_runtime()`.** A classmethod that builds a client from the
  env vars the tenant runner injects (`PEGASUS_API_BASE_URL` /
  `PEGASUS_RUNTIME_TOKEN`) and raises a clear, named error when run outside the
  runner. Prefer it over hardcoding `os.environ[...]` in activities — a future
  rename of the runtime contract becomes a one-line SDK fix. (Fixes the README's
  prior SMS/activity example, which named non-existent runtime vars and failed
  100% of the time at first execution.)
- **Named credential profiles.** Store `vnd_` tokens + API roots in
  `~/.pegasus/credentials` (AWS-CLI style) instead of pasting them on the command
  line. `pegasus-workflows configure [--profile NAME]` writes the file `0600`;
  `pegasus-workflows profile list` shows names + api_root only (never a key).
  Every API command accepts `--profile NAME`. Resolution precedence: explicit
  `--token`/`--base-url` > `--profile` > `PEGASUS_WORKFLOW_TOKEN` /
  `PEGASUS_BASE_URL` env vars > the `[default]` profile. A profile's `api_root`
  defaults to `https://api.pegasus.dolas.dev`.
- **Post-publish deployment ledger.** `push` now records each published workflow
  in a `deployments.toml` beside the manifest — `(env, workflow) → {workflow_id,
version, visibility, base_url, published_at}` — so environment-specific ids are
  a deterministic file read, not a scrollback scrape. The env key derives from the
  API host or `push --env NAME`; re-publishing upserts in place; multi-workflow
  projects nest by name. The file holds ids/URLs only (safe to commit).
- **Two read-only MCP tools.** `list_deployments(project_dir)` reads the ledger;
  `list_profiles()` lists profile names + api_root (never `api_key`). Both are
  network-free; the no-mutation MCP invariant still holds.

### Changed

- API commands (`push`, `run`, `integration-config`, `executions`, `secrets`,
  `config`) now resolve credentials through the shared profile-aware path. Behavior
  is unchanged when no profile is used (explicit flags / `PEGASUS_WORKFLOW_TOKEN`
  still work); `--base-url` now also reads `PEGASUS_BASE_URL`.
- README activity examples (SMS, secrets/config, projections) use
  `PegasusClient.from_runtime()`.

## 0.5.0

### Added

- **Integration projections (cached external state).** New runtime
  `PegasusClient` methods let a workflow maintain a per-record cache of an
  external system's last-known state: `get_projection(integration, entity_type,
key)` (returns `None` on miss), `put_projection(...)` (idempotent upsert,
  bumps `version`), `list_projections(integration, entity_type)`, and
  `delete_projection(...)`. State is the integration's native payload shape and
  is capped at 256 KB serialized. Declare `required_actions =
["ReadIntegrationProjection", "WriteIntegrationProjection"]` in the manifest.
  The Pegasus integration validator reads the matching record's cached `state`
  back as the `prior` input when pre-validating an update, so a workflow that
  syncs the external system keeps transition-rule validation accurate without
  the caller resupplying prior state.

## 0.4.0

### Added

- **Workflow diagrams (`pegasus-workflows diagram`).** AI-generates a Mermaid
  flowchart from a workflow's Python source via the Anthropic API and writes it
  to `<source_dir>/workflow.mmd` (author-editable). Needs the new `[diagram]`
  extra and `ANTHROPIC_API_KEY`. Defaults to `claude-opus-4-8`; override with
  `--model` or `$PEGASUS_DIAGRAM_MODEL`. Business users view the diagram in the
  Pegasus tenant UI to confirm a workflow matches their business rules.
- **Execution inspection CLI.** `pegasus-workflows executions list <wf-id>` and
  `executions show <wf-id> <exec-id>` (input/result/error + the Temporal
  event-history timeline). New `PegasusClient.get_execution_history` backs the
  timeline; `list_executions` / `get_execution` already existed.

### Changed

- **A workflow diagram is now required to publish.** `package` / `push` fail
  fast if `<source_dir>/workflow.mmd` is missing, and `Manifest.to_api_manifest`
  takes the diagram contents (the server's `ManifestSchema` now requires
  `diagram`). `init` scaffolds a starter `workflow.mmd`.

### Notes

- **Keep PII out of execution payloads.** Temporal stores and renders inputs,
  results, and history; pass entity ids, not personal data. (Documented in the
  README; a payload codec is deferred.)

## 0.3.0

### Added

- **Workflow secrets & configuration.** New `PegasusClient` methods for the
  per-tenant key/value store:
  - Runtime use (inside an activity): `get_secret(name)`, `get_config(name)` —
    require `ReadWorkflowSecret` / `ReadWorkflowConfig` in the manifest
    `required_actions`.
  - Management/publish: `set_secret` / `delete_secret` / `list_secrets` and
    `set_config` / `delete_config` / `list_configs` — require
    `ManageWorkflowSecrets` / `ManageWorkflowConfigs`. Secrets are write-once
    (delete then set to rotate); `set_config` is an idempotent upsert. Secret
    values are never returned by `list_secrets`.
- **CLI:** `pegasus-workflows secrets set|list|delete` and
  `pegasus-workflows config set|list|delete` for publishing values from the
  command line.
- **MCP server:** new `pegasus://guide/secrets-config` resource documenting how
  to publish and use secrets/config; the auto-generated `pegasus://reference/api`
  resource now includes the new client methods.

## 0.2.0

- `pegasus-workflows mcp` stdio MCP server (`[mcp]` extra).
- Outbound SMS: `PegasusClient.send_sms`.

## 0.1.0

- Initial release: authoring, packaging, and publishing of Pegasus workflows;
  domain reads; custom-event emit; integration-validator config authoring.
