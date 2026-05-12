// Bridge so non-React modules (e.g. utils/api/index.ts) can surface a
// notification through the active <SnackbarProvider>. The provider registers
// its push fn on mount; if no provider is mounted (tests, modules used in
// isolation) the call falls back to console.error so we don't swallow errors.
import type React from 'react'
import type { PushOptions } from './SnackbarProvider'

type PushFn = (message: React.ReactNode, options?: PushOptions) => void

let registered: PushFn | null = null

export function registerSnackbarPush(fn: PushFn | null) {
  registered = fn
}

export function notify(message: React.ReactNode, options?: PushOptions) {
  if (registered) {
    registered(message, options)
    return
  }
  if (options?.type === 'error') {
    console.error('[snackbar:fallback]', message)
  } else {
    console.log('[snackbar:fallback]', message)
  }
}

export const notifyError = (message: React.ReactNode) => notify(message, { type: 'error' })
export const notifySuccess = (message: React.ReactNode) => notify(message, { type: 'success' })
