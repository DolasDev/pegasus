#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { CognitoStack } from '../lib/stacks/cognito-stack'
import { ApiStack } from '../lib/stacks/api-stack'
import { FrontendStack } from '../lib/stacks/frontend-stack'
import { AdminFrontendStack } from '../lib/stacks/admin-frontend-stack'
import { FrontendAssetsStack } from '../lib/stacks/frontend-assets-stack'
import { AdminFrontendAssetsStack } from '../lib/stacks/admin-frontend-assets-stack'
import { MonitoringStack } from '../lib/stacks/monitoring-stack'
import { DocumentsStack } from '../lib/stacks/documents-stack'
import { WireGuardStack } from '../lib/stacks/wireguard-stack'

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
})

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
  cognitoJwksUrl: cognitoStack.jwksUrl,
  cognitoTenantClientId: cognitoStack.tenantAppClient.userPoolClientId,
  cognitoUserPoolId: cognitoStack.userPool.userPoolId,
  cognitoMobileClientId: cognitoStack.mobileAppClient.userPoolClientId,
  cognitoHostedUiDomain: cognitoStack.hostedUiBaseUrl,
  documentsBucket: documentsStack.bucket,
  wireguardHubPublicKey: wireguardStack.hubPublicKey,
  wireguardHubEndpoint: wireguardStack.hubEndpoint,
  tunnelProxyFunction: wireguardStack.tunnelProxyFunction,
})

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

new FrontendAssetsStack(app, `${stackIdPrefix}-FrontendAssetsStack`, {
  env,
  stackName: `${stackNamePrefix}-frontend-assets`,
  description: `${descPrefix} — tenant web app assets + config.json`,
  siteBucket: frontendStack.siteBucket,
  distribution: frontendStack.distribution,
  apiUrl: apiStack.apiUrl,
  cognitoRegion: env.region ?? 'us-east-1',
  cognitoUserPoolId: cognitoStack.userPool.userPoolId,
  cognitoTenantClientId: cognitoStack.tenantAppClient.userPoolClientId,
  cognitoDomain: cognitoStack.hostedUiBaseUrl,
})

new AdminFrontendAssetsStack(app, `${stackIdPrefix}-AdminFrontendAssetsStack`, {
  env,
  stackName: `${stackNamePrefix}-admin-frontend-assets`,
  description: `${descPrefix} — admin portal assets + config.json`,
  adminBucket: adminFrontendStack.adminBucket,
  distribution: adminFrontendStack.distribution,
  apiUrl: apiStack.apiUrl,
  cognitoDomain: cognitoStack.hostedUiBaseUrl,
  cognitoAdminClientId: cognitoStack.adminAppClient.userPoolClientId,
})
