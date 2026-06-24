# Dogfood: publish built-in integration configs to the platform tenant (GLOBAL)

> **Status:** CODE SHIPPED — live run pending. The buildable engineering for
> Phases 1–4 plus the Phase-2 infra flag is done (branch
> `integration-config-dogfood-publish`). What remains is the live operational run
> (provision the platform-tenant key, deploy, publish to QA, verify, then prod) —
> it needs AWS/DB credentials and is tracked in **Remaining live steps** below.

## Built in this session (branch `integration-config-dogfood-publish`)

- **Phase 1 ✅** — `apps/api/src/integration-validation/corpus/`: typed
  `longhaulCorpus` / `weichertCorpus` exports (static JSON imports), `getBuiltinCorpus`
  (full, for validate-path parity) + `getGateCorpus` (drops structural-rejection
  fixtures the gate's round-trip stage can't accept). `corpus.test.ts` asserts the
  exports equal the on-disk files and the gate passes for both built-ins;
  `gate-pipeline.test.ts` switched off its `fs` read onto the export.
- **Phase 3+4 ✅ (code)** — `apps/api/scripts/publish-builtin-configs.ts`: a tsx
  script that assembles `{ mapping, rules, corpus }` from the built-in exports and
  drives `/config/validate` (default dry-run), `/config` (`--publish`), and a
  `--verify` mode (GET config/versions + replay the FULL corpus through `/validate`,
  diffing `{ valid, ruleIds }` vs expected — expected diff = none). Env:
  `API_BASE_URL` + `PEGASUS_PUBLISH_KEY` (platform-tenant `vnd_` key).
- **Phase 2 ✅ (infra wiring)** — `packages/infra`:
  `INTEGRATION_CONFIG_PUBLISH_ENABLED=true` set on the api Lambda when
  `integrationConfigPublishEnabled` is true; `bin/app.ts` enables it for `staging`
  (QA) only (prod stays off for Phase 5). Inert until a platform-tenant key
  publishes; the dry-run validate + read paths are never gated.

> **Open questions resolved while building:** (1) there was **no SDK/CLI** for
> integration configs at first → the node script was built as the vehicle; the SDK
> `integration-config` group (`validate`/`publish`/`pull`/`versions`/`rollback`) was
> then **added to `pegasus-workflows`** and is now the preferred author-facing path
> (the script remains the simplest path for the built-ins specifically). (2) Platform tenant is the
> `isPlatformTenant=true` DB flag (admin `PROMOTE_PLATFORM_TENANT`), not a hardcoded
> id; the script never needs the id — visibility=GLOBAL is derived server-side from
> the key's tenant. (3) Kept publishing **external** (script); did **not** attach
> `corpus` to the built-in `IntegrationDefinition` / bundle it into the Lambda.

## Remaining live steps (need AWS/DB credentials — not done in-session)

1. **Merge the PR.** Because it touches `packages/infra`, the deploy pipeline runs a
   full `--all` CDK deploy (staging then prod-gated). This sets the QA flag on; prod
   is unaffected (flag is `staging`-only). The endpoint stays inert until step 2.
2. **Provision the platform-tenant `vnd_` key (QA).** Confirm which tenant has
   `isPlatformTenant=true` in QA (promote one via admin if needed); ensure its
   acts-as service account carries `Actions.PublishIntegrationConfig` (RBAC role map
   / Cedar). Mint a `vnd_` key for it.
3. **Dry-run, then publish (QA).** Two equivalent vehicles:
   - **SDK (preferred):** `pegasus-workflows integration-config pull <id>` →
     `... validate <id>` → `... publish <id>` (token via `PEGASUS_WORKFLOW_TOKEN`).
     For the built-ins, materialise `mapping.json`/`rules.json`/`corpus.json` from
     the built-in exports first, or `pull` an already-published version to seed them.
   - **Script:** `API_BASE_URL=<qa> PEGASUS_PUBLISH_KEY=vnd_xxx npx tsx scripts/publish-builtin-configs.ts`
     (gate pre-check), then `... --publish` → GLOBAL rows v1. Self-assembles the
     body from the built-in exports (no files needed), so it's the simplest path
     for the _built-ins_ specifically.
4. **Verify (QA).** `... --verify` → GET config/versions show the rows; zero
   validation diffs (the safety proof). Confirm the `integration config published`
   log fired.
5. **Prod (Phase 5).** Flip the flag to include `prod` in `bin/app.ts`, deploy, then
   run steps 2–4 against prod.

## Where things stand (context)

