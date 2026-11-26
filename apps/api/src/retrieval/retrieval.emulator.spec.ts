import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { DocumentRepository } from '../documents/document.repository';
import { Embedder } from '../embeddings/embedder';
import { RetrievalService } from './retrieval.service';

const onEmulators = Boolean(
  process.env['FIRESTORE_EMULATOR_HOST'] &&
  process.env['FIREBASE_STORAGE_EMULATOR_HOST'],
);

/** Maps known questions to fixed vectors so the expected nearest chunk is deterministic. */
class LookupEmbedder extends Embedder {
  readonly dimensions = 3;
  async embed(texts: string[]) {
    return texts.map((t) => (t.includes('refund') ? [1, 0, 0] : [0, 1, 0]));
  }
}

/** Runs only on the Firestore + Storage emulators (see document.repository.emulator.spec.ts). */
// Emulator round-trips are slower than unit tests, especially in parallel.
describe.skipIf(!onEmulators)(
  'RetrievalService (emulators)',
  { timeout: 30_000 },
  () => {
    let app: App;
    let repository: DocumentRepository;
    let retrieval: RetrievalService;
    const uid = `retrieval-user-${Date.now()}`;

    beforeAll(() => {
      app = initializeApp(
        {
          projectId: 'ai-doc-chatbot-demo',
          storageBucket: 'ai-doc-chatbot-demo.firebasestorage.app',
        },
        `retrieval-spec-${Date.now()}`,
      );
      const db = getFirestore(app);
      repository = new DocumentRepository(db, getStorage(app).bucket());
      retrieval = new RetrievalService(db, new LookupEmbedder(), repository);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    async function addDoc(
      owner: string,
      status: 'ready' | 'processing',
      chunks: [string, number[]][],
    ) {
      const id = repository.newId(owner);
      await repository.create(owner, id, {
        name: `${status}.pdf`,
        sizeBytes: 1,
        status,
        pageCount: chunks.length,
        chunkCount: chunks.length,
        createdAt: new Date().toISOString(),
        storagePath: repository.storagePath(owner, id),
      });
      await repository.saveChunks(
        owner,
        id,
        chunks.map(([text], i) => ({ page: i + 1, index: i, text })),
        chunks.map(([, v]) => v),
      );
      return id;
    }

    it('returns the nearest ready chunks of this user only', async () => {
      const ready = await addDoc(uid, 'ready', [
        ['Refunds are issued within 14 days.', [0.95, 0.05, 0]],
        ['Shipping takes 3 days.', [0, 1, 0]],
      ]);
      await addDoc(uid, 'processing', [['Refund draft text.', [1, 0, 0]]]);
      await addDoc(`${uid}-other`, 'ready', [
        ['Another user refund.', [1, 0, 0]],
      ]);

      const result = await retrieval.retrieve(uid, 'How do refunds work?', {
        topK: 2,
      });

      expect(result.map((r) => r.text)).toEqual([
        'Refunds are issued within 14 days.',
        'Shipping takes 3 days.',
      ]);
      expect(result[0]).toMatchObject({
        documentId: ready,
        documentName: 'ready.pdf',
        page: 1,
      });
      expect(result[0].distance).toBeLessThan(result[1].distance);
    });

    it('searches only the chosen document when scoped', async () => {
      const owner = `${uid}-scoped`;
      await addDoc(owner, 'ready', [
        ['Refunds from the closest document.', [1, 0, 0]],
      ]);
      const chosen = await addDoc(owner, 'ready', [
        ['Refunds in the chosen document.', [0.8, 0.2, 0]],
        ['Shipping in the chosen document.', [0, 1, 0]],
      ]);

      const result = await retrieval.retrieve(owner, 'How do refunds work?', {
        documentId: chosen,
      });

      expect(result.map((r) => r.text)).toEqual([
        'Refunds in the chosen document.',
        'Shipping in the chosen document.',
      ]);
      expect(result.every((r) => r.documentId === chosen)).toBe(true);
    });

    it('rejects a scoped search of another user’s or a processing document', async () => {
      const owner = `${uid}-scope-checks`;
      const processing = await addDoc(owner, 'processing', [
        ['Refund draft.', [1, 0, 0]],
      ]);
      const others = await addDoc(`${owner}-other`, 'ready', [
        ['Other refund.', [1, 0, 0]],
      ]);
      await expect(
        retrieval.retrieve(owner, 'refund?', { documentId: others }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        retrieval.retrieve(owner, 'refund?', { documentId: processing }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  },
);
