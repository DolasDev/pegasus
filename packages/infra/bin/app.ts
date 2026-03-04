#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { CognitoStack } from '../lib/stacks/cognito-stack'
import { ApiStack } from '../lib/stacks/api-stack'
import { FrontendStack } from '../lib/stacks/frontend-stack'
import { AdminFrontendStack } from '../lib/stacks/admin-frontend-stack'

const app = new cdk.App()

const devEnv: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
}

// CloudFront URLs resolved at deploy time and passed via CDK context so Cognito
// registers them as allowed OAuth callback/logout URLs alongside localhost.
//
// Usage:
//   --context adminUrl=https://xxx.cloudfront.net
//   --context tenantUrl=https://yyy.cloudfront.net
// The deploy.sh script sets these automatically.
const adminUrl = app.node.tryGetContext('adminUrl') as string | undefined
const tenantUrl = app.node.tryGetContext('tenantUrl') as string | undefined

// Cognito/API values for the tenant frontend two-pass deploy.
// Passed via CDK context on the asset pass (step 5 of deploy.sh) so the
// FrontendStack can be provisioned infrastructure-only on the first pass
// (before these values exist) and then re-deployed with assets + config.json.
//
//   --context apiUrl=https://...execute-api.amazonaws.com
//   --context cognitoDomain=https://pegasus-xxx.auth.us-east-1.amazoncognito.com
//   --context cognitoUserPoolId=us-east-1_XXXXXX
//   --context cognitoTenantClientId=xxxx
const tenantApiUrl = app.node.tryGetContext('apiUrl') as string | undefined
const tenantCognitoDomain = app.node.tryGetContext('cognitoDomain') as string | undefined
const tenantCognitoUserPoolId = app.node.tryGetContext('cognitoUserPoolId') as string | undefined
const tenantCognitoClientId = app.node.tryGetContext('cognitoTenantClientId') as string | undefined

// Shared Cognito User Pool — provisioned first; other stacks reference its outputs.
const cognitoStack = new CognitoStack(app, 'PegasusDev-CognitoStack', {
  env: devEnv,
  stackName: 'pegasus-dev-cognito',
  description: 'Pegasus dev — Cognito User Pool for platform and tenant auth',
  adminCallbackUrls: adminUrl
    ? ['http://localhost:5174/auth/callback', `${adminUrl}/auth/callback`]
    : undefined,
  adminLogoutUrls: adminUrl ? ['http://localhost:5174/login', `${adminUrl}/login`] : undefined,
  tenantCallbackUrls: tenantUrl
    ? ['http://localhost:5173/login/callback', `${tenantUrl}/login/callback`]
    : undefined,
  tenantLogoutUrls: tenantUrl ? ['http://localhost:5173/login', `${tenantUrl}/login`] : undefined,
})

new ApiStack(app, 'PegasusDev-ApiStack', {
  env: devEnv,
  stackName: 'pegasus-dev-api',
  description: 'Pegasus dev — Hono Lambda + HTTP API Gateway v2',
  // Thread Cognito values from CognitoStack into the API Lambda env.
  cognitoJwksUrl: cognitoStack.jwksUrl,
  // Tenant client ID for /api/auth/validate-token audience validation.
  cognitoTenantClientId: cognitoStack.tenantAppClient.userPoolClientId,
  // User Pool ID for AdminCreateUser when provisioning tenant admin accounts.
  cognitoUserPoolId: cognitoStack.userPool.userPoolId,
})

// FrontendStack is deployed twice by deploy.sh (mirrors AdminFrontendStack):
//   Pass 1 (infra): no Cognito/API context — provisions CloudFront so the URL
//                   can be registered with CognitoStack as a callback URL.
//   Pass 2 (assets): Cognito/API context provided via --context flags; CDK
//                    uploads built assets and generates config.json.
new FrontendStack(app, 'PegasusDev-FrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-frontend',
  description: 'Pegasus dev — S3 static assets + CloudFront distribution',
  apiUrl: tenantApiUrl,
  cognitoRegion: devEnv.region ?? 'us-east-1',
  cognitoUserPoolId: tenantCognitoUserPoolId,
  cognitoTenantClientId: tenantCognitoClientId,
  cognitoDomain: tenantCognitoDomain,
})

// AdminFrontendStack is deployed twice by deploy.sh:
//   Pass 1 (infra): no Cognito/API context — provisions the CloudFront distribution
//                   so the URL can be registered with CognitoStack.
//   Pass 2 (assets): Cognito/API context is provided via --context flags, CDK
//                    uploads the built assets and generates config.json.
//
// Pass Cognito/API props via CDK context on the second deploy:
//   --context apiUrl=https://...
//   --context cognitoDomain=https://...
//   --context cognitoAdminClientId=xxxx
const adminApiUrl = app.node.tryGetContext('apiUrl') as string | undefined
const adminCognitoDomain = app.node.tryGetContext('cognitoDomain') as string | undefined
const adminCognitoClientId = app.node.tryGetContext('cognitoAdminClientId') as string | undefined

new AdminFrontendStack(app, 'PegasusDev-AdminFrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-admin-frontend',
  description: 'Pegasus dev — Admin portal S3 static assets + CloudFront distribution',
  apiUrl: adminApiUrl,
  cognitoDomain: adminCognitoDomain,
  cognitoAdminClientId: adminCognitoClientId,
})
