// ---------------------------------------------------------------------------
// Crew detail drawer — everything Operations can change about a company crew.
//
//   - Header: name and email are SHARED with every tenant that has the number;
//     the company nickname is this tenant's own display name (blank clears it).
//   - Service areas: staged edits, one PUT (ServiceAreaEditor).
//   - Packers: add / edit / delete; shared like the header.
//   - Remove from company list: only when the API says `canRemoveFromCompany`.
//     It removes this tenant's link only; the crew record and any activity
//     history stay.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { notifySuccess } from '../components/Snackbar/notify'
import {
  crewDetailQueryOptions,
  useDeletePacker,
  useRemoveCompanyCrew,
  useUpdateCompanyCrew,
  type LaborCrewDetail,
  type LaborPacker,
} from '@/api/queries/labor'
import { Field, FormError, LaborConfirmDialog, OVERLAY_CLASS } from './dialogs'
import { laborErrorMessage } from './labor-errors'
import { PackerDialog } from './PackerDialog'
import { ServiceAreaEditor } from './ServiceAreaEditor'

interface Props {
  /** The crew's E.164 phone, or null when the drawer is closed. */
  phone: string | null
  onClose: () => void
}

export function CrewDetailDrawer({ phone, onClose }: Props) {
  return (
    <Dialog.Root open={phone !== null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content
          className="fixed right-0 top-0 z-50 h-full w-[min(600px,100vw)] overflow-y-auto border-l bg-background p-6 shadow-lg"
          aria-describedby={undefined}
          data-testid="labor-detail-drawer"
        >
          {phone && <DrawerBody key={phone} phone={phone} onClose={onClose} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DrawerBody({ phone, onClose }: { phone: string; onClose: () => void }) {
  const detail = useQuery(crewDetailQueryOptions(phone))
  const crew = detail.data

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Dialog.Title asChild>
            <h2 className="text-xl font-semibold">{crew?.displayName ?? 'Crew'}</h2>
          </Dialog.Title>
          {crew && <p className="text-sm text-muted-foreground">{crew.phoneDisplay}</p>}
        </div>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </Dialog.Close>
      </div>

      {detail.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {detail.isError && <FormError message={laborErrorMessage(detail.error)} />}
      {crew && (
        <>
          <HeaderForm key={`${crew.name}|${crew.email}|${crew.companyNickname}`} crew={crew} />
          <ServiceAreaEditor
            key={crew.serviceAreas.map((a) => a.id).join(',')}
            phone={crew.phone}
            serviceAreas={crew.serviceAreas}
          />
          <PackerSection crew={crew} />
          {crew.canRemoveFromCompany && <RemoveSection crew={crew} onRemoved={onClose} />}
        </>
      )}
    </div>
  )
}

function HeaderForm({ crew }: { crew: LaborCrewDetail }) {
  const update = useUpdateCompanyCrew(crew.phone)
  const [name, setName] = useState(crew.name)
  const [email, setEmail] = useState(crew.email ?? '')
  const [nickname, setNickname] = useState(crew.companyNickname ?? '')

  const dirty =
    name.trim() !== crew.name ||
    email.trim() !== (crew.email ?? '') ||
    nickname.trim() !== (crew.companyNickname ?? '')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !dirty) return
    try {
      await update.mutateAsync({
        ...(name.trim() !== crew.name ? { name: name.trim() } : {}),
        ...(email.trim() !== (crew.email ?? '') ? { email: email.trim() || null } : {}),
        ...(nickname.trim() !== (crew.companyNickname ?? '')
          ? { nickname: nickname.trim() || null }
          : {}),
      })
      notifySuccess('Crew saved')
    } catch {
      // Rendered below from update.error.
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Crew details">
      <Field
        id="labor-edit-name"
        label="Name"
        hint="Shared with every company that has this number."
        maxLength={120}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Field
        id="labor-edit-email"
        label="Email"
        type="email"
        hint="Shared with every company that has this number."
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        id="labor-edit-nickname"
        label="Company nickname"
        hint="How this crew shows on your company list. Leave blank to use the name."
        maxLength={120}
        value={nickname}
        onChange={(e) => setNickname(e.target.value)}
      />
      <FormError message={update.isError ? laborErrorMessage(update.error) : null} />
      <Button type="submit" disabled={!dirty || !name.trim() || update.isPending}>
        {update.isPending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}

function PackerSection({ crew }: { crew: LaborCrewDetail }) {
  const remove = useDeletePacker(crew.phone)
  // `null` = closed, `'new'` = add, otherwise the packer being edited.
  const [editing, setEditing] = useState<LaborPacker | 'new' | null>(null)
  const [deleting, setDeleting] = useState<LaborPacker | null>(null)

  async function confirmDelete() {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      notifySuccess('Packer removed')
      setDeleting(null)
    } catch {
      // Rendered in the confirm from remove.error.
    }
  }

  return (
    <section className="space-y-2" aria-labelledby="labor-packers-heading">
      <div className="flex items-center justify-between">
        <h3 id="labor-packers-heading" className="text-sm font-semibold">
          Packers ({crew.packers.length})
        </h3>
        <Button type="button" size="sm" variant="outline" onClick={() => setEditing('new')}>
          Add packer
        </Button>
      </div>
      {crew.packers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No packers on this crew.</p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="labor-packer-list">
          {crew.packers.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {p.firstName} {p.lastName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    p.phoneDisplay,
                    p.email,
                    p.cidNumber &&
                      `CID ${p.cidNumber}${p.cidIssuedOn ? ` (${p.cidIssuedOn})` : ''}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${p.firstName} ${p.lastName}`}
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${p.firstName} ${p.lastName}`}
                  onClick={() => {
                    remove.reset()
                    setDeleting(p)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <PackerDialog
          key={editing === 'new' ? 'new' : editing.id}
          phone={crew.phone}
          packer={editing === 'new' ? null : editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
      <LaborConfirmDialog
        open={deleting !== null}
        title="Delete packer"
        description={
          <>
            Delete {deleting?.firstName} {deleting?.lastName}? Packers are shared with every company
            that has this crew.
          </>
        }
        confirmLabel="Delete packer"
        pending={remove.isPending}
        error={remove.isError ? laborErrorMessage(remove.error) : null}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  )
}

function RemoveSection({ crew, onRemoved }: { crew: LaborCrewDetail; onRemoved: () => void }) {
  const remove = useRemoveCompanyCrew()
  const [confirming, setConfirming] = useState(false)

  async function confirm() {
    try {
      await remove.mutateAsync(crew.phone)
      notifySuccess(`Removed ${crew.displayName} from the company list`)
      setConfirming(false)
      onRemoved()
    } catch {
      // Rendered in the confirm from remove.error.
    }
  }

  return (
    <section className="border-t pt-4">
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          remove.reset()
          setConfirming(true)
        }}
      >
        Remove from company list
      </Button>
      <LaborConfirmDialog
        open={confirming}
        title="Remove from company list"
        description={
          <>
            Remove {crew.displayName} from the company list? The crew keeps its record, and past
            activity assignments are unaffected. Drivers who added this number to their own list
            keep it.
          </>
        }
        confirmLabel="Remove"
        pending={remove.isPending}
        error={remove.isError ? laborErrorMessage(remove.error) : null}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
