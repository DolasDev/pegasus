import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as kms from 'aws-cdk-lib/aws-kms'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigwv2i from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as sqs from 'aws-cdk-lib/aws-sqs'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources'
import * as triggers from 'aws-cdk-lib/triggers'
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

  /**
   * MSSQL-executor Lambda — lives inside the WireGuard VPC and runs SQL
   * against tenant MSSQL servers on overlay IPs. When supplied, the API
   * Lambda's role is granted `lambda:InvokeFunction` and the function name
   * is injected as MSSQL_EXECUTOR_FUNCTION_NAME for mssql-executor-client.ts.
   */
  readonly mssqlExecutorFunction?: lambda.IFunction

  /**
   * Temporal Cloud gRPC endpoint, e.g. `pegasus-staging.chgel.tmprl.cloud:7233`.
   * Surfaced to the API Lambda as TEMPORAL_ADDRESS so apps/api/src/lib/
   * temporal-client.ts can `Connection.connect` against Temporal Cloud when
   * `POST /workflows/:id/run` starts a workflow. Omit (or leave undefined) for
   * dev — the client falls through to a local docker-compose Temporal server.
   */
  readonly temporalAddress?: string

  /**
   * Full Temporal Cloud namespace id (`<short>.<account>`). Mirrors the same
   * value TemporalWorkerStack receives — both halves of the Pegasus side must
   * agree, so we accept it as a sibling prop derived in `bin/app.ts` rather
   * than re-parsing the address here.
   */
  readonly temporalNamespace?: string

  /**
   * Task queue the worker is polling — e.g. `pegasus-stdlib-staging`. Must
   * match TemporalWorkerStack's `TEMPORAL_TASK_QUEUE` exactly, else the API
   * starts workflows on a queue nobody is listening to.
   */
  readonly temporalTaskQueue?: string

  /**
   * FULL Secrets Manager ARN (with the 6-char random suffix) for the Temporal
   * Cloud API-key secret. Same secret TemporalWorkerStack already reads. The
   * full-ARN-with-suffix form is required because Secrets Manager rejects the
   * no-suffix form CDK's `fromSecretNameV2` produces — see TEMPORAL_SECRET_ARNS
   * in bin/app.ts (and `[[feedback_cdk_secret_complete_arn_for_ecs]]`).
   *
   * For Lambda we read the secret value at runtime in temporal-client.ts (no
   * `ecs.Secret` injection involved), but threading the full ARN end-to-end
   * gives the IAM grant a precise resource AND keeps shape parity with the
   * worker side.
   */
  readonly temporalCloudSecretArn?: string

  /**
   * FULL Secrets Manager ARN (with the 6-char random suffix) for the
   * worker→API broker shared secret. The internal handlers
   * (POST /workflow-runtime-token, PATCH /workflow-executions/:id) compare
   * the `X-Workflow-Broker-Secret` request header against this value.
   */
  readonly workflowBrokerSecretArn?: string
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
    // RingCentral SMS capture — refresh-token secrets.
    //
    // The OAuth callback (api Lambda) creates one Secrets Manager secret per
    // connection under `pegasus/<env>/ringcentral/<connectionId>`, and the
    // token-refresh cron (below) reads + rotates it. Scope the grant to that
    // name prefix (the wildcard covers Secrets Manager's random ARN suffix).
    // Inert until RINGCENTRAL_ENABLED=true; the prefix env is safe to set now so
    // secret naming is correct per environment.
    // ---------------------------------------------------------------------------
    const ringcentralSecretPrefix = `pegasus/${envName}/ringcentral`
    const ringcentralSecretArnPattern = `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${ringcentralSecretPrefix}/*`
    const ringcentralSecretPolicy = new iam.PolicyStatement({
      actions: [
        'secretsmanager:CreateSecret',
        'secretsmanager:PutSecretValue',
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret',
      ],
      resources: [ringcentralSecretArnPattern],
    })
    apiFunction.addToRolePolicy(ringcentralSecretPolicy)
    apiFunction.addEnvironment('RINGCENTRAL_SECRET_PREFIX', ringcentralSecretPrefix)

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
    // KMS: workflow runtime token key.
    //
    // Each curated workflow, at finalize and at fork, is issued its own scoped
    // vnd_ runtime API key (apps/api/src/handlers/workflows.ts). The plaintext
    // key is encrypted with this key and only the ciphertext is persisted on
    // the workflow row; apps/api/src/lib/runtime-token-crypto.ts reads the key
    // id from WORKFLOW_TOKEN_KMS_KEY_ID. grantEncryptDecrypt covers both the
    // finalize/fork encrypt path and the future worker-credential decrypt path.
    // ---------------------------------------------------------------------------
    const workflowTokenKey = new kms.Key(this, 'WorkflowTokenKey', {
      description: 'Encrypts per-workflow runtime service-account API keys.',
      enableKeyRotation: true,
    })
    workflowTokenKey.grantEncryptDecrypt(apiFunction)
    apiFunction.addEnvironment('WORKFLOW_TOKEN_KMS_KEY_ID', workflowTokenKey.keyId)

    // ---------------------------------------------------------------------------
    // Temporal Cloud client (Phase 2 Unit 6).
    //
    // POST /workflows/:id/run uses `client.workflow.start` against Temporal
    // Cloud. The client (apps/api/src/lib/temporal-client.ts) reads:
    //   - TEMPORAL_ADDRESS         — gRPC endpoint
    //   - TEMPORAL_NAMESPACE       — full namespace id (`<short>.<account>`)
    //   - TEMPORAL_TASK_QUEUE      — must match TemporalWorkerStack's queue
    //   - TEMPORAL_CLOUD_SECRET_ARN — full ARN of the JSON {apiKey} secret
    //
    // The Lambda uses the AWS SDK to GetSecretValue at startup, caching the
    // result for the container lifetime — unlike ECS task-secret injection,
    // Lambda has no `ecs.Secret` equivalent; the SDK call is the contract.
    //
    // Skipped entirely when no temporalCloudSecretArn was supplied (dev or
    // a pre-Phase-2 environment) — the client falls through to a localhost
    // dev-server connect when TEMPORAL_ADDRESS is unset.
    // ---------------------------------------------------------------------------
    if (
      props.temporalAddress &&
      props.temporalNamespace &&
      props.temporalTaskQueue &&
      props.temporalCloudSecretArn
    ) {
      apiFunction.addEnvironment('TEMPORAL_ADDRESS', props.temporalAddress)
      apiFunction.addEnvironment('TEMPORAL_NAMESPACE', props.temporalNamespace)
      apiFunction.addEnvironment('TEMPORAL_TASK_QUEUE', props.temporalTaskQueue)
      // `fromSecretCompleteArn` is the form that matches the no-suffix-rejection
      // bug captured in the bin/app.ts comment. Lambda's runtime SDK call works
      // with either form, but threading the full ARN here gives the IAM grant
      // a precise resource AND keeps shape parity with TemporalWorkerStack.
      const temporalSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'TemporalCloudSecret',
        props.temporalCloudSecretArn,
      )
      // Inject the apiKey JSON field as a plaintext env var. CloudFormation
      // resolves the secretsmanager:GetSecretValue dynamic reference at
      // deploy time; the Lambda boots with a literal string and the client
      // (lib/temporal-client.ts) reads it from `process.env`. Matches the
      // DATABASE_URL pattern above — no AWS SDK call needed at runtime.
      apiFunction.addEnvironment(
        'TEMPORAL_CLOUD_API_KEY',
        temporalSecret.secretValueFromJson('apiKey').unsafeUnwrap(),
      )
      temporalSecret.grantRead(apiFunction)
    }

    // ---------------------------------------------------------------------------
    // Workflow broker shared-secret (Phase 2 Unit 6).
    //
    // Gates the two internal endpoints under /api/v1/internal/* — the worker
    // presents this in the `X-Workflow-Broker-Secret` header on every call.
    // Read once at request time via process.env (the Lambda startup hot path
    // need not pre-fetch; the secret value is injected as a plaintext env var
    // via the same Secrets Manager pattern used for DATABASE_URL above).
    // ---------------------------------------------------------------------------
    if (props.workflowBrokerSecretArn) {
      const brokerSecret = secretsmanager.Secret.fromSecretCompleteArn(
        this,
        'WorkflowBrokerSecret',
        props.workflowBrokerSecretArn,
      )
      // Materialise the secret string as a deploy-time env var on the function.
      // Mirrors how DATABASE_URL is fed in — at runtime the handler reads
      // `process.env.WORKFLOW_BROKER_SECRET` directly, no AWS SDK call.
      apiFunction.addEnvironment('WORKFLOW_BROKER_SECRET', brokerSecret.secretValue.unsafeUnwrap())
      // Also grant read so a future code path that wants the live value via
      // GetSecretValue (e.g. for rotation) has IAM coverage already.
      brokerSecret.grantRead(apiFunction)
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
    // MSSQL executor — grant invoke + surface function name as env var.
    // apps/api/src/lib/mssql-executor-client.ts reads MSSQL_EXECUTOR_FUNCTION_NAME
    // and throws EXECUTOR_NOT_CONFIGURED if unset, so ApiStack stays
    // synthesizable in environments without WireGuardStack.
    // ---------------------------------------------------------------------------
    if (props.mssqlExecutorFunction) {
      props.mssqlExecutorFunction.grantInvoke(apiFunction)
      apiFunction.addEnvironment(
        'MSSQL_EXECUTOR_FUNCTION_NAME',
        props.mssqlExecutorFunction.functionName,
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
    // RingCentral token-refresh cron
    //
    // Keeps every active RingCentral connection's OAuth refresh token warm
    // (RC refresh tokens lapse if unused). Reads + rotates the per-connection
    // secret in Secrets Manager. Inert until RINGCENTRAL_ENABLED=true (the
    // handler no-ops when readOAuthConfig() returns null), so it is safe to
    // schedule now. RingCentral OAuth client id/secret + state secret are
    // injected as env vars when the platform RC app is registered.
    // ---------------------------------------------------------------------------
    const ringcentralTokenRefreshLogGroup = new logs.LogGroup(
      this,
      'RingCentralTokenRefreshLogGroup',
      {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    )

    const ringcentralTokenRefreshFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralTokenRefreshFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-token-refresh.ts'),
        handler: 'handler',
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
          LOG_LEVEL: 'INFO',
          RINGCENTRAL_SECRET_PREFIX: ringcentralSecretPrefix,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*'],
        },
        memorySize: 256,
        timeout: cdk.Duration.minutes(2),
        logGroup: ringcentralTokenRefreshLogGroup,
      },
    )

    dbSecret.grantRead(ringcentralTokenRefreshFunction)
    ringcentralTokenRefreshFunction.addToRolePolicy(ringcentralSecretPolicy)

    new events.Rule(this, 'RingCentralTokenRefreshSchedule', {
      // RC access tokens live ~1h and refresh tokens lapse after inactivity;
      // refresh every 30 min to stay comfortably ahead of both.
      schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
      description: 'Refreshes RingCentral OAuth tokens for active connections.',
      targets: [new eventsTargets.LambdaFunction(ringcentralTokenRefreshFunction)],
    })

    // ---------------------------------------------------------------------------
    // RingCentral reconciliation-sync cron
    //
    // Pulls SMS from both stores for every active connection (Unit 7). Primary
    // capture path until the webhook lands (Phase 2), then the low-frequency
    // safety net. Reuses the same Secrets-Manager grant (the sync rotates the
    // token via acquireAccessToken). Inert until RINGCENTRAL_ENABLED=true.
    // ---------------------------------------------------------------------------
    const ringcentralSyncLogGroup = new logs.LogGroup(this, 'RingCentralSyncLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const ringcentralSyncFunction = new nodejs.NodejsFunction(this, 'RingCentralSyncFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-sync.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
        RINGCENTRAL_SECRET_PREFIX: ringcentralSecretPrefix,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 512,
      // Generous — a backfill FSync across many connections paginates serially.
      timeout: cdk.Duration.minutes(5),
      logGroup: ringcentralSyncLogGroup,
    })

    dbSecret.grantRead(ringcentralSyncFunction)
    ringcentralSyncFunction.addToRolePolicy(ringcentralSecretPolicy)

    new events.Rule(this, 'RingCentralSyncSchedule', {
      // Safety-net cadence — near-real-time comes from the webhook (Phase 2).
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: 'RingCentral reconciliation sync (dual-store SMS capture).',
      targets: [new eventsTargets.LambdaFunction(ringcentralSyncFunction)],
    })

    // ---------------------------------------------------------------------------
    // RingCentral subscription-renewal cron
    //
    // Ensures each active connection has a healthy webhook subscription
    // (create / renew / recreate). Inert until RINGCENTRAL_ENABLED=true AND
    // RINGCENTRAL_WEBHOOK_URL is set (the shared webhook delivery address,
    // injected per env once the public webhook route exists — Unit 10).
    // ---------------------------------------------------------------------------
    const ringcentralRenewLogGroup = new logs.LogGroup(this, 'RingCentralRenewLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const ringcentralRenewFunction = new nodejs.NodejsFunction(this, 'RingCentralRenewFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-renew.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
        RINGCENTRAL_SECRET_PREFIX: ringcentralSecretPrefix,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 256,
      timeout: cdk.Duration.minutes(2),
      logGroup: ringcentralRenewLogGroup,
    })

    dbSecret.grantRead(ringcentralRenewFunction)
    ringcentralRenewFunction.addToRolePolicy(ringcentralSecretPolicy)

    new events.Rule(this, 'RingCentralRenewSchedule', {
      // Subscriptions live ~7 days; renew within 24h of expiry. Hourly is
      // comfortably ahead and recreates a blacklisted sub within the hour.
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      description: 'Ensures RingCentral webhook subscriptions stay alive.',
      targets: [new eventsTargets.LambdaFunction(ringcentralRenewFunction)],
    })

    // ---------------------------------------------------------------------------
    // RingCentral capture queue + worker (the near-real-time path)
    //
    // The webhook fast-acks by enqueuing a capture job; this SQS-triggered worker
    // runs the idempotent sync pull for the job's connection. A DLQ captures
    // poison messages after maxReceiveCount. The api Lambda gets the queue URL
    // (so enqueueCapture sends) + sqs:SendMessage. Inert until a subscription
    // delivers an event (flag off → no webhook traffic).
    // ---------------------------------------------------------------------------
    const ringcentralCaptureDlq = new sqs.Queue(this, 'RingCentralCaptureDLQ', {
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    })
    const ringcentralCaptureQueue = new sqs.Queue(this, 'RingCentralCaptureQueue', {
      // Must be >= the worker's timeout so an in-flight message isn't redelivered.
      visibilityTimeout: cdk.Duration.minutes(6),
      enforceSSL: true,
      deadLetterQueue: { queue: ringcentralCaptureDlq, maxReceiveCount: 5 },
    })

    const ringcentralCaptureLogGroup = new logs.LogGroup(this, 'RingCentralCaptureLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const ringcentralCaptureFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralCaptureFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-capture.ts'),
        handler: 'handler',
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
          LOG_LEVEL: 'INFO',
          RINGCENTRAL_SECRET_PREFIX: ringcentralSecretPrefix,
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        memorySize: 512,
        timeout: cdk.Duration.minutes(5),
        logGroup: ringcentralCaptureLogGroup,
      },
    )

    dbSecret.grantRead(ringcentralCaptureFunction)
    ringcentralCaptureFunction.addToRolePolicy(ringcentralSecretPolicy)
    ringcentralCaptureFunction.addEventSource(
      new lambdaEventSources.SqsEventSource(ringcentralCaptureQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    )

    // Wire the webhook (api Lambda) as the producer.
    ringcentralCaptureQueue.grantSendMessages(apiFunction)
    apiFunction.addEnvironment('RINGCENTRAL_WEBHOOK_QUEUE_URL', ringcentralCaptureQueue.queueUrl)

    // ---------------------------------------------------------------------------
    // RingCentral on-prem forwarder cron
    //
    // Drains the MessageForwardOutbox and writes captured SMS to each tenant's
    // on-prem SQL Server through the in-VPC mssql-executor (the same path the
    // migrated longhaul handlers use — no new VPC Lambda). The idempotent MERGE
    // makes the at-least-once drain effectively-once. Inert until
    // RINGCENTRAL_ENABLED=true (nothing captures → empty outbox → no-op); and a
    // no-op too where mssqlExecutorFunction is absent (the row just parks PENDING).
    // ---------------------------------------------------------------------------
    const ringcentralForwardLogGroup = new logs.LogGroup(this, 'RingCentralForwardLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const ringcentralForwardFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralForwardFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-forward.ts'),
        handler: 'handler',
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
          LOG_LEVEL: 'INFO',
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        memorySize: 512,
        timeout: cdk.Duration.minutes(5),
        logGroup: ringcentralForwardLogGroup,
      },
    )

    dbSecret.grantRead(ringcentralForwardFunction)
    // The forwarder reaches tenant MSSQL by synchronously invoking the in-VPC
    // executor — same MSSQL_EXECUTOR_FUNCTION_NAME contract as the api Lambda.
    if (props.mssqlExecutorFunction) {
      props.mssqlExecutorFunction.grantInvoke(ringcentralForwardFunction)
      ringcentralForwardFunction.addEnvironment(
        'MSSQL_EXECUTOR_FUNCTION_NAME',
        props.mssqlExecutorFunction.functionName,
      )
    }

    new events.Rule(this, 'RingCentralForwardSchedule', {
      // Drains the outbox often enough to keep on-prem near-real-time without
      // hammering it; backoff/jitter inside the Lambda spaces out retries.
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Forwards captured RingCentral SMS to the on-prem SQL Server.',
      targets: [new eventsTargets.LambdaFunction(ringcentralForwardFunction)],
    })

    // ---------------------------------------------------------------------------
    // RingCentral buffer-purge cron (PII retention)
    //
    // Neon is a transient buffer; on-prem is authoritative once SENT. This cron
    // nulls forwarded message bodies past their 72h window and hard-deletes SENT
    // tombstones older than 30 days. DB-only (no executor / no RC secrets).
    // Inert until messages exist (empty table → no-op).
    // ---------------------------------------------------------------------------
    const ringcentralBufferPurgeLogGroup = new logs.LogGroup(
      this,
      'RingCentralBufferPurgeLogGroup',
      {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    )

    const ringcentralBufferPurgeFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralBufferPurgeFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-buffer-purge.ts'),
        handler: 'handler',
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
          LOG_LEVEL: 'INFO',
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        memorySize: 256,
        timeout: cdk.Duration.minutes(5),
        logGroup: ringcentralBufferPurgeLogGroup,
      },
    )

    dbSecret.grantRead(ringcentralBufferPurgeFunction)

    new events.Rule(this, 'RingCentralBufferPurgeSchedule', {
      // Every 6h keeps the PII body's worst-case lifetime ≈ 72h window + 6h.
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      description: 'Purges forwarded RingCentral SMS bodies + old tombstones from Neon.',
      targets: [new eventsTargets.LambdaFunction(ringcentralBufferPurgeFunction)],
    })

    // ---------------------------------------------------------------------------
    // AVP policy reconciliation — deploy-time Trigger
    //
    // Tenant policy stores are provisioned at tenant-create time
    // (provisionTenantPolicyStore in apps/api/src/lib/authz-provision.ts), which
    // means policy-file changes in the repo only land for tenants created
    // AFTER the change. Pre-existing tenants would silently keep their stale
    // Cedar policies — and a renamed or removed group leaves their users with
    // no matching permit clause (this is what bit CI when 20-tenant-user.cedar
    // became 20-viewer.cedar).
    //
    // The Trigger here invokes a Lambda after the API function is updated; the
    // Lambda enumerates every tenant with a non-null policyStoreId and
    // reconciles their AVP store onto the current `.cedar` files (delete all
    // static policies, recreate from disk). Idempotent — safe to re-run.
    //
    // Why a Trigger (not a CustomResource with content-hash keying): the
    // operation is fast and idempotent, and we WANT a no-op deploy to verify
    // policies still match what's on disk rather than trust a hash. Trigger
    // runs every deploy; the Lambda completes in single-digit seconds for the
    // current tenant count and fails the deploy loudly if any tenant's
    // reconciliation breaks.
    // ---------------------------------------------------------------------------
    const syncAvpPoliciesLogGroup = new logs.LogGroup(this, 'SyncAvpPoliciesLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const syncAvpPoliciesFunction = new nodejs.NodejsFunction(this, 'SyncAvpPoliciesFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-sync-avp-policies.ts'),
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
        // The reconciliation function reads `apps/api/src/authz/policies/`
        // (via loadPolicies) and `cedar.schema.json` (via loadSchemaJson) at
        // runtime — same packaging trick as the main API Lambda. Without
        // these copies the handler crashes with ENOENT before it can list
        // any tenant. Schema is needed because PutSchema runs first on every
        // reconcile to bring stale tenant stores up to date with any new
        // actions added since their original provisioning.
        commandHooks: {
          beforeBundling: () => [],
          beforeInstall: () => [],
          afterBundling: (_inputDir, outputDir) => [
            `cp ${path.join(__dirname, '../../../../apps/api/src/authz/cedar.schema.json')} ${outputDir}/`,
            `cp -R ${path.join(__dirname, '../../../../apps/api/src/authz/policies')} ${outputDir}/`,
          ],
        },
      },
      memorySize: 256,
      // Reconciliation is bounded by tenant count × ~15 policies × ~2 AVP
      // calls each. At staging scale (~7 tenants) this finishes in <10s; the
      // 5-minute budget gives plenty of slack for AVP throttling on a larger
      // production tenant base.
      timeout: cdk.Duration.minutes(5),
      logGroup: syncAvpPoliciesLogGroup,
    })

    dbSecret.grantRead(syncAvpPoliciesFunction)

    // IAM: ListPolicies + DeletePolicy + CreatePolicy across any policy store
    // in this account. Store IDs are minted at runtime by CreatePolicyStore so
    // we can't tighten the resource ARN beyond the wildcard the rest of the
    // AVP IAM block uses.
    syncAvpPoliciesFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'verifiedpermissions:ListPolicies',
          'verifiedpermissions:CreatePolicy',
          'verifiedpermissions:DeletePolicy',
          'verifiedpermissions:PutSchema',
        ],
        resources: [`arn:aws:verifiedpermissions::${this.account}:policy-store/*`],
      }),
    )

    new triggers.Trigger(this, 'SyncAvpPoliciesTrigger', {
      handler: syncAvpPoliciesFunction,
      // Run AFTER the main API Lambda is updated so any new code that depends
      // on freshly-reconciled policies (e.g. handlers referencing a new
      // persona group) sees them in place from the first invocation.
      executeAfter: [apiFunction],
      // REQUEST_RESPONSE so a failure here surfaces as a CFN deploy failure
      // instead of fire-and-forget.
      invocationType: triggers.InvocationType.REQUEST_RESPONSE,
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

    new cdk.CfnOutput(this, 'WorkflowTokenKeyArn', {
      value: workflowTokenKey.keyArn,
      exportName: 'PegasusWorkflowTokenKeyArn',
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
