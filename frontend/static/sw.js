const CACHE_NAME = 'opagricola-v5'

// Archivos esenciales para que la app funcione offline
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/LogoNintanga.png',
  '/manual-corporativo.css',
  '/MiraiCorporativo/mirai-base.css',
  '/MiraiCorporativo/mirai-componentes.css',
  '/MiraiCorporativo/mirai-layout.css',
  '/MiraiCorporativo/mirai-responsive.css',
  '/boxicons/css/boxicons.min.css'
]

// Instalar: cachear archivos esenciales (cada uno por separado, para que
// si uno falla por mala conexion no se pierda el cacheo de los demas)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn('No se pudo precachear', url, err)))
      ))
      .then(() => self.skipWaiting())
  )
})

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// Fetch: network-first para todo, fallback a cache para offline.
// ignoreVary: los archivos guardados al instalar se pidieron sin cabecera Origin
// y el servidor responde con 'Vary: Origin'; sin esto, sin internet no se
// encontraban y la app quedaba en blanco.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // No cachear requests de API (datos dinámicos)
  if (url.pathname.startsWith('/api')) {
    return
  }

  // Navegación SPA: network-first, fallback a index.html cacheado
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      }).catch(() => caches.match('/index.html', { ignoreVary: true }))
    )
    return
  }

  // Assets: network-first, fallback a cache (offline)
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.ok && event.request.method === 'GET') {
        const clone = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
      }
      return response
    }).catch(() => caches.match(event.request, { ignoreVary: true }))
  )
})
