/**
 * Conformance — **the published catalog**.
 *
 * Four things, in the order they matter.
 *
 * 1. **Staleness.** The emitted artifacts are regenerated in memory and compared with what is
 *    committed, exactly as `glossary-staleness.test.ts` does for the glossary. A generated file
 *    that nothing compares against is a file that will be wrong the first time somebody edits a
 *    type and forgets the command.
 * 2. **Structure.** Every `$ref` resolves, every declared member has a record schema on both faces,
 *    every object is closed, and every field [SD §1.1] forbids is emitted as `false`. These are the
 *    properties [catalog §4.2] claims of the output, checked rather than asserted in prose.
 * 3. **Round trip.** Real records — built here with the published types, so the compiler vouches
 *    for them — are validated against the emitted schema, and tampered copies are rejected. A
 *    schema nobody has ever validated against is the false green [`plans`] warns about: it can be
 *    syntactically perfect and admit nothing.
 * 4. **The decision document's numbers.** [catalog §1.1] and [catalog §5] state counts, and a count
 *    in prose beside a count in code is the drift `documents.test.ts` exists to catch. The same
 *    discipline, applied to this document.
 *
 * ## Why this file does I/O when the package does not
 *
 * The same reason `documents.test.ts` and `glossary-staleness.test.ts` give: a guard against drift
 * between generated artifacts and the code has to read the artifacts. The reading lives here, in a
 * test, and nothing in `src/` depends on it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  ACT_TYPES,
  ADDITIVE_CHANGES,
  BREAKING_CHANGES,
  CATALOG_FACES,
  CATALOG_MEMBERS,
  CATALOG_VERSION,
  FILTER_AXES,
  FILTER_AXIS_FACES,
  FILTER_AXIS_SOURCE,
  META_RECORD_TYPES,
  NON_ACT_TYPES,
  REASON_CODES,
  REFUSED_FILTER_AXES,
  eventId,
  instant,
  partyId,
  shipmentId,
  specVersion,
  stopId,
  subjectRef,
  tripId,
  type CapturedAssertion,
  type QueriedAssertion,
} from '../../src/index'
import {
  CATALOG_COMMAND,
  CATALOG_FILES,
  CATALOG_REPO_DIR,
  committedCatalogFile,
  generateCatalog,
} from '../../tools/generate-catalog'
import { collectOwedInventory } from '../../tools/generate-glossary'

/**
 * These suites drive the TypeScript compiler API and prettier. That takes seconds, not
 * milliseconds, and a CI runner is slower than a workstation — vitest's default 5s passed locally
 * and timed out in CI once already (PR #712). The budget exists to stop a hang, not to police tsc.
 */
const SLOW_MS = 180_000

const DECISION_FILE = fileURLToPath(
  new URL('../../../../docs/domain-reference/analysis/published-event-catalog.md', import.meta.url),
)

/* ------------------------------------------------------------------------------------------------
 * A validator for the subset this generator emits
 * ---------------------------------------------------------------------------------------------- */

/**
 * JSON Schema, restricted to the keywords `generate-catalog.ts` actually produces.
 *
 * Deliberately not a library. `src/` has no runtime dependency and this package has two devDeps
 * that both earn their place; a validator for eleven keywords is smaller than the argument for
 * adding a twelfth. The restriction is the point and is enforced: {@link assertKnownKeywords}
 * fails if the generator ever emits a keyword this does not implement, so the subset can never
 * quietly drift into "the parts we check" versus "the parts we publish".
 */
const KNOWN_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'const',
  'enum',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'anyOf',
  'format',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resolve(root: Record<string, unknown>, reference: string): unknown {
  const prefix = '#/$defs/'
  if (!reference.startsWith(prefix)) throw new Error(`unsupported $ref: ${reference}`)
  const defs = root['$defs']
  if (!isObject(defs)) throw new Error('the document has no `$defs`')
  const target = defs[reference.slice(prefix.length)]
  if (target === undefined) throw new Error(`dangling $ref: ${reference}`)
  return target
}

