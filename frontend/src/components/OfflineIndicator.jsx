import { useState, useEffect, useCallback } from 'react'
import useOnlineStatus from '../services/useOnlineStatus'
import { getPendingCount, processQueue, getFailedCount, getFailedItems, retryFailedItems } from '../services/syncQueue'

function OfflineIndicator() {
  const { isOnline, checkServer } = useOnlineStatus()
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [failedItems, setFailedItems] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)
  const [verFallidos, setVerFallidos] = useState(false)

  const refreshCount = useCallback(async () => {
    const count = await getPendingCount()
    setPendingCount(count)
    const fCount = await getFailedCount()
    setFailedCount(fCount)
  }, [])

  const reintentarFallidos = useCallback(async () => {
    await retryFailedItems()
    setVerFallidos(false)
    await refreshCount()
  }, [refreshCount])

  const abrirDetalleFallidos = useCallback(async () => {
    const items = await getFailedItems()
    setFailedItems(items)
    setVerFallidos(true)
  }, [])

  // Sincronizar automáticamente cuando vuelve la conexión
  const syncNow = useCallback(async () => {
    if (syncing || pendingCount === 0) return
    setSyncing(true)
    try {
      const result = await processQueue()
      if (result.synced > 0) {
        setLastSync(new Date())
      }
      await refreshCount()
    } finally {
      setSyncing(false)
    }
  }, [syncing, pendingCount, refreshCount])

  useEffect(() => {
    refreshCount()
    const interval = setInterval(refreshCount, 5000)
    return () => clearInterval(interval)
  }, [refreshCount])

  // Auto-sync cuando vuelve la conexión
  useEffect(() => {
    if (isOnline && pendingCount > 0 && !syncing) {
      syncNow()
    }
  }, [isOnline, pendingCount, syncing, syncNow])

  // Reintentar los "fallidos" (5 intentos ya agotados) cada 3 minutos, en vez
  // de dejarlos abandonados para siempre hasta que alguien toque "Reintentar"
  // a mano -- en la práctica casi nadie lo hace y se quedan sin sincronizar
  // por meses (ej. señal débil en campo, no un dato realmente invalido).
  useEffect(() => {
    if (!isOnline || failedCount === 0) return
    const interval = setInterval(async () => {
      await retryFailedItems()
      await refreshCount()
    }, 3 * 60 * 1000)
    return () => clearInterval(interval)
  }, [isOnline, failedCount, refreshCount])

  // No mostrar nada si todo está bien
  if (isOnline && pendingCount === 0 && failedCount === 0) return null

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        alignItems: 'flex-end'
      }}>
        {/* Pendientes de sincronizar */}
        {pendingCount > 0 && (
          <div style={{
            background: isOnline ? '#ff9800' : '#616161',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            cursor: isOnline && !syncing ? 'pointer' : 'default'
          }} onClick={isOnline && !syncing ? syncNow : undefined}>
            {syncing ? (
              <>
                <i className='bx bx-loader-alt bx-spin'></i>
                Sincronizando...
              </>
            ) : (
              <>
                <i className='bx bx-cloud-upload'></i>
                {pendingCount} registro{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}
                {isOnline && <span style={{marginLeft: '0.25rem', textDecoration: 'underline'}}>— Sincronizar</span>}
              </>
            )}
          </div>
        )}

        {/* Registros que no se pudieron guardar (perdidos si no se reintentan) */}
        {failedCount > 0 && (
          <div style={{
            background: '#c0392b',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            fontSize: '0.8rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            cursor: 'pointer'
          }} onClick={abrirDetalleFallidos}>
            <i className='bx bx-error-circle'></i>
            {failedCount} registro{failedCount !== 1 ? 's' : ''} no se {failedCount !== 1 ? 'pudieron' : 'pudo'} guardar
            <span style={{marginLeft: '0.25rem', textDecoration: 'underline'}}>— Ver</span>
          </div>
        )}

        {/* Último sync exitoso */}
        {lastSync && pendingCount === 0 && isOnline && (
          <div style={{
            background: '#4caf50',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            fontSize: '0.75rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            animation: 'fadeOut 3s forwards 2s'
          }}>
            <i className='bx bx-check-circle'></i>
            Datos sincronizados
          </div>
        )}
      </div>

      {/* Modal: detalle de registros no guardados */}
      {verFallidos && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'}}>
          <div style={{background: 'white', borderRadius: '12px', maxWidth: '480px', width: '100%', maxHeight: '80vh', overflow: 'auto', padding: '1.2rem'}}>
            <h3 style={{margin: '0 0 0.5rem 0', color: '#c0392b', display: 'flex', alignItems: 'center', gap: '0.4rem'}}>
              <i className='bx bx-error-circle'></i> Registros no guardados
            </h3>
            <p style={{fontSize: '0.8rem', color: '#666', marginBottom: '1rem'}}>
              Estos datos se ingresaron sin conexión estable y no se pudieron enviar al servidor
              después de varios intentos. Si vuelves a tener buena señal, presiona "Reintentar".
              Si el problema persiste, vuelve a ingresar estos datos manualmente.
            </p>
            <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem'}}>
              {failedItems.map(item => (
                <div key={item.id} style={{background: '#fdf0ee', border: '1px solid #f5c6c0', borderRadius: '8px', padding: '0.6rem 0.8rem', fontSize: '0.8rem'}}>
                  <strong>{item.descripcion}</strong>
                  <div style={{color: '#999', fontSize: '0.72rem', marginTop: '0.2rem'}}>
                    {item.usuario} — {new Date(item.createdAt).toLocaleString('es-EC')}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display: 'flex', gap: '0.5rem', justifyContent: 'flex-end'}}>
              <button onClick={() => setVerFallidos(false)} style={{background: '#eee', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem'}}>
                Cerrar
              </button>
              <button onClick={reintentarFallidos} style={{background: '#7b1fa2', color: 'white', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontSize: '0.85rem'}}>
                <i className='bx bx-refresh'></i> Reintentar
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulseOffline {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        @keyframes fadeOut {
          0% { opacity: 1; }
          100% { opacity: 0; pointer-events: none; }
        }
      `}</style>
    </>
  )
}

export default OfflineIndicator
