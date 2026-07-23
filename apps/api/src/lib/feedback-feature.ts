// ---------------------------------------------------------------------------
// Master switch for the feedback (magic-link surveys) feature — the FeedbackForm
// authoring surface, the FeedbackRequest mint, AND the public respond endpoint.
// Mirrors isCustomEventsEnabled: an ops-level toggle that gates the whole HTTP
// surface, so the feature simply does not exist until ops flips it. Off by default.
// ---------------------------------------------------------------------------

export function isFeedbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['FEEDBACK_ENABLED'] === 'true'
}

/** Public base URL of the tenant SPA — used to build the capability link at mint. */
export function feedbackWebBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env['FEEDBACK_PUBLIC_WEB_URL'] ?? '').replace(/\/+$/, '')
}

/** Build the public capability URL a respondent opens for a given token. */
export function feedbackUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${feedbackWebBaseUrl(env)}/f/${token}`
}
