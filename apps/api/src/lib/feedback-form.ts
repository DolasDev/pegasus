// ---------------------------------------------------------------------------
// Feedback form definition — the tenant-authored question list, plus the two
// derivations the rest of the feature needs:
//
//   validateFormDefinition() — is the AUTHORED definition well-formed? (publish)
//   compileResponseSchema()  — the payload-schema a RESPONSE must satisfy (submit)
//   renderMessageTemplate()  — substitute {{url}}/{{subjectId}} into the SMS body
//
// A definition is `{ questions: Question[] }`. Each question has a slug `id`, a
// `type`, a `label`, an optional `required`, and per-type constraints. Response
// validation reuses lib/payload-schema-validator (the same dependency-free subset
// the custom-events registry uses) by COMPILING the question list into a schema —
// so there is exactly one validation engine in the codebase, not two.
//
// Supported question types (v1):
//   rating  → integer in [min,max]           (default 1..5)
//             display: faces | stars | numeric (default numeric), scaleLabels
//   number  → number in [min,max]            (bounds optional)
//   text    → string, maxLength (default 1000)
//   select  → string, enum = options[]
//   boolean → boolean
//
// Keys are STRICT: a question key not listed for its type, or a top-level key
// other than `questions`, is an error. A lenient validator let an author's
// reasonable guess (`display: "faces"` before it existed) validate clean and
// publish an immutable version that ignored it (sdk-feedback 0033 B).
// ---------------------------------------------------------------------------

export type FeedbackQuestionType = 'rating' | 'number' | 'text' | 'select' | 'boolean'

const QUESTION_TYPES: readonly FeedbackQuestionType[] = [
  'rating',
  'number',
  'text',
  'select',
  'boolean',
]

/** Keys every question may carry, whatever its type. */
const COMMON_KEYS = ['id', 'type', 'label', 'required'] as const

/** The per-type keys on top of COMMON_KEYS. Anything else is rejected. */
const TYPE_KEYS: Record<FeedbackQuestionType, readonly string[]> = {
  rating: ['min', 'max', 'display', 'scaleLabels'],
  number: ['min', 'max'],
  text: ['maxLength'],
  select: ['options'],
  boolean: [],
}

/** How the hosted form draws a rating. The answer is an integer whichever is chosen. */
export type RatingDisplay = 'faces' | 'stars' | 'numeric'
const RATING_DISPLAYS: readonly RatingDisplay[] = ['faces', 'stars', 'numeric']

/** Faces read as a sentiment ramp only over a short scale. Wider ones must pick stars or numeric. */
const MAX_FACES_POINTS = 7

/** A question-id slug — lowercase, dot/underscore/hyphen, ≤64 chars. */
const QUESTION_ID_RE = /^[a-z][a-z0-9_.-]{0,63}$/

/** Hard ceiling on a text answer when the author names no maxLength. */
const DEFAULT_TEXT_MAX_LENGTH = 1000
/** Default rating scale when the author names no bounds. */
const DEFAULT_RATING_MIN = 1
const DEFAULT_RATING_MAX = 5

export type DefinitionCheck = { ok: true } | { ok: false; errors: string[] }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── authoring-time: is the DEFINITION well-formed? ───────────────────────────

/**
 * Validate a candidate form definition. Returns every structural problem
 * (empty ⇒ ok). Called at publish so an unrenderable/unenforceable form is
 * never stored.
 */
export function validateFormDefinition(definition: unknown): DefinitionCheck {
  const errors: string[] = []
  if (!isPlainObject(definition)) {
    return { ok: false, errors: ['definition must be an object'] }
  }
  const questions = definition['questions']
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, errors: ['definition.questions must be a non-empty array'] }
  }
  for (const key of Object.keys(definition)) {
    if (key !== 'questions') {
      errors.push(`definition.${key} is not a recognized key (allowed: questions)`)
    }
  }
  const seen = new Set<string>()
  questions.forEach((q, i) => validateQuestion(q, i, seen, errors))
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

function validateQuestion(q: unknown, i: number, seen: Set<string>, errors: string[]): void {
  const at = `questions[${i}]`
  if (!isPlainObject(q)) {
    errors.push(`${at}: must be an object`)
    return
  }
  const id = q['id']
  if (typeof id !== 'string' || !QUESTION_ID_RE.test(id)) {
    errors.push(`${at}.id must be a slug ([a-z][a-z0-9_.-]{0,63})`)
  } else if (seen.has(id)) {
    errors.push(`${at}.id "${id}" is duplicated`)
  } else {
    seen.add(id)
  }
  const type = q['type']
  if (typeof type !== 'string' || !QUESTION_TYPES.includes(type as FeedbackQuestionType)) {
    errors.push(`${at}.type must be one of ${QUESTION_TYPES.join(', ')}`)
    return // remaining per-type checks are meaningless without a valid type
  }
  if (typeof q['label'] !== 'string' || q['label'].trim().length === 0) {
    errors.push(`${at}.label must be a non-empty string`)
  }
  if ('required' in q && typeof q['required'] !== 'boolean') {
    errors.push(`${at}.required must be a boolean`)
  }
  const allowed = [...COMMON_KEYS, ...TYPE_KEYS[type as FeedbackQuestionType]]
  for (const key of Object.keys(q)) {
    if (!allowed.includes(key)) {
      errors.push(
        `${at}.${key} is not a recognized key for a ${type} question (allowed: ${allowed.join(', ')})`,
      )
    }
  }

  switch (type as FeedbackQuestionType) {
    case 'rating':
    case 'number': {
      const min = q['min']
      const max = q['max']
      if (min !== undefined && typeof min !== 'number') errors.push(`${at}.min must be a number`)
      if (max !== undefined && typeof max !== 'number') errors.push(`${at}.max must be a number`)
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        errors.push(`${at}.min must be ≤ max`)
      }
      if (type === 'rating') validateRatingPresentation(q, at, errors)
      break
    }
    case 'text': {
      const maxLength = q['maxLength']
      if (maxLength !== undefined && (typeof maxLength !== 'number' || maxLength < 1)) {
        errors.push(`${at}.maxLength must be a positive number`)
      }
      break
    }
    case 'select': {
      const options = q['options']
      if (
        !Array.isArray(options) ||
        options.length === 0 ||
        !options.every((o) => typeof o === 'string' && o.length > 0)
      ) {
        errors.push(`${at}.options must be a non-empty array of strings`)
      }
      break
    }
    case 'boolean':
      break
  }
}

