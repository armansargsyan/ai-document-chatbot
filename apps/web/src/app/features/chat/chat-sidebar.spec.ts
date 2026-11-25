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
  ConversationSummary,
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
import { chatRoute } from './chat-route';
import { CLOCK, ConversationList } from './conversation-list';
import { FakeFetch, MODELS, MemoryStorage, sse } from './testing/fake-fetch';

/** Pinned "now" (local noon) so grouping doesn't depend on the clock. */
const NOW = new Date(2026, 10, 25, 12, 0, 0).getTime();
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

const summary = (
  id: string,
  title: string,
  updatedAt: string,
): ConversationSummary => ({
  id,
  title,
  createdAt: updatedAt,
  updatedAt,
  messageCount: 2,
});

const LEASE = summary('c1', 'Lease questions', ago(1));
const DEPOSIT = summary('c2', 'Deposit refund', ago(3 * 24));
const RULES = summary('c3', 'House rules', ago(40 * 24));
/** Deliberately unsorted: the sidebar orders by `updatedAt`. */
const LIST = [RULES, LEASE, DEPOSIT];

const detail = (c: ConversationSummary): ConversationDetail => ({
  ...c,
  messages: [
    {
      id: `${c.id}-m1`,
      role: 'user',
      content: `About ${c.title}`,
      createdAt: c.createdAt,
      modelId: null,
      citations: [],
    },
  ],
});

@Component({ template: '<p>documents</p>' })
class DocumentsStub {}

