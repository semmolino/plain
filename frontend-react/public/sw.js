/* plan&simple Service Worker — Web-Push-Zustellung.
 *
 * Bewusst minimal: KEIN Offline-/Asset-Caching (die App lädt weiter live vom
 * Server), nur die zwei Handler, die Web-Push zwingend braucht:
 *   - 'push'             -> System-Benachrichtigung anzeigen
 *   - 'notificationclick'-> App öffnen/fokussieren und zum LINK navigieren
 */

self.addEventListener('install', () => {
  // Sofort aktiv werden, nicht erst nach Reload aller Tabs.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'plan&simple', body: event.data ? event.data.text() : '' }
  }

  const title = data.title || 'plan&simple'
  const options = {
    body: data.body || '',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    // Nachrichten mit gleichem tag ersetzen sich statt sich zu stapeln.
    tag: data.tag || undefined,
    data: { link: data.link || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Bereits offenes Fenster fokussieren und dorthin navigieren.
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) {
              try { client.navigate(link) } catch { /* cross-origin o.ä. */ }
            }
            return client.focus()
          }
        }
        // Sonst neues Fenster öffnen.
        if (self.clients.openWindow) return self.clients.openWindow(link)
      }),
  )
})
