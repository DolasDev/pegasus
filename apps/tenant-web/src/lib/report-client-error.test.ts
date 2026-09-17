// ---------------------------------------------------------------------------
// Unit tests for the client crash reporter.
//
// The two properties that matter are not "it posts the right JSON" but:
//   - it NEVER throws (it runs from an error boundary; throwing loops the crash)
//   - it does not flood (a render loop fires the same error repeatedly)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockApiFetch } = vi.hoisted(() => ({ mockApiFetch: vi.fn() }))

vi.mock('@/api/client', () => ({ apiFetch: mockApiFetch }))

import { reportClientError, _resetClientErrorDedupe } from './report-client-error'

function lastBody(): Record<string, unknown> {
  const init = mockApiFetch.mock.calls.at(-1)![1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

beforeEach(() => {
  mockApiFetch.mockReset()
  mockApiFetch.mockResolvedValue(undefined)
  _resetClientErrorDedupe()
})

describe('reportClientError', () => {
  it('posts the crash to the client-errors endpoint', () => {
    reportClientError(new Error('Cannot read properties of undefined'))

    expect(mockApiFetch).toHaveBeenCalledOnce()
    expect(mockApiFetch.mock.calls[0]![0]).toBe('/api/v1/client-errors')
    expect(lastBody()['message']).toBe('Cannot read properties of undefined')
  })

  it('includes the stack and the React component stack', () => {
    const err = new Error('Failed to fetch dynamically imported module')
    err.stack = 'TypeError: Failed to fetch\n  at loadTrips (index-abc.js:1:2)'

    reportClientError(err, { componentStack: '\n    at TripsModule\n    at Operations' })

    const body = lastBody()
    expect(body['stack']).toContain('loadTrips')
    expect(body['componentStack']).toContain('TripsModule')
  })

  it('truncates oversized fields before sending', () => {
    const err = new Error('x'.repeat(5000))
    err.stack = 'y'.repeat(20000)

    reportClientError(err)

    const body = lastBody()
    expect((body['message'] as string).length).toBe(500)
    expect((body['stack'] as string).length).toBe(4000)
  })

  // A render loop can fire the same error hundreds of times a second.
  it('reports a repeated identical message only once', () => {
    for (let i = 0; i < 25; i++) reportClientError(new Error('same boom'))

    expect(mockApiFetch).toHaveBeenCalledOnce()
  })

  it('still reports a different message while one is deduped', () => {
    reportClientError(new Error('first'))
    reportClientError(new Error('first'))
    reportClientError(new Error('second'))

    expect(mockApiFetch).toHaveBeenCalledTimes(2)
  })

  // The reporter runs FROM an error boundary. If it throws, one crash becomes
  // a loop — so every failure mode below must stay silent.
  it('does not throw when the POST rejects', () => {
    mockApiFetch.mockRejectedValue(new Error('network down'))

    expect(() => reportClientError(new Error('boom'))).not.toThrow()
  })

  it('does not throw when apiFetch throws synchronously', () => {
    mockApiFetch.mockImplementation(() => {
      throw new Error('client not configured')
    })

    expect(() => reportClientError(new Error('boom'))).not.toThrow()
  })

  it('handles a non-Error thrown value without throwing', () => {
    expect(() => reportClientError('a bare string')).not.toThrow()
    expect(lastBody()['message']).toBe('a bare string')
  })

  it('sends nothing when there is no usable message', () => {
    reportClientError(new Error(''))

    expect(mockApiFetch).not.toHaveBeenCalled()
  })
})
