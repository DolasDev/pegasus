import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { TaskService } from '../services/taskService'
import type { DriverTask, DriverTasksMeta } from '../types/tasks'
import { dueCount } from '../utils/tasks'
import { localDay } from '../utils/itinerary'
import { logger } from '../utils/logger'

// ---------------------------------------------------------------------------
// Shared driver To Do state. One fetch backs the To Do screen, the drawer
// badge and the Dashboard "Top 3" card — each load is a legacy read through
// the tunnel, so they must never fetch separately. Loads on mount, on
// `refresh()` (pull-to-refresh, focus of the To Do screen, after an action),
// never on a timer.
// ---------------------------------------------------------------------------

interface TasksContextValue {
  loading: boolean
  tasks: DriverTask[]
  meta: DriverTasksMeta | null
  /** False when the tenant enabled no rule — the To Do is hidden. */
  enabled: boolean
  /** Overdue + today. */
  dueCount: number
  error: string | null
  refresh: () => Promise<void>
}

const TasksContext = createContext<TasksContextValue | undefined>(undefined)

/**
 * `active` = the user is a mapped driver. Off ⇒ no request (the API would only
 * answer 403 DRIVER_NOT_MAPPED).
 */
export function TasksProvider({
  active,
  children,
}: {
  active: boolean
  children: React.ReactNode
}) {
  const [loading, setLoading] = useState(false)
  const [tasks, setTasks] = useState<DriverTask[]>([])
  const [meta, setMeta] = useState<DriverTasksMeta | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!active) return
    setLoading(true)
    setError(null)
    try {
      const res = await TaskService.getMyTasks(localDay())
      setTasks(res.tasks)
      setMeta(res.meta)
    } catch (err) {
      logger.warn('Failed to load driver tasks', err)
      setError(err instanceof Error ? err.message : 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => {
    if (active) void refresh()
    else {
      setTasks([])
      setMeta(null)
    }
  }, [active, refresh])

  const value = useMemo<TasksContextValue>(
    () => ({
      loading,
      tasks,
      meta,
      enabled: active && (meta?.enabledRules.length ?? 0) > 0,
      dueCount: dueCount(tasks),
      error,
      refresh,
    }),
    [loading, tasks, meta, active, error, refresh],
  )
  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}

/** Outside a provider (a screen mounted on its own) the To Do is simply off. */
const OFF: TasksContextValue = {
  loading: false,
  tasks: [],
  meta: null,
  enabled: false,
  dueCount: 0,
  error: null,
  refresh: async () => {},
}

export function useTasks(): TasksContextValue {
  return useContext(TasksContext) ?? OFF
}
