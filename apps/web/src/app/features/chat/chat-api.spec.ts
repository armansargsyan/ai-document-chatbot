import { TestBed } from '@angular/core/testing';
import type { ChatRequest, ChatStreamEvent } from '@ai-document-chatbot/shared';
import { AuthClient } from '../../core/auth/auth-client';
import { AuthService } from '../../core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from '../../core/auth/testing/fake-auth-client';
import { CHAT_STREAM_URL, ChatApi, FETCH } from './chat-api';
import {
  CHAT_INTERRUPTED_MESSAGE,
  CHAT_NETWORK_MESSAGE,
  CHAT_SERVER_MESSAGE,
  CHAT_UNAVAILABLE_MESSAGE,
  ChatError,
} from './chat-errors';
import { CITATIONS, FakeFetch, sse } from './testing/fake-fetch';

const REQUEST: ChatRequest = {
  message: 'When is rent due?',
  modelId: 'claude-haiku-5-5',
};

describe('ChatApi', () => {
  let fake: FakeFetch;
  let auth: FakeAuthClient;
  let api: ChatApi;

  beforeEach(() => {
    fake = new FakeFetch();
    auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthClient, useValue: auth },
        { provide: FETCH, useValue: fake.fn },
      ],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
    auth.emit(TEST_USER);
    api = TestBed.inject(ChatApi);
  });

  async function collect(
    request = REQUEST,
    signal = new AbortController().signal,
  ): Promise<{ events: ChatStreamEvent[]; error: unknown }> {
    const events: ChatStreamEvent[] = [];
    try {
      for await (const event of api.stream(request, signal)) events.push(event);
      return { events, error: null };
    } catch (error) {
      return { events, error };
    }
  }

  it('POSTs the request as JSON with the bearer token', async () => {
    fake.events({
      type: 'done',
      modelId: 'claude-haiku-5-5',
      conversationId: 'c1',
      citations: [],
    });
    await collect({ ...REQUEST, conversationId: 'c0' });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(CHAT_STREAM_URL);
    expect(fake.calls[0].init?.method).toBe('POST');
    expect(fake.header('Authorization')).toBe('Bearer test-id-token');
    expect(fake.header('Content-Type')).toBe('application/json');
    expect(fake.body()).toEqual({ ...REQUEST, conversationId: 'c0' });
  });

  it('passes the start event through first', async () => {
    fake.events(
      { type: 'start', conversationId: 'c9' },
      {
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: 'c9',
        citations: [],
      },
    );
    const { events } = await collect();
    expect(events[0]).toEqual({ type: 'start', conversationId: 'c9' });
  });

  it('reports a failed token refresh as a network problem, without calling the api', async () => {
    auth.getIdToken = () =>
      Promise.reject(new Error('auth/network-request-failed'));
    const { error } = await collect();
    expect(fake.calls).toHaveLength(0);
    expect((error as ChatError).status).toBe(0);
    expect((error as ChatError).message).toBe(CHAT_NETWORK_MESSAGE);
  });

  it('sends no Authorization header without a token', async () => {
    auth.token = null;
    fake.json(401, { statusCode: 401, message: 'Unauthorized' });
    const { error } = await collect();
    expect(fake.header('Authorization')).toBeNull();
    expect((error as ChatError).status).toBe(401);
    expect((error as ChatError).message).toContain('session has expired');
  });

  it('yields deltas as they arrive, then done with citations', async () => {
    const body = fake.stream();
    const iterator = api.stream(REQUEST, new AbortController().signal);

    const first = iterator.next();
    body.push(sse({ type: 'delta', text: 'Rent is due ' }));
    expect(await first).toEqual({
      done: false,
      value: { type: 'delta', text: 'Rent is due ' },
    });

    // One event split over two chunks, plus the terminal event in the second.
    const second = sse({ type: 'delta', text: 'on the 1st [1].' });
    body.push(second.slice(0, 10));
    const next = iterator.next();
    body.push(
      second.slice(10) +
        sse({
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId: 'c1',
          citations: CITATIONS,
        }),
    );
    expect((await next).value).toEqual({
      type: 'delta',
      text: 'on the 1st [1].',
    });
    expect((await iterator.next()).value).toEqual({
      type: 'done',
      modelId: 'claude-haiku-5-5',
      conversationId: 'c1',
      citations: CITATIONS,
    });
    expect((await iterator.next()).done).toBe(true);
  });

  it('skips malformed events', async () => {
    const body = fake.stream();
    body.push('event: delta\ndata: {broken\n\n');
    body.push(sse({ type: 'delta', text: 'ok' }));
    body.push(
      sse({
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: 'c1',
        citations: [],
      }),
    );
    body.close();
    const { events, error } = await collect();
    expect(error).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
  });

  it('decodes a multi-byte character split across chunks', async () => {
    const body = fake.stream();
    const bytes = new TextEncoder().encode(
      sse({ type: 'delta', text: 'café ✓' }),
    );
    const split = bytes.indexOf(0xc3) + 1; // inside "é"
    const iterator = api.stream(REQUEST, new AbortController().signal);
    const next = iterator.next();
    body.pushBytes(bytes.slice(0, split));
    body.pushBytes(bytes.slice(split));
    expect((await next).value).toEqual({ type: 'delta', text: 'café ✓' });
  });

  it('stops on abort: the reader rejects with an AbortError', async () => {
    const body = fake.stream();
    const controller = new AbortController();
    const iterator = api.stream(REQUEST, controller.signal);
    const first = iterator.next();
    body.push(sse({ type: 'delta', text: 'Partial' }));
    await first;

    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.calls[0].init?.signal).toBe(controller.signal);
  });

  it('ends a pending read on abort even if the body ignores the signal', async () => {
    const body = fake.stream({ ignoreAbort: true });
    const controller = new AbortController();
    const iterator = api.stream(REQUEST, controller.signal);
    const first = iterator.next();
    body.push(sse({ type: 'delta', text: 'Partial' }));
    await first;

    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('turns a mid-stream error event into a ChatError that keeps the conversation', async () => {
    fake.events(
      { type: 'delta', text: 'Rent' },
      {
        type: 'error',
        status: 502,
        message: 'The model failed to answer',
        conversationId: 'c-new',
      },
    );
    const { events, error } = await collect();
    expect(events).toEqual([{ type: 'delta', text: 'Rent' }]);
    expect(error).toBeInstanceOf(ChatError);
    expect(error).toMatchObject({
      status: 502,
      message: CHAT_SERVER_MESSAGE,
      conversationId: 'c-new',
    });
  });

  it('treats a stream that ends without done as interrupted', async () => {
    fake.events({ type: 'delta', text: 'Rent' });
    const { error } = await collect();
    expect(error).toMatchObject({ message: CHAT_INTERRUPTED_MESSAGE });
  });

  describe('errors before streaming', () => {
    it('shows the server message for 429', async () => {
      const message =
        'You’re sending messages too quickly. Try again in 42 seconds.';
      fake.json(429, { statusCode: 429, message }, { 'Retry-After': '42' });
      const { error } = await collect();
      expect(error).toMatchObject({ status: 429, message });
    });

    it('falls back to Retry-After when a 429 has no message', async () => {
      fake.json(429, {}, { 'Retry-After': '42' });
      const { error } = await collect();
      expect((error as ChatError).message).toContain('42 seconds');
    });

    it('shows the server message for 404', async () => {
      fake.json(404, { statusCode: 404, message: 'Conversation not found' });
      const { error } = await collect();
      expect(error).toMatchObject({
        status: 404,
        message: 'Conversation not found',
      });
    });

    it('uses friendly copy for 503, not the server text', async () => {
      fake.json(503, {
        statusCode: 503,
        message: 'The selected model is unavailable',
      });
      const { error } = await collect();
      expect(error).toMatchObject({
        status: 503,
        message: CHAT_UNAVAILABLE_MESSAGE,
      });
    });

    it('never shows a raw 500 body', async () => {
      fake.json(500, { message: 'TypeError: x is undefined at foo.ts:12' });
      const { error } = await collect();
      expect((error as ChatError).message).toBe(CHAT_SERVER_MESSAGE);
    });

    it('reports a network failure', async () => {
      fake.networkError();
      const { error } = await collect();
      expect(error).toMatchObject({ status: 0, message: CHAT_NETWORK_MESSAGE });
    });
  });
});
