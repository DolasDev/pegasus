#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { DatabaseStack } from '../lib/stacks/database-stack'
import { ApiStack } from '../lib/stacks/api-stack'

const app = new cdk.App()

const env: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'] ?? process.env['AWS_ACCOUNT_ID'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
}

const databaseStack = new DatabaseStack(app, 'PegasusDatabaseStack', { env })

new ApiStack(app, 'PegasusApiStack', {
  env,
  databaseStack,
})
