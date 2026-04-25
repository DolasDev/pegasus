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
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface CognitoStackProps extends cdk.StackProps {
  /**
   * CloudFront distributionDomainName token from FrontendStack (e.g. xxx.cloudfront.net, no protocol).
   * When provided, the CloudFront URL is registered as an allowed OAuth callback/logout URL alongside
   * localhost. CDK resolves this cross-stack token via Fn::ImportValue at deploy time.
   */
  readonly tenantDistributionDomain?: string

  /**
   * CloudFront distributionDomainName token from AdminFrontendStack (e.g. xxx.cloudfront.net, no protocol).
   * When provided, the CloudFront URL is registered as an allowed OAuth callback/logout URL alongside
   * localhost. CDK resolves this cross-stack token via Fn::ImportValue at deploy time.
   */
  readonly adminDistributionDomain?: string
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
   * App client used by apps/mobile for SRP-based driver authentication.
   * No client secret — standard practice for mobile clients.
   */
  public readonly mobileAppClient: cognito.UserPoolClient

  /**
   * JWKS endpoint URL for the user pool.
   * Injected into the API Lambda so it can verify JWTs without any secret.
   */
  public readonly jwksUrl: string

  /**
   * Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com).
   * Injected into frontend config.json at deploy time.
   */
  public readonly hostedUiBaseUrl: string

  constructor(scope: Construct, id: string, props: CognitoStackProps = {}) {
    super(scope, id, props)

    // Construct callback/logout URL arrays from distribution domain tokens.
    // When the domain token is a CloudFormation reference (cross-stack), CDK
    // automatically generates Fn::ImportValue so CloudFormation resolves the
    // real CloudFront hostname before creating/updating the Cognito app client.
    const tenantCallbackUrls = props.tenantDistributionDomain
      ? [
          'http://localhost:5173/login/callback',
          `https://${props.tenantDistributionDomain}/login/callback`,
        ]
      : ['http://localhost:5173/login/callback']
    const tenantLogoutUrls = props.tenantDistributionDomain
      ? ['http://localhost:5173/login', `https://${props.tenantDistributionDomain}/login`]
      : ['http://localhost:5173/login']
    const adminCallbackUrls = props.adminDistributionDomain
      ? [
          'http://localhost:5174/auth/callback',
          `https://${props.adminDistributionDomain}/auth/callback`,
        ]
      : ['http://localhost:5174/auth/callback']
    const adminLogoutUrls = props.adminDistributionDomain
      ? ['http://localhost:5174/login', `https://${props.adminDistributionDomain}/login`]
      : ['http://localhost:5174/login']
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
      // Entry point is in apps/api so Lambda code stays alongside app code.
      entry: path.join(__dirname, '../../../../apps/api/src/cognito/pre-auth.ts'),
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

    // ---------------------------------------------------------------------------
    // Secrets Manager: externally-managed Neon connection string (for Pre-Token Lambda)
    // ---------------------------------------------------------------------------
    const envName = (this.node.tryGetContext('env') as string | undefined) ?? 'dev'
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      `pegasus/${envName}/database-url`,
    )

    // -------------------------------------------------------------------------
    // Pre-Token-Generation Lambda trigger
    //
    // Fires after successful authentication but before the token is securely
    // minted. Injects `custom:tenantId` and `custom:role`.
    // -------------------------------------------------------------------------
    const preTokenFn = new nodejs.NodejsFunction(this, 'PreTokenFunction', {
      functionName: `pegasus-cognito-pre-token-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/cognito/pre-token.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
    })

    dbSecret.grantRead(preTokenFn)

    // Grant the pre-token Lambda read access to the admin client ID SSM parameter.
    // The Lambda reads this at cold start to distinguish admin-app from tenant-app
    // token requests via callerContext.clientId.
    //
    // NOTE: We use a string-literal ARN rather than referencing the SSM construct
    // (created later in this stack). Referencing the construct would create a
    // CloudFormation circular dependency:
    //   Lambda → SSM Param → UserPoolClient → UserPool → Lambda (trigger)
    // The literal ARN is safe — the parameter name is a well-known constant.
    preTokenFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/pegasus/admin/cognito-admin-client-id`,
        ],
      }),
    )

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
        preTokenGeneration: preTokenFn,
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
        resources: [`arn:aws:cognito-idp:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:userpool/*`],
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
    // Used by apps/admin-web (OAuth authorization code grant, no client secret).
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
    // Used by apps/tenant-web for the tenant SSO login flow.
    //
    // Design decisions:
    //   - generateSecret: false — PKCE-only flow; no client secret in the browser.
    //   - No SRP/password flows — tenant users must authenticate via a registered
    //     IdP through the Hosted UI. Direct username/password login is not
    //     offered to tenant users; that path is reserved for admin accounts.
    //   - idTokenValidity: 8h — matches a typical working day session.
    //   - refreshTokenValidity: 30d — allows silent re-auth across days; the
    //     backend will reject expired ID tokens (exp check in validate-token).
    //
    // Adding a new tenant environment (staging, prod):
    //   Pass the CloudFront domain URL in tenantCallbackUrls / tenantLogoutUrls.
    // -------------------------------------------------------------------------
    this.tenantAppClient = this.userPool.addClient('TenantAppClient', {
      userPoolClientName: 'tenant-app-client',
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: {
        // USER_PASSWORD_AUTH: allows tenant admin users to sign in with
        // email + password directly (no Hosted UI redirect) before their
        // organisation's SSO is configured. Regular tenant users still
        // authenticate via the PKCE/SSO flow — this flow is only reachable
        // from the login page when no SSO providers exist for the tenant.
        userPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: [...tenantCallbackUrls],
        logoutUrls: [...tenantLogoutUrls],
      },
      idTokenValidity: cdk.Duration.hours(8),
      accessTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // -------------------------------------------------------------------------
    // Mobile app client
    //
    // Used by apps/mobile for driver authentication via SRP (password) and
    // OAuth2 Authorization Code + PKCE (SSO).
    //
    // Design decisions:
    //   - generateSecret: false — public client; no secret in the mobile app.
    //   - authFlows: { userSrp: true, userPassword: true } — userPassword is
    //     the primary password flow (direct REST API call, fast). userSrp is
    //     retained for Hosted UI compatibility during SSO flows.
    //   - oAuth: authorization code grant with PKCE — used for SSO logins.
    //     The mobile app opens the Cognito Hosted UI in a system browser,
    //     passing identity_provider to route directly to the IdP. The callback
    //     deep link (movingapp://auth/callback) returns the authorization code.
    //   - idTokenValidity: 8h / accessTokenValidity: 8h — matches a driver shift.
    //   - refreshTokenValidity: 30d — allows drivers to stay logged in across days.
    //   - enableTokenRevocation: true — consistent with other clients.
    // -------------------------------------------------------------------------
    this.mobileAppClient = this.userPool.addClient('MobileAppClient', {
      userPoolClientName: 'mobile-app-client',
      generateSecret: false,
      authFlows: { userSrp: true, userPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ['movingapp://auth/callback'],
        logoutUrls: ['movingapp://auth/logout'],
      },
      idTokenValidity: cdk.Duration.hours(8),
      accessTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
      enableTokenRevocation: true,
    })

    // -------------------------------------------------------------------------
    // JWKS URL
    //
    // This is a public endpoint; no secret is required to fetch it. The API
    // Lambda uses it to verify JWT signatures without network calls after the
    // first request (keys are cached in-process by the jose library).
    // -------------------------------------------------------------------------
    this.jwksUrl = `https://cognito-idp.${this.region}.amazonaws.com/${this.userPool.userPoolId}/.well-known/jwks.json`
    this.hostedUiBaseUrl = hostedUiDomain.baseUrl()

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
      description:
        'Pegasus Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com)',
    })

    // Tenant app client parameters — used by the API Lambda for ID token audience
    // validation (COGNITO_TENANT_CLIENT_ID) and by the web app build pipeline.
    new ssm.StringParameter(this, 'TenantClientIdParam', {
      parameterName: '/pegasus/tenant/cognito-client-id',
      stringValue: this.tenantAppClient.userPoolClientId,
      description: 'Pegasus tenant app client ID (no secret — PKCE only)',
    })

    new ssm.StringParameter(this, 'MobileClientIdParam', {
      parameterName: '/pegasus/mobile/cognito-client-id',
      stringValue: this.mobileAppClient.userPoolClientId,
      description: 'Pegasus mobile app client ID (no secret — SRP only)',
    })

    new ssm.StringParameter(this, 'JwksUrlParam', {
      parameterName: '/pegasus/cognito/jwks-url',
      stringValue: this.jwksUrl,
      description: 'Pegasus Cognito JWKS endpoint URL for JWT signature verification',
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

    new cdk.CfnOutput(this, 'MobileClientId', {
      value: this.mobileAppClient.userPoolClientId,
      exportName: 'PegasusCognitoMobileClientId',
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
