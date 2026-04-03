// ---------------------------------------------------------------------------
// Lambda entry point
//
// Wraps the Hono app with the AWS Lambda adapter.
//
// Environment variables expected at runtime:
//   DATABASE_URL  — Neon pooled connection string, injected from Secrets Manager
//                   (pegasus/dev/database-url) by the CDK ApiStack at deploy time.
// ---------------------------------------------------------------------------

import { handle } from 'hono/aws-lambda'
import { app } from './app'
import { validateEnv } from './lib/env'

// Validate required env vars at Lambda cold start so a misconfigured
// deployment fails immediately rather than silently serving broken requests.
validateEnv()

export const handler = handle(app)
