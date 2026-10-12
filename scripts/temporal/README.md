# scripts/temporal

Operator scripts for Temporal Cloud (account `chgel`). Background and decisions:
`plans/in-progress/tenant-temporal-namespaces.md` (3b) and
`plans/in-progress/durable-workflow-worker.md` (3a).

None of these scripts prints, logs or passes a key on a command line. Keys live
in memory, or in 0600 temp files that are shredded on exit.

| Script                  | What it does                                                                                                                                                                                         | Needs                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `build-tcld.sh`         | Builds `tcld` (no prebuilt binaries exist) with a checksum-verified Go, under `~/.cache/pegasus-tcld`. Then `~/.cache/pegasus-tcld/bin/tcld login`.                                                  | `curl`, internet                                                          |
| `create-provisioner.sh` | Creates `pegasus-<env>-provisioner` (Developer role) and a 1-year key, and stores it as `pegasus/<env>/temporal-provisioner`. Refuses to duplicate.                                                  | `tcld login` as **Global Admin/Owner**; AWS SSO for `dolas-pegasus-<env>` |
| `guardrail-probe.py`    | Proves one env's provisioner can't touch the other env's namespaces or `pegasus-<env>`, and tenant keys don't cross envs. Creates and deletes two throwaway namespaces. `--cleanup` only tears down. | `uv`; AWS SSO for both profiles                                           |
| `dns-probe.sh`          | From inside the tenant-runner network: `saas-api.tmprl.cloud` must be NXDOMAIN (3a's DNS Firewall) while the namespace endpoint resolves.                                                            | AWS SSO for `dolas-pegasus-<env>`                                         |

## When to run what

- **New environment, or a provisioner identity recreated:** `create-provisioner.sh <env>`,
  then `guardrail-probe.py`, which must print `RESULT: PASSED` before the ARN goes
  into `TEMPORAL_SECRET_ARNS` in `packages/infra/bin/app.ts`. The deploy
  pre-flight greps every `arn:aws:secretsmanager:` literal in that file.
- **After changing a provisioner's role or Temporal Cloud permissions:** re-run
  `guardrail-probe.py`.
- **After a WireGuard VPC / DNS Firewall change:** `dns-probe.sh <env>`.

## Keys that expire

| Key                                                 | Expires                              | Rotation                                                                           |
| --------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `pegasus-{staging,prod}-provisioner-key`            | 2027-10-11                           | Being automated (follow-on PR to the enable PR).                                   |
| Tenant namespace keys (`TenantTemporalNamespace`)   | 1 year after provisioning            | The provisioner's `rotate` action; scheduling it is part of the same follow-on PR. |
| `pegasus-{staging,prod}-service-account` (platform) | 2028-06-04 (`pegasus-<env>-api-key`) | Manual; a runbook and an expiry alarm come with that PR.                           |
