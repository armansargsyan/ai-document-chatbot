import { Marked, type Tokens } from 'marked';

/** `href` of an inline citation link: `#citation-<n>`. */
export const CITATION_HREF_PREFIX = '#citation-';
/** Class marking inline citation links (survives Angular's sanitizer; `data-*` doesn't). */
export const CITATION_LINK_CLASS = 'citation-ref';

interface CitationToken extends Tokens.Generic {
  type: 'citation';
  raw: string;
  number: number;
  /** Set before rendering: whether a source with this number exists. */
  label?: string;
}

/**
 * Plain utilities on the generated link (Angular's sanitizer keeps `class`),
 * so Tailwind emits them once instead of as long descendant variants.
 */
const CITATION_LINK_STYLE =
  'mx-0.5 inline-flex h-[1.125rem] min-w-[1.125rem] -translate-y-px items-center justify-center rounded-full bg-muted px-1 align-middle text-[0.6875rem] leading-none font-semibold text-muted-foreground no-underline outline-none transition-colors hover:bg-foreground hover:text-background focus-visible:ring-3 focus-visible:ring-ring/50';

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const SAFE_LINK = /^(https?:|mailto:)/i;

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  extensions: [
    {
      // `[n]` (not a `[n](url)` link) → a citation token.
      name: 'citation',
      level: 'inline',
      start: (src: string) => src.match(/\[\d{1,3}\](?!\()/)?.index,
      tokenizer(src: string): CitationToken | undefined {
        const match = /^\[(\d{1,3})\](?!\()/.exec(src);
        if (!match) return undefined;
        return { type: 'citation', raw: match[0], number: Number(match[1]) };
      },
      renderer(token: Tokens.Generic): string {
        const { number, label } = token as CitationToken;
        // Unknown numbers (or citations not loaded yet) stay plain text.
        if (!label)
          return `<sup class="text-[0.6875rem] text-muted-foreground">[${number}]</sup>`;
        return (
          `<a href="${CITATION_HREF_PREFIX}${number}" class="${CITATION_LINK_CLASS} ${CITATION_LINK_STYLE}"` +
          ` role="button" aria-haspopup="dialog" aria-label="${escapeHtml(label)}"` +
          ` title="${escapeHtml(label)}">${number}</a>`
        );
      },
    },
  ],
  renderer: {
    // GFM task lists would emit <input>, which the sanitizer strips noisily.
    checkbox: ({ checked }) => (checked ? '[x] ' : '[ ] '),
    // Raw HTML from the model is shown as text, never parsed as markup.
    html: ({ text }) => escapeHtml(text),
    // Images could load tracking URLs (e.g. injected by a document): link instead.
    image: ({ href, text }) =>
      SAFE_LINK.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(text || href)}</a>`
        : escapeHtml(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (!SAFE_LINK.test(href)) return inner;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${inner}</a>`;
    },
  },
});

/**
 * Renders an answer's Markdown to HTML. Raw HTML in `text` is escaped and only
 * http(s)/mailto links survive; the result still goes through Angular's
 * sanitizer (`[innerHTML]`), so it never runs script.
 *
 * `[n]` markers with a matching source become `<a href="#citation-n">` links
 * that the host opens via event delegation; `labels` maps n → accessible name.
 */
export function renderMarkdown(
  text: string,
  labels: ReadonlyMap<number, string> = new Map(),
): string {
  const tokens = marked.lexer(text);
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'citation') {
      const citation = token as CitationToken;
      citation.label = labels.get(citation.number);
    }
  });
  return marked.parser(tokens);
}

/** The citation number of an inline citation link `<a>`, or null. */
export function citationNumberOf(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest(`a.${CITATION_LINK_CLASS}`);
  const href = link?.getAttribute('href') ?? '';
  if (!href.startsWith(CITATION_HREF_PREFIX)) return null;
  const number = Number(href.slice(CITATION_HREF_PREFIX.length));
  return Number.isInteger(number) ? number : null;
}
