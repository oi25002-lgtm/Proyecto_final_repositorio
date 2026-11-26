import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AUTH_USER_KEY } from '../../auth/auth.constants';
import { cerrarSesion, usuarioTieneRol } from '../../auth/auth.guard';
import { SesionUsuarioComponent } from '../../auth/sesion-usuario';
import { OpcionBuscable, SelectorBuscable } from '../../compartido/selector-buscable';
import { validarContrasenaNueva, validarCorreo, validarNombre } from '../../compartido/validacion';
import { AdminService } from '../../servicios/admin.service';


type Role = 'Solicitante' | 'Supervisor' | 'Administrador';

/** En la base de datos el rol de solicitante se llama "usuario". */
const ROL_API: Record<Role, string> = {
  Solicitante: 'usuario',
  Supervisor: 'supervisor',
  Administrador: 'administrador'
};

interface AdminUser {
  id: number;
  username: string;
  name: string;
  roles: Role[];
  active: boolean;
  codigoDocente: string | null;
}

interface UsuarioApi {
  id: number;
  correo: string;
  nombres: string;
  apellidos: string;
  activo: boolean;
  roles: string[];
  codigoDocente: string | null;
}

type AdminTab = 'cuentas' | 'materias' | 'tematicas' | 'carreras' | 'departamentos';
type CatalogKey = Exclude<AdminTab, 'cuentas'>;
/** Fuente de una lista desplegable: otro catálogo o los docentes registrados. */
type OptionSource = CatalogKey | 'docentes';
type CatalogRow = Record<string, string> & { id: string };

interface CatalogField {
  key: string;
  label: string;
  required?: boolean;
  /** Si existe, el campo es una lista desplegable con los registros de esa fuente. */
  optionsFrom?: OptionSource;
  /** Campo que se envía a la API con el id elegido en la lista. */
  apiKey?: string;
  /** Opciones fijas de la lista (por ejemplo, los ciclos 1 a 12). */
  options?: Option[];
  /** Solo se pide al agregar; no es una columna de la tabla. */
  formOnly?: boolean;
  /** Solo es una columna de la tabla; no se pide en el formulario. */
  tableOnly?: boolean;
}

/** Carreras (con ciclo) y docentes de una materia. */
interface MateriaLinks {
  plan: { idCarrera: number; carrera: string; ciclo: number }[];
  imparten: { idDocente: number; nombre: string }[];
}

const ROMANOS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV'];
const CICLOS: { value: string; label: string }[] =
  ROMANOS.slice(1).map((romano, i) => ({ value: String(i + 1), label: 'Ciclo ' + romano }));

interface CatalogDef {
  tab: CatalogKey;
  label: string;
  singular: string;
  fields: CatalogField[];
}

interface Option {
  value: string;
  label: string;
  detalle?: string;
}

type PendingChange =
  | { kind: 'create' }
  | { kind: 'role'; id: number; role: Role; enabled: boolean }
  | { kind: 'active'; id: number }
  | { kind: 'delete'; catalog: CatalogKey; id: string };

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, SesionUsuarioComponent, SelectorBuscable],
  templateUrl: './admin-panel.html',
  styleUrl: './admin-panel.css'
})
export class AdminPanel {
  private readonly router = inject(Router);
  private readonly adminApi = inject(AdminService);

  readonly roles: { name: Role; description: string }[] = [
    {
      name: 'Solicitante',
      description: 'Envía trabajos y ve su estado.'
    },
    {
      name: 'Supervisor',
      description: 'Revisa entregas y decide si se publican.'
    },
    {
      name: 'Administrador',
      description: 'Gestiona cuentas, roles y catálogos.'
    }
  ];
  readonly roleNames: Role[] = this.roles.map(role => role.name);

  readonly tabs: { tab: AdminTab; label: string }[] = [
    { tab: 'cuentas', label: 'Cuentas y accesos' },
    { tab: 'materias', label: 'Materias' },
    { tab: 'tematicas', label: 'Temáticas' },
    { tab: 'carreras', label: 'Carreras' },
    { tab: 'departamentos', label: 'Departamentos' }
  ];

