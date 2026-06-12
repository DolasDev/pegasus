import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { WireGuardStack } from '../wireguard-stack'

function synth(): Template {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const stack = new WireGuardStack(app, 'TestWireGuard', {
    env: { account: '111111111111', region: 'us-east-1' },
  })
  return Template.fromStack(stack)
}

describe('WireGuardStack — networking', () => {
  it('creates a VPC with the 10.10.0.0/16 CIDR', () => {
    synth().hasResourceProperties('AWS::EC2::VPC', {
      CidrBlock: '10.10.0.0/16',
    })
  })

  it('creates public, private-isolated, and temporal-worker-egress subnets', () => {
    const template = synth()
    // Phase-2 Unit 4 expansion: 2 AZs × 3 subnet groups = 6 subnets total.
    //   - hub-public (×2): unchanged, hub lives here, has its own IGW route
    //   - private-lambda (×2, PRIVATE_ISOLATED): tunnel-proxy + mssql-executor
    //   - temporal-worker-egress (×2, PRIVATE_WITH_EGRESS): Fargate worker,
    //     consumed by TemporalWorkerStack
    template.resourceCountIs('AWS::EC2::Subnet', 6)
    template.hasResourceProperties('AWS::EC2::Subnet', {
      MapPublicIpOnLaunch: true,
    })
  })

  it('creates exactly one NAT Gateway (for the Phase-2 temporal-worker subnets — the hub keeps its own public ENI route)', () => {
    // Pre-Phase-2 this asserted zero NAT Gateways. Phase 2 Unit 4 added a
    // PRIVATE_WITH_EGRESS subnet for the Temporal Cloud Fargate worker
    // (apps/temporal-worker), which requires NAT egress. The hub does NOT
    // route through the NAT — it lives in hub-public and uses its own IGW
    // route — so the original "hub uses its own public ENI" intent is
    // preserved by holding the count at exactly 1 (one NAT, never two).
    synth().resourceCountIs('AWS::EC2::NatGateway', 1)
  })
})

describe('WireGuardStack — hub security group', () => {
  it('allows UDP 51820 ingress from anywhere', () => {
    synth().hasResourceProperties('AWS::EC2::SecurityGroup', {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({
          IpProtocol: 'udp',
          FromPort: 51820,
          ToPort: 51820,
          CidrIp: '0.0.0.0/0',
        }),
      ]),
    })
  })
})

describe('WireGuardStack — EC2 hub', () => {
  it('creates the hub EIP plus the NAT Gateway EIP', () => {
    // Pre-Phase-2 this asserted exactly 1 EIP (the hub's). Phase 2 Unit 4
    // added a NAT Gateway for the temporal-worker subnets, which CDK
    // automatically allocates its own EIP for, so the total is now 2. The
    // hub still owns its own stable EIP (tagged `pegasus-wireguard-hub`,
    // verified in the next assertion) and is the one tenants embed in
    // client.conf; the NAT EIP is purely an outbound NAT public address
    // for the Fargate worker.
    synth().resourceCountIs('AWS::EC2::EIP', 2)
  })

  it('still creates the named pegasus-wireguard-hub EIP (Phase 2 NAT EIP is additive, not a replacement)', () => {
    synth().hasResourceProperties('AWS::EC2::EIP', {
      Tags: Match.arrayWith([Match.objectLike({ Key: 'Name', Value: 'pegasus-wireguard-hub' })]),
    })
  })

  it('creates an ASG sized 1/1/1', () => {
    synth().hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '1',
      MaxSize: '1',
      DesiredCapacity: '1',
    })
  })

  it('uses a t4g.nano launch template (not a LaunchConfiguration)', () => {
    const template = synth()
    // AWS retired AWS::AutoScaling::LaunchConfiguration for new accounts in
    // late 2023; the hub must use AWS::EC2::LaunchTemplate instead.
    template.resourceCountIs('AWS::AutoScaling::LaunchConfiguration', 0)
    template.hasResourceProperties('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: Match.objectLike({
        InstanceType: 't4g.nano',
      }),
    })
    template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      LaunchTemplate: Match.objectLike({
        LaunchTemplateId: Match.anyValue(),
        Version: Match.anyValue(),
      }),
    })
  })
})

