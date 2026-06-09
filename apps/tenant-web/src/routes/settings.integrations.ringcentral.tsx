import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Phone, MessageSquare, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ringCentralConnectionsQueryOptions,
  useConnectRingCentral,
  useDisconnectRingCentral,
} from '@/api/queries/ringcentral'
import type { RcConnection } from '@/api/ringcentral'
import { ApiError } from '@/api/client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a connection's health to a Badge variant + label. */
function healthBadge(conn: RcConnection): {
  variant: 'success' | 'warning' | 'destructive'
  label: string
} {
  if (conn.tokenStatus === 'EXPIRED' || conn.health === 'UNHEALTHY') {
    return { variant: 'destructive', label: 'Unhealthy' }
  }
  if (conn.health === 'DEGRADED') {
    return { variant: 'warning', label: 'Degraded' }
  }
  return { variant: 'success', label: 'Healthy' }
}

function formatLastRefreshed(value: string | null): string {
  if (!value) return 'Never'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

// ---------------------------------------------------------------------------
// Connect form (empty / disconnected state)
// ---------------------------------------------------------------------------

function ConnectForm() {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [jwt, setJwt] = useState('')
  const [number, setNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const connectMutation = useConnectRingCentral()

  const isPending = connectMutation.isPending
  const isComplete =
    clientId.trim().length > 0 &&
    clientSecret.trim().length > 0 &&
    jwt.trim().length > 0 &&
    number.trim().length > 0

  async function handleConnect() {
    setError(null)
    try {
      await connectMutation.mutateAsync({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        jwt: jwt.trim(),
        number: number.trim(),
      })
      // On success the connections query invalidates and the connection card
      // replaces this form.
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(
          'Those RingCentral credentials were rejected — check the client id, secret, and JWT.',
        )
      } else if (err instanceof ApiError && err.status === 503) {
        setError('RingCentral is not enabled — contact your administrator.')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred. Please try again.')
      }
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Phone size={18} className="text-muted-foreground" />
          <CardTitle>Connect RingCentral</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Link your own RingCentral app so Pegasus can capture calls and messages. In the{' '}
          <a
            href="https://developers.ringcentral.com/guide/authentication/jwt-flow"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            RingCentral developer console
          </a>{' '}
          register an app, enable JWT auth, and create a JWT credential bound to that app&apos;s
          client id. Paste the client id, client secret, and JWT below, along with the owner
          extension&apos;s phone number in E.164 format.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="rc-client-id">Client ID</Label>
          <Input
            id="rc-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rc-client-secret">Client secret</Label>
          <Input
            id="rc-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rc-jwt">JWT</Label>
          <Input
            id="rc-jwt"
            type="password"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            disabled={isPending}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rc-number">Owner phone number</Label>
          <Input
            id="rc-number"
            placeholder="+14155550123"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            disabled={isPending}
          />
        </div>

        {error && (
          <div
            className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            className="gap-2"
            disabled={isPending || !isComplete}
            onClick={() => void handleConnect()}
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
            Connect RingCentral
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Disconnect confirmation
// ---------------------------------------------------------------------------

type DisconnectConfirmProps = {
  conn: RcConnection
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DisconnectConfirm({ conn, onConfirm, onCancel, isPending }: DisconnectConfirmProps) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Disconnect RingCentral?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          This will revoke the connection for <strong>{conn.ownerNumber}</strong>. Pegasus will stop
          capturing calls and messages for this extension until you reconnect.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending} className="gap-2">
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Connection card (connected state)
// ---------------------------------------------------------------------------

type ConnectionCardProps = {
  conn: RcConnection
  confirming: boolean
  onRequestDisconnect: () => void
  onCancelDisconnect: () => void
  onConfirmDisconnect: () => void
  isPending: boolean
}

function ConnectionCard({
  conn,
  confirming,
  onRequestDisconnect,
  onCancelDisconnect,
  onConfirmDisconnect,
  isPending,
}: ConnectionCardProps) {
  if (confirming) {
    return (
      <DisconnectConfirm
        conn={conn}
        onConfirm={onConfirmDisconnect}
        onCancel={onCancelDisconnect}
        isPending={isPending}
      />
    )
  }

  const badge = healthBadge(conn)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-muted-foreground" />
            <CardTitle>{conn.ownerNumber}</CardTitle>
          </div>
          <Badge variant={badge.variant} className="gap-1">
            {badge.variant === 'success' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {badge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <span className="text-muted-foreground">Token</span>
          <span>{conn.tokenStatus === 'ACTIVE' ? 'Active' : 'Expired'}</span>

          <span className="text-muted-foreground">Last refreshed</span>
          <span>{formatLastRefreshed(conn.lastRefreshedAt)}</span>

          <span className="text-muted-foreground">Scopes</span>
          <div className="flex flex-wrap gap-1.5">
            {conn.scopes.length > 0 ? (
              conn.scopes.map((scope) => (
                <Badge key={scope} variant="secondary" className="text-xs font-mono">
                  {scope}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground italic">None</span>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onRequestDisconnect}
          >
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function RingCentralIntegrationPage() {
  const { data, isLoading, isError } = useQuery(ringCentralConnectionsQueryOptions)
  const disconnectMutation = useDisconnectRingCentral()
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  async function handleDisconnect(id: string) {
    try {
      await disconnectMutation.mutateAsync(id)
      setConfirmingId(null)
    } catch {
      // The mutation surfaces its own error; keep the confirm card open.
    }
  }

  const header = (
    <PageHeader
      title="RingCentral"
      breadcrumbs={[{ label: 'Settings' }, { label: 'Integrations' }, { label: 'RingCentral' }]}
    />
  )

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Loading RingCentral connections…
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div>
        {header}
        <div className="flex items-center gap-2 text-sm text-destructive" role="alert">
          <AlertCircle size={16} />
          Failed to load RingCentral connections. Please refresh and try again.
        </div>
      </div>
    )
  }

  const connections = data?.connections ?? []

  return (
    <div>
      {header}
      <div className="space-y-3">
        {connections.length === 0 ? (
          <ConnectForm />
        ) : (
          connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              confirming={confirmingId === conn.id}
              onRequestDisconnect={() => setConfirmingId(conn.id)}
              onCancelDisconnect={() => setConfirmingId(null)}
              onConfirmDisconnect={() => void handleDisconnect(conn.id)}
              isPending={disconnectMutation.isPending}
            />
          ))
        )}
      </div>
    </div>
  )
}
