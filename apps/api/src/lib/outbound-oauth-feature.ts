// ---------------------------------------------------------------------------
// Master switch for the SHARED (DB-backed) tier of the outbound OAuth2 token
// cache — sdk-feedback 0027. Mirrors the integration-config publish flag
// (lib/integration-config-feature.ts): an ops-level toggle, off by default.
//
// Off  → tokens are cached only in the per-container in-memory Map (today's
//        behavior). Every cold or scaled-out container re-mints.
// On   → containers share minted tokens through the outbound_oauth_tokens
//        table, so a still-valid token is reused across invocations.
//
// It ships off deliberately, for two reasons:
//   1. It makes the diagnosis measurable. With the flag off, the new structured
//      log line reports one `mint` per container id; that is the evidence that
//      container non-reuse (not a broken cache) is what 0027 observed. Flipping
//      the flag then shows the same probe collapsing to a single mint.
//   2. Reusing a token across invocations is a behavior change a partner could
//      object to (Sirva's own OAuth doc says "never reuse an expired token"; a
//      stricter partner might extend that to any reuse). The flag turns that
//      off instantly, without a redeploy.
// ---------------------------------------------------------------------------

export function isOutboundOAuthSharedCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['OUTBOUND_OAUTH_SHARED_CACHE_ENABLED'] === 'true'
}
