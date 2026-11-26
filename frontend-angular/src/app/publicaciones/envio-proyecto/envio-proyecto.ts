import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { esCuentaDeGestion, usuarioTieneRol } from '../../auth/auth.guard';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { REGLAS, esCarnet, mensajeDeError, tienePalabraDemasiadoLarga, validarNombre } from '../../compartido/validacion';
import { firstValueFrom, retry, timeout } from 'rxjs';
import { AUTH_TOKEN_KEY } from '../../auth/auth.constants';
import { OpcionBuscable, SelectorBuscable } from '../../compartido/selector-buscable';
import { CatalogoService } from '../../servicios/catalogo.service';
import { ProyectosService } from '../../servicios/proyectos.service';

interface AutorFormulario {
  nombres: string;
  apellidos: string;
  carnet: string;
}

interface OpcionCatalogo {
  id: number;
  nombre: string;
}

interface RespuestaEnvio {
  idProyecto: number;
  idEntrega: number;
  estado: string;
  publicado: boolean;
  mensaje: string;
}

/** Datos de la versión observada que se precargan al corregir (RF-20). */
interface SolicitudACorregir {
  id: number;
  puedeReenviar: boolean;
  /** Se puede actualizar (RF-08). */
  puedeActualizar: boolean;
  version: number;
  titulo: string;
  resumen: string;
  anio: number;
  idTipoProyecto: number;
  idDepartamento: number;
  idCarrera: number;
  idTematica: number;
  idMateria: number | null;
  autores: { nombres: string; apellidos: string; carnet: string | null }[];
  palabrasClave: string[];
  asesores: { idDocente: number; nombre: string; autorizado: boolean }[];
  recursos: { id: number; nombre: string; tipo: string; url: string | null }[];
  observaciones: { fecha: string; mensaje: string }[];
}

/** Docente que puede asesorar un trabajo (GET /api/catalogos/docentes). */
interface DocenteCatalogo {
  id: number;
  codigo: string;
  nombres: string;
  apellidos: string;
  idDepartamento: number;
  departamento: string;
}

/** Materia del plan de la carrera elegida (GET /api/catalogos/materias?carreraId=). */
interface MateriaCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  ciclo: number;
}

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];

type DepartamentoCatalogo = OpcionCatalogo;

interface CarreraCatalogo extends OpcionCatalogo {
  departamentoId: number;
}


@Component({
  selector: 'app-envio-proyecto',
  standalone: true,
  imports: [SesionUsuarioComponent, RouterLink, RouterLinkActive, SelectorBuscable],
  templateUrl: './envio-proyecto.html',
  styleUrl: './envio-proyecto.css'
})
export class EnvioProyectoComponent implements OnInit {
  private readonly catalogoApi = inject(CatalogoService);
  private readonly proyectosApi = inject(ProyectosService);
  // La app es zoneless: se repinta con markForCheck().
  private readonly cdr = inject(ChangeDetectorRef);

  autores: AutorFormulario[] = [
    { nombres: '', apellidos: '', carnet: '' }
  ];

  pdfs: File[] = [];
  archivosZip: File[] = [];
  enlaces: string[] = [];
  palabrasClave: string[] = [];
  mensajeError = '';
  mensajeExito = '';
  /** Id del campo con error. */
  campoConError = '';
  tipoProyecto = '';
  enviando = false;
  solicitudEnviada = false;
  readonly esSupervisor = usuarioTieneRol('supervisor');
  readonly reglas = REGLAS;
  readonly anioActual = new Date().getFullYear();
  readonly esGestion = esCuentaDeGestion();

  departamentos: DepartamentoCatalogo[] = [];
  carreras: CarreraCatalogo[] = [];
  tiposProyecto: OpcionCatalogo[] = [];
  tematicas: OpcionCatalogo[] = [];
  /** Solo las materias del plan de la carrera elegida. */
  materias: MateriaCatalogo[] = [];
  cargandoMaterias = false;
  docentes: DocenteCatalogo[] = [];

