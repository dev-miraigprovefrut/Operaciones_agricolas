"""Modelos ORM del esquema operaciones_agricolas (ver sql/01_schema.sql).

Las columnas siguen la convencion nueva (id_<tabla>, estado ACTIVO/INACTIVO),
pero los ATRIBUTOS Python conservan los nombres que usa la API (id,
id_check, codigo_act...): asi las respuestas JSON no cambian para el frontend.
"""
from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from .config import settings
from .database import Base


class _Empresa:
    tenant_id = Column(BigInteger, nullable=False, default=settings.TENANT_ID)
    numero_empresa = Column(String(10), nullable=False, default=settings.NUMERO_EMPRESA)


class Proyecto(_Empresa, Base):
    __tablename__ = "proyecto"
    id = Column("id_proyecto", BigInteger, primary_key=True)
    nombre = Column(String(200), nullable=False)
    direccion = Column(String(500))
    tipo = Column(String(50))
    estado = Column(String(10), nullable=False, default="ACTIVO")
    fecha_creacion = Column(DateTime, server_default=func.now())
    supervisores = relationship("Supervisor", back_populates="proyecto_rel", lazy="dynamic")


class Supervisor(_Empresa, Base):
    __tablename__ = "supervisor"
    id = Column("id_supervisor", BigInteger, primary_key=True)
    id_persona = Column(BigInteger)
    cedula = Column(String(20), nullable=False)
    nombre = Column(String(300), nullable=False)
    id_proyecto = Column(BigInteger, ForeignKey("proyecto.id_proyecto", ondelete="SET NULL"))
    proyecto = Column(String(200))
    estado = Column(String(10), nullable=False, default="ACTIVO")
    fecha_creacion = Column(DateTime, server_default=func.now())
    proyecto_rel = relationship("Proyecto", back_populates="supervisores")


class Camion(_Empresa, Base):
    __tablename__ = "camion"
    id = Column("id_camion", BigInteger, primary_key=True)
    nombre = Column(String(200), nullable=False)
    cedula = Column(String(20), nullable=False)
    placa = Column(String(20))
    correo = Column(String(150))
    empresa = Column(String(100))
    estado = Column(String(10), nullable=False, default="ACTIVO")
    fecha_creacion = Column(DateTime, server_default=func.now())


class Actividad(_Empresa, Base):
    __tablename__ = "actividad"
    id = Column("id_actividad", BigInteger, primary_key=True)
    codigo_act = Column("codigo", String(50), nullable=False)
    actividad = Column(String(250), nullable=False)
    subactividades = Column(JSONB, nullable=False, default=list)
    equipo = Column(String(50), nullable=False, default="Tractores")
    tipo = Column(String(50))
    cantidad = Column(Integer, nullable=False, default=0)
    estado = Column(String(10), nullable=False, default="ACTIVO")
    fecha_creacion = Column(DateTime, server_default=func.now())
    fecha_actualizacion = Column(DateTime, onupdate=func.now())


class Tractorista(_Empresa, Base):
    __tablename__ = "tractorista"
    id = Column("id_tractorista", BigInteger, primary_key=True)
    id_persona = Column(BigInteger, nullable=False)
    cedula = Column(String(20), nullable=False)
    username = Column(String(100))
    pin_hash = Column(String(255))
    pin_expira = Column(DateTime)
    intentos_fallidos = Column(Integer, nullable=False, default=0)
    bloqueado_hasta = Column(DateTime)
    ultimo_acceso = Column(DateTime)
    estado = Column(String(10), nullable=False, default="ACTIVO")
    fecha_creacion = Column(DateTime, server_default=func.now())


