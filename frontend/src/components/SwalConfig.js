import Swal from 'sweetalert2'

// Configuración base oscura para todos los Swal
const SwalDark = Swal.mixin({
  background: '#1e1e2e',
  color: '#ffffff',
  confirmButtonColor: '#7b1fa2',
  cancelButtonColor: '#555',
  customClass: {
    popup: 'swal-dark-popup',
    title: 'swal-dark-title',
    htmlContainer: 'swal-dark-content',
    confirmButton: 'swal-dark-confirm',
    cancelButton: 'swal-dark-cancel'
  }
})

// Alerta de confirmación (Sí/No)
export const confirmar = ({ titulo, html, icono = 'question' }) => {
  return SwalDark.fire({
    icon: icono,
    title: titulo,
    html: html,
    showCancelButton: true,
    confirmButtonText: 'Confirmar',
    cancelButtonText: 'Cancelar'
  })
}

// Alerta de éxito
export const exito = (mensaje) => {
  return SwalDark.fire({
    icon: 'success',
    title: mensaje,
    timer: 1500,
    showConfirmButton: false
  })
}

// Alerta de advertencia
export const advertencia = ({ titulo, texto }) => {
  return SwalDark.fire({
    icon: 'warning',
    title: titulo,
    text: texto,
    confirmButtonText: 'Entendido'
  })
}

// Alerta de error
export const error = (mensaje) => {
  return SwalDark.fire({
    icon: 'error',
    title: 'Error',
    text: mensaje
  })
}

export default SwalDark
