import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { DocumentSummary } from '@ai-document-chatbot/shared';
import { ChatDocuments } from './chat-documents';
import { LEASE, RULES } from './testing/fake-chat-documents';

describe('ChatDocuments', () => {
  let docs: ChatDocuments;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ChatDocuments,
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    docs = TestBed.inject(ChatDocuments);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function load(documents: DocumentSummary[]) {
    TestBed.tick();
    httpMock.expectOne('/api/documents').flush({ documents });
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('keeps ready documents only, newest first', async () => {
    expect(docs.ready()).toEqual([]);
    expect(docs.needsDocuments()).toBe(false); // not loaded yet
    const newest = {
      ...RULES,
      id: 'doc-new',
      createdAt: '2026-11-25T08:00:00Z',
    };
    await load([
      RULES,
      { ...LEASE, id: 'doc-busy', status: 'processing' },
      LEASE,
      { ...LEASE, id: 'doc-bad', status: 'failed' },
      newest,
    ]);
    expect(docs.ready().map((d) => d.id)).toEqual([
      'doc-new',
      LEASE.id,
      RULES.id,
    ]);
    expect(docs.find(LEASE.id)).toEqual(LEASE);
    expect(docs.find('doc-busy')).toBeNull();
    expect(docs.find(null)).toBeNull();
    expect(docs.needsDocuments()).toBe(false);
  });

  it('needs documents once loaded with none ready', async () => {
    await load([{ ...LEASE, status: 'processing' }]);
    expect(docs.needsDocuments()).toBe(true);
  });
});
