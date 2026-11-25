import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  FirebaseAuthGuard,
  type AuthenticatedRequest,
} from './firebase-auth.guard';
import { TokenVerifier, type AuthUser } from './token-verifier';

const user: AuthUser = {
  uid: 'user-1',
  email: 'ada@example.com',
  name: 'Ada',
  picture: null,
};

function setup({
  isPublic = false,
  verify = vi.fn().mockResolvedValue(user),
} = {}) {
  const reflector = { getAllAndOverride: vi.fn().mockReturnValue(isPublic) };
  const verifier: TokenVerifier = { verify };
  const guard = new FirebaseAuthGuard(
    reflector as unknown as Reflector,
    verifier,
  );
  const run = (headers: AuthenticatedRequest['headers']) => {
    const request: AuthenticatedRequest = { headers };
    const context = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  };
  return { run, verify };
}

describe('FirebaseAuthGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { run, verify } = setup({ isPublic: true });
    await expect(run({}).result).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it('attaches the verified user for a valid bearer token', async () => {
    const { run, verify } = setup();
    const { request, result } = run({ authorization: 'Bearer good-token' });
    await expect(result).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual(user);
  });

  it('accepts a case-insensitive "bearer" scheme', async () => {
    const { run, verify } = setup();
    await expect(
      run({ authorization: 'bearer good-token' }).result,
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good-token');
  });

  it.each([
    ['no header', {}],
    ['empty header', { authorization: '' }],
    ['wrong scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['missing token', { authorization: 'Bearer ' }],
    ['extra parts', { authorization: 'Bearer a b' }],
    ['array header', { authorization: ['Bearer a', 'Bearer b'] }],
  ])(
    'rejects %s with 401 without calling the verifier',
    async (_label, headers) => {
      const { run, verify } = setup();
      await expect(run(headers).result).rejects.toThrow(UnauthorizedException);
      expect(verify).not.toHaveBeenCalled();
    },
  );

  it('maps verifier errors to a generic 401 without leaking provider details', async () => {
    const providerError = Object.assign(
      new Error(
        'Firebase ID token has expired. Get a fresh ID token. (secret detail)',
      ),
      { code: 'auth/id-token-expired' },
    );
    const { run } = setup({ verify: vi.fn().mockRejectedValue(providerError) });
    const { request, result } = run({ authorization: 'Bearer expired-token' });

    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).message).toBe(
      'Invalid or expired token',
    );
    expect(
      JSON.stringify((error as UnauthorizedException).getResponse()),
    ).not.toMatch(/expired\. Get|secret detail|id-token-expired|expired-token/);
    expect(request.user).toBeUndefined();
  });
});
