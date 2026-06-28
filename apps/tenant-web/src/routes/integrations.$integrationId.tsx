import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { Check, Copy, Loader2 } from 'lucide-react'
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
import { ApiError } from '@/api/client'
import { integrationConfigQueryOptions } from '@/api/queries/integrations'
import type {
  IntegrationConfig,
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

// --- Page -------------------------------------------------------------------

export function IntegrationDetailPage() {
  const { integrationId } = useParams({ strict: false }) as { integrationId: string }
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

  return (
    <div>
      <PageHeader
        title={config.integrationId}
        breadcrumbs={breadcrumbs}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="secondary">v{config.version}</Badge>
            <Badge variant="outline">{config.visibility}</Badge>
          </div>
        }
      />

      <Tabs defaultValue="mapping">
        <TabsList>
          <TabsTrigger value="mapping">Mapping</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="raw">Raw JSON</TabsTrigger>
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
      </Tabs>
    </div>
  )
}
