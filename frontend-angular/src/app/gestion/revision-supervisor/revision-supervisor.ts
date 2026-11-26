import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Observable } from 'rxjs';
import { AUTH_TOKEN_KEY } from '../../auth/auth.constants';
import { tienePalabraDemasiadoLarga } from '../../compartido/validacion';
import { RevisionService } from '../../servicios/revision.service';
import { ProyectosService } from '../../servicios/proyectos.service';


interface RecursoRevision {
  id: number;
  nombre: string;
  tipo: string;
  url: string | null;
  autorizado: boolean;
}

/** Asesor y si autorizó mostrar su nombre. */
interface AsesorRevision {
  idDocente: number;
  nombre: string;
  autorizado: boolean;
}

interface EntregaRevision {
  id: number;
  idProyecto: number;
  /** RF-19: un supervisor ya empezó a revisarla. */
  enRevision: boolean;
  revisadaPor: string | null;
  titulo: string;
  tipoTrabajo: string;
  anio: number;
  departamento: string;
  carrera: string;
  tematica: string;
  resumen: string;
  palabrasClave: string[];
  fechaEnvio: string;
  version: number;
  /** Actualiza un trabajo publicado (RF-08). */
  esActualizacion?: boolean;
  solicitante: string;
  autores: string[];
  asesores: AsesorRevision[];
  recursos: RecursoRevision[];
}

/** Permiso de difusión (RF-10). */
type Permiso = 'pendiente' | 'solo_ficha' | 'ficha_y_materiales' | 'no_autorizado';

interface Publicacion {
  idProyecto: number;
  idEntrega: number;
  titulo: string;
  tipoTrabajo: string;
  anio: number;
  carrera: string;
  autores: string[];
  fechaAprobacion: string;
  revisor: string | null;
  permiso: Permiso;
  estadoPublicacion: 'publicado' | 'no_publicado' | 'retirado';
  destacado: boolean;
  motivoRetiro: string | null;
  fechaRetiro: string | null;
  asesores: AsesorRevision[];
  recursos: RecursoRevision[];
}

type DecisionRevision = 'Aprobada' | 'Con correcciones' | 'Rechazada';
type FiltroPublicacion = '' | 'publicado' | 'no_publicado' | 'retirado' | 'destacado';
type ModoFecha = 'todas' | 'hoy' | 'dia' | 'semana' | 'rango';

/** Fecha local como 'AAAA-MM-DD'. */
function claveDia(fecha: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate());
}

/** Semana ISO de una fecha como 'AAAA-Www', el formato del input type="week". */
function semanaDe(fecha: Date): string {
  const jueves = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 3 - ((fecha.getDay() + 6) % 7));
  const primeraSemana = new Date(jueves.getFullYear(), 0, 4);
  const numero = 1 + Math.round(((jueves.getTime() - primeraSemana.getTime()) / 86400000 - 3 + ((primeraSemana.getDay() + 6) % 7)) / 7);
  return jueves.getFullYear() + '-W' + String(numero).padStart(2, '0');
}

/** Lunes y domingo de una semana ISO escrita como 'AAAA-Www' (input type="week"). */
function rangoSemana(semana: string): [string, string] | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(semana);
  if (!m) return null;
  const anio = Number(m[1]), numero = Number(m[2]);
  // El 4 de enero siempre cae en la semana 1 (norma ISO 8601).
  const cuatroEnero = new Date(anio, 0, 4);
  const lunes = new Date(anio, 0, 4 - ((cuatroEnero.getDay() + 6) % 7) + (numero - 1) * 7);
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  return [claveDia(lunes), claveDia(domingo)];
}

/** Minúsculas y sin tildes. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}
type Pestana = 'pendientes' | 'publicaciones';
type FiltroPendiente = '' | 'nuevas' | 'reenvios' | 'actualizaciones';

/** Borrador del permiso que se edita en una tarjeta antes de guardarlo. */
interface BorradorPermiso {
  permiso: Permiso;
  recursos: number[];
  /** Asesores autorizados. */
  asesores: number[];
}

