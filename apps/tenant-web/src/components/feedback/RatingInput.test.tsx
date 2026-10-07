// ---------------------------------------------------------------------------
// RatingInput — the hosted feedback form's rating control (sdk-feedback 0033).
//
// The author picks how a rating is DRAWN (`display`: numeric | faces | stars);
// the answer is the same integer whichever they pick. These tests pin both
// halves: what renders, and what value a click reports.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RatingInput, faceFor } from './RatingInput'
import type { FeedbackQuestion } from '@/api/feedback-forms'

const question = (over: Partial<FeedbackQuestion> = {}): FeedbackQuestion => ({
  id: 'q',
  type: 'rating',
  label: 'How was pack day?',
  ...over,
})

describe('RatingInput', () => {
  it('renders numbered buttons when display is omitted (unchanged default)', () => {
    render(<RatingInput question={question()} value={undefined} onChange={() => {}} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('renders one face per point, least to most satisfied, for display: faces', () => {
    render(
      <RatingInput
        question={question({ display: 'faces' })}
        value={undefined}
        onChange={() => {}}
      />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['😞', '🙁', '😐', '🙂', '😄'])
    // The number is still announced, so a screen reader hears the scale.
    expect(buttons[0]).toHaveAccessibleName('1 of 5')
    expect(buttons[4]).toHaveAccessibleName('5 of 5')
  })

  it('reports the integer for a clicked face, not the glyph', async () => {
    const onChange = vi.fn()
    render(
      <RatingInput
        question={question({ display: 'faces' })}
        value={undefined}
        onChange={onChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: '4 of 5' }))

    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('renders stars and fills them up to the chosen value', () => {
    render(<RatingInput question={question({ display: 'stars' })} value={3} onChange={() => {}} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(5)
    expect(buttons.map((b) => b.getAttribute('data-filled'))).toEqual([
      'true',
      'true',
      'true',
      'false',
      'false',
    ])
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true')
    expect(buttons[3]).toHaveAttribute('aria-pressed', 'false')
  })

  it('honors a custom scale', async () => {
    const onChange = vi.fn()
    render(
      <RatingInput
        question={question({ display: 'stars', min: 0, max: 3 })}
        value={undefined}
        onChange={onChange}
      />,
    )

    expect(screen.getAllByRole('button')).toHaveLength(4)
    await userEvent.click(screen.getByRole('button', { name: '0 of 3' }))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('captions the ends with scaleLabels and folds labels into the accessible names', () => {
    render(
      <RatingInput
        question={question({
          display: 'faces',
          scaleLabels: { '1': 'Very poor', '5': 'Excellent' },
        })}
        value={undefined}
        onChange={() => {}}
      />,
    )

    expect(screen.getByText('Very poor')).toBeInTheDocument()
    expect(screen.getByText('Excellent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1 of 5: Very poor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 of 5' })).toBeInTheDocument()
  })

  it('falls back to numbered buttons for a display value this build does not know', () => {
    render(
      <RatingInput
        question={question({ display: 'hearts' as FeedbackQuestion['display'] })}
        value={undefined}
        onChange={() => {}}
      />,
    )

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ])
  })
})

describe('faceFor', () => {
  it('spreads any scale of up to 7 points across the five faces, ends pinned', () => {
    expect([0, 1, 2].map((i) => faceFor(i, 3))).toEqual(['😞', '😐', '😄'])
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => faceFor(i, 7))).toEqual([
      '😞',
      '🙁',
      '🙁',
      '😐',
      '🙂',
      '🙂',
      '😄',
    ])
    expect(faceFor(0, 1)).toBe('😐')
  })
})
