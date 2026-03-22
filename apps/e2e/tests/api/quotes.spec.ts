import { test, expect } from '../../fixtures'

test.skip(!!process.env['E2E_SKIP'], 'Postgres unavailable — skipping E2E tests')

test('POST /api/v1/quotes creates a quote for a move', async ({ apiFetch }) => {
  // First create a move to attach the quote to
  const moveRes = await apiFetch('/api/v1/moves', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'e2e-user',
      scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      origin: {
        line1: '100 Origin St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        country: 'US',
      },
      destination: {
        line1: '200 Destination Ave',
        city: 'Shelbyville',
        state: 'IL',
        postalCode: '62565',
        country: 'US',
      },
    }),
  })
  expect(moveRes.status).toBe(201)
  const moveBody = await moveRes.json()
  const moveId: string = moveBody.data.id

  // Now create a quote for that move
  const quoteRes = await apiFetch('/api/v1/quotes', {
    method: 'POST',
    body: JSON.stringify({
      moveId,
      priceAmount: 1500.0,
      priceCurrency: 'USD',
      validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
      lineItems: [
        {
          description: 'Loading & unloading',
          quantity: 4,
          unitPrice: 375.0,
        },
      ],
    }),
  })
  expect(quoteRes.status).toBe(201)
  const quoteBody = await quoteRes.json()
  expect(typeof quoteBody.data.id).toBe('string')
  expect(quoteBody.data.moveId).toBe(moveId)
})

test('GET /api/v1/quotes returns a list', async ({ apiFetch }) => {
  const res = await apiFetch('/api/v1/quotes')
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(Array.isArray(body.data)).toBe(true)
  expect(typeof body.meta.count).toBe('number')
})
