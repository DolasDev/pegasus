// ---------------------------------------------------------------------------
// Longhaul remote handler — Windows-only remote function calls
// ---------------------------------------------------------------------------

import { Hono } from 'hono'
import type { OnPremEnv } from '../../types.onprem'

export const remoteRouter = new Hono<OnPremEnv>()

remoteRouter.post('/remote/jump-to-order', async (c) => {
  // This feature requires a Windows desktop environment. It is not available
  // when running as a cross-platform HTTP service.
  if (process.platform !== 'win32') {
    return c.json(
      {
        error: 'Remote function calls are only supported on Windows deployments',
        code: 'NOT_IMPLEMENTED',
        correlationId: c.get('correlationId'),
      },
      501,
    )
  }

  // Windows path: placeholder — implement native IPC call here when needed
  return c.json(
    {
      error: 'Remote function calls are not yet implemented',
      code: 'NOT_IMPLEMENTED',
      correlationId: c.get('correlationId'),
    },
    501,
  )
})
