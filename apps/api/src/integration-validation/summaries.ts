// ---------------------------------------------------------------------------
// Integration summaries — the shared read model behind every "which integrations
// apply to me?" endpoint.
//
// Three endpoints answer that question and MUST answer it identically:
//   - GET /api/v1/integrations                  (session/UI — handlers/integrations/list.ts)
//   - GET /integrations/configs                 (m2m/SDK discovery)
//   - GET /integrations/requirements-summary    (m2m — same id set, different payload)
//
// Each used to enumerate `listIntegrationIds()`, which is synchronous and so
// reports only whatever the module-level GLOBAL overlay cache happens to hold.
// On a container that has only served UI traffic that cache is null, so the list
// collapsed to the two built-in code overlays — a tenant's real published
// integrations were invisible and the built-ins showed as unpublished. Tenant-
// owned ids were never enumerated at all. `listIntegrationIdsForScope` fixes the
// id set; this module fixes the resolution of each id to display metadata.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@prisma/client'
import {
  listIntegrationIdsForScope,
  getIntegrationDefinition,
  toDefinitionFromRow,
} from './registry'
import { createIntegrationConfigRepository } from '../repositories/integration-config.repository'
import type { IntegrationConfigRow } from '../repositories/integration-config.repository'
import type { IntegrationDefinition } from './types'

export interface IntegrationSummary {
  id: string
  name: string
  description: string
  /** True when an active published config exists for the caller's scope. */
  published: boolean
  /** Active config version, or null when only the built-in baseline applies. */
  version: number | null
  /** Active config visibility, or null when unpublished. */
  visibility: 'GLOBAL' | 'TENANT' | null
}

/**
 * Resolve the definition governing one id for a tenant, given its already-fetched
 * active row. The row wins (it may be a TENANT-scoped overlay for an id with no
 * built-in and no GLOBAL entry — unresolvable any other way); an unparseable row
 * falls back to the built-in/GLOBAL definition, matching the runtime resolver's
 * fail-open behavior in `resolveIntegrationDefinition`.
 */
function definitionFor(id: string, row: IntegrationConfigRow | null): IntegrationDefinition | null {
  const fromRow = row ? toDefinitionFromRow(row) : null
  return fromRow ?? getIntegrationDefinition(id) ?? null
}

/**
 * Every integration that applies to `tenantId` — built-in, GLOBAL, or the
 * tenant's own — each joined with its active published config when one exists.
 * Ids that resolve to no definition at all (e.g. a row naming an unknown floor)
 * are skipped: they can never take effect, so listing them would be a lie.
 */
export async function listIntegrationSummaries(
  db: PrismaClient,
  tenantId: string,
): Promise<IntegrationSummary[]> {
  const repo = createIntegrationConfigRepository(db)
  const summaries: IntegrationSummary[] = []

  for (const id of await listIntegrationIdsForScope(db, tenantId)) {
    const active = await repo.findActiveForScope(id, tenantId)
    const def = definitionFor(id, active)
    if (!def) continue
    summaries.push({
      id: def.id,
      // The active config's displayName (0019) wins over the built-in label, so a
      // published "Weichert" reads as Weichert rather than its floor/id.
      name: active?.displayName ?? def.displayName,
      description: def.description,
      published: active !== null,
      version: active?.version ?? null,
      visibility: active?.visibility ?? null,
    })
  }
  return summaries
}
