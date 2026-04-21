# Runbook: Deploy / update the VPN reconcile agent

## Automated flow (normal case)

A push to `main` that touches `apps/vpn-agent/**` triggers the
`.github/workflows/publish-vpn-agent.yml` workflow. The workflow:

1. Builds the agent, runs its tests, and stages a runtime tree with prod
   dependencies installed.
2. Tarballs it as `vpn-agent-<git-sha>.tgz`.
3. Reads the CloudFormation outputs from the `pegasus-dev-wireguard`
   stack to discover the artifact bucket, SSM parameter name, and ASG
   name.
4. Uploads the tarball to
   `s3://<AgentArtifactsBucketName>/vpn-agent/<git-sha>.tgz`.
5. Writes the S3 URI to the SSM parameter
   `/pegasus/wireguard/agent/tarball-uri` (plain `String`).
6. Calls `aws autoscaling start-instance-refresh` on the hub ASG.
   Because the ASG is `min=max=desired=1`, refresh replaces the single
   instance — the new hub boots, reads the updated SSM value in cloud-init,
   pulls the new tarball, and starts `pegasus-vpn-agent.service`. Expect
   ~90 seconds of tunnel downtime during the swap (acceptable per §10 / Q10
   of the plan).

Manual trigger: **Actions → Publish VPN agent → Run workflow**. Tick
_Skip the ASG instance refresh_ if you want to stage the artifact without
touching the live hub (useful when you want to roll forward two fixes in a
single refresh).

## One-time bootstrap

These steps must run once per AWS account before the automated flow works.
They are documented here rather than automated because they either require
interactive authentication or produce material that CloudFormation should
never carry.

### 1. Hub keypair (manual today — see plan follow-up (4))

```
wg genkey | tee priv | wg pubkey > pub

aws ssm put-parameter --name /pegasus/wireguard/hub/privkey \
  --type SecureString --value "$(cat priv)"
aws ssm put-parameter --name /pegasus/wireguard/hub/pubkey \
  --type String --value "$(cat pub)"
```

`priv` and `pub` are local artefacts — shred `priv` once the SSM write
succeeds.

### 2. Agent API key

The hub agent authenticates to the admin API with an `ApiClient` key that
holds the `vpn:sync` scope. Provision it from the admin portal (not
automated — requires a signed-in platform admin):

1. Sign in to the admin portal.
2. Create an `ApiClient` named `hub-agent` (any tenant; the VPN handler
   does not care which tenant the key is bound to). Grant scope
   `vpn:sync`. Copy the plain key shown **once**.
3. Seed it:
   ```
   aws ssm put-parameter --name /pegasus/wireguard/agent/apikey \
     --type SecureString --value "$PLAIN_KEY"
   ```

### 3. First agent tarball

If the hub was deployed before the CI workflow ran, the ASG will come up
with the tunnel but without the agent. Push any commit touching
`apps/vpn-agent/**` (or run **Actions → Publish VPN agent → Run
workflow**) to populate the SSM parameter and refresh the instance.

## Rolling back

`aws s3 ls s3://<bucket>/vpn-agent/` lists every published tarball by git
SHA. To roll back:

```
aws ssm put-parameter --overwrite --type String \
  --name /pegasus/wireguard/agent/tarball-uri \
  --value s3://<bucket>/vpn-agent/<older-sha>.tgz

aws autoscaling start-instance-refresh \
  --auto-scaling-group-name <HubAsgName> \
  --preferences '{"MinHealthyPercentage": 0, "InstanceWarmup": 60}'
```

The bucket keeps noncurrent versions for 90 days via its lifecycle rule.

## Verifying a new agent is running

After a refresh completes (~90s):

```
aws ssm start-session --target <new-instance-id>
sudo journalctl -u pegasus-vpn-agent -n 50
sudo wg show wg0
```

`journalctl` should show `agent.starting` then `reconcile.done` every 30s.
`wg show wg0` should list every ACTIVE peer.
