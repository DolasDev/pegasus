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

This installs the `pegasus-workflows` CLI. Python 3.11+ is required.

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

| Command | What it does |
| --- | --- |
| `pegasus-workflows init <name>` | Scaffold a new workflow project. |
| `pegasus-workflows package` | Zip each declared workflow into `dist/<name>-<version>.zip`. |
| `pegasus-workflows push --token=<vnd_…> [--base-url=…]` | Package, then `upload-url` → S3 PUT → finalize. |
| `pegasus-workflows test <workflow>` | Start local Temporal and run the workflow with a stub input. |

`push` reads the token from `--token` or the `PEGASUS_WORKFLOW_TOKEN`
environment variable. The token is a `vnd_*` Pegasus API key whose service
account holds the `workflow_developer` role.

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
`sdk-python-v*` tags via PyPI trusted publishing.
