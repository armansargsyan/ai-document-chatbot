import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
  ConversationGoneError,
  ConversationRepository,
} from './conversation.repository';

const onEmulators = Boolean(process.env['FIRESTORE_EMULATOR_HOST']);

/** Runs only on the Firestore emulator (see document.repository.emulator.spec.ts). */
describe.skipIf(!onEmulators)(
  'ConversationRepository (emulators)',
  { timeout: 30_000 },
  () => {
    let app: App;
    let repository: ConversationRepository;
    const uid = `conv-user-${Date.now()}`;

    beforeAll(() => {
      app = initializeApp(
        { projectId: 'ai-doc-chatbot-demo' },
        `conv-spec-${Date.now()}`,
      );
      repository = new ConversationRepository(getFirestore(app));
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    const at = (minute: number) =>
      new Date(Date.UTC(2026, 10, 25, 10, minute)).toISOString();

    it('stores messages in order, tracks counts, scopes by user and deletes recursively', async () => {
      const older = repository.newId(uid);
      const newer = repository.newId(uid);
      for (const [id, minute] of [
        [older, 0],
        [newer, 1],
      ] as const) {
        await repository.create(uid, id, {
          title: id,
          createdAt: at(minute),
          updatedAt: at(minute),
          messageCount: 0,
        });
      }
      await repository.addMessage(uid, older, {
        role: 'user',
        content: 'Q1',
        createdAt: at(5),
        modelId: null,
        citations: [],
      });
      await repository.addMessage(uid, older, {
        role: 'assistant',
        content: 'A1',
        createdAt: at(6),
        modelId: 'claude-haiku-5-5',
        citations: [
          {
            number: 1,
            documentId: 'd',
            documentName: 'D.pdf',
            page: 2,
            snippet: 's',
          },
        ],
      });

      // Activity moves `older` to the top of the list and counts its messages.
      const list = await repository.list(uid);
      expect(list.map((c) => c.id)).toEqual([older, newer]);
      expect(list[0]).toMatchObject({ updatedAt: at(6), messageCount: 2 });

      const messages = await repository.listMessages(uid, older);
      expect(messages.map((m) => m.content)).toEqual(['Q1', 'A1']);
      expect(messages[1]).toMatchObject({
        modelId: 'claude-haiku-5-5',
        citations: [{ page: 2 }],
      });
      expect(
        (await repository.recentMessages(uid, older, 1)).map((m) => m.content),
      ).toEqual(['A1']);

      await repository.rename(uid, older, 'Renamed');
      expect((await repository.get(uid, older))?.title).toBe('Renamed');

      // Another user sees nothing.
      expect(await repository.list(`${uid}-other`)).toEqual([]);
      expect(await repository.get(`${uid}-other`, older)).toBeNull();

      await repository.delete(uid, older);
      expect(await repository.get(uid, older)).toBeNull();
      expect(await repository.listMessages(uid, older)).toEqual([]);
      await repository.delete(uid, newer);
    });

    it('createWithMessage stores the conversation and first message together', async () => {
      const id = repository.newId(uid);
      await repository.createWithMessage(
        uid,
        id,
        {
          title: 'First',
          createdAt: at(10),
          updatedAt: at(10),
          messageCount: 1,
        },
        {
          role: 'user',
          content: 'Hello',
          createdAt: at(10),
          modelId: null,
          citations: [],
        },
      );
      expect((await repository.get(uid, id))?.messageCount).toBe(1);
      expect(
        (await repository.listMessages(uid, id)).map((m) => m.content),
      ).toEqual(['Hello']);
      await repository.delete(uid, id);
    });

    it('reports a write to a deleted conversation as ConversationGoneError', async () => {
      const id = repository.newId(uid);
      await expect(repository.rename(uid, id, 'x')).rejects.toBeInstanceOf(
        ConversationGoneError,
      );
      await expect(
        repository.addMessage(uid, id, {
          role: 'user',
          content: 'late',
          createdAt: at(20),
          modelId: null,
          citations: [],
        }),
      ).rejects.toBeInstanceOf(ConversationGoneError);
    });
  },
);
