import { describe, it, expect } from 'vitest'
import {
  FetchBlockSchema,
  fetchBlockJsonSchema,
  checkFetchBlock,
  FETCH_TEMPLATE_RE,
  type FetchBlock,
} from './integration-fetch'

/** The Atlas settlements descriptor, as far as it can be written today. */
const atlasSettlements: FetchBlock = {
  settlements: {
    method: 'GET',
    path: '/settlement/v1/settlement',
    query: { settlementDate: '{{settlementDate}}' },
    decode: 'jsonString',
    recordsPath: 'agentSettlements',
    page: { style: 'none' },
  },
}

const CAPS = ['settlements'] as const

function parse(block: unknown): FetchBlock {
  const r = FetchBlockSchema.safeParse(block)
  if (!r.success) throw new Error(`fixture failed shape validation: ${r.error.message}`)
  return r.data
}

describe('FetchBlockSchema — shape', () => {
  it('accepts the Atlas settlements descriptor', () => {
    expect(FetchBlockSchema.safeParse(atlasSettlements).success).toBe(true)
  })

  it('accepts a minimal operation (method + path only)', () => {
    expect(FetchBlockSchema.safeParse({ settlements: { method: 'GET', path: '/x' } }).success).toBe(
      true,
    )
  })

  it.each([
    ['an unknown page style', { style: 'offset' }],
    ['a page style of the wrong type', { style: 2 }],
  ])('rejects %s', (_label, page) => {
    expect(
      FetchBlockSchema.safeParse({ settlements: { method: 'GET', path: '/x', page } }).success,
    ).toBe(false)
  })

  it('rejects an unknown decode', () => {
    expect(
      FetchBlockSchema.safeParse({
        settlements: { method: 'GET', path: '/x', decode: 'base64' },
      }).success,
    ).toBe(false)
  })

  it('rejects a mutating method — a fetch is a read', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      expect(FetchBlockSchema.safeParse({ settlements: { method, path: '/x' } }).success).toBe(
        false,
      )
    }
  })

  it('rejects unknown keys on an operation, so a typo is never silently ignored', () => {
    expect(
      FetchBlockSchema.safeParse({
        settlements: { method: 'GET', path: '/x', recordPath: 'Settlements' },
      }).success,
    ).toBe(false)
  })

  it('rejects an operation name that is not a capability id', () => {
    for (const name of ['Settlements', 'settle-ments', '1settlements', '']) {
      expect(FetchBlockSchema.safeParse({ [name]: { method: 'GET', path: '/x' } }).success).toBe(
        false,
      )
    }
  })

  it('publishes a JSON Schema for the discovery endpoint', () => {
    const schema = fetchBlockJsonSchema() as Record<string, unknown>
    expect(schema).toBeTypeOf('object')
    // The published schema must carry the authoring semantics, not just types:
    // an authoring agent reads this endpoint, never this file.
    expect(JSON.stringify(schema)).toContain('double-encoded')
  })
})

describe('FETCH_TEMPLATE_RE', () => {
  it.each(['{{settlementDate}}', '{{config:ATLAS_VENDOR_ID}}', '{{_x9}}'])('permits %s', (s) =>
    expect(FETCH_TEMPLATE_RE.test(s)).toBe(true),
  )

  it.each([
    '{{secret:ATLAS_KEY}}',
    '{{ settlementDate }}',
    '{{a.b}}',
    '{{#if x}}',
    '{{9x}}',
    '{{}}',
  ])('refuses %s', (s) => expect(FETCH_TEMPLATE_RE.test(s)).toBe(false))
})

describe('checkFetchBlock — capability names', () => {
  it('passes the Atlas descriptor against a floor declaring settlements', () => {
    expect(checkFetchBlock(atlasSettlements, CAPS)).toEqual([])
  })

  it('refuses an operation the floor does not declare', () => {
    const problems = checkFetchBlock(
      parse({ documents: { method: 'GET', path: '/documents/v1/list' } }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatchObject({ where: 'documents' })
    // The message must name what IS declared — otherwise the author has to go
    // read platform source to find out.
    expect(problems[0]?.problem).toContain('settlements')
  })

  it('refuses every operation when the floor declares no capabilities', () => {
    const problems = checkFetchBlock(parse(atlasSettlements), undefined)
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('declares no capabilities')
  })
})

describe('checkFetchBlock — secrets must never be templated', () => {
  it('refuses {{secret:…}} in a query value, naming secretHeaders as the way', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: {
          method: 'GET',
          path: '/s',
          query: { key: '{{secret:ATLAS_SUB_KEY}}' },
        },
      }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.query.key')
    expect(problems[0]?.problem).toContain('secretHeaders')
  })

  it('refuses {{secret:…}} in the path', () => {
    const problems = checkFetchBlock(
      parse({ settlements: { method: 'GET', path: '/s/{{secret:K}}' } }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.path')
  })

  it('refuses {{secret:…}} nested inside a POST body', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: {
          method: 'POST',
          path: '/s',
          body: { criteria: [{ token: '{{secret:K}}' }] },
        },
      }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.body.criteria[0].token')
  })

  it('does NOT scan secretHeaders values — they are key names, not templates', () => {
    expect(
      checkFetchBlock(
        parse({
          settlements: {
            method: 'GET',
            path: '/s',
            secretHeaders: { 'Ocp-Apim-Subscription-Key': 'ATLAS_SUB_KEY' },
          },
        }),
        CAPS,
      ),
    ).toEqual([])
  })
})

