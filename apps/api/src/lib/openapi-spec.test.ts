import { describe, it, expect } from 'vitest'
import { getOpenApiSpec } from './openapi-spec'

describe('getOpenApiSpec', () => {
  const spec = getOpenApiSpec() as unknown as {
    openapi: string
    paths: Record<string, Record<string, { security?: unknown[] }>>
    components: { securitySchemes?: Record<string, unknown> }
  }

  it('is an OpenAPI 3.1 doc', () => {
    expect(spec.openapi).toBe('3.1.0')
  })

  it('documents the integration-authoring surface (the SDK path)', () => {
    const paths = Object.keys(spec.paths)
    expect(paths).toContain('/api/v1/integrations/floors')
    expect(paths).toContain('/api/v1/integrations/floors/{floorId}')
    expect(paths).toContain('/api/v1/integrations/inbound-schema')
    expect(paths).toContain('/api/v1/integrations/{integrationId}/map-from-external')
    expect(paths).toContain('/api/v1/integrations/{integrationId}/config')
  })

  it('documents the pegII order write beside the read (sdk-feedback 0044 AC1)', () => {
    const order = spec.paths['/api/v1/pegii/orders/{orderId}']
    expect(Object.keys(order ?? {}).sort()).toEqual(['get', 'patch'])
    expect(order?.['patch']?.security).toEqual([{ ApiKeyAuth: [] }])
  })

  it('documents the pegII task create beside the list, and both close forms', () => {
    const tasks = spec.paths['/api/v1/pegii/tasks']
    expect(Object.keys(tasks ?? {}).sort()).toEqual(['get', 'post'])
    expect((tasks?.['post'] as { operationId?: string }).operationId).toBe('createPegiiTask')
    const close = spec.paths['/api/v1/pegii/tasks/close']?.['post'] as
      { description?: string; responses?: Record<string, unknown> } | undefined
    expect(close?.description).toContain('{ taskId } or { orderId, taskType }')
    expect(Object.keys(close?.responses ?? {})).toContain('409')
    expect(JSON.stringify(spec.paths['/api/v1/pegii/tasks'])).not.toContain('stub')
  })

  it('documents the live order search with its required params, and deprecates the list', () => {
    const search = spec.paths['/api/v1/pegii/orders/search']?.['get'] as
      { operationId?: string; parameters?: Array<{ name: string; required: boolean }> } | undefined
    expect(search?.operationId).toBe('searchPegiiOrders')
    const required = (search?.parameters ?? []).filter((p) => p.required).map((p) => p.name)
    expect(required.sort()).toEqual(['dateField', 'from', 'to'])
    expect(spec.paths['/api/v1/pegii/orders']?.['get']).toMatchObject({ deprecated: true })
  })

  it('documents factDocs on the floor contract, so the spec matches what the route serves', () => {
    const props = (
      spec.paths['/api/v1/integrations/floors/{floorId}'] as unknown as {
        get: {
          responses: Record<
            string,
            {
              content?: Record<
                string,
                { schema: { properties: { data: { properties: Record<string, unknown> } } } }
              >
            }
          >
        }
      }
    ).get.responses['200']!.content!['application/json']!.schema.properties.data.properties
    expect(props).toHaveProperty('factCatalog')
    expect(props).toHaveProperty('factDocs')
  })

  it('declares the vnd_ API-key security scheme, applied to the authoring routes', () => {
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth')
    // Public discovery routes carry no security; authoring routes do.
    expect(spec.paths['/api/v1/integrations/floors']?.get?.security).toBeUndefined()
    expect(
      spec.paths['/api/v1/integrations/{integrationId}/map-from-external']?.post?.security,
    ).toEqual([{ ApiKeyAuth: [] }])
  })
})
