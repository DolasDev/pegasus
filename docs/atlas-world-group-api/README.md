# Atlas World Group API — research + Pegasus integration gap analysis

**Researched:** 2026-07-30 · **Source:** Atlas QA Azure API Management (`atlas-qa-api-apim`)
**Scope:** all 24 published APIs / 255 operations, exported as OpenAPI 3 into [`openapi/`](./openapi).
**Live-verified:** 2026-08-20 against a working QA subscription key.

> ### ⚠️ Read this before trusting anything below
>
> The 2026-07-30 research was written **without a subscription key** — every claim about runtime
> behavior was inferred from the specs. On **2026-08-20** a working key arrived and the inferences
> were tested. Three of them were wrong:
>
> 1. **`On-Behalf-Of` must never be sent.** The doc argued it was required on 91% of our surface and
>    that header passthrough was what unlocked the tier. The opposite is true: omitting it returns
>    `200`, sending it returns `400`. See "The `On-Behalf-Of` header".
> 2. **Our grant is 6 APIs / 102 operations, not 8 / 117.** `RadsSupport-v1` returns `401`. See
>    "Our measured grant".
> 3. **The settlements pilot has no identified Atlas source.** The word "settlement" appears twice
>    in the entire catalog, both incidental. See "Financial data — where settlements are not".
>
> Anything not marked **VERIFIED** below is still spec-inferred and may fail the same way.

| File                             | What it is                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`OUTREACH.md`](./OUTREACH.md)   | Open questions for Atlas, as a ready-to-send draft — rewritten 2026-08-20                         |
| [`INVENTORY.md`](./INVENTORY.md) | Every one of the 255 operations, per API, flagged for `On-Behalf-Of` / multipart / base64 content |
| [`openapi/*.json`](./openapi)    | The 24 OpenAPI 3 documents, byte-for-byte as APIM exported them                                   |
| `apim-apis.json`                 | APIM's own API metadata (ids, paths, versions, `subscriptionRequired`)                            |
| `apim-products.json`             | The 5 products and their approval requirements                                                    |
| `apim-tags.json`                 | The 56 tags APIM uses to group operations                                                         |

---

## 1. How to re-fetch this

Atlas's developer portal (`https://atlas-qa-api-apim.developer.azure-api.net`) is an Azure APIM
portal. Nothing about the APIs is anonymously readable — the portal is a SPA and every API/product
read against its backing management endpoint returns 401. The programmatic path is:

1. `GET /config.json` on the portal host returns `managementApiUrl` + `managementApiVersion`.
2. `GET {managementApiUrl}/identity?api-version={v}` with `Authorization: Basic base64(email:password)`
   returns an **`Ocp-Apim-Sas-Token`** response header (~1 h lifetime).
3. Every subsequent call uses `Authorization: SharedAccessSignature {that token}`.
4. Per-API spec export: `GET {managementApiUrl}/apis/{apiId}?export=true&format=openapi%2Bjson-link&api-version={v}`
   returns `{"value":{"link":"<blob SAS url>"}}`; fetch that link (short-lived, ~5 min) for the JSON.

5. **`GET {managementApiUrl}/users/{userId}/subscriptions`** returns **200** at developer role and
   is the authoritative "do we hold a key" check — the admin `/subscriptions` collection is 403, but
   this one is not. The `{userId}` comes from step 2's response body (`{"id": "<userId>"}`).
   Likewise `/products/{id}/apis` is readable while `/groups`, `/namedValues` and all `/policies`
   are 403.

No fetch script is committed here because it needs portal credentials.

**Subscription status (2026-08-20).** The portal account still reports
`/users/{uid}/subscriptions` → `count: 0`, yet we now hold a **working QA subscription key** that
Atlas issued admin-side. Keys work at the gateway regardless of portal ownership, but this one
cannot be viewed or rotated from the portal — see open question 2. The original research
(2026-07-30) was conducted with **no key at all**, so everything not marked VERIFIED is
spec-inferred.

**Environments.** Three exist, and only the first appears in any spec:

