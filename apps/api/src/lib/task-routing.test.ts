import { describe, it, expect } from 'vitest'
import {
  OPERATIONS_TASK_ROLE,
  TASK_ROLES,
  isTaskRole,
  resolveTaskStore,
  taskStoreForId,
} from './task-routing'

describe('resolveTaskStore (Phase 3a D3)', () => {
  it('a role-less task is legacy, whatever the routing says (Pulse is untouched)', () => {
    expect(resolveTaskStore(undefined, undefined)).toBe('legacy')
    expect(resolveTaskStore({ coordinator: 'cloud' }, undefined)).toBe('legacy')
  })

  it('a routed role goes to the store its entry names', () => {
    const routing = { operations: 'cloud', coordinator: 'legacy' } as const
    expect(resolveTaskStore(routing, 'operations')).toBe('cloud')
    expect(resolveTaskStore(routing, 'coordinator')).toBe('legacy')
  })

  it('a role with no entry falls back to legacy (the cloud is opt-in per role)', () => {
    expect(resolveTaskStore({ operations: 'cloud' }, 'coordinator')).toBe('legacy')
    expect(resolveTaskStore(null, 'operations')).toBe('legacy')
    expect(resolveTaskStore({}, 'driver')).toBe('legacy')
  })
})

describe('taskStoreForId (guardrail 3)', () => {
  it('UUIDs are cloud, pegII ints are legacy, anything else is no store', () => {
    expect(taskStoreForId('2b916653-df32-438d-a885-e9aedae40286')).toBe('cloud')
    expect(taskStoreForId('77')).toBe('legacy')
    expect(taskStoreForId('0')).toBeNull()
    expect(taskStoreForId('9999999999')).toBeNull()
    expect(taskStoreForId('task_490317_pack')).toBeNull()
    expect(taskStoreForId('')).toBeNull()
  })
})

describe('TASK_ROLES (D1)', () => {
  it('is `operations` plus the Cedar role groups', () => {
    expect(TASK_ROLES[0]).toBe(OPERATIONS_TASK_ROLE)
    expect(isTaskRole('operations')).toBe(true)
    expect(isTaskRole('coordinator')).toBe(true)
    expect(isTaskRole('operations_admin')).toBe(true)
    expect(isTaskRole('OPS')).toBe(false)
    expect(isTaskRole('')).toBe(false)
  })
})
