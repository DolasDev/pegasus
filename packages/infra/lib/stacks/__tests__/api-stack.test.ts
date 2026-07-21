import { describe, it, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { ApiStack } from '../api-stack'

function synthApiStack() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const apiStack = new ApiStack(app, 'TestApi')
  return Template.fromStack(apiStack)
}

function synthApiStackWithDocuments() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  // Documents bucket lives in a sibling stack so the IAM policy edges become
  // cross-stack references — exactly how production wires DocumentsStack.
  const docsStack = new cdk.Stack(app, 'TestDocs', {
    env: { account: '111111111111', region: 'us-east-1' },
  })
  const bucket = new s3.Bucket(docsStack, 'DocsBucket', { bucketName: 'pegasus-test-docs' })
  const apiStack = new ApiStack(app, 'TestApiWithDocs', {
    env: { account: '111111111111', region: 'us-east-1' },
    documentsBucket: bucket,
  })
  return Template.fromStack(apiStack)
}

// Synth with `cognitoStackName` set so the conditional cognito-idp IAM block
// in api-stack.ts:269-286 actually fires. The pegasus-{env}-cognito stack
// name doesn't have to exist as a real construct — api-stack only uses it as
// a string prefix for `cdk.Fn.importValue` lookups, which CFN resolves at
// deploy time, not synth time.
function synthApiStackWithCognito() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
  const apiStack = new ApiStack(app, 'TestApiWithCognito', {
    env: { account: '111111111111', region: 'us-east-1' },
    cognitoStackName: 'TestCognitoStack',
  })
  return Template.fromStack(apiStack)
}

describe('ApiStack — Lambda function', () => {
  it('creates the expected Lambda functions (HTTP API + AVP store-count + AVP policy reconciler + tariff fuel-surcharge update + tariff coverage-check + RingCentral token-refresh/sync/renew/capture/forward/buffer-purge/metrics + push forward + Trigger invoker)', () => {
    // HTTP API handler + AvpStoreCountFunction + SyncAvpPoliciesFunction +
    // TariffFscUpdateFunction + TariffCheckFunction + RingCentralTokenRefreshFunction +
    // RingCentralSyncFunction + RingCentralRenewFunction +
    // RingCentralCaptureFunction + RingCentralForwardFunction +
    // RingCentralBufferPurgeFunction + RingCentralMetricsFunction +
    // PushForwardFunction + the CDK Triggers framework's invoker Lambda.
    const template = synthApiStack()
    template.resourceCountIs('AWS::Lambda::Function', 14)
  })

  it('uses Node.js 20.x runtime', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
    })
  })

  it('configures 512 MB memory', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
    })
  })

  it('configures a 29-second timeout', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Timeout: 29,
    })
  })

  it('enables active X-Ray tracing on the API Lambda', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 512,
      Timeout: 29,
      TracingConfig: { Mode: 'Active' },
    })
  })

  it('sets NODE_ENV to production', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          NODE_ENV: 'production',
        }),
      },
    })
  })

  it('sets DATABASE_URL environment variable', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DATABASE_URL: Match.anyValue(),
        }),
      },
    })
  })

  it('does not place the Lambda in a VPC', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.absent(),
    })
  })

  it('sets COGNITO_MOBILE_CLIENT_ID environment variable (per D-07)', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          COGNITO_MOBILE_CLIENT_ID: Match.anyValue(),
        }),
      },
    })
  })

  it('sets COGNITO_HOSTED_UI_DOMAIN environment variable for mobile SSO', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          COGNITO_HOSTED_UI_DOMAIN: Match.anyValue(),
        }),
      },
    })
  })

  it('declares WIREGUARD_HUB_PUBLIC_KEY + WIREGUARD_HUB_ENDPOINT (empty when not wired)', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          WIREGUARD_HUB_PUBLIC_KEY: Match.anyValue(),
          WIREGUARD_HUB_ENDPOINT: Match.anyValue(),
        }),
      },
    })
  })
})

