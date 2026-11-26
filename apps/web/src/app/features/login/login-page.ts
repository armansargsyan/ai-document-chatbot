import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';
import { OwnerContactLinks } from '../../core/contact/owner-contact-links';
import { AppLogo } from '../../core/layout/app-logo';
import { safeReturnUrl } from '../../core/auth/return-url';
import { ClientConfigService } from '../../core/config/client-config.service';

@Component({
  selector: 'app-login-page',
  imports: [HlmButtonImports, AppLogo, OwnerContactLinks],
  templateUrl: './login-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  protected readonly config = inject(ClientConfigService);
  private readonly router = inject(Router);

  /** Bound from the `?returnUrl=` query param. */
  readonly returnUrl = input<string>();

  constructor() {
    // Leave as soon as a user exists: after the popup succeeds, or when a
    // persisted session is restored after a config retry.
    effect(() => {
      if (this.auth.isSignedIn()) {
        void this.router.navigateByUrl(safeReturnUrl(this.returnUrl()) ?? '/');
      }
    });
  }

  protected signIn(): void {
    void this.auth.signInWithGoogle();
  }

  protected retry(): void {
    void this.config.load();
  }
}
