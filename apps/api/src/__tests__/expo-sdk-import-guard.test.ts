// ---------------------------------------------------------------------------
// Static guard: `expo-server-sdk` is ESM-only. Only PushForwardFunction is
// bundled as ESM (packages/infra api-stack.ts); pulled into the CommonJS API
// Lambda bundle it throws during INIT and takes the whole API down — the #594
// failure mode, which synth and deploy both pass. So the SDK may be reached
// only along lib/push-expo ← lib/push-deliver ← lambda-push-forward. An API
// path that wants a push delivered now kicks the forwarder instead
// (lib/push-forward-invoke).
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative, sep } from 'path'

const srcDir = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules' && e.name !== 'dist') {
        out.push(...sourceFiles(abs))
      }
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      out.push(abs)
    }
  }
  return out
}

/** Files (relative to src/) that import the given module specifier pattern. */
function importersOf(pattern: RegExp): string[] {
  return sourceFiles(srcDir)
    .filter((f) => pattern.test(readFileSync(f, 'utf-8')))
    .map((f) => relative(srcDir, f).split(sep).join('/'))
    .sort()
}

describe('expo-server-sdk stays out of the API Lambda bundle', () => {
  it('only lib/push-expo imports expo-server-sdk', () => {
    expect(importersOf(/from ['"]expo-server-sdk['"]/)).toEqual(['lib/push-expo.ts'])
  })

  it('only lib/push-deliver imports lib/push-expo', () => {
    expect(importersOf(/from ['"][./]+(lib\/)?push-expo['"]/)).toEqual(['lib/push-deliver.ts'])
  })

  it('only the forwarder Lambda imports lib/push-deliver', () => {
    expect(importersOf(/from ['"][./]+(lib\/)?push-deliver['"]/)).toEqual([
      'lambda-push-forward.ts',
    ])
  })
})