describe('ApiStack — IAM permissions', () => {
  it('grants sm:GetSecretValue on the Neon database secret', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['secretsmanager:GetSecretValue']),
            Effect: 'Allow',
          }),
        ]),
      },
    })
  })

  // Regression: the AWS-RunShellScript document is AWS-managed and its ARN
  // has an empty account portion. Templating in `this.account` here makes the
  // policy resource never match, and SendCommand fails closed at runtime.
  it('grants ssm:SendCommand on AWS-RunShellScript with an empty-account ARN', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:SendCommand',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                '',
                Match.arrayWith([
                  'arn:aws:ssm:',
                  Match.objectLike({ Ref: 'AWS::Region' }),
                  '::document/AWS-RunShellScript',
                ]),
              ],
            },
          }),
        ]),
      },
    })
  })

  // Regression: ssm:resourceTag/* conditions evaluate per-resource. AWS-managed
  // documents don't carry customer tags, so combining the document and the
  // instance scope in one statement under a tag condition filters the whole
  // statement out for the document resource, and SendCommand fails closed.
  // The document statement must be unconditional; the tag condition belongs
  // only on the instance statement.
  it('does not gate the AWS-RunShellScript ssm:SendCommand statement on a resource tag', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:SendCommand',
            Effect: 'Allow',
            Resource: {
              'Fn::Join': [
                '',
                Match.arrayWith([
                  'arn:aws:ssm:',
                  Match.objectLike({ Ref: 'AWS::Region' }),
                  '::document/AWS-RunShellScript',
                ]),
              ],
            },
            Condition: Match.absent(),
          }),
        ]),
      },
    })
  })
})

describe('ApiStack — HTTP API Gateway', () => {
  it('creates exactly one HTTP API', () => {
    const template = synthApiStack()
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 1)
  })

  it('names the API correctly', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: 'Pegasus Move Management API',
      ProtocolType: 'HTTP',
    })
  })

  it('configures CORS to allow all origins by default (dev — no corsAllowedOrigins prop)', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['*']),
      }),
    })
  })

  it('restricts CORS to the provided allowlist and mirrors it into the Lambda env', () => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const apiStack = new ApiStack(app, 'TestApiWithCors', {
      corsAllowedOrigins: ['https://pegasus.dolas.dev', 'https://admin.pegasus.dolas.dev'],
    })
    const template = Template.fromStack(apiStack)

    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['https://pegasus.dolas.dev', 'https://admin.pegasus.dolas.dev'],
      }),
    })

    // The Hono layer reads the same allowlist from CORS_ALLOWED_ORIGINS.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: 'https://pegasus.dolas.dev,https://admin.pegasus.dolas.dev',
        }),
      }),
    })
  })

  it('applies default-route throttling on the $default stage', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: Match.objectLike({
        ThrottlingRateLimit: 25,
        ThrottlingBurstLimit: 50,
      }),
    })
  })

  it('enables access logging on the $default stage with integration latency', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AccessLogSettings: {
        DestinationArn: Match.anyValue(),
        // Format is a JSON string; assert the two latency fields the latency
        // investigation depends on are present.
        Format: Match.stringLikeRegexp('.*integrationLatency.*'),
      },
    })
  })

  it('grants API Gateway write access to the access-log group', () => {
    const template = synthApiStack()
    // grantWrite to the apigateway service principal renders a CloudWatch Logs
    // resource policy scoped to the access-log group.
    template.hasResourceProperties('AWS::Logs::ResourcePolicy', {
      PolicyName: Match.stringLikeRegexp('.*ApiAccessLogGroupPolicy.*'),
    })
  })

  it('adds a catch-all proxy route', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'ANY /{proxy+}',
    })
  })

  it('creates a Lambda integration for the proxy route', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
      PayloadFormatVersion: '2.0',
    })
  })
})

describe('ApiStack — CloudWatch log group', () => {
  it('creates a log group with one-month retention', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      RetentionInDays: 30,
    })
  })
})

describe('ApiStack — Documents bucket wiring', () => {
  it('injects DOCUMENTS_BUCKET_NAME env var when a bucket is provided', () => {
    const template = synthApiStackWithDocuments()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DOCUMENTS_BUCKET_NAME: Match.anyValue(),
        }),
      },
    })
  })

  it('grants the Lambda role s3:GetObject and s3:PutObject on the documents bucket', () => {
    const template = synthApiStackWithDocuments()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['s3:GetObject*', 's3:PutObject']),
            Effect: 'Allow',
          }),
        ]),
      },
    })
  })

  it('grants s3:DeleteObject* on the documents bucket', () => {
    const template = synthApiStackWithDocuments()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 's3:DeleteObject*',
            Effect: 'Allow',
          }),
        ]),
      },
    })
  })

  it('does not inject DOCUMENTS_BUCKET_NAME when no bucket is provided', () => {
    const template = synthApiStack()
    // Confirm the env var key is absent from the Lambda function properties.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.not(Match.objectLike({ DOCUMENTS_BUCKET_NAME: Match.anyValue() })),
      },
    })
  })
})

describe('ApiStack — CloudFormation Outputs', () => {
  it('exports the API URL', () => {
    const template = synthApiStack()
    template.hasOutput('ApiUrl', {
      Export: { Name: 'PegasusApiUrl' },
    })
  })
})

