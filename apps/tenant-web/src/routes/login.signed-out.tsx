import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { consumePendingIdpSignOut, buildIdpSignOutUrl } from '@/auth/idp-signout'

// ---------------------------------------------------------------------------
// LoginSignedOutPage — the middle of the sign-out chain, not a destination.
//
// Cognito lands here after clearing its own session (this path is registered as
// a sign-out URL on the tenant app client). Its only job is the second leg:
// forward to the IdP's end-session endpoint so the IdP forgets the account the
// user did NOT want, then let the IdP return them to /login.
//
// See auth/idp-signout.ts for why the chain runs Cognito-first and what happens
// when the IdP will not honour our return URL.
//
// Reached directly with nothing pending — a bookmark, a refresh, or a provider
// with no end-session endpoint — it just continues to /login. There is nothing
// for the user to do here, so it never becomes a dead end.
// ---------------------------------------------------------------------------

export function LoginSignedOutPage() {
  useEffect(() => {
    const endSessionEndpoint = consumePendingIdpSignOut()

    window.location.replace(endSessionEndpoint ? buildIdpSignOutUrl(endSessionEndpoint) : '/login')
  }, [])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 text-center">
        <span className="text-2xl font-bold tracking-tight">Pegasus</span>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 size={18} className="animate-spin" />
            Signing you out
          </CardTitle>
          <CardDescription>Finishing sign-out with your identity provider&hellip;</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-6">
          <Loader2 size={32} className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    </div>
  )
}
