# Automations skip cleanly when the tenant has no SMS channel

- **Branch:** `fix/sms-skip-no-channel` (pegasus repo). It is started with
  `/workstream-start fix sms-skip-no-channel ~/.claude/plans/sms-skip-when-no-channel.md`.
  The Automation change is a **separate PR in `~/repos/pegasus-workflows`**,
  a different repo with its own process.
- **Goal:** an Automation that calls `send_sms` for a tenant with no SMS channel
  finishes **COMPLETED (skipped)** instead of FAILED. That stops about 100
  failed prod runs a day and removes the false "every prod run fails" baseline
  that hides real regressions.
- **Status:** direction approved by the user 2026-10-04 ("the automation
  should skip cleanly when no SMS channel exists"). This file was written
  2026-10-05 by the session that found the problem. **Step 0 needs a user
  answer** (see below) before the Automation PR.

## Outcome (2026-10-05)

- **Step 0 answered: disable the trigger.** The user chose to disable prod
  trigger `0f17a3a8` (bound to 0.1.1 `dc7b7020`) rather than make the demo skip.
  That's handed off to `pegasus-workflows`; no Automation code change is needed.
- **Deviation: the API _did_ change.** The plan said "no API change needed",
  but `apps/api/src/app.ts` `app.notFound` also returns `404 {code:
'NOT_FOUND'}`, so the SDK couldn't tell "no SMS channel" from a misroute.
  With the user's approval, `/sms/send` now returns 404 **`SMS_NOT_CONNECTED`**
  for this case, and the SDK matches on that code. No platform consumer
  branched on the old code. Only docstrings in `pegasus-workflows` mention
  "404 = no SMS provider", and that is still true on status.
- **The 503 is excluded.** `SERVICE_UNAVAILABLE` (disabled platform-wide) is an
  operator fault, and a gateway 503 under load must not read as "skipped".
- **Email is deferred.** `EMAIL_NOT_CONFIGURED` (503) and
  `EMAIL_RECIPIENTS_NOT_CONFIGURED` (409) already have distinct codes, so an
  `EmailChannelNotConfigured` later is cheap, SDK-only work.
- **In this PR:** SDK 0.44.0 (published by tagging `sdk-python-v0.44.0` after merge), `SmsChannelNotConnected`, with docs in the README,
  the MCP guide, the docstring, the CHANGELOG and OpenAPI.

## Facts (verified 2026-10-02 to 10-05; re-check anything that matters)

- **The failures:** every prod Temporal execution for at least 10 days failed
  (794 from 2026-09-22 to 10-02, about 100 a day). 793 of them are
  `send_order_saved_sms` for tenant `a90b22bc-4393-4e6e-8fe4-4ca01a13aba8`, plus
  one `nw_pulse_send`. Read-only check: `list_workflows("StartTime > '<t>'")`
  with the prod platform key, then `.result()` on a failed run for its chain.
- **The error:** `send_sms` gets `HTTP 404 NOT_FOUND "RingCentral is not
connected for this account"` from `apps/api/src/handlers/sms.ts:~86`. It's
  returned when the tenant has no connection with `tokenStatus === 'ACTIVE'`
  and a non-null `tokenSecretArn`, which covers no connection, an expired
  token, and a missing ARN alike. A **503 `SERVICE_UNAVAILABLE`** ("RingCentral
  integration is not enabled") is returned when OAuth config is absent
  platform-wide.
- **The SDK:** `PegasusClient.send_sms` (`packages/workflows-sdk-python/
pegasus_workflows/api.py:~905-916`) calls `_raise_for_status`, which raises a
  generic `PegasusApiError(status_code, code, message)`. So callers can't tell
  "no channel" from any other 404 without matching on the message string.
- **The Automation:** `~/repos/pegasus-workflows/platform/send_order_saved_sms/`.
  It's a **GLOBAL** platform workflow.
  - **It's a demo:** on every order save it texts the **full order JSON** to a
    **hard-coded number, `+16308868537`** (`DESTINATION_NUMBER`).
  - Prod rows (from `deployments.toml`): 0.1.2 = `49af37d9-878d-4531-b0e1-5e0cabf55303`
    (current); 0.1.1 = `dc7b7020-f0ab-41e6-959a-43dd3b417f13` (superseded
    2026-07-01).
  - **The failing runs execute 0.1.1 (`dc7b7020`)**: the trigger
    `0f17a3a8-c83d-45c7-afc4-7e12c1f6f626` is bound to that old row. Triggers
    point at a specific row, so **publishing a new version does not change what
    the trigger runs**. The trigger has to be re-pointed (or recreated) on the
    new row.
  - Because a GLOBAL row runs on the tenant-runner lane only for the platform
    tenant (others get `MUST_FORK`), tenant `a90b22bc` is almost certainly the
    **platform tenant**. Confirm before acting.
- **Publishing rules (from memory):** publish the **SDK** from the platform
  session by pushing the tag `sdk-python-v<version>`, which runs
  `release-sdk-python.yml` (OIDC). **Never** publish workflows or integration
  configs from a platform session; that happens in `pegasus-workflows` by its
  own process. The SDK is **0.43.0** on PyPI and on `main` as of 2026-10-05.

## Step 0: ask the user first (it changes what the Automation PR does)

> `send_order_saved_sms` is a demo that would SMS **full order JSON (customer
> PII)** to a **hard-coded personal number** on every prod order save, if
> RingCentral were ever connected for that tenant. It's harmless today only
> because the send fails. Should its prod trigger be **disabled** (which stops
> the failures immediately and needs no Automation change), or kept and made to
> skip cleanly?

Either way, the SDK change (step 1) is worth shipping, because it's the general
mechanism every SMS-sending Automation needs.

## Steps

1. **SDK (this repo, `fix/sms-skip-no-channel`)**:
   - Add `class SmsChannelNotConnected(PegasusApiError)` in
     `pegasus_workflows/api.py`, exported from `pegasus_workflows`.
     `send_sms` raises it when the response is **404 with `code ==
"NOT_FOUND"`** (and, decide and document, possibly the 503
     `SERVICE_UNAVAILABLE` integration-disabled case).
   - It's a subclass, so existing `except PegasusApiError` handlers keep
     working, and the API's wire response is unchanged (no API change needed).
   - Dry-run mode already captures `send_sms` before any HTTP call. Confirm
     dry runs are unaffected.
   - Tests (pytest, SDK): raised on 404/NOT_FOUND; **not** raised on other 404
     codes, 403, or 5xx; still an instance of `PegasusApiError`.
   - **Discoverability (`CLAUDE.md` rule):** document it in the README (SMS
     section: "skip when no SMS channel" with an example), the MCP authoring
     guide / reference, the `send_sms` docstring, and a CHANGELOG entry.
   - Bump the version (0.44.0, minor: an additive public API), land it through
     the queue, then **publish**: push the tag `sdk-python-v0.44.0` on the
     merge commit, watch `release-sdk-python.yml`, and confirm on PyPI.
   - Consider (decide, don't assume) the same treatment for `send_email`
     (`POST /api/v1/email/send`, 0.42.0) if it has an equivalent
     "not configured" response. Grep `handlers/email*.ts`.
2. **Automation (`~/repos/pegasus-workflows`, its own PR; never published from
   the platform session)**:
   - Depending on Step 0: either no code change (the trigger is disabled), or
     `deliver_sms` catches `SmsChannelNotConnected` and returns `{"skipped":
"no_sms_channel"}`, so the run ends COMPLETED. Bump the version to 0.1.3,
     pin `pegasus-workflows-sdk>=0.44.0` in that project, and add a unit test.
   - Hand off publishing and **trigger re-pointing** (from 0.1.1 `dc7b7020` to
     the new row) to that repo's owner and process.
3. **Verify (read-only, prod):** after the change takes effect, new
   `send_order_saved_sms` runs end COMPLETED with `skipped`, or stop entirely if
   the trigger was disabled. Re-run the failure breakdown to confirm the prod
   failure baseline drops to roughly 0.
4. **Follow-ups to raise, not to do here:**
   - Nothing alerts on the Automation failure rate. 100% failure went
     unnoticed for at least 10 days. Propose a CloudWatch alarm on
     `WorkflowExecution` FAILED rate per tenant or overall.
   - Update the memory `project_prod_sms_trigger_without_ringcentral.md` when
     resolved.

## Files

- `packages/workflows-sdk-python/pegasus_workflows/api.py` and `__init__.py`
  (the error class and export), plus tests under
  `packages/workflows-sdk-python/tests/`.
- `packages/workflows-sdk-python/README.md`, `CHANGELOG.md`,
  `pegasus_workflows/cli/mcp_server.py` (the guide text), and `pyproject.toml`
  (the version).
- In the other repo: `platform/send_order_saved_sms/send_order_saved_sms/workflow.py`,
  its tests and `pyproject.toml`.

## Risks

- **Matching on 404 alone would swallow real misroutes.** Match on
  `code == "NOT_FOUND"` from `/api/v1/sms/send` specifically, and keep the
  message assertion in tests so a future API change that alters the code is
  caught.
- **The PII concern above is real** whether or not the skip ships. Don't let
  the skip make it easy to forget.
