import { describe, it, expect, beforeAll } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { CognitoStack } from '../cognito-stack'

// ---------------------------------------------------------------------------
// Synthesise once — CDK runs esbuild to bundle the trigger Lambdas, which
// is expensive. A single synth shared across all tests keeps the suite fast.
// ---------------------------------------------------------------------------
let template: Template

beforeAll(() => {
  const app = new cdk.App()
  const stack = new CognitoStack(app, 'TestCognito')
  template = Template.fromStack(stack)
})

// ---------------------------------------------------------------------------
// User Pool
// ---------------------------------------------------------------------------

describe('CognitoStack — User Pool', () => {
  it('creates exactly one Cognito User Pool', () => {
    template.resourceCountIs('AWS::Cognito::UserPool', 1)
  })

  it('disables self sign-up', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: Match.objectLike({
        AllowAdminCreateUserOnly: true,
      }),
    })
  })

  it('uses email as the sign-in alias', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
    })
  })

  it('sets MFA to OPTIONAL', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      MfaConfiguration: 'OPTIONAL',
    })
  })

  it('enables TOTP (software token) MFA only — SMS is disabled', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      EnabledMfas: ['SOFTWARE_TOKEN_MFA'],
    })
  })

  it('enforces a minimum password length of 12 characters', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        PasswordPolicy: Match.objectLike({
          MinimumLength: 12,
        }),
      }),
    })
  })

  it('requires lowercase, uppercase, digits, and symbols in passwords', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      Policies: Match.objectLike({
        PasswordPolicy: Match.objectLike({
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        }),
      }),
    })
  })

  it('uses email-only account recovery', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: 'verified_email', Priority: 1 }],
      },
    })
  })

  it('sets the deletion policy to Retain', () => {
    template.hasResource('AWS::Cognito::UserPool', {
      DeletionPolicy: 'Retain',
    })
  })

  it('wires the pre-authentication Lambda trigger', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreAuthentication: Match.anyValue(),
      }),
    })
  })

  it('wires the pre-token-generation Lambda trigger', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        PreTokenGeneration: Match.anyValue(),
      }),
    })
  })
})

// ---------------------------------------------------------------------------
// Groups and Hosted UI
// ---------------------------------------------------------------------------

describe('CognitoStack — Groups and Hosted UI', () => {
  it('creates the PLATFORM_ADMIN Cognito group', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolGroup', {
      GroupName: 'PLATFORM_ADMIN',
    })
  })

  it('provisions a Cognito hosted UI domain', () => {
    template.resourceCountIs('AWS::Cognito::UserPoolDomain', 1)
  })

  it('prefixes the hosted UI domain with "pegasus-"', () => {
    // Domain includes cdk.Aws.ACCOUNT_ID (resolved at deploy time), so CDK
    // emits a Fn::Join intrinsic rather than a plain string.
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: {
        'Fn::Join': ['', [Match.stringLikeRegexp('pegasus-'), Match.anyValue()]],
      },
    })
  })
})

// ---------------------------------------------------------------------------
// App clients
// ---------------------------------------------------------------------------

describe('CognitoStack — Admin app client', () => {
  it('names the client "admin-app-client"', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
    })
  })

  it('does not generate a client secret (public PKCE client)', () => {
    // CDK writes GenerateSecret: false explicitly in the template.
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
      GenerateSecret: false,
    })
  })

  it('enables prevent-user-existence-errors', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
      PreventUserExistenceErrors: 'ENABLED',
    })
  })

  it('uses the authorization code grant OAuth flow', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
      AllowedOAuthFlows: ['code'],
    })
  })

  it('requests email, openid, and profile OAuth scopes', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
      AllowedOAuthScopes: Match.arrayWith(['email', 'openid', 'profile']),
    })
  })

  it('enables token revocation', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'admin-app-client',
      EnableTokenRevocation: true,
    })
  })
})

