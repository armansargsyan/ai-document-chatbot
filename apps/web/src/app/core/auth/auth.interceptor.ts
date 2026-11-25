import { DOCUMENT, inject } from '@angular/core';
import type { HttpInterceptorFn } from '@angular/common/http';
import { from, switchMap } from 'rxjs';
import { AuthService } from './auth.service';

/** `/api` routes the api serves without authentication. */
const PUBLIC_API_PATHS = new Set(['/api/config', '/api/health']);

/** True for same-origin `/api/...` requests that need a bearer token. */
export function needsIdToken(url: string, baseUrl: string): boolean {
  let parsed: URL;
  let base: URL;
  try {
    base = new URL(baseUrl);
    parsed = new URL(url, base);
  } catch {
    return false;
  }
  if (parsed.origin !== base.origin) return false;
  const path = parsed.pathname.replace(/\/+$/, '');
  return path.startsWith('/api/') && !PUBLIC_API_PATHS.has(path);
}

/** Attaches `Authorization: Bearer <Firebase ID token>` to protected api calls. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const document = inject(DOCUMENT);
  if (
    req.headers.has('Authorization') ||
    !needsIdToken(req.url, document.baseURI)
  ) {
    return next(req);
  }
  const auth = inject(AuthService);
  return from(auth.idToken()).pipe(
    switchMap((token) =>
      next(
        token
          ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
          : req,
      ),
    ),
  );
};
