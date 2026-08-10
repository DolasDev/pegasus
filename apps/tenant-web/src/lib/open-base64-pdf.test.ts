import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { base64ToBytes, openBase64Document } from './open-base64-pdf'

const PDF_TEXT = '%PDF-1.4 trip sheet'
const PDF_B64 = btoa(PDF_TEXT)

describe('base64ToBytes', () => {
  it('decodes base64 to the original bytes', () => {
    expect(new TextDecoder().decode(base64ToBytes(PDF_B64))).toBe(PDF_TEXT)
  })

  it('handles bytes outside the ASCII range', () => {
    // 0xff would be mangled by any naive string round-trip.
    const bytes = new Uint8Array([0x25, 0x50, 0xff, 0x00])
    const b64 = btoa(String.fromCharCode(...bytes))
    expect(Array.from(base64ToBytes(b64))).toEqual([0x25, 0x50, 0xff, 0x00])
  })

  it('returns an empty array for an empty payload', () => {
    expect(base64ToBytes('')).toHaveLength(0)
  })
})

describe('openBase64Document', () => {
  // Typed parameter so the blob handed to createObjectURL stays inspectable.
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url')
  const revokeObjectURL = vi.fn()
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    open.mockRestore()
  })

  it('opens the decoded document in a new tab', () => {
    const result = openBase64Document({
      contentBase64: PDF_B64,
      contentType: 'application/pdf',
    })

    expect(result).toBe(true)
    expect(open).toHaveBeenCalledWith('blob:fake-url', '_blank', 'noopener,noreferrer')
  })

  it('builds the blob with the reported content type', async () => {
    openBase64Document({ contentBase64: PDF_B64, contentType: 'application/pdf' })

    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe(PDF_TEXT)
  })

  it('refuses to type the blob as anything executable in this origin', async () => {
    // A blob: URL inherits this page's origin. Typing it text/html would run a
    // compromised pegII host's payload as script here, with the session token
    // in reach; octet-stream downloads instead.
    openBase64Document({ contentBase64: PDF_B64, contentType: 'text/html' })

    const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob
    expect(blob.type).toBe('application/octet-stream')
  })

  it('does not revoke the object URL before the new tab can load it', () => {
    openBase64Document({ contentBase64: PDF_B64, contentType: 'application/pdf' })

    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.advanceTimersByTime(60_000)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })

  it('reports a blocked popup and reclaims the object URL immediately', () => {
    open.mockReturnValue(null)

    const result = openBase64Document({
      contentBase64: PDF_B64,
      contentType: 'application/pdf',
    })

    expect(result).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
  })
})
