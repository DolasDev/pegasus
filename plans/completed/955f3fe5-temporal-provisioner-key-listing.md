# The provisioner can't list a tenant's API keys: stop depending on it

- **Branch:** `fix/temporal-provisioner-key-listing`.
- **Found by:** Step 9 staging acceptance, run 1 (2026-10-13), in
  `plans/completed/f0d47ffb-tenant-temporal-namespaces.md`. Test tenant
  `4b2e0267-c597-451e-a367-771dfac52fba` (AVP Smoke 2026-05-08).
- **Status:** approved by the user 2026-10-13 ("Fix workstream", with a
  live delete-by-id check, which passed).

## Facts (verified live 2026-10-13, as the staging provisioner)

- `GET /cloud/api-keys?owner_id=<tenant SA>[&owner_type=…]` returns **403**
  "only global admins or namespace admins may list API keys for other users",
  still minutes after the namespace was created. It's not propagation. The
  unfiltered listing shows only the provisioner's own key.
- For a key on the tenant SA, the provisioner **can** create it (`POST
/cloud/api-keys`), read it **by id** (`GET /cloud/api-keys/{id}`, with owner
  and resource version), and delete it **by id** (it reads 404 afterwards).
- Deleting the namespace **cascades**: after the Stage B guardrail probe
  deleted its throwaway namespaces (it deleted no key individually, because
  its listing was silently 403), both the scoped SA and its key read 404.
- `GET /cloud/service-accounts/{id}` carries no key ids.
- The guardrail probe missed this because its cleanup ignored the listing's
  status, and its "gone" checks counted 403 the same as 404.

## Impact

Provision fails at the key step (the orphan sweep calls `listApiKeys`), so
no tenant can be provisioned. Deprovision and #838's rotate sweep call it
too, so neither works either. Own-key rotation and the gauges don't use it.
Prod has no tenant rows, so nothing there is affected yet.

## Fix: remove the dependency (no try/catch)

A catch around a 403 that every production call hits would leave the tests
exercising a path production never takes.

1. **Provision, step 3:** `apiKeyId === null` → mint. A key whose response
   was lost (token-once) is an orphan nobody holds a token for; it is deleted
   with the namespace (cascade). Drop the orphan sweep.
2. **Rotate, step 1:** delete the recorded `pendingApiKeyId` by id; drop the
   "delete every key that is neither current nor previous" sweep. A key lost
   between mint and `storePendingKey` is an orphan, as above.
3. **Deprovision:** delete the row's known keys (current, previous, pending)
   by id, then the namespace, which takes the SA and any orphans with it.
4. **Cloud Ops client:** remove `listApiKeys` (and drop it from
   `CloudOpsPort`). `listOwnApiKeys` stays.
5. **Tests:** `FakeCloud.listApiKeys` goes away with the port. Model the
   cascade: `deleteNamespace` removes the namespace's SA **and its keys**.
   Rewrite the token-once tests: a lost key is no longer deleted on resume
   (it stays as an orphan until deprovision) but the run converges, and
   deprovision leaves no keys.
6. **`scripts/temporal/guardrail-probe.py`:** check the listing's status
   (record the 403 as a finding), delete keys by the ids it created, and
   count only 404 as "gone" (403 = unknown).
7. **Docs:** GOTCHAS (the 403, by-id works, the cascade, the probe's silent
   pass); the parent plan's Step 9 (run 1 result: finding 4 FAILS, finding 3
   not reached: the SA was created 73 s after the namespace, then the key
   step failed); DECISIONS if the orphan design changes the 3b.1 entry.

## After merge and deploy

Resume Step 9: **Retry** the FAILED test tenant in admin-web (it resumes
from `service_account_created`, which tests the resume path), then continue
Step 9 as written (rotate, forced own-key rotation, daily-maintenance and the
gauges, then deprovision).

## Progress (2026-10-13)

- [x] Steps 1–5: `listApiKeys` removed from the client and `CloudOpsPort`.
      Provision mints without a sweep; rotate deletes the recorded pending key by
      id; deprovision deletes the row's known key ids, then the namespace.
      `FakeCloud.deleteNamespace` cascades to the account's keys. The token-once
      tests now assert "re-minted, orphan left to the namespace delete", and a
      new test asserts no `list*` call in rotate or deprovision. apps/api: 4,104
      tests pass.
- [x] Step 6: `guardrail-probe.py` reports the listing's status, deletes its
      key by id, and counts only 404 as gone.
- [x] Step 7: GOTCHAS (Temporal Cloud Ops section), the parent plan (finding
      4 and Step 9 run 1), and a reversal note on #838's plan. DECISIONS is
      unchanged: no entry described the orphan sweep.
- [ ] After deploy: resume Step 9 with **Retry** on the FAILED test tenant
      (tracked by the parent plan's Step 9).
