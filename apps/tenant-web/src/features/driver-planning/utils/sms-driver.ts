// ---------------------------------------------------------------------------
// "Text driver" — opens an SMS conversation with a driver in the locally-
// installed Pegasus desktop app via the same custom URI protocol the
// jump-to-order flow uses (e.g. pegasus-desktop://sms/driver/ABC123).
//
// Reuses the `features.jumpToOrder` config block on purpose: the desktop app
// and scheme are the same — the flag just gates whether protocol launches
// happen at all on this deployment. The browser cannot tell us whether the
// app actually opened, so the UX mirrors jump-to-order: optimistic success
// toast, then a neutral "didn't open?" follow-up.
// ---------------------------------------------------------------------------

import { getConfig } from '@/config'
import { notify, notifyError, notifySuccess } from '../components/Snackbar/notify'

// Driver codes are short alphanumeric tokens from the on-prem system. Restrict
// to safe characters so nothing path-injectable can reach the URI.
const CODE_RE = /^[A-Za-z0-9._-]{1,32}$/

/** Returns a safe driver code or null if the input is missing / unsafe. */
export function normalizeDriverCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return CODE_RE.test(v) ? v : null
}

/** Builds the protocol URL. Caller must have validated `code` already. */
export function buildDriverSmsUri(scheme: string, code: string): string {
  return `${scheme}://sms/driver/${code}`
}

/**
 * Launches the desktop app to start a text message to the given driver.
 * Fire-and-forget — the browser cannot confirm whether the app opened.
 */
export function smsDriver(args: { driver_code: unknown }): void {
  let cfg
  try {
    cfg = getConfig().features.jumpToOrder
  } catch {
    cfg = null
  }

  if (!cfg || cfg.enabled !== true) {
    notifyError('Texting drivers from the desktop app is not enabled for this site.')
    return
  }

  const code = normalizeDriverCode(args?.driver_code)
  if (code === null) {
    notifyError('Cannot text driver: missing or invalid driver code.')
    return
  }

  const uri = buildDriverSmsUri(cfg.scheme, code)

  // Optimistic — same pattern as jump-to-order.
  notifySuccess(`Opening message to driver ${code}…`)
  try {
    window.location.assign(uri)
  } catch {
    notifyError('Could not open the desktop app.')
    return
  }

  window.setTimeout(() => {
    notify(
      'Could not open Pegasus desktop app. Make sure the Pegasus desktop app is open and try again.',
    )
  }, 2500)
}
