import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { getPermission, type PermissionKind, type PermissionState } from '../services/permissions'

/**
 * A permission's live state, re-read whenever the app returns to the
 * foreground — which is exactly when a driver comes back from flipping the
 * switch in Settings, so every nudge disappears the moment it's fixed.
 * `null` until the first read. Never prompts.
 */
export function usePermission(kind: PermissionKind): {
  state: PermissionState | null
  refresh: () => Promise<void>
  setState: (s: PermissionState) => void
} {
  const [state, setState] = useState<PermissionState | null>(null)

  const refresh = useCallback(async () => {
    try {
      setState(await getPermission(kind))
    } catch {
      setState('notApplicable') // Can't tell — don't nag about it.
    }
  }, [kind])

  useEffect(() => {
    void refresh()
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh()
    })
    return () => sub.remove()
  }, [refresh])

  return { state, refresh, setState }
}