/** `display` and `scaleLabels` on a rating: presentation only, never the answer's shape. */
function validateRatingPresentation(
  q: Record<string, unknown>,
  at: string,
  errors: string[],
): void {
  const min = typeof q['min'] === 'number' ? q['min'] : DEFAULT_RATING_MIN
  const max = typeof q['max'] === 'number' ? q['max'] : DEFAULT_RATING_MAX
  if (min > max) return // already reported; the scale has no points to check against

  const display = q['display']
  if (display !== undefined) {
    if (typeof display !== 'string' || !RATING_DISPLAYS.includes(display as RatingDisplay)) {
      errors.push(`${at}.display must be one of ${RATING_DISPLAYS.join(', ')}`)
    } else if (display === 'faces' && max - min + 1 > MAX_FACES_POINTS) {
      errors.push(
        `${at}.display "faces" supports at most ${MAX_FACES_POINTS} points; this scale has ${max - min + 1}`,
      )
    }
  }

  const labels = q['scaleLabels']
  if (labels === undefined) return
  if (!isPlainObject(labels)) {
    errors.push(`${at}.scaleLabels must be an object of scale point → label`)
    return
  }
  for (const [point, label] of Object.entries(labels)) {
    // Canonical integer spelling only: the form looks labels up by String(n), so
    // "01" or "1.0" would validate yet never render.
    const n = Number(point)
    if (!Number.isInteger(n) || String(n) !== point || n < min || n > max) {
      errors.push(`${at}.scaleLabels["${point}"] is not a point on the ${min}..${max} scale`)
    } else if (typeof label !== 'string' || label.trim().length === 0) {
      errors.push(`${at}.scaleLabels["${point}"] must be a non-empty string`)
    }
  }
}

// ── submit-time: compile the definition to a response payload-schema ─────────

interface CompiledQuestion {
  id: string
  type: FeedbackQuestionType
  label: string
  required: boolean
  min?: number
  max?: number
  maxLength?: number
  options?: string[]
}

/** Narrow a stored/validated definition to its question list (post-validation). */
function readQuestions(definition: unknown): CompiledQuestion[] {
  const raw =
    isPlainObject(definition) && Array.isArray(definition['questions'])
      ? (definition['questions'] as Record<string, unknown>[])
      : []
  return raw.map((q) => {
    const type = q['type'] as FeedbackQuestionType
    const out: CompiledQuestion = {
      id: String(q['id']),
      type,
      label: String(q['label'] ?? ''),
      required: q['required'] === true,
    }
    if (typeof q['min'] === 'number') out.min = q['min']
    if (typeof q['max'] === 'number') out.max = q['max']
    if (typeof q['maxLength'] === 'number') out.maxLength = q['maxLength']
    if (Array.isArray(q['options'])) out.options = q['options'].map(String)
    return out
  })
}

/**
 * Compile a validated definition into a payload-schema (the supported subset in
 * lib/payload-schema-validator) that a response `{ [questionId]: value }` must
 * satisfy. `additionalProperties: false` so an unknown answer key is rejected.
 */
export function compileResponseSchema(definition: unknown): Record<string, unknown> {
  const questions = readQuestions(definition)
  const properties: Record<string, Record<string, unknown>> = {}
  const required: string[] = []

  for (const q of questions) {
    properties[q.id] = questionToSchema(q)
    if (q.required) required.push(q.id)
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

function questionToSchema(q: CompiledQuestion): Record<string, unknown> {
  switch (q.type) {
    case 'rating':
      return {
        type: 'integer',
        minimum: q.min ?? DEFAULT_RATING_MIN,
        maximum: q.max ?? DEFAULT_RATING_MAX,
      }
    case 'number': {
      const schema: Record<string, unknown> = { type: 'number' }
      if (q.min !== undefined) schema['minimum'] = q.min
      if (q.max !== undefined) schema['maximum'] = q.max
      return schema
    }
    case 'text':
      return { type: 'string', maxLength: q.maxLength ?? DEFAULT_TEXT_MAX_LENGTH }
    case 'select':
      return { type: 'string', enum: q.options ?? [] }
    case 'boolean':
      return { type: 'boolean' }
  }
}

// ── mint-time: render the SMS/email message body ─────────────────────────────

/**
 * Substitute `{{url}}` and `{{subjectId}}` into a message template. Only these
 * two placeholders are supported; anything else is left verbatim. Used by the
 * mint-and-send sugar path so the tenant's copy carries the capability link.
 */
export function renderMessageTemplate(
  template: string,
  vars: { url: string; subjectId: string },
): string {
  return template.replaceAll('{{url}}', vars.url).replaceAll('{{subjectId}}', vars.subjectId)
}
