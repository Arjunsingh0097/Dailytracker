import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CrashFallback, ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

import('./App.tsx')
  .then(({ default: App }) => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    )
  })
  .catch((error: unknown) => {
    root.render(
      <StrictMode>
        <CrashFallback error={error instanceof Error ? error : new Error(String(error))} />
      </StrictMode>,
    )
  })