// ---------------------------------------------------------------------------
// AVP / Cognito IAM — regression suite for AVP per-tenant policy-store
// provisioning (`apps/api/src/lib/authz-provision.ts`,
// `POST /api/admin/tenants`).
//
// Between 2026-05-03 and 2026-05-06 four separate provisioning regressions
// reached staging, each manifesting as a generic `AUTHZ_ERROR` response and
// distinguishable only by reading CloudWatch:
//
//   - 5588b18: Lambda asset missing cedar.schema.json + policies/ (bundling).
//   - 46fb673: cognito-idp:DescribeUserPool not granted to the API role.
//   - cf36796: cognito-idp:ListUserPoolClients + DescribeUserPoolClient not granted.
//   - 02a2961: PutSchema racing CreatePolicyStore eventual consistency.
//
// This block pins the IAM permission sets that AVP requires from the *caller*
// when provisioning a new policy store. AVP itself is the SDK target, but
// `CreateIdentitySource` validates the attached Cognito User Pool by issuing
// a sequence of cognito-idp introspection calls under the caller's
// credentials — see
// https://docs.aws.amazon.com/verifiedpermissions/latest/userguide/identity-providers-cognito.html.
//
// What this catches:
//   - Someone tightening IAM and dropping a pinned action.
//   - A future api-stack refactor that breaks one of these statements.
//
// What this misses:
//   - AWS adding a new requirement we don't yet know about (see the live
//     integration test in plans/todo/avp-provisioning-regression-tests.md
//     item #3).
//   - Actual AVP runtime errors (eventual consistency, malformed schema, etc).
// ---------------------------------------------------------------------------

const AVP_PER_STORE_ACTIONS = [
  'verifiedpermissions:IsAuthorized',
  'verifiedpermissions:IsAuthorizedWithToken',
  'verifiedpermissions:BatchIsAuthorized',
  'verifiedpermissions:BatchIsAuthorizedWithToken',
  'verifiedpermissions:DeletePolicyStore',
  'verifiedpermissions:PutSchema',
  'verifiedpermissions:CreatePolicy',
  'verifiedpermissions:CreateIdentitySource',
] as const

const COGNITO_INTROSPECTION_ACTIONS = [
  // Direct calls from apps/api code paths.
  // Deliberately no AdminDisableUser/AdminEnableUser — see api-stack.ts's
  // comment at this grant: the API never calls them, since deactivating a
  // user in one tenant must not lock them out of every other tenant in the
  // shared Cognito user pool.
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminResetUserPassword',
  'cognito-idp:AdminGetUser',
  'cognito-idp:CreateIdentityProvider',
  'cognito-idp:UpdateIdentityProvider',
  'cognito-idp:DeleteIdentityProvider',
  // handlers/sso.ts adds each newly registered IdP to the tenant app client's
  // SupportedIdentityProviders (and removes it on delete). Without this grant the
  // provider registers but no client may use it, and login dies at
  // /oauth2/idpresponse with a bare 400 and no error_description — the exact
  // undiagnosable failure that cost a prod debugging session on 2026-07-16.
  'cognito-idp:UpdateUserPoolClient',
  // Required indirectly by AVP CreateIdentitySource.
  'cognito-idp:DescribeUserPool',
  'cognito-idp:ListUserPoolClients',
  // DescribeUserPoolClient serves AVP and sso.ts both — the latter reads the client's
  // full config before every write, since UpdateUserPoolClient replaces it wholesale.
  'cognito-idp:DescribeUserPoolClient',
] as const

describe('ApiStack — AVP / Cognito IAM', () => {
  // ---------------- AVP per-store actions ----------------
  // One assertion per action so a missing entry names exactly which action
  // was dropped, instead of a vague "policy doesn't match" failure.
  for (const action of AVP_PER_STORE_ACTIONS) {
    it(`grants ${action} on policy-store ARNs`, () => {
      const template = synthApiStack()
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([action]),
              Effect: 'Allow',
            }),
          ]),
        },
      })
    })
  }

  it('grants verifiedpermissions:CreatePolicyStore as an account-scoped action', () => {
    // CreatePolicyStore has no resource ARN (the store doesn't exist yet),
    // so it must be on its own statement against `*`. Splitting it from the
    // per-store statement was the correct shape from the original
    // foundation merge — this test pins it so a future "consolidate the IAM"
    // refactor doesn't accidentally re-merge the statements and break
    // CreatePolicyStore at runtime.
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'verifiedpermissions:CreatePolicyStore',
            Effect: 'Allow',
            Resource: '*',
          }),
        ]),
      },
    })
  })

  // ---------------- Cognito introspection actions ----------------
  // These only appear when cognitoStackName is supplied, so synth with the
  // helper that wires it up.
  for (const action of COGNITO_INTROSPECTION_ACTIONS) {
    it(`grants ${action} on the user pool when cognitoStackName is set`, () => {
      const template = synthApiStackWithCognito()
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([action]),
              Effect: 'Allow',
            }),
          ]),
        },
      })
    })
  }

  it('does NOT emit the cognito-idp policy statement when cognitoStackName is absent', () => {
    // Confirms the conditional in api-stack.ts:269 still gates the block
    // correctly — the synth-without-cognito case (used by all other tests
    // and by CI runs that synthesise without a Cognito stack) must not
    // fail with a missing-import error.
    const template = synthApiStack()
    // None of the cognito-idp introspection actions should be present.
    for (const action of COGNITO_INTROSPECTION_ACTIONS) {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.not(
            Match.arrayWith([
              Match.objectLike({
                Action: Match.arrayWith([action]),
              }),
            ]),
          ),
        },
      })
    }
  })
})

