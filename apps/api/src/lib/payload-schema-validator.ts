// ---------------------------------------------------------------------------
// Payload-schema validator — a small, dependency-free JSON-Schema SUBSET.
//
// A tenant may attach an optional `payloadSchema` to a custom event type; the
// emit endpoint validates each instance payload against it. We deliberately do
// NOT pull in ajv: the repo already carries ajv v6 (transitively, via ESLint)
// and the root overrides force a v6/v8 split — adding ajv v8 as a direct dep
// would create exactly the dual-version coexistence the repo's dependency
// policy forbids. Tenant payloads are shallow entity-pointer objects, so a
// curated JSON-Schema subset covers every realistic contract.
//
// Supported keywords:
//   - type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null"
//           (or an array of those — union)
//   - object: properties, required, additionalProperties (boolean)
//   - array:  items (a schema), minItems, maxItems
//   - string: enum, minLength, maxLength, pattern (RegExp source)
//   - number/integer: enum, minimum, maximum
//
// Anything else in the schema is rejected by validatePayloadSchema (meta-check)
// so a tenant can't publish a schema we don't actually enforce — fail closed,
// never silently ignore a keyword.
// ---------------------------------------------------------------------------

export type SchemaCheck = { ok: true } | { ok: false; errors: string[] }

const PRIMITIVE_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']

const SUPPORTED_KEYWORDS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'description',
  'title',
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── meta-validation: is the SCHEMA itself one we support? ────────────────────

/**
 * Verify a candidate `payloadSchema` is a well-formed schema using only the
 * supported subset. Returns the list of structural problems (empty ⇒ ok).
 * Called at registry create/update so an unenforceable schema is never stored.
 */
export function validatePayloadSchema(schema: unknown): SchemaCheck {
  const errors: string[] = []
  validateSchemaNode(schema, '#', errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function validateSchemaNode(schema: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(schema)) {
    errors.push(`${path}: schema must be an object`)
    return
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(`${path}: unsupported schema keyword "${key}"`)
    }
  }
  if ('type' in schema) {
    const t = schema['type']
    const types = Array.isArray(t) ? t : [t]
    for (const one of types) {
      if (typeof one !== 'string' || !PRIMITIVE_TYPES.includes(one)) {
        errors.push(`${path}: "type" must be one of ${PRIMITIVE_TYPES.join(', ')}`)
      }
    }
  }
  if ('properties' in schema) {
    const props = schema['properties']
    if (!isPlainObject(props)) {
      errors.push(`${path}: "properties" must be an object`)
    } else {
      for (const [name, sub] of Object.entries(props)) {
        validateSchemaNode(sub, `${path}/properties/${name}`, errors)
      }
    }
  }
  if ('required' in schema) {
    const req = schema['required']
    if (!Array.isArray(req) || !req.every((r) => typeof r === 'string')) {
      errors.push(`${path}: "required" must be an array of strings`)
    }
  }
  if ('additionalProperties' in schema && typeof schema['additionalProperties'] !== 'boolean') {
    errors.push(`${path}: "additionalProperties" must be a boolean`)
  }
  if ('items' in schema) {
    validateSchemaNode(schema['items'], `${path}/items`, errors)
  }
  if ('enum' in schema && !Array.isArray(schema['enum'])) {
    errors.push(`${path}: "enum" must be an array`)
  }
  if ('pattern' in schema) {
    const p = schema['pattern']
    if (typeof p !== 'string') {
      errors.push(`${path}: "pattern" must be a string`)
    } else {
      try {
        new RegExp(p)
      } catch {
        errors.push(`${path}: "pattern" is not a valid regular expression`)
      }
    }
  }
  for (const numeric of ['minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum']) {
    if (numeric in schema && typeof schema[numeric] !== 'number') {
      errors.push(`${path}: "${numeric}" must be a number`)
    }
  }
}

// ── data validation: does a PAYLOAD satisfy the schema? ──────────────────────

/**
 * Validate `payload` against a `schema` already proven well-formed by
 * validatePayloadSchema. Returns every violation (empty ⇒ ok).
 */
export function validatePayload(schema: Record<string, unknown>, payload: unknown): SchemaCheck {
  const errors: string[] = []
  checkValue(schema, payload, 'payload', errors)
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value // string | number | boolean | object
}

function matchesType(declared: string, value: unknown): boolean {
  const actual = typeOf(value)
  if (declared === 'number') return actual === 'number' || actual === 'integer'
  if (declared === 'object') return isPlainObject(value)
  return actual === declared
}

function checkValue(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  errors: string[],
): void {
  if ('type' in schema) {
    const t = schema['type']
    const declared = Array.isArray(t) ? (t as string[]) : [t as string]
    if (!declared.some((d) => matchesType(d, value))) {
      errors.push(`${path}: expected type ${declared.join(' | ')}, got ${typeOf(value)}`)
      return // a type mismatch makes deeper checks meaningless
    }
  }

  if ('enum' in schema) {
    const allowed = schema['enum'] as unknown[]
    if (!allowed.some((a) => a === value)) {
      errors.push(`${path}: value is not one of the allowed enum values`)
    }
  }

  if (typeof value === 'string') {
    if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
      errors.push(`${path}: shorter than minLength ${schema['minLength']}`)
    }
    if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
      errors.push(`${path}: longer than maxLength ${schema['maxLength']}`)
    }
    if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern']).test(value)) {
      errors.push(`${path}: does not match pattern`)
    }
  }

  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
      errors.push(`${path}: less than minimum ${schema['minimum']}`)
    }
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
      errors.push(`${path}: greater than maximum ${schema['maximum']}`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) {
      errors.push(`${path}: fewer than minItems ${schema['minItems']}`)
    }
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) {
      errors.push(`${path}: more than maxItems ${schema['maxItems']}`)
    }
    if (isPlainObject(schema['items'])) {
      const itemSchema = schema['items'] as Record<string, unknown>
      value.forEach((item, i) => checkValue(itemSchema, item, `${path}[${i}]`, errors))
    }
  }

  if (isPlainObject(value)) {
    const required = Array.isArray(schema['required']) ? (schema['required'] as string[]) : []
    for (const key of required) {
      if (!(key in value)) errors.push(`${path}: missing required property "${key}"`)
    }
    const properties = isPlainObject(schema['properties'])
      ? (schema['properties'] as Record<string, Record<string, unknown>>)
      : {}
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) checkValue(sub, value[key], `${path}.${key}`, errors)
    }
    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) errors.push(`${path}: additional property "${key}" not allowed`)
      }
    }
  }
}