describe('CognitoStack — Tenant app client', () => {
  it('names the client "tenant-app-client"', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'tenant-app-client',
    })
  })

  it('does not generate a client secret', () => {
    // CDK writes GenerateSecret: false explicitly in the template.
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'tenant-app-client',
      GenerateSecret: false,
    })
  })

  it('uses the authorization code grant OAuth flow', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'tenant-app-client',
      AllowedOAuthFlows: ['code'],
    })
  })

  it('has a longer refresh token validity than the admin client (30 days)', () => {
    // Tenant users stay logged in across days; admin sessions expire on tab close.
    // CDK stores validity in minutes in CloudFormation.
    const thirtyDaysInMinutes = 30 * 24 * 60

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'tenant-app-client',
      RefreshTokenValidity: thirtyDaysInMinutes,
    })
  })
})

// ---------------------------------------------------------------------------
// Lambda triggers
// ---------------------------------------------------------------------------

describe('CognitoStack — Lambda triggers', () => {
  it('creates exactly two Lambda functions (pre-auth and pre-token)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2)
  })

  it('pre-auth Lambda uses Node.js 20.x runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 128,
      Runtime: 'nodejs20.x',
    })
  })

  it('pre-auth Lambda has a 5-second timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 128,
      Timeout: 5,
    })
  })

  it('pre-token Lambda uses Node.js 20.x runtime', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Runtime: 'nodejs20.x',
    })
  })

  it('pre-token Lambda has a 15-second timeout', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Timeout: 15,
    })
  })

  it('pre-token Lambda has DATABASE_URL environment variable set', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          DATABASE_URL: Match.anyValue(),
        }),
      }),
    })
  })

  it('pre-token Lambda has NODE_ENV set to production', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      MemorySize: 256,
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          NODE_ENV: 'production',
        }),
      }),
    })
  })
})

// ---------------------------------------------------------------------------
// IAM
// ---------------------------------------------------------------------------

describe('CognitoStack — IAM permissions', () => {
  it('grants AdminGetUser to the pre-auth function', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['cognito-idp:AdminGetUser']),
            Effect: 'Allow',
          }),
        ]),
      },
    })
  })

  it('grants AdminListGroupsForUser to the pre-auth function', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['cognito-idp:AdminListGroupsForUser']),
            Effect: 'Allow',
          }),
        ]),
      },
    })
  })
})

// ---------------------------------------------------------------------------
// SSM Parameters
// ---------------------------------------------------------------------------

describe('CognitoStack — SSM Parameters', () => {
  it('creates the cognito-user-pool-id parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/admin/cognito-user-pool-id',
      Type: 'String',
    })
  })

  it('creates the cognito-admin-client-id parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/admin/cognito-admin-client-id',
      Type: 'String',
    })
  })

  it('creates the cognito-hosted-ui-domain parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/admin/cognito-hosted-ui-domain',
      Type: 'String',
    })
  })

  it('creates the tenant cognito-client-id parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/tenant/cognito-client-id',
      Type: 'String',
    })
  })

  it('creates the jwks-url parameter', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/cognito/jwks-url',
      Type: 'String',
    })
  })
})

// ---------------------------------------------------------------------------
// CloudFormation Outputs
// ---------------------------------------------------------------------------

describe('CognitoStack — CloudFormation Outputs', () => {
  it('exports the User Pool ID', () => {
    template.hasOutput('UserPoolId', {
      Export: { Name: 'PegasusCognitoUserPoolId' },
    })
  })

  it('exports the Admin Client ID', () => {
    template.hasOutput('AdminClientId', {
      Export: { Name: 'PegasusCognitoAdminClientId' },
    })
  })

  it('exports the Tenant Client ID', () => {
    template.hasOutput('TenantClientId', {
      Export: { Name: 'PegasusCognitoTenantClientId' },
    })
  })

  it('exports the Hosted UI base URL', () => {
    template.hasOutput('HostedUiBaseUrl', {
      Export: { Name: 'PegasusCognitoHostedUiBaseUrl' },
    })
  })

  it('exports the JWKS URL', () => {
    template.hasOutput('JwksUrl', {
      Export: { Name: 'PegasusCognitoJwksUrl' },
    })
  })
})
