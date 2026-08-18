const CACHE_NAME = 'is-map-v3'
const STATIC_ASSETS = ['/', '/index.html', '/favicon.svg', '/favicon.png', '/favicon.ico', '/logo.svg', '/logo.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  // Network-first for API and external service calls
  if (
    request.url.includes('supabase') ||
    request.url.includes('speed.cloudflare') ||
    request.url.includes('nominatim') ||
    request.url.includes('ipwho')
  ) {
    event.respondWith(fetch(request).catch(() => caches.match(request)))
    return
  }

  // Network-first during development / cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        return response
      })
      .catch(() => caches.match(request)),
  )
})
