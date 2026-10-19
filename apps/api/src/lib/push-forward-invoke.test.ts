import { describe, it, expect, vi, afterEach } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import { kickPushForwarder, setPushForwarderLambdaClient } from './push-forward-invoke'

function stub(send: ReturnType<typeof vi.fn>) {
  setPushForwarderLambdaClient({ send } as unknown as LambdaClient)
}

afterEach(() => {
  delete process.env['PUSH_FORWARD_FUNCTION_NAME']
  setPushForwarderLambdaClient(null)
})

describe('kickPushForwarder', () => {
  it('is a no-op when the forwarder is not configured', async () => {
    const send = vi.fn()
    stub(send)
    expect(await kickPushForwarder()).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('invokes the forwarder asynchronously', async () => {
    process.env['PUSH_FORWARD_FUNCTION_NAME'] = 'push-fwd'
    const send = vi.fn().mockResolvedValue({ StatusCode: 202 })
    stub(send)
    expect(await kickPushForwarder()).toBe(true)
    const cmd = send.mock.calls[0]![0] as { input: Record<string, unknown> }
    expect(cmd.input).toEqual({ FunctionName: 'push-fwd', InvocationType: 'Event' })
  })

  it('never throws: a refused or failed kick just reports false', async () => {
    process.env['PUSH_FORWARD_FUNCTION_NAME'] = 'push-fwd'
    stub(vi.fn().mockResolvedValue({ StatusCode: 500 }))
    expect(await kickPushForwarder()).toBe(false)
    stub(vi.fn().mockRejectedValue(new Error('throttled')))
    expect(await kickPushForwarder()).toBe(false)
  })
})
