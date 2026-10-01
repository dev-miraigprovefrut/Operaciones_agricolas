/**
 * "Ver como": permite a un admin de operagricola simular la sesion de otro
 * usuario -- ve exactamente el mismo menu/permisos, y las consultas que
 * filtran datos por usuario (ej. un supervisor solo ve sus propias fichas
 * en /api/cosecha-transp) devuelven lo mismo que ese usuario veria. Sirve
 * para comprobar directamente que ve alguien sin pedirle credenciales ni
 * preguntarle que ve.
 *
 * El JWT real nunca se toca -- solo se sobreescriben las claves de
 * localStorage que usa el resto de la app para mostrar nombre/rol/menu, y
 * se manda un header X-Ver-Como en cada request (ver fetchConVerComo en
 * main.jsx) para que el backend filtre como si fuera el usuario simulado.
 * Los permisos de escritura del backend siguen siendo los del admin real.
 */

const CLAVES_IDENTIDAD = [
  'usuario_nombre', 'usuario_username', 'usuario_rol', 'usuario_correo',
  'usuario_departamento', 'usuario_empresa', 'usuario_foto', 'usuario_jefe',
  'user_permisos_operagricola'
]

export function verComoActivo() {
  return localStorage.getItem('ver_como_username') || null
}

export function verComoNombre() {
  return localStorage.getItem('ver_como_nombre') || ''
}

export function activarVerComo(usuarioSimulado) {
  // usuarioSimulado: {usuario, nombre_completo, rol, sub_permisos, es_admin}
  // (mismo shape que devuelve GET /api/admin/usuarios)
  if (!verComoActivo()) {
    // Solo hacer backup la primera vez -- si ya estaba simulando a alguien
    // y cambia de usuario simulado, el backup debe seguir siendo el admin
    // real, no el usuario simulado anterior.
    CLAVES_IDENTIDAD.forEach(k => {
      localStorage.setItem(`ver_como_real_${k}`, localStorage.getItem(k) || '')
    })
  }
  localStorage.setItem('usuario_nombre', usuarioSimulado.nombre_completo || '')
  localStorage.setItem('usuario_username', usuarioSimulado.usuario || '')
  localStorage.setItem('usuario_rol', usuarioSimulado.rol || '')
  localStorage.setItem('user_permisos_operagricola', JSON.stringify({
    es_admin: usuarioSimulado.es_admin,
    pestanas: usuarioSimulado.sub_permisos || []
  }))
  localStorage.setItem('ver_como_username', usuarioSimulado.usuario || '')
  // La pastilla del header solo muestra el usuario (ej. "luis.toctaguano"),
  // no el nombre completo -- mas corto y es lo que identifica a la cuenta.
  localStorage.setItem('ver_como_nombre', usuarioSimulado.usuario || '')
  window.location.reload()
}

export function salirVerComo() {
  CLAVES_IDENTIDAD.forEach(k => {
    const original = localStorage.getItem(`ver_como_real_${k}`)
    if (original !== null) localStorage.setItem(k, original)
    localStorage.removeItem(`ver_como_real_${k}`)
  })
  localStorage.removeItem('ver_como_username')
  localStorage.removeItem('ver_como_nombre')
  window.location.reload()
}
