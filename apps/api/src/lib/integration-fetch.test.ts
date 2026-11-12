import { describe, it, expect } from 'vitest'
import {
  FetchBlockSchema,
  fetchBlockJsonSchema,
  checkFetchBlock,
  FETCH_TEMPLATE_RE,
  resolveFetchOperation,
  substituteFetchTemplates,
  referencedConfigKeys,
  decodeFetchBody,
  extractFetchRecords,
  readNextCursor,
  resolveFetchMaxAge,
  fetchRequestHash,
  FETCH_DEFAULT_MAX_AGE_SECONDS,
  FETCH_MAX_MAX_AGE_SECONDS,
  type FetchBlock,
  type FetchOperation,
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

// ---------------------------------------------------------------------------
// Runtime half: resolving one operation out of a stored block, and filling its
// templates. Pure, so no outbound call is involved.
// ---------------------------------------------------------------------------

describe('resolveFetchOperation', () => {
  it('resolves a declared operation', () => {
    const r = resolveFetchOperation(atlasSettlements, CAPS, 'settlements')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.path).toBe('/settlement/v1/settlement')
  })

  it('reports noFetchBlock for a config that publishes none', () => {
    for (const empty of [null, undefined]) {
      const r = resolveFetchOperation(empty, CAPS, 'settlements')
      expect(r).toEqual({ ok: false, failure: { kind: 'noFetchBlock' } })
    }
  })

  it('reports unknownOperation and lists what IS declared', () => {
    const r = resolveFetchOperation(atlasSettlements, CAPS, 'documents')
    expect(r.ok).toBe(false)
    if (!r.ok && r.failure.kind === 'unknownOperation') {
      expect(r.failure.declared).toEqual(['settlements'])
    } else {
      throw new Error('expected unknownOperation')
    }
  })

  it('refuses a stored op whose name is no longer a declared capability', () => {
    // Defence in depth: the gate accepted this row when the floor still declared
    // the capability. A floor that later dropped it must stop the operation
    // running, rather than the row quietly outliving the contract.
    const r = resolveFetchOperation(atlasSettlements, [], 'settlements')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure.kind).toBe('notACapability')
  })

  it('reports malformedBlock rather than throwing on a corrupt stored block', () => {
    const r = resolveFetchOperation({ settlements: { method: 'TELEPORT' } }, CAPS, 'settlements')
    expect(r.ok).toBe(false)
    if (!r.ok && r.failure.kind === 'malformedBlock') {
      expect(r.failure.problems.length).toBeGreaterThan(0)
    } else {
      throw new Error('expected malformedBlock')
    }
  })
})

