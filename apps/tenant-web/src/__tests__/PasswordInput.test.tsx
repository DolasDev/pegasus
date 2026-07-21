// ---------------------------------------------------------------------------
// PasswordInput tests — the show/hide toggle on password fields
//
// Covers the behavior contract the login screens depend on: masked by default,
// the eye button flips the input type without touching the value, it never
// submits the surrounding form, and sibling fields keep independent state.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PasswordInput } from '@/components/ui/password-input'

describe('PasswordInput', () => {
  it('is masked by default', () => {
    render(<PasswordInput id="password" defaultValue="hunter2" />)

    expect(screen.getByLabelText('Show password')).toBeTruthy()
    expect(document.querySelector('#password')?.getAttribute('type')).toBe('password')
  })

  it('reveals and re-hides the value when the toggle is clicked', () => {
    render(<PasswordInput id="password" defaultValue="hunter2" />)
    const field = document.querySelector('#password') as HTMLInputElement

    fireEvent.click(screen.getByLabelText('Show password'))
    expect(field.getAttribute('type')).toBe('text')
    expect(field.value).toBe('hunter2')

    fireEvent.click(screen.getByLabelText('Hide password'))
    expect(field.getAttribute('type')).toBe('password')
    expect(field.value).toBe('hunter2')
  })

  it('reflects state via aria-pressed', () => {
    render(<PasswordInput id="password" />)

    expect(screen.getByLabelText('Show password').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByLabelText('Show password'))
    expect(screen.getByLabelText('Hide password').getAttribute('aria-pressed')).toBe('true')
  })

  it('does not submit the surrounding form', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PasswordInput id="password" />
      </form>,
    )

    fireEvent.click(screen.getByLabelText('Show password'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps visibility independent per field', () => {
    render(
      <>
        <PasswordInput id="new-password" />
        <PasswordInput id="confirm-password" />
      </>,
    )

    // Reveal only the first field.
    fireEvent.click(screen.getAllByLabelText('Show password')[0]!)

    expect(document.querySelector('#new-password')?.getAttribute('type')).toBe('text')
    expect(document.querySelector('#confirm-password')?.getAttribute('type')).toBe('password')
  })

  it('forwards input props through to the field', () => {
    render(<PasswordInput id="password" autoComplete="current-password" required />)
    const field = document.querySelector('#password') as HTMLInputElement

    expect(field.getAttribute('autocomplete')).toBe('current-password')
    expect(field.required).toBe(true)
  })
})
