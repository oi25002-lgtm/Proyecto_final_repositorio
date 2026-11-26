-- Estructura de la base del Repositorio Digital UES FMO.
-- Las tablas van en orden: cada una solo depende de las anteriores.
-- Los datos están en 02_datos.sql.

SET client_encoding = 'UTF8';
SET client_min_messages = warning;

BEGIN;

-- 1. tbl_rol: roles del sistema (usuario, supervisor y administrador).
CREATE TABLE tbl_rol (
    id_rol serial,
    nombre_rol character varying(50) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_rol_pkey PRIMARY KEY (id_rol),
    CONSTRAINT uq_rol_nombre UNIQUE (nombre_rol),
    CONSTRAINT ck_rol_nombre CHECK ((((nombre_rol)::text <> ''::text) AND ((nombre_rol)::text = lower(TRIM(BOTH FROM nombre_rol)))))
);

-- 2. tbl_usuario: cuentas de las personas que usan el sistema.
CREATE TABLE tbl_usuario (
    id_usuario serial,
    nombres character varying(100) NOT NULL,
    apellidos character varying(100) NOT NULL,
    correo character varying(254) NOT NULL,
    contrasena_hash text NOT NULL,
    activo boolean NOT NULL DEFAULT true,
    fecha_registro timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tbl_usuario_pkey PRIMARY KEY (id_usuario),
    CONSTRAINT uq_usuario_correo UNIQUE (correo),
    CONSTRAINT ck_usuario_apellidos CHECK ((TRIM(BOTH FROM apellidos) <> ''::text)),
    CONSTRAINT ck_usuario_contrasena_hash CHECK ((TRIM(BOTH FROM contrasena_hash) <> ''::text)),
    CONSTRAINT ck_usuario_correo CHECK ((((correo)::text <> ''::text) AND ((correo)::text = lower(TRIM(BOTH FROM correo))))),
    CONSTRAINT ck_usuario_nombres CHECK ((TRIM(BOTH FROM nombres) <> ''::text))
);

-- 3. tbl_usuario_rol: roles de cada cuenta.
CREATE TABLE tbl_usuario_rol (
    id_usuario integer NOT NULL,
    id_rol integer NOT NULL,
    CONSTRAINT pk_usuario_rol PRIMARY KEY (id_usuario, id_rol),
    CONSTRAINT fk_usuario_rol_rol FOREIGN KEY (id_rol) REFERENCES tbl_rol(id_rol) ON DELETE RESTRICT,
    CONSTRAINT fk_usuario_rol_usuario FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT
);

-- 4. tbl_departamento: departamentos de la facultad.
CREATE TABLE tbl_departamento (
    id_departamento serial,
    nombre character varying(150) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_departamento_pkey PRIMARY KEY (id_departamento),
    CONSTRAINT ck_departamento_nombre CHECK ((TRIM(BOTH FROM nombre) <> ''::text))
);

-- 5. tbl_carrera: carreras de cada departamento.
CREATE TABLE tbl_carrera (
    id_carrera serial,
    codigo character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    id_departamento integer NOT NULL,
    CONSTRAINT tbl_carrera_pkey PRIMARY KEY (id_carrera),
    CONSTRAINT uq_carrera_codigo UNIQUE (codigo),
    CONSTRAINT fk_carrera_departamento FOREIGN KEY (id_departamento) REFERENCES tbl_departamento(id_departamento) ON DELETE RESTRICT,
    CONSTRAINT ck_carrera_codigo CHECK ((((codigo)::text <> ''::text) AND ((codigo)::text = upper(TRIM(BOTH FROM codigo))))),
    CONSTRAINT ck_carrera_nombre CHECK ((TRIM(BOTH FROM nombre) <> ''::text))
);

-- 6. tbl_materia: materias de los planes de estudio.
CREATE TABLE tbl_materia (
    id_materia serial,
    codigo character varying(20) NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_materia_pkey PRIMARY KEY (id_materia),
    CONSTRAINT uq_materia_codigo_nombre UNIQUE (codigo, nombre),
    CONSTRAINT ck_materia_codigo CHECK ((((codigo)::text <> ''::text) AND ((codigo)::text = upper(TRIM(BOTH FROM codigo))))),
    CONSTRAINT ck_materia_nombre CHECK ((TRIM(BOTH FROM nombre) <> ''::text))
);

