import { Injectable, inject } from '@angular/core';
import { HttpClient, type HttpEvent } from '@angular/common/http';
import type { Observable } from 'rxjs';
import type { DocumentSummary } from '@ai-document-chatbot/shared';

export const DOCUMENTS_URL = '/api/documents';

/** Mutations for `/api/documents`. The list is read with `httpResource` in the page. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi {
  private readonly http = inject(HttpClient);

  /**
   * Multipart upload (field `file`). Emits upload progress, then the response
   * once the server has finished extracting and indexing (can take a while).
   */
  upload(file: File): Observable<HttpEvent<DocumentSummary>> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<DocumentSummary>(DOCUMENTS_URL, body, {
      observe: 'events',
      reportUploadProgress: true,
    });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${DOCUMENTS_URL}/${encodeURIComponent(id)}`);
  }
}
