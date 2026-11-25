import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  HttpClient,
  HttpErrorResponse,
  httpResource,
} from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  ConversationSummary,
  ListConversationsResponse,
  RenameConversationRequest,
} from '@ai-document-chatbot/shared';
import { ChatStore, type ConversationActivity } from './chat-store';
import {
  groupByRecency,
  titleError,
  titleFromMessage,
} from './conversation-format';

export const CONVERSATIONS_URL = '/api/conversations';

/** Current time in ms; injectable so tests can pin "today". */
export const CLOCK = new InjectionToken<() => number>('CLOCK', {
  factory: () => () => Date.now(),
});

export type RenameOutcome =
  | 'saved'
  | 'unchanged'
  | 'invalid'
  | 'failed'
  /** The conversation no longer exists (404); it was removed from the list. */
  | 'gone';

const statusOf = (error: unknown) =>
  error instanceof HttpErrorResponse ? error.status : 0;

const conversationUrl = (id: string) =>
  `${CONVERSATIONS_URL}/${encodeURIComponent(id)}`;

/**
 * The history sidebar's state, shared by the desktop aside and the mobile
 * drawer: the list (read with `httpResource`), kept fresh from the chat
 * store's activity, plus optimistic rename and delete. Provided by the chat
 * page, so it lives in the lazy chat chunk and dies with the page.
 */
@Injectable()
export class ConversationList {
  private readonly http = inject(HttpClient);
  private readonly store = inject(ChatStore);
  private readonly router = inject(Router);
  private readonly clock = inject(CLOCK);

  private readonly resource = httpResource<ListConversationsResponse>(
    () => CONVERSATIONS_URL,
  );
  /**
   * The server's list plus local changes (new activity, renames, deletes).
   * A fresh server response replaces it, with this page's activity applied
   * on top (it may be newer than the response); a failed reload keeps it.
   */
  private readonly state = linkedSignal<
    ListConversationsResponse | undefined,
    ConversationSummary[] | undefined
  >({
    source: () =>
      this.resource.hasValue() ? this.resource.value() : undefined,
    computation: (list, previous) =>
      list ? this.applyActivity(list.conversations) : previous?.value,
  });
  /** Latest activity per conversation since the page opened (not reactive). */
  private readonly activityLog = new Map<string, ConversationActivity>();

  private readonly loaded = computed(() => this.state() !== undefined);
  /** Skeletons only for the first load. */
  readonly initialLoading = computed(
    () => this.resource.isLoading() && !this.loaded(),
  );
  readonly loadFailed = computed(
    () => !!this.resource.error() && !this.loaded(),
  );
  /** "Now" for grouping and relative times, refreshed whenever the list changes. */
  readonly now = computed(() => {
    this.state();
    return this.clock();
  });
  readonly groups = computed(() =>
    groupByRecency(this.state() ?? [], this.now()),
  );
  /** Newest activity first. */
  readonly rows = computed(() => this.groups().flatMap((g) => g.conversations));
  /** The conversation the chat shows (also one it just created). */
  readonly currentId = this.store.conversationId;

  /** Conversations with a delete request in flight. */
  readonly deletingIds = signal<ReadonlySet<string>>(new Set());
  /** Polite status for screen readers (rename / delete results). */
  readonly announcement = signal('');
  /** A failure shown in the sidebar (and announced as an alert). */
  readonly notice = signal<string | null>(null);

  /** Requests outlive the page; their results must not navigate after it's gone. */
  private destroyed = false;

  constructor() {
    this.store.activity
      .pipe(takeUntilDestroyed())
      .subscribe((activity) => this.touch(activity));
    // The store already reset and left the URL: only the row has to go.
    this.store.forgotten
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.drop(id));
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  find(id: string | undefined): ConversationSummary | undefined {
    return id ? this.state()?.find((c) => c.id === id) : undefined;
  }

  reload(): void {
    this.notice.set(null);
    this.resource.reload();
  }

  dismissNotice(): void {
    this.notice.set(null);
  }

