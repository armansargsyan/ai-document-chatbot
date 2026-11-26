import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type { UsageResponse } from '@ai-document-chatbot/shared';
import { DemoUsage, USAGE_URL } from './demo-usage';
import { limitErrorCode } from './limit-errors';
import { usageOf } from './testing/usage-fixtures';

describe('DemoUsage', () => {
  let usage: DemoUsage;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DemoUsage, provideHttpClient(), provideHttpClientTesting()],
    });
    usage = TestBed.inject(DemoUsage);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  async function respond(body: UsageResponse | 'error') {
    TestBed.tick();
    const req = httpMock.expectOne(USAGE_URL);
    if (body === 'error') {
      req.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      req.flush(body);
    }
    await TestBed.inject(ApplicationRef).whenStable();
  }

  it('knows nothing until loaded, so nothing is blocked', () => {
    TestBed.tick();
    expect(usage.loading()).toBe(true);
    expect(usage.usage()).toBeNull();
    expect(usage.uploadBlock()).toBeNull();
    expect(usage.questionsBlocked()).toBe(false);
    httpMock.expectOne(USAGE_URL).flush(usageOf());
  });

  it('works out what is left', async () => {
    await respond(usageOf({ documents: 2, uploads: 4, questions: 12 }));
    expect(usage.documentsLeft()).toBe(1);
    expect(usage.uploadsLeft()).toBe(2);
    expect(usage.questionsLeft()).toBe(18);
    expect(usage.uploadBlock()).toBeNull();
  });

  it.each([
    [usageOf({ documents: 3, uploads: 3 }), 'documents'],
    // The api checks uploads first; deleting wouldn't help, so say so.
    [usageOf({ documents: 3, uploads: 6 }), 'uploads'],
    [usageOf({ documents: 1, uploads: 7 }), 'uploads'],
  ])('blocks uploads with the right reason (%#)', async (body, reason) => {
    await respond(body);
    expect(usage.uploadBlock()).toBe(reason);
  });

  it('blocks questions once all are used', async () => {
    await respond(usageOf({ questions: 30 }));
    expect(usage.questionsExhausted()).toBe(true);
    expect(usage.questionsBlocked()).toBe(true);
  });

  it('pauses uploads and questions while search is out of budget', async () => {
    await respond({ ...usageOf(), searchQuotaExhausted: true });
    expect(usage.searchPaused()).toBe(true);
    expect(usage.uploadBlock()).toBe('paused');
    expect(usage.questionsBlocked()).toBe(true);
  });

  it('pauses on a search_quota_exhausted error until the server says otherwise', async () => {
    await respond(usageOf());
    usage.noteLimit('search_quota_exhausted');
    expect(usage.searchPaused()).toBe(true);
    // It asked for a refresh; the budget has reset meanwhile.
    await respond({ ...usageOf(), searchQuotaExhausted: false });
    expect(usage.searchPaused()).toBe(false);
  });

  it('refreshes on other limit codes and ignores none', async () => {
    await respond(usageOf());
    usage.noteLimit(undefined);
    TestBed.tick();
    httpMock.expectNone(USAGE_URL);
    usage.noteLimit('upload_limit_reached');
    await respond(usageOf({ uploads: 6 }));
    expect(usage.uploadBlock()).toBe('uploads');
    expect(usage.searchPaused()).toBe(false);
  });

  it('keeps the last usage when a refresh fails', async () => {
    await respond(usageOf({ documents: 3 }));
    // Read, as the page's template does on every render.
    expect(usage.documentsFull()).toBe(true);
    usage.refresh();
    await respond('error');
    expect(usage.documentsFull()).toBe(true);
  });
});

describe('limitErrorCode', () => {
  it('reads known demo-limit codes only', () => {
    expect(limitErrorCode({ code: 'question_limit_reached' })).toBe(
      'question_limit_reached',
    );
    expect(limitErrorCode({ code: 'document_not_found' })).toBeUndefined();
    expect(limitErrorCode({ code: 42 })).toBeUndefined();
    expect(limitErrorCode(null)).toBeUndefined();
    expect(limitErrorCode('model_quota_exhausted')).toBeUndefined();
  });
});
