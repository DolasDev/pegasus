#!/usr/bin/env node
import * as fs from 'fs'
import * as path from 'path'
import * as cdk from 'aws-cdk-lib'
import { CognitoStack } from '../lib/stacks/cognito-stack'
import { ApiStack } from '../lib/stacks/api-stack'
import { ApiCdnStack } from '../lib/stacks/api-cdn-stack'
import { FrontendStack } from '../lib/stacks/frontend-stack'
import { AdminFrontendStack } from '../lib/stacks/admin-frontend-stack'
import { FrontendAssetsStack } from '../lib/stacks/frontend-assets-stack'
import { AdminFrontendAssetsStack } from '../lib/stacks/admin-frontend-assets-stack'
import { MonitoringStack } from '../lib/stacks/monitoring-stack'
import { DocumentsStack } from '../lib/stacks/documents-stack'
import { WireGuardStack } from '../lib/stacks/wireguard-stack'
import { E2EStagingRoleStack } from '../lib/stacks/e2e-staging-role-stack'
import { TemporalWorkerStack } from '../lib/stacks/temporal-worker-stack'
import { OutboxRelayStack } from '../lib/stacks/outbox-relay-stack'

const app = new cdk.App()

// ── Environment selection ────────────────────────────────────────────────────
// Pass `-c env=dev|staging|prod` (or set `PEGASUS_ENV`) to choose target env.
// Defaults to `dev` so existing local/admin workflows keep working.
//
// Account pinning: staging/prod accounts are hardcoded as a safety net — CDK
// refuses to deploy if the assumed credentials don't match the stack env, so
// a misconfigured runner can't accidentally cross-deploy. Dev inherits from
// the ambient credentials to preserve the original behaviour.

type EnvName = 'dev' | 'staging' | 'prod'

type EnvConfig = {
  cdkEnv: cdk.Environment
}

const ENVIRONMENTS: Record<EnvName, EnvConfig> = {
  dev: {
    cdkEnv: {
      account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'],
      region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
    },
  },
  staging: {
    cdkEnv: { account: '248812875460', region: 'us-east-1' },
  },
  prod: {
    cdkEnv: { account: '331145994639', region: 'us-east-1' },
  },
}

const rawEnvName = (app.node.tryGetContext('env') ?? process.env['PEGASUS_ENV'] ?? 'dev') as string
if (!(rawEnvName in ENVIRONMENTS)) {
  throw new Error(
    `Unknown env "${rawEnvName}" — pass -c env=dev|staging|prod (or set PEGASUS_ENV).`,
  )
}
const envName = rawEnvName as EnvName
const env = ENVIRONMENTS[envName].cdkEnv

// `PegasusDev`, `PegasusStaging`, `PegasusProd` — used as construct ID prefix.
const stackIdPrefix = `Pegasus${envName.charAt(0).toUpperCase()}${envName.slice(1)}`
// `pegasus-dev`, `pegasus-staging`, `pegasus-prod` — used as CFN stack name prefix.
const stackNamePrefix = `pegasus-${envName}`

const descPrefix = `Pegasus ${envName}`

// ── SES invite-email sender (opt-in) ─────────────────────────────────────────
// Cognito sends invite emails from its generic default address unless the user
// pool is pointed at a verified SES domain identity. dolas-infra's
// PegasusSesBootstrapStack provisions that identity (no-reply@<webDomain>) and
// auto-verifies it via DKIM records in the owned subzone.
//
// This is OFF by default and gated behind `-c pegasusSesEmail=true`. Reason:
// Cognito rejects a withSES config whose identity isn't verified yet, which
// would fail the (already-live) cognito stack update. So the rollout is:
//   1. deploy dolas-infra SES bootstrap and wait for SES to verify the domain,
//   2. then deploy here with `-c pegasusSesEmail=true`.
// dev has no custom domain, so SES is never wired there.
const sesEmailEnabled =
  envName !== 'dev' &&
  (app.node.tryGetContext('pegasusSesEmail') === true ||
    app.node.tryGetContext('pegasusSesEmail') === 'true')

const SES_SENDER_DOMAIN: Record<Exclude<EnvName, 'dev'>, string> = {
  staging: 'pegasus-qa.dolas.dev',
  prod: 'pegasus.dolas.dev',
}

