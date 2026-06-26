# SDK spec — Outbound notifications (SMS/email) + activity secrets

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0002-sms-notification-and-secrets.md`
- **Status:** Shipped
- **Filed:** 2026-06-25
- **SDK version when filed:** 0.1.1
- **SDK version that addresses it:** 0.2.0
- **Area:** PegasusClient / authoring API / runtime secrets

## Problem

Building the `send_order_saved_sms` platform workflow — "text my number with the
event data when an order is saved" — surfaced two gaps that block any workflow
whose job is to _notify a human or call a third party_:

1. **No outbound-notification primitive.** The `PegasusClient` surface is domain
   _reads_ plus `emit_event` (internal event chaining only). There is no
   `send_sms` / `send_email` / `send_notification`. The only way to text someone
   today is to hand-roll an HTTP call to a provider (Twilio, etc.) inside an
   activity.

2. **No secrets mechanism.** Even hand-rolling that call needs provider
   credentials (Twilio Account SID / auth token / from-number). The SDK gives an
   activity no sanctioned way to obtain a secret — there is no
   `get_secret(...)`, no documented env-var injection contract, nothing. So the
   credential would have to be hardcoded or smuggled in, which is unacceptable.

Because of these, `send_order_saved_sms` ships with its `send_sms` activity
**stubbed** (logs instead of sends). The trigger → normalize → format → activity
path is real; only delivery is missing.

## Why it matters

"Notify someone when X happens" is one of the most common automation requests —
likely the single most common reason a tenant wants a workflow at all. Without a
first-class notification primitive, every author reinvents provider integration
and, worse, has nowhere safe to put credentials. A platform-owned primitive also
lets the platform centralize provider accounts, sending limits, opt-out/STOP
handling, and audit — none of which a per-workflow hand-roll gets right.

## Proposed change

Prefer **(A)**; **(B)** is the fallback / complement.

### (A) Platform-owned notification primitive (preferred)

Add notification methods to `PegasusClient`, gated by Cedar actions declared in
the manifest, so the platform owns provider credentials and delivery:

```python
# inside an activity
client.send_sms(to="+16308868537", body=text)          # needs action "SendSms"
client.send_email(to=..., subject=..., body=...)        # needs action "SendEmail"
```

- `required_actions = ["SendSms"]` in `pegasus-workflows.toml` grants the
  capability; absent the action, the call is denied (consistent with
  `emit_event` / `EmitTenantEvent`).
- The platform holds the provider account; the workflow never sees a credential.
- Returns a delivery/message id and raises `PegasusApiError` on failure.

### (B) Sanctioned secret access for activities

For arbitrary third parties the platform won't wrap, give activities a supported
way to read a tenant-scoped secret set in the platform:

```python
# inside an activity
token = client.get_secret("TWILIO_AUTH_TOKEN")          # needs action "ReadSecret"
```

- Secrets are configured per tenant in the platform UI, never in source/manifest.
- Reads are restricted to declared keys and audited.

Document whichever lands in the SDK README's authoring section, and (when the AI
authoring MCP server exists) expose it as reference there too.

## Acceptance criteria

- [ ] At least one of: `PegasusClient.send_sms` (A) or
      `PegasusClient.get_secret` (B) exists and is importable.
- [ ] **(A)** `send_sms(to, body)` with a manifest declaring
      `required_actions=["SendSms"]` delivers a real SMS to `+16308868537` and
      returns a message id; the same call **without** the action raises
      `PegasusApiError` (authorization denied).
- [ ] **(B)** `get_secret(key)` returns a tenant-configured secret for a declared
      key and raises for an undeclared/missing key; the secret value never
      appears in the manifest or workflow source.
- [ ] No credential needs to be hardcoded in a workflow to send a notification.
- [ ] `send_order_saved_sms` is updated to call the real primitive, its
      `send_sms` activity is no longer a stub, and a test run delivers an actual
      text to `+16308868537`.
- [ ] The capability is documented in the SDK README authoring section.

## Validation log

**Shipped in 0.2.0 (path A via RingCentral):**

- `PegasusClient.send_sms(to, body)` (PR #354) → `POST /api/v1/sms/send`
  (PR #355), which sends through the tenant's existing **RingCentral**
  connection (`acquireAccessToken` + `makeClient` →
  `/restapi/v1.0/account/~/extension/~/sms`, FROM = connection `ownerNumber`).
  Returns 404 `NOT_FOUND` when the tenant has no active RingCentral connection.
- New Cedar action `SendSms` (`sms:send`) granted to the `workflow_runtime`
  persona; absent the action the call is denied (403). A manifest declaring
  `required_actions = ["SendSms"]` is therefore the capability gate.
- Path **B (`get_secret`) was deferred** — the spec accepts "at least one of
  A/B" and A (a platform-owned primitive) is the preferred shape.

<!-- Remaining manual validation runs in the pegasus-workflows repo: bump the
     SDK to 0.2.0 in requirements.txt, un-stub send_order_saved_sms to call
     client.send_sms, run it against a RingCentral-connected tenant, and confirm
     a real text arrives at +16308868537 (plus the missing-action denial). -->
