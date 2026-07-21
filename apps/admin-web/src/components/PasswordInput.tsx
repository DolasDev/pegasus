import { forwardRef, useState, type InputHTMLAttributes } from 'react'

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/** Shared field styling — matches the plain inputs on the login screen. */
const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 pr-10 text-sm text-foreground outline-none ring-offset-background placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-2'

/**
 * Eye / eye-off icons, hand-rolled so admin-web doesn't take on an icon
 * dependency for three glyphs (see CLAUDE.md on dependency management).
 */
function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {crossed ? (
        <>
          <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.39-1.61" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="2" y1="2" x2="22" y2="22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  )
}

/**
 * Password field with a reveal toggle. Starts hidden; the eye button flips the
 * input between `password` and `text` without ever touching the value.
 *
 * Each instance owns its own visibility, so revealing "new password" leaves a
 * neighboring "confirm password" masked.
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false)

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={className ? `${INPUT_CLASS} ${className}` : INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'
