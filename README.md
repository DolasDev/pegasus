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

The deploy script handles everything: CDK stacks, Vite builds, and asset uploads.

```bash
# Full deployment (Cognito + API + tenant frontend + admin portal)
npm run deploy

# API only (skips all frontend builds)
npm run deploy -- --api-only

# Admin portal only (re-build and re-upload admin assets)
npm run deploy -- --admin-only

# Skip CognitoStack when the user pool is stable
npm run deploy -- --skip-cognito
```

The script writes `VITE_*` environment files and resolves Cognito configuration from SSM automatically. The admin portal requires two CDK passes on first deploy (CloudFront URL is not known until the stack exists).

The AWS profile defaults to `admin-dev`. Override with:

```bash
AWS_PROFILE=my-profile npm run deploy
```

### Destroy

```bash
cd packages/infra
npx cdk destroy PegasusDev-ApiStack PegasusDev-FrontendStack PegasusDev-AdminFrontendStack
```

> The `PegasusDev-CognitoStack` has `removalPolicy: RETAIN` on the user pool. Destroy the stack via the AWS Console if you need to fully tear down.

---

## Create the initial platform admin

After deploying `PegasusDev-CognitoStack` for the first time, run the guided setup script to create a `PLATFORM_ADMIN` user with TOTP MFA enrolled.

**Prerequisites:**

- `PegasusDev-CognitoStack` deployed (`pegasus-dev-cognito` stack exists).
- An authenticator app ready: Google Authenticator, Authy, 1Password, etc.
- An active AWS SSO session for the target profile:

```bash
aws sso login --profile admin-dev
```

**Run the script:**

```bash
AWS_PROFILE=admin-dev npm run create-admin-user
```

The script walks through seven steps interactively:

1. Resolves the Cognito User Pool ID and admin app client ID (prompts if not set via env vars).
2. Prompts for the new admin's email address.
3. Creates the Cognito user (welcome email suppressed).
4. Sets a cryptographically random permanent password (shown once at the end — save it immediately).
5. Enrolls TOTP MFA: displays a secret key and `otpauth://` URI to add to your authenticator app, then verifies a 6-digit code before proceeding.
6. Grants `PLATFORM_ADMIN` group membership (after MFA is verified — not before).
7. Prints a summary with the email, generated password, and next steps.

**Skip the interactive prompts** by pre-setting environment variables:

```bash
PEGASUS_COGNITO_POOL_ID=us-east-1_XXXXXXXXX \
PEGASUS_COGNITO_CLIENT_ID=YYYYYYYYYY \
AWS_REGION=us-east-1 \
npm run create-admin-user
```

The pool ID and client ID are available as CloudFormation outputs on the `pegasus-dev-cognito` stack, or from SSM:

```bash
aws ssm get-parameter --profile admin-dev --name /pegasus/admin/cognito-user-pool-id    --query Parameter.Value --output text
aws ssm get-parameter --profile admin-dev --name /pegasus/admin/cognito-admin-client-id --query Parameter.Value --output text
```

**After the script completes:**

- Copy the generated password to a team password manager — it is shown only once.
- Sign into the admin portal using the Cognito Hosted UI to confirm MFA is working.
- Share the email and password with the user via a secure channel.