describe('substituteFetchTemplates', () => {
  const op = parse(atlasSettlements)['settlements']!

  it('fills a query param', () => {
    const r = substituteFetchTemplates(op, { settlementDate: '2026-11-06' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.query).toEqual({ settlementDate: '2026-11-06' })
  })

  it('stringifies non-string params', () => {
    const numeric = parse({
      settlements: { method: 'GET', path: '/s', query: { page: '{{n}}', flag: '{{b}}' } },
    })['settlements']!
    const r = substituteFetchTemplates(numeric, { n: 7, b: true })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.query).toEqual({ page: '7', flag: 'true' })
  })

  it('ERRORS on a missing param instead of leaking the template to the wire', () => {
    // The load-bearing case: a leftover {{settlementDate}} comes back as an
    // opaque partner 400, so the real cause would be invisible.
    const r = substituteFetchTemplates(op, {})
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.problems).toHaveLength(1)
      expect(r.problems[0]?.where).toBe('query.settlementDate')
      expect(r.problems[0]?.problem).toContain("'settlementDate' was not supplied")
    }
  })

  it('fills {{config:KEY}} from the resolved config map, and errors when unset', () => {
    const withConfig = parse({
      settlements: { method: 'GET', path: '/s', query: { vendor: '{{config:VENDOR_ID}}' } },
    })['settlements']!
    const ok = substituteFetchTemplates(withConfig, {}, { VENDOR_ID: 'A123' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.operation.query).toEqual({ vendor: 'A123' })

    const missing = substituteFetchTemplates(withConfig, {}, {})
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problems[0]?.problem).toContain('VENDOR_ID')
  })

  it('does NOT let a param be mistaken for a config, or vice versa', () => {
    const withConfig = parse({
      settlements: { method: 'GET', path: '/s', query: { v: '{{config:K}}' } },
    })['settlements']!
    // A param named K must not satisfy {{config:K}}.
    const r = substituteFetchTemplates(withConfig, { K: 'from-params' }, {})
    expect(r.ok).toBe(false)
  })

  it('substitutes in the path', () => {
    const pathOp = parse({
      settlements: { method: 'GET', path: '/settlement/v1/{{id}}' },
    })['settlements']!
    const r = substituteFetchTemplates(pathOp, { id: 'abc' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.path).toBe('/settlement/v1/abc')
  })

  it.each([
    ['a path segment', 'a/b'],
    ['a query string', 'a?x=1'],
    ['a fragment', 'a#frag'],
  ])('refuses %s injected into a PATH param', (_label, value) => {
    // A descriptor exists to constrain WHICH endpoint is called. Allowing this
    // would turn it back into an arbitrary-URL builder.
    const pathOp = parse({
      settlements: { method: 'GET', path: '/settlement/v1/{{id}}' },
    })['settlements']!
    const r = substituteFetchTemplates(pathOp, { id: value })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0]?.problem).toContain('change which endpoint is called')
  })

  it('ALLOWS those characters in a query value — encoded downstream, shape unchanged', () => {
    const r = substituteFetchTemplates(op, { settlementDate: 'a/b?c#d' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.query).toEqual({ settlementDate: 'a/b?c#d' })
  })

  it('does not recursively expand a substituted value that looks like a template', () => {
    const r = substituteFetchTemplates(op, { settlementDate: '{{config:SECRETISH}}' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation.query).toEqual({ settlementDate: '{{config:SECRETISH}}' })
  })

  it('fills a nested POST body and preserves non-string leaves', () => {
    const bodyOp = parse({
      settlements: {
        method: 'POST',
        path: '/s',
        body: { criteria: [{ date: '{{d}}', limit: 50, deep: { note: 'x{{d}}y' } }], flag: true },
      },
    })['settlements']!
    const r = substituteFetchTemplates(bodyOp, { d: '2026-11-06' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.operation.body).toEqual({
        criteria: [{ date: '2026-11-06', limit: 50, deep: { note: 'x2026-11-06y' } }],
        flag: true,
      })
    }
  })

  it('fills headers but leaves secretHeaders alone (they are key names)', () => {
    const hOp = parse({
      settlements: {
        method: 'GET',
        path: '/s',
        headers: { 'X-Caller': '{{who}}' },
        secretHeaders: { 'Ocp-Apim-Subscription-Key': 'ATLAS_SUB_KEY' },
      },
    })['settlements']!
    const r = substituteFetchTemplates(hOp, { who: 'pegasus' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.operation.headers).toEqual({ 'X-Caller': 'pegasus' })
      expect(r.operation.secretHeaders).toEqual({
        'Ocp-Apim-Subscription-Key': 'ATLAS_SUB_KEY',
      })
    }
  })

  it('reports EVERY unfillable template, not just the first', () => {
    const multi = parse({
      settlements: { method: 'GET', path: '/s/{{a}}', query: { x: '{{b}}', y: '{{c}}' } },
    })['settlements']!
    const r = substituteFetchTemplates(multi, {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems.map((p) => p.where)).toEqual(['path', 'query.x', 'query.y'])
  })

  it('leaves an operation with no templates untouched', () => {
    const plain = parse({
      settlements: { method: 'GET', path: '/s', query: { format: 'json' } },
    })['settlements']!
    const r = substituteFetchTemplates(plain, {})
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.operation).toEqual(plain)
  })
})

describe('referencedConfigKeys', () => {
  it('finds config keys across path, query, headers and body — deduped and sorted', () => {
    const op = parse({
      settlements: {
        method: 'POST',
        path: '/s/{{config:B}}',
        query: { v: '{{config:A}}', w: '{{plain}}' },
        headers: { 'X-H': '{{config:A}}' },
        body: { deep: [{ k: '{{config:C}}' }] },
      },
    })['settlements']!
    expect(referencedConfigKeys(op)).toEqual(['A', 'B', 'C'])
  })

  it('returns none for a descriptor with only plain params', () => {
    expect(referencedConfigKeys(parse(atlasSettlements)['settlements']!)).toEqual([])
  })

  it('ignores secretHeaders — those are key names, not config templates', () => {
    const op = parse({
      settlements: {
        method: 'GET',
        path: '/s',
        secretHeaders: { 'Ocp-Apim-Subscription-Key': 'ATLAS_SUB_KEY' },
      },
    })['settlements']!
    expect(referencedConfigKeys(op)).toEqual([])
  })
})

