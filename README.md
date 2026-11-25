# Repositorio Digital de Proyectos y Trabajos de Grado (UES FMO)

Catálogo web de trabajos de graduación y proyectos de curso de la Universidad de El Salvador,
Facultad Multidisciplinaria Oriental. El solicitante envía su trabajo, el supervisor lo revisa y
registra el permiso de los autores, y el catálogo muestra las fichas y materiales autorizados.

Esta guía explica cómo iniciar el proyecto, dónde está cada parte y cómo respaldar la base y los
archivos (RNF-06).

## Estructura

| Carpeta | Contenido |
|---|---|
| `RepositorioApi/` | API en ASP.NET Core (.NET 10) con Entity Framework Core y PostgreSQL |
| `RepositorioApi/Controllers/` | Endpoints: autenticación, proyectos, revisión, catálogo, favoritos, administración |
| `RepositorioApi/App_Data/entregas/` | Archivos subidos (PDF y ZIP), una carpeta por entrega. No se sube al repositorio |
| `frontend-angular/` | Interfaz en Angular |
| `frontend-angular/src/app/catalogo/` | Catálogo público: búsqueda, filtros, ficha y favoritos |
| `frontend-angular/src/app/publicaciones/` | Envío de proyectos, Mis proyectos y notificaciones |
| `frontend-angular/src/app/gestion/` | Panel del supervisor, estadísticas y panel del administrador |
| `docker/` | Instalación con Docker. `db/01_tablas.sql` crea las tablas en orden, `db/02_datos.sql` carga los datos de prueba y `entregas/` trae los PDF y ZIP de ejemplo |

## Instalación rápida (recomendada)

Solo hace falta **Docker Desktop**. No es necesario instalar .NET, Node ni PostgreSQL: todo se
compila y se ejecuta dentro de contenedores.