  /** Ids de los asesores elegidos ('' = sin elegir), hasta 3. */
  asesores: string[] = [''];

  agregarAsesor(): void {
    if (this.asesores.length < 3) {
      this.asesores = [...this.asesores, ''];
    }
  }

  quitarAsesor(indice: number): void {
    this.asesores = this.asesores.length > 1
      ? this.asesores.filter((_, i) => i !== indice)
      : [''];
  }

  elegirTematica(valor: string): void {
    this.tematicaSeleccionada = valor;
    this.limpiarErrorDe('tematica');
  }

  elegirMateria(valor: string): void {
    this.materiaSeleccionada = valor;
    this.limpiarErrorDe('materia');
  }

  elegirAsesor(indice: number, valor: string): void {
    this.asesores = this.asesores.map((actual, i) => (i === indice ? valor : actual));
    this.limpiarMensajes();
  }

  /** Opciones de temáticas para el selector. */
  private cacheTematicas: { origen: OpcionCatalogo[]; opciones: OpcionBuscable[] } | null = null;
  get opcionesTematicas(): OpcionBuscable[] {
    if (this.cacheTematicas?.origen !== this.tematicas) {
      this.cacheTematicas = {
        origen: this.tematicas,
        opciones: this.tematicas.map(tematica => ({ value: String(tematica.id), label: this.formatearNombre(tematica.nombre) }))
      };
    }
    return this.cacheTematicas.opciones;
  }

  /** Opciones de cada fila de asesor; se reutilizan mientras no cambien los datos. */
  private cacheAsesores = new Map<number, { clave: string; opciones: OpcionBuscable[] }>();
  opcionesAsesor(indice: number): OpcionBuscable[] {
    const clave = [this.docentes.length, this.departamentos.length, this.departamentoSeleccionado,
      this.asesores.filter((id, i) => i !== indice && id).join(',')].join('|');
    const guardadas = this.cacheAsesores.get(indice);
    if (guardadas?.clave === clave) return guardadas.opciones;
    const opciones = this.gruposDeAsesores(indice).flatMap(grupo =>
      grupo.docentes.map(docente => ({
        value: String(docente.id),
        label: docente.nombres + ' ' + docente.apellidos,
        detalle: docente.codigo + (grupo.titulo ? '' : ' · ' + docente.departamento.replace(/^departamento de\s+/i, '')),
        grupo: grupo.titulo || undefined
      })));
    this.cacheAsesores.set(indice, { clave, opciones });
    return opciones;
  }

  /** Un docente ya elegido en otra fila no se vuelve a ofrecer. */
  docentesDisponibles(indice: number): DocenteCatalogo[] {
    const elegidos = this.asesores.filter((id, i) => i !== indice && id);
    return this.docentes.filter(docente => !elegidos.includes(String(docente.id)));
  }

  /** Primero los docentes del departamento elegido, luego los demás. */
  gruposDeAsesores(indice: number): { titulo: string; docentes: DocenteCatalogo[] }[] {
    const disponibles = this.docentesDisponibles(indice);
    const idDepartamento = Number(this.departamentoSeleccionado);
    if (!idDepartamento) {
      return [{ titulo: '', docentes: disponibles }];
    }
    const propios = disponibles.filter(docente => docente.idDepartamento === idDepartamento);
    const otros = disponibles.filter(docente => docente.idDepartamento !== idDepartamento);
    const nombre = this.departamentos.find(item => item.id === idDepartamento)?.nombre ?? 'este departamento';
    return [
      { titulo: nombre, docentes: propios },
      { titulo: 'Otros departamentos', docentes: otros }
    ].filter(grupo => grupo.docentes.length > 0);
  }

