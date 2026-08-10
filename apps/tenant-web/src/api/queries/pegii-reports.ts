import { apiFetch } from '@/api/client'

// ---------------------------------------------------------------------------
// pegII-rendered report documents.
//
// The API relays them from the pegII team's on-prem report endpoint over the
// WireGuard tunnel, base64-encoded inside the usual `{ data }` envelope, which
// `apiFetch` unwraps for us.
//
// Deliberately NOT a react-query `queryOptions`: a report is an imperative
// action ("show me this document now"), not cached view state. Fetching it on
// render would pull a multi-hundred-KB PDF through the tunnel for every user
// who merely opened the pane. It is called on click instead.
//
// The API also serves `?format=pdf` as a raw stream, but the browser cannot use
// it directly: tenant-web authenticates with a bearer token that a plain
// navigation (`<a href>`, `window.open`) will not attach. So we read the base64
// form through the authenticated client and materialize it locally — see
// lib/open-base64-pdf.ts.
// ---------------------------------------------------------------------------

/** The report types the API allowlists. Adding one is an API-side change too. */
export type PegiiReportType = 'order-profile'

export type PegiiReport = {
  reportType: string
  id: string
  fileName: string
  contentType: string
  contentBase64: string
}

export function fetchPegiiReport(reportType: PegiiReportType, id: string) {
  return apiFetch<PegiiReport>(
    `/api/v1/pegii-reports/${encodeURIComponent(reportType)}/${encodeURIComponent(id)}`,
  )
}
