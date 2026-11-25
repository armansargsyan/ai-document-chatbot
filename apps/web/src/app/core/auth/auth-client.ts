import type { ClientConfigResponse } from '@ai-document-chatbot/shared';

/** The signed-in user as the web app sees it (a subset of the Firebase user). */
export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

/**
 * Thin, swappable boundary around the identity provider. The app talks only to
 * this class, so tests replace it with a fake and never load Firebase.
 */
export abstract class AuthClient {
  /** Initializes the provider. Safe to call more than once; later calls are ignored. */
  abstract init(config: ClientConfigResponse): void;

  /**
   * Subscribes to sign-in state. Fires once with the initial (possibly
   * restored) state, then on every change. Returns an unsubscribe function.
   */
  abstract onAuthStateChanged(
    callback: (user: AuthUser | null) => void,
  ): () => void;

  /** Opens the Google sign-in popup. Rejects with an error carrying a `code`. */
  abstract signInWithGoogle(): Promise<void>;

  abstract signOut(): Promise<void>;

  /** A fresh ID token for the current user, or null when signed out. */
  abstract getIdToken(): Promise<string | null>;
}