// ---------------------------------------------------------------------------
// AVP policy-store count metric emitter — see plans/in-progress/
// authz-cedar-avp-followups.md item #9.
//
// Hourly Lambda + EventBridge schedule that publishes the count of tenants
// with a non-null policy_store_id to CloudWatch. The metric drives the
// MonitoringStack alarms for the AVP soft quota (~100 stores per Region per
// account). Pinned here because:
//   - the metric is NOT a CFN-tracked resource (it appears when published),
//     so a silent regression in this Lambda wouldn't show up at synth time
//     unless the Lambda construct itself disappears
//   - the IAM policy must scope cloudwatch:PutMetricData to the
//     `Pegasus/Authorization` namespace; tightening the role to `*` resource
//     without the namespace condition would let it write to any namespace,
//     defeating the blast-radius bound
// ---------------------------------------------------------------------------
describe('ApiStack — AVP store-count metric emitter', () => {
  it('creates the AVP store-count Lambda with 256 MB / 30s timeout', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Timeout: 30,
    })
  })

  it('schedules the AVP store-count Lambda hourly via EventBridge', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
      State: 'ENABLED',
    })
  })

  it('grants cloudwatch:PutMetricData scoped to the Pegasus/Authorization namespace', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Effect: 'Allow',
            Resource: '*',
            Condition: {
              StringEquals: { 'cloudwatch:namespace': 'Pegasus/Authorization' },
            },
          }),
        ]),
      },
    })
  })
})

// ---------------------------------------------------------------------------
describe('ApiStack — tariff fuel-surcharge cron', () => {
  it('schedules the fuel-surcharge Lambda weekly via EventBridge', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(7 days)',
      State: 'ENABLED',
      Description: Match.stringLikeRegexp('fuel-surcharge refresh from EIA'),
    })
  })

  it('injects the EIA API-key secret name so the Lambda reads it at runtime', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({ EIA_API_KEY_SECRET_NAME: 'pegasus/dev/eia-api-key' }),
      },
    })
  })

  it('grants cloudwatch:PutMetricData scoped to the Pegasus/Rating namespace', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Effect: 'Allow',
            Resource: '*',
            Condition: {
              StringEquals: { 'cloudwatch:namespace': 'Pegasus/Rating' },
            },
          }),
        ]),
      },
    })
  })

  it('grants read on the EIA API-key secret (deploys before the secret exists)', () => {
    const template = synthApiStack()
    // The secret ARN is a Fn::Join object, so assert against the serialized
    // policies: some IAM policy grants GetSecretValue on the eia-api-key secret.
    const policies = JSON.stringify(template.findResources('AWS::IAM::Policy'))
    expect(policies).toContain('secretsmanager:GetSecretValue')
    expect(policies).toContain('pegasus/dev/eia-api-key')
  })
})

// ---------------------------------------------------------------------------
describe('ApiStack — tariff coverage-check cron', () => {
  it('schedules the coverage-check Lambda daily via EventBridge', () => {
    const template = synthApiStack()
    // rate(1 day) is unique among the stack's schedules, so match on it plus the
    // description (the FSC cron above uses rate(7 days), so no collision).
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 day)',
      State: 'ENABLED',
      Description: Match.stringLikeRegexp('coverage-staleness check'),
    })
  })

  it('grants cloudwatch:PutMetricData scoped to the Pegasus/Rating namespace', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Effect: 'Allow',
            Resource: '*',
            Condition: {
              StringEquals: { 'cloudwatch:namespace': 'Pegasus/Rating' },
            },
          }),
        ]),
      },
    })
  })

  it('provisions a 256 MB / 30s DB-reading Lambda for the coverage check', () => {
    const template = synthApiStack()
    // Matches the shipped cron shape (FSC/AVP): 256/30, DATABASE_URL injected,
    // no VPC. Not unique on its own, but paired with the daily schedule + the
    // Pegasus/Rating grant above it pins the coverage cron's function config.
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Timeout: 30,
      Environment: {
        Variables: Match.objectLike({ DATABASE_URL: Match.anyValue() }),
      },
    })
  })
})

