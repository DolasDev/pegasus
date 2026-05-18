# Pegasus Workflows — Standard Library

`workflows-stdlib` is the platform team's curated set of Pegasus workflows.

It is a **dogfood project**: it uses `pegasus-workflows-sdk` exactly the way a
tenant project does. There is no private loader — the standard library is
published through the same `pegasus-workflows push` path tenants use, just run
from CI under the **platform tenant** identity. Because the platform tenant has
`isPlatformTenant=true`, every workflow here resolves to `GLOBAL` visibility
server-side and appears in every tenant's Platform Library.

## Contents

| Workflow | Version | Description |
| --- | --- | --- |
| `send_quote_followup` | `0.1.0` | Follow up on a quote that has not been accepted. |

## Develop locally

```
pip install pegasus-workflows-sdk
pegasus-workflows test send_quote_followup     # runs against local Temporal
pegasus-workflows package                      # builds dist/*.zip
```

## Publish

Publishing is automated. Pushing a `stdlib-v*` tag triggers
`.github/workflows/publish-stdlib.yml`, which installs the SDK and runs:

```
pegasus-workflows push --token=$PLATFORM_WORKFLOW_TOKEN --base-url=$API_BASE_URL
```

`PLATFORM_WORKFLOW_TOKEN` is a `vnd_*` API key bound to a service-account user
with the `workflow_developer` role in the platform tenant.
