// ---------------------------------------------------------------------------
// App Settings → Operations → Email recipient domains
//
// Platform email (workflows' send_email) is internal-only: every recipient must
// be on this list. Empty ⇒ the tenant cannot send email at all. Only tenant
// admins can change it; a workflow can't widen its own audience.
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { appSettingsQueryOptions, useUpdateAppSettings } from '@/api/queries/app-settings'
import { formatDomainList, parseDomainList } from './domains'

export function EmailRecipientDomainsCard() {
  const { data } = useQuery(appSettingsQueryOptions)
  const mutation = useUpdateAppSettings()
  const current = formatDomainList(data?.operations.emailAllowedRecipientDomains)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? current
  const parsed = parseDomainList(text)
  const isDirty = draft !== null && draft !== current

  function handleSave() {
    mutation.mutate(
      { operations: { emailAllowedRecipientDomains: parsed.domains } },
      { onSuccess: () => setDraft(null) },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email recipient domains</CardTitle>
        <CardDescription>
          Automations can only email addresses at these domains (for example your own company
          domain). Leave empty to disable automated email entirely. Mail is sent through your
          on-premises Pegasus server&apos;s SMTP account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="email-domains">Allowed domains (one per line)</Label>
        <textarea
          id="email-domains"
          data-testid="email-domains-input"
          rows={4}
          className="block w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="example.com"
          value={text}
          onChange={(e) => setDraft(e.target.value)}
        />
        {parsed.invalid.length > 0 && (
          <p className="text-xs text-destructive" data-testid="email-domains-invalid">
            Not a domain: {parsed.invalid.join(', ')}
          </p>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || parsed.invalid.length > 0 || mutation.isPending}
          data-testid="email-domains-save"
        >
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setDraft(null)}
          disabled={!isDirty || mutation.isPending}
        >
          Reset
        </Button>
        {mutation.isError && (
          <span className="text-xs text-destructive">
            Save failed: {mutation.error instanceof Error ? mutation.error.message : 'unknown'}
          </span>
        )}
      </CardFooter>
    </Card>
  )
}
