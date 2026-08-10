// ---------------------------------------------------------------------------
// /api/v1/pegii-reports — session-surface bridge to the pegII team's on-prem
// report renderer.
//
//   GET /:reportType/:id            → { data: { reportType, id, fileName,
//                                                contentType, contentBase64 } }
//   GET /:reportType/:id?format=pdf → raw application/pdf + Content-Disposition
//
// Powers the Operations shipment pane's "View Trip Sheet" action (the
// `order-profile` report, keyed by order number) and, later, the mobile
// shipment screen's trip-sheet tab.
//
// WHY A SEPARATE PREFIX FROM THE ON-PREM PATH. Upstream serves this at
// `/api/v1/pegii/reports/...` and the gateway calls exactly that. Our own route
// cannot live at `/api/v1/pegii/...`: app.ts mounts pegiiRuntimeHandler with
// `m2mV1.route('/pegii', ...)` on the same `/api/v1` prefix, which registers
// dualAuthMiddleware across `/pegii/*`. A session route nested under it would
// silently inherit the m2m auth middleware. `/pegii-reports` keeps the two
// surfaces from interleaving; the upstream path is mirrored verbatim inside
// gateways/pegii-report.gateway.ts.
//
// WHY SESSION-SURFACE, NOT m2m. The callers are tenant-web and the mobile app,
// both Cognito-session clients — and pegiiRuntimeHandler authorizes sessions
// AWAY (403) by design. The precedent for a session-surface pegII read is
// `v1.get('/dashboard/pegii', ...)`. Exposing report pulls to workflow authors
// (m2m route + Cedar action + SDK method + OpenAPI/MCP/CLI) is a deliberate
// deferral, not an oversight: no workflow author has asked for it yet, and the
// SDK boundary obligation is real work that should follow a real request.
//
// AUTHORIZATION. Authenticated tenant user, via v1's tenantMiddleware — no
// requirePermission, matching every other `/onprem/longhaul/*` Operations
// endpoint this screen already calls. The blast radius is the same order data
// the pane already renders, and it is tenant-scoped by the per-tenant pegII
// overlay target (a tenant can only ever reach its own on-prem host).
// Deliberately NOT gated on Actions.ReadOrder: that action is granted only to
// the integrations / reporting / workflow-runtime personas in Cedar and to no
// human persona, so reusing it would 403 every real Operations user.
//
// TRANSPORT. The document always arrives base64-encoded inside the pegII JSON
// envelope, because lib/pegii-api-client.ts rides tunnelFetch and has no
// binary-stream mode. Our `?format=pdf` decodes here-side; we never ask
// upstream for its raw mode.
//
// CAVEAT ON `?format=pdf`. This is the first binary response body in the API —
// nothing else in apps/api or packages/infra references `isBase64Encoded` or
// API Gateway `binaryMediaTypes`. The handler tests exercise it through
// `app.request()`, which never crosses the hono/aws-lambda adapter, so the
// deployed behavior of the raw mode is UNVERIFIED. Everything shipping today
// (the tenant-web "View Trip Sheet" link) reads the base64 envelope instead.
// Before a caller depends on `?format=pdf` in a deployed environment, confirm
// the adapter base64-encodes the body and that API Gateway is configured to
// pass `application/pdf` through as binary.
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../types'
import { resolveReportGateway } from '../gateways/report-gateway.factory'
import { PegiiApiError, pegiiApiErrorToHttp } from '../lib/pegii-api-client'
import { logger } from '../lib/logger'

/**
 * Closed allowlist of report types. A free passthrough would let any signed-in
 * user probe arbitrary report names on the on-prem host; adding a type here is
 * the only change needed to expose another one.
 */
export const SUPPORTED_REPORT_TYPES = ['order-profile'] as const

const ReportTypeSchema = z.enum(SUPPORTED_REPORT_TYPES)

/** Identifier shape for the `:id` segment — same union the pegII runtime uses. */
const IDENT_RE = /^[A-Za-z0-9._:-]{1,128}$/

/**
 * Ceiling on the base64 payload we will relay. API Gateway + Lambda cap a
 * response at 6 MB, and base64 inflates the document by ~33%; a report past
 * this size would blow the invoke up into an opaque 502 from the platform. We
 * fail with a named code instead so the cause is legible in the response and
 * the logs. 4.5 MB of base64 ≈ a 3.4 MB PDF — far above any order profile
 * observed, and still clear of the platform cap once JSON framing is added.
 */
const MAX_REPORT_BASE64_BYTES = 4.5 * 1024 * 1024

/**
 * Content types we will echo back verbatim. Anything else is downgraded to
 * `application/octet-stream`, which browsers download and never execute.
 *
 * This matters more than it looks. The upstream payload — including its
 * `contentType` — comes from the tenant's on-prem pegII host, and the browser
 * client turns it into `new Blob([bytes], { type: contentType })` +
 * `URL.createObjectURL`. A blob: URL INHERITS THE CREATING PAGE'S ORIGIN, so a
 * pegII host that answered with `text/html` and a scripted body would get that
 * script executed inside tenant-web's origin, with access to the session token
 * — an on-prem compromise escalating into the cloud SPA. Every report this
 * route serves is a PDF, so pinning the executable types out is free.
 */
