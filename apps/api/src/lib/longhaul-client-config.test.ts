// ---------------------------------------------------------------------------
// Unit tests for apps/api/src/lib/longhaul-client-config.ts
//
// Asserts that getLonghaulClientConfig() returns the correct per-client
// defaults transcribed from the legacy config files, and that missing /
// unknown values throw rather than silently falling back.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest'
import { getLonghaulClientConfig } from './longhaul-client-config'

const KEY = 'LONGHAUL_CLIENT'

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env[KEY]
  if (value === undefined) delete process.env[KEY]
  else process.env[KEY] = value
  try {
    fn()
  } finally {
    if (prev === undefined) delete process.env[KEY]
    else process.env[KEY] = prev
  }
}

afterEach(() => {
  delete process.env[KEY]
})

describe('getLonghaulClientConfig', () => {
  it('returns NWI defaults when LONGHAUL_CLIENT=nwi', () => {
    withEnv('nwi', () => {
      const cfg = getLonghaulClientConfig()
      expect(cfg.importExportTypes).toEqual(['H', 'HA', 'M', 'A', 'SS'])
      expect(cfg.moveTypesWhere).toBe('1=1')
      expect(cfg.dispatcherQuery).toBe('managed_by_id = 2021')
    })
  })

  it('returns QMM defaults when LONGHAUL_CLIENT=qmm', () => {
    withEnv('qmm', () => {
      const cfg = getLonghaulClientConfig()
      expect(cfg.importExportTypes).toEqual(['N', 'S', 'C', 'U', 'M'])
      expect(cfg.moveTypesWhere).toBe("move_type in ('C','S','N','M','U')")
      expect(cfg.dispatcherQuery).toBe("roles like ('%cpd%')")
    })
  })

  it('normalises mixed-case values', () => {
    withEnv('NWI', () => {
      const cfg = getLonghaulClientConfig()
      expect(cfg.importExportTypes).toEqual(['H', 'HA', 'M', 'A', 'SS'])
    })
    withEnv('  QMM  ', () => {
      const cfg = getLonghaulClientConfig()
      expect(cfg.moveTypesWhere).toBe("move_type in ('C','S','N','M','U')")
    })
  })

  it('throws when LONGHAUL_CLIENT is unset', () => {
    withEnv(undefined, () => {
      expect(() => getLonghaulClientConfig()).toThrow(/LONGHAUL_CLIENT/)
    })
  })

  it('throws when LONGHAUL_CLIENT is empty string', () => {
    withEnv('', () => {
      expect(() => getLonghaulClientConfig()).toThrow(/LONGHAUL_CLIENT/)
    })
  })

  it('throws when LONGHAUL_CLIENT names an unknown client', () => {
    withEnv('acme', () => {
      expect(() => getLonghaulClientConfig()).toThrow(/Unknown LONGHAUL_CLIENT/)
    })
  })

  it('returned config is independent per call (mutation isolation)', () => {
    withEnv('nwi', () => {
      const a = getLonghaulClientConfig()
      a.importExportTypes.push('X')
      const b = getLonghaulClientConfig()
      expect(b.importExportTypes).not.toContain('X')
    })
  })
})
