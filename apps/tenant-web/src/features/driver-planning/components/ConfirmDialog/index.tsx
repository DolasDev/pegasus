import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '../Button'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  open: boolean
  title?: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          aria-describedby={description ? 'confirm-dialog-description' : undefined}
        >
          <Dialog.Title asChild>
            <h2 className={styles.title}>{title}</h2>
          </Dialog.Title>
          {description ? (
            <p id="confirm-dialog-description" className={styles.description}>
              {description}
            </p>
          ) : null}
          <div className={styles.actions}>
            <Button
              type="button"
              inverted
              color={destructive ? 'red' : ''}
              onClick={onCancel}
              data-testid="confirm-dialog-cancel"
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              color={destructive ? 'red' : ''}
              onClick={onConfirm}
              data-testid="confirm-dialog-confirm"
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// --- ConfirmProvider / useConfirm: a Promise-based imperative API.
//
// Use when the legacy code was:
//   if (window.confirm(msg)) { action() }
// Rewritten as:
//   if (await confirm({ description: msg })) { action() }

export interface ConfirmOptions {
  title?: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState>({ open: false })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState({ open: false })
    if (resolve) resolve(value)
  }, [])

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setState({ ...options, open: true })
    })
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={state.open}
        title={state.title}
        description={state.description}
        {...(state.confirmLabel !== undefined ? { confirmLabel: state.confirmLabel } : {})}
        {...(state.cancelLabel !== undefined ? { cancelLabel: state.cancelLabel } : {})}
        destructive={state.destructive ?? false}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used within a <ConfirmProvider>')
  }
  return ctx
}