/** Every reason the value failed, each with the path at which it failed. */
function validate(
  root: Record<string, unknown>,
  schema: unknown,
  value: unknown,
  path = '$',
): string[] {
  if (schema === true) return []
  if (schema === false) return [`${path}: forbidden here, but present`]
  if (!isObject(schema)) return [`${path}: malformed schema`]

  if (typeof schema['$ref'] === 'string') {
    return validate(root, resolve(root, schema['$ref']), value, path)
  }

  const errors: string[] = []

  if ('const' in schema && value !== schema['const']) {
    errors.push(
      `${path}: expected ${JSON.stringify(schema['const'])}, got ${JSON.stringify(value)}`,
    )
  }
  if (Array.isArray(schema['enum']) && !schema['enum'].includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of the enum`)
  }

  const declared = schema['type']
  if (typeof declared === 'string') {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const matches = declared === 'number' ? actual === 'number' : actual === declared
    if (!matches) errors.push(`${path}: expected ${declared}, got ${actual}`)
  }

  if (Array.isArray(schema['anyOf'])) {
    const failures = schema['anyOf'].map((branch) => validate(root, branch, value, path))
    if (failures.every((failure) => failure.length > 0)) {
      errors.push(`${path}: matched none of ${schema['anyOf'].length} branches`)
    }
  }

  if (declared === 'object' && isObject(value)) {
    const properties = isObject(schema['properties']) ? schema['properties'] : {}
    for (const [key, member] of Object.entries(value)) {
      if (key in properties) {
        errors.push(...validate(root, properties[key], member, `${path}.${key}`))
      } else if (schema['additionalProperties'] === false) {
        errors.push(`${path}.${key}: not permitted — the schema is closed`)
      }
    }
    for (const key of Array.isArray(schema['required']) ? schema['required'] : []) {
      if (typeof key === 'string' && !(key in value)) errors.push(`${path}.${key}: missing`)
    }
  }

  if (declared === 'array' && Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      errors.push(`${path}: needs at least ${schema['minItems']} item(s)`)
    }
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
      errors.push(`${path}: allows at most ${schema['maxItems']} item(s)`)
    }
    value.forEach((member, index) => {
      errors.push(...validate(root, schema['items'], member, `${path}[${index}]`))
    })
  }

  return errors
}

/* ------------------------------------------------------------------------------------------------
 * Walking the emitted documents
 * ---------------------------------------------------------------------------------------------- */

function committed(file: string): Record<string, unknown> {
  const raw = committedCatalogFile(file)
  if (raw === undefined) {
    throw new Error(`\`${CATALOG_REPO_DIR}/${file}\` is missing. Run \`${CATALOG_COMMAND}\`.`)
  }
  return JSON.parse(raw) as Record<string, unknown>
}

/** Every subschema in the document, with the path it sits at. */
function everySchema(node: unknown, path = '$'): [string, Record<string, unknown>][] {
  if (!isObject(node)) return []
  const found: [string, Record<string, unknown>][] = [[path, node]]
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      value.forEach((member, index) =>
        found.push(...everySchema(member, `${path}.${key}[${index}]`)),
      )
    } else {
      found.push(...everySchema(value, `${path}.${key}`))
    }
  }
  return found
}

/**
 * The schemas that are the **envelope** of a record, rather than something inside its payload.
 *
 * Recognised by `eventId`, which [SD §1.1] makes MANDATORY on every record and which appears
 * nowhere else: a payload carries `evidence[]` and `supersedes` as event ids, but never a property
 * of that name.
 */
function envelopeSchemasOf(record: unknown): Record<string, unknown>[] {
  return everySchema(record)
    .map(([, schema]) => schema)
    .filter((schema) => isObject(schema['properties']) && 'eventId' in schema['properties'])
}

function assertKnownKeywords(document: Record<string, unknown>): void {
  const unknown = new Set<string>()
  for (const [, schema] of everySchema(document)) {
    for (const key of Object.keys(schema)) {
      // `$defs` entries and `properties` members are names, not keywords; only the schema objects
      // themselves are checked, and a schema object is recognised by carrying a keyword.
      if (key.startsWith('x-')) continue
      if (KNOWN_KEYWORDS.has(key)) continue
      unknown.add(key)
    }
  }
  // Names living under `$defs` and `properties` land here too; subtract them.
  const names = new Set<string>()
  const collect = (holder: unknown): void => {
    if (isObject(holder)) for (const key of Object.keys(holder)) names.add(key)
  }
  for (const [path, schema] of everySchema(document)) {
    if (path.endsWith('$defs') || path.endsWith('properties')) continue
    collect(schema['$defs'])
    collect(schema['properties'])
  }
  const real = [...unknown].filter((key) => !names.has(key)).sort()
  if (real.length > 0) {
    throw new Error(
      `the generator emits JSON Schema keywords this test does not validate: ${real.join(', ')}. ` +
        'Implement them in `validate()` rather than widening the allowlist — a validator that ' +
        'skips a keyword silently admits everything that keyword was there to refuse.',
    )
  }
}

