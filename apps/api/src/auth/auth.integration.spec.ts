import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AppController } from '../app/app.controller';
import { AppService } from '../app/app.service';
import { AuthModule } from './auth.module';
import { TokenVerifier, type AuthUser } from './token-verifier';

/** Accepts exactly one token; everything else fails like Firebase would. */
class FakeTokenVerifier extends TokenVerifier {
  async verify(idToken: string): Promise<AuthUser> {
    if (idToken !== 'valid-token')
      throw new Error('Decoding Firebase ID token failed');
    return {
      uid: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      picture: null,
    };
  }
}

/**
 * Real routing + the global guard from AuthModule, over loopback HTTP.
 * Firebase is replaced by FakeTokenVerifier, so nothing leaves the machine.
 */
describe('auth (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [AppController],
      providers: [AppService],
    })
      .overrideProvider(TokenVerifier)
      .useClass(FakeTokenVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string, token?: string) =>
    fetch(`${baseUrl}${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('keeps /health public', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
  });

  it('rejects /auth/me without a token', async () => {
    const res = await get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects /auth/me with an invalid token without leaking the provider error', async () => {
    const res = await get('/auth/me', 'forged-token');
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(body).toContain('Invalid or expired token');
    expect(body).not.toContain('Decoding Firebase ID token failed');
    expect(body).not.toContain('forged-token');
  });

  it('returns the verified user for a valid token', async () => {
    const res = await get('/auth/me', 'valid-token');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      uid: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      picture: null,
    });
  });
});
