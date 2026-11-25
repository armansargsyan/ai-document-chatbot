import { Inject, Injectable } from '@nestjs/common';
import type { Auth } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from '../firebase/firebase.module';
import { TokenVerifier, type AuthUser } from './token-verifier';

/** `TokenVerifier` backed by Firebase Admin `verifyIdToken`. */
@Injectable()
export class FirebaseTokenVerifier extends TokenVerifier {
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {
    super();
  }

  async verify(idToken: string): Promise<AuthUser> {
    const decoded = await this.auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: typeof decoded['name'] === 'string' ? decoded['name'] : null,
      picture: decoded.picture ?? null,
    };
  }
}
