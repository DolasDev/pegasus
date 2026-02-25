  ---
  Pegasus Development Workflow

  1. Local Setup

  npm install                      # install all workspace dependencies

  On WSL2, fix binary permissions before running any scripts:
  chmod +x node_modules/turbo-linux-64/bin/turbo
  chmod +x node_modules/@esbuild/linux-x64/bin/esbuild
  find node_modules/.bin -type f | xargs chmod +x 2>/dev/null

  Each SPA needs a local runtime config (not baked into the build):
  cp packages/web/public/config.json.example packages/web/public/config.json
  cp apps/admin/public/config.json.example apps/admin/public/config.json
  # Edit both files to point at your local/dev API and Cognito endpoints

  ---
  2. Development Mode

  npm run dev          # starts all packages in parallel via Turborepo

  ┌──────────────┬────────────────────────┬────────────────┐
  │   Package    │          Port          │ What it serves │
  ├──────────────┼────────────────────────┼────────────────┤
  │ packages/api │ Lambda (local adapter) │ Hono API       │
  ├──────────────┼────────────────────────┼────────────────┤
  │ packages/web │ 5173                   │ Tenant SPA     │
  ├──────────────┼────────────────────────┼────────────────┤
  │ apps/admin   │ 5174                   │ Admin SPA      │
  └──────────────┴────────────────────────┴────────────────┘

  Domain changes (packages/domain) are picked up automatically by the API and both SPAs since Vite/Vitest alias
  @pegasus/domain directly to src/index.ts.

  Schema changes require regenerating the Prisma client:
  cd packages/api
  npm run db:migrate      # applies migration to local DB (requires Docker)
  npm run db:generate     # regenerates the Prisma client

  ---
  3. Testing

  Tests are the only gate between a code change and a commit. The test suite has three distinct layers that run in
  parallel via Turborepo:

  ┌─────────────────────────┬─────────────────────────────────────┬─────────────────────────────────────────────────┐
  │         Package         │                Kind                 │                   Requirement                   │
  ├─────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────────────────┤
  │ packages/domain         │ Unit — pure functions, no I/O, no   │ None                                            │
  │                         │ mocks                               │                                                 │
  ├─────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────────────────┤
  │ packages/api            │ Integration — handler + repository  │ Docker (local Postgres); skipped if             │
  │                         │ tests                               │ DATABASE_URL unset                              │
  ├─────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────────────────┤
  │ packages/infra          │ CDK assertions + snapshots          │ None                                            │
  ├─────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────────────────┤
  │ packages/web /          │ Unit — auth helpers, utilities      │ None                                            │
  │ apps/admin              │                                     │                                                 │
  └─────────────────────────┴─────────────────────────────────────┴─────────────────────────────────────────────────┘

  npm test                 # all packages, parallel, cache disabled

  Tests must pass completely before proceeding. Failing tests are code bugs — do not skip, disable, or work around them.

  npm run typecheck        # topological — domain first, then consumers
  npm run lint             # parallel across all packages

  ---
  4. Pre-commit Hook

  Husky runs two checks on every git commit:

  1. lint-staged — ESLint (auto-fix) + Prettier (auto-format) on staged .ts, .tsx, .json, .md, .yaml files.
  2. shellcheck — static analysis of packages/infra/deploy.sh.

  These are automatic. If either fails, the commit is blocked; fix the issue and re-stage.

  ---
  5. Committing

  Changes are committed manually after explicit developer approval. There is no auto-commit. Once tests pass and the
  pre-commit hook clears:

  git add <specific files>     # never git add -A blindly
  git commit -m "..."

  Commit messages follow conventional-commit style (the existing log shows feat:, fix:, test:, docs:, refactor:). Each
  commit should leave the codebase in a deployable state — no half-implemented features.

  ---
  6. Build

  npm run build            # Turborepo topological build: domain → api → web/admin/infra

  Build outputs land in each package's dist/. Notably, no environment URLs are baked into the frontend bundles — both
  SPAs load /config.json at runtime, which CDK writes to S3 at deploy time.

  ---
  7. Deployment

  The full stack deploys via a single orchestration script:

  npm run deploy                        # full stack
  bash packages/infra/deploy.sh --dry-run          # preview all commands
  bash packages/infra/deploy.sh --api-only         # Lambda + API Gateway only
  bash packages/infra/deploy.sh --skip-cognito     # skip Cognito (pool is stable)
  bash packages/infra/deploy.sh --admin-only       # admin frontend only

  The script runs six ordered CDK steps:

  [1] npm build (web + admin)
  [2] cdk deploy AdminFrontendStack  ← first pass: provision CloudFront, capture URL
  [3] cdk deploy CognitoStack        ← registers admin CloudFront URL as OAuth callback
  [4] cdk deploy ApiStack            ← Lambda + API Gateway, emits API URL output
  [5] cdk deploy FrontendStack       ← S3 + CloudFront for tenant SPA, writes config.json
  [6] cdk deploy AdminFrontendStack  ← second pass: uploads assets + config.json with resolved URLs

  The two-pass AdminFrontendStack deploy is intentional: the CloudFront URL must exist before Cognito can whitelist it,
  and the config.json can only be written after the API and Cognito URLs are resolved. On subsequent runs step 2 is a
  fast no-op.

  CDK stack outputs flow through /tmp/pegasus-cdk-outputs.json, which jq reads between steps to thread URLs as context
  into later stacks.

  ---
  8. Post-deploy Verification

  After deploying, the script prints the live endpoints:

  Tenant frontend: https://<cf-id>.cloudfront.net
  Admin portal:    https://<admin-cf-id>.cloudfront.net
  API:             https://<api-id>.execute-api.us-east-1.amazonaws.com

  If a new admin user is needed:
  npm run create-admin-user

  ---
  Summary Flow

  code change
      │
      ├─ npm run dev          (local iteration)
      ├─ npm test             (must pass — all layers)
      ├─ npm run typecheck
      ├─ npm run lint
      │
      └─ git commit           (pre-commit: lint-staged + shellcheck)
            │
            └─ npm run deploy (CDK 6-step orchestration → AWS)