-- 7. tbl_carrera_materia: plan de estudios, con el ciclo de cada materia en la carrera.
CREATE TABLE tbl_carrera_materia (
    id_carrera integer NOT NULL,
    id_materia integer NOT NULL,
    ciclo smallint NOT NULL,
    CONSTRAINT pk_carrera_materia PRIMARY KEY (id_carrera, id_materia),
    CONSTRAINT fk_carrera_materia_carrera FOREIGN KEY (id_carrera) REFERENCES tbl_carrera(id_carrera) ON DELETE RESTRICT,
    CONSTRAINT fk_carrera_materia_materia FOREIGN KEY (id_materia) REFERENCES tbl_materia(id_materia) ON DELETE RESTRICT,
    CONSTRAINT ck_carrera_materia_ciclo CHECK (((ciclo >= 1) AND (ciclo <= 14)))
);
CREATE INDEX ix_carrera_materia_materia ON tbl_carrera_materia USING btree (id_materia);
COMMENT ON TABLE tbl_carrera_materia IS 'Materias del plan de estudios de cada carrera.';
COMMENT ON COLUMN tbl_carrera_materia.ciclo IS 'Ciclo en que se cursa la materia (1 a 14).';

-- 8. tbl_docente: docentes que pueden ser asesores.
CREATE TABLE tbl_docente (
    id_docente serial,
    id_usuario integer NOT NULL,
    codigo_docente character varying(20) NOT NULL,
    id_departamento integer NOT NULL,
    CONSTRAINT tbl_docente_pkey PRIMARY KEY (id_docente),
    CONSTRAINT uq_docente_codigo UNIQUE (codigo_docente),
    CONSTRAINT uq_docente_usuario UNIQUE (id_usuario),
    CONSTRAINT fk_docente_departamento FOREIGN KEY (id_departamento) REFERENCES tbl_departamento(id_departamento) ON DELETE RESTRICT,
    CONSTRAINT fk_docente_usuario FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT ck_docente_codigo CHECK ((((codigo_docente)::text <> ''::text) AND ((codigo_docente)::text = upper(TRIM(BOTH FROM codigo_docente)))))
);
CREATE INDEX ix_docente_departamento ON tbl_docente USING btree (id_departamento);
COMMENT ON COLUMN tbl_docente.id_departamento IS 'Departamento del docente.';

-- 9. tbl_materia_docente: docentes que imparten cada materia.
CREATE TABLE tbl_materia_docente (
    id_materia integer NOT NULL,
    id_docente integer NOT NULL,
    CONSTRAINT pk_materia_docente PRIMARY KEY (id_materia, id_docente),
    CONSTRAINT fk_materia_docente_docente FOREIGN KEY (id_docente) REFERENCES tbl_docente(id_docente) ON DELETE RESTRICT,
    CONSTRAINT fk_materia_docente_materia FOREIGN KEY (id_materia) REFERENCES tbl_materia(id_materia) ON DELETE RESTRICT
);
CREATE INDEX ix_materia_docente_docente ON tbl_materia_docente USING btree (id_docente);
COMMENT ON TABLE tbl_materia_docente IS 'Docentes que imparten cada materia.';

-- 10. tbl_tematica: áreas temáticas para clasificar los trabajos.
CREATE TABLE tbl_tematica (
    id_tematica serial,
    nombre character varying(100) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_tematica_pkey PRIMARY KEY (id_tematica),
    CONSTRAINT uq_tematica_nombre UNIQUE (nombre),
    CONSTRAINT ck_tematica_nombre CHECK ((((nombre)::text <> ''::text) AND ((nombre)::text = lower(TRIM(BOTH FROM nombre)))))
);

-- 11. tbl_tipo_proyecto: tipos de trabajo.
CREATE TABLE tbl_tipo_proyecto (
    id_tipo_proyecto serial,
    nombre character varying(50) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_tipo_proyecto_pkey PRIMARY KEY (id_tipo_proyecto),
    CONSTRAINT uq_tipo_proyecto_nombre UNIQUE (nombre),
    CONSTRAINT ck_tipo_proyecto_nombre CHECK ((((nombre)::text <> ''::text) AND ((nombre)::text = lower(TRIM(BOTH FROM nombre)))))
);

