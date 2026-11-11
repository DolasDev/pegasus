// Unit tests for the event-routed signal rules (pure; no I/O).

import { describe, expect, it } from 'vitest'
import {
  correlatedTemporalWorkflowId,
  correlationPathError,
  extractCorrelationKey,
  signalBindingError,
} from './workflow-signal-routing'

const envelope = {
  domainEventId: 'evt-1',
  eventType: 'pegii.shipment.opened',
  occurredAt: '2026-11-10T12:00:00.000Z',
  payload: { orderId: 'O-123', nested: { id: 7 }, list: [1], empty: null, flag: true },
}

describe('correlationPathError', () => {
  it.each(['payload.orderId', 'payload.nested.id', 'domainEventId', 'eventType'])(
    'accepts %s',
    (path) => expect(correlationPathError(path)).toBeNull(),
  )

  it.each(['', 'orderId', 'payload..x', 'payload.order-id', 'payload.1st', 'a.b.c.d.e.f.g.h.i'])(
    'refuses %j',
    (path) => expect(correlationPathError(path)).not.toBeNull(),
  )
})

describe('extractCorrelationKey', () => {
  it('reads a string, and normalizes an integer', () => {
    expect(extractCorrelationKey(envelope, 'payload.orderId')).toEqual({ ok: true, key: 'O-123' })
    expect(extractCorrelationKey(envelope, 'payload.nested.id')).toEqual({ ok: true, key: '7' })
    expect(extractCorrelationKey(envelope, 'domainEventId')).toEqual({ ok: true, key: 'evt-1' })
  })

  it('MISSING for an absent path, a null value, or a path through a non-object', () => {
    for (const path of [
      'payload.nope',
      'payload.empty',
      'payload.orderId.deeper',
      'payload.list.0',
    ]) {
      expect(extractCorrelationKey(envelope, path)).toEqual({ ok: false, reason: 'MISSING' })
    }
  })

  it('INVALID for a non-string/integer value or an unsafe key', () => {
    const bad = (payload: unknown) =>
      extractCorrelationKey({ ...envelope, payload: { k: payload } }, 'payload.k')
    for (const value of [true, 1.5, { a: 1 }, [1], '', 'has space', 'a/b', 'x'.repeat(129)]) {
      expect(bad(value)).toEqual({ ok: false, reason: 'INVALID' })
    }
  })

  it('never reads inherited properties', () => {
    expect(extractCorrelationKey(envelope, 'payload.constructor')).toEqual({
      ok: false,
      reason: 'MISSING',
    })
  })
})

describe('correlatedTemporalWorkflowId', () => {
  it('uses the wfl/ prefix no other start path mints', () => {
    expect(correlatedTemporalWorkflowId('t-1', 'order_lifecycle', 'O-123')).toBe(
      'wfl/t-1/order_lifecycle/O-123',
    )
  })
})

describe('signalBindingError', () => {
  const durable = {
    name: 'order_lifecycle',
    executable: true,
    kind: 'WORKFLOW',
    manifest: { signals: ['order_event'] },
  }
  const start = {
    kind: 'EVENT' as const,
    mode: 'START' as const,
    correlationPath: 'payload.orderId',
    signalName: 'order_event',
  }

  it('accepts a complete START / DELIVER binding on a durable Workflow', () => {
    expect(signalBindingError(start, durable)).toBeNull()
    expect(signalBindingError({ ...start, mode: 'DELIVER' }, durable)).toBeNull()
  })

  it('NEW takes neither field', () => {
    expect(signalBindingError({ kind: 'EVENT', mode: 'NEW' }, durable)).toBeNull()
    expect(
      signalBindingError({ kind: 'EVENT', mode: 'NEW', signalName: 'order_event' }, durable),
    ).toMatch(/only valid with mode START or DELIVER/)
  })

  it.each([
    [{ ...start, kind: 'SCHEDULE' as const }, durable, /only valid for EVENT/],
    [start, { ...durable, kind: 'AUTOMATION' }, /needs a durable Workflow/],
    [start, { ...durable, executable: false }, /needs a durable Workflow/],
    [{ ...start, correlationPath: null }, durable, /requires a correlationPath/],
    [{ ...start, correlationPath: 'orderId' }, durable, /must start at an event-envelope field/],
    [{ ...start, signalName: undefined }, durable, /requires a signalName/],
    [{ ...start, signalName: 'other' }, durable, /not declared .*declared: order_event/],
  ])('refuses %#', (trigger, workflow, message) => {
    expect(signalBindingError(trigger, workflow)).toMatch(message)
  })
})
