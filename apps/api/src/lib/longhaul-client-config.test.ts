// ---------------------------------------------------------------------------
// Unit tests for apps/api/src/lib/longhaul-client-config.ts
//
// Asserts that getLonghaulClientConfig() returns the correct per-client
// defaults transcribed from the legacy config files, and that missing /
// unknown values throw rather than silently falling back.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from 'vitest'
import { getLonghaulClientConfig, getLonghaulClientConfigFor } from './longhaul-client-config'

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
      expect(cfg.dispatcherQuery).toBe("(managed_by_id = 2021 OR roles like '%LO%')")
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

  it('normalizes mixed-case values', () => {
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
      expect(() => getLonghaulClientConfig()).toThrow(/Unknown longhaul client/)
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

describe('getLonghaulClientConfigFor', () => {
  it('resolves an explicit client without touching process.env', () => {
    const nwi = getLonghaulClientConfigFor('nwi')
    expect(nwi.dispatcherQuery).toBe("(managed_by_id = 2021 OR roles like '%LO%')")
    const qmm = getLonghaulClientConfigFor('qmm')
    expect(qmm.dispatcherQuery).toBe("roles like ('%cpd%')")
  })

  it('normalizes mixed-case / padded values', () => {
    expect(getLonghaulClientConfigFor('  NWI ').moveTypesWhere).toBe('1=1')
  })

  it('throws on an unknown client', () => {
    expect(() => getLonghaulClientConfigFor('acme')).toThrow(/Unknown longhaul client/)
  })

  it('returns an independent copy per call (mutation isolation)', () => {
    const a = getLonghaulClientConfigFor('nwi')
    a.importExportTypes.push('X')
    expect(getLonghaulClientConfigFor('nwi').importExportTypes).not.toContain('X')
  })
})
