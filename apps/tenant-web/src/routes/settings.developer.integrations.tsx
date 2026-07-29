import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  AlertCircle,
  Blocks,
  ChevronDown,
  ChevronRight,
  GitFork,
  Layers,
  Loader2,
  Lock,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { ApiError } from '@/api/client'
import type { IntegrationFloor, IntegrationSummary } from '@/api/integrations'
import {
  integrationsQueryOptions,
  integrationFloorsQueryOptions,
  useForkIntegrationConfig,
  useDeleteIntegrationConfig,
} from '@/api/queries/integrations'

// ---------------------------------------------------------------------------
// Settings → Developer → Integrations
//
// The full integration catalog, in four groups that answer four different
// questions:
//
//   Integration floors    — what TYPES exist to build on (code; not publishable)
//   Platform integrations — what the platform publishes GLOBALly, to fork
//   Built-in baselines    — code overlays with nothing published over them
//   Your integrations     — what this tenant owns, to edit or delete
//
// The all-user /integrations page is the operator view of the same data, narrowed
// to what is actually live. This page is the admin view: it is the only place the
// distinction between platform, built-in, and owned is visible, and the only
// place fork/delete live.
// ---------------------------------------------------------------------------

/** Partition the one list endpoint into the three config-backed groups. */
export function groupIntegrations(integrations: readonly IntegrationSummary[]): {
  platform: IntegrationSummary[]
  builtIn: IntegrationSummary[]
  owned: IntegrationSummary[]
} {
  const platform: IntegrationSummary[] = []
  const builtIn: IntegrationSummary[] = []
  const owned: IntegrationSummary[] = []
  for (const it of integrations) {
    // Unpublished ⇒ only the built-in code overlay applies. A forked id resolves
    // to the tenant's OWN row server-side, so it lands in `owned` and never
    // double-lists under `platform`.
    if (!it.published) builtIn.push(it)
    else if (it.visibility === 'TENANT') owned.push(it)
    else platform.push(it)
  }
  return { platform, builtIn, owned }
}

/** Turn a failed fork/delete into something a tenant admin can act on. */
function mutationMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // The publish master switch (INTEGRATION_CONFIG_PUBLISH_ENABLED) is off in
    // dev; saying so beats a bare 403.
    if (err.code === 'FEATURE_DISABLED')
      return 'Integration config publishing is not enabled in this environment.'
    if (err.code === 'DEPENDENTS_EXIST') return `${err.message} (This is a platform-tenant action.)`
    if (err.code === 'NOT_FOUND') return 'There is no config to act on — it may already be gone.'
    return err.message
  }
  return 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

