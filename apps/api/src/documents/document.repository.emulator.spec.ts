import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { CHUNKS_COLLECTION, DocumentRepository } from './document.repository';

const onEmulators = Boolean(
  process.env['FIRESTORE_EMULATOR_HOST'] &&
  process.env['FIREBASE_STORAGE_EMULATOR_HOST'],
);

/**
 * Runs only against the local Firestore + Storage emulators:
 *   firebase emulators:exec --only firestore,storage "npx nx test api"
 * Skipped in a normal `nx test` run (no network, no emulators).
 */
// Emulator round-trips are slower than unit tests, especially in parallel.
describe.skipIf(!onEmulators)(
  'DocumentRepository (emulators)',
  { timeout: 30_000 },
  () => {
    let app: App;
    let db: Firestore;
    let repository: DocumentRepository;
    const uid = `emulator-user-${Date.now()}`;
    const otherUid = `${uid}-other`;

    beforeAll(() => {
      app = initializeApp(
        {
          projectId: 'ai-doc-chatbot-demo',
          storageBucket: 'ai-doc-chatbot-demo.firebasestorage.app',
        },
        `emulator-spec-${Date.now()}`,
      );
      db = getFirestore(app);
      repository = new DocumentRepository(db, getStorage(app).bucket());
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    async function addDocument(owner: string, vector: number[]) {
      const id = repository.newId(owner);
      const storagePath = repository.storagePath(owner, id);
      await repository.create(owner, id, {
        name: 'a.pdf',
        sizeBytes: 3,
        status: 'processing',
        pageCount: 1,
        chunkCount: null,
        createdAt: new Date().toISOString(),
        storagePath,
      });
      await repository.saveFile(storagePath, Buffer.from('%PDF-'));
      await repository.saveChunks(
        owner,
        id,
        [{ page: 1, index: 0, text: 'hello' }],
        [vector],
      );
      await repository.update(owner, id, { status: 'ready', chunkCount: 1 });
      return { id, storagePath };
    }

    it('stores, lists, searches per user and deletes everything', async () => {
      const mine = await addDocument(uid, [1, 0, 0]);
      await addDocument(otherUid, [1, 0, 0]);

      expect((await repository.get(uid, mine.id))?.status).toBe('ready');
      expect((await repository.list(uid)).map((d) => d.id)).toEqual([mine.id]);

      // Vector search scoped to one user, as retrieval (#6) will run it.
      const nearest = await db
        .collectionGroup(CHUNKS_COLLECTION)
        .where('uid', '==', uid)
        .findNearest({
          vectorField: 'embedding',
          queryVector: [0.9, 0.1, 0],
          limit: 5,
          distanceMeasure: 'COSINE',
        })
        .get();
      expect(nearest.docs.map((d) => d.get('uid'))).toEqual([uid]);
      expect(nearest.docs[0].get('page')).toBe(1);

      const [exists] = await getStorage(app)
        .bucket()
        .file(mine.storagePath)
        .exists();
      expect(exists).toBe(true);

      await repository.delete(uid, mine.id);
      expect(await repository.get(uid, mine.id)).toBeNull();
      const chunks = await db
        .collection(`users/${uid}/documents/${mine.id}/${CHUNKS_COLLECTION}`)
        .get();
      expect(chunks.empty).toBe(true);
      const [stillExists] = await getStorage(app)
        .bucket()
        .file(mine.storagePath)
        .exists();
      expect(stillExists).toBe(false);

      // Deleting again is a no-op.
      await expect(repository.delete(uid, mine.id)).resolves.toBeUndefined();
    });

    it('deleteChunks removes only the chunks', async () => {
      const doc = await addDocument(uid, [0, 1, 0]);
      await repository.deleteChunks(uid, doc.id);
      const chunks = await db
        .collection(`users/${uid}/documents/${doc.id}/${CHUNKS_COLLECTION}`)
        .get();
      expect(chunks.empty).toBe(true);
      expect(await repository.get(uid, doc.id)).not.toBeNull();
      await repository.delete(uid, doc.id);
    });
  },
);
