# Changelog

All notable changes to `pegasus-workflows-sdk` are documented here. The project
follows [Semantic Versioning](https://semver.org/).

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
