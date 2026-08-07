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
import type * as ec2 from 'aws-cdk-lib/aws-ec2'
import type * as s3 from 'aws-cdk-lib/aws-s3'
import { type Construct } from 'constructs'
import {
  PEGASUS_AUTHZ_METRIC_NAMESPACE,
  PEGASUS_RINGCENTRAL_METRIC_NAMESPACE,
  PEGASUS_WORKFLOWS_METRIC_NAMESPACE,
  PEGASUS_RATING_METRIC_NAMESPACE,
} from '../metrics'

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
   * VPN_HUB_UNCONFIGURED, which is the correct behavior in environments
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

  /**
   * WireGuard-VPC PRIVATE_WITH_EGRESS subnets tenant-runner tasks launch
   * into (Phase 3 Unit 9) — `wireguardStack.temporalWorkerSubnets`, the same
   * group the stdlib worker uses. Combined with `tenantRunnerSecurityGroup`
   * and the Temporal config, these unlock the dispatcher's `ecs:RunTask`
   * wiring (TENANT_RUNNER_* env + IAM). Omit in dev / Temporal-less envs —
   * the dispatcher lib then no-ops cleanly (loadTenantRunnerConfig → null).
   */
  readonly tenantRunnerSubnets?: ec2.ISubnet[]

  /**
   * Egress-only security group for tenant-runner tasks
   * (`wireguardStack.tenantRunnerSecurityGroup`). Lives on WireGuardStack —
   * not TemporalWorkerStack — because TemporalWorkerStack depends on this
   * stack, so referencing one of its constructs here would be a cycle.
   */
  readonly tenantRunnerSecurityGroup?: ec2.ISecurityGroup

  /**
   * Master switch for the RingCentral SMS capture integration. When true:
   *   - `RINGCENTRAL_ENABLED=true` is set on the api Lambda (unlocks the
   *     bring-your-own-JWT connect endpoint) and on the capture / sync / renew /
   *     token-refresh crons (whose `readOAuthConfig()` no-ops while unset), and
   *   - `RINGCENTRAL_WEBHOOK_URL` (the public delivery address RingCentral POSTs
   *     events to) is set on the renew cron — the only Lambda that registers and
   *     renews the per-connection RingCentral subscription via their API. The URL
   *     is derived from the stack's own HTTP API endpoint, so there is no manual
   *     RingCentral-console webhook setup.
   *
   * Inert-safe: with zero connected tenants every cron is a no-op, no
   * subscription is created, and no webhook traffic flows — nothing happens until
   * a tenant pastes their RingCentral credentials in the UI. Default off; enabled
   * for prod in bin/app.ts.
   */
  readonly ringcentralEnabled?: boolean

  /**
   * Master switch for publishing integration-validator config from the DB-backed
   * store. When true, `INTEGRATION_CONFIG_PUBLISH_ENABLED=true` is set on the api
   * Lambda, ungating the mutating endpoints (`POST /config`, rollback). The
   * dry-run `/config/validate` and read paths are never gated by it.
   *
   * Inert-safe: publishing GLOBAL requires a platform-tenant `vnd_` key carrying
   * `Actions.PublishIntegrationConfig`; until one publishes, the validator keeps
   * serving the built-in code config. Default off; enabled for staging (QA) in
   * bin/app.ts — see plans/todo/integration-config-dogfood-publish.md (prod is a
   * separate Phase-5 rollout).
   */
  readonly integrationConfigPublishEnabled?: boolean

  /**
   * Master switch for the SHARED tier of the outbound OAuth2 token cache
   * (sdk-feedback 0027). When true, `OUTBOUND_OAUTH_SHARED_CACHE_ENABLED=true` is
   * set on the api Lambda, so containers reuse a minted partner token through the
   * `outbound_oauth_tokens` table instead of each re-minting on a cold start.
   *
   * Default off. Off, `call_external` behaves exactly as before (per-container
   * in-memory cache only) — which is also the state in which the new
   * `outbound oauth token` log line measures how often containers actually are
   * reused, the open question behind 0027. Turning it on is a behavior change a
   * partner could object to (token reuse), so it is a flag rather than a rollout.
   */
  readonly outboundOAuthSharedCacheEnabled?: boolean

  /**
   * Master switch for the feedback (magic-link surveys) feature. When true,
   * `FEEDBACK_ENABLED=true` is set on the api Lambda, ungating the whole feedback
   * surface: the FeedbackForm authoring routes, the FeedbackRequest mint, and the
   * public respond endpoint (all 404 when off). `feedbackPublicWebUrl` is set
   * alongside so the mint can build the capability link.
   *
   * Inert-safe: a tenant must first publish a form (a `vnd_` key carrying
   * `Actions.ManageFeedbackForms`) and a workflow must mint a request before any
   * link exists. Only env vars are set — no IAM/secret wiring (the store is the
   * shared Neon DB). Default off.
   */
  readonly feedbackEnabled?: boolean

  /**
   * Public base URL of the tenant SPA, used to build the feedback capability link
   * (`<url>/f/<token>`). Threaded from bin/app.ts per environment (the same
   * tenant-web origin used for CORS). Only consulted when `feedbackEnabled`.
   */
  readonly feedbackPublicWebUrl?: string

  /**
   * Browser origins allowed to call the API cross-origin. Threaded from
   * bin/app.ts per environment (tenant + admin SPA hostnames in staging/prod).
   * Applied at BOTH layers from this single source of truth:
   *   - API Gateway `corsPreflight.allowOrigins` (authoritative for OPTIONS in
   *     deployed environments), and
   *   - the Lambda env var `CORS_ALLOWED_ORIGINS` consumed by the Hono cors
   *     middleware (defense in depth / direct-served path).
   * Omit (dev) → `['*']` at API GW and an empty env var → Hono reflects any
   * origin, preserving the original permissive dev behavior.
   */
  readonly corsAllowedOrigins?: string[]
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

  /** The RingCentral capture DLQ name — used by MonitoringStack to alarm on depth. */
  public readonly ringcentralCaptureDlqName: string

  /**
   * Main API Lambda log-group name — passed to MonitoringStack for the
   * `pegasus/api-errors-by-route` and `pegasus/trace-by-correlation-id`
   * Insights query definitions.
   */
  public readonly apiLogGroupName: string

  /**
   * API Gateway access-log group name — passed to MonitoringStack for the
   * `pegasus/api-access-by-route` Insights query (gateway-side per-endpoint
   * status + traffic view, complementing the in-handler latency queries).
   */
  public readonly apiAccessLogGroupName: string

  /**
   * Scheduled-Lambda log-group names (cron functions) — passed to
   * MonitoringStack for the `pegasus/cron-failures` Insights query. Includes
   * every cron log group that is always created; Temporal-gated groups
   * (reconcile, dispatch-triggers) are appended when a Temporal address is
   * configured.
   */
  public readonly cronLogGroupNames: string[]

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
    this.apiLogGroupName = apiLogGroup.logGroupName

    // Collected as cron log groups are created below; assigned to the public
    // readonly prop at the end of the constructor.
    const cronLogGroupNames: string[] = []

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
      runtime: lambda.Runtime.NODEJS_24_X,
      // Entry resolved relative to this file at deploy time by esbuild
      entry: path.join(__dirname, '../../../../apps/api/src/lambda.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        // CloudFormation dynamic reference — resolved to plaintext at deploy time
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        // Structured log level consumed by @aws-lambda-powertools/logger.
        LOG_LEVEL: 'INFO',
        // Defensive: if an X-Ray-captured downstream client (mssql-executor /
        // tunnel-proxy invoke) is ever called outside an active segment, log
        // the context-missing condition instead of throwing a runtime error
        // (the SDK default). Active tracing normally guarantees a segment.
        AWS_XRAY_CONTEXT_MISSING: 'LOG_ERROR',
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
      // Active X-Ray tracing so the next p99 spike is attributable to a
      // downstream segment (Neon vs mssql-executor invoke vs tunnel invoke)
      // rather than a 16-29s black box. The two Lambda-invoke clients are
      // wrapped with captureAWSv3Client (see mssql-executor-client.ts /
      // tunnel-client.ts) so each downstream call renders as its own subsegment.
      tracing: lambda.Tracing.ACTIVE,
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
    // Integration-config publishing master switch. Ungates the mutating config
    // endpoints (publish + rollback); the dry-run validate and read paths stay
    // open regardless. Inert until a platform-tenant vnd_ key publishes (see
    // ApiStackProps.integrationConfigPublishEnabled). Only the env var is set —
    // no IAM/secret wiring is needed (the store is the shared Neon DB).
    // ---------------------------------------------------------------------------
    if (props.integrationConfigPublishEnabled) {
      apiFunction.addEnvironment('INTEGRATION_CONFIG_PUBLISH_ENABLED', 'true')
    }

    // ---------------------------------------------------------------------------
    // Outbound OAuth shared token cache master switch (sdk-feedback 0027). Like
    // the flag above, only the env var is set: the store is the shared Neon DB,
    // and the KMS envelope reuses workflowTokenKey, on which this Lambda already
    // holds grantEncryptDecrypt (see below) — so there is no new IAM to wire.
    // ---------------------------------------------------------------------------
    if (props.outboundOAuthSharedCacheEnabled) {
      apiFunction.addEnvironment('OUTBOUND_OAUTH_SHARED_CACHE_ENABLED', 'true')
    }

    // ---------------------------------------------------------------------------
    // Feedback (magic-link surveys) master switch. Like the flags above, only env
    // vars are set: the store is the shared Neon DB, and the public respond
    // endpoint resolves the tenant from the token (no new IAM). FEEDBACK_PUBLIC_WEB_URL
    // is the tenant SPA origin the mint uses to build the `/f/<token>` link.
    // ---------------------------------------------------------------------------
    if (props.feedbackEnabled) {
      apiFunction.addEnvironment('FEEDBACK_ENABLED', 'true')
      if (props.feedbackPublicWebUrl) {
        apiFunction.addEnvironment('FEEDBACK_PUBLIC_WEB_URL', props.feedbackPublicWebUrl)
      }
    }

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

      // -----------------------------------------------------------------------
      // Workflow-execution reconcile poller (Phase 2 Unit 6.5)
      //
      // Crash-recovery backstop: a plain (non-VPC, public-egress) Lambda that
      // runs every minute, finds RUNNING executions orphaned by a crashed
      // worker (no terminal write-back), asks Temporal Cloud for their true
      // state, and flips them. Reads/writes cross-tenant via the root `db`.
      //
      // Lives inside this Temporal-configured branch because it has nothing to
      // reconcile without a Temporal Cloud connection — it reuses the exact
      // env trio + secret the API Lambda just received. Bundled separately
      // (own log group) so a misbehaving poller can't crash the API Lambda.
      // -----------------------------------------------------------------------
      const reconcileLogGroup = new logs.LogGroup(this, 'ReconcileWorkflowExecutionsLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      })
      cronLogGroupNames.push(reconcileLogGroup.logGroupName)

      const reconcileFunction = new nodejs.NodejsFunction(
        this,
        'ReconcileWorkflowExecutionsFunction',
        {
          runtime: lambda.Runtime.NODEJS_24_X,
          entry: path.join(
            __dirname,
            '../../../../apps/api/src/lambda-reconcile-workflow-executions.ts',
          ),
          handler: 'handler',
          environment: {
            NODE_ENV: 'production',
            DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
            LOG_LEVEL: 'INFO',
            TEMPORAL_ADDRESS: props.temporalAddress,
            TEMPORAL_NAMESPACE: props.temporalNamespace,
            TEMPORAL_TASK_QUEUE: props.temporalTaskQueue,
            TEMPORAL_CLOUD_API_KEY: temporalSecret.secretValueFromJson('apiKey').unsafeUnwrap(),
          },
          bundling: {
            minify: true,
            sourceMap: true,
            externalModules: ['@aws-sdk/*'],
          },
          memorySize: 256,
          // Up to 100 describe()/result() round-trips to Temporal Cloud per
          // tick — generous so a slow Cloud response can't truncate the batch.
          timeout: cdk.Duration.minutes(2),
          logGroup: reconcileLogGroup,
        },
      )

      dbSecret.grantRead(reconcileFunction)
      temporalSecret.grantRead(reconcileFunction)

      // PutMetricData has no resource-level scoping (Resource must be `*`); the
      // cloudwatch:namespace condition narrows this role to the Pegasus/Workflows
      // namespace only — it can't publish to arbitrary customer namespaces.
      reconcileFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'cloudwatch:namespace': PEGASUS_WORKFLOWS_METRIC_NAMESPACE },
          },
        }),
      )

      new events.Rule(this, 'ReconcileWorkflowExecutionsSchedule', {
        // Every minute: a crashed worker's orphaned RUNNING row flips to its
        // true terminal state within ~1–2 min (5-min grace + next tick).
        schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
        description:
          'Reconciles orphaned RUNNING workflow executions against Temporal Cloud (crash-recovery backstop).',
        targets: [new eventsTargets.LambdaFunction(reconcileFunction)],
      })

      // -----------------------------------------------------------------------
      // Workflow trigger dispatcher (Phase 3 Unit 3)
      //
      // Consumer half of the domain-event outbox: drains undispatched
      // DomainEvent rows every minute, matches them against enabled EVENT
      // triggers, and starts executions through the same run path as
      // POST /workflows/:id/run — `client.workflow.start` against Temporal
      // Cloud with a deterministic per-(trigger,event) workflow id.
      //
      // Lives inside this Temporal-configured branch because it cannot start
      // anything without a Temporal Cloud connection (inert in dev) — it
      // reuses the exact env trio + secret the reconcile poller gets, plus
      // the workflow-token KMS key: the shared run path lazily mints runtime
      // service accounts for pre-Phase-2 workflows, which KMS-encrypts the
      // minted credential. Bundled separately (own log group) so a
      // misbehaving dispatcher can't crash the API Lambda.
      // -----------------------------------------------------------------------
      const dispatchTriggersLogGroup = new logs.LogGroup(this, 'DispatchWorkflowTriggersLogGroup', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      })
      cronLogGroupNames.push(dispatchTriggersLogGroup.logGroupName)

      const dispatchTriggersFunction = new nodejs.NodejsFunction(
        this,
        'DispatchWorkflowTriggersFunction',
        {
          runtime: lambda.Runtime.NODEJS_24_X,
          entry: path.join(
            __dirname,
            '../../../../apps/api/src/lambda-dispatch-workflow-triggers.ts',
          ),
          handler: 'handler',
          environment: {
            NODE_ENV: 'production',
            DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
            LOG_LEVEL: 'INFO',
            TEMPORAL_ADDRESS: props.temporalAddress,
            TEMPORAL_NAMESPACE: props.temporalNamespace,
            TEMPORAL_TASK_QUEUE: props.temporalTaskQueue,
            TEMPORAL_CLOUD_API_KEY: temporalSecret.secretValueFromJson('apiKey').unsafeUnwrap(),
            WORKFLOW_TOKEN_KMS_KEY_ID: workflowTokenKey.keyId,
          },
          bundling: {
            minify: true,
            sourceMap: true,
            externalModules: ['@aws-sdk/*'],
          },
          memorySize: 256,
          // Up to 100 events × their matching triggers per tick, each a
          // Temporal start round-trip — generous so a slow Cloud response
          // can't truncate the batch.
          timeout: cdk.Duration.minutes(2),
          logGroup: dispatchTriggersLogGroup,
        },
      )

      dbSecret.grantRead(dispatchTriggersFunction)
      temporalSecret.grantRead(dispatchTriggersFunction)
      // Lazy runtime-account mint encrypts the fresh vnd_ key with this key.
      workflowTokenKey.grantEncryptDecrypt(dispatchTriggersFunction)

      // Same namespace-scoped PutMetricData grant as the reconcile poller.
      dispatchTriggersFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
          conditions: {
            StringEquals: { 'cloudwatch:namespace': PEGASUS_WORKFLOWS_METRIC_NAMESPACE },
          },
        }),
      )

      new events.Rule(this, 'DispatchWorkflowTriggersSchedule', {
        // Every minute: a domain event fires its matching triggers within
        // ~1 min of the emitting transaction committing.
        schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
        description:
          'Dispatches undispatched domain events to matching workflow triggers (event-driven executions).',
        targets: [new eventsTargets.LambdaFunction(dispatchTriggersFunction)],
      })

      // -----------------------------------------------------------------------
      // Tenant-runner orchestration wiring (Phase 3 Unit 9 — scale-to-zero).
      //
      // The dispatcher logic lives in apps/api/src/lib/tenant-runner.ts and
      // runs in TWO Lambdas: the API Lambda (the run path launches a runner
      // the moment an execution routes to a tenant queue) and the trigger
      // dispatcher above (per-minute sweep = crash-recovery backstop + pool
      // metrics). Both therefore get the TENANT_RUNNER_* env contract and
      // the same ECS/PassRole grants.
      //
      // LIVE since Unit 10: the run path reaches RunTask whenever an
      // executable non-curated workflow runs (see executionNeedsTenantRunner /
      // resolveWorkflowRoute in the lib). This wiring made that a
      // routing-decision flip rather than an infra change.
      //
      // Cross-stack contract is BY NAME (cluster / task family / role names
      // mirrored from temporal-worker-stack.ts) because TemporalWorkerStack
      // depends on THIS stack — construct refs in this direction would be a
      // dependency cycle. Change either side only together.
      // -----------------------------------------------------------------------
      if (props.tenantRunnerSubnets?.length && props.tenantRunnerSecurityGroup) {
        const tenantRunnerClusterArn = `arn:aws:ecs:${this.region}:${this.account}:cluster/pegasus-temporal-worker-${envName}`
        const tenantRunnerTaskFamily = `pegasus-tenant-runner-${envName}`

        const tenantRunnerEnv: Record<string, string> = {
          TENANT_RUNNER_CLUSTER_ARN: tenantRunnerClusterArn,
          // Bare family name — RunTask resolves the latest ACTIVE revision,
          // so task-def updates need no dispatcher re-wiring.
          TENANT_RUNNER_TASK_DEFINITION: tenantRunnerTaskFamily,
          TENANT_RUNNER_CONTAINER_NAME: 'tenant-runner',
          TENANT_RUNNER_SUBNET_IDS: cdk.Fn.join(
            ',',
            props.tenantRunnerSubnets.map((s) => s.subnetId),
          ),
          TENANT_RUNNER_SECURITY_GROUP_ID: props.tenantRunnerSecurityGroup.securityGroupId,
        }

        const tenantRunnerStatements = [
          // The dispatcher calls RunTask with the BARE family name; ECS
          // resolves the latest ACTIVE revision before the IAM check, so the
          // revisioned `:*` form is the one that normally matches. The
          // unrevisioned ARN is included belt-and-braces — AWS has shipped
          // both authorization shapes for family-name RunTask calls over
          // time, and the extra resource grants nothing broader. The
          // ecs:cluster condition pins launches to our cluster either way.
          new iam.PolicyStatement({
            actions: ['ecs:RunTask'],
            resources: [
              `arn:aws:ecs:${this.region}:${this.account}:task-definition/${tenantRunnerTaskFamily}:*`,
              `arn:aws:ecs:${this.region}:${this.account}:task-definition/${tenantRunnerTaskFamily}`,
            ],
            conditions: { ArnEquals: { 'ecs:cluster': tenantRunnerClusterArn } },
          }),
          // ListTasks (startedBy dedupe + family-scoped pool gauge) and
          // DescribeTasks (cold-start latency) take no useful resource-level
          // scoping beyond the cluster condition.
          new iam.PolicyStatement({
            actions: ['ecs:ListTasks', 'ecs:DescribeTasks'],
            resources: ['*'],
            conditions: { ArnEquals: { 'ecs:cluster': tenantRunnerClusterArn } },
          }),
          // RunTask passes the task + execution roles defined on
          // TemporalWorkerStack (deterministic names — see the contract
          // note above). Confined to ECS task assumption.
          new iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [
              `arn:aws:iam::${this.account}:role/pegasus-tenant-runner-task-${envName}`,
              `arn:aws:iam::${this.account}:role/pegasus-tenant-runner-exec-${envName}`,
            ],
            conditions: {
              StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' },
            },
          }),
        ]

        for (const fn of [apiFunction, dispatchTriggersFunction]) {
          for (const [key, value] of Object.entries(tenantRunnerEnv)) {
            fn.addEnvironment(key, value)
          }
          for (const statement of tenantRunnerStatements) {
            fn.addToRolePolicy(statement)
          }
        }

        // The run-path hook emits TenantRunnerLaunched/LaunchFailed from the
        // API Lambda, which (unlike the dispatcher) has no Pegasus/Workflows
        // PutMetricData grant yet. Same namespace-condition shape as the
        // pollers'. (The wbk_ KMS-recovery grant already exists on both
        // roles via workflowTokenKey.grantEncryptDecrypt above.)
        apiFunction.addToRolePolicy(
          new iam.PolicyStatement({
            actions: ['cloudwatch:PutMetricData'],
            resources: ['*'],
            conditions: {
              StringEquals: { 'cloudwatch:namespace': PEGASUS_WORKFLOWS_METRIC_NAMESPACE },
            },
          }),
        )
      }
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
    // pegII on-prem domain API — scheme/port defaults for the overlay target.
    // apps/api/src/lib/pegii-overlay-target.ts reads these when a tenant has no
    // explicit pegiiApiBaseUrl, deriving http://10.200.<o1>.<o2>:<port> from the
    // VpnPeer overlay IP. The pegII team runs the API on-prem as plain HTTP on
    // port 65274. Reuses the already-wired TUNNEL_PROXY_FUNCTION_NAME transport
    // above; no new Lambda invoke grant is needed. PEGII_API_TUNNEL_BASE_OVERRIDE
    // is intentionally left unset (opt-in smoke-test escape hatch).
    // ---------------------------------------------------------------------------
    apiFunction.addEnvironment('PEGII_API_TUNNEL_SCHEME', 'http')
    apiFunction.addEnvironment('PEGII_API_TUNNEL_PORT', '65274')

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
            // Deliberately no AdminDisableUser/AdminEnableUser: the API never
            // calls them (see handlers/users.ts's file header) — deactivating
            // a user in one tenant must not lock them out of every other
            // tenant they belong to in the shared Cognito user pool.
            'cognito-idp:AdminResetUserPassword',
            'cognito-idp:AdminGetUser',
            'cognito-idp:CreateIdentityProvider',
            'cognito-idp:UpdateIdentityProvider',
            'cognito-idp:DeleteIdentityProvider',
            // UpdateUserPoolClient: handlers/sso.ts adds a newly registered IdP to
            // the tenant app client's SupportedIdentityProviders (and removes it on
            // delete). Registering the IdP alone is not enough — without the client
            // permitting it, Cognito redirects to the IdP, accepts the returned code,
            // then fails the callback with a bare 400 and no error_description. IaC
            // cannot pre-declare that list instead: Cognito rejects a provider name
            // whose provider does not exist yet, and tenants create providers at
            // runtime with names of their own choosing.
            'cognito-idp:UpdateUserPoolClient',
            // DescribeUserPool + ListUserPoolClients are required by AVP
            // CreateIdentitySource when attaching a Cognito User Pool. AVP issues
            // these calls against the user pool with the *caller's* credentials to
            // validate that (a) the pool ARN exists, (b) the supplied clientIds are
            // part of that pool, (c) each client's settings are compatible with
            // token-based authorization. The API Lambda never calls those two
            // directly, but its role still needs them or POST /api/admin/tenants
            // fails with AccessDeniedException *after* CreatePolicyStore + PutSchema
            // + CreatePolicy succeed — distinguishable only by reading CloudWatch.
            'cognito-idp:DescribeUserPool',
            'cognito-idp:ListUserPoolClients',
            // DescribeUserPoolClient serves both AVP (as above) and sso.ts, which
            // reads the client's full config before every write — UpdateUserPoolClient
            // replaces the whole config, so anything not echoed back is reset.
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
    cronLogGroupNames.push(avpStoreCountLogGroup.logGroupName)

    const avpStoreCountFunction = new nodejs.NodejsFunction(this, 'AvpStoreCountFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
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
    // Weekly 400NG fuel-surcharge (Item 16) refresh from EIA.
    //
    // Fetches the latest national diesel price and upserts a TariffFuelSurcharge
    // row (source EIA_AUTO). INERT until an operator creates the API-key secret
    // `pegasus/<env>/eia-api-key` (a plain-string secret holding the EIA key);
    // the Lambda reads it from Secrets Manager AT RUNTIME by name, so creating
    // the secret activates the next weekly run with no redeploy. Scheduled for
    // Wednesday (after EIA's Tuesday publish) so the current week's point is out.
    // ---------------------------------------------------------------------------
    const fscUpdateLogGroup = new logs.LogGroup(this, 'TariffFscUpdateLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    cronLogGroupNames.push(fscUpdateLogGroup.logGroupName)

    const eiaApiKeySecretName = `pegasus/${envName}/eia-api-key`
    const fscUpdateFunction = new nodejs.NodejsFunction(this, 'TariffFscUpdateFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-tariff-fsc-update.ts'),
      handler: 'handler',
      environment: {
        NODE_ENV: 'production',
        DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
        LOG_LEVEL: 'INFO',
        EIA_API_KEY_SECRET_NAME: eiaApiKeySecretName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logGroup: fscUpdateLogGroup,
    })

    dbSecret.grantRead(fscUpdateFunction)

    // Read-only on the EIA key secret. fromSecretNameV2 grants on the
    // wildcard-suffix ARN, which matches the secret once an operator creates it;
    // the grant (and this whole cron) deploys fine before the secret exists —
    // the Lambda no-ops on ResourceNotFound until it does.
    secretsmanager.Secret.fromSecretNameV2(this, 'EiaApiKeySecret', eiaApiKeySecretName).grantRead(
      fscUpdateFunction,
    )

    // PutMetricData can't be resource-scoped; narrow it to the Pegasus/Rating
    // namespace via the condition key (same rationale as the AVP emitter above).
    fscUpdateFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': PEGASUS_RATING_METRIC_NAMESPACE },
        },
      }),
    )

    new events.Rule(this, 'TariffFscUpdateSchedule', {
      // Weekly. Fixed-rate is the house style here; the exact weekday only
      // affects which day of the week runs land on across deploys, and the
      // upsert is idempotent per survey-week, so a 7-day rate is sufficient.
      schedule: events.Schedule.rate(cdk.Duration.days(7)),
      description:
        'Weekly trigger for the 400NG fuel-surcharge refresh from EIA (Pegasus/Rating/FscUpdate*).',
      targets: [new eventsTargets.LambdaFunction(fscUpdateFunction)],
    })

    // ---------------------------------------------------------------------------
    // Tariff coverage-check cron
    //
    // Daily DB-only staleness monitor for the 400NG tariff. Publishes a
    // TariffCoverageDays gauge (days until the active version's effectiveTo, 0
    // on lapse) so the MonitoringStack alarm pages ~45 days before rating would
    // break, plus a best-effort probe of next year's (WAF-gated) USTRANSCOM
    // artifact. No secret needed — a DB read and a public HTTP probe. Runs
    // DAILY, not monthly: the coverage alarm treats a missing gauge as BREACHING
    // (a missing datapoint = the cron is down), and a CloudWatch alarm period
    // caps at 1 day, so the gauge must land at least daily to avoid paging on
    // no-data. A single indexed read a day is negligible.
    // ---------------------------------------------------------------------------
    const tariffCheckLogGroup = new logs.LogGroup(this, 'TariffCheckLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    cronLogGroupNames.push(tariffCheckLogGroup.logGroupName)

    const tariffCheckFunction = new nodejs.NodejsFunction(this, 'TariffCheckFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-tariff-check.ts'),
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
      logGroup: tariffCheckLogGroup,
    })

    dbSecret.grantRead(tariffCheckFunction)

    // PutMetricData can't be resource-scoped; narrow it to the Pegasus/Rating
    // namespace via the condition key (same rationale as the FSC emitter above).
    tariffCheckFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': PEGASUS_RATING_METRIC_NAMESPACE },
        },
      }),
    )

    new events.Rule(this, 'TariffCheckSchedule', {
      // Daily — see the block comment: the coverage-days alarm is BREACHING-on-
      // missing and a CloudWatch alarm period maxes at 1 day, so a fresh gauge
      // must land every day.
      schedule: events.Schedule.rate(cdk.Duration.days(1)),
      description:
        'Daily 400NG tariff coverage-staleness check (Pegasus/Rating/TariffCoverageDays).',
      targets: [new eventsTargets.LambdaFunction(tariffCheckFunction)],
    })

    // ---------------------------------------------------------------------------
    // RingCentral credential health-check cron
    //
    // With per-tenant JWT auth there is no refresh token to rotate; this cron
    // verifies each active connection's stored credentials still work (a real
    // jwt-bearer exchange), marking a connection EXPIRED/UNHEALTHY when its JWT
    // is revoked/expired so the ConnectionsUnhealthy alarm fires. Reads the
    // per-connection credential secret from Secrets Manager. Inert until
    // RINGCENTRAL_ENABLED=true (the handler no-ops when readOAuthConfig() returns
    // null), so it is safe to schedule now.
    // ---------------------------------------------------------------------------
    const ringcentralTokenRefreshLogGroup = new logs.LogGroup(
      this,
      'RingCentralTokenRefreshLogGroup',
      {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    )
    cronLogGroupNames.push(ringcentralTokenRefreshLogGroup.logGroupName)

    const ringcentralTokenRefreshFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralTokenRefreshFunction',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
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
      // Half-hourly health check catches a revoked/expired tenant JWT well
      // before the next reconciliation sync would surface it.
      schedule: events.Schedule.rate(cdk.Duration.minutes(30)),
      description: 'Health-checks RingCentral connection credentials.',
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
    cronLogGroupNames.push(ringcentralSyncLogGroup.logGroupName)

    const ringcentralSyncFunction = new nodejs.NodejsFunction(this, 'RingCentralSyncFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
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
    cronLogGroupNames.push(ringcentralRenewLogGroup.logGroupName)

    const ringcentralRenewFunction = new nodejs.NodejsFunction(this, 'RingCentralRenewFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
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
    this.ringcentralCaptureDlqName = ringcentralCaptureDlq.queueName
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
    cronLogGroupNames.push(ringcentralCaptureLogGroup.logGroupName)

    const ringcentralCaptureFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralCaptureFunction',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
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
    cronLogGroupNames.push(ringcentralForwardLogGroup.logGroupName)

    const ringcentralForwardFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralForwardFunction',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
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
    // Push-notification forwarder — drains PushNotificationOutbox and delivers
    // via the Expo push service. Cross-tenant DB reader; no provider secret is
    // required (Expo push works unauthenticated). To enable Expo's enhanced push
    // security later, store an access token in Secrets Manager and surface it as
    // the EXPO_ACCESS_TOKEN env var here (lib/push-expo reads it when present).
    // ---------------------------------------------------------------------------
    const pushForwardLogGroup = new logs.LogGroup(this, 'PushForwardLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    cronLogGroupNames.push(pushForwardLogGroup.logGroupName)

    const pushForwardFunction = new nodejs.NodejsFunction(this, 'PushForwardFunction', {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: path.join(__dirname, '../../../../apps/api/src/lambda-push-forward.ts'),
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
        // ESM, unlike every other function here — `expo-server-sdk` is pure ESM
        // ("type": "module") and its ExpoClient.js does
        // `createRequire(import.meta.url)` at module scope. Bundled to CJS
        // (NodejsFunction's default) `import.meta.url` is undefined, so that
        // call throws ERR_INVALID_ARG_VALUE during INIT — before the handler
        // runs, which is why the outbox showed attempts=0 with no error rather
        // than a delivery failure. Synth and deploy both stay green; only
        // loading the bundle reveals it.
        format: nodejs.OutputFormat.ESM,
        // ESM output has no `require`/`__dirname`, which the CJS deps sharing
        // this bundle (Prisma) still reference. Re-create them from
        // import.meta.url, which IS defined here.
        banner:
          "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" +
          "import{fileURLToPath as __f2p}from'node:url';import{dirname as __dn}from'node:path';" +
          'const __filename=__f2p(import.meta.url);const __dirname=__dn(__filename);',
      },
      memorySize: 512,
      timeout: cdk.Duration.minutes(5),
      logGroup: pushForwardLogGroup,
    })

    dbSecret.grantRead(pushForwardFunction)

    new events.Rule(this, 'PushForwardSchedule', {
      // Near-real-time: drivers expect assignment/request pushes promptly.
      // Backoff/jitter inside the Lambda spaces out retries for failing rows.
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      description: 'Delivers queued push notifications to drivers via Expo.',
      targets: [new eventsTargets.LambdaFunction(pushForwardFunction)],
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
    cronLogGroupNames.push(ringcentralBufferPurgeLogGroup.logGroupName)

    const ringcentralBufferPurgeFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralBufferPurgeFunction',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
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
    // RingCentral health-metrics emitter cron
    //
    // Publishes the DB-derived capture-health gauges (outbox depth/dead,
    // subscriptions dead, unhealthy connections, sync lag) to the
    // Pegasus/RingCentral namespace for the MonitoringStack alarms. One emitter
    // (mirrors AvpStoreCountFunction) keeps all the gauges + the single
    // PutMetricData grant in one place. Inert-safe: emits 0s until enabled.
    // ---------------------------------------------------------------------------
    const ringcentralMetricsLogGroup = new logs.LogGroup(this, 'RingCentralMetricsLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    cronLogGroupNames.push(ringcentralMetricsLogGroup.logGroupName)

    const ringcentralMetricsFunction = new nodejs.NodejsFunction(
      this,
      'RingCentralMetricsFunction',
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: path.join(__dirname, '../../../../apps/api/src/lambda-ringcentral-metrics.ts'),
        handler: 'handler',
        environment: {
          NODE_ENV: 'production',
          DATABASE_URL: dbSecret.secretValue.unsafeUnwrap(),
          LOG_LEVEL: 'INFO',
        },
        bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
        logGroup: ringcentralMetricsLogGroup,
      },
    )

    dbSecret.grantRead(ringcentralMetricsFunction)
    // PutMetricData has no resource-level scoping (Resource must be `*`); the
    // namespace condition narrows this role to the Pegasus/RingCentral namespace.
    ringcentralMetricsFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': PEGASUS_RINGCENTRAL_METRIC_NAMESPACE },
        },
      }),
    )

    new events.Rule(this, 'RingCentralMetricsSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      description: 'Emits RingCentral capture-health gauges (Pegasus/RingCentral).',
      targets: [new eventsTargets.LambdaFunction(ringcentralMetricsFunction)],
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
      runtime: lambda.Runtime.NODEJS_24_X,
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
        // Per-env allowlist from bin/app.ts (staging/prod); dev falls back to
        // the original wildcard. API GW answers OPTIONS itself, so this is the
        // authoritative CORS layer in deployed environments.
        allowOrigins: props.corsAllowedOrigins ?? ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'X-Tenant-Slug'],
        exposeHeaders: ['x-correlation-id'],
      },
    })

    // Mirror the allowlist into the Lambda so the Hono cors() middleware
    // enforces the same origins on the non-preflight / direct-served path.
    // Empty (dev) → Hono reflects any origin.
    apiFunction.addEnvironment('CORS_ALLOWED_ORIGINS', (props.corsAllowedOrigins ?? []).join(','))

    // Stage-wide throttling — a free token bucket at the API GW edge. Excess
    // requests get 429 without consuming a Lambda slot, mitigating the
    // account-wide Lambda concurrency cap (10) starvation vector. Sized to
    // current real traffic (single-digit rps) with generous headroom; this is
    // stage-wide, not per-IP (per-IP needs WAF — deliberately deferred).
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage
    defaultStage.defaultRouteSettings = {
      throttlingRateLimit: 25, // steady-state rps across all callers
      throttlingBurstLimit: 50,
    }

    // ---------------------------------------------------------------------------
    // Access logging on the $default stage.
    //
    // The API is a single `ANY /{proxy+}` route, so per-route CloudWatch metrics
    // don't exist — without access logs there is no way to learn *which* endpoint
    // was slow during a latency spike. `integrationLatency` is the time the
    // Lambda itself took (vs `responseLatency` end-to-end), so the two together
    // separate gateway overhead from in-handler downstream stalls. Logs-Insights
    // can then rank endpoints by p99. Set via the CfnStage escape hatch because
    // the stable apigwv2 L2 stage doesn't expose accessLogSettings.
    // ---------------------------------------------------------------------------
    const apiAccessLogGroup = new logs.LogGroup(this, 'ApiAccessLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })
    this.apiAccessLogGroupName = apiAccessLogGroup.logGroupName
    // API Gateway (HTTP API) writes access logs via a CloudWatch Logs resource
    // policy rather than the account-level role REST APIs use. grantWrite to the
    // service principal renders that resource policy on the log group.
    apiAccessLogGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'))
    defaultStage.accessLogSettings = {
      destinationArn: apiAccessLogGroup.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        routeKey: '$context.routeKey',
        path: '$context.path',
        method: '$context.httpMethod',
        status: '$context.status',
        responseLatency: '$context.responseLatency',
        integrationLatency: '$context.integrationLatency',
        integrationStatus: '$context.integrationStatus',
        ip: '$context.identity.sourceIp',
        requestTime: '$context.requestTime',
        protocol: '$context.protocol',
      }),
    }

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigwv2.HttpMethod.ANY],
      integration: new apigwv2i.HttpLambdaIntegration('LambdaIntegration', apiFunction),
    })

    this.apiUrl = httpApi.apiEndpoint
    this.lambdaFunctionName = apiFunction.functionName
    this.httpApiId = httpApi.apiId

    // ---------------------------------------------------------------------------
    // RingCentral master switch (prod). Set here — after httpApi exists — because
    // the webhook delivery address is derived from the API's own public endpoint.
    // RINGCENTRAL_ENABLED ungates the connect endpoint (api Lambda) + the crons
    // whose readOAuthConfig() no-ops while unset. RINGCENTRAL_WEBHOOK_URL goes
    // only on the renew cron: it is the sole Lambda that registers/renews the
    // per-connection RingCentral subscription (deliveryAddress = this URL), so the
    // webhook is wired programmatically — no manual RingCentral-console setup.
    // Inert until a tenant connects (zero connections → every cron no-ops).
    if (props.ringcentralEnabled) {
      for (const fn of [
        apiFunction,
        ringcentralCaptureFunction,
        ringcentralSyncFunction,
        ringcentralRenewFunction,
        ringcentralTokenRefreshFunction,
      ]) {
        fn.addEnvironment('RINGCENTRAL_ENABLED', 'true')
      }
      ringcentralRenewFunction.addEnvironment(
        'RINGCENTRAL_WEBHOOK_URL',
        `${httpApi.apiEndpoint}/api/integrations/ringcentral/webhook`,
      )
    }

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

    this.cronLogGroupNames = cronLogGroupNames
  }
}
