// ---------------------------------------------------------------------------
// Unit tests for the integrations API wrappers added for the Developer tab —
// verifies each calls apiFetch with the right path, method, and query. Mirrors
// api-clients.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api/client', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '../api/client'
import { listIntegrationFloors, deleteIntegrationConfig } from '../api/integrations'

const mockApiFetch = vi.mocked(apiFetch)

beforeEach(() => vi.clearAllMocks())

describe('listIntegrationFloors', () => {
  it('calls GET /api/v1/integrations/floors', async () => {
    mockApiFetch.mockResolvedValueOnce([])
    await listIntegrationFloors()
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/floors')
  })
})

describe('deleteIntegrationConfig', () => {
  it('calls DELETE on the config path with no query by default', async () => {
    mockApiFetch.mockResolvedValueOnce({ integrationId: 'x', visibility: 'TENANT', deleted: 2 })
    const result = await deleteIntegrationConfig('sirva_ade_shipment')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/sirva_ade_shipment/config', {
      method: 'DELETE',
    })
    expect(result.deleted).toBe(2)
  })

  it('omits the force query when force is false', async () => {
    // `?force=true` is a platform-tenant escape hatch past the dependents guard;
    // a tenant deleting its own overlay must never send it implicitly.
    mockApiFetch.mockResolvedValueOnce({ integrationId: 'x', visibility: 'TENANT', deleted: 1 })
    await deleteIntegrationConfig('x', { force: false })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/x/config', {
      method: 'DELETE',
    })
  })

  it('adds ?force=true when asked', async () => {
    mockApiFetch.mockResolvedValueOnce({ integrationId: 'x', visibility: 'GLOBAL', deleted: 3 })
    await deleteIntegrationConfig('x', { force: true })
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/x/config?force=true', {
      method: 'DELETE',
    })
  })

  it('encodes an id that needs escaping', async () => {
    mockApiFetch.mockResolvedValueOnce({ integrationId: 'a/b', visibility: 'TENANT', deleted: 1 })
    await deleteIntegrationConfig('a/b')
    expect(mockApiFetch).toHaveBeenCalledWith('/api/v1/integrations/a%2Fb/config', {
      method: 'DELETE',
    })
  })
})
