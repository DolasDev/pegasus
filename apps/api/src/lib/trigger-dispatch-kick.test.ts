import { describe, it, expect, vi, afterEach } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import {
  KICK_TIMEOUT_MS,
  kickTriggerDispatcher,
  setTriggerDispatcherLambdaClient,
} from './trigger-dispatch-kick'

function stub(send: ReturnType<typeof vi.fn>) {
  setTriggerDispatcherLambdaClient({ send } as unknown as LambdaClient)
}

afterEach(() => {
  delete process.env['TRIGGER_DISPATCHER_FUNCTION_NAME']
  setTriggerDispatcherLambdaClient(null)
  vi.useRealTimers()
})

describe('kickTriggerDispatcher', () => {
  it('is a no-op when the dispatcher is not configured', async () => {
    const send = vi.fn()
    stub(send)
    expect(await kickTriggerDispatcher('sms_received')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('invokes the dispatcher asynchronously with a kick payload', async () => {
    process.env['TRIGGER_DISPATCHER_FUNCTION_NAME'] = 'dispatch-fn'
    const send = vi.fn().mockResolvedValue({ StatusCode: 202 })
    stub(send)
    expect(await kickTriggerDispatcher('run_finished')).toBe(true)
    const cmd = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(cmd.input['FunctionName']).toBe('dispatch-fn')
    expect(cmd.input['InvocationType']).toBe('Event')
    const payload = JSON.parse(new TextDecoder().decode(cmd.input['Payload'] as Uint8Array))
    expect(payload).toEqual({ source: 'kick', reason: 'run_finished' })
  })

  it('never throws: a refused or failed kick just reports false', async () => {
    process.env['TRIGGER_DISPATCHER_FUNCTION_NAME'] = 'dispatch-fn'
    stub(vi.fn().mockResolvedValue({ StatusCode: 500 }))
    expect(await kickTriggerDispatcher('sms_received')).toBe(false)
    stub(vi.fn().mockRejectedValue(new Error('throttled')))
    expect(await kickTriggerDispatcher('sms_received')).toBe(false)
  })

  it('a hung invoke gives up after the timeout instead of holding the caller', async () => {
    vi.useFakeTimers()
    process.env['TRIGGER_DISPATCHER_FUNCTION_NAME'] = 'dispatch-fn'
    const send = vi.fn().mockReturnValue(new Promise(() => {}))
    stub(send)
    const kicked = kickTriggerDispatcher('sms_received')
    await vi.advanceTimersByTimeAsync(KICK_TIMEOUT_MS)
    expect(await kicked).toBe(false)
    // The real SDK call is cancelled too, not just abandoned.
    const opts = send.mock.calls[0]![1] as { abortSignal: AbortSignal }
    expect(opts.abortSignal.aborted).toBe(true)
  })
})
