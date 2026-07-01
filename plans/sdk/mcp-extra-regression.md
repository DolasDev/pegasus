# SDK spec — MCP deps must ship in the base package (the `[mcp]` extra broke `setup`'s promise)

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0012-mcp-extra-regression-in-0.8.0.md`
- **Status:** Shipped (0.8.1)
- **Filed:** 2026-07-01
- **SDK version when filed:** 0.8.0
- **SDK version that addresses it:** 0.8.1
- **Area:** packaging (deps) / CLI (`setup`, `mcp`) / docs

## Problem

The MCP server dependency (`mcp`/FastMCP) was gated behind an optional `[mcp]`
extra, so a clean `pip install pegasus-workflows-sdk` (the command the README and
`CLAUDE.md` tell people to run) did **not** install it. `pegasus-workflows mcp`
then hard-failed on its guarded import.

This directly undercut the 0.8.0 `unified-setup-bootstrap` (0010): `pegasus-workflows
setup` registers a `pegasus` MCP server in `.mcp.json`, but on a clean install that
server could not start — the onboarding path (`pip install` → `setup` → author with
an MCP-connected agent) dead-ended at the first agent launch with an `ImportError`,
and the fix was only discoverable by triggering the failure. An in-place upgrade
(0.6.0 → 0.8.0) masked it because the old `mcp` package lingered; only a clean
install (a new author or CI) exposed the gap.

## Proposed change (chosen: option 1 — restore base-package behavior)

Move `mcp` back into the **base** dependencies so `pip install
pegasus-workflows-sdk` ships a working MCP server, matching what the docs claim and
what `setup` assumes. Keep `[mcp]` as a **no-op alias** so existing
`pip install 'pegasus-workflows-sdk[mcp]'` commands still resolve. Make the docs
agree.

## What shipped (0.8.1)

- `pyproject.toml`: `mcp>=1,<2` moved into `[project.dependencies]`; the `[mcp]`
  optional-dependency is now an empty no-op alias.
- `mcp_server.py`: the missing-dependency message + command docstrings point at a
  base reinstall (`pip install --upgrade pegasus-workflows-sdk`), not the extra.
- README (`Install` / `First-run setup` / AI-agent section) updated to the plain
  install; the tenant-web Developer page's Workflows SDK card likewise shows the
  plain `pip install pegasus-workflows-sdk`.
- Tests: a packaging regression test asserts `mcp` is a base dep and the extra is a
  no-op; the 4 previously-skipped MCP tests now run unconditionally.

## Acceptance criteria

- [x] In a clean virtualenv, plain `pip install pegasus-workflows-sdk` yields a
      `pegasus-workflows mcp` server that starts (FastMCP import + `_build_server`
      succeed).
- [x] Package metadata and the documented install command agree — no doc/packaging
      contradiction (`mcp` is a base dep; docs say plain install).
- [x] `pegasus-workflows setup` on a clean install no longer registers a `pegasus`
      MCP server that can't start.
- [ ] `CLAUDE.md` Environment note (pegasus-workflows repo) reconciled to the
      base-package model — validated in that repo's feedback loop (step 4).

## Validation log

<!-- Filled in during step 4 in the pegasus-workflows repo: throwaway venv, plain
`pip install 'pegasus-workflows-sdk==0.8.1'` (no extra), run `pegasus-workflows mcp`,
confirm it starts; confirm metadata vs documented install command agree. -->
