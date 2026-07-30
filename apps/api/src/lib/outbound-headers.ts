// ---------------------------------------------------------------------------
// Outbound header building — shared by call-external and deliver-to-external.
//
// Why this exists (docs/atlas-world-group-api): a partner fronted by Azure API
// Management authenticates with a NAMED HEADER (`Ocp-Apim-Subscription-Key`),
// not a bearer, and 142 of Atlas's 255 operations additionally carry a
// per-request identity header (`On-Behalf-Of`). Before this module the outbound
// handlers sent a hardcoded header set, so neither was expressible and NO Atlas
// operation was callable.
//
// Two maps, split by TRUST LEVEL — this split is the whole point:
//
//   headers        name -> literal value. Comes from workflow code, so it is
//                  non-secret by construction (`On-Behalf-Of: jdoe`).
//   secretHeaders  name -> SECRET KEY NAME. The platform resolves the value from
//                  the tenant's encrypted store, so the credential never appears
//                  in workflow source, logs, or a captured dry-run payload —
//                  the same invariant AUTH_MODE already upholds.
//
// SECURITY — two guards, both load-bearing:
//   1. RESERVED names (`Authorization`, `Host`, `Content-Length`, `Content-Type`)
//      are rejected. `Authorization` is the critical one: allowing it would let a
//      workflow present credentials of its own choosing and bypass AUTH_MODE
//      entirely. Matching is case-insensitive because HTTP header names are.
//   2. Header names must be RFC 7230 tokens and values must be free of CR/LF/NUL.
//      An unvalidated value carrying CRLF is a request-splitting primitive.
//      Undici would likely reject it too, but a defense that depends on the
//      HTTP client's leniency is not a defense.
// ---------------------------------------------------------------------------

/** Header names the handlers own; a caller may never set them. Lowercase. */
export const RESERVED_HEADERS: ReadonlySet<string> = new Set([
  'authorization',
  'host',
  'content-length',
  'content-type',
])

/** Combined ceiling across `headers` + `secretHeaders`. */
export const MAX_HEADER_ENTRIES = 24
export const MAX_HEADER_NAME = 128
export const MAX_HEADER_VALUE = 4096

/** RFC 7230 `token` — the only characters legal in a header field name. */
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/
/** A header value may not carry CR, LF, NUL, or leading/trailing whitespace. */
const HEADER_VALUE_ILLEGAL_RE = /[\r\n\0]/
/** A SECRET key name, matching the store's own key convention. */
const SECRET_KEY_RE = /^[A-Za-z0-9_.-]{1,128}$/

/** The two caller-supplied header maps, as published on the request body. */
export interface HeaderMaps {
  /** Header name → literal, non-secret value. */
  headers?: Record<string, string> | undefined
  /** Header name → SECRET key name, resolved server-side. */
  secretHeaders?: Record<string, string> | undefined
}

/** Thrown when a `secretHeaders` entry names a secret the tenant has not set. */
export class MissingHeaderSecretError extends Error {
  constructor(public readonly secretKey: string) {
    super(`Header secret '${secretKey}' is not set`)
    this.name = 'MissingHeaderSecretError'
  }
}

/**
 * Validate both header maps. Returns a human-readable error message, or null
 * when the maps are acceptable. Callers map a non-null result to a 400.
 */
export function validateHeaderMaps(maps: HeaderMaps): string | null {
  const headers = maps.headers ?? {}
  const secretHeaders = maps.secretHeaders ?? {}

  const total = Object.keys(headers).length + Object.keys(secretHeaders).length
  if (total > MAX_HEADER_ENTRIES) {
    return `too many custom headers (${total}); the maximum is ${MAX_HEADER_ENTRIES}`
  }

  for (const [name, value] of [...Object.entries(headers), ...Object.entries(secretHeaders)]) {
    if (!HEADER_NAME_RE.test(name) || name.length > MAX_HEADER_NAME) {
      return `invalid header name '${name}' (must be an RFC 7230 token, max ${MAX_HEADER_NAME} chars)`
    }
    if (RESERVED_HEADERS.has(name.toLowerCase())) {
      return `header '${name}' is reserved and set by the platform; it cannot be overridden`
    }
    if (typeof value !== 'string') return `header '${name}' must have a string value`
  }

  for (const [name, value] of Object.entries(headers)) {
    if (value.length > MAX_HEADER_VALUE) {
      return `header '${name}' value is too long (max ${MAX_HEADER_VALUE} chars)`
    }
    if (HEADER_VALUE_ILLEGAL_RE.test(value) || value !== value.trim()) {
      return `invalid header value for '${name}' (no CR/LF/NUL or surrounding whitespace)`
    }
  }

  for (const [name, secretKey] of Object.entries(secretHeaders)) {
    if (!SECRET_KEY_RE.test(secretKey)) {
      return `secretHeaders['${name}'] must be a secret key name, not a value (letters, digits, '_', '.', '-')`
    }
  }

  return null
}

/**
 * Build the final outbound header set: `base` (handler-owned) overlaid with the
 * caller's plain `headers`, then with the resolved `secretHeaders`.
 *
 * Secrets are applied LAST deliberately — a plain entry must never be able to
 * shadow a resolved credential, whichever order the caller wrote them in.
 *
 * @param readSecret resolves a SECRET key name to its plaintext, or null when
 *   the tenant has not set it (injected so this module stays free of DB/KMS).
 * @throws {MissingHeaderSecretError} when a named secret is unset.
 */
export async function resolveOutboundHeaders(
  base: Record<string, string>,
  maps: HeaderMaps,
  readSecret: (secretKey: string) => Promise<string | null>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = { ...base }
  for (const [name, value] of Object.entries(maps.headers ?? {})) out[name] = value
  for (const [name, secretKey] of Object.entries(maps.secretHeaders ?? {})) {
    const value = await readSecret(secretKey)
    if (value === null || value === undefined) throw new MissingHeaderSecretError(secretKey)
    out[name] = value
  }
  return out
}

/**
 * Flatten a partner response's headers into a lowercase-keyed object.
 *
 * Returning the WHOLE set (rather than just `content-type`, as before) is what
 * makes `Retry-After` reachable by the retry path, and `x-ms-request-id` /
 * `Ocp-Apim-Trace-Location` — the only identifiers an APIM operator can act on —
 * visible to a workflow diagnosing a failure.
 *
 * `set-cookie` is dropped: it is session material a workflow has no use for, and
 * it is the header most likely to end up in a log line.
 */
export function collectResponseHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    const key = name.toLowerCase()
    if (key === 'set-cookie') return
    out[key] = value
  })
  return out
}
