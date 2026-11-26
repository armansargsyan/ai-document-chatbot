import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_LIMITS } from '@ai-document-chatbot/shared';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { DocumentRecord } from '../documents/document.repository';
import { UsageRepository } from './usage.repository';

const onEmulators = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);

const record: DocumentRecord = {
  name: 'a.pdf',
  sizeBytes: 1,
  status: 'processing',
  pageCount: 1,
  chunkCount: null,
  createdAt: '2026-11-26T00:00:00.000Z',
  storagePath: 'p',
};

/** Real Firestore transactions on the emulator (see document.repository.emulator.spec.ts). */
describe.skipIf(!onEmulators)(
  'UsageRepository (emulators)',
  { timeout: 60_000 },
  () => {
    let app: App;
    let db: Firestore;
    let repository: UsageRepository;
    const run = Date.now();
    let n = 0;
    const freshUid = () => `usage-user-${run}-${n++}`;

    beforeAll(() => {
      app = initializeApp(
        { projectId: 'ai-doc-chatbot-demo' },
        `usage-spec-${run}`,
      );
      db = getFirestore(app);
      repository = new UsageRepository(db);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it('stores counters at users/{uid}/meta/usage and reads the document count', async () => {
      const uid = freshUid();
      const id = db.collection('x').doc().id;
      expect(await repository.reserveUpload(uid, id, record, DEMO_LIMITS)).toBe(
        'reserved',
      );
      expect(await repository.reserveQuestion(uid, 30)).toBe(true);
      const usage = await db.doc(`users/${uid}/meta/usage`).get();
      expect(usage.data()).toMatchObject({ uploadsUsed: 1, questionsUsed: 1 });
      expect((await db.doc(`users/${uid}/documents/${id}`).get()).exists).toBe(
        true,
      );
      expect(await repository.read(uid)).toEqual({
        usage: { uploadsUsed: 1, questionsUsed: 1 },
        documents: 1,
      });
      await repository.refund(uid, 'questionsUsed');
      expect((await repository.read(uid)).usage.questionsUsed).toBe(0);
    });

    it('never exceeds the question limit under concurrent requests', async () => {
      const uid = freshUid();
      await db
        .doc(`users/${uid}/meta/usage`)
        .set({ uploadsUsed: 0, questionsUsed: 26 });
      const results = await Promise.all(
        Array.from({ length: 10 }, () => repository.reserveQuestion(uid, 30)),
      );
      expect(results.filter(Boolean)).toHaveLength(4);
      expect((await repository.read(uid)).usage.questionsUsed).toBe(30);
    });

    it('never creates more than maxDocuments under concurrent uploads', async () => {
      const uid = freshUid();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          repository.reserveUpload(
            uid,
            db.collection('x').doc().id,
            record,
            DEMO_LIMITS,
          ),
        ),
      );
      expect(results.filter((r) => r === 'reserved')).toHaveLength(3);
      expect(
        (await db.collection(`users/${uid}/documents`).count().get()).data()
          .count,
      ).toBe(3);
      expect((await repository.read(uid)).usage.uploadsUsed).toBe(3);
    });
  },
);