| Host                            | APIM instance         | Our access                            |
| ------------------------------- | --------------------- | ------------------------------------- |
| `qa-azapi.atlasworldgroup.com`  | `atlas-qa-api-apim`   | portal account + working key          |
| `azapi.atlasworldgroup.com`     | `atlas-prod-api-apim` | no portal account (401); key untested |
| `dev-azapi.atlasworldgroup.com` | `atlas-dev-api-apim`  | no portal account (401); QA key 401s  |

---

## 2. What Atlas actually publishes

**24 APIs, 255 operations, all `https`, all gateway-fronted at `https://qa-azapi.atlasworldgroup.com/{path}/{version}`.**

Methods: 180 GET · 56 POST · 9 PUT · 9 DELETE · 1 HEAD. This is a **read-heavy pull API**.

| API                                                    |     Ops | Domain                                                              |
| ------------------------------------------------------ | ------: | ------------------------------------------------------------------- |
| `estimating-v2`                                        |      58 | Estimates/quotes — line items, accessorials, valuation, survey data |
| `assetmanagement-v1`                                   |      49 | Containers, trailers, repositioning, usage + location reporting     |
| `RadsSupport-v2` / `-v1`                               | 31 / 14 | Tariffs, pricing contracts, pricing methods, distribution terms     |
| `documents-v1`                                         |      13 | Shipment / AccountsPayable / RiskMgt / Canada document store        |
| `claims-v1`                                            |      12 | Claims intake, item categories, damage locations/directions         |
| `customers-v2`                                         |      10 | Customer + business master data, business lines, tariffs, statuses  |
| `agents-v1`                                            |       9 | Agent directory, families, salespeople, shipment auths              |
| `cubesheets-v1`                                        |       8 | Cube sheets — surveyed household-goods inventory                    |
| `authorizations-v1`                                    |       7 | Order authorizations (spend approvals)                              |
| `echo-api`                                             |       6 | APIM's stock echo/test API                                          |
| `yembo-v1`                                             |       5 | Yembo AI survey — companies, moves, locations                       |
| `customer-shipment-v1`                                 |       4 | Create orders + shipments, read/update by order number              |
| `shipment-management-v1`                               |       4 | Read/update shipment, post shipment notes                           |
| `atlasorder-v1`                                        |       4 | `GetShipment{Json,XML}`, `GetPreviousShipment{Json,XML}`            |
| `mileage-v1`                                           |       4 | AMSA / PCMiler / Rand19 mileage lookups                             |
| `holidays-v1`                                          |       4 | Calendars, holidays, next/previous working day                      |
| `move4u-integration-v1`                                |       3 | Move4U survey callbacks (inbound _to Atlas_) + item lists           |
| `tonnages-v1`                                          |       3 | Tonnage request/accept                                              |
| `finance-v1`                                           |       2 | Invoice-delivery email routing, ReloDirect entities                 |
| `RatingSystem-v1`                                      |       2 | `IsEligibile/{orderNumber}`, `RateOrder/{orderNumber}`              |
| `emailing-v1` · `questionnaire-v1` · `transitguide-v1` |  1 each | Send email · questionnaire · transit-time guide                     |

### Auth: subscription key only

Every one of the 24 APIs declares exactly two security schemes and **nothing else**:

```
apiKey, in: header, name: Ocp-Apim-Subscription-Key
apiKey, in: query,  name: subscription-key
```

`subscriptionRequired: true` on all 24. There is **no OAuth2, no OIDC, no bearer scheme** anywhere in
the catalog. Products: `starter` (no approval), `agent-limited`, `customer-shipment`,
`move4u-integration`, `unlimited` (all approval-required).

### The `On-Behalf-Of` header

> **VERIFIED 2026-08-20 — do not send this header.** The original reading below was backwards.

Measured against the live QA gateway:

| Request                                                       | Result         |
| ------------------------------------------------------------- | -------------- |
| `GET /customers/v2/Location/Types` with **no** `On-Behalf-Of` | **200** + data |
| Same, `On-Behalf-Of: not-a-real-identifier-zzz`               | **400**        |
| Same, `On-Behalf-Of: dolasllc@gmail.com`                      | **400**        |

The 400 body is identical in both cases:

