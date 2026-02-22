// ---------------------------------------------------------------------------
// CognitoStack
//
// Provisions the shared Cognito User Pool used by both the admin portal and
// the tenant-facing web app.
//
// Key design decisions:
//  - Single pool, two app clients. Admins and tenant users live in the same
//    pool, differentiated by the PLATFORM_ADMIN Cognito group. JWTs carry
//    the cognito:groups claim which API middleware reads to enforce access.
//  - MFA is OPTIONAL at the pool level (TOTP only, no SMS). The pre-auth
//    Lambda trigger enforces TOTP for PLATFORM_ADMIN users specifically.
//  - Self-sign-up is disabled. Admin users are created via the guided
//    scripts/create-admin-user.ts script.
//  - SSM parameters at /pegasus/admin/* are kept completely separate from
//    the existing /pegasus/dev/* tenant secrets.
// ---------------------------------------------------------------------------

import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import type { Construct } from 'constructs'

export interface CognitoStackProps extends cdk.StackProps {
  /**
   * OAuth 2.0 callback URLs for the admin app client.
   * Add the production admin CloudFront URL when the AdminFrontendStack is deployed.
   * Defaults to localhost for local development.
   */
  readonly adminCallbackUrls?: readonly string[]

  /**
   * OAuth 2.0 logout URLs for the admin app client.
   * Defaults to localhost for local development.
   */
  readonly adminLogoutUrls?: readonly string[]
}

export class CognitoStack extends cdk.Stack {
  /** The shared Cognito User Pool for all Pegasus auth. */
  public readonly userPool: cognito.UserPool

  /** App client used by the admin portal (OAuth authorization code flow). */
  public readonly adminAppClient: cognito.UserPoolClient

  /**
   * App client used by the tenant-facing web app.
   * OIDC identity providers (Google, GitHub) will be wired up when the main
   * app auth feature is implemented.
   */
  public readonly tenantAppClient: cognito.UserPoolClient

  /**
   * JWKS endpoint URL for the user pool.
   * Injected into the API Lambda so it can verify JWTs without any secret.
   */
  public readonly jwksUrl: string

