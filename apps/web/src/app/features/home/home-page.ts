import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';

/** Signed-in landing page; becomes the chat UI in #11. */
@Component({
  selector: 'app-home-page',
  imports: [HlmButtonImports, RouterLink],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly auth = inject(AuthService);

  protected readonly firstName = computed(() => {
    const user = this.auth.user();
    return user?.displayName?.split(/\s+/)[0] || null;
  });
}
