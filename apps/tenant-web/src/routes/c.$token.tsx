import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CalendarDays,
  Clock,
  Loader2,
  MapPin,
  Pencil,
  Scale,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CrewLinkError,
  addPacker,
  getCrewJob,
  loadSession,
  removePacker,
  requestCode,
  saveSession,
  setActivityPackers,
  updatePacker,
  verifyCode,
  type CrewJob,
  type CrewJobActivity,
  type CrewPacker,
  type PackerInput,
} from '@/api/crew-link'

// ---------------------------------------------------------------------------
// Crew-link page — `/c/<token>`, opened by a crew leader (no login) from a link
// their driver shared. Standalone (hangs off the root route, no auth).
//
//   1. "Text me a code" — the API texts a 6-digit code to the crew's phone on
//      file. This page never asks for a phone number.
//   2. Enter the code — the API returns a session, kept in sessionStorage.
//   3. The job: address, days, arrival window, weight, and the activities the
//      driver gave this crew, each with the crew's packers to tick. Below it,
//      the crew's packer list (add, edit, remove).
//
// Built for a phone first. Plan: plans/completed/*-crew-leader-link.md.
// ---------------------------------------------------------------------------

const RESEND_COOLDOWN_S = 30

function errorText(err: unknown): string {
  return err instanceof CrewLinkError ? err.message : 'Something went wrong. Try again.'
}

const isCode = (err: unknown, code: string) => err instanceof CrewLinkError && err.code === code

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto w-full max-w-lg space-y-4">{children}</div>
    </div>
  )
}

function InactiveLink() {
  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-destructive" />
            This link is no longer active
          </CardTitle>
          <CardDescription>
            It may have expired or been replaced. Ask your driver to send you a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    </Shell>
  )
}

// ── Step 1 + 2: the texted code ──────────────────────────────────────────────

