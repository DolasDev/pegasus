import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { MAX_CHAT_BODY_LENGTH } from '@pegasus/domain'
import type { ChatMentionable } from '@/api/queries/chat'
import { cn } from '@/lib/utils'
import {
  activeMentionQuery,
  encodeMentions,
  filterMentionable,
  insertMention,
  type PickedMention,
} from '../mention-input'

// ---------------------------------------------------------------------------
// The message box. Enter sends, Shift+Enter starts a new line. Typing "@"
// opens a picker of the room's mentionable people (arrows + Enter/Tab to pick,
// Esc to close); a picked name becomes a real mention when the message is sent.
// ---------------------------------------------------------------------------

type Props = {
  mentionable: readonly ChatMentionable[]
  disabled?: boolean
  onSend: (body: string) => void
}

export function Composer({ mentionable, disabled, onSend }: Props) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [picked, setPicked] = useState<PickedMention[]>([])
  const [highlight, setHighlight] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  const active = activeMentionQuery(text, caret)
  const options =
    active && active.start !== dismissedAt ? filterMentionable(mentionable, active.query) : []
  const open = options.length > 0

  const trimmed = text.trim()
  const tooLong = text.length > MAX_CHAT_BODY_LENGTH

  function send() {
    if (!trimmed || tooLong || disabled) return
    onSend(encodeMentions(trimmed, picked))
    setText('')
    setCaret(0)
    setPicked([])
    setDismissedAt(null)
  }

  function pick(option: ChatMentionable) {
    const next = insertMention(text, caret, option.name)
    setText(next.text)
    setCaret(next.caret)
    setPicked((p) => [
      ...p.filter((x) => x.name !== option.name),
      { name: option.name, userId: option.userId },
    ])
    setHighlight(0)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setHighlight((h) => (h + step + options.length) % options.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const option = options[Math.min(highlight, options.length - 1)]
        if (option) pick(option)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissedAt(active?.start ?? null)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="relative border-t p-3">
      {open && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="absolute bottom-full left-3 mb-1 max-h-60 w-72 overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {options.map((o, i) => (
            <li
              key={o.userId}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o)
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-sm',
                i === highlight && 'bg-accent',
              )}
            >
              <span className="truncate">{o.name}</span>
              {o.kind === 'driver' && (
                <span className="ml-2 text-xs text-muted-foreground">Driver</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          value={text}
          rows={1}
          disabled={disabled}
          aria-label="Message"
          placeholder="Write a message… (@ to mention)"
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setHighlight(0)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          style={{ fieldSizing: 'content' } as CSSProperties}
        />
        <button
          type="button"
          onClick={send}
          disabled={!trimmed || tooLong || disabled}
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <SendHorizontal size={16} />
        </button>
      </div>
      {tooLong && (
        <p className="mt-1 text-xs text-destructive">
          {text.length - MAX_CHAT_BODY_LENGTH} characters over the {MAX_CHAT_BODY_LENGTH} limit
        </p>
      )}
    </div>
  )
}
