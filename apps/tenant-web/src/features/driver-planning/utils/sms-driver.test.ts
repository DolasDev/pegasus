import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the Snackbar bridge.
const { notifyMock, notifyErrorMock, notifySuccessMock } = vi.hoisted(() => ({
  notifyMock: vi.fn(),
  notifyErrorMock: vi.fn(),
  notifySuccessMock: vi.fn(),
}))
vi.mock('../components/Snackbar/notify', () => ({
  notify: notifyMock,
  notifyError: notifyErrorMock,
  notifySuccess: notifySuccessMock,
}))

// Mock config so we can flip enabled / scheme per test.
const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }))
vi.mock('@/config', () => ({ getConfig: getConfigMock }))

import { normalizeDriverCode, buildDriverSmsUri, smsDriver } from './sms-driver'

const enabledConfig = (scheme = 'pegasus-desktop') => ({
  features: { jumpToOrder: { enabled: true, scheme } },
})
const disabledConfig = () => ({
  features: { jumpToOrder: { enabled: false, scheme: 'pegasus-desktop' } },
})

describe('normalizeDriverCode', () => {
  it.each([
    ['ABC123', 'ABC123'],
    ['abc-123', 'abc-123'],
    ['  D17  ', 'D17'],
    ['x.y_z-1', 'x.y_z-1'],
  ])('accepts %p → %p', (input, expected) => {
    expect(normalizeDriverCode(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc/def', '../etc', 'a b', 'abc;rm', 'x'.repeat(33), null, undefined, 42])(
    'rejects %p',
    (input) => {
      expect(normalizeDriverCode(input)).toBeNull()
    },
  )
})

describe('buildDriverSmsUri', () => {
  it('builds the path-form URI', () => {
    expect(buildDriverSmsUri('pegasus-desktop', 'ABC123')).toBe(
      'pegasus-desktop://sms/driver/ABC123',
    )
  })

  it('respects a custom scheme', () => {
    expect(buildDriverSmsUri('pegasus', 'D17')).toBe('pegasus://sms/driver/D17')
  })
})

describe('smsDriver', () => {
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    getConfigMock.mockReset()
    notifyMock.mockReset()
    notifyErrorMock.mockReset()
    notifySuccessMock.mockReset()
    assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { assign: assignSpy },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('launches the URI and shows a success toast when enabled + valid', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    smsDriver({ driver_code: 'ABC123' })
    expect(assignSpy).toHaveBeenCalledWith('pegasus-desktop://sms/driver/ABC123')
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock).not.toHaveBeenCalled()
  })

  it('uses the configured scheme', () => {
    getConfigMock.mockReturnValue(enabledConfig('pegasus'))
    smsDriver({ driver_code: 'D17' })
    expect(assignSpy).toHaveBeenCalledWith('pegasus://sms/driver/D17')
  })

  it('shows a neutral follow-up hint ~2.5s later (not an error)', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    smsDriver({ driver_code: 'ABC123' })
    expect(notifyMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2500)
    expect(notifyMock).toHaveBeenCalledTimes(1)
    expect(notifyMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('does not launch and shows an error when disabled', () => {
    getConfigMock.mockReturnValue(disabledConfig())
    smsDriver({ driver_code: 'ABC123' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock.mock.calls[0]![0]).toMatch(/not enabled/i)
  })

  it('does not launch and shows an error for an unsafe driver code', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    smsDriver({ driver_code: '../etc' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock.mock.calls[0]![0]).toMatch(/driver code/i)
  })

  it('does not launch and shows an error when driver_code is missing', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    smsDriver({ driver_code: null })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
  })
})