  /** Validates, renames optimistically and rolls back if the api refuses. */
  async rename(
    conversation: ConversationSummary,
    title: string,
  ): Promise<RenameOutcome> {
    if (titleError(title)) return 'invalid';
    const next = title.trim();
    if (next === conversation.title) return 'unchanged';
    const { id, title: previous } = conversation;
    this.notice.set(null);
    this.patch(id, { title: next });

    try {
      const body: RenameConversationRequest = { title: next };
      const saved = await firstValueFrom(
        this.http.patch<ConversationSummary>(conversationUrl(id), body),
      );
      this.patch(id, { title: saved.title });
      this.announcement.set(`Renamed to “${saved.title}”.`);
      return 'saved';
    } catch (error) {
      if (statusOf(error) === 404) {
        this.removed(id);
        this.notice.set(`“${previous}” no longer exists.`);
        return 'gone';
      }
      // Undo, unless something newer (a reload, another rename) replaced it.
      if (this.find(id)?.title === next) this.patch(id, { title: previous });
      this.notice.set(
        statusOf(error) === 400
          ? `That title can’t be used. Titles are 1–100 characters.`
          : `Couldn’t rename “${previous}”. Try again in a moment.`,
      );
      return 'failed';
    }
  }

  /** Deletes after confirmation; returns true once it is gone (204 or 404). */
  async remove(conversation: ConversationSummary): Promise<boolean> {
    const { id, title } = conversation;
    if (this.deletingIds().has(id)) return false;
    this.notice.set(null);
    this.setDeleting(id, true);
    let message = `Deleted “${title}”.`;
    try {
      await firstValueFrom(this.http.delete<void>(conversationUrl(id)));
    } catch (error) {
      if (statusOf(error) !== 404) {
        this.notice.set(`Couldn’t delete “${title}”. Try again in a moment.`);
        return false;
      }
      message = `“${title}” was already deleted.`;
    } finally {
      this.setDeleting(id, false);
    }
    this.removed(id);
    this.announcement.set(message);
    return true;
  }

  /** Drops a conversation; if it was open, the chat starts over at `/chat`. */
  private removed(id: string): void {
    this.drop(id);
    if (!this.destroyed && this.store.conversationId() === id) {
      this.store.reset();
      // Replace the URL so Back doesn't land on "Conversation not found".
      void this.router.navigate(['/chat'], { replaceUrl: true });
    }
  }

  /** Removes a row, and its logged activity so a reload can't bring it back. */
  private drop(id: string): void {
    this.activityLog.delete(id);
    this.state.update((rows) => rows?.filter((c) => c.id !== id));
  }

  /** Shows a new conversation at once and moves an active one to the top. */
  private touch(activity: ConversationActivity): void {
    this.activityLog.set(activity.conversationId, activity);
    // Before the first load lands, the log is applied to the response instead
    // (so the skeleton or error state stays as it is).
    this.state.update((rows) => rows && withActivity(rows, activity));
  }

  private applyActivity(
    rows: readonly ConversationSummary[],
  ): ConversationSummary[] {
    let result = [...rows];
    for (const activity of this.activityLog.values()) {
      const existing = result.find((c) => c.id === activity.conversationId);
      if (
        !existing ||
        Date.parse(existing.updatedAt) < Date.parse(activity.at)
      ) {
        result = withActivity(result, activity);
      }
    }
    return result;
  }

  private setDeleting(id: string, deleting: boolean): void {
    this.deletingIds.update((ids) => {
      const next = new Set(ids);
      if (deleting) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  private patch(id: string, change: Partial<ConversationSummary>): void {
    this.state.update((rows) =>
      rows?.map((c) => (c.id === id ? { ...c, ...change } : c)),
    );
  }
}

/** Puts a conversation at the top with the activity's time (adding it if new). */
function withActivity(
  rows: readonly ConversationSummary[],
  { conversationId, message, at }: ConversationActivity,
): ConversationSummary[] {
  const existing = rows.find((c) => c.id === conversationId);
  const row: ConversationSummary = existing
    ? { ...existing, updatedAt: at }
    : {
        id: conversationId,
        title: titleFromMessage(message),
        createdAt: at,
        updatedAt: at,
        messageCount: 1,
      };
  return [row, ...rows.filter((c) => c.id !== conversationId)];
}
