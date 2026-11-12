# Pluggable data sources — correlation, declarative fetch, and entity→source binding

> **Status (2026-11-12): Phases 1, 2 and 3 SHIPPED. Phases 4-5 not started.**
> Phases land as separate PRs and serialize (schema.prisma + Cedar are merge magnets).
>
> Two corrections to earlier versions of this banner, both measured rather than assumed:
> Phase 1 is **NOT "in production use"** — a read-only audit found zero correlation rows in
> prod _and_ staging, and zero projections in prod (see "Still open"); and Phase 2 is no
> longer "not started" — it is complete. The Atlas **pilot** is the only part not shipped,
> and it waits on Atlas, not on engineering.

## Resume here

Rewritten **2026-11-12** at the end of the session that shipped all of Phase 3.

### Where

- Worktree `/home/steve/repos/pegasus-atlas-fetch-phase2`, branch
  `feat/atlas-fetch-phase3`, cut fresh off `origin/main` (`6ae1cc35`, `#951`).
- A note for anyone returning to the old branch: `docs/atlas-document-grain-answered`
  holds a local commit `698e967f` that is the **pre-squash twin** of `c52bcdae` (`#954`),
  already on `main`. Do not rebase it — it double-applies. `git checkout -B <new> origin/main`
  carries the dirty files across and leaves the twin behind, which is what this session did.
- `apps/e2e/.env.test` is the worktree's isolated Postgres port (5477), written by
  `scripts/workstream-start.sh`. **Never commit it.**

### Status

**Phase 3 (freshness + provenance, C4) is CODE-COMPLETE.** All four checklist items are
done — see the Phase 3 checklist. The measured premise that shaped it: the fetch endpoint
returns raw records and **never writes a projection**, so the TTL cache and the projection's
provenance are two separate stores, not one.

| Phase | What landed                                                                |
| ----- | -------------------------------------------------------------------------- |
| 1     | `#648` / `#649` correlation + SDK 0.37.0; extended by `#812` / SDK 0.46.0  |
| 2     | `#931` `#932` `#934` `#942` `#947` `#952` `#954`; SDK 0.58.0/0.59.0/0.62.0 |
| 3     | this branch — `IntegrationFetchCache`, `max_age`/`refresh`, SDK 0.64.0     |

Remaining: **4** (entity facts + binding) `[ ]`, **5** (ship sources as GLOBAL configs) `[ ]`.

### Next action

**Phase 3 leaves no unblocked engineering task behind it.** Pick one of:

1. **Start Phase 4** (entity facts + binding, Gap C) — the next engineering step, and the
   big one. Scope the fact derivation down first; see its checklist and the Risks note.
2. **Nothing else.** Both of the questions the 2026-11-11 session left open were **answered
   on 2026-11-12** — see "Two answers from Steve" immediately below. Neither leaves work
   behind that this plan can act on.

**Do NOT** start the Atlas pilot config. It needs a populated `settlementDate` from Atlas
(ask 1 in OUTREACH.md) before its mapping can be validated against real bytes. That is now
the **only** thing the pilot waits on.

### Two answers from Steve, 2026-11-12

- **`Document.orderNumber` IS the Atlas registration number.** Not Atlas's own order number,
  so **no lookup is needed** — `orderNumber` → registration → pegII order is 1:1 the whole
  way, and `localEntityType: 'order'` (shipped in `#947`) is directly satisfiable from the
  payload. The pilot can **correlate**, not merely project, and **Gap A does not stay open
  for this source**.

  This closes the "Resolve `localEntityId` for this source" checklist item in Phase 2 and the
  matching entry under "Verification still owed". It also retires the worry recorded there
  that pegII might not store the van line's number in a queryable field — irrelevant now,
  because nothing has to be looked up.

  Worth recording how this was settled, because the cheap check genuinely failed: the
  **committed spec cannot answer it.** `orderNumber` on `Document`, `DetailRecord` and
  `AdjustmentRecord` is a bare `{"type":"string","nullable":true}` with no description, and
  "registration" appears nowhere in `settlement-v1` (only in `assetmanagement-v1` and
  `questionnaire-v1`). It was domain knowledge, not a grep — so do not go looking for it in
  the spec again.

