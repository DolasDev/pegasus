// ---------------------------------------------------------------------------
// loadPolicies must skip comment-only placeholder files.
//
// AVP's CreatePolicy rejects an empty/comment-only statement with
// `ValidationException: Invalid input`, which broke the SyncAvpPolicies
// Trigger on the first real deploy of the legacy-role catalog (the stub
// persona files for billing_manager, operations_admin, etc. carry no
// permit/forbid clause yet — they declare the group via comment only so the
// drift detector passes). Filtering here keeps the AVP and cedar-wasm
// backends in sync and lets us land new persona groups without authoring
// their permissions yet.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadPolicies } from '../load'

const POLICIES_DIR = join(__dirname, '..', 'policies')

function allCedarFiles(): string[] {
  const out: string[] = []
  const visit = (dir: string, prefix = ''): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(full, prefix ? `${prefix}/${entry.name}` : entry.name)
      } else if (entry.isFile() && entry.name.endsWith('.cedar')) {
        out.push(prefix ? `${prefix}/${entry.name}` : entry.name)
      }
    }
  }
  visit(POLICIES_DIR)
  return out
}

describe('Cedar policy files — ASCII-only invariant', () => {
  // AVP's CreatePolicy returned `ValidationException: Invalid input` on the
  // first reconciliation deploy because 20-viewer.cedar contained `--` and
  // `...` typographic characters (U+2014, U+2026) in its comment block.
  // Strict-mode validation rejects non-ASCII bytes in the policy statement.
  // This test pins every `.cedar` file to 7-bit ASCII so the failure can't
  // recur via comment prose.
  it('every .cedar file is pure 7-bit ASCII', () => {
    const offenders: Array<{ file: string; line: number; preview: string }> = []
    for (const file of allCedarFiles()) {
      const body = readFileSync(join(POLICIES_DIR, file), 'utf8')
      body.split('\n').forEach((line, i) => {
        // eslint-disable-next-line no-control-regex
        if (/[^\x00-\x7F]/.test(line)) {
          offenders.push({ file, line: i + 1, preview: line.trim().slice(0, 80) })
        }
      })
    }
    expect(
      offenders,
      `non-ASCII bytes found:\n${offenders.map((o) => `  ${o.file}:${o.line}  ${o.preview}`).join('\n')}`,
    ).toEqual([])
  })
})

describe('loadPolicies — placeholder filtering', () => {
  it('skips files with no permit/forbid clause (comment-only placeholders)', () => {
    const onDisk = allCedarFiles()
    const loaded = loadPolicies().map((p) => p.name)

    // Sanity: drift detector forces every persona name to have a file on disk.
    expect(onDisk.length).toBeGreaterThan(0)

    // Files we expect to be loaded (have a permit/forbid clause).
    const placeholders = onDisk.filter((name) => {
      const body = readFileSync(join(POLICIES_DIR, name), 'utf8')
      const stripped = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      return !/\b(permit|forbid)\s*\(/.test(stripped)
    })
    const expected = onDisk.filter((n) => !placeholders.includes(n)).sort()

    expect(loaded.slice().sort()).toEqual(expected)

    // Every loaded statement must contain a permit or forbid keyword outside
    // comments — the property the AVP CreatePolicy contract relies on.
    for (const p of loadPolicies()) {
      const stripped = p.statement.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(stripped, `loaded policy ${p.name} must declare a clause`).toMatch(
        /\b(permit|forbid)\s*\(/,
      )
    }
  })
})