// ---------------------------------------------------------------------------
describe('ApiStack — RingCentral credential health-check cron', () => {
  it('schedules the credential health-check Lambda every 30 minutes', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(30 minutes)',
      State: 'ENABLED',
      Description: 'Health-checks RingCentral connection credentials.',
    })
  })

  it('schedules the reconciliation-sync Lambda every 15 minutes', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      State: 'ENABLED',
      Description: 'RingCentral reconciliation sync (dual-store SMS capture).',
    })
  })

  it('schedules the subscription-renewal Lambda hourly', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 hour)',
      State: 'ENABLED',
      Description: 'Ensures RingCentral webhook subscriptions stay alive.',
    })
  })

  it('schedules the on-prem forwarder Lambda every 5 minutes', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(5 minutes)',
      State: 'ENABLED',
      Description: 'Forwards captured RingCentral SMS to the on-prem SQL Server.',
    })
  })

  it('schedules the buffer-purge Lambda every 6 hours', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(6 hours)',
      State: 'ENABLED',
      Description: 'Purges forwarded RingCentral SMS bodies + old tombstones from Neon.',
    })
  })

  it('schedules the health-metrics emitter every 15 minutes with a scoped PutMetricData grant', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      State: 'ENABLED',
      Description: 'Emits RingCentral capture-health gauges (Pegasus/RingCentral).',
    })
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Condition: { StringEquals: { 'cloudwatch:namespace': 'Pegasus/RingCentral' } },
          }),
        ]),
      },
    })
  })

  it('creates the capture queue + DLQ with a redrive policy', () => {
    const template = synthApiStack()
    // Two RingCentral SQS queues (capture + its DLQ).
    template.resourceCountIs('AWS::SQS::Queue', 2)
    template.hasResourceProperties('AWS::SQS::Queue', {
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    })
  })

  it('wires the capture queue as an event source for the worker (partial batch failures)', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    })
  })

  it('grants Secrets Manager read/write scoped to the ringcentral name prefix', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              'secretsmanager:CreateSecret',
              'secretsmanager:PutSecretValue',
              'secretsmanager:GetSecretValue',
            ]),
            Effect: 'Allow',
            // Resource is an Fn::Join embedding region/account refs and ending
            // in the ringcentral name-prefix wildcard.
            Resource: {
              'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp('ringcentral/\\*')])],
            },
          }),
        ]),
      },
    })
  })
})

describe('ApiStack — RingCentral master switch (ringcentralEnabled)', () => {
  function synthEnabled() {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const apiStack = new ApiStack(app, 'TestApiRcEnabled', {
      env: { account: '111111111111', region: 'us-east-1' },
      ringcentralEnabled: true,
    })
    return Template.fromStack(apiStack)
  }

  it('leaves RINGCENTRAL_ENABLED unset on every Lambda by default (inert)', () => {
    const template = synthApiStack()
    const fns = template.findResources('AWS::Lambda::Function')
    const withFlag = Object.values(fns).filter(
      (fn) => fn.Properties?.Environment?.Variables?.RINGCENTRAL_ENABLED !== undefined,
    )
    if (withFlag.length !== 0) {
      throw new Error(`expected no Lambda to carry RINGCENTRAL_ENABLED, found ${withFlag.length}`)
    }
  })

  it('sets RINGCENTRAL_ENABLED=true on the api + cron Lambdas when enabled', () => {
    const template = synthEnabled()
    const fns = template.findResources('AWS::Lambda::Function')
    const enabled = Object.values(fns).filter(
      (fn) => fn.Properties?.Environment?.Variables?.RINGCENTRAL_ENABLED === 'true',
    )
    // api Lambda + capture/sync/renew/token-refresh crons = 5.
    if (enabled.length !== 5) {
      throw new Error(`expected 5 Lambdas with RINGCENTRAL_ENABLED=true, found ${enabled.length}`)
    }
  })

  it('sets RINGCENTRAL_WEBHOOK_URL (own API endpoint) only on the renew cron', () => {
    const template = synthEnabled()
    // Exactly one Lambda — the renewal cron — registers the subscription, so it
    // is the only one that needs the public delivery address.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          RINGCENTRAL_ENABLED: 'true',
          RINGCENTRAL_WEBHOOK_URL: {
            'Fn::Join': [
              '',
              Match.arrayWith([Match.stringLikeRegexp('/api/integrations/ringcentral/webhook')]),
            ],
          },
        }),
      },
    })
    const fns = template.findResources('AWS::Lambda::Function')
    const withUrl = Object.values(fns).filter(
      (fn) => fn.Properties?.Environment?.Variables?.RINGCENTRAL_WEBHOOK_URL !== undefined,
    )
    if (withUrl.length !== 1) {
      throw new Error(
        `expected exactly 1 Lambda with RINGCENTRAL_WEBHOOK_URL, found ${withUrl.length}`,
      )
    }
  })
})

