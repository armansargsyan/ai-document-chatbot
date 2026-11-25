import { describe, expect, it } from 'vitest';
import {
  InvalidPdfError,
  PdfTextExtractor,
  TooManyPagesError,
} from './pdf-text-extractor';
import { makePdf } from './testing/make-pdf';

describe('PdfTextExtractor', () => {
  const extractor = new PdfTextExtractor();

  it('extracts text per page from a real PDF', async () => {
    const pages = await extractor.extractPages(
      makePdf(['Hello from page one', 'Page two (with parens)']),
      10,
    );
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain('Hello from page one');
    expect(pages[1]).toContain('Page two (with parens)');
  });

  it('rejects bytes that are not a PDF', async () => {
    await expect(
      extractor.extractPages(Buffer.from('%PDF-1.4 garbage'), 10),
    ).rejects.toBeInstanceOf(InvalidPdfError);
  });

  it('rejects PDFs over the page limit before extracting text', async () => {
    await expect(
      extractor.extractPages(makePdf(['one', 'two', 'three']), 2),
    ).rejects.toBeInstanceOf(TooManyPagesError);
  });
});
