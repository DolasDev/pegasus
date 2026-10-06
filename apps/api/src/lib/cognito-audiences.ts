// ---------------------------------------------------------------------------
// Which Cognito app clients may present a tenant ID token
//
// The tenant web app, the mobile driver app and the MoveManager desktop (cloud
// identity I4) each sign in through their own app client, so an ID token's `aud`
// is one of their ids. The admin client is deliberately absent — admin tokens
// must never pass as tenant credentials.
//
// Accepting several audiences does not widen authorization: the tenant still comes
// from the token's custom:tenantId claim and the principal from TenantUser.
// filter(Boolean) so an unset id can never collapse to an empty-string audience.
// Read per call so tests can stub the environment.
// ---------------------------------------------------------------------------

export function tenantIdTokenAudiences(): string[] {
  return [
    process.env['COGNITO_TENANT_CLIENT_ID'] ?? '',
    process.env['COGNITO_MOBILE_CLIENT_ID'] ?? '',
    process.env['COGNITO_DESKTOP_CLIENT_ID'] ?? '',
  ].filter(Boolean)
}
