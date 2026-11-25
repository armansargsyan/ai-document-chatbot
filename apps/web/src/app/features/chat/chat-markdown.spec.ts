import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChatMarkdown } from './chat-markdown';
import { renderMarkdown } from './markdown';
import { CITATIONS } from './testing/fake-fetch';

describe('renderMarkdown', () => {
  it('renders Markdown', () => {
    const html = renderMarkdown(
      '**Rent** is due:\n\n- monthly\n- `on the 1st`',
    );
    expect(html).toContain('<strong>Rent</strong>');
    expect(html).toContain('<li>monthly</li>');
    expect(html).toContain('<code>on the 1st</code>');
  });

  it('escapes raw HTML instead of passing it through', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhi <b>x</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops unsafe link targets and never renders images', () => {
    const html = renderMarkdown(
      '[a](javascript:alert(1)) [b](https://example.com) ![x](https://evil.test/p.png)',
    );
    expect(html).not.toContain('javascript:');
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">b</a>',
    );
    expect(html).not.toContain('<img');
  });

  it('turns known [n] markers into citation links and leaves others as text', () => {
    const html = renderMarkdown(
      'Due monthly [1][2]. See [9]. `[1]`',
      new Map([
        [1, 'Source 1: Lease.pdf, page 3'],
        [2, 'Source 2: Rules.pdf, page 7'],
      ]),
    );
    expect(html).toContain('href="#citation-1"');
    expect(html).toContain('href="#citation-2"');
    expect(html).toContain('aria-label="Source 1: Lease.pdf, page 3"');
    expect(html).not.toContain('#citation-9');
    expect(html).toContain('[9]');
    expect(html).toContain('<code>[1]</code>'); // code stays literal
  });
});

describe('ChatMarkdown', () => {
  let fixture: ComponentFixture<ChatMarkdown>;
  let el: HTMLElement;
  let opened: number[];

  async function render(text: string, citations = CITATIONS) {
    fixture = TestBed.createComponent(ChatMarkdown);
    el = fixture.nativeElement as HTMLElement;
    opened = [];
    fixture.componentInstance.citationOpen.subscribe((n) => opened.push(n));
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('citations', citations);
    await fixture.whenStable();
  }

  afterEach(() => {
    delete (window as { pwned?: boolean }).pwned;
  });

  it('never renders executable markup from model output', async () => {
    await render(
      [
        '<script>window.pwned = true</script>',
        '<img src="x" onerror="window.pwned = true">',
        '<a href="javascript:window.pwned = true">x</a>',
        '[click](javascript:window.pwned=true)',
      ].join('\n\n'),
    );
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[onerror]')).toBeNull();
    for (const a of el.querySelectorAll('a')) {
      expect(a.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    }
    expect((window as { pwned?: boolean }).pwned).toBeUndefined();
    // Shown as text so the user can see what the model wrote.
    expect(el.textContent).toContain('<script>');
  });

  it('opens a citation from an inline marker by click or Space', async () => {
    await render('Rent is due on the 1st [1], quietly [2].');
    const links = [...el.querySelectorAll<HTMLAnchorElement>('a.citation-ref')];
    expect(links.map((a) => a.textContent)).toEqual(['1', '2']);
    expect(links[0].getAttribute('aria-label')).toBe(
      'Source 1: Lease agreement.pdf, page 3',
    );

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    links[1].dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true); // no "#citation-2" navigation
    links[0].dispatchEvent(
      new KeyboardEvent('keydown', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(opened).toEqual([2, 1]);
  });

  it('ignores clicks elsewhere in the answer', async () => {
    await render('Plain [link](https://example.com) text');
    el.querySelector('p')?.click();
    expect(opened).toEqual([]);
  });
});
