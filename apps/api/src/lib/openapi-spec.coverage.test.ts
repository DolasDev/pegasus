// ---------------------------------------------------------------------------
// OpenAPI route-coverage — the lockstep enforcement (spec: read-passthrough Part C).
//
// The `api_get` read passthrough is only as discoverable as the served OpenAPI
// spec. This test asserts that EVERY vnd_-reachable (m2m) GET route is documented
// in the spec, so a new undocumented read route fails CI until it is either added
// to the spec or explicitly allowlisted here (with a reason). Without this, the
// hand-written spec silently drifts and the "reachable-but-not-in-the-SDK" gap
// reopens.
//
// Scope: GET routes on the m2m plane (the `m2mV1` router mounted at /api/v1).
// Writes are covered by typed methods and fill in incrementally — GET first.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { m2mV1 } from '../app'
import { getOpenApiSpec } from './openapi-spec'

const M2M_MOUNT = '/api/v1'

// Routes intentionally absent from the public spec, each with a reason. A GET
// route added here is a deliberate exclusion, not an oversight.
const ALLOWLIST = new Set<string>([
  // Worker-only internal endpoint — gated by the X-Workflow-Broker-Secret header,
  // NOT a vnd_ API-key surface (handlers/workflow-internal.ts). Not for the SDK.
  '/api/v1/internal/tenant-workflows',
])

/** Collapse every path param (`:x` or `{x}`) to a single `{}` token so route and
 *  spec paths match regardless of the param NAME (Hono `:integrationId` vs spec
 *  `{id}`). Compares route shapes, not param spellings. */
function canon(path: string): string {
  return path.replace(/:[A-Za-z0-9_]+/g, '{}').replace(/\{[A-Za-z0-9_]+\}/g, '{}')
}

function m2mGetPaths(): string[] {
  const routes = (m2mV1 as unknown as { routes: Array<{ method: string; path: string }> }).routes
  return [
    ...new Set(
      routes
        .filter((r) => r.method === 'GET')
        .map((r) => M2M_MOUNT + (r.path.startsWith('/') ? r.path : `/${r.path}`)),
    ),
  ].sort()
}

function documentedGetPaths(): Set<string> {
  const spec = getOpenApiSpec() as { paths: Record<string, { get?: unknown }> }
  return new Set(
    Object.entries(spec.paths)
      .filter(([, item]) => item.get)
      .map(([p]) => canon(p)),
  )
}

describe('OpenAPI route coverage (m2m GET surface)', () => {
  it('documents every vnd_-reachable GET route', () => {
    const documented = documentedGetPaths()
    const missing = m2mGetPaths().filter((p) => !documented.has(canon(p)) && !ALLOWLIST.has(p))

    if (missing.length) console.log('UNDOCUMENTED m2m GET routes:\n' + missing.join('\n'))
    expect(missing, `undocumented m2m GET routes:\n${missing.join('\n')}`).toEqual([])
  })

  it('has no stale allowlist entries', () => {
    const live = new Set(m2mGetPaths())
    const stale = [...ALLOWLIST].filter((p) => !live.has(p))
    expect(stale, `allowlisted routes no longer exist:\n${stale.join('\n')}`).toEqual([])
  })
})