// Derived only when enabled (sesEmailEnabled already excludes dev).
// e.g. no-reply@pegasus.dolas.dev.
const sesFromEmail = sesEmailEnabled ? `no-reply@${SES_SENDER_DOMAIN[envName]}` : undefined

// ── RingCentral SMS capture (prod) ───────────────────────────────────────────
// Master switch for the RingCentral capture integration (see ApiStackProps
// .ringcentralEnabled). Enabled in prod only — that is where real tenants paste
// their own RingCentral JWT credentials and connect. Env-gated rather than a
// one-shot context flag so it stays on across routine main-push deploys (a
// context flag CI doesn't pass would silently disable a live integration on the
// next deploy). Inert until a tenant connects: zero connections → crons no-op,
// no subscription, no webhook traffic. dev/staging stay off.
const ringcentralEnabled = envName === 'prod'

// ── Integration-config publishing master switch (QA first) ───────────────────
// Ungates the mutating integration-validator config endpoints (POST /config +
// rollback) behind INTEGRATION_CONFIG_PUBLISH_ENABLED on the api Lambda. Enabled
// in staging (QA) and prod — staging is where we dogfooded publishing the
// built-in demo_partner config as a GLOBAL row, verified clean (zero validation
// diffs) on 2026-06-25, so Phase 5 turns the switch on for prod too (see
// plans/todo/integration-config-dogfood-publish.md). Env-gated rather than a
// one-shot context flag so it stays on across routine main-push deploys. Inert
// until a platform-tenant vnd_ key with Actions.PublishIntegrationConfig
// actually publishes: the dry-run /config/validate and read paths are never
// gated by this switch.
const integrationConfigPublishEnabled = envName === 'staging' || envName === 'prod'

// ── CORS allowlist (staging/prod) ────────────────────────────────────────────
// Browser origins allowed to call the API cross-origin. Tenant + admin SPA
// hostnames per env (the same dolas-managed domains the frontend stacks attach
// — see FrontendStack / AdminFrontendStack attachCustomDomain comments). Dev
// has no custom domains (raw *.cloudfront.net) → omit, which keeps the
// original wildcard behaviour at both API GW and the Hono layer.
const CORS_ALLOWED_ORIGINS: Record<Exclude<EnvName, 'dev'>, string[]> = {
  staging: ['https://pegasus-qa.dolas.dev', 'https://admin.pegasus-qa.dolas.dev'],
  prod: ['https://pegasus.dolas.dev', 'https://admin.pegasus.dolas.dev'],
}
const corsAllowedOrigins = envName === 'dev' ? undefined : CORS_ALLOWED_ORIGINS[envName]

// Temporal Cloud namespace gRPC endpoints, one per non-dev env. Consumed by:
//   - TemporalWorkerStack (Phase 2 Unit 4) — Fargate worker env TEMPORAL_ADDRESS
//   - ApiStack (Phase 2 Unit 6)            — API Lambda env TEMPORAL_ADDRESS
// Credentials live in Secrets Manager at pegasus/{env}/temporal-cloud.
// Dev uses local Temporal via docker-compose.temporal.yml — no entry here.
export const TEMPORAL_ADDRESS: Record<Exclude<EnvName, 'dev'>, string> = {
  staging: 'pegasus-staging.chgel.tmprl.cloud:7233',
  prod: 'pegasus-prod.chgel.tmprl.cloud:7233',
}

// Full Secrets Manager ARNs (with the 6-char random suffix) for the two
// Phase-2 secrets, per env. They MUST include the suffix:
// `Secret.fromSecretNameV2('pegasus/<env>/<name>')` produces a no-suffix
// ARN, and ECS task-secret injection then calls Secrets Manager with that
// no-suffix form, which Secrets Manager rejects with
// `ResourceNotFoundException: Secrets Manager can't find the specified
// secret` (verified live 2026-06-06 — the no-suffix `arn:...:secret:<name>`
// form is NOT a valid SecretId at the API level, despite some AWS docs
// implying it is). Using `Secret.fromSecretCompleteArn` with the full ARN
// fixes both the ECS lookup AND lets the default `grantRead` policy match.
//
// Sourced manually via `aws secretsmanager describe-secret` per env; the
// suffix never changes for the lifetime of the secret, so this is stable.
// If a secret is ever ROTATED-by-recreation, update the suffix here in
// the same change.
export const TEMPORAL_SECRET_ARNS: Record<
  Exclude<EnvName, 'dev'>,
  { temporalCloud: string; workflowBroker: string }
