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

// Shared Cognito User Pool — provisioned first; other stacks reference its outputs.
const cognitoStack = new CognitoStack(app, 'PegasusDev-CognitoStack', {
  env: devEnv,
  stackName: 'pegasus-dev-cognito',
  description: 'Pegasus dev — Cognito User Pool for platform and tenant auth',
  adminCallbackUrls: adminUrl
    ? ['http://localhost:5174/auth/callback', `${adminUrl}/auth/callback`]
    : undefined,
  adminLogoutUrls: adminUrl
    ? ['http://localhost:5174/login', `${adminUrl}/login`]
    : undefined,
  tenantCallbackUrls: tenantUrl
    ? ['http://localhost:5173/login/callback', `${tenantUrl}/login/callback`]
    : undefined,
  tenantLogoutUrls: tenantUrl
    ? ['http://localhost:5173/login', `${tenantUrl}/login`]
    : undefined,
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

new FrontendStack(app, 'PegasusDev-FrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-frontend',
  description: 'Pegasus dev — S3 static assets + CloudFront distribution',
})

new AdminFrontendStack(app, 'PegasusDev-AdminFrontendStack', {
  env: devEnv,
  stackName: 'pegasus-dev-admin-frontend',
  description: 'Pegasus dev — Admin portal S3 static assets + CloudFront distribution',
})
