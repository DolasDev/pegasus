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
pegasus-workflows package
pegasus-workflows push --token=vnd_... --base-url=http://localhost:3000
```

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

## CLI

| Command                                                                | What it does                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pegasus-workflows init <name>`                                        | Scaffold a new workflow project.                             |
| `pegasus-workflows package`                                            | Zip each declared workflow into `dist/<name>-<version>.zip`. |
| `pegasus-workflows push --token=<vnd_…> [--base-url=…]`                | Package, then `upload-url` → S3 PUT → finalize.              |
| `pegasus-workflows test <workflow>`                                    | Start local Temporal and run the workflow with a stub input. |
| `pegasus-workflows integration-config validate <id> [-C <dir>]`        | Dry-run the publish gate for a config (no write).            |
| `pegasus-workflows integration-config publish <id> [-C <dir>]`         | Gate then publish a new config version.                      |
| `pegasus-workflows integration-config pull <id> [-C <dir>] [--stdout]` | Fetch the active config; write the editable surface to disk. |
| `pegasus-workflows integration-config versions <id>`                   | List the config version history (newest first).              |
| `pegasus-workflows integration-config rollback <id> <version>`         | Re-publish a prior version (re-runs the gate).               |

`push` reads the token from `--token` or the `PEGASUS_WORKFLOW_TOKEN`
environment variable. The token is a `vnd_*` Pegasus API key whose service
account holds the `workflow_developer` role.

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
