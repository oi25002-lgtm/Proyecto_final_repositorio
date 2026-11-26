import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../api-url';
import { cabeceraSesion } from './cabecera-sesion';

type Mensaje = { mensaje: string };

/** Panel del administrador: cuentas, roles, docentes y catálogos. */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly base = API_URL + '/admin';

  private opciones() {
    return { headers: cabeceraSesion() };
  }

  /** GET /api/admin/usuarios */
  usuarios<T>(): Observable<T[]> {
    return this.http.get<T[]>(this.base + '/usuarios', this.opciones());
  }

  /** POST /api/admin/usuarios: cuenta de supervisor o administrador. */
  crearCuenta(cuerpo: unknown): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/usuarios', cuerpo, this.opciones());
  }

  /** PUT /api/admin/usuarios/{id}/roles */
  cambiarRol(idUsuario: number, cuerpo: unknown): Observable<Mensaje> {
    return this.http.put<Mensaje>(this.base + '/usuarios/' + idUsuario + '/roles', cuerpo, this.opciones());
  }

  /** PUT /api/admin/usuarios/{id}/activo */
  cambiarActivo(idUsuario: number, cuerpo: unknown): Observable<Mensaje> {
    return this.http.put<Mensaje>(this.base + '/usuarios/' + idUsuario + '/activo', cuerpo, this.opciones());
  }

  /** POST /api/admin/docentes */
  registrarDocente(cuerpo: unknown): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/docentes', cuerpo, this.opciones());
  }

  /** GET /api/admin/catalogos/{catalogo} */
  catalogo<T>(catalogo: string): Observable<T[]> {
    return this.http.get<T[]>(this.base + '/catalogos/' + catalogo, this.opciones());
  }

  /** POST /api/admin/catalogos/{catalogo}: nuevo registro. */
  agregarACatalogo(catalogo: string, cuerpo: unknown): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/catalogos/' + catalogo, cuerpo, this.opciones());
  }

  /** POST /api/admin/catalogos/{catalogo}/{id}/eliminar: pide la contraseña del administrador. */
  eliminarDeCatalogo(catalogo: string, id: string | number, contrasena: string): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/catalogos/' + catalogo + '/' + id + '/eliminar', { contrasena }, this.opciones());
  }

  /** POST /api/admin/materias/{id}/carreras o /docentes */
  vincularMateria(idMateria: string | number, tipo: 'carreras' | 'docentes', cuerpo: unknown): Observable<Mensaje> {
    return this.http.post<Mensaje>(this.base + '/materias/' + idMateria + '/' + tipo, cuerpo, this.opciones());
  }

  /** DELETE /api/admin/materias/{id}/carreras/{vinculo} o /docentes/{vinculo} */
  desvincularMateria(idMateria: string | number, tipo: 'carreras' | 'docentes', idVinculo: number): Observable<Mensaje> {
    return this.http.delete<Mensaje>(this.base + '/materias/' + idMateria + '/' + tipo + '/' + idVinculo, this.opciones());
  }
}
