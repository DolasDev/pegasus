// =============================================================================
// Pegasus API — k6 Soak Test
// =============================================================================
//
// PURPOSE
//   Detect slow resource leaks, gradual memory growth, connection pool
//   exhaustion, and degrading latency over an extended period. Run this
//   against a staging environment before promoting a release to production,
//   especially after changes to connection handling, caching, or background
//   jobs.
//
// INSTALL k6
//   macOS:   brew install k6
//   Linux:   https://k6.io/docs/get-started/installation/#linux
//   Windows: winget install k6  (or download from https://k6.io/docs/get-started/installation/)
//   Docker:  docker run --rm -i grafana/k6 run - <k6-soak.js
//
// CONFIGURATION
//   BASE_URL    — Root URL of the running API server (no trailing slash).
//                 Default: http://localhost:3000
//   API_TOKEN   — Bearer token for authenticated routes.
//                 Obtain one by logging in through the web UI or via
//                 POST /api/auth/token (Cognito flow).
//   TENANT_SLUG — Value sent in the X-Tenant-Slug header for local dev.
//                 Default: test-tenant
//
// RUN EXAMPLES
//   k6 run k6-soak.js
//   k6 run -e BASE_URL=https://staging-api.example.com -e API_TOKEN=<token> k6-soak.js
//
//   With Grafana Cloud streaming (recommended for long runs):
//   K6_CLOUD_TOKEN=<token> k6 cloud k6-soak.js
//
// READING RESULTS
//   http_req_duration  — end-to-end latency (p50/p90/p95/p99 over the full run)
//   http_req_failed    — proportion of non-2xx/3xx responses
//   checks             — inline assertion pass/fail counts
//   vus / vus_max      — virtual user count per stage
//
//   Watch the p99 trend over time: a flat line is healthy. A rising line
//   suggests a leak or gradual resource exhaustion.
//
//   A passing run prints a green ✓ for every threshold. A failing run prints ✗
//   and exits non-zero (suitable for CI gates on staging pipelines).
//
// THRESHOLDS
//   p99 latency < 1 000 ms — more lenient than smoke because the pool is under
//                             sustained load; Lambda cold-starts should not appear
//                             after the warm-up stage, but occasional GC pauses
//                             and DB query variance must be tolerated.
//   error rate  < 0.1 %    — tighter than smoke: over 30 minutes even a 1 %
//                             failure rate represents hundreds of broken requests.
//
// LOAD PROFILE
//   0 → 5 min   Ramp up from 0 to 20 VUs — lets Lambda warm its container pool
//               and establishes steady-state DB connections.
//   5 → 25 min  Sustain 20 VUs — the soak window where leaks become visible.
//   25 → 30 min Ramp down to 0 VUs — observe graceful connection release and
//               that no in-flight requests hang during scale-down.
//
// WARNING
//   Do NOT run this test against production. It generates sustained load for
//   30 minutes. Always target a dedicated staging environment.
// =============================================================================

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const API_TOKEN = __ENV.API_TOKEN || ''
const TENANT_SLUG = __ENV.TENANT_SLUG || 'test-tenant'

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------
const errorRate = new Rate('error_rate')

// Track latency per bounded context so per-service degradation is visible
// in the output even though the overall threshold is aggregate.
const healthLatency = new Trend('latency_health', true)
const customersLatency = new Trend('latency_customers', true)
const movesLatency = new Trend('latency_moves', true)
const quotesLatency = new Trend('latency_quotes', true)

