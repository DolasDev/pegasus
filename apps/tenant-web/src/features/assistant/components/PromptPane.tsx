// Assistant Lab — Prompt editor. The operations admin owns the words: system
// prompt + domain glossary, saved as immutable versions, published (and rolled
// back by publishing an older one) without a deploy.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  promptVersionsQueryOptions,
  usePublishPromptVersion,
  useSavePromptVersion,
  type PromptVersion,
} from '@/api/assistant'

const textareaClass =
  'mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring'

const STATUS_VARIANT = { PUBLISHED: 'success', DRAFT: 'warning', SUPERSEDED: 'muted' } as const

export function PromptPane({
  activeDraftId,
  onUseDraft,
}: {
  activeDraftId: string | null
  /** Point the Lab's Chat and Evals at a draft (null = the published prompt). */
  onUseDraft: (id: string | null) => void
}) {
  const { data: versions = [], isLoading } = useQuery(promptVersionsQueryOptions)
  const save = useSavePromptVersion()
  const publish = usePublishPromptVersion()
  const published = versions.find((v) => v.status === 'PUBLISHED') ?? null

  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [glossary, setGlossary] = useState('')
  const [note, setNote] = useState('')

  function load(v: PromptVersion) {
    setSeededFrom(v.id)
    setSystemPrompt(v.systemPrompt)
    setGlossary(v.glossary)
    setNote('')
  }

  // Seed the editor from the published version (or the newest one) once loaded.
  if (!seededFrom && !isLoading && versions.length > 0) {
    load(published ?? versions[0]!)
  }

  async function saveDraft() {
    const created = await save.mutateAsync({
      systemPrompt,
      glossary,
      ...(note.trim() ? { note: note.trim() } : {}),
    })
    setSeededFrom(created.id)
    setNote('')
    onUseDraft(created.id)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <div>
          <label htmlFor="ap-system" className="block text-xs font-medium">
            System prompt
          </label>
          <p className="text-xs text-muted-foreground">
            Who the users are, what words mean here, how to answer. Grounding and safety rules are
            built in and always apply on top of this.
          </p>
          <textarea
            id="ap-system"
            className={`${textareaClass} h-56`}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            spellCheck
          />
        </div>
        <div>
          <label htmlFor="ap-glossary" className="block text-xs font-medium">
            Glossary
          </label>
          <textarea
            id="ap-glossary"
            className={`${textareaClass} h-40`}
            value={glossary}
            placeholder={'SIT — storage in transit\nR19 — …'}
            onChange={(e) => setGlossary(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="ap-note" className="block text-xs font-medium">
              Change note
            </label>
            <Input
              id="ap-note"
              value={note}
              maxLength={500}
              placeholder="What changed and why"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button
            onClick={() => void saveDraft()}
            disabled={!systemPrompt.trim() || save.isPending}
          >
            {save.isPending ? 'Saving…' : 'Save as new version'}
          </Button>
        </div>
        {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Versions</h3>
          {activeDraftId && (
            <Button variant="outline" size="sm" onClick={() => onUseDraft(null)}>
              Use published in Lab
            </Button>
          )}
        </div>
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No versions yet — the assistant uses its built-in default until you publish one.
          </p>
        )}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="rounded-md border p-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">v{v.version}</span>
                <Badge variant={STATUS_VARIANT[v.status]}>{v.status.toLowerCase()}</Badge>
                {activeDraftId === v.id && <Badge variant="info">in Lab</Badge>}
                <span className="ml-auto text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
              </div>
              {v.note && <p className="mt-1 text-muted-foreground">{v.note}</p>}
              <div className="mt-2 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => load(v)}>
                  Edit from this
                </Button>
                {v.status !== 'PUBLISHED' && (
                  <Button variant="outline" size="sm" onClick={() => onUseDraft(v.id)}>
                    Try in Lab
                  </Button>
                )}
                {v.status !== 'PUBLISHED' && (
                  <Button
                    size="sm"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate(v.id)}
                  >
                    {v.status === 'SUPERSEDED' ? 'Roll back to this' : 'Publish'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {publish.error && <p className="text-sm text-destructive">{publish.error.message}</p>}
      </div>
    </div>
  )
}
