import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { loadConfig } from './config'
import './globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('Root element #root not found in document')
}

const root = ReactDOM.createRoot(rootElement)

root.render(
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
    Loading…
  </div>,
)

loadConfig()
  .then(() => {
    root.render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </React.StrictMode>,
    )
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    root.render(
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'monospace',
          color: '#c00',
        }}
      >
        <h1>Configuration error</h1>
        <p>{message}</p>
      </div>,
    )
  })
