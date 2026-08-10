// ---------------------------------------------------------------------------
// Unit tests for the pegII reports handler.
//
// The route is a session surface mounted under v1's tenantMiddleware, so the
// test app injects the AppEnv context directly rather than stubbing an auth
// middleware. report-gateway.factory is mocked to a controllable stub — its own
// tenant resolution and tunnel transport are covered by the gateway/overlay
// unit tests.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { PrismaClient } from '@prisma/client'
import type { AppEnv } from '../types'
import { registerTestErrorHandler } from '../test-helpers'

const { fetchReport } = vi.hoisted(() => ({ fetchReport: vi.fn() }))
vi.mock('../gateways/report-gateway.factory', () => ({
  resolveReportGateway: vi.fn(async () => ({ fetchReport })),
}))

import { pegiiReportsHandler, sanitizeFileName } from './pegii-reports'
import { resolveReportGateway } from '../gateways/report-gateway.factory'
import { PegiiApiError } from '../lib/pegii-api-client'
import type { ReportRecord } from '../gateways/report.gateway'

type JsonBody = Record<string, unknown>
const json = (res: Response) => res.json() as Promise<JsonBody>

const PDF_BYTES = '%PDF-1.4 trip sheet'
const PDF_B64 = Buffer.from(PDF_BYTES).toString('base64')

const report = (over: Partial<ReportRecord> = {}): ReportRecord => ({
  reportType: 'order-profile',
  id: '12345',
  fileName: 'OrderProfile_12345.pdf',
  contentType: 'application/pdf',
  contentBase64: PDF_B64,
  ...over,
})

function buildApp() {
  const fakeDb = {} as unknown as PrismaClient
  const app = new Hono<AppEnv>()
  registerTestErrorHandler(app)
  app.use('*', async (c, next) => {
    c.set('tenantId', 'test-tenant-id')
    c.set('db', fakeDb)
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.route('/pegii-reports', pegiiReportsHandler)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchReport.mockResolvedValue(report())
})

describe('GET /pegii-reports/:reportType/:id', () => {
  it('returns the base64 envelope by default', async () => {
    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      data: {
        reportType: 'order-profile',
        id: '12345',
        fileName: 'OrderProfile_12345.pdf',
        contentType: 'application/pdf',
        contentBase64: PDF_B64,
      },
    })
  })

  it('passes the report type and id through to the gateway', async () => {
    await buildApp().request('/pegii-reports/order-profile/SO-12345')

    expect(resolveReportGateway).toHaveBeenCalledWith(expect.anything(), 'test-tenant-id')
    expect(fetchReport).toHaveBeenCalledWith('order-profile', 'SO-12345')
  })

  it('rejects a report type outside the allowlist with 400', async () => {
    const res = await buildApp().request('/pegii-reports/payroll-export/12345')

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'UNSUPPORTED_REPORT_TYPE' })
    // Never reached the on-prem host — that is the point of the allowlist.
    expect(fetchReport).not.toHaveBeenCalled()
  })

  it('rejects an id outside the identifier shape with 400', async () => {
    const res = await buildApp().request('/pegii-reports/order-profile/12%20345!')

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'INVALID_REPORT_ID' })
    expect(fetchReport).not.toHaveBeenCalled()
  })

  it('rejects a format it does not serve rather than silently returning base64', async () => {
    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=xlsx')

    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    expect(fetchReport).not.toHaveBeenCalled()
  })

  it('404s when pegII has no such report', async () => {
    fetchReport.mockResolvedValue(null)

    const res = await buildApp().request('/pegii-reports/order-profile/99999')

    expect(res.status).toBe(404)
    expect(await json(res)).toMatchObject({ code: 'REPORT_NOT_FOUND' })
  })
})

