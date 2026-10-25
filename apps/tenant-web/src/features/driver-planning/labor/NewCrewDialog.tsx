// ---------------------------------------------------------------------------
// New crew — add a crew to the company list by phone number.
//
// The server decides what "new" means (a number can already exist platform-wide,
// or already be on the list), so the dialog reports the outcome rather than
// assuming it. The two surprising ones, `linkedExisting` and `alreadyInList`,
// stay on screen as a notice; the plain ones toast and close.
// ---------------------------------------------------------------------------
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from '@/components/ui/button'
import { notifySuccess } from '../components/Snackbar/notify'
import { useCreateCompanyCrew, type CreateOutcome, type LaborCrewDetail } from '@/api/queries/labor'
import { CENTER_CLASS, Field, FormError, OVERLAY_CLASS } from './dialogs'
import { laborErrorMessage } from './labor-errors'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open the crew's detail. */
  onOpenCrew: (phone: string) => void
}

export function outcomeMessage(outcome: CreateOutcome, crew: LaborCrewDetail, typed: string) {
  switch (outcome) {
    case 'added':
      return `Added ${crew.displayName} to the company list.`
    case 'addedFromMyList':
      return `${crew.displayName} was already in your own list; it is now on the company list too.`
    case 'linkedExisting':
      return (
        `${crew.phoneDisplay} already exists on Pegasus, so its shared name "${crew.name}" stands.` +
        (crew.companyNickname
          ? ` Your company's nickname for it is "${crew.companyNickname}"` +
            `${crew.companyNickname === typed ? ', the name you typed' : ''}.`
          : '')
      )
    case 'alreadyInList':
      return `${crew.displayName} is already on the company list. Nothing was changed.`
  }
}

export function NewCrewDialog({ open, onOpenChange, onOpenCrew }: Props) {
  const create = useCreateCompanyCrew()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [nickname, setNickname] = useState('')
  const [notice, setNotice] = useState<{ message: string; phone: string } | null>(null)

  function close() {
    setPhone('')
    setName('')
    setEmail('')
    setNickname('')
    setNotice(null)
    create.reset()
    onOpenChange(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!phone.trim() || !name.trim()) return
    try {
      const { crew, outcome } = await create.mutateAsync({
        phone: phone.trim(),
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(nickname.trim() ? { nickname: nickname.trim() } : {}),
      })
      const message = outcomeMessage(outcome, crew, name.trim())
      if (outcome === 'linkedExisting' || outcome === 'alreadyInList') {
        setNotice({ message, phone: crew.phone })
        return
      }
      notifySuccess(message)
      close()
      onOpenCrew(crew.phone)
    } catch {
      // Rendered below from create.error.
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={OVERLAY_CLASS} />
        <Dialog.Content
          className={`${CENTER_CLASS} w-[min(460px,92vw)]`}
          aria-describedby={undefined}
          data-testid="labor-new-crew-dialog"
        >
          <Dialog.Title asChild>
            <h2 className="text-lg font-semibold">New crew</h2>
          </Dialog.Title>
          {notice ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm" role="status" data-testid="labor-new-crew-notice">
                {notice.message}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>
                  Done
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    const target = notice.phone
                    close()
                    onOpenCrew(target)
                  }}
                >
                  View crew
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-4 space-y-4">
              <Field
                id="labor-new-phone"
                label="Phone"
                type="tel"
                placeholder="(555) 123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
                required
              />
              <Field
                id="labor-new-name"
                label="Name"
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <Field
                id="labor-new-email"
                label="Email (optional)"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Field
                id="labor-new-nickname"
                label="Company nickname (optional)"
                hint="How this crew shows on your company list."
                maxLength={120}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
              <FormError message={create.isError ? laborErrorMessage(create.error) : null} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending || !phone.trim() || !name.trim()}>
                  {create.isPending ? 'Adding…' : 'Add crew'}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
