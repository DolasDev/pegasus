# WireGuard Multi-Tenant Private Connectivity (AWS ↔ Tenant Servers)

**Status:** Draft for review
**Author:** senior cloud/platform (adapted to Pegasus conventions)
**Date:** 2026-04-20
**Stack name:** `WireGuardStack`

---

## 0. Confirmed Decisions

These shape every section. Pulled from review Q&A:

| #   | Decision                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No per-tenant crypto identity required**, but topology still demands peer-per-tenant since each tenant has their own server.  |
| 2   | **One server per tenant** (Azure VM or on-prem Windows Server). Hub is many-to-one peering target.                              |
| 3   | **Neon stays on the public internet.** No Pegasus-internal traffic goes through the tunnel.                                     |
| 4   | Tenant-side server is **pre-existing** — could be Azure VM or on-prem Windows. We provide config + install doc; tenant runs it. |
| 5   | AWS region: **default** (us-east-1) unless tenant geography forces otherwise.                                                   |
| 6   | **Data plane = HTTPS** to the tenant's on-server web API (longhaul/pegii/efwk). No direct MSSQL access.                         |
| 8   | Pegasus team owns the Azure VMs operationally where applicable.                                                                 |
| 10  | **Outage acceptable** — single hub, ASG=1, ~90s MTTR via instance replacement.                                                  |
| 11  | **Slow revocation OK** — next reconcile cycle (≤30s) is fine.                                                                   |
| 12  | Key rotation cadence: **3 years** for hub keys; tenant key rotation on demand only.                                             |
| 13  | No audit-log integration required.                                                                                              |
| 14  | Alerts → **new SNS topic → email subscription for platform admins**.                                                            |
| 15  | Metrics destination: **CloudWatch only**.                                                                                       |
| 16  | **Skip NAT gateway** — hub uses a public ENI for its agent's egress to the admin API.                                           |
| 18  | No sensitive data in scope.                                                                                                     |
| 20  | **Admin UI required day 1** in `apps/admin-web`.                                                                                |
| 21  | Stack name: `WireGuardStack`.                                                                                                   |
| 22  | Migration name follows existing `YYYYMMDDHHMMSS_<name>` pattern.                                                                |

**Tenant install doc target: Windows Server only.** Tenant config delivered as `client.conf` + a one-page Windows install doc.

**Explicit non-goals:**

- No HA hub
- No dynamic routing
- No Kubernetes / mesh / managed VPN gateway
- No per-tenant EC2 in AWS (tenants run their own server-side)
- No installer script — written instructions only

---

## 1. High-Level Architecture

### ASCII Diagram

```
                       AWS (us-east-1)                                                Tenant N (Azure or on-prem Windows)
┌─────────────────────────────────────────────────────────────────┐                  ┌──────────────────────────────────┐
│                                                                 │                  │                                  │
│  Lambda (handlers that call tenant APIs)                        │                  │  Windows Server                  │
│  ├─ subset of apps/api handlers (longhaul/pegii/efwk callers)   │                  │  ├─ WireGuard for Windows        │
│  │  in VPC, in `private-lambda` subnet                          │                  │  │   wg0  10.200.<N>.1/32        │
│  ▼                                                              │                  │  │   peer = AWS hub             │
│  Route table:                                                   │                  │  │                              │
│    10.200.0.0/16 → ENI of WG hub                                │                  │  ├─ IIS / legacy web API         │
│  ▼                                                              │                  │  │   bound to 10.200.<N>.1:443  │
│  WG hub EC2 (t4g.nano, ASG=1)                                   │                  │  │                              │
│  ├─ wg0 10.10.200.1/24 (hub)                                    │                  │  └─ Windows Firewall:            │
│  ├─ N peers, one per tenant                                     │◄────UDP 51820────┤      outbound UDP 51820 only     │
│  ├─ AllowedIPs per peer = 10.200.<N>.1/32  (crypto isolation)   │   (tenant-init,  │      (no inbound rule needed)    │
│  ├─ reconcile agent                                             │   PersistentKA)  │                                  │
│  └─ Public ENI w/ EIP — used for both:                          │                  └──────────────────────────────────┘
│       (a) WG ingress UDP 51820                                  │
│       (b) agent's HTTPS to admin API                            │                  ┌──────────────────────────────────┐
│                                                                 │   ◄────UDP───────┤  Tenant 2 (different IP)         │
│  Route 53 private hosted zone vpn.pegasus.internal              │                  │  10.200.2.1                      │
│   <tenantId>.vpn.pegasus.internal → 10.200.<N>.1                │                  └──────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘                  ┌──────────────────────────────────┐
                                                                       ◄──UDP────────┤  Tenant N (...)                  │
                                                                                      └──────────────────────────────────┘
              ▲
              │ admin UI + agent pull-sync (HTTPS over public internet, M2M key)
              │
       ┌──────┴───────────┐
       │ Admin API        │
       │ apps/api/...     │
       │ /admin/vpn/*     │
       └──────────────────┘
```

### Components & Responsibilities

| Component            | Responsibility                                                                            | File                                           |
| -------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `WireGuardStack`     | VPC, subnets, route tables, SGs, EIP, hub ASG(1), IAM role, Route 53 PHZ, SNS alert topic | `packages/infra/lib/stacks/wireguard-stack.ts` |
| Hub EC2              | Runs `wg-quick@wg0`, reconcile agent; terminates all tenant peers                         | EC2 cloud-init in user-data                    |
| Reconcile agent      | Polls `/admin/vpn/peers` every 30s, applies `wg set` for desired state                    | Node script baked into AMI                     |
| Admin handler        | CRUD for VPN peers, renders `client.conf`                                                 | `apps/api/src/handlers/admin/vpn.ts`           |
| Admin UI             | Enable/revoke per tenant, download `client.conf`, status panel                            | `apps/admin-web/src/routes/vpn/*`              |
| `VpnPeer` model      | Per-tenant peer state in Postgres                                                         | `apps/api/prisma/schema.prisma`                |
| Route 53 PHZ         | Resolves `<tenantId>.vpn.pegasus.internal` → tenant's overlay IP                          | created by `WireGuardStack`                    |
| Tenant server        | Runs WireGuard for Windows; web API binds to its overlay IP                               | tenant-managed; we provide doc                 |
| Existing Cognito     | Authenticates admin portal — reused                                                       | n/a                                            |
| Existing `ApiClient` | Hub agent auth (M2M key, scope `vpn:sync`)                                                | reused                                         |

