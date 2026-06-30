# SDK improvement specs

Improvement specs for `pegasus-workflows-sdk`, surfaced while authoring real
workflows in the **pegasus-workflows** repo (`~/repos/pegasus-workflows`).

Each spec is self-contained and carries an **Origin** pointer back to its source
in that repo's `sdk-feedback/` folder. After a spec ships, the SDK is upgraded
there and the spec is validated against its acceptance criteria; mirror the
resulting `Status` back into the source.

## Index

| Spec                                                                         | Status          | Area                            |
| ---------------------------------------------------------------------------- | --------------- | ------------------------------- |
| [ai-authoring-mcp-server.md](ai-authoring-mcp-server.md)                     | Shipped (0.2.0) | tooling / CLI / docs            |
| [sms-notification-and-secrets.md](sms-notification-and-secrets.md)           | Shipped (0.2.0) | PegasusClient / runtime secrets |
| [post-publish-deployment-recording.md](post-publish-deployment-recording.md) | Shipped (0.6.0) | CLI (`push`) / packaging / MCP  |
| [named-credential-profiles.md](named-credential-profiles.md)                 | Shipped (0.6.0) | CLI / auth / MCP                |
| [runtime-env-var-names-wrong.md](runtime-env-var-names-wrong.md)             | Shipped (0.6.0) | docs / PegasusClient            |
| [mcp-server-guidance-stale.md](mcp-server-guidance-stale.md)                 | Proposed        | tooling (MCP) / docs / CLI      |
