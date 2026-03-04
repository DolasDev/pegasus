#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CognitoStack } from '../lib/stacks/cognito-stack'
import { ApiStack } from '../lib/stacks/api-stack'
import { FrontendStack } from '../lib/stacks/frontend-stack'
import { AdminFrontendStack } from '../lib/stacks/admin-frontend-stack'
import { FrontendAssetsStack } from '../lib/stacks/frontend-assets-stack'
import { AdminFrontendAssetsStack } from '../lib/stacks/admin-frontend-assets-stack'

const app = new cdk.App()

const devEnv: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
}

// ── Infra stacks (deployed first — no dependencies) ──────────────────────────
// CloudFront distribution domain names are CDK tokens. When CognitoStack
// references them, CDK generates Fn::ImportValue so CloudFormation resolves
// the real hostname before creating/updating the Cognito app clients.

const frontendStack = new FrontendStack(app, 'PegasusDev-FrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-frontend',
  description: 'Pegasus dev — S3 + CloudFront (tenant web app)',
})

const adminFrontendStack = new AdminFrontendStack(app, 'PegasusDev-AdminFrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-admin-frontend',
  description: 'Pegasus dev — S3 + CloudFront (admin portal)',
})

// ── CognitoStack ──────────────────────────────────────────────────────────────
// Receives cross-stack tokens for both CloudFront distribution domains.
// CDK deployment order: FrontendStack + AdminFrontendStack → CognitoStack.

const cognitoStack = new CognitoStack(app, 'PegasusDev-CognitoStack', {
  env: devEnv,
  stackName: 'pegasus-dev-cognito',
  description: 'Pegasus dev — Cognito User Pool for platform and tenant auth',
  tenantDistributionDomain: frontendStack.distribution.distributionDomainName,
  adminDistributionDomain: adminFrontendStack.distribution.distributionDomainName,
})

// ── ApiStack ──────────────────────────────────────────────────────────────────
// CDK deployment order: CognitoStack → ApiStack.

const apiStack = new ApiStack(app, 'PegasusDev-ApiStack', {
  env: devEnv,
  stackName: 'pegasus-dev-api',
  description: 'Pegasus dev — Hono Lambda + HTTP API Gateway v2',
  cognitoJwksUrl: cognitoStack.jwksUrl,
  cognitoTenantClientId: cognitoStack.tenantAppClient.userPoolClientId,
  cognitoUserPoolId: cognitoStack.userPool.userPoolId,
})

// ── Asset stacks (deployed last — depend on all upstream stacks) ──────────────
// CDK deployment order: ApiStack → FrontendAssetsStack + AdminFrontendAssetsStack.

new FrontendAssetsStack(app, 'PegasusDev-FrontendAssetsStack', {
  env: devEnv,
  stackName: 'pegasus-dev-frontend-assets',
  description: 'Pegasus dev — tenant web app assets + config.json',
  siteBucket: frontendStack.siteBucket,
  distribution: frontendStack.distribution,
  apiUrl: apiStack.apiUrl,
  cognitoRegion: devEnv.region ?? 'us-east-1',
  cognitoUserPoolId: cognitoStack.userPool.userPoolId,
  cognitoTenantClientId: cognitoStack.tenantAppClient.userPoolClientId,
  cognitoDomain: cognitoStack.hostedUiBaseUrl,
})

new AdminFrontendAssetsStack(app, 'PegasusDev-AdminFrontendAssetsStack', {
  env: devEnv,
  stackName: 'pegasus-dev-admin-frontend-assets',
  description: 'Pegasus dev — admin portal assets + config.json',
  adminBucket: adminFrontendStack.adminBucket,
  distribution: adminFrontendStack.distribution,
  apiUrl: apiStack.apiUrl,
  cognitoDomain: cognitoStack.hostedUiBaseUrl,
  cognitoAdminClientId: cognitoStack.adminAppClient.userPoolClientId,
})
