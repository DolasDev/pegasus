# SDK spec — README runtime env var names are wrong; ship a `from_runtime()` factory

- **Origin:** pegasus-workflows repo (`~/repos/pegasus-workflows`), `sdk-feedback/0005-runtime-env-var-names-wrong.md`
- **Status:** Proposed
- **Filed:** 2026-06-26
- **SDK version when filed:** 0.2.0
- **SDK version that addresses it:** <!-- fill in when shipped -->
- **Area:** docs (README) / authoring API (`PegasusClient`)

## Problem

The SDK README's "Sending an SMS" example tells activity authors to build the
client like this:

```python
client = PegasusClient(
    base_url=os.environ["PEGASUS_BASE_URL"],
    token=os.environ["PEGASUS_WORKFLOW_TOKEN"],
)
```

**Those env var names do not exist at runtime.** The tenant runner
(`pegasus_tenant_runner`) injects the API connection under _different_ names. Per
`apps/tenant-runner/pegasus_tenant_runner/subprocess_driver.py`:

```python
# The tenant's contract for calling the Pegasus API from workflow code:
# PegasusClient(base_url=os.environ["PEGASUS_API_BASE_URL"],
#               token=os.environ["PEGASUS_RUNTIME_TOKEN"]).
os.environ["PEGASUS_API_BASE_URL"] = api_base_url
os.environ["PEGASUS_RUNTIME_TOKEN"] = runtime_token
```

So the correct names are **`PEGASUS_API_BASE_URL`** and **`PEGASUS_RUNTIME_TOKEN`**.
(`PEGASUS_WORKFLOW_TOKEN` is the _publish_ CLI's token var — unrelated to runtime,
which compounds the confusion.)

This shipped a real failure: `send_order_saved_sms@0.1.0` published to prod and
died on its first execution with:

```
File ".../send_order_saved_sms/workflow.py", line 78, in deliver_sms
    base_url=os.environ["PEGASUS_BASE_URL"],
KeyError: 'PEGASUS_BASE_URL'
```

Fixed in the workflow by switching to the correct names (now `@0.1.1`).

## Why it matters

Every notification/API-calling workflow follows this example. As written it
fails 100% of the time at runtime — but only _after_ publishing, since nothing
local exercises the runner's env. The doc is the single source authors copy, so
the wrong names propagate to every workflow until each one fails in prod.

## Proposed change

1. **Fix the README** (authoritative fix): use `PEGASUS_API_BASE_URL` and
   `PEGASUS_RUNTIME_TOKEN` in the activity example, and note that
   `PEGASUS_WORKFLOW_TOKEN` is the _publish-time_ CLI var, not a runtime var.

2. **Ship a factory so authors never hardcode env names** (durable fix):

   ```python
   @activity.defn
   async def deliver_sms(to, body):
       client = PegasusClient.from_runtime()   # reads the runner-injected vars
       return client.send_sms(to=to, body=body)
   ```

   `PegasusClient.from_runtime()` reads `PEGASUS_API_BASE_URL` /
   `PEGASUS_RUNTIME_TOKEN` and raises a clear error naming them if absent (e.g.
   when run outside the runner). This removes the coupling between author code
   and an undocumented runtime contract — if the runner ever renames the vars,
   one SDK change fixes every workflow.

## Acceptance criteria

- [ ] The SDK README's SMS/activity example uses `PEGASUS_API_BASE_URL` and
      `PEGASUS_RUNTIME_TOKEN`, and disambiguates `PEGASUS_WORKFLOW_TOKEN` as the
      publish-time CLI token.
- [ ] `PegasusClient.from_runtime()` exists, returns a client configured from
      `PEGASUS_API_BASE_URL` / `PEGASUS_RUNTIME_TOKEN`, and raises a clear,
      named error when either is missing.
- [ ] The README recommends `from_runtime()` over hardcoding `os.environ[...]`.
- [ ] (Nice-to-have) A note/lint: constructing `PegasusClient` from
      `PEGASUS_BASE_URL`/`PEGASUS_WORKFLOW_TOKEN` is flagged as a likely mistake.

## Validation log

<!-- Filled in when the SDK ships this and validation runs in the
     pegasus-workflows repo. Plan: rewrite deliver_sms to use
     PegasusClient.from_runtime(), re-publish, trigger against a connected
     tenant, confirm a real text arrives (no KeyError). -->