  /** Asignaturas para el selector con buscador, agrupadas por ciclo. */
  private cacheMaterias: { origen: MateriaCatalogo[]; opciones: OpcionBuscable[] } | null = null;
  get opcionesMaterias(): OpcionBuscable[] {
    if (this.cacheMaterias?.origen !== this.materias) {
      this.cacheMaterias = {
        origen: this.materias,
        opciones: [...this.materias]
          .sort((a, b) => a.ciclo - b.ciclo || a.nombre.localeCompare(b.nombre, 'es'))
          .map(materia => ({
            value: String(materia.id),
            label: materia.nombre,
            detalle: materia.codigo,
            grupo: 'Ciclo ' + (ROMANOS[materia.ciclo] ?? materia.ciclo)
          }))
      };
    }
    return this.cacheMaterias.opciones;
  }

  /** Pide a la API las materias del plan de la carrera. */
  private cargarMaterias(idCarrera: number): void {
    this.materias = [];
    if (!idCarrera) {
      return;
    }
    this.cargandoMaterias = true;
    this.catalogoApi
      .listar<MateriaCatalogo>('/catalogos/materias', { carreraId: idCarrera })
      .subscribe({
        next: datos => {
          this.cargandoMaterias = false;
          this.materias = datos;
          // Si la asignatura elegida no es de esta carrera, se deja sin elegir.
          if (!datos.some(materia => String(materia.id) === this.materiaSeleccionada)) {
            this.materiaSeleccionada = '';
          }
          this.cdr.markForCheck();
        },
        error: () => {
          this.cargandoMaterias = false;
          this.materias = [];
          this.cdr.markForCheck();
        }
      });
  }

  departamentoSeleccionado = '';
  carreraSeleccionada = '';

  // Valores del formulario enlazados para poder precargarlos al corregir.
  titulo = '';
  anio = '';
  resumen = '';
  tematicaSeleccionada = '';
  materiaSeleccionada = '';
  palabrasClaveTexto = '';
  enlacesTexto = '';

  // Corrección (RF-20) o actualización (RF-08).
  private readonly route = inject(ActivatedRoute);
  correccion: SolicitudACorregir | null = null;
  cargandoCorreccion = false;
  errorCorreccion = '';
  conservarRecursos: number[] = [];

  /** Actualiza un trabajo publicado en lugar de corregir. */
  actualizando = false;

  get corrigiendo(): boolean {
    return this.correccion !== null;
  }

  get carrerasFiltradas(): CarreraCatalogo[] {
    const idDepartamento = Number(this.departamentoSeleccionado);

    if (!idDepartamento) {
      return [];
    }

    return this.carreras.filter(
      carrera => carrera.departamentoId === idDepartamento
    );
  }

  get tipoProyectoSeleccionado(): OpcionCatalogo | undefined {
    return this.tiposProyecto.find(tipo => tipo.id === Number(this.tipoProyecto));
  }

  get esProyectoCurso(): boolean {
    return this.tipoProyectoSeleccionado?.nombre.toLowerCase().includes('curso') ?? false;
  }

  formatearNombre(nombre: string): string {
    return nombre.length === 0
      ? nombre
      : nombre.charAt(0).toLocaleUpperCase('es-SV') + nombre.slice(1);
  }

  ngOnInit(): void {
    this.cargarCatalogo<DepartamentoCatalogo>(
      '/catalogos/departamentos',
      'repositorio.catalogos.departamentos',
      datos => this.departamentos = datos,
      'No se pudieron cargar los departamentos.'
    );

    this.cargarCatalogo<CarreraCatalogo>(
      '/catalogos/carreras',
      'repositorio.catalogos.carreras',
      datos => this.carreras = datos,
      'No se pudieron cargar las carreras.'
    );

    this.cargarCatalogo<OpcionCatalogo>(
      '/catalogos/tipos-proyecto',
      'repositorio.catalogos.tipos-proyecto',
      datos => this.tiposProyecto = datos,
      'No se pudieron cargar los tipos de proyecto.'
    );

    this.cargarCatalogo<OpcionCatalogo>(
      '/catalogos/tematicas',
      'repositorio.catalogos.tematicas',
      datos => this.tematicas = datos,
      'No se pudieron cargar las áreas temáticas.'
    );

    this.cargarCatalogo<DocenteCatalogo>(
      '/catalogos/docentes',
      'repositorio.catalogos.docentes',
      datos => this.docentes = datos,
      'No se pudieron cargar los docentes.'
    );

    const corregir = Number(this.route.snapshot.queryParamMap.get('corregir'));
    const actualizar = Number(this.route.snapshot.queryParamMap.get('actualizar'));
    if (actualizar > 0) {
      this.actualizando = true;
      this.cargarCorreccion(actualizar);
    } else if (corregir > 0) {
      this.cargarCorreccion(corregir);
    }
  }

