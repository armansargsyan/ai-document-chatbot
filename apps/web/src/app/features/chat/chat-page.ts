import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
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
import { RouterLink } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePanelLeft, lucidePlus } from '@ng-icons/lucide';
import {
  getLlmModel,
  isLlmModelId,
  type Citation,
} from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmNativeSelectImports } from '@spartan-ng/helm/native-select';
import { HlmSheetImports } from '@spartan-ng/helm/sheet';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { AppLogo } from '../../core/layout/app-logo';
import { DemoUsage } from '../../core/usage/demo-usage';
import { DemoUsageSummary } from '../../core/usage/demo-usage-summary';
import {
  QUESTION_LIMIT_MESSAGE,
  SEARCH_QUOTA_MESSAGE,
} from '../../core/usage/limit-errors';
import { ChatComposer } from './chat-composer';
import { ChatDocuments } from './chat-documents';
import { ChatMarkdown } from './chat-markdown';
import { ChatModels } from './chat-models';
import { ChatSidebar, opensElsewhere } from './chat-sidebar';
import { ChatStore, type ChatEntry } from './chat-store';
import { ConversationList } from './conversation-list';

/** Within this many px of the bottom counts as "at the latest message". */
const BOTTOM_SLACK_PX = 48;

/** Tailwind `lg`: from here the history is a persistent aside, not a drawer. */
const DESKTOP_QUERY = '(min-width: 64rem)';

/** They work without a scope: the api lists the user's documents, with dates, for the model. */
export const EXAMPLE_PROMPTS = [
  'What are the key points across my documents?',
  'What deadlines or dates are mentioned?',
  'Which of my documents is the most recent?',
] as const;

/** Longest document name shown in the "Search in" options (full name in a tooltip). */
const SCOPE_NAME_MAX = 40;

/** Shortens a long file name for an option, keeping its extension. */
export function shortDocumentName(name: string, max = SCOPE_NAME_MAX): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  return `${name.slice(0, max - ext.length - 1).trimEnd()}…${ext}`;
}

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
    ChatSidebar,
    DemoUsageSummary,
    NgIcon,
    HlmButtonImports,
    HlmNativeSelectImports,
    HlmSheetImports,
    HlmSkeletonImports,
  ],
  providers: [
    ChatStore,
    ChatModels,
    ChatDocuments,
    ConversationList,
    provideIcons({ lucidePanelLeft, lucidePlus }),
  ],
  templateUrl: './chat-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Fills the viewport under the shell header (h-14 + 1px border), so the
  // message list scrolls on its own beside the history aside.
  host: { class: 'flex h-[calc(100dvh-3.5rem-1px)] min-h-0' },
})
export class ChatPage {
  protected readonly store = inject(ChatStore);
  protected readonly models = inject(ChatModels);
  protected readonly conversations = inject(ConversationList);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** Route param (`chat/:conversationId`), bound by the router. */
  readonly conversationId = input<string>();

  protected readonly documents = inject(ChatDocuments);
  protected readonly usage = inject(DemoUsage);
  protected readonly questionLimitMessage = QUESTION_LIMIT_MESSAGE;
  protected readonly searchQuotaMessage = SEARCH_QUOTA_MESSAGE;
  protected readonly shortName = shortDocumentName;

  protected readonly draft = signal('');
  protected readonly examples = EXAMPLE_PROMPTS;
  /** No history to wait for, or it has loaded (not loading, missing or failed). */
  protected readonly historyShown = computed(
    () =>
      this.store.historyState() === 'none' ||
      this.store.historyState() === 'ready',
  );
  protected readonly canCompose = computed(
    () =>
      !!this.models.selectedId() &&
      this.historyShown() &&
      !this.usage.questionsBlocked(),
  );
  protected readonly placeholder = computed(() => {
    if (this.usage.questionsExhausted()) return 'No demo questions left';
    if (this.usage.searchPaused()) return 'Questions are paused';
    if (this.models.noneAvailable()) return 'Sending is unavailable';
    return 'Ask a question about your documents…';
  });
  protected readonly isEmpty = computed(
    () => this.store.entries().length === 0 && this.historyShown(),
  );

  /** False once the user scrolls up; sending or "Jump to latest" sets it again. */
  protected readonly atBottom = signal(true);

  /** The open conversation's title; follows a rename in the sidebar. */
  protected readonly title = computed(
    () =>
      this.conversations.find(this.store.conversationId())?.title ??
      this.store.title() ??
      'New chat',
  );

  /** The history drawer below `lg`. */
  protected readonly historyOpen = signal(false);

  /** The citation shown in the source panel (kept while it animates closed). */
  protected readonly source = signal<Citation | null>(null);
  protected readonly sourceOpen = signal(false);

  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly composer = viewChild(ChatComposer);

  constructor() {
    // Growing to desktop width while the drawer is open: the aside takes over.
    const media = this.document.defaultView?.matchMedia?.(DESKTOP_QUERY);
    if (media) {
      const onChange = (e: MediaQueryListEvent) => {
        if (e.matches) this.historyOpen.set(false);
      };
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() =>
        media.removeEventListener('change', onChange),
      );
    }

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

  /** New chat from the page header (below `lg`). */
  protected newChat(event: MouseEvent): void {
    if (opensElsewhere(event)) return;
    this.store.reset();
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
    const smooth = !this.store.streaming() && !this.prefersReducedMotion();
    this.scrollToBottom(smooth ? 'smooth' : 'auto');
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

  private prefersReducedMotion(): boolean {
    return !!this.document.defaultView?.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
  }

  private refocusComposer(): void {
    afterNextRender(() => this.composer()?.focus(), {
      injector: this.injector,
    });
  }
}