> = {
  staging: {
    temporalCloud:
      'arn:aws:secretsmanager:us-east-1:248812875460:secret:pegasus/staging/temporal-cloud-1xLDVL',
    workflowBroker:
      'arn:aws:secretsmanager:us-east-1:248812875460:secret:pegasus/staging/workflow-broker-secret-s6jQx2',
  },
  prod: {
    temporalCloud:
      'arn:aws:secretsmanager:us-east-1:331145994639:secret:pegasus/prod/temporal-cloud-f4IFFF',
    workflowBroker:
      'arn:aws:secretsmanager:us-east-1:331145994639:secret:pegasus/prod/workflow-broker-secret-VJPAmr',
  },
}

// pegII integration-event relay (OutboxRelayStack) — EventBridge bus + SQS
// buffer names per non-dev env. The on-prem Pegasus.Outbox.Relay PutEvents to
// the bus; the mapper Lambda drains the buffer. Dev has no entry (no relay
// there). Runbook: plans/in-progress/legacy-outbox-relay-setup.md
export const OUTBOX_RELAY: Record<
  Exclude<EnvName, 'dev'>,
  {
    busName: string
    bufferQueueName: string
    bufferDlqName: string
  }
> = {
  staging: {
    busName: 'pegasus-staging-integration-events',
    bufferQueueName: 'pegasus-staging-integration-events-buffer',
    bufferDlqName: 'pegasus-staging-integration-events-buffer-dlq',
  },
  prod: {
    busName: 'pegasus-prod-integration-events',
    bufferQueueName: 'pegasus-prod-integration-events-buffer',
    bufferDlqName: 'pegasus-prod-integration-events-buffer-dlq',
  },
}

// ── Infra stacks (deployed first — no dependencies) ──────────────────────────
// CloudFront distribution domain names are CDK tokens. When CognitoStack
// references them, CDK generates Fn::ImportValue so CloudFormation resolves
// the real hostname before creating/updating the Cognito app clients.

const frontendStack = new FrontendStack(app, `${stackIdPrefix}-FrontendStack`, {
  env,
  stackName: `${stackNamePrefix}-frontend`,
  description: `${descPrefix} — S3 + CloudFront (tenant web app)`,
  // staging → pegasus-qa.dolas.dev, prod → pegasus.dolas.dev. Cert + domain
  // come from SSM published by dolas-infra. dev stays at *.cloudfront.net.
  attachCustomDomain: envName === 'staging' || envName === 'prod',
})

const adminFrontendStack = new AdminFrontendStack(app, `${stackIdPrefix}-AdminFrontendStack`, {
  env,
  stackName: `${stackNamePrefix}-admin-frontend`,
  description: `${descPrefix} — S3 + CloudFront (admin portal)`,
  // staging → admin.pegasus-qa.dolas.dev, prod → admin.pegasus.dolas.dev. Cert
  // + domain come from SSM published by dolas-infra. dev stays at
  // *.cloudfront.net.
  attachCustomDomain: envName === 'staging' || envName === 'prod',
})

// ── CognitoStack ──────────────────────────────────────────────────────────────
// Receives cross-stack tokens for both CloudFront distribution domains.
// CDK deployment order: FrontendStack + AdminFrontendStack → CognitoStack.

const cognitoStack = new CognitoStack(app, `${stackIdPrefix}-CognitoStack`, {
  env,
  stackName: `${stackNamePrefix}-cognito`,
  description: `${descPrefix} — Cognito User Pool for platform and tenant auth`,
  tenantDistributionDomain: frontendStack.distribution.distributionDomainName,
  adminDistributionDomain: adminFrontendStack.distribution.distributionDomainName,
  // Register the branded web domains as allowed OAuth callback/logout URLs in
  // staging/prod so sign-out keeps the browser on pegasus[-qa].dolas.dev
  // instead of flipping to the raw *.cloudfront.net host. dev has no custom
  // domain → CloudFront URLs only.
  attachTenantWebCustomDomain: envName === 'staging' || envName === 'prod',
  attachAdminWebCustomDomain: envName === 'staging' || envName === 'prod',
  // When set, the user pool sends invite emails via SES from this verified
  // address instead of Cognito's default sender. undefined → COGNITO_DEFAULT.
  sesFromEmail,
})

