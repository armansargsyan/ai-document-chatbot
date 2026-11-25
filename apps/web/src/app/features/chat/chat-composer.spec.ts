import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { MAX_CHAT_MESSAGE_LENGTH } from '@ai-document-chatbot/shared';
import { ChatComposer } from './chat-composer';

describe('ChatComposer', () => {
  let fixture: ComponentFixture<ChatComposer>;
  let el: HTMLElement;
  let sent: string[];
  let stops: number;

  beforeEach(async () => {
    fixture = TestBed.createComponent(ChatComposer);
    el = fixture.nativeElement as HTMLElement;
    sent = [];
    stops = 0;
    fixture.componentInstance.send.subscribe((m) => sent.push(m));
    fixture.componentInstance.stop.subscribe(() => stops++);
    await fixture.whenStable();
  });

  const textarea = () => {
    const found = el.querySelector<HTMLTextAreaElement>(
      '[data-testid="composer-input"]',
    );
    if (!found) throw new Error('Missing composer input');
    return found;
  };
  const q = (id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  async function type(value: string) {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  function key(init: KeyboardEventInit & { keyCode?: number }) {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    if (init.keyCode)
      Object.defineProperty(event, 'keyCode', { value: init.keyCode });
    textarea().dispatchEvent(event);
    return event;
  }

  it('has a labelled textarea', () => {
    const label = el.querySelector(`label[for="${textarea().id}"]`);
    expect(label?.textContent).toContain('Message');
  });

  it('sends the trimmed text on Enter', async () => {
    await type('  When is rent due?  ');
    const event = key({ key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    expect(sent).toEqual(['When is rent due?']);
  });

  it('adds a line on Shift+Enter instead of sending', async () => {
    await type('Line one');
    const event = key({ key: 'Enter', shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not send while an IME composition is open', async () => {
    await type('にほんご');
    expect(key({ key: 'Enter', isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(key({ key: 'Enter', keyCode: 229 }).defaultPrevented).toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends with the button and not when empty', async () => {
    const send = q('composer-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await type('   ');
    expect(send.disabled).toBe(true);
    key({ key: 'Enter' });
    expect(sent).toEqual([]);

    await type('Hello');
    expect(send.disabled).toBe(false);
    send.click();
    expect(sent).toEqual(['Hello']);
  });

  it('caps the length and shows a counter near the limit', async () => {
    expect(textarea().getAttribute('maxlength')).toBe(
      String(MAX_CHAT_MESSAGE_LENGTH),
    );
    expect(q('composer-counter')).toBeNull();

    await type('a'.repeat(MAX_CHAT_MESSAGE_LENGTH - 10));
    expect(q('composer-counter')?.textContent).toContain(
      `${MAX_CHAT_MESSAGE_LENGTH - 10} / ${MAX_CHAT_MESSAGE_LENGTH}`,
    );

    // e.g. set programmatically past the limit: refuse to send.
    fixture.componentInstance.text.set('a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1));
    await fixture.whenStable();
    expect((q('composer-send') as HTMLButtonElement).disabled).toBe(true);
    expect(textarea().getAttribute('aria-invalid')).toBe('true');
    key({ key: 'Enter' });
    expect(sent).toEqual([]);
  });

  it('turns Send into Stop and blocks sending while streaming', async () => {
    await type('Follow-up');
    fixture.componentRef.setInput('streaming', true);
    await fixture.whenStable();

    expect(q('composer-send')).toBeNull();
    expect(textarea().readOnly).toBe(true);
    key({ key: 'Enter' });
    expect(sent).toEqual([]);

    (q('composer-stop') as HTMLButtonElement).click();
    expect(stops).toBe(1);
    key({ key: 'Escape' });
    expect(stops).toBe(2);
  });

  it('is disabled when no model can answer', async () => {
    fixture.componentRef.setInput('disabled', true);
    await type('Hello');
    expect(textarea().disabled).toBe(true);
    expect((q('composer-send') as HTMLButtonElement).disabled).toBe(true);
  });
});