- **The Atlas email: Steve is sending it himself**, from the `OUTREACH.md` draft as written.
  Nothing is owed here, and the plan no longer needs a recipient. Do not re-raise it; the
  next Atlas question is whether a populated `settlementDate` comes back.

### What Phase 3 shipped, and the three judgement calls inside it

- **`IntegrationFetchCache`** — a Postgres table, keyed
  `(tenant, integration, operation, requestHash)`. It is a table and not a per-container Map
  for a measured reason: that is exactly what failed for the OAuth token cache on scaled
  Lambda (#521/#532/#535). Same last-write-wins upsert, same absence of a lock.
- **`requestHash` covers the WHOLE resolved descriptor**, not just the caller's params —
  plus the config group and the key-name overrides. `decode`, `recordsPath` and `page`
  determine what `records` CONTAINS, so under a params-only key a republish that moved
  `recordsPath` would keep serving rows of the old shape for a full TTL.
- **`attempts`/`pages` are 0 on a hit**, deliberately. They describe THIS call, so
  `sum(attempts)` still counts real partner requests — which is the thing C5 said would make
  the duplicate rate observable. `status`/`truncated`/`records` describe the DATA and come
  off the row, so a cached truncated read stays recognizably incomplete.
- **The repository does NOT filter by freshness**, diverging from the OAuth token repo's
  `findFresh`. It cannot: a freshness-filtered read collapses "no row" and "stale row" into
  one `null`, and the row's prior `fetchedAt` is exactly what makes a concurrent duplicate
  detectable without single-flight. The handler judges age instead — also one read on the
  hit path instead of two.

### Known gaps in Phase 3, declared rather than discovered

- **`BASE_URL` is not in the cache key.** It and the credentials resolve deeper inside
  `performOutboundCall`, so rotating a base URL can serve the old host for up to `maxAge`.
  The 60s default bounds it and `refresh=True` escapes it; both the descriptor field's
  description and the SDK docstring say so. Pulling the resolved values up would mean
  reading every credential on a cache HIT — a real secret-handling surface traded for a
  rare operator event.
- **No eviction.** One row per distinct request identity, forever. Growth is bounded by the
  distinct `(operation, params)` identities a tenant asks for, and the token cache above it
  has carried the same deferral since #521 without trouble. `fetchedAt` is indexed for
  exactly that, if it ever matters.
- **Projection `fetchedAt` is provenance only.** Phase 3 stores and reports it; nothing
  reads it to make a freshness decision. `get_or_fetch` is Phase 4's business.
- **The fetch route is not metered**, and that is pre-existing, not new: `BILLABLE_ACTIONS`
  gates `CallExternal` on `data.ok === true`, which the fetch response has never carried. So
  a cache hit is not billed as a partner call — there was nothing to get wrong.

### In flight

**Check, do not assume — this block was written before the push, so verify it rather than
trusting it:**

`gh pr list --state open --json number,title,headRefName`

Two things are owed after the merge, in this order:

1. **Publish SDK 0.64.0.** Tag `sdk-python-v0.64.0` on the **verified merge commit**, never on
   `main` — an empty `mergeCommit` silently tags whatever `main` points at. Then confirm the
   artifacts at `/simple/pegasus-workflows-sdk/`, not `/pypi/<pkg>/json`, which is CDN-stale
   for about a minute after a publish.
2. **Then** the authoring repo's `CLAUDE.md` (`~/repos/pegasus-workflows`, pushed straight to
   its `main` — it takes no PRs). It names "0.64.0+", so it must land only once PyPI has it.
   The edits are fully specified; three anchors, all present as of 2026-11-12:
   - the `requirements.txt` pin line, `0.63.0` → `0.64.0`;
   - after "Two things calling code must handle" in the `fetch_external` section — the
     freshness/provenance block (`source`/`asOf`, the three-level precedence, `attempts` 0 on
     a hit, no single-flight, the BASE_URL caveat, `maxAgeSeconds` in `fetch.json`);
   - the "Projection cache + correlation (0.37.0+)" bullet — add `fetched_at=None` to the
     signature, and before "You supply the local id" the provenance block (`fetchedAt` vs
     `updatedAt`, the `asOf` round-trip example, cleared-when-omitted, null means unknown).

   Mirror the wording already committed in the SDK README's "Freshness and provenance" and
   "Record when the state was true at the partner" sections — they are the source of truth and
   were written to be transplanted.

