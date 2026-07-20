import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Partner-ingress bearer management — mirrors apps/api/src/handlers/ingress.ts
// (ingressManagementHandler, dual-auth + ManageIngress). The bearer a third
// party POSTs to the pre-tenant ingress endpoint. The plaintext token is
// returned ONCE at provision/rotate and never again (only its 12-char prefix
// and metadata are readable afterward).
// ---------------------------------------------------------------------------

/** Credential metadata — never the token. Returned by GET (200) / mutations. */
export interface IngressCredentialMeta {
  integrationId: string
  /** Public URL a partner POSTs events to. */
  url: string
  /** First 12 chars of the token (e.g. "ing_a1b2c3d4"). */
  tokenPrefix: string
  enabled: boolean
  createdAt: string
  rotatedAt: string | null
}

/** Provision/rotate result — carries the plaintext token exactly once. */
export interface IngressCredentialWithToken {
  integrationId: string
  url: string
  /** The plaintext bearer — shown ONCE, never retrievable again. */
  token: string
  tokenPrefix: string
  enabled: boolean
}

/** A structured dry-run issue: a partner-shaped code + human message. */
export interface IngressAckIssue {
  code: string
  message: string
}

/** Side-effect-free dry-run result for a sample body against the published config. */
export interface IngressTestResult {
  /** Domain event that a real delivery would emit. */
  eventType: string
  /** Derived dedup id, or null when the body is invalid. */
  dedupId: string | null
  /** Whether the body passes the published `validation` block. */
  valid: boolean
  /** Validation issues ([] when valid). */
  issues: IngressAckIssue[]
  /** The exact synchronous ack a real delivery would return. */
  ack: unknown
}

const base = (integrationId: string) =>
  `/api/v1/integrations/${encodeURIComponent(integrationId)}/ingress`

/** GET metadata; throws ApiError 404 when no credential is provisioned. */
export async function getIngress(integrationId: string): Promise<IngressCredentialMeta> {
  return apiFetch<IngressCredentialMeta>(base(integrationId))
}

/** Provision the first credential; 409 if one already exists. */
export async function provisionIngress(integrationId: string): Promise<IngressCredentialWithToken> {
  return apiFetch<IngressCredentialWithToken>(base(integrationId), { method: 'POST' })
}

/** Rotate the credential's token; 404 if none exists. */
export async function rotateIngress(integrationId: string): Promise<IngressCredentialWithToken> {
  return apiFetch<IngressCredentialWithToken>(`${base(integrationId)}/rotate`, { method: 'POST' })
}

/** Decommission (hard-delete) the credential; 404 if none exists. */
export async function decommissionIngress(
  integrationId: string,
): Promise<{ integrationId: string; decommissioned: boolean }> {
  return apiFetch<{ integrationId: string; decommissioned: boolean }>(base(integrationId), {
    method: 'DELETE',
  })
}

/** Dry-run the published inbound behavior against a sample body (no side effects). */
export async function testIngress(
  integrationId: string,
  sample: unknown,
): Promise<IngressTestResult> {
  return apiFetch<IngressTestResult>(`${base(integrationId)}/test`, {
    method: 'POST',
    body: JSON.stringify(sample),
  })
}
