# Runbook: Tenant Tunnel Not Handshaking After Install

## Symptoms

- Admin UI shows the tenant's peer as `ACTIVE` (we added it to the hub) but `lastHandshakeAt` is `null` more than a few minutes after the tenant says they installed.
- Alarm `ActivePeerNoHandshake >= 1 for 24h` will fire eventually.
- Other tenants are fine, so this is a tenant-side issue.

## Platform-side checks first

Rule out our problems before blaming the tenant.

1. SSH to the hub and confirm the peer is actually configured in the kernel:

   ```
   sudo wg show wg0
   ```

   The output should list a peer entry with the tenant's correct public key and allowed IP.

2. Confirm the hub security group allows inbound UDP 51820 from `0.0.0.0/0`. This is the default in `WireGuardStack` — if it's been changed, that's the bug.

3. Confirm the hub EIP hasn't changed. It's pinned via CDK and should be stable.

4. Confirm Route 53 still resolves:

   ```
   dig +short vpn.pegasus.internal
   ```

   The answer must match the hub EIP.

If all four checks pass, the hub is healthy and the problem is on the tenant side.

## Tenant-side diagnostic walkthrough

Paste the section below into a support ticket. The tenant runs these on their Windows Server.

1. **Confirm WireGuard is running.** Open the WireGuard app. Tunnel status should say "Active". If not, click **Activate** and watch for errors in the log pane at the bottom.

2. **Check outbound UDP 51820.** From an elevated PowerShell:

   ```powershell
   Test-NetConnection -ComputerName vpn.pegasus.internal -Port 51820
   ```

   Note: `Test-NetConnection` only tests TCP by default and will usually report failure even when UDP is fine. To verify UDP actually works, activate the tunnel first and then ping the hub's overlay IP:

   ```powershell
   ping 10.10.200.1
   ```

   If this fails while the tunnel is "Active", UDP 51820 egress is being blocked somewhere upstream.

3. **Check corporate / perimeter firewall.** WireGuard is UDP 51820 outbound from the tenant server to `vpn.pegasus.internal`. Ask the tenant's network admin to confirm this isn't being filtered. Many corporate firewalls drop all UDP except DNS by default.

4. **Check time sync.** WireGuard rejects handshakes with clock skew greater than roughly 2 minutes. On the tenant's server:

   ```powershell
   w32tm /query /status
   ```

   If the offset is large, fix NTP:

   ```powershell
   w32tm /resync
   ```

5. **Check for key-paste errors.** Re-open `client.conf` in a text editor. Confirm:
   - The `PrivateKey = ...` line under `[Interface]` has exactly 44 characters and ends in `=`.
   - The `PublicKey = ...` line under `[Peer]` matches exactly what Pegasus support sent. This is the hub public key and is the same across all tenants, so support can re-send it for comparison.
   - No extra whitespace, no accidental line breaks, no smart quotes from a word processor.

6. **Check the Address is bound.** Run `ipconfig` and look for the WireGuard adapter. It must show the tenant's overlay IP (for example `10.200.7.1`). If the adapter isn't present, the tunnel isn't actually up regardless of what the UI says — go back to step 1.

## Advanced: packet capture on tenant

If the steps above don't reveal the problem:

1. Install Wireshark on the tenant's server.
2. Start a capture on the physical network interface (not the WireGuard adapter).
3. Apply filter: `udp.port == 51820`.
4. Activate the tunnel.
5. Expect to see outbound WireGuard handshake initiation packets (Wireshark's WireGuard dissector labels them as such).

Interpretation:

- **No packets leave the machine.** A local firewall or antivirus is blocking. Temporarily disable Windows Defender Firewall for the ACTIVE network profile and retry. If it works with the firewall off, add an outbound allow rule for UDP 51820 and re-enable the firewall.
- **Packets leave but no response comes back.** Upstream UDP 51820 is blocked — corporate firewall, ISP, or cloud security group on the tenant side. Escalate to the tenant's network admin.

## After the fix

- Handshake completes within about 1 second of activation. `PersistentKeepalive = 25` keeps it alive across NAT.
- The Admin UI `lastHandshakeAt` field populates on the next agent tick (<= 30 seconds).
- The `ActivePeerNoHandshake` alarm clears on the next evaluation window.

## Related

- [install-windows.md](./install-windows.md) — tenant install walkthrough.
- [peer-not-syncing.md](./peer-not-syncing.md) — peer state drift between DB and hub kernel.
