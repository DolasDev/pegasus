import { describe, it, beforeAll, expect } from 'vitest'
import * as cdk from 'aws-cdk-lib'
import { Template, Match } from 'aws-cdk-lib/assertions'
import { CognitoStack } from '../cognito-stack'

// ---------------------------------------------------------------------------
// Synthesise once — CDK runs esbuild to bundle the trigger Lambdas, which
// is expensive. A single synth shared across all tests keeps the suite fast.
// ---------------------------------------------------------------------------
let template: Template

beforeAll(() => {
  // Skip actual esbuild bundling during tests (same pattern as api-stack.test.ts).
  // The pre-token Lambda imports @prisma/client which requires generated
  // artifacts that are not available in the test environment.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } })
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

  it('wires the custom-message Lambda trigger', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: Match.objectLike({
        CustomMessage: Match.anyValue(),
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
  it('creates exactly three Lambda functions (pre-auth, pre-token, custom-message)', () => {
    template.resourceCountIs('AWS::Lambda::Function', 3)
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

  it('custom-message Lambda has TENANT_LOGIN_URL_FALLBACK env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          TENANT_LOGIN_URL_FALLBACK: 'http://localhost:5173',
        }),
      }),
    })
  })

  it('custom-message Lambda has ADMIN_LOGIN_URL_FALLBACK env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          ADMIN_LOGIN_URL_FALLBACK: 'http://localhost:5174',
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

  it('grants ssm:GetParameter on the tenant domain-name parameter to the custom-message function', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              {
                'Fn::Join': [
                  '',
                  Match.arrayWith([
                    Match.stringLikeRegexp('parameter/dolas/pegasus/web/domain-name'),
                  ]),
                ],
              },
            ]),
          }),
        ]),
      },
    })
  })

  it('grants ssm:GetParameter on the admin domain-name parameter to the custom-message function', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ssm:GetParameter',
            Effect: 'Allow',
            Resource: Match.arrayWith([
              {
                'Fn::Join': [
                  '',
                  Match.arrayWith([
                    Match.stringLikeRegexp('parameter/dolas/pegasus/admin/domain-name'),
                  ]),
                ],
              },
            ]),
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

// ---------------------------------------------------------------------------
// Mobile app client (INFRA-02)
// ---------------------------------------------------------------------------

describe('CognitoStack — Mobile app client', () => {
  it('names the client "mobile-app-client"', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
    })
  })

  it('does not generate a client secret (SRP-only — no secret in the mobile app)', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      GenerateSecret: false,
    })
  })

  it('enables USER_SRP_AUTH and USER_PASSWORD_AUTH flows', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_SRP_AUTH']),
    })
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      ExplicitAuthFlows: Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']),
    })
  })

  it('uses the authorization code grant OAuth flow for SSO support', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      AllowedOAuthFlows: ['code'],
    })
  })

  it('requests email, openid, and profile OAuth scopes', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      AllowedOAuthScopes: Match.arrayWith(['email', 'openid', 'profile']),
    })
  })

  it('registers movingapp:// deep link as OAuth callback URL', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      CallbackURLs: Match.arrayWith(['movingapp://auth/callback']),
    })
  })

  it('registers movingapp:// deep link as OAuth logout URL', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      LogoutURLs: Match.arrayWith(['movingapp://auth/logout']),
    })
  })

  it('does not register tenant or admin localhost callback URLs', () => {
    const clients = template.findResources('AWS::Cognito::UserPoolClient', {
      Properties: { ClientName: 'mobile-app-client' },
    })
    const mobileClient = Object.values(clients)[0] as {
      Properties: { CallbackURLs?: string[] }
    }
    const callbackUrls: string[] = mobileClient?.Properties?.CallbackURLs ?? []
    expect(callbackUrls.some((u) => u.includes('localhost:5173'))).toBe(false)
    expect(callbackUrls.some((u) => u.includes('localhost:5174'))).toBe(false)
  })

  it('sets ID token validity to 8 hours (480 minutes in CloudFormation)', () => {
    // CDK Duration.hours(8) → 480 minutes in CloudFormation (not raw hours)
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      IdTokenValidity: 480,
    })
  })

  it('sets refresh token validity to 30 days (43200 minutes in CloudFormation)', () => {
    // CDK Duration.days(30) → 43200 minutes in CloudFormation
    const thirtyDaysInMinutes = 30 * 24 * 60
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      RefreshTokenValidity: thirtyDaysInMinutes,
    })
  })

  it('enables token revocation', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'mobile-app-client',
      EnableTokenRevocation: true,
    })
  })

  it('exports mobile client ID to SSM at /pegasus/mobile/cognito-client-id', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/pegasus/mobile/cognito-client-id',
      Type: 'String',
    })
  })

  it('exports mobile client ID as CloudFormation output PegasusCognitoMobileClientId', () => {
    const outputs = template.findOutputs('*')
    const mobileClientOutput = Object.values(outputs).find(
      (o: Record<string, unknown>) =>
        (o['Export'] as Record<string, unknown> | undefined)?.['Name'] ===
        'PegasusCognitoMobileClientId',
    )
    expect(mobileClientOutput).toBeDefined()
  })

  it('does not change the Lambda function count (still 3: pre-auth + pre-token + custom-message)', () => {
    // Mobile app client addition must not add any Lambda functions
    template.resourceCountIs('AWS::Lambda::Function', 3)
  })
})