  /** Precarga la versión a corregir o actualizar. */
  private cargarCorreccion(idEntrega: number): void {
    let token: string | null = null;
    try {
      token = globalThis.sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) {
      this.errorCorreccion = 'Tu sesión venció. Inicia sesión de nuevo.';
      return;
    }

    this.cargandoCorreccion = true;
    this.proyectosApi
      .solicitud<SolicitudACorregir>(idEntrega)
      .subscribe({
        next: datos => {
          this.cargandoCorreccion = false;
          if (this.actualizando ? !datos.puedeActualizar : !datos.puedeReenviar) {
            this.errorCorreccion = this.actualizando
              ? 'Este trabajo no se puede actualizar: no está publicado o ya tiene una versión más reciente.'
              : 'Esta solicitud no admite correcciones: el supervisor no las pidió o ya existe una versión más reciente.';
            this.cdr.markForCheck();
            return;
          }

          this.correccion = datos;
          this.titulo = datos.titulo;
          this.resumen = datos.resumen;
          this.anio = String(datos.anio);
          this.tipoProyecto = String(datos.idTipoProyecto);
          this.departamentoSeleccionado = String(datos.idDepartamento);
          this.carreraSeleccionada = String(datos.idCarrera);
          this.tematicaSeleccionada = String(datos.idTematica);
          this.materiaSeleccionada = datos.idMateria ? String(datos.idMateria) : '';
          this.cargarMaterias(datos.idCarrera);
          this.autores = datos.autores.length > 0
            ? datos.autores.map(autor => ({
                nombres: autor.nombres,
                apellidos: autor.apellidos,
                carnet: autor.carnet ?? ''
              }))
            : [{ nombres: '', apellidos: '', carnet: '' }];
          this.palabrasClave = [...datos.palabrasClave];
          this.palabrasClaveTexto = datos.palabrasClave.join('\n');
          this.asesores = (datos.asesores ?? []).length > 0
            ? datos.asesores.map(asesor => String(asesor.idDocente))
            : [''];
          // Por defecto se conservan todos los materiales.
          this.conservarRecursos = datos.recursos.map(recurso => recurso.id);
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargandoCorreccion = false;
          this.errorCorreccion = this.mensajeErrorApi(error);
          this.cdr.markForCheck();
        }
      });
  }

  alternarConservar(idRecurso: number, event: Event): void {
    const marcado = (event.target as HTMLInputElement).checked;
    this.conservarRecursos = marcado
      ? [...this.conservarRecursos, idRecurso]
      : this.conservarRecursos.filter(id => id !== idRecurso);
    this.limpiarMensajes();
  }

