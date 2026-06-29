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

## Quick start

```
pegasus-workflows init demo
cd demo
pegasus-workflows test demo
pegasus-workflows diagram                # generate workflow.mmd (needs [diagram] extra + ANTHROPIC_API_KEY)
pegasus-workflows package
pegasus-workflows push --token=vnd_... --base-url=http://localhost:3000
```

> A workflow **diagram** (`<source_dir>/workflow.mmd`) is required to publish. `init`
> ships a starter one; `pegasus-workflows diagram` regenerates it from your code via
> the Anthropic API. Business users view it in the Pegasus tenant UI to confirm the
> workflow matches their business rules. See [Visualizing workflows](#visualizing-workflows).

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

**2. Declare the read actions** your workflow needs in `pegasus-workflows.toml`:

```toml
[[workflow]]
name = "charge-on-quote-accepted"
version = "0.1.0"
entry_points = ["charge.workflow:ChargeWorkflow"]
required_actions = ["ReadWorkflowSecret", "ReadWorkflowConfig"]
```

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
name = "sync-weichert-orders"
version = "0.1.0"
entry_points = ["sync.workflow:SyncWeichert"]
required_actions = ["ReadIntegrationProjection", "WriteIntegrationProjection"]
```

```python
@activity.defn
async def cache_order(order: dict) -> None:
    client = PegasusClient.from_runtime()
    # Mirror the external record (native payload shape, ≤ 256 KB serialized).
    client.put_projection("weichert", "order", order["serviceOrderNumber"], order)

    prior = client.get_projection("weichert", "order", "SO-12345")  # None on miss
    every = client.list_projections("weichert", "order")
    client.delete_projection("weichert", "order", "SO-12345")
```

`get_projection` returns `None` on a cache miss; the write methods raise
`PegasusApiError` (403) if the matching action is absent from `required_actions`,
and `put_projection` raises 413 if the serialized state exceeds 256 KB.

## Visualizing workflows

A workflow is published as opaque Python, so the Pegasus tenant UI can't infer
what it does. Instead, each workflow ships a **Mermaid diagram** at
`<source_dir>/workflow.mmd` that business users view to confirm the workflow
matches their business rules. The UI pairs it with a _verified envelope_ drawn
from data the platform actually stores and trusts — the workflow's triggers, its
declared `required_actions`, and the secret/config keys it touches — so the
diagram (author-declared) sits next to the permission boundary (platform-guaranteed).

A diagram is **required to publish**. Generate or refresh it from your code:

```
pip install 'pegasus-workflows-sdk[diagram]'   # one-time: the Anthropic SDK
export ANTHROPIC_API_KEY=sk-ant-...
pegasus-workflows diagram                       # writes <source_dir>/workflow.mmd
pegasus-workflows diagram --model claude-sonnet-4-6 --force   # cheaper model, regenerate
```

The command sends your workflow's Python source to the Anthropic API and writes a
`flowchart TD`. The file is the source of truth — **edit it freely** afterward;
`diagram` only regenerates with `--force`. It is packaged into the bundle, so it
is SHA-pinned to the exact published version.

## Inspecting executions

Read execution status, results, and the Temporal event-history timeline from the
terminal (the same tenant-scoped data the web UI shows):

```
pegasus-workflows executions list <workflow-id> --token=vnd_…
pegasus-workflows executions show <workflow-id> <execution-id> --token=vnd_…
```

`show` prints the run's input/result/error plus a flattened timeline
(`WorkflowExecutionStarted` → per-activity events → the terminal event). Cancel
and retry are available in the tenant web UI. The same data is available
programmatically via `client.list_executions`, `client.get_execution`, and
`client.get_execution_history`.

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

| Command                                                                | What it does                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pegasus-workflows init <name>`                                        | Scaffold a new workflow project.                               |
| `pegasus-workflows configure [--profile <name>]`                       | Store a credential profile in `~/.pegasus/credentials` (0600). |
| `pegasus-workflows profile list`                                       | List stored profile names + api_root (never the key).          |
| `pegasus-workflows diagram [-C <dir>] [--model …] [--force]`           | AI-generate `workflow.mmd` from source (`[diagram]` extra).    |
| `pegasus-workflows package`                                            | Zip each declared workflow into `dist/<name>-<version>.zip`.   |
| `pegasus-workflows push [--profile <name>] [--env <name>] [--token=…]` | Package → upload → finalize; records `deployments.toml`.       |
| `pegasus-workflows test <workflow>`                                    | Start local Temporal and run the workflow with a stub input.   |
| `pegasus-workflows executions list <wf-id> --token=<vnd_…>`            | List recent executions of a workflow (newest first).           |
| `pegasus-workflows executions show <wf-id> <exec-id> --token=<vnd_…>`  | Show one execution's input/result/error + history timeline.    |
| `pegasus-workflows integration-config validate <id> [-C <dir>]`        | Dry-run the publish gate for a config (no write).              |
| `pegasus-workflows integration-config publish <id> [-C <dir>]`         | Gate then publish a new config version.                        |
| `pegasus-workflows integration-config pull <id> [-C <dir>] [--stdout]` | Fetch the active config; write the editable surface to disk.   |
| `pegasus-workflows integration-config versions <id>`                   | List the config version history (newest first).                |
| `pegasus-workflows integration-config rollback <id> <version>`         | Re-publish a prior version (re-runs the gate).                 |
| `pegasus-workflows secrets set <key> <value> [-d <desc>]`              | Publish a secret (write-once, encrypted at rest).              |
| `pegasus-workflows secrets list` / `secrets delete <key>`              | List secret keys (no values) / delete a secret.                |
| `pegasus-workflows config set <key> <value> [-d <desc>]`               | Publish a config value (idempotent upsert).                    |
| `pegasus-workflows config list` / `config delete <key>`                | List config key/values / delete a config entry.                |

Credentials resolve via `--token`/`--base-url`, `--profile`, the
`PEGASUS_WORKFLOW_TOKEN`/`PEGASUS_BASE_URL` env vars, or the `[default]` profile
(see [Credentials & profiles](#credentials--profiles)). The token is a `vnd_*`
Pegasus API key whose service account holds the `workflow_developer` role.

### Authoring an integration-validator config

The `integration-config` group manages an integration's declarative **mapping +
rules** (the DB-backed authoring surface; see
`apps/api/src/handlers/integration-validation/config.ts`). The editable surface
lives as three JSON files in a working directory (`-C`, default `.`):
`mapping.json`, `rules.json`, `corpus.json`. The round-trip is pull → edit →
validate → publish:

```
pegasus-workflows integration-config pull weichert -C ./weichert
# …edit mapping.json / rules.json…
pegasus-workflows integration-config validate weichert -C ./weichert
pegasus-workflows integration-config publish weichert -C ./weichert
```

`publish`/`rollback` require the token's tenant to be the **platform tenant** to
write GLOBAL (visibility is derived server-side) and to carry the
`PublishIntegrationConfig` action; they are gated by the server's
`INTEGRATION_CONFIG_PUBLISH_ENABLED` switch. `validate` and `pull` are
read-level and never gated.

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

## Using the SDK with an AI coding agent

The SDK ships a built-in [MCP](https://modelcontextprotocol.io/) server that
gives any MCP-compatible AI coding agent (Claude Code, Cursor, Windsurf, …)
structured access to SDK rules and safe tooling — without the agent having to
read or guess from source files.

### Install the extra

```
pip install 'pegasus-workflows-sdk[mcp]'
```

### Configure your agent

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
