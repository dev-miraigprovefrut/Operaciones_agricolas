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
//
// Señal sin datos (rayitas pero nada pasa, WiFi sin internet): el fetch no
// falla, se queda colgado minutos y la app quedaba en blanco. Por eso la red
// tiene ESPERA_RED ms; pasado eso se usa la copia guardada (si la hay) y la
// respuesta de la red, si llega despues, solo actualiza la copia.
const ESPERA_RED = 3500

function redOCache(request, copia) {
  const red = fetch(request).then(response => {
    if (response.ok) {
      const clone = response.clone()
      caches.open(CACHE_NAME).then(cache => cache.put(request, clone))
    }
    return response
  })
  const plazo = new Promise(resolve => setTimeout(resolve, ESPERA_RED)).then(copia)
  return Promise.race([red, plazo.then(c => c || red)])
    .then(r => r || red)
    .catch(() => copia().then(c => c || red))
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Solo GET del mismo sitio; nada de API (datos dinámicos)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api')) {
    return
  }

  // Navegación SPA: red con plazo, si no index.html guardado
  if (event.request.mode === 'navigate') {
    event.respondWith(redOCache(event.request, () => caches.match('/index.html', { ignoreVary: true })))
    return
  }

  // JS/CSS con hash en el nombre (/assets/): nunca cambian -> primero la copia
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request, { ignoreVary: true }).then(c => c || redOCache(event.request, () => Promise.resolve(undefined)))
    )
    return
  }

  // Demas archivos: red con plazo, si no la copia
  event.respondWith(redOCache(event.request, () => caches.match(event.request, { ignoreVary: true })))
})
