import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AUTH_TOKEN_KEY } from '../../auth/auth.constants';
import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { OpcionBuscable, SelectorBuscable } from '../../compartido/selector-buscable';
import { RevisionService } from '../../servicios/revision.service';


/** Un proyecto, con lo necesario para filtrar y agrupar. */
interface ProyectoDato {
  id: number;
  anio: number;
  idTematica: number;
  tipo: string;
  departamento: string;
  carrera: string;
  publicacion: 'publicado' | 'no_publicado' | 'retirado';
}

/** Respuesta de GET /api/revision/estadisticas. */
interface Estadisticas {
  anios: number[];
  total: number;
  areas: { id: number; nombre: string }[];
  proyectos: ProyectoDato[];
  entregas: { idProyecto: number; estado: 'pendiente' | 'en_revision' | 'aprobada' | 'con_correcciones' | 'rechazada' }[];
}

interface Indicadores {
  proyectos: number;
  publicados: number;
  enRevision: number;
  tasaAprobacion: number | null;
}

/** Qué agrupa la tabla en sus filas. */
type Dimension = 'area' | 'departamento' | 'carrera' | 'tipo';

interface Tabla {
  anios: number[];
  filas: { nombre: string; valores: number[]; total: number }[];
  totales: number[];
  total: number;
}

const mayuscula = (texto: string) => texto.charAt(0).toLocaleUpperCase('es-SV') + texto.slice(1);
const sinPrefijo = (departamento: string) => departamento.replace(/^departamento de\s+/i, '');

/** RF-12: proyectos registrados por año, con filtros y agrupación a elegir. */
@Component({
  selector: 'app-estadisticas',
  standalone: true,
  imports: [SesionUsuarioComponent, RouterLink, RouterLinkActive, SelectorBuscable],
  templateUrl: './estadisticas.html',
  // Usa los estilos del panel de supervisión.
  styleUrls: [
    '../../publicaciones/seguimiento/seguimiento.css',
    '../revision-supervisor/revision-supervisor.css',
    './estadisticas.css'
  ]
})
export class EstadisticasComponent implements OnInit {
  private readonly revisionApi = inject(RevisionService);
  private readonly cdr = inject(ChangeDetectorRef);

  estadisticas: Estadisticas | null = null;
  cargando = false;
  mensajeError = '';

  // Filtros ('' = todos).
  filtroAnio = '';
  filtroArea = '';
  filtroDepartamento = '';
  filtroTipo = '';

  dimension: Dimension = 'area';
  readonly dimensiones: { valor: Dimension; texto: string }[] = [
    { valor: 'area', texto: 'Área temática' },
    { valor: 'departamento', texto: 'Departamento' },
    { valor: 'carrera', texto: 'Carrera' },
    { valor: 'tipo', texto: 'Tipo de trabajo' }
  ];

  ngOnInit(): void {
    let token: string | null = null;
    try {
      token = globalThis.sessionStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      token = null;
    }
    if (!token) {
      this.mensajeError = 'Tu sesión venció. Inicia sesión de nuevo.';
      return;
    }

    this.cargando = true;
    this.revisionApi
      .estadisticas<Estadisticas>()
      .subscribe({
        next: datos => {
          this.estadisticas = datos;
          this.cargando = false;
          if (!datos.proyectos) {
            this.mensajeError = 'La API en ejecución es una versión anterior. Recompílala y vuelve a iniciarla.';
          }
          this.cdr.markForCheck();
        },
        error: (error: unknown) => {
          this.cargando = false;
          this.mensajeError = this.mensajeErrorApi(error);
          this.cdr.markForCheck();
        }
      });
  }

  // ----- Opciones de los filtros -----

  private nombresArea = new Map<number, string>();
  private cacheOpciones: { origen: Estadisticas | null; areas: OpcionBuscable[]; departamentos: string[]; tipos: string[] } =
    { origen: null, areas: [], departamentos: [], tipos: [] };

  private get opciones() {
    const datos = this.estadisticas;
    if (this.cacheOpciones.origen !== datos) {
      this.nombresArea = new Map((datos?.areas ?? []).map(area => [area.id, mayuscula(area.nombre)]));
      const proyectos = datos?.proyectos ?? [];
      this.cacheOpciones = {
        origen: datos,
        areas: [...this.nombresArea.entries()]
          .map(([id, nombre]) => ({ value: String(id), label: nombre }))
          .sort((a, b) => a.label.localeCompare(b.label, 'es')),
        departamentos: [...new Set(proyectos.map(p => sinPrefijo(p.departamento)))].sort((a, b) => a.localeCompare(b, 'es')),
        tipos: [...new Set(proyectos.map(p => mayuscula(p.tipo)))].sort((a, b) => a.localeCompare(b, 'es'))
      };
    }
    return this.cacheOpciones;
  }

  get opcionesAreas(): OpcionBuscable[] {
    return this.opciones.areas;
  }

  get departamentos(): string[] {
    return this.opciones.departamentos;
  }

  get tipos(): string[] {
    return this.opciones.tipos;
  }

  get hayFiltros(): boolean {
    return !!(this.filtroAnio || this.filtroArea || this.filtroDepartamento || this.filtroTipo);
  }