### Network Boundaries

- **Public internet:** admin UI → admin API (existing Cognito-fronted path); tenant servers → hub EIP UDP 51820; hub agent → admin API HTTPS
- **AWS VPC:** Lambda ENI → hub ENI on TCP 443 (SG-to-SG); hub kernel forwards into WireGuard
- **WireGuard overlay:** hub at `10.10.200.1`; each tenant at `10.200.<N>.1`
- **Tenant LAN:** WireGuard interface only; we never reach beyond the configured `AllowedIPs`

### Trust Boundaries

| Boundary                      | Mechanism                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Admin operator → Admin API    | Cognito JWT + `platform_admin` role                                                                                               |
| Hub agent → Admin API         | M2M `ApiClient` key, scope `vpn:sync`                                                                                             |
| Lambda → Hub                  | SG-to-SG (network-only; no auth — same VPC)                                                                                       |
| Lambda → Tenant API           | TLS (HTTPS) end-to-end inside the tunnel; tenant API does its own authz with the existing per-tenant credential model             |
| Hub ↔ Tenant peer             | WireGuard cryptokey (Curve25519); `AllowedIPs` enforces source-IP integrity                                                       |
| Tenant A peer ↔ Tenant B peer | Each peer's `AllowedIPs = 10.200.<N>.1/32`. WireGuard drops any packet not from the peer's declared source. No nftables required. |

---

## 2. Network Design

### CIDRs

```
VPC (Pegasus VPN plane):     10.10.0.0/16

Subnets:
  private-lambda-a           10.10.1.0/24    AZ a
  private-lambda-b           10.10.2.0/24    AZ b   (future expansion)
  hub-public-a               10.10.10.0/24   AZ a   (public — hub lives here, no NAT GW)
  hub-public-b               10.10.11.0/24   AZ b   (future failover)

WireGuard overlay (single /16 carved into /32s):
  10.10.200.1                hub
  10.200.<N>.1               tenant N's server   (N = 2..65534)
```

> N starts at 2; 1 is reserved (overlay convention) and 0/255 are network/broadcast in the /24 sense — unused here but reserved by convention to keep mental model simple.

### Why these CIDRs

- `10.10.0.0/16` and `10.200.0.0/16` are deliberately non-default. Most tenants' on-prem LANs use `10.0.0.0/24`, `192.168.0.0/24`, or `172.16.0.0/12`. Pinning ours to `10.200/16` minimizes overlap.
- `10.200.<N>.1/32` per tenant: trivial allocation, ~65k addressable tenants, no subnet math, no router config drift.

### Routing Rules

**Lambda subnet route table:**

```
10.10.0.0/16    → local
10.200.0.0/16   → ENI of WG hub
0.0.0.0/0       → IGW   (Lambda needs public for Secrets Manager, Cognito, Neon)
```

> If you'd rather Lambda have no public egress, add VPC interface endpoints for Secrets Manager + STS + KMS, and route Neon over a NAT GW. Default plan keeps Lambda public-egress to minimize cost.

**Hub kernel:**

```
10.200.0.0/16    dev wg0
default          via <hub-public-subnet-gateway>
```

**Tenant server (Windows, set by `client.conf`):**

```
10.10.200.1/32   via wg0   (hub overlay IP — we don't actually need to reach it)
```

The tenant's `AllowedIPs` deliberately does NOT include `10.200.0.0/16`. The tenant only sees traffic destined for itself.

### Tenant Isolation (How `AllowedIPs` Enforces It)

WireGuard's `AllowedIPs` is bidirectional:

- **Inbound:** packets arriving on a peer's tunnel are dropped unless the source IP is in that peer's `AllowedIPs`.
- **Outbound:** packets routed to a destination are sent to whichever peer claims that destination via its `AllowedIPs`.

So on the hub:

- Tenant 7's peer entry: `AllowedIPs = 10.200.7.1/32`
- A packet arriving via tenant 7's tunnel with source `10.200.8.1` → **dropped**
- A packet from a Lambda destined `10.200.7.1` → routed to tenant 7's tunnel only

This is cryptographic isolation by design. **No nftables, no SNAT, no per-tenant ACLs needed.**

### Conflict Prevention

`VpnPeer.assignedOctet1 INTEGER`, `VpnPeer.assignedOctet2 INTEGER`, both NOT NULL with composite uniqueness `(assignedOctet1, assignedOctet2)`. Allocation in a transaction picks the next free pair starting at `(0, 2)` and walking through `(255, 254)`. Skips `(0, 1)` (hub overlay).

---

## 3. WireGuard Configuration Model

### Hub `/etc/wireguard/wg0.conf` (dynamic — peers managed at runtime, never written here)

```ini
[Interface]
Address    = 10.10.200.1/24
ListenPort = 51820
PrivateKey = <HUB_PRIVATE_KEY>     # written from SSM SecureString at boot, chmod 600
MTU        = 1380
```

That's the entire static config. Tenant peers are added/removed via `wg set wg0 peer ... allowed-ips ...` by the reconcile agent. **Critical:** keeping peers out of the static file means a bad peer entry can't break the tunnel on boot.

### Tenant `client.conf` (rendered by admin handler, downloaded once)

