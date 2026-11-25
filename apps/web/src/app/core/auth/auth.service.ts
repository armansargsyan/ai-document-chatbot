import { Injectable, computed, inject, signal } from '@angular/core';
import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import { AuthClient, type AuthUser } from './auth-client';

/** Popup outcomes that mean "the user changed their mind", not a failure. */
const DISMISSED_CODES = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
]);

const FRIENDLY_MESSAGES: Record<string, string> = {
  'auth/popup-blocked':
    'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/network-request-failed':
    'Couldn’t reach Google. Check your connection and try again.',
  'auth/too-many-requests':
    'Too many sign-in attempts. Wait a moment and try again.',
  'auth/user-disabled': 'This account has been disabled.',
};

const GENERIC_MESSAGE = 'Sign-in didn’t complete. Try again.';

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : null;
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(AuthClient);

  private readonly _user = signal<AuthUser | null>(null);
  private readonly _ready = signal(false);
  private readonly _signingIn = signal(false);
  private readonly _error = signal<string | null>(null);
  private started = false;
  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>(
    (resolve) => (this.resolveReady = resolve),
  );

  /** The signed-in user, or null. */
  readonly user = this._user.asReadonly();
  /** True once the initial auth state is known (or sign-in is unavailable). */
  readonly ready = this._ready.asReadonly();
  readonly isSignedIn = computed(() => this._user() !== null);
  /** True while the sign-in popup is open. */
  readonly signingIn = this._signingIn.asReadonly();
  /** A short, user-facing message for the last failed sign-in, or null. */
  readonly error = this._error.asReadonly();

  /** Starts listening to the identity provider. Called once the client config is loaded. */
  start(config: ClientConfigResponse): void {
    if (this.started) return;
    this.client.init(config);
    this.started = true;
    this.client.onAuthStateChanged((user) => {
      this._user.set(user);
      this.markReady();
    });
  }

  /** Sign-in can't be offered (no config): resolve as signed out so guards can proceed. */
  markUnavailable(): void {
    this.markReady();
  }

  /** Resolves once {@link ready} is true. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Opens the Google popup. Resolves true on success; never rejects. */
  async signInWithGoogle(): Promise<boolean> {
    if (this._signingIn()) return false;
    this._signingIn.set(true);
    this._error.set(null);
    try {
      await this.client.signInWithGoogle();
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (!code || !DISMISSED_CODES.has(code)) {
        this._error.set((code && FRIENDLY_MESSAGES[code]) || GENERIC_MESSAGE);
      }
      return false;
    } finally {
      this._signingIn.set(false);
    }
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    this._user.set(null);
  }

  /** The current user's ID token, or null when signed out or not started. */
  async idToken(): Promise<string | null> {
    if (!this.started) return null;
    return this.client.getIdToken();
  }

  private markReady(): void {
    this._ready.set(true);
    this.resolveReady();
  }
}
