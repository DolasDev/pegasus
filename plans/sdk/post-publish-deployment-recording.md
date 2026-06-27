# SDK spec — Post-publish deployment recording (push writes a deployments ledger)

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0003-post-publish-deployment-recording.md`
- **Status:** Proposed
- **Filed:** 2026-06-26
- **SDK version when filed:** 0.2.0
- **SDK version that addresses it:** <!-- fill in when shipped -->
- **Area:** CLI (`push`) / packaging / tooling (MCP)

## Problem

After `pegasus-workflows push`, the only record of _where_ a workflow is
deployed and _what id it got_ is the command's stdout. Workflow ids are
**environment-specific** — publishing `send_order_saved_sms` produced
`f7faabdc-…` on QA and `f8077342-…` on prod. There is no durable, machine-
readable mapping from `(workflow name, environment) → {id, version, timestamp}`.

So today we hand-maintain `platform/send_order_saved_sms/deployments.toml`. Every
post-publish action needs the per-env id — `run --base-url`, listing executions,
binding a trigger, `rollback`, `fork` — and right now you scrape the UUID from
scrollback or call `list_workflows` and match by name. That's error-prone and
agent-hostile (UUIDs copy-pasted from terminal history).

## Why it matters

"Notify / automate when X happens" workflows get published repeatedly across
QA → prod, often by an AI agent. A recorded ledger turns "what's the prod id for
this workflow?" into a deterministic file read instead of a lookup-and-match.
It also gives humans and agents a single source of truth for what is live where.

## Proposed change

### (A) CLI: `push` upserts a deployment record (the write)

After a successful `finalize`, `push` writes/updates `deployments.toml` beside
the manifest, keyed by environment:

```toml
[prod]
base_url = "https://api.pegasus.dolas.dev"
workflow_id = "f8077342-2e58-4dc1-a47a-797ca394ef72"
version = "0.1.0"
visibility = "GLOBAL"
published_at = "2026-06-26T21:05:48Z"
```

- **Idempotent:** re-publishing to the same `base_url` updates that entry in
  place (no duplicates); publishing to a new env adds a new table.
- **Env key:** derived from `--base-url`, or supplied explicitly via a new
  optional `--env NAME` flag (recommended — URLs are clumsy as keys).
- **Multi-workflow projects:** a project with N `[[workflow]]` tables records
  all N, namespaced by workflow name (e.g. `[prod.send_order_saved_sms]`).
- `push` prints the path it updated.

### (B) MCP: a read-only `list_deployments` (the read)

Add a read-only MCP tool `list_deployments(project_dir)` (and/or a
`pegasus://reference/deployments` resource) that parses `deployments.toml` and
returns the records. This stays consistent with the MCP server's no-mutation
rule — the **write** happens in the CLI `push`, never over MCP — while letting an
agent answer "where is this deployed / what's its prod id" without scraping.

### Docs

Document the file format and the post-publish write in the SDK README `push`
section; note the file is safe to commit (no secrets — ids and URLs only).

## Acceptance criteria

- [ ] After `pegasus-workflows push --base-url=X`, a `deployments.toml` is
      created/updated beside the manifest with an entry for that environment
      containing `workflow_id`, `version`, `visibility`, `published_at`, `base_url`.
- [ ] Re-publishing to the same `base_url`/env updates the existing entry in
      place — no duplicate table.
- [ ] Publishing the same project to a second `base_url` adds a second entry;
      both coexist.
- [ ] A project with N `[[workflow]]` tables records all N, keyed by name.
- [ ] `push` prints the path of the file it wrote/updated.
- [ ] MCP `list_deployments(project_dir)` returns the parsed records and performs
      no network or write (read-only).
- [ ] The file format + post-publish behavior are documented in the SDK README.
- [ ] (Nice-to-have) `--env NAME` sets the environment key instead of deriving
      it from the URL.

## Validation log

<!-- Filled in when the SDK ships this and validation runs in the
     pegasus-workflows repo. Plan: re-publish send_order_saved_sms to QA, confirm
     push rewrites deployments.toml in place (matching the hand-maintained one),
     and that MCP list_deployments returns both envs. -->
