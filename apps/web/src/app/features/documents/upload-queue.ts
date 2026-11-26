import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Subject, type Subscription } from 'rxjs';
import { DEMO_LIMITS } from '@ai-document-chatbot/shared';
import { DemoUsage } from '../../core/usage/demo-usage';
import { limitErrorCode } from '../../core/usage/limit-errors';
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

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * Why some picked files weren't queued: the demo's document slots or
 * lifetime uploads ran out. `queued` of `valid` files were added.
 */
export function skippedMessage(
  queued: number,
  valid: number,
  reason: 'documents' | 'uploads',
  uploadsLeft: number,
): string {
  const head = queued
    ? `Only ${queued} of ${valid} files ${queued === 1 ? 'was' : 'were'} added.`
    : valid === 1
      ? 'This file wasn’t added.'
      : 'These files weren’t added.';
  if (reason === 'documents') {
    return `${head} You can keep ${DEMO_LIMITS.maxDocuments} documents at a time; delete one to upload more.`;
  }
  return uploadsLeft > 0
    ? `${head} You have ${plural(uploadsLeft, 'demo upload', 'demo uploads')} left.`
    : `${head} You’ve used all ${DEMO_LIMITS.maxUploads} demo uploads.`;
}

/**
 * Sequential PDF upload queue. Files are validated first (invalid ones become
 * `error` items without a request), then uploaded one at a time. Files beyond
 * the demo's remaining document slots or uploads are skipped, with a
 * {@link skipped} notice. Provide it on the component that owns the upload UI.
 */
@Injectable()
export class UploadQueue {
  private readonly api = inject(DocumentsApi);
  private readonly usage = inject(DemoUsage);

  private readonly _items = signal<readonly UploadItem[]>([]);
  private readonly _announcement = signal('');
  private readonly _skipped = signal<string | null>(null);
  private readonly files = new Map<number, File>();
  private readonly listChanges = new Subject<void>();
  private nextId = 1;
  private active: Subscription | null = null;

  readonly items = this._items.asReadonly();
  /** Latest status change, for an `aria-live` region. */
  readonly announcement = this._announcement.asReadonly();
  /** Why the last pick left some files out (demo limits), or null. */
  readonly skipped = this._skipped.asReadonly();
  /** Emits when the server's document list may have changed. */
  readonly listChanged = this.listChanges.asObservable();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.active?.unsubscribe();
      this.listChanges.complete();
    });
  }

  add(files: Iterable<File>): void {
    this._skipped.set(null);
    const added: UploadItem[] = [];
    // Room left in the demo limits, minus uploads already in this queue
    // (the server counts them once they finish). Unknown usage: no cap here;
    // the server still enforces it.
    const pending = this._items().filter(
      (i) => i.phase === 'queued' || i.phase === 'uploading',
    ).length;
    const documentsLeft = this.usage.documentsLeft();
    const uploadsLeft = this.usage.uploadsLeft();
    const limited = documentsLeft !== null && uploadsLeft !== null;
    const roomFor = (left: number | null) =>
      left === null ? Infinity : Math.max(0, left - pending);
    const reason: 'documents' | 'uploads' =
      roomFor(uploadsLeft) <= roomFor(documentsLeft) ? 'uploads' : 'documents';
    let room = limited
      ? Math.min(roomFor(documentsLeft), roomFor(uploadsLeft))
      : Infinity;
    let valid = 0;
    let skipped = 0;
    for (const file of files) {
      const error = validatePdf(file);
      if (!error) {
        valid++;
        if (room <= 0) {
          skipped++;
          continue;
        }
        room--;
      }
      const id = this.nextId++;
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
    if (added.length) {
      // Newest first, like the document list.
      this._items.update((items) => [...added.reverse(), ...items]);
      this.pump();
    }
    if (skipped) {
      const message = skippedMessage(
        valid - skipped,
        valid,
        reason,
        roomFor(uploadsLeft),
      );
      this._skipped.set(message);
      // After pump()'s "Uploading…", so the reason is what's read out.
      this._announcement.set(message);
    }
  }

  dismissSkipped(): void {
    this._skipped.set(null);
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
        if (error instanceof HttpErrorResponse) {
          this.usage.noteLimit(limitErrorCode(error.error));
        }
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
