# Pegasus Workflows SDK

`pegasus-workflows-sdk` is the Python SDK and CLI for authoring, packaging, and
publishing **Pegasus workflows** — Temporal workflows that automate
cross-domain operations (move lifecycle, billing follow-ups, dispatch
decisions) against the Pegasus public API.

Phase 1 ships the **developer flow**: write a workflow locally, run it against a
Dockerized Temporal, package it, and upload it. There is no server-side
execution yet — the API stores the artifact and lists it.

## Install

```
pip install pegasus-workflows-sdk
```

This installs the `pegasus-workflows` CLI. **Python 3.11+** is required. Pin the
version in your project's requirements for reproducible builds, e.g.
`pegasus-workflows-sdk==0.1.0`.

### Interim / unreleased install (git)

The repository is public, so you can install straight from a tagged commit
without waiting for a PyPI release — useful for an unreleased fix, or before the
first PyPI publish lands:

```
pip install "pegasus-workflows-sdk @ git+https://github.com/DolasDev/pegasus@sdk-python-v0.1.0#subdirectory=packages/workflows-sdk-python"
```

Swap the `@sdk-python-v0.1.0` tag for `@main` to track the latest unreleased
SDK. This clones the whole monorepo to build one subdirectory, so prefer the
PyPI install for everyday use.

## First-run setup

One command does the whole first-run bootstrap — seed a credential profile and
wire the authoring MCP server into your agent host:

```
pip install pegasus-workflows-sdk   # the MCP server ships in the base package
pegasus-workflows setup             # seeds ~/.pegasus/credentials (0600) + writes .mcp.json
```

`setup` is the front door the obvious `--setup` / `--configure` guesses point
at. It:

- seeds/updates a `~/.pegasus/credentials` profile at `0600` (delegates to
  `configure`; pick the profile with `--profile NAME`),
- writes the `pegasus` MCP-server stanza into `./.mcp.json` (Claude Code project
  config), never clobbering an existing `pegasus` entry without `--force`, and
- performs **no network calls** and writes the `api_key` **only** to the `0600`
  credentials file — never into `.mcp.json`.

Scriptable (zero prompts) when you pass everything as flags:

```
pegasus-workflows setup --profile qa --api-key vnd_... --api-root https://api.pegasus-qa.dolas.dev
pegasus-workflows setup --print-mcp-config      # emit the stanza to stdout, write nothing
pegasus-workflows setup --skip-mcp              # only seed the credential profile
```

