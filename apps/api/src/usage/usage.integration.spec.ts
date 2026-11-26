import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AuthModule } from '../auth/auth.module';
import { TokenVerifier, type AuthUser } from '../auth/token-verifier';
import { FIRESTORE } from '../firebase/firebase.module';
import {
  ProviderQuotaModule,
  ProviderQuotaTracker,
} from '../llm/provider-quota-tracker';
import { FakeFirestore } from './testing/fake-firestore';
import { UsageModule } from './usage.module';

class FakeTokenVerifier extends TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (!token.startsWith('user-')) throw new Error('bad token');
    return { uid: token, email: null, name: null, picture: null };
  }
}

const db = new FakeFirestore();

@Global()
@Module({
  providers: [{ provide: FIRESTORE, useValue: db.asFirestore() }],
  exports: [FIRESTORE],
})
class FakeFirebaseModule {}

/** Real HTTP + auth guard + UsageModule; Firestore is an in-memory fake. */
describe('GET /api/usage (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeFirebaseModule,
        AuthModule,
        ProviderQuotaModule,
        UsageModule,
      ],
    })
      .overrideProvider(TokenVerifier)
      .useClass(FakeTokenVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  const get = (token?: string) =>
    fetch(`${baseUrl}/usage`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('requires authentication', async () => {
    expect((await get()).status).toBe(401);
  });

  it('returns zero usage for a new user', async () => {
    const res = await get('user-new');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: { used: 0, limit: 3 },
      uploads: { used: 0, limit: 6 },
      questions: { used: 0, limit: 30 },
      searchQuotaExhausted: false,
    });
  });

  it("returns only the caller's usage", async () => {
    db.docs.set('users/user-a/meta/usage', {
      uploadsUsed: 5,
      questionsUsed: 9,
    });
    db.docs.set('users/user-a/documents/x', { name: 'x.pdf' });
    db.docs.set('users/user-b/meta/usage', {
      uploadsUsed: 1,
      questionsUsed: 1,
    });
    expect(await (await get('user-a')).json()).toMatchObject({
      documents: { used: 1 },
      uploads: { used: 5 },
      questions: { used: 9 },
    });
  });

  it('reports paused search', async () => {
    app.get(ProviderQuotaTracker).markExhausted('openai');
    expect(await (await get('user-a')).json()).toMatchObject({
      searchQuotaExhausted: true,
    });
  });
});
