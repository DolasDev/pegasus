import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LambdaClient } from '@aws-sdk/client-lambda'
import {
  invokeTemporalProvisioner,
  setTemporalProvisionerLambdaClient,
  temporalProvisionerFunctionName,
} from '../temporal-provisioner-invoke'

const send = vi.fn()

beforeEach(() => {
  send.mockReset()
  setTemporalProvisionerLambdaClient({ send } as unknown as LambdaClient)
  process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME'] = 'pegasus-staging-provisioner'
})

afterEach(() => {
  setTemporalProvisionerLambdaClient(null)
  delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
})

describe('temporal-provisioner invoke', () => {
  it('reports not configured when the function name is unset', () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    expect(temporalProvisionerFunctionName()).toBeNull()
  })

  it('invokes asynchronously (InvocationType Event) with the JSON event', async () => {
    send.mockResolvedValue({ StatusCode: 202 })
    await invokeTemporalProvisioner({ action: 'provision', tenantId: 't-1' })
    const input = send.mock.calls[0]![0].input
    expect(input.FunctionName).toBe('pegasus-staging-provisioner')
    expect(input.InvocationType).toBe('Event')
    expect(JSON.parse(Buffer.from(input.Payload).toString('utf8'))).toEqual({
      action: 'provision',
      tenantId: 't-1',
    })
  })

  it('throws on a non-202 status', async () => {
    send.mockResolvedValue({ StatusCode: 500 })
    await expect(invokeTemporalProvisioner({ action: 'rotate', tenantId: 't' })).rejects.toThrow(
      /500/,
    )
  })

  it('throws without a function name, before calling Lambda', async () => {
    delete process.env['TEMPORAL_PROVISIONER_FUNCTION_NAME']
    await expect(
      invokeTemporalProvisioner({ action: 'deprovision', tenantId: 't' }),
    ).rejects.toThrow(/not set/)
    expect(send).not.toHaveBeenCalled()
  })
})