// ── E2EStagingRoleStack ──────────────────────────────────────────────────────
// Staging-only narrow IAM role assumed by the GH Actions e2e gate over OIDC.
// See lib/stacks/e2e-staging-role-stack.ts for context.
if (envName === 'staging') {
  new E2EStagingRoleStack(app, `${stackIdPrefix}-E2EStagingRoleStack`, {
    env,
    stackName: `${stackNamePrefix}-e2e-role`,
    description: `${descPrefix} — narrow IAM role for the e2e gate's Cognito admin calls`,
    userPoolArn: cognitoStack.userPool.userPoolArn,
    githubRepo: 'DolasDev/pegasus',
  })
}

// ── DocumentsStack ────────────────────────────────────────────────────────────
// Provisions the S3 bucket used by the document management system. Deployed
// before ApiStack so the bucket reference can be injected into the Lambda.

const documentsStack = new DocumentsStack(app, `${stackIdPrefix}-DocumentsStack`, {
  env,
  stackName: `${stackNamePrefix}-documents`,
  description: `${descPrefix} — S3 bucket for document attachments`,
})

// ── WireGuardStack ────────────────────────────────────────────────────────────
// Stand-alone VPN plane — VPC, EIP, SGs, Route 53 PHZ, agent artifact bucket,
// and the key-bootstrap Custom Resource that generates the hub Curve25519
// keypair on first deploy. Deploys before ApiStack so the hub public key
// and endpoint can be injected into the Lambda env as cross-stack exports.

const wireguardStack = new WireGuardStack(app, `${stackIdPrefix}-WireGuardStack`, {
  env,
  stackName: `${stackNamePrefix}-wireguard`,
  description: `${descPrefix} — multi-tenant WireGuard hub (VPC + ASG + Route 53 PHZ + alarms)`,
})

// ── ApiStack ──────────────────────────────────────────────────────────────────
// CDK deployment order: CognitoStack + DocumentsStack + WireGuardStack → ApiStack.

// Per-env Temporal wiring — same source-of-truth maps the worker uses, so
// the two halves can't drift. Skipped in dev (no Phase-2 Temporal there;
// the API client falls through to a localhost dev-server connect).
const apiTemporalAddress = envName === 'dev' ? undefined : TEMPORAL_ADDRESS[envName]
const apiTemporalNamespace =
  envName === 'dev' ? undefined : TEMPORAL_ADDRESS[envName].replace(/\.tmprl\.cloud:\d+$/, '')
const apiTemporalTaskQueue = envName === 'dev' ? undefined : `pegasus-stdlib-${envName}`
const apiTemporalCloudSecretArn =
  envName === 'dev' ? undefined : TEMPORAL_SECRET_ARNS[envName].temporalCloud
const apiWorkflowBrokerSecretArn =
  envName === 'dev' ? undefined : TEMPORAL_SECRET_ARNS[envName].workflowBroker

const apiStack = new ApiStack(app, `${stackIdPrefix}-ApiStack`, {
  env,
  stackName: `${stackNamePrefix}-api`,
  description: `${descPrefix} — Hono Lambda + HTTP API Gateway v2`,
  // Pass cognitoStack.stackName by string (not construct refs) so CDK's
  // auto-export mechanism doesn't generate cross-stack exports whose logical
  // IDs drift across CDK versions. ApiStack resolves the user pool / client
  // IDs / Hosted UI domain / JWKS URL via Fn::ImportValue against stable,
  // hand-pinned export names declared in CognitoStack.
  cognitoStackName: cognitoStack.stackName,
  documentsBucket: documentsStack.bucket,
  wireguardHubPublicKey: wireguardStack.hubPublicKey,
  wireguardHubEndpoint: wireguardStack.hubEndpoint,
  wireguardAgentApiKeyHashParameterName: wireguardStack.agentApiKeyHashParameterName,
  tunnelProxyFunction: wireguardStack.tunnelProxyFunction,
  mssqlExecutorFunction: wireguardStack.mssqlExecutorFunction,
  // Phase 2 Unit 6 — Temporal Cloud + worker-broker shared secret. Same
  // address + namespace TemporalWorkerStack receives, so the API and the
  // worker target the same namespace/queue without a chance of drift.
  temporalAddress: apiTemporalAddress,
  temporalNamespace: apiTemporalNamespace,
  temporalTaskQueue: apiTemporalTaskQueue,
  temporalCloudSecretArn: apiTemporalCloudSecretArn,
  workflowBrokerSecretArn: apiWorkflowBrokerSecretArn,
  // Phase 3 Unit 9 — tenant-runner orchestration. Runner tasks launch into
  // the same PRIVATE_WITH_EGRESS subnets the stdlib worker uses, behind an
  // egress-only SG owned by WireGuardStack (see ApiStackProps for why the
  // SG cannot live on TemporalWorkerStack). ApiStack only activates the
  // RunTask wiring when its Temporal props are also set, so dev (which gets
  // these refs but no Temporal config) stays inert.
  tenantRunnerSubnets: wireguardStack.temporalWorkerSubnets,
  tenantRunnerSecurityGroup: wireguardStack.tenantRunnerSecurityGroup,
  ringcentralEnabled,
  integrationConfigPublishEnabled,
  corsAllowedOrigins,
})
apiStack.addDependency(cognitoStack)

