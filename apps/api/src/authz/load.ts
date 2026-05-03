// ---------------------------------------------------------------------------
// Cedar policy & schema loader.
//
// One reader so the offline (wasm) backend in `lib/authz.ts` and the AVP
// provisioning code in `lib/authz-provision.ts` see the same files in the
// same order.
// ---------------------------------------------------------------------------

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const AUTHZ_DIR = join(__dirname)
const POLICIES_DIR = join(AUTHZ_DIR, 'policies')
const SCHEMA_PATH = join(AUTHZ_DIR, 'cedar.schema.json')

export interface PolicyFile {
  /** Path-prefixed file name (e.g. `30-personas/dispatcher.cedar`) — sortable. */
  readonly name: string
  /** Raw Cedar source. */
  readonly statement: string
}

let _cached: readonly PolicyFile[] | null = null

/**
 * Returns every `.cedar` file under `apps/api/src/authz/policies/`, sorted
 * by name so callers see a stable order.
 */
export function loadPolicies(): readonly PolicyFile[] {
  if (_cached !== null) return _cached

  const out: PolicyFile[] = []
  const visit = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full, prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.cedar')) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name
        out.push({ name, statement: readFileSync(full, 'utf8') })
      }
    }
  }
  visit(POLICIES_DIR)
  out.sort((a, b) => a.name.localeCompare(b.name))
  _cached = Object.freeze(out)
  return _cached
}

/** Concatenated policy text — what cedar-wasm wants for `staticPolicies`. */
export function loadPolicyText(): string {
  return loadPolicies()
    .map((p) => p.statement)
    .join('\n\n')
}

/** Returns the raw Cedar JSON schema as a string (for AVP PutSchema). */
export function loadSchemaJson(): string {
  return readFileSync(SCHEMA_PATH, 'utf8')
}

/** Parsed Cedar schema — what cedar-wasm wants for the `schema` call field. */
let _cachedSchema: unknown = null
export function loadSchema(): unknown {
  if (_cachedSchema === null) {
    _cachedSchema = JSON.parse(loadSchemaJson())
  }
  return _cachedSchema
}
