// ---------------------------------------------------------------------------
// Workflow version grouping
//
// The API returns one row per uploaded (name, version) — so several versions of
// the same logical workflow arrive as separate rows. The Workflows settings
// page collapses those into one headline row per workflow name (the most recent
// version), with older versions tucked behind an expander. The pure helpers
// that decide "which version is latest" and "how do the groups order" live here
// so they can be unit-tested without the React layer.
// ---------------------------------------------------------------------------

import { compareSemver } from '@pegasus/domain'

// Semver precedence is shared with the API's requirements summary (which
// picks each workflow's current version the same way) — one definition.
export { compareSemver }

/** The minimal shape the grouping logic needs from a workflow row. */
export interface VersionedWorkflow {
  name: string
  version: string
  /** ISO-8601 upload timestamp. */
  createdAt: string
}

/** A workflow name with its versions sorted newest-first. */
export interface WorkflowVersionGroup<T extends VersionedWorkflow> {
  name: string
  /** The most recent version — the headline row. */
  latest: T
  /** Every other version, newest-first. Empty when only one version exists. */
  older: T[]
  /** All versions, newest-first (`latest` is `versions[0]`). */
  versions: T[]
}

/** Order two workflow rows newest-first: highest semver wins, most recent
 * upload breaks ties (e.g. a re-published identical version string). */
export function compareWorkflowVersionsDesc(a: VersionedWorkflow, b: VersionedWorkflow): number {
  const bySemver = compareSemver(b.version, a.version)
  if (bySemver !== 0) return bySemver
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}

/**
 * Collapse a flat list of workflow rows into one group per name, each group's
 * versions sorted newest-first. Groups are ordered by their latest version's
 * upload time (most recently active workflow first).
 */
export function groupWorkflowsByName<T extends VersionedWorkflow>(
  workflows: T[],
): WorkflowVersionGroup<T>[] {
  const byName = new Map<string, T[]>()
  for (const workflow of workflows) {
    const arr = byName.get(workflow.name)
    if (arr) arr.push(workflow)
    else byName.set(workflow.name, [workflow])
  }

  const groups = [...byName.values()].map((versions) => {
    const sorted = [...versions].sort(compareWorkflowVersionsDesc)
    return {
      name: sorted[0].name,
      latest: sorted[0],
      older: sorted.slice(1),
      versions: sorted,
    }
  })

  groups.sort(
    (a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime(),
  )
  return groups
}
