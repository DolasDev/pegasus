# Pluggable data sources — correlation, declarative fetch, and entity→source binding

> **Status: APPROVED — Phase 1 SHIPPED and in production use. Phase 2 not started,
> and as of 2026-11-06 NO LONGER BLOCKED.** Phases land as separate PRs and serialize
> (schema.prisma + Cedar are merge magnets).

## Resume here

Written 2026-11-06 for a fresh session. Nothing in this workstream is committed yet.

### Where

- Branch `feat/atlas-fetch-phase2`, worktree `/home/steve/repos/pegasus-atlas-fetch-phase2`
  (isolated Postgres, provisioned by `scripts/workstream-start.sh`).
- Last commit `e0671fa7 chore(security): allowlist the qs and minimatch advisories` —
  that is **main's HEAD**, i.e. this branch has **zero commits of its own**.
- This file is the workstream's plan, seeded as a copy of
  `plans/in-progress/vanline-source-binding.md` (which still exists on `main`, carrying
  the stale "Phase 1 in flight" header). **Commit this file with the implementation**;
  decide at PR time whether to also fix or delete the `main` copy so the two do not drift.

### Status

- **2026-11-06, this session:** the grain decision was taken (option 3 — see "Next
  action" and "Decisions & dead ends"), `settlement-v1.json` was re-exported into
  `docs/atlas-world-group-api/openapi/`, and **Phase 2 increment 1 (the declarative
  authoring surface) was BUILT and is green** — see the Phase 2 checklist. Nothing is
  committed; the branch still has zero commits of its own.
- Phase 1 (correlation) — **`[x]` DONE, including the SDK**, and in production use:
  - `#648` API side, `#649` SDK 0.37.0 (published to PyPI). The plan's SDK checkbox was
    never ticked because the plan rode in on the `#648` branch; it IS shipped.
  - **Another workstream extended it**: `#812` / `sdk-feedback 0045` / SDK 0.46.0 gave
    `shipment_status_update` a correlation binding keyed on **pegII order number**, and
    added `correlation {outcome: "dryRun"}` to the offline `put_projection` result.
    Two floors now declare correlations (`shipment_status_update`, `financial_settlement`).
  - SDK is now at **0.56.0** — far past 0.37.0; re-read `api.py` before assuming shapes.
- Phase 2 (declarative fetch) — `[ ]` **not started**. Verified absent in code: no
  `apps/api/src/handlers/integration-fetch.ts`, no `lib/integration-fetch.ts`, no `fetch`
  column on `IntegrationConfig` in `apps/api/prisma/schema.prisma`, no `fetch_external`
  in the SDK.
- Phases 3–5 — `[ ]` not started.

### Next action

**The grain decision is MADE — 2026-11-06, option 3.** See
"Decisions & dead ends → the grain decision" below for the reasoning and the two
one-line corrections it implies. Net effect: **no migration, no new `entityType`, no
change to `IntegrationCorrelation`'s dual-unique contract**, so `#812`'s
`shipment_status_update` consumer is untouched.

Phase 2's **platform** work is unblocked, and **increment 1 of it is DONE** (the
declarative surface: column, `capabilities`, schema, gate, discovery endpoints, SDK
0.58.0 authoring half). All green, uncommitted.

**The next action is to land increment 1 as a PR**, then start increment 2 (the
`POST /integrations/:id/fetch/:operation` endpoint + `fetch_external`).

**All three DONE 2026-11-06** (kept for the record and the standing rule):

1. `[x]` Deleted `plans/in-progress/vanline-source-binding.md` in `#931`.
2. **Publish the SDK.** The bump is **0.58.0**, not 0.57.0 — `#930` (an unrelated
   `run`/`schedule` fix) was ahead in the merge queue and took 0.57.0. Worth knowing
   because the collision was nearly silent: `pyproject.toml` and `uv.lock` MERGE
   CLEANLY when two branches make the identical `0.56.0 → 0.57.0` edit, so only the
   CHANGELOG conflicted. A naive CHANGELOG resolution would have shipped two feature
   sets under one version number, and whichever got published would be missing half
   its changes. **Check the queue for a competing SDK bump before picking a version.**
   `[x]` Published: tag `sdk-python-v0.58.0` on the verified merge commit `a25ec20a`
   (not on `main` — an empty `mergeCommit` silently tags whatever `main` points at),
   release workflow green, and **0.58.0 confirmed live on PyPI** (wheel + sdist, with
   provenance). Note PyPI's `/pypi/<pkg>/json` endpoint is CDN-stale for a minute after
   a publish and still reported 0.57.0 — `/simple/<pkg>/` showed the artifacts
   immediately, so verify there.
