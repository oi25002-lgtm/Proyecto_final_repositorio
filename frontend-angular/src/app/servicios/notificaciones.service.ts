import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../api-url';
import { cabeceraSesion } from './cabecera-sesion';

/** Avisos dentro del sistema. */
@Injectable({ providedIn: 'root' })
export class NotificacionesService {
  private readonly http = inject(HttpClient);

  /** GET /api/notificaciones */
  listar<T>(): Observable<T[]> {
    return this.http.get<T[]>(API_URL + '/notificaciones', { headers: cabeceraSesion() });
  }

  /** POST /api/notificaciones/{id}/leida */
  marcarLeida(id: number): Observable<unknown> {
    return this.http.post(API_URL + '/notificaciones/' + id + '/leida', null, { headers: cabeceraSesion() });
  }

  /** POST /api/notificaciones/leidas: marca todas. */
  marcarTodas(): Observable<unknown> {
    return this.http.post(API_URL + '/notificaciones/leidas', null, { headers: cabeceraSesion() });
  }
}
