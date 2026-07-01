# SDK improvement specs

Improvement specs for `pegasus-workflows-sdk`, surfaced while authoring real
workflows in the **pegasus-workflows** repo (`~/repos/pegasus-workflows`).

Each spec is self-contained and carries an **Origin** pointer back to its source
in that repo's `sdk-feedback/` folder. After a spec ships, the SDK is upgraded
there and the spec is validated against its acceptance criteria; mirror the
resulting `Status` back into the source.

## Index

| Spec                                                                                     | Status           | Area                                |
| ---------------------------------------------------------------------------------------- | ---------------- | ----------------------------------- |
| [ai-authoring-mcp-server.md](ai-authoring-mcp-server.md)                                 | Shipped (0.2.0)  | tooling / CLI / docs                |
| [sms-notification-and-secrets.md](sms-notification-and-secrets.md)                       | Shipped (0.2.0)  | PegasusClient / runtime secrets     |
| [post-publish-deployment-recording.md](post-publish-deployment-recording.md)             | Shipped (0.6.0)  | CLI (`push`) / packaging / MCP      |
| [named-credential-profiles.md](named-credential-profiles.md)                             | Shipped (0.6.0)  | CLI / auth / MCP                    |
| [runtime-env-var-names-wrong.md](runtime-env-var-names-wrong.md)                         | Shipped (0.6.0)  | docs / PegasusClient                |
| [long-running-event-correlated-workflows.md](long-running-event-correlated-workflows.md) | Proposed         | authoring API / manifest / platform |
| [task-lifecycle-and-order-reads.md](task-lifecycle-and-order-reads.md)                   | Shipped (0.8.0)† | PegasusClient / docs                |
| [unified-setup-bootstrap.md](unified-setup-bootstrap.md)                                 | Shipped (0.8.0)  | CLI / tooling (MCP) / docs          |
| [mcp-server-guidance-stale.md](mcp-server-guidance-stale.md)                             | Shipped (0.8.0)  | tooling (MCP) / docs / CLI          |
| [mcp-extra-regression.md](mcp-extra-regression.md)                                       | Shipped (0.8.1)  | packaging (deps) / CLI / docs       |

† `task-lifecycle-and-order-reads` (0009): SDK methods + `ReadOrder`/`ReadTask`/
`CloseTask` Cedar actions shipped; the `/api/v1/pegii/*` order+task API is a
pegII-bound **stub** (`apps/api/src/handlers/pegii-runtime.ts` +
`services/pegii-orders.ts` / `pegii-tasks.ts`) pending the real pegII API bridge.