@Component({
  selector: 'app-revision-supervisor',
  standalone: true,
  imports: [SesionUsuarioComponent, DatePipe, RouterLink, RouterLinkActive],
  templateUrl: './revision-supervisor.html',
  styleUrls: [
    '../../publicaciones/seguimiento/seguimiento.css',
    './revision-supervisor.css'
  ]
})
export class RevisionSupervisorComponent implements OnInit {
  private readonly revisionApi = inject(RevisionService);
  private readonly proyectosApi = inject(ProyectosService);
  // La app es zoneless: se repinta con markForCheck().
  private readonly cdr = inject(ChangeDetectorRef);

  readonly opcionesPermiso: { valor: Permiso; texto: string; ayuda: string }[] = [
    { valor: 'pendiente', texto: 'Permiso pendiente', ayuda: 'Se aprueba, pero no se publica hasta registrar el permiso.' },
    { valor: 'solo_ficha', texto: 'Solo la ficha', ayuda: 'Se publican los datos; los materiales quedan reservados.' },
    { valor: 'ficha_y_materiales', texto: 'Ficha y materiales seleccionados', ayuda: 'Se publican los datos y los materiales marcados.' },
    { valor: 'no_autorizado', texto: 'No autorizan la difusión', ayuda: 'Queda aprobado, pero no se publica.' }
  ];

  pestana: Pestana = 'pendientes';

  // Pendientes por páginas
  paginaPendientes = 1;
  readonly porPaginaPendientes = 6;

  // Búsqueda y filtros de pendientes
  busquedaPendiente = '';
  filtroPendiente: FiltroPendiente = '';
  departamentoPendiente = '';
  readonly filtrosPendiente: { valor: FiltroPendiente; texto: string }[] = [
    { valor: '', texto: 'Todas' },
    { valor: 'nuevas', texto: 'Envíos nuevos' },
    { valor: 'reenvios', texto: 'Versiones corregidas' },
    { valor: 'actualizaciones', texto: 'Actualizaciones' }
  ];

  get departamentosPendientes(): string[] {
    return [...new Set(this.entregas.map(entrega => entrega.departamento))].sort((a, b) => a.localeCompare(b, 'es'));
  }

  private cumpleFiltroPendiente(entrega: EntregaRevision, filtro: FiltroPendiente): boolean {
    if (filtro === 'actualizaciones') return !!entrega.esActualizacion;
    if (filtro === 'reenvios') return !entrega.esActualizacion && entrega.version > 1;
    if (filtro === 'nuevas') return !entrega.esActualizacion && entrega.version === 1;
    return true;
  }

  cuentaPendientes(filtro: FiltroPendiente): number {
    return this.entregas.filter(entrega => this.cumpleFiltroPendiente(entrega, filtro)).length;
  }

  get pendientesFiltradas(): EntregaRevision[] {
    const terminos = normalizar(this.busquedaPendiente.trim()).split(/\s+/).filter(Boolean);
    return this.entregas.filter(entrega => {
      if (!this.cumpleFiltroPendiente(entrega, this.filtroPendiente)) return false;
      if (this.departamentoPendiente && entrega.departamento !== this.departamentoPendiente) return false;
      if (!terminos.length) return true;
      const texto = normalizar([entrega.titulo, entrega.solicitante, entrega.carrera, entrega.departamento, entrega.tematica,
        entrega.tipoTrabajo, String(entrega.anio), ...entrega.autores, ...entrega.palabrasClave].join(' '));
      return terminos.every(termino => texto.includes(termino));
    });
  }

  get hayFiltroPendiente(): boolean {
    return !!(this.busquedaPendiente.trim() || this.filtroPendiente || this.departamentoPendiente);
  }

