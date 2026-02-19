import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { customersHandler } from './handlers/customers'
import { quotesHandler } from './handlers/quotes'
import { movesHandler } from './handlers/moves'
import { inventoryHandler } from './handlers/inventory'
import { billingHandler } from './handlers/billing'

const app = new Hono()

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use('*', logger())
app.use('*', cors())

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (c) => {
  return c.json({ status: 'ok' as const, timestamp: new Date().toISOString() })
})

// ---------------------------------------------------------------------------
// Bounded-context routers
// ---------------------------------------------------------------------------
app.route('/customers', customersHandler)
app.route('/quotes', quotesHandler)
app.route('/moves', movesHandler)
// Inventory routes are nested under /moves (e.g. /moves/:moveId/rooms)
app.route('/moves', inventoryHandler)
app.route('/invoices', billingHandler)

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404))

export { app }
