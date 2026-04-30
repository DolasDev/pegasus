# Installing the Pegasus WireGuard Tunnel on Windows Server

This guide walks through installing the WireGuard client on your existing Windows Server and importing the `client.conf` provided by Pegasus support. Once active, the tunnel establishes an encrypted link from your server to the Pegasus AWS environment so that Pegasus can reach your on-server web API privately over the tunnel. No inbound ports are opened on your public internet connection.

## Prerequisites

- Windows Server 2019 or later with local administrator rights
- Outbound UDP port 51820 allowed on your corporate or perimeter firewall
- The `client.conf` file provided to you by Pegasus support

## Install Steps

1. Download WireGuard for Windows from <https://www.wireguard.com/install/>.
2. Run the installer and accept the default options. Installation requires administrator privileges.
3. Save the `client.conf` file from Pegasus admin to a known location on the server, for example:

   ```
   C:\ProgramData\Pegasus\client.conf
   ```

4. Launch the WireGuard application, then click **Add Tunnel** and choose **Import tunnel(s) from file**. Select the `client.conf` file you saved.
5. With the imported tunnel selected, click **Activate**.
6. Verify the tunnel is up:
   - Status should change to **Active** within five seconds.
   - The **Latest handshake** field should show a recent timestamp (seconds, not minutes).
7. Confirm that outbound UDP 51820 is allowed in Windows Firewall. The WireGuard installer normally configures this automatically, but check the outbound rules if the handshake never completes.
8. The Pegasus on-prem API service installs via `npm run service:install` (run from `apps/api/` in the Pegasus checkout) and listens on `0.0.0.0:3000` — every interface, including the WireGuard tunnel. No per-IP binding is required.
9. Re-classify the WireGuard tunnel as a **Private** network in Windows. Newly-created interfaces default to **Public**, which puts Windows Firewall into a stealth mode that drops inbound TCP even when an explicit `Allow` rule is configured. Run in admin PowerShell:

   ```powershell
   Set-NetConnectionProfile -InterfaceAlias peg-cloud -NetworkCategory Private
   ```

   Replace `peg-cloud` with the name of your imported tunnel if different. Confirm with `Get-NetConnectionProfile -InterfaceAlias peg-cloud` — `NetworkCategory` should report `Private`.

10. In Windows Firewall, open inbound TCP **3000** (the on-prem API port — see `ONPREM_TUNNEL_PORT` default in `apps/api/src/handlers/onprem.ts`) on the WireGuard interface from the hub overlay range only. Do not open this port on your public-facing interfaces. Run in admin PowerShell:

    ```powershell
    New-NetFirewallRule -DisplayName "Pegasus on-prem API (wg0)" `
      -Direction Inbound -Protocol TCP -LocalPort 3000 `
      -RemoteAddress 10.10.200.0/24 -Action Allow
    ```

11. Troubleshooting: if **Latest handshake** stays at **Never**, the most common cause is outbound UDP 51820 being blocked by your corporate or perimeter firewall. Verify with your network team that egress on UDP 51820 to the Pegasus hub endpoint is permitted. If the handshake is fresh but the cloud `/longhaul/version` ping still fails, run the platform diagnose endpoint (`GET /api/admin/tenants/:tenantId/vpn/diagnose`) — it identifies which layer of the cloud → hub → tenant path is blocking traffic.

## Security Note

The `client.conf` file contains a private key and must be treated as a secret. Do not commit it to shared drives, send it through unencrypted email, include it in screenshots, or paste it into chat tools. If you believe the key has been exposed, contact Pegasus support and request a key rotation — the old configuration will be revoked and a replacement issued.

---

Pegasus support: dolasllc@gmail.com
