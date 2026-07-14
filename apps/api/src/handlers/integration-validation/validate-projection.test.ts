// ---------------------------------------------------------------------------
// Tests for the validate endpoint's cached-projection prior-state resolution.
//
// apiClientAuthMiddleware is mocked to a tenant-scoped principal (no DB); the
// projection repository and createTenantDb are mocked; the registry overlay
// warm is a no-op. validateOrder is spied (transform stays real) so we can
// assert exactly what `prior` the resolver fed into the validator.
//
// The demo_partner fixture maps serviceOrderNumber from
// InvolvedParties.ShipperEmployer.Identity.Description, so the derived
// projection key is "O-60232".
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import type { ApiClientEnv } from '../../types'
import type * as RegistryModule from '../../integration-validation/registry'
import type * as ValidateModule from '../../integration-validation/validate'

import type { ValidationInput } from '../../integration-validation/types'

const { mockFindState, captured, authState } = vi.hoisted(() => ({
  mockFindState: vi.fn(),
  captured: { input: undefined as ValidationInput | undefined },
  authState: { tenantId: 't1' as string | null },
}))

vi.mock('../../middleware/api-client-auth', () => ({
  apiClientAuthMiddleware: vi.fn(async (c: Context<ApiClientEnv>, next: Next) => {
    c.set('tenantId', authState.tenantId)
    c.set('apiClient', {
      id: 'ac1',
      tenantId: authState.tenantId,
      roleNames: ['workflow_runtime'],
    } as unknown as ApiClientEnv['Variables']['apiClient'])
    await next()
  }),
}))

vi.mock('../../lib/prisma', () => ({ createTenantDb: vi.fn(() => ({})) }))

vi.mock('../../repositories/integration-projection.repository', () => ({
  createIntegrationProjectionRepository: vi.fn(() => ({ findState: mockFindState })),
}))

// Resolve to the real built-in definition without touching the DB, so the test
// exercises the projection resolver (not tenant-config resolution).
vi.mock('../../integration-validation/registry', async (importActual) => {
  const actual = await importActual<typeof RegistryModule>()
  return {
    ...actual,
    resolveIntegrationDefinition: vi.fn(async (_db: unknown, id: string) =>
      actual.getBuiltInDefinition(id),
    ),
  }
})

vi.mock('../../integration-validation/validate', async (importActual) => {
  const actual = await importActual<typeof ValidateModule>()
  return {
    ...actual,
    validateWithDefinition: vi.fn(
      (def: Parameters<typeof actual.validateWithDefinition>[0], input: ValidationInput) => {
        captured.input = input
        return actual.validateWithDefinition(def, input)
      },
    ),
  }
})

import { integrationValidationHandler } from './validate'

const PATH = '/api/v1/integrations/demo_partner/validate'

const validDemoPartnerOrder = {
  Id: 'SHIP-1',
  InvolvedParties: {
    ShipperEmployer: { Identity: { Description: 'O-60232' } },
    Coordinator: {
      Identity: { Description: 'Suzanne Polo' },
      EmailAddress: 'noreply@demopartner.example',
    },
  },
  Survey: { SerivceStatus: 'Accepted', Storage1stDay: 100, GeneralComments: 'ok' },
  DocumentationDates: ['2024-05-25'],
  KeyMoveDates: { Survey: { Planned: '2024-05-25' } },
  Financials: { EstimatedWeight: 5000, ActualWeight: null },
}

function post(body: unknown) {
  const app = new Hono<{ Variables: { correlationId: string } }>()
  app.use('*', async (c, next) => {
    c.set('correlationId', 'corr-1')
    await next()
  })
  app.route('/api/v1', integrationValidationHandler)
  return app.request(PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer vnd_x' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.input = undefined
  authState.tenantId = 't1'
})

describe('validate — cached-projection prior resolution', () => {
  it('loads the cached projection as prior when the body omits prior', async () => {
    const cachedState = { ...validDemoPartnerOrder, Survey: { SerivceStatus: 'Submitted' } }
    mockFindState.mockResolvedValue(cachedState)

    const res = await post({ action: 'save', order: validDemoPartnerOrder })
    expect(res.status).toBe(200)
    expect(mockFindState).toHaveBeenCalledWith('demo_partner', 'order', 'O-60232')
    expect(captured.input?.prior).toEqual(cachedState)
  })

  it('does not apply a prior when the cache misses', async () => {
    mockFindState.mockResolvedValue(null)
    const res = await post({ action: 'save', order: validDemoPartnerOrder })
    expect(res.status).toBe(200)
    expect(mockFindState).toHaveBeenCalled()
    expect(captured.input?.prior).toBeUndefined()
  })

  it('an explicit prior in the body wins and skips the cache lookup', async () => {
    const explicitPrior = { ...validDemoPartnerOrder, Survey: { SerivceStatus: 'Accepted' } }
    const res = await post({ action: 'save', order: validDemoPartnerOrder, prior: explicitPrior })
    expect(res.status).toBe(200)
    expect(mockFindState).not.toHaveBeenCalled()
    expect(captured.input?.prior).toEqual(explicitPrior)
  })

  it('skips the lookup entirely for a platform-scoped key (null tenant)', async () => {
    authState.tenantId = null
    const res = await post({ action: 'save', order: validDemoPartnerOrder })
    expect(res.status).toBe(200)
    expect(mockFindState).not.toHaveBeenCalled()
    expect(captured.input?.prior).toBeUndefined()
  })
})
