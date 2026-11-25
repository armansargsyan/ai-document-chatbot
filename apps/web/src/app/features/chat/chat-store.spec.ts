import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import type { ConversationDetail } from '@ai-document-chatbot/shared';
import { AuthClient } from '../../core/auth/auth-client';
import { AuthService } from '../../core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from '../../core/auth/testing/fake-auth-client';
import { FETCH } from './chat-api';
import { CHAT_SERVER_MESSAGE } from './chat-errors';
import { ChatStore, type ConversationActivity } from './chat-store';
import { CITATIONS, FakeFetch, sse } from './testing/fake-fetch';

const MODEL = 'claude-haiku-5-5' as const;

const DETAIL: ConversationDetail = {
  id: 'c-old',
  title: 'Rent questions',
  createdAt: '2026-11-24T10:00:00.000Z',
  updatedAt: '2026-11-24T10:01:00.000Z',
  messageCount: 2,
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'When is rent due?',
      createdAt: '2026-11-24T10:00:00.000Z',
      modelId: null,
      citations: [],
    },
    {
      id: 'm2',
      role: 'assistant',
      content: 'On the 1st [1].',
      createdAt: '2026-11-24T10:01:00.000Z',
      modelId: MODEL,
      citations: [CITATIONS[0]],
    },
  ],
};

