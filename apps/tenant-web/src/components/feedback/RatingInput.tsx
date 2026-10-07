import { Star } from 'lucide-react'
import type { FeedbackQuestion } from '@/api/feedback-forms'

// ---------------------------------------------------------------------------
// The hosted feedback form's rating control (sdk-feedback 0033).
//
// `display` changes only how the scale is DRAWN. Every mode reports the same
// integer, so a form can switch between them without touching the response
// contract the API enforces. An unknown `display` (a newer definition read by
// an older build) falls back to numbered buttons rather than failing to render.
// ---------------------------------------------------------------------------

const FACES = ['😞', '🙁', '😐', '🙂', '😄'] as const

/**
 * The face for position `i` (0-based) on an `n`-point scale. The API caps faces
 * at 7 points. Positions are spread across the five faces with both ends pinned,
 * so the lowest point is always the unhappiest face and the highest the happiest.
 */
export function faceFor(i: number, n: number): string {
  if (n <= 1) return FACES[2]
  return FACES[Math.round((i * (FACES.length - 1)) / (n - 1))] ?? FACES[2]
}

export function RatingInput({
  question,
  value,
  onChange,
}: {
  question: FeedbackQuestion
  value: unknown
  onChange: (v: number) => void
}) {
  const min = question.min ?? 1
  const max = question.max ?? 5
  const points = Array.from({ length: max - min + 1 }, (_, i) => min + i)
  const labels = question.scaleLabels ?? {}
  const display =
    question.display === 'faces' || question.display === 'stars' ? question.display : 'numeric'
  const selected = typeof value === 'number' ? value : undefined

  const nameFor = (n: number) => {
    const caption = labels[String(n)]
    return caption ? `${n} of ${max}: ${caption}` : `${n} of ${max}`
  }

  const lowCaption = labels[String(min)]
  const highCaption = labels[String(max)]

  return (
    <div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={question.label}>
        {points.map((n, i) => {
          const pressed = selected === n
          if (display === 'faces') {
            return (
              <button
                key={n}
                type="button"
                aria-pressed={pressed}
                aria-label={nameFor(n)}
                title={labels[String(n)]}
                onClick={() => onChange(n)}
                className={`h-12 w-12 rounded-full border text-2xl leading-none transition ${
                  pressed
                    ? 'border-primary bg-primary/10 ring-2 ring-primary'
                    : 'border-transparent opacity-70 hover:opacity-100 hover:bg-muted'
                }`}
              >
                {faceFor(i, points.length)}
              </button>
            )
          }
          if (display === 'stars') {
            const filled = selected !== undefined && n <= selected
            return (
              <button
                key={n}
                type="button"
                aria-pressed={pressed}
                aria-label={nameFor(n)}
                title={labels[String(n)]}
                data-filled={filled}
                onClick={() => onChange(n)}
                className="rounded-md p-1 transition hover:bg-muted"
              >
                <Star
                  aria-hidden="true"
                  className={`h-8 w-8 ${
                    filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
                  }`}
                />
              </button>
            )
          }
          return (
            <button
              key={n}
              type="button"
              aria-pressed={pressed}
              {...(labels[String(n)] ? { 'aria-label': nameFor(n), title: labels[String(n)] } : {})}
              onClick={() => onChange(n)}
              className={`h-10 w-10 rounded-md border text-sm font-medium transition ${
                pressed
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-input bg-background text-foreground hover:bg-muted'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
      {(lowCaption || highCaption) && (
        <div className="mt-1 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
          <span>{lowCaption}</span>
          <span>{highCaption}</span>
        </div>
      )}
    </div>
  )
}