describe('ApiStack — integration-config publish switch (integrationConfigPublishEnabled)', () => {
  function synthEnabled() {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const apiStack = new ApiStack(app, 'TestApiIcEnabled', {
      env: { account: '111111111111', region: 'us-east-1' },
      integrationConfigPublishEnabled: true,
    })
    return Template.fromStack(apiStack)
  }

  it('leaves INTEGRATION_CONFIG_PUBLISH_ENABLED unset on every Lambda by default', () => {
    const template = synthApiStack()
    const fns = template.findResources('AWS::Lambda::Function')
    const withFlag = Object.values(fns).filter(
      (fn) =>
        fn.Properties?.Environment?.Variables?.INTEGRATION_CONFIG_PUBLISH_ENABLED !== undefined,
    )
    if (withFlag.length !== 0) {
      throw new Error(
        `expected no Lambda to carry INTEGRATION_CONFIG_PUBLISH_ENABLED, found ${withFlag.length}`,
      )
    }
  })

  it('sets INTEGRATION_CONFIG_PUBLISH_ENABLED=true only on the api Lambda when enabled', () => {
    const template = synthEnabled()
    const fns = template.findResources('AWS::Lambda::Function')
    const enabled = Object.values(fns).filter(
      (fn) => fn.Properties?.Environment?.Variables?.INTEGRATION_CONFIG_PUBLISH_ENABLED === 'true',
    )
    if (enabled.length !== 1) {
      throw new Error(
        `expected exactly 1 Lambda with INTEGRATION_CONFIG_PUBLISH_ENABLED=true, found ${enabled.length}`,
      )
    }
  })
})

// ---------------------------------------------------------------------------
describe('ApiStack — workflow-execution reconcile poller (Phase 2 Unit 6.5)', () => {
  // A complete secret ARN (with the random 6-char suffix) is required by
  // Secret.fromSecretCompleteArn — see the no-suffix-rejection gotcha.
  const temporalProps = {
    env: { account: '111111111111', region: 'us-east-1' },
    temporalAddress: 'pegasus-staging.chgel.tmprl.cloud:7233',
    temporalNamespace: 'pegasus-staging.chgel',
    temporalTaskQueue: 'pegasus-stdlib-staging',
    temporalCloudSecretArn:
      'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-aBcDeF',
  }

  function synthTemporal() {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const apiStack = new ApiStack(app, 'TestApiTemporal', temporalProps)
    return Template.fromStack(apiStack)
  }

  it('does NOT synthesize the poller when Temporal is unconfigured', () => {
    const template = synthApiStack()
    const rules = template.findResources('AWS::Events::Rule')
    const reconcileRules = Object.values(rules).filter((r) =>
      String(r.Properties?.Description ?? '').includes('reconcile'),
    )
    if (reconcileRules.length !== 0) {
      throw new Error(
        `expected no reconcile Rule without Temporal config, found ${reconcileRules.length}`,
      )
    }
  })

  it('schedules the reconcile poller every minute via EventBridge', () => {
    const template = synthTemporal()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 minute)',
      State: 'ENABLED',
      Description:
        'Reconciles orphaned RUNNING workflow executions against Temporal Cloud (crash-recovery backstop).',
    })
  })

  it('wires the poller Lambda with DATABASE_URL + the Temporal env trio + API key', () => {
    const template = synthTemporal()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DATABASE_URL: Match.anyValue(),
          TEMPORAL_ADDRESS: 'pegasus-staging.chgel.tmprl.cloud:7233',
          TEMPORAL_NAMESPACE: 'pegasus-staging.chgel',
          TEMPORAL_TASK_QUEUE: 'pegasus-stdlib-staging',
          TEMPORAL_CLOUD_API_KEY: Match.anyValue(),
        }),
      },
    })
  })

  it('grants cloudwatch:PutMetricData scoped to the Pegasus/Workflows namespace', () => {
    const template = synthTemporal()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'cloudwatch:PutMetricData',
            Effect: 'Allow',
            Resource: '*',
            Condition: {
              StringEquals: { 'cloudwatch:namespace': 'Pegasus/Workflows' },
            },
          }),
        ]),
      },
    })
  })

  // ── Workflow trigger dispatcher (Phase 3 Unit 3) ──────────────────────────

  it('does NOT synthesize the trigger dispatcher when Temporal is unconfigured', () => {
    const template = synthApiStack()
    const rules = template.findResources('AWS::Events::Rule')
    const dispatchRules = Object.values(rules).filter((r) =>
      String(r.Properties?.Description ?? '').includes('workflow triggers'),
    )
    if (dispatchRules.length !== 0) {
      throw new Error(
        `expected no dispatch Rule without Temporal config, found ${dispatchRules.length}`,
      )
    }
  })

  it('schedules the trigger dispatcher every minute via EventBridge', () => {
    const template = synthTemporal()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(1 minute)',
      State: 'ENABLED',
      Description:
        'Dispatches undispatched domain events to matching workflow triggers (event-driven executions).',
    })
  })

  it('wires the dispatcher Lambda with DATABASE_URL + Temporal env + the workflow-token KMS key', () => {
    const template = synthTemporal()
    // WORKFLOW_TOKEN_KMS_KEY_ID disambiguates the dispatcher from the
    // reconcile poller (which shares the rest of the env surface) — the
    // shared run path lazily mints + KMS-encrypts runtime credentials.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DATABASE_URL: Match.anyValue(),
          TEMPORAL_ADDRESS: 'pegasus-staging.chgel.tmprl.cloud:7233',
          TEMPORAL_NAMESPACE: 'pegasus-staging.chgel',
          TEMPORAL_TASK_QUEUE: 'pegasus-stdlib-staging',
          TEMPORAL_CLOUD_API_KEY: Match.anyValue(),
          WORKFLOW_TOKEN_KMS_KEY_ID: Match.anyValue(),
        }),
      },
      MemorySize: 256,
      Timeout: 120,
    })
    const fns = template.findResources('AWS::Lambda::Function')
    const dispatchers = Object.values(fns).filter(
      (fn) =>
        fn.Properties?.Environment?.Variables?.WORKFLOW_TOKEN_KMS_KEY_ID !== undefined &&
        fn.Properties?.Environment?.Variables?.TEMPORAL_ADDRESS !== undefined &&
        fn.Properties?.MemorySize === 256,
    )
    if (dispatchers.length !== 1) {
      throw new Error(`expected exactly 1 dispatcher Lambda, found ${dispatchers.length}`)
    }
  })
})

