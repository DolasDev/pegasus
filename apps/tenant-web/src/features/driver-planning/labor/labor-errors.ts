import { ApiError } from '@/api/client'

// The API's messages are already written for people, so most codes pass
// through. These are the ones worth rewording for the Operations screen, where
// the API's wording is aimed at a driver in the mobile app.
export function laborErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return err instanceof Error ? err.message : 'Something went wrong'
  }
  switch (err.code) {
    case 'OPERATIONS_ONLY':
      return 'Only Operations roles can do that.'
    case 'LINK_RATE_LIMITED':
      return 'Too many new crews were added recently. Wait a while, then try again.'
    case 'CREW_NOT_FOUND':
      return 'This crew is no longer on the company list. Close this panel and refresh the list.'
    case 'PACKER_NOT_FOUND':
      return 'That packer no longer exists. Close this dialog and reopen the crew.'
    default:
      // 409 (SERVICE_AREAS_CONFLICT, PACKER_DUPLICATE) and 400/422 validation:
      // the server's sentence says what to fix.
      return err.message
  }
}
