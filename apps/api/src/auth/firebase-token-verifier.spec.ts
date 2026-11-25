import { describe, expect, it, vi } from 'vitest';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import { FirebaseTokenVerifier } from './firebase-token-verifier';

function verifierWith(verifyIdToken: Auth['verifyIdToken']) {
  return new FirebaseTokenVerifier({ verifyIdToken } as Auth);
}

describe('FirebaseTokenVerifier', () => {
  it('maps a decoded ID token to an AuthUser', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({
      uid: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://example.com/ada.png',
    } as Partial<DecodedIdToken>);

    await expect(
      verifierWith(verifyIdToken).verify('token-123'),
    ).resolves.toEqual({
      uid: 'user-1',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://example.com/ada.png',
    });
    expect(verifyIdToken).toHaveBeenCalledWith('token-123');
  });

  it('uses null for missing optional claims', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({ uid: 'user-2' });
    await expect(verifierWith(verifyIdToken).verify('t')).resolves.toEqual({
      uid: 'user-2',
      email: null,
      name: null,
      picture: null,
    });
  });

  it('propagates verification failures', async () => {
    const verifyIdToken = vi.fn().mockRejectedValue(new Error('bad token'));
    await expect(verifierWith(verifyIdToken).verify('t')).rejects.toThrow(
      'bad token',
    );
  });
});