// ── ApiCdnStack ───────────────────────────────────────────────────────────────
// CloudFront in front of the HTTP API, with the api.pegasus[-qa].dolas.dev
// custom domain attached in staging/prod (cert + SSM contract owned by
// dolas-infra, see lib/stacks/api-cdn-stack.ts). Dev gets a *.cloudfront.net
// distribution without the custom domain, matching the FrontendStack pattern.
// CDK deployment order: ApiStack → ApiCdnStack.

const apiCdnStack = new ApiCdnStack(app, `${stackIdPrefix}-ApiCdnStack`, {
  env,
  stackName: `${stackNamePrefix}-api-cdn`,
  description: `${descPrefix} — CloudFront in front of the HTTP API (custom domain api.pegasus[-qa].dolas.dev)`,
  httpApiId: apiStack.httpApiId,
  httpApiRegion: env.region ?? 'us-east-1',
  // staging → api.pegasus-qa.dolas.dev, prod → api.pegasus.dolas.dev. Cert +
  // domain come from SSM published by dolas-infra. dev stays at *.cloudfront.net.
  attachCustomDomain: envName === 'staging' || envName === 'prod',
})
apiCdnStack.addDependency(apiStack)

// ── OutboxRelayStack ──────────────────────────────────────────────────────────
// pegII integration-event pipeline (EventBridge bus + archive + SQS buffer/DLQ +
// mapper Lambda). Staging/prod only — dev has no on-prem relay. No deploy
// dependency on other stacks.
//
// The relay's publish identity (IAM Roles Anywhere) is enabled DURABLY per env by
// committing the self-managed CA's PUBLIC cert at
// `config/outbox-relay/<env>-ca.pem` (it is not secret). When that file exists the
// trust anchor is provisioned on EVERY synth — including routine CI deploys — so it
// can't be silently torn down the way a one-shot `-c` flag would be (cf. the
// RingCentral env-gate lesson). No committed cert → Roles Anywhere is skipped and
// the bus still deploys. Overrides for non-committed setups:
// `-c outboxAcmPcaArn=<arn>` (ACM Private CA), or `-c outboxRolesAnywhere=true`
// with the SSM-lookup path (`-c outboxCaCertParam=...`).
const outboxConfig = envName === 'dev' ? undefined : OUTBOX_RELAY[envName]
if (outboxConfig) {
  const committedCaPath = path.join(__dirname, `../config/outbox-relay/${envName}-ca.pem`)
  const committedCaPem = fs.existsSync(committedCaPath)
    ? fs.readFileSync(committedCaPath, 'utf8')
    : undefined
  const outboxAcmPcaArn = app.node.tryGetContext('outboxAcmPcaArn') as string | undefined
  const outboxRolesAnywhereFlag =
    app.node.tryGetContext('outboxRolesAnywhere') === true ||
    app.node.tryGetContext('outboxRolesAnywhere') === 'true'
  const outboxRolesAnywhere = outboxAcmPcaArn
    ? { acmPcaArn: outboxAcmPcaArn }
    : committedCaPem
      ? { certificateBundlePem: committedCaPem }
      : outboxRolesAnywhereFlag
        ? {
            caCertSsmParameterName:
              (app.node.tryGetContext('outboxCaCertParam') as string | undefined) ??
              `/pegasus/${envName}/outbox-relay-ca-pem`,
          }
        : undefined
  new OutboxRelayStack(app, `${stackIdPrefix}-OutboxRelayStack`, {
    env,
    stackName: `${stackNamePrefix}-outbox-relay`,
    description: `${descPrefix} — pegII integration EventBridge bus + SQS mapper`,
    busName: outboxConfig.busName,
    bufferQueueName: outboxConfig.bufferQueueName,
    bufferDlqName: outboxConfig.bufferDlqName,
    rolesAnywhere: outboxRolesAnywhere,
  })
}