describe('checkFetchBlock — the DSL stays bounded', () => {
  it.each([
    ['a conditional', '{{#if vendor}}'],
    ['a dotted path', '{{a.b}}'],
    ['padded whitespace', '{{ settlementDate }}'],
  ])('refuses %s in a query value', (_label, template) => {
    const problems = checkFetchBlock(
      parse({ settlements: { method: 'GET', path: '/s', query: { q: template } } }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('not an expression language')
  })

  it('permits a literal query value with no template at all', () => {
    expect(
      checkFetchBlock(
        parse({ settlements: { method: 'GET', path: '/s', query: { format: 'json' } } }),
        CAPS,
      ),
    ).toEqual([])
  })

  it('permits {{config:KEY}}', () => {
    expect(
      checkFetchBlock(
        parse({
          settlements: { method: 'GET', path: '/s', query: { vendor: '{{config:VENDOR_ID}}' } },
        }),
        CAPS,
      ),
    ).toEqual([])
  })
})

describe('checkFetchBlock — reserved headers', () => {
  it.each(['Authorization', 'authorization', 'Host', 'Content-Type'])(
    'refuses %s as a literal header',
    (headerName) => {
      const problems = checkFetchBlock(
        parse({ settlements: { method: 'GET', path: '/s', headers: { [headerName]: 'x' } } }),
        CAPS,
      )
      expect(problems).toHaveLength(1)
      expect(problems[0]?.problem).toContain('reserved')
    },
  )

  it('refuses a reserved name in secretHeaders too', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: { method: 'GET', path: '/s', secretHeaders: { Authorization: 'API_KEY' } },
      }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.problem).toContain('reserved')
  })
})

describe('checkFetchBlock — paging coherence', () => {
  it('accepts a complete pageNumber descriptor', () => {
    expect(
      checkFetchBlock(
        parse({
          settlements: {
            method: 'GET',
            path: '/s',
            page: { style: 'pageNumber', param: 'page', startAt: 1, maxPages: 20 },
          },
        }),
        CAPS,
      ),
    ).toEqual([])
  })

  it('accepts a complete cursor descriptor', () => {
    expect(
      checkFetchBlock(
        parse({
          settlements: {
            method: 'GET',
            path: '/s',
            page: { style: 'cursor', param: 'next', cursorPath: 'meta.nextCursor' },
          },
        }),
        CAPS,
      ),
    ).toEqual([])
  })

  it('refuses a paging style with no param — it would silently fetch one page', () => {
    const problems = checkFetchBlock(
      parse({ settlements: { method: 'GET', path: '/s', page: { style: 'pageNumber' } } }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.page.param')
  })

  it('refuses cursor style with no cursorPath', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: { method: 'GET', path: '/s', page: { style: 'cursor', param: 'next' } },
      }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.page.cursorPath')
  })

  it('refuses paging fields that style "none" cannot use', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: { method: 'GET', path: '/s', page: { style: 'none', param: 'page' } },
      }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.page.param')
  })

  it('refuses cursorPath under pageNumber, and startAt under cursor', () => {
    expect(
      checkFetchBlock(
        parse({
          settlements: {
            method: 'GET',
            path: '/s',
            page: { style: 'pageNumber', param: 'p', cursorPath: 'x' },
          },
        }),
        CAPS,
      ),
    ).toHaveLength(1)
    expect(
      checkFetchBlock(
        parse({
          settlements: {
            method: 'GET',
            path: '/s',
            page: { style: 'cursor', param: 'p', cursorPath: 'x', startAt: 1 },
          },
        }),
        CAPS,
      ),
    ).toHaveLength(1)
  })
})

describe('checkFetchBlock — method/body coherence', () => {
  it('refuses a body on a GET', () => {
    const problems = checkFetchBlock(
      parse({ settlements: { method: 'GET', path: '/s', body: { a: 1 } } }),
      CAPS,
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]?.where).toBe('settlements.body')
  })

  it('permits a body on a POST read', () => {
    expect(
      checkFetchBlock(
        parse({ settlements: { method: 'POST', path: '/s', body: { from: '{{since}}' } } }),
        CAPS,
      ),
    ).toEqual([])
  })
})

describe('checkFetchBlock — reports every problem, not just the first', () => {
  it('accumulates across operations and fields', () => {
    const problems = checkFetchBlock(
      parse({
        settlements: {
          method: 'GET',
          path: '/s/{{secret:K}}',
          headers: { Authorization: 'x' },
          page: { style: 'cursor' },
        },
        documents: { method: 'GET', path: '/d' },
      }),
      CAPS,
    )
    // unknown capability + templated secret + reserved header + 2 paging gaps
    expect(problems.length).toBe(5)
    expect(new Set(problems.map((p) => p.where)).size).toBe(5)
  })
})
