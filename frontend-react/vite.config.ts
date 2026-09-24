import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Oeffentliche Adresse der produktiven Instanz (Scalingo) — kein Geheimnis.
const LIVE_API = 'https://planandsimple.osc-fr1.scalingo.io'

export default defineConfig(({ mode }) => {
  // Ziel des /api-Proxys. Ohne Angabe das lokale Backend — so laufen
  // `npm run dev` und die Playwright-Tests wie bisher.
  // `npm run dev:live` (Mode "live") zeigt auf die Live-API: das Frontend
  // laeuft lokal, die Daten kommen vom produktiven Server. Wer dort
  // speichert, schreibt in die echten Daten.
  // API_PROXY_TARGET (Umgebung oder .env.local) ueberschreibt beides.
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_PROXY_TARGET || (mode === 'live' ? LIVE_API : 'http://localhost:3000')
  const remote = target.startsWith('https://')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: true,
          // Der Browser schickt Origin: http://localhost:5173 mit. Die CORS-
          // Allowlist der Live-API kennt ihn nicht; sie weist zwar nicht ab,
          // aber ohne den Header ist die Anfrage eindeutig Server-zu-Server.
          configure: remote
            ? proxy => { proxy.on('proxyReq', req => { req.removeHeader('origin') }) }
            : undefined,
        },
      },
    },
  }
})
