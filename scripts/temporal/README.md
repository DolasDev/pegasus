# scripts/temporal

Operator scripts for Temporal Cloud (account `chgel`). Background and decisions:
`plans/completed/f0d47ffb-tenant-temporal-namespaces.md` (3b) and
`plans/in-progress/durable-workflow-worker.md` (3a).

None of these scripts prints, logs or passes a key on a command line. Keys live
in memory, or in 0600 temp files that are shredded on exit.

| Script                   | What it does                                                                                                                                                                                         | Needs                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `build-tcld.sh`          | Builds `tcld` (no prebuilt binaries exist) with a checksum-verified Go, under `~/.cache/pegasus-tcld`. Then `~/.cache/pegasus-tcld/bin/tcld login`.                                                  | `curl`, internet                                                          |
| `create-provisioner.sh`  | Creates `pegasus-<env>-provisioner` (Developer role) and a 1-year key, and stores it as `pegasus/<env>/temporal-provisioner`. Refuses to duplicate.                                                  | `tcld login` as **Global Admin/Owner**; AWS SSO for `dolas-pegasus-<env>` |
| `guardrail-probe.py`     | Proves one env's provisioner can't touch the other env's namespaces or `pegasus-<env>`, and tenant keys don't cross envs. Creates and deletes two throwaway namespaces. `--cleanup` only tears down. | `uv`; AWS SSO for both profiles                                           |
| `dns-probe.sh`           | From inside the tenant-runner network: `saas-api.tmprl.cloud` must be NXDOMAIN (3a's DNS Firewall) while the namespace endpoint resolves.                                                            | AWS SSO for `dolas-pegasus-<env>`                                         |
| `rotate-platform-key.sh` | Rotates the platform key in `pegasus/<env>/temporal-cloud`, tags the secret `expiresAt`/`keyId`, and prints the redeploy and old-key-delete steps. `--tag-only` just sets the tags from Cloud.       | `tcld login` as an account admin; AWS SSO for `dolas-pegasus-<env>`       |

## When to run what

- **New environment, or a provisioner identity recreated:** `create-provisioner.sh <env>`,
  then `guardrail-probe.py`, which must print `RESULT: PASSED` before the ARN goes
  into `TEMPORAL_SECRET_ARNS` in `packages/infra/bin/app.ts`. The deploy
  pre-flight greps every `arn:aws:secretsmanager:` literal in that file.
- **After changing a provisioner's role or Temporal Cloud permissions:** re-run
  `guardrail-probe.py`.
- **After a WireGuard VPC / DNS Firewall change:** `dns-probe.sh <env>`.

## Keys that expire

Every Temporal key is minted for 1 year (Cloud refuses an expiry under 24 h).
The provisioner's daily run (`{action: 'daily-maintenance'}`) publishes
`TemporalKeyDaysToExpiry` per `KeyClass`; the alarm
`pegasus-temporal-key-expiry-<class>` emails when one drops under 30 days or
stops reporting, and `pegasus-temporal-key-rotation-failed` emails on any failed
rotation that day.

| Key                                                                                                      | Expires (as of 2026-10-12) | Rotation                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provisioner (`pegasus-<env>-provisioner-key`, in `pegasus/<env>/temporal-provisioner`)                   | 2027-10-11                 | **Automatic.** The daily run mints a new key for its own service account from 45 days out, proves it authenticates, then writes it to the secret. It never deletes the old key, which expires on its own.                          |
| Tenant namespace keys (`TenantTemporalNamespace`)                                                        | 1 year after provisioning  | **Automatic.** The daily run rotates every READY row from 45 days out. The new key waits in a pending slot until it is authorized on the namespace; the old one is deleted 24 h after the swap, once the new one is proven again.  |
| Platform (`pegasus-<env>-api-key` of `pegasus-<env>-service-account`, in `pegasus/<env>/temporal-cloud`) | 2028-06-04                 | **Manual:** `rotate-platform-key.sh <env>`. It's baked into the Lambdas at deploy time and into ECS tasks at start, so rotating it means a redeploy. The alarm reads the secret's `expiresAt` tag, which the script keeps current. |

**If the provisioner's self-rotation goes wrong.** The secret is only written
after the new key is proven, and the old key keeps working until it expires. To
go back anyway: `aws secretsmanager update-secret-version-stage --secret-id
pegasus/<env>/temporal-provisioner --version-stage AWSCURRENT
--move-to-version-id <AWSPREVIOUS's id> --remove-from-version-id <AWSCURRENT's
id>` (find the ids with `list-secret-version-ids`). If both keys are lost, an
admin mints a new one for `pegasus-<env>-provisioner` as `create-provisioner.sh`
does and `put-secret-value`s `{"apiKey": ...}`. Force a self-rotation (for
example, to test one) by invoking the provisioner with
`{"action": "rotate-own-key", "force": true}`.
