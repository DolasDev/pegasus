# Sources

`registry.yaml` is the index of every source considered — internal, public,
gated, analyzed or not. One folder per source id holds what we stored and what we
concluded:

```
sources/
  registry.yaml          # the index (schema at the top of the file)
  inbox/                 # drop zone for material the user obtains (gitignored)
  <id>/
    captured/            # committed: material we may keep (open-license specs, excerpts, notes of pages)
    local/               # gitignored: licensed / gated / large binaries — recorded in the registry
    analysis.md          # phase 2, from ../templates/source-analysis.md
```

## Storage policy

| Material | Where | Why |
| --- | --- | --- |
| Open-license specs (OpenAPI, XSD, JSON-LD, markdown) under ~2 MB | `<id>/captured/` (committed) | durable, diffable, greppable |
| Public web pages with no stated license | `<id>/captured/` as **notes + short quoted excerpts** with URL and date, not a full mirror | citeable without republishing |
| Licensed, paywalled, partner-gated, or customer-provided documents | `<id>/local/` (gitignored) | we may use it but must not redistribute it via the repo |
| Large binaries (PDF, XLSX) of any license over ~2 MB | `<id>/local/` (gitignored) | same precedent as `docs/2026-400ng.pdf` |
| Material already elsewhere in this repo | referenced by path in the registry, not copied | one copy |

Every `local/` file gets a registry `files` entry with `sha256`, `retrieved`, and
the URL or person it came from, so it can be re-obtained on another machine.

> **Durability gap.** `local/` exists only on the machine that holds it. If the
> licensed material matters long-term, move it to a private bucket and record the
> bucket key in the registry.

## Inbox workflow

When a gated item is requested (registry `status: needs-user`), drop the file in
`inbox/` named `<source-id>--<anything>.<ext>`. Processing moves it into
`<id>/local/` (or `captured/` if its license allows), records hash + date in the
registry, and flips the status to `obtained`.

## Two rules about captured material

1. **It is never reformatted.** `.prettierignore` excludes `docs/domain-reference/sources/` at the
   repo root. These files are the artefact we cite, their sha256 is recorded in `registry.yaml`, and
   a formatter rewriting them would silently break that correspondence.
2. **Build scripts are trimmed, specs are kept.** Cloned upstream repos carry their own `*.sh` build
   tooling, which is not evidence and which the repo's `shellcheck` hook would lint as if it were
   ours. Removed on capture (2026-09-17): 12 scripts from the DCSA, GS1 EPCIS and MilMove-docs
   clones. Specs, schemas, ontologies and docs are untouched.

### Capture only what is cited

Committing an entire upstream repository drags it through **our** tooling: prettier reformats it,
shellcheck lints its build scripts, dependency review reads its manifests as if they were our
dependencies, and secret scanning flags the example tokens published in its own documentation. All
four fired on the first push (PR #705).

The rule that follows: **commit the artifacts the analyses cite; keep the full clone in `local/`.**
- `<id>/captured/` — the specs, schemas and docs we actually read and cite.
- `<id>/local/full-clone/` — the complete upstream tree, gitignored, still on disk for re-reading.
- Never committed from a clone: dependency manifests (`package.json`, `pom.xml`, lockfiles),
  build tooling (`Makefile`, `*.sh`), CI configuration, or documentation of the upstream project's
  own development process. None of it is evidence about the domain.

Trimmed on 2026-09-18: GS1 EPCIS (to schemas, context, XSD and JSON examples), DCSA (to the
`domain` / `tnt` / `bkg` / `cs` specs), MilMove docs (to ADRs, backend guides, API docs and
integrations). `registry.yaml` still records the upstream URL, retrieval date and sha256 for each,
so the full artefact remains reproducible.
