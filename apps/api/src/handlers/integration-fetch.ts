// ---------------------------------------------------------------------------
// POST /api/v1/integrations/:integrationId/fetch/:operation
//
// Run a PUBLISHED `fetch` descriptor (Gap B). The caller names a capability and
// supplies params; the platform resolves the descriptor, substitutes the
// templates, performs the authenticated call through the SAME core
// call-external uses (lib/outbound-call), decodes, extracts the records and
// pages — so a new source is reachable from CONFIG ALONE, with no workflow.
//
// WHAT THE CALLER CANNOT DO, by construction: name a path, a method, a header or
// a credential. Those come from the published descriptor, which the publish gate
// already checked. Compare `call-external`, where the workflow supplies the
// method and path itself — that is the escape hatch, and it is why this endpoint
// can be narrower.
//
// WHERE EACH PIECE COMES FROM, and why it is not all one lookup:
//   - the DESCRIPTOR from the tenant's scoped IntegrationConfig row, via
//     `findActiveForScope` (tenant's latest PUBLISHED wins, else GLOBAL) — the
//     same resolution every other consumer uses. `inbound` is read off the row
//     the same way; neither belongs on IntegrationDefinition.
//   - `capabilities` from the resolved DEFINITION, because that is floor-level
//     truth and is what makes the operation name legal.
//   - `{{config:KEY}}` values from the tenant's config store, resolving ONLY the
//     keys the descriptor actually references.
//
// RBAC: gated by the existing `CallExternal` action and metered the same way. A
// fetch IS an authenticated outbound call with the tenant's credentials, so it
// belongs to that permission; minting a new action would touch authz/actions.ts
// and Cedar, both named merge magnets, for no gain in expressiveness.
//
// FRESHNESS AND PROVENANCE (C4). The result is served through a short-TTL
// read-through cache, and the response ALWAYS states where it came from:
// `source` ("cached" | "fetched") and `asOf`. The discipline is the same as
// `attempts` on call-external — if the platform did something non-obvious on
// your behalf, the payload says so, because a silently-cached answer answers a
// different question than the caller asked.
//
//   - how old is acceptable: `maxAge` (seconds) at the call site beats the
//     descriptor's `maxAgeSeconds`, which beats the 60s platform default;
//     `refresh: true` or `maxAge: 0` forces a partner call. A forced call still
//     writes through.
//   - `attempts` / `pages` describe THIS call and are 0 on a hit; `status`,
//     `truncated`, `recordCount` and `records` describe the DATA and come off
//     the cached row. So `sum(attempts)` is still the partner-call count.
//   - NO single-flight, decided in C5: these are idempotent GETs, so a
//     concurrent duplicate is wasteful rather than wrong, and the TTL bounds it.
//     The bet is instrumented rather than assumed — the completion log carries
//     `cache` (hit/miss/refresh), `duplicate` and `cacheWrite`, so adding
//     coordination later is a decision on data.
//   - A cache failure NEVER fails a fetch: an unreadable cache degrades to a
//     miss, an unwritable one still serves the records, and an over-cap result
//     is served uncached.
//
// Failure modes:
//   400 VALIDATION_ERROR  — unfillable/forbidden template, bad descriptor, or a
//                           rejected URL / reserved header from the core
//   403 Forbidden         — Cedar denies (no CallExternal)
//   404 NOT_FOUND         — unknown integration, no `fetch` block, unknown
//                           operation, or a required config/secret unset
//   409 CONFLICT          — the operation is no longer a declared capability
//   502 UPSTREAM_ERROR / 504 UPSTREAM_TIMEOUT — from the shared core
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { requirePermission } from '../middleware/rbac'
import { meterUsage } from '../middleware/meter-usage'
import { dualAuthMiddleware } from '../middleware/dual-auth'
import { Actions } from '../authz/actions'
import type { AppEnv } from '../types'
import { DomainError } from '@pegasus/domain'
import { db as basePrisma } from '../db'
import { resolveIntegrationDefinition } from '../integration-validation/registry'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'
import { assertDeliverableUrl } from './integration-delivery'
import { performOutboundCall, outboundFailureToHttp } from '../lib/outbound-call'
import {
  resolveFetchOperation,
  substituteFetchTemplates,
  referencedConfigKeys,
  decodeFetchBody,
  extractFetchRecords,
  readNextCursor,
  resolveFetchMaxAge,
  fetchRequestHash,
  FETCH_DEFAULT_MAX_PAGES,
  FETCH_MAX_MAX_AGE_SECONDS,
  type FetchOperation,
} from '../lib/integration-fetch'
import { createIntegrationFetchCacheRepository } from '../repositories/integration-fetch-cache.repository'

