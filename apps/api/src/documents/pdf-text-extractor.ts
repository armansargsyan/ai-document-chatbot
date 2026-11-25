import { Injectable } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';

export class InvalidPdfError extends Error {
  constructor() {
    super('The file is not a readable PDF');
    this.name = 'InvalidPdfError';
  }
}

export class TooManyPagesError extends Error {
  constructor(readonly maxPages: number) {
    super(`The PDF has more than ${maxPages} pages`);
    this.name = 'TooManyPagesError';
  }
}

/** Extracts plain text per page. Swappable in tests. */
@Injectable()
export class PdfTextExtractor {
  /**
   * Resolves to one string per page. Rejects with TooManyPagesError (checked
   * before any text is extracted) or InvalidPdfError for corrupt/encrypted files.
   */
  async extractPages(data: Uint8Array, maxPages: number): Promise<string[]> {
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      // pdf.js may detach the buffer it is given, so pass a copy.
      pdf = await getDocumentProxy(new Uint8Array(data));
    } catch {
      throw new InvalidPdfError();
    }
    try {
      if (pdf.numPages > maxPages) throw new TooManyPagesError(maxPages);
      const { text } = await extractText(pdf, { mergePages: false });
      return text;
    } catch (error) {
      if (error instanceof TooManyPagesError) throw error;
      throw new InvalidPdfError();
    } finally {
      // A cleanup failure must not turn a successful extraction into an error.
      await pdf.loadingTask.destroy().catch(() => undefined);
    }
  }
}
