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

/** Split a semver string into its numeric core and prerelease tail. Build
 * metadata is not part of the workflow version grammar, so there is none to
 * strip. A missing prerelease yields `''`. */
function splitVersion(version: string): [core: string, prerelease: string] {
  const dash = version.indexOf('-')
  if (dash === -1) return [version, '']
  return [version.slice(0, dash), version.slice(dash + 1)]
}

const NUMERIC = /^[0-9]+$/

/** Compare two dot-separated prerelease strings per semver §11: numeric
 * identifiers rank below alphanumeric ones, a larger set of fields outranks a
 * shorter prefix, and everything else compares field-by-field. */
function comparePrerelease(a: string, b: string): number {
  const ai = a.split('.')
  const bi = b.split('.')
  const len = Math.max(ai.length, bi.length)
  for (let i = 0; i < len; i++) {
    // A shorter prerelease is lower precedence when it is a prefix of the other.
    if (ai[i] === undefined) return -1
    if (bi[i] === undefined) return 1
    if (ai[i] === bi[i]) continue
    const aNum = NUMERIC.test(ai[i])
    const bNum = NUMERIC.test(bi[i])
    if (aNum && bNum) {
      const d = Number(ai[i]) - Number(bi[i])
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (aNum) {
      return -1 // numeric identifiers have lower precedence than alphanumeric
    } else if (bNum) {
      return 1
    } else {
      return ai[i] < bi[i] ? -1 : 1
    }
  }
  return 0
}

/**
 * Compare two semver strings. Returns a negative number when `a` precedes `b`,
 * positive when `a` follows `b`, and 0 when equal. Follows semver precedence:
 * numeric core first, then a release outranks any prerelease of the same core.
 * Non-numeric core fields degrade to 0 rather than throwing.
 */
export function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a)
  const [bCore, bPre] = splitVersion(b)
  const an = aCore.split('.')
  const bn = bCore.split('.')
  for (let i = 0; i < 3; i++) {
    const av = Number(an[i] ?? 0) || 0
    const bv = Number(bn[i] ?? 0) || 0
    if (av !== bv) return av < bv ? -1 : 1
  }
  if (aPre === '' && bPre === '') return 0
  if (aPre === '') return 1 // release > prerelease
  if (bPre === '') return -1
  return comparePrerelease(aPre, bPre)
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
