import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import type {
  ChatStreamEvent,
  LlmProviderId,
} from '@ai-document-chatbot/shared';
import { AuthModule } from '../auth/auth.module';
import { TokenVerifier, type AuthUser } from '../auth/token-verifier';
import {
  LLM_PROVIDERS,
  type ChatStreamRequest,
  type LlmProvider,
} from '../llm/llm-provider';
import { LlmService } from '../llm/llm.service';
import {
  RetrievalService,
  type RetrievedChunk,
} from '../retrieval/retrieval.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationsService } from '../conversations/conversations.service';
import { NotFoundException } from '@nestjs/common';

class FakeTokenVerifier extends TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (token !== 'valid') throw new Error('bad token');
    return { uid: 'user-1', email: null, name: null, picture: null };
  }
}

/** Scripted provider; records what it was asked and whether it was aborted. */
class ScriptedProvider implements LlmProvider {
  readonly id: LlmProviderId = 'anthropic';
  requests: ChatStreamRequest[] = [];
  script: (request: ChatStreamRequest) => AsyncIterable<string> =
    async function* () {
      yield 'Refunds take ';
      yield '14 days [1].';
    };
  streamChat(request: ChatStreamRequest) {
    this.requests.push(request);
    return this.script(request);
  }
}

const retrieved: RetrievedChunk[] = [
  {
    documentId: 'doc-1',
    documentName: 'Policy.pdf',
    page: 2,
    text: 'Refunds within 14 days.',
    distance: 0.1,
  },
];

const CONV = 'abcdefghij0123456789';
const NEW_CONV = 'newconversation00001';

/** Records what the chat flow saves; knows one existing conversation for user-1. */
class FakeConversations {
  history: { role: 'user' | 'assistant'; content: string }[] = [];
  saved: unknown[] = [];
  failAssistantSave = false;
  assistantSaveGone = false;
  async historyFor(uid: string, id: string) {
    if (uid !== 'user-1' || id !== CONV)
      throw new NotFoundException('Conversation not found');
    return this.history;
  }
  async recordUserMessage(
    uid: string,
    id: string | undefined,
    content: string,
  ) {
    this.saved.push({ kind: 'user', uid, id: id ?? null, content });
    return id ?? NEW_CONV;
  }
  async recordAssistantMessage(uid: string, id: string, answer: unknown) {
    if (this.assistantSaveGone)
      throw new NotFoundException('Conversation not found');
    if (this.failAssistantSave) throw new Error('firestore down');
    this.saved.push({ kind: 'assistant', uid, id, answer });
  }
}

class FakeRetrieval {
  available = true;
  failWith: unknown = null;
  /** When set, retrieval waits for this before returning. */
  gate: Promise<void> | null = null;
  calls: [string, string][] = [];
  async retrieve(uid: string, question: string) {
    this.calls.push([uid, question]);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return retrieved;
  }
}

/** Parses an SSE body into events. */
async function readEvents(res: Response): Promise<ChatStreamEvent[]> {
  const body = await res.text();
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const data = block.split('\n').find((line) => line.startsWith('data: '));
      return JSON.parse((data ?? '').slice('data: '.length)) as ChatStreamEvent;
    });
}

