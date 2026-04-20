# Runbook: Evacuate / Replace the WireGuard Hub

## When to run this

- Upgrading the instance type (e.g. `t4g.nano` → `t4g.micro` → `c7g.medium`) per
  the thresholds in the source plan §10 (Scaling Plan).
- Moving to a different AZ (e.g. the current AZ is under maintenance or had an
  issue).
- Routine AMI refresh.
- Hub kernel panic that ASG auto-recovery did not fully resolve.

## Impact

- ~90 second outage of all tenant tunnels while the new instance bootstraps
  (cloud-init pulls SSM params, starts `wg-quick@wg0`, starts
  `pegasus-vpn-agent`).
- `PersistentKeepalive=25` means tenants will re-handshake automatically within
  ~30s after the new hub is up.
- No data loss — the hub is stateless. All state lives in SSM Parameter Store
  (keys) and Postgres (peer roster).

## Pre-flight checklist

- [ ] Maintenance window scheduled. Inform tenants that a ~90s dropout is
      expected, even for a short window.
- [ ] Confirm the `PegasusWireGuard/HandshakeAgeMaxSeconds` metric is healthy
      before starting (baseline — so you know the alarm clearing post-refresh
      means the new hub is actually good).
- [ ] Confirm SSM parameters exist and are readable by your operator role:
      - `/pegasus/wireguard/hub/privkey`
      - `/pegasus/wireguard/hub/pubkey`
      - `/pegasus/wireguard/agent/apikey`
- [ ] Confirm the new instance type is available in the target AZ (Graviton
      instance types are not uniformly available in every AZ).

## Procedure — change instance type

1. Update `packages/infra/lib/stacks/wireguard-stack.ts` — change the instance
   type on the ASG's launch template.
2. Commit, push, deploy via CI (`.github/workflows/deploy.yml`), or run
   `cdk deploy WireGuardStack` locally.
3. CDK will update the launch template version. Trigger an instance refresh:

   ```bash
   aws autoscaling start-instance-refresh \
     --auto-scaling-group-name <asg-name> \
     --preferences MinHealthyPercentage=0
   ```

   `MinHealthyPercentage=0` is required because we only have one instance; the
   default of 90% would prevent the refresh from proceeding.

4. Watch the refresh progress:

   ```bash
   aws autoscaling describe-instance-refreshes \
     --auto-scaling-group-name <asg-name>
   ```

5. The new instance bootstraps via cloud-init (pulls SSM params, starts
   `wg-quick@wg0`, starts `pegasus-vpn-agent`).
6. SSM into the new instance and verify the interface:

   ```bash
   aws ssm start-session --target <new-instance-id>
   sudo wg show wg0
   ```

## Procedure — change AZ

1. Update `packages/infra/lib/stacks/wireguard-stack.ts` — adjust the subnet
   selection for the ASG to use the target AZ.
2. The hub EIP is bound to the primary ENI. If the instance relocates to a
   different AZ, the EIP must be re-associated. Cloud-init handles this via
   the instance role's `ec2:AssociateAddress` permission.
3. Deploy and trigger an instance refresh as in the instance-type procedure
   above (`MinHealthyPercentage=0`).

## Procedure — emergency evacuate (instance wedged)

1. Terminate the hub EC2 from the console or CLI:

   ```bash
   aws ec2 terminate-instances --instance-ids <id>
   ```

2. The ASG launches a replacement from the existing launch template (same
   type, same AZ, fresh cloud-init) within ~90s.
3. No CDK deploy needed — this is just an instance recycle.

## Verification

- `sudo wg show wg0` on the new instance shows all expected peers.
- `PegasusWireGuard/ActivePeers` returns to its pre-evacuation count within
  5 minutes.
- `PegasusWireGuard/HandshakeAgeMaxSeconds` returns to < 60s.
- CloudWatch alarms (Hub reconcile lag, Handshake stale, Hub instance
  unhealthy) all clear.

## Rollback

- Revert the CDK change (`git revert <sha>`), deploy, and run another
  instance refresh.
- If you rolled back the instance type, remember to pass
  `MinHealthyPercentage=0` on the second refresh too — the ASG size is still 1.

## Related

- [`tunnel-down.md`](./tunnel-down.md) — the hub is up but tunnels are not
  handshaking.
- [`rotate-hub-keys.md`](./rotate-hub-keys.md) — 3-yearly hub keypair rotation
  (requires tenant config redistribution).