/* ------------------------------------------------------------------------------------------------
 * Real records, for the round trip
 * ---------------------------------------------------------------------------------------------- */

const spec = specVersion(CATALOG_VERSION)
const destinationStop = subjectRef('stop', stopId('ST-19'))
const shipment = subjectRef('shipment', shipmentId('S-2204'))
const trip = subjectRef('trip', tripId('T-7781'))

/** [SD §5.2] M5 — a geofence may carry `basis = ACTUAL` for arrival at a stop. */
const geofencedArrival: CapturedAssertion<'arrival'> = {
  eventId: eventId('A-DRIVER'),
  type: 'arrival',
  specVersion: spec,
  subject: destinationStop,
  assertedBy: { party: partyId('P-DRIVER-MAE'), role: 'driver' },
  assertedAt: instant('2026-09-02T13:58:04Z'),
  capturedBy: 'DEVICE_GEOFENCE',
  context: [trip, shipment],
  basis: 'ACTUAL',
  value: { at: instant('2026-09-02T13:58:00Z') },
}

/** [SD §2.2] — a first-class `COMPLETED`, which [SD §2.3] invariant 2 forbids a reason on. */
const cleanDelivery: CapturedAssertion<'delivery'> = {
  eventId: eventId('A-DELIVERY'),
  type: 'delivery',
  specVersion: spec,
  subject: shipment,
  assertedBy: { party: partyId('P-DEST-CO'), role: 'destinationAgent' },
  assertedAt: instant('2026-09-04T16:02:00Z'),
  capturedBy: 'OBSERVED_BY_PERSON',
  basis: 'ACTUAL',
  value: { occurredAt: instant('2026-09-04T15:40:00Z'), outcome: 'COMPLETED' },
}

/** The queried face — [SD §1.1]: `recordedAt` is MANDATORY here and forbidden on capture. */
const queriedArrival: QueriedAssertion<'arrival'> = {
  ...geofencedArrival,
  recordedAt: instant('2026-09-02T13:58:09Z'),
}

/** JSON, as a consumer would see it: `undefined` members gone, brands erased. */
function wire(record: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}

/* ------------------------------------------------------------------------------------------------
 * The suites
 * ---------------------------------------------------------------------------------------------- */

describe('the generated catalog', () => {
  it(
    'is committed in the state the generator produces',
    async () => {
      const generated = await generateCatalog()
      for (const [name, contents] of generated) {
        const onDisk = committedCatalogFile(name)
        if (onDisk === contents) continue
        const left = contents.split('\n')
        const right = (onDisk ?? '').split('\n')
        const at = left.findIndex((line, index) => line !== right[index])
        throw new Error(
          `\`${CATALOG_REPO_DIR}/${name}\` is stale.\n` +
            `first difference at line ${at + 1}\n` +
            `  committed: ${JSON.stringify(right[at] ?? '<end of file>')}\n` +
            `  generated: ${JSON.stringify(left[at] ?? '<end of file>')}\n\n` +
            `The catalog is generated. Do not edit it by hand — run \`${CATALOG_COMMAND}\`.`,
        )
      }
      expect([...generated.keys()].sort()).toEqual(Object.values(CATALOG_FILES).sort())
    },
    SLOW_MS,
  )

  it(
    'regenerates identically — the output is a function of the code and nothing else',
    async () => {
      // No clock, no hostname, no working directory, and `$defs` names assigned in a deterministic
      // order. A generated file that is not reproducible turns its own staleness gate into noise.
      const first = await generateCatalog()
      const second = await generateCatalog()
      expect([...second]).toEqual([...first])
    },
    SLOW_MS,
  )

  it('publishes the per-code reason discipline, which no schema can carry — [A4 §3]', () => {
    // [A4 §0] rule 2 claims a consumer reading `index.json` sees the disclosure markers "without
    // reading this file". It was written before anything emitted them, which made it a disclosure
    // defect of exactly the kind [SD §0] is about; this is the check that keeps it true.
    const manifest = JSON.parse(committedCatalogFile(CATALOG_FILES.index) ?? '{}') as {
      reasons?: {
        openMember?: { code?: string; remarkRequired?: boolean }
        codes?: { code: string; scope: string; partyRequired: boolean; remedyRequired: boolean }[]
      }
    }
    const codes = manifest.reasons?.codes ?? []
    expect(codes.map((entry) => entry.code).sort()).toEqual([...REASON_CODES].sort())
    expect(manifest.reasons?.openMember?.code).toBe('OTHER')
    expect(manifest.reasons?.openMember?.remarkRequired).toBe(true)
    // The two obligations the emitted schemas leave optional and the vocabulary does not.
    expect(
      codes
        .filter((entry) => entry.remedyRequired)
        .map((entry) => entry.code)
        .sort(),
    ).toEqual(['PARTY_ABSENT', 'PARTY_RESCHEDULED'])
    expect(codes.filter((entry) => entry.partyRequired).every((e) => e.scope === 'PARTY')).toBe(
      true,
    )
  })

  it('carries the do-not-edit header, naming the generator and the command', () => {
    for (const name of Object.values(CATALOG_FILES)) {
      const raw = committedCatalogFile(name)
      expect(raw, `${name} is missing`).toBeDefined()
      expect(raw).toContain('GENERATED FILE — DO NOT EDIT BY HAND')
      expect(raw).toContain('packages/domain-reference/tools/generate-catalog.ts')
      expect(raw).toContain(CATALOG_COMMAND)
    }
  })
})

