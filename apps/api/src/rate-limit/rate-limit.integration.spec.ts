import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Controller,
  Get,
  Global,
  Module,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { AuthModule } from '../auth/auth.module';
import { Public } from '../auth/public.decorator';
import { TokenVerifier, type AuthUser } from '../auth/token-verifier';
import { ChatController } from '../chat/chat.controller';
import {
  AppConfigService,
  type RateLimitConfig,
} from '../config/app-config.service';
import { DocumentsController } from '../documents/documents.controller';
import { RateLimit, rateLimitKindOf } from './rate-limit.decorator';
import { RateLimitModule, buildThrottlers } from './rate-limit.module';
import { limitMessage } from './user-throttler.guard';

class FakeTokenVerifier extends TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (!token.startsWith('user-')) throw new Error('bad token');
    return { uid: token, email: null, name: null, picture: null };
  }
}

const limits: RateLimitConfig = {
  chatPerMinute: 2,
  uploadsPerHour: 1,
};

@Global()
@Module({
  providers: [{ provide: AppConfigService, useValue: { rateLimits: limits } }],
  exports: [AppConfigService],
})
class FakeConfigModule {}

@Controller('t')
class TestController {
  @Post('chat')
  @RateLimit('chat')
  chat() {
    return { ok: true };
  }

  @Post('regenerate')
  @RateLimit('chat')
  regenerate() {
    return { ok: true };
  }

  @Post('upload')
  @RateLimit('upload')
  upload() {
    return { ok: true };
  }

  @Get('unlimited')
  unlimited() {
    return { ok: true };
  }

  @Public()
  @Get('public')
  open() {
    return { ok: true };
  }
}

/** Real auth + rate-limit guards in their app order; every request comes from 127.0.0.1. */
describe('rate limits (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeConfigModule, AuthModule, RateLimitModule],
      controllers: [TestController],
    })
      .overrideProvider(TokenVerifier)
      .useClass(FakeTokenVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/t`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const call = (method: string, path: string, user?: string) =>
    fetch(`${baseUrl}/${path}`, {
      method,
      headers: user ? { authorization: `Bearer ${user}` } : {},
    });

  it('allows chat messages up to the limit, then answers 429 with a friendly message', async () => {
    expect((await call('POST', 'chat', 'user-a')).status).toBe(201);
    expect((await call('POST', 'chat', 'user-a')).status).toBe(201);

    const limited = await call('POST', 'chat', 'user-a');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await limited.json()) as { message: string };
    expect(body.message).toMatch(
      /^You're sending messages too quickly\. Try again in \d+ seconds?\.$/,
    );
  });

  it('limits per user, not per IP', async () => {
    // Same IP as user-a above, separate budget.
    expect((await call('POST', 'chat', 'user-b')).status).toBe(201);
  });

  it('keeps chat and upload budgets separate, with an upload-specific message', async () => {
    // Exhaust user-e's chat budget first; uploads must still be allowed.
    await call('POST', 'chat', 'user-e');
    await call('POST', 'chat', 'user-e');
    expect((await call('POST', 'chat', 'user-e')).status).toBe(429);

    expect((await call('POST', 'upload', 'user-e')).status).toBe(201);
    const limited = await call('POST', 'upload', 'user-e');
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { message: string }).message).toMatch(
      /^You've reached the upload limit\. Try again in \d+ minutes\.$/,
    );
  });

  it('shares one budget across all routes of the same kind', async () => {
    expect((await call('POST', 'chat', 'user-f')).status).toBe(201);
    expect((await call('POST', 'regenerate', 'user-f')).status).toBe(201);
    expect((await call('POST', 'regenerate', 'user-f')).status).toBe(429);
    expect((await call('POST', 'chat', 'user-f')).status).toBe(429);
  });

  it('never limits unmarked routes', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await call('GET', 'unlimited', 'user-c')).status).toBe(200);
      expect((await call('GET', 'public')).status).toBe(200);
    }
  });

  it('rejects unauthenticated requests with 401 before counting them', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await call('POST', 'chat')).status).toBe(401);
    }
    // user-d's budget is untouched by the anonymous attempts.
    expect((await call('POST', 'chat', 'user-d')).status).toBe(201);
  });
});

describe('rate limit wiring', () => {
  const contextFor = (cls: object, handler: object) =>
    ({ getClass: () => cls, getHandler: () => handler }) as never;

  it('marks the real chat and upload routes', () => {
    expect(
      rateLimitKindOf(
        contextFor(ChatController, ChatController.prototype.stream),
      ),
    ).toBe('chat');
    expect(
      rateLimitKindOf(
        contextFor(DocumentsController, DocumentsController.prototype.upload),
      ),
    ).toBe('upload');
    expect(
      rateLimitKindOf(
        contextFor(DocumentsController, DocumentsController.prototype.list),
      ),
    ).toBeUndefined();
  });

  it('builds only the burst windows from config (no daily limits)', () => {
    expect(
      buildThrottlers(limits).map(({ name, ttl, limit }) => ({
        name,
        ttl,
        limit,
      })),
    ).toEqual([
      { name: 'chat-minute', ttl: 60_000, limit: 2 },
      { name: 'upload-hour', ttl: 3_600_000, limit: 1 },
    ]);
  });
});

describe('limitMessage', () => {
  it.each([
    [
      'chat',
      42,
      "You're sending messages too quickly. Try again in 42 seconds.",
    ],
    ['chat', 1, "You're sending messages too quickly. Try again in 1 second."],
    [
      'upload',
      600,
      "You've reached the upload limit. Try again in 10 minutes.",
    ],
    [
      'upload',
      2 * 3600,
      "You've reached the upload limit. Try again in 2 hours.",
    ],
  ] as const)('%s / %ds', (kind, retry, expected) => {
    expect(limitMessage(kind, retry)).toBe(expected);
  });
});
