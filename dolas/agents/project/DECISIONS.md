# Architectural Decisions

- **Turborepo with npm workspaces**: Chosen for monorepo orchestration, parallel builds, top-level scripts, and fast caching.
- **Serverless AWS Backend**: Using AWS CDK to provision Lambda and API Gateway for the backend (`packages/api`).
- **Separation of Domain and Handlers**: `packages/domain` is strictly pure TypeScript with zero dependencies. Handlers (`packages/api`) invoke this domain logic instead of embedding it.
- **Edge-Ready API**: Uses Hono as the HTTP framework to keep Lambda instances fast and lightweight.
- **PostgreSQL on Neon**: A serverless database solution managed via Prisma ORM (`db:generate`, `db:migrate`).
- **Client-Side SPA Architecture**: `packages/web` (Tenant view) and `apps/admin` (Administrative view) are independent React 18 SPAs bundled with Vite and Tailwind CSS.
- **Runtime Config via /config.json**: Both SPAs fetch `/config.json` at boot instead of reading `VITE_*` env vars. CDK generates the file at deploy time using `s3deploy.Source.jsonData()` with resolved CloudFormation tokens. Local dev copies `public/config.json.example` → `public/config.json`. This eliminates build-time URL baking, `sed` manipulation, and SSM reads from `deploy.sh`.
- **Pegasus-Services integration uses polling, not WebSockets**: The legacy `WebSocketConnectionManager` and `EventPublisher` Lambdas (which pushed DynamoDB stream events to WS subscribers) are being dropped in the Hono migration. The Python integration service will poll `GET /api/v1/events/:eventType` on a timer instead. Rationale: the service already had a polling path; adding a WebSocket API Gateway stack adds CDK complexity and operational surface area for minimal latency gain given the non-realtime nature of move management events.
