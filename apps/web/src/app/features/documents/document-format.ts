import { HttpErrorResponse } from '@angular/common/http';
import { MAX_PDF_BYTES, PDF_MIME_TYPE } from '@ai-document-chatbot/shared';

/** `2.4 MB`, `340 KB`, `812 B` (binary units, matching the server's limit). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024)
    return `${Math.max(0, bytes | 0)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export const MAX_PDF_SIZE_LABEL = formatBytes(MAX_PDF_BYTES);

/** Client-side check before uploading. Returns a user-facing reason, or null if OK. */
export function validatePdf(file: File): string | null {
  const isPdf =
    file.type === PDF_MIME_TYPE || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'Only PDF files can be uploaded.';
  if (file.size > MAX_PDF_BYTES) {
    return `This file is larger than ${MAX_PDF_SIZE_LABEL}, the upload limit.`;
  }
  if (file.size === 0) return 'This file is empty.';
  return null;
}

const NETWORK_MESSAGE =
  'Couldn’t reach the server. Check your connection and try again.';
const SERVER_MESSAGE =
  'Something went wrong on our side. Try again in a moment.';

/** The api's `{ message }` (Nest error body), if it's a usable string. */
function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return null;
  }
  const { message } = body as { message: unknown };
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (Array.isArray(message) && message.every((m) => typeof m === 'string')) {
    return message.join(' ') || null;
  }
  return null;
}

/**
 * Maps a failed upload to inline copy. 4xx: the server's message (already
 * user-friendly). 5xx / network: generic copy; never raw error details.
 */
export function uploadErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return SERVER_MESSAGE;
  const { status } = error;
  if (status === 0) return NETWORK_MESSAGE;
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status >= 400 && status < 500) {
    const message = serverMessage(error.error);
    if (message) return message;
    switch (status) {
      case 413:
        return `This file is too large. PDFs can be up to ${MAX_PDF_SIZE_LABEL}.`;
      case 415:
        return 'This file isn’t a PDF.';
      case 422:
        return 'This PDF couldn’t be read.';
      case 429:
        return 'You’ve reached the upload limit. Try again later.';
      default:
        return 'This file couldn’t be uploaded.';
    }
  }
  if (status === 502) {
    return 'We couldn’t finish processing this PDF. Delete it and try again.';
  }
  if (status === 503) {
    return 'Document processing is unavailable right now. Try again later.';
  }
  return SERVER_MESSAGE;
}
