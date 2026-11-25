import { Inject, Injectable } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import {
  CHUNKS_COLLECTION,
  DocumentRepository,
} from '../documents/document.repository';
import { Embedder } from '../embeddings/embedder';
import { FIRESTORE } from '../firebase/firebase.module';

export interface RetrievedChunk {
  documentId: string;
  documentName: string;
  page: number;
  text: string;
  /** Cosine distance (0 = identical). */
  distance: number;
}

/** Chunks fetched from the vector index before dropping non-ready documents. */
const CANDIDATES = 12;
export const DEFAULT_TOP_K = 6;

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
   * `ready` (never a failed or still-processing upload).
   */
  async retrieve(
    uid: string,
    question: string,
    topK = DEFAULT_TOP_K,
  ): Promise<RetrievedChunk[]> {
    if (!this.embedder) throw new Error('No embedder configured');
    const [queryVector] = await this.embedder.embed([question]);

    const snapshot = await this.db
      .collectionGroup(CHUNKS_COLLECTION)
      .where('uid', '==', uid)
      .findNearest({
        vectorField: 'embedding',
        queryVector,
        limit: Math.max(CANDIDATES, topK),
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance',
      })
      .get();

    const docIds = [
      ...new Set(snapshot.docs.map((d) => d.get('documentId') as string)),
    ];
    const records = await Promise.all(
      docIds.map((id) => this.documents.get(uid, id)),
    );
    const ready = new Map(
      docIds.flatMap((id, i) => {
        const record = records[i];
        return record?.status === 'ready' ? [[id, record.name] as const] : [];
      }),
    );

    return snapshot.docs
      .filter((d) => ready.has(d.get('documentId')))
      .slice(0, topK)
      .map((d) => ({
        documentId: d.get('documentId'),
        documentName: ready.get(d.get('documentId')) ?? '',
        page: d.get('page'),
        text: d.get('text'),
        distance: d.get('distance'),
      }));
  }
}