const ECHOED_CONTENT_TYPES = new Set(['application/pdf', 'application/octet-stream'])

/** The content type to serve for a report, never an origin-executable one. */
export function safeContentType(contentType: string): string {
  return ECHOED_CONTENT_TYPES.has(contentType.trim().toLowerCase())
    ? contentType.trim().toLowerCase()
    : 'application/octet-stream'
}

/**
 * Reduce a pegII-supplied filename to something safe to interpolate into a
 * quoted Content-Disposition parameter: no quotes, no backslashes, no CR/LF
 * (header injection), no path separators, no control characters. Falls back to
 * a derived name when nothing usable survives.
 */
export function sanitizeFileName(fileName: string, fallback: string): string {
  const cleaned = fileName
    // Anything outside printable ASCII goes: control characters (CR/LF header
    // injection) plus multi-byte codepoints, which are not legal in a header
    // value on Node's HTTP stack.
    .replace(/[^\x20-\x7e]/g, '')
    // Neutralize what would break out of the quoted parameter or imply a path.
    .replace(/["\\/]/g, '_')
    .trim()
  // Nothing meaningful survived (e.g. a name that was entirely separators).
  return /^[._]*$/.test(cleaned) ? fallback : cleaned
}

export const pegiiReportsHandler = new Hono<AppEnv>()

// Router-scoped error boundary, identical in spirit to pegii-runtime.ts: a
// PegiiApiError (source not configured / tunnel down / unusable payload) maps to
// a legible 503/502/404 that names the dependency, instead of the bare 500 the
// global app.onError would produce. Anything else re-throws so the global
// handler keeps owning it — 500 stays reserved for genuine bridge bugs.
pegiiReportsHandler.onError((err, c) => {
  if (err instanceof PegiiApiError) {
    const { status, code, message } = pegiiApiErrorToHttp(err)
    const correlationId = c.get('correlationId') ?? 'unknown'
    logger.warn('pegII report bridge upstream failure', {
      pegiiCode: err.code,
      pegiiStatus: err.status,
      status,
      correlationId,
    })
    return c.json({ error: message, code, correlationId }, status)
  }
  throw err
})

pegiiReportsHandler.get('/:reportType/:id', async (c) => {
  const tenantId = c.get('tenantId')
  const correlationId = c.get('correlationId') ?? 'unknown'

  const parsedType = ReportTypeSchema.safeParse(c.req.param('reportType'))
  if (!parsedType.success) {
    return c.json(
      {
        error: `Unsupported report type. Supported: ${SUPPORTED_REPORT_TYPES.join(', ')}`,
        code: 'UNSUPPORTED_REPORT_TYPE',
        correlationId,
      },
      400,
    )
  }
  const reportType = parsedType.data

  const id = c.req.param('id') ?? ''
  if (!IDENT_RE.test(id)) {
    return c.json(
      {
        error: 'id must match [A-Za-z0-9._:-]{1,128}',
        code: 'INVALID_REPORT_ID',
        correlationId,
      },
      400,
    )
  }

  // `format` is validated rather than ignored: a client that asks for a format
  // we don't serve should hear so, not silently receive base64 JSON.
  const format = c.req.query('format')
  if (format !== undefined && format !== 'pdf') {
    return c.json(
      { error: "format must be 'pdf' when supplied", code: 'UNSUPPORTED_FORMAT', correlationId },
      400,
    )
  }

  const gateway = await resolveReportGateway(c.get('db'), tenantId)
  const report = await gateway.fetchReport(reportType, id)

  if (!report) {
    logger.info('pegII report not found', { reportType, id, tenantId, correlationId })
    return c.json(
      { error: `No ${reportType} report for id ${id}`, code: 'REPORT_NOT_FOUND', correlationId },
      404,
    )
  }

  if (report.contentBase64.length > MAX_REPORT_BASE64_BYTES) {
    logger.warn('pegII report exceeds the relayable size', {
      reportType,
      id,
      base64Bytes: report.contentBase64.length,
      tenantId,
      correlationId,
    })
    return c.json(
      {
        error: 'The rendered report is too large to return through the API',
        code: 'REPORT_TOO_LARGE',
        correlationId,
      },
      502,
    )
  }

  logger.info('pegII report fetched', {
    reportType,
    id,
    format: format ?? 'base64',
    base64Bytes: report.contentBase64.length,
    tenantId,
    correlationId,
  })

  // The upstream content type never reaches a client unfiltered — see
  // safeContentType. Both response modes carry the filtered value, because the
  // browser client builds its Blob from the JSON envelope's field, not from the
  // response header.
  const contentType = safeContentType(report.contentType)

  if (format === 'pdf') {
    const buf = Buffer.from(report.contentBase64, 'base64')
    const fileName = sanitizeFileName(report.fileName, `${reportType}-${id}.pdf`)
    // Copy out of the pooled Buffer into a standalone ArrayBuffer — Buffer views
    // share a larger pool allocation, so handing `buf.buffer` straight to Hono
    // would emit unrelated neighbouring bytes.
    return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 200, {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': String(buf.byteLength),
    })
  }

  return c.json({ data: { ...report, contentType } })
})
