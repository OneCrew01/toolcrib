import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Offline test provision for the Zookeeper protocol client: recorded-frame
// self-checks run on every dev boot (never in production builds — the dynamic
// import below is dropped by the DEV guard).
if (import.meta.env.DEV) {
  void import('./lib/zookeeper.selfcheck.ts').then(({ runSelfChecks }) => {
    const failures = runSelfChecks()
    if (failures.length > 0) {
      console.warn(
        `zookeeper self-checks: ${failures.length} FAILED`,
        failures,
      )
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
