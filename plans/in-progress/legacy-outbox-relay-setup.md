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

### Self-managed CA setup (the wired default for Roles Anywhere) — full procedure

We use a **self-managed CA** (no ACM Private CA, no monthly cost). Ops owns one CA key and renews the relay's leaf cert; everything else is IaC. The relay never holds a long-lived AWS key — the `aws_signing_helper` presents the host's X.509 leaf cert and exchanges it for **temporary** STS credentials (access key + secret + **session token**) on every refresh. The emitter must consume credentials from an AWS profile / the SDK default chain (it gets a session token — it must NOT be hardwired to a bare access-key/secret pair).

**Enablement is durable, not a one-shot flag.** Roles Anywhere is provisioned for an env whenever that env's CA **public** cert is committed at `packages/infra/config/outbox-relay/<env>-ca.pem` — the stack inlines it into a `CERTIFICATE_BUNDLE` trust anchor on EVERY synth, so routine CI deploys keep it (a `-c` flag CI never passes would silently tear it down on the next deploy — the RingCentral lesson). No committed cert → Roles Anywhere is skipped, topic/queue still deploy.

> **Staging (dolios) is already wired** (2026-06-21): CA generated, private key stored in SSM SecureString `/pegasus/staging/outbox-relay-ca-key`, public cert committed at `packages/infra/config/outbox-relay/staging-ca.pem`. The trust anchor/profile/role land on the next CI deploy of the api component. To do another env, repeat §A–B with `<env>` and account (staging `248812875460`, prod `331145994639`, region `us-east-1`).

Examples use **openssl** (EC P-256, what staging was built with).

#### A. CA — one-time, on a trusted admin machine (not the relay host)

1. **Generate the root CA** (10 yr). Keep `ca.key` secret:
   ```
   openssl ecparam -name prime256v1 -genkey -noout -out ca.key && openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt -subj "/O=Dolas/CN=Pegasus Outbox Relay <env> Root CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
   ```
2. **Stash the CA private key** (SSM SecureString, for leaf renewal) and **commit the public cert** as the trust-anchor source:
   ```
   aws ssm put-parameter --name /pegasus/<env>/outbox-relay-ca-key --type SecureString --value file://ca.key --region us-east-1
   ```
   Then `cp ca.crt packages/infra/config/outbox-relay/<env>-ca.pem` and commit it.

#### B. AWS side — deploy the Roles Anywhere principal

3. **Deploy.** Just merge the committed cert — the canonical CI deploy provisions the trust anchor/profile/role (no flag needed). (`-c outboxAcmPcaArn=<arn>` still selects ACM Private CA if ever preferred.)
4. **Read the three ARNs the relay needs** from the stack outputs:
   ```
   aws cloudformation describe-stacks --stack-name pegasus-<env>-outbox-relay --query "Stacks[0].Outputs" --output table --region us-east-1
   ```
   - `RelayTrustAnchorArn` — carries a generated UUID; read it here.
   - `RelayProfileArn` — carries a generated UUID; read it here.
   - `RelayRoleArn` — deterministic: `arn:aws:iam::<account>:role/pegasus-<env>-outbox-relay-publish`.

#### C. On-prem relay host — issue the leaf cert + wire the credential helper

5. **Issue the host's leaf cert** (1 yr), signed by the CA, where `ca.key` lives (or `aws ssm get-parameter --name /pegasus/<env>/outbox-relay-ca-key --with-decryption` to retrieve it), then copy `leaf.pem` + `leaf.key` to `C:\Services\Pegasus.Outbox.Relay\.aws\` on the host:
   ```
   openssl ecparam -name prime256v1 -genkey -noout -out leaf.key && openssl req -new -key leaf.key -subj "/O=Dolas/CN=pegasus-<env>-outbox-relay-dolios" | openssl x509 -req -CA ca.crt -CAkey ca.key -CAcreateserial -sha256 -days 365 -out leaf.pem -extfile <(printf "basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n")
   ```
   On the host, restrict the key to the service account: `icacls "...\.aws\leaf.key" /inheritance:r /grant:r "<RelayServiceAccount>:R"`.
6. **Install the credential helper** `aws_signing_helper` (AWS IAM Roles Anywhere Credential Helper) on the host.
7. **Configure the AWS profile** the relay's Windows service account will use (`%UserProfile%\.aws\config` for that account, or `C:\Windows\System32\config\systemprofile\.aws\config` if it runs as `LocalSystem`). The `credential_process` shells out to the helper, which returns fresh temp creds on demand:
   ```
   [profile pegasus-outbox-relay]
   credential_process = "C:\\Tools\\aws_signing_helper.exe" credential-process --certificate C:\\Services\\Pegasus.Outbox.Relay\\.aws\\leaf.pem --private-key C:\\Services\\Pegasus.Outbox.Relay\\.aws\\leaf.key --trust-anchor-arn <RelayTrustAnchorArn> --profile-arn <RelayProfileArn> --role-arn <RelayRoleArn>
   region = us-east-1
   ```
8. **Point the relay at the profile** (service-scoped env, machine-wide with `/M`):
   ```
   setx AWS_PROFILE "pegasus-outbox-relay" /M
   setx AWS_REGION "us-east-1" /M
   ```
9. **Verify the credential chain BEFORE starting the service** — this is the cleanest isolation of "can the host assume the role at all":
   ```
   aws sts get-caller-identity --profile pegasus-outbox-relay
   ```
   Expect an assumed-role ARN containing `pegasus-<env>-outbox-relay-publish`. If this fails, fix it here — don't debug it through the relay.
10. **Automate leaf renewal** — the one recurring task. Re-issue/replace `leaf.pem`/`leaf.key` before the 1-yr expiry (a scheduled task re-running step 5 against the SSM-stored CA key). The CA cert (10 yr) and the trust anchor need no routine maintenance; only the leaf does. If the leaf expires, `get-caller-identity` starts failing and the relay silently stops publishing — alarm on outbox depth (§5) is your backstop.

> **Hardening (optional):** the relay role currently trusts **any** cert that chains to the CA. Because this CA is dedicated to the relay (it only ever signs the one leaf), that's acceptable. To tighten, add a trust-policy condition on the cert subject CN (`aws:PrincipalTag/x509Subject/CN`) in `OutboxRelayStack`.

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
