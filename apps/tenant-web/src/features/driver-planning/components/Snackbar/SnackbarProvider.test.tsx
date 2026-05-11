import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { SnackbarProvider, useSnackbar } from './SnackbarProvider'
import { notify, notifyError, notifySuccess, registerSnackbarPush } from './notify'

describe('<SnackbarProvider> + useSnackbar()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    registerSnackbarPush(null)
  })

  function Pusher({ msg }: { msg: string }) {
    const { push } = useSnackbar()
    return <button onClick={() => push(msg, { type: 'success' })}>push</button>
  }

  it('exposes a push function via useSnackbar()', () => {
    render(
      <SnackbarProvider>
        <Pusher msg="hello world" />
      </SnackbarProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('throws when useSnackbar is used outside the provider', () => {
    function Bad() {
      useSnackbar()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bad />)).toThrow(/SnackbarProvider/)
    spy.mockRestore()
  })

  it('registers a global notify bridge while mounted', async () => {
    vi.useRealTimers()
    const { unmount } = render(
      <SnackbarProvider>
        <div>child</div>
      </SnackbarProvider>,
    )
    notify('via bridge', { type: 'error' })
    expect(await screen.findByText('via bridge')).toBeInTheDocument()

    unmount()
    // After unmount, notify falls back to console (no throw).
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    notifyError('fallback path')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('notify/notifySuccess/notifyError fall back to console when no provider mounted', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    notifyError('boom')
    notifySuccess('ok')
    expect(errSpy).toHaveBeenCalledWith('[snackbar:fallback]', 'boom')
    expect(logSpy).toHaveBeenCalledWith('[snackbar:fallback]', 'ok')
    errSpy.mockRestore()
    logSpy.mockRestore()
  })
})
