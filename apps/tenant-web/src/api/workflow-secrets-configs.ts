import { apiFetch } from './client'

// ---------------------------------------------------------------------------
// Workflow secrets & configuration — mirror
// apps/api/src/handlers/workflow-secrets-configs.ts.
//
// Per-tenant key/value store a running workflow reads at runtime. SECRETS are
// write-once and their values are NEVER returned by the management API (only
// metadata); CONFIG entries are plain key/value and fully editable.
// ---------------------------------------------------------------------------

/** Group an entry lands in when none is specified. */
export const DEFAULT_GROUP = 'global'

/** Secret metadata — the management surface never returns the value. */
export interface WorkflowSecretMeta {
  id: string
  group: string
  key: string
  description: string | null
  isSecret: true
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowConfigEntry {
  id: string
  group: string
  key: string
  value: string
  description: string | null
  isSecret: false
  createdByUserId: string
  createdAt: string
  updatedAt: string
}

const BASE = '/api/v1/workflow-secrets-configs'

/** Serialize a `?group=` query (server defaults to "global" when omitted). */
function groupQuery(group: string | undefined): string {
  return group ? `?group=${encodeURIComponent(group)}` : ''
}

// -- secrets (requires workflow_secret:manage) ------------------------------

/** List secret metadata (no values), across every group. */
export async function listSecrets(): Promise<WorkflowSecretMeta[]> {
  return apiFetch<WorkflowSecretMeta[]>(`${BASE}/secrets`)
}

/** Create a write-once secret (201). The value is never echoed back. */
export async function createSecret(data: {
  key: string
  value: string
  group?: string
  description?: string
}): Promise<WorkflowSecretMeta> {
  return apiFetch<WorkflowSecretMeta>(`${BASE}/secrets`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** Delete a secret by key within its group (204). */
export async function deleteSecret(key: string, group?: string): Promise<void> {
  await apiFetch<null>(`${BASE}/secrets/${encodeURIComponent(key)}${groupQuery(group)}`, {
    method: 'DELETE',
  })
}

// -- config (requires workflow_config:manage) -------------------------------

/** List config entries with their plain values, across every group. */
export async function listConfigs(): Promise<WorkflowConfigEntry[]> {
  return apiFetch<WorkflowConfigEntry[]>(`${BASE}/configs`)
}

/** Create a config entry (201). */
export async function createConfig(data: {
  key: string
  value: string
  group?: string
  description?: string
}): Promise<WorkflowConfigEntry> {
  return apiFetch<WorkflowConfigEntry>(`${BASE}/configs`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** Upsert a config value by key within its group (idempotent). */
export async function upsertConfig(
  key: string,
  data: { value: string; group?: string; description?: string | null },
): Promise<WorkflowConfigEntry> {
  return apiFetch<WorkflowConfigEntry>(`${BASE}/configs/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

/** Delete a config entry by key within its group (204). */
export async function deleteConfig(key: string, group?: string): Promise<void> {
  await apiFetch<null>(`${BASE}/configs/${encodeURIComponent(key)}${groupQuery(group)}`, {
    method: 'DELETE',
  })
}