3. `[x]` Committed `~/repos/pegasus-workflows/CLAUDE.md` (`103c3e7`, pushed straight to
   that repo's `main` — it takes no PRs), after the publish. It says
   "SDK 0.58.0+", so it must not land before 0.58.0 exists on PyPI. The split is
   deliberate: increment 2 must extract the outbound core out of
   `handlers/integration-call.ts` rather than copy it, which is a security-sensitive
   refactor that deserves its own review rather than riding along behind a schema change.

Phase 2's **pilot mapping** is still blocked, but now for one specific, answerable
reason rather than a general one — see "Still open → is a `Document` 1:1 with an
`orderNumber`". Build the platform surface against the descriptor shape; publish the
Atlas config only once a populated `settlementDate` exists.

A cheap, useful parallel task: finish the **docs PR**. `settlement-v1.json` is now
exported into `docs/atlas-world-group-api/openapi/` (it is the primary evidence for the
grain decision); `RadsData-v1` and `yembo-v2` are still missing, and
`docs/atlas-world-group-api/README.md`'s "Financial data — where settlements are not"
section is **factually wrong**.

### Uncommitted work

- `plans/in-progress/atlas-fetch-phase2.md` (this file) — untracked. Seeded plan **plus
  the 2026-11-06 grain decision**. The Atlas portal password that gotcha 5 used to quote
  verbatim has been **redacted** — the seed contradicted itself ("commit this file" vs.
  "do not put it in a commit"), and gitleaks would not have caught a 12-char
  alphanumeric. **Keep it redacted.**
- `docs/atlas-world-group-api/openapi/settlement-v1.json` — untracked, **new**. The
  re-exported spec; primary evidence for the grain decision. **Commit it** (it is also
  the first piece of the docs PR).
- `apps/e2e/.env.test` — worktree-local DB port written by the provisioner. **Never
  commit**; recurring churn.
- `package-lock.json` — churn from the provisioner's `npm install`. **Never commit**
  unless a dependency actually changed.

**Increment 1's implementation is also uncommitted.** New: `apps/api/src/lib/
integration-fetch.ts` (+test), `apps/api/src/integration-validation/gate-fetch.test.ts`,
`apps/api/prisma/migrations/20261106183000_integration_config_fetch/`. Modified:
`schema.prisma`, `integration-validation/{types,registry,gate-pipeline}.ts`,
`floors/financial-settlement.floor.ts`,
`repositories/integration-config.repository.ts`,
`handlers/integration-validation/{config,validate}.ts` (+their tests),
`lib/openapi-spec.ts`, and the SDK (`api.py`, `cli/integration_config.py`,
`cli/mcp_server.py`, `testing/__init__.py`, README, CHANGELOG, `pyproject.toml`,
`uv.lock`, `tests/test_cli_integration_config.py`).

**Outside this repo:** `~/repos/pegasus-workflows/CLAUDE.md` is modified too (the
authoring repo's `fetch.json` docs — a required discovery surface per this repo's
CLAUDE.md). It needs its own commit in that repo; it will NOT ride along with this PR.

Plan + docs files are Prettier-clean (`plans/` is formatted here and lint-staged runs
`prettier --write` on `*.md` / `*.json` at pre-commit).

### In flight

No PR for this branch yet, no background watchers, no CI or deploy runs started by this
session. `main` was green at `e0671fa7` (CI, Deploy and the daily Dependency Audit all
success).

**The increment-1 boundary, so the next session knows what is trustworthy.** Everything
listed `[x]` under Phase 2 increment 1 was run and passed in this worktree at
2026-11-06: `tsc --noEmit` clean, 4914/4914 API tests, 556/556 SDK tests,
`turbo run typecheck` 15/15, `turbo run lint` 10/10. The migration was applied to this
worktree's isolated Postgres via `prisma migrate deploy` (needed, or the repository
tests fail on the missing column). Nothing was run against staging or prod, and nothing
in increment 2 exists yet.

Unrelated but adjacent: `main`'s working tree in the primary checkout has an uncommitted
`plans/todo/durable-workflows-3c-followups.md` (91 added lines, a handoff note from the
durable-workflows workstream). **Not ours — leave it alone.**

### Decisions & dead ends

- **2026-11-06: the grain decision — OPTION 3, keep the 1:1 correlation.** The mismatch
  was a **record-identification error, not a contract defect**. Decided against the
  re-exported `settlement-v1` spec (now at
  `docs/atlas-world-group-api/openapi/settlement-v1.json` — read it, do not re-derive).

  **Why.** The floor's grain was always per-shipment, and two independent sources say so:
  its own header comment ("a settlement record binds to exactly one Pegasus shipment"),
  and the Sirva ADE precedent — `sirva_ade_compensation` maps one compensation statement
  per shipment, keyed `Brand:RegNumber:RegYear`
  (`docs/domain-reference/sources/sirva-ade/analysis.md`, A7/A9).

  Atlas's `Settlement` and `AgentSettlement` are a **remittance envelope** — a payment run
  across many orders — not the record. The spec is unambiguous: `Settlement` carries only
  `settlementDate` + three totals + `agentSettlements[]`; `AgentSettlement` adds
  `atlasPaymentNumber`, `settlementId`, `vendorId` + three totals. **Zero shipment
  attributes at either level.**

  The per-shipment record is the **`Document`**, which carries shipment identity _and_
  money: `orderNumber`, `shipper`, `customerName`, `invoiceNumber`, `documentNumber`,
  `documentAmount`, `totalLinehaulCommission`. Crucially `documentAmount` means
  `Totals.Net` is mappable with a single `$from` — the mapping DSL has **no arithmetic**
  (verified in `transform/mapping-format.ts`: `$from` / `default` / `$map` / `coerce` /
  `$each`, nothing else), so a `Document` without its own amount would have been
  unmappable. It has one.

  So: `recordsPath` points into `documents[]`, one `Document` → one `financial_settlement`
  record → one order. The 1:1 holds and nothing in Phase 1 changes.

  **Consequence to state up front, so nobody expects otherwise.** With `Id ← orderNumber`
  the projection key is **stable across settlement periods**, so each new period
  **overwrites** the row (version bump). That is `IntegrationProjection`'s own contract —
  _"last-known external state"_ — a projection is **not a ledger**. The payment-run
  aggregate (`atlasPaymentNumber`, run-level `netSettlement`) has no home in
  `financial_settlement`, and that is correct: a remittance / payment run is a **different
  data type** and earns its own floor when a tenant actually needs one. Per decision 3
  below, do not invent it now.

- **2026-11-06, falling out of the above: `localEntityType` should be `'order'`, not
  `'shipment'`.** A one-line floor edit, no migration — but it is a real correction, not
  cosmetics. There is **no Pegasus "shipment id" to supply**: shipments live in pegII and
  are addressed by **order number** (`services/pegii-orders.ts`,
  `/api/v1/pegii/orders/{orderNumber}`; `grep orderNumber apps/api/prisma/schema.prisma`
  returns nothing). `#812` already got this right — `shipment_status_update` declares
  `localEntityType: 'order'` for exactly this identifier. `financial_settlement`'s
  `'shipment'` names a kind the caller cannot produce.

  Safe to change because `localEntityType` is a **free string validated only against the
  floor's own declaration** — no enum, no FK, no registry (`integration-validation/types.ts`,
  `IntegrationCorrelationBinding`; enforced at `handlers/integration-projections.ts:204`).

  **Check before editing:** any `integration_correlations` row already written with
  `local_entity_type = 'shipment'` stops resolving, because the floor check rejects the
  old value on the next PUT and `findByLocal` keys on it. Query prod/staging for such rows
  and either migrate the value or confirm there are none. Do this as part of the floor
  edit, not after.

  Narrowed 2026-11-06: **no in-repo workflow writes one.** `grep -rn local_entity_type
packages/workflows-stdlib packages/workflows-sdk-python --include=*.py` finds the SDK
  plumbing and nothing else — `workflows-stdlib` never calls `put_projection` with a
  correlation, and the Sirva ADE analysis says the correlation to the RMC's id is precisely
  the gap, so ADE never correlated. Only **bespoke tenant code** could have written rows,
  which makes the query a "confirm zero" rather than an open-ended search.

  **But the SDK's own docs teach `'shipment'`, so the floor edit has discoverability blast
  radius** (per CLAUDE.md's SDK rule — a change must land on every discovery surface):
  - `packages/workflows-sdk-python/README.md` (~line 950) shows exactly
    `put_projection("atlas_settlement", "settlement", …, local_entity_type="shipment",
local_entity_id=shipment_id)` plus a matching `get_correlated_state(…, "shipment", …)`.
    This is the most likely source of any stray row, and it must change with the floor.
  - `pegasus_workflows/api.py` docstrings already say `e.g. "order"` and "the pegII order
    number", so the **docstrings and the README currently disagree** — the README is the
    wrong one.
  - `packages/workflows-sdk-python/tests/test_api.py` uses `"shipment"` in two places
    (fixtures only, no floor validation offline — harmless, but update for consistency).
  - Also sweep the authoring repo's `CLAUDE.md` (`~/repos/pegasus-workflows`) and the MCP
    resources, which is where an external author actually reads this.

- **2026-11-06: the Atlas settlements blocker is GONE.** Atlas added a `settlement-v1`
  API. This reverses the single biggest premise of the ⚠️ 2026-08-20 banner below and of
  the "pilot has no proven source" risk. Those are annotated, not deleted.
- **Phase 1's design call (Aug) held up.** The floor declares the entity _kind_ and the
  caller supplies the id, because a partner payload carries only the partner's
  identifiers. `#812` adopting the same mechanism for pegII order numbers is the
  evidence it generalized. Do not revisit it.
- **Dead end, Aug: `On-Behalf-Of`.** Never send it. Omitting it returns 200; sending any
  value returns 400 `"User is not allowed to make request on behalf of another user."`
  Re-verified 2026-11-06, unchanged. It is a _permission_ denial, so it could change if
  Atlas grants impersonation — but nothing may template it today.
- **Dead end: probing subscription scope with fabricated paths.** Every API returns 404
  for an unknown path regardless of grant, because APIM matches the operation before
  checking the key. Only a **real** path discriminates (401 = not granted).

### Gotchas

Each of these was measured this session and the next step depends on them.

1. ~~**The grain does not match our 1:1 correlation**~~ — **RESOLVED 2026-11-06 as a
   record-identification error, not a contract defect** (see "Decisions & dead ends →
   the grain decision"). One agent settlement does span many orders, but the
   `Settlement` / `AgentSettlement` levels are a **remittance envelope**, not the record;
   the record is the `Document`, which is per-order. Nothing in Phase 1 changes.

   **What survives as real work — the fan-out, now the load-bearing Phase 2 question.**
   The record is **two arrays deep** and two things it wants are **not on the element**:

   - `vendorId` and `settlementId` live only on the parent `AgentSettlement`. `$each`
     sub-templates are **element-relative**, so from inside a `Document` the parent is
     unreachable → `Reference.PartyId` cannot be mapped.
     **This costs less than it looks, but it is not free:** `PartyId` is not load-bearing
     for the key in the ordinary case — `projection.key` already falls back to `'?'`, so
     `orderNumber:?` is unique per order. A **per-tenant** overlay can supply its own
     `vendorId` as a literal `default`; a **GLOBAL** one (Phase 5) cannot, which is a
     reason not to promise `PartyId` globally.
     **The edge that is NOT just legibility:** if one response carries the same
     `orderNumber` under two `vendorId`s (two branches settling one order), both
     `Document`s collapse to the **same** `orderNumber:?` key — the second PUT silently
     overwrites the first's projection and the correlation returns `unchanged`, **not
     `conflict`**, so nothing surfaces. Moot for one-agent-per-subscription, but "whose
     identity the subscription key acts as" is still open (see "Still open"), so this
     cannot yet be ruled out. If it is possible, `PartyId` becomes mandatory and the
     parent hoist — branch (a) — stops being optional.
   - `recordsPath` must reach a **nested** array (`agentSettlements[*].documents[*]`),
     which exceeds the "one `recordsPath`" the C2 design promises. Note `documents[]`
     hangs off **both** `AgentSettlement` **and** `AgentSettlementDetail`, so the path
     choice is itself a decision, not a given.

   **The fork — a scope call on Phase 2, deliberately NOT resolved here:**
   (a) `recordsPath` grows a bounded nested path plus a declared parent-field hoist — a
   DSL addition, exactly the scope creep C2 warns about; or
   (b) fan-out is the pilot workflow's Python — the documented escape hatch, but then the
   pilot source is **not "config alone"**, which was Gap B's whole point.
   Decide this with populated data in hand — see the sub-question immediately below.

   **THE DOCUMENT-GRAIN SUB-QUESTION** (cited elsewhere by that name; it is deliberately
   not its own numbered gotcha, because the plan cites gotchas 2/3/8 by number and
   renumbering would break those references). **Whether a `Document` is 1:1 with an
   `orderNumber` is UNKNOWN, and the spec cannot settle it.** `orderNumber` recurs at
   **three** levels — `Document.orderNumber`, `DetailRecord.orderNumber`,
   `AdjustmentRecord.orderNumber`. If a Document's detail or adjustment records can carry
   a **different** order than the Document itself, the per-shipment record is a
   **group-by `orderNumber` across a nested envelope** — which no bounded `recordsPath`
   can express, and which forces branch (b) above. If they always match the parent
   Document, branch (a) stays viable. This is now **the sharpest form of the one remaining
   ask of Atlas** (gotcha 3), and it is what the populated `settlementDate` is actually
   needed to answer.

2. **The settlement response is double-encoded** — the body is a JSON **string** whose
   content is JSON, not an object. Phase 2's `recordsPath` design assumes an object and
   will break on the first call without an explicit decode step. Decode with
   `raw = json.loads(body); obj = json.loads(raw) if isinstance(raw, str) else raw`.
3. **QA has no settlement data.** 14 `settlementDate` values spanning 2024-12 → 2026-11
   all returned `200` with `agentSettlements: []`, `netSettlement: 0.0`, and
   `SettlementDate: "0001-01-01T00:00:00"` (.NET's default ⇒ "no record found", not
   "found but empty"). The shape below is from the **spec**, never observed populated.
   **The one open ask of Atlas is now just: a QA `settlementDate` that has data.**
4. **APIM's spec-export response shape CHANGED.** It is now flat `{"link": "..."}`; in
   August it was `{"value":{"link":"..."}}`. The recipe in
   `docs/atlas-world-group-api/README.md` §1 is wrong as written.
5. **The Atlas portal password was never rotated** — `dolasllc@gmail.com` /
   `<portal password — ask Steve; NOT rotated as of 2026-11-06>` still returns 200 on `/identity`. Steve was told twice. Do not rely on
   it persisting, and do not put it in a commit.
6. **The QA subscription key is still valid**: `~/.atlas-qa-key` (mode 600, 32 lowercase
   hex, sha256 head `c9d57d4dedfc`), untouched since 2026-08-20. Read it only inside
   command substitution so it never lands in a transcript.
7. **The grant is unchanged from August**: reachable = `agents-v1`, `customers-v2`,
   `estimating-v2`, `cubesheets-v1`, `documents-v1`, `shipment-management-v1`, **plus
   `settlement-v1`**. Still 401: `RadsSupport-v1`, `RadsSupport-v2`, `atlasorder-v1`,
   `RatingSystem-v1`, `finance-v1`, `customer-shipment-v1`.
8. **Worktree-isolation guard**: this session's Bash calls were refused for heredocs,
   `xargs`, runtime-computed `python3 -c`, and nested `base64` command substitution.
   Write a script to the scratchpad and run `python3 <path>` instead. `curl -u user:pass`
   avoids building an auth header by hand.

### The new Atlas settlements API (measured 2026-11-06)

Catalog grew 24 → 27 APIs. **Added**: `settlement-v1`, `RadsData-v1`, `yembo-v2`. None
removed, no revisions changed. `RadsData-v1` and `yembo-v2` were **not** probed for grant
or contents — unknown.

`settlement-v1` is **in our grant** (200) and declares **no** `On-Behalf-Of`:

```
GET https://qa-azapi.atlasworldgroup.com/settlement/v1/settlement
    ?settlementDate=<string, format date-time>      # the ONLY parameter, required
```

```
Settlement { settlementDate, netSettlement, totalCharges, totalDistribution,
  agentSettlements[] AgentSettlement {
      settlementId, vendorId, atlasPaymentNumber,
      netSettlement, totalCharges, totalDistribution,
      agentSettlementDetails[] AgentSettlementDetail { settlementId, vendorId,
          netSettlement, totalCharges, totalDistribution, documents[] },
      documents[] Document { orderNumber, ... detailRecords[], adjustmentRecords[] } } }
```

`Document` in full (verified against the exported spec, 2026-11-06) — note it carries its
own `documentAmount`, and carries **neither** `vendorId` **nor** `settlementId`:

```
Document { orderNumber, documentNumber, documentType, documentDescription, description,
  documentAmount, totalLinehaulCommission, invoiceNumber, controlNumber, memoType,
  shipmentType, shipper, customerName, salesPerson,
  detailRecords[]        DetailRecord     { orderNumber, documentNumber,
                                            documentDescription, documentAmount },
  adjustmentRecords[]    AdjustmentRecord { orderNumber, amount, memoType, reason,
                                            reasonCode, distributionCode, dueFrom, dueTo,
                                            comment, adjustmentDocumentNumber,
                                            agentInvoiceNumber, atlasInvoiceNumber },
  apDistributionRecords[], sopDetailRecords[], invoices[] }
```

Other schemas present: `APDistributionRecord`, `AdjustmentRecord`, `DetailRecord`,
`Document`, `Invoice`, `InvoiceDetailRecord`, `InvoiceDistributionRecord`,
`SOPDetailRecord`.

> **The mapping sketch that used to sit here was wrong and has been replaced.** It read:
> `settlementId → Id`, `vendorId → Reference.PartyId`, the totals triple → `Totals`,
> `agentSettlementDetails[] → LineItems[]`. That maps the **remittance envelope** onto a
> floor whose grain is one shipment — the error the 2026-11-06 grain decision corrects.

**Corrected mapping — the record is the `Document`** (full field lists in
`docs/atlas-world-group-api/openapi/settlement-v1.json`, exported 2026-11-06):

| canonical (`financial_settlement`) | Atlas (`Document`)                                      |
| ---------------------------------- | ------------------------------------------------------- |
| `Id`                               | `orderNumber` — stable across periods; see decision     |
| `Totals.Net`                       | `documentAmount` (a plain `$from`; DSL has no `$sum`)   |
| `Subject.ShipperLastName`          | `shipper` (also `customerName`)                         |
| `LineItems[]`                      | `detailRecords[]` + `adjustmentRecords[]`               |
| `Reference.PartyId`                | **unmappable** — `vendorId` is on the parent (gotcha 1) |

Deliberately unmapped: `atlasPaymentNumber`, `settlementId`, and the run-level totals.
They are **payment-run** attributes with no home in a per-shipment floor — a different
data type, a later floor.

**Re-exporting the spec.** The committed copy above is authoritative; re-export only to
check for drift. Four plain steps, split because of gotcha 8 — and note the export link
expires in ~5 minutes (the `python3` line must read its argument from a file, not from a
shell-computed variable, or the isolation guard refuses it).

**Do not collapse the `read`/`ATLAS_AUTH` line back into `curl -u 'user:password'`** — a
literal `user:pass` on a `curl` line trips Betterleaks' `curl-auth-user` rule and reds
Secret Scanning **even with a placeholder password**, which is how this very file first
failed CI. Hoisting it also keeps the real password out of shell history:

```
MGMT=https://atlas-qa-api-apim.management.azure-api.net/subscriptions/000/resourceGroups/000/providers/Microsoft.ApiManagement/service/atlas-qa-api-apim
read -rsp 'Atlas portal password: ' PW && ATLAS_AUTH="dolasllc@gmail.com:$PW" && unset PW
curl -sS -D id.hdr -o /dev/null -u "$ATLAS_AUTH" "$MGMT/identity?api-version=2021-01-01-preview"
grep -i '^Ocp-Apim-Sas-Token:' id.hdr | sed 's/^[^:]*: *//' | tr -d '\r' > sas.txt
curl -sS -o link.json -H "Authorization: SharedAccessSignature $(cat sas.txt)" "$MGMT/apis/settlement-v1?export=true&format=openapi%2Bjson-link&api-version=2021-01-01-preview"
curl -sS -o settlement-v1.json "$(python3 -c "import json;print(json.load(open('link.json'))['link'])")"
```

### Verification still owed

- **Nothing was run** in this worktree: no `npx tsc --noEmit`, no `npx vitest run`, no
  lint, no `npm run build`. There is no code to verify yet.
- The provisioner applied migrations to the isolated DB; that was not re-checked.
- `RadsData-v1` / `yembo-v2`: grant and contents unverified.
- The settlement payload has never been seen populated (gotcha 3), so any mapping written
  against the schema above is unvalidated against real bytes.

> **Sequencing correction (2026-08-21).** An earlier note claimed Phases 1, 3 and 4
> were source-agnostic and only Phase 2 waited on Atlas. That does not compile:
> Phase 3's `max_age`/`refresh` live ON Phase 2's fetch surface, so 3 depends on 2
> existing. The real order is **1 → 2-minus-pilot → 3 → 4**. Only Phase 2's pilot
> checklist item (and Phase 4's stdlib settlements workflow, same cause) waits for
> Atlas or a substituted capability.

> ### ⚠️ 2026-08-20 — live Atlas measurement invalidates two assumptions
>
> A working Atlas QA subscription key arrived and the API was exercised for the first time
> (`docs/atlas-world-group-api/README.md`, sections marked VERIFIED). Two things this plan
> assumed are false:
>
> 1. **`On-Behalf-Of` cannot be sent.** Atlas rejects it with `400` _"User is not allowed to
>    make request on behalf of another user."_ The example `fetch` block below templated
>    `{{config:ATLAS_USER}}` into that header; that would fail every call. Corrected in place.
> 2. ~~**The pilot capability `settlements` has no identified Atlas source.**~~ **OVERTAKEN
>    2026-11-06 — Atlas shipped `settlement-v1` and it is in our grant.** See "Resume here".
>    The original finding, true on 2026-08-20: "Settlement" appeared twice in Atlas's
>    then-24-spec catalog, both incidental; there was no settlements endpoint, and the
>    invoice-bearing APIs (`RatingSystem-v1`, `atlasorder-v1`, `authorizations-v1`) all
>    returned 401. Those three are **still 401** — what changed is that a purpose-built
>    `settlement-v1` API now exists alongside them.
>
> The plan's **architecture** is unaffected: nothing here depends on OBO, and capability names
> were deliberately left unfrozen. What changes is which capability can be piloted first, and
> that is now blocked on an answer from Atlas rather than on engineering.

> **Decisions taken 2026-08-06** (see "Decisions" at the foot for the reasoning):
>
> 1. **On-demand fetch stays.** Short-TTL read-through cache, **no single-flight** in v1.
> 2. **Binding is a tenant-level document**, not a column on `IntegrationConfig`.
> 3. **Capability names are not frozen.** The floor declares its capability list; only
>    `settlements` is needed to ship the pilot.

**Goal:** let a tenant fetch the same _kind_ of information — settlements first — from
whichever external source it actually uses (Atlas, Allied, United, a billing bureau, a TMS),
on demand, **without a new workflow per source**.

---

## Why this isn't already possible

The floor/overlay split already gets most of the way there, and that part needs no change:

- **Floors are per data TYPE and partner-neutral.** `financial_settlement` already exists and
  says so in its own header: _"any settlement / agent-compensation feed builds on this floor.
  Exposes only GENERIC facts; partner value sets live in the overlay rules."_
- **Overlays are per PARTNER and publishable as config** — per-tenant or GLOBAL. Two overlays
  on one floor already works in code (`demo_partner` and `allied_status` both sit on
  `shipment_status_update`; Allied is a vanline).
- **Per-tenant endpoints/credentials already resolve per tenant** out of the
  WorkflowSecretConfig store by group (`BASE_URL`, `AUTH_MODE`, keys), and #563 added
  `apikey` mode plus `headers`/`secretHeaders` so a named-header partner is reachable.

**Do NOT model "vanline" as a floor.** A vanline is a partner category, not a data type. A
tenant may take settlements from a source that is not a vanline at all. Binding the canonical
shape to _who_ the partner is rather than _what the data means_ would exclude those tenants
and duplicate every floor per carrier. The abstraction is the information.

Three things are genuinely missing.

### Gap A — the projection cache is keyed by THEIR identifiers, not ours

`IntegrationProjection` is unique on `(tenantId, integrationId, entityType, entityKey)` and
holds _"Last-known external state, in the integration's NATIVE payload shape"_
(`apps/api/prisma/schema.prisma`, `model IntegrationProjection`). `entityKey` comes from the
floor's `projection.key(o)`, which derives it **from the partner payload** —
`financial_settlement` builds `` `${o.Id}:${o.Reference.PartyId}` ``.

So "look up the cached external state for shipment S" cannot be expressed: you need the
partner's key to read the cache, and today you only learn that key _by fetching_. Without a
correlation, cache-then-fetch degenerates to always-fetch and the cache is dead weight on the
read path.

### Gap B — there is no declarative "how to fetch"

`IntegrationConfig`'s columns are `mapping`, `rules`, `corpus`, `gateReport`, `floor`,
`displayName`, `externalShape`, `externalMapping`, **`inbound`**, `requiredSecrets`,
`requiredConfigs`.

`inbound` describes **push** (which event to emit, how to dedup, how to shape the ack).
**Nothing describes pull.** `call_external` takes `method` and `path` _from the caller_, so
partner-specific transport knowledge — which path, which params select a period, how to page,
where in the envelope the records live — lives in workflow Python. That means **a new source
needs a new workflow**, even though its mapping and rules are pure config, which silently
breaks the "new partner = config alone" property the floor/overlay split otherwise buys.
(Confirming evidence: no workflow in `packages/workflows-stdlib` calls `call_external` at all —
every use today is bespoke tenant code.)

### Gap C — nothing binds an entity to a source

There is no config that answers "for this shipment, which integration provides settlements?"

---

## Design

### C1. Correlation — our entity ↔ their key

Add an explicit correlation record written on first successful fetch/ingest:

```
model IntegrationCorrelation {
  tenantId, integrationId, entityType,
  localEntityType, localEntityId,   // e.g. "shipment", <pegasus id>
  entityKey,                        // the projection's external key
  @@unique([tenantId, integrationId, entityType, localEntityType, localEntityId])
  @@unique([tenantId, integrationId, entityType, entityKey])
}
```

Both directions are unique, so it is a true 1:1 within an integration.

> **CONFIRMED 2026-11-06 — the dual-unique contract stands.** The Atlas grain decision
> (option 3) found no case against it: the apparent counter-example was the remittance
> envelope being mistaken for the record. Do not relax either unique without a second,
> genuinely many-to-one source — and note `shipment_status_update` is now a second
> consumer via `#812`.
>
> One operational note from that review: `localEntityType` is a **free string**, validated
> only against the floor's own `correlation` declaration. There is no registry, so the
> vocabulary drifts silently — `financial_settlement` says `'shipment'` while `#812`'s
> `shipment_status_update` says `'order'` for the same pegII identifier.
> `'order'` is correct (there is no Pegasus shipment id); `financial_settlement` is being
> corrected in Phase 2. **If a third floor declares a correlation, consider a registry.**

> **AMENDED 2026-08-21 during Phase 1 — the original wording could not be built.**
>
> It read: _"The floor gains an optional `correlation` descriptor naming which canonical path
> carries the local id, so the correlation is written by the SAME code path that already
> computes `projection.key` — no new partner-specific logic."_ Two things were wrong.
>
> **No canonical path carries our id.** A partner payload carries the PARTNER's identifiers.
> `financial_settlement`'s canonical shape exposes `Id` and `Reference.PartyId` — both theirs —
> and nothing of ours; `AgreementReference` is declared but referenced nowhere in the codebase,
> so treating it as our id would be a guess. Deriving our id from their payload also assumes it
> is embeddable in their surrogate, which is the assumption this very section rejects for the
> external key.
>
> **It is not one code path.** `projection.key` is invoked in exactly one place —
> `handlers/integration-validation/validate.ts`, the READ path, to resolve `prior`. That
> function is deliberately side-effect-free and fails open ("a projection problem must never
> block a save"), so it is the wrong place to write anything. Projections are WRITTEN through
> `PUT /runtime/:integrationId/:entityType/:entityKey`, where the key arrives from the caller.
>
> **What shipped instead.** The floor declares only what it genuinely knows — WHICH KIND of
> Pegasus entity its records describe (`correlation: { localEntityType: 'shipment' }`) — and the
> id is supplied by the caller that already holds it, on the projection PUT. The declaration is
> still load-bearing: the write path validates the caller's `localEntityType` against it, so a
> workflow cannot bind a settlement to a "vehicle" by typo. Correlations reuse the projection's
> RBAC actions rather than minting new ones, which keeps `authz/actions.ts` and Cedar — both
> named merge magnets in Risks — out of this phase entirely.

**Alternative considered:** derive the external key from the Pegasus entity via a formula in
config. Rejected — it assumes our id is embeddable in their key, which is false for any
partner that mints its own surrogate (Atlas's settlement `Id` is exactly that).

### C2. `fetch` — the pull counterpart to `inbound`

A new nullable `fetch` Json column on `IntegrationConfig`, holding **named operations** whose
names come from the floor's declared capability list (so every settlement source answers to
`settlements`):

```json
"fetch": {
  "settlements": {
    "method": "GET",
    "path": "/finance/v1/settlements",
    "query": { "from": "{{since}}", "to": "{{until}}" },
    "recordsPath": "Settlements",
    "page": { "style": "none" }
  }
}
```

> **The example above is illustrative only.** `/finance/v1/settlements` **does not exist**;
> `finance-v1` publishes exactly two operations (`/invoicedelivery/ReloDirectEntities`,
> `/invoicedelivery/MadEmails/{agentBranch}/{division}`) and returns 401 for our
> subscription regardless. The `On-Behalf-Of` header that previously appeared here has been
> removed: Atlas rejects it outright (see the banner).
>
> **The real Atlas descriptor, as far as 2026-11-06 can write it.** Transport is settled;
> the `recordsPath` is the open fork (gotcha 1 + the Document-grain sub-question), so it is shown as a question:
>
> ```json
> "fetch": {
>   "settlements": {
>     "method": "GET",
>     "path": "/settlement/v1/settlement",
>     "query": { "settlementDate": "{{settlementDate}}" },
>     "decode": "jsonString",
>     "recordsPath": "agentSettlements[*].documents[*]",
>     "page": { "style": "none" }
>   }
> }
> ```
>
> Three things this shows that the original example did not, and that the DSL must answer:
> a **`decode`** step (the body is a JSON string), a **nested** `recordsPath` (the record is
> two arrays deep), and the fact that the record's `Reference.PartyId` lives on a **parent**
> of the extracted element. `page.style: "none"` is honest, not lazy — `settlementDate` is
> the endpoint's _only_ parameter, so there is no paging surface to use.

**Bound the DSL hard.** The mapping format is deliberately not an expression language and a
fetch block is where that discipline usually dies. Permitted: `{{param}}` and `{{config:KEY}}`
substitution only (no arithmetic, no conditionals), a closed enum of `page.style`
(`none` | `pageNumber` | `cursor`), one `recordsPath`. Anything richer falls back to a bespoke
workflow — the same escape hatch the mapping DSL already documents.

Secrets are **never** inlined: header credentials go through `secretHeaders` (#563), which
resolves server-side. A `{{secret:…}}` substitution is deliberately NOT offered, so a
credential can never be templated into a URL or query string.

**Capability names are not frozen by this phase.** The **floor** declares its capability list
(`capabilities: ['settlements']` on `financial_settlement`); the `fetch` block and the binding
table both validate their operation/capability names against it at publish. So naming is a
floor change, not a schema migration, and adding or renaming later costs one code edit plus a
republish.

Only **`settlements`** is needed to ship the pilot. Deliberately do not invent
`documents`/`status`/`estimates` now: with one example there is nothing to check a naming
scheme against, and a name guessed now is a name we would be stuck matching later. Name the
second capability when a second domain is real — at that point there are two cases to
generalize over, which is the first moment the decision is actually informed.

### C3. Binding — (entityType, capability) → integration

Key on **(entity type, capability)**, not entity → integration: a tenant may take settlements
from source A and documents from source B for the same shipment.

**Decision: binding is its own TENANT-LEVEL document**, not a column on `IntegrationConfig`.
Three consequences that follow from that and shape the build:

- **One place answers "where does this tenant get X?"** Spread across per-integration configs,
  that question requires reading every config and mentally unioning them — and the failure mode
  we most need to prevent (two sources claiming the same capability) is invisible until you do.
  A single document makes overlap detection a property of one row set.
- **Lifecycles decouple.** Re-pointing settlements from Atlas to Allied is a routing change, not
  a mapping change; it should not bump an overlay version or re-run that overlay's corpus gate.
  Conversely a mapping fix should not touch routing.
- **Cost:** its own publish + validation path, its own RBAC action (`ManageIntegrationBinding`),
  and its own versioning/rollback. Do not reuse `IntegrationConfig`'s publish machinery
  wholesale — the shapes differ — but do reuse the _gate pattern_ (static checks + corpus).

Modeled as a decision table, matching the existing rules format:

```json
[
  {
    "id": "atlas-settlements",
    "capability": "settlements",
    "localEntityType": "shipment",
    "integrationId": "atlas_settlement",
    "priority": 100,
    "when": [{ "fact": "vanline", "op": "eq", "value": "ATLAS" }]
  }
]
```

- **Reuse the rules operator set** (`eq/ne/gt/gte/lt/lte/in/nin` over scalar facts) — one
  predicate vocabulary, statically checkable, corpus-testable.
- **But this is a different fact universe.** Rules today derive facts from a _native partner
  payload_; binding evaluates over _our own domain entity_. That means a new
  **entity fact source** (Pegasus entity → `Facts`) — real work, not free reuse. This is the
  largest single chunk in the plan and the most likely thing to scope down first.
- **Deterministic resolution.** Highest `priority` wins; ties are a **publish-time error**, not
  a runtime coin-flip — ambiguity about which carrier to call is a data-integrity bug. Reuse
  the existing gate (static checks + golden corpus) to reject overlaps.
- An explicit no-match outcome is required; no implicit default source.

### C4. Freshness + provenance (the contract that keeps this honest)

`IntegrationProjection` has a `version` counter but **no TTL and no `fetchedAt`** — `updatedAt`
means "when we last wrote a row", not "when this was true at the partner". A generic
`get_or_fetch` that silently returns it would answer a _different question_ than the caller
asked.

- Add `fetchedAt`, distinct from `updatedAt`.
- Freshness is **explicit at the call site**: `max_age` / `refresh=True`, over a short default
  TTL (start at 60s, per-capability overridable). The default must be _short enough that
  serving it is defensible_; anything longer belongs to an explicit `max_age`.
- The response **always** states provenance: `source: "cached" | "fetched"` and `as_of`. Same
  discipline as `attempts` on `call_external` — if the platform did something non-obvious on
  your behalf, the payload says so.

### C5. Rate budget = freshness policy

Agent-Limited's quota is still unpublished (only `starter`'s 5/min + 100/week is documented;
the enforced policies are 403 at developer role). On-demand fetch against an unknown budget is
how you discover the limit in production, and N users refreshing the same shipment is N partner
calls.

The outbound OAuth token cache is the near precedent: a per-container Map was **not** enough in
a horizontally-scaled Lambda (#521/#532/#535), which is why the shared L2 tier exists.

**Decision: short-TTL read-through, no single-flight in v1.** The OAuth case is _not_ the same
problem. There, a duplicate mint burned a rate-limited credential and the duplicate was
correctness-adjacent. Here the fetches are **idempotent GETs**, so a concurrent duplicate is
_wasteful, not wrong_. A short TTL bounds the exposure: the first request populates the cache
and everything inside the window hits it, so the worst case is a handful of redundant calls in
the miss window rather than one per user.

Building the coordination tier up front would be paying the expensive part of the design for a
problem we have no evidence we have. The provenance fields from C4 (`source`, `as_of`) plus the
existing `attempts` make the miss/duplicate rate **directly observable in production** — so the
decision to add single-flight can be taken on data instead of on speculation. Revisit if
observed duplicate-fetch rates matter against the (still unpublished) Agent-Limited quota.

**Design the freshness policy and the rate-limit policy as one thing**, not two — that part
stands; the TTL _is_ the rate control.

---

## Phases

Ordered by dependency, not visibility. Binding is the most visible piece and the least useful
first: without a fetch descriptor there is nothing generic to route _to_, and without a
correlation key the cache lookup cannot happen.

### Phase 1 — Correlation (Gap A) — API side `[x]`, SDK `[ ]`

- `[x]` `IntegrationCorrelation` model + migration + repository (+ 9 integration tests)
- `[x]` Optional `correlation` descriptor on `TypeFloor`; wired into the projection-write
  path (`PUT /runtime/...`), **not** the validate path — see the C1 amendment for why
- `[x]` `financial_settlement` declares its correlation (`localEntityType: 'shipment'`)
- `[x]` Read endpoint `GET /runtime/:integrationId/:entityType/by-local/:localEntityType/:localEntityId`,
  gated by the existing `ReadIntegrationProjection`, documented in OpenAPI
- `[x]` SDK: `get_correlated_state(integration_id, local_entity_type, local_entity_id)` —
  **SHIPPED** in `#649` as SDK **0.37.0**, published to PyPI, with the full discoverability
  sweep (README, CHANGELOG, MCP via docstring introspection, the authoring repo's
  `CLAUDE.md` at `~/repos/pegasus-workflows`, commit there). This box sat unticked only
  because the plan file rode in on the `#648` branch. `put_projection` also gained
  `local_entity_type` / `local_entity_id`. Extended later by `#812` (SDK 0.46.0); SDK is
  now 0.56.0.

### Phase 2 — Declarative fetch (Gap B) — increment 1 `[x]`, increment 2 `[ ]`

Split into two increments on purpose. **Increment 1 is the declarative SURFACE** —
column, schema, gate, discovery, SDK authoring — and lands without touching the
outbound security path at all. **Increment 2 is EXECUTION**, which does touch it
(`call-external` is a 300-line handler whose auth/headers/timeout/429-retry must be
reused, not re-implemented), so it gets its own review.

**Increment 1 — the authoring surface. DONE 2026-11-06, all green, NOT yet committed.**

- `[x]` `fetch` column on `IntegrationConfig` + migration
  (`20261106183000_integration_config_fetch`, nullable JSONB, no backfill, no index —
  deliberately trivial to rebase, since Phases 3 and 4 each touch `schema.prisma` again)
- `[x]` `capabilities` on `TypeFloor` → `IntegrationDefinition` → `registry.ts`, and
  `financial_settlement` declares `capabilities: ['settlements']`. **This had to come
  first**: it is what the gate's operation-name check reads.
- `[x]` Zod schema + `fetchBlockJsonSchema()` in `apps/api/src/lib/integration-fetch.ts`
  (mirroring `lib/ingress.ts`); served at `GET /api/v1/integrations/fetch-schema`
- `[x]` The **`decode` enum** (`none` | `jsonString`)
- `[x]` Publish-gate validation as TWO stages, matching the format/semantic pairing every
  other gate stage uses: `fetch-format` (shape) and `fetch` (content — capability names,
  reserved headers, the `{{secret:}}` refusal, paging coherence, GET-with-a-body). Both
  pure and synchronous, so the gate did not become async.
- `[x]` Wired at **all four** gate call sites — publish, dry-run validate, fork, rollback —
  and added to `carriedPublishFields`, whose comment exists precisely because `inbound`
  once went missing from the copy-forward paths.
- `[x]` SDK **0.58.0** (authoring half): `publish_integration_config(fetch=…)`,
  `validate_integration_config(fetch=…)`, `get_fetch_schema()`, CLI `fetch.json`
  (read AND written back by `pull`), MCP reference, README, CHANGELOG, `uv.lock`.
  `capabilities` reaches authors through the existing `get_floor()` — live
  introspection, no new static doc.
- `[x]` OpenAPI: the `fetch-schema` path, the publish body's `fetch` property, and the
  publish description.
- `[x]` Verification: `npx tsc --noEmit` clean; **4914/4914** API tests pass (318 files);
  **556/556** SDK tests; `turbo run typecheck` 15/15 and `turbo run lint` 10/10 green.
  New tests: 44 unit (`lib/integration-fetch.test.ts`), 13 wiring
  (`integration-validation/gate-fetch.test.ts`), 5 handler, 3 endpoint/floor, 1 SDK CLI.

> **A trap worth not re-stepping on.** `fetch` collides with the global `fetch`
> function, so a handler that destructures everything _except_ `fetch` still
> **typechecks** and silently hands the gate a function. The dry-run validate handler
> had exactly that shape; both authoring handlers now have a test asserting what
> reaches the gate is an object, and a comment saying why.

**Increment 2 — execution. Not started.**

- `[ ]` **Floor one-liner, decided 2026-11-06:** `financial_settlement`'s
  `correlation.localEntityType` → `'order'` (matching `#812`), **after** querying for
  existing `'shipment'` correlations. Deliberately NOT folded into increment 1: it has
  its own blast radius (the SDK README teaches `"shipment"`) and its own DB precheck,
  which cannot be run from this worktree. See "Decisions & dead ends".
- `[x]` ~~**Prerequisite: thread `fetch` into the resolved definition**~~ —
  **DISSOLVED 2026-11-06, the prescription was wrong.** It is true that
  `IntegrationDefinition` has no `fetch` field, but it does not need one: **`inbound`
  has no field there either.** The ingress handler reads the block straight off the
  config row (`handlers/ingress.ts`: `select: { inbound: true }`), and that is the
  precedent `fetch` follows. The machinery already exists —
  `integrationConfigRepository.findActiveForScope(integrationId, tenantId)` returns the
  `fetch` column (it is in `SELECT`) **and** implements tenant-wins-over-GLOBAL. So the
  runtime reads the descriptor off the scoped row and takes only `capabilities` from the
  definition, for the runtime name check.
  _Do not re-derive the threading model from an earlier draft of this bullet._
- `[x]` **Increment 2a — the PURE runtime core. DONE 2026-11-06, green, uncommitted on
  branch `feat/atlas-fetch-resolve-definition`.** Both in `lib/integration-fetch.ts`
  beside the gate code, both pure, so they are fully tested without an outbound call:
  - `resolveFetchOperation(rawBlock, capabilities, opName)` → the descriptor or a TYPED
    miss (`noFetchBlock` / `unknownOperation` / `notACapability` / `malformedBlock`), so
    the handler maps each to its own status instead of collapsing them to 404.
    It re-checks the capability name even though the gate already did — a stored row can
    outlive a floor that dropped a capability.
  - `substituteFetchTemplates(op, params, configs)` → fills `{{param}}` /
    `{{config:KEY}}` in path, query, headers and body (nested, shape-preserving).
  - Two correctness edges worth keeping: an **unfillable template is an ERROR, never a
    pass-through** (a leftover `{{settlementDate}}` on the wire returns an opaque partner
    400, so the real cause — a caller that forgot a param — would be invisible); and a
    **path** substitution may not introduce `/`, `?` or `#`, because a descriptor exists
    to constrain WHICH endpoint is called and caller-injected path segments would turn it
    back into an arbitrary-URL builder. Query and body values are exempt (encoded
    downstream, cannot change the request's shape). Substitution is single-pass, so no
    caller input can expand into another template.
  - 24 new tests (64 in `integration-fetch.test.ts`, 20 in `registry.test.ts`); full API
    suite 4938/4938, `tsc` clean, lint clean.
- `[ ]` **Increment 2b — the endpoint.** `POST /integrations/:id/fetch/:operation`: resolves the descriptor, substitutes
  params, calls through the existing call-external path (auth/headers/timeout/429-retry
  all reused), decodes per `decode`, extracts `recordsPath`, pages per `page.style`.
  **Reuse, do not re-implement:** extract the outbound core out of
  `handlers/integration-call.ts` so both handlers share one path — a second copy of the
  SSRF guard and the token/retry logic is the failure mode to avoid.
  Use the exported `FETCH_TEMPLATE_RE` for substitution so the runtime and the gate can
  never disagree about what `{{…}}` is legal.
- `[ ]` SDK `fetch_external(integration_id, operation, **params)`; docs + MCP + OpenAPI
- `[ ]` **Pilot: endpoint UNBLOCKED 2026-11-06, mapping STILL BLOCKED.** The transport is
  real and in our grant: `GET /settlement/v1/settlement?settlementDate={{settlementDate}}`,
  no `On-Behalf-Of`. The grain question is **settled** (record = `Document`, per order).
  Two constraints remain, both designed for above: the **double-encoded** body (`decode`),
  and the **fan-out** — whose config-vs-Python branch cannot be chosen until a populated
  `settlementDate` shows whether a `Document` is 1:1 with an `orderNumber` (gotcha 1, the Document-grain sub-question).
  Build the platform items above first; publish the Atlas config last.
  Substituting a reachable capability (`documents` via `documents-v1`, `status` via
  `shipment-management-v1`) remains the fallback if Atlas never supplies data — and note
  it would prove the fetch surface **without** proving Gap B's "config alone" property, so
  it is a weaker pilot, not an equivalent one.
- `[ ]` **Resolve `localEntityId` for this source.** Correlating needs
  Atlas `orderNumber` → pegII order number. Pegasus addresses shipments by pegII order
  number only, and Atlas mints its own order numbers; whether pegII stores the van line's
  number in a queryable field is **unverified** (nothing in this repo answers it — it is a
  legacy-DB question). If it does not, the pilot can **project but not correlate**, and
  Gap A stays open for this source regardless of the grain decision. Verify before
  writing the pilot workflow.

### Phase 3 — Freshness + provenance (C4) `[ ]`

- `[ ]` `fetchedAt` on `IntegrationProjection` + migration
- `[ ]` `max_age` / `refresh` on the fetch surface; `source` + `as_of` in every response
- `[ ]` Short default TTL (60s, per-capability overridable). **No single-flight** — decided in
  C5; the provenance fields make the duplicate rate observable so this can be revisited on data
- `[ ]` Emit a metric/log for cache hit vs miss vs duplicate-in-flight, so "do we need
  single-flight?" is answerable later without a code change

### Phase 4 — Entity fact source + binding (Gap C) `[ ]`

- `[ ]` Entity fact derivation (Pegasus entity → `Facts`) — **scope this down first**; start
  with the handful of shipment fields binding actually needs, not a general projection
- `[ ]` `IntegrationBinding` — **tenant-level model** + migration (not a column on
  `IntegrationConfig`), reusing `PredicateSchema` for `when`
- `[ ]` Its own publish/validate path, `ManageIntegrationBinding` Cedar action, and
  versioning/rollback — reuse the gate _pattern_, not `IntegrationConfig`'s machinery
- `[ ]` Deterministic resolver + publish-time rejection of two rules claiming one capability
- `[ ]` `resolve_source(capability, local_entity_type, local_entity_id)` in the SDK
- `[ ]` One generic settlements workflow in `workflows-stdlib` proving N sources, zero code

### Phase 5 — Ship sources as GLOBAL configs `[ ]`

- `[ ]` Publish per-carrier overlays as **GLOBAL configs**, not built-in code — they already
  appear to every tenant and are forkable, with `fork(force=True)` re-syncing. "Built in"
  should mean _published_, not _compiled_; every code overlay is a PR instead of a publish.

---

## Files

**New:** `apps/api/src/lib/integration-fetch.ts` (+test) · `apps/api/src/handlers/integration-fetch.ts`
(+test) · `apps/api/src/repositories/integration-correlation.repository.ts` (+test) ·
`apps/api/src/integration-validation/binding/{types,resolver}.ts` (+tests) ·
`apps/api/src/integration-validation/facts/entity-facts.ts` (+test)

**Modified:** `apps/api/prisma/schema.prisma` (3 migrations — hot file, serialize) ·
`integration-validation/types.ts` · `floors/financial-settlement.floor.ts` · `registry.ts` ·
`repositories/integration-config.repository.ts` · `handlers/integrations/*` ·
`lib/openapi-spec.ts` · `authz/actions.ts` + Cedar policies (hot files — serialize) ·
`packages/workflows-sdk-python/{pegasus_workflows/api.py,README.md,CHANGELOG.md,cli/mcp_server.py}`

## Risks

- ~~**The settlement grain does not match our 1:1 correlation**~~ — **DOWNGRADED
  2026-11-06.** It was never a contract problem in Phase 1's shipped foundation: the
  record is the per-order `Document`, not the remittance envelope, so the dual-unique
  contract stands and `#812`'s second consumer is untouched. No migration. What remains is
  two smaller, bounded risks:
  - **The fan-out may not be expressible in config.** `vendorId` is on the parent and
    `documents[]` is two arrays deep; if detail/adjustment records can name a different
    order than their Document, the per-shipment record is a group-by, not a path. Then the
    pilot needs Python and **Gap B's "new partner = config alone" property does not hold
    for this source** — the pilot would demonstrate the fetch surface without
    demonstrating the property it exists to buy. See gotcha 1 and the Document-grain sub-question. Resolvable only
    with populated data.
  - **`localEntityType: 'shipment'` → `'order'` may orphan existing correlations.** The
    edit is one line, but rows already written under `'shipment'` stop resolving. Query
    before editing — see the decision entry.
- ~~**The pilot has no proven source**~~ — **RETIRED 2026-11-06**: Atlas shipped
  `settlement-v1`. Kept below as the record of why Phase 2 stalled for three months, and
  because its last paragraph (substituting a reachable capability) is still the fallback.
  _Original, as written 2026-08-20:_
  Phase 2 ships "an Atlas settlements `fetch` block published as a GLOBAL config", and Atlas
  publishes no settlements endpoint. Measured: `settlement` occurs twice in the whole 24-spec
  catalog, both incidental; `remittance` and `disbursement` zero times; and the invoice-heavy
  APIs (`RatingSystem-v1` 107 mentions, `atlasorder-v1` 55, `authorizations-v1` 33) all return
  **401** for our subscription. The only reachable candidate is
  `shipment-management-v1 GET /shipments/{orderNumber}` → `invoices`, which the spec declares as
  `{"nullable": true}` with **no schema at all**, and no reachable endpoint yields an order
  number to discover its shape with.
  **Consequence:** Phases 1, 3 and 4 are source-agnostic and unaffected, but **Phase 2's pilot
  cannot be written** until Atlas answers where settlement data lives and supplies a QA order
  number. Two mitigations, in preference order: (a) get the answer — it is open question 1 in
  `docs/atlas-world-group-api/README.md`; (b) if settlements prove unavailable, pilot a
  capability we can actually reach (`documents` via `documents-v1`, or `status` via
  `shipment-management-v1`) — the plan explicitly does not freeze capability names, so this is a
  substitution, not a redesign.
- **Identity scoping is unresolved (NEW, 2026-08-20).** Our Atlas key executes as a fixed
  Atlas-side identity and impersonation is refused, so a Pegasus tenant cannot currently present
  as its own Atlas agent. If Atlas's answer is "one subscription per agent", per-tenant
  credentials already handle it and nothing changes. If it is "use `On-Behalf-Of`, we'll grant
  it", the `fetch` block needs a per-principal substitution (`{{principal:…}}`) plus a
  Pegasus-user → Atlas-user mapping — a real addition to C2's deliberately-bounded DSL.
- **Hot-file contention.** `schema.prisma`, `authz/actions.ts` and the Cedar policies are
  merge magnets that collide _semantically_. Serialize across phases; rebase before continuing.
- **Scope creep in the fetch DSL** — see C2. If a `{{#if}}` shows up in review, the answer is a
  bespoke workflow.
- **Phase 4 is the big one.** The entity fact source is a general capability wearing a small
  hat. If the plan slips, ship Phases 1–3 (which already deliver "fetch settlements from a
  configured source on demand", just with the integration named explicitly) and defer binding.
- **SSRF posture unchanged** — resolved URLs still go through `assertDeliverableUrl`. The fetch
  block adds a path/query template, not a new egress.
- **Unknown rate budget** — see C5. Worth resolving with Atlas before Phase 3 lands, since it is
  the only input that would move the TTL default off judgement. **Partially measured 2026-08-20:**
  ~70 live calls at ~24/min drew no `429` and no rate-limit headers, so there is no aggressive
  per-minute throttle — but a _weekly_ quota (the `starter` product publishes 100/week) would not
  have surfaced, and Atlas exposes no quota headers to read it from. The 60s TTL default remains
  judgement, not measurement.
- **Deferring single-flight is a bet, and it is instrumented as one.** If duplicate fetches turn
  out to matter, the fix is additive (a shared lease tier, the L2 pattern from #521/#532/#535)
  and does not invalidate anything built in Phases 1–3. The failure mode to avoid is shipping it
  _without_ the hit/miss/duplicate metric — that is what would turn a reversible bet into a
  guess, so treat that checklist item in Phase 3 as non-optional.

## Decisions (2026-08-06)

**1. On-demand fetch stays; drop single-flight, not on-demand.**
The question was posed as "on-demand vs. scheduled sync + read from cache", but that is not
where the cost actually sits:

- The **fetch descriptor** is required either way — a scheduled sync still has to know which
  path to call.
- **Correlation** is required _more_ by the cache-first route, not less: reading the cache by
  our own entity id is exactly what needs it. Pure on-demand could have skipped Phase 1.
- So cache-first trades single-flight for a sync pipeline (scheduling, backfill, partial
  failure). Different shape, not less work.

The expensive, subtle part is **coordination**, and that is what we drop. Fetches are
idempotent GETs, so concurrent duplicates are wasteful rather than wrong, and a short TTL bounds
the miss window. Ship without a coordination tier; make the duplicate rate observable; add
single-flight only if the numbers justify it. This gives the preferred behavior (on-demand)
_and_ the simplification.

**2. Binding is a tenant-level document.** Confirmed — see C3 for the three consequences
(global answerability of "where does this tenant get X", decoupled lifecycles, and the cost of
its own publish path + RBAC action).

**3. Capability names deliberately deferred.** The floor declares its capability list and both
the `fetch` block and the binding table validate against it, so naming is a floor change rather
than a migration. Only `settlements` is needed for the pilot. Naming `documents`/`status`/
`estimates` now would be guessing with one example to generalize from; the second real domain
is the first informed moment to decide.

## Still open

- ~~**The settlement↔shipment grain decision**~~ — **CLOSED 2026-11-06, option 3.** See
  "Decisions & dead ends". No longer gates Phase 2's platform work.
- **Is a `Document` 1:1 with an `orderNumber`?** The successor question, and the one that
  now gates the pilot: `orderNumber` recurs on `Document`, `DetailRecord` and
  `AdjustmentRecord`, so a Document may or may not be single-order. Decides whether the
  fan-out is config (bounded nested `recordsPath` + parent hoist) or Python (group-by).
  Unanswerable from the spec — needs populated data. See gotcha 1, the Document-grain sub-question.
- **A QA `settlementDate` that returns data** — the only remaining ask of Atlas, and far
  narrower than August's "where does settlement data live". 14 dates tried, all empty.
  **Ask for it with the above question attached** — the data is wanted to answer something
  specific, not to browse.
- **Does pegII store the Atlas order number?** Decides whether this source can correlate
  at all (see the Phase 2 checklist). Not answerable from this repo.
- **Do any `local_entity_type = 'shipment'` correlations exist?** Gates the one-line floor
  edit to `'order'`. One query against staging/prod settles it.
- **LATENT BUG found 2026-11-06, NOT fixed here (out of scope — record only).**
  `handlers/ingress.ts` loads the `inbound` block with
  `findFirst({ where: { integrationId, tenantId, status: 'PUBLISHED' } })` — **no GLOBAL
  fallback and no `orderBy: { version: 'desc' }`**, while `config.ts`'s own
  `carriedPublishFields` comment states a tenant overlay "wins over GLOBAL" for `inbound`.
  So a tenant relying on a GLOBAL published `inbound` silently gets the generic
  `{status:'accepted'}` ack instead of the partner's envelope. The repository already has
  `findActiveForScope`, which does tenant-then-GLOBAL correctly.
  **Do not copy ingress's query shape for `fetch`** — increment 2b uses
  `findActiveForScope`. Worth its own small PR.
- **Agent-Limited's rate budget** — unpublished; blocks choosing the TTL default on anything
  better than judgement. Outstanding with Atlas (see `docs/atlas-world-group-api/README.md`).
  No throttling observed at ~24 calls/min in Aug, and none hit again on 2026-11-06, but a
  weekly quota would not have surfaced either time.
- **Whose identity the subscription key acts as** — unanswered since August. Lower stakes now
  that `settlement-v1` needs no `On-Behalf-Of`, but it still decides whether a per-tenant
  Atlas identity is ever needed.
- **`RadsData-v1` and `yembo-v2`** — new in the catalog 2026-11-06, grant and contents
  unprobed.
- **Phase 4 scope.** The entity fact source is the largest piece and the most likely to be cut
  down; it does not block Phases 1–3.
- ~~**The `main` copy of this plan**~~ — **DECIDED 2026-11-06: delete it in the
  increment-1 PR.** `plans/in-progress/vanline-source-binding.md` carries the stale
  "Phase 1 in flight" header and is superseded by this file in full. Deciding it "at PR
  time" was the deferral that let it drift; PR time is now.

## Provenance

Derived from `docs/atlas-world-group-api/` (research, 2026-07-30) and the outbound work in
#563/#564. Atlas is the motivating source but is deliberately **not** the abstraction.