### Version-picking warning (cost us three collisions in one day)

`main`'s SDK version was **0.63.0** on 2026-11-12 (`#951`), confirmed live on PyPI, so this
branch took **0.64.0**. Other sessions bump it constantly. **Before choosing a version,
check both** `main`'s `pyproject.toml` **and** PyPI —
`curl -sS "https://pypi.org/simple/pegasus-workflows-sdk/?x=$RANDOM"`.

The collision is near-silent: two branches bumping `0.6x → 0.6y` make the **identical** edit
to `pyproject.toml` and `uv.lock`, so those **merge cleanly** and only `CHANGELOG.md`
conflicts. A naive CHANGELOG resolution ships two unrelated feature sets under one version
number, and whichever publishes is missing half its changes.

Also: PyPI's `/simple/` and `/pypi/<pkg>/json` are **CDN-cached for ~a minute** after a
publish. "My version isn't there" is not evidence of a failed publish — check the release
run's status and bust the cache before concluding anything.

### Environment traps, re-confirmed 2026-11-12

- **A fresh branch off `origin/main` leaves `node_modules` and the Prisma client stale**, and
  the symptom is a typecheck failure in SOMEONE ELSE'S files — this session saw
  `Cannot find module '@anthropic-ai/sdk'` (added by `#948`) plus a pending migration. Fix:
  `npm install` at the root, then `npx prisma migrate deploy && npx prisma generate` in
  `apps/api`. A previously-green `tsc` and a `turbo` cache hit both predate the branch and
  will lie to you.
- **`npm install` rewrites `package-lock.json` to drop `"peer": true` markers.** Pure churn
  from an npm-version difference. **Discard it** rather than committing it into a feature PR.
- **Never `git stash` in a worktree** — the stack is shared, and this session briefly stashed
  its own entire Phase 3 working tree chasing a question not worth asking (whether `api.py`
  was already unformatted on `main`: it was). Recovery needed `git stash apply <sha>` by the
  SHA captured from `git stash list`, then `drop`. The cheap version of that probe is
  `git show origin/main:<path> > /tmp/… && ruff format --check /tmp/…`, which touches nothing.
- **`ruff format --check` fails on ~20 pre-existing SDK files, `api.py` among them.** CI runs
  `ruff check` only, which passes. Do not "fix" it inside a feature PR — the diff would bury
  the change.
- **The worktree-isolation guard refuses heredocs, `xargs`, runtime-computed `python3 -c` and
  nested command substitution** (gotcha 8). Write a script to the scratchpad and run
  `python3 <path>`.
