import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  MAX_PDF_BYTES,
  MAX_PDF_CHUNKS,
  MAX_PDF_PAGES,
  type DocumentSummary,
  type ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { Embedder } from '../embeddings/embedder';
import { describeProviderError, toHttpException } from '../llm/llm-errors';
import { DEFAULT_CHUNK_OPTIONS, chunkPages } from './chunking';
import {
  DocumentRepository,
  toSummary,
  type DocumentRecord,
} from './document.repository';
import {
  InvalidPdfError,
  PdfTextExtractor,
  TooManyPagesError,
} from './pdf-text-extractor';

/** The subset of a multer file the service needs. */
export interface UploadedPdf {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const PDF_MAGIC = '%PDF-';
/**
 * A `processing` record older than this is treated as abandoned (e.g. the
 * server restarted mid-upload). Above the worst case for a healthy upload:
 * 20 embedding batches x 60s timeout x up to 3 attempts.
 */
export const STALE_PROCESSING_MS = 2 * 60 * 60_000;

/** Display name: no path, no control characters, bounded length. */
export function sanitizeFileName(name: string): string {
  const base = [...(name.split(/[\\/]/).pop() ?? '')]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      const bidi =
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069);
      return (
        code > 0x1f &&
        code !== 0x7f &&
        code !== 0x2028 &&
        code !== 0x2029 &&
        !bidi
      );
    })
    .join('')
    .trim()
    .slice(0, 200);
  return base || 'document.pdf';
}

/** Ingests user PDFs: validate → extract → chunk → store → embed → index. */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly repository: DocumentRepository,
    private readonly extractor: PdfTextExtractor,
    @Inject(Embedder) private readonly embedder: Embedder | null,
  ) {}

  async upload(
    uid: string,
    file: UploadedPdf | undefined,
  ): Promise<DocumentSummary> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Attach a PDF in the "file" form field');
    }
    if (file.size > MAX_PDF_BYTES) {
      throw new PayloadTooLargeException('The PDF is too large');
    }
    // Check the content, not the client-supplied MIME type or extension.
    if (!file.buffer.subarray(0, 1024).toString('latin1').includes(PDF_MAGIC)) {
      throw new UnsupportedMediaTypeException('Only PDF files are supported');
    }
    if (!this.embedder) {
      throw new ServiceUnavailableException(
        'Document processing is unavailable',
      );
    }

    // Validate fully before storing anything.
    let pages: string[];
    try {
      pages = await this.extractor.extractPages(file.buffer, MAX_PDF_PAGES);
    } catch (error) {
      if (error instanceof TooManyPagesError) {
        throw new UnprocessableEntityException(error.message);
      }
      if (error instanceof InvalidPdfError) {
        throw new UnprocessableEntityException(
          'The PDF could not be read; it may be corrupt or password-protected',
        );
      }
      throw error;
    }
    // Cheap bound before chunking: decompressed text can be far larger than the file.
    const totalChars = pages.reduce((sum, page) => sum + page.length, 0);
    if (totalChars > MAX_PDF_CHUNKS * DEFAULT_CHUNK_OPTIONS.size * 2) {
      throw new UnprocessableEntityException(
        'The PDF has too much text to index',
      );
    }
    const chunks = chunkPages(pages);
    if (chunks.length === 0) {
      throw new UnprocessableEntityException(
        'The PDF has no extractable text (scanned PDFs are not supported)',
      );
    }
    if (chunks.length > MAX_PDF_CHUNKS) {
      throw new UnprocessableEntityException(
        'The PDF has too much text to index',
      );
    }

    const id = this.repository.newId(uid);
    const record: DocumentRecord = {
      name: sanitizeFileName(file.originalname),
      sizeBytes: file.size,
      status: 'processing',
      pageCount: pages.length,
      chunkCount: null,
      createdAt: new Date().toISOString(),
      storagePath: this.repository.storagePath(uid, id),
    };
    const embedder = this.embedder;

    try {
      await this.repository.create(uid, id, record);
      await this.repository.saveFile(record.storagePath, file.buffer);
      let embeddings: number[][];
      try {
        embeddings = await embedder.embed(chunks.map((c) => c.text));
      } catch (error) {
        // Only embedding-provider errors go through the LLM error mapping.
        this.logger.warn(`Embedding failed: ${describeProviderError(error)}`);
        throw toHttpException(error);
      }
      await this.repository.saveChunks(uid, id, chunks, embeddings);
      await this.repository.update(uid, id, {
        status: 'ready',
        chunkCount: chunks.length,
      });
      return toSummary(id, {
        ...record,
        status: 'ready',
        chunkCount: chunks.length,
      });
    } catch (error) {
      this.logger.warn(
        `Ingestion failed for a document: ${describeProviderError(error)}`,
      );
      // Best effort: no partial chunks stay searchable, the record shows the failure.
      await this.repository.deleteChunks(uid, id).catch(() => undefined);
      await this.repository
        .update(uid, id, { status: 'failed' })
        .catch(() => undefined);
      throw error instanceof HttpException
        ? error
        : new BadGatewayException('Document processing failed');
    }
  }

  async list(uid: string): Promise<ListDocumentsResponse> {
    const records = await this.repository.list(uid);
    return {
      documents: records.map(({ id, ...record }) => toSummary(id, record)),
    };
  }

  async remove(uid: string, id: string): Promise<void> {
    const record = await this.repository.get(uid, id);
    if (!record) throw new NotFoundException('Document not found');
    // Deleting mid-ingestion would let the upload re-create the file and chunks.
    const age = Date.now() - Date.parse(record.createdAt);
    if (record.status === 'processing' && age < STALE_PROCESSING_MS) {
      throw new ConflictException('The document is still being processed');
    }
    await this.repository.delete(uid, id);
  }
}
