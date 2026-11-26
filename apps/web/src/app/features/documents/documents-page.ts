import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import type {
  DocumentSummary,
  ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { DemoUsage } from '../../core/usage/demo-usage';
import { DemoUsageSummary } from '../../core/usage/demo-usage-summary';
import { DocumentUpload } from './document-upload';
import { formatBytes } from './document-format';
import { DOCUMENTS_URL, DocumentsApi } from './documents-api';

/** How often the list is refreshed while a document is `processing` (ms). */
export const DOCUMENTS_POLL_MS = new InjectionToken<number>(
  'DOCUMENTS_POLL_MS',
  { factory: () => 4000 },
);

interface Notice {
  readonly text: string;
  /** For "still processing": hide the notice once that document is no longer processing. */
  readonly whileProcessingId?: string;
}

@Component({
  selector: 'app-documents-page',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    DocumentUpload,
    DemoUsageSummary,
    HlmAlertDialogImports,
    HlmBadgeImports,
    HlmButtonImports,
    HlmSkeletonImports,
  ],
  templateUrl: './documents-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class DocumentsPage {
  private readonly api = inject(DocumentsApi);
  private readonly injector = inject(Injector);
  protected readonly usage = inject(DemoUsage);

  protected readonly documents = httpResource<ListDocumentsResponse>(
    () => DOCUMENTS_URL,
  );
  /**
   * The last list the server returned. A failed refresh (a poll, or one after
   * an upload) keeps showing it, and polling carries on, instead of blanking it.
   */
  private readonly lastList = linkedSignal<
    ListDocumentsResponse | undefined,
    ListDocumentsResponse | undefined
  >({
    source: () =>
      this.documents.hasValue() ? this.documents.value() : undefined,
    computation: (list, previous) => list ?? previous?.value,
  });
  protected readonly rows = computed(() => this.lastList()?.documents ?? []);
  private readonly loaded = computed(() => this.lastList() !== undefined);
  /** Skeletons only on the first load; refreshes keep the current rows. */
  protected readonly initialLoading = computed(
    () => this.documents.isLoading() && !this.loaded(),
  );
  /** Nothing to show: the first load failed. */
  protected readonly loadFailed = computed(
    () => !!this.documents.error() && !this.loaded(),
  );
  /** A refresh failed while older rows are on screen. */
  protected readonly refreshFailed = computed(
    () => !!this.documents.error() && this.loaded(),
  );
  private readonly anyProcessing = computed(() =>
    this.rows().some((d) => d.status === 'processing'),
  );

  /** The document the delete dialog is about (kept while it animates closed). */
  protected readonly deleteTarget = signal<DocumentSummary | null>(null);
  protected readonly confirmOpen = signal(false);
  protected readonly deletingId = signal<string | null>(null);
  private readonly noticeState = signal<Notice | null>(null);
  /** The current notice, unless it was about a document that has since finished processing. */
  protected readonly notice = computed(() => {
    const notice = this.noticeState();
    if (!notice?.whileProcessingId) return notice;
    const doc = this.rows().find((d) => d.id === notice.whileProcessingId);
    return doc?.status === 'processing' ? notice : null;
  });
  protected readonly announcement = signal('');
  protected readonly formatBytes = formatBytes;

  private readonly heading =
    viewChild.required<ElementRef<HTMLElement>>('listHeading');
  /** The delete button that opened the dialog, to refocus on cancel. */
  private deleteTrigger: HTMLElement | null = null;

  constructor() {
    // Poll only while something is processing (another tab's upload, or one in
    // flight here). Stops as soon as the list shows none.
    const pollMs = inject(DOCUMENTS_POLL_MS);
    effect((onCleanup) => {
      if (!this.anyProcessing()) return;
      const timer = setInterval(() => this.documents.reload(), pollMs);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected reload(): void {
    this.documents.reload();
  }

  /** An upload started, finished or failed: both the list and the counts may have changed. */
  protected onUploadChanged(): void {
    this.documents.reload();
    this.usage.refresh();
  }

  protected askDelete(doc: DocumentSummary, event: Event): void {
    this.noticeState.set(null);
    this.deleteTrigger = event.currentTarget as HTMLElement | null;
    this.deleteTarget.set(doc);
    this.confirmOpen.set(true);
  }

  /** Fires after any close. Without a confirm (Escape, Cancel), refocus the trigger. */
  protected onDialogClosed(): void {
    this.confirmOpen.set(false);
    // The row may have disappeared (a refresh) while the dialog was open.
    if (this.deleteTrigger?.isConnected) this.deleteTrigger.focus();
    else this.focusHeading();
    this.deleteTrigger = null;
  }

  protected confirmDelete(): void {
    const doc = this.deleteTarget();
    if (!doc || !this.confirmOpen()) return;
    this.confirmOpen.set(false);
    this.deleteTrigger = null;
    this.deletingId.set(doc.id);
    // The row (and its button) is about to go; keep focus somewhere stable.
    this.focusHeading();

    this.api.remove(doc.id).subscribe({
      next: () => this.removed(doc, `Deleted “${doc.name}”.`),
      error: (error: unknown) => {
        this.deletingId.set(null);
        const status = error instanceof HttpErrorResponse ? error.status : 0;
        if (status === 404) {
          this.removed(doc, `“${doc.name}” was already deleted.`);
        } else if (status === 409) {
          this.noticeState.set({
            text: `“${doc.name}” is still processing. You can delete it once it’s finished.`,
            whileProcessingId: doc.id,
          });
          this.documents.reload();
        } else {
          this.noticeState.set({
            text: `Couldn’t delete “${doc.name}”. Try again in a moment.`,
          });
        }
      },
    });
  }

  protected badgeLabel(doc: DocumentSummary): string {
    switch (doc.status) {
      case 'processing':
        return 'Processing';
      case 'failed':
        return 'Failed';
      default:
        return 'Ready';
    }
  }

  private removed(doc: DocumentSummary, message: string): void {
    this.deletingId.set(null);
    // A document slot is free again (uploads stay used).
    this.usage.refresh();
    const without = (list: ListDocumentsResponse): ListDocumentsResponse => ({
      ...list,
      documents: list.documents.filter((d) => d.id !== doc.id),
    });
    if (this.documents.hasValue()) this.documents.value.update(without);
    else this.lastList.update((list) => list && without(list));
    this.announcement.set(message);
    this.focusHeading();
  }

  private focusHeading(): void {
    afterNextRender(() => this.heading().nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
