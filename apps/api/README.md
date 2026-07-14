# Pegasus API

The core Hono REST API for the Pegasus platform. It is deployed as an **AWS
Lambda** function (entry point `src/lambda.ts`), fronted by API Gateway and
provisioned by `packages/infra`.

## Running locally

The same app also runs as a plain Node HTTP server via `src/server.ts` (using
`@hono/node-server`) for local development and the e2e suite's `webServer` (see
`apps/e2e/playwright.config.ts`):

```bash
npm run start:dev            # tsx src/server.ts
```

Environment variables:

- `DATABASE_URL` / `DIRECT_URL` — PostgreSQL connection string.
- `PORT` — HTTP port (default `3000`).
- `HOST` — bind address (default `0.0.0.0`).
- `SKIP_AUTH` / `DEFAULT_TENANT_ID` — when `SKIP_AUTH=true`, Cognito auth is
  bypassed for local/internal use. Forbidden when `NODE_ENV=production` (fails
  closed at boot).

Database setup:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

## Legacy SQL Server (MSSQL) access

Some tenants still read from the legacy SQL Server database used by the original
VB.NET WinForms application (via the `longhaul-cloud` routes, the pegII
dashboard, and the pegII customer/order gateways). All of that traffic goes
through the **in-VPC `mssql-executor` Lambda over the WireGuard tunnel** —
`src/lib/mssql-executor-client.ts` — never a direct connection from the API
Lambda (which has no route to a tenant's on-prem network).

The MSSQL connection string is stored **per-tenant** in the PostgreSQL `tenants`
table (`mssql_connection_string` column) and managed via `GET`/`PATCH`
`/api/v1/settings/mssql` (with `POST /api/v1/settings/mssql/test` for a
connectivity check). If it is unset for a tenant, legacy-backed requests surface
a stable error rather than falling back.

> **Historical note:** this package previously shipped a standalone on-prem
> Windows Service (`server.ts` → `app.server.ts`) that opened direct MSSQL
> connection pools and served generic `pegii`/`efwk` entity routes. That server
> and those routes were retired (see
> `plans/completed/…retire-pegii-efwk-onprem-routes.md`); the executor-Lambda
> path above is now the only way the platform reaches legacy SQL Server.
