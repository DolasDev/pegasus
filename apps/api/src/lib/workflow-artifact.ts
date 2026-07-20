// ---------------------------------------------------------------------------
// Workflow artifact integrity validation (Phase 3 Unit 6)
//
// Validates a tenant-uploaded workflow artifact zip at finalize time, BEFORE
// the workflow row is written:
//
//   * zip structure is sound (real central directory, no zip64, ≤10k entries,
//     no `..`/absolute entry paths)
//   * every manifest entry point resolves to a real file inside the zip
//   * the artifact declares no pip dependencies (v1 no-arbitrary-deps
//     decision — stdlib + SDK only)
//
// The zip reader is hand-written on purpose: we only ever need the entry
// NAMES from the central directory — no decompression, no extraction — so a
// zip dependency would be pure attack surface. The reader is strict: anything
// it cannot positively parse is rejected.
//
// SDK parity (ground truth, derived from
// packages/workflows-sdk-python/pegasus_workflows/cli/package.py):
// `pegasus-workflows package` archives every file under the workflow's
// `source_dir` at its path RELATIVE TO THE PROJECT ROOT (so entries look like
// `<source_dir>/module.py`), plus `pegasus-workflows.toml` at the zip root.
// Entry points are `dotted.module.path:Attribute` references resolved from
// the zip root: module `a.b.c` must exist as `a/b/c.py` or `a/b/c/__init__.py`.
// The parity test in workflow-artifact.test.ts pins this against the real
// stdlib layout (packages/workflows-stdlib/pegasus-workflows.toml).
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Limits & constants
// ---------------------------------------------------------------------------

/**
 * Hard cap on an executable artifact zip (Resolved decision #3 — v1-blocking).
 * Enforced twice at finalize: S3 HEAD pre-check (skip the download entirely)
 * and again on the fetched bytes.
 */
export const MAX_EXECUTABLE_ARTIFACT_BYTES = 10 * 1024 * 1024 // 10 MB

/** Maximum number of entries we will read from a central directory. */
export const MAX_ZIP_ENTRIES = 10_000

/** End of central directory record: signature + fixed size + max comment. */
const EOCD_SIGNATURE = 0x06054b50
const EOCD_MIN_SIZE = 22
const EOCD_MAX_SCAN = EOCD_MIN_SIZE + 0xffff // 65557 — fixed record + max comment

/** Zip64 end-of-central-directory locator signature (precedes the EOCD). */
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_LOCATOR_SIZE = 20

/** Central directory file header: signature + fixed size. */
const CDFH_SIGNATURE = 0x02014b50
const CDFH_MIN_SIZE = 46

/**
 * Files whose presence in an artifact means "this code declares pip
 * dependencies". v1 forbids arbitrary dependencies (stdlib + SDK only), and
 * the manifest has no dependency field — so a dependency manifest inside the
 * zip is the only smuggling vector left. Matched case-insensitively on the
 * entry basename, anywhere in the tree.
 */
const DEPENDENCY_FILE_NAMES: ReadonlySet<string> = new Set([
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'pyproject.toml',
  'pipfile',
  'pipfile.lock',
])

// ---------------------------------------------------------------------------
// sha256
// ---------------------------------------------------------------------------

/** Hex-encoded SHA-256 of a buffer. */
export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

// ---------------------------------------------------------------------------
// Zip central-directory reader (names only, no decompression)
// ---------------------------------------------------------------------------

export type ZipReadResult = { ok: true; entryNames: string[] } | { ok: false; problem: string }

/**
 * Locate the end-of-central-directory record by scanning backward through
 * the last `EOCD_MAX_SCAN` bytes. A candidate signature only counts when its
 * comment length is consistent with the buffer end — this disambiguates a
 * real EOCD from the signature bytes appearing inside a trailing comment.
 */
function findEocdOffset(buf: Buffer): number | null {
  const lowest = Math.max(0, buf.length - EOCD_MAX_SCAN)
  for (let i = buf.length - EOCD_MIN_SIZE; i >= lowest; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIGNATURE) continue
    const commentLength = buf.readUInt16LE(i + 20)
    if (i + EOCD_MIN_SIZE + commentLength === buf.length) return i
  }
  return null
}

/** True when any path segment is `..`, or the path is absolute/empty. */
function isUnsafeEntryPath(name: string): boolean {
  if (name.length === 0) return true
  // Absolute: POSIX (`/x`), Windows drive (`C:\x` / `C:/x`), or UNC (`\\x`).
  if (name.startsWith('/') || name.startsWith('\\')) return true
  if (/^[A-Za-z]:/.test(name)) return true
  // Split on both separators — the zip spec mandates `/`, but a hostile
  // writer can emit `\` and some extractors honor it.
  return name.split(/[/\\]/).some((segment) => segment === '..')
}

/**
 * Read the entry names from a zip's central directory. Strict by design:
 *
 *   - no EOCD record → not a zip
 *   - zip64 markers (EOCD locator or 0xFFFF/0xFFFFFFFF sentinel fields) → reject
 *   - more than `MAX_ZIP_ENTRIES` entries → reject
 *   - central directory walk that doesn't line up byte-for-byte → reject
 *   - any entry whose path is absolute or contains a `..` segment → reject
 *
 * Never decompresses anything; only the central directory headers are read.
 */
