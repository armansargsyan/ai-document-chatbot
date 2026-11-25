import { describe, expect, it } from 'vitest';
import { chunkPages } from './chunking';

describe('chunkPages', () => {
  it('keeps short pages as one chunk each, with 1-based page numbers', () => {
    expect(chunkPages(['First page.', 'Second page.'])).toEqual([
      { page: 1, index: 0, text: 'First page.' },
      { page: 2, index: 1, text: 'Second page.' },
    ]);
  });

  it('normalizes whitespace and skips empty pages', () => {
    expect(chunkPages(['  a\n\n b\tc  ', '   ', 'd'])).toEqual([
      { page: 1, index: 0, text: 'a b c' },
      { page: 3, index: 1, text: 'd' },
    ]);
  });

  it('splits long pages into overlapping chunks that never span pages', () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkPages([words, 'tail'], { size: 200, overlap: 50 });

    const page1 = chunks.filter((c) => c.page === 1);
    expect(page1.length).toBeGreaterThan(5);
    expect(chunks.at(-1)).toMatchObject({ page: 2, text: 'tail' });
    for (const chunk of page1)
      expect(chunk.text.length).toBeLessThanOrEqual(200);
    // Consecutive chunks overlap: the next one starts with text from the previous.
    for (let i = 1; i < page1.length; i++) {
      const head = page1[i].text.slice(0, 20);
      expect(page1[i - 1].text).toContain(head);
    }
    // Every word survives chunking.
    const joined = page1.map((c) => c.text).join(' ');
    expect(joined).toContain('w0 ');
    expect(joined).toContain('w299');
    // Indexes are sequential across the document.
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('backs off to whitespace in the last 20% of the window', () => {
    // size 10: the space at position 9 is within the last 20%, so the break moves there.
    const [first] = chunkPages(['aaaa bbbb cccc dddd'], {
      size: 10,
      overlap: 2,
    });
    expect(first.text).toBe('aaaa bbbb');
  });

  it('terminates on text without spaces', () => {
    const chunks = chunkPages(['x'.repeat(1000)], { size: 100, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(9);
    expect(chunks.every((c) => c.text.length <= 100)).toBe(true);
  });

  it('rejects invalid options', () => {
    expect(() => chunkPages(['a'], { size: 10, overlap: 10 })).toThrow();
    expect(() => chunkPages(['a'], { size: 0, overlap: 0 })).toThrow();
  });
});
