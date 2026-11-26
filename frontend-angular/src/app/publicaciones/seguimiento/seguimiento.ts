import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { esCuentaDeGestion, usuarioTieneRol } from '../../auth/auth.guard';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AUTH_TOKEN_KEY } from '../../auth/auth.constants';
import { ProyectosService } from '../../servicios/proyectos.service';


export type EstadoSolicitud =
  | 'Pendiente'
  | 'En revisión'
  | 'Con correcciones'
  | 'Aprobada'
  | 'Rechazada';

export interface ProyectoEnSeguimiento {
  id: number;
  idProyecto: number;
  esUltimaVersion: boolean;
  titulo: string;
  tipoTrabajo: string;
  fechaEnvio: string;
  ultimaActualizacion: string;
  version: number;
  estado: EstadoSolicitud;
  /** Fecha estimada de la primera respuesta (RF-19). */
  respuestaEstimada: string | null;
  /** Qué pasó con la publicación si la entrega fue aprobada (RF-07). */
  publicacion: string | null;
  puedeEliminar: boolean;
  puedeReenviar: boolean;
  /** Se puede actualizar (RF-08). */
  puedeActualizar: boolean;
  esActualizacion: boolean;
  observacion: string | null;
}

interface AutorDetalle {
  nombres: string;
  apellidos: string;
  carnet: string | null;
}

interface RecursoDetalle {
  id: number;
  nombre: string;
  tipo: string;
  url: string | null;
}

interface ObservacionDetalle {
  fecha: string;
  mensaje: string;
}

export interface DetalleSolicitud {
  id: number;
  titulo: string;
  resumen: string;
  anio: number;
  tipoTrabajo: string;
  departamento: string;
  carrera: string;
  tematica: string;
  materia: string | null;
  fechaEnvio: string;
  fechaRevision: string | null;
  ultimaActualizacion: string;
  revisor: string | null;
  version: number;
  estado: EstadoSolicitud;
  respuestaEstimada: string | null;
  publicacion: string | null;
  puedeEliminar: boolean;
  puedeReenviar: boolean;
  puedeActualizar: boolean;
  esActualizacion: boolean;
  autores: AutorDetalle[];
  palabrasClave: string[];
  asesores: { idDocente: number; nombre: string; autorizado: boolean }[];
  recursos: RecursoDetalle[];
  observaciones: ObservacionDetalle[];
}

@Component({
  selector: 'app-seguimiento',
  standalone: true,
  imports: [SesionUsuarioComponent, DatePipe, RouterLink, RouterLinkActive],
  templateUrl: './seguimiento.html',
  styleUrl: './seguimiento.css'
})
export class SeguimientoComponent implements OnInit {
  private readonly proyectosApi = inject(ProyectosService);
  // La app es zoneless: se repinta con markForCheck().
  private readonly cdr = inject(ChangeDetectorRef);

  /** Una tarjeta por proyecto: su versión más reciente. */
  proyectos: ProyectoEnSeguimiento[] = [];
  /** Todas las versiones enviadas. */
  private envios: ProyectoEnSeguimiento[] = [];
  historialAbierto: number | null = null;
  cargando = true;
  mensajeError = '';
  mensajeExito = '';
  readonly esSupervisor = usuarioTieneRol('supervisor');
  readonly esGestion = esCuentaDeGestion();

  detalle: DetalleSolicitud | null = null;
  cargandoDetalleId: number | null = null;
  errorDetalle = '';

  confirmandoEliminarId: number | null = null;
  eliminandoId: number | null = null;

  ngOnInit(): void {
    this.cargarProyectos();
  }

  /** Las fechas llegan en UTC sin zona. */
  fechaLocal(fecha: string | null): Date | null {
    if (!fecha) {
      return null;
    }

    const tieneZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(fecha);
    return new Date(tieneZona ? fecha : fecha + 'Z');
  }

  formatearNombre(nombre: string): string {
    return nombre.length === 0
      ? nombre
      : nombre.charAt(0).toLocaleUpperCase('es-SV') + nombre.slice(1);
  }

  private aplicarEnvios(datos: ProyectoEnSeguimiento[]): void {
    this.envios = datos;
    this.proyectos = datos.filter(envio => envio.esUltimaVersion);
  }

