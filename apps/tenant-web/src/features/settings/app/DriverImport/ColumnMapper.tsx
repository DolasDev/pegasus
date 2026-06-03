// ---------------------------------------------------------------------------
// ColumnMapper — step 2 of the Driver Import dialog.
//
// Renders one row per source column with a sample value and a dropdown of
// import targets. Pure presentational: parent owns the mapping array.
// ---------------------------------------------------------------------------
import { TARGETS, type ColumnMapping, type ImportTarget } from './csv'

interface Props {
  columns: string[]
  /** Up to ~3 sample values per column for the planner to eyeball. */
  samples: string[][]
  mapping: ColumnMapping
  onChange: (next: ColumnMapping) => void
}

export function ColumnMapper({ columns, samples, mapping, onChange }: Props) {
  function setOne(idx: number, value: string) {
    const next = mapping.slice()
    next[idx] = value === '' ? null : (value as ImportTarget)
    onChange(next)
  }

  return (
    <div className="max-h-[50vh] overflow-y-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-medium">CSV column</th>
            <th className="px-3 py-2 font-medium">Sample</th>
            <th className="px-3 py-2 font-medium">Maps to</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => {
            const previewCells = samples
              .map((r) => r[i])
              .filter((v) => v != null && v !== '')
              .slice(0, 2)
            return (
              <tr key={i} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{col}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {previewCells.length > 0 ? previewCells.join(', ') : <em>(empty)</em>}
                </td>
                <td className="px-3 py-2">
                  <select
                    data-testid={`mapper-select-${i}`}
                    className="block w-full max-w-xs rounded-md border border-input bg-background px-2 py-1 text-sm"
                    value={mapping[i] ?? ''}
                    onChange={(e) => setOne(i, e.target.value)}
                  >
                    <option value="">— ignore —</option>
                    {TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                        {t.required ? ' *' : ''}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
