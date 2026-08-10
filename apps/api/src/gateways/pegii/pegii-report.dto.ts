// ---------------------------------------------------------------------------
// pegII Report DTO — the typed anti-corruption boundary for the report document
// returned by the pegII team's on-prem domain API at
// `/api/v1/pegii/reports/:reportType/:id`.
//
// This is the shape of the INNER object the pegII client returns after
// unwrapping the `{ data }` envelope (see lib/pegii-api-client.ts). The
// upstream contract is:
//
//   { data: { reportType, id, fileName, contentType: "application/pdf",
//             contentBase64 }, error, code, correlationId }
//
// Only `contentBase64` is genuinely required — without the document there is
// nothing to serve. Every other field is optional here and defaulted by the
// mapper from the values we asked for, so a pegII build that trims the echoed
// metadata still produces a usable record instead of throwing.
//
// This file and pegii-report.mapper.ts are the ONLY two files that should need
// to change if the pegII report contract shifts — the gateway, factory and
// handler downstream are insulated from it.
// ---------------------------------------------------------------------------

export interface PegiiReportDto {
  /** Echo of the requested report type, e.g. "order-profile". */
  reportType?: string | null
  /** Echo of the requested record id. Tolerated as a number, as pegII ids often are. */
  id?: number | string | null
  /** Suggested download filename, e.g. "order-profile-12345.pdf". */
  fileName?: string | null
  /** MIME type of the decoded document. "application/pdf" on every known report. */
  contentType?: string | null
  /** The document, base64-encoded. The one field with no sane default. */
  contentBase64: string
}