// ---------------------------------------------------------------------------
// Test options
// ---------------------------------------------------------------------------
export const options = {
  stages: [
    // Ramp up: 0 → 20 VUs over 5 minutes
    { duration: '5m', target: 20 },
    // Sustain: 20 VUs for 20 minutes (the soak window)
    { duration: '20m', target: 20 },
    // Ramp down: 20 → 0 VUs over 5 minutes
    { duration: '5m', target: 0 },
  ],

  thresholds: {
    // 99th-percentile latency must stay under 1 second across the full run
    http_req_duration: ['p(99)<1000'],
    // Fewer than 0.1 % of requests may fail
    error_rate: ['rate<0.001'],
    // Per-context latency budgets (p95): gives early warning before the
    // aggregate p99 threshold is breached.
    latency_health: ['p(95)<200'],
    latency_customers: ['p(95)<800'],
    latency_moves: ['p(95)<800'],
    latency_quotes: ['p(95)<800'],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function authHeaders() {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': TENANT_SLUG,
  }
  if (API_TOKEN) {
    headers['Authorization'] = `Bearer ${API_TOKEN}`
  }
  return headers
}

function recordResult(res, latencyTrend) {
  const failed = res.status < 200 || res.status >= 400
  errorRate.add(failed)
  latencyTrend.add(res.timings.duration)
  return failed
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/** GET /health — lightweight liveness probe */
function checkHealth() {
  const res = http.get(`${BASE_URL}/health`)
  recordResult(res, healthLatency)
  check(res, {
    'health: 200': (r) => r.status === 200,
    'health: status ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok'
      } catch {
        return false
      }
    },
  })
}

/** GET /health?deep=true — health check that exercises the DB connection pool */
function checkHealthDeep() {
  const res = http.get(`${BASE_URL}/health?deep=true`)
  recordResult(res, healthLatency)
  check(res, {
    'health deep: 200 or 503': (r) => r.status === 200 || r.status === 503,
  })
}

/** GET /api/v1/customers — list customers, first page */
function listCustomers() {
  const res = http.get(`${BASE_URL}/api/v1/customers?limit=20&offset=0`, {
    headers: authHeaders(),
  })
  recordResult(res, customersLatency)
  check(res, {
    'customers: 200 or 401': (r) => r.status === 200 || r.status === 401,
    'customers: JSON body': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
}

/** GET /api/v1/moves — list moves, first page */
function listMoves() {
  const res = http.get(`${BASE_URL}/api/v1/moves?limit=20&offset=0`, {
    headers: authHeaders(),
  })
  recordResult(res, movesLatency)
  check(res, {
    'moves: 200 or 401': (r) => r.status === 200 || r.status === 401,
    'moves: JSON body': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
}

/** GET /api/v1/quotes — list quotes, first page */
function listQuotes() {
  const res = http.get(`${BASE_URL}/api/v1/quotes?limit=20&offset=0`, {
    headers: authHeaders(),
  })
  recordResult(res, quotesLatency)
  check(res, {
    'quotes: 200 or 401': (r) => r.status === 200 || r.status === 401,
    'quotes: JSON body': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
}

/**
 * Full dispatcher workflow — simulates a user navigating the main dashboard.
 * Think-time pauses are deliberately short compared to the smoke test because
 * the soak test's goal is sustained throughput, not human-paced interaction.
 */
function dispatcherWorkflow() {
  checkHealth()
  sleep(0.2)

  listCustomers()
  sleep(0.2)

  listMoves()
  sleep(0.2)

  listQuotes()
  sleep(0.3)
}

/**
 * Read-heavy workflow — stress-tests the read path and DB connection pool by
 * issuing several list requests back-to-back with minimal pauses.
 */
function readHeavyWorkflow() {
  listCustomers()
  sleep(0.1)
  listMoves()
  sleep(0.1)
  listQuotes()
  sleep(0.1)
  listCustomers()
  sleep(0.2)
}

/**
 * Health-ping workflow — keeps a proportion of VUs busy with cheap health
 * checks so Lambda containers stay warm throughout the soak window.
 */
function healthPingWorkflow() {
  checkHealth()
  sleep(0.5)
  checkHealthDeep()
  sleep(0.5)
}

// ---------------------------------------------------------------------------
// Default function — executed once per VU per iteration
// ---------------------------------------------------------------------------
export default function () {
  // Distribute VUs across workflows based on iteration count:
  //   ~50 % dispatcher (realistic, exercises all read endpoints)
  //   ~30 % read-heavy (stresses the DB pool)
  //   ~20 % health-ping (keeps containers warm)
  const bucket = __ITER % 10

  if (bucket < 5) {
    dispatcherWorkflow()
  } else if (bucket < 8) {
    readHeavyWorkflow()
  } else {
    healthPingWorkflow()
  }
}
