import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AuthModule } from '../auth/auth.module';
import { TokenVerifier, type AuthUser } from '../auth/token-verifier';
import {
  ConversationRepository,
  type ConversationRecord,
} from './conversation.repository';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

const ID = 'abcdefghij0123456789';

class FakeTokenVerifier extends TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (!token.startsWith('user-')) throw new Error('bad token');
    return { uid: token, email: null, name: null, picture: null };
  }
}

/** In-memory repository keyed by uid, so cross-user access can be tested. */
function memoryRepository() {
  const store = new Map<string, ConversationRecord>([
    [
      `user-1/${ID}`,
      { title: 'Mine', createdAt: 't', updatedAt: 't', messageCount: 0 },
    ],
  ]);
  return {
    store,
    get: vi.fn(
      async (uid: string, id: string) => store.get(`${uid}/${id}`) ?? null,
    ),
    list: vi.fn(async (uid: string) =>
      [...store.entries()]
        .filter(([key]) => key.startsWith(`${uid}/`))
        .map(([key, r]) => ({ id: key.split('/')[1], ...r })),
    ),
    listMessages: vi.fn(async () => []),
    rename: vi.fn(async (uid: string, id: string, title: string) => {
      const r = store.get(`${uid}/${id}`);
      if (r) store.set(`${uid}/${id}`, { ...r, title });
    }),
    delete: vi.fn(async (uid: string, id: string) => {
      store.delete(`${uid}/${id}`);
    }),
  };
}

describe('conversations (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const repository = memoryRepository();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ConversationsController],
      providers: [
        ConversationsService,
        { provide: ConversationRepository, useValue: repository },
      ],
    })
      .overrideProvider(TokenVerifier)
      .useClass(FakeTokenVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const call = (
    method: string,
    path: string,
    user = 'user-1',
    body?: unknown,
  ) =>
    fetch(`${baseUrl}/conversations${path}`, {
      method,
      headers: {
        authorization: `Bearer ${user}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  it('requires authentication', async () => {
    expect((await fetch(`${baseUrl}/conversations`)).status).toBe(401);
  });

  it('lists and gets the caller’s conversation', async () => {
    expect(await (await call('GET', '')).json()).toEqual({
      conversations: [
        {
          id: ID,
          title: 'Mine',
          createdAt: 't',
          updatedAt: 't',
          messageCount: 0,
        },
      ],
    });
    const res = await call('GET', `/${ID}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: ID,
      title: 'Mine',
      messages: [],
    });
  });

  it('hides other users’ conversations (404 for get, rename and delete)', async () => {
    expect(await (await call('GET', '', 'user-2')).json()).toEqual({
      conversations: [],
    });
    expect((await call('GET', `/${ID}`, 'user-2')).status).toBe(404);
    expect(
      (await call('PATCH', `/${ID}`, 'user-2', { title: 'hijack' })).status,
    ).toBe(404);
    expect((await call('DELETE', `/${ID}`, 'user-2')).status).toBe(404);
    expect(repository.store.get(`user-1/${ID}`)?.title).toBe('Mine');
  });

  it('validates rename bodies', async () => {
    for (const body of [
      {},
      { title: '   ' },
      { title: 'x'.repeat(101) },
      { title: 'ok', extra: 1 },
    ]) {
      expect((await call('PATCH', `/${ID}`, 'user-1', body)).status).toBe(400);
    }
  });

  it('renames with a trimmed title', async () => {
    const res = await call('PATCH', `/${ID}`, 'user-1', {
      title: '  Refund questions  ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: ID,
      title: 'Refund questions',
    });
  });

  it('returns 404 for malformed ids without touching storage', async () => {
    repository.get.mockClear();
    expect((await call('GET', '/..%2Fother')).status).toBe(404);
    expect(repository.get).not.toHaveBeenCalled();
  });

  it('deletes', async () => {
    expect((await call('DELETE', `/${ID}`)).status).toBe(204);
    expect((await call('GET', `/${ID}`)).status).toBe(404);
  });
});
