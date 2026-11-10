// ---------------------------------------------------------------------------
// Assistant Lab — the operations admin's authoring surface for the AI
// assistant (plans/in-progress/ai-chat-assistant.md, 1e): prompt editor, chat,
// trace viewer, eval runner.
//
// Route guard: operations_admin + tenant_admin (router.tsx). NOT under
// /settings/*, whose layout is tenant_admin-only. Server side, every call is
// gated by Cedar (UseAssistant / ManageAssistantPrompt) and by ASSISTANT_ENABLED.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePermissions } from '@/auth/permissions'
import type { Effort } from '@/api/assistant'
import { ChatPane } from '@/features/assistant/components/ChatPane'
import { PromptPane } from '@/features/assistant/components/PromptPane'
import { TracePane } from '@/features/assistant/components/TracePane'
import { EvalPane } from '@/features/assistant/components/EvalPane'

const EFFORTS: Effort[] = ['low', 'medium', 'high']

export function AssistantLabPage() {
  const perms = usePermissions()
  // The draft the Lab's Chat and Evals run against (null = published prompt).
  const [draftId, setDraftId] = useState<string | null>(null)
  const [effort, setEffort] = useState<Effort>('medium')

  const header = <PageHeader title="Assistant Lab" breadcrumbs={[{ label: 'Assistant Lab' }]} />

  if (!perms.isLoading && !perms.hasCapability('assistant')) {
    return (
      <div>
        {header}
        <EmptyState
          title="The assistant is not enabled"
          description="It is switched off for this deployment. Nothing here will work until it is turned on."
        />
      </div>
    )
  }

  const canAuthor = perms.has('assistant:manage_prompt')

  return (
    <div>
      {header}
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <label htmlFor="lab-effort">Effort</label>
        <select
          id="lab-effort"
          className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          value={effort}
          onChange={(e) => setEffort(e.target.value as Effort)}
        >
          {EFFORTS.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <span>— the main cost / latency lever after tool-result size.</span>
      </div>
      <Tabs defaultValue="chat">
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          {canAuthor && <TabsTrigger value="prompt">Prompt</TabsTrigger>}
          <TabsTrigger value="traces">Traces</TabsTrigger>
          {canAuthor && <TabsTrigger value="evals">Evals</TabsTrigger>}
        </TabsList>
        <TabsContent value="chat" className="pt-4">
          <ChatPane promptVersionId={canAuthor ? draftId : null} effort={effort} />
        </TabsContent>
        {canAuthor && (
          <TabsContent value="prompt" className="pt-4">
            <PromptPane activeDraftId={draftId} onUseDraft={setDraftId} />
          </TabsContent>
        )}
        <TabsContent value="traces" className="pt-4">
          <TracePane />
        </TabsContent>
        {canAuthor && (
          <TabsContent value="evals" className="pt-4">
            <EvalPane draftId={draftId} effort={effort} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
