import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { createFirebaseApp } from './firebase-app.factory';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  cert: vi.fn(() => 'cert-credential'),
  applicationDefault: vi.fn(() => 'adc-credential'),
}));

describe('createFirebaseApp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses Application Default Credentials and an explicit projectId by default', () => {
    createFirebaseApp({
      projectId: 'demo-project',
      storageBucket: 'demo-project.firebasestorage.app',
    });

    expect(applicationDefault).toHaveBeenCalledOnce();
    expect(cert).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith({
      projectId: 'demo-project',
      storageBucket: 'demo-project.firebasestorage.app',
      credential: 'adc-credential',
    });
  });

  it('uses inline service-account credentials when configured', () => {
    createFirebaseApp({
      projectId: 'demo-project',
      storageBucket: 'bucket',
      serviceAccount: {
        clientEmail: 'svc@demo-project.iam.gserviceaccount.com',
        privateKey: 'fake-key',
      },
    });

    expect(cert).toHaveBeenCalledWith({
      projectId: 'demo-project',
      clientEmail: 'svc@demo-project.iam.gserviceaccount.com',
      privateKey: 'fake-key',
    });
    expect(applicationDefault).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ credential: 'cert-credential' }),
    );
  });
});
