/**
 * Cola de sincronización offline
 * Guarda requests pendientes en IndexedDB y los envía cuando hay conexión
 */

const DB_NAME = 'opagricola_offline'
const DB_VERSION = 1
const STORE_QUEUE = 'sync_queue'
const STORE_CACHE = 'data_cache'

// ---- IndexedDB helpers ----

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function dbTransaction(storeName, mode, callback) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      const result = callback(store)
      tx.oncomplete = () => resolve(result.result !== undefined ? result.result : undefined)
      tx.onerror = () => reject(tx.error)
    })
  })
}

// ---- Cola de sincronización ----

/**
 * Agregar un request a la cola offline
 * @param {string} url - URL del endpoint
 * @param {string} method - GET, POST, PUT, DELETE
 * @param {object} body - Datos del request
 * @param {string} tipo - Tipo de operación ('registro', 'cosecha', 'check')
 * @param {string} descripcion - Descripción legible para el usuario
 */
export async function addToQueue(url, method, body, tipo, descripcion) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const item = {
      url,
      method,
      body,
      tipo,
      descripcion,
      status: 'pending',
      createdAt: new Date().toISOString(),
      retries: 0,
      usuario: localStorage.getItem('usuario_nombre') || 'desconocido'
    }
    const req = store.add(item)
    req.onsuccess = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Obtener todos los items pendientes de la cola
 */
export async function getPendingItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('status')
    const req = index.getAll('pending')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Obtener conteo de items pendientes
 */
export async function getPendingCount() {
  const items = await getPendingItems()
  return items.length
}

/**
 * Marcar un item como sincronizado: se borra de inmediato, no hace falta conservarlo
 */
async function markSynced(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    store.delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Marcar un item como fallido
 */
async function markFailed(id, error) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const req = store.get(id)
    req.onsuccess = () => {
      const item = req.result
      if (item) {
        item.retries += 1
        item.lastError = error
        if (item.retries >= 5) {
          item.status = 'failed'
        }
        store.put(item)
      }
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Limpiar items fallidos definitivos (mas de 7 dias). Los sincronizados ya se borran
 * al instante en markSynced, no necesitan limpieza. Los fallidos se conservan
 * unos dias para poder diagnosticar, pero no deben acumularse para siempre.
 */
export async function cleanSyncedItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('status')
    const req = index.getAll('failed')
    req.onsuccess = () => {
      const items = req.result
      const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      items.forEach(item => {
        if (item.createdAt && item.createdAt < hace7dias) {
          store.delete(item.id)
        }
      })
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Obtener conteo de items fallidos definitivamente (para mostrar al usuario)
 */
export async function getFailedCount() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('status')
    const req = index.getAll('failed')
    req.onsuccess = () => resolve(req.result.length)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Obtener el detalle de los items fallidos (descripcion, error) para mostrarlos
 */
export async function getFailedItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readonly')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('status')
    const req = index.getAll('failed')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Reintentar items fallidos: los vuelve a poner en 'pending' con retries en 0
 * para que processQueue() los tome de nuevo. Se usa cuando el usuario pide
 * reintentar manualmente (ej. ya recupero señal).
 */
export async function retryFailedItems() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, 'readwrite')
    const store = tx.objectStore(STORE_QUEUE)
    const index = store.index('status')
    const req = index.getAll('failed')
    req.onsuccess = () => {
      req.result.forEach(item => {
        item.status = 'pending'
        item.retries = 0
        store.put(item)
      })
      resolve(req.result.length)
    }
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Procesar la cola - enviar todos los pendientes al servidor
 * @returns {{ synced: number, failed: number }}
 */
export async function processQueue() {
  const pending = await getPendingItems()
  if (pending.length === 0) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  for (const item of pending) {
    try {
      // La sesion va en la cookie (services/sesion.js agrega credentials y
      // la renueva con el HUB si vencio), asi el reintento usa la vigente.
      const options = {
        method: item.method,
        headers: { 'Content-Type': 'application/json' }
      }
      if (item.body && item.method !== 'GET') {
        options.body = JSON.stringify(item.body)
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      options.signal = controller.signal

      const res = await fetch(item.url, options)
      clearTimeout(timeout)

      if (res.ok) {
        await markSynced(item.id)
        synced++
      } else {
        const msg = res.status === 401
          ? 'Sesión expirada: vuelve a iniciar sesión para reintentar'
          : `HTTP ${res.status}`
        await markFailed(item.id, msg)
        failed++
      }
    } catch (err) {
      await markFailed(item.id, err.message)
      failed++
      // Si falla por red, no seguir intentando los demás
      if (err.name === 'AbortError' || !navigator.onLine) break
    }
  }

  // Limpiar items viejos ya sincronizados
  await cleanSyncedItems()

  return { synced, failed }
}

// ---- Cache de datos (catálogos) ----

/**
 * Guardar datos en cache local para uso offline
 */
export async function cacheData(key, data) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CACHE, 'readwrite')
    const store = tx.objectStore(STORE_CACHE)
    store.put({ key, data, updatedAt: new Date().toISOString() })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Obtener datos del cache local
 */
export async function getCachedData(key) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CACHE, 'readonly')
    const store = tx.objectStore(STORE_CACHE)
    const req = store.get(key)
    req.onsuccess = () => resolve(req.result ? req.result.data : null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Fetch con soporte offline: intenta fetch, si falla usa cache
 * Si tiene éxito, actualiza el cache
 */
export async function fetchWithOffline(url, cacheKey) {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (res.ok) {
      const data = await res.json()
      await cacheData(cacheKey, data)
      return { data, fromCache: false }
    }
    throw new Error(`HTTP ${res.status}`)
  } catch {
    // Intentar desde cache
    const cached = await getCachedData(cacheKey)
    if (cached) {
      return { data: cached, fromCache: true }
    }
    return { data: [], fromCache: true }
  }
}
