// ---------------------------------------------------------------------------
// Semver precedence for workflow versions
//
// Workflow versions are semver strings (`1.2.3`, `1.2.3-beta.1`). Both the
// tenant UI (collapse versions to latest-per-name) and the API (which version
// of a workflow is current for the requirements summary) must agree on which
// version is newest, so the comparison lives here, once.
// ---------------------------------------------------------------------------

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
    const x = ai[i]
    const y = bi[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const aNum = NUMERIC.test(x)
    const bNum = NUMERIC.test(y)
    if (aNum && bNum) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (aNum) {
      return -1 // numeric identifiers have lower precedence than alphanumeric
    } else if (bNum) {
      return 1
    } else {
      return x < y ? -1 : 1
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
