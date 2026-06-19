# Outbox Relay — Deployment & Configuration Runbook

How to stand up `Pegasus.Outbox.Relay` (the on-prem Windows Service that drains the transactional outbox and publishes shipment domain events to AWS SNS).

**Status going in:** the relay code and the capture side (`Outbox` table + `ShipmentRepository` writes) are complete and tested. What remains is **configuration and deployment** — there is no more code to write for slice 1. The companion infra requirements are in [`aws-outbox-sns-sqs-handoff.md`](aws-outbox-sns-sqs-handoff.md); the implementation plan is `plans/in-progress/shipment-outbox-event-publishing.md`.

---

## 0. Prerequisites (must be true before the relay can do anything useful)

| #   | Prerequisite                               | How to satisfy                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | **SNS FIFO topic provisioned** + its ARN   | IaC repo, per the handoff. **Must be FIFO** (`.fifo` suffix) — the relay always sets `MessageGroupId`/`MessageDeduplicationId`; publishing those to a Standard topic errors.                                                                                        |
| P2  | Infra decisions **D1–D6** resolved         | See handoff §11 (FIFO, runtime subscriptions, KMS, credentials, region, naming).                                                                                                                                                                                    |
| P3  | **`Outbox` table exists** in the target DB | Created by `Migration0003OutboxTable`, applied automatically when `Pegasus.Api` starts (it runs `SchemaMigrator` on boot). To apply without serving traffic: run the API once with `--migrate-only`. Verify: `SELECT OBJECT_ID('dbo.Outbox','U')` returns non-null. |
| P4  | The capture side is deployed               | The MoveManager build that contains the `ShipmentRepository` outbox writes is live, so new shipment saves enqueue rows.                                                                                                                                             |
| P5  | **Subscriber idempotency** on `messageId`  | Owned by each consumer (e.g. the Python partner integration). At-least-once delivery means duplicates _will_ occur — non-negotiable. See handoff §5/§10.                                                                                                            |

---

## 1. Configure the relay

Configuration binds from the `Relay` section of `appsettings.json` (or environment variables / user-secrets). The shipped `appsettings.json`:

```json
"Relay": {
  "ConnectionString": "Server=...;database=PegNW;...;TrustServerCertificate=true;",
  "TopicArn": "",
  "PollIntervalSeconds": 5,
  "BatchSize": 50,
  "MaxAttempts": 5,
  "StaleLockSeconds": 300,
  "Source": "MoveManager"
}
```

| Key                   | Meaning                                                                                           | Default       | Set for prod        |
| --------------------- | ------------------------------------------------------------------------------------------------- | ------------- | ------------------- |
| `ConnectionString`    | DB that owns the `Outbox` table (the same per-site DB the app writes)                             | a dev default | **Yes** — per site  |
| `TopicArn`            | ARN of the SNS FIFO topic (P1)                                                                    | empty         | **Yes** — required  |
| `PollIntervalSeconds` | How often to drain                                                                                | 5             | tune to latency SLA |
| `BatchSize`           | Rows claimed per cycle                                                                            | 50            | usually fine        |
| `MaxAttempts`         | Attempts before a row is dead-lettered (`Status = 2`)                                             | 5             | per tolerance       |
| `StaleLockSeconds`    | A claimed (`Status = 1`) row older than this is swept back to Pending (recovers a crashed worker) | 300           | ≥ a few cycles      |
| `Source`              | Value of the SNS `source` message attribute                                                       | `MoveManager` | optional            |

### Keep secrets out of source control

Any setting can be overridden with environment variables using the `Relay__` prefix (double underscore), which is preferable for the connection string and is mandatory if you don't want creds in `appsettings.json`:

```
setx Relay__ConnectionString "Server=...;database=PegNW;User Id=...;Password=...;TrustServerCertificate=true;" /M
setx Relay__TopicArn "arn:aws:sns:us-east-1:123456789012:movemanager-domain-events.fifo" /M
```