// ── MonitoringStack ───────────────────────────────────────────────────────────
// CDK deployment order: ApiStack → MonitoringStack.

new MonitoringStack(app, `${stackIdPrefix}-MonitoringStack`, {
  env,
  stackName: `${stackNamePrefix}-monitoring`,
  description: `${descPrefix} — CloudWatch alarms and dashboard`,
  lambdaFunctionName: apiStack.lambdaFunctionName,
  httpApiId: apiStack.httpApiId,
  httpApiStage: apiStack.httpApiStage,
  ringcentralCaptureDlqName: apiStack.ringcentralCaptureDlqName,
  // Integration-event buffer (OutboxRelayStack) queue/dlq names for the two
  // mapper-pipeline alarms. Staging/prod only; dev leaves them undefined.
  integrationBufferQueueName: outboxConfig?.bufferQueueName,
  integrationBufferDlqName: outboxConfig?.bufferDlqName,
  // Alarm notifications go to a human on staging + prod; dev stays silent.
  // Overridable per-synth via `-c alarmEmail=...`. NOTE: the SNS email
  // subscription needs a one-time confirmation click per env after deploy.
  alarmEmail:
    (app.node.tryGetContext('alarmEmail') as string | undefined) ??
    (envName === 'staging' || envName === 'prod' ? 'dolasllc@gmail.com' : undefined),
  // Phase 1 — Temporal worker ECS alarm. Names are deterministic and equal:
  // cluster + service both use `pegasus-temporal-worker-${envName}`.
  // Staging/prod only; dev has no Fargate worker → props remain undefined.
  temporalWorkerClusterName:
    envName === 'staging' || envName === 'prod' ? `pegasus-temporal-worker-${envName}` : undefined,
  temporalWorkerServiceName:
    envName === 'staging' || envName === 'prod' ? `pegasus-temporal-worker-${envName}` : undefined,
  // Phase 2 — Logs Insights query definitions. Pass log-group names from
  // ApiStack (always available) and the temporal worker log group name
  // (staging/prod only — matches temporal-worker-stack.ts :229).
  apiLogGroupName: apiStack.apiLogGroupName,
  apiAccessLogGroupName: apiStack.apiAccessLogGroupName,
  cronLogGroupNames: apiStack.cronLogGroupNames,
  temporalWorkerLogGroupName:
    envName === 'staging' || envName === 'prod' ? `/pegasus/${envName}/temporal-worker` : undefined,
})

// ── Asset stacks (deployed last — depend on all upstream stacks) ──────────────
// CDK deployment order: ApiStack → FrontendAssetsStack + AdminFrontendAssetsStack.

// Pass frontendStackName / adminFrontendStackName by string (not construct
// ref) so CDK's auto-export mechanism doesn't generate cross-stack exports
// whose logical IDs drift across CDK versions. The asset stacks resolve the
// bucket + distribution via Fn::ImportValue against stable, hand-pinned
// export names declared in FrontendStack / AdminFrontendStack.
const frontendAssetsStack = new FrontendAssetsStack(app, `${stackIdPrefix}-FrontendAssetsStack`, {
  env,
  stackName: `${stackNamePrefix}-frontend-assets`,
  description: `${descPrefix} — tenant web app assets + config.json`,
  frontendStackName: frontendStack.stackName,
  apiStackName: apiStack.stackName,
  cognitoStackName: cognitoStack.stackName,
  cognitoRegion: env.region ?? 'us-east-1',
  // staging/prod → https://api.pegasus[-qa].dolas.dev (via CloudFront).
  // dev keeps the raw execute-api URL — no custom API domain there.
  useApiCustomDomain: envName === 'staging' || envName === 'prod',
  // Point config.json's cognito.redirectUri at the branded domain in
  // staging/prod so login + logout stay on pegasus[-qa].dolas.dev.
  useWebCustomDomain: envName === 'staging' || envName === 'prod',
  // Enable the "jump to order" desktop launcher on QA + prod. (Inert until the
  // Pegasus desktop app registers the pegasus-desktop:// scheme — see
  // plans/todo/jump-to-order-desktop-handoff.md.)
  jumpToOrderEnabled: envName === 'staging' || envName === 'prod',
})
frontendAssetsStack.addDependency(frontendStack)
frontendAssetsStack.addDependency(apiStack)
frontendAssetsStack.addDependency(cognitoStack)