class CheckList(_Empresa, Base):
    __tablename__ = "checklist"
    id = Column("id_checklist", BigInteger, primary_key=True)
    id_tractorista = Column(BigInteger, ForeignKey("tractorista.id_tractorista", ondelete="SET NULL"))
    usuario = Column(String(150))
    fecha = Column(DateTime)
    tractor = Column(String(150))
    apero = Column(String(150))
    insp_motor = Column(Boolean, default=False)
    insp_refrigerante = Column(Boolean, default=False)
    insp_aceite_motor = Column(Boolean, default=False)
    insp_aceite_hidraulico = Column(Boolean, default=False)
    insp_fugas_hidraulico = Column(Boolean, default=False)
    insp_bomba_hidraulica = Column(Boolean, default=False)
    insp_transmisiones = Column(Boolean, default=False)
    insp_indicadores_tablero = Column(Boolean, default=False)
    insp_neumaticos = Column(Boolean, default=False)
    insp_frenos = Column(Boolean, default=False)
    insp_fisuras = Column(Boolean, default=False)
    insp_fallo_electrico = Column(Boolean, default=False)
    limp_radiador = Column(Boolean, default=False)
    limp_motor_filtros = Column(Boolean, default=False)
    limp_cabina = Column(Boolean, default=False)
    limp_frenos = Column(Boolean, default=False)
    lub_articulaciones = Column(Boolean, default=False)
    lub_pines_bocines = Column(Boolean, default=False)
    horometro_inicial = Column(Float)
    horometro_final = Column(Float)
    estado = Column(String(20))


class Registro(_Empresa, Base):
    __tablename__ = "registro"
    id = Column("id_registro", BigInteger, primary_key=True)
    id_actividad = Column(BigInteger, ForeignKey("actividad.id_actividad", ondelete="SET NULL"))
    id_check = Column("id_checklist", BigInteger, ForeignKey("checklist.id_checklist", ondelete="SET NULL"))
    id_tractorista = Column(BigInteger, ForeignKey("tractorista.id_tractorista", ondelete="SET NULL"))
    fecha_creacion = Column(DateTime, nullable=False)
    fecha_fin = Column(DateTime)
    tiempo_inicio = Column(DateTime)
    fecha_historial = Column(JSONB, nullable=False, default=list)
    actividad = Column(String(250), nullable=False)
    subactividad = Column(String(250))
    tractor = Column(String(150))
    apero = Column(String(150))
    lote = Column(String(100))
    hacienda = Column(String(150))
    orden_cultivo = Column(String(100))
    tipo = Column(String(50))
    usuario = Column(String(150))
    ubicacion = Column(String(200))
    tiempo_paro = Column(Float, nullable=False, default=0.0)
    tiempo_real = Column(Float, nullable=False, default=0.0)
    estado = Column(String(20), nullable=False, default="Pendiente")
    equipo = Column(String(20), nullable=False, default="Tractores")   # Tractores | Drones
    cliente_id = Column(String(40), unique=True)   # id que genera el celular (trabajo sin internet)
    # Revision (aprobacion) de horas: REVISADO = bloqueado para cambios
    revision_estado = Column(String(15), nullable=False, default="NO_REVISADO")
    revisado_por = Column(String(150))
    revisado_por_nombre = Column(String(200))
    fecha_revision = Column(DateTime)


class RegistroRevision(_Empresa, Base):
    """Historial de revisiones de un registro: quien, cuando y que cambio."""
    __tablename__ = "registro_revision"
    id = Column("id_registro_revision", BigInteger, primary_key=True)
    id_registro = Column(BigInteger, ForeignKey("registro.id_registro", ondelete="CASCADE"), nullable=False)
    accion = Column(String(20), nullable=False, default="REVISADO")
    usuario = Column(String(150), nullable=False)
    usuario_nombre = Column(String(200))
    cambios = Column(JSONB, nullable=False, default=dict)
    fecha = Column(DateTime, server_default=func.now())


class Parametro(_Empresa, Base):
    """Configuracion editable del modulo (clave -> JSON), p.ej. 'jornada'."""
    __tablename__ = "parametro"
    id = Column("id_parametro", BigInteger, primary_key=True)
    clave = Column(String(60), nullable=False)
    valor = Column(JSONB, nullable=False, default=dict)
    actualizado_por = Column(String(150))
    fecha_actualizacion = Column(DateTime, server_default=func.now())


