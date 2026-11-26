import { Injectable, computed } from '@angular/core';
import { httpResource } from '@angular/common/http';
import type {
  DocumentSummary,
  ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { DOCUMENTS_URL } from '../documents/documents-api';

/** A chat turn limited to one document (`ChatRequest.documentId`). */
export interface DocumentScope {
  readonly id: string;
  /** For the "Searched:" label; the name when the turn was sent. */
  readonly name: string;
}

/**
 * The user's documents from `GET /api/documents`, for the empty state and the
 * "Search in" picker. Page-scoped, like the model list.
 */
@Injectable()
export class ChatDocuments {
  readonly resource = httpResource<ListDocumentsResponse>(() => DOCUMENTS_URL);

  /** Searchable documents, newest first. Empty until loaded. */
  readonly ready = computed<readonly DocumentSummary[]>(() =>
    this.resource.hasValue()
      ? this.resource
          .value()
          .documents.filter((d) => d.status === 'ready')
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      : [],
  );

  /** Loaded and none is ready to search: point to the documents page. */
  readonly needsDocuments = computed(
    () => this.resource.hasValue() && this.ready().length === 0,
  );

  find(id: string | null | undefined): DocumentSummary | null {
    return id ? (this.ready().find((d) => d.id === id) ?? null) : null;
  }

  reload(): void {
    this.resource.reload();
  }
}
