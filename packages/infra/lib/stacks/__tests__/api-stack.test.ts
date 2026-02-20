import { describe, it } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { DatabaseStack } from '../database-stack'
import { ApiStack } from '../api-stack'

function synthApiStack() {
  const app = new cdk.App()
  const dbStack = new DatabaseStack(app, 'TestDb')
  const apiStack = new ApiStack(app, 'TestApi', { databaseStack: dbStack })
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
          DB_PORT: '5432',
          DB_NAME: 'pegasus',
        }),
      },
    })
  })

  it('sets DB_PROXY_ENDPOINT and DB_SECRET_ARN environment variables', () => {
    const template = synthApiStack()
    // Cross-stack references appear as Fn::ImportValue tokens
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          DB_PROXY_ENDPOINT: Match.anyValue(),
          DB_SECRET_ARN: Match.anyValue(),
        }),
      },
    })
  })

  it('places the Lambda in a VPC private subnet', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::Lambda::Function', {
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
        SecurityGroupIds: Match.anyValue(),
      }),
    })
  })
})

describe('ApiStack — IAM permissions', () => {
  it('grants sm:GetSecretValue on the database secret', () => {
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

  it('grants rds-db:connect for IAM authentication', () => {
    const template = synthApiStack()
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'rds-db:connect',
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

describe('ApiStack — CloudFormation Outputs', () => {
  it('exports the API URL', () => {
    const template = synthApiStack()
    template.hasOutput('ApiUrl', {
      Export: { Name: 'PegasusApiUrl' },
    })
  })
})
