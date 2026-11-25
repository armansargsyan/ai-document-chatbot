import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  ConversationDetail,
  DocumentSummary,
  LlmModelsResponse,
} from '@ai-document-chatbot/shared';
import { AuthClient } from '../../core/auth/auth-client';
import { AuthService } from '../../core/auth/auth.service';
import {
  FakeAuthClient,
  TEST_CONFIG,
  TEST_USER,
} from '../../core/auth/testing/fake-auth-client';
import { FETCH } from './chat-api';
import { MODEL_STORAGE } from './chat-models';
import { ChatPage } from './chat-page';
import { chatRoute } from './chat-route';
import {
  CITATIONS,
  FakeFetch,
  MODELS,
  MemoryStorage,
  sse,
  type StreamControl,
} from './testing/fake-fetch';

@Component({ template: '<p>documents</p>' })
class DocumentsStub {}

const READY_DOC: DocumentSummary = {
  id: 'doc-1',
  name: 'Lease agreement.pdf',
  sizeBytes: 1000,
  status: 'ready',
  pageCount: 12,
  chunkCount: 30,
  createdAt: '2026-11-24T10:00:00.000Z',
};

/** querySelector that fails the test instead of returning null. */
function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const NO_MODELS: LlmModelsResponse = {
  ...MODELS,
  models: MODELS.models.map((m) => ({ ...m, available: false })),
};

const ANSWER_TEXT =
  'Rent is due on the **1st** of each month [1].\n\n- Quiet hours start at 10 pm [2]';

