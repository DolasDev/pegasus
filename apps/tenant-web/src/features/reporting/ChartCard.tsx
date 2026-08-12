// ---------------------------------------------------------------------------
// ChartCard -- renders ONE widget of a dashboard definition.
//
// Every widget here is single-series (one measure across categories), which
// settles most of the visual design by itself:
//   - one series color (--chart-1), validated per theme against its own surface;
//   - NO legend -- the card title names the series;
//   - value labels and axes wear ink tokens, never the series color;
//   - grid and axes are recessive; no gridlines on the category axis.
//
// Recharts is confined to this file. Swapping to another library (ECharts, if
// dense operational visuals ever land) touches nothing else.
// ---------------------------------------------------------------------------

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ReportingColumn, ReportingResult, ReportingRow } from '@/api/queries/reporting'
import type { DashboardWidget } from './dashboard-definition'

const SERIES = 'var(--color-chart-1)'

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})
const num = new Intl.NumberFormat('en-US')

export function formatValue(value: unknown, type: ReportingColumn['type']): string {
  if (value === null || value === undefined) return '—'
  if (type === 'currency') return usd.format(Number(value))
  if (type === 'number') return num.format(Number(value))
  if (type === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

interface ChartCardProps {
  widget: DashboardWidget
  /** Undefined while the batch is still in flight. */
  result: ReportingResult | undefined
  /** Column metadata from the catalog; drives formatting and the table view. */
  columns: ReportingColumn[] | undefined
  isLoading: boolean
}

// Geometry is the GRID's job now (phase 2) — the card fills whatever cell it is
// placed in. `widget.span` is still carried on the document for rollback safety
// but is deliberately not read here; honoring both would give two competing
// sources of truth for width.
export function ChartCard({ widget, result, columns, isLoading }: ChartCardProps) {
  return (
    <Card
      className="flex h-full flex-col overflow-hidden"
      data-testid={`widget-${widget.datasetId}`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <Body widget={widget} result={result} columns={columns} isLoading={isLoading} />
      </CardContent>
    </Card>
  )
}

function Body({ widget, result, columns, isLoading }: ChartCardProps) {
  if (isLoading) {
    return <div className="h-24 animate-pulse rounded bg-muted" aria-label="Loading" />
  }

  // A widget degrades on its OWN -- an unavailable legacy source or a failed
  // dataset must never blank the rest of the dashboard.
  if (result?.error) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="widget-error">
        {result.error.code === 'MSSQL_NOT_CONFIGURED'
          ? 'Not available — this tenant has no legacy database configured.'
          : 'Could not load this data.'}
      </p>
    )
  }

  const rows = result?.rows ?? []
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data.</p>
  }

  const cols = columns ?? []
  switch (widget.widget) {
    case 'scalar':
      return <Scalar rows={rows} columns={cols} />
    case 'table':
      return <TableView rows={rows} columns={cols} />
    case 'line':
      return <Series rows={rows} columns={cols} kind="line" />
    case 'bar':
    default:
      return <Series rows={rows} columns={cols} kind="bar" />
  }
}

/**
 * Hero number. Per the form heuristic, a single headline value is NOT a chart --
 * rendering it as a one-bar chart would be strictly worse.
 */
function Scalar({ rows, columns }: { rows: ReportingRow[]; columns: ReportingColumn[] }) {
  const first = rows[0] ?? {}
  const primary = columns[0]
  const secondary = columns[1]

  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {primary ? formatValue(first[primary.key], primary.type) : '—'}
      </p>
      {secondary ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {formatValue(first[secondary.key], secondary.type)} {secondary.label.toLowerCase()}
        </p>
      ) : null}
    </div>
  )
}

function TableView({ rows, columns }: { rows: ReportingRow[]; columns: ReportingColumn[] }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell key={col.key} className={col.type === 'string' ? '' : 'tabular-nums'}>
                  {formatValue(row[col.key], col.type)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Single-series bar/line. The first string column is the category axis; the
 * first numeric column is the measure.
 */
function Series({
  rows,
  columns,
  kind,
}: {
  rows: ReportingRow[]
  columns: ReportingColumn[]
  kind: 'bar' | 'line'
}) {
  const categoryCol = columns.find((c) => c.type === 'string') ?? columns[0]
  const valueCol = columns.find((c) => c.type !== 'string') ?? columns[1]

  if (!categoryCol || !valueCol) {
    return <TableView rows={rows} columns={columns} />
  }

  const axisTick = { fontSize: 12, fill: 'var(--color-muted-foreground)' }
  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
      contentStyle={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        fontSize: 12,
        color: 'var(--color-card-foreground)',
      }}
      formatter={(value) => [formatValue(value, valueCol.type), valueCol.label]}
    />
  )

  return (
    <div className="h-full min-h-[8rem]">
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'line' ? (
          <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey={categoryCol.key} tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            {tooltip}
            <Line
              type="monotone"
              dataKey={valueCol.key}
              stroke={SERIES}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        ) : (
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {/* Horizontal rules only — vertical gridlines on a category axis are noise. */}
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis dataKey={categoryCol.key} tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} />
            {tooltip}
            {/* Rounded data-end only; the baseline end stays square. */}
            <Bar dataKey={valueCol.key} fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
