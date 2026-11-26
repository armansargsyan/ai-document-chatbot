import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  HttpEventType,
  HttpHeaders,
  provideHttpClient,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import {
  MAX_PDF_BYTES,
  type DocumentSummary,
  type UsageResponse,
} from '@ai-document-chatbot/shared';
import { DemoUsage, USAGE_URL } from '../../core/usage/demo-usage';
import { usageOf } from '../../core/usage/testing/usage-fixtures';
import { DocumentUpload } from './document-upload';
import { skippedMessage } from './upload-queue';

function pdf(name = 'lease.pdf', size = 2048, type = 'application/pdf'): File {
  const f = new File(['%PDF-1.7'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** querySelector that fails the test instead of returning null. */
function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const READY: DocumentSummary = {
  id: 'd1',
  name: 'lease.pdf',
  sizeBytes: 2048,
  status: 'ready',
  pageCount: 3,
  chunkCount: 4,
  createdAt: '2026-11-24T10:00:00.000Z',
};

describe('DocumentUpload', () => {
  let fixture: ComponentFixture<DocumentUpload>;
  let el: HTMLElement;
  let httpMock: HttpTestingController;
  let changed: number;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [DocumentUpload],
      providers: [provideHttpClient(), provideHttpClientTesting(), DemoUsage],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DocumentUpload);
    el = fixture.nativeElement as HTMLElement;
    changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    // A new account: every limit has room.
    TestBed.tick();
    httpMock.expectOne(USAGE_URL).flush(usageOf());
    await fixture.whenStable();
  });

  afterEach(() => {
    // Refreshes after a limit error are asserted where they matter.
    httpMock.match(USAGE_URL);
    httpMock.verify();
  });

  /** Answers a usage refresh a limit error asked for, then settles. */
  async function settleWithUsage(usage = usageOf()) {
    TestBed.tick();
    httpMock.expectOne(USAGE_URL).flush(usage);
    await fixture.whenStable();
  }

  /** Replaces the usage the component sees (a refresh with a new body). */
  async function setUsage(usage: UsageResponse) {
    TestBed.inject(DemoUsage).refresh();
    TestBed.tick();
    httpMock.expectOne(USAGE_URL).flush(usage);
    await fixture.whenStable();
  }

  const input = () => must<HTMLInputElement>(el, '[data-testid="file-input"]');
  const dropZone = () =>
    must<HTMLButtonElement>(el, '[data-testid="drop-zone"]');
  const items = () => [
    ...el.querySelectorAll<HTMLElement>('[data-testid="upload-item"]'),
  ];
  const status = (item: HTMLElement) =>
    item.querySelector('[data-testid="upload-status"]')?.textContent?.trim();
  const errorText = (item: HTMLElement) =>
    item.querySelector('[data-testid="upload-error"]')?.textContent?.trim();
  const announcer = () =>
    el.querySelector('[data-testid="upload-announcer"]')?.textContent?.trim();

  async function pick(...files: File[]) {
    Object.defineProperty(input(), 'files', {
      value: files,
      configurable: true,
    });
    input().dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  function dragEvent(type: string, files: File[] = []): DragEvent {
    const event = new Event(type, {
      bubbles: true,
      cancelable: true,
    }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
      value: { types: ['Files'], files, dropEffect: 'none' },
    });
    return event;
  }

  function expectUpload(): TestRequest {
    const req = httpMock.expectOne('/api/documents');
    expect(req.request.method).toBe('POST');
    return req;
  }

  async function fail(req: TestRequest, status: number, message?: string) {
    req.flush(
      message === undefined
        ? null
        : { statusCode: status, message, error: 'Error' },
      {
        status,
        statusText: 'Error',
        headers:
          status === 429 ? new HttpHeaders({ 'Retry-After': '720' }) : {},
      },
    );
    await fixture.whenStable();
  }

  it('describes the limits and opens the file picker from the drop zone', () => {
    const click = vi.spyOn(input(), 'click');
    expect(dropZone().tagName).toBe('BUTTON');
    expect(dropZone().textContent).toContain('PDF only');
    expect(dropZone().textContent).toContain('up to 3 MB');
    expect(input().accept).toBe('application/pdf,.pdf');
    expect(input().multiple).toBe(true);

    dropZone().click();
    expect(click).toHaveBeenCalled();
  });

  it('rejects wrong types and oversized files inline without a request', async () => {
    await pick(
      pdf('notes.docx', 100, 'application/msword'),
      pdf('huge.pdf', MAX_PDF_BYTES + 1),
    );
    httpMock.expectNone('/api/documents');

    const [huge, notes] = items();
    expect(errorText(notes)).toBe('Only PDF files can be uploaded.');
    expect(errorText(huge)).toBe(
      'This file is larger than 3 MB, the upload limit.',
    );
    expect(announcer()).toContain('huge.pdf');
  });

  it('uploads multipart with the PDF in `file`, then shows progress and processing', async () => {
    const file = pdf();
    await pick(file);

    const req = expectUpload();
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBeInstanceOf(File);
    expect((body.get('file') as File).name).toBe('lease.pdf');
    expect(req.request.reportUploadProgress).toBe(true);

    req.event({
      type: HttpEventType.UploadProgress,
      loaded: 1024,
      total: 2048,
    });
    await fixture.whenStable();
    const [item] = items();
    expect(status(item)).toBe('Uploading… 50%');
    expect(item.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(changed).toBe(0);

    req.event({
      type: HttpEventType.UploadProgress,
      loaded: 2048,
      total: 2048,
    });
    await fixture.whenStable();
    expect(status(item)).toBe('Processing… (extracting text and indexing)');
    expect(announcer()).toContain('Processing');
    expect(changed).toBe(1); // the list now shows it as processing

    req.flush(READY);
    await fixture.whenStable();
    expect(status(items()[0])).toContain('Added to your documents');
    expect(changed).toBe(2);

    items()[0].querySelector<HTMLButtonElement>('button')?.click();
    await fixture.whenStable();
    expect(items()).toHaveLength(0);
  });

  it('uploads several files one at a time', async () => {
    await pick(pdf('a.pdf'), pdf('b.pdf'));
    const first = expectUpload();
    expect((first.request.body as FormData).get('file')).toHaveProperty(
      'name',
      'a.pdf',
    );
    expect(status(items()[0])).toBe('Waiting…'); // b.pdf (newest first)

    first.flush({ ...READY, name: 'a.pdf' });
    await fixture.whenStable();
    const second = expectUpload();
    expect((second.request.body as FormData).get('file')).toHaveProperty(
      'name',
      'b.pdf',
    );
    second.flush({ ...READY, id: 'd2', name: 'b.pdf' });
    await fixture.whenStable();
  });

  it.each([
    [413, 'File is too large. PDFs can be up to 3 MB.'],
    [415, 'Only PDF files are supported.'],
    [
      422,
      'This PDF has no extractable text. Scanned PDFs aren’t supported yet.',
    ],
    [429, 'You’ve reached the upload limit. Try again in 12 minutes.'],
  ])('shows the server message for %d inline', async (code, message) => {
    await pick(pdf());
    await fail(expectUpload(), code, message);

    const [item] = items();
    expect(item.dataset['phase']).toBe('error');
    expect(errorText(item)).toBe(message);
    expect(announcer()).toContain(message);
    expect(changed).toBe(1);
  });

  it.each([
    [503, 'Document processing is unavailable right now. Try again later.'],
    [502, 'We couldn’t finish processing this PDF. Delete it and try again.'],
  ])('shows generic copy for %d', async (code, copy) => {
    await pick(pdf());
    await fail(expectUpload(), code, 'OpenAI: internal provider detail');
    expect(errorText(items()[0])).toBe(copy);
    expect(el.textContent).not.toContain('OpenAI');
  });

  it('shows a network message when the request never reaches the server', async () => {
    await pick(pdf());
    expectUpload().error(new ProgressEvent('error'));
    await fixture.whenStable();
    expect(errorText(items()[0])).toContain('Check your connection');
  });

  it('carries on with the queue after a failure', async () => {
    await pick(pdf('a.pdf'), pdf('b.pdf'));
    await fail(expectUpload(), 503, 'x');
    const next = expectUpload();
    expect((next.request.body as FormData).get('file')).toHaveProperty(
      'name',
      'b.pdf',
    );
    next.flush(READY);
    await fixture.whenStable();
  });

  it('highlights while files are dragged over and uploads dropped PDFs', async () => {
    dropZone().dispatchEvent(dragEvent('dragenter'));
    await fixture.whenStable();
    expect(dropZone().hasAttribute('data-dragging')).toBe(true);
    expect(dropZone().textContent).toContain('Drop to upload');

    dropZone().dispatchEvent(dragEvent('dragleave'));
    await fixture.whenStable();
    expect(dropZone().hasAttribute('data-dragging')).toBe(false);

    dropZone().dispatchEvent(dragEvent('dragenter'));
    const drop = dragEvent('drop', [pdf('dropped.pdf')]);
    dropZone().dispatchEvent(drop);
    await fixture.whenStable();
    expect(drop.defaultPrevented).toBe(true);
    expect(dropZone().hasAttribute('data-dragging')).toBe(false);

    const req = expectUpload();
    expect((req.request.body as FormData).get('file')).toHaveProperty(
      'name',
      'dropped.pdf',
    );
    req.flush(READY);
    await fixture.whenStable();
  });

  it('validates dropped files too', async () => {
    dropZone().dispatchEvent(
      dragEvent('drop', [pdf('pic.png', 10, 'image/png')]),
    );
    await fixture.whenStable();
    httpMock.expectNone('/api/documents');
    expect(errorText(items()[0])).toBe('Only PDF files can be uploaded.');
  });

  describe('demo limits', () => {
    const skipped = () =>
      el.querySelector('[data-testid="upload-skipped"]')?.textContent?.trim();
    const blocked = () =>
      el
        .querySelector('[data-testid="upload-blocked-title"]')
        ?.textContent?.trim();

    it('queues only as many files as free document slots allow', async () => {
      await setUsage(usageOf({ documents: 2, uploads: 2 }));
      await pick(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'));
      expect(items().map((i) => i.textContent)).toHaveLength(1);
      expect(items()[0].textContent).toContain('a.pdf');
      expect(skipped()).toBe(
        'Only 1 of 3 files was added. You can keep 3 documents at a time; delete one to upload more.',
      );
      expect(announcer()).toBe(skipped());
      expectUpload().flush(READY);
      await fixture.whenStable();
    });

    it('queues only as many files as uploads left allow', async () => {
      await setUsage(usageOf({ documents: 0, uploads: 4 }));
      await pick(pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf'));
      expect(items()).toHaveLength(2);
      expect(skipped()).toBe(
        'Only 2 of 3 files were added. You have 2 demo uploads left.',
      );
      expectUpload().flush(READY);
      await fixture.whenStable();
      expectUpload().flush({ ...READY, id: 'd2' });
      await fixture.whenStable();
    });

    it('counts files already queued, and ignores invalid ones', async () => {
      await setUsage(usageOf({ documents: 2, uploads: 5 }));
      await pick(pdf('a.pdf'));
      const first = expectUpload();
      // a.pdf takes the last upload while it's in flight.
      await pick(pdf('notes.txt', 10, 'text/plain'), pdf('b.pdf'));
      expect(items().map((i) => i.dataset['phase'])).toEqual([
        'error',
        'uploading',
      ]);
      expect(skipped()).toBe(
        'This file wasn’t added. You’ve used all 6 demo uploads.',
      );
      first.flush(READY);
      await fixture.whenStable();
    });

    it('clears the notice on the next pick and on dismiss', async () => {
      await setUsage(usageOf({ documents: 2, uploads: 2 }));
      await pick(pdf('a.pdf'), pdf('b.pdf'));
      expect(skipped()).toBeTruthy();
      must<HTMLButtonElement>(
        el,
        '[data-testid="upload-skipped"] button',
      ).click();
      await fixture.whenStable();
      expect(skipped()).toBeUndefined();
      expectUpload().flush(READY);
      await fixture.whenStable();
    });

    it('keeps the last known usage when a refresh fails', async () => {
      await setUsage(usageOf({ documents: 3 })); // known: full
      TestBed.inject(DemoUsage).refresh();
      TestBed.tick();
      httpMock
        .expectOne(USAGE_URL)
        .flush(null, { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      // A failed refresh keeps the last known usage.
      expect(blocked()).toBe('Delete a document to upload another');
    });

    it.each([
      [
        usageOf({ documents: 3, uploads: 3 }),
        'Delete a document to upload another',
      ],
      [usageOf({ documents: 1, uploads: 6 }), 'You’ve used all 6 demo uploads'],
    ])('disables the drop zone with the reason (%#)', async (usage, title) => {
      await setUsage(usage);
      expect(el.querySelector('[data-testid="drop-zone"]')).toBeNull();
      expect(blocked()).toBe(title);
      expect(
        el
          .querySelector('[data-testid="upload-blocked"]')
          ?.getAttribute('role'),
      ).toBe('status');
      // A drop is ignored too.
      el.dispatchEvent(dragEvent('drop', [pdf()]));
      await fixture.whenStable();
      httpMock.expectNone('/api/documents');
    });

    it.each([
      [
        'document_limit_reached',
        409,
        'You can keep 3 documents at a time. Delete a document to upload another.',
      ],
      ['upload_limit_reached', 403, 'You’ve used all 6 demo uploads.'],
    ])(
      'maps %s without a server message and refreshes the usage',
      async (code, status, copy) => {
        await pick(pdf());
        expectUpload().flush(
          { statusCode: status, code },
          { status, statusText: 'Error' },
        );
        // The usage refresh it asks for: now at the document limit.
        TestBed.tick();
        httpMock.expectOne(USAGE_URL).flush(usageOf({ documents: 3 }));
        await fixture.whenStable();
        expect(errorText(items()[0])).toBe(copy);
        expect(blocked()).toBe('Delete a document to upload another');
      },
    );

    it('prefers the server message for a 4xx limit error', async () => {
      await pick(pdf());
      expectUpload().flush(
        {
          statusCode: 409,
          code: 'document_limit_reached',
          message: 'You already have 3 documents.',
        },
        { status: 409, statusText: 'Conflict' },
      );
      await settleWithUsage();
      expect(errorText(items()[0])).toBe('You already have 3 documents.');
    });

    it('pauses uploads when document search is out of budget', async () => {
      await pick(pdf());
      expectUpload().flush(
        {
          statusCode: 503,
          code: 'search_quota_exhausted',
          message: 'OpenAI insufficient_quota',
        },
        { status: 503, statusText: 'Service Unavailable' },
      );
      await settleWithUsage();
      expect(errorText(items()[0])).toBe(
        'Document search has reached its demo limit for this month, so uploads and questions are paused.',
      );
      expect(el.textContent).not.toContain('insufficient_quota');
      expect(blocked()).toBe('Uploads are paused this month');
    });
  });
});

describe('skippedMessage', () => {
  it('explains each limit', () => {
    expect(skippedMessage(0, 2, 'documents', 3)).toBe(
      'These files weren’t added. You can keep 3 documents at a time; delete one to upload more.',
    );
    expect(skippedMessage(1, 2, 'uploads', 1)).toBe(
      'Only 1 of 2 files was added. You have 1 demo upload left.',
    );
  });
});
