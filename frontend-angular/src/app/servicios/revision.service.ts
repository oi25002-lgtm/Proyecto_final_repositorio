import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../api-url';
import { cabeceraSesion } from './cabecera-sesion';

type Mensaje = { mensaje: string };

/** Trabajo del supervisor: revisar, decidir, publicar y consultar estadísticas. */
@Injectable({ providedIn: 'root' })
export class RevisionService {
  private readonly http = inject(HttpClient);
  private readonly base = API_URL + '/revision';

  /** GET /api/revision/pendientes */
  pendientes<T>(): Observable<T[]> {
    return this.http.get<T[]>(this.base + '/pendientes', { headers: cabeceraSesion() });
  }

  /** GET /api/revision/publicaciones */
  publicaciones<T>(): Observable<T[]> {
    return this.http.get<T[]>(this.base + '/publicaciones', { headers: cabeceraSesion() });
  }

  /** GET /api/revision/estadisticas */
  estadisticas<T>(): Observable<T> {
    return this.http.get<T>(this.base + '/estadisticas', { headers: cabeceraSesion() });
  }

  /** POST /api/revision/{id}/iniciar: la entrega pasa a «en revisión». */
  iniciar(idEntrega: number): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/' + idEntrega + '/iniciar', {}, { headers: cabeceraSesion() });
  }

  /** POST /api/revision/{id}/decision: aprobar, pedir correcciones o rechazar. */
  decidir(idEntrega: number, cuerpo: unknown): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/' + idEntrega + '/decision', cuerpo, { headers: cabeceraSesion() });
  }

  /** PUT /api/revision/proyectos/{id}/permiso */
  guardarPermiso(idProyecto: number, cuerpo: unknown): Observable<Mensaje> {
    return this.http.put<Mensaje>(this.base + '/proyectos/' + idProyecto + '/permiso', cuerpo, {
      headers: cabeceraSesion()
    });
  }

  /** PUT /api/revision/proyectos/{id}/destacado */
  cambiarDestacado(idProyecto: number, destacado: boolean): Observable<Mensaje & { destacado: boolean }> {
    return this.http.put<Mensaje & { destacado: boolean }>(
      this.base + '/proyectos/' + idProyecto + '/destacado',
      { destacado },
      { headers: cabeceraSesion() }
    );
  }

  /** POST /api/revision/proyectos/{id}/retirar */
  retirar(idProyecto: number, motivo: string): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/proyectos/' + idProyecto + '/retirar', { motivo }, {
      headers: cabeceraSesion()
    });
  }
}