```json
{
  "title": "One or more on behalf of errors occurred.",
  "errors": { "On-Behalf-Of": ["User is not allowed to make request on behalf of another user."] }
}
```

The behavior is **per-API and matches the spec declaration**: every API that declares the header
rejects it (`cubesheets-v1`, `shipment-management-v1`, `customers-v2` all confirmed), while
`agents-v1` — which does not declare it — ignores it and returns 200 either way.

**Read the error carefully: it is a _permission denial_, not a protocol rejection.** The subscription
key evidently executes as some Atlas-side identity, and impersonating a different user is a privilege
this subscription does not hold. So "never send `On-Behalf-Of`" is true **of this subscription
today** — it is not an invariant of the Atlas API. If Atlas grants impersonation, the header returns.

That reframes the open question rather than closing it. The live question is now **whose identity
does our key act as, and whose data does it see?** — which matters directly because Pegasus is
multi-tenant and different tenants may be different Atlas agents. Suggestive but not conclusive:
`agents/v1/Companies` and `cubesheets/v1/Cubesheets` both return `[]` while `customers/v2/Customers`
returns 50 rows. That is indistinguishable between "thin QA dataset" and "scoped to an identity that
owns nothing".

**Original spec-inferred reading, retained for the record:** 142 of 255 operations (55%) declare
`On-Behalf-Of` — _"Specifies the user on whose behalf the request is made."_ `required: false`, but
present on 100% of operations in nine APIs, plus 2 `authorizations-v1` ops using
`On-Behalf-Of-Agent`. The inference that "an identity header on every operation is not decorative"
was reasonable and wrong.

Note also that `questionnaire-v1` passes `firstName`, `lastName`, `emailAddress`, `phoneNumber`,
`orderNumber` and `businessId` as **header** parameters.

### Products — what each subscription actually grants

A subscription key is scoped to a **product**, and a product grants a specific subset of the 24
APIs. The per-product API list _is_ readable at developer role
(`GET {mgmt}/products/{productId}/apis`), even though `/subscriptions`, `/groups` and the policy
documents are not.

| Product              | APIs |     Ops | Approval       | Grants                                                                                                                                       |
| -------------------- | ---: | ------: | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **`agent-limited`**  |    8 | **117** | required       | `estimating-v2`, `RadsSupport-v1`, `documents-v1`, `customers-v2`, `agents-v1`, `cubesheets-v1`, `shipment-management-v1`, `transitguide-v1` |
| `unlimited`          |   23 |     252 | required       | everything except `move4u-integration-v1`                                                                                                    |
| `customer-shipment`  |    1 |       4 | required       | `customer-shipment-v1`                                                                                                                       |
| `move4u-integration` |    1 |       3 | required       | `move4u-integration-v1`                                                                                                                      |
| `starter`            |    1 |       6 | **self-serve** | `echo-api` only                                                                                                                              |

**`starter` is not a trial of the real APIs** — it grants APIM's stock echo endpoint and nothing
else. Self-subscribing to it buys no access to anything in §2.

#### Our measured grant — 6 APIs, 102 operations

> **VERIFIED 2026-08-20.** Atlas said we were on `agent-limited`, and the table above says that
> product grants 8 APIs / 117 ops. **Measurement disagrees**: `RadsSupport-v1` (14 ops) returns
> `401` on real paths, and `transitguide-v1` (1 op) is POST-only and remains untested.

| API                      |     Ops | Live result                                 |
| ------------------------ | ------: | ------------------------------------------- |
| `estimating-v2`          |      58 | reachable (some ops 422 — see spec drift)   |
| `documents-v1`           |      13 | reachable (`/Shipment/Documents` 500s bare) |
| `customers-v2`           |      10 | **200**, 50 customer records                |
| `agents-v1`              |       9 | **200**                                     |
| `cubesheets-v1`          |       8 | **200**, empty collections                  |
| `shipment-management-v1` |       4 | **200**                                     |
| `RadsSupport-v1`         |      14 | **401 — NOT GRANTED**                       |
| `transitguide-v1`        |       1 | untested (no GET operation)                 |
| **Reachable total**      | **102** | vs. 117 documented                          |