describe('chat stream (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const provider = new ScriptedProvider();
  const retrieval = new FakeRetrieval();
  const conversations = new FakeConversations();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [ChatController],
      providers: [
        ChatService,
        LlmService,
        { provide: LLM_PROVIDERS, useValue: [provider] },
        { provide: RetrievalService, useValue: retrieval },
        {
          provide: ConversationsService,
          useValue: {
            history: (uid: string, id: string) =>
              conversations.historyFor(uid, id),
            recordUserMessage:
              conversations.recordUserMessage.bind(conversations),
            recordAssistantMessage:
              conversations.recordAssistantMessage.bind(conversations),
          },
        },
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

  beforeEach(() => {
    provider.requests = [];
    retrieval.calls = [];
    retrieval.available = true;
    retrieval.failWith = null;
    retrieval.gate = null;
    conversations.history = [];
    conversations.saved = [];
    conversations.failAssistantSave = false;
    conversations.assistantSaveGone = false;
    provider.script = async function* () {
      yield 'Refunds take ';
      yield '14 days [1].';
    };
  });

  const post = (body: unknown, token = 'valid', signal?: AbortSignal) =>
    fetch(`${baseUrl}/chat/stream`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

  const question = {
    message: 'How long do refunds take?',
    modelId: 'claude-haiku-5-5',
  };

  it('requires authentication', async () => {
    expect((await post(question, 'nope')).status).toBe(401);
  });

  it('streams deltas then a done event with citations', async () => {
    const res = await post({
      ...question,
      conversationId: CONV,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const events = await readEvents(res);
    expect(events).toEqual([
      { type: 'start', conversationId: CONV },
      { type: 'delta', text: 'Refunds take ' },
      { type: 'delta', text: '14 days [1].' },
      {
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: CONV,
        citations: [
          {
            number: 1,
            documentId: 'doc-1',
            documentName: 'Policy.pdf',
            page: 2,
            snippet: 'Refunds within 14 days.',
          },
        ],
      },
    ]);
    // Retrieval is scoped to the caller, and the excerpts reach the model.
    expect(retrieval.calls).toEqual([['user-1', 'How long do refunds take?']]);
    expect(provider.requests[0].messages[0].content).toContain(
      'Refunds within 14 days.',
    );
    // Both turns are saved; the answer carries the model and citations.
    expect(conversations.saved).toEqual([
      {
        kind: 'user',
        uid: 'user-1',
        id: CONV,
        content: 'How long do refunds take?',
      },
      {
        kind: 'assistant',
        uid: 'user-1',
        id: CONV,
        answer: expect.objectContaining({
          content: 'Refunds take 14 days [1].',
          modelId: 'claude-haiku-5-5',
          citations: [expect.objectContaining({ number: 1, page: 2 })],
        }),
      },
    ]);
  });

  it('starts a new conversation and returns its id', async () => {
    const events = await readEvents(await post(question));
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      conversationId: NEW_CONV,
    });
    expect(conversations.saved[0]).toMatchObject({ kind: 'user', id: null });
  });

  it('sends earlier turns as context before the grounded question', async () => {
    conversations.history = [
      { role: 'user', content: 'What is the policy?' },
      { role: 'assistant', content: 'It covers refunds [1].' },
    ];
    await readEvents(await post({ ...question, conversationId: CONV }));
    const sent = provider.requests[0].messages;
    expect(sent.slice(0, 2)).toEqual([
      { role: 'user', content: 'What is the policy?' },
      // Old citation markers are stripped: they referred to earlier excerpts.
      { role: 'assistant', content: 'It covers refunds.' },
    ]);
    expect(sent[2].role).toBe('user');
    expect(sent[2].content).toContain('Question: How long do refunds take?');
  });

  it('returns 404 before anything else for a conversation that is not the caller’s', async () => {
    const res = await post({
      ...question,
      conversationId: 'zzzzzzzzzz0123456789',
    });
    expect(res.status).toBe(404);
    expect(retrieval.calls).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
    expect(conversations.saved).toHaveLength(0);
  });

  it('includes the conversation id in error events so a retry continues it', async () => {
    provider.script = async function* () {
      yield 'partial';
      throw Object.assign(new Error('boom'), { status: 500 });
    };
    const events = await readEvents(await post(question));
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      conversationId: NEW_CONV,
    });
  });

  it('does not save an empty answer and ends with an error event', async () => {
    provider.script = async function* () {
      yield* [];
    };
    const events = await readEvents(await post(question));
    expect(events).toEqual([
      { type: 'start', conversationId: NEW_CONV },
      expect.objectContaining({
        type: 'error',
        status: 502,
        conversationId: NEW_CONV,
      }),
    ]);
    expect(
      conversations.saved.some(
        (x) => (x as { kind: string }).kind === 'assistant',
      ),
    ).toBe(false);
  });

  it('reports a conversation deleted mid-stream as 404 without its id', async () => {
    conversations.assistantSaveGone = true;
    const events = await readEvents(
      await post({ ...question, conversationId: CONV }),
    );
    const last = events.at(-1);
    expect(last).toMatchObject({ type: 'error', status: 404 });
    expect(last).not.toHaveProperty('conversationId');
  });

  it('ends with an error event instead of done when the answer cannot be saved', async () => {
    conversations.failAssistantSave = true;
    const events = await readEvents(await post(question));
    expect(events.at(-1)).toMatchObject({ type: 'error', status: 502 });
    expect(events.some((e) => e.type === 'done')).toBe(false);
  });

  it('rejects invalid input with a 400 JSON error before streaming', async () => {
    const res = await post({ message: '', modelId: 'claude-haiku-5-5' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(provider.requests).toHaveLength(0);
  });

  it('returns 503 before streaming when the model provider is not configured', async () => {
    const res = await post({ ...question, modelId: 'gpt-6-luna' });
    expect(res.status).toBe(503);
    expect(retrieval.calls).toHaveLength(0);
  });

  it('returns 503 before streaming when document search is unavailable', async () => {
    retrieval.available = false;
    expect((await post(question)).status).toBe(503);
  });

  it.each([
    [
      'a Firestore error (e.g. missing vector index)',
      Object.assign(new Error('FAILED_PRECONDITION: index'), { code: 9 }),
      503,
    ],
    [
      'an embedding rate limit',
      Object.assign(new Error('rate limited'), { status: 429 }),
      429,
    ],
    [
      'a rejected embedding key',
      Object.assign(new Error('invalid key'), { status: 401 }),
      503,
    ],
  ])(
    'maps %s during retrieval to a JSON error before streaming',
    async (_label, error, expected) => {
      retrieval.failWith = error;
      const res = await post(question);
      expect(res.status).toBe(expected);
      expect(res.headers.get('content-type')).toContain('application/json');
      const body = await res.text();
      expect(body).not.toContain('FAILED_PRECONDITION');
      expect(provider.requests).toHaveLength(0);
    },
  );

  it('ends with an error event when the provider fails mid-stream', async () => {
    provider.script = async function* () {
      yield 'partial ';
      throw Object.assign(new Error('upstream secret detail'), { status: 529 });
    };
    const res = await post(question);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('upstream secret detail');
    const events = body.split('\n\n').filter(Boolean);
    expect(events[0]).toContain('event: start');
    expect(events[1]).toContain('"partial "');
    expect(events.at(-1)).toContain('event: error');
    expect(events.at(-1)).toContain('"status":502');
  });

  it('does not start a model call if the client left during retrieval', async () => {
    let release!: () => void;
    retrieval.gate = new Promise((resolve) => (release = resolve));
    const client = new AbortController();
    const pending = post(question, 'valid', client.signal).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(retrieval.calls).toHaveLength(1));
    client.abort();
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the server see the close
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(provider.requests).toHaveLength(0);
  });

  it('aborts the upstream model call when the client disconnects', async () => {
    let upstreamAborted: Promise<boolean> = Promise.resolve(false);
    provider.script = (request) => {
      upstreamAborted = new Promise((resolve) =>
        request.signal?.addEventListener('abort', () => resolve(true)),
      );
      return (async function* () {
        yield 'first ';
        await upstreamAborted;
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      })();
    };
    const client = new AbortController();
    const res = await post(question, 'valid', client.signal);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    await reader.read(); // first delta arrived
    client.abort();
    await expect(upstreamAborted).resolves.toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The user turn stays; no (partial) assistant message is saved.
    expect(conversations.saved).toEqual([
      expect.objectContaining({ kind: 'user' }),
    ]);
  });
});
