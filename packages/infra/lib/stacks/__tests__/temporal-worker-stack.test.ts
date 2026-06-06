import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { TemporalWorkerStack } from '../temporal-worker-stack'

/**
 * Helper: spin up a tiny app with a fresh VPC living in a sibling stack
 * and synthesise the TemporalWorkerStack against it. Mirrors the
 * "construct the cross-stack dep inline" trick used in api-stack.test.ts
 * (TestDocs sibling for DocumentsStack).
 *
 * NOTE: we use a plain `ec2.Vpc` here (not WireGuardStack) to keep the
 * test focused on the worker stack's own resources. The production
 * wiring passes `wireguardStack.temporalWorkerSubnets`; here we
 * construct an equivalent-shaped subnet list locally.
 */
function synth(): { template: Template; stack: TemporalWorkerStack } {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const networkStack = new cdk.Stack(app, 'TestNetwork', {
    env: { account: '111111111111', region: 'us-east-1' },
  })
  const vpc = new ec2.Vpc(networkStack, 'TestVpc', {
    maxAzs: 2,
    natGateways: 1,
    subnetConfiguration: [
      { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      {
        name: 'temporal-worker-egress',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        cidrMask: 24,
      },
    ],
  })
  const workerSubnets = vpc.selectSubnets({ subnetGroupName: 'temporal-worker-egress' }).subnets
  const stack = new TemporalWorkerStack(app, 'TestTemporalWorker', {
    env: { account: '111111111111', region: 'us-east-1' },
    vpc,
    workerSubnets,
    temporalNamespace: 'pegasus-staging',
    temporalAddress: 'pegasus-staging.chgel.tmprl.cloud:7233',
    temporalTaskQueue: 'pegasus-stdlib-staging',
    pegasusApiBaseUrl: 'https://api.pegasus-qa.dolas.dev',
    envName: 'staging',
  })
  return { template: Template.fromStack(stack), stack }
}

describe('TemporalWorkerStack — ECR repository', () => {
  it('creates exactly one ECR repository named pegasus-temporal-worker', () => {
    const { template } = synth()
    template.resourceCountIs('AWS::ECR::Repository', 1)
    template.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: 'pegasus-temporal-worker',
      ImageScanningConfiguration: { ScanOnPush: true },
    })
  })

  it('retains the ECR repo on stack delete (image loss would block Unit 5 rollback)', () => {
    const tmpl = synth().template.toJSON() as {
      Resources?: Record<string, { Type: string; DeletionPolicy?: string }>
    }
    const repo = Object.values(tmpl.Resources ?? {}).find(
      (r) => r.Type === 'AWS::ECR::Repository',
    )
    expect(repo?.DeletionPolicy).toBe('Retain')
  })

  it('keeps the most recent 20 images via a lifecycle policy', () => {
    const { template } = synth()
    template.hasResourceProperties('AWS::ECR::Repository', {
      LifecyclePolicy: Match.objectLike({
        LifecyclePolicyText: Match.stringLikeRegexp('"countNumber":\\s*20'),
      }),
    })
  })
})

describe('TemporalWorkerStack — ECS cluster + Fargate service', () => {
  it('creates exactly one ECS cluster', () => {
    synth().template.resourceCountIs('AWS::ECS::Cluster', 1)
  })

  it('creates exactly one Fargate task definition + service', () => {
    const { template } = synth()
    template.resourceCountIs('AWS::ECS::TaskDefinition', 1)
    template.resourceCountIs('AWS::ECS::Service', 1)
  })

  it('runs the service at desiredCount 1 (Unit 5 — image is now present in ECR)', () => {
    synth().template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 1,
      LaunchType: 'FARGATE',
    })
  })

  it('runs on Fargate with 512 CPU / 1024 MiB', () => {
    synth().template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Cpu: '512',
      Memory: '1024',
      RequiresCompatibilities: Match.arrayWith(['FARGATE']),
      NetworkMode: 'awsvpc',
    })
  })
})

describe('TemporalWorkerStack — networking', () => {
  it('creates a worker security group named pegasus-temporal-worker', () => {
    synth().template.hasResourceProperties('AWS::EC2::SecurityGroup', {
      GroupName: 'pegasus-temporal-worker',
    })
  })

  // Regression guard: EC2 rejects non-ASCII in SG GroupDescription with
  // "Character sets beyond ASCII are not supported" (an em-dash slipped in
  // on the first Unit-4 deploy and rolled back the staging stack — see
  // commits 7d5955b → fix). Synth-level check so we catch it before CFN.
  it('uses ASCII-only in the SecurityGroup description', () => {
    const sgs = synth().template.findResources('AWS::EC2::SecurityGroup')
    const descriptions = Object.values(sgs).map(
      (sg) => (sg as { Properties: { GroupDescription?: string } }).Properties.GroupDescription ?? '',
    )
    expect(descriptions.length).toBeGreaterThan(0)
    for (const desc of descriptions) {
      // eslint-disable-next-line no-control-regex
      expect(desc, `Non-ASCII in SG description: "${desc}"`).toMatch(/^[\x00-\x7F]*$/)
    }
  })

  it('attaches the service to the temporal-worker-egress subnets (no public IP)', () => {
    synth().template.hasResourceProperties('AWS::ECS::Service', {
      NetworkConfiguration: Match.objectLike({
        AwsvpcConfiguration: Match.objectLike({
          AssignPublicIp: 'DISABLED',
          // Subnet IDs are CDK tokens; just check they're present.
          Subnets: Match.anyValue(),
          SecurityGroups: Match.anyValue(),
        }),
      }),
    })
  })
})

