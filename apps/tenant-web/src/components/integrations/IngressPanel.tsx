import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertCircle, Check, Copy, Loader2, Plug, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError } from '@/api/client'
import {
  ingressQueryOptions,
  useProvisionIngress,
  useRotateIngress,
  useDecommissionIngress,
  useTestIngress,
} from '@/api/queries/ingress'
import type { IngressCredentialWithToken, IngressTestResult } from '@/api/ingress'

// ---------------------------------------------------------------------------
// Ingress management — the "Ingress" tab on /integrations/$integrationId.
//
// Provision / rotate / decommission the per-integration partner bearer, and
// dry-run the published inbound behavior against a sample body. Rendered only
// when the config is inbound-capable AND the caller has `ingress:manage`.
//
// Mirrors the API-Client management patterns in settings.developer.tsx:
//   - reveal-once token modal (KeyDisplayModal)
//   - inline confirm cards for destructive/rotate actions (PanelState union)
//   - clipboard copy idiom (navigator.clipboard + copied toggle)
// ---------------------------------------------------------------------------

const TEXTAREA_CLASS =
  'w-full min-h-[12rem] rounded-md border bg-muted/30 p-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

/** Small inline error alert, matching the app's inline-alert convention. */
function InlineError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      <AlertCircle size={14} className="shrink-0" />
      {message}
    </div>
  )
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/** A copy-to-clipboard icon button (Copy → green Check for 2s). */
function CopyButton({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be unavailable — ignore.
    }
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={() => void copy()}
      title={title}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  )
}

