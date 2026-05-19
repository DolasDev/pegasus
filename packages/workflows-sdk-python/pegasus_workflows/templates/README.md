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

## Publish

```
pegasus-workflows package                                   # build dist/*.zip
pegasus-workflows push --token=vnd_... --base-url=https://api.pegasus.example
```

`push` validates the manifest locally, requests a presigned upload URL,
PUTs the artifact to S3, and finalizes the `Workflow` row. A `409` means
that `name@version` already exists for your tenant — bump the version.