1. Instalar [Docker Desktop](https://www.docker.com/products/docker-desktop/) y abrirlo
   (esperar a que diga *Engine running*).
2. Descargar el proyecto:

   ```powershell
   git clone https://github.com/oi25002-lgtm/Proyecto_final_repositorio.git
   cd Proyecto_final_repositorio
   ```

   Sin Git: en GitHub, **Code → Download ZIP**, descomprimir y abrir una terminal en esa carpeta.
3. Levantar el sistema:

   ```powershell
   docker compose up --build
   ```

   La primera vez tarda varios minutos (descarga las imágenes y compila). Está listo cuando
   aparece una línea parecida a `Application started` y la terminal deja de mostrar mensajes nuevos.
4. Abrir **http://localhost:4200** en el navegador.

### Cuentas de prueba

Todas usan la contraseña **Repositorio2026**.

| Rol | Correo | Qué puede probar |
|---|---|---|
| Administrador | `admin@example.com` | Crear cuentas de supervisor y administrador, asignar roles, habilitar cuentas, docentes, carreras, materias y demás catálogos |
| Supervisor | `carlos.ventura@example.com` | Empezar la revisión de las entregas pendientes, decidir, registrar permisos, destacar, retirar y ver estadísticas |
| Solicitante | `da18379@example.com` | Subir un proyecto y seguir sus entregas (tiene un trabajo publicado y otro en revisión que antes recibió correcciones), notificaciones y favoritos |

El catálogo público se puede ver sin iniciar sesión. La base de prueba trae 301 proyectos
(219 publicados), 15 entregas pendientes de revisión, 33 carreras y 8 departamentos.

### Detener, volver a iniciar y reiniciar

| Acción | Comando |
|---|---|
| Detener | `Ctrl + C` en la terminal, o `docker compose down` |
| Volver a iniciar (conserva los cambios) | `docker compose up` |
| Volver a los datos de prueba originales | `docker compose down -v` y luego `docker compose up --build` |

### Si algo falla

| Problema | Solución |
|---|---|
| `docker` no se reconoce como comando | Docker Desktop no está instalado o no está abierto. |
| *port is already allocated* (puerto 4200 ocupado) | Usar otro puerto: `$env:PUERTO=4300; docker compose up --build` y abrir http://localhost:4300 |
| *TLS handshake timeout* o *failed to fetch* al descargar | Falla de conexión con Docker Hub. Volver a ejecutar `docker compose up --build`; continúa donde se quedó. |
| La página abre pero no carga trabajos | La API todavía está arrancando; esperar unos segundos y recargar. |
| Se quiere empezar de cero | `docker compose down -v` y volver a `docker compose up --build`. |

## Instalación para desarrollo

Para modificar el código con recarga automática se usan las herramientas por separado.

### Requisitos

- Docker Desktop
- .NET SDK 10
- Node.js 22 o superior

### 1. Base de datos

La base corre en un contenedor de PostgreSQL 17 publicado en el puerto **5434**. Se carga con el
mismo script de la instalación rápida:

```powershell
docker run -d --name postgres17 -e POSTGRES_PASSWORD=TU_CONTRASEÑA -p 5434:5432 -v pgdata17:/var/lib/postgresql/data postgres:17
docker exec postgres17 psql -U postgres -c "CREATE DATABASE repositorio_db"
Get-Content docker/db/01_tablas.sql | docker exec -i postgres17 psql -U postgres -d repositorio_db
Get-Content docker/db/02_datos.sql | docker exec -i postgres17 psql -U postgres -d repositorio_db
New-Item -ItemType Directory -Force RepositorioApi/App_Data | Out-Null
Copy-Item -Recurse docker/entregas RepositorioApi/App_Data/entregas
```

### 2. Configurar la API

La cadena de conexión y la clave de los tokens van en *user-secrets*:

```powershell
cd RepositorioApi
dotnet user-secrets set "ConnectionStrings:RepositorioDb" "Host=localhost;Port=5434;Database=repositorio_db;Username=postgres;Password=TU_CONTRASEÑA"
dotnet user-secrets set "Jwt:Key" "UNA_CLAVE_LARGA_DE_AL_MENOS_32_CARACTERES"
dotnet user-secrets set "Jwt:Issuer" "RepositorioApi"
dotnet user-secrets set "Jwt:Audience" "RepositorioFrontend"
```

### 3. Ejecutar

API (queda en `https://localhost:7244`):

```powershell
cd RepositorioApi
dotnet dev-certs https --trust
dotnet run --launch-profile https
```

Interfaz (queda en `http://localhost:4200`):

```powershell
cd frontend-angular
npm install
npm start
```

### 4. Primer administrador

Con los datos de prueba ya existe `admin@example.com`. En una base sin cuentas, la persona se
registra desde **Registrarse** y después se le da el rol de administrador:

```sql
INSERT INTO tbl_usuario_rol (id_usuario, id_rol)
SELECT u.id_usuario, r.id_rol FROM tbl_usuario u, tbl_rol r
WHERE u.correo = 'TU_CORREO' AND r.nombre_rol = 'administrador';
```

Desde el panel de administración se crean las cuentas de supervisor y administrador, se asignan
roles a cuentas existentes, se registran docentes y se gestionan materias, temáticas, carreras y
departamentos. Los estudiantes crean su propia cuenta. Los cambios de rol aplican al volver a
iniciar sesión.

## Pantallas por rol

| Rol | Pantallas |
|---|---|
| Visitante (sin cuenta) | Catálogo `/catalogo` |
| Solicitante | Subir proyecto `/publicar`, Mis proyectos `/mis-proyectos`, Notificaciones `/notificaciones` y favoritos |
| Supervisor | Revisión `/revision-supervisor` (pendientes y publicaciones) y Estadísticas `/estadisticas` |
| Administrador | Administración `/admin` |

## Cambiar algo del catálogo (ejemplo)

Para cambiar el texto del botón **Ver ficha del trabajo**:

1. Abrir `frontend-angular/src/app/catalogo/catalogo.html` y buscar `Ver ficha del trabajo`.
2. Cambiar el texto y guardar. Con `npm start` en marcha, el navegador se actualiza solo.
3. Comprobar en `http://localhost:4200/catalogo` que el botón muestra el texto nuevo y sigue abriendo la ficha.

Los estilos del catálogo están en `catalogo.css` y su lógica (búsqueda, filtros, favoritos) en `catalogo.ts`.

## Respaldo

Hay que guardar **dos cosas**: la base y la carpeta de archivos subidos. Estos comandos son para la
instalación de desarrollo (contenedor `postgres17`). En la instalación con Docker los datos se
conservan mientras no se ejecute `docker compose down -v`.

```powershell
New-Item -ItemType Directory -Force respaldo | Out-Null

# Base de datos
docker exec postgres17 pg_dump -U postgres -d repositorio_db -F c -f /tmp/repositorio_db.backup
docker cp postgres17:/tmp/repositorio_db.backup .\respaldo\repositorio_db.backup

# Archivos subidos
Copy-Item -Recurse RepositorioApi\App_Data\entregas .\respaldo\entregas
```

Para restaurar:

```powershell
docker cp .\respaldo\repositorio_db.backup postgres17:/tmp/repositorio_db.backup
docker exec postgres17 pg_restore -U postgres -d repositorio_db --clean --if-exists /tmp/repositorio_db.backup
New-Item -ItemType Directory -Force RepositorioApi\App_Data\entregas | Out-Null
Copy-Item -Recurse -Force .\respaldo\entregas\* RepositorioApi\App_Data\entregas
```
