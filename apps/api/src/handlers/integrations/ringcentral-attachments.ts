// ---------------------------------------------------------------------------
// RingCentral MMS attachment lookup (tenant-authenticated).
//
//   GET /api/v1/integrations/ringcentral/messages/:source/:externalId/attachments/:attachmentId
//
// Pegasus forwards only attachment REFERENCES on-prem
// (dbo.inbound_message_attachments); the file stays in RingCentral. On-prem
// clients hold no RingCentral credentials, so they fetch the file here: we look
// it up through the tenant's RingCentral connection and pass the bytes straight
// back. Nothing is stored.
//
// Auth: dual — a Cognito session or a `vnd_` API key (the on-prem client's).
// Mounted on the pre-tenant m2m router with the middleware ROUTE-level, so the
// other /integrations/ringcentral/* paths (Cognito-only) still fall through.
//
// Response modes (mirrors handlers/pegii-reports.ts):
//   • default        — JSON envelope with `contentBase64` (the proven transport).
//   • ?format=raw    — the bytes with their content type. Binary through the
//     hono/aws-lambda adapter + HTTP API is exercised only by `app.request()`
//     in tests; smoke-test it in a deployed environment before relying on it.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { requirePermission } from '../../middleware/rbac'
import { dualAuthMiddleware } from '../../middleware/dual-auth'
import { Actions } from '../../authz/actions'
import type { AppEnv } from '../../types'
import { logger } from '../../lib/logger'
import { listConnectionsByTenant } from '../../repositories/messaging.repository'
import { fetchAttachmentContent } from '../../services/ringcentral/attachments'
import { RateLimitError } from '../../services/ringcentral/client'

export const ringcentralAttachmentsHandler = new Hono<AppEnv>()

/** RingCentral message and attachment ids are numeric; allow a safe superset. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Only v1 message-store attachments are captured today; the thread store has no
 * attachment handling yet (no thread-store traffic has been observed).
 */
const SUPPORTED_SOURCES = new Set(['V1_STORE'])

/**
 * Ceiling on the file we relay. API Gateway + Lambda cap a response at 6 MB and
 * base64 inflates by ~33%, so 3.3 MB of file ≈ 4.4 MB on the wire. Observed MMS
 * files top out near 1.1 MB.
 */
const MAX_ATTACHMENT_BYTES = 3_300_000

/** Raw mode only ever serves passive media; anything else downloads as bytes. */
function safeContentType(contentType: string): string {
  const base = contentType.split(';')[0]!.trim().toLowerCase()
  return /^(image|video|audio)\/[a-z0-9.+-]+$/.test(base) && base !== 'image/svg+xml'
    ? base
    : 'application/octet-stream'
}

ringcentralAttachmentsHandler.get(
  '/messages/:source/:externalId/attachments/:attachmentId',
  dualAuthMiddleware,
  requirePermission(Actions.ReadRingCentralAttachment),
  async (c) => {
    const tenantId = c.get('tenantId')
    const source = c.req.param('source') ?? ''
    const externalId = c.req.param('externalId') ?? ''
    const attachmentId = c.req.param('attachmentId') ?? ''

    if (!SUPPORTED_SOURCES.has(source)) {
      return c.json(
        { error: 'Only V1_STORE message attachments are supported', code: 'UNSUPPORTED_SOURCE' },
        400,
      )
    }
    if (!ID_RE.test(externalId) || !ID_RE.test(attachmentId)) {
      return c.json({ error: 'Malformed message or attachment id', code: 'INVALID_ID' }, 400)
    }
    const format = c.req.query('format')
    if (format !== undefined && format !== 'raw') {
      return c.json(
        { error: "format must be 'raw' when supplied", code: 'UNSUPPORTED_FORMAT' },
        400,
      )
    }

    const connections = await listConnectionsByTenant(c.get('db'), tenantId)
    if (connections.length === 0) {
      return c.json(
        { error: 'This tenant has no RingCentral connection', code: 'NO_RINGCENTRAL_CONNECTION' },
        404,
      )
    }

    let content
    try {
      content = await fetchAttachmentContent(connections, externalId, attachmentId)
    } catch (err) {
      if (err instanceof RateLimitError) {
        c.header('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)))
        return c.json(
          { error: 'RingCentral is rate-limiting; retry later', code: 'RATE_LIMITED' },
          503,
        )
      }
      logger.warn('RingCentral attachment fetch failed', {
        tenantId,
        externalId,
        attachmentId,
        error: err instanceof Error ? err.message : String(err),
      })
      return c.json({ error: 'RingCentral request failed', code: 'UPSTREAM_ERROR' }, 502)
    }

    if (!content) {
      return c.json(
        {
          error: 'RingCentral has no such attachment (it may have been deleted)',
          code: 'ATTACHMENT_NOT_FOUND',
        },
        404,
      )
    }
    if (content.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      logger.warn('RingCentral attachment exceeds the relayable size', {
        tenantId,
        externalId,
        attachmentId,
        bytes: content.bytes.byteLength,
      })
      return c.json(
        {
          error: 'The attachment is too large to return through the API',
          code: 'ATTACHMENT_TOO_LARGE',
        },
        502,
      )
    }

    if (format === 'raw') {
      // Copy into a standalone ArrayBuffer (a view may share a larger buffer).
      const body = content.bytes.slice().buffer
      return c.body(body, 200, {
        'Content-Type': safeContentType(content.contentType),
        'Content-Length': String(content.bytes.byteLength),
        'Content-Disposition': `inline; filename="${externalId}-${attachmentId}"`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=300',
      })
    }

    return c.json({
      data: {
        source,
        externalId,
        attachmentId,
        contentType: content.contentType,
        sizeBytes: content.bytes.byteLength,
        contentBase64: Buffer.from(content.bytes).toString('base64'),
      },
    })
  },
)
