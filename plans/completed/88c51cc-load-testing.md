# Load Testing Baseline

**Branch:** `feature/load-testing`
**Goal:** k6 load testing scripts (smoke + soak) to establish performance baselines for API endpoints.

## Context

No performance baseline exists. Cold start latency on Lambda matters. Legacy Pegii bridges execute raw SQL. k6 is lightweight, JS-scriptable, and CI-compatible.

## Implementation Checklist

### 1. Smoke test script

- [x] Create `tests/load/k6-smoke.js`
  - Target CRUD endpoints: health, customers, moves, quotes
  - 10 VUs, 1 minute duration
  - Thresholds: p99 < 500ms, error rate < 1%

### 2. Soak test script

- [x] Create `tests/load/k6-soak.js`
  - Same endpoints as smoke
  - 20 VUs, 30 minute duration
  - Thresholds: p99 < 1s, error rate < 0.1%, no memory leaks
  - Ramp-up and ramp-down stages

### 3. Documentation

- [x] Add usage instructions as comments in test files
  - How to install k6
  - How to configure target URL
  - How to read results

### 4. Verify

- [x] k6 smoke test runs against local API server
- [x] Results report includes p99 latency and error rate

## Files

| Action | Path |
|--------|------|
| Create | `tests/load/k6-smoke.js` |
| Create | `tests/load/k6-soak.js` |

## Risks / Side Effects

- Load tests must NOT run against production without explicit approval
- Requires a running API server (local or staging) to execute
- k6 is not an npm package — requires separate installation

## Dependencies

None — can start immediately (requires running API server to execute, but scripts can be written independently).
