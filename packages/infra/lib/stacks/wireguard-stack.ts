// ---------------------------------------------------------------------------
// WireGuardStack — the single-hub multi-tenant VPN plane.
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
// the agent — peers are still added/removed by manually running `wg set` or
// after the agent lands.
// ---------------------------------------------------------------------------

import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions'
import { type Construct } from 'constructs'

export interface WireGuardStackProps extends cdk.StackProps {
  /**
   * SSM parameter path holding the hub's base64 Curve25519 private key
   * (SecureString). Seeded once out of band — see §8 Phase 2 of the plan.
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
   * Base URL of the admin API the reconcile agent polls. Written into
   * /etc/pegasus/agent.env at boot. Defaults to the production hostname;
   * cross-stack callers should pass `apiStack.apiUrl` instead.
   */
  readonly adminApiUrl?: string
}

export class WireGuardStack extends cdk.Stack {
  /** VPC exposed for Lambdas that need to reach the hub. */
  public readonly vpc: ec2.IVpc

  /** Security group attached to the hub — Lambdas that need the tunnel egress to this SG on 443. */
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

  /** ASG name — used by CI to trigger an instance refresh after publishing a new agent. */
  public readonly hubAsgName: string

  constructor(scope: Construct, id: string, props: WireGuardStackProps = {}) {
    super(scope, id, props)

    const hubPrivKeyParam = props.hubPrivateKeyParameterName ?? '/pegasus/wireguard/hub/privkey'
    const hubPubKeyParam = props.hubPublicKeyParameterName ?? '/pegasus/wireguard/hub/pubkey'
    const phzName = props.privateHostedZoneName ?? 'vpn.pegasus.internal'
    const agentTarballUriParam = '/pegasus/wireguard/agent/tarball-uri'

    // -----------------------------------------------------------------------
    // VPC — 10.10.0.0/16 per plan §2
    // -----------------------------------------------------------------------
    // Two AZs declared but only AZ-a is used in v1. Hub is in a public subnet
    // (no NAT GW — its agent needs egress via its own public ENI per Q16).
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
          // PRIVATE_ISOLATED — no NAT egress; Lambdas that need public
          // egress for Cognito/Neon set their own routes via IGW when
          // attached.
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    })
    this.vpc = vpc
    this.privateLambdaSubnets = vpc.isolatedSubnets

    // -----------------------------------------------------------------------
    // Security groups
    // -----------------------------------------------------------------------
    const hubSg = new ec2.SecurityGroup(this, 'HubSg', {
      vpc,
      securityGroupName: 'pegasus-wireguard-hub',
      description: 'WireGuard hub — UDP 51820 ingress from tenants; 443 ingress from Lambdas',
      allowAllOutbound: true,
    })
    hubSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(51820),
      'WireGuard handshake/data from tenant servers (source IPs vary per tenant).',
    )
    this.hubSecurityGroup = hubSg

    // -----------------------------------------------------------------------
    // IAM — narrow role for the hub instance
    // -----------------------------------------------------------------------
    const hubRole = new iam.Role(this, 'HubRole', {
      roleName: 'pegasus-wireguard-hub',
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'WireGuard hub instance — SSM session, keys, CloudWatch, Route 53 PHZ writes',
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
    // Private hosted zone — per-tenant overlay CNAMEs
    // -----------------------------------------------------------------------
    const phz = new route53.PrivateHostedZone(this, 'VpnPhz', {
      zoneName: phzName,
      vpc,
      comment: 'WireGuard overlay — <tenantId>.vpn.pegasus.internal → 10.200.<N>.1',
    })
    this.privateHostedZone = phz
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['route53:ChangeResourceRecordSets'],
        resources: [phz.hostedZoneArn],
      }),
    )

    // -----------------------------------------------------------------------
    // Agent artifacts bucket — CI uploads agent tarballs here, hub downloads.
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
    // EIP — the hub's stable public address
    // -----------------------------------------------------------------------
    const eip = new ec2.CfnEIP(this, 'HubEip', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: 'pegasus-wireguard-hub' }],
    })
    this.hubEip = eip

    // -----------------------------------------------------------------------
    // Cloud-init — install wireguard-tools, template wg0.conf from SSM,
    // enable the tunnel + the pegasus-vpn-agent reconcile daemon.
    //
    // The agent source lives in apps/vpn-agent. The `publish-vpn-agent` CI
    // workflow builds the tarball, uploads it to the agent artifacts bucket,
    // and writes the resulting S3 URI to SSM at `agentTarballUriParam`. The
    // hub reads that param at boot and pulls the tarball. If the param is
    // not set yet, the hub boots with the tunnel but without the agent —
    // peer reconciliation is deferred until the URI appears.
    // -----------------------------------------------------------------------
    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      'set -euxo pipefail',
      'dnf update -y',
      'dnf install -y wireguard-tools chrony aws-cli nodejs20 tar',
      'systemctl enable --now chronyd',
      `HUB_PRIVKEY=$(aws ssm get-parameter --name ${hubPrivKeyParam} --with-decryption --query 'Parameter.Value' --output text --region ${this.region})`,
      'mkdir -p /etc/wireguard',
      'umask 077',
      'cat > /etc/wireguard/wg0.conf <<EOF',
      '[Interface]',
      'Address    = 10.10.200.1/24',
      'ListenPort = 51820',
      'PrivateKey = $HUB_PRIVKEY',
      'MTU        = 1380',
      'EOF',
      'chmod 600 /etc/wireguard/wg0.conf',
      // Enable IPv4 forwarding so the kernel can route between tunnel and API SG peers.
      "echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-wireguard.conf",
      'sysctl -p /etc/sysctl.d/99-wireguard.conf',
      'systemctl enable --now wg-quick@wg0',
      // Reconcile agent — install and start.
      'mkdir -p /opt/pegasus-vpn-agent /etc/pegasus',
      'chmod 700 /etc/pegasus',
      `AGENT_APIKEY=$(aws ssm get-parameter --name /pegasus/wireguard/agent/apikey --with-decryption --query 'Parameter.Value' --output text --region ${this.region})`,
      'cat > /etc/pegasus/agent.env <<EOF',
      `ADMIN_API_URL=${props.adminApiUrl ?? 'https://api.pegasusapp.com'}`,
      'AGENT_API_KEY=$AGENT_APIKEY',
      `AWS_REGION=${this.region}`,
      'TICK_SECS=30',
      'EOF',
      'chmod 600 /etc/pegasus/agent.env',
      // Install the agent tarball. The S3 URI comes from SSM so CI can bump
      // it between deploys without a stack update. Skipped cleanly when the
      // param is unset — the hub still carries the tunnel, just without
      // automatic peer reconciliation until CI publishes an agent.
      `AGENT_TARBALL_URI=$(aws ssm get-parameter --name ${agentTarballUriParam} --query 'Parameter.Value' --output text --region ${this.region} 2>/dev/null || echo '')`,
      'if [ -n "$AGENT_TARBALL_URI" ]; then',
      '  aws s3 cp "$AGENT_TARBALL_URI" /tmp/vpn-agent.tgz',
      '  tar -xzf /tmp/vpn-agent.tgz -C /opt/pegasus-vpn-agent --strip-components=1',
      '  (cd /opt/pegasus-vpn-agent && npm install --omit=dev)',
      '  cp /opt/pegasus-vpn-agent/systemd/pegasus-vpn-agent.service /etc/systemd/system/',
      '  systemctl daemon-reload',
      '  systemctl enable --now pegasus-vpn-agent.service',
      'fi',
      // Elastic IP association via AWS CLI — the instance ID comes from IMDSv2.
      'TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 60")',
      'INSTANCE_ID=$(curl -sH "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
      `aws ec2 associate-address --region ${this.region} --instance-id "$INSTANCE_ID" --allocation-id ${eip.attrAllocationId} --allow-reassociation || true`,
    )

    // Allow the hub to self-associate its EIP (replacement instances after ASG refresh).
    hubRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AssociateAddress'],
        resources: ['*'],
      }),
    )

    // -----------------------------------------------------------------------
    // ASG — one t4g.nano ARM hub, AL2023
    // -----------------------------------------------------------------------
    const asg = new autoscaling.AutoScalingGroup(this, 'HubAsg', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.fromSsmParameter(
        '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64',
        { os: ec2.OperatingSystemType.LINUX },
      ),
      securityGroup: hubSg,
      role: hubRole,
      userData,
      minCapacity: 1,
      maxCapacity: 1,
      desiredCapacity: 1,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: autoscaling.BlockDeviceVolume.ebs(8, {
            volumeType: autoscaling.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
      associatePublicIpAddress: true,
    })
    cdk.Tags.of(asg).add('Name', 'pegasus-wireguard-hub')
    this.hubAsgName = asg.autoScalingGroupName

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
      alarmDescription: 'Hub instance EC2 status check has failed — ASG is replacing it.',
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
        'HubReconcileLagSeconds > 120 for 5 min — agent is not polling the admin API.',
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
        'HandshakeAgeMaxSeconds > 180 for 5 min — at least one ACTIVE peer has stopped handshaking.',
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

    // -----------------------------------------------------------------------
    // CloudFormation outputs — consumed by the admin API (hub endpoint +
    // public key injection) and ops runbooks.
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'HubEipAddress', {
      value: eip.ref,
      description: 'Public IP of the WireGuard hub — embed in tenant client.conf Endpoint.',
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
      description: 'ASG name — pass to `aws autoscaling start-instance-refresh` in CI.',
      exportName: 'PegasusWireGuardHubAsgName',
    })
  }
}
