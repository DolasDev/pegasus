// ---------------------------------------------------------------------------
// ReportGateway — the read seam for pegII-rendered report documents.
//
// Reports (order profile / "trip sheet", …) are rendered by the legacy pegII
// (MoveManager) system, not by the cloud: only pegII has the report definitions
// and the data joins behind them. This seam lets the
// /api/v1/pegii-reports/:reportType/:id route be served from the pegII team's
// on-prem domain API over the WireGuard tunnel, exactly the way OrderGateway
// serves order reads. See report-gateway.factory.ts for how a tenant resolves to
// a live gateway, and pegii-report.gateway.ts for the implementation.
//
// The document always crosses the wire base64-encoded inside the standard
// `{ data }` envelope, because lib/pegii-api-client.ts speaks that envelope over
// tunnelFetch and has no binary-stream mode. A caller that wants raw PDF bytes
// (our `?format=pdf`) decodes the base64 itself — see handlers/pegii-reports.ts.
// ---------------------------------------------------------------------------

/** One rendered report document, as it comes back from pegII. */
export interface ReportRecord {
  /** The report type that was rendered, e.g. "order-profile". */
  reportType: string
  /** The record the report was rendered for — for us, the order number. */
  id: string
  /** Suggested download filename, e.g. "order-profile-12345.pdf". */
  fileName: string
  /** MIME type of the decoded document. Always "application/pdf" today. */
  contentType: string
  /** The document itself, base64-encoded (standard alphabet, may be padded). */
  contentBase64: string
}

export interface ReportGateway {
  /**
   * Fetch one rendered report. Resolves null when pegII reports 404 — either the
   * report type is unknown to that pegII install or the record does not exist.
   */
  fetchReport(reportType: string, id: string): Promise<ReportRecord | null>
}
