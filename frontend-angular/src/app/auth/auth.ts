import { ChangeDetectorRef, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { mensajeDeError, validarContrasenaNueva, validarCorreo, validarNombre } from '../compartido/validacion';
import { AUTH_EXPIRY_KEY, AUTH_TOKEN_KEY, AUTH_USER_KEY } from './auth.constants';
import { AutenticacionService } from '../servicios/autenticacion.service';

type AuthMode = 'login' | 'registro';

interface AuthResponse {
  token: string;
  expiraUtc: string;
  usuario: {
    id: number;
    nombres: string;
    apellidos: string;
    correo: string;
    roles?: string[];
  };
}

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './auth.html',
  styleUrl: './auth.css'
})
export class AuthComponent {
  readonly mode = input<AuthMode>('login');

  private readonly autenticacion = inject(AutenticacionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);

  nombres = '';
  apellidos = '';
  correo = '';
  contrasena = '';
  confirmarContrasena = '';
  enviando = false;
  mensajeError = '';
  /** Error de cada campo ('' = sin error). */
  errores: Partial<Record<'nombres' | 'apellidos' | 'correo' | 'contrasena' | 'confirmarContrasena', string>> = {};

  limpiarError(campo: keyof AuthComponent['errores']): void {
    if (this.errores[campo]) {
      this.errores = { ...this.errores, [campo]: '' };
    }
  }

  private validar(mode: AuthMode): boolean {
    const errores: AuthComponent['errores'] = {};
    if (mode === 'registro') {
      errores.nombres = validarNombre(this.nombres, 'tus nombres');
      errores.apellidos = validarNombre(this.apellidos, 'tus apellidos');
    }
    errores.correo = validarCorreo(this.correo);
    if (mode === 'registro') {
      errores.contrasena = validarContrasenaNueva(this.contrasena);
      errores.confirmarContrasena = !this.confirmarContrasena
        ? 'Confirma tu contraseña.'
        : this.contrasena !== this.confirmarContrasena ? 'Las contraseñas no coinciden.' : '';
    } else {
      errores.contrasena = this.contrasena ? '' : 'Escribe tu contraseña.';
    }
    this.errores = errores;
    const primero = (Object.keys(errores) as (keyof typeof errores)[]).find(campo => errores[campo]);
    if (primero) {
      globalThis.document?.querySelector<HTMLInputElement>('input[name=' + primero + ']')?.focus();
    }
    return !primero;
  }

  get returnUrl(): string {
    const requested = this.route.snapshot.queryParamMap.get('returnUrl');
    return requested?.startsWith('/') && !requested.startsWith('//')
      ? requested
      : '/catalogo';
  }

  /** Vuelve a la página que se pidió o entra a la pantalla de su rol. */
  private destinoTrasIngresar(roles: string[]): string {
    if (this.route.snapshot.queryParamMap.has('returnUrl') && this.returnUrl !== '/catalogo') {
      const pideRevision = this.returnUrl.startsWith('/revision-supervisor');
      if (!pideRevision || roles.includes('supervisor')) {
        return this.returnUrl;
      }
    }

    if (roles.includes('administrador')) {
      return '/admin';
    }

    if (roles.includes('supervisor')) {
      return '/revision-supervisor';
    }

    return '/mis-proyectos';
  }

  get queryParams(): Record<string, string> | null {
    return this.returnUrl === '/catalogo'
      ? null
      : { returnUrl: this.returnUrl };
  }

  async submit(): Promise<void> {
    if (this.enviando) return;

    const mode = this.mode();
    this.mensajeError = '';

    if (!this.validar(mode)) {
      return;
    }

    const endpoint = mode === 'login' ? 'login' : 'registro';
    const payload = mode === 'login'
      ? {
          correo: this.correo.trim(),
          contrasena: this.contrasena
        }
      : {
          nombres: this.nombres.trim(),
          apellidos: this.apellidos.trim(),
          correo: this.correo.trim(),
          contrasena: this.contrasena
        };

    this.enviando = true;

    try {
      const response = await firstValueFrom(
        this.autenticacion.enviar<AuthResponse>(endpoint, payload).pipe(timeout(30000))
      );

      try {
        globalThis.sessionStorage.setItem(AUTH_TOKEN_KEY, response.token);
        globalThis.sessionStorage.setItem(AUTH_EXPIRY_KEY, response.expiraUtc);
        globalThis.sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(response.usuario));
      } catch {
        this.mensajeError = 'El navegador no permitió guardar la sesión. Habilita el almacenamiento y vuelve a intentarlo.';
        return;
      }

      await this.router.navigateByUrl(this.destinoTrasIngresar(response.usuario.roles ?? []));
    } catch (error: unknown) {
      this.mensajeError = mensajeDeError(error, 'No se pudo completar la solicitud. Revisa los datos e inténtalo de nuevo.');
    } finally {
      this.enviando = false;
      this.cdr.markForCheck();
    }
  }
}