-- 12. tbl_etiquetas: palabras clave.
CREATE TABLE tbl_etiquetas (
    id_etiqueta serial,
    nombre character varying(60) NOT NULL,
    CONSTRAINT tbl_etiquetas_pkey PRIMARY KEY (id_etiqueta),
    CONSTRAINT uq_etiqueta_nombre UNIQUE (nombre),
    CONSTRAINT ck_etiqueta_nombre CHECK ((((nombre)::text <> ''::text) AND ((nombre)::text = lower(TRIM(BOTH FROM nombre)))))
);

-- 13. tbl_proyecto: trabajos académicos.
CREATE TABLE tbl_proyecto (
    id_proyecto serial,
    titulo character varying(300) NOT NULL,
    resumen text NOT NULL,
    anio integer NOT NULL,
    id_tipo_proyecto integer NOT NULL,
    id_carrera integer NOT NULL,
    id_tematica integer NOT NULL,
    id_materia integer,
    estado_publicacion character varying(15) NOT NULL DEFAULT 'no_publicado'::character varying,
    estado_autorizacion character varying(20) NOT NULL DEFAULT 'pendiente'::character varying,
    es_destacado boolean NOT NULL DEFAULT false,
    fecha_registro timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT tbl_proyecto_pkey PRIMARY KEY (id_proyecto),
    CONSTRAINT fk_proyecto_carrera FOREIGN KEY (id_carrera) REFERENCES tbl_carrera(id_carrera) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_carrera_materia FOREIGN KEY (id_carrera, id_materia) REFERENCES tbl_carrera_materia(id_carrera, id_materia) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_materia FOREIGN KEY (id_materia) REFERENCES tbl_materia(id_materia) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_tematica FOREIGN KEY (id_tematica) REFERENCES tbl_tematica(id_tematica) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_tipo FOREIGN KEY (id_tipo_proyecto) REFERENCES tbl_tipo_proyecto(id_tipo_proyecto) ON DELETE RESTRICT,
    CONSTRAINT ck_proyecto_anio CHECK (((anio >= 1) AND (anio <= 9999))),
    CONSTRAINT ck_proyecto_autorizacion CHECK (((estado_autorizacion)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('autorizado'::character varying)::text, ('no_autorizado'::character varying)::text]))),
    CONSTRAINT ck_proyecto_fechas CHECK ((fecha_actualizacion >= fecha_registro)),
    CONSTRAINT ck_proyecto_publicacion CHECK (((estado_publicacion)::text = ANY (ARRAY[('no_publicado'::character varying)::text, ('publicado'::character varying)::text, ('retirado'::character varying)::text]))),
    CONSTRAINT ck_proyecto_publicacion_autorizada CHECK ((((estado_publicacion)::text <> 'publicado'::text) OR ((estado_autorizacion)::text = 'autorizado'::text))),
    CONSTRAINT ck_proyecto_resumen CHECK ((TRIM(BOTH FROM resumen) <> ''::text)),
    CONSTRAINT ck_proyecto_titulo CHECK ((TRIM(BOTH FROM titulo) <> ''::text))
);

-- 14. tbl_autor: estudiantes autores de los trabajos.
CREATE TABLE tbl_autor (
    id_autor serial,
    nombres character varying(100) NOT NULL,
    apellidos character varying(100) NOT NULL,
    carnet character varying(20),
    id_usuario integer,
    CONSTRAINT tbl_autor_pkey PRIMARY KEY (id_autor),
    CONSTRAINT uq_autor_carnet UNIQUE (carnet),
    CONSTRAINT uq_autor_usuario UNIQUE (id_usuario),
    CONSTRAINT fk_autor_usuario FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT ck_autor_apellidos CHECK ((TRIM(BOTH FROM apellidos) <> ''::text)),
    CONSTRAINT ck_autor_carnet CHECK (((carnet IS NULL) OR (((carnet)::text <> ''::text) AND ((carnet)::text = upper(TRIM(BOTH FROM carnet)))))),
    CONSTRAINT ck_autor_nombres CHECK ((TRIM(BOTH FROM nombres) <> ''::text))
);

-- 15. tbl_proyecto_autor: autores de cada proyecto y su orden.
CREATE TABLE tbl_proyecto_autor (
    id_proyecto integer NOT NULL,
    id_autor integer NOT NULL,
    orden_autoria integer NOT NULL,
    CONSTRAINT pk_proyecto_autor PRIMARY KEY (id_proyecto, id_autor),
    CONSTRAINT uq_proyecto_orden_autoria UNIQUE (id_proyecto, orden_autoria),
    CONSTRAINT fk_proyecto_autor_autor FOREIGN KEY (id_autor) REFERENCES tbl_autor(id_autor) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_autor_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT,
    CONSTRAINT ck_proyecto_orden_autoria CHECK ((orden_autoria > 0))
);

