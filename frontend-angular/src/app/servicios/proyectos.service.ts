import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../api-url';
import { cabeceraSesion } from './cabecera-sesion';

/** Envíos del solicitante: enviar, corregir, actualizar, seguir y eliminar. */
@Injectable({ providedIn: 'root' })
export class ProyectosService {
  private readonly http = inject(HttpClient);

  /**
   * POST /api/proyectos (envío nuevo),
   * /api/proyectos/mis-proyectos/{id}/reenvio o /actualizacion.
   */
  enviar<T>(ruta: string, datos: FormData): Observable<T> {
    return this.http.post<T>(API_URL + ruta, datos, { headers: cabeceraSesion() });
  }

  /** GET /api/proyectos/mis-proyectos */
  misProyectos<T>(): Observable<T[]> {
    return this.http.get<T[]>(API_URL + '/proyectos/mis-proyectos', { headers: cabeceraSesion() });
  }

  /** GET /api/proyectos/mis-proyectos/{id}: detalle de una entrega propia. */
  solicitud<T>(idEntrega: number): Observable<T> {
    return this.http.get<T>(API_URL + '/proyectos/mis-proyectos/' + idEntrega, { headers: cabeceraSesion() });
  }

  /** DELETE /api/proyectos/mis-proyectos/{id}: solo si sigue pendiente. */
  eliminarSolicitud(idEntrega: number): Observable<{ mensaje: string }> {
    return this.http.delete<{ mensaje: string }>(API_URL + '/proyectos/mis-proyectos/' + idEntrega, {
      headers: cabeceraSesion()
    });
  }

  /** GET /api/proyectos/recursos/{id}: descarga un PDF o ZIP como archivo. */
  descargarRecurso(idRecurso: number): Observable<Blob> {
    return this.http.get(API_URL + '/proyectos/recursos/' + idRecurso, {
      headers: cabeceraSesion(),
      responseType: 'blob'
    });
  }
}
