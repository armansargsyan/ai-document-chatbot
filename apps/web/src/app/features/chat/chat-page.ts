import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import {
  getLlmModel,
  isLlmModelId,
  type Citation,
  type ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { AppLogo } from '../../core/layout/app-logo';
import { ChatComposer } from './chat-composer';
import { ChatMarkdown } from './chat-markdown';
import { ChatModels } from './chat-models';
import { ChatStore, type ChatEntry } from './chat-store';

/** Within this many px of the bottom counts as "at the latest message". */
const BOTTOM_SLACK_PX = 48;

export const EXAMPLE_PROMPTS = [
  'Summarize the key points of my latest document',
  'What deadlines or dates are mentioned?',
  'List any obligations or risks, with page references',
] as const;

/** `[n]` numbers an answer refers to, in order of first mention. */
function referencedNumbers(text: string): Set<number> {
  return new Set([...text.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])));
}

@Component({
  selector: 'app-chat-page',
  imports: [
    RouterLink,
    AppLogo,
    ChatComposer,
    ChatMarkdown,
    HlmButtonImports,
    HlmNativeSelectImports,
    HlmSheetImports,
    HlmSkeletonImports,
  ],
  providers: [ChatStore, ChatModels],
  templateUrl: './chat-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Fills the viewport under the shell header (h-14 + 1px border), so the
  // message list scrolls on its own and a history aside (#12) can sit beside it.
  host: { class: 'flex h-[calc(100dvh-3.5rem-1px)] min-h-0' },
})
export class ChatPage {
  protected readonly store = inject(ChatStore);
  protected readonly models = inject(ChatModels);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** Route param (`chat/:conversationId`), bound by the router. */
  readonly conversationId = input<string>();

  private readonly documents = httpResource<ListDocumentsResponse>(
    () => '/api/documents',
  );
  /** Loaded and none is ready to search: point to the documents page. */
  protected readonly needsDocuments = computed(
    () =>
      this.documents.hasValue() &&
      !this.documents.value().documents.some((d) => d.status === 'ready'),
  );

  protected readonly draft = signal('');
  protected readonly examples = EXAMPLE_PROMPTS;
  /** No history to wait for, or it has loaded (not loading, missing or failed). */
  protected readonly historyShown = computed(
    () =>
      this.store.historyState() === 'none' ||
      this.store.historyState() === 'ready',
  );
  protected readonly canCompose = computed(
    () => !!this.models.selectedId() && this.historyShown(),
  );
  protected readonly isEmpty = computed(
    () => this.store.entries().length === 0 && this.historyShown(),
  );

  /** False once the user scrolls up; sending or "Jump to latest" sets it again. */
  protected readonly atBottom = signal(true);

  /** The citation shown in the source panel (kept while it animates closed). */
  protected readonly source = signal<Citation | null>(null);
  protected readonly sourceOpen = signal(false);

  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild(ChatComposer);

  constructor() {
    // The route drives which conversation is shown. The store ignores the id
    // it just put in the URL itself (a new conversation).
    effect(() => {
      const id = this.conversationId();
      untracked(() => {
        this.store.open(id);
        this.atBottom.set(true);
      });
    });

    // Keep the latest message in view while text arrives, unless the user
    // has scrolled up to read.
    afterRenderEffect({
      write: () => {
        this.store.entries();
        if (untracked(this.atBottom)) this.scrollToBottom();
      },
    });

    // Send became Stop (or Stop went away when the answer finished): if that
    // dropped focus, put the keyboard back in the composer.
    let wasStreaming = false;
    afterRenderEffect({
      write: () => {
        const streaming = this.store.streaming();
        if (streaming === wasStreaming) return;
        wasStreaming = streaming;
        const active = this.document.activeElement;
        if (!active || active === this.document.body) this.composer()?.focus();
      },
    });
  }

  protected send(message: string): void {
    const modelId = this.models.selectedId();
    if (!modelId || !this.store.send(message, modelId)) return;
    this.draft.set('');
    this.atBottom.set(true);
    this.refocusComposer();
  }

  protected stop(): void {
    this.store.stop();
    this.refocusComposer();
  }

  protected retry(entry: ChatEntry): void {
    this.atBottom.set(true);
    this.store.retry(entry.id, this.models.selectedId());
  }

  protected useExample(prompt: string): void {
    this.draft.set(prompt);
    this.refocusComposer();
  }

  protected onScroll(): void {
    const el = this.scroller().nativeElement;
    this.atBottom.set(
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX,
    );
  }

  protected jumpToLatest(): void {
    this.atBottom.set(true);
    // A smooth scroll would fall behind new deltas while streaming.
    this.scrollToBottom(this.store.streaming() ? 'auto' : 'smooth');
    this.refocusComposer();
  }

  protected openSource(entry: ChatEntry, number: number): void {
    const citation = entry.citations.find((c) => c.number === number);
    if (!citation) return;
    this.source.set(citation);
    this.sourceOpen.set(true);
  }

  /** Citations the answer refers to as `[n]` (sources it didn't use are left out). */
  protected chips(entry: ChatEntry): readonly Citation[] {
    if (!entry.citations.length) return [];
    const used = referencedNumbers(entry.content);
    return entry.citations.filter((c) => used.has(c.number));
  }

  protected modelLabel(entry: ChatEntry): string | null {
    const id = entry.modelId;
    if (!id) return null;
    return (
      this.models.label(id) ?? (isLlmModelId(id) ? getLlmModel(id).label : null)
    );
  }

  private scrollToBottom(behavior: ScrollBehavior = 'auto'): void {
    const el = this.scroller().nativeElement;
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }

  private refocusComposer(): void {
    afterNextRender(() => this.composer()?.focus(), {
      injector: this.injector,
    });
  }
}
