# Runbook: Rotate Hub WireGuard Keypair (3-yearly)

## When to run this

- **Scheduled cadence:** every 3 years, per the key rotation policy in
  `plans/in-progress/wireguard-multi-tenant-vpn.md` §7 / Q12.
- **Emergency rotation:** immediately if the hub private key
  (`/pegasus/wireguard/hub/privkey` SSM SecureString) is suspected leaked,
  an operator workstation that generated it was compromised, or CloudTrail
  shows unauthorized `ssm:GetParameter` access to the hub key path.

## Impact warning

Rotating the hub keypair is a coordinated, tenant-visible event. Every tenant's
`client.conf` embeds the hub public key in its `[Peer] PublicKey = ...` line,
so flipping the hub key invalidates every existing tenant config at once.

- ALL tenants' `client.conf` files must be updated with the new hub public key.
- Each tenant will need to re-import their new `client.conf` in WireGuard for
  Windows (the old tunnel must be deleted or replaced).
- Plan for a maintenance window. Tunnels drop when the hub flips keys; each
  tenant only reconnects once the new `client.conf` is applied tenant-side.
- Minimum **1-week lead time** recommended for notifying tenants. Support
  channels (email, phone) should be staffed during the window.

This is why the cadence is 3 years, not routine. Do not treat this as a
one-click operation.

## Pre-flight checklist

- [ ] Maintenance window scheduled (date, start time, expected duration).
- [ ] All tenants notified with window start and end, and a contact for issues.
- [ ] Platform admin distribution list aware (SNS topic
      `pegasus-wireguard-alerts` subscribers).
- [ ] Admin UI "Rotate Hub" flow tested in a staging stack (if one exists) or
      verified by reading the handler code in
      `apps/api/src/handlers/admin/vpn.ts`.
- [ ] Current hub private key's SSM parameter version recorded (for rollback):
      `aws ssm get-parameter-history --name /pegasus/wireguard/hub/privkey`.
- [ ] Secure workstation available for key generation (offline preferred,
      full-disk encryption, no shell history persistence).

## Procedure

1. Generate a new keypair locally on a secure workstation:

   ```
   wg genkey | tee hub.priv | wg pubkey > hub.pub
   ```

2. Write the new private key to SSM (SecureString, overwrite existing value):

   ```
   aws ssm put-parameter \
     --name /pegasus/wireguard/hub/privkey \
     --type SecureString \
     --value "$(cat hub.priv)" \
     --overwrite
   ```

3. Write the new public key to SSM (plain String, overwrite existing value):

   ```
   aws ssm put-parameter \
     --name /pegasus/wireguard/hub/pubkey \
     --type String \
     --value "$(cat hub.pub)" \
     --overwrite
   ```

4. Securely delete the local copies of the keypair:

   ```
   shred -u hub.priv hub.pub
   ```

   On Windows, use `sdelete -p 3 hub.priv hub.pub` or an equivalent secure
   erase tool.

5. Trigger an ASG instance refresh so the hub picks up the new keys from SSM
   at cloud-init:

   ```
   aws autoscaling start-instance-refresh \
     --auto-scaling-group-name <asg-name>
   ```

6. Wait ~90s for the new instance to bootstrap. Connect via SSM Session
   Manager and verify the interface is up:

   ```
   wg show wg0
   ```

   You should see the `[Interface]` block with the new public key and no peers
   yet (peers get re-added by the reconcile agent on its next tick).

7. From the admin UI, click **Rotate Hub** (or POST to the equivalent API
   route once implemented). This re-renders every tenant's `client.conf` with
   the new hub public key. The bundle is delivered either as a single ZIP
   download or as individually rendered per-tenant `client.conf` files.

8. Distribute the new `client.conf` files to each tenant through the existing
   out-of-band channel (email via the Pegasus support contact). Include a
   reference to `install-windows.md` in the tenant-facing message.

9. Each tenant re-imports their new `client.conf` in WireGuard for Windows
   (follow `install-windows.md` steps 3–5). They should delete or replace the
   previous tunnel rather than running both side-by-side.

10. Monitor `PegasusWireGuard/ActivePeers` in CloudWatch. The count should
    return to pre-rotation levels within the maintenance window. Peers that
    have not reconnected by the end of the window need direct tenant-side
    follow-up.

## Verification

- `wg show wg0` on the hub lists all expected peers with recent handshakes.
- `PegasusWireGuard/HandshakeAgeMaxSeconds` returns to < 30s.
- Admin UI shows all peers in `ACTIVE` state with live handshake age.
- No alarms firing on `pegasus-wireguard-alerts`.
- Spot check: from a Lambda with `sg-lambda-vpn`, hit a tenant's
  `https://<tenantId>.vpn.pegasus.internal/health` and confirm 200 OK.

## Rollback (emergency)

SSM retains parameter versions, so the previous hub keypair can be restored
if the rotation goes wrong mid-flight.

1. Find the prior version values:

   ```
   aws ssm get-parameter-history --name /pegasus/wireguard/hub/privkey
   aws ssm get-parameter-history --name /pegasus/wireguard/hub/pubkey
   ```

2. Restore the previous values (replace `$OLD_PRIV` / `$OLD_PUB` with the
   captured prior values):

   ```
   aws ssm put-parameter \
     --name /pegasus/wireguard/hub/privkey \
     --type SecureString \
     --value "$OLD_PRIV" \
     --overwrite

   aws ssm put-parameter \
     --name /pegasus/wireguard/hub/pubkey \
     --type String \
     --value "$OLD_PUB" \
     --overwrite
   ```

3. Trigger another instance refresh:

   ```
   aws autoscaling start-instance-refresh \
     --auto-scaling-group-name <asg-name>
   ```

4. Tenants whose `client.conf` you had already rotated will need the **old**
   `client.conf` re-delivered. This is why a staged rollout (a small pilot
   group first, then the rest of the fleet) is safer than a big-bang flip.

## Related

- [`rotate-tenant-key.md`](./rotate-tenant-key.md) — per-tenant key rotation
  flow (on-demand, no coordination required).
- [`tunnel-down.md`](./tunnel-down.md) — symptoms and recovery when the hub
  tunnel is unhealthy.
