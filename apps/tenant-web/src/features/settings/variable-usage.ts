// ---------------------------------------------------------------------------
// Variable ↔ consumer cross-reference
//
// The two requirements summaries answer "which keys does THIS workflow /
// integration need?" (forward). This module inverts them into "who needs THIS
// key?" (reverse) so the Configs page can annotate each stored secret/config
// row with its consumers, name them before a delete, and offer a key-centric
// list of what is still missing.
//
// Pure transform of data the page already fetches — no API call of its own, so
// no new endpoint and no RBAC surface. See {@link useVariableUsage} for the
// fail-open query wrapper.
// ---------------------------------------------------------------------------

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { workflowRequirementsSummaryQueryOptions } from '@/api/queries/workflows'
import { integrationRequirementsSummaryQueryOptions } from '@/api/queries/integrations'
import type { WorkflowRequirementsSummary } from '@/api/workflows'
import type { IntegrationRequirementsSummary } from '@/api/integrations'

/** Something that declared it reads a key at runtime. */
export interface VariableConsumer {
  type: 'workflow' | 'integration'
  /** Link target. For a workflow this is ONE version's id — see {@link buildVariableUsageIndex}. */
  id: string
  name: string
}

/** One `(kind, group, key)` variable and everything that declared it. */
export interface VariableUsage {
  kind: 'SECRET' | 'CONFIG'
  group: string
  key: string
  /** First non-empty description any consumer declared, else null. */
  description: string | null
  /** Whether the tenant's store already holds this key (as resolved server-side). */
  present: boolean
  consumers: VariableConsumer[]
}

export type VariableUsageIndex = Map<string, VariableUsage>

/**
 * Index lookup key. A JSON triple so no (kind, group, key) combination is
 * ambiguous regardless of the characters involved — mirrors the server's
 * `presenceKey` in lib/workflow-secret-requirements.ts.
 */
export function usageKey(kind: 'SECRET' | 'CONFIG', group: string, key: string): string {
  return JSON.stringify([kind, group, key])
}

/**
 * Invert both requirements summaries into a `(kind, group, key)` → consumers map.
 *
 * Consumers are deduped by `(type, name)` rather than by id: the workflows list
 * returns every VERSION of a workflow as its own row with its own id (which is
 * why the workflows settings page collapses to latest-per-name), so an id-based
 * dedupe would dedupe nothing and render the same workflow once per version. The
 * first id seen wins as the link target.
 *
 * `present` is taken from the summaries, which resolved it against the tenant's
 * store server-side. Both arguments are optional so a caller whose query failed
 * (or is not permitted) can still build a partial — or empty — index.
 */
export function buildVariableUsageIndex(
  workflowSummary?: WorkflowRequirementsSummary,
  integrationSummary?: IntegrationRequirementsSummary,
): VariableUsageIndex {
  const index: VariableUsageIndex = new Map()

  function add(requirement: VariableRequirement, consumer: VariableConsumer): void {
    const id = usageKey(requirement.kind, requirement.group, requirement.key)
    let usage = index.get(id)
    if (!usage) {
      usage = {
        kind: requirement.kind,
        group: requirement.group,
        key: requirement.key,
        description: requirement.description,
        present: requirement.present,
        consumers: [],
      }
      index.set(id, usage)
    }
    // A later declaration may carry the description an earlier one omitted.
    if (!usage.description && requirement.description) usage.description = requirement.description
    // Presence is a property of the store, identical across consumers; OR-ing
    // keeps the index honest if two summaries ever disagree mid-refetch.
    usage.present = usage.present || requirement.present
    if (!usage.consumers.some((c) => c.type === consumer.type && c.name === consumer.name)) {
      usage.consumers.push(consumer)
    }
  }

  for (const workflow of workflowSummary?.workflows ?? []) {
    const consumer: VariableConsumer = {
      type: 'workflow',
      id: workflow.workflowId,
      name: workflow.name,
    }
    for (const requirement of workflow.requirements) add(requirement, consumer)
  }

  for (const integration of integrationSummary?.integrations ?? []) {
    const consumer: VariableConsumer = {
      type: 'integration',
      id: integration.integrationId,
      name: integration.displayName,
    }
    for (const requirement of integration.requirements) add(requirement, consumer)
  }

  return index
}

/** The resolved-requirement shape both summaries share. */
type VariableRequirement = {
  kind: 'SECRET' | 'CONFIG'
  key: string
  group: string
  description: string | null
  present: boolean
}

/**
 * Consumers of one stored entry. Matches on the full `(kind, group, key)` tuple,
 * so a secret named `API_KEY` never picks up a config requirement of the same
 * name. Empty when nothing declares it — or when the index is empty because the
 * caller cannot read the summaries.
 */
export function consumersOf(
  index: VariableUsageIndex,
  kind: 'SECRET' | 'CONFIG',
  group: string,
  key: string,
): VariableConsumer[] {
  return index.get(usageKey(kind, group, key))?.consumers ?? []
}

/**
 * Every declared variable the tenant has not set yet, key-centric (one entry per
 * `(kind, group, key)` no matter how many consumers want it). Sorted secrets
 * first, then by group, then by key, so the list is stable across refetches.
 */
export function missingVariables(index: VariableUsageIndex): VariableUsage[] {
  return [...index.values()]
    .filter((usage) => !usage.present)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'SECRET' ? -1 : 1
      if (a.group !== b.group) return a.group.localeCompare(b.group)
      return a.key.localeCompare(b.key)
    })
}

/**
 * Read both requirements summaries and invert them.
 *
 * Fails open, independently per query: the Configs page is gated on
 * `workflow_secret:manage` / `workflow_config:manage`, which do NOT imply
 * ReadWorkflow or ReadIntegrationConfig. A user holding only the manage
 * permissions still gets a fully working panel — just without the cross-
 * reference annotations — instead of an error.
 */
export function useVariableUsage(): VariableUsageIndex {
  const { data: workflows } = useQuery({ ...workflowRequirementsSummaryQueryOptions, retry: false })
  const { data: integrations } = useQuery({
    ...integrationRequirementsSummaryQueryOptions,
    retry: false,
  })
  // react-query hands back a stable reference until the data actually changes,
  // so this recomputes only on refetch — not on every render of the panel.
  return useMemo(() => buildVariableUsageIndex(workflows, integrations), [workflows, integrations])
}
