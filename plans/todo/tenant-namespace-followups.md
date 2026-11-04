# Tenant namespaces: follow-ups after the legacy runner's retirement

- **Status:** TODO. Small checks and housekeeping; no code change expected.
- **Branch:** none needed unless a check fails.
- **Goal:** close the live checks that #919's acceptance couldn't reach, plus
  housekeeping. Background: `plans/completed/872d63bf-retire-legacy-tenant-runner.md`
  (design, decisions, outcome) and DECISIONS.md "Every tenant-runner Automation
  runs in its tenant's own namespace".
- **Written:** 2026-11-04 against `main` @ `872d63bf`.

## Checklist

- [ ] **NW's next real run (prod)** completes in `pg-prod-9d869236518f.chgel` on a
      scoped runner. No NW run had happened since the 2026-11-04 deploy (checked
      ~19:30 UTC). Query `workflow_executions` for tenant `9d869236-…`,
      `created_at > '2026-11-04 18:45'`, and check `temporal_namespace` plus the
      `runner-scoped/` log stream.
- [ ] **Dolios's first run since its 2026-11-03 cutover (prod)** lands in
      `pg-prod-a90b22bc4393.chgel`. It has 11 executable Automations and 9
      triggers, none enabled, so this waits for someone to run one.
- [ ] **EVENT trigger during PROVISIONING (live).** Unit-tested
      (`lambda-dispatch-workflow-triggers.test.ts`, `temporal-namespace-cutover.test.ts`)
      but not seen live. Needs a tenant with no namespace (each costs one of the
      100 namespaces shared by staging and prod; 7 in use). Do it opportunistically
      with the next real new tenant: an event that arrives while it provisions
      should fire once it is ACTIVE.
- [ ] **Staging AVP Smoke housekeeping.** Revoke the `avp-smoke` CLI key
      (`workflow_developer`, user-created) if it isn't wanted. Optionally retire
      `ns_canary@0.1.0` and deprovision its namespace (allowed from ACTIVE once
      no live Automations or open runs remain) to free one of the 100.

## Files

None expected.

## Risks

None: read-only checks and optional staging cleanup.