describe('WireGuardStack — IAM', () => {
  it('grants SSM Session Manager access (AmazonSSMManagedInstanceCore)', () => {
    synth().hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: 'ec2.amazonaws.com' },
          }),
        ]),
      }),
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('AmazonSSMManagedInstanceCore')]),
          ]),
        }),
      ]),
    })
  })

  it('grants narrow SSM read on the hub key parameters (not ssm:*)', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ssm:GetParameter']),
          }),
        ]),
      }),
    })
  })

  it('grants CloudWatch PutMetricData scoped to the PegasusWireGuard namespace', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Condition: Match.objectLike({
              StringEquals: { 'cloudwatch:namespace': 'PegasusWireGuard' },
            }),
          }),
        ]),
      }),
    })
  })
})

describe('WireGuardStack — key bootstrap', () => {
  it('creates Lambda-backed Custom Resources for the hub keypair AND the agent apikey', () => {
    const template = synth()
    // Two user handlers: hub key bootstrap + agent apikey bootstrap. The
    // Provider framework also synthesises infrastructure Lambdas for each.
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 2)
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      PrivateKeyParameterName: '/pegasus/wireguard/hub/privkey',
      PublicKeyParameterName: '/pegasus/wireguard/hub/pubkey',
    })
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      ApiKeyParameterName: '/pegasus/wireguard/agent/apikey',
      ApiKeyHashParameterName: '/pegasus/wireguard/agent/apikey-hash',
    })
  })

  it('grants the bootstrap Lambda narrow SSM access on the hub key paths only', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['ssm:GetParameter', 'ssm:PutParameter']),
          }),
        ]),
      }),
    })
  })

  it('retains both Custom Resources on stack deletion', () => {
    const template = synth().toJSON()
    const customResources = Object.values(template.Resources ?? {}).filter(
      (r): r is { Type: string; DeletionPolicy?: string; UpdateReplacePolicy?: string } =>
        typeof r === 'object' &&
        r !== null &&
        (r as { Type?: string }).Type === 'AWS::CloudFormation::CustomResource',
    )
    expect(customResources).toHaveLength(2)
    for (const r of customResources) {
      expect(r.DeletionPolicy).toBe('Retain')
      expect(r.UpdateReplacePolicy).toBe('Retain')
    }
  })

  it('exports the hub public key, endpoint, and agent apikey-hash param as CF outputs', () => {
    const template = synth().toJSON()
    const outputs = Object.keys(template.Outputs ?? {})
    expect(outputs).toContain('HubPublicKey')
    expect(outputs).toContain('HubEndpoint')
    expect(outputs).toContain('AgentApiKeyHashParameterName')
  })
})

describe('WireGuardStack — Route 53 + SNS', () => {
  it('creates the private hosted zone vpn.pegasus.internal', () => {
    synth().hasResourceProperties('AWS::Route53::HostedZone', {
      Name: 'vpn.pegasus.internal.',
    })
  })

  it('creates the pegasus-wireguard-alerts SNS topic', () => {
    synth().hasResourceProperties('AWS::SNS::Topic', {
      TopicName: 'pegasus-wireguard-alerts',
    })
  })
})

describe('WireGuardStack — agent artifacts', () => {
  it('creates a versioned S3 bucket with SSL enforced', () => {
    const template = synth()
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true }),
    })
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              Bool: { 'aws:SecureTransport': 'false' },
            }),
          }),
        ]),
      }),
    })
  })

  it('exports the bucket name, tarball SSM param, and ASG name', () => {
    const template = synth().toJSON()
    const outputs = Object.keys(template.Outputs ?? {})
    expect(outputs).toContain('AgentArtifactsBucketName')
    expect(outputs).toContain('AgentTarballUriParameterName')
    expect(outputs).toContain('HubAsgName')
  })
})

describe('WireGuardStack — tunnel proxy', () => {
  it('creates a Lambda attached to the VPC private-isolated subnets', () => {
    const template = synth()
    // Multiple Lambdas exist (key bootstrap, provider framework, proxy).
    // Assert a VPC-attached Lambda with our proxy handler exists.
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
        SecurityGroupIds: Match.anyValue(),
      }),
    })
  })

  it('exports the tunnel-proxy function ARN as a CF output', () => {
    const outputs = Object.keys(synth().toJSON().Outputs ?? {})
    expect(outputs).toContain('TunnelProxyFunctionArn')
  })

  it('grants the hub role the narrow EC2 perms needed for self-setup on ASG replace', () => {
    synth().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'ec2:AssociateAddress',
              'ec2:ModifyInstanceAttribute',
              'ec2:DescribeRouteTables',
              'ec2:CreateRoute',
              'ec2:ReplaceRoute',
            ]),
          }),
        ]),
      }),
    })
  })
})