  buscarPendiente(event: Event): void {
    this.busquedaPendiente = (event.target as HTMLInputElement).value;
    this.paginaPendientes = 1;
  }

  elegirFiltroPendiente(filtro: FiltroPendiente): void {
    this.filtroPendiente = filtro;
    this.paginaPendientes = 1;
  }

  elegirDepartamentoPendiente(event: Event): void {
    this.departamentoPendiente = (event.target as HTMLSelectElement).value;
    this.paginaPendientes = 1;
  }

  quitarFiltrosPendientes(): void {
    this.busquedaPendiente = '';
    this.filtroPendiente = '';
    this.departamentoPendiente = '';
    this.paginaPendientes = 1;
  }

  /** Posición en la fila por orden de llegada, aunque haya filtros. */
  posicionEnFila(entrega: EntregaRevision): number {
    return this.entregas.indexOf(entrega) + 1;
  }

  get totalPaginasPendientes(): number {
    return Math.max(1, Math.ceil(this.pendientesFiltradas.length / this.porPaginaPendientes));
  }

  /** Índice donde empieza la página actual. */
  get inicioPendientes(): number {
    return (Math.min(this.paginaPendientes, this.totalPaginasPendientes) - 1) * this.porPaginaPendientes;
  }

  get entregasPagina(): EntregaRevision[] {
    return this.pendientesFiltradas.slice(this.inicioPendientes, this.inicioPendientes + this.porPaginaPendientes);
  }

