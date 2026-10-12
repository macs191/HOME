const CACHE = 'homefix-shell-v1'
const ROOT = new URL('/', self.location.origin).href
const SHELL = [ROOT, new URL('/manifest.webmanifest', self.location.origin).href, new URL('/offline.html', self.location.origin).href, new URL('/icons/homefix-192.png', self.location.origin).href, new URL('/icons/homefix-512.png', self.location.origin).href]
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = event.notification.data && event.notification.data.url
  const aliases = { '/customer#orders': '/customer/orders', '/customer#notifications': '/customer/notifications', '/provider#work-queue': '/provider/work-queue', '/provider#ledger': '/provider/ledger', '/admin#quotes': '/admin/quotes', '/admin#payments': '/admin/payments', '/admin#operations': '/admin/operations' }
  const safePath = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? (aliases[raw] || raw) : ROOT
  const target = new URL(safePath, self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin)
    return existing ? existing.navigate(target).then(() => existing.focus()) : self.clients.openWindow(target)
  }))
})
self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put(ROOT, copy))
      return response
    }).catch(async () => (await caches.match(request)) || (await caches.match(ROOT)) || (await caches.match(new URL('/offline.html', self.location.origin).href))))
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, response.clone()))
      return response
    })))
  }
})
