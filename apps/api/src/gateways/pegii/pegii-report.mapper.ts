// ---------------------------------------------------------------------------
// pegII Report mapper — PegiiReportDto → ReportRecord.
//
// Anti-corruption layer, mirroring pegii-order.mapper.ts / pegii-salesman.mapper.ts:
// nothing downstream of here knows the pegII wire shape.
//
// Two jobs beyond field copying:
//
//  1. Default the echoed metadata from what we asked for. pegII owns the
//     document; it does not own our request, so a missing/blank `reportType`,
//     `id`, `fileName` or `contentType` is filled from the caller's own values
//     rather than treated as a failure.
//
//  2. Validate + normalize `contentBase64`. `Buffer.from(s, 'base64')` silently
//     DISCARDS characters outside the base64 alphabet, so a truncated or
//     HTML-error-page payload would decode to a plausible-looking but corrupt
//     PDF and reach the user as a broken download. Checking the alphabet here
//     turns that into a legible 502 PEGII_SOURCE_BAD_RESPONSE instead. Embedded
//     whitespace (MIME-style line wrapping) is stripped, not rejected — several
//     base64 encoders emit it and it is not corruption.
// ---------------------------------------------------------------------------

import type { ReportRecord } from '../report.gateway'
import type { PegiiReportDto } from './pegii-report.dto'
import { PegiiApiError } from '../../lib/pegii-api-client'

/** Standard base64 alphabet with optional `=` padding; whitespace pre-stripped. */
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/** What the caller asked for — the source of every default below. */
export interface RequestedReport {
  reportType: string
  id: string
}

/** First non-blank string among the candidates, else ''. */
function firstNonBlank(...values: Array<unknown>): string {
  for (const v of values) {
    if (v == null) continue
    const s = String(v).trim()
    if (s !== '') return s
  }
  return ''
}

export function mapPegiiReportToRecord(
  dto: PegiiReportDto,
  requested: RequestedReport,
): ReportRecord {
  const raw = dto?.contentBase64
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new PegiiApiError(
      'PEGII_API_BAD_ENVELOPE',
      `pegII report ${requested.reportType}/${requested.id} came back with no contentBase64`,
    )
  }

  const contentBase64 = raw.replace(/\s+/g, '')
  if (!BASE64_RE.test(contentBase64)) {
    throw new PegiiApiError(
      'PEGII_API_BAD_ENVELOPE',
      `pegII report ${requested.reportType}/${requested.id} contentBase64 is not valid base64`,
    )
  }

  const reportType = firstNonBlank(dto.reportType, requested.reportType)
  const id = firstNonBlank(dto.id, requested.id)

  return {
    reportType,
    id,
    fileName: firstNonBlank(dto.fileName, `${reportType}-${id}.pdf`),
    contentType: firstNonBlank(dto.contentType, 'application/pdf'),
    contentBase64,
  }
}
