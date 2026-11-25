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
} from '@ai-document-chatbot/shared';
import { DocumentUpload } from './document-upload';

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
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DocumentUpload);
    el = fixture.nativeElement as HTMLElement;
    changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

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
    expect(dropZone().textContent).toContain('10 MB');
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
    expect(errorText(huge)).toContain('larger than 10 MB');
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
    [413, 'File is too large. PDFs can be up to 10 MB.'],
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
});
