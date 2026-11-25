import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

export const appRoutes: Route[] = [
  {
    path: 'login',
    title: 'Sign in | AI Document Chatbot',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'AI Document Chatbot',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/home/home-page').then((m) => m.HomePage),
  },
  { path: '**', redirectTo: '' },
];
