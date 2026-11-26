import { Injectable, computed, linkedSignal, type Signal } from '@angular/core';
import { httpResource } from '@angular/common/http';
import type {
  LimitErrorCode,
  UsageCounter,
  UsageResponse,
} from '@ai-document-chatbot/shared';

export const USAGE_URL = '/api/usage';

/**
 * Why the upload area is off:
 * - `uploads`: every lifetime upload is used (deleting won't help)
 * - `documents`: at the document limit; deleting one frees a slot
 * - `paused`: document search hit its monthly demo budget
 */
export type UploadBlock = 'uploads' | 'documents' | 'paused';

const left = (counter: UsageCounter | undefined): number | null =>
  counter ? Math.max(0, counter.limit - counter.used) : null;

/**
 * What the UI derives from the usage counts. Split from {@link DemoUsage} so
 * tests can drive the same logic without HTTP.
 */
export abstract class DemoUsageState {
  /** Null until loaded (or if it never loaded). */
  abstract readonly usage: Signal<UsageResponse | null>;
  /** Embeddings are out of their monthly budget: uploads and questions are paused. */
  abstract readonly searchPaused: Signal<boolean>;

  readonly documentsLeft = computed(() => left(this.usage()?.documents));
  readonly uploadsLeft = computed(() => left(this.usage()?.uploads));
  readonly questionsLeft = computed(() => left(this.usage()?.questions));

  readonly documentsFull = computed(() => this.documentsLeft() === 0);
  readonly uploadsExhausted = computed(() => this.uploadsLeft() === 0);
  readonly questionsExhausted = computed(() => this.questionsLeft() === 0);

  /** Why uploading is off right now, or null. The permanent reason wins. */
  readonly uploadBlock = computed<UploadBlock | null>(() => {
    if (this.uploadsExhausted()) return 'uploads';
    if (this.documentsFull()) return 'documents';
    if (this.searchPaused()) return 'paused';
    return null;
  });

  /** Questions can't be sent: the quota is used, or search is paused. */
  readonly questionsBlocked = computed(
    () => this.questionsExhausted() || this.searchPaused(),
  );

  abstract readonly loading: Signal<boolean>;
  abstract refresh(): void;
  /** A request failed with a demo-limit code: refresh, and remember a paused search. */
  abstract noteLimit(code: LimitErrorCode | undefined): void;
}

/**
 * The signed-in user's demo usage from `GET /api/usage`. Provided by the
 * signed-in shell, so it starts fresh for each session and is shared by the
 * Documents and Chat pages. Call {@link refresh} after anything that changes
 * a counter (upload, delete, a finished question).
 */
@Injectable()
export class DemoUsage extends DemoUsageState {
  readonly resource = httpResource<UsageResponse>(() => USAGE_URL);

  /** The last usage the server returned; a failed refresh keeps showing it. */
  private readonly last = linkedSignal<
    UsageResponse | undefined,
    UsageResponse | undefined
  >({
    source: () =>
      this.resource.hasValue() ? this.resource.value() : undefined,
    computation: (usage, previous) => usage ?? previous?.value,
  });

  readonly usage = computed(() => this.last() ?? null);
  readonly loading = computed(() => this.resource.isLoading() && !this.usage());

  /**
   * `usage.searchQuotaExhausted` from the server, set early by a
   * `search_quota_exhausted` error; the next usage response is authoritative.
   */
  private readonly paused = linkedSignal<UsageResponse | null, boolean>({
    source: this.usage,
    computation: (usage, previous) =>
      usage?.searchQuotaExhausted ?? previous?.value ?? false,
  });
  readonly searchPaused = this.paused.asReadonly();

  refresh(): void {
    this.resource.reload();
  }

  noteLimit(code: LimitErrorCode | undefined): void {
    if (!code) return;
    if (code === 'search_quota_exhausted') this.paused.set(true);
    this.refresh();
  }
}