- **GitHub Actions runs can wedge `queued` indefinitely** while other branches' runs proceed.
  `gh run cancel` then refuses with "Cannot cancel a workflow run that is completed" while
  `gh run view` still says `queued`. Recovery: `gh pr close <N> && gh pr reopen <N>`.

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

  So: one per-order record → one `financial_settlement` record. The 1:1 holds and nothing
  in Phase 1 changes.

  > **CORRECTION 2026-11-11 — the extraction half of this entry was wrong.** It said
  > "`recordsPath` points into `documents[]`, one `Document` → one record → one order."
  > A `Document` is **not** 1:1 with an order (answered by Steve from domain knowledge;
  > see gotcha 1 → the Document-grain sub-question). The per-order record is the
  > **group-by `orderNumber`** across the envelope, which no `recordsPath` can express.
  >
  > **What survives, and it is the load-bearing half:** the record GRAIN is per-order, the
  > 1:1 correlation stands, there is no migration, and `#812`'s consumer is untouched —
  > all independently confirmed, and the floor edit to `localEntityType: 'order'` shipped
  > on the strength of a prod+staging audit rather than on this reasoning. The
  > `Settlement`/`AgentSettlement` levels are still a remittance envelope; the error was
  > assuming the next level down was therefore the record.
  >
  > **What was wrong and is now corrected below:** the mapping table's `recordsPath`
  > advice, and the illustrative descriptor. Nothing shipped depends on either — the
  > Atlas config was never published, which is exactly why the pilot was sequenced last.

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

   **THE DOCUMENT-GRAIN SUB-QUESTION — ANSWERED 2026-11-11 by Steve (domain knowledge),
   and the answer is (b).** Cited elsewhere by that name; deliberately not its own
   numbered gotcha, because the plan cites gotchas 2/3/8 by number.

   **A `Document` is NOT 1:1 with an `orderNumber`.** What IS 1:1 is the **Atlas
   registration number ↔ the order number**: in Pegasus every order represents exactly one
   Atlas registration. So the per-order settlement record is the set of records bearing a
   given `orderNumber`, gathered across the envelope — `orderNumber` recurs on `Document`,
   `DetailRecord` and `AdjustmentRecord` precisely because a Document spans orders.

   **Consequences, in order of how much they cost:**

   1. **The extraction is a GROUP-BY, not a path — so branch (b) wins and the Atlas
      pilot needs Python.** No bounded `recordsPath` can express "regroup the envelope by
      `orderNumber`", and `fetch`'s DSL deliberately has no wildcard, no arithmetic and no
      aggregation. This is the documented escape hatch working as designed, not a defect.
   2. **Therefore the Atlas pilot does NOT demonstrate "new partner = config alone."**
      That was Gap B's whole selling point, so say it plainly rather than let the pilot
      imply it. What `fetch_external` still buys for Atlas is real but narrower: path,
      params, auth, `decode`, retry and paging all leave workflow code; only the
      record-shaping stays. A source whose records sit at one path still gets the full
      property — Atlas just is not that source.
   3. **The correlation contract is UNAFFECTED, and the registration 1:1 confirms it.**
      `localEntityType: 'order'` (shipped 2026-11-11, `#947`) is exactly right: the thing
      that is 1:1 with an Atlas registration is the ORDER. Nothing shipped is wrong —
      see the correction note under "Decisions & dead ends".

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

| canonical (`financial_settlement`) | Atlas (`Document`)                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Id`                               | `orderNumber` — stable across periods; see decision. Supplied by the REGROUPING step, not read off one `Document` |
| `Totals.Net`                       | `documentAmount` (a plain `$from`; DSL has no `$sum`)                                                             |
| `Subject.ShipperLastName`          | `shipper` (also `customerName`)                                                                                   |
| `LineItems[]`                      | `detailRecords[]` + `adjustmentRecords[]`                                                                         |
| `Reference.PartyId`                | **unmappable** — `vendorId` is on the parent (gotcha 1)                                                           |

**`recordsPath` cannot produce these rows.** A per-order record is a group-by across the
envelope (gotcha 1), so the Atlas pilot regroups in workflow Python and feeds the result
in; `fetch_external` still owns path, params, auth, `decode`, retry and paging.

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

**Everything shipped was verified.** As of 2026-11-12, on the Phase 3 branch: `tsc --noEmit`
clean, `turbo run typecheck lint` 25/25, the full API suite green (**5229** tests, 328 files),
the SDK suite green (**595**), `ruff check` clean. Phase 2's merges were the same at `#947`
(5018 API, 579 SDK) and every main-branch CI + Deploy run came back `success`.

**Phase 3's own gap, stated plainly: nothing has exercised the cache against a real partner.**
Every path is covered by tests — hit, miss, forced refresh, descriptor-vs-call-site precedence,
the duplicate metric, oversize skip, read-throw and write-throw degradation — but all of it is
against a mocked outbound call. The first REAL hit/miss cycle will be whenever a tenant fetch
runs, and the completion log (`cache`, `duplicate`, `cacheWrite`, `ageSeconds`) is the thing to
read when it does. That log is also the whole point: C5's no-single-flight call was taken as a
reversible bet, and the duplicate rate is what would reverse it.

What is still owed beyond that — none of it blocks the shipped code:

- **The settlement payload has never been seen populated** (gotcha 3), so the mapping in "The new
  Atlas settlements API" is unvalidated against real bytes. This is the one thing the Atlas ask
  exists for now that the grain question is answered.
- **The regrouping step does not exist yet**, and it is new code (per-order grouping across the
  envelope — see gotcha 1). Its first run should not also be its first test, which is the reason
  populated data is still wanted.
- ~~**Whether `Document.orderNumber` is the Atlas registration number** or needs a lookup~~ —
  **ANSWERED 2026-11-12: it IS the registration number**, so the pilot correlates without a
  join. See "Two answers from Steve" in the resume block. Nothing owed.
