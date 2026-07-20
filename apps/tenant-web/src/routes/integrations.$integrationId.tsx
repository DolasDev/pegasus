import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { AlertTriangle, Check, Copy, GitFork, Loader2, Pencil, RotateCcw, X } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/EmptyState'
import { IngressPanel } from '@/components/integrations/IngressPanel'
import { usePermissions } from '@/auth/permissions'
import { ApiError } from '@/api/client'
import {
  integrationConfigQueryOptions,
  integrationConfigVersionsQueryOptions,
  useForkIntegrationConfig,
  useValidateIntegrationConfig,
  usePublishIntegrationConfig,
  useRollbackIntegrationConfig,
} from '@/api/queries/integrations'
import type {
  ConfigDraft,
  GateReport,
  IntegrationConfig,
  IntegrationConfigVersion,
  IntegrationRule,
  MappingDirective,
  MappingNode,
  MappingObject,
  MapScalar,
  Predicate,
} from '@/api/integrations'

// ---------------------------------------------------------------------------
// Integration detail — /integrations/$integrationId
//
// Read-only visualization of a published integration's active config for both
// business users and developers:
//   - Mapping: the output-shaped template flattened to an output-field -> source
//     table (handles $from fallback chains, $map, coerce, default, and $each).
//   - Rules: each decision-table rule as a plain-English "fires when ALL of" card.
//   - Raw JSON: the full config (incl. corpus) for developers, with copy.
// ---------------------------------------------------------------------------

// --- Mapping flattening -----------------------------------------------------

interface MappingRow {
  outputPath: string
  sources: string[]
  transforms: string[]
}

function isDirective(node: MappingNode): node is MappingDirective {
  return typeof node === 'object' && node !== null && '$from' in node
}

function formatMap(map: Record<string, MapScalar>): string {
  const entries = Object.entries(map)
  const shown = entries.slice(0, 3).map(([k, v]) => `${k}→${String(v)}`)
  const more = entries.length > 3 ? `, +${entries.length - 3} more` : ''
  return `map: ${shown.join(', ')}${more}`
}

function flattenNode(node: MappingNode, path: string, rows: MappingRow[]): void {
  if (typeof node === 'string') {
    rows.push({ outputPath: path, sources: [node], transforms: [] })
    return
  }
  if (isDirective(node)) {
    const sources = Array.isArray(node.$from) ? node.$from : [node.$from]
    if (node.$each) {
      rows.push({ outputPath: `${path}[]`, sources, transforms: ['array: per-element'] })
      flattenObject(node.$each, `${path}[]`, rows)
      return
    }
    const transforms: string[] = []
    if (node.coerce && node.coerce !== 'identity') transforms.push(`coerce: ${node.coerce}`)
    if (node.$map) transforms.push(formatMap(node.$map))
    if ('default' in node) transforms.push(`default: ${JSON.stringify(node.default)}`)
    rows.push({ outputPath: path, sources, transforms })
    return
  }
  flattenObject(node, path, rows)
}

function flattenObject(obj: MappingObject, prefix: string, rows: MappingRow[]): void {
  for (const [key, child] of Object.entries(obj)) {
    flattenNode(child, prefix ? `${prefix}.${key}` : key, rows)
  }
}

function flattenMapping(mapping: MappingObject): MappingRow[] {
  const rows: MappingRow[] = []
  flattenObject(mapping, '', rows)
  return rows
}

