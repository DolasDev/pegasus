// ---------------------------------------------------------------------------
// WireGuardStack - the single-hub multi-tenant VPN plane.
//
// Provisions everything in §6 of plans/in-progress/wireguard-multi-tenant-vpn.md:
//   - A dedicated VPC (10.10.0.0/16) with one public + one private subnet.
//   - A t4g.nano ARM hub in an ASG sized min=max=desired=1, pinned to an EIP
//     so tenant client.conf Endpoint values never need to change.
//   - Security groups allowing UDP 51820 ingress from the internet (tenants)
//     and TCP 443 from the private Lambda SG (east-west).
//   - An IAM instance role with narrow SSM read on the hub-key parameters,
//     CloudWatch metric/log write, and Route 53 change permissions for the
//     private hosted zone.
//   - A private hosted zone `vpn.pegasus.internal` for per-tenant overlay
//     CNAMEs written by the reconcile agent.
//   - SNS topic `pegasus-wireguard-alerts` for CloudWatch alarm fan-out.
//   - Cloud-init that installs wireguard-tools, templates
//     /etc/wireguard/wg0.conf from SSM, and enables wg-quick@wg0.
//
// The hub reconcile agent (apps/vpn-agent, landing in Unit 5) will extend
// this stack by appending its install steps to the user-data script and
// enabling pegasus-vpn-agent.service. Today the hub runs the tunnel without
// the agent - peers are still added/removed by manually running `wg set` or
// after the agent lands.
// ---------------------------------------------------------------------------

import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as customResources from 'aws-cdk-lib/custom-resources'
import { type Construct } from 'constructs'

export interface WireGuardStackProps extends cdk.StackProps {
  /**
   * SSM parameter path holding the hub's base64 Curve25519 private key
   * (SecureString). Seeded once out of band - see §8 Phase 2 of the plan.
   * Defaults to `/pegasus/wireguard/hub/privkey`.
   */
  readonly hubPrivateKeyParameterName?: string

  /**
   * SSM parameter path holding the hub's base64 public key (plain String).
   * Defaults to `/pegasus/wireguard/hub/pubkey`.
   */
  readonly hubPublicKeyParameterName?: string

  /** DNS name for the private hosted zone. Defaults to `vpn.pegasus.internal`. */
  readonly privateHostedZoneName?: string

  /**
   * Optional override for the admin API URL the reconcile agent polls.
   * Normally left unset — the URL is read from SSM at hub boot from
   * `/pegasus/wireguard/agent/admin-api-url`, which ApiStack writes (it
   * deploys after WireGuardStack, so the prop-based wiring would create
   * a circular dependency). Set this only for local testing.
   */
  readonly adminApiUrl?: string
}

export class WireGuardStack extends cdk.Stack {
  /** VPC exposed for Lambdas that need to reach the hub. */
  public readonly vpc: ec2.IVpc

  /** Security group attached to the hub - Lambdas that need the tunnel egress to this SG on 443. */
  public readonly hubSecurityGroup: ec2.ISecurityGroup

  /** The stable public IPv4 address of the hub. Tenant `client.conf`s embed this via DNS CNAME. */
  public readonly hubEip: ec2.CfnEIP

  /** Route 53 private hosted zone used for per-tenant overlay CNAMEs. */
  public readonly privateHostedZone: route53.IPrivateHostedZone

  /** SNS topic the CloudWatch alarms publish to. Subscribe platform admin emails out of band. */
  public readonly alertsTopic: sns.ITopic

  /** Private subnets Lambda functions should attach to when they need the tunnel. */
  public readonly privateLambdaSubnets: ec2.ISubnet[]

  /** Bucket the CI publish-vpn-agent workflow drops agent tarballs into. */
  public readonly agentArtifactsBucket: s3.IBucket

  /** ASG name - used by CI to trigger an instance refresh after publishing a new agent. */
  public readonly hubAsgName: string

  /** Base64 hub public key - produced by the key-bootstrap Custom Resource. */
  public readonly hubPublicKey: string

  /**
   * SSM parameter name (plain String) that holds the SHA-256 hex hash of the
   * agent's `vnd_*` API key. ApiStack reads this at deploy time and injects
   * it into the API Lambda env so the auth middleware can verify the agent's
   * Bearer token without a DB lookup or per-request SSM call.
   */
  public readonly agentApiKeyHashParameterName: string

  /** Tenant-facing endpoint (EIP + port). Embed in tenant client.conf via renderClientConfig. */
  public readonly hubEndpoint: string