describe('decodeFetchBody', () => {
  it('passes the body through when decode is absent or "none"', () => {
    for (const d of [undefined, 'none' as const]) {
      const r = decodeFetchBody({ a: 1 }, d)
      expect(r).toEqual({ ok: true, body: { a: 1 } })
    }
  })

  it('parses a double-encoded body for decode "jsonString"', () => {
    // Atlas's settlement response is a JSON STRING containing JSON.
    const r = decodeFetchBody(JSON.stringify({ agentSettlements: [] }), 'jsonString')
    expect(r).toEqual({ ok: true, body: { agentSettlements: [] } })
  })

  it('passes an OBJECT through under "jsonString" rather than failing', () => {
    // A partner that stops double-encoding is a FIX; failing the call would turn
    // their improvement into our outage.
    const r = decodeFetchBody({ agentSettlements: [] }, 'jsonString')
    expect(r).toEqual({ ok: true, body: { agentSettlements: [] } })
  })

  it('reports a problem when the string is not valid JSON', () => {
    const r = decodeFetchBody('<html>nope</html>', 'jsonString')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problem).toContain('not valid JSON')
  })
})

describe('extractFetchRecords', () => {
  it('treats the whole body as ONE record when recordsPath is absent', () => {
    expect(extractFetchRecords({ a: 1 }, undefined)).toEqual({ ok: true, records: [{ a: 1 }] })
  })

  it('yields no records for an empty body with no recordsPath', () => {
    expect(extractFetchRecords(null, undefined)).toEqual({ ok: true, records: [] })
  })

  it('reads a nested dot-path', () => {
    const body = { outer: { inner: [1, 2, 3] } }
    expect(extractFetchRecords(body, 'outer.inner')).toEqual({ ok: true, records: [1, 2, 3] })
  })

  it('returns EMPTY (not an error) when the path is absent', () => {
    // An empty period is a legitimate answer — Atlas QA returns exactly that for
    // every settlementDate tried. Failing here would make "nothing this week"
    // indistinguishable from a broken descriptor.
    expect(extractFetchRecords({ other: 1 }, 'agentSettlements')).toEqual({
      ok: true,
      records: [],
    })
    expect(extractFetchRecords({ agentSettlements: null }, 'agentSettlements')).toEqual({
      ok: true,
      records: [],
    })
  })

  it('FAILS when the path resolves to a non-array — that is a descriptor bug', () => {
    const r = extractFetchRecords({ agentSettlements: { not: 'an array' } }, 'agentSettlements')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problem).toContain('not an array')
  })

  it('does not walk through a non-object hop', () => {
    expect(extractFetchRecords({ a: 'string' }, 'a.b')).toEqual({ ok: true, records: [] })
  })
})

