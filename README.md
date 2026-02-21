# Pegasus

Cloud-native move management platform — a TypeScript monorepo built on Hono, React, Prisma, and AWS CDK.

## Prerequisites

- Node ≥ 18, npm ≥ 9
- AWS CLI configured (`aws configure`) for deploy steps
- A [Neon](https://neon.tech) project (or any PostgreSQL instance) for the database

## Install

```bash
npm install
```

---

## Local development

### 1. Set up the database

Create a `.env` file in `packages/api/`:

```bash
# packages/api/.env
DIRECT_URL="postgres://user:pass@host/dbname?sslmode=require"
DATABASE_URL="postgres://user:pass@host/dbname?sslmode=require"
```

Run migrations:

```bash
cd packages/api
npx prisma migrate dev
```

Optionally open Prisma Studio:

```bash
cd packages/api
npx prisma studio
```

### 2. Start the API

The API is a standard Hono app. Run it directly with tsx:

```bash
cd packages/api
npx tsx src/index.ts
```

### 3. Start the web app

```bash
cd packages/web
npm run dev
```

The Vite dev server starts at `http://localhost:5173` by default.

---

## Build

Build all packages from the repo root:

```bash
npm run build
```

Or build individually:

```bash
# API (TypeScript → JS)
cd packages/api && npm run build

# Web (Vite production bundle → packages/web/dist)
cd packages/web && npm run build
```

---

## Test

```bash
# All packages
npm test

# Single package
cd packages/domain && npm test
cd packages/api && npm test
cd packages/infra && npm test
```

API integration tests require a live database. Set `DATABASE_URL` in the environment — tests automatically skip when it is not set.

---

## Type-check

```bash
npm run typecheck
```

---

## Deploy

### One-time setup (first deploy only)

**1. Store the Neon connection string in AWS Secrets Manager:**

```bash
aws secretsmanager create-secret \
  --name pegasus/dev/database-url \
  --secret-string "postgres://user:pass@ep-xxx-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

Use the **pooled** connection string from your Neon project dashboard (hostname ends in `-pooler.neon.tech`).

**2. Run migrations against Neon:**

```bash
cd packages/api
DATABASE_URL="postgres://..." npx prisma migrate deploy
```

**3. Bootstrap CDK** (once per AWS account/region):

```bash
cd packages/infra
npx cdk bootstrap
```

### Deploy

Build everything first, then deploy the CDK stacks:

```bash
# From repo root
npm run build

# Deploy API + Frontend
cd packages/infra
npx cdk deploy PegasusDev-ApiStack PegasusDev-FrontendStack
```

The API Gateway URL is printed as a CloudFormation output (`ApiUrl`) after the API stack deploys.

### Destroy

```bash
cd packages/infra
npx cdk destroy PegasusDev-ApiStack PegasusDev-FrontendStack
```
