// ---------------------------------------------------------------------------
// Small dialog building blocks for the Labor screen.
//
// The crew detail is a Radix drawer, and its confirm / packer dialogs open from
// inside it. Those have to be Radix dialogs NESTED in the drawer's React tree:
// Radix tracks layers through the tree, so a sibling dialog (like the shared
// driver-planning ConfirmProvider's, mounted above the drawer) would count as
// an outside click and dismiss the drawer underneath it.
// ---------------------------------------------------------------------------
import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { Input, type InputProps } from '@/components/ui/input'

export const OVERLAY_CLASS = 'fixed inset-0 z-50 bg-black/50'
export const CENTER_CLASS =
  'fixed left-1/2 top-1/2 z-50 max-h-[92vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg'

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  )
}

export function Field({
  id,
  label,
  hint,
  ...inputProps
}: { id: string; label: string; hint?: string } & InputProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} {...inputProps} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export interface ConfirmProps {
  open: boolean
  title: string
  description: ReactNode
  confirmLabel: string
  pending?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function LaborConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content
          className={`${CENTER_CLASS} w-[min(440px,92vw)]`}
          aria-describedby="labor-confirm-description"
          data-testid="labor-confirm-dialog"
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">{title}</h2>
          </Dialog.Title>
          <p id="labor-confirm-description" className="mt-2 text-sm text-muted-foreground">
            {description}
          </p>
          <div className="mt-4 space-y-3">
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirm}
                disabled={pending}
                data-testid="labor-confirm-ok"
              >
                {pending ? 'Working…' : confirmLabel}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
