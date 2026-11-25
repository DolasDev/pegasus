import { useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { NewThreadForm } from '@/features/support/components/NewThreadForm'
import { ThreadList } from '@/features/support/components/ThreadList'
import { ThreadPane } from '@/features/support/components/ThreadPane'

// ---------------------------------------------------------------------------
// /support and /support/$threadId: Help, a conversation with Pegasus support.
// Laid out like /messages: my requests on the left, the open one (or the
// new-request form) on the right. Below the `md` breakpoint they are separate
// screens. The nav entry is gated on the `support` capability + `support:read`;
// with the flag off the API answers 404 and the list shows its error.
// ---------------------------------------------------------------------------

export function SupportPage() {
  const { threadId } = useParams({ strict: false }) as { threadId?: string }
  const navigate = useNavigate()
  // Below `md` the form is its own screen; on wider screens it fills the right
  // pane whenever no thread is open.
  const [composing, setComposing] = useState(false)

  const open = (id: string) => {
    setComposing(false)
    void navigate({ to: '/support/$threadId', params: { threadId: id } })
  }
  const back = () => {
    setComposing(false)
    void navigate({ to: '/support' })
  }
  const startNew = () => {
    setComposing(true)
    if (threadId) void navigate({ to: '/support' })
  }

  const showRight = threadId != null || composing

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0">
      <aside
        className={cn('w-full shrink-0 border-r md:block md:w-80', showRight ? 'hidden' : 'block')}
      >
        <ThreadList selected={threadId ?? null} onOpen={open} onNew={startNew} />
      </aside>
      <div className={cn('min-w-0 flex-1', showRight ? 'block' : 'hidden md:block')}>
        {threadId ? (
          <ThreadPane key={threadId} threadId={threadId} onBack={back} />
        ) : (
          <NewThreadForm onCreated={open} onBack={back} />
        )}
      </div>
    </div>
  )
}
