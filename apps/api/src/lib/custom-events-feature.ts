// ---------------------------------------------------------------------------
// Master switch for the tenant custom-events feature — the registry CRUD and
// the emit endpoint. Mirrors isIntegrationConfigPublishEnabled: an ops-level
// toggle that gates the whole HTTP surface (a tenant cannot define or emit
// custom events until it is flipped). Off by default.
//
// The dispatcher's domain-condition derivation path is deliberately NOT gated
// by this flag — it is keyed off existing TenantEventType rows, which can only
// exist once the flag was on long enough to create them. Gating the management
// surface is enough.
// ---------------------------------------------------------------------------

export function isCustomEventsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['CUSTOM_EVENTS_ENABLED'] === 'true'
}
