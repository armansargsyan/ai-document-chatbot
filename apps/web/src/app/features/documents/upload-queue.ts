import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpEventType } from '@angular/common/http';
import { Subject, type Subscription } from 'rxjs';
import { DocumentsApi } from './documents-api';
import { uploadErrorMessage, validatePdf } from './document-format';

/**
 * - `queued`: waiting for the upload ahead of it
 * - `uploading`: bytes are being sent (`progress` is 0–100)
 * - `processing`: bytes sent; the server is extracting text and indexing
 * - `done` / `error`: finished (dismissable)
 */
export type UploadPhase =
  'queued' | 'uploading' | 'processing' | 'done' | 'error';

export interface UploadItem {
  readonly id: number;
  readonly name: string;
  readonly sizeBytes: number;
  readonly phase: UploadPhase;
  /** Upload percentage while `uploading`. */
  readonly progress: number;
  readonly error: string | null;
}

/**
 * Sequential PDF upload queue. Files are validated first (invalid ones become
 * `error` items without a request), then uploaded one at a time.
 * Provide it on the component that owns the upload UI.
 */
@Injectable()
export class UploadQueue {
  private readonly api = inject(DocumentsApi);

  private readonly _items = signal<readonly UploadItem[]>([]);
  private readonly _announcement = signal('');
  private readonly files = new Map<number, File>();
  private readonly listChanges = new Subject<void>();
  private nextId = 1;
  private active: Subscription | null = null;

  readonly items = this._items.asReadonly();
  /** Latest status change, for an `aria-live` region. */
  readonly announcement = this._announcement.asReadonly();
  /** Emits when the server's document list may have changed. */
  readonly listChanged = this.listChanges.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.active?.unsubscribe();
      this.listChanges.complete();
    });
  }

  add(files: Iterable<File>): void {
    const added: UploadItem[] = [];
    for (const file of files) {
      const id = this.nextId++;
      const error = validatePdf(file);
      added.push({
        id,
        name: file.name,
        sizeBytes: file.size,
        phase: error ? 'error' : 'queued',
        progress: 0,
        error,
      });
      if (error) this._announcement.set(`${file.name}: ${error}`);
      else this.files.set(id, file);
    }
    if (!added.length) return;
    // Newest first, like the document list.
    this._items.update((items) => [...added.reverse(), ...items]);
    this.pump();
  }

  /** Removes a finished (done or failed) item. */
  dismiss(id: number): void {
    this._items.update((items) =>
      items.filter(
        (i) => i.id !== id || (i.phase !== 'done' && i.phase !== 'error'),
      ),
    );
  }

  private pump(): void {
    if (this.active) return;
    // Oldest queued first.
    const next = [...this._items()].reverse().find((i) => i.phase === 'queued');
    const file = next && this.files.get(next.id);
    if (!next || !file) return;

    const { id, name } = next;
    this.patch(id, { phase: 'uploading', progress: 0 });
    this._announcement.set(`Uploading ${name}…`);

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.files.delete(id);
      this.active = null;
      this.listChanges.next();
      this.pump();
    };

    const subscription = this.api.upload(file).subscribe({
      next: (event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? file.size;
          if (total > 0 && event.loaded >= total) {
            this.startProcessing(id, name);
          } else if (total > 0) {
            this.patch(id, {
              progress: Math.min(99, Math.round((event.loaded / total) * 100)),
            });
          }
        } else if (event.type === HttpEventType.Response) {
          this.patch(id, { phase: 'done', progress: 100 });
          this._announcement.set(`${name} is ready.`);
        }
      },
      error: (error: unknown) => {
        const message = uploadErrorMessage(error);
        this.patch(id, { phase: 'error', error: message });
        this._announcement.set(`${name} wasn’t added: ${message}`);
        finish();
      },
      complete: finish,
    });
    // A synchronous completion has already run finish() (and started the next).
    if (!settled) this.active = subscription;
  }

  private startProcessing(id: number, name: string): void {
    const item = this._items().find((i) => i.id === id);
    if (item?.phase !== 'uploading') return;
    this.patch(id, { phase: 'processing', progress: 100 });
    this._announcement.set(`${name} uploaded. Processing…`);
    // The server lists it as `processing` now.
    this.listChanges.next();
  }

  private patch(id: number, patch: Partial<UploadItem>): void {
    this._items.update((items) =>
      items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );
  }
}
