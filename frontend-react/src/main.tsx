import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
// Nach globals.css: die Design-Variante ueberschreibt Tokens ohne !important.
// Auf main leer — siehe Kopf von skin.css.
import '@/styles/skin.css'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker registrieren (Voraussetzung für Web-Push). Nur wenn der
// Browser ihn unterstützt; Fehler dürfen den App-Start nie blockieren.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch(err => console.warn('[SW] Registrierung fehlgeschlagen:', err))
  })
}
