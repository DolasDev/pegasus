// Unit tests for the ingress helpers (sdk-feedback 0021): dedup derivation,
// ack template rendering, and inbound-config parsing.

import { describe, it, expect } from 'vitest'
import {
  parseInboundConfig,
  deriveDedupId,
  renderAck,
  successAck,
  failureAck,
  validateInboundBody,
  defaultEventType,
} from './ingress'

describe('parseInboundConfig', () => {
  it('reads the known fields, ignores the rest', () => {
    const cfg = parseInboundConfig({
      eventType: 'sirva_ade.shipment.event',
      dedupKeyPath: 'Events.0.Id',
      ackTemplate: { success: { ok: true } },
      junk: 1,
    })
    expect(cfg.eventType).toBe('sirva_ade.shipment.event')
    expect(cfg.dedupKeyPath).toBe('Events.0.Id')
    expect(cfg.ackTemplate?.success).toEqual({ ok: true })
  })
  it('returns empty for a non-object', () => {
    expect(parseInboundConfig(null)).toEqual({})
    expect(parseInboundConfig('x')).toEqual({})
  })
})

describe('deriveDedupId', () => {
  it('uses a resolved dot-path scalar', () => {
    expect(deriveDedupId({ Events: [{ Id: 'E-1' }] }, 'Events.0.Id')).toBe('E-1')
    expect(deriveDedupId({ Id: 42 }, 'Id')).toBe('42')
  })
  it('falls back to a body hash when the path is absent', () => {
    const id = deriveDedupId({ a: 1 }, 'Missing.Path')
    expect(id).toMatch(/^sha256:/)
    // Stable for an identical body (redelivery dedups).
    expect(deriveDedupId({ a: 1 }, 'Missing.Path')).toBe(id)
    // Different body → different id.
    expect(deriveDedupId({ a: 2 }, 'Missing.Path')).not.toBe(id)
  })
  it('hashes when no path configured', () => {
    expect(deriveDedupId({ a: 1 }, undefined)).toMatch(/^sha256:/)
  })
})

describe('renderAck', () => {
  it('substitutes {{key}} preserving type', () => {
    const out = renderAck(
      { Result: { Results: '{{status}}', Count: '{{errorCount}}', Msg: '{{messages}}' } },
      { status: 'Failed', errorCount: 2, messages: ['a', 'b'] },
    )
    expect(out).toEqual({ Result: { Results: 'Failed', Count: 2, Msg: ['a', 'b'] } })
  })
  it('passes through non-placeholder strings and literals', () => {
    expect(renderAck({ a: 'literal', b: 5 }, {})).toEqual({ a: 'literal', b: 5 })
  })
})

describe('successAck / failureAck', () => {
  it('renders the ADE Success envelope from a published template', () => {
    const cfg = parseInboundConfig({
      ackTemplate: {
        success: {
          Result: { Results: 'Success', ResultsMessageCount: 0, ResultsMessage: [] },
        },
      },
    })
    expect(successAck(cfg)).toEqual({
      Result: { Results: 'Success', ResultsMessageCount: 0, ResultsMessage: [] },
    })
  })
  it('renders the ADE Failed envelope with the error count/messages', () => {
    const cfg = parseInboundConfig({
      ackTemplate: {
        failure: {
          Result: {
            Results: 'Failed',
            ResultsMessageCount: '{{errorCount}}',
            ResultsMessage: '{{messages}}',
          },
        },
      },
    })
    expect(failureAck(cfg, [{ code: 'MALFORMED_BODY', message: 'bad body' }])).toEqual({
      Result: { Results: 'Failed', ResultsMessageCount: 1, ResultsMessage: ['bad body'] },
    })
  })
  it('shapes the ADE ResultsMessage[] objects from structured issues via $map', () => {
    // The full ADE Failed envelope: ResultsMessage is an ARRAY OF OBJECTS
    // {ResultsMessageCode, ResultsMessageDescription}, built from the structured
    // issues by the $map directive (a whole-value {{messages}} can't shape it).
    const cfg = parseInboundConfig({
      ackTemplate: {
        failure: {
          Result: {
            Results: '{{status}}',
            ResultsMessageCount: '{{errorCount}}',
            ResultsMessage: {
              $map: 'issues',
              as: { ResultsMessageCode: '{{code}}', ResultsMessageDescription: '{{message}}' },
            },
          },
        },
      },
    })
    expect(
      failureAck(cfg, [
        { code: 'MISSING_FIELD', message: 'Required field "SvcProvDataRecipient" is missing.' },
        { code: 'EMPTY_LIST', message: '"Events" must be a non-empty array.' },
      ]),
    ).toEqual({
      Result: {
        Results: 'Failed',
        ResultsMessageCount: 2,
        ResultsMessage: [
          {
            ResultsMessageCode: 'MISSING_FIELD',
            ResultsMessageDescription: 'Required field "SvcProvDataRecipient" is missing.',
          },
          {
            ResultsMessageCode: 'EMPTY_LIST',
            ResultsMessageDescription: '"Events" must be a non-empty array.',
          },
        ],
      },
    })
  })
  it('falls back to a generic ack when no template is published', () => {
    expect(successAck({})).toEqual({ status: 'accepted' })
    expect(failureAck({}, [{ code: 'C', message: 'x' }])).toEqual({
      status: 'rejected',
      errors: ['x'],
    })
  })
})

describe('validateInboundBody', () => {
  const validation = { requiredPaths: ['SvcProvDataRecipient'], nonEmptyArrayPaths: ['Events'] }
  it('passes a well-formed body', () => {
    expect(
      validateInboundBody({ SvcProvDataRecipient: '0556000', Events: [{ Id: 'E-1' }] }, validation),
    ).toEqual([])
  })
  it('flags a missing required scalar', () => {
    const issues = validateInboundBody({ Events: [{ Id: 'E-1' }] }, validation)
    expect(issues).toEqual([
      { code: 'MISSING_FIELD', message: 'Required field "SvcProvDataRecipient" is missing.' },
    ])
  })
  it('flags a missing or empty array', () => {
    expect(validateInboundBody({ SvcProvDataRecipient: 'x', Events: [] }, validation)).toEqual([
      { code: 'EMPTY_LIST', message: '"Events" must be a non-empty array.' },
    ])
    expect(validateInboundBody({ SvcProvDataRecipient: 'x' }, validation)).toEqual([
      { code: 'EMPTY_LIST', message: '"Events" must be a non-empty array.' },
    ])
  })
  it('is a no-op (accepts anything) when no validation is published', () => {
    expect(validateInboundBody({ anything: 1 }, undefined)).toEqual([])
  })
})

describe('defaultEventType', () => {
  it('derives from the integration id', () => {
    expect(defaultEventType('sirva_ade_shipment')).toBe('sirva_ade_shipment.inbound.received')
  })
})
