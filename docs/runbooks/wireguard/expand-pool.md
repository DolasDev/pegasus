# Runbook: Expand the WireGuard Octet Pool

## When to run this

- Admin API returns HTTP 507 with `code: "VPN_POOL_EXHAUSTED"` when an operator
  tries to enable VPN for a new tenant.
- CloudWatch alarm `ActivePeers > 60000` fires. This is a very-early warning:
  the pool is `10.200.0.0/16`, minus reserved octet pairs, so the usable
  ceiling is roughly 65,000 peers (see "Current pool layout" below for the
  exact math).
- Hypothetically reached once Pegasus has more than ~60,000 active tenants.
  Not a near-term concern — the business will likely never see this.

Because this runbook is borderline speculative, the approaches below are
deliberately high-level. Treat them as a sketch, not a step-by-step.

## Current pool layout

Reference: `plans/in-progress/wireguard-multi-tenant-vpn.md` §2.

- Overlay CIDR: `10.200.0.0/16`
- Per-tenant assignment: `10.200.<assignedOctet1>.<assignedOctet2>/32`
- Allocation walks `(0, 2)` through `(255, 254)`, skipping:
  - `(0, 1)` — reserved for the hub overlay convention
  - `(*, 0)` — network address convention
  - `(*, 255)` — broadcast address convention
- Schema:
  - `VpnPeer.assignedOctet1 INTEGER NOT NULL`
  - `VpnPeer.assignedOctet2 INTEGER NOT NULL`
  - Composite unique on `(assignedOctet1, assignedOctet2)`

Effective ceiling: `256 * 254 - 1 = 65,023` tenants (approx).

## Expansion approach A — Lift the `/25` / `/26` restriction if it's in place

The quickest, cheapest move. Verify in code that the allocator is actually
skipping `(*, 0)` and `(*, 255)`. If it is, and operational testing confirms
those addresses work on the wire (they do inside a pure WireGuard overlay —
there is no Ethernet broadcast semantics on `wg0`), remove the skips.

- Payoff: recovers roughly 500 addresses.
- Risk: low. WireGuard does not interpret `.0` or `.255` specially.
- Effort: a single allocator PR plus a migration to retroactively allow
  previously-skipped pairs.

This is marginal. Use it only if you are very close to the limit and need
breathing room while planning approach B.

## Expansion approach B — Add a second `/16` overlay

The most realistic solution when we genuinely outgrow a single `/16`. Add
`10.201.0.0/16` as a second pool alongside the existing one.

High-level migration:

1. Add a column `VpnPeer.assignedOctet0 INTEGER NOT NULL DEFAULT 200` (the
   middle-high octet: `200` for existing rows, `201` for new-pool rows).
   Backfill existing rows with `200`.
2. Update the allocator to try `(200, *, *)` first, then fall through to
   `(201, *, *)`. Keep the composite-unique constraint extended to all three
   octets.
3. Update the reconcile agent's `AllowedIPs` computation to build the full
   three-octet address from the row (`10.<octet0>.<octet1>.<octet2>/32`).
4. Update `WireGuardStack` (CDK): add a second VPC route
   `10.201.0.0/16 → ENI of WG hub` alongside the existing
   `10.200.0.0/16 → ENI` route.
5. Update tenant `client.conf` rendering: new tenants provisioned in the
   second pool get `Address = 10.201.<N>.1/32` instead of
   `10.200.<N>.1/32`. Existing tenants are untouched.
6. Update dashboards and alarms so `ActivePeers` and related metrics cover
   both pools. The 60k early-warning threshold should become "total across
   pools" or a pair of alarms.

Scope: moderately invasive. Plan for a sprint. Nothing here is
architecturally novel — it's the same allocator, widened by one octet.

## Expansion approach C — Shard by hub

Per `plans/in-progress/wireguard-multi-tenant-vpn.md` §10, at very large
scale we move to two hubs sharded by `hash(tenantId)`. Each hub runs its
own `10.200.0.0/16` pool inside its own VPC.

- This is required anyway for performance reasons once we pass roughly
  500 concurrent active peers per hub. Pool expansion via sharding
  aligns naturally with that scaling work.
- Much larger undertaking than approach B: new VPC, new route table,
  hub-selection logic in the admin API, reconcile agent per hub,
  per-hub generation counters, cross-hub DNS.
- Treat it as a separate multi-week project, not a pool-expansion task.

## Decision matrix

| Active peers | Recommended approach                               |
| ------------ | -------------------------------------------------- |
| < 60k        | Not yet needed. Monitor only.                      |
| 60k–120k     | Approach B (add a second `/16`)                    |
| 120k+        | Approach C (shard by hub) — and reconsider architecture |

If approach A buys enough room to unblock a specific onboarding without
entering the next band, use it as a stopgap, but still schedule B.

## Related

- [tunnel-down.md](./tunnel-down.md) — hub-down recovery
- Source plan: `plans/in-progress/wireguard-multi-tenant-vpn.md`
  - §2 Network Design / CIDRs
  - §10 Scaling Plan