export function MappingTable({ mapping }: { mapping: MappingObject }) {
  const rows = flattenMapping(mapping)
  if (rows.length === 0) {
    return <EmptyState title="No field mappings" description="This config maps no output fields." />
  }
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Output field</TableHead>
              <TableHead>Source path(s)</TableHead>
              <TableHead>Transforms</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.outputPath}>
                <TableCell className="font-mono text-xs">{row.outputPath}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {row.sources.join('  ·  ')}
                </TableCell>
                <TableCell className="text-xs">
                  {row.transforms.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {row.transforms.map((t) => (
                        <Badge key={t} variant="muted" className="font-mono">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// --- Rules ------------------------------------------------------------------

const OP_LABEL: Record<Predicate['op'], string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'is one of',
}

function formatPredicateValue(value: Predicate['value']): string {
  if (Array.isArray(value)) return `[${value.map((v) => String(v)).join(', ')}]`
  return JSON.stringify(value)
}

export function RulesTable({ rules }: { rules: IntegrationRule[] }) {
  if (rules.length === 0) {
    return <EmptyState title="No rules" description="This config enforces no validation rules." />
  }
  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <Card key={rule.id}>
          <CardContent className="space-y-2 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {rule.id}
              </Badge>
              <span className="text-xs text-muted-foreground">
                on field <code className="font-mono">{rule.field}</code>
              </span>
            </div>
            <p className="text-sm font-medium">{rule.description}</p>
            <p className="text-sm text-destructive/90">{rule.message}</p>
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Fires when ALL of:</p>
              <ul className="space-y-0.5">
                {rule.when.map((p, i) => (
                  <li key={i} className="font-mono text-xs">
                    <span className="text-foreground">{p.fact}</span>{' '}
                    <span className="text-muted-foreground">{OP_LABEL[p.op]}</span>{' '}
                    <span className="text-foreground">{formatPredicateValue(p.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
            {rule.sourceRef && (
              <p className="text-xs text-muted-foreground">
                Source: <span className="font-mono">{rule.sourceRef}</span>
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// --- Raw JSON ---------------------------------------------------------------

export function RawJsonView({ config }: { config: IntegrationConfig }) {
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(config, null, 2)

  async function copy() {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable — ignore.
    }
  }

  return (
    <div className="relative">
      <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/50 p-3 pr-12 text-xs font-mono">
        {json}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-7 w-7"
        onClick={() => void copy()}
        title="Copy to clipboard"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  )
}

// --- Gate report ------------------------------------------------------------

export function GateReportView({ report }: { report: GateReport }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-xs ${
        report.ok
          ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}
    >
      <p className="flex items-center gap-1.5 font-medium">
        {report.ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {report.ok
          ? `Gate passed — ${report.corpus.passed}/${report.corpus.total} corpus cases`
          : `Gate failed — ${report.problems.length} problem(s), ${report.corpus.passed}/${report.corpus.total} corpus cases`}
      </p>
      {report.problems.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono">
          {report.problems.map((p, i) => (
            <li key={i}>
              [{p.stage}] {p.where}: {p.problem}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// --- Editor -----------------------------------------------------------------

const TEXTAREA_CLASS =
  'w-full min-h-[16rem] rounded-md border bg-muted/30 p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/**
 * Edit a TENANT config's mapping + rules as JSON, dry-run the gate, and publish
 * a new version. The corpus is carried through unchanged from the current config
 * (edit mapping/rules only). Publish is blocked until a validate passes on the
 * exact current text — any edit clears the prior verdict.
 */
export function IntegrationConfigEditor({
  config,
  onClose,
}: {
  config: IntegrationConfig
  onClose: () => void
}) {
  const [mappingText, setMappingText] = useState(() => JSON.stringify(config.mapping, null, 2))
  const [rulesText, setRulesText] = useState(() => JSON.stringify(config.rules, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [report, setReport] = useState<GateReport | null>(null)

  const validate = useValidateIntegrationConfig(config.integrationId)
  const publish = usePublishIntegrationConfig(config.integrationId)

  function parseDraft(): ConfigDraft | null {
    try {
      const draft: ConfigDraft = {
        mapping: JSON.parse(mappingText),
        rules: JSON.parse(rulesText),
        corpus: config.corpus,
      }
      setParseError(null)
      return draft
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
      return null
    }
  }

  // Any edit invalidates a prior gate verdict — you must re-validate to publish.
  function editMapping(v: string) {
    setMappingText(v)
    setReport(null)
  }
  function editRules(v: string) {
    setRulesText(v)
    setReport(null)
  }

  function onValidate() {
    const draft = parseDraft()
    if (!draft) return
    setReport(null)
    validate.mutate(draft, { onSuccess: (r) => setReport(r) })
  }

  function onPublish() {
    const draft = parseDraft()
    if (!draft) return
    publish.mutate(draft, { onSuccess: onClose })
  }

  const busy = validate.isPending || publish.isPending
  const canPublish = report?.ok === true && !busy

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Mapping (JSON)</label>
            <textarea
              className={TEXTAREA_CLASS}
              value={mappingText}
              spellCheck={false}
              onChange={(e) => editMapping(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Rules (JSON)</label>
            <textarea
              className={TEXTAREA_CLASS}
              value={rulesText}
              spellCheck={false}
              onChange={(e) => editRules(e.target.value)}
            />
          </div>
        </div>

        {parseError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Invalid JSON: {parseError}
          </div>
        )}
        {report && <GateReportView report={report} />}
        {(validate.error || publish.error) && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {(validate.error ?? publish.error) instanceof ApiError
              ? ((validate.error ?? publish.error) as ApiError).message
              : 'Request failed.'}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onValidate} disabled={busy}>
            {validate.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            Validate
          </Button>
          <Button variant="default" size="sm" onClick={onPublish} disabled={!canPublish}>
            {publish.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Publish new version
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            <X className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
          {!canPublish && !report && (
            <span className="text-xs text-muted-foreground">Validate before publishing.</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// --- Version history --------------------------------------------------------

export function ConfigVersionsCard({ integrationId }: { integrationId: string }) {
  const { data: versions } = useQuery(integrationConfigVersionsQueryOptions(integrationId))
  const rollback = useRollbackIntegrationConfig(integrationId)
  if (!versions || versions.length === 0) return null

  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <p className="mb-2 text-sm font-medium">Version history</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Published by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.map((v: IntegrationConfigVersion) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-xs">
                  v{v.version}
                  {v.forkedFromVersion != null && (
                    <span className="ml-1 text-muted-foreground">
                      (forked from platform v{v.forkedFromVersion})
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={v.status === 'PUBLISHED' ? 'secondary' : 'muted'}>
                    {v.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{v.publishedBy}</TableCell>
                <TableCell className="text-right">
                  {v.status === 'SUPERSEDED' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => rollback.mutate(v.version)}
                      disabled={rollback.isPending}
                    >
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      Roll back
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rollback.error instanceof ApiError && (
          <p className="mt-2 text-xs text-destructive">{rollback.error.message}</p>
        )}
      </CardContent>
    </Card>
  )
}

// --- Page -------------------------------------------------------------------

export function IntegrationDetailPage() {
  const { integrationId } = useParams({ strict: false }) as { integrationId: string }
  const [editing, setEditing] = useState(false)
  const perms = usePermissions()
  const fork = useForkIntegrationConfig()
  const {
    data: config,
    isLoading,
    isError,
    error,
  } = useQuery(integrationConfigQueryOptions(integrationId ?? ''))

  const breadcrumbs = [{ label: 'Integrations', href: '/integrations' }, { label: integrationId }]

  if (isLoading) {
    return (
      <div>
        <PageHeader title={integrationId} breadcrumbs={breadcrumbs} />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading config…
        </div>
      </div>
    )
  }

  if (isError) {
    // A 404 means no published config exists for this integration's scope — an
    // expected state, not a failure. Any other error is a real load failure.
    const isNotFound = error instanceof ApiError && error.status === 404
    return (
      <div>
        <PageHeader title={integrationId} breadcrumbs={breadcrumbs} />
        {isNotFound ? (
          <EmptyState
            title="No published config"
            description="This integration has no published mapping or rules yet."
            action={
              <Link to="/integrations" className="text-sm text-primary hover:underline">
                Back to integrations
              </Link>
            }
          />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Failed to load the integration config.
          </div>
        )}
      </div>
    )
  }

  if (!config) {
    return (
      <div>
        <PageHeader title={integrationId} breadcrumbs={breadcrumbs} />
        <EmptyState
          title="No published config"
          description="This integration has no published mapping or rules yet."
          action={
            <Link to="/integrations" className="text-sm text-primary hover:underline">
              Back to integrations
            </Link>
          }
        />
      </div>
    )
  }

  const isTenantOwned = config.visibility === 'TENANT'
  const isPlatform = config.visibility === 'GLOBAL'

  return (
    <div>
      <PageHeader
        title={config.integrationId}
        breadcrumbs={breadcrumbs}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">v{config.version}</Badge>
            <Badge variant="outline">{isTenantOwned ? 'Your config' : 'Platform'}</Badge>
            {isPlatform && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => fork.mutate(config.integrationId)}
                disabled={fork.isPending}
              >
                {fork.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitFork className="mr-1.5 h-3.5 w-3.5" />
                )}
                Fork to my tenant
              </Button>
            )}
            {isTenantOwned && !editing && (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
          </div>
        }
      />

      {isPlatform && (
        <p className="mb-3 text-sm text-muted-foreground">
          This is the platform&rsquo;s shared config. Fork it to customize the mapping and rules for
          your tenant.
        </p>
      )}
      {isTenantOwned && config.forkedFromVersion != null && (
        <p className="mb-3 text-sm text-muted-foreground">
          Your config — forked from platform v{config.forkedFromVersion}.
        </p>
      )}
      {fork.error instanceof ApiError && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {fork.error.message}
        </div>
      )}

      {editing && isTenantOwned ? (
        <IntegrationConfigEditor config={config} onClose={() => setEditing(false)} />
      ) : (
        <Tabs defaultValue="mapping">
          <TabsList>
            <TabsTrigger value="mapping">Mapping</TabsTrigger>
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="raw">Raw JSON</TabsTrigger>
            {/* Ingress management — only for an inbound-capable config the caller can manage. */}
            {config.inbound != null && perms.has('ingress:manage') && (
              <TabsTrigger value="ingress">Ingress</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="mapping" className="mt-4">
            <MappingTable mapping={config.mapping} />
          </TabsContent>

          <TabsContent value="rules" className="mt-4">
            <RulesTable rules={config.rules} />
          </TabsContent>

          <TabsContent value="raw" className="mt-4">
            <RawJsonView config={config} />
          </TabsContent>

          {config.inbound != null && perms.has('ingress:manage') && (
            <TabsContent value="ingress" className="mt-4">
              <IngressPanel integrationId={config.integrationId} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {isTenantOwned && !editing && <ConfigVersionsCard integrationId={config.integrationId} />}
    </div>
  )
}