```ini
[Interface]
PrivateKey = <TENANT_PRIVATE_KEY>     # generated server-side, returned once
Address    = 10.200.7.1/32
DNS        = 10.10.200.1              # optional — only if tenant wants to resolve hub-side names
MTU        = 1380

[Peer]
PublicKey           = <HUB_PUBLIC_KEY>
Endpoint            = vpn.pegasus.internal:51820   # CNAME → hub EIP
AllowedIPs          = 10.10.200.1/32                # only the hub overlay IP
PersistentKeepalive = 25
```

> The tenant **never** initiates connections to other tenant ranges. AllowedIPs reflects that.

### Naming Conventions

- Tenant peer description (visible in `wg show`): `tnt:<tenantId>` (we set this via `wg set wg0 peer ...` though WireGuard itself ignores comments — used in agent logs)
- SSM parameters: `/pegasus/wireguard/hub/privkey`, `/pegasus/wireguard/hub/pubkey`, `/pegasus/wireguard/agent/apikey`
- CloudWatch namespace: `PegasusWireGuard`
- SNS topic: `pegasus-wireguard-alerts`
- Route 53 PHZ: `vpn.pegasus.internal`
- Tenant DNS record: `<tenantId>.vpn.pegasus.internal A 10.200.<N>.1`

### Key Management

| Key                    | Generated by                                  | Stored                                                          | Rotation                 |
| ---------------------- | --------------------------------------------- | --------------------------------------------------------------- | ------------------------ |
| Hub private key        | `wg genkey` once at bootstrap                 | SSM SecureString `/pegasus/wireguard/hub/privkey`               | 3 years (manual runbook) |
| Hub public key         | derived from above                            | SSM Parameter (plain) — used by tenant configs                  | with private key         |
| Per-tenant private key | `wg genkey` in admin handler at peer creation | **Returned once in `client.conf`, never persisted server-side** | On demand only           |
| Per-tenant public key  | derived                                       | `VpnPeer.publicKey` in Postgres                                 | with private key         |
| Hub agent M2M key      | existing `POST /admin/api-clients` flow       | SSM SecureString `/pegasus/wireguard/agent/apikey`              | 3 years                  |

### Zero-Downtime Peer Changes

- `wg set wg0 peer <pub> allowed-ips <ip>` is atomic at the kernel level — no interface bounce.
- Removing: `wg set wg0 peer <pub> remove`.
- The reconcile agent computes desired state from the API and applies the diff. Both add and remove are idempotent.
- Static `wg0.conf` only contains `[Interface]`. No tenant data, no risk of boot-time breakage.

---

## 4. Tenant Provisioning Workflow

### Lifecycle

```
[Admin UI]  ──"Enable VPN"──▶  POST /admin/tenants/{id}/vpn
                                       │
                                       ▼
                       Allocate octet (txn, FOR UPDATE)
                       Generate keypair (wg genkey | wg pubkey)
                       INSERT VpnPeer { tenantId, octet, publicKey, status=PENDING }
                       INCREMENT VpnState.generation
                       Render client.conf (in memory)
                                       │
                                       ▼
                Response: { peer DTO, clientConfig: "<.conf blob>" }
                Plaintext private key returned ONCE — admin downloads, never re-fetched
                                       │
                                       ▼
[Admin UI]  shows status PENDING and a "Download client.conf" button
                       (also offers a "Mark as installed" button — purely informational)
                                       │
                                       ▼
[Hub agent ≤30s later]  GET /admin/vpn/peers  →  sees PENDING tenant
                        wg set wg0 peer <pub> allowed-ips 10.200.7.1/32
                        PATCH /admin/vpn/peers/<id>  status=ACTIVE
                                       │
                                       ▼
[Tenant ops]  installs client.conf on Windows Server, starts service
              first handshake within seconds; agent records lastHandshakeAt on next tick
                                       │
                                       ▼
[Admin UI]  status ACTIVE + handshake age live
```

### Sequence Diagram

```
Operator     Admin UI       Admin API        Postgres        Hub Agent       Hub Kernel       Tenant
   │            │               │                │                │                │              │
   │─Enable────▶│               │                │                │                │              │
   │            │─POST vpn─────▶│                │                │                │              │
   │            │               │─BEGIN─────────▶│                │                │              │
   │            │               │─SELECT FOR U──▶│                │                │              │
   │            │               │◄──octet=7─────│                │                │              │
   │            │               │ (gen keypair)  │                │                │              │
   │            │               │─INSERT────────▶│                │                │              │
   │            │               │─bump gen──────▶│                │                │              │
   │            │               │─COMMIT────────▶│                │                │              │
   │            │◄─201 + .conf──│                │                │                │              │
   │◄──Download─│               │                │                │                │              │
   │            │               │                │◄──GET peers (If-None-Match: 41) │              │
   │            │               │─304/200──────────────────────────│                │              │
   │            │               │                │                │─wg set─────────▶│              │
   │            │               │                │◄──PATCH ACTIVE─│                │              │
   │            │               │─UPDATE────────▶│                │                │              │
   │ (operator delivers .conf to tenant ops out of band)                                         │
   │                                                                                  ───install──▶│
   │                                                                       (tenant brings up wg0) │
   │                                                                                              │
   │                                                                                              │
[next 30s tick]                  │                │                │─wg show────────▶│              │
                                 │                │                │◄──handshake age─│              │
                                 │                │                │─PATCH lastHs───────────────────│
```

### Failure Handling