/**
 * Cap on a cached record set, matching IntegrationProjection's `state` cap.
 * An over-cap result is still SERVED — it is simply not cached, because failing
 * a successful partner read over a cache write would be the wrong trade.
 */
const MAX_CACHED_BYTES = 256 * 1024

const FetchBody = z.object({
  /** Values for the descriptor's `{{param}}` placeholders. */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** WorkflowSecretConfig group the descriptor's config/secrets live in. */
  group: z.string().min(1).max(128).default('global'),
  /**
   * Oldest result this caller will accept, in seconds. Overrides the
   * descriptor's `maxAgeSeconds`, which overrides the 60s platform default.
   * `0` forces a partner call. Absent ⇒ no call-site opinion.
   */
  maxAge: z.number().int().min(0).max(FETCH_MAX_MAX_AGE_SECONDS).optional(),
  /** Call the partner regardless of what is cached, and refresh the cache with it. */
  refresh: z.boolean().default(false),
  /** Config/secret key-name overrides, same defaults as call-external. */
  baseUrlConfig: z.string().min(1).max(128).default('BASE_URL'),
  authModeConfig: z.string().min(1).max(128).default('AUTH_MODE'),
  tokenUrlConfig: z.string().min(1).max(128).default('TOKEN_URL'),
  clientIdSecret: z.string().min(1).max(128).default('CLIENT_ID'),
  clientSecretSecret: z.string().min(1).max(128).default('CLIENT_SECRET'),
  bearerSecret: z.string().min(1).max(128).default('API_KEY'),
  apiKeyHeaderConfig: z.string().min(1).max(128).default('API_KEY_HEADER'),
  timeoutConfig: z.string().min(1).max(128).default('REQUEST_TIMEOUT_MS'),
  maxRetriesConfig: z.string().min(1).max(128).default('MAX_RETRIES'),
})

type FetchInput = z.infer<typeof FetchBody>

export const integrationFetchHandler = new Hono<AppEnv>()

// Mounted on the m2mV1 router (no wildcard auth) — authenticate here, same as
// call-external and the delivery handler.
integrationFetchHandler.use('*', dualAuthMiddleware)

/** Per-page query overlay for the declared paging style. */
function pageQuery(op: FetchOperation, page: number, cursor: string | null): FetchOperation {
  const style = op.page?.style ?? 'none'
  if (style === 'none' || !op.page?.param) return op
  const value = style === 'cursor' ? cursor : page
  if (value === null) return op
  return { ...op, query: { ...(op.query ?? {}), [op.page.param]: String(value) } }
}

