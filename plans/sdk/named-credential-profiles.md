# SDK spec — Named credential profiles (AWS-CLI-style) for publishing

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0004-named-credential-profiles.md`
- **Status:** Shipped
- **Filed:** 2026-06-26
- **SDK version when filed:** 0.2.0
- **SDK version that addresses it:** 0.6.0
- **Area:** CLI (`push`/`run`/`integration-config`) / auth / tooling (MCP)

## Problem

Every command that talks to the API (`push`, `run`, `integration-config`) needs
a `vnd_` token **and** a base URL, supplied as `--token`/`--base-url` flags or
the `PEGASUS_WORKFLOW_TOKEN` env var. There is no place to _store_ a named set of
credentials, so in practice the token gets pasted on the command line or into a
chat with an agent — which is exactly how two live keys (QA + prod) ended up in
plaintext conversation history while publishing `send_order_saved_sms`.

There is also no notion of "environments." QA and prod differ only by token +
base URL, but the caller re-types both every time and it's easy to point the
wrong token at the wrong URL.

## Why it matters

This is a security and ergonomics problem at the same time. Secrets on the
command line leak into shell history, process listings, and agent transcripts.
And the repetitive `--token=… --base-url=…` is error-prone precisely where a
mistake is most costly (publishing to prod). The AWS CLI solved this years ago
with named profiles in `~/.aws/credentials`; we want the same model.

## Proposed change

### Profiles file

A **local, uncommitted** profiles file the SDK creates and reads — default
`~/.pegasus/credentials` (home dir, like AWS; inherently outside any repo). TOML
(the SDK already depends on `tomllib`), one table per profile:

```toml
[default]
api_key = "vnd_…"
# api_root optional — defaults to https://api.pegasus.dolas.dev
api_root = "https://api.pegasus.dolas.dev"

[qa]
api_key = "vnd_…"
api_root = "https://api.pegasus-qa.dolas.dev"

[prod]
api_key = "vnd_…"
api_root = "https://api.pegasus.dolas.dev"
```

- `api_root` is optional and **defaults to `https://api.pegasus.dolas.dev`**.
- The file is created with `0600` perms. An optional project-local
  `./.pegasus/credentials` may override the home file; if the SDK writes one, it
  also ensures it is gitignored. (The pegasus-workflows repo already gitignores
  `.pegasus/` and `pegasus-credentials.toml` defensively.)

### Using a profile

```bash
pegasus-workflows push --profile prod        # token + root from [prod]
pegasus-workflows push                       # uses [default]
pegasus-workflows run --profile qa <id>
```

`--profile` works on **every** command that builds a `PegasusClient`.

**Resolution precedence** (highest first), so explicit always wins:

1. explicit `--token` / `--base-url` flags
2. `--profile NAME`
3. `PEGASUS_WORKFLOW_TOKEN` / `PEGASUS_BASE_URL` env vars
4. the `[default]` profile

### Managing profiles

A command to create/update without hand-editing (cf. `aws configure`):

```bash
pegasus-workflows configure --profile prod      # prompts for api_key (hidden) + api_root
pegasus-workflows profile list                  # names + api_root only — NEVER prints api_key
```

### MCP

Secrets must never cross the MCP boundary: the MCP server must not return
`api_key` values. At most, a read-only `list_profiles` may expose profile
**names + api_root** (no keys). If MCP tools that need a client (e.g.
`validate_integration_config`) gain a `profile` argument, the key is resolved
server-side and never echoed.

### Relationship to other specs

The profile name is the natural environment key for the
[post-publish-deployment-recording](post-publish-deployment-recording.md) spec's
`deployments.toml` (`--profile prod` → record under `[prod]`), unifying "which
creds" and "which environment."

## Acceptance criteria

- [ ] The SDK reads a TOML profiles file at `~/.pegasus/credentials` with one
      table per profile (`api_key`, optional `api_root`).
- [ ] Omitting `api_root` defaults it to `https://api.pegasus.dolas.dev`.
- [ ] `pegasus-workflows push --profile NAME` authenticates with that profile —
      no `--token`/`--base-url` needed — and `--profile` is accepted by every
      command that builds a client.
- [ ] Resolution precedence is: explicit flags > `--profile` > env vars >
      `[default]`.
- [ ] A `configure`/`profile set` command creates/updates the file with `0600`
      perms; `profile list` shows names + `api_root` and never prints `api_key`.
- [ ] A project-local profiles file, if written by the SDK, is gitignored; the
      home file is documented as never committed.
- [ ] No `api_key` is ever returned through the MCP server.
- [ ] The profiles file + precedence are documented in the SDK README.

## Validation log

**Shipped in 0.6.0:** `~/.pegasus/credentials` TOML profiles (new
`pegasus_workflows.credentials` module); `configure` writes the file `0600`,
`profile list` shows names + api_root only. `--profile` accepted by every API
command; precedence is explicit flags > `--profile` > env vars > `[default]`;
profile `api_root` defaults to `https://api.pegasus.dolas.dev`. Read-only MCP
`list_profiles` never returns `api_key`. Unit-tested in `tests/test_credentials.py`
and `tests/test_cli_profile.py`; CLI binary verified (0600 perms, key masked).

<!-- Remaining manual validation in the pegasus-workflows repo: create a [qa]
     profile, run `pegasus-workflows push --profile qa` with no token/url flags,
     confirm it publishes to QA. -->
