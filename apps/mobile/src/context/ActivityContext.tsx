import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AppState } from 'react-native'
import { ActivityService } from '../services/activityService'
import { onNotificationReceived } from '../services/pushNotifications'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// The Activity bell's unseen count, shared by the header bell and the Activity
// screen. Refreshes on mount, when the app comes to the foreground, when a push
// arrives while it's open, and on `refresh()` — never on a timer. The count is
// a Postgres read, so this costs no tunnel traffic.
// ---------------------------------------------------------------------------

interface ActivityContextValue {
  unseen: number
  refresh: () => Promise<void>
  /** Clear the bell (opening the Activity screen). */
  markSeen: () => Promise<void>
}

const ActivityContext = createContext<ActivityContextValue | undefined>(undefined)

export function ActivityProvider({ children }: { children: React.ReactNode }) {
  const [unseen, setUnseen] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setUnseen(await ActivityService.unseenCount())
    } catch (err) {
      logger.warn('Failed to load the Activity count', err)
    }
  }, [])

  const markSeen = useCallback(async () => {
    setUnseen(0)
    try {
      await ActivityService.markSeen()
    } catch (err) {
      logger.warn('Failed to mark Activity seen', err)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    const pushes = onNotificationReceived(() => void refresh())
    return () => {
      appState.remove()
      pushes.remove()
    }
  }, [refresh])

  const value = useMemo(() => ({ unseen, refresh, markSeen }), [unseen, refresh, markSeen])
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
}

/** Outside a provider the bell is simply empty. */
const NONE: ActivityContextValue = {
  unseen: 0,
  refresh: async () => {},
  markSeen: async () => {},
}

export function useActivity(): ActivityContextValue {
  return useContext(ActivityContext) ?? NONE
}
