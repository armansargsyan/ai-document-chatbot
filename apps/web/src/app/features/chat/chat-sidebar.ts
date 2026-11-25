import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePencil, lucidePlus, lucideTrash2 } from '@ng-icons/lucide';
import type { ConversationSummary } from '@ai-document-chatbot/shared';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@ai-document-chatbot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { ChatStore } from './chat-store';
import { fullTime, relativeTime, titleError } from './conversation-format';
import { ConversationList } from './conversation-list';

let nextInstance = 0;

/** A click RouterLink leaves to the browser (new tab or window): no navigation here. */
export function opensElsewhere(event: MouseEvent): boolean {
  return (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * Conversation history: New chat, the list grouped by recency, inline rename
 * and confirmed delete. Rendered twice by the chat page (desktop aside and
 * mobile drawer); both share the page's {@link ConversationList}.
 */
@Component({
  selector: 'app-chat-sidebar',
  imports: [
    RouterLink,
    NgIcon,
    HlmAlertDialogImports,
    HlmButtonImports,
    HlmSkeletonImports,
  ],
  providers: [provideIcons({ lucidePencil, lucidePlus, lucideTrash2 })],
  templateUrl: './chat-sidebar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 flex-col' },
})
export class ChatSidebar {
  protected readonly list = inject(ConversationList);
  private readonly store = inject(ChatStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** A conversation or New chat was chosen (the drawer closes on this). */
  readonly navigated = output<void>();

  /** Unique per instance: the page renders two sidebars. */
  protected readonly uid = `conversations-${++nextInstance}`;
  protected readonly maxTitle = MAX_CONVERSATION_TITLE_LENGTH;
  protected readonly relativeTime = relativeTime;
  protected readonly fullTime = fullTime;

  protected readonly editingId = signal<string | null>(null);
  protected readonly editError = signal<string | null>(null);
  /** Focus moves after awaited requests; skip them once this sidebar is gone. */
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  /** The conversation the delete dialog is about (kept while it animates closed). */
  protected readonly deleteTarget = signal<ConversationSummary | null>(null);
  protected readonly confirmOpen = signal(false);
  private deleteTrigger: HTMLElement | null = null;

  protected startNew(event: MouseEvent): void {
    if (opensElsewhere(event)) return;
    this.store.reset();
    this.navigated.emit();
  }

  protected select(event: MouseEvent): void {
    if (opensElsewhere(event)) return;
    this.navigated.emit();
  }

  protected startRename(c: ConversationSummary): void {
    this.list.dismissNotice();
    this.editError.set(null);
    this.editingId.set(c.id);
    afterNextRender(
      () => {
        const input = this.inRow<HTMLInputElement>(c.id, 'rename-input');
        input?.focus();
        input?.select();
      },
      { injector: this.injector },
    );
  }

  protected onRenameKeydown(
    c: ConversationSummary,
    event: KeyboardEvent,
  ): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.commitRename(c, event.target as HTMLInputElement, true);
    } else if (event.key === 'Escape') {
      // Cancel the edit only; don't let it close the drawer around it.
      event.preventDefault();
      event.stopPropagation();
      this.cancelRename(c);
    }
  }

  protected onRenameInput(): void {
    this.editError.set(null);
  }

  protected onRenameBlur(
    c: ConversationSummary,
    input: HTMLInputElement,
  ): void {
    if (this.editingId() !== c.id) return;
    // Leaving the field: save a valid title, drop an invalid one.
    if (titleError(input.value)) {
      this.editingId.set(null);
      this.editError.set(null);
      this.list.announcement.set('Rename cancelled.');
      return;
    }
    void this.commitRename(c, input, false);
  }

  protected askDelete(c: ConversationSummary, event: Event): void {
    this.list.dismissNotice();
    this.deleteTrigger = event.currentTarget as HTMLElement | null;
    this.deleteTarget.set(c);
    this.confirmOpen.set(true);
  }

  /** Any close. Without a confirm (Escape, Cancel), focus goes back to the trigger. */
  protected onDialogClosed(): void {
    this.confirmOpen.set(false);
    if (this.deleteTrigger?.isConnected) this.deleteTrigger.focus();
    this.deleteTrigger = null;
  }

  protected async confirmDelete(): Promise<void> {
    const c = this.deleteTarget();
    if (!c || !this.confirmOpen()) return;
    this.confirmOpen.set(false);
    this.deleteTrigger = null;
    const index = this.list.rows().findIndex((r) => r.id === c.id);
    // Keep focus on the row while the request runs (the dialog took it).
    this.linkFor(c.id)?.focus();
    if (await this.list.remove(c)) this.focusAfterDelete(index);
    else this.focusLater(() => this.renameOrDeleteButton(c.id, 'delete'));
  }

  private cancelRename(c: ConversationSummary): void {
    this.editingId.set(null);
    this.editError.set(null);
    this.list.announcement.set('Rename cancelled.');
    this.focusLater(() => this.renameOrDeleteButton(c.id, 'rename'));
  }

  private async commitRename(
    c: ConversationSummary,
    input: HTMLInputElement,
    keepFocus: boolean,
  ): Promise<void> {
    // Enter clears `editingId` first, so the blur that follows can't send twice.
    if (this.editingId() !== c.id) return;
    const error = titleError(input.value);
    if (error) {
      this.editError.set(error);
      return;
    }
    this.editingId.set(null);
    this.editError.set(null);
    if (keepFocus) {
      this.focusLater(() => this.renameOrDeleteButton(c.id, 'rename'));
    }
    await this.list.rename(c, input.value);
  }

  /** The next row takes the deleted one's place; with none left, New chat. */
  private focusAfterDelete(index: number): void {
    this.focusLater(() => {
      const rows = this.list.rows();
      const next = rows[Math.min(Math.max(index, 0), rows.length - 1)];
      return (
        (next && this.linkFor(next.id)) ||
        this.query<HTMLElement>('[data-testid="new-chat"]')
      );
    });
  }

  private focusLater(target: () => HTMLElement | null | undefined): void {
    if (this.destroyed) return;
    afterNextRender(() => target()?.focus(), { injector: this.injector });
  }

  private linkFor(id: string): HTMLElement | null {
    return this.inRow(id, 'conversation-link');
  }

  private renameOrDeleteButton(
    id: string,
    which: 'rename' | 'delete',
  ): HTMLElement | null {
    return this.inRow(id, `${which}-button`);
  }

  /** An element in a conversation's row (ids are matched as data, not CSS). */
  private inRow<T extends HTMLElement>(id: string, testId: string): T | null {
    const row = [
      ...this.host.nativeElement.querySelectorAll<HTMLElement>(
        '[data-testid="conversation-row"]',
      ),
    ].find((el) => el.dataset['id'] === id);
    return row?.querySelector<T>(`[data-testid="${testId}"]`) ?? null;
  }

  private query<T extends HTMLElement>(selector: string): T | null {
    return this.host.nativeElement.querySelector<T>(selector);
  }
}