/** Reveal-once modal shown after provision/rotate — the token is never retrievable again. */
function TokenModal({
  result,
  onClose,
}: {
  result: IngressCredentialWithToken
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(result.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Ignore.
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md">
        <Card className="border-primary shadow-lg">
          <CardHeader className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5 text-primary" />
              Ingress token generated
            </CardTitle>
            <CardDescription>
              This is the only time the token will be shown. Copy it into the partner&rsquo;s
              configuration now — you cannot retrieve it again.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input value={result.token} readOnly className="bg-muted/50 font-mono" />
              <Button
                variant="secondary"
                size="icon"
                onClick={() => void copy()}
                title="Copy token"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700">
              <strong>Warning:</strong> if you lose this token, rotate the credential to generate a
              new one.
            </div>
            <Button className="w-full" onClick={onClose}>
              I have copied the token
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** Result of a dry-run test, green when valid / red when the body was rejected. */
function TestResultView({ result }: { result: IngressTestResult }) {
  return (
    <div
      className={`space-y-2 rounded-md border px-3 py-2 text-xs ${
        result.valid
          ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400'
          : 'border-destructive/40 bg-destructive/10 text-destructive'
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        {result.valid ? <Check size={14} /> : <AlertCircle size={14} />}
        {result.valid ? 'Body accepted' : 'Body rejected'}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono">
        <span className="opacity-70">eventType</span>
        <span className="break-all">{result.eventType}</span>
        <span className="opacity-70">dedupId</span>
        <span className="break-all">{result.dedupId ?? '—'}</span>
      </div>
      {result.issues.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {result.issues.map((i, idx) => (
            <li key={idx}>
              <span className="font-mono">{i.code}</span>: {i.message}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="mb-1 opacity-70">Ack the partner would receive:</div>
        <pre className="overflow-auto rounded border bg-background/60 p-2">
          {JSON.stringify(result.ack, null, 2)}
        </pre>
      </div>
    </div>
  )
}

const SAMPLE_PLACEHOLDER = JSON.stringify({ Events: [{ Id: 'sample-1' }] }, null, 2)

/** The dry-run tester — always available, independent of credential state. */
function DryRunTester({ integrationId }: { integrationId: string }) {
  const [sample, setSample] = useState(SAMPLE_PLACEHOLDER)
  const [parseError, setParseError] = useState<string | null>(null)
  const test = useTestIngress(integrationId)

  function run() {
    setParseError(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(sample)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    test.mutate(parsed)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dry-run test</CardTitle>
        <CardDescription>
          Send a sample payload through the published inbound validation, dedup, and ack logic. This
          persists nothing and emits no event — it confirms your config behaves as expected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className={TEXTAREA_CLASS}
          value={sample}
          spellCheck={false}
          aria-label="Sample payload (JSON)"
          onChange={(e) => setSample(e.target.value)}
        />
        {parseError && <InlineError message={`Invalid JSON: ${parseError}`} />}
        {test.isError && <InlineError message={apiErrorMessage(test.error, 'Test failed')} />}
        <div className="flex justify-end">
          <Button onClick={run} disabled={test.isPending} className="gap-2">
            {test.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Run test
          </Button>
        </div>
        {test.data && <TestResultView result={test.data} />}
      </CardContent>
    </Card>
  )
}

type PanelState = { kind: 'idle' } | { kind: 'rotate' } | { kind: 'decommission' }

export function IngressPanel({ integrationId }: { integrationId: string }) {
  const { data, isLoading, error } = useQuery(ingressQueryOptions(integrationId))
  const provision = useProvisionIngress()
  const rotate = useRotateIngress()
  const decommission = useDecommissionIngress()

  const [panel, setPanel] = useState<PanelState>({ kind: 'idle' })
  const [tokenModal, setTokenModal] = useState<IngressCredentialWithToken | null>(null)

  // A 404 means "not provisioned yet" (an expected state), not an error.
  const notProvisioned = error instanceof ApiError && error.status === 404
  const loadError = error && !notProvisioned ? error : null
  const busy = provision.isPending || rotate.isPending || decommission.isPending

  // The endpoint URL comes off the credential when present; before provisioning
  // we don't know the tenant's base URL, so it's shown once a credential exists.
  const url = data?.url ?? null

  const provisionError = useMemo(
    () =>
      provision.isError ? apiErrorMessage(provision.error, 'Failed to provision credential') : null,
    [provision.isError, provision.error],
  )
  const rotateError = rotate.isError
    ? apiErrorMessage(rotate.error, 'Failed to rotate credential')
    : null
  const decommissionError = decommission.isError
    ? apiErrorMessage(decommission.error, 'Failed to decommission credential')
    : null

  function doProvision() {
    provision.mutate(integrationId, {
      onSuccess: (res) => setTokenModal(res),
    })
  }
  function doRotate() {
    rotate.mutate(integrationId, {
      onSuccess: (res) => {
        setTokenModal(res)
        setPanel({ kind: 'idle' })
      },
    })
  }
  function doDecommission() {
    decommission.mutate(integrationId, {
      onSuccess: () => setPanel({ kind: 'idle' }),
    })
  }

  return (
    <div className="space-y-4">
      {tokenModal && <TokenModal result={tokenModal} onClose={() => setTokenModal(null)} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partner ingress credential</CardTitle>
          <CardDescription>
            A partner presents this bearer token when POSTing events to your ingress endpoint. The
            token is shown once at provision/rotate and cannot be retrieved afterward.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          )}

          {loadError && (
            <InlineError message={apiErrorMessage(loadError, 'Failed to load credential')} />
          )}

          {url && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Endpoint URL</span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded border bg-muted/40 px-2 py-1 font-mono text-xs">
                  {url}
                </code>
                <CopyButton value={url} title="Copy endpoint URL" />
              </div>
            </div>
          )}

          {/* Not provisioned → call to action. */}
          {!isLoading && notProvisioned && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                No credential yet. Provision one to give the partner a bearer token for this
                integration.
              </p>
              {provisionError && <InlineError message={provisionError} />}
              <Button onClick={doProvision} disabled={busy} className="gap-2">
                {provision.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plug size={14} />
                )}
                Provision credential
              </Button>
            </div>
          )}

          {/* Provisioned → metadata + rotate/decommission. */}
          {data && (
            <div className="space-y-4">
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Status</span>
                <span>
                  <Badge variant={data.enabled ? 'success' : 'destructive'}>
                    {data.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                </span>
                <span className="text-muted-foreground">Token prefix</span>
                <code className="font-mono">{data.tokenPrefix}…</code>
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(data.createdAt).toLocaleString()}</span>
                <span className="text-muted-foreground">Last rotated</span>
                <span>{data.rotatedAt ? new Date(data.rotatedAt).toLocaleString() : '—'}</span>
              </div>

              {panel.kind === 'idle' && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setPanel({ kind: 'rotate' })}
                  >
                    Rotate token
                  </Button>
                  <Button
                    variant="outline"
                    className="border-destructive/50 text-destructive hover:bg-destructive/10"
                    disabled={busy}
                    onClick={() => setPanel({ kind: 'decommission' })}
                  >
                    Decommission
                  </Button>
                </div>
              )}

              {panel.kind === 'rotate' && (
                <Card className="border-amber-500/50">
                  <CardHeader>
                    <CardTitle className="text-amber-600">Rotate token?</CardTitle>
                    <CardDescription>
                      A new token is minted and the current one stops working immediately. You will
                      be shown the new token once. Update the partner before rotating.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {rotateError && <InlineError message={rotateError} />}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setPanel({ kind: 'idle' })}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        className="gap-2 bg-amber-600 hover:bg-amber-700"
                        onClick={doRotate}
                        disabled={busy}
                      >
                        {rotate.isPending && <Loader2 size={14} className="animate-spin" />}
                        Rotate token
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {panel.kind === 'decommission' && (
                <Card className="border-destructive/50">
                  <CardHeader>
                    <CardTitle className="text-destructive">Decommission credential?</CardTitle>
                    <CardDescription>
                      The credential is permanently deleted and the partner&rsquo;s token stops
                      working immediately. This cannot be undone — you can provision a fresh
                      credential afterward.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {decommissionError && <InlineError message={decommissionError} />}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => setPanel({ kind: 'idle' })}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        className="gap-2"
                        onClick={doDecommission}
                        disabled={busy}
                      >
                        {decommission.isPending && <Loader2 size={14} className="animate-spin" />}
                        Decommission
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <DryRunTester integrationId={integrationId} />
    </div>
  )
}
