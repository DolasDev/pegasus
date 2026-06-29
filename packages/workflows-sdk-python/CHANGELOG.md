# Changelog

All notable changes to `pegasus-workflows-sdk` are documented here. The project
follows [Semantic Versioning](https://semver.org/).

## 0.6.0

### Added

- **`PegasusClient.from_runtime()`.** A classmethod that builds a client from the
  env vars the tenant runner injects (`PEGASUS_API_BASE_URL` /
  `PEGASUS_RUNTIME_TOKEN`) and raises a clear, named error when run outside the
  runner. Prefer it over hardcoding `os.environ[...]` in activities — a future
  rename of the runtime contract becomes a one-line SDK fix. (Fixes the README's
  prior SMS/activity example, which named non-existent runtime vars and failed
  100% of the time at first execution.)
- **Named credential profiles.** Store `vnd_` tokens + API roots in
  `~/.pegasus/credentials` (AWS-CLI style) instead of pasting them on the command
  line. `pegasus-workflows configure [--profile NAME]` writes the file `0600`;
  `pegasus-workflows profile list` shows names + api_root only (never a key).
  Every API command accepts `--profile NAME`. Resolution precedence: explicit
  `--token`/`--base-url` > `--profile` > `PEGASUS_WORKFLOW_TOKEN` /
  `PEGASUS_BASE_URL` env vars > the `[default]` profile. A profile's `api_root`
  defaults to `https://api.pegasus.dolas.dev`.
- **Post-publish deployment ledger.** `push` now records each published workflow
  in a `deployments.toml` beside the manifest — `(env, workflow) → {workflow_id,
version, visibility, base_url, published_at}` — so environment-specific ids are
  a deterministic file read, not a scrollback scrape. The env key derives from the
  API host or `push --env NAME`; re-publishing upserts in place; multi-workflow
  projects nest by name. The file holds ids/URLs only (safe to commit).
- **Two read-only MCP tools.** `list_deployments(project_dir)` reads the ledger;
  `list_profiles()` lists profile names + api_root (never `api_key`). Both are
  network-free; the no-mutation MCP invariant still holds.

### Changed

- API commands (`push`, `run`, `integration-config`, `executions`, `secrets`,
  `config`) now resolve credentials through the shared profile-aware path. Behavior
  is unchanged when no profile is used (explicit flags / `PEGASUS_WORKFLOW_TOKEN`
  still work); `--base-url` now also reads `PEGASUS_BASE_URL`.
- README activity examples (SMS, secrets/config, projections) use
  `PegasusClient.from_runtime()`.

## 0.5.0

### Added

- **Integration projections (cached external state).** New runtime
  `PegasusClient` methods let a workflow maintain a per-record cache of an
  external system's last-known state: `get_projection(integration, entity_type,
key)` (returns `None` on miss), `put_projection(...)` (idempotent upsert,
  bumps `version`), `list_projections(integration, entity_type)`, and
  `delete_projection(...)`. State is the integration's native payload shape and
  is capped at 256 KB serialized. Declare `required_actions =
["ReadIntegrationProjection", "WriteIntegrationProjection"]` in the manifest.
  The Pegasus integration validator reads the matching record's cached `state`
  back as the `prior` input when pre-validating an update, so a workflow that
  syncs the external system keeps transition-rule validation accurate without
  the caller resupplying prior state.

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
