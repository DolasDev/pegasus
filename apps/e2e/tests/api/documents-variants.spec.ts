import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

test.describe('Document variant endpoints', () => {
  test('download-url rejects invalid variant param', async ({ apiFetch }) => {
    // Use a random UUID — we only need to exercise validation, not a real doc
    const res = await apiFetch(
      '/api/v1/documents/00000000-0000-0000-0000-000000000001/download-url?variant=huge',
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  test('download-url with variant=original returns 404 for missing doc', async ({ apiFetch }) => {
    const res = await apiFetch(
      '/api/v1/documents/00000000-0000-0000-0000-000000000001/download-url?variant=original',
    )
    expect(res.status).toBe(404)
  })

  test('download-url with variant=thumb returns 404 for missing doc', async ({ apiFetch }) => {
    const res = await apiFetch(
      '/api/v1/documents/00000000-0000-0000-0000-000000000001/download-url?variant=thumb',
    )
    expect(res.status).toBe(404)
  })

  test('entity list includes variants map', async ({ apiFetch }) => {
    const res = await apiFetch(
      '/api/v1/documents/entity/customer/00000000-0000-0000-0000-000000000001',
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toBeInstanceOf(Array)
    expect(body.meta).toHaveProperty('count')

    for (const doc of body.data) {
      expect(doc.variants).toEqual(
        expect.objectContaining({
          thumb: expect.stringMatching(/^(ready|pending|failed|none)$/),
          web: expect.stringMatching(/^(ready|pending|failed|none)$/),
        }),
      )
    }
  })

  test('entity list rejects invalid entity type', async ({ apiFetch }) => {
    const res = await apiFetch(
      '/api/v1/documents/entity/invalid/00000000-0000-0000-0000-000000000001',
    )
    expect(res.status).toBe(400)
  })
})
