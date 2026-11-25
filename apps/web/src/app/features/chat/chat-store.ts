import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  type Citation,
  type ConversationDetail,
  type LlmModelId,
} from '@ai-document-chatbot/shared';
import { ChatApi } from './chat-api';
import { CHAT_SERVER_MESSAGE, ChatError } from './chat-errors';

export type ChatEntryStatus =
  /** Sent, no text yet (typing indicator). */
  | 'pending'
  | 'streaming'
  | 'done'
  /** The user pressed Stop; partial text is kept. */
  | 'stopped'
  | 'error';

export interface ChatEntry {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly status: ChatEntryStatus;
  readonly citations: readonly Citation[];
  readonly modelId: LlmModelId | null;
  /** User-facing reason, for `error`. */
  readonly error?: string;
  /** What an assistant turn answers: re-sent by Retry. */
  readonly request?: { readonly message: string; readonly modelId: LlmModelId };
}

export type HistoryState = 'none' | 'loading' | 'ready' | 'not-found' | 'error';

let nextId = 0;
const localId = (prefix: string) => `${prefix}-${++nextId}`;

function fromDetail(detail: ConversationDetail): ChatEntry[] {
  return detail.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    status: 'done',
    citations: m.citations ?? [],
    modelId: m.modelId,
  }));
}

/**
 * Chat state for one page: the open conversation's history plus turns sent
 * here, the in-flight stream and its Stop. Provided by the chat page, so it
 * lives (and is lazy-loaded) with it.
 */
@Injectable()
export class ChatStore {
  private readonly api = inject(ChatApi);
  private readonly router = inject(Router);

  /** Conversation whose history is loaded from the api (not one created here). */
  private readonly historyId = signal<string | undefined>(undefined);
  readonly history = httpResource<ConversationDetail>(() => {
    const id = this.historyId();
    return id ? `/api/conversations/${encodeURIComponent(id)}` : undefined;
  });

  private readonly _conversationId = signal<string | undefined>(undefined);
  /** Where the next message goes; undefined starts a new conversation. */
  readonly conversationId = this._conversationId.asReadonly();

  private readonly _entries = linkedSignal<ChatEntry[]>(() =>
    this.history.hasValue() ? fromDetail(this.history.value()) : [],
  );
  readonly entries = this._entries.asReadonly();

  readonly title = computed(() =>
    this.history.hasValue() ? this.history.value().title : null,
  );

  readonly historyState = computed<HistoryState>(() => {
    if (!this.historyId()) return 'none';
    const error = this.history.error();
    if (error) {
      return error instanceof HttpErrorResponse && error.status === 404
        ? 'not-found'
        : 'error';
    }
    return this.history.hasValue() ? 'ready' : 'loading';
  });

  private readonly activeId = signal<string | null>(null);
  /** True from send until the answer is done, stopped or failed. */
  readonly streaming = computed(() => this.activeId() !== null);

  private readonly _announcement = signal('');
  /** Short status for screen readers (not every delta). */
  readonly announcement = this._announcement.asReadonly();

  private controller: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  /**
   * Follows the route: `undefined` is a new chat, an id opens that
   * conversation. No-op for the conversation already shown (e.g. the URL was
   * just updated to the one this page created).
   */
  open(conversationId: string | undefined): void {
    if (conversationId === this._conversationId()) return;
    this.cancel();
    this._announcement.set('');
    this._conversationId.set(conversationId);
    this.historyId.set(conversationId);
    // Turns sent here belong to the previous conversation; the history
    // resource refills this once the new one loads.
    this._entries.set([]);
  }

  reloadHistory(): void {
    this.history.reload();
  }

  /** Sends a message; returns false if it can't be sent right now. */
  send(message: string, modelId: LlmModelId): boolean {
    const text = message.trim();
    if (
      this.streaming() ||
      !text ||
      text.length > MAX_CHAT_MESSAGE_LENGTH ||
      // Only into a conversation that's shown: a reload of failed history
      // would replace turns sent meanwhile.
      (this.historyState() !== 'none' && this.historyState() !== 'ready')
    ) {
      return false;
    }
    const assistantId = localId('assistant');
    this._entries.update((entries) => [
      ...entries,
      {
        id: localId('user'),
        role: 'user',
        content: text,
        status: 'done',
        citations: [],
        modelId: null,
      },
      {
        id: assistantId,
        role: 'assistant',
        content: '',
        status: 'pending',
        citations: [],
        modelId,
        request: { message: text, modelId },
      },
    ]);
    void this.run(assistantId, text, modelId);
    return true;
  }