  get tituloDimension(): string {
    return this.dimensiones.find(d => d.valor === this.dimension)?.texto ?? '';
  }

  elegir(filtro: 'filtroAnio' | 'filtroDepartamento' | 'filtroTipo', event: Event): void {
    this[filtro] = (event.target as HTMLSelectElement).value;
  }

  elegirDimension(event: Event): void {
    this.dimension = (event.target as HTMLSelectElement).value as Dimension;
  }

  limpiarFiltros(): void {
    this.filtroAnio = this.filtroArea = this.filtroDepartamento = this.filtroTipo = '';
  }

  // ----- Datos filtrados -----

  private filtrados(): ProyectoDato[] {
    void this.opciones; // prepara los nombres de las áreas
    return (this.estadisticas?.proyectos ?? []).filter(p =>
      (!this.filtroAnio || String(p.anio) === this.filtroAnio) &&
      (!this.filtroArea || String(p.idTematica) === this.filtroArea) &&
      (!this.filtroDepartamento || sinPrefijo(p.departamento) === this.filtroDepartamento) &&
      (!this.filtroTipo || mayuscula(p.tipo) === this.filtroTipo));
  }

  /** Se recalcula solo si cambian los datos, los filtros o las filas. */
  private cache: { clave: string; indicadores: Indicadores | null; tabla: Tabla | null } =
    { clave: '', indicadores: null, tabla: null };

  private calcular(): void {
    const clave = [this.estadisticas?.total, this.filtroAnio, this.filtroArea, this.filtroDepartamento, this.filtroTipo, this.dimension].join('|');
    if (this.cache.clave === clave) return;
    const datos = this.estadisticas;
    if (!datos?.proyectos) {
      this.cache = { clave, indicadores: null, tabla: null };
      return;
    }

    const proyectos = this.filtrados();
    const ids = new Set(proyectos.map(p => p.id));
    const entregas = datos.entregas.filter(e => ids.has(e.idProyecto));
    const aprobadas = entregas.filter(e => e.estado === 'aprobada').length;
    const decididas = entregas.filter(e => e.estado !== 'pendiente' && e.estado !== 'en_revision').length;

    const indicadores: Indicadores = {
      proyectos: proyectos.length,
      publicados: proyectos.filter(p => p.publicacion === 'publicado').length,
      enRevision: entregas.filter(e => e.estado === 'pendiente' || e.estado === 'en_revision').length,
      tasaAprobacion: decididas ? Math.round((aprobadas / decididas) * 100) : null
    };

    const anios = [...new Set(proyectos.map(p => p.anio))].sort((a, b) => b - a);
    const grupos = new Map<string, number[]>();
    for (const p of proyectos) {
      const nombre = this.nombreFila(p);
      const fila = grupos.get(nombre) ?? anios.map(() => 0);
      fila[anios.indexOf(p.anio)]++;
      grupos.set(nombre, fila);
    }
    const filas = [...grupos.entries()]
      .map(([nombre, valores]) => ({ nombre, valores, total: valores.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
    const totales = anios.map((_, i) => filas.reduce((suma, fila) => suma + fila.valores[i], 0));

    this.cache = { clave, indicadores, tabla: { anios, filas, totales, total: proyectos.length } };
  }

  get indicadores(): Indicadores | null {
    this.calcular();
    return this.cache.indicadores;
  }

  get tabla(): Tabla | null {
    this.calcular();
    return this.cache.tabla;
  }

  private nombreFila(p: ProyectoDato): string {
    switch (this.dimension) {
      case 'departamento': return sinPrefijo(p.departamento);
      case 'carrera': return p.carrera;
      case 'tipo': return mayuscula(p.tipo);
      default: return this.nombresArea.get(p.idTematica) ?? '';
    }
  }

  /** Descarga la tabla como CSV (se abre en Excel). */
  descargarCsv(): void {
    const tabla = this.tabla;
    if (!tabla) return;
    const celda = (valor: string | number) => `"${String(valor).replace(/"/g, '""')}"`;
    const lineas = [
      [this.tituloDimension, ...tabla.anios, 'Total'],
      ...tabla.filas.map(fila => [fila.nombre, ...fila.valores, fila.total]),
      ['Total', ...tabla.totales, tabla.total]
    ].map(linea => linea.map(celda).join(';'));
    // BOM para que Excel lea bien las tildes.
    const archivo = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `estadisticas-${this.dimension}${this.filtroAnio ? '-' + this.filtroAnio : ''}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  private mensajeErrorApi(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const mensajeApi = error.error && typeof error.error.mensaje === 'string' ? error.error.mensaje : null;
      if (mensajeApi) return mensajeApi;
      if (error.status === 0) return 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.';
      if (error.status === 401) return 'Tu sesión venció. Inicia sesión de nuevo.';
      if (error.status === 403) return 'Tu cuenta no tiene el rol de supervisor.';
      if (error.status === 404) return 'La API en ejecución no tiene esta función. Recompílala y vuelve a iniciarla.';
    }
    return 'No se pudo cargar el conteo. Inténtalo de nuevo.';
  }
}
