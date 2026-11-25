import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    // The single owner of the "session ended" redirect: guards only run on
    // navigation, so this covers sign-out here or in another tab and revoked
    // tokens. No returnUrl: the next person to sign in on this device must not
    // land on the previous user's page.
    let wasSignedIn = false;
    effect(() => {
      const signedIn = this.auth.isSignedIn();
      if (wasSignedIn && !signedIn) this.redirectToLogin();
      wasSignedIn = signedIn;
    });
  }

  private redirectToLogin(): void {
    void this.router.navigate(['/login']);
  }
}