  /**
   * Tunnel-proxy Lambda. Main API Lambda invokes this synchronously when a
   * handler needs to call a tenant overlay IP. Lives in the private-lambda
   * subnets with the `10.200.0.0/16 → hub` route, so it can reach tenant
   * servers through the WireGuard tunnel without giving the main API
   * Lambda VPC attachment (and its cold-start / public-egress cost).
   */
  public readonly tunnelProxyFunction: lambda.IFunction

  constructor(scope: Construct, id: string, props: WireGuardStackProps = {}) {
    super(scope, id, props)

    const hubPrivKeyParam = props.hubPrivateKeyParameterName ?? '/pegasus/wireguard/hub/privkey'
    const hubPubKeyParam = props.hubPublicKeyParameterName ?? '/pegasus/wireguard/hub/pubkey'
    const phzName = props.privateHostedZoneName ?? 'vpn.pegasus.internal'
    const agentTarballUriParam = '/pegasus/wireguard/agent/tarball-uri'
    const adminApiUrlParam = '/pegasus/wireguard/agent/admin-api-url'
    const agentApiKeyParam = '/pegasus/wireguard/agent/apikey'
    const agentApiKeyHashParam = '/pegasus/wireguard/agent/apikey-hash'

    // -----------------------------------------------------------------------
    // VPC - 10.10.0.0/16 per plan §2
    // -----------------------------------------------------------------------
    // Two AZs declared but only AZ-a is used in v1. Hub is in a public subnet
    // (no NAT GW - its agent needs egress via its own public ENI per Q16).
    const vpc = new ec2.Vpc(this, 'VpnVpc', {
      vpcName: 'pegasus-wireguard-vpc',
      ipAddresses: ec2.IpAddresses.cidr('10.10.0.0/16'),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'hub-public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private-lambda',
          // PRIVATE_ISOLATED - no NAT egress; Lambdas that need public
          // egress for Cognito/Neon set their own routes via IGW when
          // attached.
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    })
    this.vpc = vpc
    this.privateLambdaSubnets = vpc.isolatedSubnets
    // Tag the private-lambda subnets so the hub's cloud-init can find their
    // route tables via `aws ec2 describe-route-tables` and point
    // 10.200.0.0/16 at itself on each boot.
    for (const subnet of vpc.isolatedSubnets) {
      cdk.Tags.of(subnet).add('pegasus:subnet-role', 'private-lambda')
    }

    // -----------------------------------------------------------------------
    // Security groups
    // -----------------------------------------------------------------------
    const hubSg = new ec2.SecurityGroup(this, 'HubSg', {
      vpc,
      securityGroupName: 'pegasus-wireguard-hub',
      description: 'WireGuard hub - UDP 51820 ingress from tenants; 443 ingress from Lambdas',
      allowAllOutbound: true,
    })
    hubSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(51820),
      'WireGuard handshake/data from tenant servers (source IPs vary per tenant).',
    )
    this.hubSecurityGroup = hubSg

