import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Everything server-shaped is proxied to the ToolCRIB backend: src/lib/api.ts
// fetches relative paths only and never holds a token.
//
// One deliberate exception, and it is not routed through this proxy:
// src/lib/zookeeper.ts opens a browser WebSocket straight to Zoo
// (COPILOT_URL = wss://api.zoo.dev/ws/ml/copilot) with an operator-pasted token
// held in tab memory. Operator mode only. If you are auditing where credentials
// can leave the browser, that file is the one to read — not this one.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
})
