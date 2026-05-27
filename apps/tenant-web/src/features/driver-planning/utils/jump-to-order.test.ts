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

import {
  isJumpToOrderEnabled,
  normalizeOrderNum,
  buildOrderUri,
  jumpToOrder,
} from './jump-to-order'

const enabledConfig = (scheme = 'pegasus-desktop') => ({
  features: { jumpToOrder: { enabled: true, scheme } },
})
const disabledConfig = () => ({
  features: { jumpToOrder: { enabled: false, scheme: 'pegasus-desktop' } },
})

describe('normalizeOrderNum', () => {
  it.each([
    [42, 42],
    ['42', 42],
    [1, 1],
  ])('accepts %p → %p', (input, expected) => {
    expect(normalizeOrderNum(input)).toBe(expected)
  })

  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    '12; rm -rf',
    '../../etc',
    'abc',
    undefined,
    null,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects %p', (input) => {
    expect(normalizeOrderNum(input)).toBeNull()
  })
})

describe('buildOrderUri', () => {
  it('builds the path-form URI', () => {
    expect(buildOrderUri('pegasus-desktop', 42)).toBe('pegasus-desktop://order/42')
  })

  it('respects a custom scheme', () => {
    expect(buildOrderUri('pegasus', 7)).toBe('pegasus://order/7')
  })
})

describe('isJumpToOrderEnabled', () => {
  beforeEach(() => getConfigMock.mockReset())

  it('true when config enables it', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    expect(isJumpToOrderEnabled()).toBe(true)
  })

  it('false when disabled', () => {
    getConfigMock.mockReturnValue(disabledConfig())
    expect(isJumpToOrderEnabled()).toBe(false)
  })

  it('false when config not loaded / malformed (getConfig unusable)', () => {
    // Mirrors the real getConfig throwing when loadConfig() hasn't run: the
    // missing `features` makes the property access throw, which the helper
    // swallows to a safe `false`.
    getConfigMock.mockReturnValue(undefined)
    expect(isJumpToOrderEnabled()).toBe(false)
  })
})

describe('jumpToOrder', () => {
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    getConfigMock.mockReset()
    notifyMock.mockReset()
    notifyErrorMock.mockReset()
    notifySuccessMock.mockReset()
    assignSpy = vi.fn()
    // jsdom's location.assign is a no-op; replace with a spy.
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
    jumpToOrder({ order_num: 42 })
    expect(assignSpy).toHaveBeenCalledWith('pegasus-desktop://order/42')
    expect(notifySuccessMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock).not.toHaveBeenCalled()
  })

  it('uses the configured scheme', () => {
    getConfigMock.mockReturnValue(enabledConfig('pegasus'))
    jumpToOrder({ order_num: 9 })
    expect(assignSpy).toHaveBeenCalledWith('pegasus://order/9')
  })

  it('shows a neutral follow-up hint ~2.5s later (not an error)', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    jumpToOrder({ order_num: 42 })
    expect(notifyMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2500)
    expect(notifyMock).toHaveBeenCalledTimes(1)
    // Plain notify (no options) → neutral, never an error toast.
    expect(notifyMock.mock.calls[0]![1]).toBeUndefined()
  })

  it('does not launch and shows an error when disabled', () => {
    getConfigMock.mockReturnValue(disabledConfig())
    jumpToOrder({ order_num: 42 })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock.mock.calls[0]![0]).toMatch(/not enabled/i)
  })

  it('does not launch and shows an error for an invalid order number', () => {
    getConfigMock.mockReturnValue(enabledConfig())
    jumpToOrder({ order_num: 'abc' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(notifyErrorMock).toHaveBeenCalledTimes(1)
    expect(notifyErrorMock.mock.calls[0]![0]).toMatch(/invalid order number/i)
  })
})
