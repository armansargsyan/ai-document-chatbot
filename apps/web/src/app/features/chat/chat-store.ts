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
import { Subject } from 'rxjs';
import {
  MAX_CHAT_MESSAGE_LENGTH,
  type Citation,
  type ConversationDetail,
  type LlmModelId,
} from '@ai-document-chatbot/shared';
import { ChatApi } from './chat-api';
import { ChatDocuments, type DocumentScope } from './chat-documents';
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
  readonly request?: {
    readonly message: string;
    readonly modelId: LlmModelId;
    /** The document searched; null for all documents. */
    readonly scope: DocumentScope | null;
  };
}

/**
 * A message was saved to a conversation (it may have just been created).
 * Emitted on the stream's `start` and `done`, so the history list can show a
 * new conversation straight away and move one to the top on new activity.
 */
export interface ConversationActivity {
  readonly conversationId: string;
  /** The user's message, for a title until the server's list is reloaded. */
  readonly message: string;
  /** ISO 8601. */
  readonly at: string;
}

export type HistoryState = 'none' | 'loading' | 'ready' | 'not-found' | 'error';

let nextId = 0;
const localId = (prefix: string) => `${prefix}-${++nextId}`;

/** Added to a "document not found" error: Retry then drops the scope. */
export const RETRY_ALL_DOCUMENTS_HINT = 'Retry will search all documents.';

/** Ends a server message with a full stop, so a hint can follow it. */
const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

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
  private readonly documents = inject(ChatDocuments);

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

  /** The document picked in "Search in"; null searches all of them. */
  private readonly chosenScope = signal<string | null>(null);
  /**
   * Where the next message searches. Belongs to the conversation: kept across
   * turns, reset when another one is shown. Falls back to all documents once
   * the pick is no longer ready (deleted or failed).
   */
  readonly scope = computed<DocumentScope | null>(() => {
    const doc = this.documents.find(this.chosenScope());
    return doc ? { id: doc.id, name: doc.name } : null;
  });

  private readonly activeId = signal<string | null>(null);
  /** True from send until the answer is done, stopped or failed. */
  readonly streaming = computed(() => this.activeId() !== null);

  private readonly _announcement = signal('');
  /** Short status for screen readers (not every delta). */
  readonly announcement = this._announcement.asReadonly();

  private readonly _activity = new Subject<ConversationActivity>();
  /** Page-scoped event stream; see {@link ConversationActivity}. */
  readonly activity = this._activity.asObservable();
  private readonly _forgotten = new Subject<string>();
  /**
   * Ids of conversations found gone mid-stream (404 after `start`), so the
   * history list can drop a row it added for them.
   */
  readonly forgotten = this._forgotten.asObservable();

  private controller: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cancel();
      this._activity.complete();
      this._forgotten.complete();
    });
  }

  /**
   * Follows the route: `undefined` is a new chat, an id opens that
   * conversation. No-op for the conversation already shown (e.g. the URL was
   * just updated to the one this page created).
   */
  open(conversationId: string | undefined): void {
    if (conversationId === this._conversationId()) return;
    this.show(conversationId);
  }

  /**
   * Starts over with an empty chat, even when no conversation id is set
   * (e.g. turns kept after {@link forgetConversation}). Call it before
   * navigating to `/chat`; the route's `open(undefined)` is then a no-op.
   */
  reset(): void {
    this.show(undefined);
  }

  private show(conversationId: string | undefined): void {
    this.cancel();
    this._announcement.set('');
    this.chosenScope.set(null);
    this._conversationId.set(conversationId);
    this.historyId.set(conversationId);
    // Turns sent here belong to the previous conversation; the history
    // resource refills this once the new one loads.
    this._entries.set([]);
  }

  /** Picks the document to search; anything not ready means all documents. */
  selectScope(documentId: string | null | undefined): void {
    this.chosenScope.set(this.documents.find(documentId)?.id ?? null);
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
    const scope = this.scope();
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
        request: { message: text, modelId, scope },
      },
    ]);
    void this.run(assistantId, text, modelId, scope);
    return true;
  }

  /**
   * Re-sends a failed turn's message (in the conversation it was saved to, if
   * any) with the scope it was sent with; none once that document was found
   * to be gone.
   */
  retry(entryId: string, modelId?: LlmModelId | null): boolean {
    const entry = this._entries().find((e) => e.id === entryId);
    if (this.streaming() || entry?.status !== 'error' || !entry.request) {
      return false;
    }
    const target = modelId ?? entry.request.modelId;
    const { message, scope } = entry.request;
    this.patch(entryId, {
      content: '',
      status: 'pending',
      error: undefined,
      citations: [],
      modelId: target,
      request: { message, modelId: target, scope },
    });
    void this.run(entryId, message, target, scope);
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
    scope: DocumentScope | null,
  ): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.activeId.set(entryId);
    this._announcement.set('');
    const current = () => this.controller === controller;

    try {
      const conversationId = this._conversationId();
      const events = this.api.stream(
        {
          message,
          modelId,
          ...(conversationId ? { conversationId } : {}),
          ...(scope ? { documentId: scope.id } : {}),
        },
        controller.signal,
      );
      for await (const event of events) {
        if (!current()) return; // stopped or cancelled meanwhile
        if (event.type === 'start') {
          // Known from the first event, so Stop before `done` keeps this conversation.
          this.adopt(event.conversationId, message);
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
          this.adopt(event.conversationId, message);
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
      const { code } = chatError;
      let text = chatError.message;
      if (code === 'document_not_found' || code === 'document_not_ready') {
        // Refresh the picker so a gone document falls back to "All
        // documents". The conversation is still fine.
        this.documents.reload();
        if (code === 'document_not_found' && scope) {
          // It won't come back: Retry searches everything instead. A document
          // that isn't ready keeps its scope; a later Retry can succeed.
          text = `${sentence(text)} ${RETRY_ALL_DOCUMENTS_HINT}`;
          this.patch(entryId, (e) => ({
            request: e.request && { ...e.request, scope: null },
          }));
        }
      } else if (
        code === 'conversation_not_found' ||
        // A mid-stream `error` event has no code.
        (chatError.status === 404 && !code)
      ) {
        // The conversation was deleted (e.g. in another tab): forget it so
        // Retry starts a fresh one instead of 404ing forever.
        this.forgetConversation();
      } else if (chatError.conversationId) {
        this.adopt(chatError.conversationId, message);
      }
      this.patch(entryId, { status: 'error', error: text });
      this._announcement.set(`Couldn’t answer: ${text}`);
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
  private adopt(conversationId: string, message: string): void {
    const isNew = this._conversationId() !== conversationId;
    this._conversationId.set(conversationId);
    this._activity.next({
      conversationId,
      message,
      at: new Date().toISOString(),
    });
    if (isNew) {
      void this.router.navigate(['/chat', conversationId], {
        replaceUrl: true,
      });
    }
  }

  private forgetConversation(): void {
    const id = this._conversationId();
    if (id === undefined) return;
    // Keep the visible turns: only the id is dropped. `open(undefined)` from
    // the route change is then a no-op because it already matches.
    this._conversationId.set(undefined);
    this._forgotten.next(id);
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
