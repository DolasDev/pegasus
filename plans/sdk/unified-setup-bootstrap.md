# SDK spec — Unified `setup` bootstrap (MCP wiring + profile seeding)

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0010-unified-setup-bootstrap.md`
- **Status:** Shipped (0.8.0)
- **Filed:** 2026-06-30
- **SDK version when filed:** 0.6.0
- **SDK version that addresses it:** 0.8.0
- **Area:** CLI / tooling (MCP) / docs

## Problem

A first-time user (or their AI agent) reaching for the obvious onboarding entry
point finds nothing. There is no `pegasus-workflows setup`, and neither `--setup`
nor `--configure` is a top-level flag. The actual first-run steps are spread
across three places a newcomer has to already know about:

1. `pip install 'pegasus-workflows-sdk'` to get the SDK + MCP deps.
2. `pegasus-workflows configure` to seed a `~/.pegasus/credentials` profile
   (shipped in 0.6.0 — see `named-credential-profiles.md`).
3. Wire `pegasus-workflows mcp` (a stdio server) into the agent's MCP config by
   hand — the SDK gives no command to emit or register that snippet.

`pegasus-workflows mcp` only _starts_ the server; nothing tells the agent host
(Claude Code `.mcp.json`, Cursor, Windsurf, …) that it exists. Concretely, this
question came up while authoring in the pegasus-workflows repo ("is there an
`--setup`/`--configure` that installs the MCP server and sets up credential
profiles?") and the answer was no — the pieces exist but there is no single front
door.

## Why it matters

The whole point of `ai-authoring-mcp-server.md` is that _any_ SDK user with _any_
capable agent gets full authoring context with minimal setup. That promise leaks
at onboarding: discovering the MCP server, hand-writing the JSON stanza, and
separately seeding credentials is exactly the friction the MCP work was meant to
remove. Every new tenant author and every fresh machine pays this cost, and the
manual MCP-config edit is the step most likely to be done wrong or skipped — at
which point the agent silently authors without the guide and the value of the MCP
server is lost. There is no acceptable "just read the docs" workaround: the gap
_is_ discoverability.

## Proposed change

A single guided command that performs first-run setup and is itself
discoverable (`pegasus-workflows setup`, with `--setup`/`--configure` mentioned
in top-level `--help` so the obvious guesses land somewhere).

```bash
pegasus-workflows setup
#  → seeds/updates a credential profile (delegates to `configure`)
#  → detects the agent host and offers to register the MCP server
#  → prints next steps
```

Behavior:

- **Profile seeding.** Reuses the `configure` flow (prompt for hidden `api_key` +
  `api_root`, write `~/.pegasus/credentials` at `0600`). `--profile NAME`
  selects which profile. If the profile already exists, offer to keep or replace.
- **MCP registration.** Detect the calling agent host and write the correct MCP
  stanza, or print it for manual paste. For Claude Code this is a
  `pegasus` server entry in the project (or user) `.mcp.json`:

  ```json
  {
    "mcpServers": {
      "pegasus": { "command": "pegasus-workflows", "args": ["mcp"] }
    }
  }
  ```

  Provide `--print-mcp-config` to emit the stanza to stdout (no file writes) so
  unsupported hosts and CI can consume it. Never overwrite an existing `pegasus`
  entry without `--force`.

- **Idempotent & non-interactive friendly.** Re-running is safe. Flags
  (`--profile`, `--api-key`, `--api-root`, `--print-mcp-config`, `--force`)
  cover the non-interactive path; with all inputs supplied it must run with no
  prompts (for scripted/agent use).
- **No secrets to MCP, no network mutation.** `setup` only writes local config;
  it performs no publish/run. The api_key is written only to the `0600`
  credentials file, never to `.mcp.json` (the server resolves creds itself).

Backward compatible: a brand-new command; `configure`, `profile`, and `mcp`
keep working unchanged. `setup` is a convenience front door over them.

## Acceptance criteria

- [ ] `pegasus-workflows setup` exists and appears in `pegasus-workflows --help`.
- [ ] Top-level `--help` (or the `setup` help) points users who guess
      `--setup`/`--configure` to the right command.
- [ ] `setup` seeds/updates a `~/.pegasus/credentials` profile at `0600`
      (same result as `configure`), honoring `--profile`.
- [ ] `setup` writes a correct, valid MCP stanza for Claude Code (a `pegasus`
      entry running `pegasus-workflows mcp`) into `.mcp.json`, and refuses to
      clobber an existing `pegasus` entry without `--force`.
- [ ] `pegasus-workflows setup --print-mcp-config` prints the stanza to stdout
      and writes no files.
- [ ] With all inputs passed as flags, `setup` completes with zero interactive
      prompts (scriptable).
- [ ] `setup` performs no network calls and writes `api_key` only to the
      `0600` credentials file — never into `.mcp.json` or any committed file.
- [ ] The onboarding flow (`pip install` → `setup` → start authoring) is
      documented in the SDK README.

## Validation log

<!-- Filled in during step 4 of the feedback loop (in the pegasus-workflows
repo) once the SDK ships: check `setup` exists and is discoverable, that it seeds
a 0600 profile and writes/prints a valid `.mcp.json` stanza (respecting --force),
runs prompt-free with all flags, and performs no network calls. -->
