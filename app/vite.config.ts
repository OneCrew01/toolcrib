import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Everything server-shaped is proxied to the ToolCRIB backend. The app only
// ever fetches relative paths — it never holds a token and never talks to Zoo.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/health': 'http://localhost:8787',
    },
  },
})
