// ---------------------------------------------------------------------------
// Add / edit a packer on a crew.
//
// The API needs a first and last name plus at least one of email / CID number /
// phone, and an issue date (not in the future) with a CID number. The server
// is the authority on all of it; the form only keeps the obvious ones from
// round-tripping. On edit a blank field is sent as null, which CLEARS it.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { notifySuccess } from '../components/Snackbar/notify'
import { useAddPacker, useUpdatePacker, type LaborPacker } from '@/api/queries/labor'
import { CENTER_CLASS, Field, FormError, OVERLAY_CLASS } from './dialogs'
import { laborErrorMessage } from './labor-errors'

interface Props {
  phone: string
  /** The packer being edited; null adds a new one. */
  packer: LaborPacker | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const blankToNull = (s: string) => (s.trim() === '' ? null : s.trim())

export function PackerDialog({ phone, packer, open, onOpenChange }: Props) {
  const add = useAddPacker(phone)
  const update = useUpdatePacker(phone)
  const mutation = packer ? update : add
  const [firstName, setFirstName] = useState(packer?.firstName ?? '')
  const [lastName, setLastName] = useState(packer?.lastName ?? '')
  const [email, setEmail] = useState(packer?.email ?? '')
  const [packerPhone, setPackerPhone] = useState(packer?.phoneDisplay ?? packer?.phone ?? '')
  const [cidNumber, setCidNumber] = useState(packer?.cidNumber ?? '')
  const [cidIssuedOn, setCidIssuedOn] = useState(packer?.cidIssuedOn ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  function close() {
    mutation.reset()
    setLocalError(null)
    onOpenChange(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) return
    if (!email.trim() && !cidNumber.trim() && !packerPhone.trim()) {
      setLocalError('Give at least one of email, phone or CID number.')
      return
    }
    if (cidNumber.trim() && !cidIssuedOn) {
      setLocalError('A CID number needs the date it was issued.')
      return
    }
    setLocalError(null)
    const body = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: blankToNull(email),
      phone: blankToNull(packerPhone),
      cidNumber: blankToNull(cidNumber),
      cidIssuedOn: cidNumber.trim() ? cidIssuedOn : null,
    }
    try {
      if (packer) await update.mutateAsync({ id: packer.id, ...body })
      else await add.mutateAsync(body)
      notifySuccess(packer ? 'Packer updated' : 'Packer added')
      close()
    } catch {
      // Rendered below from mutation.error.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content
          className={`${CENTER_CLASS} w-[min(460px,92vw)]`}
          aria-describedby={undefined}
          data-testid="labor-packer-dialog"
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">{packer ? 'Edit packer' : 'Add packer'}</h2>
          </Dialog.Title>
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="labor-packer-first"
                label="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                autoFocus
                required
              />
              <Field
                id="labor-packer-last"
                label="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <Field
              id="labor-packer-email"
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              id="labor-packer-phone"
              label="Phone"
              type="tel"
              value={packerPhone}
              onChange={(e) => setPackerPhone(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                id="labor-packer-cid"
                label="CID number"
                value={cidNumber}
                onChange={(e) => setCidNumber(e.target.value)}
              />
              <Field
                id="labor-packer-cid-date"
                label="CID issued on"
                type="date"
                value={cidIssuedOn}
                onChange={(e) => setCidIssuedOn(e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              At least one of email, phone or CID number is required.
            </p>
            <FormError
              message={localError ?? (mutation.isError ? laborErrorMessage(mutation.error) : null)}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save packer'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
