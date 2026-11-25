import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { MAX_CHAT_MESSAGE_LENGTH } from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';

/** Show the character counter once this close to the limit. */
const COUNTER_THRESHOLD = 500;
/** Tallest the textarea grows before it scrolls (px). */
const MAX_HEIGHT_PX = 200;

/**
 * Message input. Enter sends, Shift+Enter adds a line, and nothing is sent
 * while an IME composition is open. While an answer streams the text is
 * read-only (focus stays here) and Send becomes Stop.
 */
@Component({
  selector: 'app-chat-composer',
  imports: [HlmButtonImports, HlmTextareaImports],
  templateUrl: './chat-composer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class ChatComposer {
  readonly text = model('');
  readonly streaming = input(false);
  /** No model can answer (or none is selected yet). */
  readonly disabled = input(false);
  readonly placeholder = input('Ask a question about your documents…');
  readonly send = output<string>();
  readonly stop = output<void>();

  protected readonly maxLength = MAX_CHAT_MESSAGE_LENGTH;
  private readonly textarea =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('textarea');

  protected readonly length = computed(() => this.text().length);
  protected readonly showCounter = computed(
    () => this.length() >= this.maxLength - COUNTER_THRESHOLD,
  );
  protected readonly tooLong = computed(() => this.length() > this.maxLength);
  protected readonly canSend = computed(
    () =>
      !this.disabled() &&
      !this.streaming() &&
      !!this.text().trim() &&
      !this.tooLong(),
  );

  constructor() {
    // Auto-grow (for browsers without `field-sizing: content`).
    afterRenderEffect({
      write: () => {
        this.text();
        const el = this.textarea().nativeElement;
        el.style.height = 'auto';
        const height = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
        if (height > 0) el.style.height = `${height}px`;
        el.style.overflowY =
          el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden';
      },
    });
  }

  focus(): void {
    this.textarea().nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.streaming()) {
      event.preventDefault();
      this.stop.emit();
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey) return;
    // IME: Enter confirms the composition, it must not send. (229: Safari.)
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    this.submit();
  }

  protected submit(): void {
    if (!this.canSend()) return;
    this.send.emit(this.text().trim());
  }
}