The integration-config platform is fully built on `main` (PRs #314–#321):

- **Store**: `IntegrationConfig` Prisma model + `repositories/integration-config.repository.ts`
  (versioned, append-only, `visibility` GLOBAL/TENANT, `status` PUBLISHED/SUPERSEDED;
  `findActiveForScope` does TENANT → GLOBAL fallback).
- **Registry overlay** (`integration-validation/registry.ts`): built-in REGISTRY
  (code: `structuralContract` + `deriveFacts` + `factCatalog` + `inputFieldRoots`)
  with a **GLOBAL-only** DB overlay of the editable surface (`mapping` + `rules`).
  `loadRegistryOverlayIfStale(db)` / `refreshRegistryOverlay(db)`.
- **Gate** (`integration-validation/gate-pipeline.ts`): `runGatePipeline(base, candidate)`
  → format → static-checks → compile → structural round-trip → behavioral corpus.
- **Publish endpoints** (`handlers/integration-validation/config.ts`, on the m2m
  plane via `dualAuthMiddleware`) — see contract below.

**Current reality:** the validator runs **entirely off the built-in code** — there
are **no GLOBAL rows** in the store yet, and the golden corpus exists only as
`__corpus__/<id>/*.json` (read by tests via `fs`). This plan changes neither the
engine nor the built-ins; it just gets the built-ins _into_ the store via the real
publish path.

## Publish endpoint contract (don't re-derive — from `handlers/integration-validation/config.ts`)

All under `/api/v1/integrations/:integrationId/config*`, mounted on `m2mV1`
(`dualAuthMiddleware` → a `vnd_` key or Cognito), RBAC-gated:

| Route                       | Method | Gate?                                     | Flag-gated? | Permission                 |
| --------------------------- | ------ | ----------------------------------------- | ----------- | -------------------------- |
| `/config/validate`          | POST   | dry-run (no write)                        | **no**      | `PublishIntegrationConfig` |
| `/config`                   | POST   | gate → publish → `refreshRegistryOverlay` | **yes**     | `PublishIntegrationConfig` |
| `/config`                   | GET    | —                                         | no          | `ReadIntegrationConfig`    |
| `/config/versions`          | GET    | —                                         | no          | `ReadIntegrationConfig`    |
| `/config/rollback/:version` | POST   | re-gate → publish                         | yes         | `PublishIntegrationConfig` |

- **Body** (validate + publish): `{ mapping, rules, corpus: GateCorpusCase[] }` —
  the **caller supplies the corpus**; the gate runs server-side; publish writes
  nothing on `report.ok === false` (returns `422 GATE_FAILED` + full report).
- **Visibility is derived server-side** from the publishing tenant's
  `isPlatformTenant`: **GLOBAL** for the platform tenant, TENANT otherwise. → To
  publish GLOBAL, authenticate as the **platform tenant**.
- **Flag**: `isIntegrationConfigPublishEnabled()` (`lib/integration-config-feature.ts`,
  env `INTEGRATION_CONFIG_PUBLISH_ENABLED`) gates `POST /config` + rollback. The
  dry-run `/config/validate` is **not** gated — usable anywhere as a pre-check.
- On success the handler calls `refreshRegistryOverlay` so the live validator picks
  up the new GLOBAL config immediately.

**Key consequence:** corpus is only needed at **publish/gate time** (request body),
never in the hot `validate` path (the overlay uses only `mapping` + `rules`). So
**nothing needs to be bundled into the Lambda.**

## Phase 1 — Expose each integration's corpus as importable data

- **Objective:** give the publisher (and the gate test) a typed, importable corpus
  per integration, instead of `fs`-reading `__corpus__/`.
- **Scope (in):** add a `corpus` export per integration (e.g. `weichertCorpus`,
  `longhaulCorpus`) that imports the `__corpus__/<id>/*.json` cases as
  `GateCorpusCase[]` (via `resolveJsonModule`, or a tiny generated index). Optionally
  surface it on the built-in `IntegrationDefinition` as `corpus?`. **(out):** any
  engine/gate change; bundling corpus into the Lambda runtime (not needed).
- **Deliverables:** `<integration>Corpus` exports; gate-pipeline test switched to the
  export (optional); a test asserting the export equals the `__corpus__` files.
- **DoD:** `import { weichertCorpus }` returns the cases; `runGatePipeline(base,
{ mapping, rules, corpus })` is `ok` for both integrations using the exports.
- **When launched, cover:** whether to also attach `corpus` to `IntegrationDefinition`
  (only if the API should ever self-publish built-ins), and the `resolveJsonModule`
  / esbuild include for the JSON.

## Phase 2 — Publish prerequisites (auth + flag) in QA

- **Objective:** be able to authenticate as the platform tenant with publish rights,
  with the flag on in QA.
- **Scope (in):** provision (or locate) a **`vnd_` API key for the platform tenant**
  (`isPlatformTenant = true`) whose acts-as user has `Actions.PublishIntegrationConfig`
  (check the RBAC role map / `authz/actions.ts` + Cedar policies); set
  `INTEGRATION_CONFIG_PUBLISH_ENABLED=true` in the QA API env (CDK/Lambda env).
  **(out):** prod (Phase 5).
- **Resolves:** who can publish GLOBAL, and the QA flag state.
- **DoD:** `POST /api/v1/integrations/longhaul/config/validate` and `.../weichert/...`
  as that key return `{ data: { ok: true } }` (dry-run gate passes for both built-ins).
- **When launched, cover:** the exact platform-tenant id + key provisioning steps and
  where the QA flag is set.

## Phase 3 — Publish script (the dogfood)

- **Objective:** push the two built-ins through the real publish path as GLOBAL.
- **Scope (in):** a node script (`apps/api/scripts/publish-builtin-configs.ts`) that,
  for each of `longhaul` + `weichert`: assembles `{ mapping, rules, corpus }` from the
  built-in exports (mapping/rules from `transform/<id>.transform.ts` + `rules/<id>.rules.ts`,
  corpus from Phase 1); `POST /config/validate` (pre-check, fail loud if not ok); then
  `POST /config` (publish). Reads API base + the `vnd_` key from env. Idempotent in
  spirit (a re-run just bumps the version; prior PUBLISHED → SUPERSEDED). **(out):**
  any change to the endpoint; the SDK CLI (see Open questions).
- **DoD:** GLOBAL `IntegrationConfig` rows (version 1) exist for both integrations in
  QA; the handler's `integration config published` log fired for each.
- **When launched, cover:** the script's env contract and a `--dry-run` mode that only
  hits `/config/validate`.

## Phase 4 — Verify: overlay live + behavior unchanged

- **Objective:** prove the published GLOBAL configs are being served and validation is
  byte-for-byte unchanged vs the built-in floor.
- **Scope (in):** `GET /config` + `/config/versions` show the rows; run **every**
  corpus case (both integrations) through `POST /api/v1/integrations/:id/validate` and
  assert the `{ valid, issues }` outcomes are **identical** to the pre-publish results
  (a tiny diff harness). Because the published mapping/rules equal the built-ins, the
  expected diff is **none** — that's the safety proof.
- **DoD:** zero validation diffs; both rows present and active; overlay confirmed
  refreshed (validate served the DB config).
- **When launched, cover:** the diff harness (capture outcomes before publish, compare
  after).

## Phase 5 — Prod rollout (separate, flag-gated)

- **Objective:** repeat in prod once QA is clean.
- **Scope (in):** `INTEGRATION_CONFIG_PUBLISH_ENABLED=true` in prod; run the Phase 3
  script against prod as the platform tenant; run the Phase 4 verify. **(out):** any
  behavior change (configs remain identical to the floor).
- **DoD:** GLOBAL rows in prod; zero validation diffs.

## Risks → mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published config diverges from / breaks behavior                                                | Publish configs **identical** to the built-ins (Phase 4 diff = none); built-in code stays the fallback floor if the overlay row is missing/unparseable              |
| No platform-tenant key with publish rights                                                      | Phase 2 provisions it before any publish; dry-run `/config/validate` confirms before mutating                                                                       |
| Corpus mistakenly assumed needed at runtime                                                     | It isn't — overlay uses only mapping/rules; corpus is request-supplied at publish only (no Lambda bundling)                                                         |
| Canonical contract changes in code later → a stored config fails the gate                       | By design (gate re-runs on rollback); built-in floor protects the live path                                                                                         |
| Weichert legacy `$from` paths still INFERRED (`KeyMoveDates.*.Actual`, `Survey.ShipmentStatus`) | Doesn't block publishing identical-to-floor; confirm against the real client payload before relying on the date rules in anger (flagged in `weichert.transform.ts`) |

## Open questions / decisions

1. **SDK CLI vs node script.** `config.ts` comments mention "the CLI `pull` can
   round-trip" — is there (or planned) an SDK/CLI `push` for integration configs
   (the "publish via the SDK" path), or is the Phase-3 node script the intended
   dogfood vehicle? If the CLI exists, use it instead of the script.
2. **Platform-tenant identity.** Which tenant is `isPlatformTenant=true`, and does
   its service account/key carry `PublishIntegrationConfig`? Confirm before Phase 2.
3. **API self-publish?** Keep publishing external (script/SDK), or add an admin
   "publish built-in as GLOBAL" path inside the API (would require attaching `corpus`
   to the built-in definition / bundling — Phase 1 optional extension)?

```

```