describe('the emitted schemas', () => {
  for (const face of CATALOG_FACES) {
    describe(`the ${face} face`, () => {
      const document = committed(CATALOG_FILES[face])

      it('emits one record schema per published member, and no others', () => {
        const defs = document['$defs']
        expect(isObject(defs)).toBe(true)
        const records = Object.keys(defs as Record<string, unknown>)
          .filter((key) => key.startsWith('record.'))
          .map((key) => key.slice('record.'.length))
          .sort()
        expect(records).toEqual([...CATALOG_MEMBERS].sort())
      })

      it('gives every record a `type` fixed to its own member name — [SD §1.3] E-TYPE', () => {
        const defs = document['$defs'] as Record<string, unknown>
        for (const member of CATALOG_MEMBERS) {
          const found = new Set<unknown>()
          // Envelope-level only. A `FactResolved` also carries `factRef.type` — the **corrected**
          // fact's class ([SD §4.3]) — and that one is a whole-vocabulary enum by design, so a walk
          // that did not distinguish the two would read the meta-record's own axis off its payload.
          for (const schema of envelopeSchemasOf(defs[`record.${member}`])) {
            const declared = (schema['properties'] as Record<string, unknown>)['type']
            if (isObject(declared) && 'const' in declared) found.add(declared['const'])
          }
          expect([...found], `record.${member}`).toEqual([member])
        }
      })

      it('resolves every `$ref`', () => {
        for (const [path, schema] of everySchema(document)) {
          const reference = schema['$ref']
          if (typeof reference !== 'string') continue
          expect(() => resolve(document, reference), `${path} → ${reference}`).not.toThrow()
        }
      })

      it('closes every object schema — [catalog §2.3]', () => {
        for (const [path, schema] of everySchema(document)) {
          if (schema['type'] !== 'object') continue
          expect(schema['additionalProperties'], path).toBe(false)
        }
      })

      it('emits every permanently-forbidden envelope field as `false` — [SD §1.1]', () => {
        // The list [SD §1.1] calls permanent, spelled as `envelope.ts` blocks each one.
        const forbidden = [
          'subjects',
          'secondSubject',
          'subjectPath',
          'factClass',
          'tense',
          'eventClassifierCode',
          'status',
          'currentState',
          'correlation',
          'causedBy',
        ]
        const defs = document['$defs'] as Record<string, unknown>
        for (const member of CATALOG_MEMBERS) {
          for (const [, schema] of everySchema(defs[`record.${member}`])) {
            const properties = schema['properties']
            if (!isObject(properties) || !('eventId' in properties)) continue
            for (const field of forbidden) {
              expect(properties[field], `record.${member}.${field}`).toBe(false)
            }
          }
        }
      })

      it('puts `recordedAt` on the right side of the capture/query line — [SD §1.1]', () => {
        const defs = document['$defs'] as Record<string, unknown>
        for (const member of CATALOG_MEMBERS) {
          for (const [, schema] of everySchema(defs[`record.${member}`])) {
            const properties = schema['properties']
            if (!isObject(properties) || !('eventId' in properties)) continue
            const required = Array.isArray(schema['required']) ? schema['required'] : []
            if (face === 'captured') {
              expect(properties['recordedAt'], `record.${member}`).toBe(false)
            } else {
              expect(properties['recordedAt'], `record.${member}`).not.toBe(false)
              expect(required, `record.${member}`).toContain('recordedAt')
            }
          }
        }
      })

      it('uses only the JSON Schema keywords this suite validates', () => {
        expect(() => assertKnownKeywords(document)).not.toThrow()
      })
    })
  }
})