integrationFetchHandler.post(
  '/integrations/:integrationId/fetch/:operation',
  requirePermission(Actions.CallExternal),
  meterUsage(Actions.CallExternal),
  validator('json', (value, c) => {
    // An absent body is the common case (an operation with no params), so treat
    // it as `{}` rather than making every caller send one.
    const r = FetchBody.safeParse(value ?? {})
    if (!r.success) return c.json({ error: r.error.message, code: 'VALIDATION_ERROR' }, 400)
    return r.data
  }),
  async (c) => {
    const integrationId = c.req.param('integrationId') ?? ''
    const operation = c.req.param('operation') ?? ''
    const tenantId = c.get('tenantId')
    if (!tenantId) throw new DomainError('Tenant context required', 'UNAUTHENTICATED')
    const input = c.req.valid('json') as FetchInput

    // Resolve per request against the DB (own → GLOBAL → built-in) through
    // `basePrisma`, for the same reason call-external does: the synchronous
    // registry reads a module-level overlay that only the config-mutation
    // handlers warm, so on scaled Lambda a config-only integration would 404 on
    // every container but the one that served the publish.
    const def = await resolveIntegrationDefinition(basePrisma, integrationId, tenantId)
    if (!def) {
      return c.json({ error: `Unknown integration '${integrationId}'`, code: 'NOT_FOUND' }, 404)
    }

    const row = await createIntegrationConfigRepository(c.get('db')).findActiveForScope(
      integrationId,
      tenantId,
    )
    const resolved = resolveFetchOperation(row?.fetch ?? null, def.capabilities, operation)
    if (!resolved.ok) {
      const f = resolved.failure
      switch (f.kind) {
        case 'noFetchBlock':
          return c.json(
            {
              error: `Integration '${integrationId}' publishes no fetch block`,
              code: 'NOT_FOUND',
            },
            404,
          )
        case 'unknownOperation':
          return c.json(
            {
              error: `Operation '${operation}' is not published; this config declares: ${f.declared.join(', ') || '(none)'}`,
              code: 'NOT_FOUND',
            },
            404,
          )
        case 'notACapability':
          // 409, not 404: the operation IS published, but the floor no longer
          // declares it — a contract conflict the tenant must resolve by
          // republishing, not a missing route.
          return c.json(
            {
              error: `Operation '${operation}' is no longer a capability of floor '${def.floor}' (declared: ${f.capabilities.join(', ') || '(none)'}) — republish the config`,
              code: 'CONFLICT',
            },
            409,
          )
        case 'malformedBlock':
          return c.json(
            {
              error: 'The published fetch block is malformed — republish the config',
              code: 'VALIDATION_ERROR',
              problems: f.problems,
            },
            400,
          )
      }
    }

    // Resolve ONLY the config keys this descriptor references, so the readable
    // set does not depend on what else happens to live in the group.
    const configs: Record<string, string> = {}
    const needed = referencedConfigKeys(resolved.operation)
    if (needed.length) {
      const secretRepo = createWorkflowSecretConfigRepository(c.get('db'))
      for (const key of needed) {
        const found = await secretRepo.findByKey('CONFIG', input.group, key)
        if (found?.value != null) configs[key] = found.value
      }
    }

    const filled = substituteFetchTemplates(resolved.operation, input.params, configs)
    if (!filled.ok) {
      // An unfillable template is a 400, never a call: a leftover `{{x}}` on the
      // wire returns an opaque partner error that hides the real cause.
      return c.json(
        {
          error: 'Could not fill the fetch descriptor from the supplied params',
          code: 'VALIDATION_ERROR',
          problems: filled.problems,
        },
        400,
      )
    }

    // ── Freshness (C4) ──────────────────────────────────────────────────────
    // The cache read sits HERE, after substitution, for two reasons: the hash
    // needs the fully filled descriptor, and a hit must still 404/409 on an
    // unknown operation or a withdrawn capability exactly as a miss does. A hit
    // skips `performOutboundCall` and nothing else.
    const cache = createIntegrationFetchCacheRepository(c.get('db'))
    const cacheKey = {
      tenantId,
      integrationId,
      operation,
      requestHash: fetchRequestHash(filled.operation, {
        group: input.group,
        overrides: {
          baseUrlConfig: input.baseUrlConfig,
          authModeConfig: input.authModeConfig,
          tokenUrlConfig: input.tokenUrlConfig,
          clientIdSecret: input.clientIdSecret,
          clientSecretSecret: input.clientSecretSecret,
          bearerSecret: input.bearerSecret,
          apiKeyHeaderConfig: input.apiKeyHeaderConfig,
          timeoutConfig: input.timeoutConfig,
          maxRetriesConfig: input.maxRetriesConfig,
        },
      }),
    }
    const maxAge = resolveFetchMaxAge(input.maxAge, filled.operation.maxAgeSeconds)

    // Read even when `refresh` forces a call: the row's prior `fetchedAt` is
    // what makes a concurrent duplicate fetch detectable afterwards, which C5
    // trades for not building single-flight. A cache read must never fail the
    // request, so a store error degrades to a miss.
    const priorFetchedAt = await cache.find(cacheKey).catch((error: unknown) => {
      logger.warn('integration fetch cache read failed; treating as a miss', {
        integrationId,
        operation,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })

    const startedAt = new Date()
    const horizon = new Date(startedAt.getTime() - maxAge * 1000)
    // `>=` on the horizon, so maxAge 0 cannot be satisfied by any stored row.
    const servable =
      !input.refresh && priorFetchedAt && priorFetchedAt.fetchedAt.getTime() >= horizon.getTime()
        ? priorFetchedAt
        : null

    if (servable) {
      logger.info('integration fetch completed', {
        integrationId,
        operation,
        tenantId,
        cache: 'hit',
        maxAge,
        ageSeconds: Math.round((startedAt.getTime() - servable.fetchedAt.getTime()) / 1000),
        records: servable.recordCount,
        truncated: servable.truncated,
      })
      return c.json({
        data: {
          operation,
          records: servable.records,
          recordCount: servable.recordCount,
          // `attempts`/`pages` describe THIS call, which made no request — so
          // summing `attempts` across calls still counts partner calls, which is
          // what makes the duplicate rate observable (C5).
          attempts: 0,
          pages: 0,
          // These describe the DATA being served, so they come off the row: a
          // cached truncated read must stay recognizable as incomplete.
          status: servable.status,
          truncated: servable.truncated,
          source: 'cached',
          asOf: servable.fetchedAt.toISOString(),
        },
      })
    }

    const op = filled.operation
    const style = op.page?.style ?? 'none'
    const maxPages = style === 'none' ? 1 : (op.page?.maxPages ?? FETCH_DEFAULT_MAX_PAGES)
    const startAt = op.page?.startAt ?? 1

    const records: unknown[] = []
    let attempts = 0
    let pages = 0
    let cursor: string | null = null
    let lastStatus = 0
    let truncated = false

    for (let i = 0; i < maxPages; i++) {
      const thisPage = pageQuery(op, startAt + i, cursor)
      const result = await performOutboundCall(
        { db: c.get('db'), tenantId, integrationId },
        {
          method: thisPage.method,
          path: thisPage.path,
          ...(thisPage.query !== undefined ? { query: thisPage.query } : {}),
          ...(thisPage.body !== undefined ? { body: thisPage.body } : {}),
          ...(thisPage.headers !== undefined ? { headers: thisPage.headers } : {}),
          ...(thisPage.secretHeaders !== undefined
            ? { secretHeaders: thisPage.secretHeaders }
            : {}),
          // A fetch is ALWAYS a read, even when the partner exposes it as POST,
          // so it is safe to re-send after a 429. Never inferred from `method`.
          mutating: false,
          group: input.group,
          baseUrlConfig: input.baseUrlConfig,
          authModeConfig: input.authModeConfig,
          tokenUrlConfig: input.tokenUrlConfig,
          clientIdSecret: input.clientIdSecret,
          clientSecretSecret: input.clientSecretSecret,
          bearerSecret: input.bearerSecret,
          apiKeyHeaderConfig: input.apiKeyHeaderConfig,
          timeoutConfig: input.timeoutConfig,
          maxRetriesConfig: input.maxRetriesConfig,
        },
        assertDeliverableUrl,
      )
      if (!result.ok) {
        const { status, body } = outboundFailureToHttp(result.failure)
        return c.json(body, status)
      }
      attempts += result.attempts
      pages += 1
      lastStatus = result.response.status

      const text = await result.response.text()
      if (!result.response.ok) {
        // A partner error is reported as an upstream failure with its status, so
        // the caller can tell "the partner said no" from "we could not ask".
        return c.json(
          {
            error: `partner returned ${result.response.status}`,
            code: 'UPSTREAM_ERROR',
            status: result.response.status,
            body: text.slice(0, 2048),
          },
          502,
        )
      }

      let parsed: unknown = null
      if (text) {
        try {
          parsed = JSON.parse(text)
        } catch {
          return c.json({ error: 'partner response is not JSON', code: 'UPSTREAM_ERROR' }, 502)
        }
      }

      const decoded = decodeFetchBody(parsed, op.decode)
      if (!decoded.ok) {
        return c.json({ error: decoded.problem, code: 'UPSTREAM_ERROR' }, 502)
      }
      const extracted = extractFetchRecords(decoded.body, op.recordsPath)
      if (!extracted.ok) {
        // The descriptor is wrong about this partner's shape — a config bug.
        return c.json({ error: extracted.problem, code: 'VALIDATION_ERROR' }, 400)
      }
      records.push(...extracted.records)

      if (style === 'none') break
      if (extracted.records.length === 0) break
      if (style === 'cursor') {
        cursor = op.page?.cursorPath ? readNextCursor(decoded.body, op.page.cursorPath) : null
        if (!cursor) break
      }
      // A loop that ends because it ran out of budget rather than out of data is
      // reported, not silently treated as a complete result set.
      if (i === maxPages - 1) truncated = true
    }

    // ── Write through, and make the C5 bet observable ────────────────────────
    // Deferring single-flight is instrumented as a bet, not taken as a guess:
    // the Risks section calls this metric non-optional, because without it the
    // decision to add coordination later would have no data behind it.
    //
    // A duplicate is detectable WITHOUT any coordination: if the row's
    // `fetchedAt` changed while we were on the wire, another container asked the
    // partner the same question concurrently. One extra indexed read, on the
    // miss path only, where an HTTP round-trip already dominates.
    const fetchedAt = new Date()
    const result = {
      records,
      recordCount: records.length,
      pages,
      attempts,
      status: lastStatus,
      truncated,
      fetchedAt,
    }

    let duplicate = false
    let cacheWrite: 'stored' | 'skipped:oversize' | 'failed' = 'stored'
    try {
      const nowStored = await cache.find(cacheKey)
      const before = priorFetchedAt?.fetchedAt.getTime() ?? null
      const after = nowStored?.fetchedAt.getTime() ?? null
      // A changed `fetchedAt` between the two reads IS the duplicate — we read
      // before our own write, so nobody else could have moved it. Deliberately
      // not also requiring `after >= startedAt`: a container that began its call
      // before ours and landed during it is still a duplicate, and that guard
      // would only undercount the thing the metric exists to measure.
      duplicate = after !== null && after !== before

      if (Buffer.byteLength(JSON.stringify(records), 'utf8') > MAX_CACHED_BYTES) {
        cacheWrite = 'skipped:oversize'
      } else {
        // Last-write-wins, exactly like the OAuth token cache: both containers
        // asked the same idempotent question, so either answer will do.
        await cache.upsert(cacheKey, result)
      }
    } catch (error: unknown) {
      // The records are already in hand and correct. A cache that cannot be
      // written is a performance problem, never a reason to fail a good read.
      cacheWrite = 'failed'
      logger.warn('integration fetch cache write failed; serving the fetched result', {
        integrationId,
        operation,
        tenantId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    logger.info('integration fetch completed', {
      integrationId,
      operation,
      tenantId,
      pages,
      attempts,
      records: records.length,
      truncated,
      cache: input.refresh ? 'refresh' : 'miss',
      maxAge,
      duplicate,
      cacheWrite,
    })

    return c.json({
      data: {
        operation,
        records,
        recordCount: records.length,
        pages,
        attempts,
        status: lastStatus,
        truncated,
        source: 'fetched',
        asOf: fetchedAt.toISOString(),
      },
    })
  },
)
