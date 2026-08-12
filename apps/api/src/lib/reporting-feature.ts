// ---------------------------------------------------------------------------
// Master switch for the reporting (dashboards) feature -- the dataset catalog
// and the batched query endpoint. Mirrors isFeedbackEnabled: an ops-level
// toggle that gates the whole HTTP surface, so the feature simply does not
// exist until ops flips it. Off by default.
//
// The tenant SPA keys its nav entry off the catalog endpoint responding, so
// flipping this off hides the UI too rather than leaving a dead link.
// ---------------------------------------------------------------------------

export function isReportingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['REPORTING_ENABLED'] === 'true'
}
