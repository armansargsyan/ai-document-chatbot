import { Inject, Injectable } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import {
  documentsCollection,
  type DocumentRecord,
} from '../documents/document.repository';
import { FIRESTORE } from '../firebase/firebase.module';

/** Firestore shape of `users/{uid}/meta/usage` (missing doc = nothing used yet). */
export interface UsageRecord {
  uploadsUsed: number;
  questionsUsed: number;
  updatedAt?: string;
}

export type UsageCounterField = 'uploadsUsed' | 'questionsUsed';

export type UploadReservation =
  'reserved' | 'document_limit_reached' | 'upload_limit_reached';

export interface UploadLimits {
  maxDocuments: number;
  maxUploads: number;
}

function toUsage(data: unknown): UsageRecord {
  const record = (data ?? {}) as Partial<UsageRecord>;
  const count = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  return {
    uploadsUsed: count(record.uploadsUsed),
    questionsUsed: count(record.questionsUsed),
  };
}

/**
 * Lifetime usage counters in `users/{uid}/meta/usage`. Every check-and-charge
 * runs in a Firestore transaction, so concurrent requests serialize on the
 * usage doc and can never take the counters past their limits.
 *
 * The document limit is safe too: every upload writes the usage doc in the
 * same transaction that counts and creates documents, so two uploads racing
 * for the last slot conflict on it and the loser retries with the new count.
 * Deletes only lower the count, so they need no coordination.
 */
@Injectable()
export class UsageRepository {
  constructor(@Inject(FIRESTORE) private readonly db: Firestore) {}

  private usageRef(uid: string) {
    return this.db.collection('users').doc(uid).collection('meta').doc('usage');
  }

  async read(uid: string): Promise<{ usage: UsageRecord; documents: number }> {
    const [snapshot, count] = await Promise.all([
      this.usageRef(uid).get(),
      documentsCollection(this.db, uid).count().get(),
    ]);
    return { usage: toUsage(snapshot.data()), documents: count.data().count };
  }

  /**
   * Atomically: checks the upload quota, then the number of documents (any
   * status), then charges one upload and creates the document record.
   */
  reserveUpload(
    uid: string,
    documentId: string,
    record: DocumentRecord,
    limits: UploadLimits,
  ): Promise<UploadReservation> {
    const ref = this.usageRef(uid);
    const documents = documentsCollection(this.db, uid);
    return this.db.runTransaction(async (tx) => {
      const [snapshot, count] = await Promise.all([
        tx.get(ref),
        tx.get(documents.count()),
      ]);
      const usage = toUsage(snapshot.data());
      // Uploads first: when none are left, deleting a document would not help.
      if (usage.uploadsUsed >= limits.maxUploads) return 'upload_limit_reached';
      if (count.data().count >= limits.maxDocuments) {
        return 'document_limit_reached';
      }
      tx.set(
        ref,
        {
          ...usage,
          uploadsUsed: usage.uploadsUsed + 1,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      tx.create(documents.doc(documentId), record);
      return 'reserved';
    });
  }

  /** Atomically charges one question unless `max` are used; false when none are left. */
  reserveQuestion(uid: string, max: number): Promise<boolean> {
    const ref = this.usageRef(uid);
    return this.db.runTransaction(async (tx) => {
      const usage = toUsage((await tx.get(ref)).data());
      if (usage.questionsUsed >= max) return false;
      tx.set(
        ref,
        {
          ...usage,
          questionsUsed: usage.questionsUsed + 1,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
      return true;
    });
  }

  /** Gives one back (never below zero). */
  refund(uid: string, field: UsageCounterField): Promise<void> {
    const ref = this.usageRef(uid);
    return this.db.runTransaction(async (tx) => {
      const usage = toUsage((await tx.get(ref)).data());
      if (usage[field] <= 0) return;
      tx.set(
        ref,
        {
          ...usage,
          [field]: usage[field] - 1,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    });
  }
}
