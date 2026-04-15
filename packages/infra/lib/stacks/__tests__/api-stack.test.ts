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

describe('ApiStack — Lambda function', () => {
  it('creates exactly one Lambda function', () => {
    const template = synthApiStack()
    template.resourceCountIs('AWS::Lambda::Function', 1)
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