  /** Re-sends a failed turn's message (in the conversation it was saved to, if any). */
  retry(entryId: string, modelId?: LlmModelId | null): boolean {
    const entry = this._entries().find((e) => e.id === entryId);
    if (this.streaming() || entry?.status !== 'error' || !entry.request) {
      return false;
    }
    const target = modelId ?? entry.request.modelId;
    this.patch(entryId, {
      content: '',
      status: 'pending',
      error: undefined,
      citations: [],
      modelId: target,
      request: { message: entry.request.message, modelId: target },
    });
    void this.run(entryId, entry.request.message, target);
    return true;
  }

  /** Stops the answer being generated; keeps what arrived so far. */
  stop(): void {
    const entryId = this.activeId();
    if (!this.controller || !entryId) return;
    // Settle the turn now rather than when the aborted read rejects.
    this.cancel();
    this.patch(entryId, { status: 'stopped' });
    this._announcement.set('Stopped. The partial answer is kept.');
  }

  private async run(
    entryId: string,
    message: string,
    modelId: LlmModelId,
  ): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.activeId.set(entryId);
    this._announcement.set('');
    const current = () => this.controller === controller;

    try {
      const conversationId = this._conversationId();
      const events = this.api.stream(
        { message, modelId, ...(conversationId ? { conversationId } : {}) },
        controller.signal,
      );
      for await (const event of events) {
        if (!current()) return; // stopped or cancelled meanwhile
        if (event.type === 'start') {
          // Known from the first event, so Stop before `done` keeps this conversation.
          this.adopt(event.conversationId);
        } else if (event.type === 'delta') {
          this.patch(entryId, (e) => ({
            content: e.content + event.text,
            status: 'streaming',
          }));
        } else {
          this.patch(entryId, {
            status: 'done',
            citations: event.citations,
            modelId: event.modelId,
          });
          this.adopt(event.conversationId);
          this._announcement.set('Answer complete.');
        }
      }
    } catch (error) {
      // Stopped, or cancelled by navigation: already settled.
      if (!current()) return;
      const chatError =
        error instanceof ChatError
          ? error
          : new ChatError(500, CHAT_SERVER_MESSAGE);
      if (chatError.status === 404) {
        // The conversation was deleted (e.g. in another tab) after `start`:
        // forget it so Retry starts a fresh one instead of 404ing forever.
        this.forgetConversation();
      } else if (chatError.conversationId) {
        this.adopt(chatError.conversationId);
      }
      this.patch(entryId, { status: 'error', error: chatError.message });
      this._announcement.set(`Couldn’t answer: ${chatError.message}`);
    } finally {
      if (current()) {
        this.controller = null;
        this.activeId.set(null);
      }
    }
  }

  /**
   * Keeps using the conversation the server saved this turn to. A new one is
   * put in the URL without reloading: the route reuses this page and
   * {@link open} sees it is already shown.
   */
  private adopt(conversationId: string): void {
    const isNew = this._conversationId() !== conversationId;
    this._conversationId.set(conversationId);
    if (isNew) {
      void this.router.navigate(['/chat', conversationId], {
        replaceUrl: true,
      });
    }
  }

  private forgetConversation(): void {
    if (this._conversationId() === undefined) return;
    // Keep the visible turns: only the id is dropped. `open(undefined)` from
    // the route change is then a no-op because it already matches.
    this._conversationId.set(undefined);
    void this.router.navigate(['/chat'], { replaceUrl: true });
  }

  private cancel(): void {
    const controller = this.controller;
    this.controller = null;
    this.activeId.set(null);
    controller?.abort();
  }

  private patch(
    id: string,
    change: Partial<ChatEntry> | ((entry: ChatEntry) => Partial<ChatEntry>),
  ): void {
    this._entries.update((entries) =>
      entries.map((e) =>
        e.id === id
          ? { ...e, ...(typeof change === 'function' ? change(e) : change) }
          : e,
      ),
    );
  }
}
