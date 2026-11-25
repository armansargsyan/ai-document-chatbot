import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { MeResponse } from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { AuthService } from '../auth/auth.service';
import { AppLogo } from './app-logo';

/**
 * Layout for every signed-in page: header (brand, nav, account, sign-out) and
 * a router outlet for the feature. The chat history sidebar (#12) is an
 * aside inside the chat page.
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    HlmButtonImports,
    AppLogo,
  ],
  templateUrl: './app-shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShell {
  private readonly auth = inject(AuthService);

  protected readonly nav = [
    { path: '/chat', label: 'Chat', exact: false },
    { path: '/documents', label: 'Documents', exact: false },
  ] as const;

  /** Fetched from the api (not Firebase) to prove the bearer token round trip. */
  protected readonly me = httpResource<MeResponse>(() => '/api/auth/me');
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal(false);
  private readonly avatarFailed = signal(false);

  protected readonly displayName = computed(() => {
    const me = this.me.hasValue() ? this.me.value() : null;
    return me?.name || me?.email || '';
  });
  protected readonly picture = computed(() =>
    this.me.hasValue() && !this.avatarFailed() ? this.me.value().picture : null,
  );
  protected readonly initial = computed(
    () => this.displayName().charAt(0).toUpperCase() || '?',
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
