# Integration Validation Endpoint — Legacy App Handoff

> **Audience:** the legacy desktop app (Pegasus.MoveManager / WinForms) team.
> **Status:** POC. One integration supported: `longhaul`. The endpoint is live
> behind API-key auth; wiring the desktop app's save flow to call it is the
> legacy-side task this doc describes.

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
POST {API_BASE_URL}/api/v1/integrations/longhaul/validate
```

`{API_BASE_URL}` is the same API host the rest of `/api/v1/*` uses (the same base
the legacy API bridge already talks to — prod and QA each have their own).

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
    /* the proposed trip, legacy DTO shape — see below */
  },
  "prior": {
    /* OPTIONAL: the trip's current persisted state, same shape */
  },
}
```

- **`order`** — the trip as it _will be_ after the save. Required.
- **`action`** — what the user is doing. Drives action-scoped rules (cancel).
  Omit for a normal save.
- **`prior`** — the trip's _current_ persisted state. Only needed for the
  **transition** rules (driver-change, removing actualized activities). Omit it
  and those two rules simply don't run; the rest still do. A malformed `prior`
  is ignored, not an error.

### Order shape (what the validator reads)

The `order` (and `prior`) use the **same trip DTO the save path already
produces** — you can send the object you're about to persist as-is. Only these
fields are read; everything else is ignored:

| Field (any of)                                                                         | Meaning                                                             |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `TripStatus_id` or `status.status_id`                                                  | numeric trip status (1 = pending, ≥4 = in-progress, ≥5 = finalized) |
| `driver.id` or `driver_id`                                                             | assigned driver id (`null`/absent = unassigned)                     |
| `dispatcher.code` or `dispatcher_id`                                                   | dispatcher code                                                     |
| `shipments[].order_num`                                                                | the trip's shipments                                                |
| `activities[].order_num`, `activities[].ActivityType_code`, `activities[].actual_date` | the trip's activities                                               |
| `id`                                                                                   | trip id (absent/null = create)                                      |

## Response

Always `200` when validation ran, regardless of pass/fail:

```jsonc
{
  "valid": true, // false ⇒ at least one issue
  "issues": [
    // empty when valid
    {
      "ruleId": "no-finalize-without-actual-dates",
      "field": "activities", // the order field the issue maps to
      "message": "Advancing trip to finalized is not allowed until all activities have actual dates",
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

## Rules currently enforced (longhaul)

These mirror the existing longhaul save-time guards, one-for-one:

| `ruleId`                              | Fires when                                                                   | `field`      |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------ |
| `trip-must-have-shipments`            | the trip has no shipments                                                    | `shipments`  |
| `no-advance-without-driver`           | status > 1 (past pending) and no driver assigned                             | `driver`     |
| `no-finalize-without-actual-dates`    | status ≥ 5 (finalize) and any activity has no `actual_date`                  | `activities` |
| `no-driver-change-in-progress`        | `prior` given, status ≥ 4, and the driver changed                            | `driver`     |
| `no-remove-activity-with-actual-date` | `prior` given and an activity with an `actual_date` was dropped from `order` | `activities` |
| `no-cancel-after-in-progress`         | `action: "cancel"` and status ≥ 4                                            | `status`     |

`structural` issues (e.g. a non-numeric status) use `ruleId: "structural-contract"`
and a `field` pointing at the offending path.

## How the legacy app should integrate

At the point the user clicks **Save** (or **Cancel**):

1. Build the order DTO you're about to persist.
2. POST it to the endpoint with the API key. Use a **tight timeout** (e.g.
   2–3 s).
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
> to make. Enforcement = the desktop app honoring `valid: false` and aborting its
> own save. That contract lives on your side.

### Timeout & fail-open

A validator outage must never freeze saves. Default to **fail-open**: on
timeout, network failure, `5xx`, or `degraded: true`, let the save through and
record a warning. Only `valid: false` should block, and only when the call
clearly succeeded.

## Examples

**Pass** — pending create with one shipment:

```bash
curl -sS -X POST "{API_BASE_URL}/api/v1/integrations/longhaul/validate" \
  -H "Authorization: Bearer vnd_xxx" -H "Content-Type: application/json" \
  -d '{"action":"save","order":{"TripStatus_id":1,"shipments":[{"order_num":100}],"activities":[]}}'
# → {"valid":true,"issues":[],"degraded":false}
```

**Fail** — finalizing with an activity missing its actual date:

```bash
curl -sS -X POST "{API_BASE_URL}/api/v1/integrations/longhaul/validate" \
  -H "Authorization: Bearer vnd_xxx" -H "Content-Type: application/json" \
  -d '{"action":"save","order":{"TripStatus_id":5,"driver":{"id":7},"shipments":[{"order_num":100}],"activities":[{"order_num":100,"ActivityType_code":"DELIVER","actual_date":null}]}}'
# → {"valid":false,"issues":[{"ruleId":"no-finalize-without-actual-dates","field":"activities","message":"…","kind":"behavioral","severity":"error"}],"degraded":false}
```

**Transition** — driver change on an in-progress trip (needs `prior`):

```bash
curl -sS -X POST "{API_BASE_URL}/api/v1/integrations/longhaul/validate" \
  -H "Authorization: Bearer vnd_xxx" -H "Content-Type: application/json" \
  -d '{"action":"save",
       "order": {"id":50,"TripStatus_id":4,"driver":{"id":99},"shipments":[{"order_num":100}],"activities":[]},
       "prior": {"id":50,"TripStatus_id":4,"driver":{"id":7},"shipments":[{"order_num":100}],"activities":[]}}'
# → valid:false, ruleId "no-driver-change-in-progress"
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
            apiBase & "/api/v1/integrations/longhaul/validate", content)
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

Two integrations are registered (use the id in the URL):

- **`longhaul`** — the on-prem dispatch system (see the rule table above).
- **`weichert`** — the Weichert Supplier Move Network (Salesforce-backed). Rules:
  serviceStatus must be supplier-settable (not Requested/Awarded/Cancelled/Declined);
  submitting an estimate (`Submitted`) requires supplier contact, contact-made date,
  survey date, and a non-zero estimated total cost; supplier email must be
  well-formed; **In Progress** requires Pack + Load Date 1 Actual on a shipment;
  **Delivered/Completed** requires Pack + Load + Delivery Date 1 Actual; the
  per-shipment `shipmentStatus` is a restricted picklist (Under Review/In Process/
  In Storage/Delivered/Completed/Cancelled). **Still deferred** (no field on the HHG
  payload): "In Progress requires Awarded by WMN", Move On-Hold/Closed/Cancelled lock
  (an Auto-order concept), and storage-service close (a separate LTS Order payload).
  See `rules/weichert.rules.ts`. The Weichert mapping is authored in the output-shaped
  format — see [`integration-mapping-format.md`](./integration-mapping-format.md).

## Notes & limits (POC)

- **Global, not per-tenant:** a single shared rule definition per integration;
  tenant-specific rules are out of scope for the POC.
- **No persistence / side effects:** the call is pure validation.
- Source of truth: `apps/api/src/integration-validation/` — rules in
  `rules/<integration>.rules.ts`, canonical contract in `canonical-<integration>.ts`,
  mapping in `transform/<integration>.transform.ts`. Updating a rule or mapping is a
  data change in that folder, not a handler change.