  irAPaginaPendientes(pagina: number): void {
    this.paginaPendientes = Math.min(Math.max(1, pagina), this.totalPaginasPendientes);
    document.querySelector('.lista-revision')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Aprobadas y publicaciones: búsqueda, filtros y páginas.
  busquedaPublicacion = '';
  filtroPublicacion: FiltroPublicacion = '';
  paginaPublicaciones = 1;
  readonly porPaginaPublicaciones = 10;
  abiertaId: number | null = null;
  readonly filtrosPublicacion: { valor: FiltroPublicacion; texto: string }[] = [
    { valor: '', texto: 'Todas' },
    { valor: 'publicado', texto: 'Publicadas' },
    { valor: 'no_publicado', texto: 'Sin publicar' },
    { valor: 'retirado', texto: 'Retiradas' },
    { valor: 'destacado', texto: 'Destacadas' }
  ];

  // Filtro por fecha de aprobación.
  modoFecha: ModoFecha = 'todas';
  fechaDia = '';
  fechaSemana = '';
  fechaDesde = '';
  fechaHasta = '';
  readonly modosFecha: { valor: ModoFecha; texto: string }[] = [
    { valor: 'todas', texto: 'Todas' },
    { valor: 'hoy', texto: 'Hoy' },
    { valor: 'dia', texto: 'Día' },
    { valor: 'semana', texto: 'Semana' },
    { valor: 'rango', texto: 'Rango' }
  ];

  get hoy(): string {
    return claveDia(new Date());
  }

  elegirModoFecha(modo: ModoFecha): void {
    this.modoFecha = modo;
    // Día y semana empiezan en la fecha actual.
    if (modo === 'dia' && !this.fechaDia) this.fechaDia = this.hoy;
    if (modo === 'semana' && !this.fechaSemana) this.fechaSemana = semanaDe(new Date());
    if (modo === 'todas') this.fechaDia = this.fechaSemana = this.fechaDesde = this.fechaHasta = '';
    this.paginaPublicaciones = 1;
  }

  cambiarFecha(campo: 'fechaDia' | 'fechaSemana' | 'fechaDesde' | 'fechaHasta', event: Event): void {
    this[campo] = (event.target as HTMLInputElement).value;
    this.paginaPublicaciones = 1;
  }

  private cumpleFecha(publicacion: Publicacion): boolean {
    const fecha = this.fechaLocal(publicacion.fechaAprobacion);
    if (this.modoFecha === 'todas' || !fecha) return true;
    const dia = claveDia(fecha);
    if (this.modoFecha === 'hoy') return dia === this.hoy;
    if (this.modoFecha === 'dia') return !this.fechaDia || dia === this.fechaDia;
    if (this.modoFecha === 'semana') {
      const rango = rangoSemana(this.fechaSemana);
      return !rango || (dia >= rango[0] && dia <= rango[1]);
    }
    return (!this.fechaDesde || dia >= this.fechaDesde) && (!this.fechaHasta || dia <= this.fechaHasta);
  }

  /** Publicaciones dentro del filtro de fecha. */
  private get publicacionesEnFecha(): Publicacion[] {
    return this.publicaciones.filter(publicacion => this.cumpleFecha(publicacion));
  }

  cuentaFiltro(filtro: FiltroPublicacion): number {
    return this.publicacionesEnFecha.filter(publicacion => this.cumpleFiltro(publicacion, filtro)).length;
  }

  private cumpleFiltro(publicacion: Publicacion, filtro: FiltroPublicacion): boolean {
    return filtro === '' ||
      (filtro === 'destacado' ? publicacion.destacado : publicacion.estadoPublicacion === filtro);
  }

  get publicacionesFiltradas(): Publicacion[] {
    const terminos = normalizar(this.busquedaPublicacion.trim()).split(/\s+/).filter(Boolean);
    return this.publicacionesEnFecha.filter(publicacion => {
      if (!this.cumpleFiltro(publicacion, this.filtroPublicacion)) return false;
      if (!terminos.length) return true;
      const texto = normalizar([publicacion.titulo, publicacion.carrera, publicacion.tipoTrabajo,
        String(publicacion.anio), ...publicacion.autores].join(' '));
      return terminos.every(termino => texto.includes(termino));
    });
  }

  get totalPaginasPublicaciones(): number {
    return Math.max(1, Math.ceil(this.publicacionesFiltradas.length / this.porPaginaPublicaciones));
  }

  get publicacionesPagina(): Publicacion[] {
    const pagina = Math.min(this.paginaPublicaciones, this.totalPaginasPublicaciones);
    const inicio = (pagina - 1) * this.porPaginaPublicaciones;
    return this.publicacionesFiltradas.slice(inicio, inicio + this.porPaginaPublicaciones);
  }

  buscarPublicacion(event: Event): void {
    this.busquedaPublicacion = (event.target as HTMLInputElement).value;
    this.paginaPublicaciones = 1;
  }

  elegirFiltroPublicacion(filtro: FiltroPublicacion): void {
    this.filtroPublicacion = filtro;
    this.paginaPublicaciones = 1;
  }

  irAPaginaPublicaciones(pagina: number): void {
    this.paginaPublicaciones = Math.min(Math.max(1, pagina), this.totalPaginasPublicaciones);
    this.abiertaId = null;
  }

  alternarAbierta(idProyecto: number): void {
    this.abiertaId = this.abiertaId === idProyecto ? null : idProyecto;
  }

  entregas: EntregaRevision[] = [];
  publicaciones: Publicacion[] = [];
  cargando = true;
  cargandoPublicaciones = false;
  publicacionesCargadas = false;

  observaciones: Record<number, string> = {};
  permisosDecision: Record<number, BorradorPermiso> = {};
  permisosPublicacion: Record<number, BorradorPermiso> = {};
  motivosRetiro: Record<number, string> = {};
  retirandoId: number | null = null;

  ocupadoId: number | null = null;
  /** Tarjeta que muestra el último error. */
  errorEntregaId: number | null = null;
  mensaje = '';
  mensajeError = '';

  ngOnInit(): void {
    this.cargarPendientes();
  }

  // ----- Utilidades de presentación -----

  formatearNombre(nombre: string): string {
    return nombre.length === 0
      ? nombre
      : nombre.charAt(0).toLocaleUpperCase('es-SV') + nombre.slice(1);
  }

  /** Las fechas llegan en UTC sin zona. */
  fechaLocal(fecha: string | null): Date | null {
    if (!fecha) {
      return null;
    }
    const tieneZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(fecha);
    return new Date(tieneZona ? fecha : fecha + 'Z');
  }

  textoPermiso(permiso: Permiso): string {
    return this.opcionesPermiso.find(opcion => opcion.valor === permiso)?.texto ?? permiso;
  }

  textoPublicacion(estado: Publicacion['estadoPublicacion']): string {
    return estado === 'publicado'
      ? 'Publicado'
      : estado === 'retirado'
        ? 'Retirado'
        : 'Sin publicar';
  }

  cambiarPestana(pestana: Pestana): void {
    this.pestana = pestana;
    this.limpiarMensajes();
    if (pestana === 'publicaciones' && !this.publicacionesCargadas) {
      this.cargarPublicaciones();
    }
  }

  // ----- Pendientes (RF-18, RF-21) -----

  borradorDecision(entrega: EntregaRevision): BorradorPermiso {
    return this.permisosDecision[entrega.id] ??= { permiso: 'pendiente', recursos: [], asesores: [] };
  }

  actualizarObservacion(id: number, event: Event): void {
    this.observaciones[id] = (event.target as HTMLTextAreaElement).value;
    this.mensajeError = '';
  }

  elegirPermiso(borrador: BorradorPermiso, permiso: Permiso): void {
    borrador.permiso = permiso;
    if (permiso !== 'ficha_y_materiales') {
      borrador.recursos = [];
    }
    this.mensajeError = '';
  }

  nombresAsesores(asesores: AsesorRevision[]): string {
    return asesores.map(asesor => asesor.nombre).join(', ');
  }

  alternarAsesor(borrador: BorradorPermiso, idDocente: number, event: Event): void {
    const marcado = (event.target as HTMLInputElement).checked;
    borrador.asesores = marcado
      ? [...borrador.asesores, idDocente]
      : borrador.asesores.filter(id => id !== idDocente);
  }

  alternarRecurso(borrador: BorradorPermiso, idRecurso: number, event: Event): void {
    const marcado = (event.target as HTMLInputElement).checked;
    borrador.recursos = marcado
      ? [...borrador.recursos, idRecurso]
      : borrador.recursos.filter(id => id !== idRecurso);
  }

  /** Marca la entrega como "en revisión"; el solicitante lo ve en Mis proyectos. */
  iniciarRevision(entrega: EntregaRevision): void {
    this.ejecutar(
      entrega.id,
      this.revisionApi.iniciar(entrega.id),
      () => {
        entrega.enRevision = true;
        entrega.revisadaPor = 'tú';
      },
      error => {
        this.errorEntregaId = entrega.id;
        // Otro supervisor ya la tomó o la decidió: se recarga la fila.
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.cargarPendientes();
        }
      }
    );
  }

