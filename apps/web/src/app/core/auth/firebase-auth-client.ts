import { Injectable } from '@angular/core';
import type { ClientConfigResponse } from '@ai-document-chatbot/shared';
import { getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  GoogleAuthProvider,
  type User,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { AuthClient, type AuthUser } from './auth-client';

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

/** Production {@link AuthClient} backed by the Firebase Auth web SDK. */
@Injectable()
export class FirebaseAuthClient extends AuthClient {
  private auth: Auth | null = null;

  init(config: ClientConfigResponse): void {
    if (this.auth) return;
    const { messagingSenderId, ...firebase } = config.firebase;
    const app =
      getApps()[0] ??
      initializeApp({
        ...firebase,
        ...(messagingSenderId ? { messagingSenderId } : {}),
      });
    const auth = getAuth(app);
    if (config.authEmulatorUrl) {
      connectAuthEmulator(auth, config.authEmulatorUrl, {
        disableWarnings: true,
      });
    }
    this.auth = auth;
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    return onAuthStateChanged(this.requireAuth(), (user) =>
      callback(user ? toAuthUser(user) : null),
    );
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(this.requireAuth(), provider);
  }

  async signOut(): Promise<void> {
    if (this.auth) await signOut(this.auth);
  }

  async getIdToken(): Promise<string | null> {
    return (await this.auth?.currentUser?.getIdToken()) ?? null;
  }

  private requireAuth(): Auth {
    if (!this.auth) throw new Error('AuthClient used before init()');
    return this.auth;
  }
}
