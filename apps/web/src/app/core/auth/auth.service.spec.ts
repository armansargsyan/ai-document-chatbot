import { TestBed } from '@angular/core/testing';
import { AuthClient } from './auth-client';
import { AuthService } from './auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
  firebaseError,
} from './testing/fake-auth-client';

describe('AuthService', () => {
  let client: FakeAuthClient;
  let service: AuthService;

  beforeEach(() => {
    client = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [{ provide: AuthClient, useValue: client }],
    });
    service = TestBed.inject(AuthService);
  });

  it('is not ready and signed out before auth starts', () => {
    expect(service.ready()).toBe(false);
    expect(service.user()).toBeNull();
    expect(service.isSignedIn()).toBe(false);
  });

  it('initializes the client with the loaded config and becomes ready on the first state', async () => {
    service.start(TEST_CONFIG);
    expect(client.config).toBe(TEST_CONFIG);
    expect(service.ready()).toBe(false);

    client.emit(TEST_USER);
    await service.whenReady();
    expect(service.ready()).toBe(true);
    expect(service.user()).toEqual(TEST_USER);
    expect(service.isSignedIn()).toBe(true);
  });

  it('becomes ready, signed out, when sign-in is unavailable', async () => {
    service.markUnavailable();
    await service.whenReady();
    expect(service.ready()).toBe(true);
    expect(service.isSignedIn()).toBe(false);
  });

  it('signs in with Google', async () => {
    service.start(TEST_CONFIG);
    client.emit(null);

    const pending = service.signInWithGoogle();
    expect(service.signingIn()).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(service.signingIn()).toBe(false);
    expect(service.user()).toEqual(TEST_USER);
    expect(service.error()).toBeNull();
  });

  it.each(['auth/popup-closed-by-user', 'auth/cancelled-popup-request'])(
    'shows no error when the popup is dismissed (%s)',
    async (code) => {
      service.start(TEST_CONFIG);
      client.signInImpl = () => Promise.reject(firebaseError(code));

      await expect(service.signInWithGoogle()).resolves.toBe(false);
      expect(service.error()).toBeNull();
      expect(service.signingIn()).toBe(false);
    },
  );

  it('maps known errors to a friendly message, never the raw Firebase error', async () => {
    service.start(TEST_CONFIG);
    client.signInImpl = () =>
      Promise.reject(firebaseError('auth/popup-blocked'));

    await service.signInWithGoogle();
    expect(service.error()).toMatch(/blocked the sign-in window/);
    expect(service.error()).not.toContain('auth/');
    expect(service.error()).not.toContain('Firebase');
  });

  it('uses a generic message for unknown errors and clears it on the next attempt', async () => {
    service.start(TEST_CONFIG);
    client.signInImpl = () =>
      Promise.reject(firebaseError('auth/internal-error'));
    await service.signInWithGoogle();
    expect(service.error()).toBe('Sign-in didn’t complete. Try again.');

    client.signInImpl = () => new Promise(() => undefined);
    void service.signInWithGoogle();
    expect(service.error()).toBeNull();
  });

  it('ignores a second sign-in while the popup is open', async () => {
    service.start(TEST_CONFIG);
    let calls = 0;
    client.signInImpl = () => {
      calls++;
      return new Promise(() => undefined);
    };
    void service.signInWithGoogle();
    await expect(service.signInWithGoogle()).resolves.toBe(false);
    expect(calls).toBe(1);
  });

  it('signs out', async () => {
    service.start(TEST_CONFIG);
    client.emit(TEST_USER);

    await service.signOut();
    expect(client.signOutCalls).toBe(1);
    expect(service.user()).toBeNull();
  });

  it('returns the ID token only once started', async () => {
    await expect(service.idToken()).resolves.toBeNull();
    service.start(TEST_CONFIG);
    await expect(service.idToken()).resolves.toBe('test-id-token');
  });
});