(Service-scoped env vars: set them machine-wide with `/M`, or as the service account's environment.)

---

## 2. AWS credentials & region (on-prem)

The relay creates the SNS client with the **default credential and region resolution chain** — it does _not_ hard-code keys. Provide credentials by **one** of (preference order, per handoff §7 / decision **D4**):

1. **IAM Roles Anywhere** (preferred) — X.509 trust anchor; no long-lived keys on the host. Configure the AWS SDK credential profile to use the `aws_signing_helper` (Roles Anywhere credential helper). The AWS side (trust anchor + profile + least-privilege role) is provisioned by `OutboxRelayStack` — see **"Self-managed CA setup"** below.
2. **Shared profile** — `%UserProfile%\.aws\credentials` for the service account.
3. **Static access key** via env vars (least preferred): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (store outside `appsettings.json`). Needs a hand-made IAM user/role with the least-privilege policy below — `OutboxRelayStack` only creates an IAM principal on the Roles Anywhere path.

### Self-managed CA setup (the wired default for Roles Anywhere)

We use a **self-managed CA** (no ACM Private CA, no monthly cost). Ops owns one CA key and renews the relay's leaf cert; everything else is IaC. One-time:

1. **Generate the CA** (once; keep the private key secret — vault / SSM SecureString / offline). Long-lived, e.g. 10 yr:
   ```
   step certificate create "Pegasus Outbox Relay Root CA" ca.crt ca.key --profile root-ca --no-password --insecure --not-after 87600h
   ```
2. **Publish the CA's PUBLIC cert** to SSM (the trust anchor reads it; it is not secret):
   ```
   aws ssm put-parameter --name /pegasus/<env>/outbox-relay-ca-pem --type String --value file://ca.crt --region us-east-1
   ```
3. **Deploy with Roles Anywhere on:** `npx cdk deploy PegasusStaging-OutboxRelayStack -c env=<env> -c outboxRolesAnywhere=true` (override the param name with `-c outboxCaCertParam=...`, or use ACM-PCA instead with `-c outboxAcmPcaArn=<arn>`). Until the SSM parameter is populated the stack **skips** the trust anchor (logs a warning) and the topic/queue still deploy — so you can run on the static-key fallback in the interim.
4. **Issue + install the relay's leaf cert** on the Windows host (shorter-lived, e.g. 1 yr), signed by the CA, and point `aws_signing_helper` at it. **Automate renewal** (the one recurring task) — e.g. `step-ca` with ACME (`step ca renew` on a scheduled task) — or the leaf silently expires and the relay stops publishing.

Read the trust-anchor + role ARNs the relay needs from the stack outputs `RelayTrustAnchorArn` / `RelayRoleArn`.

**Region is required** and is resolved the same way — set it explicitly:

```
setx AWS_REGION "us-east-1" /M      (use the region from decision D6)
```

The relay's IAM principal needs **least-privilege**:

- `sns:Publish` on the topic ARN only.
- If the topic uses a **KMS CMK** (decision D3): `kms:GenerateDataKey*` and `kms:Decrypt` on that key — otherwise publishes fail silently at the SNS boundary.

> The service runs under a Windows account; make sure _that_ account is the one whose credential profile / env vars are configured. If running as `LocalSystem`, put credentials in machine-wide env vars or a machine-readable profile.

---

## 3. Build, publish, install

From the repo root on the target host (or publish elsewhere and copy):

```powershell
# 1. Publish a self-contained-ish framework-dependent build
dotnet publish Pegasus.Outbox.Relay\Pegasus.Outbox.Relay.csproj -c Release -o C:\Services\Pegasus.Outbox.Relay

# 2. Edit C:\Services\Pegasus.Outbox.Relay\appsettings.json (or set Relay__* env vars) — TopicArn + ConnectionString

# 3. Install the Windows Service (elevated prompt). install-service.ps1 is copied to the output.
cd C:\Services\Pegasus.Outbox.Relay
.\install-service.ps1
```

`install-service.ps1` parameters (defaults shown):

- `-InstallPath C:\Services\Pegasus.Outbox.Relay`
- `-ServiceName PegasusOutboxRelay`
- `-DisplayName "Pegasus Outbox Relay"`
- `-StartupType Automatic`
- `-Uninstall` (switch) to stop + remove the service

The script registers the service, creates the Event Log source, starts it, and waits up to 30s for `Running`.

---

## 4. Verify (smoke test)

1. **Service is running:** `Get-Service PegasusOutboxRelay`.
2. **Logs:** `C:\ProgramData\Pegasus\OutboxRelay\logs\relay-<date>.log` — expect the startup line `Outbox relay starting; polling every 5s, batch 50.` and no recurring errors.
3. **End-to-end:** create/close a shipment in MoveManager (or insert a test row):
   ```sql
   INSERT INTO dbo.Outbox (MessageId, AggregateType, AggregateId, EventType, SchemaVersion, Payload, OccurredAtUtc)
   VALUES (NEWID(), 'Shipment', '999999', 'Shipment.Opened', 1, '{"status":"Open"}', SYSUTCDATETIME());
   ```
   Within `PollIntervalSeconds` the row should **disappear** from `dbo.Outbox` (deleted on successful publish) and arrive on the subscriber SQS queue.
4. **Pending depth stays near zero:** `SELECT COUNT(*) FROM dbo.Outbox WHERE Status = 0;` should drain, not grow.

---

## 5. Monitoring

**AWS-side** (provisioned by the IaC repo, handoff §8): alarm on DLQ depth `> 0` and `ApproximateAgeOfOldestMessage` on each queue, plus SNS `NumberOfNotificationsFailed`.

**Relay-side (this host):**

- **Oldest pending age** is the real SLA signal:
  ```sql
  SELECT DATEDIFF(SECOND, MIN(OccurredAtUtc), SYSUTCDATETIME()) AS OldestPendingSeconds
  FROM dbo.Outbox WHERE Status = 0;
  ```
- **Dead-letter count** (needs a human):
  ```sql
  SELECT COUNT(*) FROM dbo.Outbox WHERE Status = 2;
  ```
- Log errors/warnings in the relay log file.

---

## 6. Operational runbook

| Situation                          | What it means                           | Action                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rows piling up at `Status = 0`     | Relay stopped, or every publish failing | Check the service is running and the log; verify `TopicArn`, region, credentials, and `sns:Publish`/KMS permissions.                                                                        |
| Rows stuck at `Status = 1`         | A worker crashed mid-publish            | Auto-recovered by the stale-lock sweep after `StaleLockSeconds`. No action unless persistent.                                                                                               |
| Rows at `Status = 2` (dead-letter) | Exhausted `MaxAttempts`                 | Inspect `LastError`. After fixing the cause, requeue: `UPDATE dbo.Outbox SET Status = 0, Attempts = 0, NextAttemptUtc = SYSUTCDATETIME(), LastError = NULL WHERE Status = 2 AND Id = <id>;` |
| Need to pause publishing           | Maintenance / incident                  | `Stop-Service PegasusOutboxRelay`. Rows accumulate safely (durable); they drain when restarted.                                                                                             |
| Duplicate events downstream        | Expected (at-least-once)                | Consumers must dedupe on `messageId` (P5). Not a relay bug.                                                                                                                                 |

---

## 7. Cutover from the existing trigger

During migration, the legacy SQL trigger and the new outbox can both emit the same shipment events. To validate before cutting over:

1. Run the relay publishing to a **shadow/test subscriber** first, or compare outbox output against the trigger's queue rows for the same shipments.
2. Once parity is confirmed, **disable the legacy trigger** for shipment events (a deliberate, human-authored DB change — out of the additive migration lane).
3. Keep the relay's DLQ alarmed so any divergence surfaces immediately.

---

## 8. What this slice does and does not cover

- **Covers:** outbound `Shipment.Opened` / `Shipment.Closed` events, captured atomically with the `comm_eticket` write and relayed to SNS.
- **Not yet:** `Receipt` and the EF-mapped aggregates (reuse `OutboxWriter`), legacy raw-ADO flows (Sale/Account — need the unit-of-work refactor), and the inbound order/lead consumer. These are later slices per the plan.
