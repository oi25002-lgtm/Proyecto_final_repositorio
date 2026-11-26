import { SesionUsuarioComponent } from '../auth/sesion-usuario';
import { esCuentaDeGestion, sesionActiva, usuarioTieneRol } from '../auth/auth.guard';
import { Component, computed, effect, input, model, OnInit, signal, untracked, WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import type { Work } from '../app';
import { afterNextRender, DestroyRef, inject, Injector } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { API_URL } from '../api-url';
import { CatalogoService } from '../servicios/catalogo.service';


/** Grupos de filtros del catálogo. */
type FilterGroup = 'area' | 'year' | 'type' | 'department' | 'career' | 'subject' | 'author';

/** Minúsculas y sin tildes, para comparar textos. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
}

interface OpcionApi {
  id: number;
  nombre: string;
}

/** Ficha que devuelve GET /api/catalogo. */
interface FichaApi {
  id: number;
  titulo: string;
  autores: string[];
  anio: number;
  carrera: string;
  departamento?: string;
  tematica: string;
  tipoTrabajo: string;
  materia: string | null;
  resumen: string;
  palabrasClave: string[];
  destacado: boolean;
  /** Solo asesores autorizados. */
  asesores?: string[];
  permiso: 'solo_ficha' | 'ficha_y_materiales';
  recursos: { id: number; nombre: string; tipo: string; url: string | null }[];
}

@Component({
  selector: 'app-catalogo',
  imports: [SesionUsuarioComponent, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './catalogo.html',
  styleUrl: './catalogo.css',
})
export class Catalogo implements OnInit {
  readonly esSupervisor = usuarioTieneRol('supervisor');
  readonly esGestion = esCuentaDeGestion();
  readonly active = input.required<boolean>();
  private readonly catalogoApi = inject(CatalogoService);

  /** Fichas publicadas. */
  readonly works = signal<Work[]>([]);
  readonly areas = signal<string[]>([]);
  readonly cargandoCatalogo = signal(true);
  /** La API no respondió. */
  readonly errorCarga = signal(false);
  /** Cargó bien, pero no hay trabajos publicados. */
  readonly sinTrabajos = computed(() => !this.cargandoCatalogo() && !this.errorCarga() && this.publicWorks().length === 0);
  readonly actionNotice = model('');

  readonly query = signal('');
  readonly searchScope = signal('all');
  readonly selectedAreas = signal<string[]>([]);
  readonly selectedYears = signal<number[]>([]);
  readonly selectedTypes = signal<string[]>([]);
  readonly selectedDepartments = signal<string[]>([]);
  readonly selectedCareers = signal<string[]>([]);
  readonly selectedSubjects = signal<string[]>([]);
  /** Filtro por autor. */
  readonly selectedAuthors = signal<string[]>([]);
  readonly sortOrder = signal('relevance');
  readonly page = signal(1);
  readonly pageSize = 10;
  /** Los favoritos requieren sesión. */
  readonly conSesion = sesionActiva();
  readonly favoriteIds = signal<number[]>([]);
  readonly favoritesOnly = signal(false);
  readonly selectedWork = signal<Work | null>(null);

  readonly authors = computed(() => [...new Set(this.publicWorks().flatMap((work) => work.authors))].sort((a, b) => a.localeCompare(b, 'es')));
  readonly years = computed(() => [...new Set(this.publicWorks().map((work) => work.year))].sort((a, b) => b - a));
  readonly types = computed(() => [...new Set(this.publicWorks().map((work) => work.type))].sort((a, b) => a.localeCompare(b, 'es')));
  readonly departments = computed(() => [...new Set(this.publicWorks().map((work) => work.department ?? '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')));
  /** Carreras de los departamentos marcados. */
  readonly careers = computed(() => {
    const departamentos = this.selectedDepartments();
    if (!departamentos.length) return [];
    return [...new Set(this.publicWorks()
      .filter((work) => departamentos.includes(work.department ?? ''))
      .map((work) => work.career))].sort((a, b) => a.localeCompare(b, 'es'));
  });
  readonly subjects = computed(() => [...new Set(this.publicWorks().map((work) => work.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')));

  /** Opciones visibles por grupo antes de "Ver todas". */
  readonly facetLimit = 6;
  /** Desde cuántas opciones aparece el buscador del grupo. */
  readonly facetSearchFrom = 8;
  /** Grupos cortos: se muestran completos y sin buscador. */
  readonly shortGroups: FilterGroup[] = ['year', 'type', 'department'];
  readonly expandedGroups = signal<FilterGroup[]>([]);
  readonly groupQueries = signal<Partial<Record<FilterGroup, string>>>({});

  readonly facetGroups = computed(() => {
    const definiciones: { key: FilterGroup; title: string; values: (string | number)[]; selection: WritableSignal<(string | number)[]> }[] = [
      { key: 'area', title: 'Área temática', values: this.areas(), selection: this.selectedAreas as WritableSignal<(string | number)[]> },
      { key: 'year', title: 'Año', values: this.years(), selection: this.selectedYears as WritableSignal<(string | number)[]> },
      { key: 'type', title: 'Tipo de trabajo', values: this.types(), selection: this.selectedTypes as WritableSignal<(string | number)[]> },
      { key: 'department', title: 'Departamento', values: this.departments(), selection: this.selectedDepartments as WritableSignal<(string | number)[]> },
      { key: 'career', title: 'Carrera', values: this.careers(), selection: this.selectedCareers as WritableSignal<(string | number)[]> },
      { key: 'subject', title: 'Asignatura', values: this.subjects(), selection: this.selectedSubjects as WritableSignal<(string | number)[]> },
      { key: 'author', title: 'Autor', values: this.authors(), selection: this.selectedAuthors as WritableSignal<(string | number)[]> }
    ];
    const expandidos = this.expandedGroups();
    const busquedas = this.groupQueries();

    return definiciones
      .map((grupo) => {
        const seleccion = grupo.selection();
        // Opciones con resultados: marcadas primero, luego por cantidad (años, del más reciente).
        const disponibles = grupo.values
          .map((value) => ({ value, label: String(value), count: this.count(grupo.key, value), selected: seleccion.includes(value) }))
          .filter((option) => option.count > 0 || option.selected)
          .sort((a, b) =>
            Number(b.selected) - Number(a.selected) ||
            (grupo.key === 'year' ? Number(b.value) - Number(a.value) : b.count - a.count || a.label.localeCompare(b.label, 'es'))
          );

        const termino = normalizar((busquedas[grupo.key] ?? '').trim());
        const coincidentes = termino ? disponibles.filter((option) => normalizar(option.label).includes(termino)) : disponibles;
        const expandido = expandidos.includes(grupo.key) || termino.length > 0;
        const corto = this.shortGroups.includes(grupo.key);
        // Las marcadas nunca se esconden detrás de "Ver todas".
        const limite = corto
          ? coincidentes.length
          : Math.max(this.facetLimit, coincidentes.filter((option) => option.selected).length);
        const visibles = expandido ? coincidentes : coincidentes.slice(0, limite);

        return {
          key: grupo.key,
          title: grupo.title,
          selection: grupo.selection,
          total: disponibles.length,
          selectedCount: seleccion.length,
          searchable: !corto && disponibles.length >= this.facetSearchFrom,
          query: busquedas[grupo.key] ?? '',
          expanded: expandido,
          canExpand: !termino && coincidentes.length > limite,
          hiddenCount: coincidentes.length - visibles.length,
          options: visibles,
          hint: grupo.key === 'department' && !seleccion.length ? 'Marca un departamento para ver sus carreras.' : ''
        };
      })
      .filter((grupo) => grupo.total > 0);
  });

  toggleGroupExpanded(key: FilterGroup): void {
    this.expandedGroups.update((actuales) =>
      actuales.includes(key) ? actuales.filter((item) => item !== key) : [...actuales, key]
    );
  }

  setGroupQuery(key: FilterGroup, value: string): void {
    this.groupQueries.update((actuales) => ({ ...actuales, [key]: value }));
  }

  /** Atajos de "Explorar por área": las áreas con más trabajos. */
  readonly areaShortcutLimit = 8;
  readonly areaShortcuts = computed(() => {
    const seleccion = this.selectedAreas();
    return this.areas()
      .map((area) => ({ area, count: this.count('area', area), selected: seleccion.includes(area) }))
      .filter((item) => item.count > 0 || item.selected)
      .sort((a, b) => Number(b.selected) - Number(a.selected) || b.count - a.count || a.area.localeCompare(b.area, 'es'))
      .slice(0, this.areaShortcutLimit);
  });
  readonly moreAreas = computed(() =>
    Math.max(0, this.areas().filter((area) => this.count('area', area) > 0).length - this.areaShortcuts().length)
  );

  /** Abre el grupo de área completo. */
  showAllAreas(): void {
    this.abrirConArea = !this.filtersOpen();
    this.filtersOpen.set(true);
    const area = document.getElementById('filtro-area') as HTMLDetailsElement | null;
    if (area) area.open = true;
    if (!this.expandedGroups().includes('area')) this.toggleGroupExpanded('area');
    afterNextRender(() => {
      document.getElementById('filtro-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, { injector: this.injector });
  }

  /** Texto normalizado de cada ficha, por campo, para la búsqueda. */
  private readonly searchIndex = computed(() => {
    const index = new Map<number, Record<string, string>>();
    for (const work of this.publicWorks()) {
      const title = normalizar(work.title);
      const author = normalizar(work.authors.join(' '));
      const topic = normalizar(`${work.area} ${work.summary} ${work.keywords.join(' ')}`);
      index.set(work.id, {
        title,
        author,
        topic,
        keywords: normalizar(work.keywords.join(' ')),
        summary: normalizar(work.summary),
        area: normalizar(`${work.area} ${work.subject}`),
        all: `${title} ${author} ${topic} ${normalizar(`${work.career} ${work.type} ${work.subject} ${work.advisor} ${work.year}`)}`
      });
    }
    return index;
  });

  /** Cada palabra buscada debe aparecer, en cualquier orden. */
  private readonly searchTerms = computed(() => normalizar(this.query()).split(/\s+/).filter(Boolean));

  /**
   * Qué tan bien coincide una ficha con lo buscado: pesa más el título, luego
   * las palabras clave y los autores, y al final el resumen.
   */
  private coincidencia(work: Work, terms: string[]): number {
    const campos = this.searchIndex().get(work.id);
    if (!campos) return 0;
    // Una palabra completa vale el doble que un pedazo ("agua" frente a "Guatajiagua").
    const valor = (texto: string, termino: string, peso: number) => {
      if (!texto.includes(termino)) return 0;
      const completa = texto.split(/[^a-z0-9ñ]+/).includes(termino);
      return completa ? peso * 2 : peso;
    };
    let puntos = 0;
    for (const termino of terms) {
      puntos += valor(campos['title'], termino, 6);
      puntos += valor(campos['keywords'], termino, 4);
      puntos += valor(campos['author'], termino, 4);
      puntos += valor(campos['area'], termino, 2);
      puntos += valor(campos['summary'], termino, 1);
    }
    return puntos;
  }

  /** Resultado con filtros y orden aplicados. */
  readonly filteredWorks = computed(() => {
    const results = this.publicWorks().filter((work) => this.matches(work, null));
    const order = this.sortOrder();
    const terms = this.searchTerms();
    // Sin búsqueda, "más relevantes" muestra primero los más recientes.
    const puntos = order === 'relevance' && terms.length
      ? new Map(results.map((work) => [work.id, this.coincidencia(work, terms)]))
      : null;
    return [...results].sort((a, b) => {
      if (puntos) {
        const diferencia = (puntos.get(b.id) ?? 0) - (puntos.get(a.id) ?? 0);
        if (diferencia !== 0) return diferencia;
      }
      if (order === 'featured' && a.featured !== b.featured) return a.featured ? -1 : 1;
      if (order === 'title') return a.title.localeCompare(b.title, 'es');
      const byYear = order === 'old' ? a.year - b.year : b.year - a.year;
      // Desempate por título.
      return byYear !== 0 ? byYear : a.title.localeCompare(b.title, 'es');
    });
  });

  /** Cuántos trabajos quedarían al marcar cada opción, con los demás filtros. */
  readonly facetCounts = computed(() => {
    const contar = <K extends string | number>(grupo: FilterGroup, valores: (work: Work) => K[]) => {
      const conteo = new Map<K, number>();
      for (const work of this.publicWorks()) {
        if (!this.matches(work, grupo)) continue;
        for (const valor of new Set(valores(work))) {
          conteo.set(valor, (conteo.get(valor) ?? 0) + 1);
        }
      }
      return conteo;
    };
    return {
      area: contar('area', (work) => [work.area]),
      year: contar('year', (work) => [work.year]),
      type: contar('type', (work) => [work.type]),
      department: contar('department', (work) => (work.department ? [work.department] : [])),
      career: contar('career', (work) => [work.career]),
      subject: contar('subject', (work) => (work.subject ? [work.subject] : [])),
      author: contar('author', (work) => work.authors)
    };
  });

  /** Filtros activos como etiquetas que se pueden quitar. */
  readonly activeFilters = computed(() => {
    const chips: { label: string; remove: () => void }[] = [];
    const add = <T extends string | number>(selection: WritableSignal<T[]>, prefijo: string) => {
      for (const value of selection()) {
        chips.push({ label: `${prefijo}: ${value}`, remove: () => this.toggleSelection(selection, value) });
      }
    };
    if (this.query().trim()) {
      chips.push({ label: `Búsqueda: «${this.query().trim()}»`, remove: () => { this.query.set(''); this.page.set(1); } });
    }
    add(this.selectedAreas, 'Área');
    add(this.selectedYears, 'Año');
    add(this.selectedTypes, 'Tipo');
    add(this.selectedDepartments, 'Departamento');
    add(this.selectedCareers, 'Carrera');
    add(this.selectedSubjects, 'Asignatura');
    add(this.selectedAuthors, 'Autor');
    if (this.favoritesOnly()) {
      chips.push({ label: 'Solo favoritos', remove: () => { this.favoritesOnly.set(false); this.page.set(1); } });
    }
    return chips;
  });

  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredWorks().length / this.pageSize)));
  /** Página dentro del rango aunque cambien los resultados. */
  readonly currentPage = computed(() => Math.min(this.page(), this.pageCount()));
  readonly pageWorks = computed(() =>
    this.filteredWorks().slice((this.currentPage() - 1) * this.pageSize, this.currentPage() * this.pageSize)
  );

  /** Comprueba todos los filtros excepto el grupo indicado (para los conteos). */
  private matches(work: Work, except: FilterGroup | null): boolean {
    const terms = this.searchTerms();
    if (terms.length) {
      const text = this.searchIndex().get(work.id)?.[this.searchScope()] ?? '';
      if (!terms.every((term) => text.includes(term))) return false;
    }
    const pasa = <T>(grupo: FilterGroup, seleccion: T[], valor: T | T[]) =>
      except === grupo || !seleccion.length ||
      (Array.isArray(valor) ? valor.some((item) => seleccion.includes(item)) : seleccion.includes(valor));

    return (
      pasa('area', this.selectedAreas(), work.area) &&
      pasa('year', this.selectedYears(), work.year) &&
      pasa('type', this.selectedTypes(), work.type) &&
      pasa('department', this.selectedDepartments(), work.department ?? '') &&
      pasa('career', this.selectedCareers(), work.career) &&
      pasa('subject', this.selectedSubjects(), work.subject) &&
      pasa('author', this.selectedAuthors(), work.authors) &&
      (!this.favoritesOnly() || this.favoriteIds().includes(work.id))
    );
  }

  count(grupo: FilterGroup, value: string | number): number {
    return (this.facetCounts()[grupo] as Map<string | number, number>).get(value) ?? 0;
  }

  ngOnInit(): void {
    this.catalogoApi.listar<OpcionApi>('/catalogos/tematicas').subscribe({
      next: (tematicas) => this.areas.set(tematicas.map((tematica) => this.capitalizar(tematica.nombre))),
      error: () => this.areas.set([])
    });

    this.cargarFavoritos();

    this.catalogoApi.fichas<FichaApi>().subscribe({
      next: (fichas) => {
        this.works.set(fichas.map((ficha) => this.aWork(ficha)));
        this.cargandoCatalogo.set(false);
        this.abrirFichaDelEnlace();
      },
      error: (error: unknown) => {
        this.cargandoCatalogo.set(false);
        this.errorCarga.set(true);
        this.actionNotice.set(
          error instanceof HttpErrorResponse && error.status === 0
            ? 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.'
            : 'No se pudo cargar el catálogo. Inténtalo de nuevo.'
        );
      }
    });
  }

  /** Abre la ficha de un enlace compartido (#trabajo-N) si sigue publicada. */
  private abrirFichaDelEnlace(): void {
    const match = globalThis.location?.hash.match(/^#trabajo-(\d+)$/);
    if (!match) return;

    const work = this.publicWorks().find((item) => item.id === Number(match[1]));
    if (work) {
      this.selectedWork.set(work);
    } else {
      this.actionNotice.set('La ficha de ese enlace ya no está disponible en el catálogo.');
    }
  }

  private capitalizar(texto: string): string {
    return texto.length === 0 ? texto : texto.charAt(0).toLocaleUpperCase('es-SV') + texto.slice(1);
  }

  private aWork(ficha: FichaApi): Work {
    const tipoRecurso = (tipo: string): Work['resources'][number]['kind'] =>
      tipo === 'pdf' ? 'PDF' : tipo === 'zip' ? 'ZIP' : 'Enlace de descarga';

    return {
      id: ficha.id,
      title: ficha.titulo,
      authors: ficha.autores,
      year: ficha.anio,
      career: ficha.carrera,
      // Sin el prefijo "Departamento de".
      department: ficha.departamento ? this.capitalizar(ficha.departamento.replace(/^departamento de\s+/i, '')) : '',
      area: this.capitalizar(ficha.tematica),
      type: this.capitalizar(ficha.tipoTrabajo),
      subject: ficha.materia ?? '',
      summary: ficha.resumen,
      keywords: ficha.palabrasClave,
      advisor: (ficha.asesores ?? []).join(', '),
      advisorAllowed: (ficha.asesores ?? []).length > 0,
      permission: ficha.permiso === 'ficha_y_materiales' ? 'Ficha y materiales autorizados' : 'Solo ficha',
      approvedResourceIds: ficha.recursos.map((recurso) => recurso.id),
      resources: ficha.recursos.map((recurso) => ({
        id: recurso.id,
        name: recurso.nombre,
        kind: tipoRecurso(recurso.tipo),
        // La API vuelve a comprobar el permiso del archivo.
        href: recurso.url ?? API_URL + '/catalogo/recursos/' + recurso.id
      })),
      published: true,
      featured: ficha.destacado,
      withdrawnReason: ''
    };
  }

  private publicWorks(): Work[] {
    return this.works().filter((work) => work.published && work.permission !== 'Pendiente');
  }

  constructor() {
    this.contraerFiltrosAlBajar();
    // Al abrir el panel, los grupos empiezan cerrados.
    effect(() => {
      if (!this.filtersOpen()) return;
      // Excepto con "Más áreas", que abre el grupo de área.
      const dejarArea = this.abrirConArea;
      this.abrirConArea = false;
      afterNextRender(() => {
        document.querySelectorAll<HTMLDetailsElement>('.filters details.filter-group').forEach((grupo) => {
          if (!(dejarArea && grupo.id === 'filtro-area')) grupo.open = false;
        });
      }, { injector: this.injector });
    });
    // Los filtros se guardan en la URL: sobreviven a recargas y se pueden compartir.
    this.leerFiltrosDeUrl();
    effect(() => this.escribirFiltrosEnUrl());
    // Al desmarcar un departamento se sueltan también sus carreras.
    effect(() => {
      if (this.cargandoCatalogo()) return;
      const validas = this.careers();
      const marcadas = untracked(() => this.selectedCareers());
      const quedan = marcadas.filter((carrera) => validas.includes(carrera));
      if (quedan.length !== marcadas.length) untracked(() => this.selectedCareers.set(quedan));
    });
  }

  private leerFiltrosDeUrl(): void {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(globalThis.location?.search ?? '');
    } catch {
      return;
    }
    const campos = ['all', 'title', 'author', 'topic'];
    const ordenes = ['relevance', 'recent', 'old', 'title', 'featured'];
    this.query.set(params.get('q') ?? '');
    if (campos.includes(params.get('campo') ?? '')) this.searchScope.set(params.get('campo')!);
    if (ordenes.includes(params.get('orden') ?? '')) this.sortOrder.set(params.get('orden')!);
    this.selectedAreas.set(params.getAll('area'));
    this.selectedYears.set(params.getAll('anio').map(Number).filter(Number.isFinite));
    this.selectedTypes.set(params.getAll('tipo'));
    this.selectedDepartments.set(params.getAll('departamento'));
    this.selectedCareers.set(params.getAll('carrera'));
    this.selectedSubjects.set(params.getAll('materia'));
    this.selectedAuthors.set(params.getAll('autor'));
    this.favoritesOnly.set(this.conSesion && params.get('favoritos') === '1');
    const pagina = Number(params.get('pagina'));
    this.page.set(Number.isInteger(pagina) && pagina > 0 ? pagina : 1);
  }

  private escribirFiltrosEnUrl(): void {
    const params = new URLSearchParams();
    const query = this.query().trim();
    if (query) params.set('q', query);
    if (this.searchScope() !== 'all') params.set('campo', this.searchScope());
    this.selectedAreas().forEach((value) => params.append('area', value));
    this.selectedYears().forEach((value) => params.append('anio', String(value)));
    this.selectedTypes().forEach((value) => params.append('tipo', value));
    this.selectedDepartments().forEach((value) => params.append('departamento', value));
    this.selectedCareers().forEach((value) => params.append('carrera', value));
    this.selectedSubjects().forEach((value) => params.append('materia', value));
    this.selectedAuthors().forEach((value) => params.append('autor', value));
    if (this.favoritesOnly()) params.set('favoritos', '1');
    if (this.sortOrder() !== 'relevance') params.set('orden', this.sortOrder());
    if (this.page() > 1) params.set('pagina', String(this.page()));

    const location = globalThis.location;
    // Solo en la pantalla del catálogo.
    if (!location || location.pathname !== '/catalogo') return;
    const search = params.toString();
    const url = location.pathname + (search ? '?' + search : '') + location.hash;
    if (url !== location.pathname + location.search + location.hash) {
      // replaceState: no llena el historial con cada tecla.
      globalThis.history.replaceState(globalThis.history.state, '', url);
    }
  }


  /** Carga los favoritos de la cuenta. */
  private cargarFavoritos(): void {
    if (!this.conSesion) return;
    this.catalogoApi.favoritos().subscribe({
      next: (ids) => this.favoriteIds.set(ids),
      error: () => this.favoriteIds.set([])
    });
  }

  toggleFavoritesOnly(): void {
    if (!this.conSesion) {
      this.actionNotice.set('Inicia sesión para guardar y ver tus favoritos.');
      return;
    }
    this.favoritesOnly.set(!this.favoritesOnly());
    this.page.set(1);
  }

  isSelected<T extends string | number>(selection: WritableSignal<T[]>, value: T): boolean {
    return selection().includes(value);
  }

  toggleSelection<T extends string | number>(selection: WritableSignal<T[]>, value: T): void {
    const current = selection();
    selection.set(current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
    this.page.set(1);
  }

  clearFilters(): void {
    this.query.set('');
    this.selectedAreas.set([]);
    this.selectedYears.set([]);
    this.selectedTypes.set([]);
    this.selectedCareers.set([]);
    this.selectedSubjects.set([]);
    this.selectedDepartments.set([]);
    this.selectedAuthors.set([]);
    this.groupQueries.set({});
    this.expandedGroups.set([]);
    this.favoritesOnly.set(false);
    this.page.set(1);
  }

  readonly hasActiveFilters = computed(() => this.activeFilters().length > 0);

  toggleFavorite(id: number): void {
    if (!this.conSesion) {
      this.actionNotice.set('Inicia sesión para guardar y ver tus favoritos.');
      return;
    }
    const anterior = this.favoriteIds();
    const guardado = anterior.includes(id);
    // Se marca al instante y se revierte si falla.
    this.favoriteIds.set(guardado ? anterior.filter((item) => item !== id) : [...anterior, id]);
    const peticion = guardado
      ? this.catalogoApi.quitarFavorito(id)
      : this.catalogoApi.guardarFavorito(id);
    peticion.subscribe({
      error: () => {
        this.favoriteIds.set(anterior);
        this.actionNotice.set('No se pudo actualizar tus favoritos. Inténtalo de nuevo.');
      }
    });
  }

  openWork(work: Work): void {
    if (!work.published) return;
    this.selectedWork.set(work);
    globalThis.location.hash = `trabajo-${work.id}`;
  }

  closeWork(): void {
    this.selectedWork.set(null);
    if (globalThis.location.hash.startsWith('#trabajo-')) globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);
  }

  async shareWork(work: Work): Promise<void> {
    const link = `${globalThis.location.origin}${globalThis.location.pathname}#trabajo-${work.id}`;
    try {
      await globalThis.navigator.clipboard.writeText(link);
      this.actionNotice.set('Enlace de la ficha copiado. Solo permite abrir una publicación vigente.');
    } catch {
      this.actionNotice.set(`Copia este enlace público: ${link}`);
    }
  }

  movePage(direction: number): void {
    this.goToPage(this.currentPage() + direction);
  }

  goToPage(pagina: number): void {
    this.page.set(Math.min(this.pageCount(), Math.max(1, pagina)));
    document.getElementById('catalogo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Números de página: la primera, la última y las vecinas de la actual (0 = "…"). */
  readonly pageNumbers = computed(() => {
    const total = this.pageCount(), actual = this.currentPage();
    const paginas = [...new Set([1, actual - 1, actual, actual + 1, total])]
      .filter((p) => p >= 1 && p <= total)
      .sort((a, b) => a - b);
    return paginas.flatMap((p, i) => (i > 0 && p - paginas[i - 1] > 1 ? [0, p] : [p]));
  });

  permissionAllowsResource(work: Work, resourceId: number): boolean {
    return work.permission === 'Ficha y materiales autorizados' && work.approvedResourceIds.includes(resourceId);
  }

  /** Panel de filtros. En celular empieza cerrado. */
  readonly filtersOpen = signal(!(globalThis.matchMedia?.('(max-width: 760px)').matches ?? false));

  private readonly injector = inject(Injector);
  private abrirConArea = false;

  /**
   * Contrae el panel al bajar y lo vuelve a abrir al regresar arriba.
   * Los umbrales son distintos para que no se abra y cierre en bucle.
   */
  private contraerFiltrosAlBajar(): void {
    if (typeof window === 'undefined') return;
    // Más o menos una fila de trabajos.
    const bajar = 900;
    const subir = 150;
    const escritorio = window.matchMedia('(min-width: 761px)');
    let marca = window.scrollY;
    let estabaAbierto = this.filtersOpen();
    let contraidoSolo = false;
    let quietoHasta = 0;
    // No se cierra mientras se escribe en un buscador del panel.
    const usandoPanel = () => !!document.activeElement?.matches('.filters input[type="search"]');
    const alDesplazar = () => {
      // Ignora el scroll que provoca el propio cambio.
      if (performance.now() < quietoHasta) return;
      const y = window.scrollY;
      const abierto = this.filtersOpen();
      // Si se abre estando abajo, cuenta desde ahí.
      if (abierto && !estabaAbierto) {
        marca = y;
        contraidoSolo = false;
      }
      estabaAbierto = abierto;
      if (y < marca) marca = y;
      if (abierto && y > bajar && y - marca > 600 && !usandoPanel()) {
        this.filtersOpen.set(false);
        estabaAbierto = false;
        contraidoSolo = true;
        quietoHasta = performance.now() + 400;
      } else if (!abierto && y < subir && contraidoSolo) {
        contraidoSolo = false;
        // En celular no se abre solo: movería la lista.
        if (escritorio.matches) {
          this.filtersOpen.set(true);
          estabaAbierto = true;
          marca = y;
          quietoHasta = performance.now() + 400;
        }
      }
    };
    window.addEventListener('scroll', alDesplazar, { passive: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', alDesplazar));
  }
}
