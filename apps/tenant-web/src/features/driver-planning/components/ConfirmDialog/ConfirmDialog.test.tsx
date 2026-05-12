import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ConfirmDialog, ConfirmProvider, useConfirm } from './index'

describe('<ConfirmDialog>', () => {
  it('renders title and description when open', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Cancel trip?"
        description="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Cancel trip?')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('renders nothing in the DOM when closed', () => {
    render(
      <ConfirmDialog
        open={false}
        title="Hidden"
        description="Should not appear"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('invokes onConfirm when the confirm button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('invokes onCancel when the cancel button is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'No' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('uses default labels when none supplied', () => {
    render(
      <ConfirmDialog
        open={true}
        title="t"
        description="d"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
})

describe('useConfirm / <ConfirmProvider>', () => {
  function TriggerButton({
    onResult,
  }: {
    onResult: (value: boolean) => void
  }) {
    const confirm = useConfirm()
    return (
      <button
        onClick={async () => {
          const result = await confirm({ description: 'Delete the thing?' })
          onResult(result)
        }}
      >
        ask
      </button>
    )
  }

  it('resolves true when the user confirms', async () => {
    const onResult = vi.fn()
    render(
      <ConfirmProvider>
        <TriggerButton onResult={onResult} />
      </ConfirmProvider>,
    )

    fireEvent.click(screen.getByText('ask'))
    expect(await screen.findByText('Delete the thing?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    })
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('resolves false when the user cancels', async () => {
    const onResult = vi.fn()
    render(
      <ConfirmProvider>
        <TriggerButton onResult={onResult} />
      </ConfirmProvider>,
    )

    fireEvent.click(screen.getByText('ask'))
    expect(await screen.findByText('Delete the thing?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(onResult).toHaveBeenCalledWith(false)
  })

  it('throws when useConfirm is used outside provider', () => {
    function Bad() {
      useConfirm()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bad />)).toThrow(/ConfirmProvider/)
    spy.mockRestore()
  })

  it('records the resolved value for a sequential confirm flow', async () => {
    function Multi() {
      const confirm = useConfirm()
      const [results, setResults] = useState<boolean[]>([])
      return (
        <>
          <button
            onClick={async () => {
              const a = await confirm({ description: 'first?' })
              setResults((r) => [...r, a])
            }}
          >
            askA
          </button>
          <div data-testid="results">{JSON.stringify(results)}</div>
        </>
      )
    }
    render(
      <ConfirmProvider>
        <Multi />
      </ConfirmProvider>,
    )
    fireEvent.click(screen.getByText('askA'))
    expect(await screen.findByText('first?')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    })
    expect(screen.getByTestId('results').textContent).toBe('[true]')
  })
})