  constructor(scope: Construct, id: string, props: CognitoStackProps = {}) {
    super(scope, id, props)

    const adminCallbackUrls = props.adminCallbackUrls ?? ['http://localhost:5174/auth/callback']
    const adminLogoutUrls = props.adminLogoutUrls ?? ['http://localhost:5174/login']

    // -------------------------------------------------------------------------
    // Pre-Authentication Lambda trigger
    //
    // Created before the pool to avoid circular stack references. The pool ARN
    // (needed for IAM permissions) and pool ID (needed as env var) are added
    // after the pool is constructed.
    // -------------------------------------------------------------------------
    const preAuthFn = new nodejs.NodejsFunction(this, 'PreAuthFunction', {
      functionName: `pegasus-cognito-pre-auth-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      // Entry point is in packages/api so Lambda code stays alongside app code.
      entry: path.join(__dirname, '../../../api/src/cognito/pre-auth.ts'),
      handler: 'handler',
      bundling: {
        minify: true,
        sourceMap: true,
        // @aws-sdk/* is available in the Lambda Node.js 20 runtime; exclude
        // from bundle to keep the deployment package small.
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
    })

    // -------------------------------------------------------------------------
    // User Pool
    // -------------------------------------------------------------------------
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'pegasus-user-pool',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      // TOTP MFA is optional at the pool level. The pre-auth trigger enforces
      // it for PLATFORM_ADMIN users. SMS is disabled — no SNS setup required.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      lambdaTriggers: {
        preAuthentication: preAuthFn,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // RETAIN: user accounts must survive stack updates and accidental
      // `cdk destroy` runs.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // Grant the trigger the minimum Cognito API permissions it needs to check
    // group membership and MFA enrollment status.
    //
    // NOTE: We intentionally use a wildcard ARN (scoped to account + region)
    // rather than this.userPool.userPoolArn. Referencing the pool ARN token
    // here creates a CloudFormation circular dependency:
    //   UserPool → PreAuthFunction (trigger) → IAM Policy → UserPool (ARN)
    // The wildcard is safe because the Lambda's execution role is already
    // scoped to this account and region by its IAM role trust policy.
    preAuthFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminGetUser', 'cognito-idp:AdminListGroupsForUser'],
        resources: [
          `arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/*`,
        ],
      }),
    )

    // USER_POOL_ID is NOT injected as an env var here. Cognito passes the pool
    // ID on every trigger event (event.userPoolId), which the Lambda reads
    // directly. Injecting it via addEnvironment would create another cycle:
    //   UserPool → PreAuthFunction → env var token → UserPool

    // -------------------------------------------------------------------------
    // PLATFORM_ADMIN group
    // -------------------------------------------------------------------------
    new cognito.CfnUserPoolGroup(this, 'PlatformAdminGroup', {
      userPoolId: this.userPool.userPoolId,
      groupName: 'PLATFORM_ADMIN',
      description: 'Platform administrators with full access to the Pegasus admin portal.',
      // No IAM role — the group is used for JWT claims only, not AWS permissions.
    })

    // -------------------------------------------------------------------------
    // Hosted UI domain
    //
    // Format: https://pegasus-<accountId>.auth.<region>.amazoncognito.com
    // Using the account ID as a suffix guarantees global uniqueness since
    // account IDs are globally unique across all AWS accounts.
    // -------------------------------------------------------------------------
    const hostedUiDomain = this.userPool.addDomain('HostedUiDomain', {
      cognitoDomain: {
        domainPrefix: `pegasus-${cdk.Aws.ACCOUNT_ID}`,
      },
    })

    // -------------------------------------------------------------------------
    // Admin app client
    //
    // Used by apps/admin (OAuth authorization code grant, no client secret).
    // Refresh token validity is set to the minimum (1 hour) since the admin
    // portal stores tokens in sessionStorage which is cleared on tab close,
    // making refresh tokens effectively unused.
    // -------------------------------------------------------------------------
    this.adminAppClient = this.userPool.addClient('AdminAppClient', {
      userPoolClientName: 'admin-app-client',
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: {
        // userSrp: ALLOW_USER_SRP_AUTH — required by the Cognito Hosted UI.
        // The Hosted UI uses SRP internally to drive its login form regardless
        // of which flows the SPA uses via the API. Without this, the Hosted UI
        // shows "An error was encountered with the requested page" before the
        // login form even renders.
        userSrp: true,
        // userPassword: ALLOW_USER_PASSWORD_AUTH — retained so the
        // scripts/create-admin-user.ts script can open an auth session with
        // ADMIN_USER_PASSWORD_AUTH to enroll TOTP before MFA is required.
        userPassword: true,
        // adminUserPassword: ALLOW_ADMIN_USER_PASSWORD_AUTH — same reason.
        adminUserPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [...adminCallbackUrls],
        logoutUrls: [...adminLogoutUrls],
      },
      idTokenValidity: cdk.Duration.hours(1),
      accessTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.hours(1), // Cognito minimum
      enableTokenRevocation: true,
    })

    // -------------------------------------------------------------------------
    // Tenant app client
    //
    // Used by packages/web. OIDC identity providers (Google, GitHub) will be
    // configured here when the main-app auth feature is built.
    // -------------------------------------------------------------------------
    this.tenantAppClient = this.userPool.addClient('TenantAppClient', {
      userPoolClientName: 'tenant-app-client',
      generateSecret: false,
      preventUserExistenceErrors: true,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:5173/auth/callback'],
        logoutUrls: ['http://localhost:5173/login'],
      },
      idTokenValidity: cdk.Duration.hours(8),
      accessTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // -------------------------------------------------------------------------
    // JWKS URL
    //
    // This is a public endpoint; no secret is required to fetch it. The API
    // Lambda uses it to verify JWT signatures without network calls after the
    // first request (keys are cached in-process by the jose library).
    // -------------------------------------------------------------------------
    this.jwksUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/jwks.json`

    // -------------------------------------------------------------------------
    // SSM Parameters — /pegasus/admin/* (separate from /pegasus/dev/*)
    // -------------------------------------------------------------------------
    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: '/pegasus/admin/cognito-user-pool-id',
      stringValue: this.userPool.userPoolId,
      description: 'Pegasus Cognito User Pool ID',
    })

    new ssm.StringParameter(this, 'AdminClientIdParam', {
      parameterName: '/pegasus/admin/cognito-admin-client-id',
      stringValue: this.adminAppClient.userPoolClientId,
      description: 'Pegasus admin portal Cognito app client ID',
    })

    new ssm.StringParameter(this, 'HostedUiDomainParam', {
      parameterName: '/pegasus/admin/cognito-hosted-ui-domain',
      stringValue: hostedUiDomain.baseUrl(),
      description: 'Pegasus Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com)',
    })

    // -------------------------------------------------------------------------
    // CloudFormation Outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      exportName: 'PegasusCognitoUserPoolId',
    })

    new cdk.CfnOutput(this, 'AdminClientId', {
      value: this.adminAppClient.userPoolClientId,
      exportName: 'PegasusCognitoAdminClientId',
    })

    new cdk.CfnOutput(this, 'TenantClientId', {
      value: this.tenantAppClient.userPoolClientId,
      exportName: 'PegasusCognitoTenantClientId',
    })

    new cdk.CfnOutput(this, 'HostedUiBaseUrl', {
      value: hostedUiDomain.baseUrl(),
      exportName: 'PegasusCognitoHostedUiBaseUrl',
    })

    new cdk.CfnOutput(this, 'JwksUrl', {
      value: this.jwksUrl,
      exportName: 'PegasusCognitoJwksUrl',
    })
  }
}
