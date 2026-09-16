# WireGuard hub: give the t4g.nano swap so `dnf` stops being OOM-killed at boot

**Branch:** `fix/wireguard-hub-swap` · **Goal:** unblock the deploy pipeline — every Deploy run since #692 fails because the staging hub cannot boot.

## Context (so any agent can resume)

**Symptom:** Deploy has failed on every merge since 2026-09-15 14:52 (#692, #695, #696, #697). Last green: 2026-09-12 (#690). The failing step is always `Deploy to staging / CDK deploy`, and prod never runs (job skipped), so nothing has shipped since 09-12.

**Root cause (verified in prod/staging AWS, read-only):**

- `pegasus-staging-wireguard` is in `UPDATE_ROLLBACK_FAILED`; CloudFormation refuses any update while it is.
- It got there on #692's deploy: the hub ASG (`HubAsgASG26763D76`) rolled a new instance, which sent `cfn-signal` FAILURE ~47s in ("Received 1 FAILURE signal(s) out of 1"). The rollback launched another instance, which failed the same way ⇒ `UPDATE_ROLLBACK_FAILED`.
- Console output of the surviving instance `i-057b1128b30820f83`: `dnf invoked oom-killer` at t+29.9s, `Out of memory: Killed process 2016 (dnf)`, then `+ exitCode=137`. The hub is `t4g.nano` (0.5 GB, `wireguard-stack.ts:723`) with **no swap**, and `dnf update -y` (`:543`) is the first thing user-data runs.
- Not the CDK bump in #692 (aws-cdk-lib 2.267→2.268): the ROLLBACK instance runs the OLD launch template and died identically. dnf's own memory use grew past what 0.5 GB allows.
- Prod's hub is the same t4g.nano on the same AMI (`ami-0a157bd98d97a9589`), healthy only because it last booted 09-10. **The next prod hub replacement takes the on-prem tunnel down the same way.**

**User decision 2026-09-15:** add swap, keep t4g.nano (no instance-size change, no cost change). Also approved: `continue-update-rollback --resources-to-skip HubAsgASG26763D76` on staging, run manually, to unstick the stack before this fix can deploy.

**Current staging state:** the running hub `i-057b…` was killed mid-user-data, so wg0 is NOT configured — the staging/QA tunnel is down until this fix deploys and replaces the instance.

## Design

`packages/infra/lib/stacks/wireguard-stack.ts` user-data, as the FIRST commands (before `dnf update -y`):

```
# 1 GB swapfile: t4g.nano has 0.5 GB and dnf's metadata load OOMs without it
# (2026-09-15: dnf killed at boot, exit 137, blocked every deploy for 3 days).
swapon --show | grep -q '/swapfile' || {
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
}
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Idempotent (user-data can re-run on reboot), and survives reboot via fstab. Keep `set -euxo pipefail` semantics: every command above either succeeds or is guarded.

## Checklist

- [x] Add the swap block to the hub user-data ahead of `dnf update -y`
- [x] Test in `wireguard-stack.test.ts`: user-data creates+enables swap, and does so BEFORE `dnf update` (ordering is the whole point)
- [x] Gates: `packages/infra` vitest (32 pass), `npx tsc --noEmit` on infra, eslint clean
- [ ] PR through the merge queue; watch the Deploy run — staging must reach `UPDATE_COMPLETE` and prod must actually deploy
- [ ] After deploy: confirm the new staging hub instance signals success, wg0 is up, and the QA tunnel works
- [x] GOTCHAS.md entry: hub OOM at boot — symptom, console-output check, and why the rollback also fails
- [x] Archive this plan into the impl commit

## Blocked on, before this can land

`continue-update-rollback --resources-to-skip HubAsgASG26763D76` on
`pegasus-staging-wireguard` (user-approved 2026-09-15) has NOT run — the AWS SSO
session expired mid-command. Until the stack leaves `UPDATE_ROLLBACK_FAILED`, the
Deploy run for this PR fails the same way, however correct the fix is.

## Files

- M `packages/infra/lib/stacks/wireguard-stack.ts`
- M `packages/infra/lib/stacks/__tests__/wireguard-stack.test.ts`
- M `dolas/agents/project/GOTCHAS.md`

## Risks

- **Prod hub replacement.** This changes the launch template, so prod's hub is replaced on deploy — a brief on-prem tunnel interruption. That replacement is also what proves the fix; leaving it unfixed means the same OOM at the next unplanned replacement, with no warning.
- **A second deploy blocker may be hiding behind this one.** Staging CDK deploy never got past the wireguard stack, so later stacks in the same run are unproven. Watch the full Deploy run, not just the wireguard stack.
- **`fallocate` on some filesystems** can fail; the `dd` fallback covers it.
