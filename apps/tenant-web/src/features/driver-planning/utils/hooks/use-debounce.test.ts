import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebounce } from './use-debounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500))
    expect(result.current).toBe('initial')
  })

  it('does not update the value before the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 500 } },
    )

    rerender({ value: 'b', delay: 500 })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(result.current).toBe('a')
  })

  it('updates the value once the delay elapses', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 500 } },
    )

    rerender({ value: 'b', delay: 500 })

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe('b')
  })

  it('resets the debounce timer when the value changes within the delay window', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 500 } },
    )

    rerender({ value: 'b', delay: 500 })
    act(() => {
      vi.advanceTimersByTime(300)
    })

    rerender({ value: 'c', delay: 500 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // Only 300ms since the last change — should still be the original value.
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('c')
  })

  it('respects a changing delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }: { value: string; delay: number }) => useDebounce(value, delay),
      { initialProps: { value: 'a', delay: 500 } },
    )

    rerender({ value: 'b', delay: 1000 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe('b')
  })

  it('works with non-string values', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) => useDebounce(value, 100),
      { initialProps: { value: 1 } },
    )

    rerender({ value: 2 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe(2)
  })

  it('clears the timeout on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { unmount } = renderHook(() => useDebounce('a', 500))
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