**Do not conclude "the portal's product mapping is wrong."** The likelier reading is that **we are
not on `agent-limited` at all**. Atlas issued the keys admin-side — the portal shows
`/users/{uid}/subscriptions` → `count: 0` for our account — and an admin-created subscription can
carry a custom product or a direct API set. Treat the numbers above as _the measured grant of our
subscription_, and do not assert which product it is. Confirming that is an outreach question.

**How to probe scope correctly.** Only a **real** path discriminates. An unsubscribed API on a real
path returns `401`; a **fabricated** path returns `404` on every API regardless of subscription,
because APIM matches the operation before checking the key. A 404-vs-401 sweep over made-up paths
proves nothing — this was tried and produced a uniformly `SUBSCRIBED` table that was pure artifact.

**Spec drift is real.** Several operations the spec marks parameterless fail when called bare:
`GET /Estimating/Order` and `GET /Estimating/Estimates` return **422**, `GET /Shipment/Documents`
returns **500**. Treat "no required parameters" in these specs as unreliable.

Three further consequences, from the original analysis:

|                          | Catalog-wide | Agent-Limited |
| ------------------------ | -----------: | ------------: |
| Operations               |          255 |           117 |
| Declare `On-Behalf-Of`   |    142 (55%) | **107 (91%)** |
| `multipart/form-data`    |           12 |         **0** |
| Map to an existing floor |          ~25 |        **17** |

- ~~**`On-Behalf-Of` jumps to 91%**~~ — **DISPROVEN 2026-08-20.** The claim was that without header
  passthrough (G2) the tier would yield 10 usable operations out of 117. In fact all 102 reachable
  operations work on the subscription key alone, and sending `On-Behalf-Of` _breaks_ them. G2 is not
  what unlocks the tier. (G2 remains justified generically, and the subscription key itself rides
  `AUTH_MODE=apikey`, not G2.)
- **Multipart is moot.** All 12 multipart ops are in `assetmanagement-v1`, which Agent-Limited
  excludes. G3 is not merely deferred — it is out of scope unless the tier changes.
- **The floor gap widens.** Only `documents-v1` (13) and `shipment-management-v1` (4) land on an
  existing floor. The remaining 100 ops — Estimating 58, RadsSupport 14, Customers 10, Cubesheets 8
  — are precisely the domains with no floor (G7).