  readonly catalogDefs: Record<CatalogKey, CatalogDef> = {
    materias: {
      tab: 'materias', label: 'Materias', singular: 'materia',
      fields: [
        { key: 'codigo', label: 'Código', required: true },
        { key: 'nombre', label: 'Nombre', required: true },
        { key: 'carrera', label: 'Carrera', required: true, optionsFrom: 'carreras', apiKey: 'idCarrera', formOnly: true },
        { key: 'ciclo', label: 'Ciclo', required: true, options: CICLOS, apiKey: 'ciclo', formOnly: true },
        { key: 'docente', label: 'Docente', required: true, optionsFrom: 'docentes', apiKey: 'idDocente', formOnly: true },
        { key: 'carreras', label: 'Carreras (ciclo)', tableOnly: true },
        { key: 'docentes', label: 'Docentes', tableOnly: true },
        { key: 'descripcion', label: 'Descripción' }
      ]
    },
    tematicas: {
      tab: 'tematicas', label: 'Temáticas', singular: 'temática',
      fields: [
        { key: 'nombre', label: 'Nombre', required: true },
        { key: 'descripcion', label: 'Descripción' }
      ]
    },
    carreras: {
      tab: 'carreras', label: 'Carreras', singular: 'carrera',
      fields: [
        { key: 'codigo', label: 'Código', required: true },
        { key: 'nombre', label: 'Nombre', required: true },
        { key: 'departamento', label: 'Departamento', required: true, optionsFrom: 'departamentos', apiKey: 'idDepartamento' }
      ]
    },
    departamentos: {
      tab: 'departamentos', label: 'Departamentos', singular: 'departamento',
      fields: [
        { key: 'nombre', label: 'Nombre', required: true },
        { key: 'descripcion', label: 'Descripción' }
      ]
    }
  };

  /** Sección de la ruta /admin/:seccion. */
  readonly seccion = input<string>();
  readonly activeTab = computed<AdminTab>(() => {
    const value = this.seccion();
    return this.tabs.find(item => item.tab === value)?.tab ?? 'cuentas';
  });
  readonly catalogData = signal<Record<CatalogKey, CatalogRow[]>>({
    materias: [], tematicas: [], carreras: [], departamentos: []
  });
  readonly docentes = signal<Option[]>([]);
  /** Carreras y docentes de cada materia, por id. */
  readonly materiaLinks = signal<Record<string, MateriaLinks>>({});
  readonly draft = signal<Record<string, string>>({});
  readonly loading = signal(false);
  readonly saving = signal(false);

  readonly activeCatalog = computed<CatalogDef | null>(() => {
    const tab = this.activeTab();
    return tab === 'cuentas' ? null : this.catalogDefs[tab];
  });

  readonly pageTitle = computed(() =>
    this.activeTab() === 'cuentas' ? 'Cuentas y accesos' : this.catalogDefs[this.activeTab() as CatalogKey].label
  );

  readonly formFields = computed(() => this.activeCatalog()?.fields.filter(field => !field.tableOnly) ?? []);
  readonly tableFields = computed(() => this.activeCatalog()?.fields.filter(field => !field.formOnly) ?? []);

  readonly filteredCatalogRows = computed(() => {
    const catalog = this.activeCatalog();
    if (!catalog) return [];
    const query = this.search().trim().toLowerCase();
    const rows = this.catalogData()[catalog.tab];
    if (!query) return rows;
    return rows.filter(row =>
      catalog.fields.some(field => (row[field.key] ?? '').toLowerCase().includes(query))
    );
  });

  // Registro de docentes.
  // RF-22: cuenta de supervisor o administrador creada por el administrador
  readonly nuevaNombres = signal('');
  readonly nuevaApellidos = signal('');
  readonly nuevaCorreo = signal('');
  readonly nuevaContrasena = signal('');
  readonly nuevaSupervisor = signal(false);
  readonly nuevaAdministrador = signal(false);

  readonly docenteUserId = signal('');
  readonly docenteCode = signal('');
  readonly docenteDepto = signal('');