describe('the round trip — real records against the emitted schema', () => {
  const capturedDocument = committed(CATALOG_FILES.captured)
  const queriedDocument = committed(CATALOG_FILES.queried)

  it('admits a geofenced arrival on the captured face — [SD §5.2] M5', () => {
    expect(validate(capturedDocument, capturedDocument, wire(geofencedArrival))).toEqual([])
  })

  it('admits a clean delivery, which carries no `reasons` — [SD §2.3] invariant 2', () => {
    expect(validate(capturedDocument, capturedDocument, wire(cleanDelivery))).toEqual([])
  })

  it('admits the same arrival on the queried face once `recordedAt` is there', () => {
    expect(validate(queriedDocument, queriedDocument, wire(queriedArrival))).toEqual([])
  })

  /*
   * The tampering half. A gate is only worth having if it is capable of failing, and [`plans`]
   * records two tamper attempts in an earlier session that silently matched nothing — which looks
   * exactly like a working gate.
   */

  it('refuses a captured record carrying `recordedAt` — it is server-authored [SD §1.1]', () => {
    const tampered = { ...wire(geofencedArrival), recordedAt: '2026-09-02T13:58:09Z' }
    expect(validate(capturedDocument, capturedDocument, tampered).length).toBeGreaterThan(0)
  })

  it('refuses a record carrying a second subject — [SD §1.1], permanently forbidden', () => {
    const tampered = { ...wire(geofencedArrival), subjects: [{ aggregate: 'shipment', id: 'S-1' }] }
    expect(validate(capturedDocument, capturedDocument, tampered).length).toBeGreaterThan(0)
  })

  it('refuses a record carrying a mutable current-state field — [SD §1.1]', () => {
    const tampered = { ...wire(geofencedArrival), status: 'IN_TRANSIT' }
    expect(validate(capturedDocument, capturedDocument, tampered).length).toBeGreaterThan(0)
  })

  it('refuses a queried record with no `recordedAt` — it is MANDATORY there [SD §1.1]', () => {
    expect(
      validate(queriedDocument, queriedDocument, wire(geofencedArrival)).length,
    ).toBeGreaterThan(0)
  })

  it('refuses a type outside the vocabulary — [SD §1.3] E-TYPE', () => {
    const tampered = { ...wire(geofencedArrival), type: 'weighing' }
    expect(validate(capturedDocument, capturedDocument, tampered).length).toBeGreaterThan(0)
  })

  it('refuses an unknown field — the schemas are closed [catalog §2.3]', () => {
    const tampered = { ...wire(geofencedArrival), vendorExtension: 'anything' }
    expect(validate(capturedDocument, capturedDocument, tampered).length).toBeGreaterThan(0)
  })
})