describe('WireGuardStack — CloudWatch alarms', () => {
  it('creates the full alarm set', () => {
    // 3 original (status check, reconcile lag, handshake age)
    // + 3 new (agent heartbeat, EIP detached, peer drift)
    synth().resourceCountIs('AWS::CloudWatch::Alarm', 6)
  })

  it('routes the reconcile-lag alarm to the SNS topic', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-wireguard-reconcile-lag',
      // SnsAction serialises to a Ref → topic ARN; assert it's non-empty.
      AlarmActions: Match.anyValue(),
    })
  })

  it('alarms when the agent stops emitting AgentHeartbeat', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-wireguard-agent-down',
      MetricName: 'AgentHeartbeat',
      Namespace: 'PegasusWireGuard',
      ComparisonOperator: 'LessThanThreshold',
      TreatMissingData: 'breaching',
    })
  })

  it('alarms when the hub EIP is no longer associated with the hub instance', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-wireguard-eip-detached',
      MetricName: 'HubEipAssociated',
      Namespace: 'PegasusWireGuard',
      ComparisonOperator: 'LessThanThreshold',
    })
  })

  it('alarms when kernel peer count drifts from desired count', () => {
    // Metric-math alarm — assert the math expression references KernelPeers.
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-wireguard-peer-drift',
      Metrics: Match.arrayWith([
        Match.objectLike({
          Expression: Match.stringLikeRegexp('kernel'),
        }),
      ]),
    })
  })
})

describe('WireGuardStack — tenant-runner plane (Phase 3 Unit 9)', () => {
  it('enables VPC flow logs (ALL traffic) on both temporal-worker-egress subnets', () => {
    const template = synth()
    // One FlowLog per worker-egress subnet (2 AZs), each capturing ALL
    // traffic — Resolved decision #2: runners get open egress, flow logs
    // are the compensating audit control.
    template.resourceCountIs('AWS::EC2::FlowLog', 2)
    const flowLogs = template.findResources('AWS::EC2::FlowLog')
    for (const flowLog of Object.values(flowLogs)) {
      expect(flowLog.Properties?.ResourceType).toBe('Subnet')
      expect(flowLog.Properties?.TrafficType).toBe('ALL')
      expect(flowLog.Properties?.LogDestinationType ?? 'cloud-watch-logs').toBe('cloud-watch-logs')
    }
  })

  it('flow logs target the temporal-worker-egress subnets specifically', () => {
    const template = synth().toJSON() as {
      Resources?: Record<string, { Type: string; Properties?: { ResourceId?: { Ref?: string } } }>
    }
    const flowLogs = Object.values(template.Resources ?? {}).filter(
      (r) => r.Type === 'AWS::EC2::FlowLog',
    )
    for (const flowLog of flowLogs) {
      // The subnet refs must point at temporalworkeregress subnets, not the
      // hub-public or private-lambda groups.
      expect(flowLog.Properties?.ResourceId?.Ref ?? '').toMatch(/temporalworkeregress/i)
    }
  })

  it('retains the flow-log group for three months (audit trail, unnamed to avoid orphan collisions)', () => {
    const template = synth().toJSON() as {
      Resources?: Record<
        string,
        {
          Type: string
          DeletionPolicy?: string
          Properties?: { RetentionInDays?: number; LogGroupName?: string }
        }
      >
    }
    const groups = Object.entries(template.Resources ?? {}).filter(
      ([id, r]) => r.Type === 'AWS::Logs::LogGroup' && id.startsWith('TenantRunnerFlowLogGroup'),
    )
    expect(groups).toHaveLength(1)
    const [, group] = groups[0]!
    expect(group.Properties?.RetentionInDays).toBe(90)
    // Unnamed by design: a rollback-orphaned retained copy can never block a
    // retry with a name collision.
    expect(group.Properties?.LogGroupName).toBeUndefined()
    expect(group.DeletionPolicy).toBe('Retain')
  })

  it('creates the egress-only pegasus-tenant-runner security group (ASCII description)', () => {
    const template = synth()
    template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'pegasus-tenant-runner',
    })
    const sgs = template.findResources('AWS::EC2::SecurityGroup')
    const runnerSg = Object.values(sgs).find(
      (sg) => sg.Properties?.GroupName === 'pegasus-tenant-runner',
    )
    // Egress-only: no ingress rules at all.
    expect(runnerSg?.Properties?.SecurityGroupIngress).toBeUndefined()
    // eslint-disable-next-line no-control-regex
    expect(String(runnerSg?.Properties?.GroupDescription ?? '')).toMatch(/^[\x00-\x7F]*$/)
  })
})