describe('readNextCursor', () => {
  it('reads a string cursor', () => {
    expect(readNextCursor({ meta: { next: 'abc' } }, 'meta.next')).toBe('abc')
  })

  it('stringifies a numeric cursor', () => {
    expect(readNextCursor({ next: 7 }, 'next')).toBe('7')
  })

  it.each([
    ['absent', {}],
    ['null', { next: null }],
    ['an empty string', { next: '' }],
    ['an object', { next: { a: 1 } }],
  ])('returns null (stop paging) for %s', (_label, body) => {
    expect(readNextCursor(body, 'next')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Freshness (C4): maxAgeSeconds on the descriptor, maxAge/refresh at the call
// site, and the precedence between them.
// ---------------------------------------------------------------------------

describe('maxAgeSeconds — the per-capability TTL override', () => {
  it('is optional: a descriptor without it is still valid', () => {
    expect(FetchBlockSchema.safeParse(atlasSettlements).success).toBe(true)
  })

  it('accepts a declared override', () => {
    const r = FetchBlockSchema.safeParse({
      settlements: { ...atlasSettlements['settlements'], maxAgeSeconds: 900 },
    })
    expect(r.success).toBe(true)
  })

  it('accepts 0 — "never serve this from cache" is a legitimate declaration', () => {
    const r = FetchBlockSchema.safeParse({
      settlements: { ...atlasSettlements['settlements'], maxAgeSeconds: 0 },
    })
    expect(r.success).toBe(true)
  })

  it.each([
    ['negative', -1],
    ['fractional', 1.5],
    ['over the ceiling', FETCH_MAX_MAX_AGE_SECONDS + 1],
  ])('refuses a %s maxAgeSeconds at publish', (_label, value) => {
    const r = FetchBlockSchema.safeParse({
      settlements: { ...atlasSettlements['settlements'], maxAgeSeconds: value },
    })
    expect(r.success).toBe(false)
  })

  it('appears in the published JSON Schema, so an authoring agent can discover it', () => {
    expect(JSON.stringify(fetchBlockJsonSchema())).toContain('maxAgeSeconds')
  })
})

describe('resolveFetchMaxAge — precedence', () => {
  it('defaults to the platform TTL when neither side says anything', () => {
    expect(resolveFetchMaxAge(undefined, undefined)).toBe(FETCH_DEFAULT_MAX_AGE_SECONDS)
  })

  it('is 60s by default — short enough that serving it is defensible (C4)', () => {
    expect(FETCH_DEFAULT_MAX_AGE_SECONDS).toBe(60)
  })

  it('uses the descriptor override when the caller is silent', () => {
    expect(resolveFetchMaxAge(undefined, 900)).toBe(900)
  })

  it('lets the CALL SITE win over the descriptor — freshness is explicit at the call site', () => {
    expect(resolveFetchMaxAge(5, 900)).toBe(5)
  })

  it('honours an explicit call-site 0 over a descriptor override', () => {
    // The trap this pins: `callSite || descriptor` would treat 0 as "unset" and
    // silently serve a 15-minute-old row to a caller who asked for live data.
    expect(resolveFetchMaxAge(0, 900)).toBe(0)
  })

  it('honours an explicit descriptor 0 over the platform default', () => {
    expect(resolveFetchMaxAge(undefined, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// fetchRequestHash — the cache key. What it includes is the whole correctness
// argument: anything that changes the RECORDS but not the hash would be served
// stale for a full TTL.
// ---------------------------------------------------------------------------

describe('fetchRequestHash', () => {
  const op: FetchOperation = {
    method: 'GET',
    path: '/settlement/v1/settlement',
    query: { settlementDate: '2026-11-06' },
    decode: 'jsonString',
    recordsPath: 'agentSettlements',
    page: { style: 'none' },
  }
  const env = { group: 'global', overrides: { baseUrlConfig: 'BASE_URL' } }

  it('is a lowercase sha256 hex digest', () => {
    expect(fetchRequestHash(op, env)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across calls', () => {
    expect(fetchRequestHash(op, env)).toBe(fetchRequestHash(op, env))
  })

  it('ignores key ORDER — the same request written two ways is one cache entry', () => {
    const reordered: FetchOperation = {
      recordsPath: 'agentSettlements',
      page: { style: 'none' },
      decode: 'jsonString',
      query: { settlementDate: '2026-11-06' },
      path: '/settlement/v1/settlement',
      method: 'GET',
    }
    expect(fetchRequestHash(reordered, env)).toBe(fetchRequestHash(op, env))
  })

  it.each([
    ['the filled path', { path: '/settlement/v1/other' }],
    ['a filled query value', { query: { settlementDate: '2026-12-06' } }],
    ['the method', { method: 'POST' as const }],
    ['a literal header', { headers: { 'X-Thing': 'a' } }],
    ['a secret header KEY NAME', { secretHeaders: { 'Ocp-Apim-Subscription-Key': 'K' } }],
    ['the body', { method: 'POST' as const, body: { a: 1 } }],
  ])('changes when %s changes', (_label, patch) => {
    expect(fetchRequestHash({ ...op, ...patch }, env)).not.toBe(fetchRequestHash(op, env))
  })

  it.each([
    ['decode', { decode: 'none' as const }],
    ['recordsPath', { recordsPath: 'documents' }],
    ['page', { page: { style: 'pageNumber' as const, param: 'page' } }],
  ])('changes when %s changes — these SHAPE the records, not just the request', (_label, patch) => {
    // The bug this pins: hashing only the caller's params would let a republish
    // that moves `recordsPath` keep serving rows of the OLD shape for a full TTL.
    expect(fetchRequestHash({ ...op, ...patch }, env)).not.toBe(fetchRequestHash(op, env))
  })

  it('changes when the config GROUP changes — a different group is different credentials', () => {
    expect(fetchRequestHash(op, { ...env, group: 'atlas' })).not.toBe(fetchRequestHash(op, env))
  })

  it('changes when a config-key override changes', () => {
    expect(
      fetchRequestHash(op, { ...env, overrides: { baseUrlConfig: 'ATLAS_BASE_URL' } }),
    ).not.toBe(fetchRequestHash(op, env))
  })

  it('does not leak the request into the digest — only the hash is storable', () => {
    const hash = fetchRequestHash(op, env)
    expect(hash).not.toContain('settlement')
    expect(hash).not.toContain('2026')
  })
})
