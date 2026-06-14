# __WORKFLOW_NAME__

A Pegasus workflow project, scaffolded with `pegasus-workflows init`.

## Layout

- `pegasus-workflows.toml` — the manifest. Declares each workflow's name,
  version, and entry points.
- `__WORKFLOW_NAME__/workflow.py` — the workflow definition.

## Develop

```
pip install pegasus-workflows-sdk
pegasus-workflows test __WORKFLOW_NAME__    # run locally against Dockerized Temporal
```

> **Input contract:** your `run()` method receives a single positional argument whose shape depends on
> how the workflow is started:
>
> - **Trigger-fired** (domain-event): the event envelope
>   `{"domainEventId", "eventType", "occurredAt", "payload": {...}}` — read entity ids from
>   `arg["payload"]` (camelCase) and re-fetch authoritative state via the API.
> - **Manual run** (`POST /workflows/:id/run`): `{"executionId", "input": {...}}` — read your data from
>   `arg["input"]`.
> - **CLI test** (`pegasus-workflows test`): a raw string for local-dev parity.
>
> Handle all three. A module-level helper (not a method) keeps resolution unit-testable without a
> Temporal worker context. See the "Input contract" section of the `pegasus-workflows-sdk` README for a
> worked example.

## Publish

```
pegasus-workflows package                                   # build dist/*.zip
pegasus-workflows push --token=vnd_... --base-url=https://api.pegasus.example
```

`push` validates the manifest locally, requests a presigned upload URL,
PUTs the artifact to S3, and finalizes the `Workflow` row. A `409` means
that `name@version` already exists for your tenant — bump the version.
