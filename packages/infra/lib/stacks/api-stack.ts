import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwv2i from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { type Construct } from 'constructs'

export interface ApiStackProps extends cdk.StackProps {
  /**
   * Cognito User Pool JWKS URL injected into the Lambda so the admin auth
   * middleware and the validate-token endpoint can verify JWTs without a
   * shared secret.
   *
   * Format: https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json
   *
   * Provided by CognitoStack.jwksUrl. Optional so the stack can still be
   * synthesised in isolation (e.g. during CI typechecks without Cognito).
   */
  readonly cognitoJwksUrl?: string

  /**
   * Cognito tenant app client ID.
   * Used by the /api/auth/validate-token endpoint to validate the `aud` claim
   * on Cognito ID tokens, ensuring tokens issued to other app clients (e.g.
   * the admin client) are rejected.
   *
   * Provided by CognitoStack.tenantAppClient.userPoolClientId.
   */
  readonly cognitoTenantClientId?: string

  /**
   * Cognito User Pool ID.
   * Used by the POST /api/admin/tenants endpoint to provision the initial
   * tenant administrator account via AdminCreateUser.
   *
   * Provided by CognitoStack.userPool.userPoolId.
   */
  readonly cognitoUserPoolId?: string

  /**
   * Cognito mobile app client ID.
   * Used by GET /api/auth/mobile-config to return the client ID to the mobile app.
   * Provided by CognitoStack.mobileAppClient.userPoolClientId.
   */
  readonly cognitoMobileClientId?: string

  /**
   * Cognito Hosted UI base URL (e.g. https://pegasus-123.auth.us-east-1.amazoncognito.com).
   * Used by GET /api/auth/mobile-config to return the OAuth domain to the mobile app
   * for SSO login flows.
   * Provided by CognitoStack.hostedUiBaseUrl.
   */
  readonly cognitoHostedUiDomain?: string
}

export class ApiStack extends cdk.Stack {
  /** The HTTP API endpoint URL — used by other stacks to inject into frontend config. */
  public readonly apiUrl: string

  /** The Lambda function name — used by MonitoringStack to scope CloudWatch alarms. */
  public readonly lambdaFunctionName: string

  /** The HTTP API Gateway v2 ID — used by MonitoringStack to scope CloudWatch alarms. */
  public readonly httpApiId: string

  /** The HTTP API Gateway v2 default stage name. */
  public readonly httpApiStage: string = '$default'

  constructor(scope: Construct, id: string, props: ApiStackProps = {}) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // Secrets Manager: externally-managed Neon connection string
    // ---------------------------------------------------------------------------
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      'pegasus/dev/database-url',
    )

    // Explicit log group so retention is set without the deprecated
    // `logRetention` custom-resource Lambda.
    const apiLogGroup = new logs.LogGroup(this, 'ApiLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const apiFunction = new nodejs.NodejsFunction(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      // Entry resolved relative to this file at deploy time by esbuild
      entry: path.join(__dirname, '../../../../apps/api/src/lambda.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        // CloudFormation dynamic reference — resolved to plaintext at deploy time
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        // Structured log level consumed by @aws-lambda-powertools/logger.
        LOG_LEVEL: 'INFO',
        // Cognito JWKS endpoint for JWT verification. Used by:
        //   - adminAuthMiddleware: verifies admin access tokens
        //   - /api/auth/validate-token: verifies tenant ID tokens
        // Keys are cached in-process after the first fetch (jose handles this).
        COGNITO_JWKS_URL: props.cognitoJwksUrl ?? '',
        // Tenant app client ID. Used by /api/auth/validate-token to validate
        // the `aud` claim on Cognito ID tokens. Prevents tokens issued to the
        // admin app client from being accepted as tenant credentials.
        COGNITO_TENANT_CLIENT_ID: props.cognitoTenantClientId ?? '',
        // User Pool ID. Used by POST /api/admin/tenants to provision the
        // initial tenant administrator via Cognito AdminCreateUser.
        COGNITO_USER_POOL_ID: props.cognitoUserPoolId ?? '',
        // Mobile app client ID. Returned by GET /api/auth/mobile-config so the
        // mobile app can authenticate against Cognito without baking credentials
        // into the app bundle.
        COGNITO_MOBILE_CLIENT_ID: props.cognitoMobileClientId ?? '',
        // Cognito Hosted UI domain. Returned by GET /api/auth/mobile-config so
        // the mobile app can build OAuth authorize URLs for SSO login flows.
        COGNITO_HOSTED_UI_DOMAIN: props.cognitoHostedUiDomain ?? '',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      logGroup: apiLogGroup,
    })

    // ---------------------------------------------------------------------------
    // IAM: sm:GetSecretValue to read the Neon connection string
    // ---------------------------------------------------------------------------
    dbSecret.grantRead(apiFunction)

    // ---------------------------------------------------------------------------
    // IAM: cognito-idp:AdminCreateUser to provision tenant admin accounts
    //
    // Scoped to the specific user pool when cognitoUserPoolId is provided.
    // Falls back to a wildcard scoped to account + region when synthesising
    // without the Cognito stack (e.g. CI runs that only synthesise this stack).
    // ---------------------------------------------------------------------------
    if (props.cognitoUserPoolId) {
      apiFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminDisableUser',
            'cognito-idp:AdminEnableUser',
            'cognito-idp:AdminGetUser',
            'cognito-idp:CreateIdentityProvider',
            'cognito-idp:UpdateIdentityProvider',
            'cognito-idp:DeleteIdentityProvider',
          ],
          resources: [
            `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${props.cognitoUserPoolId}`,
          ],
        }),
      )
    }

    // ---------------------------------------------------------------------------
    // API Gateway v2 HTTP API
    // ---------------------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, 'PegasusHttpApi', {
      apiName: 'Pegasus Move Management API',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
        exposeHeaders: ['x-correlation-id'],
      },
    })

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2i.HttpLambdaIntegration('LambdaIntegration', apiFunction),
    })

    this.apiUrl = httpApi.apiEndpoint
    this.lambdaFunctionName = apiFunction.functionName
    this.httpApiId = httpApi.apiId

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      exportName: 'PegasusApiUrl',
    })
  }
}
