import { Suspense } from 'react'
import { Provider } from 'react-redux'
import { Outlet } from '@tanstack/react-router'
import store from './redux/store'
import { AppGuard } from './containers/AppGuard'
import { SnackbarProvider } from './components/Snackbar/SnackbarProvider'
import { ConfirmProvider } from './components/ConfirmDialog'
// Open Sans — the font the longhaul reference app rendered in (declared as the
// `.driver-planning-root` font-family in styles.css). Bundled via @fontsource
// (offline-safe, no CDN) in the weights the feature uses: 400 + 700.
import '@fontsource/open-sans/400.css'
import '@fontsource/open-sans/700.css'
import './styles.css'

// The Operations sub-sections (Availability / Planning / Trips / Shipments) are
// now exposed as expandable sub-nav under "Operations" in the AppShell sidebar
// (see components/AppShell.tsx -> OPERATIONS_CHILDREN). This layout just hosts
// the route Outlet with its Redux/snackbar/confirm providers + AppGuard.
export function DriverPlanningLayout() {
  return (
    <Provider store={store}>
      <SnackbarProvider>
        <ConfirmProvider>
          <div className="driver-planning-root space-y-4">
            <AppGuard>
              <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
                <Outlet />
              </Suspense>
            </AppGuard>
          </div>
        </ConfirmProvider>
      </SnackbarProvider>
    </Provider>
  )
}