-- 16. tbl_proyecto_docente: asesores de cada proyecto.
CREATE TABLE tbl_proyecto_docente (
    id_proyecto integer NOT NULL,
    id_docente integer NOT NULL,
    nombre_autorizado boolean NOT NULL DEFAULT false,
    CONSTRAINT pk_proyecto_docente PRIMARY KEY (id_proyecto, id_docente),
    CONSTRAINT fk_proyecto_docente_docente FOREIGN KEY (id_docente) REFERENCES tbl_docente(id_docente) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_docente_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT
);
COMMENT ON COLUMN tbl_proyecto_docente.nombre_autorizado IS 'Si se puede mostrar el nombre del asesor en la ficha.';

-- 17. tbl_proyecto_etiqueta: palabras clave de cada proyecto.
CREATE TABLE tbl_proyecto_etiqueta (
    id_proyecto integer NOT NULL,
    id_etiqueta integer NOT NULL,
    CONSTRAINT pk_proyecto_etiqueta PRIMARY KEY (id_proyecto, id_etiqueta),
    CONSTRAINT fk_proyecto_etiqueta_etiqueta FOREIGN KEY (id_etiqueta) REFERENCES tbl_etiquetas(id_etiqueta) ON DELETE RESTRICT,
    CONSTRAINT fk_proyecto_etiqueta_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT
);

-- 18. tbl_entrega: envíos de cada proyecto (original, reenvíos y actualizaciones).
CREATE TABLE tbl_entrega (
    id_entrega serial,
    id_proyecto integer NOT NULL,
    id_usuario_envia integer NOT NULL,
    id_usuario_revisa integer,
    fecha_envio timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado_entrega character varying(20) NOT NULL DEFAULT 'pendiente'::character varying,
    fecha_revision timestamp without time zone,
    datos_propuestos jsonb,
    CONSTRAINT tbl_entrega_pkey PRIMARY KEY (id_entrega),
    CONSTRAINT fk_entrega_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_usuario_envia FOREIGN KEY (id_usuario_envia) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_usuario_revisa FOREIGN KEY (id_usuario_revisa) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT ck_entrega_estado CHECK (estado_entrega IN ('pendiente', 'en_revision', 'aprobada', 'con_correcciones', 'rechazada')),
    CONSTRAINT ck_entrega_fechas CHECK (((fecha_revision IS NULL) OR (fecha_revision >= fecha_envio))),
    -- Pendiente: nadie la ha tomado. En revisión: ya tiene supervisor, falta la decisión.
    CONSTRAINT ck_entrega_revision CHECK (
        (estado_entrega = 'pendiente' AND fecha_revision IS NULL)
        OR (estado_entrega = 'en_revision' AND id_usuario_revisa IS NOT NULL AND fecha_revision IS NULL)
        OR (estado_entrega IN ('aprobada', 'con_correcciones', 'rechazada')
            AND id_usuario_revisa IS NOT NULL AND fecha_revision IS NOT NULL))
);
COMMENT ON COLUMN tbl_entrega.datos_propuestos IS 'Cambios pedidos para un trabajo publicado; se aplican al aprobar.';

-- 19. tbl_tipo_recurso: tipos de material (pdf, zip o enlace).
CREATE TABLE tbl_tipo_recurso (
    id_tipo_recurso serial,
    nombre character varying(50) NOT NULL,
    descripcion text,
    CONSTRAINT tbl_tipo_recurso_pkey PRIMARY KEY (id_tipo_recurso),
    CONSTRAINT uq_tipo_recurso_nombre UNIQUE (nombre),
    CONSTRAINT ck_tipo_recurso_nombre CHECK ((((nombre)::text <> ''::text) AND ((nombre)::text = lower(TRIM(BOTH FROM nombre)))))
);

