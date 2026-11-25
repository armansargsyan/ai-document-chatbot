import {
  applicationDefault,
  cert,
  initializeApp,
  type App,
} from 'firebase-admin/app';
import type { FirebaseConfig } from '../config/app-config.service';

/**
 * Initializes the Firebase Admin app from validated config.
 *
 * `projectId` is always passed explicitly: user credentials from
 * `gcloud auth application-default login` carry no project ID, and the Admin
 * SDK needs it to verify ID tokens. With inline service-account credentials
 * those are used; otherwise Application Default Credentials. When
 * `*_EMULATOR_HOST` vars are set, the Admin SDK talks to the emulators.
 */
export function createFirebaseApp(config: FirebaseConfig): App {
  return initializeApp({
    projectId: config.projectId,
    storageBucket: config.storageBucket,
    credential: config.serviceAccount
      ? cert({ projectId: config.projectId, ...config.serviceAccount })
      : applicationDefault(),
  });
}
