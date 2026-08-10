import { describe, it, expect } from 'vitest'
import { mapPegiiReportToRecord } from '../pegii-report.mapper'
import type { PegiiReportDto } from '../pegii-report.dto'
import { PegiiApiError } from '../../../lib/pegii-api-client'

const REQUESTED = { reportType: 'order-profile', id: '12345' }

/** Base64 of "%PDF-1.4" — a realistic, valid payload. */
const PDF_B64 = Buffer.from('%PDF-1.4').toString('base64')

describe('mapPegiiReportToRecord', () => {
  it('maps a full pegII payload straight through', () => {
    const dto: PegiiReportDto = {
      reportType: 'order-profile',
      id: 12345,
      fileName: 'OrderProfile_12345.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF_B64,
    }

    expect(mapPegiiReportToRecord(dto, REQUESTED)).toEqual({
      reportType: 'order-profile',
      id: '12345',
      fileName: 'OrderProfile_12345.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF_B64,
    })
  })

  it('defaults the echoed metadata from the request when pegII omits it', () => {
    const record = mapPegiiReportToRecord({ contentBase64: PDF_B64 }, REQUESTED)

    expect(record).toEqual({
      reportType: 'order-profile',
      id: '12345',
      fileName: 'order-profile-12345.pdf',
      contentType: 'application/pdf',
      contentBase64: PDF_B64,
    })
  })

  it('treats blank echoed metadata the same as missing', () => {
    const record = mapPegiiReportToRecord(
      { reportType: '  ', id: '', fileName: '   ', contentType: '', contentBase64: PDF_B64 },
      REQUESTED,
    )

    expect(record.reportType).toBe('order-profile')
    expect(record.id).toBe('12345')
    expect(record.fileName).toBe('order-profile-12345.pdf')
    expect(record.contentType).toBe('application/pdf')
  })

  it('strips MIME-style line wrapping from contentBase64', () => {
    const wrapped = `${PDF_B64.slice(0, 4)}\r\n${PDF_B64.slice(4)}\n`

    expect(mapPegiiReportToRecord({ contentBase64: wrapped }, REQUESTED).contentBase64).toBe(
      PDF_B64,
    )
  })

  it('throws a bad-envelope error when contentBase64 is missing', () => {
    expect(() =>
      mapPegiiReportToRecord({ contentBase64: undefined as unknown as string }, REQUESTED),
    ).toThrow(PegiiApiError)
  })

  it('throws a bad-envelope error when contentBase64 is blank', () => {
    expect(() => mapPegiiReportToRecord({ contentBase64: '   ' }, REQUESTED)).toThrow(PegiiApiError)
  })

  it('rejects a payload outside the base64 alphabet rather than decoding it to garbage', () => {
    // Buffer.from() would silently DISCARD the illegal characters and hand back
    // a corrupt "PDF"; the mapper must fail loudly instead.
    expect(() =>
      mapPegiiReportToRecord({ contentBase64: '<html>upstream error</html>' }, REQUESTED),
    ).toThrow(/not valid base64/)
  })

  it('reports the bad-envelope code so the router maps it to a 502', () => {
    try {
      mapPegiiReportToRecord({ contentBase64: '' }, REQUESTED)
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PegiiApiError)
      expect((err as PegiiApiError).code).toBe('PEGII_API_BAD_ENVELOPE')
    }
  })
})
