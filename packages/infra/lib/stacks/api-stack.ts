import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwv2i from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import type * as s3 from 'aws-cdk-lib/aws-s3'
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

  /**
   * S3 bucket for document uploads. Provided by DocumentsStack.
   * When supplied, the API Lambda is granted ReadWrite + Delete on the
   * bucket and receives the bucket name via the DOCUMENTS_BUCKET_NAME env var.
   * Optional so the stack can still be synthesised in isolation.
   */
  readonly documentsBucket?: s3.IBucket

  /**
   * Hub Curve25519 public key. Passed through from WireGuardStack. Surfaced
   * to the API Lambda as WIREGUARD_HUB_PUBLIC_KEY so the VPN admin handler
   * can render it into tenant client.conf blobs without an extra SSM round-trip.
   * Optional — when absent the VPN provision endpoint returns 503
   * VPN_HUB_UNCONFIGURED, which is the correct behaviour in environments
   * without WireGuardStack.
   */
  readonly wireguardHubPublicKey?: string

  /**
   * Tenant-facing hub endpoint (`<eip>:51820`). Passed through from
   * WireGuardStack. Injected as WIREGUARD_HUB_ENDPOINT.
   */
  readonly wireguardHubEndpoint?: string

  /**
   * Tunnel-proxy Lambda — lives inside the WireGuard VPC and is the only
   * path from the public-egress API Lambda to tenant overlay IPs. When
   * supplied, the API Lambda's role is granted `lambda:InvokeFunction`
   * and the function name is injected as TUNNEL_PROXY_FUNCTION_NAME so
   * application code can build the InvokeCommand.
   */
  readonly tunnelProxyFunction?: lambda.IFunction
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
    const envName = (this.node.tryGetContext('env') as string | undefined) ?? 'dev'
    const dbSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'NeonDatabaseUrl',
      `pegasus/${envName}/database-url`,
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
        // WireGuard hub identity — consumed by apps/api/src/handlers/admin/vpn.ts
        // to render client.conf. Absent in environments without WireGuardStack;
        // the handler returns 503 VPN_HUB_UNCONFIGURED.
        WIREGUARD_HUB_PUBLIC_KEY: props.wireguardHubPublicKey ?? '',
        WIREGUARD_HUB_ENDPOINT: props.wireguardHubEndpoint ?? '',
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
    // S3 documents bucket — grant scoped read/write/delete and inject the
    // bucket name as an environment variable. grantReadWrite covers
    // GetObject + PutObject; grantDelete is added explicitly so the future
    // hard-delete worker can reuse the same role pattern.
    // ---------------------------------------------------------------------------
    if (props.documentsBucket) {
      props.documentsBucket.grantReadWrite(apiFunction)
      props.documentsBucket.grantDelete(apiFunction)
      apiFunction.addEnvironment('DOCUMENTS_BUCKET_NAME', props.documentsBucket.bucketName)
    }

    // ---------------------------------------------------------------------------
    // Tunnel proxy — grant invoke + surface function name as env var.
    // apps/api/src/lib/tunnel-client.ts reads TUNNEL_PROXY_FUNCTION_NAME and
    // falls back to throwing a VPN_NOT_ROUTED error if the var is unset, so
    // ApiStack remains synthesizable in environments without WireGuardStack.
    // ---------------------------------------------------------------------------
    if (props.tunnelProxyFunction) {
      props.tunnelProxyFunction.grantInvoke(apiFunction)
      apiFunction.addEnvironment(
        'TUNNEL_PROXY_FUNCTION_NAME',
        props.tunnelProxyFunction.functionName,
      )
    }

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

    // Publish the API URL to the SSM path the WireGuard hub user-data reads
    // at boot. WireGuardStack must deploy before ApiStack (it owns the hub
    // public key + endpoint that ApiStack consumes), so we cannot pass this
    // URL as a constructor prop without a circular dependency. SSM bridges
    // the gap: ApiStack writes here, WireGuardStack's user-data fetches at
    // instance launch.
    new ssm.StringParameter(this, 'WireGuardAdminApiUrlParam', {
      parameterName: '/pegasus/wireguard/agent/admin-api-url',
      stringValue: httpApi.apiEndpoint,
      description: 'API endpoint the WireGuard hub reconcile agent polls.',
    })
  }
}