    // -----------------------------------------------------------------------
    // IAM - narrow role for the hub instance
    // -----------------------------------------------------------------------
    const hubRole = new iam.Role(this, 'HubRole', {
      roleName: 'pegasus-wireguard-hub',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'WireGuard hub instance - SSM session, keys, CloudWatch, Route 53 PHZ writes',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    })
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: hubPrivKeyParam.replace(/^\//, ''),
          }),
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: hubPubKeyParam.replace(/^\//, ''),
          }),
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: 'pegasus/wireguard/agent/*',
          }),
        ],
      }),
    )
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': 'PegasusWireGuard' },
        },
      }),
    )

    // -----------------------------------------------------------------------
    // Private hosted zone - per-tenant overlay CNAMEs
    // -----------------------------------------------------------------------
    const phz = new route53.PrivateHostedZone(this, 'VpnPhz', {
      zoneName: phzName,
      vpc,
      comment: 'WireGuard overlay - <tenantId>.vpn.pegasus.internal -> 10.200.<N>.1',
    })
    this.privateHostedZone = phz
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [phz.hostedZoneArn],
      }),
    )

    // -----------------------------------------------------------------------
    // Agent artifacts bucket - CI uploads agent tarballs here, hub downloads.
    // -----------------------------------------------------------------------
    const agentBucket = new s3.Bucket(this, 'AgentArtifactsBucket', {
      bucketName: `pegasus-vpn-agent-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Keep recent tarballs for rollback; expire older noncurrent versions.
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
    })
    this.agentArtifactsBucket = agentBucket
    agentBucket.grantRead(hubRole)
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: agentTarballUriParam.replace(/^\//, ''),
          }),
        ],
      }),
    )

    // -----------------------------------------------------------------------
    // EIP - the hub's stable public address
    // -----------------------------------------------------------------------
    const eip = new ec2.CfnEIP(this, 'HubEip', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: 'pegasus-wireguard-hub' }],
    })
    this.hubEip = eip
    this.hubEndpoint = `${eip.ref}:51820`

    // -----------------------------------------------------------------------
    // Custom Resource - bootstrap the hub keypair idempotently.
    //
    // On first deploy the Lambda generates a clamped X25519 scalar (same
    // 32-byte shape `wg genkey` outputs), writes both halves to SSM, and
    // returns the public key as a CR Data attribute. On re-deploy it sees
    // the params already exist and just returns the current public key -
    // no regeneration. Delete is a noop; the retained SSM params mean
    // `cdk destroy` + redeploy does not invalidate tenant client.confs.
    // -----------------------------------------------------------------------
    // Explicit log group so retention is set without the deprecated
    // `logRetention` custom-resource Lambda. RETAIN preserves the audit
    // trail of bootstrap invocations across stack recreations.
    const keyBootstrapFnLogGroup = new logs.LogGroup(this, 'HubKeyBootstrapFnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    const keyBootstrapFn = new nodejs.NodejsFunction(this, 'HubKeyBootstrapFn', {
      entry: path.join(__dirname, 'wireguard-key-bootstrap.handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: keyBootstrapFnLogGroup,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    })
    keyBootstrapFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: hubPrivKeyParam.replace(/^\//, ''),
          }),
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: hubPubKeyParam.replace(/^\//, ''),
          }),
        ],
      }),
    )

    const keyProviderLogGroup = new logs.LogGroup(this, 'HubKeyBootstrapProviderLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    const keyProvider = new customResources.Provider(this, 'HubKeyBootstrapProvider', {
      onEventHandler: keyBootstrapFn,
      logGroup: keyProviderLogGroup,
    })

    const keyBootstrap = new cdk.CustomResource(this, 'HubKeyBootstrap', {
      serviceToken: keyProvider.serviceToken,
      properties: {
        PrivateKeyParameterName: hubPrivKeyParam,
        PublicKeyParameterName: hubPubKeyParam,
      },
    })
    // The SSM params this CR writes must survive stack deletion so destroying
    // the stack does not silently invalidate every tenant's client.conf.
    keyBootstrap.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)
    this.hubPublicKey = keyBootstrap.getAttString('PublicKey')

    // -----------------------------------------------------------------------
    // Custom Resource - bootstrap the agent's M2M API key.
    //
    // The agent authenticates against the admin API with a token of shape
    // `vnd_<48 hex>`, sent as a Bearer header. The API verifies it by hashing
    // the incoming token with SHA-256 and comparing against the value stored
    // at /pegasus/wireguard/agent/apikey-hash - no DB row required, since
    // this is platform-level M2M that doesn't belong to any tenant. See the
    // platform-key path in apps/api/src/middleware/api-client-auth.ts.
    //
    // First deploy: generates plaintext + hash, writes both. Re-deploy: reuses
    // any existing plaintext (preserves a running agent's credential) and
    // refreshes the hash from it. Delete: noop, both params retained.
    // -----------------------------------------------------------------------
    const agentKeyBootstrapFnLogGroup = new logs.LogGroup(this, 'AgentKeyBootstrapFnLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    const agentKeyBootstrapFn = new nodejs.NodejsFunction(this, 'AgentKeyBootstrapFn', {
      entry: path.join(__dirname, 'wireguard-agent-key-bootstrap.handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: agentKeyBootstrapFnLogGroup,
      bundling: {
        externalModules: ['@aws-sdk/*'],
      },
    })
    agentKeyBootstrapFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:PutParameter'],
        resources: [
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: agentApiKeyParam.replace(/^\//, ''),
          }),
          cdk.Stack.of(this).formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: agentApiKeyHashParam.replace(/^\//, ''),
          }),
        ],
      }),
    )

    const agentKeyProviderLogGroup = new logs.LogGroup(this, 'AgentKeyBootstrapProviderLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })
    const agentKeyProvider = new customResources.Provider(this, 'AgentKeyBootstrapProvider', {
      onEventHandler: agentKeyBootstrapFn,
      logGroup: agentKeyProviderLogGroup,
    })

    const agentKeyBootstrap = new cdk.CustomResource(this, 'AgentKeyBootstrap', {
      serviceToken: agentKeyProvider.serviceToken,
      properties: {
        ApiKeyParameterName: agentApiKeyParam,
        ApiKeyHashParameterName: agentApiKeyHashParam,
      },
    })
    agentKeyBootstrap.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN)
    this.agentApiKeyHashParameterName = agentApiKeyHashParam

    // -----------------------------------------------------------------------
    // Cloud-init - install wireguard-tools, template wg0.conf from SSM,
    // enable the tunnel + the pegasus-vpn-agent reconcile daemon.
    //
    // The agent source lives in apps/vpn-agent. The `publish-vpn-agent` CI
    // workflow builds the tarball, uploads it to the agent artifacts bucket,
    // and writes the resulting S3 URI to SSM at `agentTarballUriParam`. The
    // hub reads that param at boot and pulls the tarball. If the param is
    // not set yet, the hub boots with the tunnel but without the agent -
    // peer reconciliation is deferred until the URI appears.
    // -----------------------------------------------------------------------
    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      'set -euxo pipefail',
      'dnf update -y',
      'dnf install -y wireguard-tools chrony aws-cli nodejs20 tar',
      'systemctl enable --now chronyd',
      // Resolve hub privkey. Bash's `set -e` does NOT abort on a failed
      // command substitution in an assignment, so we read into a variable
      // explicitly with a guard to make a missing/inaccessible param fatal.
      'HUB_PRIVKEY=""',
      `HUB_PRIVKEY=$(aws ssm get-parameter --name ${hubPrivKeyParam} --with-decryption --query 'Parameter.Value' --output text --region ${this.region})`,
      '[ -n "$HUB_PRIVKEY" ] || { echo "FATAL: hub privkey SSM param is empty or unreadable" >&2; exit 1; }',
      'mkdir -p /etc/wireguard',
      'umask 077',
      // PostUp: install the kernel route that tells the hub "to reach the
      // tenant overlay range (10.200.0.0/16), send via wg0". Without this
      // the hub's wg0 only owns 10.10.200.0/24 (its own /24), and any packet
      // destined for a tenant IP falls through to the VPC default gateway —
      // i.e. silently leaks out ens5. The two-subnet design (hub on
      // 10.10.200.0/24, tenants on 10.200.0.0/16) is intentional, but the
      // hub kernel doesn't infer the cross-subnet route from WG's cryptokey
      // routing alone, so we install it explicitly. PostDown undoes it so
      // wg-quick teardown stays clean.
      'cat > /etc/wireguard/wg0.conf <<EOF',
      '[Interface]',
      'Address    = 10.10.200.1/24',
      'ListenPort = 51820',
      'PrivateKey = $HUB_PRIVKEY',
      'MTU        = 1380',
      'PostUp     = ip route replace 10.200.0.0/16 dev %i',
      'PostDown   = ip route del 10.200.0.0/16 dev %i 2>/dev/null || true',
      'EOF',
      'chmod 600 /etc/wireguard/wg0.conf',
      // Enable IPv4 forwarding so the kernel can route between tunnel and API SG peers.
      "echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-wireguard.conf",
      'sysctl -p /etc/sysctl.d/99-wireguard.conf',
      'systemctl enable --now wg-quick@wg0',
      // Verify the cross-subnet kernel route landed. The wg0.conf PostUp
      // installs `10.200.0.0/16 dev wg0` so the hub can reach tenant
      // overlay IPs (which live in a different /16 from the hub's /24).
      // Without this route the kernel falls through to the VPC default
      // gateway and silently leaks tenant-bound packets out ens5. We hit
      // exactly that bug in prod once already; fail boot loudly if the
      // route didn't take so we never inherit the same blackhole again.
      'ip route show 10.200.0.0/16 2>/dev/null | grep -q wg0 || { echo "FATAL: wg-quick did not install the 10.200.0.0/16 → wg0 route — check wg0.conf PostUp" >&2; exit 1; }',
      // Reconcile agent - install and start. Missing apikey or missing
      // tarball URI is fatal: an instance without the agent silently drifts
      // from the desired peer set, which is exactly the failure mode that
      // motivated this hardening.
      'mkdir -p /opt/pegasus-vpn-agent /etc/pegasus',
      'chmod 700 /etc/pegasus',
      'AGENT_APIKEY=""',
      `AGENT_APIKEY=$(aws ssm get-parameter --name /pegasus/wireguard/agent/apikey --with-decryption --query 'Parameter.Value' --output text --region ${this.region})`,
      '[ -n "$AGENT_APIKEY" ] || { echo "FATAL: /pegasus/wireguard/agent/apikey SSM param is empty or unreadable - WireGuardStack AgentKeyBootstrap custom resource should have created it on deploy" >&2; exit 1; }',
      // Admin API URL: ApiStack writes this on its own deploy. Required so
      // the agent polls the right endpoint - the previous default of a
      // hard-coded production hostname routed to a different service and
      // silently corrupted reconcile.
      ...(props.adminApiUrl
        ? [`ADMIN_API_URL=${props.adminApiUrl}`]
        : [
            'ADMIN_API_URL=""',
            `ADMIN_API_URL=$(aws ssm get-parameter --name ${adminApiUrlParam} --query 'Parameter.Value' --output text --region ${this.region})`,
            `[ -n "$ADMIN_API_URL" ] || { echo "FATAL: ${adminApiUrlParam} SSM param is empty - ApiStack must deploy at least once before the hub can boot" >&2; exit 1; }`,
          ]),
      // Resolve our own instance-id early so the agent can include it in
      // /etc/pegasus/agent.env for the HubEipAssociated metric. The EIP
      // allocation id is hard-baked from the CDK construct ID.
      'TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")',
      'INSTANCE_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
      '[ -n "$INSTANCE_ID" ] || { echo "FATAL: could not read instance-id from IMDSv2" >&2; exit 1; }',
      'cat > /etc/pegasus/agent.env <<EOF',
      'ADMIN_API_URL=$ADMIN_API_URL',
      'AGENT_API_KEY=$AGENT_APIKEY',
      `AWS_REGION=${this.region}`,
      'TICK_SECS=30',
      `HUB_EIP_ALLOCATION_ID=${eip.attrAllocationId}`,
      'HUB_INSTANCE_ID=$INSTANCE_ID',
      'EOF',
      'chmod 600 /etc/pegasus/agent.env',
      // Install the agent tarball. The S3 URI comes from SSM so CI can bump
      // it between deploys without a stack update. Missing tarball URI is
      // fatal - the agent must run; without it, hub state silently drifts
      // from the database.
      'AGENT_TARBALL_URI=""',
      `AGENT_TARBALL_URI=$(aws ssm get-parameter --name ${agentTarballUriParam} --query 'Parameter.Value' --output text --region ${this.region})`,
      '[ -n "$AGENT_TARBALL_URI" ] || { echo "FATAL: agent tarball SSM param is empty - publish via .github/workflows/publish-vpn-agent.yml" >&2; exit 1; }',
      'aws s3 cp "$AGENT_TARBALL_URI" /tmp/vpn-agent.tgz',
      'tar -xzf /tmp/vpn-agent.tgz -C /opt/pegasus-vpn-agent --strip-components=1',
      '(cd /opt/pegasus-vpn-agent && npm install --omit=dev)',
      'cp /opt/pegasus-vpn-agent/systemd/pegasus-vpn-agent.service /etc/systemd/system/',
      'systemctl daemon-reload',
      'systemctl enable --now pegasus-vpn-agent.service',
      // Elastic IP association via AWS CLI. INSTANCE_ID was already resolved
      // above for the agent.env. Retried with backoff because the API is
      // occasionally rate-limited when several stacks come up simultaneously,
      // and a silent skip here leaves the hub orphaned from its EIP -
      // tenants then can't connect.
      'EIP_OK=0',
      'for attempt in 1 2 3 4 5 6 7 8 9 10; do',
      `  if aws ec2 associate-address --region ${this.region} --instance-id "$INSTANCE_ID" --allocation-id ${eip.attrAllocationId} --allow-reassociation; then`,
      '    EIP_OK=1; break',
      '  fi',
      '  echo "associate-address attempt $attempt failed; retrying in 3s" >&2',
      '  sleep 3',
      'done',
      '[ "$EIP_OK" = "1" ] || { echo "FATAL: could not associate EIP after 10 attempts" >&2; exit 1; }',
      // Disable source/dest check so the hub can forward overlay packets
      // arriving from the tunnel proxy Lambda (NAT-instance-style).
      `aws ec2 modify-instance-attribute --region ${this.region} --instance-id "$INSTANCE_ID" --source-dest-check '{"Value":false}'`,
      // Point the private-lambda subnets' route tables at this instance for
      // the 10.200.0.0/16 overlay. On first boot `create-route` wins; on
      // replacement `replace-route` wins - try both to stay idempotent.
      `VPC_ID=${vpc.vpcId}`,
      'for RT_ID in $(aws ec2 describe-route-tables' +
        ` --region ${this.region}` +
        ' --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:pegasus:subnet-role,Values=private-lambda"' +
        " --query 'RouteTables[*].RouteTableId' --output text); do",
      `  aws ec2 create-route --region ${this.region} --route-table-id "$RT_ID" --destination-cidr-block 10.200.0.0/16 --instance-id "$INSTANCE_ID" 2>/dev/null || \\`,
      `    aws ec2 replace-route --region ${this.region} --route-table-id "$RT_ID" --destination-cidr-block 10.200.0.0/16 --instance-id "$INSTANCE_ID"`,
      'done',
    )

    // IAM for lifecycle self-setup on ASG replacement. Scoped tight: the hub
    // may re-associate its own EIP, flip its own source/dest check, describe
    // route tables, modify the overlay route, and read its own EIP
    // association status (DescribeAddresses, used by the agent's
    // HubEipAssociated metric). No broader ec2:*.
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:AssociateAddress',
          'ec2:ModifyInstanceAttribute',
          'ec2:DescribeRouteTables',
          'ec2:CreateRoute',
          'ec2:ReplaceRoute',
          'ec2:DescribeAddresses',
        ],
        resources: ['*'],
      }),
    )

    // -----------------------------------------------------------------------
    // ASG - one t4g.nano ARM hub, AL2023
    //
    // AWS retired AWS::AutoScaling::LaunchConfiguration for new accounts in
    // late 2023 ("The Launch Configuration creation operation is not available
    // in your account. Use launch templates..."), so the instance shape lives
    // on an ec2.LaunchTemplate. The ASG only carries the capacity + subnet
    // placement; everything else - AMI, instance type, IAM role, SG, user-data,
    // block devices, public-IP association - is on the LT.
    // -----------------------------------------------------------------------
    const launchTemplate = new ec2.LaunchTemplate(this, 'HubLaunchTemplate', {
      launchTemplateName: 'pegasus-wireguard-hub',
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64',
        { os: ec2.OperatingSystemType.LINUX },
      ),
      securityGroup: hubSg,
      role: hubRole,
      userData,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      associatePublicIpAddress: true,
    })

    const asg = new autoscaling.AutoScalingGroup(this, 'HubAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      launchTemplate,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      // Roll the instance whenever the LaunchTemplate version changes (i.e.
      // any userdata edit). Without this, CDK updates the LT but leaves the
      // running instance on the old version — userdata fixes silently sit
      // dormant until something else replaces the box. minInstancesInService
      // is 0 because the hub owns the EIP exclusively: AWS won't let two
      // instances hold the same EIP, so we must fully terminate the old
      // hub before launching the new one. Outage is ~2–3 min while the new
      // instance boots, runs userdata, and the on-prem peers re-handshake
      // (PersistentKeepalive=25 in the tenant config drives that).
      // pauseTime is the upper bound CFN waits for the instance to reach
      // InService before continuing — userdata typically finishes in <3 min;
      // 10 min is a safe ceiling for cold dnf installs.
      updatePolicy: autoscaling.UpdatePolicy.rollingUpdate({
        maxBatchSize: 1,
        minInstancesInService: 0,
        pauseTime: cdk.Duration.minutes(10),
        waitOnResourceSignals: false,
      }),
    })
    cdk.Tags.of(asg).add('Name', 'pegasus-wireguard-hub')
    this.hubAsgName = asg.autoScalingGroupName

    // -----------------------------------------------------------------------
    // Tunnel-proxy Lambda - the data-plane hop that lets the main (public)
    // API Lambda reach tenant overlay IPs without itself being VPC-attached.
    //
    // Lives in the private-lambda subnets so its only network egress is via
    // the 10.200.0.0/16 → hub route the cloud-init above maintains. No NAT,
    // no interface endpoints - strictly zero ongoing infra cost.
    //
    // CloudWatch Logs from this Lambda will NOT publish (no network path
    // to the logs endpoint). That's accepted tradeoff for the $0 cost
    // target; invocation metrics (count, duration, errors) still work
    // because Lambda's control plane reports them. Adding a CloudWatch
    // Logs interface endpoint (~$7/mo) later would restore log output.
    // -----------------------------------------------------------------------
    const proxySg = new ec2.SecurityGroup(this, 'TunnelProxySg', {
      vpc,
      securityGroupName: 'pegasus-wireguard-tunnel-proxy',
      description: 'Tunnel-proxy Lambda - egress only (to tenant overlay IPs via hub).',
      allowAllOutbound: true,
    })
    // Allow the tunnel-proxy Lambda to reach the hub ENI on any port. The
    // VPC route table already directs 10.200.0.0/16 → hub instance, but AWS
    // Security Groups also evaluate inbound traffic at the destination ENI
    // before it reaches the OS — including traffic that the host is only
    // forwarding. Without this rule, every TCP SYN from the Lambda gets
    // silently dropped at the hub ENI: tcpdump on the hub sees nothing,
    // wg0 stays quiet on the tenant-bound side, and the tunnel-proxy
    // times out at 10s. The Lambda's egress is already allow-all by
    // default; the missing piece is hub-side ingress acceptance.
    hubSg.addIngressRule(
      proxySg,
      ec2.Port.allTraffic(),
      'Tunnel-proxy Lambda to hub ENI (forwarded onto wg0 for tenant overlays)',
    )

    const tunnelProxyFn = new nodejs.NodejsFunction(this, 'TunnelProxyFn', {
      entry: path.join(__dirname, '../../../../apps/tunnel-proxy/src/index.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySg],
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    })
    this.tunnelProxyFunction = tunnelProxyFn

    // -----------------------------------------------------------------------
    // SNS topic for alarms + CloudWatch alarms
    // -----------------------------------------------------------------------
    const alertsTopic = new sns.Topic(this, 'AlertsTopic', {
      topicName: 'pegasus-wireguard-alerts',
      displayName: 'Pegasus WireGuard alerts',
    })
    this.alertsTopic = alertsTopic

    const statusCheckFailedAlarm = new cloudwatch.Alarm(this, 'HubStatusCheckFailedAlarm', {
      alarmName: 'pegasus-wireguard-hub-status-check-failed',
      alarmDescription: 'Hub instance EC2 status check has failed - ASG is replacing it.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/EC2',
        metricName: 'StatusCheckFailed',
        dimensionsMap: { AutoScalingGroupName: asg.autoScalingGroupName },
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    statusCheckFailedAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    const reconcileLagAlarm = new cloudwatch.Alarm(this, 'HubReconcileLagAlarm', {
      alarmName: 'pegasus-wireguard-reconcile-lag',
      alarmDescription:
        'HubReconcileLagSeconds > 120 for 5 min - agent is not polling the admin API.',
      metric: new cloudwatch.Metric({
        namespace: 'PegasusWireGuard',
        metricName: 'HubReconcileLagSeconds',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 120,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    reconcileLagAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    const handshakeAgeAlarm = new cloudwatch.Alarm(this, 'HandshakeAgeAlarm', {
      alarmName: 'pegasus-wireguard-handshake-stale',
      alarmDescription:
        'HandshakeAgeMaxSeconds > 180 for 5 min - at least one ACTIVE peer has stopped handshaking.',
      metric: new cloudwatch.Metric({
        namespace: 'PegasusWireGuard',
        metricName: 'HandshakeAgeMaxSeconds',
        statistic: 'Maximum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 180,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    handshakeAgeAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    // ---- Agent liveness: AgentHeartbeat is emitted every tick (~30s). If
    // the agent process dies or can't reach CloudWatch, no datapoints land
    // and the alarm flips to ALARM via missing-data treatment.
    const agentHeartbeatAlarm = new cloudwatch.Alarm(this, 'AgentHeartbeatAlarm', {
      alarmName: 'pegasus-wireguard-agent-down',
      alarmDescription:
        'AgentHeartbeat missing for >5 min - the reconcile agent process is not running.',
      metric: new cloudwatch.Metric({
        namespace: 'PegasusWireGuard',
        metricName: 'AgentHeartbeat',
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    agentHeartbeatAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    // ---- EIP association: agent emits 1 when its instance currently holds
    // the hub EIP, 0 if a manual operator action or AWS-side change has
    // detached it. Below 1 for 5 min => alarm.
    const eipAssociatedAlarm = new cloudwatch.Alarm(this, 'HubEipAssociatedAlarm', {
      alarmName: 'pegasus-wireguard-eip-detached',
      alarmDescription:
        'HubEipAssociated < 1 for 5 min - the hub instance is not the current holder of the EIP. Tenants will fail to connect.',
      metric: new cloudwatch.Metric({
        namespace: 'PegasusWireGuard',
        metricName: 'HubEipAssociated',
        statistic: 'Minimum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      // Missing data is "not breaching" so this alarm stays quiet on
      // envs where HUB_EIP_ALLOCATION_ID/HUB_INSTANCE_ID are unset.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    eipAssociatedAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    // ---- Peer count drift: kernel peer count diverges from desired
    // (ACTIVE + PENDING) for >10 min. Uses a metric-math expression so
    // we don't have to add yet another emitted metric.
    const kernelPeersMetric = new cloudwatch.Metric({
      namespace: 'PegasusWireGuard',
      metricName: 'KernelPeers',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    })
    const activePeersMetric = new cloudwatch.Metric({
      namespace: 'PegasusWireGuard',
      metricName: 'ActivePeers',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    })
    const pendingPeersMetric = new cloudwatch.Metric({
      namespace: 'PegasusWireGuard',
      metricName: 'PendingPeers',
      statistic: 'Maximum',
      period: cdk.Duration.minutes(1),
    })
    const peerDriftMetric = new cloudwatch.MathExpression({
      // Absolute drift between kernel-observed and desired (active+pending)
      // peer counts. 0 in steady state.
      expression: 'ABS(kernel - (active + pending))',
      usingMetrics: {
        kernel: kernelPeersMetric,
        active: activePeersMetric,
        pending: pendingPeersMetric,
      },
      period: cdk.Duration.minutes(1),
      label: 'PeerCountDrift',
    })
    const peerDriftAlarm = new cloudwatch.Alarm(this, 'HubPeerCountDriftAlarm', {
      alarmName: 'pegasus-wireguard-peer-drift',
      alarmDescription:
        'Kernel peer count diverged from desired (ACTIVE+PENDING) for >10 min. Reconcile is stuck or losing writes.',
      metric: peerDriftMetric,
      threshold: 0,
      evaluationPeriods: 10,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    peerDriftAlarm.addAlarmAction(new cwActions.SnsAction(alertsTopic))

    // -----------------------------------------------------------------------
    // CloudFormation outputs - consumed by the admin API (hub endpoint +
    // public key injection) and ops runbooks.
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'HubEipAddress', {
      value: eip.ref,
      description: 'Public IP of the WireGuard hub - embed in tenant client.conf Endpoint.',
      exportName: 'PegasusWireGuardHubEip',
    })
    new cdk.CfnOutput(this, 'VpcId', { value: vpc.vpcId, exportName: 'PegasusWireGuardVpcId' })
    new cdk.CfnOutput(this, 'HubSecurityGroupId', {
      value: hubSg.securityGroupId,
      exportName: 'PegasusWireGuardHubSgId',
    })
    new cdk.CfnOutput(this, 'AlertsTopicArn', {
      value: alertsTopic.topicArn,
      exportName: 'PegasusWireGuardAlertsTopicArn',
    })
    new cdk.CfnOutput(this, 'PrivateHostedZoneId', {
      value: phz.hostedZoneId,
      exportName: 'PegasusWireGuardPhzId',
    })
    new cdk.CfnOutput(this, 'AgentArtifactsBucketName', {
      value: agentBucket.bucketName,
      description: 'Bucket the publish-vpn-agent workflow uploads tarballs into.',
      exportName: 'PegasusWireGuardAgentBucket',
    })
    new cdk.CfnOutput(this, 'AgentTarballUriParameterName', {
      value: agentTarballUriParam,
      description: 'SSM param holding the current agent tarball S3 URI.',
      exportName: 'PegasusWireGuardAgentTarballParam',
    })
    new cdk.CfnOutput(this, 'HubAsgName', {
      value: asg.autoScalingGroupName,
      description: 'ASG name - pass to `aws autoscaling start-instance-refresh` in CI.',
      exportName: 'PegasusWireGuardHubAsgName',
    })
    new cdk.CfnOutput(this, 'AgentApiKeyHashParameterName', {
      value: agentApiKeyHashParam,
      description: 'SSM param holding the SHA-256 hash of the agent API key.',
      exportName: 'PegasusWireGuardAgentApiKeyHashParam',
    })
    new cdk.CfnOutput(this, 'HubPublicKey', {
      value: this.hubPublicKey,
      description: 'Base64 hub public key - embedded in tenant client.conf as Peer.PublicKey.',
      exportName: 'PegasusWireGuardHubPublicKey',
    })
    new cdk.CfnOutput(this, 'HubEndpoint', {
      value: this.hubEndpoint,
      description:
        'Tenant-facing endpoint (EIP:51820) - embedded in tenant client.conf as Peer.Endpoint.',
      exportName: 'PegasusWireGuardHubEndpoint',
    })
    new cdk.CfnOutput(this, 'TunnelProxyFunctionArn', {
      value: tunnelProxyFn.functionArn,
      description:
        'Tunnel-proxy Lambda ARN - the main API Lambda invokes this to reach tenant overlay IPs.',
      exportName: 'PegasusWireGuardTunnelProxyFnArn',
    })
  }
}