  decidir(entrega: EntregaRevision, decision: DecisionRevision): void {
    const observacion = (this.observaciones[entrega.id] ?? '').trim();
    const borrador = this.borradorDecision(entrega);
    this.errorEntregaId = entrega.id;

    if (decision === 'Rechazada' && observacion.length === 0) {
      this.mensajeError = 'Escribe el motivo del rechazo.';
      return;
    }

    if (decision === 'Con correcciones' && observacion.length === 0) {
      this.mensajeError = 'Describe las correcciones que debe hacer el solicitante.';
      return;
    }

    if (decision !== 'Aprobada' && (observacion.length < 10 || tienePalabraDemasiadoLarga(observacion))) {
      this.mensajeError = 'Explica la decisión con al menos 10 caracteres.';
      return;
    }

    if (decision === 'Aprobada' &&
        borrador.permiso === 'ficha_y_materiales' &&
        borrador.recursos.length === 0) {
      this.mensajeError = 'Marca al menos un material autorizado o elige «Solo la ficha».';
      return;
    }

    const cuerpo = {
      decision,
      observacion,
      permiso: decision === 'Aprobada' ? borrador.permiso : null,
      recursosAutorizados: decision === 'Aprobada' ? borrador.recursos : [],
      asesoresAutorizados: decision === 'Aprobada' ? borrador.asesores : []
    };

    this.ejecutar(
      entrega.id,
      this.revisionApi.decidir(entrega.id, cuerpo),
      respuesta => {
        this.mensaje = respuesta.mensaje;
        this.entregas = this.entregas.filter(item => item.id !== entrega.id);
        this.paginaPendientes = Math.min(this.paginaPendientes, this.totalPaginasPendientes);
        delete this.observaciones[entrega.id];
        delete this.permisosDecision[entrega.id];
        // La lista de publicaciones cambia al aprobar.
        this.publicacionesCargadas = false;
      },
      error => {
        // Otro supervisor ya decidió: se recarga.
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.cargarPendientes();
        }
      }
    );
  }

  // ----- Publicaciones (RF-07, RF-09, RF-10, RF-12) -----

  borradorPublicacion(publicacion: Publicacion): BorradorPermiso {
    return this.permisosPublicacion[publicacion.idProyecto] ??= {
      permiso: publicacion.permiso,
      recursos: publicacion.recursos.filter(recurso => recurso.autorizado).map(recurso => recurso.id),
      asesores: publicacion.asesores.filter(asesor => asesor.autorizado).map(asesor => asesor.idDocente)
    };
  }

  permisoCambio(publicacion: Publicacion): boolean {
    const borrador = this.borradorPublicacion(publicacion);
    const actuales = publicacion.recursos
      .filter(recurso => recurso.autorizado)
      .map(recurso => recurso.id)
      .sort((a, b) => a - b)
      .join(',');
    const asesoresActuales = publicacion.asesores
      .filter(asesor => asesor.autorizado)
      .map(asesor => asesor.idDocente)
      .sort((a, b) => a - b)
      .join(',');
    return borrador.permiso !== publicacion.permiso ||
      [...borrador.recursos].sort((a, b) => a - b).join(',') !== actuales ||
      [...borrador.asesores].sort((a, b) => a - b).join(',') !== asesoresActuales;
  }

  guardarPermiso(publicacion: Publicacion): void {
    const borrador = this.borradorPublicacion(publicacion);
    if (borrador.permiso === 'ficha_y_materiales' && borrador.recursos.length === 0) {
      this.mensajeError = 'Marca al menos un material autorizado o elige «Solo la ficha».';
      return;
    }

    this.ejecutar(
      publicacion.idProyecto,
      this.revisionApi.guardarPermiso(
        publicacion.idProyecto,
        { permiso: borrador.permiso, recursosAutorizados: borrador.recursos, asesoresAutorizados: borrador.asesores }
      ),
      respuesta => {
        this.mensaje = respuesta.mensaje;
        this.cargarPublicaciones();
      }
    );
  }

  alternarDestacado(publicacion: Publicacion): void {
    this.ejecutar(
      publicacion.idProyecto,
      this.revisionApi.cambiarDestacado(publicacion.idProyecto, !publicacion.destacado),
      respuesta => {
        this.mensaje = respuesta.mensaje;
        publicacion.destacado = respuesta.destacado;
      }
    );
  }

  iniciarRetiro(publicacion: Publicacion): void {
    this.retirandoId = publicacion.idProyecto;
    this.motivosRetiro[publicacion.idProyecto] ??= '';
    this.limpiarMensajes();
  }

  cancelarRetiro(): void {
    this.retirandoId = null;
  }

  actualizarMotivo(idProyecto: number, event: Event): void {
    this.motivosRetiro[idProyecto] = (event.target as HTMLTextAreaElement).value;
    this.mensajeError = '';
  }

  confirmarRetiro(publicacion: Publicacion): void {
    const motivo = (this.motivosRetiro[publicacion.idProyecto] ?? '').trim();
    if (motivo.length === 0) {
      this.mensajeError = 'Escribe el motivo del retiro. Sin motivo no se confirma.';
      return;
    }
    if (motivo.length < 10 || tienePalabraDemasiadoLarga(motivo)) {
      this.mensajeError = 'Explica el motivo del retiro con al menos 10 caracteres.';
      return;
    }

    this.ejecutar(
      publicacion.idProyecto,
      this.revisionApi.retirar(publicacion.idProyecto, motivo),
      respuesta => {
        this.mensaje = respuesta.mensaje;
        this.retirandoId = null;
        delete this.motivosRetiro[publicacion.idProyecto];
        this.cargarPublicaciones();
      }
    );
  }

  // ----- Materiales -----

  abrirRecurso(recurso: RecursoRevision): void {
    if (recurso.url) {
      globalThis.open(recurso.url, '_blank', 'noopener,noreferrer');
      return;
    }

    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      return;
    }

    this.proyectosApi
      .descargarRecurso(recurso.id)
      .subscribe({
        next: archivo => {
          const url = URL.createObjectURL(archivo);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = recurso.nombre;
          enlace.click();
          URL.revokeObjectURL(url);
        },
        error: (error: unknown) => {
          this.mensajeError = this.mensajeErrorApi(error);
          this.cdr.markForCheck();
        }
      });
  }

  // ----- Carga de datos -----

  private cargarPendientes(): void {
    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      this.cargando = false;
      return;
    }

    this.cargando = true;
    this.revisionApi
      .pendientes<EntregaRevision>()
      .subscribe({
        next: datos => {
          this.entregas = datos;
          this.cargando = false;
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargando = false;
          this.mensajeError = this.mensajeErrorApi(error);
          this.cdr.markForCheck();
        }
      });
  }

  private cargarPublicaciones(): void {
    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      return;
    }

    this.cargandoPublicaciones = true;
    this.revisionApi
      .publicaciones<Publicacion>()
      .subscribe({
        next: datos => {
          this.publicaciones = datos;
          // Los borradores se recalculan con los datos guardados.
          this.permisosPublicacion = {};
          this.cargandoPublicaciones = false;
          this.publicacionesCargadas = true;
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargandoPublicaciones = false;
          this.mensajeError = this.mensajeErrorApi(error);
          this.cdr.markForCheck();
        }
      });
  }

  /** Ejecuta una acción y bloquea la tarjeta mientras responde. */
  private ejecutar<T>(
    id: number,
    peticion$: Observable<T>,
    alTerminar: (respuesta: T) => void,
    alFallar?: (error: unknown) => void
  ): void {
    this.ocupadoId = id;
    this.limpiarMensajes();

    peticion$.subscribe({
      next: respuesta => {
        this.ocupadoId = null;
        alTerminar(respuesta);
        this.cdr.markForCheck();
      },
      error: (error: unknown) => {
        this.ocupadoId = null;
        this.mensajeError = this.mensajeErrorApi(error);
        alFallar?.(error);
        this.cdr.markForCheck();
      }
    });
  }

  private cabeceras(): Record<string, string> | null {
    try {
      const token = globalThis.sessionStorage.getItem(AUTH_TOKEN_KEY);
      if (token) {
        return { Authorization: 'Bearer ' + token };
      }
    } catch {
      // Sin acceso al almacenamiento no hay sesión.
    }

    this.mensajeError = 'Tu sesión venció. Inicia sesión de nuevo.';
    return null;
  }

  private limpiarMensajes(): void {
    this.mensaje = '';
    this.mensajeError = '';
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
        return 'Tu cuenta no tiene el rol de supervisor.';
      }
    }

    return 'No se pudo completar la acción. Inténtalo de nuevo.';
  }
}