- `RadsData-v1` / `yembo-v2`: grant and contents still unprobed. Not worth probing until wanted.

**Environment traps that cost real time this session, both of which re-verification must survive:**

- **A rebase that pulls in another workstream's migration leaves the generated Prisma client
  stale**, and the symptom is a typecheck failure in THEIR files (e.g. `WorkflowTrigger.mode` does
  not exist). A previously-green `tsc` and a `turbo` cache hit both predate the rebase and will lie
  to you. Fix: `npx prisma migrate deploy && npx prisma generate` in `apps/api`, then re-run.
- **GitHub Actions runs can wedge `queued` indefinitely** while other branches' runs proceed.
  `gh run cancel` then refuses with "Cannot cancel a workflow run that is completed" while
  `gh run view` still says `queued` — two contradictory states. `gh pr checks` reports "no checks
  reported", which looks like a gh quirk but is really reporting on wedged runs. Recovery:
  `gh pr close <N> && gh pr reopen <N>` re-fires the `pull_request` event and produces fresh runs.

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

> **SHIPPED 2026-11-12** — see the Phase 3 checklist for what each bullet became, and the
> resume block for the three judgement calls the design did not anticipate. One correction the
> build forced: this section reads as though one store holds both the TTL and `fetchedAt`. It
> does not. The fetch endpoint returns raw records and never writes a projection, so the
> read-through cache is its own table (`IntegrationFetchCache`) and `fetchedAt` on
> `IntegrationProjection` is separate provenance that a caller threads through from a fetch's
> `asOf`.

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

### Phase 2 — Declarative fetch (Gap B) — increments 1, 2a, 2b all `[x]`

> **Phase 2 is CODE-COMPLETE as of 2026-11-10.** A published `fetch` block is
> authorable, gated, discoverable and **executable** end to end. What remains is not
> engineering: the Atlas pilot config needs a populated `settlementDate` from Atlas
> (see "Still open"), and the floor's `localEntityType` edit needs one DB query.

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

- `[x]` **Floor one-liner — DONE 2026-11-11, SDK 0.62.0.** `financial_settlement`'s
  `correlation.localEntityType` → `'order'`, after the prod+staging audit cleared the
  gate (zero rows either side — see "Still open"). Blast radius closed with it: the SDK
  README (which _taught_ `"shipment"` and was the only plausible source of a stray row),
  the `get_correlated_state` docstring, the SDK test fixtures, and the authoring repo's
  `CLAUDE.md`.

  **The part worth remembering:** the full API suite passed **5013/5013 before any test
  was added**, so this change was invisible to it and nothing had ever asserted the two
  correlating floors agreed — which is exactly how the drift survived since August. Five
  tests now pin the vocabulary (including a guard against a vacuous pass on an empty
  floor list), and they were verified to DISCRIMINATE by reverting the floor to
  `'shipment'` and watching three fail. A one-line change whose test suite does not
  notice it is a change with no coverage, not a safe one.

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
- `[x]` SDK **0.59.0** `fetch_external(integration_id, operation, *, params, group)` +
  OpenAPI + MCP + README + CHANGELOG + the authoring repo's `CLAUDE.md`. Signature
  deliberately exposes NO method/path/header argument — a test asserts the parameter set,
  so a later convenience addition cannot quietly reopen the escape hatch.
- `[ ]` **Pilot: endpoint UNBLOCKED 2026-11-06, mapping STILL BLOCKED.** The transport is
  real and in our grant: `GET /settlement/v1/settlement?settlementDate={{settlementDate}}`,
  no `On-Behalf-Of`. The grain question is **settled** (record = `Document`, per order).
  Two constraints remain, both designed for above: the **double-encoded** body (`decode`),
  and the **fan-out**, whose branch is now **decided** — regrouping is Python (gotcha 1, the
  Document-grain sub-question, answered 2026-11-11). Correlation is no longer a constraint at
  all: `orderNumber` is the registration number, so the record carries its own
  `localEntityId` (answered 2026-11-12). **What the pilot still waits on is exactly one
  thing: a populated `settlementDate`.**
  Build the platform items above first; publish the Atlas config last.
  Substituting a reachable capability (`documents` via `documents-v1`, `status` via
  `shipment-management-v1`) remains the fallback if Atlas never supplies data — and note
  it would prove the fetch surface **without** proving Gap B's "config alone" property, so
  it is a weaker pilot, not an equivalent one.
