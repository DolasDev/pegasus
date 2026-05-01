# Admin-web VPN diagnose button

## Background

`/api/admin/tenants/:tenantId/vpn/diagnose` (commit `3eb1a71`) returns a
structured 10-check report covering the cloud → hub → tenant data path.
It was built after a multi-hour debug session that bisected through
every layer manually (DB, EC2 routing, hub SG, hub kernel, MASQUERADE,
WG handshake, TCP connect, on-prem auth). The endpoint is now the
canonical "where is traffic dying" check.

Right now you have to invoke it via curl with a Cognito JWT. Wiring it
into the admin-web tenant page makes it a single click — the next time
on-prem connectivity breaks, support / ops can localise the failure
without shelling into anything.

## Goal

Add a "Run Diagnose" button to `TenantVpnSection.tsx` on the tenant
detail page. On click: call the endpoint, show a live progress
indicator (~10–30 s expected latency), then render each check with a
pass/fail/skip pill, the detail string, and the elapsed time.
`firstFailure` gets a callout above the list so the eye lands on the
root cause first.

## Plan

- [ ] **1. Add the typed API client.** Extend
      `apps/admin-web/src/api/vpn.ts` with `runVpnDiagnose(tenantId):
    Promise<DiagnoseReport>`. Mirror the response shape from
      `apps/api/src/handlers/admin/vpn-diagnose.ts` (`DiagnoseReport`,
      `DiagnoseCheck`, `CheckStatus` — re-declare here, don't pull
      across the workspace boundary).
- [ ] **2. Add the button to `TenantVpnSection.tsx`.** Place it next
      to the existing "Rotate" / "Suspend" controls. Disabled while a
      diagnose call is in flight; show a spinner with the elapsed
      seconds (UX clarity — the call legitimately takes 10–30 s
      because of the SSM round-trips).
- [ ] **3. Render the report.** A panel below the button: - Top-level summary pill (green `PASS` / red `FAIL`). - If `firstFailure` is non-null, a callout: "First failure:
      `<id>` — <detail>". This is the operationally most important
      line; bias the layout to make it impossible to miss. - One row per check: status pill (pass/fail/skip), label, detail
      text, elapsed ms. Failed rows get a warning border. Skipped
      rows are de-emphasised. - If a check has `evidence`, expose it via a "Show details"
      toggle (it's already a `Record<string, unknown>` — just
      `JSON.stringify(…, null, 2)` in a `<pre>`).
- [ ] **4. Loading + error states.** The endpoint can fail for
      mundane reasons (admin token expired, network blip). On
      `ApiError`, render the error inline in the report panel with a
      retry button. On 401 / 403, redirect to login (matches the
      existing pattern in `client.ts`).
- [ ] **5. E2E test.** Add a Playwright test under
      `apps/e2e/tests/browser/` that loads the tenant page and clicks
      Run Diagnose. Mock the `/diagnose` endpoint at the network layer
      (Playwright's `page.route`) and assert the report renders
      correctly for both pass and fail fixtures.
- [ ] **6. Doc update.** Add a one-line reference in
      `docs/wireguard/install-windows.md` step 11 (already mentions
      the curl path) pointing tenants to ask Pegasus support to run
      the button on their tenant — keeps the troubleshooting
      escalation path obvious.

## UX details

- The endpoint runs sequentially, so we can't usefully stream partial
  results (`/diagnose` returns the whole report at once). For the
  loading state, show a generic "Running 10 checks (~30 s)…" message
  with an indeterminate progress bar. Don't fake per-check progress.
- Don't auto-run on page load. The endpoint hits SSM and EC2 APIs that
  cost money and take seconds; only run on explicit click.
- Display the timestamp the report was generated client-side (the
  endpoint doesn't return one). Lets the admin see staleness when
  re-investigating an issue.

## Out of scope

- Real-time / per-check streaming. Endpoint would need to switch to
  SSE or chunked responses; not worth the complexity for a
  ~30 s call.
- Auto-remediation. Surfacing the failure is the goal; fixing it
  remains a manual operator action (re-deploy, edit SG, etc.).
- Tenant-side button (i.e. exposing this in `tenant-web`). Tenants
  should not be able to enumerate AWS infrastructure state.

## References

- `apps/api/src/handlers/admin/vpn-diagnose.ts` — handler + response
  shape (`DiagnoseReport`, `DiagnoseCheck`, `CheckStatus`).
- `apps/admin-web/src/components/TenantVpnSection.tsx` — host
  component for the button.
- `apps/admin-web/src/api/vpn.ts` — pattern for typed API clients.
- `docs/wireguard/install-windows.md` — already links to the curl
  fallback path; this UI is the easier-on-ramp version.
