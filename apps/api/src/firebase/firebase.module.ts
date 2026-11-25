import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { deleteApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { AppConfigService } from '../config/app-config.service';
import { createFirebaseApp } from './firebase-app.factory';

/** Injection token for the Firebase Admin `App`. */
export const FIREBASE_APP = Symbol('FIREBASE_APP');
/** Injection token for the Firebase Admin `Auth` service. */
export const FIREBASE_AUTH = Symbol('FIREBASE_AUTH');
/** Injection token for the Firestore client. */
export const FIRESTORE = Symbol('FIRESTORE');
/** Injection token for the default Cloud Storage bucket (from `storageBucket` in config). */
export const STORAGE_BUCKET = Symbol('STORAGE_BUCKET');

export type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_APP,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        createFirebaseApp(config.firebase),
    },
    {
      provide: FIREBASE_AUTH,
      inject: [FIREBASE_APP],
      useFactory: (app: App) => getAuth(app),
    },
    {
      provide: FIRESTORE,
      inject: [FIREBASE_APP],
      useFactory: (app: App) => getFirestore(app),
    },
    {
      provide: STORAGE_BUCKET,
      inject: [FIREBASE_APP],
      useFactory: (app: App): StorageBucket => getStorage(app).bucket(),
    },
  ],
  exports: [FIREBASE_APP, FIREBASE_AUTH, FIRESTORE, STORAGE_BUCKET],
})
export class FirebaseModule implements OnApplicationShutdown {
  constructor(@Inject(FIREBASE_APP) private readonly app: App) {}

  /** Free the default app so the process (or a test worker) can re-initialize it. */
  async onApplicationShutdown(): Promise<void> {
    await deleteApp(this.app);
  }
}
