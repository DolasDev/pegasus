# Plan: discriminated inbound validation (`oneOf` variants) for multi-shape push partners

**Goal:** let a config author express "the ingress body must match one of several allowed shapes" so a partner that POSTs structurally different bodies to a single ingress id (ADE Abstract & Statement → `sirva_ade_compensation`) gets correct malformed→`Failed` acks. Platform + SDK only; the compensation config itself is authored + published later in the workflow repo.

## Why `oneOf`, not a discriminator path (design reconciliation)

The selected option's preview showed `discriminator: "Transaction"` + value-keyed variants. But the real ADE payloads (verified from the Abstract & Statement PDF) have **no top-level discriminator**: `Transaction` (`AbstrctOrgnl`/`AbstrctAdj`/`Stmt`) lives _inside_ the `StatementEntry[]` / `PostingTickets[]` array items. The two bodies are distinguished by **which top-level structure is present**:

- Abstract: `{ …, AgentNbr, StatementEntry: [ {…} ] }`
- Statement: `{ AgentStatementHdr: { …, AgentNbr }, PostingTickets: [ {…} ] }`

So variant selection must be **presence-based**, not value-at-a-path. `oneOf` (body is valid iff it fully satisfies ≥1 variant block) expresses exactly this, needs no discriminator, and stays fully back-compatible.

## Contract

`ingress.ts` `InboundValidation` gains an optional `oneOf`:

```jsonc
"validation": {
  "requiredPaths": [...],          // existing AND checks — applied to EVERY body first (common invariants)
  "nonEmptyArrayPaths": [...],     // existing
  "oneOf": [                        // NEW: if present, the body must fully satisfy at least ONE block
    { "requiredPaths": ["AgentNbr"],                  "nonEmptyArrayPaths": ["StatementEntry"] },
    { "requiredPaths": ["AgentStatementHdr.AgentNbr"], "nonEmptyArrayPaths": ["PostingTickets"] }
  ]
}
```

**Semantics** (in `validateBody`/`collectIssues`):

1. Apply top-level `requiredPaths`/`nonEmptyArrayPaths` (unchanged) → base issues.
2. If `oneOf` present: evaluate each variant's checks independently; if **any** variant yields zero issues → the `oneOf` contributes no issues. If **all** fail → contribute a single clear issue (`code: "NO_VARIANT_MATCH"`, message naming the expected shapes, e.g. `"Body matched none of the 2 accepted shapes."`), plus optionally the closest-variant detail. Back-compat: no `oneOf` ⇒ behaviour identical to today.
3. Empty `oneOf: []` ⇒ treat as absent (no-op), not "always fail".

`dedupKeyPath` stays a single optional path; when a variant lacks it (e.g. Abstract uses `StatementEntry.0.ReferenceNbr`, Statement uses `PostingTickets.0.ReferenceNbr`) dedup is best-effort and simply skips when the path is absent — **also** widen `dedupKeyPath` to accept `string | string[]` (first present path wins) so both variants dedup. (Small, additive; drop if it complicates review.)

## Changes

1. **`apps/api/src/lib/ingress.ts`** — extend the Zod `InboundValidation` schema + the `InboundValidation` TS type with `oneOf?: InboundValidation[]` (reuse the same shape, one level — no nested `oneOf`). Update `parseInboundValidation` to read `oneOf`. Update the issue collector to the semantics above. Optionally widen `dedupKeyPath`.
2. **inbound-schema** (served `GET /integrations/inbound-schema`, and the copy in `apps/api/src/lib/openapi-spec.ts`) — add `oneOf` to the published JSON Schema so it's discoverable + validatable.
3. **SDK docs / MCP** — `pegasus://reference/integration-config` (mcp_server.py) + README `inbound.json` section: document `oneOf` with the compensation worked example. No `publish/validate_integration_config` signature change (`inbound` is already free-form `Any`).
4. **pegasus-workflows CLAUDE.md** — note `oneOf` in the inbound block doc (folds into the existing PR #6 doc, OR a follow-up; not this PR).

## Tests (TDD, `apps/api`)

- `ingress` unit tests: (a) `oneOf` — Abstract-shaped body passes, Statement-shaped passes, neither → single `NO_VARIANT_MATCH` issue → `failure` ack; (b) top-level `requiredPaths` still AND-applied alongside `oneOf`; (c) no `oneOf` ⇒ byte-identical behaviour (back-compat); (d) `oneOf: []` no-op; (e) dedupKeyPath array first-present-wins (if implemented).
- openapi-spec test: served spec includes `oneOf` in the inbound schema.
- Coverage stays ≥ main floors; do NOT commit an autoUpdate floor raise.

## Out of scope / handoff

- Authoring + publishing `sirva_ade_compensation/inbound.json` — happens in the **workflow repo** (not published from this session). This PR only makes it _expressible + discoverable_.
- SDK version bump: **0.22.0** (docs-only SDK change) — tag + PyPI after merge.

## Acceptance

An agent reading only `GET /integrations/inbound-schema` + the MCP/README docs can author a compensation `inbound.json` using `oneOf` such that an Abstract POST and a Statement POST both ack `Success` and a malformed POST acks `Failed` — without reading platform source.