describe('ChatStore', () => {
  let fake: FakeFetch;
  let store: ChatStore;
  let navigate: ReturnType<typeof vi.spyOn>;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    fake = new FakeFetch();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        ChatStore,
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthClient, useValue: auth },
        { provide: FETCH, useValue: fake.fn },
      ],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
    auth.emit(TEST_USER);
    navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    store = TestBed.inject(ChatStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  /** Lets httpResource deliver a flushed response. */
  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  const assistant = () => {
    const entries = store.entries();
    return entries[entries.length - 1];
  };

  it('streams an answer into a new conversation and puts it in the URL', async () => {
    const body = fake.stream();
    expect(store.send('  When is rent due?  ', MODEL)).toBe(true);

    expect(store.entries().map((e) => [e.role, e.content, e.status])).toEqual([
      ['user', 'When is rent due?', 'done'],
      ['assistant', '', 'pending'],
    ]);
    expect(store.streaming()).toBe(true);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    expect(fake.body()).toEqual({
      message: 'When is rent due?',
      modelId: MODEL,
    });

    body.push(sse({ type: 'delta', text: 'On the ' }));
    await vi.waitFor(() => expect(assistant().status).toBe('streaming'));
    body.push(sse({ type: 'delta', text: '1st [1].' }));
    await vi.waitFor(() => expect(assistant().content).toBe('On the 1st [1].'));
    expect(store.announcement()).toBe(''); // not announced per delta

    body.push(
      sse({
        type: 'done',
        modelId: MODEL,
        conversationId: 'c-new',
        citations: CITATIONS,
      }),
    );
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(assistant()).toMatchObject({ status: 'done', citations: CITATIONS });
    expect(store.conversationId()).toBe('c-new');
    expect(store.announcement()).toBe('Answer complete.');
    expect(navigate).toHaveBeenCalledWith(['/chat', 'c-new'], {
      replaceUrl: true,
    });

    // The router then reports that id: the page keeps its state.
    store.open('c-new');
    httpMock.expectNone(() => true);
    expect(store.entries()).toHaveLength(2);
  });

  it('continues an existing conversation without navigating', async () => {
    store.open('c-old');
    TestBed.tick();
    httpMock.expectOne('/api/conversations/c-old').flush(DETAIL);
    await settle();
    expect(store.historyState()).toBe('ready');
    expect(store.entries().map((e) => e.content)).toEqual([
      'When is rent due?',
      'On the 1st [1].',
    ]);

    fake.events({
      type: 'done',
      modelId: MODEL,
      conversationId: 'c-old',
      citations: [],
    });
    store.send('And late fees?', MODEL);
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(fake.body().conversationId).toBe('c-old');
    expect(store.entries()).toHaveLength(4);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stops: aborts the request and keeps the partial text', async () => {
    const body = fake.stream();
    store.send('Summarize', MODEL);
    body.push(sse({ type: 'delta', text: 'The lease ' }));
    await vi.waitFor(() => expect(assistant().content).toBe('The lease '));

    store.stop();
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(fake.calls[0].init?.signal?.aborted).toBe(true);
    expect(assistant()).toMatchObject({
      status: 'stopped',
      content: 'The lease ',
    });
    expect(store.announcement()).toContain('Stopped');
  });

  it('adopts the conversation from `start`, so Stop before `done` keeps using it', async () => {
    const body = fake.stream();
    store.send('Summarize', MODEL);
    body.push(sse({ type: 'start', conversationId: 'c-early' }));
    body.push(sse({ type: 'delta', text: 'The lease ' }));
    await vi.waitFor(() => expect(assistant().content).toBe('The lease '));

    store.stop();
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(store.conversationId()).toBe('c-early');
    expect(navigate).toHaveBeenCalledWith(['/chat', 'c-early'], {
      replaceUrl: true,
    });

    // The next message continues that conversation instead of starting another.
    fake.events(
      { type: 'start', conversationId: 'c-early' },
      { type: 'delta', text: 'ok' },
      {
        type: 'done',
        modelId: MODEL,
        conversationId: 'c-early',
        citations: [],
      },
    );
    store.send('And the deposit?', MODEL);
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(fake.body(1).conversationId).toBe('c-early');
  });

  it('forgets a conversation deleted mid-stream so Retry starts a new one', async () => {
    fake.events(
      { type: 'start', conversationId: 'c-gone' },
      { type: 'error', status: 404, message: 'Conversation not found' },
    );
    store.send('Summarize', MODEL);
    await vi.waitFor(() => expect(assistant().status).toBe('error'));
    expect(store.conversationId()).toBeUndefined();
    expect(navigate).toHaveBeenLastCalledWith(['/chat'], { replaceUrl: true });

    fake.events(
      { type: 'start', conversationId: 'c-fresh' },
      { type: 'delta', text: 'ok' },
      {
        type: 'done',
        modelId: MODEL,
        conversationId: 'c-fresh',
        citations: [],
      },
    );
    store.retry(assistant().id);
    await vi.waitFor(() => expect(store.streaming()).toBe(false));
    expect(fake.body(1).conversationId).toBeUndefined();
    expect(store.conversationId()).toBe('c-fresh');
  });

  it('keeps the conversation from a mid-stream error so Retry continues it', async () => {
    fake.events(
      { type: 'delta', text: 'Partial' },
      {
        type: 'error',
        status: 502,
        message: 'The model failed to answer',
        conversationId: 'c-saved',
      },
    );
    store.send('When is rent due?', MODEL);
    await vi.waitFor(() => expect(assistant().status).toBe('error'));
    expect(assistant().error).toBe(CHAT_SERVER_MESSAGE);
    expect(store.conversationId()).toBe('c-saved');
    expect(navigate).toHaveBeenCalledWith(['/chat', 'c-saved'], {
      replaceUrl: true,
    });

    fake.events({
      type: 'done',
      modelId: 'gpt-6.2-astra',
      conversationId: 'c-saved',
      citations: [],
    });
    expect(store.retry(assistant().id, 'gpt-6.2-astra')).toBe(true);
    expect(assistant()).toMatchObject({ status: 'pending', content: '' });
    await vi.waitFor(() => expect(assistant().status).toBe('done'));
    expect(fake.body()).toEqual({
      message: 'When is rent due?',
      modelId: 'gpt-6.2-astra',
      conversationId: 'c-saved',
    });
    // Retried in place: still one user turn and one answer.
    expect(store.entries().map((e) => e.role)).toEqual(['user', 'assistant']);
  });

  it('shows a pre-stream 429 on the turn and can retry it', async () => {
    const message =
      'You’re sending messages too quickly. Try again in 42 seconds.';
    fake.json(429, { statusCode: 429, message }, { 'Retry-After': '42' });
    store.send('Hi', MODEL);
    await vi.waitFor(() => expect(assistant().status).toBe('error'));
    expect(assistant().error).toBe(message);
    expect(store.conversationId()).toBeUndefined();

    fake.events({
      type: 'done',
      modelId: MODEL,
      conversationId: 'c1',
      citations: [],
    });
    store.retry(assistant().id);
    await vi.waitFor(() => expect(assistant().status).toBe('done'));
    expect(fake.body()).toEqual({ message: 'Hi', modelId: MODEL });
  });

  it('refuses to send while streaming, when empty or too long', async () => {
    fake.stream();
    expect(store.send('   ', MODEL)).toBe(false);
    expect(store.send('x'.repeat(4001), MODEL)).toBe(false);
    expect(store.send('First', MODEL)).toBe(true);
    expect(store.send('Second', MODEL)).toBe(false);
    expect(store.entries()).toHaveLength(2);
  });

  it('reports a missing conversation and blocks sending into it', async () => {
    store.open('c-gone');
    TestBed.tick();
    httpMock
      .expectOne('/api/conversations/c-gone')
      .flush(
        { statusCode: 404, message: 'Conversation not found' },
        { status: 404, statusText: 'Not Found' },
      );
    await settle();
    expect(store.historyState()).toBe('not-found');
    expect(store.send('Hello?', MODEL)).toBe(false);
  });

  it('blocks sending while history failed to load, until a reload succeeds', async () => {
    store.open('c-old');
    TestBed.tick();
    httpMock
      .expectOne('/api/conversations/c-old')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await settle();
    expect(store.historyState()).toBe('error');
    expect(store.send('Hello?', MODEL)).toBe(false);
    expect(fake.calls).toHaveLength(0);

    store.reloadHistory();
    TestBed.tick();
    httpMock.expectOne('/api/conversations/c-old').flush(DETAIL);
    await settle();
    expect(store.historyState()).toBe('ready');
    fake.stream();
    expect(store.send('Hello?', MODEL)).toBe(true);
  });

  it('cancels the stream when another conversation is opened', async () => {
    const body = fake.stream();
    store.send('Summarize', MODEL);
    body.push(sse({ type: 'delta', text: 'Partial' }));
    await vi.waitFor(() => expect(assistant().content).toBe('Partial'));

    store.open('c-old');
    expect(store.streaming()).toBe(false);
    expect(store.entries()).toEqual([]);
    await vi.waitFor(() =>
      expect(fake.calls[0].init?.signal?.aborted).toBe(true),
    );
    TestBed.tick();
    httpMock.expectOne('/api/conversations/c-old').flush(DETAIL);
    await settle();
    // The aborted stream wrote nothing into the newly opened conversation.
    expect(store.entries().map((e) => e.id)).toEqual(['m1', 'm2']);
  });

  describe('reset', () => {
    it('clears turns kept after a conversation was forgotten', async () => {
      fake.events(
        { type: 'start', conversationId: 'c-gone' },
        { type: 'error', status: 404, message: 'Conversation not found' },
      );
      store.send('Summarize', MODEL);
      await vi.waitFor(() => expect(assistant().status).toBe('error'));
      expect(store.conversationId()).toBeUndefined();
      // The route's open(undefined) can't clear these: the id already matches.
      store.open(undefined);
      expect(store.entries()).toHaveLength(2);

      store.reset();
      expect(store.entries()).toEqual([]);
      expect(store.announcement()).toBe('');
      expect(store.historyState()).toBe('none');
    });

    it('stops a running answer and drops the open conversation', async () => {
      store.open('c-old');
      TestBed.tick();
      httpMock.expectOne('/api/conversations/c-old').flush(DETAIL);
      await settle();
      const body = fake.stream();
      store.send('More?', MODEL);
      await vi.waitFor(() => expect(fake.calls).toHaveLength(1));

      store.reset();
      expect(store.streaming()).toBe(false);
      expect(store.conversationId()).toBeUndefined();
      expect(store.entries()).toEqual([]);
      expect(fake.calls[0].init?.signal?.aborted).toBe(true);
      body.close();
    });
  });

  it('reports activity on start and done for the history list', async () => {
    const seen: ConversationActivity[] = [];
    store.activity.subscribe((a) => seen.push(a));
    fake.events(
      { type: 'start', conversationId: 'c-new' },
      { type: 'delta', text: 'ok' },
      { type: 'done', modelId: MODEL, conversationId: 'c-new', citations: [] },
    );
    store.send('  When is rent due?  ', MODEL);
    await vi.waitFor(() => expect(store.streaming()).toBe(false));

    expect(seen).toHaveLength(2);
    for (const a of seen) {
      expect(a).toMatchObject({
        conversationId: 'c-new',
        message: 'When is rent due?',
      });
      expect(Number.isNaN(Date.parse(a.at))).toBe(false);
    }
  });
});
