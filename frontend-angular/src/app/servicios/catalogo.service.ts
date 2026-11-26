import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../api-url';
import { cabeceraSesion } from './cabecera-sesion';

/** Catálogo público, catálogos de clasificación y favoritos. */
@Injectable({ providedIn: 'root' })
export class CatalogoService {
  private readonly http = inject(HttpClient);

  /** GET /api/catalogo: fichas publicadas. */
  fichas<T>(): Observable<T[]> {
    return this.http.get<T[]>(API_URL + '/catalogo');
  }

  /** GET /api/catalogos/...: departamentos, carreras, temáticas, tipos, materias o docentes. */
  listar<T>(endpoint: string, params?: Record<string, string | number | boolean>): Observable<T[]> {
    return this.http.get<T[]>(API_URL + endpoint, params ? { params } : {});
  }

  /** GET /api/favoritos: ids de los proyectos guardados. */
  favoritos(): Observable<number[]> {
    return this.http.get<number[]>(API_URL + '/favoritos', { headers: cabeceraSesion() });
  }

  /** PUT /api/favoritos/{id} */
  guardarFavorito(idProyecto: number): Observable<unknown> {
    return this.http.put(API_URL + '/favoritos/' + idProyecto, null, { headers: cabeceraSesion() });
  }

  /** DELETE /api/favoritos/{id} */
  quitarFavorito(idProyecto: number): Observable<unknown> {
    return this.http.delete(API_URL + '/favoritos/' + idProyecto, { headers: cabeceraSesion() });
  }
}