| Failure                                        | Recovery                                                                                                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Octet pool exhausted                           | Handler 507 `VPN_POOL_EXHAUSTED`. CloudWatch alarm → SNS. Pool widening runbook.                                                                                     |
| Operator never downloads `.conf`               | The plain private key is in the response body only; if lost, operator must rotate (DELETE+POST). Documented as "download immediately" in admin UI.                   |
| Agent offline >30s                             | Next tick reconciles. All operations idempotent.                                                                                                                     |
| `wg set` fails on hub                          | Agent logs ERROR, status stays PENDING, alarm fires. Next tick retries.                                                                                              |
| Tenant never installs                          | Status stays ACTIVE in DB but `lastHandshakeAt` stays null. Alarm "active peer with no handshake >24h" pages the platform admin email.                               |
| Tenant installs but handshake fails (firewall) | `lastHandshakeAt` null, agent logs no handshake. Operator checks tenant-side firewall per runbook.                                                                   |
| Operator deletes mid-PENDING                   | Agent diff sees peer removed → noop.                                                                                                                                 |
| Concurrent enable for same tenant              | DB unique on `tenantId` → second call returns existing row (200, idempotent). Plain key NOT re-rendered (already gone). Admin UI shows "rotate to get a new config." |

---

## 5. Admin Portal Integration

### Routes (`apps/api/src/handlers/admin/vpn.ts`)

| Method   | Path                                   | Auth             | Purpose                                    |
| -------- | -------------------------------------- | ---------------- | ------------------------------------------ |
| `POST`   | `/admin/tenants/:tenantId/vpn`         | `platform_admin` | Provision peer; returns `client.conf` body |
| `GET`    | `/admin/tenants/:tenantId/vpn`         | `platform_admin` | Current peer record (no key)               |
| `GET`    | `/admin/tenants/:tenantId/vpn/status`  | `platform_admin` | Live status: handshake age, bytes          |
| `POST`   | `/admin/tenants/:tenantId/vpn/rotate`  | `platform_admin` | Regenerate keys; returns new `client.conf` |
| `POST`   | `/admin/tenants/:tenantId/vpn/suspend` | `platform_admin` | Set status=SUSPENDED; agent removes peer   |
| `POST`   | `/admin/tenants/:tenantId/vpn/resume`  | `platform_admin` | Re-add peer                                |
| `DELETE` | `/admin/tenants/:tenantId/vpn`         | `platform_admin` | Hard delete; deallocate octet              |
| `GET`    | `/admin/vpn/peers`                     | M2M `vpn:sync`   | Hub agent reconcile feed                   |
| `PATCH`  | `/admin/vpn/peers/:id`                 | M2M `vpn:sync`   | Hub agent ack                              |
| `GET`    | `/admin/vpn/hub`                       | `platform_admin` | Hub health summary                         |

### Payloads

**`POST /admin/tenants/:tenantId/vpn` — 201**

```jsonc
{
  "data": {
    "id": "vpn_01HQ...",
    "tenantId": "tnt_01HQ...",
    "assignedIp": "10.200.7.1",
    "publicKey": "K8...",
    "status": "PENDING",
    "createdAt": "2026-04-20T12:00:00.000Z",
  },
  "clientConfig": "[Interface]\nPrivateKey = ...\nAddress = 10.200.7.1/32\nMTU = 1380\n\n[Peer]\nPublicKey = ...\nEndpoint = vpn.pegasus.internal:51820\nAllowedIPs = 10.10.200.1/32\nPersistentKeepalive = 25\n",
}
```

The plain private key appears **only in `clientConfig`**, only in this response, never logged, never re-fetchable. Idempotent re-POST returns the peer record without `clientConfig` and an explicit `keyAvailable: false` field — operator must rotate to get a new config.

**`GET /admin/vpn/peers` — agent feed**

```jsonc
{
  "data": [
    {
      "id": "vpn_01HQ...",
      "tenantId": "tnt_01HQ...",
      "assignedIp": "10.200.7.1",
      "publicKey": "K8...",
      "status": "ACTIVE",
    },
    {
      "id": "vpn_01HR...",
      "tenantId": "tnt_02...",
      "assignedIp": "10.200.8.1",
      "publicKey": "M2...",
      "status": "PENDING",
    },
  ],
  "meta": { "generation": 42, "count": 2 },
}
```

`If-None-Match: "42"` returns 304 when generation unchanged.

**`PATCH /admin/vpn/peers/:id` — agent ack**

```jsonc
{
  "status": "ACTIVE",
  "lastHandshakeAt": "2026-04-20T12:00:30.000Z",
  "rxBytes": 12345,
  "txBytes": 67890,
}
```

### Error Codes

| HTTP | Code                 | When                                                     |
| ---- | -------------------- | -------------------------------------------------------- |
| 400  | `VPN_INVALID_STATE`  | Suspend already-deleted, resume already-active           |
| 404  | `VPN_NOT_FOUND`      | No peer for tenant                                       |
| 200  | (idempotent)         | Re-POST returns existing peer record (no `clientConfig`) |
| 507  | `VPN_POOL_EXHAUSTED` | All octets used                                          |

### Idempotency

- POST is idempotent on `(tenantId)` — second call returns existing record with no key, never errors.
- DELETE is idempotent — 204 whether row existed or not.
- PATCH from agent is idempotent (no state machine on handshake fields).
- Rotate is **not** idempotent — each call generates fresh keys.

---

## 6. Infrastructure Specification

### EC2 Hub

| Field               | Value                                                                                                                                                 | Why                                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Instance type       | `t4g.nano` (ARM Graviton, 512 MB, 2 vCPU burst)                                                                                                       | WireGuard kernel module is near-zero CPU. ~1 Gbps sustained per benchmark. We need <50 Mbps. |
| AMI                 | Amazon Linux 2023 arm64                                                                                                                               | Kernel 6.x ships native WireGuard. AWS-maintained. Smaller footprint than Ubuntu.            |
| Disk                | 8 GB gp3                                                                                                                                              | Stateless. Logs ship to CloudWatch; config in SSM.                                           |
| Network             | 1 public ENI in `hub-public-a` with EIP                                                                                                               | Predictable public IP for tenants' `Endpoint`; NAT GW skipped per Q16.                       |
| ASG                 | `min=1, max=1, desired=1`, 2 subnets across AZs                                                                                                       | Self-healing replacement ~90s. Cheaper than ALB+2.                                           |
| IAM role            | `ssm:GetParameter` (specific paths), `cloudwatch:PutMetricData`, `logs:*` (scoped to its log group), `route53:ChangeResourceRecordSets` (for the PHZ) | Least privilege. No `ec2:*`.                                                                 |
| SSM Session Manager | Enabled                                                                                                                                               | No SSH, no keypair, no bastion.                                                              |
| User data           | cloud-init: install `wireguard-tools`, fetch SSM params, template `wg0.conf`, install agent, enable services                                          | Reproducible — destroying and recreating yields identical hub.                               |

