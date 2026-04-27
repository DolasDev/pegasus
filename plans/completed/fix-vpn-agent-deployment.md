# Fix WireGuard reconcile-agent deployment

## Background

On 2026-04-27 a tenant's WireGuard client was unable to complete a
handshake against the prod hub (`54.208.228.139:51820`). Layer-by-layer
debugging (see this conversation) found:

1. **EIP not associated.** The hub's user-data calls `aws ec2
associate-address ... || true` at
   `packages/infra/lib/stacks/wireguard-stack.ts:383`. The `|| true`
   silently swallowed a failure on first boot, so the EIP remained
   unattached. Manually associated to recover.
2. **No peers on the hub.** `sudo wg show` listed zero `[Peer]`
   blocks even though the admin app had a `VpnPeer` row
   (`10.200.0.2`, pubkey `MuY0FPkY…`). The reconcile agent
   (`apps/vpn-agent`) that polls the API and applies `wg set` was
   **never installed** — the SSM param
   `/pegasus/wireguard/agent/tarball-uri` does not exist in prod, so
   the conditional install block at
   `packages/infra/lib/stacks/wireguard-stack.ts:371-379` was
   skipped.
3. **The publish workflow is dev-only and currently failing.**
   `.github/workflows/publish-vpn-agent.yml:36-39` hard-codes
   `environment: dev` and `STACK_NAME: pegasus-dev-wireguard`. It has
   never run against `pegasus-prod-wireguard`, and the last two
   triggered runs (2026-04-21 and 2026-04-22) failed before reaching
   the upload step.
4. **No automated provisioning of `/pegasus/wireguard/agent/apikey`.**
   User-data reads the param at line 359 with no fallback. The bash
   `set -e` gotcha (assignment from a failing command substitution
   does not abort) lets the script continue with `AGENT_APIKEY=""`,
   which would then break the agent silently if it were installed.

The immediate prod outage was unblocked by manually adding the peer
on the hub:

```
sudo wg set wg0 peer MuY0FPkYnD1yfGDSshkQXd9IiFLbgxbFKxEzl46FRTw= \
  allowed-ips 10.200.0.2/32
```

This is **non-persistent** — an ASG instance replacement will lose it.

## Goal

Make the reconcile agent the single source of truth for hub peer state
in every environment, with hard failures (not silent skips) when any
piece is missing, and observability that pages before the next
silent-failure outage.

## Plan

- [ ] **1. Diagnose the two failed `Publish VPN agent` runs.**
      `gh run view 24778469608 --log-failed` and
      `gh run view 24749634348 --log-failed`. Note the failing step
      and root cause in this plan before changing anything — fix
      directly if it's a small thing (lockfile drift, missing var),
      or capture as a separate sub-task otherwise.

- [ ] **2. Make `publish-vpn-agent.yml` multi-env.** Replace the
      hard-coded `STACK_NAME` and `environment: dev` with a matrix
      over `[dev, staging, prod]` driven by GitHub Environments,
      mirroring `_deploy.yml`. Each env reads its own
      `AWS_DEPLOY_ROLE_ARN` and resolves the WireGuardStack outputs
      for `pegasus-${env}-wireguard`. Path-filter trigger stays the
      same; manual `workflow_dispatch` gains an `env` input so prod
      can be re-published without a code change.

- [ ] **3. Provision the M2M agent ApiClient automatically.** Today
      `/pegasus/wireguard/agent/apikey` has no creator. Add a CDK
      custom resource in `WireGuardStack` modelled on
      `HubKeyBootstrapFn` (`wireguard-stack.ts:316`) that:
      a. On first deploy, calls the admin API to create an
      `ApiClient` with scope `vpn:sync` (see
      `apps/api/src/handlers/vpn-agent.ts:28`).
      b. Stores the returned plain key in
      `/pegasus/wireguard/agent/apikey` as a SecureString.
      c. On stack delete, revokes the ApiClient row.
      Alternative if a Lambda calling the API at deploy time is
      awkward: ship a `scripts/bootstrap-vpn-agent-apikey.ts` that an
      operator runs once per env, and document it in
      `plans/completed/wireguard-multi-tenant-vpn.md`.

- [ ] **4. Harden user-data — fail loud, not silent.** In
      `packages/infra/lib/stacks/wireguard-stack.ts`:
      a. Replace the EIP-associate `|| true` at line 383 with a
      retry loop (e.g. up to 30s with 3s backoff) and a final
      `exit 1` on persistent failure. The instance failing health
      checks is better than a silently-orphan EIP.
      b. Drop the `2>/dev/null || echo ''` on the tarball lookup at
      line 371 once we expect the agent in every env. Missing
      tarball = launch fails.
      c. Treat missing `agent/apikey` (line 359) the same way —
      explicit `aws ssm get-parameter` failure aborts user-data.
      d. Confirm the new failure modes surface as ASG launch failures
      and feed the existing `HubStatusCheckFailedAlarm` (or add a
      tighter alarm on `HubAsg` failed-instance count > 0).

- [ ] **5. Add observability for silent agent gaps.** New CloudWatch
      alarms in `WireGuardStack`, all wired to the existing
      `pegasus-wireguard-alerts` SNS topic:
      a. **EIP unassociated.** Custom metric from a 5-minute Lambda
      (or `aws-sdk` poll inside the agent itself) emitting
      `HubEipAssociated` 0/1.
      b. **Agent service not running.** The agent already imports
      `@aws-sdk/client-cloudwatch`; emit a `AgentHeartbeat` metric
      every tick and alarm on `Missing data` for > 5 min.
      c. **Peer count drift.** Agent emits `HubPeerCount` and
      `DesiredPeerCount`; alarm when they differ for > 10 min.

- [ ] **6. Roll out to prod and verify.**
      a. After tasks 2–5 land, manually run the new multi-env
      workflow against `prod` (`workflow_dispatch` with
      `env: prod`).
      b. Watch the ASG instance refresh in EC2 console — the new
      instance should pull the tarball, install the agent, and
      within 30s of boot have the prod peer in `wg show` (the one
      currently kept alive by the manual `wg set`).
      c. Once verified, remove the manual peer — it'll be
      re-created by the agent from the DB:
      `aws ssm send-command --document-name AWS-RunShellScript
        --parameters 'commands=["sudo wg show"]'` to confirm
      it's already there from the agent before removing.

- [ ] **7. Backfill staging.** Same workflow run with `env: staging`.
      Verify identical behaviour. Capture the runbook in this plan's
      "completed" version so the next env (or DR account) is one
      command away.

- [ ] **8. Document the manual override.** In
      `dolas/agents/project/GOTCHAS.md`, record the
      `wg set wg0 peer … allowed-ips …` recipe as the on-call
      break-glass for when the agent is wedged. Keep it short — this
      should be the _exception_, not the steady-state.

## Out of scope

- Migrating the hub off ASG-of-1 to a true HA pair. Worthwhile but a
  separate plan; the failure modes here are silent-skip and silent-
  failure, not single-instance outage.
- Rotating the agent ApiClient key on a schedule. Add as a follow-up
  once task 3 is in place.

## Done when

- `wg show` on the prod hub matches the `VpnPeer` table within 30s of
  any change in the admin app, with zero manual `wg set` calls.
- An on-call alert fires in <10 minutes if the agent stops, the EIP
  detaches, or peer counts drift — instead of the next tenant
  noticing.
- `publish-vpn-agent.yml` can publish to any of dev/staging/prod from
  a single workflow file.
