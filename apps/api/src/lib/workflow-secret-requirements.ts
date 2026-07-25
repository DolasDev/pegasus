// ---------------------------------------------------------------------------
// Workflow secret/config requirements resolver
//
// A workflow manifest may declare the secret/config keys it reads at runtime
// (`requiredSecrets` / `requiredConfigs`). This module resolves those declared
// requirements against the tenant's workflow_secret_configs store, tagging each
// with whether a matching entry exists. Presence only — it never reads or
// returns a value, so it is safe to expose to any caller who may read the
// workflow. Declaration is informational: the runtime read still resolves
// lazily (get_secret/get_config, 404 if absent); this only powers the tenant
// UI's "which keys are set / missing" view.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import { createWorkflowSecretConfigRepository } from '../repositories/workflow-secret-config.repository'

export type RequirementKind = 'SECRET' | 'CONFIG'

export type ResolvedRequirement = {
  kind: RequirementKind
  key: string
  group: string
  description: string | null
  present: boolean
}

/** The raw, defensively-typed shape of one requirement in the stored manifest. */
type RawRequirement = { key: string; group: string; description: string | null }

/** Presence lookup sets for a tenant, keyed by {@link presenceKey}. */
export type PresenceSets = { secrets: Set<string>; configs: Set<string> }

const DEFAULT_GROUP = 'global'

/** Compose the presence-set lookup key. A JSON tuple `["group","key"]` is used
 *  so no (group, key) pair is ambiguous regardless of the characters involved. */
export function presenceKey(group: string, key: string): string {
  return JSON.stringify([group, key])
}

/**
 * Pull `requiredSecrets` / `requiredConfigs` out of a stored manifest JSON blob,
 * coercing each entry defensively (the manifest is an untyped Json column). Rows
 * without a string `key` are dropped; a missing/blank group falls back to
 * "global" to match the store's default.
 */
export function extractRequirements(manifest: unknown): {
  secrets: RawRequirement[]
  configs: RawRequirement[]
} {
  const m = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>) : {}
  return { secrets: coerce(m.requiredSecrets), configs: coerce(m.requiredConfigs) }
}

function coerce(value: unknown): RawRequirement[] {
  if (!Array.isArray(value)) return []
  const out: RawRequirement[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    if (typeof r.key !== 'string' || r.key === '') continue
    out.push({
      key: r.key,
      group: typeof r.group === 'string' && r.group !== '' ? r.group : DEFAULT_GROUP,
      description: typeof r.description === 'string' ? r.description : null,
    })
  }
  return out
}

/**
 * Load the tenant's secret/config presence sets in one query per kind. `db` must
 * already be tenant-scoped (the Prisma extension rewrites the reads). Reuse the
 * result across many workflows (e.g. the requirements summary) instead of
 * re-querying per workflow.
 */
export async function loadPresenceSets(db: PrismaClient): Promise<PresenceSets> {
  const repo = createWorkflowSecretConfigRepository(db)
  const [secretRows, configRows] = await Promise.all([
    repo.listByKind('SECRET'),
    repo.listByKind('CONFIG'),
  ])
  return {
    secrets: new Set(secretRows.map((r) => presenceKey(r.group, r.key))),
    configs: new Set(configRows.map((r) => presenceKey(r.group, r.key))),
  }
}

/** Resolve a manifest's requirements against already-loaded presence sets. */
export function resolveAgainst(manifest: unknown, sets: PresenceSets): ResolvedRequirement[] {
  const { secrets, configs } = extractRequirements(manifest)
  const resolved: ResolvedRequirement[] = []
  for (const r of secrets) {
    resolved.push({
      kind: 'SECRET',
      key: r.key,
      group: r.group,
      description: r.description,
      present: sets.secrets.has(presenceKey(r.group, r.key)),
    })
  }
  for (const r of configs) {
    resolved.push({
      kind: 'CONFIG',
      key: r.key,
      group: r.group,
      description: r.description,
      present: sets.configs.has(presenceKey(r.group, r.key)),
    })
  }
  return resolved
}

/** Count how many resolved requirements are not yet present in the store. */
export function countMissing(requirements: ResolvedRequirement[]): number {
  return requirements.reduce((n, r) => (r.present ? n : n + 1), 0)
}