function FloorRow({ floor }: { floor: IntegrationFloor }) {
  const [open, setOpen] = useState(false)
  const facts = Object.entries(floor.factCatalog)

  return (
    <li className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 text-left"
      >
        {open ? (
          <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">{floor.floor}</span>
            <Badge variant="outline" className="text-xs">
              {facts.length} fact{facts.length === 1 ? '' : 's'}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {floor.canonicalFields.length} field
              {floor.canonicalFields.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Default action: <span className="font-mono">{floor.defaultAction}</span>
            {floor.projection ? ` · projects ${floor.projection.entityType}` : ''}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-l pl-6">
          <div>
            <p className="text-xs font-medium">Rule facts</p>
            <ul className="mt-1 space-y-1">
              {facts.map(([name, type]) => (
                <li key={name} className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{name}</span>
                  <span className="ml-1 font-mono">({type})</span>
                  {floor.factDocs?.[name] ? ` — ${floor.factDocs[name]}` : ''}
                </li>
              ))}
            </ul>
          </div>
          {floor.inputFieldRoots && floor.inputFieldRoots.length > 0 && (
            <div>
              <p className="text-xs font-medium">Readable source roots</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {floor.inputFieldRoots.join(', ')}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function FloorsCard() {
  const { data, isLoading, isError } = useQuery(integrationFloorsQueryOptions)
  const floors = data ?? []

  return (
    <Card role="region" aria-label="Integration floors">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-muted-foreground" />
          <CardTitle>Integration floors</CardTitle>
          {!isLoading && !isError && (
            <Badge variant="secondary" className="text-xs">
              {floors.length}
            </Badge>
          )}
        </div>
        <CardDescription>
          The per-type contract an integration is built on — canonical shape, legal mapping targets,
          and the facts rules may test. Floors are code: a published config overlays the mapping and
          rules, never the floor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading floors…
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle size={14} className="shrink-0" />
            Failed to load integration floors.
          </div>
        ) : floors.length === 0 ? (
          <EmptyState title="No floors" description="No integration type floors are registered." />
        ) : (
          <ul className="divide-y rounded-md border">
            {floors.map((f) => (
              <FloorRow key={f.floor} floor={f} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Integration rows
// ---------------------------------------------------------------------------

function IntegrationIdentity({ integration }: { integration: IntegrationSummary }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{integration.name}</span>
        <Badge variant="outline" className="font-mono text-xs">
          {integration.id}
        </Badge>
        {integration.published ? (
          <Badge variant="secondary" className="text-xs">
            v{integration.version}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs">
            Code only
          </Badge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{integration.description}</p>
      <Link
        to="/integrations/$integrationId"
        params={{ integrationId: integration.id }}
        className="mt-1 inline-block text-xs text-primary hover:underline"
      >
        View mapping &amp; rules
      </Link>
    </div>
  )
}

function PlatformRow({ integration }: { integration: IntegrationSummary }) {
  const fork = useForkIntegrationConfig()

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Blocks size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <IntegrationIdentity integration={integration} />
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={fork.isPending}
          onClick={() => fork.mutate(integration.id)}
        >
          {fork.isPending ? <Loader2 size={14} className="animate-spin" /> : <GitFork size={14} />}
          Fork to my tenant
        </Button>
        {fork.isError && (
          <p className="max-w-xs text-right text-xs text-destructive">
            {mutationMessage(fork.error)}
          </p>
        )}
      </div>
    </li>
  )
}

function OwnedRow({ integration }: { integration: IntegrationSummary }) {
  const [confirming, setConfirming] = useState(false)
  const del = useDeleteIntegrationConfig()

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <Blocks size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <IntegrationIdentity integration={integration} />
        <div className="shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={del.isPending || confirming}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={14} />
            Delete
          </Button>
        </div>
      </div>

      {confirming && (
        <div className="mt-3 rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">
            Delete your config for {integration.name}?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This removes <strong>every version</strong> you have published for{' '}
            <span className="font-mono">{integration.id}</span>, including its history — it cannot
            be undone. Validation immediately falls back to the platform config, or to the built-in
            baseline if the platform has none, so inbound orders keep being checked, just by
            different rules than yours.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={del.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="gap-2"
              disabled={del.isPending}
              onClick={() =>
                del.mutate(
                  { integrationId: integration.id },
                  { onSuccess: () => setConfirming(false) },
                )
              }
            >
              {del.isPending && <Loader2 size={14} className="animate-spin" />}
              Delete permanently
            </Button>
          </div>
        </div>
      )}

      {del.isError && <p className="mt-2 text-xs text-destructive">{mutationMessage(del.error)}</p>}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type GroupCardProps = {
  title: string
  description: string
  count: number | null
  children: React.ReactNode
}

function GroupCard({ title, description, count, children }: GroupCardProps) {
  return (
    // A labelled region per group: the grouping IS the page's meaning, so make it
    // navigable by assistive tech (and addressable in tests) rather than implied
    // by visual order alone.
    <Card role="region" aria-label={title}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Blocks size={18} className="text-muted-foreground" />
          <CardTitle>{title}</CardTitle>
          {count !== null && (
            <Badge variant="secondary" className="text-xs">
              {count}
            </Badge>
          )}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function DeveloperIntegrationsPage() {
  const { data, isLoading, isError } = useQuery(integrationsQueryOptions)
  const { platform, builtIn, owned } = groupIntegrations(data ?? [])

  const status = isLoading ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 size={14} className="animate-spin" />
      Loading integrations…
    </div>
  ) : isError ? (
    <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle size={14} className="shrink-0" />
      Failed to load integrations.
    </div>
  ) : null

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <PageHeader
        title="Integrations"
        breadcrumbs={[{ label: 'Settings' }, { label: 'Developer' }, { label: 'Integrations' }]}
      />

      <FloorsCard />

      <GroupCard
        title="Platform integrations"
        description="Published by the platform team and inherited by every tenant. Fork one to get your own copy you can edit and publish independently — after forking, your version governs validation for this tenant."
        count={status ? null : platform.length}
      >
        {status ??
          (platform.length === 0 ? (
            <EmptyState
              title="No platform integrations"
              description="The platform team hasn't published any integrations you can fork."
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {platform.map((it) => (
                <PlatformRow key={it.id} integration={it} />
              ))}
            </ul>
          ))}
      </GroupCard>

      <GroupCard
        title="Built-in baselines"
        description="Reference integrations that live in the platform's code rather than in a published config. They govern validation for their id until something is published over them, and cannot be forked or deleted."
        count={status ? null : builtIn.length}
      >
        {status ??
          (builtIn.length === 0 ? (
            <EmptyState
              title="No built-in baselines"
              description="Every built-in integration has a published config over it."
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {builtIn.map((it) => (
                <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                  <Lock size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <IntegrationIdentity integration={it} />
                </li>
              ))}
            </ul>
          ))}
      </GroupCard>

      <GroupCard
        title="Your integrations"
        description="Configs this tenant owns — forked from the platform or published with the pegasus-workflows CLI. These win over the platform's version for this tenant."
        count={status ? null : owned.length}
      >
        {status ??
          (owned.length === 0 ? (
            <EmptyState
              title="No integrations of your own"
              description="Fork a platform integration above to get a copy you can change."
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {owned.map((it) => (
                <OwnedRow key={it.id} integration={it} />
              ))}
            </ul>
          ))}
      </GroupCard>
    </div>
  )
}
