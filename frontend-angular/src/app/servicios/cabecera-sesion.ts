import { AUTH_TOKEN_KEY } from '../auth/auth.constants';

/** Cabecera Authorization con el token de la sesión guardado en el navegador. */
export function cabeceraSesion(): Record<string, string> {
  let token = '';
  try {
    token = globalThis.sessionStorage?.getItem(AUTH_TOKEN_KEY) ?? '';
  } catch {
    token = '';
  }
  return { Authorization: 'Bearer ' + token };
}
