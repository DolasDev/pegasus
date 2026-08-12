// ---------------------------------------------------------------------------
// Per-widget settings — title, chart type, and dataset params.
//
// Params are rendered FROM the dataset's own `paramsSchema` (the JSON Schema the
// catalog endpoint returns), not from a hard-coded form per dataset. That is the
// whole point of the catalog being introspectable: a new dataset with a new
// enum param gets a working control here without a frontend change.
//
// Only enum and boolean params are rendered today — every seed dataset's params
// are closed sets. An unrecognized param type is shown as read-only rather than
// silently dropped, so a dataset that outgrows this is visible instead of quietly
// losing user input.
// ---------------------------------------------------------------------------

import type { ReportingDataset } from '@/api/queries/reporting'
import type { DashboardWidget, WidgetKind } from './dashboard-definition'

const WIDGET_KINDS: WidgetKind[] = ['scalar', 'bar', 'line', 'table']

interface JsonSchemaProperty {
  type?: string
  enum?: unknown[]
  default?: unknown
}

interface JsonSchemaish {
  properties?: Record<string, JsonSchemaProperty>
}

interface WidgetSettingsProps {
  widget: DashboardWidget
  dataset: ReportingDataset | undefined
  onChange: (next: DashboardWidget) => void
}

export function WidgetSettings({ widget, dataset, onChange }: WidgetSettingsProps) {
  const schema = (dataset?.paramsSchema ?? {}) as JsonSchemaish
  const properties = Object.entries(schema.properties ?? {})

  return (
    <div className="space-y-3">
      <div>
        <label
          className="mb-1 block text-xs font-medium text-muted-foreground"
          htmlFor={`title-${widget.datasetId}`}
        >
          Title
        </label>
        <input
          id={`title-${widget.datasetId}`}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={widget.title}
          onChange={(e) => onChange({ ...widget, title: e.target.value })}
        />
      </div>

      <div>
        <label
          className="mb-1 block text-xs font-medium text-muted-foreground"
          htmlFor={`kind-${widget.datasetId}`}
        >
          Chart type
        </label>
        <select
          id={`kind-${widget.datasetId}`}
          className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          value={widget.widget}
          onChange={(e) => onChange({ ...widget, widget: e.target.value as WidgetKind })}
        >
          {WIDGET_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>

      {properties.map(([name, prop]) => {
        const current = widget.params?.[name]

        if (Array.isArray(prop.enum)) {
          return (
            <div key={name}>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor={`p-${name}`}
              >
                {name}
              </label>
              <select
                id={`p-${name}`}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={String(current ?? prop.default ?? prop.enum[0])}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    params: { ...widget.params, [name]: e.target.value },
                  })
                }
              >
                {prop.enum.map((opt) => (
                  <option key={String(opt)} value={String(opt)}>
                    {String(opt)}
                  </option>
                ))}
              </select>
            </div>
          )
        }

        if (prop.type === 'boolean') {
          return (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input accent-primary"
                checked={Boolean(current ?? prop.default)}
                onChange={(e) =>
                  onChange({
                    ...widget,
                    params: { ...widget.params, [name]: e.target.checked },
                  })
                }
              />
              {name}
            </label>
          )
        }

        // Surfaced rather than dropped — see the header note.
        return (
          <p key={name} className="text-xs text-muted-foreground">
            <span className="font-medium">{name}</span>: not editable here ({prop.type ?? 'unknown'}{' '}
            param)
          </p>
        )
      })}
    </div>
  )
}
