import { getApiClient } from '../api/client'
import type { DriverTask, DriverTasksMeta, DriverTasksResponse } from '../types/tasks'

// ---------------------------------------------------------------------------
// Task service — the driver's To Do (`GET /api/v1/me/tasks`), computed by the
// API from their itinerary and the order documents, plus snooze / dismiss.
// A task clears itself once its data arrives; there is no "complete" call.
// ---------------------------------------------------------------------------

const TASKS = '/api/v1/me/tasks'

export class TaskService {
  /** `today` is the device's local day — the API buckets against it. */
  static async getMyTasks(today: string): Promise<DriverTasksResponse> {
    // fetchPaginated keeps `meta` (plain fetch drops it).
    const res = await getApiClient().fetchPaginated<DriverTask>(
      `${TASKS}?today=${encodeURIComponent(today)}`,
    )
    const meta = res.meta as unknown as Partial<DriverTasksMeta> | undefined
    return {
      tasks: res.data ?? [],
      meta: {
        today: meta?.today ?? today,
        from: meta?.from ?? today,
        to: meta?.to ?? today,
        enabledRules: meta?.enabledRules ?? [],
        failedSources: meta?.failedSources ?? [],
        unavailable: meta?.unavailable ?? [],
        hidden: meta?.hidden ?? 0,
      },
    }
  }

  /** Hide one task until `until` (an instant). */
  static async snooze(key: string, until: Date): Promise<void> {
    await getApiClient().fetch(`${TASKS}/state`, {
      method: 'PUT',
      body: JSON.stringify({ key, snoozedUntil: until.toISOString() }),
    })
  }

  /**
   * Mark a task blocked. The first block tells the company's operations users;
   * returns how many were told (0 = nobody holds an operations role).
   * `today` is the device's local day: the server re-checks the task is yours.
   */
  static async block(key: string, reason: string, today: string): Promise<{ notified: number }> {
    const res = await getApiClient().fetch<{ notified?: number }>(`${TASKS}/state`, {
      method: 'PUT',
      body: JSON.stringify({ key, blocked: { reason }, today }),
    })
    return { notified: res?.notified ?? 0 }
  }

  static async unblock(key: string): Promise<void> {
    await getApiClient().fetch(`${TASKS}/state`, {
      method: 'PUT',
      body: JSON.stringify({ key, blocked: null }),
    })
  }
}

/** 6 am local tomorrow — when a "Later" task comes back. */
export function snoozeUntilTomorrow(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 6, 0, 0, 0)
}
