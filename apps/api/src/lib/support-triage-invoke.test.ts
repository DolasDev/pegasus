import { describe, it, expect, vi, afterEach } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import {
  invokeSupportTriage,
  isSupportTriageEvent,
  setSupportTriageLambdaClient,
} from './support-triage-invoke'

function stub(send: ReturnType<typeof vi.fn>) {
  setSupportTriageLambdaClient({ send } as unknown as LambdaClient)
}

afterEach(() => {
  delete process.env['SUPPORT_TRIAGE_FUNCTION_NAME']
  setSupportTriageLambdaClient(null)
})

describe('invokeSupportTriage', () => {
  it('is a no-op when no worker is configured', async () => {
    const send = vi.fn()
    stub(send)
    expect(await invokeSupportTriage('d1')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('invokes the worker asynchronously with the draft id', async () => {
    process.env['SUPPORT_TRIAGE_FUNCTION_NAME'] = 'triage-fn'
    const send = vi.fn().mockResolvedValue({ StatusCode: 202 })
    stub(send)
    expect(await invokeSupportTriage('d1')).toBe(true)
    const cmd = send.mock.calls[0]![0] as {
      input: { Payload: Uint8Array } & Record<string, unknown>
    }
    expect(cmd.input['FunctionName']).toBe('triage-fn')
    expect(cmd.input['InvocationType']).toBe('Event')
    expect(JSON.parse(Buffer.from(cmd.input.Payload).toString())).toEqual({ draftId: 'd1' })
  })

  it('never throws: a refused or failed invoke reports false', async () => {
    process.env['SUPPORT_TRIAGE_FUNCTION_NAME'] = 'triage-fn'
    stub(vi.fn().mockResolvedValue({ StatusCode: 500 }))
    expect(await invokeSupportTriage('d1')).toBe(false)
    stub(vi.fn().mockRejectedValue(new Error('AccessDenied')))
    expect(await invokeSupportTriage('d1')).toBe(false)
  })
})

describe('isSupportTriageEvent', () => {
  it('accepts only { draftId: string }', () => {
    expect(isSupportTriageEvent({ draftId: 'd1' })).toBe(true)
    expect(isSupportTriageEvent({ draftId: 1 })).toBe(false)
    expect(isSupportTriageEvent(null)).toBe(false)
    expect(isSupportTriageEvent('d1')).toBe(false)
  })
})
