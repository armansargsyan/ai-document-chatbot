import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Firestore } from 'firebase-admin/firestore';
import type {
  DocumentRecord,
  DocumentRepository,
} from '../documents/document.repository';
import { Embedder } from '../embeddings/embedder';
import { RetrievalService } from './retrieval.service';

class FakeEmbedder extends Embedder {
  readonly dimensions = 3;
  embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]));
}

type Hit = { documentId: string; page: number; text: string; distance: number };

/** Fake Firestore query chain: collectionGroup().where().findNearest().get(). */
function fakeDb(hits: Hit[]) {
  const calls: Record<string, unknown[]> = { where: [] };
  const query = {
    where: vi.fn((...args: unknown[]) => (calls.where.push(args), query)),
    findNearest: vi.fn(
      (options: unknown) => ((calls.findNearest = [options]), query),
    ),
    get: vi.fn(async () => ({
      docs: hits.map((hit) => ({ get: (field: keyof Hit) => hit[field] })),
    })),
  };
  const db = {
    collectionGroup: vi.fn(
      (name: string) => ((calls.collectionGroup = [name]), query),
    ),
  };
  return { db: db as unknown as Firestore, calls };
}

function repo(records: Record<string, Partial<DocumentRecord> | null>) {
  return {
    get: vi.fn(
      async (_uid: string, id: string) =>
        (records[id] ?? null) as DocumentRecord | null,
    ),
  } as unknown as DocumentRepository;
}

const hit = (documentId: string, page = 1, distance = 0.1): Hit => ({
  documentId,
  page,
  text: `text from ${documentId} p${page}`,
  distance,
});

describe('RetrievalService', () => {
  it('embeds the question and searches only this user’s chunks', async () => {
    const { db, calls } = fakeDb([hit('a')]);
    const embedder = new FakeEmbedder();
    const service = new RetrievalService(
      db,
      embedder,
      repo({
        a: {
          status: 'ready',
          name: 'A.pdf',
          createdAt: '2026-11-20T10:00:00.000Z',
        },
      }),
    );

    const result = await service.retrieve('user-1', 'question?');

    expect(embedder.embed).toHaveBeenCalledWith(['question?']);
    expect(calls.collectionGroup).toEqual(['chunks']);
    expect(calls.where).toEqual([['uid', '==', 'user-1']]);
    expect(calls.findNearest).toEqual([
      expect.objectContaining({
        vectorField: 'embedding',
        queryVector: [0.1, 0.2, 0.3],
        distanceMeasure: 'COSINE',
        distanceResultField: 'distance',
      }),
    ]);
    expect(result).toEqual([
      {
        documentId: 'a',
        documentName: 'A.pdf',
        documentCreatedAt: '2026-11-20T10:00:00.000Z',
        page: 1,
        text: 'text from a p1',
        distance: 0.1,
      },
    ]);
  });

  it('drops chunks from documents that are not ready or no longer exist', async () => {
    const { db } = fakeDb([
      hit('ready'),
      hit('processing'),
      hit('failed'),
      hit('gone'),
      hit('ready', 2),
    ]);
    const service = new RetrievalService(
      db,
      new FakeEmbedder(),
      repo({
        ready: { status: 'ready', name: 'R.pdf' },
        processing: { status: 'processing', name: 'P.pdf' },
        failed: { status: 'failed', name: 'F.pdf' },
        gone: null,
      }),
    );
    const result = await service.retrieve('user-1', 'q');
    expect(result.map((r) => `${r.documentId}:${r.page}`)).toEqual([
      'ready:1',
      'ready:2',
    ]);
  });

  it('returns at most topK chunks, in distance order', async () => {
    const hits = Array.from({ length: 10 }, (_, i) => hit('a', i + 1, i / 10));
    const { db } = fakeDb(hits);
    const service = new RetrievalService(
      db,
      new FakeEmbedder(),
      repo({ a: { status: 'ready', name: 'A.pdf' } }),
    );
    const result = await service.retrieve('user-1', 'q', { topK: 3 });
    expect(result.map((r) => r.page)).toEqual([1, 2, 3]);
  });

  describe('scoped to one document', () => {
    const DOC = 'abcdefghij0123456789';

    it('adds a documentId filter next to the uid prefilter', async () => {
      const { db, calls } = fakeDb([hit(DOC), hit(DOC, 2)]);
      const documents = repo({ [DOC]: { status: 'ready', name: 'D.pdf' } });
      const service = new RetrievalService(db, new FakeEmbedder(), documents);

      const result = await service.retrieve('user-1', 'q', {
        documentId: DOC,
      });

      expect(calls.where).toEqual([
        ['uid', '==', 'user-1'],
        ['documentId', '==', DOC],
      ]);
      expect(documents.get).toHaveBeenCalledWith('user-1', DOC);
      // The checked record is reused for the ready filter.
      expect(documents.get).toHaveBeenCalledTimes(1);
      expect(result.map((r) => r.documentName)).toEqual(['D.pdf', 'D.pdf']);
    });

    it.each([
      [
        'an unknown (or another user’s) document',
        null,
        NotFoundException,
        'document_not_found',
      ],
      [
        'a processing document',
        { status: 'processing' },
        ConflictException,
        'document_not_ready',
      ],
      [
        'a failed document',
        { status: 'failed' },
        ConflictException,
        'document_not_ready',
      ],
    ] as const)(
      'rejects %s before embedding the question',
      async (_label, record, expected, code) => {
        const { db } = fakeDb([hit(DOC)]);
        const embedder = new FakeEmbedder();
        const service = new RetrievalService(
          db,
          embedder,
          repo({ [DOC]: record as Partial<DocumentRecord> | null }),
        );
        await expect(
          service.retrieve('user-1', 'q', { documentId: DOC }),
        ).rejects.toBeInstanceOf(expected);
        const error = await service
          .retrieve('user-1', 'q', { documentId: DOC })
          .catch((e: unknown) => e as NotFoundException | ConflictException);
        expect(error.getResponse()).toMatchObject({
          statusCode: expected === NotFoundException ? 404 : 409,
          code,
        });
        expect(embedder.embed).not.toHaveBeenCalled();
        expect(db.collectionGroup).not.toHaveBeenCalled();
      },
    );

    it('uses a friendly message for a document that is not ready', async () => {
      const service = new RetrievalService(
        fakeDb([]).db,
        new FakeEmbedder(),
        repo({ [DOC]: { status: 'processing' } }),
      );
      await expect(
        service.retrieve('user-1', 'q', { documentId: DOC }),
      ).rejects.toThrow("That document isn't ready yet");
    });
  });

  it('reports unavailable without an embedder', async () => {
    const { db } = fakeDb([]);
    const service = new RetrievalService(db, null, repo({}));
    expect(service.available).toBe(false);
    await expect(service.retrieve('u', 'q')).rejects.toThrow();
  });
});