// ---------------------------------------------------------------------------
describe('ApiStack — tenant-runner orchestration wiring (Phase 3 Unit 9)', () => {
  // Runner wiring needs the Temporal branch active PLUS the network refs
  // (subnets + SG) WireGuardStack provides in production. A sibling network
  // stack stands in for WireGuardStack here, mirroring the
  // temporal-worker-stack.test.ts trick.
  function synthTenantRunner() {
    const app = new cdk.App({
      // env=staging context pins the by-name cross-stack contract
      // (pegasus-temporal-worker-staging cluster etc.) the assertions check.
      context: { 'aws:cdk:bundling-stacks': [], env: 'staging' },
    })
    const networkStack = new cdk.Stack(app, 'TestRunnerNetwork', {
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
    const apiStack = new ApiStack(app, 'TestApiTenantRunner', {
      env: { account: '111111111111', region: 'us-east-1' },
      temporalAddress: 'pegasus-staging.chgel.tmprl.cloud:7233',
      temporalNamespace: 'pegasus-staging.chgel',
      temporalTaskQueue: 'pegasus-stdlib-staging',
      temporalCloudSecretArn:
        'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-aBcDeF',
      tenantRunnerSubnets: vpc.selectSubnets({ subnetGroupName: 'temporal-worker-egress' }).subnets,
      tenantRunnerSecurityGroup: new ec2.SecurityGroup(networkStack, 'TestRunnerSg', { vpc }),
    })
    return Template.fromStack(apiStack)
  }

  it('stays inert without the runner network props (no TENANT_RUNNER_* env anywhere)', () => {
    // The plain Temporal synth (used by the poller tests above) passes no
    // subnets/SG — exactly the dev shape. Nothing runner-related may leak in.
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
    const template = Template.fromStack(
      new ApiStack(app, 'TestApiNoRunner', {
        env: { account: '111111111111', region: 'us-east-1' },
        temporalAddress: 'pegasus-staging.chgel.tmprl.cloud:7233',
        temporalNamespace: 'pegasus-staging.chgel',
        temporalTaskQueue: 'pegasus-stdlib-staging',
        temporalCloudSecretArn:
          'arn:aws:secretsmanager:us-east-1:111111111111:secret:pegasus/staging/temporal-cloud-aBcDeF',
      }),
    )
    const fns = template.findResources('AWS::Lambda::Function')
    for (const fn of Object.values(fns)) {
      const vars = fn.Properties?.Environment?.Variables ?? {}
      if ('TENANT_RUNNER_CLUSTER_ARN' in vars) {
        throw new Error('TENANT_RUNNER_* env must not be set without the runner network props')
      }
    }
  })

  it('injects the TENANT_RUNNER_* env contract into exactly the API + dispatcher Lambdas', () => {
    const template = synthTenantRunner()
    const fns = template.findResources('AWS::Lambda::Function')
    const wired = Object.values(fns).filter(
      (fn) => fn.Properties?.Environment?.Variables?.TENANT_RUNNER_CLUSTER_ARN !== undefined,
    )
    // The API Lambda (run-path hook) + the trigger dispatcher (sweep). The
    // reconcile poller and the other crons must NOT get launch powers.
    if (wired.length !== 2) {
      throw new Error(`expected exactly 2 Lambdas with TENANT_RUNNER_* env, found ${wired.length}`)
    }
    for (const fn of wired) {
      const vars = fn.Properties?.Environment?.Variables ?? {}
      if (
        vars.TENANT_RUNNER_CLUSTER_ARN !==
        'arn:aws:ecs:us-east-1:111111111111:cluster/pegasus-temporal-worker-staging'
      ) {
        throw new Error(`unexpected cluster ARN: ${JSON.stringify(vars.TENANT_RUNNER_CLUSTER_ARN)}`)
      }
      if (vars.TENANT_RUNNER_TASK_DEFINITION !== 'pegasus-tenant-runner-staging') {
        throw new Error('TENANT_RUNNER_TASK_DEFINITION must be the bare family name')
      }
      if (vars.TENANT_RUNNER_CONTAINER_NAME !== 'tenant-runner') {
        throw new Error('TENANT_RUNNER_CONTAINER_NAME mismatch')
      }
      if (vars.TENANT_RUNNER_SECURITY_GROUP_ID === undefined) {
        throw new Error('TENANT_RUNNER_SECURITY_GROUP_ID missing')
      }
      // Subnet ids are cross-stack tokens joined with ','.
      if (vars.TENANT_RUNNER_SUBNET_IDS === undefined) {
        throw new Error('TENANT_RUNNER_SUBNET_IDS missing')
      }
    }
  })

  it('grants ecs:RunTask on the runner task-definition family, cluster-conditioned', () => {
    synthTenantRunner().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ecs:RunTask',
            Effect: 'Allow',
            // Revisioned pattern (ECS normally authorizes the resolved
            // revision) + the bare-family form, belt-and-braces — see the
            // statement comment in api-stack.ts.
            Resource: [
              'arn:aws:ecs:us-east-1:111111111111:task-definition/pegasus-tenant-runner-staging:*',
              'arn:aws:ecs:us-east-1:111111111111:task-definition/pegasus-tenant-runner-staging',
            ],
            Condition: {
              ArnEquals: {
                'ecs:cluster':
                  'arn:aws:ecs:us-east-1:111111111111:cluster/pegasus-temporal-worker-staging',
              },
            },
          }),
        ]),
      }),
    })
  })

  it('grants ecs:ListTasks + ecs:DescribeTasks confined to the worker cluster', () => {
    synthTenantRunner().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: ['ecs:ListTasks', 'ecs:DescribeTasks'],
            Effect: 'Allow',
            Resource: '*',
            Condition: {
              ArnEquals: {
                'ecs:cluster':
                  'arn:aws:ecs:us-east-1:111111111111:cluster/pegasus-temporal-worker-staging',
              },
            },
          }),
        ]),
      }),
    })
  })

  it('grants iam:PassRole on ONLY the two runner roles, confined to ecs-tasks', () => {
    synthTenantRunner().hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'iam:PassRole',
            Effect: 'Allow',
            Resource: [
              'arn:aws:iam::111111111111:role/pegasus-tenant-runner-task-staging',
              'arn:aws:iam::111111111111:role/pegasus-tenant-runner-exec-staging',
            ],
            Condition: {
              StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
            },
          }),
        ]),
      }),
    })
  })

  it('both launch-capable roles carry the RunTask statement (api + dispatcher)', () => {
    const template = synthTenantRunner().toJSON() as {
      Resources?: Record<
        string,
        {
          Type: string
          Properties?: {
            PolicyDocument?: { Statement?: Array<{ Action?: string | string[] }> }
          }
        }
      >
    }
    const policiesWithRunTask = Object.values(template.Resources ?? {}).filter(
      (r) =>
        r.Type === 'AWS::IAM::Policy' &&
        (r.Properties?.PolicyDocument?.Statement ?? []).some((s) =>
          (Array.isArray(s.Action) ? s.Action : [s.Action]).includes('ecs:RunTask'),
        ),
    )
    // One default policy per role — API Lambda role + dispatcher role.
    if (policiesWithRunTask.length !== 2) {
      throw new Error(
        `expected ecs:RunTask in exactly 2 role policies, found ${policiesWithRunTask.length}`,
      )
    }
  })
})
