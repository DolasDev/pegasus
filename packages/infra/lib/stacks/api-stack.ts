import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
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
import { PEGASUS_AUTHZ_METRIC_NAMESPACE } from '../metrics'

export interface ApiStackProps extends cdk.StackProps {
  /**
   * Name of the upstream CognitoStack — used to build stable Fn::ImportValue
   * strings for the user pool ID, tenant + mobile client IDs, and Hosted UI
   * domain. Same drift-immunity rationale as the frontend-assets / admin-
   * frontend-assets pinning: passing the construct refs directly (e.g.
   * cognitoStack.userPool.userPoolId) makes CDK auto-generate the export
   * logical IDs, and those IDs have empirically drifted across CDK minor
   * versions, blocking cognito-stack updates with "Cannot delete export …".
   *
   * Optional so the stack can still be synthesised in isolation (e.g. during
   * CI typechecks without Cognito). When absent the COGNITO_* env vars
   * default to empty strings and AdminCreateUser IAM grants are skipped.
   */
  readonly cognitoStackName?: string

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
   * SSM parameter name (plain String) holding the SHA-256 hex hash of the
   * agent's Bearer token. Passed through from WireGuardStack; ApiStack reads
   * the value at deploy time and injects it as VPN_AGENT_APIKEY_HASH so the
   * platform-key path in apiClientAuthMiddleware can verify the agent's
   * token without a per-request SSM round-trip or DB lookup. Optional —
   * absent in environments without WireGuardStack, in which case the agent
   * cannot authenticate and the /api/vpn/* routes 401.
   */
  readonly wireguardAgentApiKeyHashParameterName?: string

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

