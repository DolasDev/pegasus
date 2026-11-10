// ---------------------------------------------------------------------------
// streamFetch — POST + Authorization + server-sent events, read incrementally.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, createStreamClient, parseSseStream, type SseEvent } from '../index'

/** A Response whose body arrives in the given chunks (split mid-event on purpose). */
function chunked(chunks: string[], status = 200, contentType = 'text/event-stream'): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

async function collect(gen: AsyncIterable<SseEvent>): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

describe('parseSseStream', () => {
  it('yields events as they complete, across chunk boundaries', async () => {
    const res = chunked([
      'event: text\ndata: {"text":"Hel',
      'lo"}\n\nevent: done\n',
      'data: {"ok":true}\n\n',
    ])
    expect(await collect(parseSseStream(res.body!))).toEqual([
      { event: 'text', data: { text: 'Hello' } },
      { event: 'done', data: { ok: true } },
    ])
  })

  it('handles CRLF line endings, comments and multi-line data', async () => {
    const res = chunked([': keep-alive\r\n\r\nevent: x\r\ndata: {"a":\r\ndata: 1}\r\n\r\n'])
    expect(await collect(parseSseStream(res.body!))).toEqual([{ event: 'x', data: { a: 1 } }])
  })

  it('defaults the event name to "message" and keeps non-JSON data as a string', async () => {
    const res = chunked(['data: plain\n\n'])
    expect(await collect(parseSseStream(res.body!))).toEqual([{ event: 'message', data: 'plain' }])
  })
})

describe('createStreamClient().stream', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('POSTs JSON with the bearer token and a correlation id to the base URL', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(chunked(['data: {}\n\n']))
    const client = createStreamClient({
      getBaseUrl: () => 'https://fn.test/',
      getToken: () => 'tok',
    })
    await collect(client.stream('/api/v1/assistant/chat', { question: 'hi' }))
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe('https://fn.test/api/v1/assistant/chat')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ question: 'hi' }))
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer tok')
    expect(headers.get('Accept')).toBe('text/event-stream')
    expect(headers.get('x-correlation-id')).toBeTruthy()
  })

  it('throws ApiError from a JSON error envelope before streaming', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope', code: 'FORBIDDEN' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = createStreamClient({ getBaseUrl: () => 'https://fn.test', getToken: () => null })
    const err = await collect(client.stream('/x', {})).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: 'FORBIDDEN', status: 403 })
  })

  it('passes the abort signal through', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(chunked([]))
    const controller = new AbortController()
    const client = createStreamClient({ getBaseUrl: () => 'https://fn.test', getToken: () => null })
    await collect(client.stream('/x', {}, controller.signal))
    expect(spy.mock.calls[0]![1]?.signal).toBe(controller.signal)
  })
})
