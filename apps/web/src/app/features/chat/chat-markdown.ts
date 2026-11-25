import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { Citation } from '@ai-document-chatbot/shared';
import { citationNumberOf, renderMarkdown } from './markdown';

/**
 * Prose styles for the generated HTML (no per-component CSS: Tailwind
 * descendant variants). Inline citation links carry their own classes.
 */
const PROSE = [
  'block min-w-0 text-[0.9375rem] leading-7 break-words',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
  '[&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-1 [&_li>p]:my-1',
  '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-semibold',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_a:not(.citation-ref)]:underline [&_a:not(.citation-ref)]:underline-offset-2 [&_a:not(.citation-ref)]:decoration-muted-foreground/50 hover:[&_a:not(.citation-ref)]:decoration-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125rem]',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/50 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-sm [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:my-4 [&_hr]:border-border',
].join(' ');

/**
 * An assistant answer as Markdown. The HTML is bound with `[innerHTML]`, so
 * Angular's sanitizer runs on it (on top of the renderer escaping raw HTML).
 *
 * Inline `[n]` markers become `<a href="#citation-n" class="citation-ref">`.
 * Angular can't bind events inside sanitized HTML, so a single click listener
 * on the host (event delegation) maps clicks on those links to
 * {@link citationOpen}. They are real links, so Tab reaches them, and Enter
 * or Space activates them.
 */
@Component({
  selector: 'app-chat-markdown',
  // Sanitized by Angular: the HTML security context applies to [innerHTML].
  template: `<div [class]="proseClass" [innerHTML]="html()"></div>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0',
    '(click)': 'onClick($event)',
    '(keydown.space)': 'onClick($event)',
  },
})
export class ChatMarkdown {
  readonly text = input.required<string>();
  readonly citations = input<readonly Citation[]>([]);
  /** A citation marker was activated: its number. */
  readonly citationOpen = output<number>();

  protected readonly proseClass = PROSE;

  private readonly labels = computed(
    () =>
      new Map(
        this.citations().map((c) => [
          c.number,
          `Source ${c.number}: ${c.documentName}, page ${c.page}`,
        ]),
      ),
  );

  protected readonly html = computed(() =>
    renderMarkdown(this.text(), this.labels()),
  );

  /** Click, or Space (the links have `role="button"`; Enter already clicks). */
  protected onClick(event: Event): void {
    const number = citationNumberOf(event.target);
    if (number === null) return;
    event.preventDefault();
    if (this.labels().has(number)) this.citationOpen.emit(number);
  }
}
