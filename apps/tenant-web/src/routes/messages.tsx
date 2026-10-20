import { useNavigate, useParams } from '@tanstack/react-router'
import { MessagesSquare } from 'lucide-react'
import { resolveChatScope } from '@pegasus/domain'
import { usePermissions } from '@/auth/permissions'
import { cn } from '@/lib/utils'
import { ConversationList } from '@/features/chat/components/ConversationList'
import { ConversationPane } from '@/features/chat/components/ConversationPane'

// ---------------------------------------------------------------------------
// /messages and /messages/shipment/$orderNum — move chat, laid out like
// Teams/Slack: conversations on the left, the open one on the right. Below the
// `md` breakpoint they are two screens (the list, or the open conversation with
// a back arrow). Open to every signed-in user; the API scopes what they see.
// ---------------------------------------------------------------------------

/** The order number in the URL, or null when it isn't a valid one. */
export function parseOrderParam(raw: string | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null
  const n = Number(raw)
  return n <= 2147483647 ? n : null
}

export function MessagesPage() {
  const { orderNum: raw } = useParams({ strict: false }) as { orderNum?: string }
  const orderNum = parseOrderParam(raw)
  const navigate = useNavigate()
  const perms = usePermissions()
  const isEmployee = resolveChatScope(perms.roles) === 'employee'

  const open = (n: number) =>
    void navigate({ to: '/messages/shipment/$orderNum', params: { orderNum: String(n) } })
  const back = () => void navigate({ to: '/messages' })

  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] min-h-0">
      <aside
        className={cn(
          'w-full shrink-0 border-r md:block md:w-80',
          orderNum != null ? 'hidden' : 'block',
        )}
      >
        {!perms.isLoading && (
          <ConversationList isEmployee={isEmployee} selected={orderNum} onOpen={open} />
        )}
      </aside>
      <div className={cn('min-w-0 flex-1', orderNum != null ? 'block' : 'hidden md:block')}>
        {orderNum != null ? (
          <ConversationPane
            key={orderNum}
            orderNum={orderNum}
            myUserId={perms.userId}
            isAdmin={perms.roles.includes('tenant_admin')}
            onBack={back}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessagesSquare size={40} className="opacity-40" />
            <p className="text-sm">
              {raw
                ? 'That isn’t a valid order number.'
                : 'Pick a conversation, or search an order number.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
