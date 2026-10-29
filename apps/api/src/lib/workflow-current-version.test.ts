import { describe, it, expect } from 'vitest'
import { currentWorkflowIds } from './workflow-current-version'

const row = (id: string, tenantId: string, name: string, version: string, day = 1) => ({
  id,
  tenantId,
  name,
  version,
  createdAt: new Date(Date.UTC(2026, 0, day)),
})

describe('currentWorkflowIds', () => {
  it('keeps only the newest semver per (owner, name)', () => {
    const rows = [
      row('w040', 'platform', 'weichert', '0.4.0', 1),
      row('w0100', 'platform', 'weichert', '0.10.0', 2), // numeric, not lexical
      row('w063', 'platform', 'weichert', '0.6.3', 3), // uploaded later, still older
    ]
    expect(currentWorkflowIds(rows, [])).toEqual(new Set(['w0100']))
  })

  it("treats a tenant's fork and the GLOBAL original as separate workflows", () => {
    const rows = [
      row('global', 'platform', 'weichert', '0.7.0'),
      row('fork', 'nw', 'weichert', '0.4.0'),
    ]
    expect(currentWorkflowIds(rows, [])).toEqual(new Set(['global', 'fork']))
  })

  it('breaks an identical-version tie by upload time', () => {
    const rows = [row('first', 't', 'a', '1.0.0', 1), row('second', 't', 'a', '1.0.0', 2)]
    expect(currentWorkflowIds(rows, [])).toEqual(new Set(['second']))
  })

  it('keeps an older version an enabled trigger still runs', () => {
    const rows = [row('old', 't', 'a', '1.0.0'), row('new', 't', 'a', '2.0.0')]
    expect(currentWorkflowIds(rows, ['old'])).toEqual(new Set(['old', 'new']))
  })

  it('ignores trigger targets that are not among the visible rows', () => {
    expect(currentWorkflowIds([row('a', 't', 'a', '1.0.0')], ['retired'])).toEqual(new Set(['a']))
  })
})
