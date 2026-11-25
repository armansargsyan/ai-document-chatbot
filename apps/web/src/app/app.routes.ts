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
    // Signed-in shell: header + nav around every feature page.
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./core/layout/app-shell').then((m) => m.AppShell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'AI Document Chatbot',
        loadComponent: () =>
          import('./features/home/home-page').then((m) => m.HomePage),
      },
      {
        path: 'documents',
        title: 'Documents | AI Document Chatbot',
        loadComponent: () =>
          import('./features/documents/documents-page').then(
            (m) => m.DocumentsPage,
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
