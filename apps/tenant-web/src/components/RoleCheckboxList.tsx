import type { RoleOption } from '@/api/queries/users'

type RoleCheckboxListProps = {
  options: RoleOption[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  /** Used to namespace input ids when multiple lists exist on a page. */
  idPrefix: string
}

/**
 * Reusable checkbox list of Cedar role groups. Used by the user invite/manage
 * forms and by the developer-settings API-client form (where the selection
 * drives the bound service-account user's roleNames).
 */
export function RoleCheckboxList({
  options,
  selected,
  onChange,
  disabled,
  idPrefix,
}: RoleCheckboxListProps) {
  function toggle(name: string) {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name))
    } else {
      onChange([...selected, name])
    }
  }

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const id = `${idPrefix}-${opt.name}`
        const checked = selected.includes(opt.name)
        return (
          <label
            key={opt.name}
            htmlFor={id}
            className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-accent/40"
          >
            <input
              id={id}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => toggle(opt.name)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.description}</span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
