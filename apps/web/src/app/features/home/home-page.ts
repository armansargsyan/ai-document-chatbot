import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import type { MeResponse } from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../../core/auth/auth.service';

/** Placeholder home for signed-in users; replaced by the chat UI (#10–#12). */
@Component({
  selector: 'app-home-page',
  imports: [HlmButtonImports],
  templateUrl: './home-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomePage {
  private readonly auth = inject(AuthService);

  /** Fetched from the api (not Firebase) to prove the bearer token round trip. */
  protected readonly me = httpResource<MeResponse>(() => '/api/auth/me');
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal(false);
  private readonly avatarFailed = signal(false);

  protected readonly displayName = computed(() => {
    const me = this.me.hasValue() ? this.me.value() : null;
    return me?.name || me?.email || 'there';
  });
  protected readonly picture = computed(() =>
    this.me.hasValue() && !this.avatarFailed() ? this.me.value().picture : null,
  );
  protected readonly initial = computed(() =>
    this.displayName().charAt(0).toUpperCase(),
  );

  protected onAvatarError(): void {
    this.avatarFailed.set(true);
  }

  /** The App redirects to /login once the session ends; nothing to navigate here. */
  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    this.signOutError.set(false);
    try {
      await this.auth.signOut();
    } catch {
      this.signOutError.set(true);
    } finally {
      this.signingOut.set(false);
    }
  }
}
