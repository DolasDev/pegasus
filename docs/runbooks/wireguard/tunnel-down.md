# Runbook: WireGuard Tunnel Down

Use this runbook when the hub's WireGuard interface is unavailable and every tenant peer has stopped handshaking. Because the multi-tenant VPN terminates all tenants on a single EC2 hub, interface-level failures are platform-wide incidents — treat accordingly.

## Symptoms

- All tenants stop handshaking simultaneously (not isolated to one peer).
- CloudWatch metric `PegasusWireGuard/ActivePeers` drops to `0`.
- Admin UI shows every peer with a stale handshake age (no recent `latestHandshake`).
- CloudWatch alarm `HandshakeAgeMax > 180s for 5m` fires.
- Possibly `AWS/EC2 StatusCheckFailed` alarm fires (indicates an instance-level problem rather than a pure service problem).

## Quick diagnosis

1. Open AWS Systems Manager → Session Manager and start a session on the hub EC2 instance (the instance inside `WireGuardStack`'s Auto Scaling Group). There is no SSH and no bastion — SSM is the only entry point.
2. Check the interface and peer table:
   ```bash
   sudo wg show wg0
   ```
   Confirm `wg0` exists and that peers are listed. Missing interface means the tunnel service is not running.
3. Confirm both systemd units are active:
   ```bash
   sudo systemctl status wg-quick@wg0 pegasus-vpn-agent
   ```
4. Inspect tunnel service logs for kernel or config errors:
   ```bash
   sudo journalctl -u wg-quick@wg0 -n 50 --no-pager
   ```
5. Inspect agent logs for reconcile errors (failed peer sync, SSM key fetch, etc.):
   ```bash
   sudo journalctl -u pegasus-vpn-agent -n 50 --no-pager
   ```
6. Verify that packets are actually reaching the interface:
   ```bash
   cat /sys/class/net/wg0/statistics/rx_packets
   ```
   If the counter is `0` or not advancing, traffic is not arriving at the hub at all — check the security group (UDP/51820 inbound from `0.0.0.0/0`) and that the Elastic IP is still associated with the running instance.

## Remediation

Pick the scenario that matches your diagnosis.

### Scenario 1: Service is down (interface missing, unit inactive/failed)

Restart the tunnel, then the agent:

```bash
sudo systemctl restart wg-quick@wg0
sudo systemctl restart pegasus-vpn-agent
```

Wait ~60 seconds and re-check:

```bash
sudo wg show wg0
```

Peers should reappear and handshake timestamps should advance.

### Scenario 2: Instance is unhealthy (`StatusCheckFailed`)

Trigger an ASG instance refresh so a healthy node replaces the failed one. From the AWS console: EC2 → Auto Scaling Groups → select the WireGuard ASG → Instance refresh → Start. Or from the CLI:

```bash
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name <asg-name>
```

Expected MTTR is ~90 seconds. The replacement instance boots from the existing AMI, cloud-init re-runs, the agent re-syncs peers from the database, and tunnels re-establish.

### Scenario 3: Kernel panic or full instance wedge

If SSM cannot connect and the instance appears wedged, terminate it from the EC2 console. The ASG will launch a replacement using the existing AMI plus cloud-init; no manual rebuild is required.

## Verification after fix

- `sudo wg show wg0` lists peers and handshake timestamps update within ~30 seconds (`PersistentKeepalive=25` forces clients to re-handshake).
- `PegasusWireGuard/ActivePeers` climbs back toward its normal count in CloudWatch.
- The `HandshakeAgeMax > 180s for 5m` alarm returns to `OK`.
- Spot-check one or two tenants in the admin UI — their `latestHandshake` should be recent.

## Escalation

If the hub still fails to come up after a successful ASG replacement (`wg0` exists but has no peers, or the agent logs repeated key-load failures), suspect a corrupted SSM hub private key. Do not try to rebuild the key by hand — follow [rotate-hub-keys.md](./rotate-hub-keys.md).

## Related

- [peer-not-syncing.md](./peer-not-syncing.md) — a single tenant peer is stuck while others are healthy.
- [evacuate-hub.md](./evacuate-hub.md) — planned replacement of the hub instance with minimal disruption.
- [rotate-hub-keys.md](./rotate-hub-keys.md) — rotate the hub's WireGuard keypair when keys are compromised or corrupted.
