-- =============================================================================
-- Operaciones Agricolas (Nintanga) - esquema `operaciones_agricolas` en mirai_core
--
-- Reemplaza la base propia (operaciones-agricolas-db). Convenciones MirAI:
--   * PK  id_<tabla>; FKs con el mismo nombre que la PK referenciada.
--   * tenant_id (1 = mirai) y numero_empresa (Nintanga = '222') en cada tabla.
--   * Catalogos: estado ACTIVO / INACTIVO.
--   * Tablas de proceso (registro, checklist, cosecha...): `estado` guarda la
--     etapa del flujo (Pendiente, Ejecutándose, Enviado, Recibido...) con los
--     mismos valores que usa la aplicacion.
--   * Personas: solo id_persona (maestro Personas, por API). Los usuarios del
--     HUB se guardan por su login (`usuario`, `creado_por`).
--   * Activos (tractores/aperos) siguen como texto mientras se termina el
--     catalogo de Activos.
-- Idempotente: se puede correr varias veces.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS operaciones_agricolas;
SET search_path TO operaciones_agricolas;

-- ----------------------------------------------------------------- catalogos
CREATE TABLE IF NOT EXISTS proyecto (
    id_proyecto     BIGSERIAL    PRIMARY KEY,
    tenant_id       BIGINT       NOT NULL DEFAULT 1,
    numero_empresa  VARCHAR(10)  NOT NULL DEFAULT '222',
    nombre          VARCHAR(200) NOT NULL,
    direccion       VARCHAR(500),
    tipo            VARCHAR(50),                    -- Orgánico / Convencional
    estado          VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
    fecha_creacion  TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT ck_proyecto_estado CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT uq_proyecto_nombre UNIQUE (tenant_id, numero_empresa, nombre)
);

CREATE TABLE IF NOT EXISTS supervisor (
    id_supervisor   BIGSERIAL    PRIMARY KEY,
    tenant_id       BIGINT       NOT NULL DEFAULT 1,
    numero_empresa  VARCHAR(10)  NOT NULL DEFAULT '222',
    id_persona      BIGINT,                         -- maestro Personas (por cedula)
    cedula          VARCHAR(20)  NOT NULL,
    nombre          VARCHAR(300) NOT NULL,
    id_proyecto     BIGINT       REFERENCES proyecto (id_proyecto) ON DELETE SET NULL,
    proyecto        VARCHAR(200),                   -- texto historico (antes de id_proyecto)
    estado          VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
    fecha_creacion  TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT ck_supervisor_estado CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT uq_supervisor_cedula UNIQUE (tenant_id, numero_empresa, cedula)
);

-- Choferes / camiones de transporte de cosecha (externos: no son personal).
CREATE TABLE IF NOT EXISTS camion (
    id_camion       BIGSERIAL    PRIMARY KEY,
    tenant_id       BIGINT       NOT NULL DEFAULT 1,
    numero_empresa  VARCHAR(10)  NOT NULL DEFAULT '222',
    nombre          VARCHAR(200) NOT NULL,
    cedula          VARCHAR(20)  NOT NULL,
    placa           VARCHAR(20),
    correo          VARCHAR(150),
    empresa         VARCHAR(100),                   -- PROVEFRUT / PROCONGELADOS
    estado          VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
    fecha_creacion  TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT ck_camion_estado CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT uq_camion_cedula UNIQUE (tenant_id, numero_empresa, cedula)
);

CREATE TABLE IF NOT EXISTS actividad (
    id_actividad        BIGSERIAL    PRIMARY KEY,
    tenant_id           BIGINT       NOT NULL DEFAULT 1,
    numero_empresa      VARCHAR(10)  NOT NULL DEFAULT '222',
    codigo              VARCHAR(50)  NOT NULL,      -- ACT-001
    actividad           VARCHAR(250) NOT NULL,
    subactividades      JSONB        NOT NULL DEFAULT '[]'::jsonb,
    equipo              VARCHAR(50)  NOT NULL DEFAULT 'Tractores',
    tipo                VARCHAR(50),
    cantidad            INTEGER      NOT NULL DEFAULT 0,
    estado              VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
    fecha_creacion      TIMESTAMP    NOT NULL DEFAULT now(),
    fecha_actualizacion TIMESTAMP,
    CONSTRAINT ck_actividad_estado CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT uq_actividad_codigo UNIQUE (tenant_id, numero_empresa, codigo)
);

