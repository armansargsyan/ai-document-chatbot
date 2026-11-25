import { Inject, Injectable } from '@nestjs/common';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  PDF_MIME_TYPE,
  type DocumentStatus,
  type DocumentSummary,
} from '@ai-document-chatbot/shared';
import {
  FIRESTORE,
  STORAGE_BUCKET,
  type StorageBucket,
} from '../firebase/firebase.module';
import type { TextChunk } from './chunking';

/** Firestore shape of `users/{uid}/documents/{id}`. */
export interface DocumentRecord {
  name: string;
  sizeBytes: number;
  status: DocumentStatus;
  pageCount: number;
  chunkCount: number | null;
  createdAt: string;
  storagePath: string;
}

/** Collection group queried by retrieval (#6); `uid` scopes vector search to one user. */
export const CHUNKS_COLLECTION = 'chunks';
/** Chunks per batch: ~400 × (1536-dim vector + text) stays well under the 10 MiB request limit. */
const WRITE_BATCH_SIZE = 400;

/**
 * Persistence for documents and their chunks:
 * - metadata: `users/{uid}/documents/{id}`
 * - chunks:   `users/{uid}/documents/{id}/chunks/{index}` (with `uid`, `embedding` vector)
 * - file:     `users/{uid}/documents/{id}.pdf` in the default bucket
 */
@Injectable()
export class DocumentRepository {
  constructor(
    @Inject(FIRESTORE) private readonly db: Firestore,
    @Inject(STORAGE_BUCKET) private readonly bucket: StorageBucket,
  ) {}

  private documents(uid: string) {
    return this.db.collection('users').doc(uid).collection('documents');
  }

  newId(uid: string): string {
    return this.documents(uid).doc().id;
  }

  storagePath(uid: string, id: string): string {
    return `users/${uid}/documents/${id}.pdf`;
  }

  async create(uid: string, id: string, record: DocumentRecord): Promise<void> {
    await this.documents(uid).doc(id).create(record);
  }

  async update(
    uid: string,
    id: string,
    patch: Partial<Pick<DocumentRecord, 'status' | 'chunkCount'>>,
  ): Promise<void> {
    await this.documents(uid).doc(id).update(patch);
  }

  async get(uid: string, id: string): Promise<DocumentRecord | null> {
    const snapshot = await this.documents(uid).doc(id).get();
    return snapshot.exists ? (snapshot.data() as DocumentRecord) : null;
  }

  async list(uid: string): Promise<(DocumentRecord & { id: string })[]> {
    const snapshot = await this.documents(uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as DocumentRecord),
    }));
  }

  async saveFile(path: string, data: Uint8Array): Promise<void> {
    await this.bucket.file(path).save(Buffer.from(data), {
      contentType: PDF_MIME_TYPE,
      resumable: false,
    });
  }

  async saveChunks(
    uid: string,
    documentId: string,
    chunks: TextChunk[],
    embeddings: number[][],
  ): Promise<void> {
    const collection = this.documents(uid)
      .doc(documentId)
      .collection(CHUNKS_COLLECTION);
    for (let i = 0; i < chunks.length; i += WRITE_BATCH_SIZE) {
      const batch = this.db.batch();
      chunks.slice(i, i + WRITE_BATCH_SIZE).forEach((chunk, offset) => {
        batch.set(collection.doc(String(chunk.index).padStart(5, '0')), {
          uid,
          documentId,
          page: chunk.page,
          index: chunk.index,
          text: chunk.text,
          embedding: FieldValue.vector(embeddings[i + offset]),
        });
      });
      await batch.commit();
    }
  }

  /** Deletes all chunks of a document (e.g. after a failed ingestion). */
  async deleteChunks(uid: string, id: string): Promise<void> {
    await this.db.recursiveDelete(
      this.documents(uid).doc(id).collection(CHUNKS_COLLECTION),
    );
  }

  /** Deletes the file, every chunk and the metadata document. Idempotent. */
  async delete(uid: string, id: string): Promise<void> {
    await this.bucket
      .file(this.storagePath(uid, id))
      .delete({ ignoreNotFound: true });
    await this.db.recursiveDelete(this.documents(uid).doc(id));
  }
}

export function toSummary(id: string, record: DocumentRecord): DocumentSummary {
  return {
    id,
    name: record.name,
    sizeBytes: record.sizeBytes,
    status: record.status,
    pageCount: record.pageCount,
    chunkCount: record.chunkCount,
    createdAt: record.createdAt,
  };
}