describe('the manifest', () => {
  const index = committed(CATALOG_FILES.index)

  it('publishes the catalog at the version the code declares', () => {
    const catalog = index['catalog'] as Record<string, unknown>
    expect(catalog['specVersion']).toBe(CATALOG_VERSION)
    expect(catalog['memberCount']).toBe(CATALOG_MEMBERS.length)
  })

  it('publishes every filter axis with its source and its faces — [catalog §3.2]', () => {
    const filtering = index['filtering'] as Record<string, unknown>
    const axes = filtering['axes'] as { axis: string; source: string; faces: string[] }[]
    expect(axes.map((entry) => entry.axis)).toEqual([...FILTER_AXES])
    for (const entry of axes) {
      expect(entry.source, entry.axis).toBe(
        FILTER_AXIS_SOURCE[entry.axis as keyof typeof FILTER_AXIS_SOURCE],
      )
      expect(entry.faces, entry.axis).toEqual([
        ...FILTER_AXIS_FACES[entry.axis as keyof typeof FILTER_AXIS_FACES],
      ])
    }
    expect(filtering['refused']).toEqual([...REFUSED_FILTER_AXES])
  })

  it('publishes the compatibility classification — [catalog §2.3]', () => {
    const compatibility = index['compatibility'] as Record<string, unknown>
    expect(compatibility['additive']).toEqual([...ADDITIVE_CHANGES])
    expect(compatibility['breaking']).toEqual([...BREAKING_CHANGES])
  })

  it(
    'publishes the owed inventory, so a consumer sees the gaps — [catalog §5]',
    () => {
      const owed = index['owed'] as Record<string, unknown>
      const counts = owed['counts'] as Record<string, number>
      const inventory = collectOwedInventory()
      expect(counts['declared']).toBe(inventory.declared.length)
      expect(counts['authorityRows']).toBe(inventory.authorityRows.length)
      expect(counts['absentFactClasses']).toBe(inventory.absentFactClasses.length)
      // Not zero, and not silently emptied: [SD §0] carries a gap as a gap.
      expect(counts['declared']).toBeGreaterThan(0)
      expect(counts['authorityRows']).toBeGreaterThan(0)
    },
    SLOW_MS,
  )
})

describe('the filter vocabulary — [catalog §3.2]', () => {
  it('sources every axis from the envelope, the payload, or a key derived from them', () => {
    for (const axis of FILTER_AXES) {
      expect(['envelope', 'payload', 'derived'], axis).toContain(FILTER_AXIS_SOURCE[axis])
    }
  })

  it('offers every axis on both faces except `recordedAt`, which capture forbids', () => {
    for (const axis of FILTER_AXES) {
      const faces = FILTER_AXIS_FACES[axis]
      expect(faces, axis).toEqual(axis === 'recordedAt' ? ['queried'] : [...CATALOG_FACES])
    }
  })

  it('keeps the offered and the refused axes disjoint', () => {
    const offered = new Set<string>(FILTER_AXES)
    for (const refused of REFUSED_FILTER_AXES) expect(offered.has(refused)).toBe(false)
  })

  it('refuses `context` as a default axis — [SD §1.4] rule 1', () => {
    expect([...REFUSED_FILTER_AXES]).toContain('context')
  })
})

describe('the decision document and the code agree on the counts', () => {
  // Whitespace-collapsed, because the document is wrapped at 100 columns and a claim that spans a
  // line break is the same claim. A check that broke on rewrapping would be a check people rewrap
  // around.
  const text = readFileSync(DECISION_FILE, 'utf8').replace(/\s+/g, ' ')

  /** `| Act types | 19 | …` — the count in the cell after the label. */
  function countAfter(label: string): number {
    const match = new RegExp(`\\|\\s*${label}\\s*\\|\\s*\\*{0,2}(\\d+)\\*{0,2}\\s*\\|`).exec(text)
    if (match?.[1] === undefined) {
      throw new Error(
        `[catalog §1.1]'s table no longer carries a row labelled "${label}". The table is the ` +
          "document's statement of what the catalog publishes; if it moved, move this check.",
      )
    }
    return Number(match[1])
  }

  it('states the member counts the vocabulary declares — [catalog §1.1]', () => {
    expect(countAfter('Act types')).toBe(ACT_TYPES.length)
    expect(countAfter('Non-act assertion types')).toBe(NON_ACT_TYPES.length)
    expect(countAfter('Meta-record types')).toBe(META_RECORD_TYPES.length)
    expect(countAfter('\\*\\*Published members\\*\\*')).toBe(CATALOG_MEMBERS.length)
  })

  it('states the twelve filter axes it tabulates — [catalog §3.2]', () => {
    expect(text).toContain(`The twelve are \`FILTER_AXES\``)
    expect(FILTER_AXES.length).toBe(12)
    for (const axis of FILTER_AXES) expect(text, axis).toContain(`\`${axis}\``)
  })

  it(
    'states the owed counts the ledger holds — [catalog §5]',
    () => {
      const inventory = collectOwedInventory()
      expect(text).toContain(`**${inventory.declared.length} declared owed values**`)
      expect(text).toContain(
        `**${inventory.authorityRows.length} of ${inventory.declaredRecordTypes}**`,
      )
      expect(text).toContain(`**${inventory.factClassFamilies.length}** whose fact-class family`)
      expect(text).toContain(`**${inventory.absentFactClasses.length}** fact classes named`)
    },
    SLOW_MS,
  )
})