describe('GET /pegii-reports/:reportType/:id?format=pdf', () => {
  it('serves the decoded document as a PDF with a disposition header', async () => {
    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=pdf')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="OrderProfile_12345.pdf"')
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(PDF_BYTES)))
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe(PDF_BYTES)
  })

  it('emits only the document bytes, not neighbouring Buffer-pool bytes', async () => {
    // Buffer.from(…, 'base64') returns a view into a shared pool; handing its
    // backing ArrayBuffer to Hono unsliced would leak whatever else is pooled.
    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=pdf')

    expect((await res.arrayBuffer()).byteLength).toBe(Buffer.byteLength(PDF_BYTES))
  })

  it('sanitizes a hostile filename before putting it in the header', async () => {
    fetchReport.mockResolvedValue(report({ fileName: 'evil".pdf\r\nX-Injected: yes' }))

    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=pdf')

    expect(res.headers.get('x-injected')).toBeNull()
    expect(res.headers.get('content-disposition')).toBe(
      'inline; filename="evil_.pdfX-Injected: yes"',
    )
  })

  it('honors the content type pegII reported', async () => {
    fetchReport.mockResolvedValue(report({ contentType: 'application/octet-stream' }))

    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=pdf')

    expect(res.headers.get('content-type')).toBe('application/octet-stream')
  })
})

describe('size guard', () => {
  it('refuses a document too large to survive the Lambda response cap', async () => {
    // 5 MB of base64 — past the 4.5 MB ceiling, under which the invoke would
    // fail opaquely instead of answering.
    fetchReport.mockResolvedValue(report({ contentBase64: 'A'.repeat(5 * 1024 * 1024) }))

    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(502)
    expect(await json(res)).toMatchObject({ code: 'REPORT_TOO_LARGE' })
  })

  it('applies to the raw-pdf mode too', async () => {
    fetchReport.mockResolvedValue(report({ contentBase64: 'A'.repeat(5 * 1024 * 1024) }))

    const res = await buildApp().request('/pegii-reports/order-profile/12345?format=pdf')

    expect(res.status).toBe(502)
  })
})

describe('upstream failure mapping', () => {
  it('503s when the tenant has no configured pegII source', async () => {
    vi.mocked(resolveReportGateway).mockRejectedValueOnce(
      new PegiiApiError('PEGII_API_NOT_CONFIGURED', 'no peer'),
    )

    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(503)
    expect(await json(res)).toMatchObject({ code: 'PEGII_SOURCE_UNAVAILABLE' })
  })

  it('502s when the tunnel hop fails', async () => {
    fetchReport.mockRejectedValue(new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'timeout'))

    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(502)
    expect(await json(res)).toMatchObject({ code: 'PEGII_SOURCE_UNREACHABLE' })
  })

  it('502s when pegII answers with an unusable payload', async () => {
    fetchReport.mockRejectedValue(new PegiiApiError('PEGII_API_BAD_ENVELOPE', 'not base64'))

    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(502)
    expect(await json(res)).toMatchObject({ code: 'PEGII_SOURCE_BAD_RESPONSE' })
  })

  it('leaves a genuine bridge bug to the global 500 handler', async () => {
    fetchReport.mockRejectedValue(new Error('boom'))

    const res = await buildApp().request('/pegii-reports/order-profile/12345')

    expect(res.status).toBe(500)
  })
})

describe('sanitizeFileName', () => {
  it('keeps an ordinary filename intact', () => {
    expect(sanitizeFileName('OrderProfile_12345.pdf', 'fb.pdf')).toBe('OrderProfile_12345.pdf')
  })

  it('strips control characters and quotes, and neutralizes path separators', () => {
    expect(sanitizeFileName('a"b\r\nc/d\\e.pdf', 'fb.pdf')).toBe('a_bc_d_e.pdf')
  })

  it('drops non-ASCII codepoints that are illegal in a header value', () => {
    expect(sanitizeFileName('réport.pdf', 'fb.pdf')).toBe('rport.pdf')
  })

  it('falls back when nothing meaningful survives', () => {
    expect(sanitizeFileName('///', 'fb.pdf')).toBe('fb.pdf')
    expect(sanitizeFileName('', 'fb.pdf')).toBe('fb.pdf')
    expect(sanitizeFileName(' ', 'fb.pdf')).toBe('fb.pdf')
  })
})
