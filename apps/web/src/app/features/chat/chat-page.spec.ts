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
import { ChatPage, EXAMPLE_PROMPTS, shortDocumentName } from './chat-page';
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
    httpMock.expectOne('/api/conversations').flush({ conversations: [] });
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

  /** Like {@link typeAndSend}, for when a pending request keeps the app unstable. */
  async function sendWithoutWaiting(text: string) {
    const input = must<HTMLTextAreaElement>(
      el(),
      '[data-testid="composer-input"]',
    );
    input.value = text;
    input.dispatchEvent(new Event('input'));
    TestBed.tick();
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
    );
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
      // None needs a scope; the api gives the model the document list with dates.
      expect(examples.map((e) => e.textContent?.trim())).toEqual([
        'What are the key points across my documents?',
        'What deadlines or dates are mentioned?',
        'Which of my documents is the most recent?',
      ]);
      expect(EXAMPLE_PROMPTS.join(' ')).not.toContain('latest document');
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
      // Short enough not to clip in the one-line composer on a phone.
      expect(q<HTMLTextAreaElement>('composer-input')?.placeholder).toBe(
        'Sending is unavailable',
      );
      expect(q<HTMLButtonElement>('composer-send')?.disabled).toBe(true);
      expect(
        el().querySelector<HTMLSelectElement>('#chat-model')?.disabled,
      ).toBe(true);
    });
  });

  describe('search in', () => {
    const OLDER: DocumentSummary = {
      ...READY_DOC,
      id: 'doc-old',
      name: 'House rules.pdf',
      createdAt: '2026-11-01T10:00:00.000Z',
    };
    const NEWEST: DocumentSummary = {
      ...READY_DOC,
      id: 'doc-new',
      name: 'Insurance policy.pdf',
      createdAt: '2026-11-25T10:00:00.000Z',
    };
    const DOCS: DocumentSummary[] = [
      OLDER,
      { ...READY_DOC, id: 'doc-busy', name: 'Busy.pdf', status: 'processing' },
      READY_DOC,
      { ...READY_DOC, id: 'doc-bad', name: 'Broken.pdf', status: 'failed' },
      NEWEST,
    ];
    const scopeSelect = () => must<HTMLSelectElement>(el(), '#chat-scope');
    async function pick(value: string) {
      const select = scopeSelect();
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await stable();
    }
    /**
     * A scoped 404/409 reloads the list. That request keeps the app unstable,
     * so wait for it without `stable()` and flush it first.
     */
    async function flushDocumentsReload(documents: DocumentSummary[]) {
      const req = await vi.waitFor(() => {
        TestBed.tick();
        return httpMock.expectOne('/api/documents');
      });
      req.flush({ documents });
      await stable();
    }
    function done(conversationId = 'c-new') {
      fake.events(
        { type: 'delta', text: 'Rent is due on the 1st [1].' },
        {
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId,
          citations: CITATIONS,
        },
      );
    }

    it('lists ready documents newest first after "All documents", the default', async () => {
      await render('/chat', { documents: DOCS });
      // A visible label: the picker must not read as a second model pill.
      const label = must<HTMLLabelElement>(el(), 'label[for="chat-scope"]');
      expect(label.textContent?.trim()).toBe('Search in');
      expect(label.classList.contains('sr-only')).toBe(false);
      const select = scopeSelect();
      expect(
        [...select.options].map((o) => [o.value, o.textContent?.trim()]),
      ).toEqual([
        ['', 'All documents'],
        ['doc-new', 'Insurance policy.pdf'],
        ['doc-1', 'Lease agreement.pdf'],
        ['doc-old', 'House rules.pdf'],
      ]);
      expect(select.value).toBe('');
    });

    it('is hidden when no document is ready', async () => {
      await render('/chat', {
        documents: [{ ...READY_DOC, status: 'processing' }],
      });
      expect(el().querySelector('#chat-scope')).toBeNull();
      expect(q('upload-cta')).not.toBeNull();
    });

    it('shortens long names in the options and keeps the full name as a tooltip', async () => {
      const name = `${'Quarterly financial statement '.repeat(3)}2026.pdf`;
      await render('/chat', { documents: [{ ...READY_DOC, name }] });
      const option = scopeSelect().options[1];
      expect(option.textContent?.trim()).toBe(shortDocumentName(name));
      expect(option.textContent?.trim().length).toBeLessThanOrEqual(40);
      expect(option.textContent?.trim().endsWith('….pdf')).toBe(true);
      expect(option.title).toBe(name);
      expect(option.getAttribute('aria-label')).toBe(name);
    });

    it('sends the picked document, labels the answer and keeps the scope for the next turn', async () => {
      await render();
      done();
      await typeAndSend('Everything?');
      await until(() => expect(all('assistant-message')).toHaveLength(1));
      await until(() =>
        expect(q('assistant-message')?.dataset['status']).toBe('done'),
      );
      expect(fake.body()).not.toHaveProperty('documentId');
      expect(q('scope-label')).toBeNull();

      await pick('doc-1');
      done();
      await typeAndSend('When is rent due?');
      await until(() => expect(all('scope-label')).toHaveLength(1));
      expect(fake.body().documentId).toBe('doc-1');
      expect(q('scope-label')?.textContent?.trim()).toBe(
        'Searched: Lease agreement.pdf',
      );

      // Still scoped for the next turn in this conversation.
      expect(scopeSelect().value).toBe('doc-1');
      done();
      await typeAndSend('And the deposit?');
      await until(() => expect(all('scope-label')).toHaveLength(2));
      expect(fake.body()).toMatchObject({
        conversationId: 'c-new',
        documentId: 'doc-1',
      });

      // "All documents" again: the request has no documentId.
      await pick('');
      done();
      await typeAndSend('Anything else?');
      await until(() => expect(all('assistant-message')).toHaveLength(4));
      await until(() =>
        expect(all('assistant-message')[3].dataset['status']).toBe('done'),
      );
      expect(fake.body()).not.toHaveProperty('documentId');
      expect(all('scope-label')).toHaveLength(2);
    });

    it('resets to "All documents" on New chat', async () => {
      await render();
      await pick('doc-1');
      must<HTMLAnchorElement>(el(), '[data-testid="toolbar-new-chat"]').click();
      await stable();
      expect(scopeSelect().value).toBe('');
    });

    it('resets to "All documents" when another conversation is opened', async () => {
      await render();
      await pick('doc-1');
      await harness.navigateByUrl('/chat/c-old');
      TestBed.tick();
      httpMock.expectOne('/api/conversations/c-old').flush({
        id: 'c-old',
        title: 'Old',
        createdAt: '2026-11-24T10:00:00.000Z',
        updatedAt: '2026-11-24T10:00:00.000Z',
        messageCount: 0,
        messages: [],
      } satisfies ConversationDetail);
      await stable();
      expect(scopeSelect().value).toBe('');
    });

    it('retries with the same scope', async () => {
      await render();
      await pick('doc-1');
      fake.json(500, { statusCode: 500, message: 'boom' });
      await typeAndSend('Hi');
      await until(() => expect(q('retry-button')).not.toBeNull());

      done();
      q<HTMLButtonElement>('retry-button')?.click();
      await until(() => expect(q('scope-label')).not.toBeNull());
      expect(fake.body()).toMatchObject({ message: 'Hi', documentId: 'doc-1' });
    });

    it('shows a 409 inline and falls back to "All documents" once the document is gone', async () => {
      await render('/chat', { documents: [READY_DOC, OLDER] });
      await pick('doc-1');
      const message =
        "That document isn't ready yet; try again once it has finished processing";
      fake.json(409, { statusCode: 409, message, code: 'document_not_ready' });
      await sendWithoutWaiting('Hi');
      // The list is refreshed; the document has failed meanwhile.
      await flushDocumentsReload([{ ...READY_DOC, status: 'failed' }, OLDER]);
      await until(() => expect(q('turn-error')).not.toBeNull());
      expect(q('turn-error')?.textContent).toContain(message);
      expect(scopeSelect().value).toBe('');
      expect([...scopeSelect().options].map((o) => o.value)).toEqual([
        '',
        'doc-old',
      ]);
    });

    it('shows a 404 for a deleted document inline', async () => {
      await render();
      await pick('doc-1');
      fake.json(404, {
        statusCode: 404,
        message: 'Document not found',
        code: 'document_not_found',
      });
      await sendWithoutWaiting('Hi');
      await flushDocumentsReload([]);
      await until(() => expect(q('turn-error')).not.toBeNull());
      expect(q('turn-error')?.textContent).toContain(
        'Document not found. Retry will search all documents.',
      );
      expect(el().querySelector('#chat-scope')).toBeNull();

      done();
      q<HTMLButtonElement>('retry-button')?.click();
      await until(() =>
        expect(q('assistant-message')?.dataset['status']).toBe('done'),
      );
      expect(fake.body()).not.toHaveProperty('documentId');
      expect(q('scope-label')).toBeNull();
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

  describe('jump to latest scrolling', () => {
    afterEach(() => vi.unstubAllGlobals());

    async function scrolledUpAnswer() {
      await render();
      const body = fake.stream();
      await typeAndSend('Hi');
      await answer(body);
      const scroller = must<HTMLElement>(el(), '[data-testid="chat-scroller"]');
      Object.defineProperties(scroller, {
        scrollHeight: { value: 2000, configurable: true },
        clientHeight: { value: 500, configurable: true },
      });
      scroller.scrollTop = 200;
      scroller.dispatchEvent(new Event('scroll'));
      await stable();
      const scrollTo = vi.fn();
      scroller.scrollTo = scrollTo;
      return scrollTo;
    }

    function stubReducedMotion(reduce: boolean) {
      vi.stubGlobal(
        'matchMedia',
        (query: string) =>
          ({
            matches: reduce && query.includes('prefers-reduced-motion'),
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }) as unknown as MediaQueryList,
      );
    }

    it('scrolls smoothly once the answer has finished', async () => {
      stubReducedMotion(false);
      const scrollTo = await scrolledUpAnswer();
      must<HTMLButtonElement>(el(), '[data-testid="jump-to-latest"]').click();
      await stable();
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth' }),
      );
    });

    it('jumps without animation when the user prefers reduced motion', async () => {
      stubReducedMotion(true);
      const scrollTo = await scrolledUpAnswer();
      must<HTMLButtonElement>(el(), '[data-testid="jump-to-latest"]').click();
      await stable();
      expect(scrollTo).toHaveBeenCalled();
      for (const [options] of scrollTo.mock.calls) {
        expect(options).toEqual(expect.objectContaining({ behavior: 'auto' }));
      }
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
