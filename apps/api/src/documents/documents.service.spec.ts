import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { MAX_PDF_BYTES, MAX_PDF_CHUNKS } from '@ai-document-chatbot/shared';
import { limitError } from '../common/limit-errors';
import { Embedder, QuotaTrackingEmbedder } from '../embeddings/embedder';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import type { UsageService } from '../usage/usage.service';
import type { DocumentRecord, DocumentRepository } from './document.repository';
import {
  DocumentsService,
  STALE_PROCESSING_MS,
  sanitizeFileName,
  type UploadedPdf,
} from './documents.service';
import {
  InvalidPdfError,
  TooManyPagesError,
  type PdfTextExtractor,
} from './pdf-text-extractor';

const UID = 'user-1';
const ID = 'abcdefghij0123456789';

function pdf(size = 1000): UploadedPdf {
  return {
    originalname: 'report.pdf',
    size,
    buffer: Buffer.from('%PDF-1.7 fake content'),
  };
}

class FakeEmbedder extends Embedder {
  readonly dimensions = 3;
  embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
}

function setup() {
  const repository = {
    newId: vi.fn(() => ID),
    storagePath: vi.fn(
      (uid: string, id: string) => `users/${uid}/documents/${id}.pdf`,
    ),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    get: vi.fn(async (): Promise<DocumentRecord | null> => null),
    list: vi.fn(async () => [] as (DocumentRecord & { id: string })[]),
    saveFile: vi.fn(async () => undefined),
    saveChunks: vi.fn(async () => undefined),
    deleteChunks: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  const extractor = {
    extractPages: vi.fn(async () => ['Page one text', 'Page two text']),
  };
  const embedder = new FakeEmbedder();
  const usage = {
    // The real one creates the record in the quota transaction.
    reserveUpload: vi.fn(
      async (uid: string, id: string, record: DocumentRecord) => {
        await repository.create(uid, id, record);
      },
    ),
    refundUpload: vi.fn(async () => undefined),
  };
  const quota = new ProviderQuotaTracker();
  const make = (withEmbedder = true) =>
    new DocumentsService(
      repository as unknown as DocumentRepository,
      extractor as unknown as PdfTextExtractor,
      withEmbedder ? new QuotaTrackingEmbedder(embedder, quota) : null,
      usage as unknown as UsageService,
      quota,
    );
  return {
    repository,
    extractor,
    embedder,
    usage,
    quota,
    service: make(),
    make,
  };
}

async function status(promise: Promise<unknown>): Promise<number> {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return (error as HttpException).getStatus();
}

describe('DocumentsService.upload', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('stores, embeds and indexes a PDF, returning it as ready', async () => {
    const summary = await ctx.service.upload(UID, pdf());

    expect(summary).toMatchObject({
      id: ID,
      name: 'report.pdf',
      sizeBytes: 1000,
      status: 'ready',
      pageCount: 2,
      chunkCount: 2,
    });
    expect(ctx.repository.create).toHaveBeenCalledWith(
      UID,
      ID,
      expect.objectContaining({
        status: 'processing',
        storagePath: `users/${UID}/documents/${ID}.pdf`,
      }),
    );
    expect(ctx.repository.saveFile).toHaveBeenCalledWith(
      `users/${UID}/documents/${ID}.pdf`,
      expect.any(Buffer),
    );
    expect(ctx.embedder.embed).toHaveBeenCalledWith([
      'Page one text',
      'Page two text',
    ]);
    expect(ctx.repository.saveChunks).toHaveBeenCalledWith(
      UID,
      ID,
      [
        { page: 1, index: 0, text: 'Page one text' },
        { page: 2, index: 1, text: 'Page two text' },
      ],
      [
        [0.1, 0.2, 0.3],
        [0.1, 0.2, 0.3],
      ],
    );
    expect(ctx.repository.update).toHaveBeenLastCalledWith(UID, ID, {
      status: 'ready',
      chunkCount: 2,
    });
    expect(ctx.usage.reserveUpload).toHaveBeenCalledOnce();
    expect(ctx.usage.refundUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['no file', () => undefined, 400],
    ['an empty file', () => ({ ...pdf(), buffer: Buffer.alloc(0) }), 400],
    ['an oversized file', () => pdf(MAX_PDF_BYTES + 1), 413],
    [
      'a non-PDF (even if named .pdf)',
      () => ({ ...pdf(), buffer: Buffer.from('<html>not a pdf</html>') }),
      415,
    ],
  ])('rejects %s before storing anything', async (_label, file, expected) => {
    expect(await status(ctx.service.upload(UID, file() as UploadedPdf))).toBe(
      expected,
    );
    expect(ctx.repository.create).not.toHaveBeenCalled();
    expect(ctx.extractor.extractPages).not.toHaveBeenCalled();
    expect(ctx.usage.reserveUpload).not.toHaveBeenCalled();
  });

  it('returns 503 when no embedding provider is configured', async () => {
    expect(await status(ctx.make(false).upload(UID, pdf()))).toBe(503);
    expect(ctx.repository.create).not.toHaveBeenCalled();
  });

  it('rejects unreadable PDFs with 422', async () => {
    ctx.extractor.extractPages.mockRejectedValueOnce(new InvalidPdfError());
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.repository.create).not.toHaveBeenCalled();
  });

  it('passes the page limit to the extractor and rejects too many pages with 422', async () => {
    ctx.extractor.extractPages.mockRejectedValueOnce(
      new TooManyPagesError(300),
    );
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.extractor.extractPages).toHaveBeenCalledWith(
      expect.any(Buffer),
      300,
    );
    expect(ctx.repository.create).not.toHaveBeenCalled();
  });

  it('rejects huge extracted text with 422 before chunking', async () => {
    ctx.extractor.extractPages.mockResolvedValueOnce([
      'x'.repeat(MAX_PDF_CHUNKS * 1200 * 2 + 1),
    ]);
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.repository.create).not.toHaveBeenCalled();
  });

  it('rejects PDFs that would produce too many chunks with 422', async () => {
    const page = 'word '.repeat(240); // ~1200 chars: one chunk per page
    ctx.extractor.extractPages.mockResolvedValueOnce(
      Array.from({ length: MAX_PDF_CHUNKS + 1 }, () => page),
    );
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.repository.create).not.toHaveBeenCalled();
    expect(ctx.embedder.embed).not.toHaveBeenCalled();
  });

  it('rejects PDFs without extractable text with 422', async () => {
    ctx.extractor.extractPages.mockResolvedValueOnce(['  ', '']);
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.repository.create).not.toHaveBeenCalled();
  });

  it('marks the document failed and maps embedding errors', async () => {
    ctx.embedder.embed.mockRejectedValueOnce(
      Object.assign(new Error('Rate limit for key sk-live-secret'), {
        status: 429,
      }),
    );
    const error = await ctx.service.upload(UID, pdf()).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(
      JSON.stringify((error as HttpException).getResponse()),
    ).not.toContain('sk-live');
    expect(ctx.repository.update).toHaveBeenLastCalledWith(UID, ID, {
      status: 'failed',
    });
    expect(ctx.repository.saveChunks).not.toHaveBeenCalled();
    expect(ctx.repository.deleteChunks).toHaveBeenCalledWith(UID, ID);
  });

  it('maps a storage error to 502 even if it carries an HTTP status', async () => {
    // e.g. a GaxiosError from a failed GCS token refresh
    ctx.repository.saveFile.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(502);
  });

  it('cleans up partial chunks when writing chunks fails', async () => {
    ctx.repository.saveChunks.mockRejectedValueOnce(
      new Error('batch 2 failed'),
    );
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(502);
    expect(ctx.repository.deleteChunks).toHaveBeenCalledWith(UID, ID);
    expect(ctx.repository.update).toHaveBeenLastCalledWith(UID, ID, {
      status: 'failed',
    });
  });

  it('passes a quota failure through without storing, embedding or refunding', async () => {
    ctx.usage.reserveUpload.mockRejectedValueOnce(new Error('unexpected'));
    await expect(ctx.service.upload(UID, pdf())).rejects.toThrow('unexpected');
    expect(ctx.repository.saveFile).not.toHaveBeenCalled();
    expect(ctx.embedder.embed).not.toHaveBeenCalled();
    expect(ctx.usage.refundUpload).not.toHaveBeenCalled();
  });

  it('marks the document failed with 502 when storage fails', async () => {
    ctx.repository.saveFile.mockRejectedValueOnce(
      new Error('bucket unavailable'),
    );
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(502);
    expect(ctx.repository.update).toHaveBeenLastCalledWith(UID, ID, {
      status: 'failed',
    });
    expect(ctx.embedder.embed).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.upload quotas', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it.each([
    [
      'document_limit_reached',
      409,
      'You can keep up to 3 documents. Delete one to upload another.',
    ],
    ['upload_limit_reached', 403, "You've used all 6 demo uploads."],
  ] as const)(
    'answers %s after validation, before storing or embedding',
    async (code, expected, message) => {
      ctx.usage.reserveUpload.mockRejectedValueOnce(limitError(code));
      const error = (await ctx.service
        .upload(UID, pdf())
        .catch((e: unknown) => e)) as HttpException;
      expect(error.getStatus()).toBe(expected);
      expect(error.getResponse()).toMatchObject({ code, message });
      // Cheap validation ran first; nothing paid or stored afterwards.
      expect(ctx.extractor.extractPages).toHaveBeenCalled();
      expect(ctx.repository.saveFile).not.toHaveBeenCalled();
      expect(ctx.embedder.embed).not.toHaveBeenCalled();
      expect(ctx.usage.refundUpload).not.toHaveBeenCalled();
    },
  );

  it('does not charge for a PDF that fails validation', async () => {
    ctx.extractor.extractPages.mockRejectedValueOnce(new InvalidPdfError());
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(422);
    expect(ctx.usage.reserveUpload).not.toHaveBeenCalled();
    expect(ctx.usage.refundUpload).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an embedding provider error',
      (c: ReturnType<typeof setup>) =>
        c.embedder.embed.mockRejectedValueOnce(
          Object.assign(new Error('overloaded'), { status: 500 }),
        ),
      502,
    ],
    [
      'a storage error',
      (c: ReturnType<typeof setup>) =>
        c.repository.saveFile.mockRejectedValueOnce(new Error('bucket down')),
      502,
    ],
    [
      'a chunk write error',
      (c: ReturnType<typeof setup>) =>
        c.repository.saveChunks.mockRejectedValueOnce(new Error('batch')),
      502,
    ],
    [
      'an embedding rate limit',
      (c: ReturnType<typeof setup>) =>
        c.embedder.embed.mockRejectedValueOnce(
          Object.assign(new Error('slow down'), { status: 429 }),
        ),
      429,
    ],
  ])('refunds the upload after %s', async (_label, fail, expected) => {
    fail(ctx);
    expect(await status(ctx.service.upload(UID, pdf()))).toBe(expected);
    expect(ctx.usage.refundUpload).toHaveBeenCalledExactlyOnceWith(UID);
  });

  it('maps embeddings exhaustion to 503 search_quota_exhausted, refunds and then fails fast', async () => {
    ctx.embedder.embed.mockRejectedValueOnce(
      Object.assign(new Error('quota'), {
        status: 429,
        code: 'insufficient_quota',
        type: 'insufficient_quota',
      }),
    );
    const error = (await ctx.service
      .upload(UID, pdf())
      .catch((e: unknown) => e)) as HttpException;
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toMatchObject({
      code: 'search_quota_exhausted',
    });
    expect(ctx.usage.refundUpload).toHaveBeenCalledOnce();
    expect(ctx.quota.searchExhausted).toBe(true);

    // Next upload: rejected before parsing, charging or calling OpenAI.
    ctx.extractor.extractPages.mockClear();
    ctx.usage.reserveUpload.mockClear();
    ctx.embedder.embed.mockClear();
    const next = (await ctx.service
      .upload(UID, pdf())
      .catch((e: unknown) => e)) as HttpException;
    expect(next.getResponse()).toMatchObject({
      code: 'search_quota_exhausted',
    });
    expect(ctx.extractor.extractPages).not.toHaveBeenCalled();
    expect(ctx.usage.reserveUpload).not.toHaveBeenCalled();
    expect(ctx.embedder.embed).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.list / remove', () => {
  it('lists summaries without internal fields', async () => {
    const ctx = setup();
    ctx.repository.list.mockResolvedValueOnce([
      {
        id: ID,
        name: 'a.pdf',
        sizeBytes: 10,
        status: 'ready',
        pageCount: 1,
        chunkCount: 3,
        createdAt: '2026-11-25T10:00:00.000Z',
        storagePath: 'users/user-1/documents/x.pdf',
      },
    ]);
    const { documents } = await ctx.service.list(UID);
    expect(documents).toEqual([
      {
        id: ID,
        name: 'a.pdf',
        sizeBytes: 10,
        status: 'ready',
        pageCount: 1,
        chunkCount: 3,
        createdAt: '2026-11-25T10:00:00.000Z',
      },
    ]);
    expect(ctx.repository.list).toHaveBeenCalledWith(UID);
  });

  it('returns 404 when deleting a document the user does not have', async () => {
    const ctx = setup();
    expect(await status(ctx.service.remove(UID, ID))).toBe(404);
    expect(ctx.repository.delete).not.toHaveBeenCalled();
  });

  const record = (
    status: DocumentRecord['status'],
    ageMs = 0,
  ): DocumentRecord => ({
    name: 'a.pdf',
    sizeBytes: 1,
    status,
    pageCount: 1,
    chunkCount: null,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
    storagePath: 'p',
  });

  it.each(['ready', 'failed'] as const)(
    'deletes a %s document',
    async (state) => {
      const ctx = setup();
      ctx.repository.get.mockResolvedValueOnce(record(state));
      await ctx.service.remove(UID, ID);
      expect(ctx.repository.get).toHaveBeenCalledWith(UID, ID);
      expect(ctx.repository.delete).toHaveBeenCalledWith(UID, ID);
      // Deleting frees a document slot but never gives an upload back.
      expect(ctx.usage.refundUpload).not.toHaveBeenCalled();
    },
  );

  it('refuses with 409 to delete a document that is still processing', async () => {
    const ctx = setup();
    ctx.repository.get.mockResolvedValueOnce(record('processing'));
    expect(await status(ctx.service.remove(UID, ID))).toBe(409);
    expect(ctx.repository.delete).not.toHaveBeenCalled();
  });

  it('allows deleting an abandoned processing document', async () => {
    const ctx = setup();
    ctx.repository.get.mockResolvedValueOnce(
      record('processing', STALE_PROCESSING_MS + 1000),
    );
    await ctx.service.remove(UID, ID);
    expect(ctx.repository.delete).toHaveBeenCalledWith(UID, ID);
  });
});

describe('sanitizeFileName', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['C:\\Users\\me\\secret\\report.pdf', 'report.pdf'],
    ['../../etc/passwd.pdf', 'passwd.pdf'],
    ['bad\u0000name\u001f.pdf', 'badname.pdf'],
    ['invoice\u202Efdp.exe', 'invoicefdp.exe'],
    ['a\u2066b\u2069\u2028c.pdf', 'abc.pdf'],
    ['   ', 'document.pdf'],
    ['x'.repeat(300), 'x'.repeat(200)],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });
});
