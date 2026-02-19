#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { DatabaseStack } from '../lib/stacks/database-stack'
import { ApiStack } from '../lib/stacks/api-stack'

const app = new cdk.App()

const devEnv: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
}

const databaseStack = new DatabaseStack(app, 'PegasusDev-DatabaseStack', {
  env: devEnv,
  stackName: 'pegasus-dev-database',
  description: 'Pegasus dev — Aurora Serverless v2 + RDS Proxy + Secrets Manager',
})

new ApiStack(app, 'PegasusDev-ApiStack', {
  env: devEnv,
  stackName: 'pegasus-dev-api',
  description: 'Pegasus dev — Hono Lambda + HTTP API Gateway v2',
  databaseStack,
})