### Why t4g.nano is enough

- Kernel WireGuard is ~200 cycles per packet. At nano's 2.5 GHz burst that's ceiling ~12 Mpps.
- 100 tenants × 5 rps × 2 KB = ~8 Mbps. Six orders of magnitude below ceiling.
- Upgrade path: `t4g.micro` → `c7g.medium` is a one-line CDK change with instance refresh. No architecture change.

### Subnet Layout

Two subnets needed in v1: `private-lambda-a` and `hub-public-a`. Add `-b` AZ pair when multi-AZ becomes worth it (currently never).

### Tenant Server Requirements

| Item      | Requirement                                                                             |
| --------- | --------------------------------------------------------------------------------------- |
| OS        | Windows Server 2019 or later                                                            |
| WireGuard | Official client from wireguard.com                                                      |
| Network   | Outbound UDP 51820 to `vpn.pegasus.internal` (resolves to hub EIP)                      |
| Web API   | Listens on `10.200.<N>.1:443` (TLS termination tenant-side)                             |
| Firewall  | Inbound TCP 443 from `10.10.200.0/24` (the hub's overlay IP); no other inbound on `wg0` |

---

## 7. Security Model

### Authentication

- Operator → Admin UI: existing Cognito with `platform_admin` role
- Hub agent → Admin API: M2M `ApiClient` with new scope `vpn:sync`
- Tenant peer ↔ Hub: WireGuard Curve25519
- Lambda → Hub → Tenant API: TLS (HTTPS) end-to-end inside the tunnel; tenant API does its own auth (existing per-tenant credentials)

### Authorization

- Admin endpoints: `requireRole('platform_admin')`
- Agent endpoints: `requireScope('vpn:sync')` (add to `apps/api/src/lib/scopes.ts`)
- Database: `vpnPeer` table same DB user as today

### Encryption

- AWS↔tenant in transit: WireGuard ChaCha20-Poly1305
- Lambda↔hub in transit: cleartext at L3 (same VPC, SG-bounded), TLS at L7
- At rest on hub: SSM SecureString → tmpfs at boot, never written to EBS
- At rest in Postgres: only **public** keys

### Security Groups

```
sg-lambda-vpn (attached to MSSQL/longhaul-calling Lambdas):
  egress  tcp/443    → sg-hub                 (HTTPS over the tunnel)
  egress  tcp/443    → 0.0.0.0/0              (Cognito, Neon, AWS APIs)
  egress  udp/53     → vpc-resolver           (Route 53)
  egress  tcp/5432   → 0.0.0.0/0              (Neon)

sg-hub (attached to hub ENI):
  ingress udp/51820  from 0.0.0.0/0           (tenants, source IPs vary)
  ingress tcp/443    from sg-lambda-vpn       (Lambda → tenant APIs)
  egress  tcp/443    → 0.0.0.0/0              (agent → admin API + SSM)
  egress  udp/51820  → 0.0.0.0/0              (return WG traffic)
```

### Tenant Isolation

- Each peer's `AllowedIPs = 10.200.<N>.1/32` on the hub.
- WireGuard drops any packet from a peer whose source IP isn't in that peer's AllowedIPs.
- Tenant A cannot send packets claiming to be tenant B.
- Tenant A cannot receive packets destined for tenant B (its own AllowedIPs is just `10.10.200.1/32`).
- **No nftables rules required.** Crypto + AllowedIPs are the isolation primitive.

### Key Rotation (3-year cadence per Q12)

| What          | Procedure                                                                                                                                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub keys      | Generate new keypair → write SSM → ASG instance refresh; **all tenant configs need updating** with the new hub public key (this is why a 3-year cadence is acceptable). Admin UI gains a "rotate hub" flow that re-renders every tenant's `client.conf` and emails platform admins to coordinate distribution. |
| Tenant keys   | On-demand `POST /vpn/rotate` only. Returns new `client.conf` for that tenant.                                                                                                                                                                                                                                  |
| M2M agent key | `POST /admin/api-clients/:id/rotate` → write SSM → systemd reload agent.                                                                                                                                                                                                                                       |

### Compromise Isolation

1. Operator clicks **Suspend** in admin UI
2. Handler: `UPDATE VpnPeer SET status='SUSPENDED'` + bump `generation`, in one transaction
3. Hub agent's next poll (≤30s) sees the change
4. Agent: `wg set wg0 peer <pub> remove` → ACK
5. Tenant's tunnel goes dead; their handshake attempts are ignored

If you ever need <30s revocation, add an SNS topic that the agent subscribes to via a long-lived `aws sqs receive-message --wait-time-seconds 20` loop. Out of scope today (Q11 = no).

---

## 8. Deployment Plan

### From empty AWS account → first working tenant

**Phase 1 — CDK infra (~10 min, automated)**

1. Add `WireGuardStack` to `packages/infra/bin/app.ts`
2. `cdk deploy WireGuardStack`
3. Outputs: hub EIP, VPC id, subnet ids, SG ids, PHZ id

**Phase 2 — Bootstrap secrets (~5 min, manual one-time)**

1. Generate hub keypair locally:
   ```
   wg genkey | tee priv | wg pubkey > pub
   ```
2. `aws ssm put-parameter --name /pegasus/wireguard/hub/privkey --type SecureString --value "$(cat priv)"`
3. `aws ssm put-parameter --name /pegasus/wireguard/hub/pubkey --type String --value "$(cat pub)"`
4. Agent M2M key — automatic. WireGuardStack ships a CDK custom resource
   (`AgentKeyBootstrap`) that on first deploy generates a `vnd_<48 hex>`
   token, writes the plaintext to `/pegasus/wireguard/agent/apikey`
   (SecureString) and the SHA-256 hash to
   `/pegasus/wireguard/agent/apikey-hash` (plain String). On re-deploy it
   reuses any existing plaintext and recomputes the hash. ApiStack reads
   the hash via `ssm.StringParameter.valueForStringParameter` and injects
   it as `VPN_AGENT_APIKEY_HASH` on the API Lambda; the platform-key path
   in `apiClientAuthMiddleware` verifies the agent's Bearer token against
   that hash without a DB lookup.

   Rotation: change the plaintext in SSM, redeploy ApiStack to pick up
   the new hash, restart the agent.

**Phase 3 — Hub launches (~2 min, automatic)**

- ASG instance comes up; cloud-init pulls SSM params, templates `wg0.conf`, starts `wg-quick@wg0` and `pegasus-vpn-agent.service`

**Phase 4 — Verify hub**

1. SSM Session Manager into hub: `wg show wg0` → interface up, no peers yet
2. Verify agent: `journalctl -u pegasus-vpn-agent` → seeing "no peers in PENDING/ACTIVE"

**Phase 5 — Wire admin API + UI**

1. Run Prisma migration: `apps/api/prisma/migrations/<timestamp>_add_vpn_peers/`
2. Deploy `apps/api` (CI path filter)
3. Deploy `apps/admin-web` (CI path filter) with new VPN routes

**Phase 6 — Attach Lambda subset to VPC**

- For handlers that call tenant APIs (longhaul/pegii/efwk callers), set `vpc + securityGroups` in the CDK construct
- Deploy via existing CI

**Phase 7 — First tenant**

1. Admin UI → tenant detail → "Enable VPN" → download `client.conf`
2. Email `client.conf` + the install doc to the tenant
3. Tenant ops installs WireGuard for Windows + the conf
4. `wg show` on hub shows handshake within seconds
5. Admin UI status → ACTIVE with live handshake age

Total wall-clock: ~30 min infra + tenant onboarding turnaround time.

---

## 9. Operations and Maintenance

### Monitoring (CloudWatch)

| Metric                                      | Source                                            | Alarm                              |
| ------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| `PegasusWireGuard/HubReconcileLag`          | Agent emits `now - lastSuccessfulReconcile`       | >120s for 5 min                    |
| `PegasusWireGuard/ActivePeers`              | Agent: `wg show wg0 peers \| wc -l`               | DB count ≠ kernel count for 10 min |
| `PegasusWireGuard/HandshakeAgeMax`          | Agent: max over peers of `now - latest-handshake` | >180s for an ACTIVE peer for 5 min |
| `PegasusWireGuard/ActivePeerNoHandshake`    | Per-peer: ACTIVE but no handshake in 24h          | ≥1 (peer never installed)          |
| `PegasusWireGuard/TunnelRxBytes`, `TxBytes` | Agent                                             | dashboard only                     |
| `AWS/EC2 StatusCheckFailed`                 | built-in                                          | ≥1 (auto-recovered)                |
| `AWS/EC2 CPUCreditBalance`                  | built-in                                          | <30 for 15 min                     |

All alarms publish to **SNS topic `pegasus-wireguard-alerts`** with email subscriptions for platform admins (per Q14).

### Logging

- Hub journald → CloudWatch Logs `/pegasus/wireguard/hub`
- Agent: structured JSON (matches Powertools format), correlationId per cycle
- Admin handlers: existing Powertools pipeline, `service=vpn-admin`

### Restart Behavior

- `wg-quick@wg0.service` Restart=on-failure, RestartSec=3s
- `pegasus-vpn-agent.service` Restart=always, RestartSec=5s, After=wg-quick@wg0.service
- ASG instance replacement re-bootstraps from SSM in ~90s

### Backup

- Hub: stateless, nothing to back up
- Postgres: existing Neon branching covers `VpnPeer` table
- SSM: parameter versions retained automatically

### Runbooks (`docs/runbooks/wireguard/`)

1. `tunnel-down.md` — symptoms, restart, rebuild
2. `peer-not-syncing.md` — agent logs, force reconcile via SSM RunCommand
3. `rotate-hub-keys.md` — 3-yearly procedure including tenant config redistribution
4. `rotate-tenant-key.md` — admin UI flow, tenant redistribution
5. `expand-pool.md` — widening allocation if we somehow need >65k tenants
6. `tenant-not-handshaking.md` — tenant-side troubleshooting (firewall, time sync, key paste errors)
7. `evacuate-hub.md` — change instance type / AZ via instance refresh

---

## 10. Scaling Plan

| Tenants | Action                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------- |
| 1–50    | t4g.nano, ASG=1 (default)                                                                         |
| 50–200  | Upgrade to t4g.micro on CPU credit exhaustion or sustained CPU >40%                               |
| 200–500 | c7g.medium on >500 Mbps sustained or packet loss >0.01%                                           |
| 500+    | Two hubs sharded by `tenantId` hash. Per-hub `generation` counter. NOT NEEDED at projected scale. |

**Hard thresholds for adding a second hub** (so the team doesn't argue):
any of: tenants >150, sustained CPU >60%, peer count >150, handshake error rate >0.1%

---

## 11. Failure Modes

| Failure                            | Detection                                                                                                       | Recovery                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| WireGuard interface down           | systemd Restart; `ActivePeers`=0                                                                                | Auto-restart 3s; agent re-applies all peers; alarm if not healthy in 60s                                                     |
| Hub kernel panic                   | EC2 `StatusCheckFailed_System`                                                                                  | ASG replaces instance ~90s; new cloud-init bootstrap                                                                         |
| Hub AZ outage                      | EC2 status check                                                                                                | ASG relaunches in other AZ (we declared 2 subnets in v1.1; v1 is single-AZ — outage acceptable per Q10)                      |
| Tenant network partition           | `HandshakeAgeMax` climbs for that peer                                                                          | No action our side; tenant reconnects; `PersistentKeepalive=25` keeps NAT alive                                              |
| Tenant server reboot               | Handshake age climbs, then recovers                                                                             | None                                                                                                                         |
| Tenant changes their public IP     | If they use a hostname for their endpoint, none. Tenants don't have inbound rules so their IP changing is fine. | None                                                                                                                         |
| Hub EIP changes                    | Tenant configs all break                                                                                        | We pin EIP in CDK and use a stable Route 53 name `vpn.pegasus.internal`; EIP doesn't change without explicit operator action |
| Tenant misconfigures `client.conf` | No handshake                                                                                                    | Runbook: tenant-not-handshaking.md                                                                                           |
| Agent crashes                      | `HubReconcileLag` climbs; alarm                                                                                 | systemd Restart 5s                                                                                                           |
| SSM key leak                       | CloudTrail audit                                                                                                | Rotate per §7                                                                                                                |
| Postgres (Neon) outage             | Admin handlers 5xx; new peers blocked                                                                           | Hub keeps existing peers working — agent just can't fetch updates                                                            |
| Time skew on hub                   | Handshakes fail                                                                                                 | chrony enabled in user-data; alarm on skew >30s                                                                              |

---

## 12. Observability

### Metrics (`PegasusWireGuard/*`, dimensioned by `hubInstanceId`)

- `ActivePeers`, `PendingPeers`, `SuspendedPeers` (gauges)
- `HubReconcileLagSeconds` (gauge)
- `HandshakeAgeMaxSeconds`, `HandshakeAgeP95Seconds` (gauge)
- `ActivePeerNoHandshakeCount` (gauge — ACTIVE but never handshook)
- `HandshakeFailuresPerMinute` (counter)
- `TunnelRxBytesTotal`, `TunnelTxBytesTotal` (counter)
- `PerPeerRxBytes{tenantId}`, `PerPeerTxBytes{tenantId}` (counter — capped at top 50 talkers to control cost)
- `AgentReconcileDurationMs` (histogram via percentile metrics)

### Logs

- Agent JSON: `event`, `generation`, `tenantId`, `correlationId`, `action` (`add` | `remove` | `update`), `error`
- Kernel: `journalctl -u wg-quick@wg0`
- Admin handler: existing pipeline + `service=vpn-admin`

### Alerts (all SNS → email)

| Alert                  | Condition                                    | Severity |
| ---------------------- | -------------------------------------------- | -------- |
| Hub reconcile lag      | `HubReconcileLagSeconds > 120` for 5 min     | medium   |
| Handshake stale        | `HandshakeAgeMaxSeconds > 180` for 5 min     | high     |
| Peer state drift       | DB peer count ≠ kernel peer count for 10 min | medium   |
| Peer never handshakes  | `ActivePeerNoHandshakeCount ≥ 1` for 24h     | low      |
| Pool near exhaustion   | `ActivePeers > 200`                          | low      |
| Hub instance unhealthy | `StatusCheckFailed > 0`                      | high     |
| Handshake error spike  | `HandshakeFailuresPerMinute > 1`             | medium   |

### Synthetic latency probe

- Agent runs `ping -c 5 10.200.<N>.1` per ACTIVE peer every 5 min
- Emits `PegasusWireGuard/PeerLatencyMs{tenantId}` p50, p99, loss%

---

## 13. Cost Estimate (us-east-1, monthly)

| Item                                                          | 3 tenants   | 20 tenants  | 100 tenants  |
| ------------------------------------------------------------- | ----------- | ----------- | ------------ |
| EC2 `t4g.nano` (730h on-demand)                               | $3.80       | $3.80       | $3.80        |
| EBS 8 GB gp3                                                  | $0.64       | $0.64       | $0.64        |
| EIP attached                                                  | $0          | $0          | $0           |
| AWS data transfer out (HTTPS into tunnel + WG overhead)       | $1 (10 GB)  | $7 (75 GB)  | $35 (375 GB) |
| Tenant→AWS data in (free on AWS side; tenant pays their side) | $0          | $0          | $0           |
| CloudWatch Logs ~1 GB                                         | $0.50       | $1          | $2           |
| CloudWatch metrics (~15 base + per-tenant top-50 cap)         | $5          | $20         | $20          |
| SSM Parameter Store standard                                  | $0          | $0          | $0           |
| Route 53 PHZ + queries                                        | $0.50       | $0.50       | $1           |
| SNS email (first 1k notifications free)                       | $0          | $0          | $0           |
| **AWS subtotal**                                              | **~$11/mo** | **~$33/mo** | **~$62/mo**  |

Notes:

- Bandwidth dominates above ~50 tenants. If costs become a problem, evaluate compression at the API layer.
- Tenant-side cost is theirs to bear (their internet egress).
- The metric cost line is the second-biggest item at scale. Consider downsampling per-tenant counters or aggregating server-side.

---

## 14. Minimal Implementation Path

### Target: working tunnel + first tenant in under one day

**Morning (~4 hours)**

1. [60m] `WireGuardStack` (`packages/infra/lib/stacks/wireguard-stack.ts`):
   VPC, 1 lambda subnet, 1 hub-public subnet, route tables, SGs, EIP, ASG(1), IAM, Route 53 PHZ, SNS topic, CloudWatch alarms
2. [30m] CDK snapshot test under `packages/infra/lib/stacks/__tests__/wireguard-stack.test.ts`
3. [30m] Bootstrap SSM (hub privkey, hub pubkey, agent apikey)
4. [30m] cloud-init script, baked or fetched via S3 in user-data
5. [30m] Verify hub up via SSM Session Manager: `wg show wg0`
6. [60m] Prisma migration `<timestamp>_add_vpn_peers`:
   - `VpnPeer` (tenantId UNIQUE FK, assignedOctet1, assignedOctet2, publicKey, status enum, lastHandshakeAt, rxBytes, txBytes, createdAt, updatedAt)
   - `VpnState` singleton (`generation` counter)

**Afternoon (~4 hours)**

7. [90m] Handler `apps/api/src/handlers/admin/vpn.ts` + tests:
   - Zod schemas, no try/catch (per `feedback_no_handler_try_catch`), `{ data }` shape
   - Key generation via `crypto` module + `wg`-equivalent JS lib OR shell out to `wg` in build environment? Avoid shell in Lambda — use a pure-JS Curve25519 lib (`curve25519-js` or similar) that produces WG-compatible keys
   - `clientConfig` template
8. [60m] Reconcile agent (~250 LOC Node script):
   - Polls `/admin/vpn/peers` every 30s with `If-None-Match`
   - Diffs against `wg show wg0 dump` output
   - Applies via `wg set` shell-out (agent runs as root on the hub, this is fine)
   - PATCHes status + handshake info per peer
9. [90m] Admin UI (`apps/admin-web/src/routes/admin.tenants.$tenantId.vpn.tsx`):
   - Status panel
   - Enable button → fetch `client.conf` → trigger browser download
   - Suspend / Resume / Rotate / Delete buttons
   - Use existing `@pegasus/api-http` client (per `feedback_always_use_shared_api_client`)
   - Use `Serialized<VpnPeerDTO>` types (per `feedback_use_serialized_type`)
10. [30m] Playwright API spec at `apps/e2e/tests/api/vpn.spec.ts`:
    - Create → poll status → ACTIVE → delete
11. [15m] Write tenant install doc `docs/wireguard/install-windows.md`
12. [Deploy] Push to `main`; existing `.github/workflows/deploy.yml` path filters trigger `infra` + `api` + `admin-web` deploys

**End of day**

- Hub up, agent green, dashboards live, alarms armed
- Admin UI provisions a test tenant
- Test Windows VM with the `client.conf` handshakes
- Test Lambda calls `https://10.200.<N>.1/health` and gets a response

**Deferred to v1.1**

- Multi-AZ ASG
- Per-tenant top-50-bandwidth metric (start with global counters only)
- SQS-based instant revocation
- Audit log integration (Q13 = no)

---

## Appendix A — Prisma Model

```prisma
model VpnPeer {
  id              String    @id @default(cuid())
  tenantId        String    @unique
  tenant          Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assignedOctet1  Int                                      // 0..255
  assignedOctet2  Int                                      // 1..254 (skip 0/255)
  publicKey       String
  status          VpnStatus @default(PENDING)
  lastHandshakeAt DateTime?
  rxBytes         BigInt    @default(0)
  txBytes         BigInt    @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@unique([assignedOctet1, assignedOctet2])
  @@index([status])
}

model VpnState {
  id         Int @id @default(1)
  generation Int @default(1)
}

enum VpnStatus { PENDING ACTIVE SUSPENDED REVOKED }
```

## Appendix B — Handler Skeleton (follows project conventions)

```ts
// apps/api/src/handlers/admin/vpn.ts
import { Hono } from 'hono'
import { z } from 'zod'
import { basePrisma } from '../../lib/db'
import { requireRole } from '../../middleware/rbac'
import { generateWgKeypair } from '../../lib/wireguard'
import { renderClientConfig } from '../../lib/wireguard-config'
import type { AppEnv } from '../../types'

export const vpnAdminHandler = new Hono<AppEnv>()
vpnAdminHandler.use('*', requireRole(['platform_admin']))

vpnAdminHandler.post('/tenants/:tenantId/vpn', async (c) => {
  const tenantId = c.req.param('tenantId')

  const result = await basePrisma.$transaction(async (tx) => {
    const existing = await tx.vpnPeer.findUnique({ where: { tenantId } })
    if (existing) return { peer: existing, clientConfig: null }

    const { octet1, octet2 } = await allocateNextOctet(tx)
    const { publicKey, privateKey } = await generateWgKeypair()
    await tx.vpnState.update({ where: { id: 1 }, data: { generation: { increment: 1 } } })
    const peer = await tx.vpnPeer.create({
      data: {
        tenantId,
        assignedOctet1: octet1,
        assignedOctet2: octet2,
        publicKey,
        status: 'PENDING',
      },
    })
    const clientConfig = await renderClientConfig({ peer, privateKey })
    return { peer, clientConfig }
  })

  return c.json(
    { data: toDto(result.peer), clientConfig: result.clientConfig },
    result.clientConfig ? 201 : 200,
  )
})
// ... GET, DELETE, suspend, resume, rotate, agent endpoints follow same shape, no try/catch
```

## Appendix C — Tenant Install Doc Outline (`docs/wireguard/install-windows.md`)

Single-page Windows-only doc covering:

1. Download WireGuard for Windows from https://www.wireguard.com/install/
2. Install with default options (requires admin)
3. Save the `client.conf` from Pegasus admin to a known location
4. Open WireGuard → "Add Tunnel" → "Import tunnel(s) from file" → select `client.conf`
5. Click **Activate**
6. Verify: status shows "Active" within 5 seconds; "Latest handshake" shows a recent timestamp
7. Allow outbound UDP 51820 in Windows Firewall (usually automatic)
8. Bind your web API (IIS / Kestrel) to the WireGuard interface IP shown in the tunnel config (`Address` line)
9. Open inbound TCP 443 from `10.10.200.0/24` on the WireGuard interface in Windows Firewall
10. Troubleshooting: "Latest handshake" shows "Never" → check outbound UDP 51820 isn't blocked by corporate firewall

Total length: one page. Pegasus support contact at the bottom.
