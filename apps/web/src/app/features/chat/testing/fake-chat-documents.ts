import { signal } from '@angular/core';
import type { DocumentSummary } from '@ai-document-chatbot/shared';
import type { ChatDocuments } from '../chat-documents';

export const LEASE: DocumentSummary = {
  id: 'doc-lease',
  name: 'Lease.pdf',
  sizeBytes: 1000,
  status: 'ready',
  pageCount: 12,
  chunkCount: 30,
  createdAt: '2026-11-24T10:00:00.000Z',
};

export const RULES: DocumentSummary = {
  ...LEASE,
  id: 'doc-rules',
  name: 'House rules.pdf',
  createdAt: '2026-11-20T10:00:00.000Z',
};

/** Stand-in for the page's {@link ChatDocuments}: the ready list is set directly. */
export class FakeChatDocuments implements Pick<
  ChatDocuments,
  'ready' | 'find' | 'reload'
> {
  readonly ready = signal<readonly DocumentSummary[]>([LEASE, RULES]);
  /** Times {@link reload} was called. */
  reloads = 0;

  reload(): void {
    this.reloads++;
  }

  find(id: string | null | undefined): DocumentSummary | null {
    return id ? (this.ready().find((d) => d.id === id) ?? null) : null;
  }
}
