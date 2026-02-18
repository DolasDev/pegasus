import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { Move } from '@pegasus/domain'

const app = new Hono()

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use('*', logger())
app.use('*', cors())

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', (c) => {
  return c.json({ status: 'ok' as const, timestamp: new Date().toISOString() })
})

app.get('/moves', (c) => {
  // Stub — real implementation will query via Prisma
  const moves: Move[] = []
  return c.json({ moves, total: moves.length })
})

app.get('/moves/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ move: null, id }, 404)
})

// ---------------------------------------------------------------------------
// 404 fallback
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found' }, 404))

export { app }