  /** Versiones anteriores del mismo proyecto, de la más reciente a la más antigua. */
  versionesAnteriores(proyecto: ProyectoEnSeguimiento): ProyectoEnSeguimiento[] {
    return this.envios
      .filter(envio => envio.idProyecto === proyecto.idProyecto && envio.id !== proyecto.id)
      .sort((a, b) => b.version - a.version);
  }

  alternarHistorial(idProyecto: number): void {
    this.historialAbierto = this.historialAbierto === idProyecto ? null : idProyecto;
  }

  textoEstado(estado: EstadoSolicitud): string {
    if (estado === 'Pendiente') return 'Pendiente de revisión';
    if (estado === 'En revisión') return 'En revisión por el supervisor';
    return estado;
  }

  verDetalle(proyecto: ProyectoEnSeguimiento): void {
    const token = this.leerToken();
    if (!token) {
      this.mensajeError = 'Tu sesión venció. Inicia sesión de nuevo.';
      return;
    }

    this.cargandoDetalleId = proyecto.id;
    this.errorDetalle = '';

    this.proyectosApi
      .solicitud<DetalleSolicitud>(proyecto.id)
      .subscribe({
        next: datos => {
          this.detalle = datos;
          this.cargandoDetalleId = null;
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargandoDetalleId = null;
          this.mensajeError = this.mensajeErrorApi(
            error,
            'No se pudo abrir la solicitud. Inténtalo de nuevo.'
          );
          this.cdr.markForCheck();
        }
      });
  }

  cerrarDetalle(): void {
    this.detalle = null;
    this.errorDetalle = '';
    this.confirmandoEliminarId = null;
  }

  abrirRecurso(recurso: RecursoDetalle): void {
    if (recurso.url) {
      globalThis.open(recurso.url, '_blank', 'noopener,noreferrer');
      return;
    }

    const token = this.leerToken();
    if (!token) {
      this.errorDetalle = 'Tu sesión venció. Inicia sesión de nuevo.';
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
          this.errorDetalle = this.mensajeErrorApi(
            error,
            'No se pudo descargar el archivo.'
          );
          this.cdr.markForCheck();
        }
      });
  }

  pedirConfirmacionEliminar(id: number): void {
    this.confirmandoEliminarId = id;
    this.mensajeExito = '';
  }

  cancelarEliminar(): void {
    this.confirmandoEliminarId = null;
  }

  eliminarSolicitud(id: number): void {
    const token = this.leerToken();
    if (!token) {
      this.mensajeError = 'Tu sesión venció. Inicia sesión de nuevo.';
      return;
    }

    this.eliminandoId = id;
    this.errorDetalle = '';

    this.proyectosApi
      .eliminarSolicitud(id)
      .subscribe({
        next: respuesta => {
          this.mensajeExito = respuesta.mensaje;
          // La versión anterior puede volver a ser la vigente: se recarga.
          this.cargarProyectos();
          this.eliminandoId = null;
          this.confirmandoEliminarId = null;
          if (this.detalle?.id === id) {
            this.detalle = null;
          }
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          const mensaje = this.mensajeErrorApi(
            error,
            'No se pudo eliminar la solicitud. Inténtalo de nuevo.'
          );
          this.eliminandoId = null;
          this.confirmandoEliminarId = null;
          if (this.detalle) {
            this.errorDetalle = mensaje;
          } else {
            this.mensajeError = mensaje;
          }
          // Si el supervisor ya la revisó, se recarga para mostrar el estado real.
          if (error instanceof HttpErrorResponse && error.status === 409) {
            this.cargarProyectos();
          }
          this.cdr.markForCheck();
        }
      });
  }

  private cargarProyectos(): void {
    const token = this.leerToken();
    if (!token) {
      this.cargando = false;
      this.mensajeError = 'Tu sesión venció. Inicia sesión de nuevo.';
      return;
    }

    this.proyectosApi
      .misProyectos<ProyectoEnSeguimiento>()
      .subscribe({
        next: datos => {
          this.aplicarEnvios(datos);
          this.cargando = false;
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargando = false;
          this.mensajeError = this.mensajeErrorApi(
            error,
            'No se pudieron cargar tus proyectos. Inténtalo de nuevo.'
          );
          this.cdr.markForCheck();
        }
      });
  }

  private leerToken(): string | null {
    try {
      return globalThis.sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private mensajeErrorApi(error: unknown, mensajePorDefecto: string): string {
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
    }

    return mensajePorDefecto;
  }
}
