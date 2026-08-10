// ---------------------------------------------------------------------------
// Open a base64-encoded document in a new browser tab.
//
// Why this exists rather than a plain `<a href="…?format=pdf">`: tenant-web
// authenticates with a bearer token from the Cognito session, and the browser
// does not attach it to a top-level navigation. The document therefore has to
// come back through the authenticated fetch client, which means base64 — so we
// decode it here, wrap it in a Blob, and hand the browser a local object URL.
//
// The object URL is revoked on a timer rather than immediately: revoking it in
// the same tick can race the new tab's own load of that URL in Chrome, which
// shows an empty viewer. A minute is far longer than any load needs and the
// allocation is reclaimed on unload regardless.
// ---------------------------------------------------------------------------

/** How long an object URL stays alive before it is revoked. */
const REVOKE_AFTER_MS = 60_000

/**
 * Decode standard base64 (as the API returns it) into raw bytes. The buffer is
 * allocated explicitly so the result is a `Uint8Array<ArrayBuffer>` — the plain
 * `new Uint8Array(n)` form widens to `ArrayBufferLike`, which `BlobPart` (and
 * therefore the Blob constructor below) does not accept.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Types safe to hand a Blob that we then navigate to. A blob: URL INHERITS THE
 * CREATING PAGE'S ORIGIN, so opening one typed `text/html` would execute its
 * body as script inside this app's origin, with access to the session token.
 * The API already filters the type it serves; this is the second lock on the
 * same door, at the sink where it actually matters.
 */
const OPENABLE_CONTENT_TYPES = ['application/pdf'] as const

export interface OpenBase64DocumentOptions {
  contentBase64: string
  /** MIME type of the decoded document, e.g. "application/pdf". */
  contentType: string
}

/**
 * Materialize a base64 document and open it in a new tab. Returns false when
 * the browser blocked the popup, so the caller can tell the user why nothing
 * happened instead of failing silently.
 */
export function openBase64Document({
  contentBase64,
  contentType,
}: OpenBase64DocumentOptions): boolean {
  // Never open a blob typed as anything that could execute in this origin;
  // octet-stream downloads instead of rendering.
  const type = (OPENABLE_CONTENT_TYPES as readonly string[]).includes(contentType.toLowerCase())
    ? contentType.toLowerCase()
    : 'application/octet-stream'
  const blob = new Blob([base64ToBytes(contentBase64)], { type })
  const url = URL.createObjectURL(blob)

  try {
    const opened = window.open(url, '_blank', 'noopener,noreferrer')
    if (!opened) {
      // Nothing will ever load this URL — reclaim it now rather than in a minute.
      URL.revokeObjectURL(url)
      return false
    }
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS)
    return true
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }
}