    // Cognito values via stable named imports — see CognitoStack for the
    // pinned CfnOutput declarations and the rationale. The COGNITO_* env vars
    // default to empty strings when no cognitoStackName is supplied so the
    // stack stays synthesisable in isolation (CI typechecks without Cognito).
    const cognitoStackName = props.cognitoStackName
    const importCognito = (logicalId: string): string =>
      cognitoStackName ? cdk.Fn.importValue(`${cognitoStackName}:${logicalId}`) : ''
    const cognitoUserPoolId = importCognito('ExportsOutputRefUserPool6BA7E5F296FD7236')
    const cognitoTenantClientId = importCognito(
      'ExportsOutputRefUserPoolTenantAppClientA86A3129C4F3A42A',
    )
    const cognitoMobileClientId = importCognito(
      'ExportsOutputRefUserPoolMobileAppClient2650C7F34B844422',
    )
    // jwksUrl reuses the pinned UserPool ref — no separate export.
    const cognitoJwksUrl = cognitoStackName
      ? cdk.Fn.join('', [
          `https://cognito-idp.${this.region}.amazonaws.com/`,
          cognitoUserPoolId,
          '/.well-known/jwks.json',
        ])
      : ''
    // Reconstruct the full Hosted UI URL from the pinned domain Ref export so
    // the rendered env var matches the prior construct-token shape byte-for-byte.
    const cognitoHostedUiDomain = cognitoStackName
      ? cdk.Fn.join('', [
          'https://',
          importCognito('ExportsOutputRefUserPoolHostedUiDomainE021B0B644BA1D58'),
          `.auth.${this.region}.amazoncognito.com`,
        ])
      : ''

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
        COGNITO_JWKS_URL: cognitoJwksUrl,
        // Tenant app client ID. Used by /api/auth/validate-token to validate
        // the `aud` claim on Cognito ID tokens. Prevents tokens issued to the
        // admin app client from being accepted as tenant credentials.
        COGNITO_TENANT_CLIENT_ID: cognitoTenantClientId,
        // User Pool ID. Used by POST /api/admin/tenants to provision the
        // initial tenant administrator via Cognito AdminCreateUser.
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        // User Pool ARN — required by AVP CreateIdentitySource when the API
        // provisions a per-tenant policy store (apps/api/src/lib/authz-provision.ts).
        // Built from the imported pool ID + this stack's account/region so it
        // matches whatever pool the rest of this stack is wired against.
        COGNITO_USER_POOL_ARN: cognitoStackName
          ? cdk.Fn.join('', [
              `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/`,
              cognitoUserPoolId,
            ])
          : '',
        // Mobile app client ID. Returned by GET /api/auth/mobile-config so the
        // mobile app can authenticate against Cognito without baking credentials
        // into the app bundle.
        COGNITO_MOBILE_CLIENT_ID: cognitoMobileClientId,
        // Cognito Hosted UI domain. Returned by GET /api/auth/mobile-config so
        // the mobile app can build OAuth authorize URLs for SSO login flows.
        COGNITO_HOSTED_UI_DOMAIN: cognitoHostedUiDomain,
        // WireGuard hub identity — consumed by apps/api/src/handlers/admin/vpn.ts
        // to render client.conf. Absent in environments without WireGuardStack;
        // the handler returns 503 VPN_HUB_UNCONFIGURED.
        WIREGUARD_HUB_PUBLIC_KEY: props.wireguardHubPublicKey ?? '',
        WIREGUARD_HUB_ENDPOINT: props.wireguardHubEndpoint ?? '',
        // Platform-key hash for the WireGuard hub reconcile agent. Resolved
        // at deploy time from SSM (WireGuardStack writes it via custom
        // resource). Empty string when WireGuardStack is absent — the
        // platform-key path in api-client-auth.ts treats empty as disabled.
        VPN_AGENT_APIKEY_HASH: props.wireguardAgentApiKeyHashParameterName
          ? ssm.StringParameter.valueForStringParameter(
              this,
              props.wireguardAgentApiKeyHashParameterName,
            )
          : '',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        // @cedar-policy/cedar-wasm/nodejs loads `${__dirname}/cedar_wasm_bg.wasm`
        // synchronously at module init via require('fs').readFileSync. esbuild
        // can't bundle that — the .wasm asset must live next to the JS file at
        // runtime. Listing the package under `nodeModules` (not externalModules)
        // tells CDK to skip bundling it AND install it as a real node_modules
        // dependency in the Lambda asset, preserving the package layout. Without
        // this, init throws ENOENT on `/var/task/cedar_wasm_bg.wasm` and the
        // Lambda returns a bare API Gateway 500 before our onError sees it.
        nodeModules: ['@cedar-policy/cedar-wasm'],
        // apps/api/src/authz/load.ts reads `cedar.schema.json` and the
        // `policies/` tree from `__dirname` at runtime to push them into AVP
        // (POST /api/admin/tenants → provisionTenantPolicyStore) and to feed
        // the offline cedar-wasm backend. esbuild can't see those reads, so
        // the files have to be copied next to the bundled `index.js` in the
        // Lambda asset; without this, tenant provisioning fails with
        // `ENOENT: /var/task/cedar.schema.json` and the offline /me/permissions
        // path breaks the same way.
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir, outputDir) => [
            `cp ${path.join(__dirname, '../../../../apps/api/src/authz/cedar.schema.json')} ${outputDir}/`,
            `cp -R ${path.join(__dirname, '../../../../apps/api/src/authz/policies')} ${outputDir}/`,
          ],
        },
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
    // Scoped to the specific user pool when cognitoStackName is provided.
    // Skipped entirely when synthesising without the Cognito stack (e.g. CI
    // runs that only synthesise this stack).
    // ---------------------------------------------------------------------------
    if (props.cognitoStackName) {
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
            // The next three (DescribeUserPool, ListUserPoolClients,
            // DescribeUserPoolClient) are required by AVP CreateIdentitySource
            // when attaching a Cognito User Pool. AVP issues these calls
            // against the user pool with the *caller's* credentials to
            // validate that (a) the pool ARN exists, (b) the supplied
            // clientIds are part of that pool, (c) each client's settings
            // are compatible with token-based authorization. The API Lambda
            // never calls them directly, but its role still needs them or
            // POST /api/admin/tenants fails with AccessDeniedException
            // *after* CreatePolicyStore + PutSchema + CreatePolicy succeed —
            // distinguishable only by reading CloudWatch.
            'cognito-idp:DescribeUserPool',
            'cognito-idp:ListUserPoolClients',
            'cognito-idp:DescribeUserPoolClient',
          ],
          resources: [
            `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/${cognitoUserPoolId}`,
          ],
        }),
      )
    }

    // ---------------------------------------------------------------------------
    // IAM: AWS Verified Permissions (Cedar/AVP).
    //
    // Two statements:
    //   1. Per-store ops (IsAuthorized*, BatchIsAuthorized*, lifecycle calls
    //      we use during tenant provisioning) — scoped to any policy-store ARN
    //      in this account because store IDs are minted at runtime by
    //      CreatePolicyStore. AVP doesn't support resource-level conditions on
    //      CreatePolicy / PutSchema / CreateIdentitySource that would let us
    //      tighten this further at IAM time.
    //   2. CreatePolicyStore — account-scoped action (no ARN), so we list it
    //      separately against `*`.
    // ---------------------------------------------------------------------------
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'verifiedpermissions:IsAuthorized',
          'verifiedpermissions:IsAuthorizedWithToken',
          'verifiedpermissions:BatchIsAuthorized',
          'verifiedpermissions:BatchIsAuthorizedWithToken',
          'verifiedpermissions:DeletePolicyStore',
          'verifiedpermissions:PutSchema',
          'verifiedpermissions:CreatePolicy',
          'verifiedpermissions:CreateIdentitySource',
        ],
        resources: [`arn:aws:verifiedpermissions::${this.account}:policy-store/*`],
      }),
    )
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['verifiedpermissions:CreatePolicyStore'],
        resources: ['*'],
      }),
    )

    // ---------------------------------------------------------------------------
    // IAM: read-only EC2 + SSM RunShellScript on the WG hub for the admin
    // VPN diagnose endpoint (apps/api/src/handlers/admin/vpn-diagnose.ts).
    //
    // Describe* are read-only and broadly scoped because EC2 doesn't support
    // resource-level perms on most Describe APIs (AWS limitation, not laziness).
    // SSM SendCommand is scoped to:
    //   - the AWS-RunShellScript document (so we can't run other documents)
    //   - instances tagged Name=pegasus-wireguard-hub (so we can't run on
    //     anything else, even if a tenant ID gets passed in by mistake)
    // GetCommandInvocation has no resource-level scoping in IAM but is a
    // read-only call that returns only commands the role itself initiated.
    // ---------------------------------------------------------------------------
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:DescribeInstances',
          'ec2:DescribeInstanceAttribute',
          'ec2:DescribeSecurityGroups',
          'ec2:DescribeRouteTables',
        ],
        resources: ['*'],
      }),
    )
    // ssm:SendCommand authorizes against BOTH the document and the instance
    // resource. We can't put them in the same PolicyStatement: the
    // `ssm:resourceTag/Name` condition is evaluated per-resource, and the
    // AWS-managed AWS-RunShellScript document doesn't carry customer tags,
    // so the condition fails for the document and the whole statement gets
    // filtered out. Splitting keeps the tag condition where it matters
    // (instance scope = the safety guarantee) and lets the document be
    // referenced unconditionally. Without this split, the diagnose handler
    // 500s with `ssm:SendCommand on resource: arn:aws:ssm:<region>::document/
    // AWS-RunShellScript` AccessDenied even though both ARNs are listed.
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [`arn:aws:ec2:${this.region}:${this.account}:instance/*`],
        conditions: {
          StringEquals: { 'ssm:resourceTag/Name': 'pegasus-wireguard-hub' },
        },
      }),
    )
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        // AWS-managed document ARN — empty account portion is mandatory.
        resources: [`arn:aws:ssm:${this.region}::document/AWS-RunShellScript`],
      }),
    )
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetCommandInvocation'],
        resources: ['*'],
      }),
    )

    // ---------------------------------------------------------------------------
    // AVP policy-store count — scheduled metric emitter
    //
    // Hourly Lambda that counts tenants with a non-null policy_store_id and
    // publishes the value to CloudWatch under Pegasus/Authorization /
    // PolicyStoreCount. Drives the warn/critical alarms in MonitoringStack
    // for the AVP soft quota (~100 stores per Region per AWS account).
    //
    // Bundled separately from the API Lambda so a misbehaving handler can't
    // crash the metric job (and vice-versa). Same DB secret + same external
    // @aws-sdk/* + sourcemaps for parity.
    // ---------------------------------------------------------------------------
    const avpStoreCountLogGroup = new logs.LogGroup(this, 'AvpStoreCountLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const avpStoreCountFunction = new nodejs.NodejsFunction(this, 'AvpStoreCountFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-avp-store-count.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: avpStoreCountLogGroup,
    })

    dbSecret.grantRead(avpStoreCountFunction)

    // PutMetricData has no resource-level scoping in IAM (the Resource field
    // must be `*`); we narrow blast radius with the cloudwatch:namespace
    // condition key so this role can only publish to the Pegasus/Authorization
    // namespace, not to arbitrary customer namespaces.
    avpStoreCountFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': PEGASUS_AUTHZ_METRIC_NAMESPACE },
        },
      }),
    )

    new events.Rule(this, 'AvpStoreCountSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description:
        'Hourly trigger for the AVP policy-store count metric emitter (Pegasus/Authorization/PolicyStoreCount).',
      targets: [new eventsTargets.LambdaFunction(avpStoreCountFunction)],
    })

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

    // ---------------------------------------------------------------------------
    // Pinned cross-stack export for the asset stacks.
    //
    // Same drift problem as b88d9c3 (frontend bucket/distribution refs) and
    // dbda2dd (cognito admin client ref): both FrontendAssetsStack and
    // AdminFrontendAssetsStack consume `apiStack.apiUrl` as a construct-level
    // cross-stack token, which makes CDK auto-generate the output logical ID
    // ExportsOutputFnGetAttPegasusHttpApiF652FECBApiEndpointFD99A5D1. That auto
    // ID is not a stable contract — when it drifts CFN reports
    // "Cannot delete export … as it is in use by …-frontend-assets and
    // …-admin-frontend-assets" and blocks every api-stack update.
    //
    // Fix: own the export name explicitly. Consumers switch to
    // cdk.Fn.importValue against this same string so CDK no longer
    // auto-generates a colliding output and the export contract stays put.
    // ---------------------------------------------------------------------------
    const apiEndpointExport = new cdk.CfnOutput(this, 'AssetsApiEndpointExport', {
      value: httpApi.apiEndpoint,
      exportName: `${this.stackName}:ExportsOutputFnGetAttPegasusHttpApiF652FECBApiEndpointFD99A5D1`,
    })
    apiEndpointExport.overrideLogicalId(
      'ExportsOutputFnGetAttPegasusHttpApiF652FECBApiEndpointFD99A5D1',
    )

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