  actualizarCampo(
    campo: 'titulo' | 'anio' | 'resumen' | 'tematicaSeleccionada' | 'materiaSeleccionada',
    event: Event
  ): void {
    this[campo] = (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
    this.limpiarErrorDe(campo === 'tematicaSeleccionada' ? 'tematica' : campo === 'materiaSeleccionada' ? 'materia' : campo);
  }

  private cargarCatalogo<T>(
    endpoint: string,
    claveCache: string,
    aplicar: (datos: T[]) => void,
    mensajeError: string
  ): void {
    // Los catálogos siempre vienen de la API; se borra la copia que guardaban versiones viejas.
    try {
      globalThis.sessionStorage.removeItem(claveCache);
    } catch {
      // Sin acceso al almacenamiento no hay copia que borrar.
    }

    this.catalogoApi
      .listar<T>(endpoint)
      .pipe(retry({ count: 2, delay: 500 }))
      .subscribe({
        next: datos => {
          aplicar(datos);
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          console.error('Error al cargar catálogo ' + endpoint + ':', error);
          aplicar([]);
          this.mensajeError = error instanceof HttpErrorResponse && error.status === 0
            ? 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.'
            : mensajeError;
          this.cdr.markForCheck();
        }
      });
  }
  get totalRecursos(): number {
    return this.pdfs.length + this.archivosZip.length + this.enlaces.length +
      this.conservarRecursos.length;
  }

  agregarAutor(): void {
    this.autores.push({ nombres: '', apellidos: '', carnet: '' });
  }

  quitarAutor(indice: number): void {
    if (this.autores.length > 1) {
      this.autores.splice(indice, 1);
    }
  }

  actualizarAutor(
    indice: number,
    campo: keyof AutorFormulario,
    event: Event
  ): void {
    const input = event.target as HTMLInputElement;
    const autor = this.autores[indice];

    if (!autor) {
      return;
    }

    autor[campo] = input.value;
    this.limpiarErrorDe(campo + '-autor-' + indice);
  }

  actualizarDepartamento(event: Event): void {
    this.departamentoSeleccionado =
      (event.target as HTMLSelectElement).value;
    this.carreraSeleccionada = '';
    this.materiaSeleccionada = '';
    this.materias = [];
    this.limpiarMensajes();
  }

  actualizarCarrera(event: Event): void {
    this.carreraSeleccionada =
      (event.target as HTMLSelectElement).value;
    // La asignatura depende de la carrera: se vuelve a elegir.
    this.materiaSeleccionada = '';
    this.cargarMaterias(Number(this.carreraSeleccionada));
    this.limpiarMensajes();
  }

  actualizarTipoProyecto(event: Event): void {
    this.tipoProyecto = (event.target as HTMLSelectElement).value;
    this.limpiarMensajes();
  }

  // RF-17: se admiten varios materiales; cada selección se suma.
  actualizarPdfs(event: Event): void {
    this.pdfs = this.agregarArchivos(event, this.pdfs, '.pdf', 'PDF');
  }

  actualizarZips(event: Event): void {
    this.archivosZip = this.agregarArchivos(event, this.archivosZip, '.zip', 'ZIP');
  }

  quitarPdf(indice: number): void {
    this.pdfs = this.pdfs.filter((_, i) => i !== indice);
    this.limpiarMensajes();
  }

  quitarZip(indice: number): void {
    this.archivosZip = this.archivosZip.filter((_, i) => i !== indice);
    this.limpiarMensajes();
  }

  /** Suma los archivos elegidos sin repetir, hasta el máximo por envío. */
  private agregarArchivos(event: Event, actuales: File[], extension: string, tipo: string): File[] {
    const input = event.target as HTMLInputElement;
    const elegidos = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo archivo
    this.limpiarMensajes();
    if (elegidos.length === 0) return actuales;

    const error = this.revisarArchivos(elegidos, extension, tipo);
    if (error) {
      this.mensajeError = error;
      return actuales;
    }

    const mismo = (a: File, b: File) => a.name === b.name && a.size === b.size;
    const nuevos = elegidos.filter(archivo => !actuales.some(actual => mismo(actual, archivo)));
    const total = this.pdfs.length + this.archivosZip.length + nuevos.length;
    if (total > REGLAS.maximoArchivos) {
      this.mensajeError = `Puedes adjuntar hasta ${REGLAS.maximoArchivos} archivos entre PDF y ZIP.`;
      return actuales;
    }
    return [...actuales, ...nuevos];
  }

  tamanoLegible(bytes: number): string {
    return bytes >= 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /** Revisa extensión, archivos vacíos y tamaño (25 MB). */
  private revisarArchivos(archivos: File[], extension: string, tipo: string): string {
    const incorrecto = archivos.find(archivo => !archivo.name.toLowerCase().endsWith(extension));
    if (incorrecto) return `«${incorrecto.name}» no es un archivo ${tipo}.`;
    const vacio = archivos.find(archivo => archivo.size === 0);
    if (vacio) return `«${vacio.name}» está vacío.`;
    const grande = archivos.find(archivo => archivo.size > REGLAS.maximoArchivoBytes);
    if (grande) return `«${grande.name}» pesa más de 25 MB.`;
    return '';
  }

  /** Valida con las reglas de la API. Devuelve el primer error y su campo. */
  private validarFormulario(): { mensaje: string; campo?: string } | null {
    const titulo = this.titulo.trim();
    if (!titulo) return { mensaje: 'Escribe el título del proyecto.', campo: 'titulo' };
    if (titulo.length < REGLAS.tituloMinimo || titulo.length > REGLAS.tituloMaximo) {
      return { mensaje: `El título debe tener entre ${REGLAS.tituloMinimo} y ${REGLAS.tituloMaximo} caracteres.`, campo: 'titulo' };
    }
    if (tienePalabraDemasiadoLarga(titulo)) {
      return { mensaje: 'El título tiene texto sin espacios demasiado largo. Revisa que esté bien escrito.', campo: 'titulo' };
    }

    for (const [i, autor] of this.autores.entries()) {
      const numero = this.autores.length > 1 ? ' del autor ' + (i + 1) : ' del autor';
      const errorNombres = validarNombre(autor.nombres, 'los nombres' + numero);
      if (errorNombres) return { mensaje: errorNombres, campo: 'nombres-autor-' + i };
      const errorApellidos = validarNombre(autor.apellidos, 'los apellidos' + numero);
      if (errorApellidos) return { mensaje: errorApellidos, campo: 'apellidos-autor-' + i };
      if (autor.carnet.trim() && !esCarnet(autor.carnet)) {
        return { mensaje: 'El carnet lleva dos letras y cinco números, por ejemplo AB12345.', campo: 'carnet-autor-' + i };
      }
    }
    const nombres = this.autores.map(autor => (autor.nombres.trim() + ' ' + autor.apellidos.trim()).toLowerCase());
    if (new Set(nombres).size !== nombres.length) return { mensaje: 'Hay un autor repetido.' };
    const carnets = this.autores.map(autor => autor.carnet.trim().toUpperCase()).filter(Boolean);
    if (new Set(carnets).size !== carnets.length) return { mensaje: 'No repitas el carnet de un autor.' };

    const anio = Number(this.anio);
    if (!this.anio.trim() || !Number.isInteger(anio)) return { mensaje: 'Escribe el año del trabajo.', campo: 'anio' };
    if (anio < REGLAS.anioMinimo || anio > this.anioActual) {
      return { mensaje: `El año debe estar entre ${REGLAS.anioMinimo} y ${this.anioActual}.`, campo: 'anio' };
    }

    if (!this.tipoProyecto) return { mensaje: 'Selecciona el tipo de trabajo.', campo: 'tipoProyecto' };
    if (!this.departamentoSeleccionado) return { mensaje: 'Selecciona el departamento.', campo: 'departamento' };
    if (!this.carreraSeleccionada) return { mensaje: 'Selecciona la carrera.', campo: 'carrera' };
    if (!this.tematicaSeleccionada) return { mensaje: 'Selecciona el área temática.', campo: 'tematica' };
    if (this.esProyectoCurso && this.materias.length > 0 && !this.materiaSeleccionada) {
      return { mensaje: 'Selecciona la asignatura del proyecto de curso.', campo: 'materia' };
    }

    const resumen = this.resumen.trim();
    if (!resumen) return { mensaje: 'Escribe el resumen del proyecto.', campo: 'resumen' };
    if (resumen.length < REGLAS.resumenMinimo || resumen.length > REGLAS.resumenMaximo) {
      return { mensaje: `El resumen debe tener entre ${REGLAS.resumenMinimo} y ${REGLAS.resumenMaximo} caracteres (ahora tiene ${resumen.length}).`, campo: 'resumen' };
    }
    if (tienePalabraDemasiadoLarga(resumen)) {
      return { mensaje: 'El resumen tiene texto sin espacios demasiado largo. Revisa que esté bien escrito.', campo: 'resumen' };
    }

    const palabras = [...new Set(this.palabrasClave.map(palabra => palabra.toLowerCase()))];
    if (palabras.length > REGLAS.maximoPalabrasClave) {
      return { mensaje: `Agrega hasta ${REGLAS.maximoPalabrasClave} palabras clave.`, campo: 'palabrasClave' };
    }
    if (palabras.some(palabra => palabra.length < 2 || palabra.length > 60 || tienePalabraDemasiadoLarga(palabra))) {
      return { mensaje: 'Cada palabra clave debe tener entre 2 y 60 caracteres.', campo: 'palabrasClave' };
    }

    if (this.totalRecursos === 0) return { mensaje: 'Agrega al menos un PDF, un enlace o un archivo ZIP.', campo: 'pdfs' };
    const errorArchivos = this.revisarArchivos(this.pdfs, '.pdf', 'PDF') || this.revisarArchivos(this.archivosZip, '.zip', 'ZIP');
    if (errorArchivos) return { mensaje: errorArchivos };
    const archivos = [...this.pdfs, ...this.archivosZip];
    if (archivos.length > REGLAS.maximoArchivos) return { mensaje: `Adjunta hasta ${REGLAS.maximoArchivos} archivos.` };
    if (archivos.reduce((suma, archivo) => suma + archivo.size, 0) > REGLAS.maximoSolicitudBytes) {
      return { mensaje: 'Los archivos suman más de 80 MB.' };
    }
    if (this.enlaces.length > REGLAS.maximoEnlaces) return { mensaje: `Agrega hasta ${REGLAS.maximoEnlaces} enlaces.`, campo: 'enlaces' };
    if (!this.enlacesValidos()) return { mensaje: 'Revisa los enlaces. Deben comenzar con http:// o https://.', campo: 'enlaces' };

    const nombreTipo = this.tipoProyectoSeleccionado?.nombre.toLowerCase() ?? '';
    const requierePdf = nombreTipo.includes('tesis') || nombreTipo.includes('graduación');
    const conservaPdf = (this.correccion?.recursos ?? []).some(
      recurso => recurso.tipo === 'pdf' && this.conservarRecursos.includes(recurso.id)
    );
    if (requierePdf && !conservaPdf && this.pdfs.length === 0) {
      return { mensaje: 'Para tesis y trabajos de graduación debes adjuntar el PDF completo.', campo: 'pdfs' };
    }
    return null;
  }

  actualizarEnlaces(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;

    this.enlaces = textarea.value
      .split('\n')
      .map(enlace => enlace.trim())
      .filter(enlace => enlace.length > 0);

    this.limpiarMensajes();
  }

  actualizarPalabrasClave(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;

    this.palabrasClave = textarea.value
      .split('\n')
      .map(palabra => palabra.trim())
      .filter(palabra => palabra.length > 0);
    this.limpiarErrorDe('palabrasClave');
  }

  private limpiarMensajes(): void {
    this.mensajeError = '';
    this.mensajeExito = '';
    this.campoConError = '';
  }

  /** Al escribir en el campo marcado se quita su aviso. */
  private limpiarErrorDe(campo: string): void {
    if (this.campoConError === campo) {
      this.limpiarMensajes();
    }
  }

  private enlacesValidos(): boolean {
    return this.enlaces.every(enlace => {
      try {
        const url = new URL(enlace);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    });
  }

  async enviarSolicitud(event: Event): Promise<void> {
    event.preventDefault();

    if (this.enviando || this.solicitudEnviada) {
      return;
    }

    const formulario = event.target as HTMLFormElement;

    const problema = this.validarFormulario();
    if (problema) {
      this.mensajeError = problema.mensaje;
      this.mensajeExito = '';
      this.campoConError = problema.campo ?? '';
      if (problema.campo) {
        const campo = formulario.querySelector<HTMLElement>('#' + problema.campo);
        campo?.focus();
        campo?.scrollIntoView({ block: 'center' });
      }
      return;
    }

    let token: string | null = null;
    try {
      token = globalThis.sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      this.mensajeError = 'No se pudo leer la sesión. Inicia sesión de nuevo.';
      return;
    }

    if (!token) {
      this.mensajeError = 'Tu sesión venció. Inicia sesión para enviar el proyecto.';
      return;
    }

    const datos = new FormData();
    datos.append('Titulo', this.titulo.trim());
    datos.append('Resumen', this.resumen.trim());
    datos.append('Anio', this.anio.trim());
    datos.append('IdTipoProyecto', this.tipoProyecto);
    datos.append('IdCarrera', this.carreraSeleccionada);
    datos.append('IdTematica', this.tematicaSeleccionada);
    datos.append('AutoresJson', JSON.stringify(this.autores.map(autor => ({
      nombres: autor.nombres.trim(),
      apellidos: autor.apellidos.trim(),
      carnet: autor.carnet.trim().toUpperCase()
    }))));
    this.asesores
      .filter(id => id)
      .forEach(id => datos.append('IdDocentesAsesores', id));

    // Solo el proyecto de curso lleva asignatura.
    const materia = this.esProyectoCurso ? this.materiaSeleccionada : '';
    if (materia) {
      datos.append('IdMateria', materia);
    }

    this.palabrasClave.forEach(palabra =>
      datos.append('PalabrasClave', palabra)
    );
    this.enlaces.forEach(enlace =>
      datos.append('Enlaces', enlace)
    );
    this.pdfs.forEach(archivo =>
      datos.append('Pdfs', archivo, archivo.name)
    );
    this.archivosZip.forEach(archivo =>
      datos.append('ArchivosZip', archivo, archivo.name)
    );
    this.conservarRecursos.forEach(id =>
      datos.append('ConservarRecursos', String(id))
    );

    this.enviando = true;
    this.limpiarMensajes();

    // Corrección y actualización se envían como otra entrega del proyecto.
    const ruta = this.correccion
      ? '/proyectos/mis-proyectos/' + this.correccion.id + (this.actualizando ? '/actualizacion' : '/reenvio')
      : '/proyectos';

    try {
      const respuesta = await firstValueFrom(
        this.proyectosApi.enviar<RespuestaEnvio>(ruta, datos).pipe(timeout(180000))
      );

      this.mensajeExito = respuesta.mensaje;
      this.solicitudEnviada = true;
    } catch (error: unknown) {
      this.mensajeError = error instanceof HttpErrorResponse && error.status === 403 && !error.error?.mensaje
        ? 'Tu cuenta no tiene permiso para enviar proyectos.'
        : mensajeDeError(error, 'No se pudo guardar el envío. Revisa los datos e inténtalo de nuevo.');
    } finally {
      this.enviando = false;
      this.cdr.markForCheck();
    }
  }

  private mensajeErrorApi(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const mensajeApi =
        error.error && typeof error.error.mensaje === 'string'
          ? error.error.mensaje
          : null;

      if (mensajeApi) {
        return mensajeApi;
      }

      if (error.status === 0) {
        return 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.';
      }

      if (error.status === 401) {
        return 'Tu sesión venció. Inicia sesión de nuevo.';
      }

      if (error.status === 403) {
        return 'Tu cuenta no tiene permiso para enviar proyectos.';
      }
    }

    return 'No se pudo guardar el envío. Revisa los datos e inténtalo de nuevo.';
  }
}
