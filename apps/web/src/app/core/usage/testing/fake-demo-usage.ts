import { signal } from '@angular/core';
import type {
  LimitErrorCode,
  UsageResponse,
} from '@ai-document-chatbot/shared';
import { DemoUsageState } from '../demo-usage';
import { FRESH_USAGE } from './usage-fixtures';

/**
 * Stand-in for {@link DemoUsage} without HTTP: set {@link usage} directly and
 * count refreshes. Provide it as `{ provide: DemoUsage, useValue: fake }`.
 */
export class FakeDemoUsage extends DemoUsageState {
  readonly usage = signal<UsageResponse | null>(FRESH_USAGE);
  /** Like the server's `searchQuotaExhausted`; also set by {@link noteLimit}. */
  readonly searchPaused = signal(false);
  readonly loading = signal(false);
  refreshes = 0;
  readonly limits: LimitErrorCode[] = [];

  refresh(): void {
    this.refreshes++;
  }

  noteLimit(code: LimitErrorCode | undefined): void {
    if (!code) return;
    this.limits.push(code);
    if (code === 'search_quota_exhausted') this.searchPaused.set(true);
    this.refresh();
  }
}