- `[x]` **Resolve `localEntityId` for this source — ANSWERED 2026-11-12 by Steve, and the
  answer is the good one.** `Document.orderNumber` **is the Atlas registration number**, which
  is 1:1 with a pegII order, so there is **nothing to look up**: the payload carries the
  correlating id directly and `localEntityType: 'order'` is satisfiable as shipped.

  The pilot can **correlate**, not merely project, and **Gap A does not stay open for this
  source**. The earlier worry — that Atlas mints its own order numbers and pegII might not
  store the van line's number in a queryable field — is moot, not unresolved.

  Note the committed spec could NOT have answered this (`orderNumber` is an undescribed
  nullable string; "registration" does not occur in `settlement-v1`). It was domain
  knowledge. Do not re-derive it from the spec.

### Phase 3 — Freshness + provenance (C4) `[x]` DONE 2026-11-12

Shipped as one PR. The premise that split it in two: the fetch endpoint returns raw records
and **never writes a projection**, so the TTL cache and the projection's provenance are
separate stores. Confirmed by reading `handlers/integration-fetch.ts`, not assumed.

- `[x]` `fetchedAt` on `IntegrationProjection` + migration. Nullable, **not backfilled** —
  a pre-existing row has no honest value to claim. A null means UNKNOWN and must be read as
  stale; it is explicitly **not** a fall-back to `updatedAt`, which answers a different
  question. Cleared (not inherited) by a write that omits it, because `state` is replaced
  wholesale. Written via `put_projection(..., fetched_at=)`, whose natural source is a
  `fetch_external` response's `asOf`.
- `[x]` `max_age` / `refresh` on the fetch surface; `source` + `asOf` in **every** response,
  the miss path included. Precedence: call-site `maxAge` > descriptor `maxAgeSeconds` >
  60s default. `maxAge: 0` and `refresh: true` both force a call, and a forced call still
  writes through. `resolveFetchMaxAge` uses explicit `undefined` checks, because
  `callSite || descriptor` would read an explicit 0 as "unset".
- `[x]` Short default TTL (`FETCH_DEFAULT_MAX_AGE_SECONDS = 60`), per-capability overridable
  via the descriptor's `maxAgeSeconds` (0–86400, `FETCH_MAX_MAX_AGE_SECONDS`). **No
  single-flight**, per C5. New model `IntegrationFetchCache` (in `TENANT_SCOPED_MODELS`),
  repository `integration-fetch-cache.repository.ts`.
- `[x]` The metric, which Risks called non-optional. One structured completion log carries
  `cache` (`hit`/`miss`/`refresh`), `duplicate`, `cacheWrite`
  (`stored`/`skipped:oversize`/`failed`) and, on a hit, `ageSeconds`. Duplicates are detected
  **without** coordination: the row's `fetchedAt` is read before the partner call and again
  after, and a change means another container fetched concurrently — one extra indexed read,
  on the miss path only. Tested, not merely emitted.
- `[x]` Every cache failure degrades instead of failing a good read: an unreadable cache is a
  miss, an unwritable one still returns the records, and a result over 256 KB (the projection
  `state` cap) is served **uncached**.
- `[x]` Discovery surfaces, per CLAUDE.md's SDK rule: `fetchBlockJsonSchema()` (so the
  discovery endpoint publishes `maxAgeSeconds`), OpenAPI, SDK `fetch_external` +
  `put_projection`, README, CHANGELOG, MCP resource text, CLI `fetch.json` help. The
  authoring repo's `CLAUDE.md` lands **after** the PyPI publish, since it names 0.64.0.
