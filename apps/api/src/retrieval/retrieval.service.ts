import { Inject, Injectable } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import {
  CHUNKS_COLLECTION,
  DocumentRepository,
  type DocumentRecord,
} from '../documents/document.repository';
import { chatConflict, chatNotFound } from '../common/chat-errors';
import { Embedder } from '../embeddings/embedder';
import { FIRESTORE } from '../firebase/firebase.module';

export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  /** Upload time of the source document (ISO 8601). */
  documentCreatedAt: string;
  page: number;
  text: string;
  /** Cosine distance (0 = identical). */
  distance: number;
}

export interface RetrieveOptions {
  /** Search only this document; it must exist for this user and be `ready`. */
  documentId?: string;
  topK?: number;
}

/** Chunks fetched from the vector index before dropping non-ready documents. */
const CANDIDATES = 12;
export const DEFAULT_TOP_K = 6;

/**
 * Throws unless the record is a searchable document: 404 when it doesn't
 * exist (or isn't the caller's — the lookup is per user), 409 when it is
 * still processing or failed. No paid call happens before this check.
 */
export function assertSearchable<T extends Pick<DocumentRecord, 'status'>>(
  record: T | null | undefined,
): asserts record is T {
  if (!record) throw chatNotFound('Document not found', 'document_not_found');
  if (record.status === 'processing') {
    throw chatConflict(
      "That document isn't ready yet; try again once it has finished processing",
      'document_not_ready',
    );
  }
  if (record.status !== 'ready') {
    throw chatConflict(
      "That document couldn't be processed; delete it and upload it again",
      'document_not_ready',
    );
  }
}

/** Finds the user's most relevant chunks for a question (vector search). */
@Injectable()
export class RetrievalService {
  constructor(
    @Inject(FIRESTORE) private readonly db: Firestore,
    @Inject(Embedder) private readonly embedder: Embedder | null,
    private readonly documents: DocumentRepository,
  ) {}

  get available(): boolean {
    return this.embedder !== null;
  }

  /**
   * Searches only chunks with this `uid`, and only from documents that are
   * `ready` (never a failed or still-processing upload). With `documentId`,
   * searches that one document, after checking it (404/409) and before
   * embedding the question.
   */
  async retrieve(
    uid: string,
    question: string,
    { documentId, topK = DEFAULT_TOP_K }: RetrieveOptions = {},
  ): Promise<RetrievedChunk[]> {
    if (!this.embedder) throw new Error('No embedder configured');

    const known = new Map<string, DocumentRecord | null>();
    if (documentId !== undefined) {
      const record = await this.documents.get(uid, documentId);
      assertSearchable(record);
      known.set(documentId, record);
    }

    const [queryVector] = await this.embedder.embed([question]);

    let query = this.db
      .collectionGroup(CHUNKS_COLLECTION)
      .where('uid', '==', uid);
    if (documentId !== undefined) {
      query = query.where('documentId', '==', documentId);
    }
    const snapshot = await query
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: Math.max(CANDIDATES, topK),
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance',
      })
      .get();

    // Keep only chunks of ready documents (one lookup per document; the scoped one is known).
    const docIds = [
      ...new Set(snapshot.docs.map((d) => d.get('documentId') as string)),
    ];
    await Promise.all(
      docIds
        .filter((id) => !known.has(id))
        .map(async (id) => known.set(id, await this.documents.get(uid, id))),
    );
    const ready = new Map(
      docIds.flatMap((id) => {
        const record = known.get(id);
        return record?.status === 'ready' ? [[id, record] as const] : [];
      }),
    );

    return snapshot.docs
      .filter((d) => ready.has(d.get('documentId')))
      .slice(0, topK)
      .map((d) => {
        const record = ready.get(d.get('documentId'));
        return {
          documentId: d.get('documentId'),
          documentName: record?.name ?? '',
          documentCreatedAt: record?.createdAt ?? '',
          page: d.get('page'),
          text: d.get('text'),
          distance: d.get('distance'),
        };
      });
  }
}
