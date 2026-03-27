# Technology Stack

**Analysis Date:** 2026-03-27

## Languages

**Primary:**

- TypeScript 5.6.3 - Core language for all packages and applications (strict mode with `exactOptionalPropertyTypes`)
- JavaScript - Used in package.json scripts and build tooling

**Secondary:**

- SQL (PostgreSQL/Prisma schemas)
- Shell - Deployment and utility scripts

## Runtime

**Environment:**

- Node.js >= 18.0.0 (configured in package.json `engines`)
- AWS Lambda (Node.js 20.x runtime)
- Browsers (React 19 frontend)
- React Native / Expo (mobile app)

**Package Manager:**

- npm >= 9.0.0
- Lockfile: `package-lock.json` present
- npm workspaces for monorepo orchestration

## Frameworks

**Core Backend:**

- Hono 4.6.14 - Lightweight HTTP framework on Lambda
  - `@hono/node-server` 1.19.11 - Node.js server adapter
  - `@hono/zod-openapi` 0.18.4 - OpenAPI schema generation with Zod

**Database & ORM:**

- Prisma 6.0.0 - Schema-driven PostgreSQL ORM
  - Generated client at `@prisma/client` 6.0.0
  - Supports PostgreSQL extensions (uuid-ossp)
  - Dual schema support (public + platform)

**Frontend Frameworks:**

- React 19.2.4 - Core UI library for web and admin frontends
- Vite 5.4.11 - Build tool for React SPAs (both tenant and admin apps)
- Expo 54.0.30 - Cross-platform framework for mobile app (React Native)
- expo-router 6.0.21 - File-based routing for mobile

**State Management:**

- @tanstack/react-query 5.59.20 - Server state (caching, sync, mutations)
- @tanstack/react-router 1.79.0 - Client-side routing (web + admin)

**UI Components:**

- Radix UI - Unstyled, accessible component library
  - @radix-ui/react-label, react-scroll-area, react-separator, react-slot, react-tabs
- Tailwind CSS 3.4.19 - Utility-first CSS framework (web + admin)
- class-variance-authority 0.7.1 - Variant composition for components
- clsx 2.1.1 - Class name string builder
- tailwind-merge 3.5.0 - Merge Tailwind classes intelligently
- lucide-react 0.575.0 - Icon library

**Mobile:**

- react-native 0.81.6 - Cross-platform mobile runtime
- react-native-web 0.21.0 - React Native components in web browser
- react-native-safe-area-context 5.6.0 - Safe area primitives
- react-native-screens 4.16.0 - Native screen management
- @react-native-async-storage/async-storage 2.2.0 - Local persistent storage

**Testing:**

- Vitest 2.1.8 - Fast unit/integration test runner (domain, api, infra)
- @playwright/test 1.58.2 - E2E and API acceptance tests
- @testing-library/react 16.0.0 - React component testing utilities
- @testing-library/dom 10.4.1 - DOM utilities
- jest 29.7.0 - Test runner for mobile (React Native)
- @stryker-mutator/core 9.6.0 - Mutation testing framework
- fast-check 4.6.0 - Property-based testing

**Build & Dev:**

- @vitejs/plugin-react 4.3.3 - React plugin for Vite
- TypeScript - Type checking and compilation
- autoprefixer 10.4.24 - PostCSS plugin for vendor prefixes
- esbuild - Bundler (via Vite and Turbo)

**Linting & Formatting:**

- ESLint 8.57.1 with @typescript-eslint plugins
- Prettier 3.3.3 - Code formatter
- lint-staged 15.2.10 - Pre-commit hooks (via husky)
- husky 9.1.7 - Git hooks management

**Infrastructure:**

- AWS CDK 2.160.0 - Infrastructure as Code (TypeScript)
- Constructs 10.4.2 - CDK building blocks

**Build Orchestration:**

- Turborepo 2.3.3 - Monorepo build tool
  - Topologically sorted build (`dependsOn: ["^build"]`)
  - Cache enabled for build, disabled for test
  - Outputs to `dist/**`

**Utility Libraries:**

- Zod 3.23.8 - Runtime schema validation
- jose 5.0.0 - JWT signing/verification
- @aws-lambda-powertools/logger 2.0.0 - Structured logging for Lambda
- mssql 12.2.0 - Legacy SQL Server client (pegii bridge)
- @aws-sdk/client-cognito-identity-provider 3.x - Cognito API access
- source-map-support 0.5.21 - Enhanced stack traces

## Configuration

**Environment:**

- Runtime config injected via environment variables (see INTEGRATIONS.md)
- TypeScript strict mode enabled at root (tsconfig.base.json)
  - `strict: true`
  - `exactOptionalPropertyTypes: true` (prevents optional/undefined confusion)
  - `noUncheckedIndexedAccess: true`
  - `noImplicitOverride: true`
- Monorepo config via Turborepo (turbo.json)

**Build:**

- TypeScript config inheritance: each package extends `tsconfig.base.json`
- Vite config: `vite.config.ts` in web and admin packages
- Jest config: `jest.config.js` in mobile package
- Playwright config: `apps/e2e/playwright.config.ts`
- Prisma schema: `packages/api/prisma/schema.prisma`
- ESLint: `.eslintrc` at root (inherited by packages)
- Prettier: `.prettierrc` at root

**Database:**

- Prisma migrations at `packages/api/prisma/migrations/`
- Seed script at `packages/api/prisma/seed.ts`
- Two PostgreSQL schemas: `public` (tenant data) and `platform` (admin data)

## Platform Requirements

**Development:**

- Node.js >= 18
- npm >= 9
- PostgreSQL (local Docker via Docker Compose for integration tests)
- WSL2 (project uses Linux-specific node module binaries)

**Production:**

- AWS Account with:
  - AWS Lambda (Node.js 20.x)
  - API Gateway v2 (HTTP API)
  - Amazon RDS PostgreSQL (or Neon for serverless pooling)
  - AWS Secrets Manager (database credentials, SSO secrets)
  - AWS Cognito (authentication & identity)
  - AWS CloudWatch (logging, metrics, alarms)
  - AWS CloudFront (CDN for frontend assets)
  - AWS S3 (static asset storage)
  - AWS IAM (role-based access)

**Database:**

- PostgreSQL 12+ (Neon recommended for Lambda via connection pooling)
- Prisma binary targets: `["native", "rhel-openssl-3.0.x", "windows"]`

---

_Stack analysis: 2026-03-27_