-- Credencial de acceso de los tractoristas (usuarios EXTERNOS al HUB: entran
-- con cedula + PIN). Los datos de la persona viven en el maestro Personas.
CREATE TABLE IF NOT EXISTS tractorista (
    id_tractorista    BIGSERIAL    PRIMARY KEY,
    tenant_id         BIGINT       NOT NULL DEFAULT 1,
    numero_empresa    VARCHAR(10)  NOT NULL DEFAULT '222',
    id_persona        BIGINT       NOT NULL,         -- maestro Personas
    cedula            VARCHAR(20)  NOT NULL,         -- clave de ingreso (= personas.identificacion)
    username          VARCHAR(100),                  -- nombre.apellido
    pin_hash          VARCHAR(255),                  -- bcrypt; NULL = aun no registra su PIN
    pin_expira        TIMESTAMP,
    intentos_fallidos INTEGER      NOT NULL DEFAULT 0,
    bloqueado_hasta   TIMESTAMP,
    ultimo_acceso     TIMESTAMP,
    estado            VARCHAR(10)  NOT NULL DEFAULT 'ACTIVO',
    fecha_creacion    TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT ck_tractorista_estado CHECK (estado IN ('ACTIVO', 'INACTIVO')),
    CONSTRAINT uq_tractorista_persona UNIQUE (tenant_id, numero_empresa, id_persona),
    CONSTRAINT uq_tractorista_cedula UNIQUE (tenant_id, numero_empresa, cedula)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tractorista_username
    ON tractorista (tenant_id, lower(username)) WHERE username IS NOT NULL;

-- Copia semanal de ordenes de cultivo desde Informix (sync_lotes_informix).
CREATE TABLE IF NOT EXISTS lote_informix (
    id_lote_informix     BIGSERIAL    PRIMARY KEY,
    tenant_id            BIGINT       NOT NULL DEFAULT 1,
    numero_empresa       VARCHAR(10)  NOT NULL DEFAULT '222',
    ocult_cod_ocult      VARCHAR(50),
    ocult_cod_proda      VARCHAR(100),
    variedad             VARCHAR(150),
    lote                 VARCHAR(100),
    lote_obs             VARCHAR(200),
    empresa              VARCHAR(150),
    hacienda             VARCHAR(150),
    proyecto             VARCHAR(150),
    edad_sem             VARCHAR(20),
    dimension            DOUBLE PRECISION,
    fecha_siembra        DATE,
    anio                 INTEGER,
    semana               INTEGER,
    fecha_sincronizacion TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lote_informix_ocult ON lote_informix (ocult_cod_ocult, id_lote_informix DESC);
CREATE INDEX IF NOT EXISTS ix_lote_informix_semana ON lote_informix (anio, semana);

-- ------------------------------------------------------ actividades tractores
-- Checklist pre-uso del tractor. estado: Activo (en uso) / Inactivo
-- (reemplazado por otro) / Desactivado (jornada cerrada).
CREATE TABLE IF NOT EXISTS checklist (
    id_checklist             BIGSERIAL    PRIMARY KEY,
    tenant_id                BIGINT       NOT NULL DEFAULT 1,
    numero_empresa           VARCHAR(10)  NOT NULL DEFAULT '222',
    id_tractorista           BIGINT       REFERENCES tractorista (id_tractorista) ON DELETE SET NULL,
    usuario                  VARCHAR(150),             -- nombre del operador (como lo muestra la app)
    fecha                    TIMESTAMP,
    tractor                  VARCHAR(150),             -- Activos: texto por ahora
    apero                    VARCHAR(150),
    insp_motor               BOOLEAN NOT NULL DEFAULT false,
    insp_refrigerante        BOOLEAN NOT NULL DEFAULT false,
    insp_aceite_motor        BOOLEAN NOT NULL DEFAULT false,
    insp_aceite_hidraulico   BOOLEAN NOT NULL DEFAULT false,
    insp_fugas_hidraulico    BOOLEAN NOT NULL DEFAULT false,
    insp_bomba_hidraulica    BOOLEAN NOT NULL DEFAULT false,
    insp_transmisiones       BOOLEAN NOT NULL DEFAULT false,
    insp_indicadores_tablero BOOLEAN NOT NULL DEFAULT false,
    insp_neumaticos          BOOLEAN NOT NULL DEFAULT false,
    insp_frenos              BOOLEAN NOT NULL DEFAULT false,
    insp_fisuras             BOOLEAN NOT NULL DEFAULT false,
    insp_fallo_electrico     BOOLEAN NOT NULL DEFAULT false,
    limp_radiador            BOOLEAN NOT NULL DEFAULT false,
    limp_motor_filtros       BOOLEAN NOT NULL DEFAULT false,
    limp_cabina              BOOLEAN NOT NULL DEFAULT false,
    limp_frenos              BOOLEAN NOT NULL DEFAULT false,
    lub_articulaciones       BOOLEAN NOT NULL DEFAULT false,
    lub_pines_bocines        BOOLEAN NOT NULL DEFAULT false,
    horometro_inicial        DOUBLE PRECISION,
    horometro_final          DOUBLE PRECISION,
    estado                   VARCHAR(20),
    CONSTRAINT ck_checklist_estado CHECK (estado IS NULL OR estado IN ('Activo', 'Inactivo', 'Desactivado'))
);
CREATE INDEX IF NOT EXISTS ix_checklist_tractor_estado ON checklist (tractor, estado);

CREATE TABLE IF NOT EXISTS registro (
    id_registro      BIGSERIAL    PRIMARY KEY,
    tenant_id        BIGINT       NOT NULL DEFAULT 1,
    numero_empresa   VARCHAR(10)  NOT NULL DEFAULT '222',
    id_actividad     BIGINT       REFERENCES actividad (id_actividad) ON DELETE SET NULL,
    id_checklist     BIGINT       REFERENCES checklist (id_checklist) ON DELETE SET NULL,
    id_tractorista   BIGINT       REFERENCES tractorista (id_tractorista) ON DELETE SET NULL,
    fecha_creacion   TIMESTAMP    NOT NULL,
    fecha_fin        TIMESTAMP,
    tiempo_inicio    TIMESTAMP,
    fecha_historial  JSONB        NOT NULL DEFAULT '[]'::jsonb,
    actividad        VARCHAR(250) NOT NULL,
    subactividad     VARCHAR(250),
    tractor          VARCHAR(150),
    apero            VARCHAR(150),
    lote             VARCHAR(100),
    hacienda         VARCHAR(150),
    orden_cultivo    VARCHAR(100),
    tipo             VARCHAR(50),
    usuario          VARCHAR(150),
    ubicacion        VARCHAR(200),
    tiempo_paro      DOUBLE PRECISION NOT NULL DEFAULT 0,
    tiempo_real      DOUBLE PRECISION NOT NULL DEFAULT 0,
    estado           VARCHAR(20)  NOT NULL DEFAULT 'Pendiente',
    CONSTRAINT ck_registro_estado CHECK (estado IN ('Pendiente', 'Ejecutándose', 'Pausado', 'Finalizado', 'Eliminado'))
);
CREATE INDEX IF NOT EXISTS ix_registro_fecha ON registro (fecha_creacion DESC);
CREATE INDEX IF NOT EXISTS ix_registro_usuario_estado ON registro (usuario, estado);
CREATE INDEX IF NOT EXISTS ix_registro_checklist ON registro (id_checklist);

CREATE TABLE IF NOT EXISTS falla_tractor (
    id_falla_tractor BIGSERIAL    PRIMARY KEY,
    tenant_id        BIGINT       NOT NULL DEFAULT 1,
    numero_empresa   VARCHAR(10)  NOT NULL DEFAULT '222',
    id_checklist     BIGINT       REFERENCES checklist (id_checklist) ON DELETE SET NULL,
    id_tractorista   BIGINT       REFERENCES tractorista (id_tractorista) ON DELETE SET NULL,
    usuario          VARCHAR(150) NOT NULL,
    tractor          VARCHAR(150) NOT NULL,
    detalle          TEXT,
    ubicacion        VARCHAR(200),
    estado           VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
    fecha            TIMESTAMP    NOT NULL DEFAULT now(),
    fecha_creacion   TIMESTAMP    NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------- cosecha
-- Ficha de transporte (camion). estado: Activo, Enviado, Recibido, Falla,
-- Corregida, Desactivado, Eliminado. Una correccion crea una ficha nueva
-- 'Corregida' que apunta a la original ('Falla') por id_correccion.
CREATE TABLE IF NOT EXISTS cosecha_transporte (
    id_cosecha_transporte   BIGSERIAL    PRIMARY KEY,
    tenant_id               BIGINT       NOT NULL DEFAULT 1,
    numero_empresa          VARCHAR(10)  NOT NULL DEFAULT '222',
    id_camion               BIGINT       REFERENCES camion (id_camion) ON DELETE SET NULL,
    id_supervisor           BIGINT       REFERENCES supervisor (id_supervisor) ON DELETE SET NULL,
    id_correccion           BIGINT       REFERENCES cosecha_transporte (id_cosecha_transporte) ON DELETE SET NULL,
    propietario             VARCHAR(150),
    placa                   VARCHAR(20),
    nombre_chofer           VARCHAR(150),
    numeracion              VARCHAR(30),
    num_ficha               VARCHAR(50),
    seg_chaleco             BOOLEAN NOT NULL DEFAULT false,
    seg_cofia               BOOLEAN NOT NULL DEFAULT false,
    seg_casco               BOOLEAN NOT NULL DEFAULT false,
    seg_calzado_adecuado    BOOLEAN NOT NULL DEFAULT false,
    seg_limpieza_bines      BOOLEAN NOT NULL DEFAULT false,
    seg_materiales_extranos BOOLEAN NOT NULL DEFAULT false,
    seg_saran               BOOLEAN NOT NULL DEFAULT false,
    seg_comentario          TEXT,
    seg_observaciones       TEXT,
    seg_foto_url            TEXT,                    -- lista de URLs (JSON) de fotos en S3
    fecha_creacion          TIMESTAMP    NOT NULL DEFAULT now(),
    fecha_despacho          TIMESTAMP,
    fecha_salida            TIMESTAMP,
    planta                  VARCHAR(100),
    usuario                 VARCHAR(150),
    observacion_falla       TEXT,
    recibido_por            VARCHAR(200),
    hora_ingreso            VARCHAR(20),
    creado_por              VARCHAR(150),            -- login HUB de quien la creo
    estado                  VARCHAR(20)  NOT NULL DEFAULT 'Activo',
    CONSTRAINT ck_cosecha_transporte_estado CHECK (estado IN
        ('Activo', 'Enviado', 'Recibido', 'Falla', 'Corregida', 'Desactivado', 'Eliminado'))
);
CREATE INDEX IF NOT EXISTS ix_cosecha_transporte_estado ON cosecha_transporte (estado);
CREATE INDEX IF NOT EXISTS ix_cosecha_transporte_creado_por ON cosecha_transporte (creado_por);

-- Productos (bines) de cada ficha. numeracion COS-aaaamm-NNNNNN por producto.
CREATE TABLE IF NOT EXISTS cosecha (
    id_cosecha            BIGSERIAL    PRIMARY KEY,
    tenant_id             BIGINT       NOT NULL DEFAULT 1,
    numero_empresa        VARCHAR(10)  NOT NULL DEFAULT '222',
    id_cosecha_transporte BIGINT       REFERENCES cosecha_transporte (id_cosecha_transporte) ON DELETE CASCADE,
    producto              VARCHAR(150),
    lote                  VARCHAR(100),
    centro_costos         VARCHAR(150),
    orden_cultivo         VARCHAR(100),
    variedad              VARCHAR(150),
    num_ficha_org         VARCHAR(50),
    num_ficha             VARCHAR(50),             -- num_sec de Informix (pesaje en planta)
    peso                  DOUBLE PRECISION NOT NULL DEFAULT 0,
    peso_neto             DOUBLE PRECISION NOT NULL DEFAULT 0,
    cantidad              INTEGER      NOT NULL DEFAULT 0,
    ubicacion             VARCHAR(200),
    responsable           VARCHAR(150),
    recibido_por          VARCHAR(200),
    numeracion            VARCHAR(30),
    fecha_creacion        TIMESTAMP    NOT NULL DEFAULT now(),
    estado                VARCHAR(20)  NOT NULL DEFAULT 'Activo',
    CONSTRAINT ck_cosecha_estado CHECK (estado IN ('Activo', 'Cargado', 'Enviado'))
);
CREATE INDEX IF NOT EXISTS ix_cosecha_transporte ON cosecha (id_cosecha_transporte);
CREATE INDEX IF NOT EXISTS ix_cosecha_numeracion ON cosecha (numeracion);
CREATE INDEX IF NOT EXISTS ix_cosecha_num_ficha ON cosecha (num_ficha);

-- ------------------------------------------------- revision de horas (aprobacion)
-- Un supervisor revisa las horas del tractorista (puede corregir inicio/fin) y
-- al guardar la actividad queda REVISADO y BLOQUEADA para otros cambios.
ALTER TABLE registro ADD COLUMN IF NOT EXISTS revision_estado     VARCHAR(15) NOT NULL DEFAULT 'NO_REVISADO';
ALTER TABLE registro ADD COLUMN IF NOT EXISTS revisado_por        VARCHAR(150);   -- login HUB
ALTER TABLE registro ADD COLUMN IF NOT EXISTS revisado_por_nombre VARCHAR(200);
ALTER TABLE registro ADD COLUMN IF NOT EXISTS fecha_revision      TIMESTAMP;
DO $$ BEGIN
    ALTER TABLE registro ADD CONSTRAINT ck_registro_revision_estado CHECK (revision_estado IN ('NO_REVISADO', 'REVISADO'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_registro_revision ON registro (revision_estado);

-- Historial de revisiones: quien, cuando y que cambio (antes -> despues).
CREATE TABLE IF NOT EXISTS registro_revision (
    id_registro_revision BIGSERIAL    PRIMARY KEY,
    tenant_id            BIGINT       NOT NULL DEFAULT 1,
    numero_empresa       VARCHAR(10)  NOT NULL DEFAULT '222',
    id_registro          BIGINT       NOT NULL REFERENCES registro (id_registro) ON DELETE CASCADE,
    accion               VARCHAR(20)  NOT NULL DEFAULT 'REVISADO',
    usuario              VARCHAR(150) NOT NULL,
    usuario_nombre       VARCHAR(200),
    cambios              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    fecha                TIMESTAMP    NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_registro_revision_registro ON registro_revision (id_registro);

-- ------------------------------------------------- parametros del modulo
-- Configuracion editable desde la app (clave -> JSON). Hoy: 'jornada' = horario
-- normal, almuerzo por jornada, separacion entre jornadas y feriados que usa el
-- reporte de actividades para clasificar horas normales / 50% / 100%.
CREATE TABLE IF NOT EXISTS parametro (
    id_parametro         BIGSERIAL    PRIMARY KEY,
    tenant_id            BIGINT       NOT NULL DEFAULT 1,
    numero_empresa       VARCHAR(10)  NOT NULL DEFAULT '222',
    clave                VARCHAR(60)  NOT NULL,
    valor                JSONB        NOT NULL DEFAULT '{}'::jsonb,
    actualizado_por      VARCHAR(150),
    fecha_actualizacion  TIMESTAMP    NOT NULL DEFAULT now(),
    CONSTRAINT uq_parametro_clave UNIQUE (tenant_id, numero_empresa, clave)
);

-- ------------------------------------------------- bitacora dron
-- Los registros son de Tractores (Bitacora Tractor) o de Drones (Bitacora Dron);
-- las actividades del catalogo ya tienen su columna `equipo`.
ALTER TABLE registro ADD COLUMN IF NOT EXISTS equipo VARCHAR(20) NOT NULL DEFAULT 'Tractores';
DO $$ BEGIN
    ALTER TABLE registro ADD CONSTRAINT ck_registro_equipo CHECK (equipo IN ('Tractores', 'Drones'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_registro_equipo ON registro (equipo);
