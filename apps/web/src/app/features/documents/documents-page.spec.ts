import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import type {
  DocumentSummary,
  ListDocumentsResponse,
} from '@ai-document-chatbot/shared';
import { DOCUMENTS_POLL_MS, DocumentsPage } from './documents-page';

/** Long enough never to fire on its own; polling tests fake `setInterval`. */
const POLL_MS = 60_000;

const doc = (patch: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'd1',
  name: 'Lease agreement.pdf',
  sizeBytes: 2.4 * 1024 * 1024,
  status: 'ready',
  pageCount: 12,
  chunkCount: 30,
  createdAt: '2026-11-24T10:00:00.000Z',
  ...patch,
});

const READY = doc({});
const PROCESSING = doc({
  id: 'd2',
  name: 'Annual report.pdf',
  status: 'processing',
  chunkCount: null,
});
const FAILED = doc({
  id: 'd3',
  name: 'Scan.pdf',
  status: 'failed',
  pageCount: 1,
  sizeBytes: 340 * 1024,
});

/** querySelector that fails the test instead of returning null. */
function must<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

const list = (...documents: DocumentSummary[]): ListDocumentsResponse => ({
  documents,
});

describe('DocumentsPage', () => {
  let fixture: ComponentFixture<DocumentsPage>;
  let el: HTMLElement;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DOCUMENTS_POLL_MS, useValue: POLL_MS },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    httpMock.verify();
  });

  const q = (id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rows = () => [
    ...el.querySelectorAll<HTMLElement>('[data-testid="document-row"]'),
  ];
  const overlay = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  async function expectList(
    response: ListDocumentsResponse | 'error' = list(READY),
  ) {
    TestBed.tick();
    const req = httpMock.expectOne('/api/documents');
    expect(req.request.method).toBe('GET');
    if (response === 'error') {
      req.flush(null, { status: 500, statusText: 'Server Error' });
    } else {
      req.flush(response);
    }
    await fixture.whenStable();
  }

  async function render(response?: ListDocumentsResponse | 'error') {
    fixture = TestBed.createComponent(DocumentsPage);
    el = fixture.nativeElement as HTMLElement;
    TestBed.tick();
    await expectList(response);
  }

  it('shows skeleton rows while the first load runs', async () => {
    fixture = TestBed.createComponent(DocumentsPage);
    el = fixture.nativeElement as HTMLElement;
    TestBed.tick();
    expect(q('list-loading')?.getAttribute('aria-busy')).toBe('true');
    expect(q('list-loading')?.querySelectorAll('li')).toHaveLength(3);

    await expectList(list(READY));
    expect(q('list-loading')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('shows an empty state', async () => {
    await render(list());
    expect(q('list-empty')?.textContent).toContain('Upload your first PDF');
    expect(rows()).toHaveLength(0);
  });

  it('shows an error with a working retry', async () => {
    await render('error');
    expect(q('list-error')?.textContent).toContain(
      'Couldn’t load your documents',
    );

    q('list-error')?.querySelector('button')?.click();
    await expectList(list(READY));
    expect(q('list-error')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('lists name, size, pages, date and status', async () => {
    await render(list(READY, PROCESSING, FAILED));
    const [ready, processing, failed] = rows();

    expect(q('document-count')?.textContent?.trim()).toBe('3 files');
    expect(
      ready.querySelector('[data-testid="document-name"]')?.textContent?.trim(),
    ).toBe('Lease agreement.pdf');
    const meta = must(ready, '[data-testid="document-meta"]');
    expect(meta.textContent).toContain('2.4 MB');
    expect(meta.textContent).toContain('12 pages');
    expect(meta.textContent).toContain('Nov 24, 2026');
    expect(meta.querySelector('time')?.getAttribute('datetime')).toBe(
      READY.createdAt,
    );
    expect(failed.textContent).toContain('1 page');

    const badge = (row: HTMLElement) =>
      row.querySelector('[data-testid="status-badge"]')?.textContent?.trim();
    expect(badge(ready)).toBe('Ready');
    expect(badge(processing)).toBe('Processing');
    expect(badge(failed)).toBe('Failed');
    expect(failed.textContent).toContain('Processing failed');
  });

  describe('polling', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });
    afterEach(() => vi.useRealTimers());

    it('refreshes while a document is processing and stops once none are', async () => {
      await render(list(PROCESSING, READY));

      vi.advanceTimersByTime(POLL_MS);
      await expectList(list(PROCESSING, READY)); // still processing
      vi.advanceTimersByTime(POLL_MS);
      await expectList(list({ ...PROCESSING, status: 'ready' }, READY));
      expect(rows()[0].textContent).toContain('Ready');

      vi.advanceTimersByTime(POLL_MS);
      httpMock.expectNone('/api/documents');
    });

    it('keeps the rows and keeps polling when a refresh fails', async () => {
      await render(list(PROCESSING, READY));

      vi.advanceTimersByTime(POLL_MS);
      await expectList('error');
      expect(rows()).toHaveLength(2);
      expect(q('list-error')).toBeNull();
      expect(q('refresh-error')?.textContent).toContain('Couldn’t refresh');

      vi.advanceTimersByTime(POLL_MS);
      await expectList(list({ ...PROCESSING, status: 'ready' }, READY));
      expect(q('refresh-error')).toBeNull();
      expect(rows()[0].textContent).toContain('Ready');
    });

    it('does not poll when nothing is processing', async () => {
      await render(list(READY, FAILED));
      vi.advanceTimersByTime(POLL_MS);
      httpMock.expectNone('/api/documents');
    });
  });

  describe('delete', () => {
    const deleteButton = (row: HTMLElement) =>
      must<HTMLButtonElement>(row, '[data-testid="delete-button"]');

    async function openConfirm(row: HTMLElement) {
      deleteButton(row).click();
      await fixture.whenStable();
      expect(overlay('delete-confirm')).not.toBeNull();
    }

    it('is disabled while a document is processing', async () => {
      await render(list(PROCESSING, READY));
      const [processing, ready] = rows();
      expect(deleteButton(processing).disabled).toBe(true);
      expect(deleteButton(ready).disabled).toBe(false);
      expect(deleteButton(ready).getAttribute('aria-label')).toBe(
        'Delete Lease agreement.pdf',
      );
    });

    it('confirms, deletes and removes the row', async () => {
      await render(list(READY, FAILED));
      await openConfirm(rows()[0]);
      expect(overlay('delete-description')?.textContent).toContain(
        'Lease agreement.pdf',
      );
      httpMock.expectNone({ method: 'DELETE' });

      overlay('delete-confirm')?.click();
      await fixture.whenStable();
      const req = httpMock.expectOne('/api/documents/d1');
      expect(req.request.method).toBe('DELETE');
      expect(rows()[0].hasAttribute('data-deleting')).toBe(true);

      req.flush(null, { status: 204, statusText: 'No Content' });
      await fixture.whenStable();
      expect(rows()).toHaveLength(1);
      expect(rows()[0].textContent).toContain('Scan.pdf');
      expect(q('list-announcer')?.textContent).toContain(
        'Deleted “Lease agreement.pdf”',
      );
      expect(document.activeElement?.id).toBe('documents-heading');
    });

    it('does nothing when cancelled', async () => {
      await render(list(READY));
      await openConfirm(rows()[0]);
      overlay('delete-cancel')?.click();
      await fixture.whenStable();
      httpMock.expectNone({ method: 'DELETE' });
      expect(rows()).toHaveLength(1);
    });

    it('explains a 409 (still processing) and refreshes the list', async () => {
      await render(list(READY));
      await openConfirm(rows()[0]);
      overlay('delete-confirm')?.click();
      await fixture.whenStable();

      httpMock
        .expectOne('/api/documents/d1')
        .flush(
          { statusCode: 409, message: 'Document is still processing' },
          { status: 409, statusText: 'Conflict' },
        );
      // The refresh it triggers stays pending until flushed: no whenStable() yet.
      await expectList(list({ ...READY, status: 'processing' }));
      expect(q('list-notice')?.getAttribute('role')).toBe('alert');
      expect(q('list-notice')?.textContent).toContain('still processing');
      expect(deleteButton(rows()[0]).disabled).toBe(true);
    });

    it('drops the "still processing" notice once that document is ready', async () => {
      await render(list(READY));
      await openConfirm(rows()[0]);
      overlay('delete-confirm')?.click();
      await fixture.whenStable();

      httpMock
        .expectOne('/api/documents/d1')
        .flush(
          { statusCode: 409, message: 'Document is still processing' },
          { status: 409, statusText: 'Conflict' },
        );
      // The refresh shows it has finished in the meantime.
      await expectList(list(READY));
      expect(q('list-notice')).toBeNull();
      expect(deleteButton(rows()[0]).disabled).toBe(false);
      expect(deleteButton(rows()[0]).getAttribute('aria-label')).toBe(
        `Delete ${READY.name}`,
      );
    });

    it('treats a 404 as already deleted', async () => {
      await render(list(READY));
      await openConfirm(rows()[0]);
      overlay('delete-confirm')?.click();
      await fixture.whenStable();

      httpMock
        .expectOne('/api/documents/d1')
        .flush(
          { statusCode: 404, message: 'Document not found' },
          { status: 404, statusText: 'Not Found' },
        );
      await fixture.whenStable();
      expect(rows()).toHaveLength(0);
      expect(q('list-empty')).not.toBeNull();
      expect(q('list-announcer')?.textContent).toContain('already deleted');
    });

    it('shows a friendly error when delete fails', async () => {
      await render(list(READY));
      await openConfirm(rows()[0]);
      overlay('delete-confirm')?.click();
      await fixture.whenStable();

      httpMock
        .expectOne('/api/documents/d1')
        .flush('stack trace', { status: 500, statusText: 'Server Error' });
      await fixture.whenStable();
      expect(q('list-notice')?.textContent).toContain('Couldn’t delete');
      expect(el.textContent).not.toContain('stack trace');
      expect(rows()).toHaveLength(1);
      expect(deleteButton(rows()[0]).disabled).toBe(false);
    });
  });

  it('refreshes the list when an upload finishes', async () => {
    await render(list());
    const input = q('file-input') as HTMLInputElement;
    const file = new File(['%PDF'], 'new.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    httpMock
      .expectOne({ method: 'POST', url: '/api/documents' })
      .flush(doc({ id: 'n1', name: 'new.pdf' }));
    // The upload triggered a refresh, which stays pending until flushed.
    await expectList(list(doc({ id: 'n1', name: 'new.pdf' })));
    expect(rows()[0].textContent).toContain('new.pdf');
  });
});