const adminFrontendAssetsStack = new AdminFrontendAssetsStack(
  app,
  `${stackIdPrefix}-AdminFrontendAssetsStack`,
  {
    env,
    stackName: `${stackNamePrefix}-admin-frontend-assets`,
    description: `${descPrefix} — admin portal assets + config.json`,
    adminFrontendStackName: adminFrontendStack.stackName,
    cognitoStackName: cognitoStack.stackName,
    apiStackName: apiStack.stackName,
    cognitoRegion: env.region ?? 'us-east-1',
    // staging/prod → https://api.pegasus[-qa].dolas.dev (via CloudFront).
    // dev keeps the raw execute-api URL — no custom API domain there.
    useApiCustomDomain: envName === 'staging' || envName === 'prod',
    // Point config.json's cognito.redirectUri at admin.pegasus[-qa].dolas.dev
    // in staging/prod so login + logout stay on the brand.
    useWebCustomDomain: envName === 'staging' || envName === 'prod',
  },
)
adminFrontendAssetsStack.addDependency(adminFrontendStack)
adminFrontendAssetsStack.addDependency(cognitoStack)
adminFrontendAssetsStack.addDependency(apiStack)

// ── TemporalWorkerStack (Phase 2 Unit 4) ─────────────────────────────────────
// Staging/prod only. Dev runs Temporal locally via docker-compose.temporal.yml,
// no Fargate fleet there. Depends on WireGuardStack (for VPC + worker subnets)
// and ApiStack (PEGASUS_API_BASE_URL must be live so the worker can reach the
// internal broker + status-sync endpoints once Unit 6 wires them up).
//
// In Unit 4 the service runs at `desiredCount: 0` and the ECR repo is empty,
// so deploying this stack is essentially a no-op other than creating the
// scaffolding. Unit 5 ships the worker image and bumps the desired count.
//
// PEGASUS_API_BASE_URL: in staging/prod we point at the branded
// `https://api.pegasus[-qa].dolas.dev` resolved from the SSM param dolas-infra
// publishes (`/dolas/pegasus/api/domain-name`). This matches how
// FrontendAssetsStack writes the same URL into config.json, so the worker and
// the browser SPA both target the same CloudFront-fronted API endpoint.
if (envName === 'staging' || envName === 'prod') {
  const apiCustomDomain = cdk.Fn.join('', [
    'https://',
    cdk.aws_ssm.StringParameter.valueForStringParameter(apiStack, '/dolas/pegasus/api/domain-name'),
  ])
  const temporalWorkerStack = new TemporalWorkerStack(app, `${stackIdPrefix}-TemporalWorkerStack`, {
    env,
    stackName: `${stackNamePrefix}-temporal-worker`,
    description: `${descPrefix} — Temporal Cloud worker (ECS Fargate, curated stdlib workflows)`,
    vpc: wireguardStack.vpc,
    workerSubnets: wireguardStack.temporalWorkerSubnets,
    // Temporal Cloud namespace IDs are `<short>.<account-id>` — the
    // short name alone is not what `validate` will accept. Verified
    // 2026-06-06 against the live `chgel` account: the SDK's first
    // `describeNamespace` returns PermissionDenied with the short
    // form, and the worker crashes with `Worker validation failed`.
    // Derive the full ID from the gRPC address, which already
    // embeds it (`<full-namespace>.tmprl.cloud:7233`).
    temporalNamespace: TEMPORAL_ADDRESS[envName].replace(/\.tmprl\.cloud:\d+$/, ''),
    temporalAddress: TEMPORAL_ADDRESS[envName],
    temporalTaskQueue: `pegasus-stdlib-${envName}`,
    pegasusApiBaseUrl: apiCustomDomain,
    envName,
    temporalCloudSecretArn: TEMPORAL_SECRET_ARNS[envName].temporalCloud,
    workflowBrokerSecretArn: TEMPORAL_SECRET_ARNS[envName].workflowBroker,
  })
  temporalWorkerStack.addDependency(wireguardStack)
  temporalWorkerStack.addDependency(apiStack)
}
