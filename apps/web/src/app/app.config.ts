import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideSpartanHlm } from '@spartan-ng/helm/utils';
import { appRoutes } from './app.routes';
import { AuthClient } from './core/auth/auth-client';
import { authInterceptor } from './core/auth/auth.interceptor';
import { FirebaseAuthClient } from './core/auth/firebase-auth-client';
import { ClientConfigService } from './core/config/client-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    provideSpartanHlm(),
    { provide: AuthClient, useClass: FirebaseAuthClient },
    // Firebase config comes from the api at startup, never from literals.
    // `load()` never rejects: a failure shows "sign-in unavailable" on /login.
    provideAppInitializer(() => inject(ClientConfigService).load()),
  ],
};
