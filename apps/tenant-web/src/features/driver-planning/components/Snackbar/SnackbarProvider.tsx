import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { Snackbar } from './index'
import { registerSnackbarPush } from './notify'

export type SnackbarType = 'success' | 'error' | undefined

export interface SnackbarMessage {
  id: number
  message: React.ReactNode
  type?: SnackbarType
  autoHideDuration?: number
}

export interface PushOptions {
  type?: SnackbarType
  autoHideDuration?: number
}

interface SnackbarContextValue {
  push: (message: React.ReactNode, options?: PushOptions) => void
  pushSuccess: (message: React.ReactNode, options?: Omit<PushOptions, 'type'>) => void
  pushError: (message: React.ReactNode, options?: Omit<PushOptions, 'type'>) => void
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null)

const DEFAULT_DURATION = 5000

let nextId = 1

export const SnackbarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<SnackbarMessage[]>([])

  const dismiss = useCallback((id: number) => {
    setQueue((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const push = useCallback((message: React.ReactNode, options?: PushOptions) => {
    const entry: SnackbarMessage = {
      id: nextId++,
      message,
      ...(options?.type !== undefined ? { type: options.type } : {}),
      autoHideDuration: options?.autoHideDuration ?? DEFAULT_DURATION,
    }
    setQueue((prev) => [...prev, entry])
  }, [])

  const value = useMemo<SnackbarContextValue>(
    () => ({
      push,
      pushSuccess: (message, options) =>
        push(message, { ...(options ?? {}), type: 'success' }),
      pushError: (message, options) =>
        push(message, { ...(options ?? {}), type: 'error' }),
    }),
    [push],
  )

  useEffect(() => {
    registerSnackbarPush(push)
    return () => registerSnackbarPush(null)
  }, [push])

  // Render the most-recent message; older messages auto-dismiss in turn.
  const current = queue[queue.length - 1]

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {current ? (
        <Snackbar
          key={current.id}
          open={true}
          message={current.message}
          type={current.type}
          autoHideDuration={current.autoHideDuration}
          onClose={() => dismiss(current.id)}
        />
      ) : null}
    </SnackbarContext.Provider>
  )
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext)
  if (!ctx) {
    throw new Error('useSnackbar must be used within a <SnackbarProvider>')
  }
  return ctx
}
