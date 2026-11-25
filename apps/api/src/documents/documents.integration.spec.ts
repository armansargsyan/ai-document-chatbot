import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'node:net';
import { MAX_PDF_BYTES } from '@ai-document-chatbot/shared';
import { AuthModule } from '../auth/auth.module';
import { TokenVerifier, type AuthUser } from '../auth/token-verifier';
import { Embedder } from '../embeddings/embedder';
import { DocumentRepository } from './document.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { PdfTextExtractor } from './pdf-text-extractor';
import { makePdf } from './testing/make-pdf';

class FakeTokenVerifier extends TokenVerifier {
  async verify(token: string): Promise<AuthUser> {
    if (token !== 'valid') throw new Error('bad token');
    return { uid: 'user-1', email: null, name: null, picture: null };
  }
}

class FakeEmbedder extends Embedder {
  readonly dimensions = 2;
  async embed(texts: string[]) {
    return texts.map(() => [0.5, 0.5]);
  }
}

/**
 * Real HTTP + multer + auth guard + real PDF parsing; Firebase and OpenAI are
 * fakes. Loopback only.
 */
describe('documents (integration)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const repository = {
    newId: vi.fn(() => 'abcdefghij0123456789'),
    storagePath: vi.fn(() => 'users/user-1/documents/abcdefghij0123456789.pdf'),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    saveFile: vi.fn(async () => undefined),
    saveChunks: vi.fn(async () => undefined),
    deleteChunks: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthModule],
      controllers: [DocumentsController],
      providers: [
        DocumentsService,
        PdfTextExtractor,
        { provide: DocumentRepository, useValue: repository },
        { provide: Embedder, useClass: FakeEmbedder },
      ],
    })
      .overrideProvider(TokenVerifier)
      .useClass(FakeTokenVerifier)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const upload = (body: Buffer, token = 'valid', name = 'notes.pdf') => {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(body)], { type: 'application/pdf' }),
      name,
    );
    return fetch(`${baseUrl}/documents`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  };

  it('requires authentication', async () => {
    expect((await upload(makePdf(['hi']), 'nope')).status).toBe(401);
    expect((await fetch(`${baseUrl}/documents`)).status).toBe(401);
  });

  it('ingests a real multipart PDF upload', async () => {
    const res = await upload(makePdf(['Alpha page', 'Beta page']));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      name: 'notes.pdf',
      status: 'ready',
      pageCount: 2,
      chunkCount: 2,
    });
  });

  it('rejects files over the size limit with 413', async () => {
    const big = Buffer.concat([makePdf(['x']), Buffer.alloc(MAX_PDF_BYTES)]);
    expect((await upload(big)).status).toBe(413);
  });

  it('rejects a non-PDF with 415', async () => {
    expect(
      (await upload(Buffer.from('just text'), 'valid', 'fake.pdf')).status,
    ).toBe(415);
  });

  it('returns 404 for malformed document ids without touching storage', async () => {
    repository.get.mockClear();
    const res = await fetch(`${baseUrl}/documents/..%2F..%2Fother-user`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer valid' },
    });
    expect(res.status).toBe(404);
    expect(repository.get).not.toHaveBeenCalled();
  });
});
