import { describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { render, renderHook } from '@testing-library/react'
import { useOutsideClick } from './use-outside-click'

function dispatchMouseDown(target: EventTarget) {
  const event = new MouseEvent('mousedown', { bubbles: true })
  target.dispatchEvent(event)
}

describe('useOutsideClick', () => {
  it('invokes the callback when a mousedown happens outside the ref element', () => {
    const callback = vi.fn()

    const Component = () => {
      const ref = useRef<HTMLDivElement>(null)
      useOutsideClick([ref], callback)
      return (
        <div>
          <div ref={ref} data-testid="inside">
            <span data-testid="child">child</span>
          </div>
          <div data-testid="outside">outside</div>
        </div>
      )
    }

    const { getByTestId } = render(<Component />)

    dispatchMouseDown(getByTestId('outside'))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not invoke the callback when the click is inside the ref element', () => {
    const callback = vi.fn()

    const Component = () => {
      const ref = useRef<HTMLDivElement>(null)
      useOutsideClick([ref], callback)
      return (
        <div ref={ref} data-testid="inside">
          <span data-testid="child">child</span>
        </div>
      )
    }

    const { getByTestId } = render(<Component />)

    dispatchMouseDown(getByTestId('inside'))
    expect(callback).not.toHaveBeenCalled()

    dispatchMouseDown(getByTestId('child'))
    expect(callback).not.toHaveBeenCalled()
  })

  it('does not invoke the callback when the click is inside any of multiple refs', () => {
    const callback = vi.fn()

    const Component = () => {
      const refA = useRef<HTMLDivElement>(null)
      const refB = useRef<HTMLDivElement>(null)
      useOutsideClick([refA, refB], callback)
      return (
        <div>
          <div ref={refA} data-testid="a">
            a
          </div>
          <div ref={refB} data-testid="b">
            b
          </div>
          <div data-testid="outside">outside</div>
        </div>
      )
    }

    const { getByTestId } = render(<Component />)

    dispatchMouseDown(getByTestId('a'))
    dispatchMouseDown(getByTestId('b'))
    expect(callback).not.toHaveBeenCalled()

    dispatchMouseDown(getByTestId('outside'))
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('treats a ref with no current element as outside', () => {
    const callback = vi.fn()
    const ref = { current: null } as { current: HTMLElement | null }

    renderHook(() => useOutsideClick([ref], callback))

    const target = document.createElement('div')
    document.body.appendChild(target)
    dispatchMouseDown(target)
    document.body.removeChild(target)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('removes the listener on unmount', () => {
    const callback = vi.fn()
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const ref = { current: null } as { current: HTMLElement | null }
    const { unmount } = renderHook(() => useOutsideClick([ref], callback))
    unmount()

    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))

    // After unmount, dispatching should not call the callback.
    const target = document.createElement('div')
    document.body.appendChild(target)
    dispatchMouseDown(target)
    document.body.removeChild(target)

    expect(callback).not.toHaveBeenCalled()
    removeSpy.mockRestore()
  })
})
