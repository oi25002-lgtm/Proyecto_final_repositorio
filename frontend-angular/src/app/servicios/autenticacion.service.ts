import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AUTH_API_URL } from '../auth/auth.constants';

/** Inicio de sesión y registro de cuentas. */
@Injectable({ providedIn: 'root' })
export class AutenticacionService {
  private readonly http = inject(HttpClient);

  /** POST /api/auth/{login|registro} */
  enviar<T>(endpoint: string, datos: unknown): Observable<T> {
    return this.http.post<T>(AUTH_API_URL + '/' + endpoint, datos);
  }
}