export function readZipEntryNames(buf: Buffer): ZipReadResult {
  if (buf.length < EOCD_MIN_SIZE) {
    return { ok: false, problem: 'artifact is not a zip file (too small)' }
  }

  const eocd = findEocdOffset(buf)
  if (eocd === null) {
    return {
      ok: false,
      problem: 'artifact is not a zip file (no end-of-central-directory record)',
    }
  }

  // Zip64: explicit locator record directly before the EOCD…
  if (
    eocd >= ZIP64_EOCD_LOCATOR_SIZE &&
    buf.readUInt32LE(eocd - ZIP64_EOCD_LOCATOR_SIZE) === ZIP64_EOCD_LOCATOR_SIGNATURE
  ) {
    return { ok: false, problem: 'zip64 archives are not supported' }
  }

  const totalEntries = buf.readUInt16LE(eocd + 10)
  const centralDirSize = buf.readUInt32LE(eocd + 12)
  const centralDirOffset = buf.readUInt32LE(eocd + 16)

  // …or sentinel values in the EOCD fields pointing at zip64 extensions.
  if (totalEntries === 0xffff || centralDirSize === 0xffffffff || centralDirOffset === 0xffffffff) {
    return { ok: false, problem: 'zip64 archives are not supported' }
  }

  if (totalEntries > MAX_ZIP_ENTRIES) {
    return {
      ok: false,
      problem: `zip has too many entries (${totalEntries} > ${MAX_ZIP_ENTRIES})`,
    }
  }

  if (centralDirOffset + centralDirSize > eocd) {
    return { ok: false, problem: 'zip central directory is corrupt (extends past its end record)' }
  }

  const entryNames: string[] = []
  let cursor = centralDirOffset
  for (let i = 0; i < totalEntries; i++) {
    if (cursor + CDFH_MIN_SIZE > eocd) {
      return { ok: false, problem: 'zip central directory is corrupt (truncated header)' }
    }
    if (buf.readUInt32LE(cursor) !== CDFH_SIGNATURE) {
      return { ok: false, problem: 'zip central directory is corrupt (bad header signature)' }
    }
    const nameLength = buf.readUInt16LE(cursor + 28)
    const extraLength = buf.readUInt16LE(cursor + 30)
    const commentLength = buf.readUInt16LE(cursor + 32)
    const nameStart = cursor + CDFH_MIN_SIZE
    if (nameStart + nameLength > eocd) {
      return { ok: false, problem: 'zip central directory is corrupt (truncated entry name)' }
    }
    const name = buf.toString('utf8', nameStart, nameStart + nameLength)
    if (isUnsafeEntryPath(name)) {
      return {
        ok: false,
        problem: `zip contains an unsafe entry path: ${JSON.stringify(name)}`,
      }
    }
    entryNames.push(name)
    cursor = nameStart + nameLength + extraLength + commentLength
  }

  return { ok: true, entryNames }
}

// ---------------------------------------------------------------------------
// Entry-point resolution
// ---------------------------------------------------------------------------

/** Valid Python module path segment (identifier). */
const MODULE_SEGMENT_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Resolve a manifest entry point (`dotted.module.path:Attribute`) against the
 * zip's entry names. The module path is rooted at the zip root, mirroring how
 * the SDK packages source: `a.b.c` resolves to `a/b/c.py` or
 * `a/b/c/__init__.py`.
 *
 * Returns the matched zip path, or `null` with no distinction of cause — the
 * caller composes the user-facing problem message.
 */
export function resolveEntryPoint(
  entryPoint: string,
  entryNames: ReadonlySet<string>,
): string | null {
  const colon = entryPoint.indexOf(':')
  if (colon <= 0 || colon === entryPoint.length - 1) return null
  const modulePath = entryPoint.slice(0, colon)
  const segments = modulePath.split('.')
  if (!segments.every((s) => MODULE_SEGMENT_REGEX.test(s))) return null

  const base = segments.join('/')
  const moduleFile = `${base}.py`
  if (entryNames.has(moduleFile)) return moduleFile
  const packageInit = `${base}/__init__.py`
  if (entryNames.has(packageInit)) return packageInit
  return null
}

// ---------------------------------------------------------------------------
// Full artifact validation
// ---------------------------------------------------------------------------

export type ArtifactValidationResult =
  | { ok: true; sha256: string; sizeBytes: number }
  | { ok: false; problems: string[] }

/**
 * Validate an artifact zip against its (already zod-validated) manifest.
 * Returns either the integrity facts to persist on the workflow row, or the
 * full list of problems for a 422 `ARTIFACT_INVALID` response.
 */
export function validateWorkflowArtifact(
  artifact: Buffer,
  manifest: { entryPoints: string[] },
): ArtifactValidationResult {
  const zip = readZipEntryNames(artifact)
  // Structural failures are terminal — entry-point/dependency checks would
  // only produce noise against an unreadable archive.
  if (!zip.ok) return { ok: false, problems: [zip.problem] }

  const problems: string[] = []
  const entryNames: ReadonlySet<string> = new Set(zip.entryNames)

  for (const name of zip.entryNames) {
    const basename = (name.split('/').pop() ?? '').toLowerCase()
    if (DEPENDENCY_FILE_NAMES.has(basename)) {
      problems.push(
        `artifact contains a dependency manifest (${name}); ` +
          'pip dependencies are not allowed — workflows may use the Python stdlib and the Pegasus SDK only',
      )
    }
  }

  for (const entryPoint of manifest.entryPoints) {
    const resolved = resolveEntryPoint(entryPoint, entryNames)
    if (resolved === null) {
      const colon = entryPoint.indexOf(':')
      const modulePath = colon > 0 ? entryPoint.slice(0, colon) : entryPoint
      const expected = modulePath.split('.').join('/')
      problems.push(
        `entry point "${entryPoint}" does not resolve to a file in the artifact ` +
          `(expected "module.path:Attribute" with ${expected}.py or ${expected}/__init__.py in the zip)`,
      )
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, sha256: sha256Hex(artifact), sizeBytes: artifact.length }
}