class TractorFalla(_Empresa, Base):
    __tablename__ = "falla_tractor"
    id = Column("id_falla_tractor", BigInteger, primary_key=True)
    id_check = Column("id_checklist", BigInteger, ForeignKey("checklist.id_checklist", ondelete="SET NULL"))
    id_tractorista = Column(BigInteger, ForeignKey("tractorista.id_tractorista", ondelete="SET NULL"))
    usuario = Column(String(150), nullable=False)
    tractor = Column(String(150), nullable=False)
    detalle = Column(Text)
    ubicacion = Column(String(200))
    estado = Column(String(20), nullable=False, default="pendiente")
    fecha = Column(DateTime, server_default=func.now())
    fecha_creacion = Column(DateTime, server_default=func.now())


class FichaAplicacion(_Empresa, Base):
    """Ficha de aplicacion fitosanitaria (copia de agdocul por orden + semana +
    actividad) y lo que se hizo en campo. Ver sync/fichas.py."""
    __tablename__ = "ficha_aplicacion"
    id = Column("id_ficha_aplicacion", BigInteger, primary_key=True)
    ocult = Column(String(20), nullable=False)
    anio = Column(Integer, nullable=False)
    semana = Column(Integer, nullable=False)
    cod_acamp = Column(Integer, nullable=False)
    actividad = Column(String(150))
    lote = Column(String(100))
    hacienda = Column(String(150))
    proyecto = Column(String(150))
    cultivo = Column(String(150))
    hectareas = Column(Numeric(12, 4))
    edad_sem = Column(Integer)
    estado_erp = Column(String(5))
    aplicada_en_erp = Column(Boolean, nullable=False, default=False)
    estado_aplicacion = Column(String(15), nullable=False, default="PENDIENTE")
    id_registro = Column(BigInteger, ForeignKey("registro.id_registro", ondelete="SET NULL"))
    equipo = Column(String(20))
    tractor = Column(String(150))
    bomba = Column(String(150))
    cod_mapli = Column(Integer)
    temperatura = Column(Numeric(6, 2))
    velocidad_viento = Column(Numeric(6, 2))
    num_bombas = Column(Numeric(8, 2))
    aplicador = Column(String(200))
    usuario_inicio = Column(String(150))
    fecha_aplicacion = Column(Date)
    hora_inicio = Column(Time)
    hora_fin = Column(Time)
    envio_erp = Column(String(10))
    envio_error = Column(Text)
    fecha_envio = Column(DateTime)
    fecha_sincronizacion = Column(DateTime, server_default=func.now())
    productos = relationship("FichaAplicacionProducto", back_populates="ficha", cascade="all, delete-orphan",
                             order_by="FichaAplicacionProducto.cod_docul")


class FichaAplicacionProducto(Base):
    __tablename__ = "ficha_aplicacion_producto"
    id = Column("id_ficha_aplicacion_producto", BigInteger, primary_key=True)
    id_ficha_aplicacion = Column(BigInteger, ForeignKey("ficha_aplicacion.id_ficha_aplicacion", ondelete="CASCADE"),
                                 nullable=False)
    cod_docul = Column(BigInteger, nullable=False, unique=True)
    tipo = Column(String(5))
    cod_prod = Column(String(40))
    nombre_comercial = Column(String(150))
    descripcion = Column(String(250))
    clasificacion = Column(String(100))
    unidad = Column(String(20))
    cantidad = Column(Numeric(14, 4))
    dosis_ha = Column(Numeric(14, 4))
    carencia = Column(String(30))
    estado_erp = Column(String(5))
    cantidad_salida = Column(Numeric(14, 4))
    cantidad_aplicada = Column(Numeric(14, 4))
    ficha = relationship("FichaAplicacion", back_populates="productos")
