// =============================================================================
// Pegasus API — k6 Smoke Test
// =============================================================================
//
// PURPOSE
//   Verify that all core API endpoints respond correctly and meet baseline
//   latency/error thresholds under a modest, sustained load. Run this before
//   every staging deployment and after any significant backend change.
//
// INSTALL k6
//   macOS:   brew install k6
//   Linux:   https://k6.io/docs/get-started/installation/#linux
//   Windows: winget install k6  (or download from https://k6.io/docs/get-started/installation/)
//   Docker:  docker run --rm -i grafana/k6 run - <k6-smoke.js
//
// CONFIGURATION
//   BASE_URL   — Root URL of the running API server (no trailing slash).
//                Default: http://localhost:3000
//   API_TOKEN  — Bearer token for authenticated routes.
//                Obtain one by logging in through the web UI or via
//                POST /api/auth/token (Cognito flow).
//   TENANT_SLUG — Value sent in the X-Tenant-Slug header for local dev.
//                 Default: test-tenant
//
// RUN EXAMPLES
//   k6 run k6-smoke.js
//   k6 run -e BASE_URL=https://staging-api.example.com -e API_TOKEN=<token> k6-smoke.js
//
// READING RESULTS
//   http_req_duration  — end-to-end request latency (p(50), p(90), p(95), p(99))
//   http_req_failed    — proportion of requests that received a non-2xx/3xx status
//   checks             — pass/fail counts for inline assertions
//   vus / vus_max      — active virtual users over time
//
//   A passing run prints a green ✓ for every threshold. A failing run prints ✗
//   and exits with a non-zero status code (useful in CI).
//
// THRESHOLDS
//   p99 latency < 500 ms   — ensures the 99th percentile is fast enough for
//                            interactive use; cold-start Lambda warm-up is
//                            accounted for by the 1-minute window.
//   error rate  < 1 %      — allows for a tiny fraction of transient failures
//                            (network blips, occasional cold starts that time out).
// =============================================================================

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

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

// ---------------------------------------------------------------------------
// Test options
// ---------------------------------------------------------------------------
export const options = {
  vus: 10,
  duration: '1m',

  thresholds: {
    // 99th-percentile latency must stay under 500 ms
    http_req_duration: ['p(99)<500'],
    // Fewer than 1 % of requests may fail
    error_rate: ['rate<0.01'],
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

function recordError(res) {
  const failed = res.status < 200 || res.status >= 400
  errorRate.add(failed)
  return failed
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/** GET /health — unauthenticated liveness probe */
function smokeHealth() {
  const res = http.get(`${BASE_URL}/health`)
  const failed = recordError(res)
  check(res, {
    'health: status 200': (r) => r.status === 200,
    'health: body has status ok': (r) => {
      try {
        return JSON.parse(r.body).status === 'ok'
      } catch {
        return false
      }
    },
  })
  return failed
}

/** GET /health?deep=true — liveness probe that also pings the database */
function smokeHealthDeep() {
  const res = http.get(`${BASE_URL}/health?deep=true`)
  recordError(res)
  check(res, {
    'health deep: status 200 or 503': (r) => r.status === 200 || r.status === 503,
    'health deep: body has timestamp': (r) => {
      try {
        return typeof JSON.parse(r.body).timestamp === 'string'
      } catch {
        return false
      }
    },
  })
}

/** GET /api/v1/customers — paginated customer list */
function smokeListCustomers() {
  const res = http.get(`${BASE_URL}/api/v1/customers?limit=10&offset=0`, {
    headers: authHeaders(),
  })
  const failed = recordError(res)
  check(res, {
    'list customers: status 200 or 401': (r) => r.status === 200 || r.status === 401,
    'list customers: body is JSON': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
  return failed
}

/** GET /api/v1/moves — paginated moves list */
function smokeListMoves() {
  const res = http.get(`${BASE_URL}/api/v1/moves?limit=10&offset=0`, {
    headers: authHeaders(),
  })
  const failed = recordError(res)
  check(res, {
    'list moves: status 200 or 401': (r) => r.status === 200 || r.status === 401,
    'list moves: body is JSON': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
  return failed
}

/** GET /api/v1/quotes — paginated quotes list */
function smokeListQuotes() {
  const res = http.get(`${BASE_URL}/api/v1/quotes?limit=10&offset=0`, {
    headers: authHeaders(),
  })
  const failed = recordError(res)
  check(res, {
    'list quotes: status 200 or 401': (r) => r.status === 200 || r.status === 401,
    'list quotes: body is JSON': (r) => {
      try {
        JSON.parse(r.body)
        return true
      } catch {
        return false
      }
    },
  })
  return failed
}

/**
 * Realistic user flow — mimics a dispatcher opening the dashboard:
 *   1. Health check (app boot)
 *   2. List customers (populate customer picker)
 *   3. List moves (populate dispatch board)
 *   4. List quotes (populate quote pipeline)
 *
 * Think-time pauses between steps approximate human interaction speed.
 */
function realisticDispatcherFlow() {
  smokeHealth()
  sleep(0.5)

  smokeListCustomers()
  sleep(0.3)

  smokeListMoves()
  sleep(0.3)

  smokeListQuotes()
  sleep(0.5)
}

// ---------------------------------------------------------------------------
// Default function — executed once per VU per iteration
// ---------------------------------------------------------------------------
export default function () {
  // Rotate between a direct health check and the full dispatcher flow so the
  // test exercises every endpoint while still generating realistic request
  // patterns rather than uniform hammering of a single route.
  const iteration = __ITER % 3

  if (iteration === 0) {
    smokeHealth()
    smokeHealthDeep()
    sleep(0.2)
  } else if (iteration === 1) {
    smokeListCustomers()
    smokeListMoves()
    sleep(0.3)
  } else {
    realisticDispatcherFlow()
  }
}