- `[x]` `test_fetch_external_exposes_no_method_or_path_argument` updated **deliberately**, not
  loosened: the pinned set is now
  `{self, integration_id, operation, params, group, max_age, refresh}`, and the comment says
  why those two are not transport.

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
- **Unknown rate budget** — see C5. **Phase 3 landed 2026-11-12 WITHOUT this resolved**, so the
  60s default is still judgement rather than measurement. That was the right trade only because
  the TTL is now a declared, per-capability, call-site-overridable field rather than a constant:
  moving it is a config edit, not a deploy. Still worth asking Atlas. **Partially measured
  2026-08-20:**
  ~70 live calls at ~24/min drew no `429` and no rate-limit headers, so there is no aggressive
  per-minute throttle — but a _weekly_ quota (the `starter` product publishes 100/week) would not
  have surfaced, and Atlas exposes no quota headers to read it from. The 60s TTL default remains
  judgement, not measurement.
- ~~**Deferring single-flight is a bet, and it is instrumented as one.**~~ **DISCHARGED
  2026-11-12.** The metric shipped with the cache rather than after it, so the bet stayed
  reversible: the completion log carries `cache` (hit/miss/refresh), `duplicate` and
  `cacheWrite`, and the duplicate is detected with no coordination at all — the row's
  `fetchedAt` read before and after the partner call. If duplicates turn out to matter the fix
  is still additive (a shared lease tier, the L2 pattern from #521/#532/#535) and invalidates
  nothing in Phases 1–3. What remains is to actually READ that log once real traffic exists;
  see "Verification still owed".

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
- ~~**Is a `Document` 1:1 with an `orderNumber`?**~~ — **ANSWERED 2026-11-11 by Steve: NO.**
  The 1:1 is Atlas **registration number ↔ order number** (every Pegasus order is exactly
  one Atlas registration). So the fan-out is **Python (group-by)**, not config, and the
  Atlas pilot does not demonstrate "config alone". Details and consequences in gotcha 1.
  **This no longer needs data to resolve** — which is why the remaining Atlas ask shrank.
- **A QA `settlementDate` that returns data** — still the one Atlas ask, but **no longer a
  blocker on the DESIGN**, only on validating the mapping against real bytes. 14 dates
  tried, all empty. Reason it is still worth having: nothing in the settlement mapping has
  ever been checked against a populated payload, and the regrouping step is new code whose
  first run should not be its first test.
- **Does pegII store the Atlas order number?** Narrowed 2026-11-11: the 1:1 Atlas
  registration ↔ order relationship means the mapping EXISTS; what is still unverified is
  whether `Document.orderNumber` carries the Atlas registration number directly or needs a
  lookup on our side. Decides whether the pilot can correlate without a join. Not
  answerable from this repo.
- ~~**Do any `local_entity_type = 'shipment'` correlations exist?**~~ — **MEASURED
  2026-11-10, answer: NO. Gate cleared, no migration needed.**

  Read-only audit against both environments (Secrets Manager `pegasus/<env>/database-url`
  via the `dolas-pegasus-<env>` SSO profile, `default_transaction_read_only=on`):

  |                                                  | prod         | staging    |
  | ------------------------------------------------ | ------------ | ---------- |
  | `local_entity_type = 'shipment'` rows            | **0**        | **0**      |
  | rename collisions against the local unique index | **0**        | **0**      |
  | `integration_correlations` total rows            | **0**        | **0**      |
  | `integration_projections` total rows             | 0            | 2          |
  | tenants / integration_configs / workflows        | 19 / 32 / 52 | 3 / 2 / 11 |

  The last row is the point: **the zeros are real, not a false green.** Four zeros
  against an empty table is indistinguishable from querying the wrong database, so the
  audit also proves the connection sees populated data (`current_database()` = `neondb`,
  one `integration_correlations` table, in `public`). Scripts:
  `correlation_audit.sql` + `run_correlation_audit.sh` (session scratchpad — re-create
  from this entry if needed; the AWS managed **ReadOnly** policy does NOT include
  `secretsmanager:GetSecretValue`, so the `-ro` profiles cannot fetch the URL and the
  writable profile is required for that one read).

- **CORRECTION, same measurement: Phase 1 is NOT "in production use".** This plan has
  said so since August. The data says correlations have **never been written in either
  environment**, and prod has **no projections at all**. Staging has 2 projections and 0
  correlations — so even where `put_projection` was called, `local_entity_type` was never
  passed. The API shipped and is live; nothing exercises it. Two consequences:
  the floor edit's risk is essentially nil (there is no legacy data to preserve), and
  **the Atlas pilot would be the FIRST real user of the projection + correlation path**,
  so expect first-contact problems there rather than in the edit.
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
