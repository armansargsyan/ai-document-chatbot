import { beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { DocumentRecord } from '../documents/document.repository';
import { ProviderQuotaTracker } from '../llm/provider-quota-tracker';
import { FakeFirestore } from './testing/fake-firestore';
import { UsageRepository } from './usage.repository';
import { UsageService } from './usage.service';

const UID = 'user-1';
const USAGE = `users/${UID}/meta/usage`;
const record: DocumentRecord = {
  name: 'a.pdf',
  sizeBytes: 1,
  status: 'processing',
  pageCount: 1,
  chunkCount: null,
  createdAt: '2026-11-26T00:00:00.000Z',
  storagePath: 'p',
};

async function rejection(promise: Promise<unknown>): Promise<HttpException> {
  const error = await promise.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HttpException);
  return error as HttpException;
}

describe('UsageService', () => {
  let db: FakeFirestore;
  let quota: ProviderQuotaTracker;
  let service: UsageService;

  beforeEach(() => {
    db = new FakeFirestore();
    quota = new ProviderQuotaTracker();
    service = new UsageService(new UsageRepository(db.asFirestore()), quota);
  });

  it('reports usage against the demo limits', async () => {
    db.docs.set(USAGE, { uploadsUsed: 4, questionsUsed: 12 });
    db.docs.set(`users/${UID}/documents/a`, { ...record });
    db.docs.set(`users/${UID}/documents/b`, { ...record });
    expect(await service.getUsage(UID)).toEqual({
      documents: { used: 2, limit: 3 },
      uploads: { used: 4, limit: 6 },
      questions: { used: 12, limit: 30 },
      searchQuotaExhausted: false,
    });
  });

  it('flags paused search while OpenAI is exhausted', async () => {
    quota.markExhausted('openai');
    expect((await service.getUsage(UID)).searchQuotaExhausted).toBe(true);
  });

  it('answers 503 without details when usage cannot be read', async () => {
    const broken = new UsageService(
      {
        read: async () => {
          throw new Error('firestore internal detail');
        },
      } as unknown as UsageRepository,
      quota,
    );
    const error = await rejection(broken.getUsage(UID));
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse())).not.toContain('internal');
  });

  it('throws 409 document_limit_reached with the friendly message', async () => {
    for (const id of ['a', 'b', 'c']) {
      db.docs.set(`users/${UID}/documents/${id}`, { ...record });
    }
    const error = await rejection(service.reserveUpload(UID, 'd', record));
    expect(error.getStatus()).toBe(409);
    expect(error.getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'You can keep up to 3 documents. Delete one to upload another.',
      code: 'document_limit_reached',
    });
  });

  it('throws 403 upload_limit_reached with the friendly message', async () => {
    db.docs.set(USAGE, { uploadsUsed: 6 });
    const error = await rejection(service.reserveUpload(UID, 'd', record));
    expect(error.getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: "You've used all 6 demo uploads.",
      code: 'upload_limit_reached',
    });
  });

  it('throws 403 question_limit_reached with the friendly message', async () => {
    db.docs.set(USAGE, { questionsUsed: 30 });
    const error = await rejection(service.reserveQuestion(UID));
    expect(error.getResponse()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: "You've used all 30 demo questions.",
      code: 'question_limit_reached',
    });
  });

  it('maps a Firestore failure while reserving to a generic 503', async () => {
    db.failNextCommit = new Error('UNAVAILABLE: secret detail');
    const error = await rejection(service.reserveQuestion(UID));
    expect(error.getStatus()).toBe(503);
    expect(JSON.stringify(error.getResponse())).not.toContain('secret');
  });

  it('refunds and swallows refund failures', async () => {
    await service.reserveQuestion(UID);
    await service.reserveUpload(UID, 'd', record);
    await service.refundQuestion(UID);
    await service.refundUpload(UID);
    expect(db.docs.get(USAGE)).toMatchObject({
      uploadsUsed: 0,
      questionsUsed: 0,
    });
    db.failNextCommit = new Error('down');
    await expect(service.refundQuestion(UID)).resolves.toBeUndefined();
  });
});
