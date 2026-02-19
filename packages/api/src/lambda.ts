// ---------------------------------------------------------------------------
// Lambda entry point
//
// Wraps the Hono app with the AWS Lambda adapter.
//
// Environment variables expected at runtime:
//   DB_PROXY_ENDPOINT  — RDS Proxy endpoint hostname
//   DB_SECRET_ARN      — Secrets Manager secret ARN (holds DB credentials)
//   DB_PORT            — Database port (default: 5432)
//   DB_NAME            — Database name (default: pegasus)
//
// The DATABASE_URL for Prisma should be constructed at Lambda startup by
// fetching credentials from DB_SECRET_ARN and combining with DB_PROXY_ENDPOINT.
// ---------------------------------------------------------------------------

import { handle } from 'hono/aws-lambda'
import { app } from './app'

export const handler = handle(app)