  // Ventana "Carreras y docentes" de una materia.
  readonly cicloOptions = CICLOS;
  readonly managingId = signal<string | null>(null);
  readonly linkCarrera = signal('');
  readonly linkCiclo = signal('');
  readonly linkDocente = signal('');
  readonly linkNotice = signal('');
  readonly managedMateria = computed(() => {
    const id = this.managingId();
    if (!id) return null;
    const row = this.catalogData().materias.find(item => item.id === id);
    if (!row) return null;
    const links = this.materiaLinks()[id] ?? { plan: [], imparten: [] };
    return {
      id,
      nombre: row['nombre'] ?? '',
      codigo: row['codigo'] ?? '',
      plan: links.plan,
      imparten: links.imparten,
      // Solo se ofrecen las carreras y docentes que todavía no están.
      carrerasLibres: this.catalogData().carreras
        .filter(carrera => !links.plan.some(item => String(item.idCarrera) === carrera.id))
        .map(carrera => ({ value: carrera.id, label: carrera['nombre'] ?? '', detalle: carrera['codigo'] })),
      docentesLibres: this.docentes().filter(docente =>
        !links.imparten.some(item => String(item.idDocente) === docente.value))
    };
  });
  readonly actionNotice = signal('');
  readonly search = signal('');
  readonly showRolesHelp = signal(false);
  readonly esSupervisor = usuarioTieneRol('supervisor');
  private readonly ownId = this.sessionUserId();

  readonly users = signal<AdminUser[]>([]);

