# Changelog

All notable changes to `pegasus-workflows-sdk` are documented here. The project
follows [Semantic Versioning](https://semver.org/).

## 0.8.0

### Added

- **`pegasus-workflows setup` — one guided first-run bootstrap** (spec 0010). Seeds
  a `~/.pegasus/credentials` profile at `0600` (delegating to `configure`) and
  registers the bundled MCP server by writing a `pegasus` entry into the agent
  host's `.mcp.json` (Claude Code project config). Never clobbers an existing
  `pegasus` entry without `--force`; `--print-mcp-config` emits the stanza to
  stdout for other hosts/CI; `--skip-mcp` seeds only the profile. Performs no
  network calls and writes the `api_key` only to the `0600` credentials file —
  never into `.mcp.json`. Fully scriptable (zero prompts) when inputs are passed
  as flags. The obvious `--setup` / `--configure` guesses now point at it, and
  the onboarding flow is documented in the README.
- **Order + task reads on `PegasusClient`** (spec 0009). New activity-side methods
  `get_order` / `list_orders` (gated `ReadOrder`), `list_tasks` / `get_task`
  (gated `ReadTask`), and an idempotent `close_task(*, order_id, task_type,
reason=None)` (gated `CloseTask`) for lifecycle workflows that advance or close
  out an order's operational tasks. All auto-surface in the
  `pegasus://reference/api` MCP resource.

### Changed

- **MCP authoring guidance synced to 0.6.0 behavior** (spec 0011). The
  `pegasus://guide/authoring` Activities example (and the secrets-config runtime
  example) now build the client with `PegasusClient.from_runtime()` instead of a
  hardcoded `base_url`/`token`, and reference the `PEGASUS_API_BASE_URL` /
  `PEGASUS_RUNTIME_TOKEN` runtime contract. `pegasus://reference/manifest` now
  documents the `workflow.mmd` packaging requirement, and the MCP
  `package_project` tool's missing-diagram error names the in-MCP remedy (the
  `diagram_prompt` tool) so a non-Claude agent isn't dead-ended at a shell command.

> **Platform note (spec 0009):** the SDK's order/task methods target a namespaced
> `/api/v1/pegii/*` legacy-bridge surface (like the retired `/onprem/longhaul/*`
> handlers) — `get_order`/`list_orders` → `/api/v1/pegii/orders`,
> `list_tasks`/`get_task`/`close_task` → `/api/v1/pegii/tasks`. That surface + the
> `ReadOrder`/`ReadTask`/`CloseTask` Cedar actions ship in `apps/api` backed by
> in-memory **stubs** (`services/pegii-orders.ts` + `services/pegii-tasks.ts`) that
> bridge to the pegII API later — the same cutover pattern the retired longhaul
> surface used. `close_task` is idempotent today against the stub. This is distinct
> from the untouched M2M `/api/v1/orders` reporting view of cloud moves.

## 0.7.0

### Added

- **MCP `diagram_prompt` tool + authoring-guide coverage.** The `pegasus-workflows
mcp` server now exposes a read-only `diagram_prompt(project_dir, workflow=None)`
  tool — the MCP-native equivalent of the CLI command — returning each workflow's
  source plus its `workflow.mmd` output path and Mermaid rules so an AI coding
  agent draws the diagram itself. The `pegasus://guide/authoring` resource now
  documents that a `workflow.mmd` is required to publish and that the agent (not
  any AI service) draws it. No new mutating/network tools; the no-write invariant
  holds.

### Changed

- **`pegasus-workflows diagram` is now bring-your-own-agent.** The command no
  longer calls the Anthropic API. Instead it prints a ready-to-use prompt — the
  workflow's Python source plus the exact `<source_dir>/workflow.mmd` output path
  and formatting rules — for **whatever coding agent the developer already uses**
  (Claude Code, Cursor, Copilot, …) to act on, on their own subscription. No
  `ANTHROPIC_API_KEY`, no provider lock-in. `--out/-o FILE` writes the prompt to a
  file; `--workflow/-w` scopes to one workflow. What's required to publish is
  unchanged: the `workflow.mmd` file must exist — its contents may be hand-written
  or produced by any tool.

### Removed

- **The `[diagram]` extra** (the bundled `anthropic` dependency) and the
  `--model` / `--force` flags and `$PEGASUS_DIAGRAM_MODEL` env var — the command
  no longer generates or writes the diagram itself, so none apply. Anyone who
  installed `pegasus-workflows-sdk[diagram]` should drop the extra; the command
  works with no extras.

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
