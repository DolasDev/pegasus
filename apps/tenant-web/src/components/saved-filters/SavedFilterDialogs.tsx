// ---------------------------------------------------------------------------
// Saved-filter dialogs shared by the Operations screens (Availability, Services).
//
// The Save dialog and the choose/load dialog. Same UX contract as Planning's
// SaveFilterModal / FilterModal:
//   - Save takes a name plus Make Default and Make Public;
//   - the choose dialog has My and Public tabs;
//   - your own filters offer Load, Use as Default and Delete.
// Built on the app's components/ui primitives. Each screen
// supplies its own data hooks (its own /…-filters endpoint) and a `screen` key
// that namespaces the element ids and test ids (`save-<screen>-filter-dialog`,
// `<screen>-filter-row`, …).
// ---------------------------------------------------------------------------
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  useQuery,
  type QueryKey,
  type UseMutationResult,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type SavedFilterScope = 'mine' | 'public'

/** The fields the dialogs read off a saved filter; each screen's DTO has more. */
export interface SavedFilterLike {
  id: string
  name: string
  isPublic: boolean
  isDefault: boolean
  owner: { email: string }
}

export interface SaveFilterInput<Q> {
  name: string
  query: Q
  isPublic: boolean
  isDefault: boolean
}

const CONTENT_CLASS =
  'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export interface SaveFilterDialogProps<Q> {
  /** Namespaces ids and test ids, e.g. `availability` → `availability-filter-name`. */
  screen: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The filter-bar state to save, already serialized. */
  query: Q
  save: UseMutationResult<unknown, Error, SaveFilterInput<Q>>
}

