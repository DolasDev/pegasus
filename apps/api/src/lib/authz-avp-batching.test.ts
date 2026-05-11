// Regression: listAllowedPermissions used to issue a single BatchIsAuthorized
// call with one request per ALL_ACTIONS entry. AVP caps the batch at 30
// requests; when the catalog crossed 30 (Order + Event actions in PR #96)
// the call hit ValidationException and the API surfaced INTERNAL_ERROR for
// every /me/permissions hit in staging. The fix splits requests into ≤30
// per call. This test asserts the contract.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type * as VPModule from '@aws-sdk/client-verifiedpermissions'

const sendMock = vi.fn()

vi.mock('@aws-sdk/client-verifiedpermissions', async () => {
  const actual = await vi.importActual<typeof VPModule>('@aws-sdk/client-verifiedpermissions')
  return {
    ...actual,
    VerifiedPermissionsClient: class {
      send(cmd: unknown) {
        return sendMock(cmd)
      }
    },
  }
})

import { ALL_ACTIONS } from '../authz/actions'
import { listAllowedPermissions, _clearAuthzCache } from './authz'

const AVP_BATCH_LIMIT = 30

beforeEach(() => {
  _clearAuthzCache()
  sendMock.mockReset()
  delete process.env['AUTHZ_OFFLINE']
  delete process.env['SKIP_AUTH']
})

describe('listAllowedPermissions — AVP batch chunking', () => {
  it('catalog has more actions than AVP batch limit (else the chunking is dead code)', () => {
    expect(ALL_ACTIONS.length).toBeGreaterThan(AVP_BATCH_LIMIT)
  })

  it('splits requests across multiple BatchIsAuthorized calls, none exceeding 30', async () => {
    sendMock.mockImplementation((cmd: { input: { requests: unknown[] } }) =>
      Promise.resolve({ results: cmd.input.requests.map(() => ({ decision: 'DENY' })) }),
    )

    await listAllowedPermissions(
      { sub: 'sub-batch', tenantId: 'tenant-batch', roleNames: [] },
      undefined,
      'ps-test',
    )

    const expectedChunks = Math.ceil(ALL_ACTIONS.length / AVP_BATCH_LIMIT)
    expect(sendMock).toHaveBeenCalledTimes(expectedChunks)
    for (const call of sendMock.mock.calls) {
      const cmd = call[0] as { input: { requests: unknown[] } }
      expect(cmd.input.requests.length).toBeLessThanOrEqual(AVP_BATCH_LIMIT)
      expect(cmd.input.requests.length).toBeGreaterThan(0)
    }
    const total = sendMock.mock.calls.reduce(
      (n, c) => n + (c[0] as { input: { requests: unknown[] } }).input.requests.length,
      0,
    )
    expect(total).toBe(ALL_ACTIONS.length)
  })

  it('returns only actions whose AVP decision is ALLOW, regardless of which chunk they fell in', async () => {
    // Mark the first action in each chunk ALLOW, rest DENY. Then assert we
    // get exactly that set back — proves we don't drop or re-order results
    // when stitching chunks.
    sendMock.mockImplementation((cmd: { input: { requests: unknown[] } }) =>
      Promise.resolve({
        results: cmd.input.requests.map((_, i) => ({ decision: i === 0 ? 'ALLOW' : 'DENY' })),
      }),
    )

    const perms = await listAllowedPermissions(
      { sub: 'sub-stitch', tenantId: 'tenant-stitch', roleNames: [] },
      undefined,
      'ps-test',
    )

    const expectedChunks = Math.ceil(ALL_ACTIONS.length / AVP_BATCH_LIMIT)
    const expectedPerms = Array.from({ length: expectedChunks }, (_, ci) => {
      const action = ALL_ACTIONS[ci * AVP_BATCH_LIMIT]
      return action?.permission
    }).filter((p): p is string => !!p)
    expect(new Set(perms)).toEqual(new Set(expectedPerms))
  })
})