describe('ChatSidebar (in the chat page)', () => {
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
        { provide: CLOCK, useValue: () => NOW },
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

  const stable = () => harness.fixture.whenStable();
  const url = () => TestBed.inject(Router).url;
  /** The desktop aside (CSS doesn't apply here, so it's always rendered). */
  const aside = () =>
    harness.routeNativeElement?.querySelector<HTMLElement>(
      '[data-testid="history-aside"]',
    ) as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(
    id: string,
    root: ParentNode = aside(),
  ) => root.querySelector<T>(`[data-testid="${id}"]`);
  const all = (id: string, root: ParentNode = aside()) => [
    ...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
  ];
  const page = (id: string) =>
    harness.routeNativeElement?.querySelector<HTMLElement>(
      `[data-testid="${id}"]`,
    ) ?? null;
  const overlay = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const row = (id: string, root: ParentNode = aside()) =>
    root.querySelector<HTMLElement>(`[data-id="${id}"]`) as HTMLElement;
  const titles = (root: ParentNode = aside()) =>
    all('conversation-title', root).map((t) => t.textContent?.trim());

  async function until(check: () => void) {
    await vi.waitFor(async () => {
      await stable();
      check();
    });
  }

  /** Opens `path` and answers the page's reads (models, documents, list, history). */
  async function render(
    path = '/chat',
    list: ConversationSummary[] | 'error' = LIST,
  ) {
    harness = await RouterTestingHarness.create(path);
    TestBed.tick();
    httpMock.expectOne('/api/models').flush(MODELS);
    httpMock.expectOne('/api/documents').flush({ documents: [] });
    const listReq = httpMock.expectOne('/api/conversations');
    if (list === 'error') {
      listReq.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      listReq.flush({ conversations: list });
    }
    const id = path.split('/')[2];
    if (id) {
      const c = LIST.find((x) => x.id === id) ?? LEASE;
      httpMock.expectOne(`/api/conversations/${id}`).flush(detail(c));
    }
    await stable();
  }

  async function type(input: HTMLInputElement, value: string, key?: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    if (key) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
      );
    }
    await stable();
  }

  async function startRename(id: string) {
    q<HTMLButtonElement>('rename-button', row(id))?.click();
    await stable();
    const input = q<HTMLInputElement>('rename-input', row(id));
    if (!input) throw new Error('No rename input');
    return input;
  }

  async function confirmDeleteOf(id: string) {
    q<HTMLButtonElement>('delete-button', row(id))?.click();
    await until(() => expect(overlay('history-delete-confirm')).not.toBeNull());
    overlay('history-delete-confirm')?.click();
    await stable();
    const req = httpMock.expectOne(`/api/conversations/${id}`);
    expect(req.request.method).toBe('DELETE');
    return req;
  }

  describe('list', () => {
    it('shows skeletons, then conversations newest first in recency groups', async () => {
      harness = await RouterTestingHarness.create('/chat');
      TestBed.tick();
      httpMock.expectOne('/api/models').flush(MODELS);
      httpMock.expectOne('/api/documents').flush({ documents: [] });
      TestBed.tick();
      expect(q('history-list-loading')?.getAttribute('aria-busy')).toBe('true');

      httpMock.expectOne('/api/conversations').flush({ conversations: LIST });
      await stable();
      expect(q('history-list-loading')).toBeNull();
      expect(aside().querySelector('nav')?.getAttribute('aria-label')).toBe(
        'Conversations',
      );
      expect(titles()).toEqual([
        'Lease questions',
        'Deposit refund',
        'House rules',
      ]);
      expect(
        all('history-group').map((g) =>
          g.querySelector('h2')?.textContent?.trim(),
        ),
      ).toEqual(['Today', 'Previous 7 days', 'Older']);
      const link = q<HTMLAnchorElement>('conversation-link', row('c1'));
      expect(link?.getAttribute('href')).toBe('/chat/c1');
      const time = row('c1').querySelector('time');
      expect(time?.getAttribute('datetime')).toBe(LEASE.updatedAt);
      expect(time?.textContent).toMatch(/11:00/);
      expect(row('c2').querySelector('time')?.textContent).not.toBe('');
      expect(q('rename-button', row('c2'))?.getAttribute('aria-label')).toBe(
        'Rename Deposit refund',
      );
      expect(q('delete-button', row('c2'))?.getAttribute('aria-label')).toBe(
        'Delete Deposit refund',
      );
    });

    it('shows an empty state', async () => {
      await render('/chat', []);
      expect(q('history-list-empty')?.textContent).toContain(
        'No conversations yet',
      );
      expect(all('conversation-row')).toHaveLength(0);
    });

    it('shows an error with a working retry', async () => {
      await render('/chat', 'error');
      expect(q('history-list-error')?.textContent).toContain(
        'Couldn’t load conversations',
      );
      q('history-list-error')?.querySelector('button')?.click();
      TestBed.tick();
      httpMock.expectOne('/api/conversations').flush({ conversations: LIST });
      await stable();
      expect(q('history-list-error')).toBeNull();
      expect(all('conversation-row')).toHaveLength(3);
    });

    it('marks the open conversation with aria-current', async () => {
      await render('/chat/c2');
      const current = all('conversation-link').filter(
        (a) => a.getAttribute('aria-current') === 'page',
      );
      expect(current).toHaveLength(1);
      expect(current[0].textContent).toContain('Deposit refund');
      // The page title follows the list (and so a rename).
      expect(page('toolbar-title')?.textContent?.trim()).toBe('Deposit refund');
    });
  });

  describe('selecting and New chat', () => {
    it('opens a conversation from its link and reflects it in the URL', async () => {
      await render('/chat');
      q<HTMLAnchorElement>('conversation-link', row('c3'))?.click();
      await vi.waitFor(() => expect(url()).toBe('/chat/c3'));
      TestBed.tick();
      httpMock.expectOne('/api/conversations/c3').flush(detail(RULES));
      await stable();
      expect(page('user-message')?.textContent).toContain('About House rules');
      expect(
        q('conversation-link', row('c3'))?.getAttribute('aria-current'),
      ).toBe('page');
    });

    it('New chat goes to /chat with an empty conversation', async () => {
      await render('/chat/c1');
      expect(page('user-message')).not.toBeNull();

      q<HTMLAnchorElement>('new-chat')?.click();
      await vi.waitFor(() => expect(url()).toBe('/chat'));
      await stable();
      expect(page('user-message')).toBeNull();
      expect(page('chat-empty')).not.toBeNull();
      expect(
        all('conversation-link').some((a) => a.hasAttribute('aria-current')),
      ).toBe(false);
    });

    it('leaves the chat alone when New chat opens in a new tab', async () => {
      await render('/chat/c1');
      const link = q<HTMLAnchorElement>('new-chat') as HTMLAnchorElement;
      link.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );
      await stable();
      expect(url()).toBe('/chat/c1');
      expect(page('user-message')).not.toBeNull();
    });

    it('New chat also clears turns kept after a conversation vanished', async () => {
      await render('/chat');
      fake.events(
        { type: 'start', conversationId: 'c-gone' },
        { type: 'error', status: 404, message: 'Conversation not found' },
      );
      const input = page('composer-input') as HTMLTextAreaElement;
      await type(input as unknown as HTMLInputElement, 'Hello', 'Enter');
      await until(() => expect(page('turn-error')).not.toBeNull());
      expect(url()).toBe('/chat');

      q<HTMLAnchorElement>('new-chat')?.click();
      await stable();
      expect(page('user-message')).toBeNull();
      expect(page('chat-empty')).not.toBeNull();
    });
  });

  describe('keeping fresh', () => {
    it('shows a new conversation at the top on start, current, then keeps it after done', async () => {
      await render('/chat');
      const body = fake.stream();
      const input = page('composer-input') as unknown as HTMLInputElement;
      await type(input, 'What does the lease say about pets?', 'Enter');
      await until(() => expect(fake.calls).toHaveLength(1));

      body.push(sse({ type: 'start', conversationId: 'c-new' }));
      await until(() =>
        expect(titles()[0]).toBe('What does the lease say about pets?'),
      );
      expect(
        q('conversation-link', row('c-new'))?.getAttribute('aria-current'),
      ).toBe('page');
      expect(url()).toBe('/chat/c-new');

      body.push(sse({ type: 'delta', text: 'No pets.' }));
      body.push(
        sse({
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId: 'c-new',
          citations: [],
        }),
      );
      await until(() => expect(page('composer-stop')).toBeNull());
      expect(titles()).toEqual([
        'What does the lease say about pets?',
        'Lease questions',
        'Deposit refund',
        'House rules',
      ]);
      // No polling or refetch: the list was updated locally.
      httpMock.expectNone('/api/conversations');
    });

    it('drops a conversation that turns out gone mid-stream, even after a reload', async () => {
      await render('/chat');
      const body = fake.stream();
      const input = page('composer-input') as unknown as HTMLInputElement;
      await type(input, 'Is this still here?', 'Enter');
      await until(() => expect(fake.calls).toHaveLength(1));
      body.push(sse({ type: 'start', conversationId: 'c-gone' }));
      await until(() => expect(titles()[0]).toBe('Is this still here?'));

      body.push(
        sse({ type: 'error', status: 404, message: 'Conversation not found' }),
      );
      await until(() => expect(page('turn-error')).not.toBeNull());
      await until(() => expect(row('c-gone')).toBeNull());
      expect(url()).toBe('/chat');

      harness.routeDebugElement?.injector.get(ConversationList).reload();
      TestBed.tick();
      httpMock.expectOne('/api/conversations').flush({ conversations: LIST });
      await stable();
      expect(row('c-gone')).toBeNull();
      expect(titles()).toEqual([
        'Lease questions',
        'Deposit refund',
        'House rules',
      ]);
    });

    it('moves a conversation to the top when it gets a new message', async () => {
      await render('/chat/c3');
      expect(titles()[2]).toBe('House rules');
      fake.events(
        { type: 'start', conversationId: 'c3' },
        { type: 'delta', text: 'Quiet after 10.' },
        {
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId: 'c3',
          citations: [],
        },
      );
      const input = page('composer-input') as unknown as HTMLInputElement;
      await type(input, 'Quiet hours?', 'Enter');
      await until(() => expect(titles()[0]).toBe('House rules'));
      expect(
        all('history-group')[0].querySelector('h2')?.textContent,
      ).toContain('Today');
    });
  });

  describe('activity before the list loads', () => {
    async function renderWithoutList(path = '/chat') {
      harness = await RouterTestingHarness.create(path);
      TestBed.tick();
      httpMock.expectOne('/api/models').flush(MODELS);
      httpMock.expectOne('/api/documents').flush({ documents: [] });
      TestBed.tick();
    }

    async function sendNewConversation() {
      fake.events(
        { type: 'start', conversationId: 'c-early' },
        {
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId: 'c-early',
          citations: [],
        },
      );
      const input = page('composer-input') as unknown as HTMLInputElement;
      input.value = 'An early question';
      input.dispatchEvent(new Event('input'));
      TestBed.tick();
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }),
      );
      await vi.waitFor(() => expect(url()).toBe('/chat/c-early'));
    }

    it('keeps a conversation created before a stale list arrives', async () => {
      await renderWithoutList();
      await sendNewConversation();
      expect(q('history-list-loading')).not.toBeNull();

      // The response was read before the conversation existed.
      httpMock.expectOne('/api/conversations').flush({ conversations: LIST });
      await stable();
      expect(titles()).toEqual([
        'An early question',
        'Lease questions',
        'Deposit refund',
        'House rules',
      ]);
    });

    it('keeps the error state when the first load failed', async () => {
      await renderWithoutList();
      httpMock
        .expectOne('/api/conversations')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await stable();
      await sendNewConversation();
      await stable();
      expect(q('history-list-error')).not.toBeNull();

      q('history-list-error')?.querySelector('button')?.click();
      TestBed.tick();
      httpMock.expectOne('/api/conversations').flush({ conversations: [] });
      await stable();
      expect(titles()).toEqual(['An early question']);
    });
  });

  describe('rename', () => {
    it('saves on Enter, optimistically, and announces it', async () => {
      await render('/chat/c1');
      const input = await startRename('c1');
      expect(document.activeElement).toBe(input);
      expect(input.value).toBe('Lease questions');

      await type(input, '  Pets and the lease  ', 'Enter');
      const req = httpMock.expectOne('/api/conversations/c1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Pets and the lease' });
      expect(q('rename-input', row('c1'))).toBeNull();
      expect(titles()[0]).toBe('Pets and the lease');
      expect(page('toolbar-title')?.textContent?.trim()).toBe(
        'Pets and the lease',
      );
      expect(document.activeElement).toBe(q('rename-button', row('c1')));

      req.flush({ ...LEASE, title: 'Pets and the lease' });
      await until(() =>
        expect(q('history-announcer')?.textContent).toContain(
          'Renamed to “Pets and the lease”',
        ),
      );
      expect(titles()[0]).toBe('Pets and the lease');
    });

    it('sends a second rename while the first is still in flight', async () => {
      await render('/chat');
      await type(await startRename('c1'), 'First', 'Enter');
      const first = httpMock.expectOne('/api/conversations/c1');

      const second = await startRename('c2');
      await type(second, 'Second');
      second.dispatchEvent(new FocusEvent('blur'));
      await stable();
      const req = httpMock.expectOne('/api/conversations/c2');
      expect(req.request.body).toEqual({ title: 'Second' });

      first.flush({ ...LEASE, title: 'First' });
      req.flush({ ...DEPOSIT, title: 'Second' });
      await stable();
      expect(titles().slice(0, 2)).toEqual(['First', 'Second']);
    });

    it('saves on blur', async () => {
      await render('/chat');
      const input = await startRename('c2');
      await type(input, 'Deposit');
      input.dispatchEvent(new FocusEvent('blur'));
      await stable();
      httpMock
        .expectOne('/api/conversations/c2')
        .flush({ ...DEPOSIT, title: 'Deposit' });
      await stable();
      expect(titles()[1]).toBe('Deposit');
    });

    it('rejects an empty title without a request', async () => {
      await render('/chat');
      const input = await startRename('c2');
      await type(input, '   ', 'Enter');
      expect(q('rename-error', row('c2'))?.textContent).toContain(
        'Enter a title',
      );
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(q('rename-input', row('c2'))).toBe(input);

      await type(input, 'x'.repeat(101), 'Enter');
      expect(q('rename-error', row('c2'))?.textContent).toContain('100');
      httpMock.expectNone('/api/conversations/c2');
    });

    it('rolls back and explains when the server refuses', async () => {
      await render('/chat');
      const input = await startRename('c2');
      await type(input, 'New name', 'Enter');
      expect(titles()[1]).toBe('New name');
      httpMock
        .expectOne('/api/conversations/c2')
        .flush(null, { status: 500, statusText: 'Server Error' });
      await until(() => expect(titles()[1]).toBe('Deposit refund'));
      expect(q('history-notice')?.textContent).toContain(
        'Couldn’t rename “Deposit refund”',
      );
      expect(q('history-notice')?.getAttribute('role')).toBe('alert');
    });

    it('cancels on Escape without saving', async () => {
      await render('/chat');
      const input = await startRename('c2');
      await type(input, 'Something else', 'Escape');
      expect(q('rename-input', row('c2'))).toBeNull();
      expect(titles()[1]).toBe('Deposit refund');
      expect(document.activeElement).toBe(q('rename-button', row('c2')));
      expect(q('history-announcer')?.textContent).toContain('Rename cancelled');
      httpMock.expectNone('/api/conversations/c2');
    });
  });

  describe('delete', () => {
    it('asks first; Cancel keeps it and refocuses the button', async () => {
      await render('/chat');
      q<HTMLButtonElement>('delete-button', row('c2'))?.click();
      await until(() =>
        expect(overlay('history-delete-description')?.textContent).toContain(
          '“Deposit refund”',
        ),
      );
      overlay('history-delete-cancel')?.click();
      await until(() => expect(overlay('history-delete-confirm')).toBeNull());
      expect(all('conversation-row')).toHaveLength(3);
      expect(document.activeElement).toBe(q('delete-button', row('c2')));
      httpMock.expectNone('/api/conversations/c2');
    });

    it('removes it on 204, announces it and focuses the next row', async () => {
      await render('/chat');
      const req = await confirmDeleteOf('c2');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(all('conversation-row')).toHaveLength(2));
      expect(titles()).toEqual(['Lease questions', 'House rules']);
      expect(q('history-announcer')?.textContent).toContain(
        'Deleted “Deposit refund”',
      );
      await until(() =>
        expect(document.activeElement).toBe(q('conversation-link', row('c3'))),
      );
    });

    it('disables the row actions while its delete runs', async () => {
      await render('/chat');
      const req = await confirmDeleteOf('c2');
      expect(row('c2').hasAttribute('data-deleting')).toBe(true);
      expect(q<HTMLButtonElement>('delete-button', row('c2'))?.disabled).toBe(
        true,
      );
      expect(q<HTMLButtonElement>('rename-button', row('c2'))?.disabled).toBe(
        true,
      );
      // Another row can still be deleted meanwhile; both stay pending.
      const other = await confirmDeleteOf('c3');
      expect(row('c2').hasAttribute('data-deleting')).toBe(true);
      other.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(all('conversation-row')).toHaveLength(2));
      expect(row('c2').hasAttribute('data-deleting')).toBe(true);
      req.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(all('conversation-row')).toHaveLength(1));
    });

    it('treats 404 as already deleted', async () => {
      await render('/chat');
      const req = await confirmDeleteOf('c3');
      req.flush(
        { statusCode: 404, message: 'Conversation not found' },
        { status: 404, statusText: 'Not Found' },
      );
      await until(() => expect(all('conversation-row')).toHaveLength(2));
      expect(q('history-announcer')?.textContent).toContain(
        'was already deleted',
      );
      // The last row went: the one before it takes focus.
      await until(() =>
        expect(document.activeElement).toBe(q('conversation-link', row('c2'))),
      );
    });

    it('keeps the row and explains a failure', async () => {
      await render('/chat');
      const req = await confirmDeleteOf('c2');
      req.flush(null, { status: 500, statusText: 'Server Error' });
      await until(() =>
        expect(q('history-notice')?.textContent).toContain(
          'Couldn’t delete “Deposit refund”',
        ),
      );
      expect(all('conversation-row')).toHaveLength(3);
    });

    it('deleting the open conversation goes to a new chat', async () => {
      await render('/chat/c1');
      expect(page('user-message')).not.toBeNull();
      const req = await confirmDeleteOf('c1');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(url()).toBe('/chat'));
      await stable();
      expect(page('user-message')).toBeNull();
      expect(page('chat-empty')).not.toBeNull();
      expect(page('toolbar-title')?.textContent?.trim()).toBe('New chat');
      // The store forgot the id: the next message starts a new conversation.
      fake.events(
        { type: 'start', conversationId: 'c-next' },
        {
          type: 'done',
          modelId: 'claude-haiku-5-5',
          conversationId: 'c-next',
          citations: [],
        },
      );
      const input = page('composer-input') as unknown as HTMLInputElement;
      await type(input, 'Fresh start', 'Enter');
      await until(() => expect(fake.calls).toHaveLength(1));
      expect(fake.body().conversationId).toBeUndefined();
      await until(() => expect(url()).toBe('/chat/c-next'));
    });

    it('deleting the open conversation replaces the URL, so Back skips it', async () => {
      await render('/chat/c1');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
      const req = await confirmDeleteOf('c1');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(url()).toBe('/chat'));
      expect(navigate).toHaveBeenCalledWith(['/chat'], { replaceUrl: true });
    });

    it('a late response after leaving the page neither navigates nor throws', async () => {
      await render('/chat/c1');
      const req = await confirmDeleteOf('c1');
      await TestBed.inject(Router).navigateByUrl('/documents');
      await stable();
      expect(url()).toBe('/documents');
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');

      req.flush(null, { status: 204, statusText: 'No Content' });
      await new Promise((resolve) => setTimeout(resolve));
      await stable();
      expect(navigate).not.toHaveBeenCalled();
      expect(url()).toBe('/documents');
    });

    it('focuses New chat when the last conversation is deleted', async () => {
      await render('/chat', [LEASE]);
      const req = await confirmDeleteOf('c1');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await until(() => expect(q('history-list-empty')).not.toBeNull());
      await until(() => expect(document.activeElement).toBe(q('new-chat')));
    });
  });

  describe('mobile drawer', () => {
    it('opens from the History button and closes after selecting', async () => {
      await render('/chat');
      expect(overlay('history-drawer')).toBeNull();
      const toggle = page('history-toggle') as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');

      toggle.click();
      await until(() => expect(overlay('history-drawer')).not.toBeNull());
      const drawer = overlay('history-drawer') as HTMLElement;
      expect(drawer.querySelector('nav')?.getAttribute('aria-label')).toBe(
        'Conversations',
      );
      expect(titles(drawer)).toEqual([
        'Lease questions',
        'Deposit refund',
        'House rules',
      ]);

      q<HTMLAnchorElement>('conversation-link', row('c2', drawer))?.click();
      await vi.waitFor(() => expect(url()).toBe('/chat/c2'));
      TestBed.tick();
      httpMock.expectOne('/api/conversations/c2').flush(detail(DEPOSIT));
      await until(() => expect(overlay('history-drawer')).toBeNull());
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes after New chat', async () => {
      await render('/chat/c1');
      (page('history-toggle') as HTMLButtonElement).click();
      await until(() => expect(overlay('history-drawer')).not.toBeNull());
      q<HTMLAnchorElement>(
        'new-chat',
        overlay('history-drawer') as HTMLElement,
      )?.click();
      await until(() => expect(overlay('history-drawer')).toBeNull());
      expect(url()).toBe('/chat');
      expect(page('chat-empty')).not.toBeNull();
    });
  });
});
