/** Largest PDF the api accepts (bytes). */
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** Most pages the api will ingest from one PDF. */
export const MAX_PDF_PAGES = 300;
/** Most text chunks one PDF may produce (~2.4M characters); bounds embedding cost per upload. */
export const MAX_PDF_CHUNKS = 2000;
export const PDF_MIME_TYPE = 'application/pdf';

/**
 * - `processing`: stored and being embedded (visible while the upload request runs)
 * - `ready`: chunks are embedded and searchable
 * - `failed`: ingestion failed after the file was stored; delete and re-upload
 */
export type DocumentStatus = 'processing' | 'ready' | 'failed';

/** A user's uploaded document. Returned by `POST /api/documents` and listed by `GET /api/documents`. */
export interface DocumentSummary {
  id: string;
  name: string;
  sizeBytes: number;
  status: DocumentStatus;
  pageCount: number;
  /** Number of searchable chunks; null until the document is ready. */
  chunkCount: number | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Response of `GET /api/documents`, newest first. */
export interface ListDocumentsResponse {
  documents: DocumentSummary[];
}
