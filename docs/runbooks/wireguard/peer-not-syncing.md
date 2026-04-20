# Runbook: Peer Not Syncing to Hub

## Symptoms

- A tenant's peer record in the admin UI shows status `PENDING` more than 2 minutes after the operator clicked "Enable VPN".
- The `HubReconcileLag > 120s for 5m` CloudWatch alarm may be firing.
- Other tenants are unaffected — their existing tunnels still handshake normally. (If _all_ tenants are broken, use `tunnel-down.md` instead.)
- DB peer count does not match kernel peer count (`SELECT count(*) FROM "VpnPeer" WHERE status='ACTIVE'` vs. `sudo wg show wg0 peers | wc -l`).

## Quick diagnosis

1. SSM Session Manager into the hub EC2:
   ```bash
   aws ssm start-session --target i-<hub-instance-id>
   ```
2. Check the agent is running:
   ```bash
   sudo systemctl status pegasus-vpn-agent
   ```
3. Tail agent logs — look for `ERROR`, HTTP errors when polling `/admin/vpn/peers`, or `wg set` failures:
   ```bash
   sudo journalctl -u pegasus-vpn-agent -n 100 --no-pager
   ```
4. Confirm the agent can reach the admin API (adjust host for your environment):
   ```bash
   curl -sS -H "X-Api-Key: $(sudo cat /run/pegasus-vpn-agent/apikey)" \
     https://api.pegasus.com/admin/vpn/peers | head -c 200
   ```
5. Check the generation counter. The agent uses `If-None-Match` against the API's generation; compare the DB value to what the agent last logged:
   ```sql
   SELECT generation FROM "VpnState" WHERE id = 1;
   ```
   Then in the agent logs look for the most recent `generation=` line. They should match (or the agent should be within one tick).
6. Confirm kernel state and diff it against the DB peer list:
   ```bash
   sudo wg show wg0 dump | awk '{print $1}'
   ```

## Remediation

- **Agent is dead.** Restart it and wait a full tick:
  ```bash
  sudo systemctl restart pegasus-vpn-agent
  sleep 60
  sudo systemctl status pegasus-vpn-agent
  ```
- **Agent can't reach admin API.** Check the hub security group allows outbound TCP 443 to `0.0.0.0/0`. Re-read the M2M API key from SSM:
  ```bash
  aws ssm get-parameter \
    --name /pegasus/wireguard/agent/apikey \
    --with-decryption
  ```
  If the key is stale, rotate it following the M2M rotation steps in `plans/in-progress/wireguard-multi-tenant-vpn.md` §7 (the tenant-key flow in `rotate-tenant-key.md` is the closest analog, but the agent key is an `ApiClient` row, not a tenant peer).
- **Force reconcile.** Signal the agent to tick immediately, or just restart it:
  ```bash
  sudo systemctl kill -s SIGUSR1 pegasus-vpn-agent   # if SIGUSR1 force-tick is implemented
  # otherwise:
  sudo systemctl restart pegasus-vpn-agent
  ```
- **Manual sync for one peer (emergency only).** The agent will re-assert on the next tick, so this is only to shortcut waiting:
  ```bash
  # add
  sudo wg set wg0 peer <pubkey> allowed-ips 10.200.<N>.1/32
  # drop
  sudo wg set wg0 peer <pubkey> remove
  ```

## Verification after fix

- Agent log shows `reconcile complete` with the expected generation matching `VpnState.generation`.
- `sudo wg show wg0` includes the peer's public key.
- Admin UI status for the tenant flips from `PENDING` to `ACTIVE` on the next tick (~30s).
- `HubReconcileLag` alarm returns to OK within 5 minutes.

## If still stuck

- **Neon is down.** The admin API itself will be returning 5xx, so the hub agent cannot fetch updates. The hub keeps existing tunnels working — new peers are blocked until Neon recovers. Check the Neon status page before digging further.
- **Suspect the peer's DB row is corrupt.** Inspect it:
  ```sql
  SELECT * FROM "VpnPeer" WHERE "tenantId" = '<id>';
  ```
  If the row looks odd (bad public key, impossible octet, mismatched status), delete it and re-provision from the admin UI. Re-provisioning generates a new keypair and client config.

## Related

- [`tunnel-down.md`](./tunnel-down.md) — whole-hub outage, not a single-peer sync issue.
- [`tenant-not-handshaking.md`](./tenant-not-handshaking.md) — peer is `ACTIVE` on the hub but never completes a handshake (tenant-side).
