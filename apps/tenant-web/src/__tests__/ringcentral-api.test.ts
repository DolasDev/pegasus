// ---------------------------------------------------------------------------
// Unit tests for the RingCentral api module — verifies each wrapper calls
// apiFetch with the right path/method.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/client', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '../api/client'
import {
  listRingCentralConnections,
  disconnectRingCentralConnection,
  connectRingCentral,
} from '../api/ringcentral'

const mockApiFetch = vi.mocked(apiFetch)

describe('ringcentral api', () => {
  it('listRingCentralConnections calls GET /api/v1/integrations/ringcentral/connections', async () => {
    mockApiFetch.mockResolvedValueOnce({ connections: [] })
    const result = await listRingCentralConnections()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/ringcentral/connections')
    expect(result).toEqual({ connections: [] })
  })

  it('disconnectRingCentralConnection calls DELETE /api/v1/integrations/ringcentral/connections/:id', async () => {
    mockApiFetch.mockResolvedValueOnce({ disconnected: true })
    const result = await disconnectRingCentralConnection('conn-1')
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/v1/integrations/ringcentral/connections/conn-1',
      { method: 'DELETE' },
    )
    expect(result).toEqual({ disconnected: true })
  })

  it('connectRingCentral POSTs the credentials to /connections', async () => {
    mockApiFetch.mockResolvedValueOnce({ connectionId: 'conn-9' })
    const input = {
      clientId: 'cid',
      clientSecret: 'secret',
      jwt: 'the-jwt',
      number: '+14155550123',
    }
    const result = await connectRingCentral(input)
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/ringcentral/connections', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    expect(result).toEqual({ connectionId: 'conn-9' })
  })

  it('propagates errors thrown by apiFetch', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('Network error'))
    await expect(listRingCentralConnections()).rejects.toThrow('Network error')
  })
})