describe('ChatPage', () => {
  let fake: FakeFetch;
  let harness: RouterTestingHarness;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    fake = new FakeFetch();
    const auth = new FakeAuthClient();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [chatRoute, { path: 'documents', component: DocumentsStub }],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthClient, useValue: auth },
        { provide: FETCH, useValue: fake.fn },
        { provide: MODEL_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    TestBed.inject(AuthService).start(TEST_CONFIG);
    auth.emit(TEST_USER);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    harness?.fixture.destroy();
    httpMock.verify();
  });

  const el = () => harness.routeNativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string) => [
    ...el().querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const overlay = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const stable = () => harness.fixture.whenStable();

  async function render(
    url = '/chat',
    {
      models = MODELS,
      documents = [READY_DOC],
      conversation,
    }: {
      models?: LlmModelsResponse;
      documents?: DocumentSummary[];
      conversation?: ConversationDetail | 404 | 500;
    } = {},
  ) {
    harness = await RouterTestingHarness.create(url);
    TestBed.tick();
    httpMock.expectOne('/api/models').flush(models);
    httpMock.expectOne('/api/documents').flush({ documents });
    if (conversation !== undefined) {
      const req = httpMock.expectOne((r) =>
        r.url.startsWith('/api/conversations/'),
      );
      if (conversation === 500) {
        req.flush('boom', { status: 500, statusText: 'Server Error' });
      } else if (conversation === 404) {
        req.flush(
          { statusCode: 404, message: 'Conversation not found' },
          { status: 404, statusText: 'Not Found' },
        );
      } else {
        req.flush(conversation);
      }
    }
    await stable();
  }

  async function typeAndSend(text: string) {
    const input = must<HTMLTextAreaElement>(
      el(),
      '[data-testid="composer-input"]',
    );
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await stable();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );
    await stable();
  }

  /** Waits until the async stream consumer has caught up. */
  async function until(check: () => void) {
    await vi.waitFor(async () => {
      await stable();
      check();
    });
  }

  async function answer(body: StreamControl) {
    body.push(sse({ type: 'delta', text: ANSWER_TEXT }));
    body.push(
      sse({
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: 'c-new',
        citations: CITATIONS,
      }),
    );
    await until(() => expect(all('citation-chip')).toHaveLength(2));
  }

  describe('empty state', () => {
    it('shows an intro and example prompts that fill the composer', async () => {
      await render();
      expect(q('chat-empty')?.textContent).toContain(
        'Ask your documents anything',
      );
      expect(q('upload-cta')).toBeNull();

      const examples = all('example-prompt');
      expect(examples.length).toBeGreaterThanOrEqual(3);
      examples[1].click();
      await stable();
      expect(q<HTMLTextAreaElement>('composer-input')?.value).toBe(
        examples[1].textContent?.trim(),
      );
    });

    it('points to the documents page when no document is ready', async () => {
      await render('/chat', {
        documents: [{ ...READY_DOC, status: 'processing' }],
      });
      const cta = q('upload-cta');
      expect(cta?.textContent).toContain('ready documents');
      expect(cta?.querySelector('a')?.getAttribute('href')).toBe('/documents');
    });
  });

  describe('model switcher', () => {
    it('groups models by provider and disables unavailable ones', async () => {
      await render();
      const select = must<HTMLSelectElement>(el(), '#chat-model');
      expect(el().querySelector('label[for="chat-model"]')?.textContent).toBe(
        'Model',
      );
      expect(
        [...select.querySelectorAll('optgroup')].map((g) => g.label),
      ).toEqual(['OpenAI', 'Claude', 'Gemini']);
      const gemini = must<HTMLOptionElement>(
        select,
        'option[value="gemini-4-argon"]',
      );
      expect(gemini.disabled).toBe(true);
      expect(gemini.textContent).toContain('(unavailable)');
      expect(select.value).toBe('claude-haiku-5-5');

      select.value = 'gpt-6.2-astra';
      select.dispatchEvent(new Event('change'));
      await stable();
      const body = fake.stream();
      await typeAndSend('Hi');
      await until(() => expect(fake.calls).toHaveLength(1));
      expect(fake.body().modelId).toBe('gpt-6.2-astra');
      body.close();
    });

    it('explains and disables sending when no model is available', async () => {
      await render('/chat', { models: NO_MODELS });
      expect(q('no-models')?.textContent).toContain(
        'No AI models are available',
      );
      expect(q<HTMLTextAreaElement>('composer-input')?.disabled).toBe(true);
      expect(q<HTMLButtonElement>('composer-send')?.disabled).toBe(true);
      expect(
        el().querySelector<HTMLSelectElement>('#chat-model')?.disabled,
      ).toBe(true);
    });
  });

  describe('sending', () => {
    it('streams the answer and moves a new conversation to its URL in place', async () => {
      await render();
      const page = harness.routeDebugElement?.componentInstance as ChatPage;
      const body = fake.stream();
      await typeAndSend('When is rent due?');

      expect(all('user-message').map((m) => m.textContent?.trim())).toEqual([
        'You: When is rent due?',
      ]);
      expect(q('typing-indicator')).not.toBeNull();
      expect(q<HTMLTextAreaElement>('composer-input')?.value).toBe('');
      expect(q('composer-stop')).not.toBeNull();
      expect(q('message-log')?.getAttribute('aria-busy')).toBe('true');

      body.push(sse({ type: 'delta', text: 'Rent is due on the ' }));
      await until(() =>
        expect(q('assistant-message')?.textContent).toContain(
          'Rent is due on the',
        ),
      );
      expect(q('typing-indicator')).toBeNull();

      await answer(body);
      const message = must<HTMLElement>(
        el(),
        '[data-testid="assistant-message"]',
      );
      expect(message.querySelector('strong')?.textContent).toBe('1st');
      expect(
        message.querySelector('app-chat-markdown')?.querySelectorAll('li'),
      ).toHaveLength(1);
      const chips = all('citation-chip');
      expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
        'Source 1: Lease agreement.pdf, page 3',
        'Source 2: House rules.pdf, page 7',
      ]);
      expect(chips[0].textContent).toContain('Lease agreement.pdf');
      expect(chips[0].textContent).toContain('· p. 3');
      expect(q('composer-send')).not.toBeNull();
      expect(q('message-log')?.hasAttribute('aria-busy')).toBe(false);
      expect(q('chat-announcer')?.textContent).toContain('Answer complete');

      await until(() => expect(TestBed.inject(Router).url).toBe('/chat/c-new'));
      // Same page instance, nothing reloaded, messages kept.
      expect(harness.routeDebugElement?.componentInstance).toBe(page);
      httpMock.expectNone((r) => r.url.startsWith('/api/conversations/'));
      expect(all('user-message')).toHaveLength(1);
    });

    it('stops generation and keeps the partial answer', async () => {
      await render();
      const body = fake.stream();
      await typeAndSend('Summarize');
      body.push(sse({ type: 'delta', text: 'The lease covers' }));
      await until(() =>
        expect(q('assistant-message')?.textContent).toContain(
          'The lease covers',
        ),
      );

      must<HTMLButtonElement>(el(), '[data-testid="composer-stop"]').click();
      await until(() => expect(q('stopped-label')).not.toBeNull());
      expect(q('assistant-message')?.textContent).toContain('The lease covers');
      expect(fake.calls[0].init?.signal?.aborted).toBe(true);
      expect(document.activeElement).toBe(q('composer-input'));
    });

    it('shows a pre-stream 429 inline with a Retry', async () => {
      await render();
      const message =
        'You’re sending messages too quickly. Try again in 42 seconds.';
      fake.json(429, { statusCode: 429, message }, { 'Retry-After': '42' });
      await typeAndSend('Hi');
      await until(() => expect(q('turn-error')).not.toBeNull());
      expect(q('turn-error')?.textContent).toContain(message);

      fake.events({
        type: 'done',
        modelId: 'claude-haiku-5-5',
        conversationId: 'c1',
        citations: [],
      });
      must<HTMLButtonElement>(el(), '[data-testid="retry-button"]').click();
      await until(() => expect(q('turn-error')).toBeNull());
      expect(fake.calls).toHaveLength(2);
      expect(fake.body(1).message).toBe('Hi');
      expect(all('user-message')).toHaveLength(1);
    });

    it('offers "Jump to latest" after the user scrolls up', async () => {
      await render();
      const body = fake.stream();
      await typeAndSend('Hi');
      const scroller = must<HTMLElement>(el(), '[data-testid="chat-scroller"]');
      Object.defineProperties(scroller, {
        scrollHeight: { value: 2000, configurable: true },
        clientHeight: { value: 500, configurable: true },
      });
      scroller.scrollTop = 200;
      scroller.dispatchEvent(new Event('scroll'));
      await stable();
      expect(q('jump-to-latest')).not.toBeNull();

      must<HTMLButtonElement>(el(), '[data-testid="jump-to-latest"]').click();
      await stable();
      expect(q('jump-to-latest')).toBeNull();
      body.close();
    });
  });

  describe('citations', () => {
    it('opens the source panel from a chip and from an inline marker', async () => {
      await render();
      const body = fake.stream();
      await typeAndSend('When is rent due?');
      await answer(body);

      all('citation-chip')[1].click();
      await stable();
      expect(overlay('source-name')?.textContent).toContain('House rules.pdf');
      expect(overlay('source-page')?.textContent).toContain('Page 7');
      expect(overlay('source-snippet')?.textContent).toContain('Quiet hours');

      // The panel is modal: close it, then open another source inline.
      const close = [
        ...(overlay('source-panel')?.querySelectorAll('button') ?? []),
      ].find((b) => b.textContent?.includes('Close'));
      close?.click();
      await until(() => expect(overlay('source-panel')).toBeNull());

      must<HTMLAnchorElement>(
        el(),
        'a.citation-ref[href="#citation-1"]',
      ).click();
      await stable();
      expect(overlay('source-name')?.textContent).toContain(
        'Lease agreement.pdf',
      );
      expect(overlay('source-snippet')?.textContent).toContain('first day');
    });
  });

  describe('history', () => {
    it('renders a saved conversation', async () => {
      await render('/chat/c-old', {
        conversation: {
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
              modelId: 'claude-haiku-5-5',
              citations: [CITATIONS[0]],
            },
          ],
        },
      });
      expect(el().querySelector('h1')?.textContent).toContain('Rent questions');
      expect(q('chat-empty')).toBeNull();
      expect(all('user-message')).toHaveLength(1);
      expect(all('citation-chip')).toHaveLength(1);
      expect(q('assistant-message')?.textContent).toContain('Claude Haiku 5.5');
    });

    it('shows a load error with Try again, and no live log meanwhile', async () => {
      await render('/chat/c-old', { conversation: 500 });
      expect(q('history-error')?.textContent).toContain(
        'Couldn’t load this conversation',
      );
      expect(q('message-log')).toBeNull();
      expect(q<HTMLTextAreaElement>('composer-input')?.disabled).toBe(true);
      expect(el().textContent).not.toContain('boom');
    });

    it('shows "Conversation not found" for a 404, with a new-chat link', async () => {
      await render('/chat/c-gone', { conversation: 404 });
      const notFound = q('history-not-found');
      expect(notFound?.textContent).toContain('Conversation not found');
      expect(notFound?.querySelector('a')?.getAttribute('href')).toBe('/chat');
      expect(q<HTMLTextAreaElement>('composer-input')?.disabled).toBe(true);
      expect(q('chat-empty')).toBeNull();
    });
  });

  it('has an accessible message log', async () => {
    await render();
    const log = q('message-log');
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('aria-live')).toBe('polite');
  });
});