function AccessGate({
  token,
  onSession,
  onInactive,
}: {
  token: string
  onSession: (session: string) => void
  onInactive: () => void
}) {
  const [hint, setHint] = useState<string | null>(null)
  // A reload (e.g. coming back from Messages) loses `hint`; the code already
  // texted is still good, so let them enter it without sending another.
  const [haveCode, setHaveCode] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode() {
    setError(null)
    setBusy(true)
    try {
      const sent = await requestCode(token)
      setHint(sent.phoneHint)
      setCode('')
      setCooldown(RESEND_COOLDOWN_S)
    } catch (err) {
      if (isCode(err, 'LINK_INACTIVE')) return onInactive()
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { session } = await verifyCode(token, code.trim())
      onSession(session)
    } catch (err) {
      if (isCode(err, 'LINK_INACTIVE')) return onInactive()
      if (
        err instanceof CrewLinkError &&
        err.code === 'CODE_INCORRECT' &&
        err.attemptsLeft != null
      ) {
        setError(
          `That code isn't right. ${err.attemptsLeft} ${err.attemptsLeft === 1 ? 'try' : 'tries'} left.`,
        )
      } else {
        setError(errorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Crew access</CardTitle>
          <CardDescription>
            {hint
              ? `We texted a 6-digit code to the crew phone ending ${hint.slice(-4)}.`
              : haveCode
                ? 'Enter the 6-digit code we texted to the crew phone.'
                : "Your driver shared this job with your crew. We'll text a code to the crew phone on file to make sure it's you."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hint || haveCode ? (
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="crew-code">Code</Label>
                <Input
                  id="crew-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center text-lg tracking-[0.4em]"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
              </Button>
            </form>
          ) : (
            <>
              <Button className="w-full" disabled={busy} onClick={() => void sendCode()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Text me a code
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setHaveCode(true)}>
                I already have a code
              </Button>
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </Shell>
  )
}

// ── Step 3: the job ──────────────────────────────────────────────────────────

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

function activityDay(a: CrewJobActivity): string | null {
  if (a.actualDate) return `${fmtDay(a.actualDate)} (done)`
  if (a.estimatedDate) return fmtDay(a.estimatedDate)
  if (a.plannedStart) return `${fmtDay(a.plannedStart)} (planned)`
  return null
}

function addressLines(a: CrewJobActivity): string[] {
  if (!a.address) return []
  const { street, unit, city, state, zip } = a.address
  const line1 = [street, unit].filter(Boolean).join(' ')
  const line2 = [[city, state].filter(Boolean).join(', '), zip].filter(Boolean).join(' ')
  return [line1, line2].filter((l) => l.length > 0)
}

const packerName = (p: CrewPacker) => `${p.firstName} ${p.lastName}`

function ActivityCard({
  activity,
  packers,
  saving,
  onToggle,
}: {
  activity: CrewJobActivity
  packers: CrewPacker[]
  saving: boolean
  onToggle: (packerId: string, on: boolean) => void
}) {
  const day = activityDay(activity)
  const lines = addressLines(activity)
  const selected = new Set(activity.packerIds)
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          {activity.typeName}
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </CardTitle>
        <div className="space-y-1 text-sm text-muted-foreground">
          {day && (
            <p className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" /> {day}
            </p>
          )}
          {activity.arrivalWindow && (
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Start {activity.arrivalWindow.start}–
              {activity.arrivalWindow.end}
            </p>
          )}
          {lines.length > 0 && (
            <p className="flex items-start gap-2">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {lines.map((l) => (
                  <span key={l} className="block">
                    {l}
                  </span>
                ))}
              </span>
            </p>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-sm font-medium">Who&rsquo;s working it</p>
        {packers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add your crew below, then tick them here.</p>
        ) : (
          <ul className="space-y-1">
            {packers.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-muted">
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={selected.has(p.id)}
                    disabled={saving}
                    onChange={(e) => onToggle(p.id, e.target.checked)}
                  />
                  <span className="text-sm">{packerName(p)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const EMPTY_FORM: Required<{ [K in keyof PackerInput]: string }> = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  cidNumber: '',
  cidIssuedOn: '',
}

function formFrom(p: CrewPacker): typeof EMPTY_FORM {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    phone: p.phoneDisplay ?? p.phone ?? '',
    email: p.email ?? '',
    cidNumber: p.cidNumber ?? '',
    cidIssuedOn: p.cidIssuedOn ?? '',
  }
}

function toInput(f: typeof EMPTY_FORM): PackerInput {
  const opt = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    phone: opt(f.phone),
    email: opt(f.email),
    cidNumber: opt(f.cidNumber),
    cidIssuedOn: opt(f.cidIssuedOn),
  }
}

function PackerForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: typeof EMPTY_FORM
  submitLabel: string
  onSubmit: (input: PackerInput) => Promise<void>
  onCancel?: () => void
}) {
  const [f, setF] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const field = (key: keyof typeof EMPTY_FORM, label: string, type = 'text') => (
    <div className="space-y-1.5">
      <Label htmlFor={`packer-${key}`}>{label}</Label>
      <Input
        id={`packer-${key}`}
        type={type}
        value={f[key]}
        onChange={(e) => setF((prev) => ({ ...prev, [key]: e.target.value }))}
      />
    </div>
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await onSubmit(toInput(f))
      setF(initial)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {field('firstName', 'First name')}
        {field('lastName', 'Last name')}
      </div>
      {field('phone', 'Phone', 'tel')}
      {field('email', 'Email', 'email')}
      <div className="grid grid-cols-2 gap-3">
        {field('cidNumber', 'CID number')}
        {field('cidIssuedOn', 'CID issued', 'date')}
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          className="flex-1"
          disabled={busy || !f.firstName.trim() || !f.lastName.trim()}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function CrewList({
  token,
  session,
  packers,
  onChanged,
  onError,
}: {
  token: string
  session: string
  packers: CrewPacker[]
  onChanged: () => Promise<void>
  onError: (err: unknown) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)

  async function remove(id: string) {
    try {
      await removePacker(token, session, id)
      setConfirming(null)
      await onChanged()
    } catch (err) {
      onError(err)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Your crew</CardTitle>
        <CardDescription>Changes here update your crew everywhere it&rsquo;s used.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {packers.length === 0 && (
          <p className="text-sm text-muted-foreground">No one on your crew yet.</p>
        )}
        <ul className="divide-y">
          {packers.map((p) =>
            editing === p.id ? (
              <li key={p.id} className="py-3">
                <PackerForm
                  initial={formFrom(p)}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (input) => {
                    await updatePacker(token, session, p.id, input)
                    setEditing(null)
                    await onChanged()
                  }}
                />
              </li>
            ) : (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{packerName(p)}</p>
                  {p.phoneDisplay && (
                    <p className="text-xs text-muted-foreground">{p.phoneDisplay}</p>
                  )}
                </div>
                {confirming === p.id ? (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="destructive" onClick={() => void remove(p.id)}>
                      Remove
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${packerName(p)}`}
                      onClick={() => setEditing(p.id)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${packerName(p)}`}
                      onClick={() => setConfirming(p.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ),
          )}
        </ul>
        {adding ? (
          <PackerForm
            initial={EMPTY_FORM}
            submitLabel="Add to crew"
            onCancel={() => setAdding(false)}
            onSubmit={async (input) => {
              await addPacker(token, session, input)
              setAdding(false)
              await onChanged()
            }}
          />
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
            Add a crew member
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function JobView({
  token,
  session,
  onSignedOut,
  onInactive,
}: {
  token: string
  session: string
  onSignedOut: () => void
  onInactive: () => void
}) {
  const qc = useQueryClient()
  const key = ['crew-link-job', token]
  const [error, setError] = useState<string | null>(null)
  const job = useQuery({
    queryKey: key,
    queryFn: () => getCrewJob(token, session),
    retry: false,
  })

  function handle(err: unknown) {
    if (isCode(err, 'SESSION_EXPIRED')) return onSignedOut()
    if (isCode(err, 'LINK_INACTIVE')) return onInactive()
    setError(errorText(err))
  }

  useEffect(() => {
    if (job.error) handle(job.error)
  }, [job.error])

  const select = useMutation({
    mutationFn: (v: { activityId: number; packerIds: string[] }) =>
      setActivityPackers(token, session, v.activityId, v.packerIds),
    onMutate: (v) => {
      setError(null)
      const before = qc.getQueryData<CrewJob>(key)
      qc.setQueryData<CrewJob>(
        key,
        (j) =>
          j && {
            ...j,
            activities: j.activities.map((a) =>
              a.id === v.activityId ? { ...a, packerIds: v.packerIds } : a,
            ),
          },
      )
      return { before }
    },
    // Re-read after every save so the boxes show what the server kept.
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before)
      handle(err)
    },
  })

  if (job.isPending) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the job…
        </div>
      </Shell>
    )
  }
  if (!job.data) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Couldn&rsquo;t load the job
            </CardTitle>
            <CardDescription>{error ?? 'Try again in a minute.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => void job.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  const data = job.data
  const lbs = (n: number) => `${n.toLocaleString()} lbs`
  return (
    <Shell>
      <div>
        <h1 className="text-xl font-semibold">{data.crew.name}</h1>
        <p className="text-sm text-muted-foreground">Order {data.orderNum}</p>
      </div>
      {(data.weight.estimated != null || data.weight.actual != null) && (
        <Card>
          <CardContent className="flex items-center gap-2 py-4 text-sm">
            <Scale className="h-4 w-4 text-muted-foreground" />
            {data.weight.actual != null
              ? `Actual weight ${lbs(data.weight.actual)}`
              : `Estimated weight ${lbs(data.weight.estimated!)}`}
          </CardContent>
        </Card>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {data.activities.map((a) => (
        <ActivityCard
          key={a.id}
          activity={a}
          packers={data.packers}
          saving={select.isPending && select.variables?.activityId === a.id}
          onToggle={(packerId, on) =>
            select.mutate({
              activityId: a.id,
              packerIds: on
                ? [...a.packerIds, packerId]
                : a.packerIds.filter((id) => id !== packerId),
            })
          }
        />
      ))}
      <CrewList
        token={token}
        session={session}
        packers={data.packers}
        onError={handle}
        onChanged={async () => {
          setError(null)
          await qc.invalidateQueries({ queryKey: key })
        }}
      />
    </Shell>
  )
}

export function CrewLinkPage() {
  const { token } = useParams({ strict: false }) as { token: string }
  const [session, setSession] = useState<string | null>(() => loadSession(token))
  const [inactive, setInactive] = useState(false)

  if (inactive) return <InactiveLink />
  if (!session) {
    return (
      <AccessGate
        token={token}
        onInactive={() => setInactive(true)}
        onSession={(s) => {
          saveSession(token, s)
          setSession(s)
        }}
      />
    )
  }
  return (
    <JobView
      token={token}
      session={session}
      onInactive={() => {
        saveSession(token, null)
        setInactive(true)
      }}
      onSignedOut={() => {
        saveSession(token, null)
        setSession(null)
      }}
    />
  )
}
