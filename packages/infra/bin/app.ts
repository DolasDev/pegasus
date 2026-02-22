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

// The admin CloudFront URL is resolved at deploy time (after AdminFrontendStack
// is provisioned) and passed in via CDK context so Cognito can register it as
// an allowed OAuth callback/logout URL alongside the localhost dev URL.
//
// Usage:  cdk deploy PegasusDev-CognitoStack --context adminUrl=https://xxx.cloudfront.net
// The deploy.sh script sets this automatically.
const adminUrl = app.node.tryGetContext('adminUrl') as string | undefined

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
})

new ApiStack(app, 'PegasusDev-ApiStack', {
  env: devEnv,
  stackName: 'pegasus-dev-api',
  description: 'Pegasus dev — Hono Lambda + HTTP API Gateway v2',
  // Thread the JWKS URL from the Cognito stack into the API Lambda environment
  // so the admin auth middleware can verify JWTs without a shared secret.
  cognitoJwksUrl: cognitoStack.jwksUrl,
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
