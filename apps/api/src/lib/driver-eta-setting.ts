// ---------------------------------------------------------------------------
// The shared 403 for a driver ETA write on a tenant that has not turned on
// `operations.driverEtaSubmission` (see lib/app-settings.ts). Both ETA write
// routes — the trip activity PATCH and the itinerary act PUT — answer with it,
// so the mobile app shows one message whichever editor the driver used.
// ---------------------------------------------------------------------------

import type { Context } from 'hono'
import type { AppEnv } from '../types'

export const DRIVER_ETA_DISABLED_MESSAGE =
  'Driver ETA submission is turned off for your company. Ask your dispatcher to update the ETA.'

export function driverEtaDisabled(c: Context<AppEnv>) {
  return c.json(
    {
      error: DRIVER_ETA_DISABLED_MESSAGE,
      code: 'DRIVER_ETA_DISABLED',
      correlationId: c.get('correlationId'),
    },
    403,
  )
}
