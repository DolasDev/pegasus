// ---------------------------------------------------------------------------
// "Jump to order" — opens an order in the locally-installed Pegasus desktop
// app via a custom URI protocol (e.g. pegasus-desktop://order/123).
//
// In the legacy system a co-located Electron app used named-pipe IPC to tell
// the running WinForms app to open an order. A browser SPA can't do that; the
// equivalent is a custom URI scheme that Windows routes to the registered
// desktop app (works for both classic and MSIX installs). The desktop app
// registers the scheme and authorises the id — see the handoff in the plan.
//
// The browser gives no success/failure callback for a protocol launch, so the
// flow is optimistic: show success, navigate, then a neutral "didn't open?"
// hint. Feature is config-gated and default-off, so it's inert until a
// deployment's desktop app registers the scheme.
// ---------------------------------------------------------------------------

import { getConfig } from '@/config'
import { notify, notifyError, notifySuccess } from '../components/Snackbar/notify'

/** Returns true when jump-to-order is configured + enabled for this deployment. */
export function isJumpToOrderEnabled(): boolean {
  try {
    return getConfig().features.jumpToOrder.enabled === true
  } catch {
    // Config not loaded (e.g. isolated unit tests) — treat as disabled.
    return false
  }
}

/**
 * Coerces an order number to a safe positive integer, or null if invalid.
 * Security boundary: only digits reach the URI, so no injection is possible.
 */
export function normalizeOrderNum(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) {
    return null
  }
  return n
}

/** Builds the protocol URL. Caller must have validated `orderNum` already. */
export function buildOrderUri(scheme: string, orderNum: number): string {
  return `${scheme}://order/${orderNum}`
}

/**
 * Launches the desktop app to open the given order. Fire-and-forget — the
 * browser cannot confirm whether the app opened.
 */
export function jumpToOrder(args: { order_num: unknown }): void {
  let cfg
  try {
    cfg = getConfig().features.jumpToOrder
  } catch {
    cfg = null
  }

  if (!cfg || cfg.enabled !== true) {
    notifyError('Opening orders in the desktop app is not enabled for this site.')
    return
  }

  const orderNum = normalizeOrderNum(args?.order_num)
  if (orderNum === null) {
    notifyError('Cannot open order: invalid order number.')
    return
  }

  const uri = buildOrderUri(cfg.scheme, orderNum)

  // Optimistic — a registered scheme hands off to the OS and leaves this SPA
  // mounted; an unregistered scheme is a silent no-op in modern browsers.
  notifySuccess(`Opening order ${orderNum} in Pegasus…`)
  try {
    window.location.assign(uri)
  } catch {
    notifyError('Could not open the desktop app.')
    return
  }

  // Soft follow-up (NOT an error toast — the browser can't tell us whether the
  // app actually opened, so this stays neutral and guides a retry).
  window.setTimeout(() => {
    notify(
      'Could not open Pegasus desktop app. Make sure the Pegasus desktop app is open and try again.',
    )
  }, 2500)
}
