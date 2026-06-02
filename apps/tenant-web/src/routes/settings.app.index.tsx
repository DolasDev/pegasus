// /settings/app — bare landing route. We forward straight to the first
// section so the rail always has a selection. Implemented as a component
// (rather than a `beforeLoad` redirect) so this file matches the shape of the
// other settings.app.*.tsx route components and is easy to swap for a real
// summary page later.
import { Navigate } from '@tanstack/react-router'

export function AppSettingsIndexPage() {
  return <Navigate to="/settings/app/dashboard" replace />
}
