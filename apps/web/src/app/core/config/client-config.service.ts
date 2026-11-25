import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import { AuthService } from '../auth/auth.service';

/** Bootstrap waits on this request, so a hung api must not leave a blank page. */
export const CLIENT_CONFIG_TIMEOUT_MS = 10_000;

export type ClientConfigStatus = 'loading' | 'ready' | 'unavailable';

/**
 * Loads the public Firebase web config from `GET /api/config` and starts auth
 * with it. Failure is a state, not a crash: the login page offers a retry.
 */
@Injectable({ providedIn: 'root' })
export class ClientConfigService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly _status = signal<ClientConfigStatus>('loading');
  readonly status = this._status.asReadonly();
  readonly isUnavailable = computed(() => this._status() === 'unavailable');

  private inFlight: Promise<void> | null = null;

  /** Fetches the config and starts auth. Never rejects; concurrent calls share one request. */
  load(): Promise<void> {
    if (this._status() === 'ready') return Promise.resolve();
    this.inFlight ??= this.fetchAndStart().finally(
      () => (this.inFlight = null),
    );
    return this.inFlight;
  }

  private async fetchAndStart(): Promise<void> {
    this._status.set('loading');
    try {
      const config = await firstValueFrom(
        this.http
          .get<ClientConfigResponse>('/api/config')
          .pipe(timeout(CLIENT_CONFIG_TIMEOUT_MS)),
      );
      this.auth.start(config);
      this._status.set('ready');
    } catch {
      this._status.set('unavailable');
      this.auth.markUnavailable();
    }
  }
}
