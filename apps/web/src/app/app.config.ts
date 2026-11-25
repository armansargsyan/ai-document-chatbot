import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  provideHttpClient,
  withInterceptors,
  withXhr,
} from '@angular/common/http';
import { OVERLAY_DEFAULT_CONFIG } from '@angular/cdk/overlay';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { appRoutes } from './app.routes';
import { AuthClient } from './core/auth/auth-client';
import { authInterceptor } from './core/auth/auth.interceptor';
import { FirebaseAuthClient } from './core/auth/firebase-auth-client';
import { ClientConfigService } from './core/config/client-config.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    // XHR, not fetch: only XHR reports upload progress (PDF uploads show a %).
    provideHttpClient(withXhr(), withInterceptors([authInterceptor])),
    // What `provideSpartanHlm()` provides (overlays stay out of the popover top
    // layer), imported from the cdk directly: the `@spartan-ng/helm/utils`
    // barrel would pull `cn` and brain core (~33 kB) into the initial bundle.
    { provide: OVERLAY_DEFAULT_CONFIG, useValue: { usePopover: false } },
    { provide: AuthClient, useClass: FirebaseAuthClient },
    // Firebase config comes from the api at startup, never from literals.
    // `load()` never rejects: a failure shows "sign-in unavailable" on /login.
    provideAppInitializer(() => inject(ClientConfigService).load()),
  ],
};