describe('TemporalWorkerStack — container env vars', () => {
  it('sets the plain (non-secret) env vars on the container', () => {
    synth().template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'temporal-worker',
          Environment: Match.arrayWith([
            { Name: 'TEMPORAL_NAMESPACE', Value: 'pegasus-staging' },
            {
              Name: 'TEMPORAL_ADDRESS',
              Value: 'pegasus-staging.chgel.tmprl.cloud:7233',
            },
            { Name: 'TEMPORAL_TASK_QUEUE', Value: 'pegasus-stdlib-staging' },
            {
              Name: 'PEGASUS_API_BASE_URL',
              Value: 'https://api.pegasus-qa.dolas.dev',
            },
            { Name: 'ENV_NAME', Value: 'staging' },
          ]),
        }),
      ]),
    })
  })

  it('injects TEMPORAL_CLOUD_API_KEY from the apiKey JSON field of pegasus/{env}/temporal-cloud', () => {
    synth().template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'TEMPORAL_CLOUD_API_KEY',
              ValueFrom: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  Match.arrayWith([Match.stringLikeRegexp(':apiKey::')]),
                ]),
              }),
            }),
          ]),
        }),
      ]),
    })
  })

  it('injects WORKFLOW_BROKER_SECRET as a raw secret (no JSON path)', () => {
    // No `:apiKey::` suffix on this one — the broker secret is stored as
    // a raw string in Secrets Manager, so ecs.Secret.fromSecretsManager
    // is called without a fieldName.
    const tmpl = synth().template.toJSON() as {
      Resources?: Record<
        string,
        {
          Type: string
          Properties?: {
            ContainerDefinitions?: Array<{
              Secrets?: Array<{ Name: string; ValueFrom: unknown }>
            }>
          }
        }
      >
    }
    const taskDef = Object.values(tmpl.Resources ?? {}).find(
      (r) => r.Type === 'AWS::ECS::TaskDefinition',
    )
    const secrets = taskDef?.Properties?.ContainerDefinitions?.[0]?.Secrets ?? []
    const broker = secrets.find((s) => s.Name === 'WORKFLOW_BROKER_SECRET')
    expect(broker).toBeDefined()
    // Sanity: the broker ARN reference should NOT carry the JSON-path
    // suffix. CDK encodes the field path by appending ":<field>::" to the
    // joined ARN; absence here is what makes it a raw fetch.
    expect(JSON.stringify(broker?.ValueFrom)).not.toMatch(/:apiKey::/)
  })
})

describe('TemporalWorkerStack — IAM grants', () => {
  it('grants the task execution role secretsmanager:GetSecretValue (required for Fargate to inject secret env)', () => {
    synth().template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
          }),
        ]),
      }),
    })
  })

  it('does NOT grant kms:* — runtime token is fetched via the API broker, not directly', () => {
    const tmpl = synth().template.toJSON() as {
      Resources?: Record<
        string,
        {
          Type: string
          Properties?: {
            PolicyDocument?: {
              Statement?: Array<{ Action?: string | string[] }>
            }
          }
        }
      >
    }
    for (const r of Object.values(tmpl.Resources ?? {})) {
      if (r.Type !== 'AWS::IAM::Policy') continue
      const statements = r.Properties?.PolicyDocument?.Statement ?? []
      for (const s of statements) {
        const action = Array.isArray(s.Action) ? s.Action : [s.Action ?? '']
        for (const a of action) {
          // Allow Secrets Manager's own implicit kms:Decrypt only via the
          // grantRead helper, which the helper does NOT inject when the
          // secret has no CMK attached. Belt-and-braces: assert no
          // wildcard kms:* sneaks in.
          expect(a).not.toBe('kms:*')
        }
      }
    }
  })
})

describe('TemporalWorkerStack — CloudWatch log group', () => {
  it('creates a dedicated /pegasus/<env>/temporal-worker log group with 1-month retention', () => {
    synth().template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/pegasus/staging/temporal-worker',
      RetentionInDays: 30,
    })
  })

  it('retains the log group on stack delete', () => {
    const tmpl = synth().template.toJSON() as {
      Resources?: Record<
        string,
        { Type: string; DeletionPolicy?: string; Properties?: { LogGroupName?: string } }
      >
    }
    const lg = Object.values(tmpl.Resources ?? {}).find(
      (r) =>
        r.Type === 'AWS::Logs::LogGroup' &&
        r.Properties?.LogGroupName === '/pegasus/staging/temporal-worker',
    )
    expect(lg?.DeletionPolicy).toBe('Retain')
  })
})

describe('TemporalWorkerStack — CloudFormation outputs', () => {
  it('exports the repo URI, cluster name, service name, and log group name', () => {
    const outputs = Object.keys(synth().template.toJSON().Outputs ?? {})
    expect(outputs).toContain('WorkerRepositoryUri')
    expect(outputs).toContain('WorkerClusterName')
    expect(outputs).toContain('WorkerServiceName')
    expect(outputs).toContain('WorkerLogGroupName')
  })
})
