import { describe, it, expect } from 'vitest'
import { getOpenApiSpec } from '../openapi-spec'

describe('getOpenApiSpec', () => {
  const spec = getOpenApiSpec()

  it('uses OpenAPI 3.1.0', () => {
    expect(spec.openapi).toBe('3.1.0')
  })

  it('has paths["/health"]', () => {
    expect(spec.paths['/health']).toBeDefined()
  })

  it('has paths["/api/v1/customers"]', () => {
    expect(spec.paths['/api/v1/customers']).toBeDefined()
  })

  it('has components.schemas.Customer', () => {
    expect(spec.components.schemas.Customer).toBeDefined()
  })
})
