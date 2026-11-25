import { vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  app: { name: '[DEFAULT]' },
  auth: { currentUser: null as null | { getIdToken: () => Promise<string> } },
  getApps: vi.fn(() => [] as unknown[]),
  initializeApp: vi.fn(),
  getAuth: vi.fn(),
  connectAuthEmulator: vi.fn(),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
}));

vi.mock('firebase/app', () => ({
  getApps: sdk.getApps,
  initializeApp: sdk.initializeApp,
}));
vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  getAuth: sdk.getAuth,
  connectAuthEmulator: sdk.connectAuthEmulator,
  onAuthStateChanged: sdk.onAuthStateChanged,
  signInWithPopup: sdk.signInWithPopup,
  signOut: sdk.signOut,
}));

import { FirebaseAuthClient } from './firebase-auth-client';
import { TEST_CONFIG } from './testing/fake-auth-client';

describe('FirebaseAuthClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.initializeApp.mockReturnValue(sdk.app);
    sdk.getAuth.mockReturnValue(sdk.auth);
    sdk.auth.currentUser = null;
  });

  it('initializes Firebase from the loaded config, once', () => {
    const client = new FirebaseAuthClient();
    client.init({
      ...TEST_CONFIG,
      firebase: { ...TEST_CONFIG.firebase, messagingSenderId: '42' },
    });
    client.init(TEST_CONFIG);

    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      appId: '1:1:web:1',
      messagingSenderId: '42',
    });
    expect(sdk.getAuth).toHaveBeenCalledWith(sdk.app);
  });

  it('omits a null messagingSenderId', () => {
    new FirebaseAuthClient().init(TEST_CONFIG);
    expect(sdk.initializeApp.mock.calls[0][0]).not.toHaveProperty(
      'messagingSenderId',
    );
  });

  it('connects to the Auth emulator only when configured', () => {
    new FirebaseAuthClient().init(TEST_CONFIG);
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();

    new FirebaseAuthClient().init({
      ...TEST_CONFIG,
      authEmulatorUrl: 'http://127.0.0.1:9099',
    });
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(
      sdk.auth,
      'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
  });

  it('maps Firebase users to AuthUser', () => {
    const client = new FirebaseAuthClient();
    client.init(TEST_CONFIG);
    const callback = vi.fn();
    client.onAuthStateChanged(callback);

    const listener = sdk.onAuthStateChanged.mock.calls[0][1] as (
      user: unknown,
    ) => void;
    listener({
      uid: 'u1',
      displayName: 'Ada',
      email: 'ada@example.com',
      photoURL: null,
      refreshToken: 'secret',
    });
    listener(null);

    expect(callback).toHaveBeenNthCalledWith(1, {
      uid: 'u1',
      displayName: 'Ada',
      email: 'ada@example.com',
      photoURL: null,
    });
    expect(callback).toHaveBeenNthCalledWith(2, null);
  });

  it('signs in with the Google popup and returns ID tokens', async () => {
    const client = new FirebaseAuthClient();
    await expect(client.signInWithGoogle()).rejects.toThrow(/before init/);

    client.init(TEST_CONFIG);
    await client.signInWithGoogle();
    expect(sdk.signInWithPopup).toHaveBeenCalledWith(
      sdk.auth,
      expect.anything(),
    );

    await expect(client.getIdToken()).resolves.toBeNull();
    sdk.auth.currentUser = { getIdToken: async () => 'id-token' };
    await expect(client.getIdToken()).resolves.toBe('id-token');
  });
});