Notable **exclusions** from Agent-Limited: `atlasorder-v1` (so shipment reads come from
`shipment-management-v1 GET /shipments/{orderNumber}`, not `GetShipmentJson`), `RadsSupport-v2`
(31 ops — we get only v1's 14), `claims-v1`, `RatingSystem-v1`, `authorizations-v1`, `finance-v1`,
`tonnages-v1`, `yembo-v1`, and `customer-shipment-v1` — that last one being order/shipment
**creation**, which is a separate product. Under Agent-Limited we can read and estimate, but cannot
create a shipment at Atlas.

### Rate limits

Only one figure is published, in the `starter` product description: **5 calls/minute, max 100 calls
per week**. No limit is stated for any other product.

The enforced numbers live in APIM **policy documents**, which return 403 at developer role
(`/products/{id}/policies` and `/products/{id}/policies/policy` both refused).

> **PARTIALLY MEASURED 2026-08-20.** ~70 live calls at a burst of roughly 24 calls/minute drew
> **no 429 and no rate-limit response headers whatsoever**. So there is no aggressive per-minute
> throttle on our subscription. This does **not** answer the question: a _weekly_ quota — `starter`
> publishes 100/week — would not have surfaced in a single session, and roughly 70 calls of whatever
> weekly budget exists have now been spent. Responses carry no `X-RateLimit-*` or quota headers, so
> the budget cannot be read without exhausting it.

On a pull-only integration this budget, not the endpoint list, is the binding design constraint.

### Financial data — where settlements are not

> **VERIFIED 2026-08-20.** This is a plan-level finding, not a documentation detail. The
> `vanline-source-binding` design nominates **`settlements`** as its pilot capability
> (`financial-settlement.floor.ts`). Atlas's published catalog does not obviously serve it.

Term frequency across all 24 specs:

| Term           |  Hits | Where                                                                                                                      |
| -------------- | ----: | -------------------------------------------------------------------------------------------------------------------------- |
| `settlement`   | **2** | `estimating-v2` (1), `RatingSystem-v1` (1) — both incidental field names                                                   |
| `remittance`   | **0** | —                                                                                                                          |
| `disbursement` | **0** | —                                                                                                                          |
| `payable`      |    25 | `documents-v1` (19), `RadsSupport-v1` (3), `RadsSupport-v2` (3)                                                            |
| `invoice`      |   260 | `RatingSystem-v1` (107), `atlasorder-v1` (55), `authorizations-v1` (33), `documents-v1` (25), `estimating-v2` (20), others |

**There is no settlement endpoint.** And the invoice-bearing APIs cluster almost exactly in what our
subscription cannot reach — `RatingSystem-v1`, `atlasorder-v1` and `authorizations-v1` account for
195 of the 260 invoice mentions and **all three return 401**.

The reachable financial surfaces are only:

- **`documents-v1`** → `GET|POST|DELETE /AccountsPayable/Documents/{documentId}` — document blobs,
  not structured settlement data.
- **`shipment-management-v1`** → `GET /shipments/{orderNumber}`, whose `Shipment` schema carries an
  `invoices` property alongside `invoiceStatus` and `paymentTiming`.

That second one is the only plausible source, and it is **undocumented**: the spec declares
`invoices` as literally `{"nullable": true}` with no type, no `$ref`, and no item schema. Its shape
cannot be known without fetching a real shipment — and no reachable endpoint yields an order number
to fetch with (`customers-v2` records carry no order/shipment identifier of any kind).

**Consequences.** Until Atlas answers, the settlements pilot cannot be designed against a known
payload; the choice of `settlements` as the pilot capability should be treated as unvalidated; and
"where does settlement data live, and can we have an order number to see its shape?" is the highest
-priority outreach question — above rate limits.

### Payload shapes

- **Request bodies:** `application/json` (52), `text/json` (24), `application/*+json` (24),
  **`multipart/form-data` (12)**, `text/plain` (1). No XML, no form-urlencoded.
- **Responses:** `application/json` (289), `text/plain` (74), `text/json` (74). No declared binary
  responses. `atlasorder-v1` returns XML _as a string body_ from its `…XML` operations.
- **File transfer is base64-in-JSON**, not multipart, on the document paths: `content: {type: string,
format: byte}` on `ShipmentDocument`, `AccountsPayableDocument`, `RiskMgtDocument`,
  `estimating-v2 Document`, `customer-shipment-v1 Document`, `claims-v1 ImageModel.data`,
  `assetmanagement-v1 Attachment.Data` / `TrailerControlSheet.Data`.
- The 12 `multipart/form-data` operations are **all in `assetmanagement-v1`** (report generation,
  `downloadable-documents`, `notes`, `trailer-control-sheets`).
- **No cursor/offset pagination.** `limit` appears on 3 operations; there is no `page`, `offset`,
  `continuationToken`, or `Link`-header paging anywhere.

### Direction of travel: pull-only

There is **no mechanism for Atlas to push to us**. The only push-shaped paths in the catalog —
`estimating-v2 POST /WebHooks/Atlas/Order`, `POST /WebHooks/HubSpot/Survey`, and
`move4u-integration-v1 POST /callbacks` — are endpoints _Atlas receives on_. Nothing registers a
subscriber URL. Any Pegasus↔Atlas integration is **polling plus our own outbound writes**.

---

## 3. Gap analysis vs. Pegasus integrations/workflows

Evidence cited against `main` as of 2026-07-30.

### Blocking — CLOSED (PR: Atlas APIM enablement)

> **Status: fixed.** All five gaps below were closed together. What follows is kept as
> the record of what was wrong and why, since it is the justification for the design.

**G1. No API-key / custom-header auth mode.**
`AUTH_MODE` accepts exactly `oauth2_client_credentials | bearer | none`
(`apps/api/src/handlers/integration-call.ts:219,232,276,285`). Atlas's _only_ credential is the
`Ocp-Apim-Subscription-Key` header. There is no mode that sends it, so **no Atlas operation is
callable** through `call_external`.

**G2. `call-external` cannot send any caller-supplied header.**
`CallBody` has no `headers` field (`integration-call.ts:124-155`); the header set is hardcoded to
`Accept` + `Authorization` + `Content-Type` (`:230,304`). This blocks the subscription key _and_
`On-Behalf-Of`, as well as the `questionnaire-v1` header parameters.

> **Correction 2026-08-20.** This gap was originally justified by "the 142 identity-scoped
> operations stay out of reach" without G2. That justification is void — those operations are
> reachable on the key alone, and `On-Behalf-Of` is rejected when sent. G2 is still a real gap
> (arbitrary outbound headers are a generic requirement, and `questionnaire-v1` genuinely needs
> them), but it did **not** gate the Atlas tier.

`deliver-to-external` _does_ have `headersConfig` (`integration-delivery.ts:58,153-166`), but it reads
a **CONFIG** row — plaintext `value`, not `valueCiphertext` — so using it for a subscription key
stores a live credential in the clear. The two outbound endpoints are inconsistent, and the one that
has the feature is the wrong place to put a secret.

There is a workaround: Atlas also accepts `?subscription-key=`, and we do support `query`
(`integration-call.ts:130`). It should not be used — it forces the workflow to `get_secret()` the key
itself (defeating the entire "credentials never touch workflow code" design of this endpoint) and
puts a live credential into URLs and logs.

### Significant — partially closed

**G3. `multipart/form-data` cannot be sent.** Bodies are always `JSON.stringify` +
`Content-Type: application/json` (`integration-call.ts:304,310`). Blocks the 12 `assetmanagement-v1`
operations.

**G4. 5 MB ceiling on document bytes.** `INLINE_BLOB_MAX_BYTES` (`integration-call.ts:68`) caps both
`{"$blob": id}` request embedding and `responseToBlob`. Atlas's base64 `content` fields are a _good_
fit for our blob mechanism — this is the one place our design and theirs line up cleanly — but
scanned BOLs, claims photo sets and trailer control sheets will exceed 5 MB, and base64 inflates by
~33% on top.

**G5. Response headers are discarded — CLOSED.** Only `content-type` was returned. Loses `Retry-After` (APIM throttles per subscription by policy and
429 is a normal signal), `x-ms-request-id` / `Ocp-Apim-Trace-Location` (the only identifiers Atlas
support can act on), and `ETag`.

**G6. No 429/5xx retry, no backoff, no timeout — CLOSED.** The only retry in the path was a single
OAuth-401 re-mint — dead code for Atlas, which uses no OAuth — and `fetch` was called with no
`AbortSignal`, so a hung partner burned the whole Lambda budget.

### Semantic layer

**G7. Floor coverage is ~10%.** We have five floors — `shipment_status_update`,
`shipment_lifecycle_event`, `sales_lead`, `financial_settlement`, `document_record`
(`apps/api/src/integration-validation/registry.ts:72-81`). Mapping Atlas's catalog onto them:

> **Read with the measured grant in mind (2026-08-20).** This table covers the whole catalog. Of the
> domains below, our subscription can only reach `shipment-management-v1`, `documents-v1`,
> `estimating-v2`, `customers-v2` and `cubesheets-v1`. Every row resting on `atlasorder-v1`,
> `customer-shipment-v1`, `authorizations-v1`, `finance-v1`, `assetmanagement-v1`, `RadsSupport-*`,
> `RatingSystem-v1`, `claims-v1` or `yembo-v1` is **currently unreachable** — including the
> `financial_settlement` row, which is the subject of "Financial data — where settlements are not".

| Atlas domain                                |    Ops | Existing floor                                                                  |
| ------------------------------------------- | -----: | ------------------------------------------------------------------------------- |
| `atlasorder-v1` + `shipment-management-v1`  |      8 | `shipment_status_update` (fits)                                                 |
| `customer-shipment-v1`                      |      4 | `shipment_lifecycle_event` (partial — it's order _registration_, not an event)  |
| `documents-v1`                              |     13 | `document_record` (fits)                                                        |
| `authorizations-v1` + `finance-v1`          |      9 | `financial_settlement` (partial)                                                |
| **`estimating-v2`**                         | **58** | **none** — quoting/estimate                                                     |
| **`assetmanagement-v1`**                    | **49** | **none** — equipment/asset                                                      |
| **`RadsSupport-v1/v2` + `RatingSystem-v1`** | **47** | **none** — tariff/rating                                                        |
| **`claims-v1`**                             | **12** | **none** — claims                                                               |
| **`customers-v2`**                          | **10** | **none** — customer master (`sales_lead` is lead-shaped, not a customer record) |
| **`cubesheets-v1` + `yembo-v1`**            | **13** | **none** — survey/inventory                                                     |

Not every operation needs a floor — reference reads (`holidays`, `mileage`, `agents`, `tonnages`,
`transitguide`) are fine as raw `call_external`. But the domains where we'd want canonical shape,
fact derivation, rules and dry-run gating — **estimates, cubesheet inventory, claims, customer
master, tariffs** — have no floor at all. This matches Atlas's own public description of its AtlasNet
API integration as carrying _"customer details, addresses, and surveyed household goods data"_: the
survey/inventory floor is exactly what we're missing.

Scoped to our actual `agent-limited` tier this gets **worse**, not better: of the 117 operations we
can reach, only `documents-v1` (13) and `shipment-management-v1` (4) land on an existing floor. The
other 100 are Estimating (58), RadsSupport (14), Customers (10) and Cubesheets (8) — four domains,
none of which has a floor. See "Agent-Limited is our tier" in §2.

Structural note: **overlays are publishable, floors are not.** `FLOORS` is a code map
(`registry.ts:72-81`), so each missing floor is a platform PR + deploy, not tenant configuration.

**G8. Rule operators and mapping are thin for this data.** Operators are `eq/ne/gt/gte/lt/lte/in/nin`
over scalar facts only (`integration-validation/rules/types.ts:25,17`) — no regex, prefix, contains,
exists or length. Mapping has no expressions: `$from`/`default`/`$map`/`$each`/`coerce`, with `$map`
a finite lookup table (`transform/mapping-format.ts:21-23`). `estimating-v2`'s nested line-item and
valuation structures will strain both.

### Not a gap after all

Worth recording, because these were live concerns before the specs were readable:

- **OAuth `scope`/`resource`.** Our token minting sends only `grant_type=client_credentials` with
  Basic auth and cannot add `scope` (`services/outbound-oauth/index.ts:266-277`). Irrelevant here —
  Atlas publishes no OAuth scheme. Still a real gap for a future Entra-fronted partner, but **not on
  the Atlas critical path.**
- **XML/SOAP request bodies.** None in the catalog. `atlasorder-v1` returns XML as a string, which our
  text fallback already handles (`integration-call.ts:179`).
- **Header-based pagination.** No paging in the catalog, so G5 costs us diagnostics, not correctness.
- **Ingress (inbound) auth.** Our ingress accepts only a platform-issued bearer, JSON only
  (`handlers/ingress.ts:51-67,92`). Atlas never pushes, so this doesn't block the integration.

---

## 4. Sequencing — status

1. ✅ **G1 + G2 + G2b — DONE.** `AUTH_MODE=apikey` sends the `API_KEY` secret as the header named by
   config `API_KEY_HEADER` (default `Ocp-Apim-Subscription-Key`). Both `call-external` and
   `deliver-to-external` now take `headers` (literal, non-secret) and `secretHeaders` (header name →
   SECRET key name, resolved server-side so the credential never enters workflow code).
   `Authorization`/`Host`/`Content-Length`/`Content-Type` are reserved and rejected, header names
   must be RFC 7230 tokens, and CR/LF values are refused.
   ~~**Atlas reachability: 0 → 243 of 255 operations**~~ — **superseded.** That figure assumed the
   whole catalog was in scope and that G2 was the unlock. Measured 2026-08-20: our subscription
   reaches **102 operations**, on `AUTH_MODE=apikey` alone.
   **Still unverified:** this was proven with `curl` against the gateway. The Pegasus
   `call_external` round-trip through `integration-call.ts` has **not** been exercised against
   Atlas — that remains the outstanding rung of the verification ladder.
2. ✅ **G5 + G6 — DONE.** Both handlers return the full response header map (lowercase keys, minus
   `set-cookie`). Every attempt is bounded by `REQUEST_TIMEOUT_MS` (default 30s, clamped to
   [1000, 60000]) with a distinct `504 UPSTREAM_TIMEOUT`, and 429/503 is retried per `Retry-After`
   (capped at 10s) up to `MAX_RETRIES` — **for idempotent requests only**, so a POST is never
   auto-retried into a duplicate write.
3. ⬜ **G3 + G4** — multipart support and a streaming path above 5 MB. Deferred: needs a request-body
   encoding design, and no business case for `assetmanagement-v1` is identified yet.
4. ⬜ **G7** — new floors, one per domain we commit to. `estimate/quote` and `survey_inventory`
   first; they're the largest surface and the ones Atlas's own integration story centers on.
   Deferred: each is a platform PR _and_ a domain-modeling decision about which Atlas domains we
   actually integrate. Needs a product call.
5. ⬜ **G8** — revisit only if a concrete mapping proves unexpressible.

Items 1–2 shipped in SDK **0.35.0**: `call_external` and `deliver_to_external` gained `headers`,
`secret_headers` and `timeout_config`, documented in the SDK README + CHANGELOG, surfaced through
`pegasus://reference/api` (introspection-generated, so the docstrings carry it), and added to
`GET /openapi.json` — both routes were previously undocumented there.

---

## 5. Open questions

Reordered 2026-08-20 by what actually blocks work. Items settled by live measurement are struck
through with a pointer to the evidence.

**1. Where does settlement data live?** — _highest priority; blocks the pilot, not just the docs._
No settlement endpoint exists in the catalog, and the only plausible reachable source
(`shipments/{orderNumber}` → `invoices`) has no schema. We also need **one real QA order number** so
the payload shape can be observed. See "Financial data — where settlements are not".

**2. What product or scope is our subscription actually on?** Atlas said `agent-limited`; that
product grants `RadsSupport-v1`, and ours returns 401. Is that exclusion deliberate? The
subscription is also invisible in the portal (`count: 0`), which points at an admin-side custom
scope. Related ask: **attach the subscription to `dolasllc@gmail.com`** so it is portal-visible and
self-rotatable.

**3. Whose identity does our key act as?** `On-Behalf-Of` is rejected with _"User is not allowed to
make request on behalf of another user"_, so calls execute as some fixed Atlas identity. We need to
know which, and what data it can see. **Then the multi-tenant question:** Pegasus tenants may be
different Atlas agents — does Atlas want one subscription per agent, or an impersonation grant that
re-enables `On-Behalf-Of`? This determines whether the fetch descriptor needs per-principal values.

**4. What is the real rate limit, including any weekly quota?** No per-minute throttle observed at
~24 calls/min, but a weekly cap would not have shown yet and responses carry no quota headers. See
"Rate limits".

**5. Is there any push/event feed outside this catalog?** Everything published is pull-only. A
"yes" would reverse the polling design and make the ingress surface relevant again.

**6. Prod parity.** `atlas-prod-api-apim` was not accessible with the QA account, and our portal
account exists **only** on QA. Note a **third** environment exists that no spec mentions:
`dev-azapi.atlasworldgroup.com` = `atlas-dev-api-apim` (the QA key 401s there too). Assume the prod
catalog differs until verified.

**7. Do we need anything outside our grant?** Order/shipment _creation_ (`customer-shipment-v1`),
claims, rating, `RadsSupport-v2`, and — critically — the invoice-bearing APIs in item 1 are all
excluded. If the roadmap needs any, that is a product-tier conversation, not an engineering one.

---

### Settled by live measurement

- ~~**Is `On-Behalf-Of` enforced, and what goes in it?**~~ **Answered — never send it.** It is
  rejected with a permission error. But see item 3: this closed the mechanical question and opened
  an identity one.
- ~~**Which product do we need?**~~ **Partly answered, then reopened** — see item 2. The per-product
  API list is readable at developer role; it just does not match what our key does.
- ~~**Do we hold a working key?**~~ **Yes**, as of 2026-08-20 (QA only).
