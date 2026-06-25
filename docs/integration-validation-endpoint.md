# Integration Validation Endpoint — Integration Client Handoff

> **Audience:** a system that submits orders to Pegasus on a partner integration's
> behalf and wants them checked before they are written.
> **Status:** POC. One integration supported: `weichert`. The endpoint is live
> behind API-key auth; wiring a client's save flow to call it is the task this doc
> describes. (The original `longhaul` POC integration was removed — see git
> history; another integration is re-added as data, not new endpoint code.)

## What it is

A **stateless, synchronous validator**. You POST an order's proposed state; it
checks that state against the integration's declarative rules and returns a
pass/fail plus a list of issues, each mapped to the order field that caused it.
It touches no database and resolves no tenant — it just validates and replies.

Use it at **save time**: call it before you write the order, show the user any
issues, and block the save on a hard failure. If the call fails or times out,
**proceed** (fail-open) — see [Timeout & fail-open](#timeout--fail-open).

## Endpoint

```
POST {API_BASE_URL}/api/v1/integrations/weichert/validate
```

`{API_BASE_URL}` is the same API host the rest of `/api/v1/*` uses (prod and QA
each have their own).

### Auth

API key, same scheme as other machine-to-machine endpoints. Send a valid,
non-revoked vendor key (`vnd_…`) as a Bearer token. **Any tenant's key works** —
the validator reads no tenant data.

```
Authorization: Bearer vnd_xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

| Auth outcome               | Response                         |
| -------------------------- | -------------------------------- |
| Missing / non-`vnd_` token | `401 { "code": "UNAUTHORIZED" }` |
| Revoked key                | `403 { "code": "FORBIDDEN" }`    |

## Request body

```jsonc
{
  "action": "save", // "save" | "cancel" | "status-change"  (default: "save")
  "order": {
    /* the proposed order, in the integration's native payload shape */
  },
  "prior": {
    /* OPTIONAL: the order's current persisted state, same shape */
  },
}
```

- **`order`** — the order as it _will be_ after the save. Required.
- **`action`** — what the user is doing. Drives action-scoped rules. Omit for a
  normal save.
- **`prior`** — the order's _current_ persisted state, for any transition rules.
  Omit it and those rules simply don't run; the rest still do. A malformed `prior`
  is ignored, not an error.

### Order shape (what the validator reads)

The `order` (and `prior`) use the integration's **native legacy payload shape**;
you can send the object you're about to persist as-is — only the fields the
mapping reads are used, everything else is ignored. For `weichert` that is the
Weichert move object (`InvolvedParties` / `Survey` / `KeyMoveDates` /
`DocumentationDates` / `Financials`). The authoritative field list is the mapping
itself: `transform/weichert.transform.ts`. The examples below are complete,
copy-pasteable payloads.

## Response

Always `200` when validation ran, regardless of pass/fail:

```jsonc
{
  "valid": true, // false ⇒ at least one issue
  "issues": [
    // empty when valid
    {
      "ruleId": "service-status-not-supplier-settable",
      "field": "serviceStatus", // the order field the issue maps to
      "message": "The supplier cannot change the Service Status to Requested, Awarded, Cancelled, or Declined…",
      "kind": "behavioral", // or "structural" (bad shape)
      "severity": "error",
    },
  ],
  "degraded": false, // true ⇒ the validator failed internally and FAILED OPEN
  //        (it did NOT actually check — treat as "proceed")
}
```

Other responses:

| Status | Body code          | Meaning                           |
| ------ | ------------------ | --------------------------------- |
| `400`  | `VALIDATION_ERROR` | request body wasn't valid JSON    |
| `401`  | `UNAUTHORIZED`     | missing/invalid API key           |
| `403`  | `FORBIDDEN`        | API key revoked                   |
| `404`  | `NOT_FOUND`        | unknown integration id in the URL |

## Rules currently enforced (weichert)

These reproduce the live Weichert Move Network rejections, one-for-one. Source:
`rules/weichert.rules.ts`.

| `ruleId`                                        | Fires when                                                                     | `field`                |
| ----------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| `service-status-not-supplier-settable`          | `serviceStatus` is set to Requested, Awarded, Cancelled, or Declined           | `serviceStatus`        |
| `invalid-supplier-email`                        | the supplier contact email is malformed                                        | `supplierContactEmail` |
| `submit-requires-supplier-contact`              | `serviceStatus` = Submitted with no supplier contact                           | `supplierContactName`  |
| `submit-requires-contact-made-date`             | `serviceStatus` = Submitted with no contact-made date                          | `contactMadeDate`      |
| `submit-requires-survey-date`                   | `serviceStatus` = Submitted with no survey date                                | `surveyDate`           |
| `submit-requires-estimated-total-cost`          | `serviceStatus` = Submitted with a zero/absent estimated total cost            | `shipments`            |
| `in-progress-requires-pack-load-actuals`        | a shipment is In Progress without Pack + Load Date 1 Actual                    | `shipments`            |
| `delivered-requires-pack-load-delivery-actuals` | a shipment is Delivered/Completed without Pack + Load + Delivery Date 1 Actual | `shipments`            |

`structural` issues (e.g. a `shipmentStatus` outside the restricted picklist) use
`ruleId: "structural-contract"` and a `field` pointing at the offending path.

> **Still deferred** (no field on the HHG payload): "In Progress requires Awarded
> by WMN", Move On-Hold/Closed/Cancelled lock (an Auto-order concept), and
> storage-service close (a separate LTS Order payload).

## How a client should integrate

At the point the user clicks **Save** (or **Cancel**):

1. Build the order payload you're about to persist.
2. POST it to the endpoint with the API key. Use a **tight timeout** (e.g. 2–3 s).
3. Branch on the response:
   - **`200` and `valid: true`** → proceed with the save.
   - **`200` and `valid: false`** → **block the save**; show `issues[].message`,
     ideally highlighting the named `field`.
   - **`200` and `degraded: true`** → proceed (validator failed open; don't block
     the user on our defect).
   - **timeout / network error / `5xx`** → proceed (fail-open) and log it.
   - **`401`/`403`** → a key/config problem on our side — log loudly; don't
     silently block users. (Treat as fail-open for the save, fix the key.)

> The endpoint is **advisory** by construction: it can't stop a write you choose
> to make. Enforcement = the client honoring `valid: false` and aborting its own
> save. That contract lives on your side.

### Timeout & fail-open

A validator outage must never freeze saves. Default to **fail-open**: on timeout,
network failure, `5xx`, or `degraded: true`, let the save through and record a
warning. Only `valid: false` should block, and only when the call clearly
succeeded.

## Examples

**Pass** — a well-formed Accepted order:

```bash
curl -sS -X POST "{API_BASE_URL}/api/v1/integrations/weichert/validate" \
  -H "Authorization: Bearer vnd_xxx" -H "Content-Type: application/json" \
  -d '{"action":"save","order":{"Id":"SHIP-1","InvolvedParties":{"ShipperEmployer":{"Identity":{"Description":"O-60232"}},"Coordinator":{"Identity":{"Description":"Suzanne Polo"},"EmailAddress":"noreply@weichertwm.com"}},"Survey":{"SerivceStatus":"Accepted"},"DocumentationDates":["2024-05-25"],"KeyMoveDates":{"Survey":{"Planned":"2024-05-25"}},"Financials":{"EstimatedWeight":5000}}}'
# → {"valid":true,"issues":[],"degraded":false}
```

**Fail** — a supplier-forbidden service status (`Awarded`):

```bash
curl -sS -X POST "{API_BASE_URL}/api/v1/integrations/weichert/validate" \
  -H "Authorization: Bearer vnd_xxx" -H "Content-Type: application/json" \
  -d '{"action":"save","order":{"Id":"SHIP-1","InvolvedParties":{"ShipperEmployer":{"Identity":{"Description":"O-60232"}},"Coordinator":{"Identity":{"Description":"Suzanne Polo"},"EmailAddress":"noreply@weichertwm.com"}},"Survey":{"SerivceStatus":"Awarded"}}}'
# → {"valid":false,"issues":[{"ruleId":"service-status-not-supplier-settable","field":"serviceStatus","message":"…","kind":"behavioral","severity":"error"}],"degraded":false}
```

### VB.NET sketch

```vbnet
Using client As New Net.Http.HttpClient()
    client.Timeout = TimeSpan.FromSeconds(3)
    client.DefaultRequestHeaders.Authorization =
        New Headers.AuthenticationHeaderValue("Bearer", apiKey)

    Dim payload = New With {.action = "save", .order = orderDto}   ' serialize to JSON
    Dim content = New Net.Http.StringContent(
        Newtonsoft.Json.JsonConvert.SerializeObject(payload),
        Text.Encoding.UTF8, "application/json")

    Try
        Dim resp = Await client.PostAsync(
            apiBase & "/api/v1/integrations/weichert/validate", content)
        If resp.IsSuccessStatusCode Then
            Dim result = Newtonsoft.Json.JsonConvert.DeserializeObject(Of ValidationResult)(
                Await resp.Content.ReadAsStringAsync())
            If Not result.valid AndAlso Not result.degraded Then
                ShowIssuesAndBlockSave(result.issues)   ' block; surface messages per field
                Return
            End If
        End If
        ' 200+valid, degraded, non-2xx, or exception below → fall through and save
    Catch ex As Exception
        Log.Warn("integration validation unreachable; proceeding (fail-open)", ex)
    End Try

    SaveOrder(orderDto)
End Using
```

## Registered integrations

One integration is registered (use the id in the URL):

- **`weichert`** — the Weichert Supplier Move Network (Salesforce-backed). See the
  rule table above. The Weichert mapping is authored in the output-shaped format —
  see [`integration-mapping-format.md`](./integration-mapping-format.md). Source:
  `rules/weichert.rules.ts`, `canonical-weichert.ts`, `transform/weichert.transform.ts`.

The live, machine-readable list is `GET /api/v1/integrations`.

## Notes & limits (POC)

- **Global, not per-tenant:** a single shared rule definition per integration;
  tenant-specific rules are out of scope for the POC. (A DB-published GLOBAL config
  can override the editable surface — see the integration-config authoring flow.)
- **No persistence / side effects:** the call is pure validation.
- Source of truth: `apps/api/src/integration-validation/` — rules in
  `rules/<integration>.rules.ts`, canonical contract in `canonical-<integration>.ts`,
  mapping in `transform/<integration>.transform.ts`. Updating a rule or mapping is a
  data change in that folder, not a handler change.

```

```
