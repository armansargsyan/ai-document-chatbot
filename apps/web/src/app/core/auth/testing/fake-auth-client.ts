import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import { AuthClient, type AuthUser } from '../auth-client';

export const TEST_CONFIG: ClientConfigResponse = {
  firebase: {
    apiKey: 'test-api-key',
    authDomain: 'test.firebaseapp.com',
    projectId: 'test-project',
    appId: '1:1:web:1',
    messagingSenderId: null,
  },
  authEmulatorUrl: null,
};

export const TEST_USER: AuthUser = {
  uid: 'u1',
  displayName: 'Ada Lovelace',
  email: 'ada@example.com',
  photoURL: null,
};

/** In-memory {@link AuthClient} for tests; never touches Firebase. */
export class FakeAuthClient extends AuthClient {
  config: ClientConfigResponse | null = null;
  token: string | null = 'test-id-token';
  /** What the next `signInWithGoogle()` does. */
  signInImpl: () => Promise<void> = async () => this.emit(TEST_USER);
  signOutCalls = 0;
  /** When set, the next `signOut()` rejects with it. */
  signOutError: unknown = null;
  private listener: ((user: AuthUser | null) => void) | null = null;

  init(config: ClientConfigResponse): void {
    this.config = config;
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    this.listener = callback;
    return () => (this.listener = null);
  }

  signInWithGoogle(): Promise<void> {
    return this.signInImpl();
  }

  async signOut(): Promise<void> {
    this.signOutCalls++;
    if (this.signOutError) throw this.signOutError;
    this.emit(null);
  }

  async getIdToken(): Promise<string | null> {
    return this.token;
  }

  /** Simulates Firebase reporting a (new) auth state. */
  emit(user: AuthUser | null): void {
    this.listener?.(user);
  }
}

export function firebaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Firebase: Error (${code}).`), { code });
}
