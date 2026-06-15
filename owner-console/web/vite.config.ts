import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: UI auf :4173, API-Aufrufe an /api/console werden an die Konsolen-API
// (owner-console/server.js, default :4000) weitergereicht.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      '/api/console': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
