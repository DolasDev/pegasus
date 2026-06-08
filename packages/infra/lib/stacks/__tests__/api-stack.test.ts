import { describe, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
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
  it('creates the expected Lambda functions (HTTP API + AVP store-count + AVP policy reconciler + RingCentral token-refresh + RingCentral sync + Trigger invoker)', () => {
    // HTTP API handler + AvpStoreCountFunction + SyncAvpPoliciesFunction +
    // RingCentralTokenRefreshFunction + RingCentralSyncFunction + the CDK
    // Triggers framework's invoker Lambda (one per Trigger).
    const template = synthApiStack()
    template.resourceCountIs('AWS::Lambda::Function', 6)
  })

  it('uses Node.js 20.x runtime', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
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

  it('configures CORS to allow all origins', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['*']),
      }),
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
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminDisableUser',
  'cognito-idp:AdminEnableUser',
  'cognito-idp:AdminGetUser',
  'cognito-idp:CreateIdentityProvider',
  'cognito-idp:UpdateIdentityProvider',
  'cognito-idp:DeleteIdentityProvider',
  // Required indirectly by AVP CreateIdentitySource.
  'cognito-idp:DescribeUserPool',
  'cognito-idp:ListUserPoolClients',
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
describe('ApiStack — RingCentral token-refresh cron', () => {
  it('schedules the token-refresh Lambda every 30 minutes', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(30 minutes)',
      State: 'ENABLED',
      Description: 'Refreshes RingCentral OAuth tokens for active connections.',
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
