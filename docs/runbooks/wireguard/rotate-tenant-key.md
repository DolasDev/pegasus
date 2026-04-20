# Runbook: Rotate a Tenant's WireGuard Keypair

## When to run this

- The tenant's `client.conf` was accidentally shared, committed to source control, or emailed to the wrong party.
- The tenant has a compliance requirement for periodic rotation.
- The tenant reports suspicious activity and wants a fresh key.
- **Not** on a scheduled cadence. Per the design (Q12), tenant key rotation is on-demand only; only hub keys rotate on a fixed 3-year cadence.

## Impact

- The affected tenant's tunnel drops briefly during cutover (a few seconds to a couple of minutes, depending on how quickly the tenant imports the new config).
- **Other tenants are unaffected.** Unlike a hub key rotation, no coordinated window is needed.
- The old `client.conf` is immediately invalidated once the new public key is applied by the reconcile agent (within the next reconcile tick, which is less than 30 seconds).

## Procedure

1. In the admin portal, navigate to the tenant's detail page and open the **VPN** section.
2. Click **Rotate key**. (Equivalent API call:)

   ```http
   POST /admin/tenants/:tenantId/vpn/rotate
   Authorization: Bearer <operator JWT>
   ```

3. A new `client.conf` is returned in the response body **once**. Download it immediately. The plain private key is **not** stored server-side and cannot be re-fetched.

   ```jsonc
   {
     "data": { "id": "vpn_...", "publicKey": "K8...", "status": "PENDING", ... },
     "clientConfig": "[Interface]\nPrivateKey = ...\n..."
   }
   ```

4. Deliver the new `client.conf` to the tenant via the agreed secure channel: reply to their support ticket, encrypted email, a shared password-vault entry, etc. Never post it in a plain chat channel.
5. The tenant follows `install-windows.md` steps 3-5 to re-import the new config. They can either overwrite the existing tunnel or add a new one and remove the old.
6. Wait up to 30 seconds for the hub reconcile agent to pick up the new public key and apply it via `wg set`. No action required on your side.
7. The tenant activates the tunnel. Handshake should complete within seconds.

## Verification

- The admin UI shows `lastHandshakeAt` with a timestamp within the last minute.
- The CloudWatch metric `PegasusWireGuard/HandshakeAgeMaxSeconds` for this peer returns to below 30 seconds.
- The old public key is no longer present in `wg show wg0` on the hub (the reconcile agent removed it during reconciliation).

  ```bash
  # Via SSM Session Manager on the hub
  sudo wg show wg0 | grep -A2 "peer: <new-public-key>"
  sudo wg show wg0 | grep "<old-public-key>"   # expect no output
  ```

## If the new config is lost before the tenant installs it

- The plain private key is **not** recoverable server-side by design. There is no "re-download" button.
- Simply run rotate again to generate a fresh `client.conf`.
- The original (pre-rotation) key was already invalidated by the first rotation; the second (lost) key is invalidated by this rotation; the third key is active.
- There is no penalty for rotating repeatedly.

## If the tenant cannot install immediately

- The tenant's tunnel stays down until they install the new config. That's acceptable because there's no outage for any other tenant, and the data plane only carries tenant-specific API calls.
- If this rotation is urgent (for example, a confirmed compromise and you want the old key removed from the hub right now rather than whenever the tenant gets to it), you may additionally suspend the peer to explicitly remove the old entry from the hub within the next reconcile tick:

  ```http
  POST /admin/tenants/:tenantId/vpn/suspend
  Authorization: Bearer <operator JWT>
  ```

  Note that `/rotate` already queues the old key for removal; `/suspend` is only worth running if you want belt-and-suspenders confirmation that the old peer is gone within the 30-second reconcile window rather than waiting for the tenant to install the new config. Resume (`POST /admin/tenants/:tenantId/vpn/resume`) once the tenant is ready to install.

## Related

- [`install-windows.md`](./install-windows.md) - Tenant-side installation steps.
- [`rotate-hub-keys.md`](./rotate-hub-keys.md) - The 3-yearly hub key rotation, which does require coordinated redistribution to every tenant.
- [`tenant-not-handshaking.md`](./tenant-not-handshaking.md) - Troubleshooting if the handshake doesn't complete after the tenant installs the new config.
