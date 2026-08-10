# Variable ↔ workflow/integration cross-reference + add-missing flow

## Problem

Half of this shipped in #531/#538/#540. The **forward** direction exists: a workflow or
integration config declares `requiredSecrets` / `requiredConfigs` in its manifest, and
`GET /api/v1/workflows/requirements-summary` + `GET /api/v1/integrations/requirements-summary`
resolve those declarations against the tenant's store, tagging each key present/missing
(presence only, never values). The workflow detail page and the integration detail page each
render a "Secrets & configuration" list from that.

The **reverse** direction was never built. On Settings → Developer → Configs, a row for
`STRIPE_API_KEY` shows the key, group, and value controls — nothing about who consumes it.
There is no "Used by" anywhere in the SPA (`grep -ri "used by\|usedBy\|consumers"` over
`apps/tenant-web` returns nothing). Two concrete consequences:

- Deleting a key three workflows depend on gives no warning. The delete dialog says
  "Workflows that read it will fail until it is recreated" — generically, without naming any.
- The `MissingRequirementsBanner` lists _workflows/integrations_ with a missing count, so
  filling a gap means: read the banner → click into the workflow → note the key and group →
  come back → click Add → retype it. Nothing carries over.

## Approach

Client-side inversion. Both summary payloads already carry every
`(consumer → requirement)` pair, so the reverse index is a pure transform of data the page
already fetches: **no API change, no new endpoint, RBAC unchanged**. Because there is no API
change, the SDK-discoverability rule in CLAUDE.md does not trigger — the two endpoints are
already documented in the SDK README, MCP resources, and OpenAPI.

## Units

### 1. `features/settings/variable-usage.ts` — the pure index (+ hook)

- `buildVariableUsageIndex(wf, intg)` → `Map<usageKey(kind, group, key), VariableUsage>`, where
  `VariableUsage = { kind, group, key, description, consumers: Consumer[], present }` and
  `Consumer = { type: 'workflow' | 'integration', id, name }`.
- Match on the **full tuple** `(kind, group, key)`: a secrets row only matches `SECRET`
  requirements, a configs row only `CONFIG`. Groups arrive already defaulted to `global`
  server-side, so no client normalization.
- **Dedupe consumers by `(type, name)`, not by id.** `listForTenant` returns every workflow
  _version_ as its own row with its own `workflowId` (that is why the workflows settings page
  collapses to latest-per-name, #418). Deduping by id would dedupe nothing and render
  `my-workflow, my-workflow, my-workflow`. Keep the first id as the link target.
- `missingVariables(index)` → the deduped `(kind, group, key)` tuples with no store entry,
  each carrying its consumer list — the key-centric view of what the banner shows per-consumer.
- `useVariableUsage()` wraps both summary queries with `retry: false` and **fails open**: a
  user holding `workflow_secret:manage` but not `ReadWorkflow` still gets a working panel,
  just with no "Used by" annotations. Mirrors the existing banner's independent-fail-open.

### 2. Unit tests for the pure module

Multi-version dedupe, kind/group tuple matching, mixed workflow+integration consumers,
missing-vs-present split, and empty/undefined payloads (the fail-open path).

### 3. Panel wiring — `features/settings/WorkflowSecretsConfigs.tsx`

- **"Used by" on every row** in both the Secrets and Configuration tables: consumer names as
  links to the workflow/integration detail page, overflow collapsed to "+N more". Silent when
  the index is empty (fail-open, or genuinely unreferenced).
- **Replace `MissingRequirementsBanner` with a key-centric list**: one row per missing
  `(kind, group, key)`, showing the declared description and who needs it, with an **Add**
  button. The button is kind-gated — a missing `SECRET`'s Add only renders for
  `workflow_secret:manage`, a `CONFIG`'s for `workflow_config:manage`, mirroring how the
  sections already self-hide.
- **Prefill**: Add opens that section's existing create form with key + group + description
  filled, leaving the user to type only the value. Lift a `prefill` object to the panel and
  pass it down; apply it in each section via an effect. Carry a **nonce** on the prefill
  object — two clicks on different missing keys can otherwise produce an identical object and
  an identity-based effect would not refire.
- **Name the blast radius on delete**: pass the row's consumers into `ConfirmDeleteDialog` so
  it names them instead of warning generically. This is the motivating case for the feature.

### 4. Component test for the panel

Stubbed summaries → asserts "Used by" renders deduped across versions, the missing list is
key-centric, Add prefills the form, and the delete dialog names consumers.

## Out of scope

- No API/handler changes; no SDK version bump.
- Detail pages already link to the Configs page for missing values — left alone.

## Verification

`npm run typecheck` + `npm run lint` + `npm test` for `apps/tenant-web`, then the
`apps/tenant-web:verify` skill to drive the real SPA against stubbed summary responses —
which is also the visual check for the version-dedupe bug.
