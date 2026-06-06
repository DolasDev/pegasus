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
    // Full ARNs (with the 6-char random suffix) — using fake but
    // realistic-shape suffixes so the assertions can match exactly.
    temporalCloudSecretArn:
      'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-TESTAB',
    workflowBrokerSecretArn:
      'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/workflow-broker-secret-TESTCD',
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

  it('injects TEMPORAL_CLOUD_API_KEY from the apiKey JSON field of the temporal-cloud secret', () => {
    // Since #192 the secret ARN is a literal string (not an Fn::Join
    // token), so `ValueFrom` is just `<full-arn>:apiKey::`.
    synth().template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Secrets: Match.arrayWith([
            Match.objectLike({
              Name: 'TEMPORAL_CLOUD_API_KEY',
              ValueFrom: Match.stringLikeRegexp(
                'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-TESTAB:apiKey::',
              ),
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

  // Regression guard for the post-#188 staging boot failures (PRs #190,
  // #191, and finally #192). Two independent issues both rooted in the
  // CDK `Secret.fromSecretNameV2` helper producing a no-suffix ARN:
  //
  //   1. The default `grantRead` policy uses a `-??????` suffix pattern
  //      that doesn't match no-suffix-ARN calls (IAM AccessDenied).
  //   2. The no-suffix ARN is NOT a valid Secrets Manager SecretId —
  //      `GetSecretValue` returns `ResourceNotFoundException`.
  //
  // Both vanish once we switch to `Secret.fromSecretCompleteArn` with
  // the full ARN (with 6-char random suffix). This test asserts:
  //   - The container's `secrets[].valueFrom` is the FULL ARN we passed.
  //   - The IAM grant Resource is also the FULL ARN (no `??????` form,
  //     no wildcards) — so IAM matches the actual SM API call exactly.
  it('uses the full Secrets Manager ARN (with suffix) end-to-end in valueFrom AND IAM Resource', () => {
    const tmpl = synth().template.toJSON() as {
      Resources?: Record<
        string,
        {
          Type: string
          Properties?: {
            ContainerDefinitions?: Array<{
              Secrets?: Array<{ Name: string; ValueFrom: string | unknown }>
            }>
            PolicyDocument?: {
              Statement?: Array<{
                Action?: string | string[]
                Resource?: string | string[]
              }>
            }
          }
        }
      >
    }
    const fullCloudArn =
      'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-TESTAB'
    const fullBrokerArn =
      'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/workflow-broker-secret-TESTCD'

    // (1) Task def secrets reference the full ARN. The Temporal cloud one
    // has `:apiKey::` appended for the JSON key path; broker is raw.
    const taskDefs = Object.values(tmpl.Resources ?? {}).filter(
      (r) => r.Type === 'AWS::ECS::TaskDefinition',
    )
    expect(taskDefs.length).toBe(1)
    const secrets = taskDefs[0]?.Properties?.ContainerDefinitions?.[0]?.Secrets ?? []
    const broker = secrets.find((s) => s.Name === 'WORKFLOW_BROKER_SECRET')
    const tcloud = secrets.find((s) => s.Name === 'TEMPORAL_CLOUD_API_KEY')
    expect(broker?.ValueFrom).toBe(fullBrokerArn)
    expect(tcloud?.ValueFrom).toBe(`${fullCloudArn}:apiKey::`)

    // (2) Every SM `GetSecretValue` grant Resource is the full ARN
    // (no `??????` suffix-wildcard, no bare `*`, no stripped no-suffix
    // ARN). CDK emits one statement per (role × secret) pair, so a
    // synthesized template has 4 statements (2 secrets × 2 roles); we
    // assert the resource set across them includes both full ARNs.
    const seenResources = new Set<string>()
    let grantCount = 0
    for (const r of Object.values(tmpl.Resources ?? {})) {
      if (r.Type !== 'AWS::IAM::Policy') continue
      for (const s of r.Properties?.PolicyDocument?.Statement ?? []) {
        const actions = (Array.isArray(s.Action) ? s.Action : [s.Action ?? '']).filter(
          (a): a is string => typeof a === 'string',
        )
        if (!actions.includes('secretsmanager:GetSecretValue')) continue
        const resources = (Array.isArray(s.Resource) ? s.Resource : [s.Resource ?? '']).filter(
          (a): a is string => typeof a === 'string',
        )
        for (const res of resources) {
          expect(res, `SM grant resource should be a full ARN, not "${res}"`).not.toMatch(
            /[?*]/,
          )
          expect(res).toMatch(/-[A-Za-z0-9]{6}$/)
          seenResources.add(res)
        }
        grantCount++
      }
    }
    // Both full ARNs must appear in the grant set (otherwise one of the
    // two secrets isn't reachable from its consuming role).
    expect(seenResources.has(fullCloudArn)).toBe(true)
    expect(seenResources.has(fullBrokerArn)).toBe(true)
    // Exec role + task role × 2 secrets = 4 statements expected.
    expect(grantCount).toBeGreaterThanOrEqual(4)
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
