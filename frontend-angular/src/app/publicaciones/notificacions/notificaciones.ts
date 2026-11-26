import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { esCuentaDeGestion, usuarioTieneRol } from '../../auth/auth.guard';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AUTH_TOKEN_KEY } from '../../auth/auth.constants';
import { NotificacionesService } from '../../servicios/notificaciones.service';


/** Minúsculas y sin tildes. */
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export type TipoNotificacion =
  | 'Nueva entrega'
  | 'Correcciones solicitadas'
  | 'Proyecto aprobado'
  | 'Proyecto rechazado'
  | 'Publicación retirada'
  | 'Aviso';

export interface Notificacion {
  id: number;
  idEntrega: number;
  tituloProyecto: string;
  tipo: TipoNotificacion;
  mensaje: string;
  fecha: string;
  leida: boolean;
}

@Component({
  selector: 'app-notificaciones',
  standalone: true,
  imports: [SesionUsuarioComponent, DatePipe, RouterLink, RouterLinkActive],
  templateUrl: './notificaciones.html',
  styleUrl: './notificaciones.css'
})
export class NotificacionesComponent implements OnInit {
  private readonly notificacionesApi = inject(NotificacionesService);
  private readonly router = inject(Router);
  // La app es zoneless: se repinta con markForCheck().
  private readonly cdr = inject(ChangeDetectorRef);

  readonly esSupervisor = usuarioTieneRol('supervisor');
  readonly esGestion = esCuentaDeGestion();
  notificaciones: Notificacion[] = [];
  cargando = true;
  mensajeError = '';

  get sinLeer(): number {
    return this.notificaciones.filter(notificacion => !notificacion.leida).length;
  }

  // Filtros ('' = sin filtro) y páginas de 10.
  filtroLectura: '' | 'sin_leer' | 'leidas' = '';
  filtroTipo = '';
  filtroFecha: '' | 'hoy' | '7' | '30' = '';
  busqueda = '';
  pagina = 1;
  readonly porPagina = 10;

  get hayFiltros(): boolean {
    return !!(this.filtroLectura || this.filtroTipo || this.filtroFecha || this.busqueda.trim());
  }

  /** Tipos de aviso que tiene la cuenta, con su cantidad. */
  get tipos(): { tipo: string; total: number }[] {
    const conteo = new Map<string, number>();
    this.notificaciones.forEach(n => conteo.set(n.tipo, (conteo.get(n.tipo) ?? 0) + 1));
    return [...conteo.entries()].map(([tipo, total]) => ({ tipo, total })).sort((a, b) => b.total - a.total);
  }

  get filtradas(): Notificacion[] {
    const texto = normalizar(this.busqueda.trim());
    const desde = this.filtroFecha === 'hoy'
      ? new Date(new Date().setHours(0, 0, 0, 0))
      : this.filtroFecha ? new Date(Date.now() - Number(this.filtroFecha) * 86400000) : null;
    return this.notificaciones.filter(n =>
      (!this.filtroLectura || (this.filtroLectura === 'leidas') === n.leida) &&
      (!this.filtroTipo || n.tipo === this.filtroTipo) &&
      (!desde || this.fechaLocal(n.fecha) >= desde) &&
      (!texto || normalizar(n.tituloProyecto + ' ' + n.mensaje).includes(texto)));
  }

  get totalPaginas(): number {
    return Math.max(1, Math.ceil(this.filtradas.length / this.porPagina));
  }

  get visibles(): Notificacion[] {
    const pagina = Math.min(this.pagina, this.totalPaginas);
    return this.filtradas.slice((pagina - 1) * this.porPagina, pagina * this.porPagina);
  }

  /** Cambia un filtro y vuelve a la primera página. */
  filtrar(cambio: Partial<Pick<NotificacionesComponent, 'filtroLectura' | 'filtroTipo' | 'filtroFecha' | 'busqueda'>>): void {
    Object.assign(this, cambio);
    this.pagina = 1;
  }

  quitarFiltros(): void {
    this.filtrar({ filtroLectura: '', filtroTipo: '', filtroFecha: '', busqueda: '' });
  }

  irAPagina(pagina: number): void {
    this.pagina = Math.min(this.totalPaginas, Math.max(1, pagina));
    globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  ngOnInit(): void {
    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      this.cargando = false;
      return;
    }

    this.notificacionesApi
      .listar<Notificacion>()
      .subscribe({
        next: datos => {
          this.notificaciones = datos;
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

  /** Las fechas llegan en UTC sin zona. */
  fechaLocal(fecha: string): Date {
    const tieneZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(fecha);
    return new Date(tieneZona ? fecha : fecha + 'Z');
  }

  textoAccion(notificacion: Notificacion): string {
    return this.esSupervisor ? 'Ir a revisión' : 'Ver mi solicitud';
  }

  /** Marca el aviso como leído y lleva a la pantalla donde se atiende. */
  abrir(notificacion: Notificacion): void {
    this.marcarLeida(notificacion);
    const destino = this.esSupervisor ? '/revision-supervisor' : '/mis-proyectos';
    void this.router.navigateByUrl(destino);
  }

  marcarLeida(notificacion: Notificacion): void {
    if (notificacion.leida) {
      return;
    }
    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      return;
    }

    notificacion.leida = true;
    this.notificacionesApi
      .marcarLeida(notificacion.id)
      .subscribe({
        error: () => {
          notificacion.leida = false;
          this.cdr.markForCheck();
        }
      });
  }

  marcarTodasLeidas(): void {
    const cabeceras = this.cabeceras();
    if (!cabeceras) {
      return;
    }

    const pendientes = this.notificaciones.filter(notificacion => !notificacion.leida);
    pendientes.forEach(notificacion => notificacion.leida = true);
    this.notificacionesApi
      .marcarTodas()
      .subscribe({
        error: (error: unknown) => {
          pendientes.forEach(notificacion => notificacion.leida = false);
          this.mensajeError = this.mensajeErrorApi(error);
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

  private mensajeErrorApi(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.';
      }
      if (error.status === 401) {
        return 'Tu sesión venció. Inicia sesión de nuevo.';
      }
    }
    return 'No se pudieron cargar tus notificaciones. Inténtalo de nuevo.';
  }
}
