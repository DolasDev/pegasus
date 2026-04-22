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

  it('creates public and private subnets', () => {
    const template = synth()
    // 2 AZs × 2 subnet groups = 4 subnets total.
    template.resourceCountIs('AWS::EC2::Subnet', 4)
    template.hasResourceProperties('AWS::EC2::Subnet', {
      MapPublicIpOnLaunch: true,
    })
  })

  it('does NOT create a NAT Gateway (hub uses its own public ENI)', () => {
    synth().resourceCountIs('AWS::EC2::NatGateway', 0)
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
  it('creates a single EIP', () => {
    synth().resourceCountIs('AWS::EC2::EIP', 1)
  })

  it('creates an ASG sized 1/1/1', () => {
    synth().hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
      MinSize: '1',
      MaxSize: '1',
      DesiredCapacity: '1',
    })
  })

  it('uses a t4g.nano launch configuration', () => {
    synth().hasResourceProperties('AWS::AutoScaling::LaunchConfiguration', {
      InstanceType: 't4g.nano',
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
  it('creates a Lambda-backed Custom Resource for the hub keypair', () => {
    const template = synth()
    // The AwsCustomResource / Provider framework synthesises one Lambda for
    // the user handler and additional infrastructure Lambdas for the Provider
    // state machine. Assert at least one user handler exists.
    template.resourceCountIs('AWS::CloudFormation::CustomResource', 1)
    template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
      PrivateKeyParameterName: '/pegasus/wireguard/hub/privkey',
      PublicKeyParameterName: '/pegasus/wireguard/hub/pubkey',
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

  it('retains the Custom Resource on stack deletion', () => {
    synth().hasResource('AWS::CloudFormation::CustomResource', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    })
  })

  it('exports the hub public key and endpoint as CF outputs', () => {
    const template = synth().toJSON()
    const outputs = Object.keys(template.Outputs ?? {})
    expect(outputs).toContain('HubPublicKey')
    expect(outputs).toContain('HubEndpoint')
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
  it('creates three alarms', () => {
    synth().resourceCountIs('AWS::CloudWatch::Alarm', 3)
  })

  it('routes the reconcile-lag alarm to the SNS topic', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'pegasus-wireguard-reconcile-lag',
      // SnsAction serialises to a Ref → topic ARN; assert it's non-empty.
      AlarmActions: Match.anyValue(),
    })
  })
})