Then start authoring (see [Quick start](#quick-start)). For other agent hosts or
manual wiring, see [Using the SDK with an AI coding agent](#using-the-sdk-with-an-ai-coding-agent).

## Quick start

```
pegasus-workflows init demo
cd demo
pegasus-workflows test demo
pegasus-workflows diagram                # prints a prompt — your coding agent draws workflow.mmd
pegasus-workflows package
pegasus-workflows push --profile default
```

> A workflow **diagram** (`<source_dir>/workflow.mmd`) is required to publish. `init`
> ships a starter one; `pegasus-workflows diagram` prints a prompt you feed to your
> own coding agent (Claude Code, Cursor, …) to draw it — no API key or extra needed.
> Business users view it in the Pegasus tenant UI to confirm the workflow matches
> their business rules. See [Visualizing workflows](#visualizing-workflows).

## Authoring

Import the Temporal authoring primitives from `pegasus_workflows` and mark your
workflow class with `@pegasus_workflow`:

```python
from datetime import timedelta
from pegasus_workflows import activity, pegasus_workflow, workflow

@activity.defn
async def greet(name: str) -> str:
    return f"Hello, {name}!"

@pegasus_workflow(name="demo", version="0.1.0")
class HelloWorkflow:
    @workflow.run
    async def run(self, name: str = "world") -> str:
        return await workflow.execute_activity(
            greet, name, start_to_close_timeout=timedelta(seconds=10)
        )
```

`@pegasus_workflow` wraps `temporalio.workflow.defn` and records the
`(name, version)` used by the manifest.

### Input contract: how `run()` receives its argument

Your `run()` method receives a **single positional argument** whose shape depends on how the workflow
was started:

**1. Trigger-fired (domain-event trigger)** — the dispatcher passes the full event envelope:

```python
{
    "domainEventId": "<uuid>",
    "eventType": "quote.accepted",      # the event type that fired the trigger
    "occurredAt": "<ISO-8601>",
    "payload": {"quoteId": "<id>", "moveId": "<id>"}   # entity ids, camelCase
}
```

Read entity ids from `arg["payload"]["quoteId"]` etc. The `payload` is a pointer, not a full snapshot
— always re-fetch authoritative state from the Pegasus API using those ids rather than relying on the
payload alone.

**2. Manual run** — `POST /api/v1/workflows/:id/run` passes:

```python
{"executionId": "<uuid>", "input": <user-supplied dict>}
```

Read your business data from `arg["input"]` (e.g. `arg["input"]["quote_id"]`).

**3. CLI test** — `pegasus-workflows test <name>` passes a raw string for local-dev parity.

Your `run()` should handle all three shapes. A module-level helper (not a method) is the recommended
pattern — it stays unit-testable without a Temporal worker context:

```python
def _resolve_quote_id(payload: dict | str) -> str:
    if isinstance(payload, str):
        return payload
    event_payload = payload.get("payload") if isinstance(payload, dict) else None
    if isinstance(event_payload, dict) and event_payload.get("quoteId"):
        return str(event_payload["quoteId"])
    inner = payload.get("input") if isinstance(payload, dict) else None
    if isinstance(inner, dict) and inner.get("quote_id"):
        return str(inner["quote_id"])
    return "quote-unknown"
```

### Sending an SMS

Inside a workflow activity, call `client.send_sms` to send an outbound text message
via the tenant's configured SMS provider. The platform holds the provider credentials —
no credential needs to appear in the workflow source or manifest.

```python
from pegasus_workflows import activity
from pegasus_workflows.api import PegasusClient

@activity.defn
async def send_alert_sms(to: str, message: str) -> dict:
    client = PegasusClient.from_runtime()   # reads the runner-injected env vars
    return client.send_sms(to=to, body=message)
```

> **Build the client with `PegasusClient.from_runtime()`** inside activities. The
> tenant runner injects the API connection as `PEGASUS_API_BASE_URL` and
> `PEGASUS_RUNTIME_TOKEN`; `from_runtime()` reads exactly those and raises a clear,
> named error if run outside the runner. Don't hardcode `os.environ[...]` — and
> note `PEGASUS_WORKFLOW_TOKEN` is the **publish-time CLI** token, _not_ a runtime
> var, so reaching for it here fails at runtime.

Declare the capability in `pegasus-workflows.toml`:

```toml
[[workflow]]
name = "order-saved-notify"
version = "0.1.0"
entry_points = ["order_saved.workflow:OrderSavedWorkflow"]
required_actions = ["SendSms"]
```

`send_sms` raises `PegasusApiError` (403) if `SendSms` is absent from `required_actions`,
or (404) if the tenant has no SMS provider connected. The `to` number must be E.164
(e.g. `"+16308868537"`).

### Soliciting feedback (magic-link surveys)

Ask a customer or driver for feedback via a tokenized link, then act on the
response. You author a versioned form once (via the `feedback-form` CLI), then a
workflow **mints a per-recipient link** and sends it. When the recipient submits,
the platform records the response and emits the built-in `feedback.submitted`
domain event — so a second workflow with an `EVENT` trigger on `feedback.submitted`
picks up and routes it (alert on a low rating, log a testimonial, etc.).

Author the form (once), from a working directory holding `form.json`:

```json
{
  "title": "How did we do?",
  "definition": {
    "questions": [
      { "id": "rating", "type": "rating", "label": "Rate your crew", "required": true },
      { "id": "comments", "type": "text", "label": "Anything else?", "maxLength": 500 }
    ]
  }
}
```

```bash
pegasus-workflows feedback-form validate post-move-csat   # dry-run the definition
pegasus-workflows feedback-form publish  post-move-csat   # publish v1
```

Then, inside a workflow activity, mint + send the link:

```python
@activity.defn
async def request_feedback_activity(move: dict) -> dict:
    client = PegasusClient.from_runtime()
    # channel="sms" also sends the form's messageTemplate; omit it to mint-only
    # and send the returned url yourself (e.g. via client.send_sms or email).
    return client.create_feedback_request(
        "post-move-csat",
        subject_type="move",
        subject_id=move["id"],
        ttl_hours=72,
        channel="sms",
        to=move["contactPhone"],
    )
```

`create_feedback_request` needs `required_actions = ["CreateFeedbackRequest"]`;
form authoring (`publish_feedback_form`, …) needs `ManageFeedbackForms`. Question
types: `rating` (int, default 1..5), `number`, `text`, `select` (options), `boolean`.
Poll a request with `client.get_feedback_request(request_id)`. The whole feature is
server-gated behind `FEEDBACK_ENABLED`.

### Delivering a body to a partner endpoint

To POST a mapped body to a partner API, use `client.deliver_to_external` rather than
calling the partner directly with `httpx` — the platform performs the outbound POST
**server-side**, so the send flows through the one boundary a dry run controls
(captured, never performed) instead of a raw call the runtime can't see or stop. It
pairs with `map_to_external`: map to build the body, deliver to send it.

```python
@activity.defn
async def send_order_to_partner(order: dict) -> dict:
    client = PegasusClient.from_runtime()
    mapped = client.map_to_external("demo_partner", order)   # build the partner body
    if not mapped["valid"]:
        raise RuntimeError(f"refusing to send invalid body: {mapped['issues']}")
    result = client.deliver_to_external("demo_partner", mapped["external"])
    if not result["delivered"]:
        raise RuntimeError(f"partner rejected the delivery: {result['status']}")
    return result
```

The delivery URL and API key come from the workflow's own config/secret (`SEND_URL`
config, `SEND_API_KEY` secret by default — override with `url_config` /
`api_key_secret` / `headers_config` / `group`), so no partner URL or key appears in
the workflow source. Declare `required_actions = ["DeliverToExternal"]` in the
manifest. Returns `{delivered, status, response, dryRun}`; raises `PegasusApiError`
on 403 (missing action), 404 (unknown integration, or the URL config / API-key
secret is not set), or 400 (a delivery URL pointing at a private/loopback host).

So the tenant can see which keys to provision, **declare them on the integration
config** via `required_secrets` / `required_configs` (each `{key, group?,
description?}`) — e.g. `required_secrets=[{"key": "SEND_API_KEY", "group": "sirva"}]`,
`required_configs=[{"key": "SEND_URL", "group": "sirva"}]` on
`publish_integration_config`, or as `requiredSecrets`/`requiredConfigs` in the
config directory's `meta.json`. It is informational (the runtime read still resolves
lazily) but surfaces a present/missing view on the integration's detail page and the
Settings → Developer → Configs summary. The resolved status for every integration is
at `GET /api/v1/integrations/requirements-summary` (presence only — never values).

### Ingesting a partner payload (inbound: native → canonical)

`map_to_external` is the **outbound** direction (entity → partner body). To go the
other way — normalize a partner's **native** payload into the platform's canonical
entity — use `client.map_from_external`. This is the step an **ingest workflow**
runs on an inbound webhook event (see "Inbound integration ingress"): map the raw
partner payload to the canonical shape, then persist it (e.g. to a projection).

```python
@activity.defn
async def normalize_shipment_event(event: dict) -> dict:
    client = PegasusClient.from_runtime()
    result = client.map_from_external("sirva_ade_shipment", event)   # native → canonical
    if result["canonical"] is None or not result["valid"]:
        raise RuntimeError(f"refusing to ingest an invalid payload: {result['issues']}")
    return result["canonical"]   # the system-of-record entity to persist
```

Returns `{canonical, valid, issues, degraded}`. `canonical` is the normalized
entity (the value the outbound direction discards internally) — `None` only when
the payload can't be mapped/parsed at all, so an ingest can **fail closed**.
`valid`/`issues` are the same gate verdict. Raises `PegasusApiError` (404) on an
unknown integration / no floor — it fails closed so an ingest never proceeds on a
silently-empty entity. Open API-key surface — no `required_actions`.

The integration's mapping + rules are a **published config** on a reusable,
partner-neutral **floor** (`shipment_lifecycle_event`, `sales_lead`,
`financial_settlement`, `document_record`). Partner value sets (allowed brand
codes, statuses, file types) live in the config's rules via the `nin` operator
(`{brandPresent eq true} AND {brand nin [AVL,NVL]}`) — not in platform code — so
the same floor serves any partner of that type.

### Calling a partner API (authenticated reads & writes)

`deliver_to_external` is one fixed JSON `POST`. For arbitrary reads and writes —
`GET` with query params, per-call paths, OAuth2 partners — use
`client.call_external`. You name a `method` + `path` (+ `query`/`body`) and the
platform performs the call **server-side** against the integration's configured
`BASE_URL`, authenticating per its `AUTH_MODE`. For `oauth2_client_credentials` it
mints, caches, and re-mints (on a partner `401`) an OAuth2 token server-side — so
`client_id`/`client_secret` never appear in workflow code.

```python
@activity.defn
async def fetch_shipment(reg: str, year: int) -> dict:
    client = PegasusClient.from_runtime()
    res = client.call_external(
        "sirva_ade_shipment",
        method="GET",
        path="/OM/m1/GetShipmentDetail",
        query={"RegNumber": reg, "RegYear": year},
    )
    return res["response"]          # parsed JSON (or raw text for an XML reply)
```

Config + credentials live in the tenant's config/secret store, read by name +
`group`. Declare `required_actions = ["CallExternal"]`. Returns
`{status, ok, response, headers, attempts, dryRun}`, where `headers` is **every**
partner response header (lowercase keys, `set-cookie` removed) — so `retry-after`,
`etag`, and vendor diagnostics like `x-ms-request-id` are all readable.

| `AUTH_MODE`                           | Credential                                                | Sent as                                                                          |
| ------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `oauth2_client_credentials` (default) | `CLIENT_ID` + `CLIENT_SECRET` secrets, `TOKEN_URL` config | minted bearer, cached, re-minted on `401`                                        |
| `bearer`                              | `API_KEY` secret                                          | `Authorization: Bearer …`                                                        |
| `apikey`                              | `API_KEY` secret                                          | the header named by config `API_KEY_HEADER`, default `Ocp-Apim-Subscription-Key` |
| `none`                                | —                                                         | —                                                                                |

**Dry-run split:** a `GET` is a read and runs **live** under
`pegasus-workflows run --dry-run` (returns real data); a `POST`/`PUT`/… is a
mutation and is **captured, not performed**. Pass `mutating=True`/`False` to
override the method-based default when a partner overloads a verb.

#### Custom request headers

Two maps, split by **trust level** — this split is the point, so pick the right one:

- `headers` — literal values, **non-secret by construction** (they come from your
  workflow code): `{"On-Behalf-Of": "jdoe"}`.
- `secret_headers` — header name → **secret key name**. The platform resolves the
  value from the encrypted store, so the credential never appears in workflow
  source, logs, or a captured dry-run payload:
  `{"X-Partner-Token": "PARTNER_TOKEN"}`.

`Authorization`, `Host`, `Content-Length` and `Content-Type` are owned by the
platform and rejected with a `400` — allowing an override would let a workflow
bypass `AUTH_MODE` entirely. Header names must be RFC 7230 tokens and values may
not contain CR/LF.

An Azure API Management partner (subscription key + a per-request identity
header) looks like this — with tenant config `AUTH_MODE=apikey` and secret
`API_KEY` holding the subscription key:

```python
res = client.call_external(
    "atlas_estimating",
    method="GET",
    path="/Estimating/Order/12345",
    headers={"On-Behalf-Of": "jdoe"},   # identity, not a credential
)
```

#### Timeouts and throttling

Each attempt is bounded by config `REQUEST_TIMEOUT_MS` (default 30s, clamped to
[1000, 60000]); exceeding it raises a `504`. A `429`/`503` is retried up to config
`MAX_RETRIES` times (default 2, clamped to [0, 5]), honoring the partner's
`Retry-After` (capped at 10s) and otherwise backing off exponentially.

**Only idempotent requests are retried** — `GET`/`HEAD`/`OPTIONS`, or any call
with `mutating=False`. A `POST` is never auto-retried, because a repeat could
double-write at the partner. Read `attempts` in the result to see how many HTTP
requests were actually made.

`deliver_to_external` takes the same `headers` / `secret_headers` /
`timeout_config` arguments. Its older `headers_config` (a config key holding a
JSON object) still works but is **non-secret only** — config values are stored in
plaintext, so a credential belongs in `secret_headers`.

### Transferring documents (blobs)

A workflow can stage a file to upload or land a file it fetched without holding
the bytes in workflow memory — `put_blob`/`get_blob` stream **runner↔S3 directly**
(presigned URLs), so they aren't bounded by the API payload limit. Declare
`required_actions = ["WriteBlob"]` (put) / `["ReadBlob"]` (get).

```python
@activity.defn
async def file_document(reg: str) -> dict:
    client = PegasusClient.from_runtime()

    # Retrieve: land a partner GET response straight into a blob (not memory).
    got = client.call_external(
        "sirva_ade_document", method="GET", path="/IMAGING/m2/GetImage",
        query={"Id": reg}, response_to_blob=True,
    )
    blob_id = got["blobId"]

    # ...or stage your own bytes:
    handle = client.put_blob(pdf_bytes, content_type="application/pdf")  # {blobId, size}

    # Upload: reference a staged blob; the platform inlines its bytes server-side.
    client.call_external(
        "sirva_ade_document", method="POST", path="/Imaging/m3/AddDocument",
        body={"ReferenceNumber": reg, "FileData": {"$blob": handle["blobId"]}},
    )
    return {"blobId": blob_id}
```

`put_blob` is a mutation (captured under `--dry-run`); `get_blob`/`get_blob_url`
are reads (live). Blobs are tenant-scoped and expire via a TTL. The
`$blob`/`response_to_blob` paths are a **small-file cut** (≤ ~5 MB through the
API); large-file streaming is a follow-up.

### Receiving events (inbound ingress)

For partners that **push** to you (a webhook), provision a platform-hosted ingress
endpoint. The partner POSTs to it with a bearer the platform issues; the endpoint
authenticates, dedups, persists the raw body, emits a domain event, and returns a
partner-shaped ack synchronously.

```
pegasus-workflows ingress create sirva_ade_shipment   # prints URL + one-time token
pegasus-workflows ingress rotate sirva_ade_shipment
pegasus-workflows ingress list   sirva_ade_shipment
```

The workflow that handles the events binds to the emitted domain event with an
ordinary **EVENT trigger**. The emitted event type, the dedup key path, the body
**`validation`**, and the **ack template** (the partner's `Result{…}` envelope)
are published as part of the integration definition — an `inbound` block on the
integration config:

```jsonc
"inbound": {
  "eventType": "sirva_ade.shipment.event",
  "dedupKeyPath": "Events.0.Id",
  // Declarative body checks. A body that fails them gets the `failure` ack (below)
  // at HTTP 200 — the partner records the rejection and does not retry it.
  "validation": {
    "requiredPaths": ["SvcProvDataRecipient"],
    "nonEmptyArrayPaths": ["Events"]
  },
  "ackTemplate": {
    // {{key}} substitutes a whole context value ({{status}} → "Success"/"Failed",
    // {{errorCount}} → the issue count). A number stays a number.
    "success": { "Result": { "Results": "{{status}}", "ResultsMessageCount": "{{errorCount}}",
                             "ResultsMessage": [] } },
    // The `$map` directive builds a per-message array from the structured issues —
    // exactly ADE's ResultsMessage[{Code, Description}] shape. Each element renders
    // the `as` sub-template against one issue ({{code}}, {{message}}).
    "failure": { "Result": { "Results": "{{status}}", "ResultsMessageCount": "{{errorCount}}",
      "ResultsMessage": { "$map": "issues",
        "as": { "ResultsMessageCode": "{{code}}", "ResultsMessageDescription": "{{message}}" } } } }
  }
}
```

The ack is derived from **ingestion** (accepted + durably queued), never from the
bound workflow finishing. Managing ingress needs a `vnd_` key with `ManageIngress`
(the `workflow_developer` / `tenant_admin` role). With no `inbound` block, the
endpoint accepts any body and returns a generic `{status:"accepted"}` ack (no
validation, no partner envelope).

**Multi-shape partners — `validation.oneOf` (0.22.0+).** When one ingress id
receives structurally different bodies (e.g. an ADE Abstract `{…, AgentNbr,
StatementEntry[]}` vs a Statement `{AgentStatementHdr:{AgentNbr}, PostingTickets[]}`),
list each accepted shape under `validation.oneOf`. The body must fully satisfy **at
least one** variant (in addition to any top-level `requiredPaths`/`nonEmptyArrayPaths`);
a body matching none gets the `failure` ack. Pair it with an array `dedupKeyPath`
(each path tried in order, first present wins) so both shapes dedup:

```jsonc
"inbound": {
  "eventType": "sirva_ade.compensation.event",
  "dedupKeyPath": ["StatementEntry.0.ReferenceNbr", "PostingTickets.0.ReferenceNbr"],
  "validation": {
    "oneOf": [
      { "requiredPaths": ["AgentNbr"],                  "nonEmptyArrayPaths": ["StatementEntry"] },
      { "requiredPaths": ["AgentStatementHdr.AgentNbr"], "nonEmptyArrayPaths": ["PostingTickets"] }
    ]
  }
  // ackTemplate as above
}
```

### Secrets & configuration

A workflow reads two kinds of per-tenant key/value data at runtime — **secrets**
(write-once, encrypted at rest; e.g. a third-party API key) and **config** (plain,
editable; e.g. a region or base URL). Both are scoped to the whole tenant, so every
workflow the tenant owns reads the same namespace. Values live in the platform — they
never appear in the workflow source or artifact.

**1. Publish the values once** with a `vnd_` key holding the manage actions (the
`workflow_developer` or `tenant_admin` role), via the CLI:

```
pegasus-workflows secrets set STRIPE_API_KEY "sk_live_…" --token=vnd_… --base-url=…
pegasus-workflows config  set DEFAULT_REGION us-east-1   --token=vnd_… --base-url=…
pegasus-workflows secrets list --token=vnd_…   # metadata only — never values
```

or from Python (`client.set_secret(...)`, `client.set_config(...)`,
`client.list_secrets()`, `client.delete_secret(...)`). Secrets are write-once —
delete then set again to rotate; `set_config` is an idempotent upsert.

**2. Declare the read actions** your workflow needs in `pegasus-workflows.toml`,
and — recommended — the specific keys it reads, so the tenant sees up front which
values to provide and whether they are set:

```toml
[[workflow]]
name = "charge-on-quote-accepted"
version = "0.1.0"
entry_points = ["charge.workflow:ChargeWorkflow"]
required_actions = ["ReadWorkflowSecret", "ReadWorkflowConfig"]
# Which keys this workflow reads. Each is a table with a required `key`, an
# optional `group` (default "global"), and an optional `description`. Purely
# informational — it does not gate execution — but it drives the tenant UI's
# "keys still needed" view in Settings → Developer → Configs and the badges on
# the workflow's detail page.
required_secrets = [{ key = "STRIPE_API_KEY", group = "billing", description = "Stripe secret key" }]
required_configs = [{ key = "DEFAULT_REGION" }]
```

The resolved present/missing state for every visible workflow is available at
`GET /api/v1/workflows/requirements-summary` (presence only — never values).

**3. Read the values inside an activity** (never in workflow code):

```python
@activity.defn
async def charge_customer(amount_cents: int) -> str:
    client = PegasusClient.from_runtime()
    api_key = client.get_secret("STRIPE_API_KEY")   # needs ReadWorkflowSecret
    region = client.get_config("DEFAULT_REGION")    # needs ReadWorkflowConfig
    ...
```

`get_secret` / `get_config` raise `PegasusApiError` (404) if the key is unset and
(403) if the matching read action is absent from `required_actions`.

### Integration projections (cached external state)

When a workflow syncs an external system, it can cache each record's last-known
state as a **projection** — keyed by `(integration, entity_type, key)` within the
tenant. The Pegasus **integration validator** reads the matching record's cached
`state` back as the `prior` input when pre-validating an update, so transition
rules stay accurate without the caller resupplying prior state.

Declare the actions your workflow needs, then read/write inside an activity:

```toml
[[workflow]]
name = "sync-demo-partner-orders"
version = "0.1.0"
entry_points = ["sync.workflow:SyncDemoPartner"]
required_actions = ["ReadIntegrationProjection", "WriteIntegrationProjection"]
```

```python
@activity.defn
async def cache_order(order: dict) -> None:
    client = PegasusClient.from_runtime()
    # Mirror the external record (native payload shape, ≤ 256 KB serialized).
    client.put_projection("demo_partner", "order", order["serviceOrderNumber"], order)

    prior = client.get_projection("demo_partner", "order", "SO-12345")  # None on miss
    every = client.list_projections("demo_partner", "order")
    client.delete_projection("demo_partner", "order", "SO-12345")
```

`get_projection` returns `None` on a cache miss; the write methods raise
`PegasusApiError` (403) if the matching action is absent from `required_actions`,
and `put_projection` raises 413 if the serialized state exceeds 256 KB.

### Reading operational entities (inside a workflow)

A running workflow authenticates with its `workflow_runtime` service-account key
(`PegasusClient.from_runtime()`), which is granted read access to the core
operational records. These helpers return `{data, meta: {total, count, limit,
offset}}` and take `limit` (≤100) / `offset`:

```python
client = PegasusClient.from_runtime()
client.list_customers(limit=25)          # ReadCustomer
client.list_quotes()                     # ReadQuote
client.list_moves()                      # ReadMove
client.list_invoices()                   # ReadInvoice
client.list_events("order.completed")    # ReadEvent — poll pending inbound events of a type
```

They read the m2m `/api/v1/runtime/*` surface (the browser `/api/v1/*` CRUD routes
are Cognito-only and reject a `vnd_` key). `list_events` polls the inbound
platform-event queue, which is keyed by type, so an event type is required.
(Inventory has no runtime read grant — a workflow that needs item-level data reads
it from the move it is processing.)

The pegII operational surface (legacy orders + tasks + salesmen) has its own reads/mutation:

```python
client.list_orders()                 # ReadOrder
client.get_order("SO-12345")         # ReadOrder — projected row {id, orderNumber, status, …}
client.list_tasks(order_id="SO-12345")   # ReadTask
client.get_task("task-1")            # ReadTask
client.close_task(order_id="SO-12345", task_type="date_confirmation", reason="done")  # CloseTask
client.list_salesmen(active="true")  # ReadSalesman
client.get_salesman("213056")        # ReadSalesman — {id, name, email, branch, active, …}
```

To dry-run a **published integration** against a real order id — "does this
production order pass the mapping?" — fetch the order's **native** pegII payload
(the same `{Id, Survey, InvolvedParties, KeyMoveDates, …}` shape a partner posts to
the ingress) and normalize it through the integration's inbound mapping. Two ways:

```python
# One-shot: fetch native + map + gate, server-normalized.
client.dry_run_integration("demo_partner", "490574")   # ReadOrder
# → {canonical, valid, issues, degraded}

# Or compose it yourself from the native payload:
native = client.get_order("490574", shape="native")    # ReadOrder — raw pegII payload
client.map_from_external("demo_partner", native)        # native → canonical + gate
```

No hand-pasting the raw payload. `get_order` without `shape` returns the projected
row; `shape="native"` returns the raw serialized object for mapping.

### Emitting a custom event (workflow-to-workflow chaining)

A workflow can fire a tenant-defined event type, which any workflow bound to it via
an EVENT trigger will run — the in-platform way to chain automations without an
outside queue. Requires `EmitTenantEvent`.

```python
client.emit_event("quote.followed_up", {"quoteId": "Q-1", "channel": "sms"})
# → {"emitted": True, "eventType": "quote.followed_up", "occurredAt": "…"}
```

The event type must already exist for the tenant (define it in the tenant UI or via
the events surface). `emit_event` is a mutation — captured, not performed, under the
offline test harness and the server-side `--dry-run`.

### Calling a read endpoint directly (`api_get`)

Most reads have a typed helper, but the API exposes more than the helpers cover —
for example the **projection read-model** (`GET /integrations/{id}/projections/{entityType}`),
which the typed `get_projection` / `list_projections` don't reach: it filters and
keyset-pages. `api_get(path, **params)` is a **read-only** passthrough to any Pegasus
API path with your key; it returns the full JSON body (so `meta` / `nextCursor`
survive). The catalog of paths is the OpenAPI spec (`GET /openapi.json`, or
`pegasus://reference/openapi` in your agent):

```python
# "ADE shipments still stuck at REGISTERED, not touched since 3 days ago" — paged
page = client.api_get(
    "/api/v1/integrations/sirva_ade_shipment/projections/shipment",
    status="REGISTERED", updatedSince="2026-07-14T00:00:00Z", limit=50,
)
for record in page["data"]:
    ...                       # chase the stuck shipment
cursor = page.get("nextCursor")   # keyset-page through the rest
```

Read-only by design: `api_get` only does `GET`, and only against your Pegasus API
(an absolute URL raises — a partner host is `call_external`'s job). For **writes**,
use the typed methods — they route through the dry-run capture path, which a generic
call would bypass. `api_get` is likewise **not** stubbed by the offline test harness
(use a typed read helper there); it's meant for ops/reconciliation on a real client.

## Visualizing workflows

A workflow is published as opaque Python, so the Pegasus tenant UI can't infer
what it does. Instead, each workflow ships a **Mermaid diagram** at
`<source_dir>/workflow.mmd` that business users view to confirm the workflow
matches their business rules. The UI pairs it with a _verified envelope_ drawn
from data the platform actually stores and trusts — the workflow's triggers, its
declared `required_actions`, and the secret/config keys it touches — so the
diagram (author-declared) sits next to the permission boundary (platform-guaranteed).

A diagram is **required to publish** — but how you draw it is up to you. The
`workflow.mmd` file is the source of truth: hand-write it, or have it drawn by
**whatever coding agent you already use** (Claude Code, Cursor, Copilot, …) on
your own subscription. `init` scaffolds a starter `workflow.mmd` so a new project
publishes out of the box.

The `diagram` command never calls an LLM and needs no API key. It assembles a
ready-to-use prompt — your workflow's Python source plus the exact output path and
formatting rules — for your agent to act on:

```
pegasus-workflows diagram                  # print the prompt for all workflows
pegasus-workflows diagram -w my-workflow   # just one workflow
pegasus-workflows diagram -o diagram.txt   # write the prompt to a file instead
```

Feed the output to your coding agent (it names the target path, e.g.
`<source_dir>/workflow.mmd`, and asks for a bare `flowchart TD`), then save the
result there. The file is packaged into the bundle, so it is SHA-pinned to the
exact published version — **edit it freely**; a changed diagram only goes live
with a new published version.

## Inspecting executions

Read execution status, results, and the Temporal event-history timeline from the
terminal (the same tenant-scoped data the web UI shows):

```
pegasus-workflows executions list <workflow-id> --token=vnd_…
pegasus-workflows executions show <workflow-id> <execution-id> --token=vnd_…
```

`show` prints the run's input/result/error plus a flattened timeline
(`WorkflowExecutionStarted` → per-activity events → the terminal event). The same
data is available programmatically via `client.list_executions`,
`client.get_execution`, and `client.get_execution_history`.

Drive an execution from the SDK too (also in the tenant web UI):

```python
client.cancel_execution(workflow_id, execution_id)  # CancelWorkflowExecution — cooperative cancel
client.retry_execution(workflow_id, execution_id)   # RetryWorkflowExecution — new run, same input
```

`cancel` signals a running execution (it transitions to CANCELLED when the run
observes it); `retry` starts a **new** execution from the stored input of a
terminal-failed one (FAILED / TIMED_OUT / CANCELLED), leaving the original row
untouched. Both need the `workflow_developer` role.

> ⚠️ **Keep PII out of workflow inputs and results.** Temporal stores execution
> payloads (input, result, and the full event history) and renders them in its
> UI, and platform engineers can read them cross-tenant in the Temporal Cloud
> console. Pass **entity ids**, not raw personal data — look the details up inside
> an activity via the API. (A payload codec would let us encrypt payloads; it's
> deferred until this convention can't hold.)

## The manifest — `pegasus-workflows.toml`

Every project has a `pegasus-workflows.toml` at its root. Each `[[workflow]]`
table is packaged into its own artifact and uploaded as a distinct
`(name, version)` row:

```toml
[[workflow]]
name = "demo"                                   # ^[a-z0-9][a-z0-9_-]{0,63}$
version = "0.1.0"                               # semver
entry_points = ["demo.workflow:HelloWorkflow"]  # non-empty
source_dir = "demo"                             # optional, defaults to name
description = "..."                             # optional
```

These rules mirror the server's `ManifestSchema` exactly, so `package`/`push`
fail fast locally before any HTTP call.

## Credentials & profiles

Every command that talks to the API needs a `vnd_` token and a base URL. Rather
than pasting them on the command line (where they leak into shell history,
process listings, and agent transcripts), store **named profiles** — AWS-CLI
style — in `~/.pegasus/credentials`:

```
pegasus-workflows configure --profile prod   # prompts for api_key (hidden) + api_root
pegasus-workflows configure --profile qa
pegasus-workflows profile list               # names + api_root only — never the key
```

The file is created `0600` (owner read/write only) and is **never committed** —
keep it out of repos. Then select a profile per command:

```
pegasus-workflows push --profile prod        # token + root from [prod]
pegasus-workflows run  --profile qa <id>
pegasus-workflows push                        # uses [default] if present
```

`--profile` works on every command that builds a client (`push`, `run`,
`integration-config`, `executions`, `secrets`, `config`). Resolution precedence,
highest first:

| Tier | Source                                                 |
| ---- | ------------------------------------------------------ |
| 1    | explicit `--token` / `--base-url` flags                |
| 2    | `--profile NAME`                                       |
| 3    | `PEGASUS_WORKFLOW_TOKEN` / `PEGASUS_BASE_URL` env vars |
| 4    | the `[default]` profile                                |

`api_root` is optional in a profile and defaults to
`https://api.pegasus.dolas.dev`. With nothing configured at all, the base URL
falls back to `http://localhost:3000` for local dev.

> These are the **publish-time CLI** credentials — distinct from the runtime vars
> (`PEGASUS_API_BASE_URL` / `PEGASUS_RUNTIME_TOKEN`) that the tenant runner injects
> for `PegasusClient.from_runtime()` inside activities.

## Deployment ledger — `deployments.toml`

Workflow ids are **environment-specific** — publishing the same workflow to QA and
prod yields different ids. After a successful `push`, the SDK records where each
workflow landed in a `deployments.toml` beside the manifest, so post-publish
actions (`run`, `executions`, fork, rollback) read the id instead of scraping it
from scrollback:

```toml
[prod]
base_url = "https://api.pegasus.dolas.dev"
workflow_id = "f8077342-2e58-4dc1-a47a-797ca394ef72"
version = "0.1.0"
visibility = "GLOBAL"
published_at = "2026-06-29T21:05:48Z"
```

- The environment key is derived from the API host, or set explicitly with
  `push --env NAME`.
- Re-publishing to the same env **updates the entry in place** (no duplicates);
  a second env adds a table. A multi-workflow project nests each record under the
  workflow name (`[prod.send_order_saved_sms]`).
- The file is **safe to commit** — it holds ids and URLs only, never a token.

## CLI

| Command                                                                            | What it does                                                   |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pegasus-workflows setup [--profile <name>] [--print-mcp-config]`                  | First-run bootstrap: seed a profile + register the MCP server. |
| `pegasus-workflows init <name>`                                                    | Scaffold a new workflow project.                               |
| `pegasus-workflows configure [--profile <name>]`                                   | Store a credential profile in `~/.pegasus/credentials` (0600). |
| `pegasus-workflows profile list`                                                   | List stored profile names + api_root (never the key).          |
| `pegasus-workflows diagram [-C <dir>] [-w <name>] [-o <file>]`                     | Print a prompt for your coding agent to draw `workflow.mmd`.   |
| `pegasus-workflows package`                                                        | Zip each declared workflow into `dist/<name>-<version>.zip`.   |
| `pegasus-workflows push [--profile <name>] [--env <name>] [--token=…]`             | Package → upload → finalize; records `deployments.toml`.       |
| `pegasus-workflows test <workflow>`                                                | Start local Temporal and run the workflow with a stub input.   |
| `pegasus-workflows executions list <wf-id> --token=<vnd_…>`                        | List recent executions of a workflow (newest first).           |
| `pegasus-workflows executions show <wf-id> <exec-id> --token=<vnd_…>`              | Show one execution's input/result/error + history timeline.    |
| `pegasus-workflows integration-config validate <id> [-C <dir>]`                    | Dry-run the publish gate for a config (no write).              |
| `pegasus-workflows integration-config publish <id> [-C <dir>]`                     | Gate then publish a new config version.                        |
| `pegasus-workflows integration-config pull <id> [-C <dir>] [--stdout]`             | Fetch the active config; write the editable surface to disk.   |
| `pegasus-workflows integration-config versions <id>`                               | List the config version history (newest first).                |
| `pegasus-workflows integration-config rollback <id> <version>`                     | Re-publish a prior version (re-runs the gate).                 |
| `pegasus-workflows integration-config fork <id> [--force] [--yes]`                 | Copy the GLOBAL config into this tenant; `--force` re-syncs.   |
| `pegasus-workflows integration-config delete <id> [--force] [--yes]`               | Permanently remove the caller's config for an integration.     |
| `pegasus-workflows secrets set <key> <value> [-d <desc>]`                          | Publish a secret (write-once, encrypted at rest).              |
| `pegasus-workflows secrets list` / `secrets delete <key>`                          | List secret keys (no values) / delete a secret.                |
| `pegasus-workflows config set <key> <value> [-d <desc>]`                           | Publish a config value (idempotent upsert).                    |
| `pegasus-workflows config list` / `config delete <key>`                            | List config key/values / delete a config entry.                |
| `pegasus-workflows schedule create <wf-id> --cron "<5-field UTC>"`                 | Attach a cron SCHEDULE trigger that runs the workflow.         |
| `pegasus-workflows schedule list <wf-id>` / `schedule delete <wf-id> <trigger-id>` | List / remove a workflow's schedule triggers.                  |
| `pegasus-workflows ingress create <id>` / `rotate <id>` / `list <id>`              | Provision / rotate / inspect a partner-ingress bearer.         |
| `pegasus-workflows feedback-form validate <key> [-d <dir>]`                        | Dry-run a feedback form definition (no write).                 |
| `pegasus-workflows feedback-form publish <key> [-d <dir>]`                         | Publish a new feedback form version.                           |
| `pegasus-workflows feedback-form pull <key> [-d <dir>]`                            | Fetch the active form; write `form.json` (+ `message.txt`).    |
| `pegasus-workflows feedback-form versions <key>` / `rollback <key> <version>`      | List versions / re-publish a prior version.                    |

Credentials resolve via `--token`/`--base-url`, `--profile`, the
`PEGASUS_WORKFLOW_TOKEN`/`PEGASUS_BASE_URL` env vars, or the `[default]` profile
(see [Credentials & profiles](#credentials--profiles)). The token is a `vnd_*`
Pegasus API key whose service account holds the `workflow_developer` role.

### Authoring an integration-validator config

The `integration-config` group manages an integration's declarative **mapping +
rules** (the DB-backed authoring surface). The working directory (`-C`, default
`.`) holds:

| File                                            | Required | What it is                                                                                                                             |
| ----------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `mapping.json`                                  | ✓        | native payload → canonical (output-shaped DSL; `GET /api/v1/integrations/mapping-schema`)                                              |
| `rules.json`                                    | ✓        | behavioral rules; ops `eq ne gt gte lt lte in nin` (use `nin` for "must be one of a set")                                              |
| `corpus.json`                                   | ✓        | gate cases `{input: {order: <native>}, expected: {valid, ruleIds}}`                                                                    |
| `meta.json`                                     | –        | `{floor, displayName}` — **required for a new id** with no built-in overlay                                                            |
| `inbound.json`                                  | –        | ingress ack/validation block (`GET /api/v1/integrations/inbound-schema`) — makes the ingress return the partner's `Result{…}` envelope |
| `external-shape.json` / `external-mapping.json` | –        | partner **outbound** body shape + projection                                                                                           |

**Discover the floor first.** A floor is the contract your config builds on — it
declares the only legal mapping _targets_ and rule _facts_. Author against it:

```python
client.list_floors()                    # [{floor, canonicalFields, factCatalog, factDocs?, …}]
client.get_floor("shipment_lifecycle_event")
#  → canonicalFields:  legal mapping targets    (what a mapping may WRITE)
#  → factCatalog:      legal rule facts         (name → type)
#  → factDocs:         what each fact MEANS     (name → one line), when documented
#  → inputFieldRoots:  legal mapping source roots (what a $from may READ), when declared.
#      bare "Survey" opens a whole native root; dotted "UnusedFields.survey_received"
#      opens ONLY that curated sub-path (siblings stay closed).
```

**Read `factDocs` before picking a fact.** A name and a type don't say what a fact
counts. Facts that count related records (`shipmentsWith…`) carry "at least one"
semantics, so you forbid the milestone with `{"op": "lte", "value": 0}` — and two
such predicates AND-ed in one rule are evaluated **independently**, so with 2+
related records one may satisfy the first and a different one the second. Where the
values must belong to the _same_ record the floor publishes a paired fact; `factDocs`
is what tells you which is which:

```jsonc
// "at least one shipment has a load actual" — the load-only milestone
"when": [
  {"fact": "serviceStatus", "op": "eq",  "value": "In Progress"},
  {"fact": "shipmentsWithLoadActual", "op": "lte", "value": 0}
]

// load AND delivery on the SAME shipment — use the paired fact, not two predicates
"when": [
  {"fact": "serviceStatus", "op": "in",  "value": ["Delivered", "Completed"]},
  {"fact": "shipmentsWithLoadDeliveryActual", "op": "lte", "value": 0}
]
```

(or public `GET /api/v1/integrations/floors[/{id}]`). Then the round-trip is
pull → edit → validate → publish:

```
pegasus-workflows integration-config pull demo_partner -C ./demo_partner
# …edit mapping.json / rules.json / inbound.json…
pegasus-workflows integration-config validate demo_partner -C ./demo_partner
pegasus-workflows integration-config publish demo_partner -C ./demo_partner
```

#### Forking a platform default — and re-syncing it later

`fork` copies the platform **GLOBAL** config into your tenant as your own overlay
(stamped with fork provenance, after re-running the gate against the current
floor). That overlay then **shadows** GLOBAL for your tenant.

```
pegasus-workflows integration-config fork demo_partner                  # seed my overlay
pegasus-workflows integration-config fork demo_partner --force          # re-sync it (prompts)
```

```python
client.fork_integration_config("demo_partner")               # -> the new TENANT config
client.fork_integration_config("demo_partner", force=True)   # refresh from the current GLOBAL
```

Without `--force` / `force=True` a fork is **one-shot**: if you already own an
overlay you get `409 CONFLICT`, so an overlay forked from an old GLOBAL can never
pick up upstream fixes. `--force` re-seeds it from the **current** GLOBAL as a
**new version** — your previous versions stay in `versions` and remain reachable
via `rollback`, so a refresh you regret is reversible. A stale overlay is easy to
miss (it silently validates against the old contract while GLOBAL is correct), so
re-sync after a platform fix rather than hand-republishing a copy.

Choosing between the two withdrawal/refresh paths:

- **`fork --force`** — you still want your own overlay, just rebased on the latest
  GLOBAL. History preserved; you keep diverging from there.
- **`delete`** (below) — you want _no_ overlay and to re-inherit GLOBAL live from
  then on. The lineage is destroyed.

Either way the gate re-runs against the current floor, so neither can resurrect a
GLOBAL config the contract has outgrown (`422`).

#### Removing an integration

`delete` is the withdrawal path publish/rollback never had — **one verb, scoped by
who calls it**, removing only the config lineage your own tenant owns:

```
pegasus-workflows integration-config delete demo_partner            # prompts first
pegasus-workflows integration-config delete demo_partner --yes --force
```

```python
client.delete_integration_config("demo_partner")               # -> {integrationId, visibility, deleted}
client.delete_integration_config("demo_partner", force=True)   # despite dependent tenant overlays
```

- **Platform tenant → the GLOBAL config.** Retires a placeholder or renamed id
  (e.g. `demo_partner` after a rename to `weichert`) so it stops resolving, drops
  out of `list_integrations()`, and can no longer be forked by tenants.
- **Any other tenant → its own TENANT overlay.** Afterwards
  `get_integration_config(id)` returns the platform GLOBAL again — the supported
  way to drop a stale overlay and re-inherit upstream, rather than
  hand-republishing a copy that never tracks GLOBAL.

It is **irreversible**: the whole version lineage is hard-deleted, so `versions`
comes back empty and `rollback` cannot undo it; a later publish starts again at
`v1`. Deleting a GLOBAL that other tenants still overlay returns `409
DEPENDENTS_EXIST` unless you pass `--force` / `force=True` — which acknowledges
them but never touches their rows. An id that also has a **built-in** definition
in platform code keeps resolving to that code baseline (it stays listed with
`published: false`); a config-only id disappears entirely — `get`,
`map_from_external` and `fork` all 404.

An AI coding agent can do all of this **without platform source**: the MCP
resources `pegasus://reference/integration-config` (the full guide),
`pegasus://reference/floors` (live floors), and `pegasus://reference/openapi` (the
API's OpenAPI 3.1 spec, also at `GET /openapi.json` / Swagger UI `/docs`) carry the
complete contract.

`publish`/`rollback`/`delete` require the token's tenant to be the **platform
tenant** to write GLOBAL (visibility is derived server-side) and to carry the
`PublishIntegrationConfig` action; they are gated by the server's
`INTEGRATION_CONFIG_PUBLISH_ENABLED` switch. `fork` takes the same action and
switch but is the mirror image on tenancy — it writes a TENANT overlay, so the
platform tenant (which owns GLOBAL already) cannot call it. `validate` and `pull`
are read-level and never gated.

## Local Temporal

`pegasus-workflows test` needs a Temporal server. The repo root ships
`docker-compose.temporal.yml` (Temporal server + Temporal UI on `7233` / `8080`)
purely as a local-dev aid — no production connection. `test` runs
`docker compose -f docker-compose.temporal.yml up -d` automatically if Temporal
is not already reachable on `127.0.0.1:7233`. To start it by hand:

```
docker compose -f docker-compose.temporal.yml up -d
```

The Temporal Web UI is then at <http://localhost:8080>.

## Testing activities offline

`pegasus-workflows test` runs a workflow end-to-end against a local Temporal, but
it injects **no** runtime client — so every activity that builds one via
`PegasusClient.from_runtime()` gets nothing and falls back to a hand-written stub,
exercising control flow only. To run an activity's **real** body — a real mapping,
a real read — without any Docker, network, or side effect, use the
`pegasus_workflows.testing` harness:

```python
from pegasus_workflows.testing import fake_client, run_activity
from my_workflow.workflow import fetch_order, send_order_to_partner

# Reads are served from fixtures; keyed reads (get_order, get_secret,
# map_to_external, …) take a {key: value} map, list/whole-value reads take the
# value as-is.
client = fake_client(reads={"get_order": {"S-123": {"orderNumber": "S-123"}}})

# The activity's REAL body runs (inside Temporal's ActivityEnvironment) — not a
# stub — with the fake injected in place of PegasusClient.from_runtime().
order = run_activity(fetch_order, "S-123", client=client)
assert order["orderNumber"] == "S-123"
assert client.captured == []                 # a read — nothing was sent

# Mutations are captured, never performed. Each entry records its Cedar capability.
run_activity(send_order_to_partner, order, client=client)
assert client.captured[0]["capability"] == "SendSms"
```

This retires the `if client is None: return {"stub": True}` pattern: the stub
logic lives in the harness, not in shipped source, so a test exercises the same
code that runs in production. Reads (`get_order`, `map_to_external`,
`get_config`/`get_secret`, `list_*`, …) are benign and served from fixtures;
mutations (`send_sms`, `emit_event`, `close_task`, `put_projection`, …) are
captured to `client.captured` — the same read-vs-mutation split the platform's
Cedar `required_actions` gating enforces, and the same `is_dry_run` /
`record_side_effect` surface the server-side dry-run mode exposes.

**Rehearse the real thing with `--dry-run`.** The offline harness runs one
activity; to rehearse a whole workflow end-to-end on the platform — real reads,
mutations captured, nothing performed — start it in dry-run mode:

```
pegasus-workflows run send_order_to_partner --dry-run --input '{"saleId":"S-123"}'
```

The workflow runs on the tenant runner exactly as a live run would, but the
runtime injects a dry-run client (`client.is_dry_run` is `True`), so reads hit
the live API while every mutation is captured instead of performed. The result
carries the per-activity trace and the capture log of would-be side effects.
Only tenant-runner workflows support it (a curated workflow returns 422
`DRY_RUN_UNSUPPORTED`).

## Using the SDK with an AI coding agent

The SDK ships a built-in [MCP](https://modelcontextprotocol.io/) server that
gives any MCP-compatible AI coding agent (Claude Code, Cursor, Windsurf, …)
structured access to SDK rules and safe tooling — without the agent having to
read or guess from source files.

### Install

The MCP server ships in the base package — no extra needed:

```
pip install pegasus-workflows-sdk
```

(A legacy `[mcp]` extra still resolves as a no-op alias, so older
`pip install 'pegasus-workflows-sdk[mcp]'` commands keep working.)

### Configure your agent

For Claude Code, `pegasus-workflows setup` writes the stanza for you (a `pegasus`
entry in project `./.mcp.json`) — see [First-run setup](#first-run-setup). Use
`pegasus-workflows setup --print-mcp-config` to emit the stanza for any other
host, or wire it by hand below.

#### Claude Code (`~/.claude/settings.json` or project `.claude/settings.json`)

```json
{
  "mcpServers": {
    "pegasus-workflows": {
      "command": "pegasus-workflows",
      "args": ["mcp"]
    }
  }
}
```

#### Cursor / Windsurf (`.cursor/mcp.json` or `.windsurf/mcp.json`)

```json
{
  "mcpServers": {
    "pegasus-workflows": {
      "command": "pegasus-workflows",
      "args": ["mcp"]
    }
  }
}
```

Once configured, the agent can call the resources and tools below without
any additional setup.

### Resources (read-only context)

| URI                              | Description                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pegasus://guide/authoring`      | Authoring guide: import surface, determinism rule, input contract pointer.                                            |
| `pegasus://guide/input-contract` | The three `run()` input shapes (trigger-fired, manual run, CLI test) + a worked resolver example.                     |
| `pegasus://guide/secrets-config` | How to publish and use per-tenant workflow secrets & configuration (manifest actions, CLI/SDK publish, runtime read). |
| `pegasus://reference/manifest`   | Manifest fields and constraints generated from `manifest.py` constants — stays in sync automatically.                 |
| `pegasus://reference/api`        | `PegasusClient` method signatures and docstrings generated by introspection — stays in sync automatically.            |

### Tools (safe actions — no network writes)

| Tool                                                                                   | Description                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `scaffold_workflow(name, dest)`                                                        | Scaffold a new workflow project at `dest/name`. Wraps `pegasus-workflows init`.                        |
| `validate_manifest(path_or_toml)`                                                      | Validate a manifest file path or raw TOML text. Returns structured errors or the parsed manifest.      |
| `package_project(project_dir)`                                                         | Package declared workflows into `dist/`. Returns `{name, version, zip_path, size_bytes}` per workflow. |
| `validate_integration_config(integration_id, mapping, rules, corpus, base_url, token)` | Dry-run the integration config publish gate. No state change.                                          |
| `list_deployments(project_dir)`                                                        | Read a project's `deployments.toml` ledger (no network, no write).                                     |
| `list_profiles()`                                                                      | List credential profile names + api_root. **Never** returns `api_key`.                                 |

Network-mutating operations (`push`, `publish_integration_config`, `run`) are
intentionally **not exposed** — keep those human-gated via the CLI. Secrets never
cross the MCP boundary: `list_profiles` exposes profile names and api_roots only.

### Smoke test (verify the server starts)

```bash
pegasus-workflows mcp --help   # should print the mcp command help
```

Without the extra installed, the command exits non-zero with an install hint.

## Keeping the SDK in sync (maintainers)

The SDK is the **external product boundary** for integration/workflow authors —
they and their AI agents must be able to use the **full** platform functionality
without platform source, via the docs, the MCP `pegasus://reference/*` resources,
CLI `--help`, and the API's OpenAPI spec (`/openapi.json`). So whenever an
integrations/workflows platform feature is added or changed (a new route, floor,
rule operator, config field, or capability):

1. Expose it in the SDK (a `PegasusClient` method / CLI command / config-file surface).
2. Update its **discovery surfaces in turn** — this README, `CLAUDE.md`, the MCP
   resources, and the OpenAPI spec — preferring **live introspection** (e.g. the
   floor endpoints) over static docs where the contract is code.

A capability that exists in the API but isn't reachable + discoverable through
these is a gap, not a feature.

## Release

The SDK is published to PyPI by `.github/workflows/release-sdk-python.yml` on
`sdk-python-v*` tags via PyPI **trusted publishing** (OIDC — no API token).

To cut a release:

1. Bump `version` in `pyproject.toml` and commit it on `main`.
2. Tag the release commit and push the tag, e.g.
   `git tag sdk-python-v0.1.0 && git push origin sdk-python-v0.1.0`.

The workflow then lints, audits, tests, builds, and uploads the sdist + wheel.

**One-time setup (before the first release):** a PyPI project owner must add a
pending publisher at `pegasus-workflows-sdk` → Publishing → owner `DolasDev`,
repo `pegasus`, workflow `release-sdk-python.yml`, environment `pypi`. Until
that exists the `publish` job fails at the upload step, and tenants must use the
[git install](#interim--unreleased-install-git) above.