  readonly filteredUsers = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) return this.users();
    return this.users().filter(user =>
      user.username.toLowerCase().includes(query) || user.name.toLowerCase().includes(query)
    );
  });

  // Tablas por páginas; la búsqueda revisa todos los registros.
  readonly pageSize = 10;
  readonly page = signal(1);

  private readonly activeRows = computed<unknown[]>(() =>
    this.activeTab() === 'cuentas' ? this.filteredUsers() : this.filteredCatalogRows()
  );
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.activeRows().length / this.pageSize)));
  private readonly pageStart = computed(() => (Math.min(this.page(), this.totalPages()) - 1) * this.pageSize);
  readonly pagedUsers = computed(() => this.filteredUsers().slice(this.pageStart(), this.pageStart() + this.pageSize));
  readonly pagedCatalogRows = computed(() =>
    this.filteredCatalogRows().slice(this.pageStart(), this.pageStart() + this.pageSize)
  );

  setSearch(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  goToPage(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.totalPages()));
  }

  /** Cuentas que todavía no son docentes, para el formulario de registro. */
  readonly nonTeacherUsers = computed(() => this.users().filter(user => !user.codigoDocente));

  // Confirmación con contraseña del administrador
  readonly pending = signal<PendingChange | null>(null);
  readonly password = signal('');
  readonly passwordError = signal('');
  readonly verifying = signal(false);

  readonly pendingDescription = computed(() => {
    const change = this.pending();
    if (!change) return '';
    if (change.kind === 'create') {
      return 'Crear la cuenta ' + this.nuevaCorreo().trim().toLowerCase() + ' con el rol ' +
        this.rolesNuevaCuenta().join(', ') + '.';
    }
    if (change.kind === 'delete') {
      const row = this.catalogData()[change.catalog].find(item => item.id === change.id);
      return row
        ? 'Eliminar «' + (row['nombre'] ?? '') + '» de ' + this.catalogDefs[change.catalog].label + '.'
        : '';
    }
    const user = this.users().find(item => item.id === change.id);
    if (!user) return '';
    if (change.kind === 'role') {
      return (change.enabled ? 'Asignar' : 'Quitar') + ' el rol ' + change.role +
        (change.enabled ? ' a ' : ' de ') + user.username + '.';
    }
    return (user.active ? 'Deshabilitar' : 'Habilitar') + ' la cuenta de ' + user.username + '.';
  });

  readonly navegar = {
    emit: (pantalla: 'catalog' | 'admin' | 'supervisor' | 'login'): void => {
      if (pantalla === 'login') {
        cerrarSesion();
      }

      const rutas = {
        catalog: '/catalogo',
        admin: '/admin',
        supervisor: '/revision-supervisor',
        login: '/iniciar-sesion'
      };

      void this.router.navigateByUrl(rutas[pantalla]);
    }
  };

  constructor() {
    effect(() => {
      const tab = this.activeTab();
      untracked(() => {
        this.search.set('');
        this.page.set(1);
        this.draft.set({});
        this.actionNotice.set('');
        void this.loadTab(tab);
      });
    });
  }

  /** Esta cuenta no puede quitarse el rol de administrador ni deshabilitarse. */
  isSelf(user: AdminUser): boolean {
    return user.id === this.ownId;
  }

  setDraft(key: string, value: string): void {
    this.draft.update(current => ({ ...current, [key]: value }));
  }

  /** Fuentes largas que usan el selector con buscador. */
  readonly searchableSources: OptionSource[] = ['docentes', 'carreras'];
  readonly sourceOptions = computed<Record<OptionSource, OpcionBuscable[]>>(() => {
    const desde = (rows: CatalogRow[]) => rows.map(row => ({ value: row.id, label: row['nombre'] ?? '' }));
    const data = this.catalogData();
    return {
      docentes: this.docentes(),
      carreras: data.carreras.map(row => ({ value: row.id, label: row['nombre'] ?? '', detalle: row['codigo'] })),
      materias: desde(data.materias),
      tematicas: desde(data.tematicas),
      departamentos: desde(data.departamentos)
    };
  });

  isSearchable(field: CatalogField): boolean {
    return !!field.optionsFrom && this.searchableSources.includes(field.optionsFrom);
  }

  /** Cuentas que se pueden registrar como docentes, con su correo para buscar. */
  readonly accountOptions = computed<OpcionBuscable[]>(() =>
    this.nonTeacherUsers().map(user => ({ value: String(user.id), label: user.name, detalle: user.username })));

  optionsFor(field: CatalogField): Option[] {
    if (field.options) return field.options;
    if (!field.optionsFrom) return [];
    if (field.optionsFrom === 'docentes') return this.docentes();
    return this.catalogData()[field.optionsFrom].map(row => ({ value: row.id, label: row['nombre'] ?? '' }));
  }

  async addCatalogRow(): Promise<void> {
    const catalog = this.activeCatalog();
    if (!catalog || this.saving()) return;
    const draft = this.draft();
    const missing = catalog.fields.some(field => field.required && !(draft[field.key] ?? '').trim());
    if (missing) {
      this.actionNotice.set('Completa los campos obligatorios.');
      return;
    }

    const body: Record<string, string | number> = {};
    for (const field of catalog.fields) {
      const value = (draft[field.key] ?? '').trim();
      if (!value) continue;
      if (field.apiKey) {
        body[field.apiKey] = Number(value);
      } else {
        body[field.key] = value;
      }
    }

    this.saving.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.adminApi.agregarACatalogo(catalog.tab, body)
      );
      this.draft.set({});
      this.actionNotice.set(respuesta.mensaje);
      await this.loadCatalog(catalog.tab);
    } catch (error: unknown) {
      this.actionNotice.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  romano(ciclo: number): string {
    return ROMANOS[ciclo] ?? String(ciclo);
  }

  openLinks(id: string): void {
    this.linkCarrera.set('');
    this.linkCiclo.set('');
    this.linkDocente.set('');
    this.linkNotice.set('');
    this.managingId.set(id);
  }

  closeLinks(): void {
    if (this.saving()) return;
    this.managingId.set(null);
  }

  /** Agrega la materia al plan de otra carrera o le agrega otro docente. */
  async addLink(kind: 'carrera' | 'docente'): Promise<void> {
    const id = this.managingId();
    if (!id || this.saving()) return;
    const body = kind === 'carrera'
      ? { idCarrera: Number(this.linkCarrera()), ciclo: Number(this.linkCiclo()) }
      : { idDocente: Number(this.linkDocente()) };
    if (kind === 'carrera' ? !body.idCarrera || !body.ciclo : !body.idDocente) {
      this.linkNotice.set(kind === 'carrera' ? 'Elige la carrera y el ciclo.' : 'Elige el docente.');
      return;
    }
    await this.saveLink(() => firstValueFrom(this.adminApi.vincularMateria(
      id, kind === 'carrera' ? 'carreras' : 'docentes', body)));
    this.linkCarrera.set('');
    this.linkCiclo.set('');
    this.linkDocente.set('');
  }

  async removeLink(kind: 'carrera' | 'docente', linkId: number): Promise<void> {
    const id = this.managingId();
    if (!id || this.saving()) return;
    await this.saveLink(() => firstValueFrom(this.adminApi.desvincularMateria(
      id, kind === 'carrera' ? 'carreras' : 'docentes', linkId)));
  }

  private async saveLink(request: () => Promise<{ mensaje: string }>): Promise<void> {
    this.saving.set(true);
    try {
      const respuesta = await request();
      this.linkNotice.set(respuesta.mensaje);
      await this.loadCatalog('materias');
    } catch (error: unknown) {
      this.linkNotice.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  requestDelete(catalog: CatalogKey, id: string): void {
    this.openPasswordDialog({ kind: 'delete', catalog, id });
  }

  initials(user: AdminUser): string {
    return user.name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join('');
  }

  /** Registra una cuenta como docente. */
  async registerTeacher(): Promise<void> {
    const idUsuario = Number(this.docenteUserId());
    const codigo = this.docenteCode().trim();
    const idDepartamento = Number(this.docenteDepto());
    if (!idUsuario || !codigo || !idDepartamento) {
      this.actionNotice.set('Elige la cuenta, escribe su código docente y elige su departamento.');
      return;
    }

    this.saving.set(true);
    try {
      const respuesta = await firstValueFrom(
        this.adminApi.registrarDocente({ idUsuario, codigo, idDepartamento })
      );
      this.docenteUserId.set('');
      this.docenteCode.set('');
      this.docenteDepto.set('');
      this.actionNotice.set(respuesta.mensaje);
      await this.loadUsers();
    } catch (error: unknown) {
      this.actionNotice.set(this.errorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  private rolesNuevaCuenta(): string[] {
    return [...(this.nuevaSupervisor() ? ['supervisor'] : []), ...(this.nuevaAdministrador() ? ['administrador'] : [])];
  }

  /** Revisa el formulario y pide la contraseña del administrador para crear la cuenta. */
  requestCreateAccount(): void {
    const error = validarNombre(this.nuevaNombres(), 'los nombres') ||
      validarNombre(this.nuevaApellidos(), 'los apellidos') ||
      validarCorreo(this.nuevaCorreo()).replace('tu correo', 'el correo') ||
      validarContrasenaNueva(this.nuevaContrasena()) ||
      (this.rolesNuevaCuenta().length ? '' : 'Elige si la cuenta es de supervisor, de administrador o ambas.');
    if (error) {
      this.actionNotice.set(error);
      return;
    }
    this.actionNotice.set('');
    this.openPasswordDialog({ kind: 'create' });
  }

  /** Pide confirmar con la contraseña antes de cambiar un rol. */
  requestRoleChange(user: AdminUser, role: Role, enabled: boolean): void {
    if (this.isSelf(user) && role === 'Administrador' && !enabled) return;
    this.openPasswordDialog({ kind: 'role', id: user.id, role, enabled });
  }

  requestActiveChange(user: AdminUser): void {
    if (this.isSelf(user)) return;
    this.openPasswordDialog({ kind: 'active', id: user.id });
  }

  private openPasswordDialog(change: PendingChange): void {
    this.password.set('');
    this.passwordError.set('');
    this.pending.set(change);
  }

  cancelPending(): void {
    if (this.verifying()) return;
    this.pending.set(null);
    this.password.set('');
    this.passwordError.set('');
  }

  async confirmPending(): Promise<void> {
    const change = this.pending();
    if (!change || this.verifying()) return;

    if (!this.password()) {
      this.passwordError.set('Escribe tu contraseña.');
      return;
    }

    this.verifying.set(true);
    this.passwordError.set('');

    try {
      // La API vuelve a comprobar la contraseña.
      const mensaje = await this.applyChange(change, this.password());
      this.pending.set(null);
      this.password.set('');
      this.actionNotice.set(mensaje);
    } catch (error: unknown) {
      this.passwordError.set(this.errorMessage(error));
    } finally {
      this.verifying.set(false);
    }
  }

  private async applyChange(change: PendingChange, contrasena: string): Promise<string> {
    if (change.kind === 'create') {
      const respuesta = await firstValueFrom(this.adminApi.crearCuenta(
        {
          nombres: this.nuevaNombres().trim(),
          apellidos: this.nuevaApellidos().trim(),
          correo: this.nuevaCorreo().trim(),
          contrasena: this.nuevaContrasena(),
          roles: this.rolesNuevaCuenta(),
          contrasenaAdministrador: contrasena
        }
      ));
      for (const campo of [this.nuevaNombres, this.nuevaApellidos, this.nuevaCorreo, this.nuevaContrasena]) campo.set('');
      this.nuevaSupervisor.set(false);
      this.nuevaAdministrador.set(false);
      await this.loadUsers();
      return respuesta.mensaje;
    }
    if (change.kind === 'delete') {
      const respuesta = await firstValueFrom(this.adminApi.eliminarDeCatalogo(change.catalog, change.id, contrasena));
      await this.loadCatalog(change.catalog);
      return respuesta.mensaje;
    }

    const user = this.users().find(item => item.id === change.id);
    if (change.kind === 'role') {
      const respuesta = await firstValueFrom(this.adminApi.cambiarRol(change.id, { rol: ROL_API[change.role], asignar: change.enabled, contrasena }));
      await this.loadUsers();
      return respuesta.mensaje;
    }

    const respuesta = await firstValueFrom(this.adminApi.cambiarActivo(change.id, { activo: !(user?.active ?? true), contrasena }));
    await this.loadUsers();
    return respuesta.mensaje;
  }

  // ----- Carga de datos -----

  private async loadTab(tab: AdminTab): Promise<void> {
    this.loading.set(true);
    try {
      if (tab === 'cuentas') {
        await this.loadUsers();
        await this.loadCatalog('departamentos');
      } else {
        await this.loadCatalog(tab);
        if (tab === 'carreras') await this.loadCatalog('departamentos');
        if (tab === 'materias') {
          await this.loadCatalog('carreras');
          await this.loadTeachers();
        }
      }
    } catch (error: unknown) {
      this.actionNotice.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  private async loadUsers(): Promise<void> {
    const datos = await firstValueFrom(
      this.adminApi.usuarios<UsuarioApi>()
    );
    this.users.set(datos.map(usuario => ({
      id: usuario.id,
      username: usuario.correo,
      name: (usuario.nombres + ' ' + usuario.apellidos).trim(),
      roles: this.roleNames.filter(role => usuario.roles.includes(ROL_API[role])),
      active: usuario.activo,
      codigoDocente: usuario.codigoDocente
    })));
  }

  private async loadCatalog(catalog: CatalogKey): Promise<void> {
    const datos = await firstValueFrom(
      this.adminApi.catalogo<Record<string, unknown>>(catalog)
    );
    const rows: CatalogRow[] = datos.map(item => {
      const row: CatalogRow = { id: String(item['id']) };
      for (const [key, value] of Object.entries(item)) {
        // Las listas de vínculos se guardan aparte.
        if (key !== 'id' && !Array.isArray(value)) row[key] = value === null || value === undefined ? '' : String(value);
      }
      return row;
    });
    this.catalogData.update(data => ({ ...data, [catalog]: rows }));
    if (catalog === 'materias') {
      this.materiaLinks.set(Object.fromEntries(datos.map(item => [
        String(item['id']),
        { plan: (item['plan'] ?? []) as MateriaLinks['plan'], imparten: (item['imparten'] ?? []) as MateriaLinks['imparten'] }
      ])));
    }
  }

  private async loadTeachers(): Promise<void> {
    const datos = await firstValueFrom(
      this.adminApi.catalogo<{ id: number; codigo: string; nombre: string; departamento: string }>('docentes')
    );
    this.docentes.set(datos.map(docente => ({
      value: String(docente.id),
      label: docente.nombre,
      detalle: docente.codigo + ' · ' + docente.departamento.replace(/^departamento de\s+/i, '')
    })));
  }


  private sessionUserId(): number | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(AUTH_USER_KEY);
      const id = raw ? (JSON.parse(raw) as { id?: unknown }).id : null;
      return typeof id === 'number' ? id : null;
    } catch {
      return null;
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const mensaje = error.error && typeof error.error.mensaje === 'string' ? error.error.mensaje : null;
      if (mensaje) return mensaje;
      if (error.status === 0) return 'No se pudo conectar con la API. Verifica que RepositorioApi esté iniciado.';
      if (error.status === 401) return 'Tu sesión venció. Inicia sesión de nuevo.';
      if (error.status === 403) return 'Tu cuenta no tiene el rol de administrador.';
    }
    return 'No se pudo completar la acción. Inténtalo de nuevo.';
  }
}