export function SaveFilterDialog<Q>({
  screen,
  open,
  onOpenChange,
  query,
  save,
}: SaveFilterDialogProps<Q>) {
  const [name, setName] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [isPublic, setIsPublic] = useState(false)

  function close() {
    setName('')
    setIsDefault(false)
    setIsPublic(false)
    save.reset()
    onOpenChange(false)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await save.mutateAsync({ name: name.trim(), query, isDefault, isPublic })
      close()
    } catch {
      // Rendered below from save.error.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={`${CONTENT_CLASS} w-[min(420px,92vw)]`}
          aria-describedby={undefined}
          data-testid={`save-${screen}-filter-dialog`}
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">Save Filter</h2>
          </Dialog.Title>
          <form onSubmit={handleSave} className="mt-4 space-y-4">
            <div className="space-y-1">
              <label htmlFor={`${screen}-filter-name`} className="text-sm font-medium">
                Filter Name
              </label>
              <Input
                id={`${screen}-filter-name`}
                data-testid={`${screen}-filter-name`}
                placeholder="Enter name"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid={`${screen}-filter-default`}
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Make Default
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid={`${screen}-filter-public`}
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                />
                Make Public
              </label>
            </div>
            {save.isError && (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage(save.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim() || save.isPending}
                data-testid={`${screen}-filter-save-submit`}
              >
                {save.isPending ? 'Saving…' : 'Save Filter'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// Choose / load
// ---------------------------------------------------------------------------

export interface ChooseFilterDialogProps<F extends SavedFilterLike, K extends QueryKey> {
  screen: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Apply the chosen filter to the page. */
  onLoad: (filter: F) => void
  listQueryOptions: (scope: SavedFilterScope) => UseQueryOptions<F[], Error, F[], K>
  setDefault: UseMutationResult<unknown, Error, string | null>
  remove: UseMutationResult<unknown, Error, string>
}

export function ChooseFilterDialog<F extends SavedFilterLike, K extends QueryKey>({
  screen,
  open,
  onOpenChange,
  onLoad,
  listQueryOptions,
  setDefault,
  remove,
}: ChooseFilterDialogProps<F, K>) {
  const [scope, setScope] = useState<SavedFilterScope>('mine')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const list = useQuery({ ...listQueryOptions(scope), enabled: open })

  const filters = list.data ?? []
  const selected = filters.find((f) => f.id === selectedId) ?? null
  const actionError = setDefault.error ?? remove.error

  function select(id: string | null) {
    setSelectedId(id)
    setConfirmingDelete(false)
    setDefault.reset()
    remove.reset()
  }

  function close() {
    select(null)
    onOpenChange(false)
  }

  function load(filter: F) {
    onLoad(filter)
    close()
  }

  async function useAsDefault() {
    if (!selected) return
    try {
      await setDefault.mutateAsync(selected.id)
      load(selected)
    } catch {
      // Rendered below from actionError.
    }
  }

  async function handleDelete() {
    if (!selected) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    try {
      await remove.mutateAsync(selected.id)
      select(null)
    } catch {
      setConfirmingDelete(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          className={`${CONTENT_CLASS} flex h-[min(520px,90vh)] w-[min(560px,92vw)] flex-col`}
          aria-describedby={undefined}
          data-testid={`${screen}-filters-dialog`}
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">Choose a Filter</h2>
          </Dialog.Title>

          <Tabs
            value={scope}
            onValueChange={(v) => {
              setScope(v as SavedFilterScope)
              select(null)
            }}
            className="mt-4"
          >
            <TabsList>
              <TabsTrigger value="mine" data-testid={`${screen}-filters-tab-mine`}>
                My Filters
              </TabsTrigger>
              <TabsTrigger value="public" data-testid={`${screen}-filters-tab-public`}>
                Public Filters
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border text-sm">
            <div className="sticky top-0 grid grid-cols-[1fr_1fr] gap-2 border-b bg-muted px-3 py-2 font-medium">
              <span>Filter Name</span>
              <span>Created By</span>
            </div>
            {list.isLoading ? (
              <p className="px-3 py-6 text-center text-muted-foreground">Loading…</p>
            ) : list.isError ? (
              <p className="px-3 py-6 text-center text-destructive" role="alert">
                {errorMessage(list.error)}
              </p>
            ) : filters.length === 0 ? (
              <p className="px-3 py-6 text-center text-muted-foreground">
                {scope === 'mine' ? 'You have no saved filters yet.' : 'No public filters yet.'}
              </p>
            ) : (
              <ul role="listbox" aria-label="Saved filters">
                {filters.map((f) => (
                  <li
                    key={f.id}
                    role="option"
                    aria-selected={f.id === selectedId}
                    data-testid={`${screen}-filter-row`}
                    className={`grid cursor-pointer grid-cols-[1fr_1fr] gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-accent ${
                      f.id === selectedId ? 'bg-accent font-medium' : ''
                    }`}
                    onClick={() => select(f.id)}
                    onDoubleClick={() => load(f)}
                  >
                    <span className="truncate">
                      {f.isDefault && (
                        <i
                          className="fas fa-star mr-1 text-yellow-500"
                          title="Your default"
                          data-testid={`${screen}-filter-default-star`}
                        />
                      )}
                      {f.name}
                      {scope === 'mine' && f.isPublic && (
                        <span className="ml-2 text-xs text-muted-foreground">(public)</span>
                      )}
                    </span>
                    <span className="truncate text-muted-foreground">{f.owner.email}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {actionError && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {errorMessage(actionError)}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Close
            </Button>
            {selected && (
              <>
                {scope === 'mine' && (
                  <Button
                    type="button"
                    variant={confirmingDelete ? 'destructive' : 'outline'}
                    onClick={handleDelete}
                    disabled={remove.isPending}
                    data-testid={`${screen}-filter-delete`}
                  >
                    {confirmingDelete ? 'Confirm Delete' : 'Delete'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={useAsDefault}
                  disabled={setDefault.isPending}
                  data-testid={`${screen}-filter-use-default`}
                >
                  Use as Default
                </Button>
                <Button
                  type="button"
                  onClick={() => load(selected)}
                  data-testid={`${screen}-filter-load`}
                >
                  Load
                </Button>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
