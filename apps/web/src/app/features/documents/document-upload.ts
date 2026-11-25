import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { outputFromObservable } from '@angular/core/rxjs-interop';
import { MAX_PDF_PAGES } from '@ai-document-chatbot/shared';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmProgressImports } from '@spartan-ng/helm/progress';
import { MAX_PDF_SIZE_LABEL, formatBytes } from './document-format';
import { UploadQueue } from './upload-queue';

/** Drop zone + file picker + the sequential upload queue's status rows. */
@Component({
  selector: 'app-document-upload',
  imports: [HlmButtonImports, HlmProgressImports],
  providers: [UploadQueue],
  templateUrl: './document-upload.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    // Dropping a file just outside the zone must not navigate away to the PDF.
    '(window:dragover)': '$event.preventDefault()',
    '(window:drop)': '$event.preventDefault()',
  },
})
export class DocumentUpload {
  protected readonly queue = inject(UploadQueue);

  /** Fires when the server's document list may have changed. */
  readonly changed = outputFromObservable(this.queue.listChanged);

  protected readonly maxSize = MAX_PDF_SIZE_LABEL;
  protected readonly maxPages = MAX_PDF_PAGES;
  protected readonly formatBytes = formatBytes;
  protected readonly dragging = signal(false);
  private dragDepth = 0;

  private readonly input =
    viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /** Short label for the file tile: the extension (`PDF`, `DOCX`…) or `FILE`. */
  protected fileType(name: string): string {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toUpperCase() : '';
    return ext && ext.length <= 4 ? ext : 'FILE';
  }

  protected browse(): void {
    this.input().nativeElement.click();
  }

  protected onPicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.queue.add(Array.from(input.files));
    // Allow picking the same file again after an error.
    input.value = '';
  }

  protected onDragEnter(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDragLeave(): void {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) this.queue.add(Array.from(files));
  }
}

function hasFiles(event: DragEvent): boolean {
  return !!event.dataTransfer?.types?.includes('Files');
}
