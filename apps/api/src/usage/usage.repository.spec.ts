import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_LIMITS } from '@ai-document-chatbot/shared';
import type { DocumentRecord } from '../documents/document.repository';
import { FakeFirestore } from './testing/fake-firestore';
import { UsageRepository } from './usage.repository';

const UID = 'user-1';
const USAGE = `users/${UID}/meta/usage`;

const record = (name = 'a.pdf'): DocumentRecord => ({
  name,
  sizeBytes: 1,
  status: 'processing',
  pageCount: 1,
  chunkCount: null,
  createdAt: '2026-11-26T00:00:00.000Z',
  storagePath: 'p',
});

describe('UsageRepository (fake Firestore)', () => {
  let db: FakeFirestore;
  let repository: UsageRepository;
  let ids = 0;
  const nextId = () => `doc${String(ids++).padStart(17, '0')}`;

  beforeEach(() => {
    db = new FakeFirestore();
    repository = new UsageRepository(db.asFirestore());
  });

  it('reads zero usage for a new user', async () => {
    expect(await repository.read(UID)).toEqual({
      usage: { uploadsUsed: 0, questionsUsed: 0 },
      documents: 0,
    });
  });

  it('charges an upload and creates the record in one transaction', async () => {
    const id = nextId();
    expect(await repository.reserveUpload(UID, id, record(), DEMO_LIMITS)).toBe(
      'reserved',
    );
    expect(db.docs.get(`users/${UID}/documents/${id}`)).toMatchObject({
      name: 'a.pdf',
      status: 'processing',
    });
    expect(db.docs.get(USAGE)).toMatchObject({ uploadsUsed: 1 });
    expect(await repository.read(UID)).toMatchObject({ documents: 1 });
  });

  it('refuses a 4th document (any status) without charging', async () => {
    for (let i = 0; i < 3; i++) {
      await repository.reserveUpload(UID, nextId(), record(), DEMO_LIMITS);
    }
    const id = nextId();
    expect(await repository.reserveUpload(UID, id, record(), DEMO_LIMITS)).toBe(
      'document_limit_reached',
    );
    expect(db.docs.has(`users/${UID}/documents/${id}`)).toBe(false);
    expect(db.docs.get(USAGE)).toMatchObject({ uploadsUsed: 3 });
  });

  it('refuses after 6 uploads even with free document slots', async () => {
    db.docs.set(USAGE, { uploadsUsed: 6, questionsUsed: 0 });
    expect(
      await repository.reserveUpload(UID, nextId(), record(), DEMO_LIMITS),
    ).toBe('upload_limit_reached');
    expect(db.childrenOf(`users/${UID}/documents`)).toHaveLength(0);
  });

  it('reports the upload limit first when both limits are hit', async () => {
    db.docs.set(USAGE, { uploadsUsed: 6, questionsUsed: 0 });
    for (let i = 0; i < 3; i++) {
      db.docs.set(`users/${UID}/documents/${nextId()}`, { ...record() });
    }
    expect(
      await repository.reserveUpload(UID, nextId(), record(), DEMO_LIMITS),
    ).toBe('upload_limit_reached');
  });

  it('charges questions up to the limit and keeps other fields', async () => {
    db.docs.set(USAGE, { uploadsUsed: 2, questionsUsed: 29 });
    expect(await repository.reserveQuestion(UID, 30)).toBe(true);
    expect(await repository.reserveQuestion(UID, 30)).toBe(false);
    expect(db.docs.get(USAGE)).toMatchObject({
      uploadsUsed: 2,
      questionsUsed: 30,
    });
  });

  it('refunds one, never below zero', async () => {
    db.docs.set(USAGE, { uploadsUsed: 1, questionsUsed: 1 });
    await repository.refund(UID, 'questionsUsed');
    await repository.refund(UID, 'questionsUsed');
    await repository.refund(UID, 'uploadsUsed');
    expect(db.docs.get(USAGE)).toMatchObject({
      uploadsUsed: 0,
      questionsUsed: 0,
    });
  });

  it('treats corrupt counters as zero', async () => {
    db.docs.set(USAGE, { uploadsUsed: 'lots', questionsUsed: -4 });
    expect((await repository.read(UID)).usage).toEqual({
      uploadsUsed: 0,
      questionsUsed: 0,
    });
  });

  describe('concurrency', () => {
    it('lets exactly the remaining questions through a burst of 20', async () => {
      db.docs.set(USAGE, { uploadsUsed: 0, questionsUsed: 25 });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => repository.reserveQuestion(UID, 30)),
      );
      expect(results.filter(Boolean)).toHaveLength(5);
      expect(db.docs.get(USAGE)).toMatchObject({ questionsUsed: 30 });
      expect(db.retries).toBeGreaterThan(0); // the race really happened
    });

    it('never creates more than 3 documents from 10 parallel uploads', async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repository.reserveUpload(UID, nextId(), record(), DEMO_LIMITS),
        ),
      );
      expect(results.filter((r) => r === 'reserved')).toHaveLength(3);
      expect(
        results.filter((r) => r === 'document_limit_reached'),
      ).toHaveLength(7);
      expect(db.childrenOf(`users/${UID}/documents`)).toHaveLength(3);
      expect(db.docs.get(USAGE)).toMatchObject({ uploadsUsed: 3 });
    });

    it('never charges more than 6 uploads in total', async () => {
      db.docs.set(USAGE, { uploadsUsed: 4, questionsUsed: 0 });
      const limits = { maxDocuments: 100, maxUploads: 6 };
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          repository.reserveUpload(UID, nextId(), record(), limits),
        ),
      );
      expect(results.filter((r) => r === 'reserved')).toHaveLength(2);
      expect(db.docs.get(USAGE)).toMatchObject({ uploadsUsed: 6 });
    });

    it('keeps concurrent refunds and charges consistent', async () => {
      db.docs.set(USAGE, { uploadsUsed: 0, questionsUsed: 10 });
      await Promise.all([
        ...Array.from({ length: 5 }, () => repository.reserveQuestion(UID, 30)),
        ...Array.from({ length: 3 }, () =>
          repository.refund(UID, 'questionsUsed'),
        ),
      ]);
      expect(db.docs.get(USAGE)).toMatchObject({ questionsUsed: 12 });
    });
  });
});