-- 20. tbl_recurso: materiales de cada entrega.
CREATE TABLE tbl_recurso (
    id_recurso serial,
    id_entrega integer NOT NULL,
    id_tipo_recurso integer NOT NULL,
    nombre character varying(200) NOT NULL,
    ubicacion text NOT NULL,
    difusion_autorizada boolean NOT NULL DEFAULT false,
    CONSTRAINT tbl_recurso_pkey PRIMARY KEY (id_recurso),
    CONSTRAINT fk_recurso_entrega FOREIGN KEY (id_entrega) REFERENCES tbl_entrega(id_entrega) ON DELETE RESTRICT,
    CONSTRAINT fk_recurso_tipo FOREIGN KEY (id_tipo_recurso) REFERENCES tbl_tipo_recurso(id_tipo_recurso) ON DELETE RESTRICT,
    CONSTRAINT ck_recurso_nombre CHECK ((TRIM(BOTH FROM nombre) <> ''::text)),
    CONSTRAINT ck_recurso_ubicacion CHECK (((TRIM(BOTH FROM ubicacion) <> ''::text) AND (ubicacion = TRIM(BOTH FROM ubicacion))))
);
COMMENT ON COLUMN tbl_recurso.difusion_autorizada IS 'Si el material se puede descargar desde el catálogo.';

-- 21. tbl_notificacion: avisos que recibe el solicitante.
CREATE TABLE tbl_notificacion (
    id_notificacion serial,
    id_entrega integer NOT NULL,
    id_usuario_destino integer NOT NULL,
    mensaje text NOT NULL,
    fecha_envio timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_lectura timestamp without time zone,
    CONSTRAINT tbl_notificacion_pkey PRIMARY KEY (id_notificacion),
    CONSTRAINT fk_notificacion_destinatario FOREIGN KEY (id_usuario_destino) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT fk_notificacion_entrega FOREIGN KEY (id_entrega) REFERENCES tbl_entrega(id_entrega) ON DELETE RESTRICT,
    CONSTRAINT ck_notificacion_fechas CHECK (((fecha_lectura IS NULL) OR (fecha_lectura >= fecha_envio))),
    CONSTRAINT ck_notificacion_mensaje CHECK ((TRIM(BOTH FROM mensaje) <> ''::text))
);

-- 22. tbl_historial: registro de acciones sobre los proyectos.
CREATE TABLE tbl_historial (
    id_historial serial,
    id_usuario integer NOT NULL,
    id_proyecto integer NOT NULL,
    accion character varying(20) NOT NULL,
    fecha_accion timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detalle text,
    CONSTRAINT tbl_historial_pkey PRIMARY KEY (id_historial),
    CONSTRAINT fk_historial_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT,
    CONSTRAINT fk_historial_usuario FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT,
    CONSTRAINT ck_historial_accion CHECK ((((accion)::text <> ''::text) AND ((accion)::text = lower(TRIM(BOTH FROM accion)))))
);

-- 23. tbl_favorito: proyectos guardados por cada usuario.
CREATE TABLE tbl_favorito (
    id_usuario integer NOT NULL,
    id_proyecto integer NOT NULL,
    fecha_registro timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_favorito PRIMARY KEY (id_usuario, id_proyecto),
    CONSTRAINT fk_favorito_proyecto FOREIGN KEY (id_proyecto) REFERENCES tbl_proyecto(id_proyecto) ON DELETE RESTRICT,
    CONSTRAINT fk_favorito_usuario FOREIGN KEY (id_usuario) REFERENCES tbl_usuario(id_usuario) ON DELETE RESTRICT
);

-- Índice, vista, función, trigger y procedimiento.
-- La aplicación no los usa; se consultan directamente en la base.

-- 24. ix_proyecto_publicacion_anio: filtra el catálogo y las estadísticas por publicación y año.
CREATE INDEX ix_proyecto_publicacion_anio ON tbl_proyecto USING btree (estado_publicacion, anio);

-- 25. vw_catalogo_publicado: trabajos publicados con su clasificación y sus autores.
CREATE VIEW vw_catalogo_publicado AS
SELECT
    p.id_proyecto,
    p.titulo,
    p.anio,
    tp.nombre AS tipo,
    d.nombre AS departamento,
    c.nombre AS carrera,
    t.nombre AS area,
    p.es_destacado,
    (SELECT string_agg(a.nombres || ' ' || a.apellidos, ', ' ORDER BY pa.orden_autoria)
       FROM tbl_proyecto_autor pa
       JOIN tbl_autor a ON a.id_autor = pa.id_autor
      WHERE pa.id_proyecto = p.id_proyecto) AS autores
