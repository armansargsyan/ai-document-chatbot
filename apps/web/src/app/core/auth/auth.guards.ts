import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { safeReturnUrl } from './return-url';

/** Lets signed-in users through; sends everyone else to `/login?returnUrl=…`. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (auth.isSignedIn()) return true;

  const returnUrl = safeReturnUrl(state.url);
  return router.createUrlTree(['/login'], {
    queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {},
  });
};

/** Keeps signed-in users off `/login`, sending them to `returnUrl` or home. */
export const guestGuard: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.whenReady();
  if (!auth.isSignedIn()) return true;
  return router.parseUrl(
    safeReturnUrl(route.queryParamMap.get('returnUrl')) ?? '/',
  );
};
