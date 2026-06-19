// ---------------------------------------------------------------------------
// Master switch for publishing integration-validator config from the DB-backed
// store. Mirrors the RingCentral env-flag pattern (services/ringcentral/oauth.ts):
// an ops-level toggle that gates the mutating endpoints (publish, rollback).
// Read + dry-run validate stay available so authors can iterate before the
// switch is flipped. Off by default — the built-in code config keeps serving.
// ---------------------------------------------------------------------------

export function isIntegrationConfigPublishEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['INTEGRATION_CONFIG_PUBLISH_ENABLED'] === 'true'
}
