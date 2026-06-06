#!/usr/bin/env node
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

// Temporal Cloud namespace gRPC endpoints, one per non-dev env. Consumed by:
//   - TemporalWorkerStack (Phase 2 Unit 4) — Fargate worker env TEMPORAL_ADDRESS
//   - ApiStack (Phase 2 Unit 6)            — API Lambda env TEMPORAL_ADDRESS
// Credentials live in Secrets Manager at pegasus/{env}/temporal-cloud
// (Secret.fromSecretNameV2 convention). Dev uses local Temporal via
// docker-compose.temporal.yml — no entry needed here.
export const TEMPORAL_ADDRESS: Record<Exclude<EnvName, 'dev'>, string> = {
  staging: 'pegasus-staging.chgel.tmprl.cloud:7233',
  prod: 'pegasus-prod.chgel.tmprl.cloud:7233',
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

// ── MonitoringStack ───────────────────────────────────────────────────────────
// CDK deployment order: ApiStack → MonitoringStack.

new MonitoringStack(app, `${stackIdPrefix}-MonitoringStack`, {
  env,
  stackName: `${stackNamePrefix}-monitoring`,
  description: `${descPrefix} — CloudWatch alarms and dashboard`,
  lambdaFunctionName: apiStack.lambdaFunctionName,
  httpApiId: apiStack.httpApiId,
  httpApiStage: apiStack.httpApiStage,
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
    cdk.aws_ssm.StringParameter.valueForStringParameter(
      apiStack,
      '/dolas/pegasus/api/domain-name',
    ),
  ])
  const temporalWorkerStack = new TemporalWorkerStack(
    app,
    `${stackIdPrefix}-TemporalWorkerStack`,
    {
      env,
      stackName: `${stackNamePrefix}-temporal-worker`,
      description: `${descPrefix} — Temporal Cloud worker (ECS Fargate, curated stdlib workflows)`,
      vpc: wireguardStack.vpc,
      workerSubnets: wireguardStack.temporalWorkerSubnets,
      temporalNamespace: `pegasus-${envName}`,
      temporalAddress: TEMPORAL_ADDRESS[envName],
      temporalTaskQueue: `pegasus-stdlib-${envName}`,
      pegasusApiBaseUrl: apiCustomDomain,
      envName,
    },
  )
  temporalWorkerStack.addDependency(wireguardStack)
  temporalWorkerStack.addDependency(apiStack)
}
