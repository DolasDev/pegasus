import { describe, it, expect, vi } from 'vitest'
import { createPegiiReportGateway } from '../pegii-report.gateway'
import { PegiiApiError, type PegiiApiClient } from '../../lib/pegii-api-client'
import type { PegiiReportDto } from '../pegii/pegii-report.dto'

function stubClient(get: PegiiApiClient['get']): PegiiApiClient {
  // fetchReport only uses get(); getHealth is never reached on this gateway.
  return { get, getHealth: vi.fn() }
}

const PDF_B64 = Buffer.from('%PDF-1.4').toString('base64')

describe('createPegiiReportGateway.fetchReport', () => {
  it('fetches the report from the pegII reports path and maps it to a ReportRecord', async () => {
    const dto: PegiiReportDto = {
      reportType: 'order-profile',
      id: 12345,
      fileName: 'OrderProfile_12345.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF_B64,
    }
    const get = vi.fn().mockResolvedValue(dto)
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    const report = await gateway.fetchReport('order-profile', '12345')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/reports/order-profile/12345')
    expect(report).toEqual({
      reportType: 'order-profile',
      id: '12345',
      fileName: 'OrderProfile_12345.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF_B64,
    })
  })

  it('never asks upstream for ?format=pdf — the tunnel transport is JSON-only', async () => {
    const get = vi.fn().mockResolvedValue({ contentBase64: PDF_B64 })
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await gateway.fetchReport('order-profile', '12345')

    // One argument only: no query object, and no `format` in the path.
    expect(get).toHaveBeenCalledTimes(1)
    expect(get.mock.calls[0]).toHaveLength(1)
    expect(get.mock.calls[0]?.[0]).not.toMatch(/format/)
  })

  it('url-encodes both path segments', async () => {
    const get = vi.fn().mockResolvedValue({ contentBase64: PDF_B64 })
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    await gateway.fetchReport('order/profile', 'a b')

    expect(get).toHaveBeenCalledWith('/api/v1/pegii/reports/order%2Fprofile/a%20b')
  })

  it('returns null when pegII reports a 404', async () => {
    const get = vi
      .fn()
      .mockRejectedValue(new PegiiApiError('PEGII_API_HTTP_ERROR', 'not found', 404))
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(get),
    })

    expect(await gateway.fetchReport('order-profile', 'missing')).toBeNull()
  })

  it('rethrows non-404 transport/HTTP errors', async () => {
    const boom = new PegiiApiError('PEGII_API_TUNNEL_ERROR', 'tunnel down')
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn().mockRejectedValue(boom)),
    })

    await expect(gateway.fetchReport('order-profile', '12345')).rejects.toBe(boom)
  })

  it('propagates the mapper bad-envelope error for an undecodable document', async () => {
    const gateway = createPegiiReportGateway({
      tenantId: 't1',
      baseUrl: 'https://pegii.test:8443',
      client: stubClient(vi.fn().mockResolvedValue({ contentBase64: '' })),
    })

    await expect(gateway.fetchReport('order-profile', '12345')).rejects.toThrow(PegiiApiError)
  })
})