FROM tbl_proyecto p
JOIN tbl_tipo_proyecto tp ON tp.id_tipo_proyecto = p.id_tipo_proyecto
JOIN tbl_carrera c ON c.id_carrera = p.id_carrera
JOIN tbl_departamento d ON d.id_departamento = c.id_departamento
JOIN tbl_tematica t ON t.id_tematica = p.id_tematica
WHERE p.estado_publicacion = 'publicado'
  AND p.estado_autorizacion = 'autorizado';

-- 26. trg_proteger_entrega_revisada: solo se puede borrar una entrega pendiente (RF-24).
CREATE FUNCTION fn_proteger_entrega_revisada() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.estado_entrega <> 'pendiente' THEN
        RAISE EXCEPTION 'La entrega % ya fue revisada (estado: %); solo se puede eliminar una entrega pendiente.',
            OLD.id_entrega, OLD.estado_entrega;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_proteger_entrega_revisada
    BEFORE DELETE ON tbl_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_entrega_revisada();

-- 27. fn_estadisticas: indicadores de la pantalla de Estadísticas, con año y área opcionales.
-- Cada proyecto cuenta una sola vez, aunque tenga varias entregas.
CREATE FUNCTION fn_estadisticas(p_anio integer DEFAULT NULL, p_id_tematica integer DEFAULT NULL)
RETURNS TABLE (proyectos bigint, publicados bigint, en_revision bigint, tasa_aprobacion integer)
LANGUAGE sql STABLE AS $$
    WITH elegidos AS (
        SELECT id_proyecto, estado_publicacion
        FROM tbl_proyecto
        WHERE (p_anio IS NULL OR anio = p_anio)
          AND (p_id_tematica IS NULL OR id_tematica = p_id_tematica)
    ), sus_entregas AS (
        SELECT e.estado_entrega
        FROM tbl_entrega e
        JOIN elegidos el ON el.id_proyecto = e.id_proyecto
    )
    SELECT
        (SELECT count(*) FROM elegidos),
        (SELECT count(*) FROM elegidos WHERE estado_publicacion = 'publicado'),
        (SELECT count(*) FROM sus_entregas WHERE estado_entrega IN ('pendiente', 'en_revision')),
        (SELECT CASE WHEN count(*) FILTER (WHERE estado_entrega NOT IN ('pendiente', 'en_revision')) = 0 THEN NULL
                     ELSE round(100.0 * count(*) FILTER (WHERE estado_entrega = 'aprobada')
                                / count(*) FILTER (WHERE estado_entrega NOT IN ('pendiente', 'en_revision')))::integer
                END
           FROM sus_entregas);
$$;

-- 28. sp_retirar_publicacion: retira un trabajo publicado y guarda el motivo en el historial (RF-09).
-- Si el usuario no es supervisor, el motivo es corto o el trabajo no está publicado, no cambia nada.
CREATE PROCEDURE sp_retirar_publicacion(p_id_proyecto integer, p_id_usuario integer, p_motivo text)
LANGUAGE plpgsql AS $$
DECLARE
    v_estado character varying;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM tbl_usuario_rol ur JOIN tbl_rol r ON r.id_rol = ur.id_rol
                    WHERE ur.id_usuario = p_id_usuario AND r.nombre_rol = 'supervisor') THEN
        RAISE EXCEPTION 'Solo un supervisor puede retirar una publicación.';
    END IF;
    IF length(trim(coalesce(p_motivo, ''))) < 10 THEN
        RAISE EXCEPTION 'Explica el motivo del retiro con al menos 10 caracteres.';
    END IF;

    SELECT estado_publicacion INTO v_estado FROM tbl_proyecto WHERE id_proyecto = p_id_proyecto FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No existe el proyecto %.', p_id_proyecto;
    END IF;
    IF v_estado <> 'publicado' THEN
        RAISE EXCEPTION 'Solo se puede retirar una publicación vigente (el proyecto está %).', v_estado;
    END IF;

    UPDATE tbl_proyecto
       SET estado_publicacion = 'retirado',
           es_destacado = false,
           fecha_actualizacion = GREATEST(now() AT TIME ZONE 'UTC', fecha_registro)
     WHERE id_proyecto = p_id_proyecto;

    INSERT INTO tbl_historial (id_usuario, id_proyecto, accion, detalle)
    VALUES (p_id_usuario, p_id_proyecto, 'retiro', trim(p_motivo));
END;
$$;

COMMIT;
